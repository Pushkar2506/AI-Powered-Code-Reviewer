const crypto = require('crypto')
const { query } = require('../config/database')

const selectReviewSql = `
    SELECT
        reviews.id,
        reviews.project_id,
        reviews.code,
        reviews.review,
        reviews.model,
        reviews.depth,
        reviews.source_type,
        reviews.source_url,
        reviews.score,
        reviews.fixed_code,
        reviews.checklist,
        reviews.comments,
        reviews.files,
        reviews.ai_options,
        reviews.is_favorite,
        reviews.notes,
        reviews.share_token,
        reviews.deleted_at,
        reviews.created_at,
        projects.name AS project_name
     FROM reviews
     LEFT JOIN projects ON projects.id = reviews.project_id
`

async function saveReview({ userId, projectId, code, review, model, depth, sourceType, sourceUrl, score, fixedCode, checklist, comments, files, aiOptions }) {
    const result = await query(
        `INSERT INTO reviews (
            user_id,
            project_id,
            code,
            review,
            model,
            depth,
            source_type,
            source_url,
            score,
            fixed_code,
            checklist,
            comments,
            files,
            ai_options
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13::jsonb, $14::jsonb)
         RETURNING id, project_id, code, review, model, depth, source_type, source_url, score, fixed_code, checklist, comments, files, ai_options, is_favorite, notes, share_token, deleted_at, created_at`,
        [
            userId,
            projectId || null,
            code,
            review,
            model,
            depth,
            sourceType,
            sourceUrl || null,
            score,
            fixedCode || null,
            JSON.stringify(checklist || []),
            JSON.stringify(comments || []),
            JSON.stringify(files || []),
            JSON.stringify(aiOptions || {})
        ]
    )

    return mapReview(result.rows[0])
}

async function getReviewsByUser(userId, filters = {}) {
    const params = [userId]
    const conditions = ['reviews.user_id = $1', 'reviews.deleted_at IS NULL']
    let searchOrder = ''

    if (filters.search) {
        const searchText = String(filters.search).toLowerCase().trim()
        params.push(`%${searchText}%`)
        const fuzzyIndex = params.length
        params.push(searchText)
        const exactIndex = params.length
        conditions.push(`(
            LOWER(COALESCE(projects.name, '')) LIKE $${fuzzyIndex}
            OR LOWER(reviews.source_type) LIKE $${fuzzyIndex}
            OR LOWER(reviews.review) LIKE $${fuzzyIndex}
            OR LOWER(reviews.code) LIKE $${fuzzyIndex}
            OR LOWER(COALESCE(reviews.notes, '')) LIKE $${fuzzyIndex}
        )`)
        searchOrder = `
            CASE
                WHEN LOWER(COALESCE(projects.name, '')) = $${exactIndex} THEN 0
                WHEN LOWER(COALESCE(projects.name, '')) LIKE $${fuzzyIndex} THEN 1
                WHEN LOWER(COALESCE(reviews.notes, '')) LIKE $${fuzzyIndex} THEN 2
                WHEN LOWER(reviews.source_type) LIKE $${fuzzyIndex} THEN 3
                WHEN LOWER(reviews.review) LIKE $${fuzzyIndex} THEN 4
                WHEN LOWER(reviews.code) LIKE $${fuzzyIndex} THEN 5
                ELSE 6
            END ASC,
        `
    }

    if (filters.model) {
        params.push(filters.model)
        conditions.push(`reviews.model = $${params.length}`)
    }

    if (filters.projectId) {
        params.push(Number(filters.projectId))
        conditions.push(`reviews.project_id = $${params.length}`)
    }

    if (filters.severity) {
        params.push(String(filters.severity).toLowerCase())
        conditions.push(`EXISTS (
            SELECT 1 FROM jsonb_array_elements(reviews.comments) AS comment
            WHERE LOWER(comment->>'severity') = $${params.length}
        )`)
    }

    if (filters.favorite === 'true') {
        conditions.push('reviews.is_favorite = TRUE')
    }

    if (filters.dateFrom) {
        params.push(filters.dateFrom)
        conditions.push(`reviews.created_at >= $${params.length}::date`)
    }

    if (filters.dateTo) {
        params.push(filters.dateTo)
        conditions.push(`reviews.created_at < ($${params.length}::date + interval '1 day')`)
    }

    const result = await query(
        `${selectReviewSql}
         WHERE ${conditions.join(' AND ')}
         ORDER BY ${searchOrder} reviews.is_favorite DESC, reviews.created_at DESC
         LIMIT 100`,
        params
    )

    return result.rows.map(mapReview)
}

async function getReviewById(userId, reviewId) {
    const result = await query(
        `${selectReviewSql}
         WHERE reviews.user_id = $1
         AND reviews.id = $2
         AND reviews.deleted_at IS NULL`,
        [userId, reviewId]
    )
    return result.rows[0] ? mapReview(result.rows[0]) : null
}

async function getSharedReview(shareToken) {
    const result = await query(
        `${selectReviewSql}
         WHERE reviews.share_token = $1
         AND reviews.deleted_at IS NULL`,
        [shareToken]
    )
    return result.rows[0] ? mapReview(result.rows[0]) : null
}

async function updateFavorite({ userId, reviewId, isFavorite }) {
    const result = await query(
        `UPDATE reviews
         SET is_favorite = $1
         WHERE user_id = $2
         AND id = $3
         AND deleted_at IS NULL
         RETURNING id, project_id, code, review, model, depth, source_type, source_url, score, fixed_code, checklist, comments, files, ai_options, is_favorite, notes, share_token, deleted_at, created_at`,
        [Boolean(isFavorite), userId, reviewId]
    )
    return result.rows[0] ? mapReview(result.rows[0]) : null
}

async function updateNotes({ userId, reviewId, notes }) {
    const result = await query(
        `UPDATE reviews
         SET notes = $1
         WHERE user_id = $2
         AND id = $3
         AND deleted_at IS NULL
         RETURNING id, project_id, code, review, model, depth, source_type, source_url, score, fixed_code, checklist, comments, files, ai_options, is_favorite, notes, share_token, deleted_at, created_at`,
        [notes, userId, reviewId]
    )
    return result.rows[0] ? mapReview(result.rows[0]) : null
}

async function deleteReview({ userId, reviewId }) {
    const result = await query(
        `UPDATE reviews
         SET deleted_at = NOW()
         WHERE user_id = $1
         AND id = $2
         AND deleted_at IS NULL
         RETURNING id`,
        [userId, reviewId]
    )
    return Boolean(result.rows[0])
}

async function createShareLink({ userId, reviewId }) {
    const existing = await getReviewById(userId, reviewId)
    if (!existing) return null
    if (existing.shareToken) return existing

    const shareToken = crypto.randomBytes(24).toString('hex')
    const result = await query(
        `UPDATE reviews
         SET share_token = $1
         WHERE user_id = $2
         AND id = $3
         AND deleted_at IS NULL
         RETURNING id, project_id, code, review, model, depth, source_type, source_url, score, fixed_code, checklist, comments, files, ai_options, is_favorite, notes, share_token, deleted_at, created_at`,
        [shareToken, userId, reviewId]
    )
    return result.rows[0] ? mapReview(result.rows[0]) : null
}

function createMarkdownExport(review) {
    return [
        `# ${review.projectName || 'Code Review Report'}`,
        '',
        `- Score: ${review.score || 0}/100`,
        `- Model: ${review.model}`,
        `- Depth: ${review.depth}`,
        `- Source: ${review.sourceType}`,
        `- Created: ${review.createdAt}`,
        review.notes ? `- Notes: ${review.notes}` : '',
        '',
        review.review,
        '',
        '## Inline Comments',
        ...(review.comments.length ? review.comments.map(comment => `- ${comment.file}:${comment.line} [${comment.severity}] ${comment.title} - ${comment.message}`) : ['- No inline comments.']),
        '',
        '## Checklist',
        ...(review.checklist.length ? review.checklist.map(item => `- ${item.label}: ${item.status} - ${item.note}`) : ['- No checklist items.'])
    ].filter(Boolean).join('\n')
}

function mapReview(review) {
    return {
        id: review.id,
        projectId: review.project_id,
        projectName: review.project_name,
        code: review.code,
        review: review.review,
        model: review.model,
        depth: review.depth,
        sourceType: review.source_type,
        sourceUrl: review.source_url,
        score: review.score,
        fixedCode: review.fixed_code,
        checklist: review.checklist || [],
        comments: review.comments || [],
        files: review.files || [],
        aiOptions: review.ai_options || {},
        isFavorite: review.is_favorite,
        notes: review.notes || '',
        shareToken: review.share_token,
        deletedAt: review.deleted_at,
        createdAt: review.created_at
    }
}

module.exports = {
    saveReview,
    getReviewsByUser,
    getReviewById,
    getSharedReview,
    updateFavorite,
    updateNotes,
    deleteReview,
    createShareLink,
    createMarkdownExport
}

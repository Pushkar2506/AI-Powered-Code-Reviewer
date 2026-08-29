const { query } = require('../config/database')

async function saveReview({ userId, projectId, code, review, model, depth, sourceType, sourceUrl, score, fixedCode, checklist, comments, files }) {
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
            files
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13::jsonb)
         RETURNING id, project_id, code, review, model, depth, source_type, source_url, score, fixed_code, checklist, comments, files, created_at`,
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
            JSON.stringify(files || [])
        ]
    )

    return mapReview(result.rows[0])
}

async function getReviewsByUser(userId) {
    const result = await query(
        `SELECT
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
            reviews.created_at,
            projects.name AS project_name
         FROM reviews
         LEFT JOIN projects ON projects.id = reviews.project_id
         WHERE reviews.user_id = $1
         ORDER BY reviews.created_at DESC
         LIMIT 50`,
        [userId]
    )

    return result.rows.map(mapReview)
}

async function getAdminStats() {
    const result = await query(`
        SELECT
            (SELECT COUNT(*)::int FROM users) AS users,
            (SELECT COUNT(*)::int FROM reviews) AS reviews,
            (SELECT COUNT(*)::int FROM projects) AS projects,
            (SELECT COUNT(*)::int FROM reviews WHERE created_at >= date_trunc('month', NOW())) AS reviews_this_month
    `)

    return result.rows[0]
}

async function getAdminUsers() {
    const result = await query(`
        SELECT
            users.id,
            users.name,
            users.email,
            users.role,
            users.monthly_limit,
            users.created_at,
            COUNT(reviews.id)::int AS total_reviews,
            COUNT(reviews.id) FILTER (WHERE reviews.created_at >= date_trunc('month', NOW()))::int AS reviews_this_month
        FROM users
        LEFT JOIN reviews ON reviews.user_id = users.id
        GROUP BY users.id
        ORDER BY users.created_at DESC
    `)

    return result.rows.map(user => ({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        monthlyLimit: user.monthly_limit,
        totalReviews: user.total_reviews,
        reviewsThisMonth: user.reviews_this_month,
        createdAt: user.created_at
    }))
}

async function updateUserLimit(userId, monthlyLimit) {
    const result = await query(
        `UPDATE users
         SET monthly_limit = $1
         WHERE id = $2
         RETURNING id, name, email, role, monthly_limit, created_at`,
        [monthlyLimit, userId]
    )

    return result.rows[0]
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
        createdAt: review.created_at
    }
}

module.exports = {
    saveReview,
    getReviewsByUser,
    getAdminStats,
    getAdminUsers,
    updateUserLimit
}

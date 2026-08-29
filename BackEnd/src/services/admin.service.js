const { query } = require('../config/database')
const { ADMIN_EMAIL } = require('../config/admin')

const COST_PER_REVIEW = Number(process.env.ESTIMATED_COST_PER_REVIEW) || 0.01

const sortMap = {
    newest: 'users.created_at DESC',
    name: 'LOWER(users.name) ASC',
    role: 'users.role ASC, LOWER(users.name) ASC',
    status: 'users.status ASC, LOWER(users.name) ASC',
    usage: 'reviews_this_month DESC, total_reviews DESC',
    cost: 'estimated_cost DESC',
    score: 'average_score DESC NULLS LAST'
}

function currency(value) {
    return Number(value || 0).toFixed(2)
}

function mapUser(row) {
    return {
        id: row.id,
        name: row.name,
        email: row.email,
        role: row.role,
        status: row.status,
        monthlyLimit: row.monthly_limit,
        totalReviews: row.total_reviews || 0,
        reviewsThisMonth: row.reviews_this_month || 0,
        averageScore: row.average_score ? Number(row.average_score) : 0,
        estimatedCost: Number(currency(row.estimated_cost)),
        createdAt: row.created_at
    }
}

function mapReview(row) {
    return {
        id: row.id,
        projectName: row.project_name,
        sourceType: row.source_type,
        sourceUrl: row.source_url,
        model: row.model,
        depth: row.depth,
        score: row.score,
        review: row.review,
        comments: row.comments || [],
        checklist: row.checklist || [],
        files: row.files || [],
        createdAt: row.created_at
    }
}

async function getOverview() {
    const result = await query(
        `SELECT
            COUNT(users.id)::int AS total_users,
            COUNT(users.id) FILTER (WHERE users.status = 'active')::int AS active_users,
            COUNT(users.id) FILTER (WHERE users.status = 'suspended')::int AS suspended_users,
            COUNT(users.id) FILTER (WHERE users.role = 'admin')::int AS admin_users,
            (SELECT COUNT(*)::int FROM projects) AS projects,
            (SELECT COUNT(*)::int FROM reviews) AS total_reviews,
            (SELECT COUNT(*)::int FROM reviews WHERE created_at >= date_trunc('month', NOW())) AS reviews_this_month,
            COALESCE((SELECT ROUND(AVG(score))::int FROM reviews), 0) AS average_score,
            COALESCE((SELECT COUNT(*) * $1::numeric FROM reviews WHERE created_at >= date_trunc('month', NOW())), 0)::numeric AS estimated_monthly_cost
         FROM users`,
        [COST_PER_REVIEW]
    )

    const row = result.rows[0]
    return {
        totalUsers: row.total_users,
        activeUsers: row.active_users,
        suspendedUsers: row.suspended_users,
        adminUsers: row.admin_users,
        projects: row.projects,
        totalReviews: row.total_reviews,
        reviewsThisMonth: row.reviews_this_month,
        averageScore: row.average_score,
        estimatedMonthlyCost: Number(currency(row.estimated_monthly_cost))
    }
}

async function getMonthlyUsage() {
    const result = await query(
        `WITH months AS (
            SELECT date_trunc('month', NOW()) - interval '11 months' + (interval '1 month' * generate_series(0, 11)) AS month_start
         )
         SELECT
            to_char(months.month_start, 'Mon YYYY') AS label,
            COUNT(reviews.id)::int AS reviews,
            COUNT(DISTINCT reviews.user_id)::int AS users,
            COALESCE(ROUND(AVG(reviews.score))::int, 0) AS average_score,
            (COUNT(reviews.id) * $1::numeric)::numeric AS estimated_cost
         FROM months
         LEFT JOIN reviews
            ON reviews.created_at >= months.month_start
            AND reviews.created_at < months.month_start + interval '1 month'
         GROUP BY months.month_start
         ORDER BY months.month_start ASC`,
        [COST_PER_REVIEW]
    )

    return result.rows.map(row => ({
        label: row.label,
        reviews: row.reviews,
        users: row.users,
        averageScore: row.average_score,
        estimatedCost: Number(currency(row.estimated_cost))
    }))
}

async function getModelUsage() {
    const result = await query(
        `SELECT
            model,
            COUNT(*)::int AS reviews,
            COUNT(DISTINCT user_id)::int AS users,
            COALESCE(ROUND(AVG(score))::int, 0) AS average_score,
            (COUNT(*) * $1::numeric)::numeric AS estimated_cost
         FROM reviews
         GROUP BY model
         ORDER BY reviews DESC, model ASC`,
        [COST_PER_REVIEW]
    )

    return result.rows.map(row => ({
        model: row.model,
        reviews: row.reviews,
        users: row.users,
        averageScore: row.average_score,
        estimatedCost: Number(currency(row.estimated_cost))
    }))
}

async function getCostByUser() {
    const result = await query(
        `SELECT
            users.id,
            users.name,
            users.email,
            COUNT(reviews.id)::int AS reviews,
            (COUNT(reviews.id) * $1::numeric)::numeric AS estimated_cost
         FROM users
         LEFT JOIN reviews ON reviews.user_id = users.id
         GROUP BY users.id
         ORDER BY estimated_cost DESC, LOWER(users.name) ASC
         LIMIT 20`,
        [COST_PER_REVIEW]
    )

    return result.rows.map(row => ({
        id: row.id,
        name: row.name,
        email: row.email,
        reviews: row.reviews,
        estimatedCost: Number(currency(row.estimated_cost))
    }))
}

async function getUsers(filters = {}) {
    const where = []
    const params = [COST_PER_REVIEW]
    const search = String(filters.search || '').trim()
    const role = String(filters.role || '').trim()
    const status = String(filters.status || '').trim()

    if (search) {
        params.push(`%${search.toLowerCase()}%`)
        where.push(`(LOWER(users.name) LIKE $${params.length} OR LOWER(users.email) LIKE $${params.length})`)
    }

    if (['admin', 'user'].includes(role)) {
        params.push(role)
        where.push(`users.role = $${params.length}`)
    }

    if (['active', 'suspended'].includes(status)) {
        params.push(status)
        where.push(`users.status = $${params.length}`)
    }

    const orderBy = sortMap[filters.sort] || sortMap.newest
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const result = await query(
        `SELECT
            users.id,
            users.name,
            users.email,
            users.role,
            users.status,
            users.monthly_limit,
            users.created_at,
            COUNT(reviews.id)::int AS total_reviews,
            COUNT(reviews.id) FILTER (WHERE reviews.created_at >= date_trunc('month', NOW()))::int AS reviews_this_month,
            COALESCE(ROUND(AVG(reviews.score))::int, 0) AS average_score,
            (COUNT(reviews.id) * $1::numeric)::numeric AS estimated_cost
         FROM users
         LEFT JOIN reviews ON reviews.user_id = users.id
         ${whereClause}
         GROUP BY users.id
         ORDER BY ${orderBy}
         LIMIT 200`,
        params
    )

    return result.rows.map(mapUser)
}

async function updateUserLimit(userId, monthlyLimit) {
    const result = await query(
        `UPDATE users
         SET monthly_limit = $1
         WHERE id = $2
         RETURNING id, name, email, role, status, monthly_limit, created_at`,
        [monthlyLimit, userId]
    )

    return result.rows[0] ? mapUser({ ...result.rows[0], total_reviews: 0, reviews_this_month: 0, average_score: 0, estimated_cost: 0 }) : null
}

async function updateUserStatus(userId, status) {
    const result = await query(
        `UPDATE users
         SET status = $1
         WHERE id = $2
         RETURNING id, name, email, role, status, monthly_limit, created_at`,
        [status, userId]
    )

    return result.rows[0] ? mapUser({ ...result.rows[0], total_reviews: 0, reviews_this_month: 0, average_score: 0, estimated_cost: 0 }) : null
}

async function updateUserRole(userId, role) {
    const result = await query(
        `UPDATE users
         SET role = $1
         WHERE id = $2
         AND ($1 <> 'admin' OR email = $3)
         AND (email <> $3 OR $1 = 'admin')
         RETURNING id, name, email, role, status, monthly_limit, created_at`,
        [role, userId, ADMIN_EMAIL]
    )

    return result.rows[0] ? mapUser({ ...result.rows[0], total_reviews: 0, reviews_this_month: 0, average_score: 0, estimated_cost: 0 }) : null
}

async function getUserReviewHistory(userId) {
    const result = await query(
        `SELECT
            reviews.id,
            reviews.source_type,
            reviews.source_url,
            reviews.model,
            reviews.depth,
            reviews.score,
            reviews.review,
            reviews.comments,
            reviews.checklist,
            reviews.files,
            reviews.created_at,
            projects.name AS project_name
         FROM reviews
         LEFT JOIN projects ON projects.id = reviews.project_id
         WHERE reviews.user_id = $1
         ORDER BY reviews.created_at DESC
         LIMIT 100`,
        [userId]
    )

    return result.rows.map(mapReview)
}

async function getAnalytics() {
    const [overview, monthlyUsage, modelUsage, costByUser] = await Promise.all([
        getOverview(),
        getMonthlyUsage(),
        getModelUsage(),
        getCostByUser()
    ])

    return { overview, monthlyUsage, modelUsage, costByUser }
}

async function getReportData() {
    const [analytics, users] = await Promise.all([
        getAnalytics(),
        getUsers({ sort: 'cost' })
    ])

    return {
        generatedAt: new Date().toISOString(),
        analytics,
        users
    }
}

module.exports = {
    getAnalytics,
    getOverview,
    getUsers,
    updateUserLimit,
    updateUserStatus,
    updateUserRole,
    getUserReviewHistory,
    getReportData
}

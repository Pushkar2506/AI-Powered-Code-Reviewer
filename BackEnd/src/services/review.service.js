const { query } = require('../config/database')

async function saveReview({ userId, code, review, model, depth }) {
    const result = await query(
        `INSERT INTO reviews (user_id, code, review, model, depth)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, code, review, model, depth, created_at`,
        [userId, code, review, model, depth]
    )

    return mapReview(result.rows[0])
}

async function getReviewsByUser(userId) {
    const result = await query(
        `SELECT id, code, review, model, depth, created_at
         FROM reviews
         WHERE user_id = $1
         ORDER BY created_at DESC
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
        code: review.code,
        review: review.review,
        model: review.model,
        depth: review.depth,
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

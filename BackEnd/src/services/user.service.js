const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const { query } = require('../config/database')

function createToken(user) {
    return jwt.sign(
        { userId: user.id, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    )
}

function sanitizeUser(user) {
    return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        monthlyLimit: user.monthly_limit,
        createdAt: user.created_at
    }
}

async function getUsage(userId) {
    const result = await query(
        `SELECT COUNT(*)::int AS used
         FROM reviews
         WHERE user_id = $1
         AND created_at >= date_trunc('month', NOW())`,
        [userId]
    )

    return result.rows[0]?.used || 0
}

async function registerUser({ name, email, password }) {
    const existing = await query('SELECT id FROM users WHERE email = $1', [email])

    if (existing.rows.length) {
        const error = new Error('An account with this email already exists.')
        error.statusCode = 409
        throw error
    }

    const role = email === process.env.ADMIN_EMAIL ? 'admin' : 'user'
    const monthlyLimit = Number(process.env.DEFAULT_MONTHLY_LIMIT) || 20
    const passwordHash = await bcrypt.hash(password, 12)
    const result = await query(
        `INSERT INTO users (name, email, password_hash, role, monthly_limit)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, name, email, role, monthly_limit, created_at`,
        [name, email, passwordHash, role, monthlyLimit]
    )

    const user = result.rows[0]
    return {
        user: sanitizeUser(user),
        token: createToken(user)
    }
}

async function loginUser({ email, password }) {
    const result = await query('SELECT * FROM users WHERE email = $1', [email])
    const user = result.rows[0]

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
        const error = new Error('Invalid email or password.')
        error.statusCode = 401
        throw error
    }

    return {
        user: sanitizeUser(user),
        token: createToken(user)
    }
}

async function getUserProfile(user) {
    const used = await getUsage(user.id)

    return {
        user: sanitizeUser(user),
        usage: {
            used,
            limit: user.monthly_limit,
            remaining: Math.max(user.monthly_limit - used, 0)
        }
    }
}

module.exports = {
    registerUser,
    loginUser,
    getUserProfile,
    getUsage,
    sanitizeUser
}

const bcrypt = require('bcryptjs')
const crypto = require('crypto')
const jwt = require('jsonwebtoken')
const { query } = require('../config/database')
const { ADMIN_EMAIL, ADMIN_PASSWORD } = require('../config/admin')
const teamService = require('./team.service')
const emailService = require('./email.service')

const APP_NAME = 'AI Powered Code Reveiwer'

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
        status: user.status,
        emailVerified: user.email_verified,
        avatarUrl: user.avatar_url,
        bio: user.bio,
        monthlyLimit: user.monthly_limit,
        createdAt: user.created_at
    }
}

function createRawToken() {
    return crypto.randomBytes(24).toString('hex')
}

async function createAuthToken(userId, type, minutes = 30) {
    const token = createRawToken()
    await query(
        `INSERT INTO auth_tokens (user_id, type, token, expires_at)
         VALUES ($1, $2, $3, NOW() + ($4::text || ' minutes')::interval)`,
        [userId, type, token, minutes]
    )
    return token
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
    const normalizedEmail = String(email || '').toLowerCase()
    const existing = await query('SELECT id FROM users WHERE email = $1', [normalizedEmail])

    if (existing.rows.length) {
        const error = new Error('An account with this email already exists.')
        error.statusCode = 409
        throw error
    }

    if (normalizedEmail === ADMIN_EMAIL) {
        const error = new Error('This administrator account is already managed by the system.')
        error.statusCode = 409
        throw error
    }

    const monthlyLimit = Number(process.env.DEFAULT_MONTHLY_LIMIT) || 20
    const passwordHash = await bcrypt.hash(password, 12)
    const result = await query(
        `INSERT INTO users (name, email, password_hash, role, monthly_limit)
         VALUES ($1, $2, $3, 'user', $4)
         RETURNING id, name, email, role, status, email_verified, avatar_url, bio, two_factor_enabled, monthly_limit, created_at`,
        [name, normalizedEmail, passwordHash, monthlyLimit]
    )

    const user = result.rows[0]
    await teamService.ensurePersonalWorkspace(user)

    const verificationToken = await createAuthToken(user.id, 'email_verification', 60 * 24)
    let verificationSent = true
    try {
        await emailService.sendVerificationEmail(user, verificationToken)
    } catch (error) {
        verificationSent = false
        console.error('Verification email failed:', error.message)
    }

    return {
        user: sanitizeUser(user),
        token: createToken(user),
        verificationSent
    }
}

async function loginUser({ email, password }) {
    const normalizedEmail = String(email || '').toLowerCase()
    const result = await query('SELECT * FROM users WHERE email = $1', [normalizedEmail])
    const user = result.rows[0]

    const isSystemAdminLogin = normalizedEmail === ADMIN_EMAIL
    const passwordMatches = isSystemAdminLogin
        ? password === ADMIN_PASSWORD
        : Boolean(user && await bcrypt.compare(password, user.password_hash))

    if (!user || !passwordMatches) {
        const error = new Error('Invalid email or password.')
        error.statusCode = 401
        throw error
    }

    if (user.status !== 'active') {
        const error = new Error('This account is suspended. Please contact an administrator.')
        error.statusCode = 403
        throw error
    }

    return {
        user: sanitizeUser(user),
        token: createToken(user)
    }
}

async function getUserProfile(user) {
    const used = await getUsage(user.id)
    await teamService.ensurePersonalWorkspace(user)
    const workspaces = await teamService.getMyWorkspaces(user.id)

    return {
        user: sanitizeUser(user),
        workspaces,
        usage: {
            used,
            limit: user.monthly_limit,
            remaining: Math.max(user.monthly_limit - used, 0)
        }
    }
}

async function updateProfile(userId, { name, bio, avatarUrl }) {
    const result = await query(
        `UPDATE users
         SET name = COALESCE($1, name),
             bio = COALESCE($2, bio),
             avatar_url = COALESCE($3, avatar_url)
         WHERE id = $4
         RETURNING id, name, email, role, status, email_verified, avatar_url, bio, two_factor_enabled, monthly_limit, created_at`,
        [name || null, bio ?? null, avatarUrl ?? null, userId]
    )

    return sanitizeUser(result.rows[0])
}

async function updatePassword(userId, { currentPassword, newPassword }) {
    const result = await query('SELECT * FROM users WHERE id = $1', [userId])
    const user = result.rows[0]

    if (user.email === ADMIN_EMAIL) {
        const error = new Error('The fixed system admin password is managed in server configuration.')
        error.statusCode = 400
        throw error
    }

    const currentMatches = await bcrypt.compare(currentPassword, user.password_hash)

    if (!currentMatches) {
        const error = new Error('Current password is incorrect.')
        error.statusCode = 401
        throw error
    }

    const passwordHash = await bcrypt.hash(newPassword, 12)
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userId])
}

async function requestPasswordReset(email) {
    const normalizedEmail = String(email || '').toLowerCase()
    const result = await query('SELECT id, name, email FROM users WHERE email = $1', [normalizedEmail])
    const user = result.rows[0]

    if (!user || normalizedEmail === ADMIN_EMAIL) return

    const resetToken = await createAuthToken(user.id, 'password_reset', 30)
    await emailService.sendPasswordResetEmail(user, resetToken)
}

async function resetPassword({ token, password }) {
    const tokenResult = await query(
        `SELECT *
         FROM auth_tokens
         WHERE token = $1
         AND type = 'password_reset'
         AND used_at IS NULL
         AND expires_at > NOW()`,
        [token]
    )
    const tokenRow = tokenResult.rows[0]

    if (!tokenRow) {
        const error = new Error('Password reset link is invalid or expired.')
        error.statusCode = 400
        throw error
    }

    const passwordHash = await bcrypt.hash(password, 12)
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, tokenRow.user_id])
    await query('UPDATE auth_tokens SET used_at = NOW() WHERE id = $1', [tokenRow.id])
}

async function requestEmailVerification(userId) {
    const result = await query('SELECT id, name, email, email_verified FROM users WHERE id = $1', [userId])
    const user = result.rows[0]
    if (!user) return { sent: false, alreadyVerified: false }
    if (user.email_verified) return { sent: false, alreadyVerified: true }

    const verificationToken = await createAuthToken(userId, 'email_verification', 60 * 24)
    await emailService.sendVerificationEmail(user, verificationToken)
    return { sent: true, alreadyVerified: false, email: user.email }
}

async function verifyEmail(token) {
    const tokenResult = await query(
        `SELECT *
         FROM auth_tokens
         WHERE token = $1
         AND type = 'email_verification'
         AND used_at IS NULL
         AND expires_at > NOW()`,
        [token]
    )
    const tokenRow = tokenResult.rows[0]

    if (!tokenRow) {
        const error = new Error('Email verification link is invalid or expired.')
        error.statusCode = 400
        throw error
    }

    const result = await query(
        `UPDATE users
         SET email_verified = TRUE
         WHERE id = $1
         RETURNING id, name, email, role, status, email_verified, avatar_url, bio, two_factor_enabled, monthly_limit, created_at`,
        [tokenRow.user_id]
    )
    await query('UPDATE auth_tokens SET used_at = NOW() WHERE id = $1', [tokenRow.id])
    return sanitizeUser(result.rows[0])
}

async function oauthLogin({ provider, providerUserId, email, name, avatarUrl }) {
    const normalizedEmail = String(email || '').toLowerCase()

    if (!normalizedEmail) {
        const error = new Error('OAuth profile did not include an email address.')
        error.statusCode = 400
        throw error
    }

    if (normalizedEmail === ADMIN_EMAIL) {
        const error = new Error('The system admin account must sign in with email and password.')
        error.statusCode = 403
        throw error
    }

    const displayName = name || normalizedEmail.split('@')[0] || provider
    const existing = await query('SELECT * FROM users WHERE email = $1', [normalizedEmail])
    let user = existing.rows[0]

    if (!user) {
        const passwordHash = await bcrypt.hash(createRawToken(), 12)
        const result = await query(
            `INSERT INTO users (name, email, password_hash, role, status, email_verified, avatar_url, monthly_limit)
             VALUES ($1, $2, $3, 'user', 'active', TRUE, $4, $5)
             RETURNING id, name, email, role, status, email_verified, avatar_url, bio, two_factor_enabled, monthly_limit, created_at`,
            [displayName, normalizedEmail, passwordHash, avatarUrl || null, Number(process.env.DEFAULT_MONTHLY_LIMIT) || 20]
        )
        user = result.rows[0]
    } else {
        const result = await query(
            `UPDATE users
             SET email_verified = TRUE,
                 avatar_url = COALESCE(avatar_url, $2)
             WHERE id = $1
             RETURNING id, name, email, role, status, email_verified, avatar_url, bio, two_factor_enabled, monthly_limit, created_at`,
            [user.id, avatarUrl || null]
        )
        user = result.rows[0]
    }

    if (providerUserId) {
        await query(
            `INSERT INTO oauth_accounts (user_id, provider, provider_user_id, email)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (provider, provider_user_id)
             DO UPDATE SET user_id = EXCLUDED.user_id, email = EXCLUDED.email`,
            [user.id, provider, providerUserId, normalizedEmail]
        )
    }

    await teamService.ensurePersonalWorkspace(user)
    return {
        user: sanitizeUser(user),
        token: createToken(user)
    }
}

module.exports = {
    registerUser,
    loginUser,
    getUserProfile,
    updateProfile,
    updatePassword,
    requestPasswordReset,
    resetPassword,
    requestEmailVerification,
    verifyEmail,
    oauthLogin,
    getUsage,
    sanitizeUser
}

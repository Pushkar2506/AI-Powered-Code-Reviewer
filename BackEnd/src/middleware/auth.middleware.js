const jwt = require('jsonwebtoken')
const { query } = require('../config/database')
const businessService = require('../services/business.service')

async function requireAuth(req, res, next) {
    try {
        const header = req.headers.authorization
        const token = header?.startsWith('Bearer ') ? header.slice(7) : null

        if (!token) {
            return res.status(401).json({ error: 'Authentication required.' })
        }

        const payload = jwt.verify(token, process.env.JWT_SECRET)
        const result = await query(
            'SELECT id, name, email, role, status, monthly_limit, created_at FROM users WHERE id = $1',
            [payload.userId]
        )

        if (!result.rows.length) {
            return res.status(401).json({ error: 'Invalid session.' })
        }

        const user = result.rows[0]

        if (user.status !== 'active') {
            return res.status(403).json({ error: 'This account is suspended. Please contact an administrator.' })
        }

        req.user = user
        return next()
    } catch (error) {
        console.error('Authentication failed:', error)
        return res.status(401).json({ error: 'Invalid or expired session.' })
    }
}

async function requireApiKey(req, res, next) {
    try {
        const header = req.headers.authorization
        const bearerKey = header?.startsWith('Bearer ') ? header.slice(7) : null
        const apiKey = req.headers['x-api-key'] || bearerKey

        if (!apiKey) {
            return res.status(401).json({ error: 'API key required.' })
        }

        const user = await businessService.authenticateApiKey(apiKey)
        if (!user) {
            return res.status(401).json({ error: 'Invalid API key.' })
        }

        req.user = user
        req.apiKeyId = user.apiKeyId
        return next()
    } catch (error) {
        console.error('API key authentication failed:', error)
        return res.status(401).json({ error: 'Invalid API key.' })
    }
}

function requireAdmin(req, res, next) {
    if (req.user?.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required.' })
    }

    return next()
}

module.exports = {
    requireAuth,
    requireApiKey,
    requireAdmin
}

const jwt = require('jsonwebtoken')
const { query } = require('../config/database')

async function requireAuth(req, res, next) {
    try {
        const header = req.headers.authorization
        const token = header?.startsWith('Bearer ') ? header.slice(7) : null

        if (!token) {
            return res.status(401).json({ error: 'Authentication required.' })
        }

        const payload = jwt.verify(token, process.env.JWT_SECRET)
        const result = await query(
            'SELECT id, name, email, role, monthly_limit, created_at FROM users WHERE id = $1',
            [payload.userId]
        )

        if (!result.rows.length) {
            return res.status(401).json({ error: 'Invalid session.' })
        }

        req.user = result.rows[0]
        return next()
    } catch (error) {
        console.error('Authentication failed:', error)
        return res.status(401).json({ error: 'Invalid or expired session.' })
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
    requireAdmin
}

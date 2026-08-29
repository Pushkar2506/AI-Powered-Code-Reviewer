const express = require('express');
const cors = require('cors')
const helmet = require('helmet')
const rateLimit = require('express-rate-limit')
const aiRoutes = require('./routes/ai.routes')
const authRoutes = require('./routes/auth.routes')
const reviewRoutes = require('./routes/review.routes')
const adminRoutes = require('./routes/admin.routes')
const projectRoutes = require('./routes/project.routes')

const app = express()

const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://localhost:5175')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean)

const appLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: Number(process.env.RATE_LIMIT_APP_MAX_REQUESTS) || 1000,
    standardHeaders: true,
    legacyHeaders: false,
    skip: req => req.method === 'OPTIONS' || req.path === '/health',
    message: {
        error: 'Too many requests. Please wait a moment and try again.'
    }
})

const aiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: Number(process.env.RATE_LIMIT_AI_MAX_REQUESTS) || 40,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: 'Too many AI review requests. Please try again later.'
    }
})

app.use(helmet())

app.use(cors({
    origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
            return callback(null, true)
        }

        return callback(new Error('Not allowed by CORS'))
    }
}))

app.use(appLimiter)
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '256kb' }))

app.get('/', (req, res) => {
    res.json({ status: 'ok', service: 'ai-code-reviewer-api' })
})

app.get('/health', (req, res) => {
    res.json({ status: 'ok' })
})

app.use('/ai', aiLimiter, aiRoutes)
app.use('/auth', authRoutes)
app.use('/reviews', reviewRoutes)
app.use('/projects', projectRoutes)
app.use('/admin', adminRoutes)

app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' })
})

app.use((err, req, res, next) => {
    console.error(err)

    if (err.type === 'entity.too.large') {
        return res.status(413).json({ error: 'Request body is too large.' })
    }

    if (err.message === 'Not allowed by CORS') {
        return res.status(403).json({ error: 'This origin is not allowed.' })
    }

    return res.status(500).json({ error: 'Something went wrong. Please try again.' })
})

module.exports = app

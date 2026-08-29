const adminService = require('../services/admin.service')
const { ADMIN_EMAIL } = require('../config/admin')

module.exports.getStats = async (req, res) => {
    const overview = await adminService.getOverview()
    return res.json({
        stats: {
            users: overview.totalUsers,
            projects: overview.projects,
            reviews: overview.totalReviews,
            reviews_this_month: overview.reviewsThisMonth
        },
        overview
    })
}

module.exports.getAnalytics = async (req, res) => {
    const analytics = await adminService.getAnalytics()
    return res.json({ analytics })
}

module.exports.getUsers = async (req, res) => {
    const users = await adminService.getUsers(req.query)
    return res.json({ users })
}

module.exports.updateUserLimit = async (req, res) => {
    const monthlyLimit = Number(req.body.monthlyLimit)

    if (!Number.isInteger(monthlyLimit) || monthlyLimit < 0 || monthlyLimit > 10000) {
        return res.status(400).json({ error: 'Monthly limit must be a number between 0 and 10000.' })
    }

    const user = await adminService.updateUserLimit(req.params.userId, monthlyLimit)

    if (!user) {
        return res.status(404).json({ error: 'User not found.' })
    }

    return res.json({ user })
}

module.exports.updateUserStatus = async (req, res) => {
    const status = String(req.body.status || '').trim()

    if (!['active', 'suspended'].includes(status)) {
        return res.status(400).json({ error: 'Status must be active or suspended.' })
    }

    if (Number(req.params.userId) === req.user.id && status !== 'active') {
        return res.status(400).json({ error: 'You cannot suspend your own admin account.' })
    }

    const user = await adminService.updateUserStatus(req.params.userId, status)

    if (!user) {
        return res.status(404).json({ error: 'User not found.' })
    }

    return res.json({ user })
}

module.exports.updateUserRole = async (req, res) => {
    const role = String(req.body.role || '').trim()

    if (!['admin', 'user'].includes(role)) {
        return res.status(400).json({ error: 'Role must be admin or user.' })
    }

    if (Number(req.params.userId) === req.user.id && role !== 'admin') {
        return res.status(400).json({ error: 'You cannot remove admin access from your own account.' })
    }

    if (role === 'admin') {
        const users = await adminService.getUsers({})
        const target = users.find(user => user.id === Number(req.params.userId))

        if (target && target.email !== ADMIN_EMAIL) {
            return res.status(400).json({ error: 'Only admin@gmail.com can have administrator access.' })
        }
    }

    const user = await adminService.updateUserRole(req.params.userId, role)

    if (!user) {
        return res.status(404).json({ error: 'User not found or role change is not allowed.' })
    }

    return res.json({ user })
}

module.exports.getUserReviewHistory = async (req, res) => {
    const reviews = await adminService.getUserReviewHistory(req.params.userId)
    return res.json({ reviews })
}

module.exports.exportReport = async (req, res) => {
    const report = await adminService.getReportData()

    if (req.query.format === 'csv') {
        const csv = toCsv(report.users)
        res.setHeader('Content-Type', 'text/csv')
        res.setHeader('Content-Disposition', 'attachment; filename="admin-report.csv"')
        return res.send(csv)
    }

    res.setHeader('Content-Disposition', 'attachment; filename="admin-report.json"')
    return res.json(report)
}

function toCsv(users) {
    const headers = [
        'name',
        'email',
        'role',
        'status',
        'reviewsThisMonth',
        'totalReviews',
        'averageScore',
        'monthlyLimit',
        'estimatedCost',
        'createdAt'
    ]
    const rows = users.map(user => headers.map(header => escapeCsv(user[header])).join(','))
    return [headers.join(','), ...rows].join('\n')
}

function escapeCsv(value) {
    const text = String(value ?? '')
    if (/[",\n]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`
    }
    return text
}

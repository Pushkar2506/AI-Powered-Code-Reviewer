const reviewService = require('../services/review.service')

module.exports.getStats = async (req, res) => {
    const stats = await reviewService.getAdminStats()
    return res.json({ stats })
}

module.exports.getUsers = async (req, res) => {
    const users = await reviewService.getAdminUsers()
    return res.json({ users })
}

module.exports.updateUserLimit = async (req, res) => {
    const monthlyLimit = Number(req.body.monthlyLimit)

    if (!Number.isInteger(monthlyLimit) || monthlyLimit < 0 || monthlyLimit > 10000) {
        return res.status(400).json({ error: 'Monthly limit must be a number between 0 and 10000.' })
    }

    const user = await reviewService.updateUserLimit(req.params.userId, monthlyLimit)

    if (!user) {
        return res.status(404).json({ error: 'User not found.' })
    }

    return res.json({ user })
}

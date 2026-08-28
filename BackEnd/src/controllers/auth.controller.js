const userService = require('../services/user.service')

function validateAuthPayload(req, res, includeName = false) {
    const { name, email, password } = req.body

    if (includeName && (typeof name !== 'string' || !name.trim())) {
        res.status(400).json({ error: 'Name is required.' })
        return null
    }

    if (typeof email !== 'string' || !email.trim()) {
        res.status(400).json({ error: 'Email is required.' })
        return null
    }

    if (typeof password !== 'string' || password.length < 8) {
        res.status(400).json({ error: 'Password must be at least 8 characters.' })
        return null
    }

    return {
        name: name?.trim(),
        email: email.trim().toLowerCase(),
        password
    }
}

module.exports.register = async (req, res) => {
    try {
        const payload = validateAuthPayload(req, res, true)
        if (!payload) return

        const response = await userService.registerUser(payload)
        return res.status(201).json(response)
    } catch (error) {
        return res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : 'Unable to create account.'
        })
    }
}

module.exports.login = async (req, res) => {
    try {
        const payload = validateAuthPayload(req, res)
        if (!payload) return

        const response = await userService.loginUser(payload)
        return res.json(response)
    } catch (error) {
        return res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : 'Unable to sign in.'
        })
    }
}

module.exports.me = async (req, res) => {
    const profile = await userService.getUserProfile(req.user)
    return res.json(profile)
}

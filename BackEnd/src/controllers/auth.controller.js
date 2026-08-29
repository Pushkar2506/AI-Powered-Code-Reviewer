const userService = require('../services/user.service')
const oauthService = require('../services/oauth.service')

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

module.exports.updateProfile = async (req, res) => {
    const user = await userService.updateProfile(req.user.id, {
        name: typeof req.body.name === 'string' ? req.body.name.trim() : null,
        bio: typeof req.body.bio === 'string' ? req.body.bio.trim() : null,
        avatarUrl: typeof req.body.avatarUrl === 'string' ? req.body.avatarUrl.trim() : null
    })
    return res.json({ user })
}

module.exports.updatePassword = async (req, res) => {
    try {
        if (typeof req.body.newPassword !== 'string' || req.body.newPassword.length < 8) {
            return res.status(400).json({ error: 'New password must be at least 8 characters.' })
        }

        await userService.updatePassword(req.user.id, {
            currentPassword: String(req.body.currentPassword || ''),
            newPassword: req.body.newPassword
        })
        return res.json({ message: 'Password updated.' })
    } catch (error) {
        return res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Unable to update password.' })
    }
}

module.exports.requestPasswordReset = async (req, res) => {
    try {
        await userService.requestPasswordReset(String(req.body.email || ''))
        return res.json({ message: 'If an account exists, a password reset email has been sent.' })
    } catch (error) {
        return res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Unable to send reset email.' })
    }
}

module.exports.resetPassword = async (req, res) => {
    try {
        if (typeof req.body.password !== 'string' || req.body.password.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters.' })
        }

        await userService.resetPassword({
            token: String(req.body.token || ''),
            password: req.body.password
        })
        return res.json({ message: 'Password reset complete.' })
    } catch (error) {
        return res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Unable to reset password.' })
    }
}

module.exports.requestEmailVerification = async (req, res) => {
    try {
        const result = await userService.requestEmailVerification(req.user.id)
        return res.json({
            message: result.alreadyVerified ? 'Your email is already verified.' : 'Verification email sent.',
            sent: result.sent,
            alreadyVerified: result.alreadyVerified
        })
    } catch (error) {
        return res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Unable to send verification email.' })
    }
}

module.exports.verifyEmail = async (req, res) => {
    try {
        const user = await userService.verifyEmail(String(req.body.token || ''))
        return res.json({ user })
    } catch (error) {
        return res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Unable to verify email.' })
    }
}

module.exports.startGoogleOAuth = async (req, res) => {
    try {
        return res.redirect(oauthService.googleStartUrl())
    } catch (error) {
        return res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Unable to start Google sign-in.' })
    }
}

module.exports.completeGoogleOAuth = async (req, res) => {
    try {
        const response = await oauthService.completeGoogleOAuth({
            code: String(req.query.code || ''),
            state: String(req.query.state || '')
        })
        return res.redirect(oauthService.oauthRedirectUrl({ token: response.token }))
    } catch (error) {
        return res.redirect(oauthService.oauthRedirectUrl({ error: error.statusCode ? error.message : 'Unable to complete Google sign-in.' }))
    }
}

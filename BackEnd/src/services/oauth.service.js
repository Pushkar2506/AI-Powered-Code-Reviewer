const jwt = require('jsonwebtoken')
const userService = require('./user.service')

function getBackendUrl() {
    return (process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '')
}

function getFrontendUrl() {
    return (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '')
}

function createState(provider) {
    return jwt.sign(
        { provider, nonce: Math.random().toString(36).slice(2) },
        process.env.JWT_SECRET,
        { expiresIn: '10m' }
    )
}

function verifyState(provider, state) {
    const payload = jwt.verify(state, process.env.JWT_SECRET)
    return payload.provider === provider
}

function googleStartUrl() {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
        const error = new Error('Google OAuth is not configured.')
        error.statusCode = 503
        throw error
    }

    const params = new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        redirect_uri: `${getBackendUrl()}/auth/oauth/google/callback`,
        response_type: 'code',
        scope: 'openid email profile',
        prompt: 'select_account',
        state: createState('google')
    })

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

async function completeGoogleOAuth({ code, state }) {
    if (!verifyState('google', state)) {
        const error = new Error('OAuth session is invalid or expired.')
        error.statusCode = 400
        throw error
    }

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            code,
            client_id: process.env.GOOGLE_CLIENT_ID,
            client_secret: process.env.GOOGLE_CLIENT_SECRET,
            redirect_uri: `${getBackendUrl()}/auth/oauth/google/callback`,
            grant_type: 'authorization_code'
        })
    })

    if (!tokenResponse.ok) {
        const error = new Error('Google sign-in could not be completed.')
        error.statusCode = 502
        throw error
    }

    const tokenData = await tokenResponse.json()
    const profileResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` }
    })

    if (!profileResponse.ok) {
        const error = new Error('Google profile could not be loaded.')
        error.statusCode = 502
        throw error
    }

    const profile = await profileResponse.json()
    return userService.oauthLogin({
        provider: 'google',
        providerUserId: profile.sub,
        email: profile.email,
        name: profile.name,
        avatarUrl: profile.picture
    })
}

function oauthRedirectUrl({ token, error }) {
    const params = new URLSearchParams()
    if (token) params.set('oauthToken', token)
    if (error) params.set('oauthError', error)
    return `${getFrontendUrl()}/?${params.toString()}`
}

module.exports = {
    googleStartUrl,
    completeGoogleOAuth,
    oauthRedirectUrl
}

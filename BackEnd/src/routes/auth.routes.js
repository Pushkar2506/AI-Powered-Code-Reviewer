const express = require('express')
const authController = require('../controllers/auth.controller')
const { requireAuth } = require('../middleware/auth.middleware')

const router = express.Router()

router.post('/register', authController.register)
router.post('/login', authController.login)
router.post('/forgot-password', authController.requestPasswordReset)
router.post('/reset-password', authController.resetPassword)
router.post('/verify-email', authController.verifyEmail)
router.get('/oauth/google/start', authController.startGoogleOAuth)
router.get('/oauth/google/callback', authController.completeGoogleOAuth)
router.get('/me', requireAuth, authController.me)
router.patch('/me', requireAuth, authController.updateProfile)
router.patch('/password', requireAuth, authController.updatePassword)
router.post('/email-verification', requireAuth, authController.requestEmailVerification)

module.exports = router

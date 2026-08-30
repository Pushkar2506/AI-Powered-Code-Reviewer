const express = require('express')
const developerController = require('../controllers/developer.controller')
const { requireAuth } = require('../middleware/auth.middleware')

const router = express.Router()
const wrap = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)

router.get('/docs', developerController.getPublicDocs)
router.use(requireAuth)
router.get('/', wrap(developerController.getDeveloperResources))
router.post('/api-keys', wrap(developerController.createApiKey))
router.delete('/api-keys/:keyId', wrap(developerController.revokeApiKey))
router.post('/webhooks', wrap(developerController.createWebhook))
router.delete('/webhooks/:webhookId', wrap(developerController.deleteWebhook))

module.exports = router

const express = require('express')
const complianceController = require('../controllers/compliance.controller')
const { requireAuth } = require('../middleware/auth.middleware')

const router = express.Router()
const wrap = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)

router.use(requireAuth)
router.get('/', wrap(complianceController.getCompliance))
router.patch('/privacy', wrap(complianceController.updatePrivacy))
router.post('/retention/apply', wrap(complianceController.applyRetention))

module.exports = router

const express = require('express')
const adminController = require('../controllers/admin.controller')
const { requireAuth, requireAdmin } = require('../middleware/auth.middleware')

const router = express.Router()
const wrap = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)

router.use(requireAuth, requireAdmin)
router.get('/stats', wrap(adminController.getStats))
router.get('/analytics', wrap(adminController.getAnalytics))
router.get('/users', wrap(adminController.getUsers))
router.get('/users/:userId/reviews', wrap(adminController.getUserReviewHistory))
router.get('/export', wrap(adminController.exportReport))
router.patch('/users/:userId/limit', wrap(adminController.updateUserLimit))
router.patch('/users/:userId/status', wrap(adminController.updateUserStatus))
router.patch('/users/:userId/role', wrap(adminController.updateUserRole))

module.exports = router

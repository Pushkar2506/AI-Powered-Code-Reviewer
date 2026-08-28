const express = require('express')
const adminController = require('../controllers/admin.controller')
const { requireAuth, requireAdmin } = require('../middleware/auth.middleware')

const router = express.Router()

router.use(requireAuth, requireAdmin)
router.get('/stats', adminController.getStats)
router.get('/users', adminController.getUsers)
router.patch('/users/:userId/limit', adminController.updateUserLimit)

module.exports = router

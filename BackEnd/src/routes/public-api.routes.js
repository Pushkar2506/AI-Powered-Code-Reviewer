const express = require('express')
const aiController = require('../controllers/ai.controller')
const { requireApiKey } = require('../middleware/auth.middleware')

const router = express.Router()

router.post('/reviews', requireApiKey, aiController.getReview)

module.exports = router

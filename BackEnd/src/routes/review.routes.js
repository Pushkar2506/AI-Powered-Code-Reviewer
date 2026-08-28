const express = require('express')
const reviewController = require('../controllers/review.controller')
const { requireAuth } = require('../middleware/auth.middleware')

const router = express.Router()

router.get('/', requireAuth, reviewController.getMyReviews)

module.exports = router

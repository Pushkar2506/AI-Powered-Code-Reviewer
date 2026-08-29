const express = require('express')
const reviewController = require('../controllers/review.controller')
const { requireAuth } = require('../middleware/auth.middleware')

const router = express.Router()
const wrap = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)

router.get('/shared/:shareToken', wrap(reviewController.getSharedReview))
router.get('/', requireAuth, wrap(reviewController.getMyReviews))
router.get('/:reviewId', requireAuth, wrap(reviewController.getReview))
router.get('/:reviewId/export.md', requireAuth, wrap(reviewController.exportMarkdown))
router.post('/:reviewId/share', requireAuth, wrap(reviewController.shareReview))
router.patch('/:reviewId/favorite', requireAuth, wrap(reviewController.updateFavorite))
router.patch('/:reviewId/notes', requireAuth, wrap(reviewController.updateNotes))
router.delete('/:reviewId', requireAuth, wrap(reviewController.deleteReview))

module.exports = router

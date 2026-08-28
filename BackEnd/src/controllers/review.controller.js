const reviewService = require('../services/review.service')

module.exports.getMyReviews = async (req, res) => {
    const reviews = await reviewService.getReviewsByUser(req.user.id)
    return res.json({ reviews })
}

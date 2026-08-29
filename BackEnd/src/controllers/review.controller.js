const reviewService = require('../services/review.service')

function getFrontendUrl() {
    return (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '')
}

module.exports.getMyReviews = async (req, res) => {
    const reviews = await reviewService.getReviewsByUser(req.user.id, {
        search: req.query.search,
        model: req.query.model,
        projectId: req.query.projectId,
        severity: req.query.severity,
        favorite: req.query.favorite,
        dateFrom: req.query.dateFrom,
        dateTo: req.query.dateTo
    })
    return res.json({ reviews })
}

module.exports.getReview = async (req, res) => {
    const review = await reviewService.getReviewById(req.user.id, Number(req.params.reviewId))
    if (!review) return res.status(404).json({ error: 'Review not found.' })
    return res.json({ review })
}

module.exports.getSharedReview = async (req, res) => {
    const review = await reviewService.getSharedReview(String(req.params.shareToken || ''))
    if (!review) return res.status(404).json({ error: 'Shared review not found.' })
    return res.json({ review })
}

module.exports.updateFavorite = async (req, res) => {
    const review = await reviewService.updateFavorite({
        userId: req.user.id,
        reviewId: Number(req.params.reviewId),
        isFavorite: Boolean(req.body.isFavorite)
    })
    if (!review) return res.status(404).json({ error: 'Review not found.' })
    return res.json({ review })
}

module.exports.updateNotes = async (req, res) => {
    const notes = typeof req.body.notes === 'string' ? req.body.notes.slice(0, 5000) : ''
    const review = await reviewService.updateNotes({
        userId: req.user.id,
        reviewId: Number(req.params.reviewId),
        notes
    })
    if (!review) return res.status(404).json({ error: 'Review not found.' })
    return res.json({ review })
}

module.exports.deleteReview = async (req, res) => {
    const deleted = await reviewService.deleteReview({
        userId: req.user.id,
        reviewId: Number(req.params.reviewId)
    })
    if (!deleted) return res.status(404).json({ error: 'Review not found.' })
    return res.json({ message: 'Review deleted.' })
}

module.exports.shareReview = async (req, res) => {
    const review = await reviewService.createShareLink({
        userId: req.user.id,
        reviewId: Number(req.params.reviewId)
    })
    if (!review) return res.status(404).json({ error: 'Review not found.' })
    return res.json({
        review,
        shareUrl: `${getFrontendUrl()}/?share=${review.shareToken}`
    })
}

module.exports.exportMarkdown = async (req, res) => {
    const review = await reviewService.getReviewById(req.user.id, Number(req.params.reviewId))
    if (!review) return res.status(404).json({ error: 'Review not found.' })

    res.setHeader('Content-Type', 'text/markdown; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="review-${review.id}.md"`)
    return res.send(reviewService.createMarkdownExport(review))
}

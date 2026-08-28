const aiService = require("../services/ai.service")
const userService = require("../services/user.service")
const reviewService = require("../services/review.service")
const { availableModels, getModel } = require("../config/models")

const MAX_CODE_LENGTH = Number(process.env.MAX_CODE_LENGTH) || 20000
const allowedDepths = new Set(['quick', 'standard', 'deep'])

module.exports.getModels = (req, res) => {
    return res.json({ models: availableModels })
}

module.exports.getReview = async (req, res) => {
    try {
        const { code, depth, model } = req.body;

        if (typeof code !== 'string') {
            return res.status(400).json({ error: 'Code must be provided as a string.' });
        }

        const trimmedCode = code.trim();

        if (!trimmedCode) {
            return res.status(400).json({ error: 'Code is required.' });
        }

        if (trimmedCode.length > MAX_CODE_LENGTH) {
            return res.status(413).json({
                error: `Code is too large. Please keep it under ${MAX_CODE_LENGTH} characters.`
            });
        }

        const used = await userService.getUsage(req.user.id)

        if (used >= req.user.monthly_limit) {
            return res.status(429).json({
                error: 'Monthly review limit reached.',
                usage: {
                    used,
                    limit: req.user.monthly_limit,
                    remaining: 0
                }
            })
        }

        const reviewDepth = allowedDepths.has(depth) ? depth : 'standard'
        const selectedModel = getModel(model)
        const review = await aiService({
            code: trimmedCode,
            depth: reviewDepth,
            model: selectedModel.id
        });

        const savedReview = await reviewService.saveReview({
            userId: req.user.id,
            code: trimmedCode,
            review,
            model: selectedModel.id,
            depth: reviewDepth
        })

        return res.json({
            review,
            savedReview,
            usage: {
                used: used + 1,
                limit: req.user.monthly_limit,
                remaining: Math.max(req.user.monthly_limit - used - 1, 0)
            }
        });
    } catch (error) {
        console.error('Code review failed:', error);
        return res.status(502).json({
            error: 'Unable to generate a review right now. Please try again.'
        });
    }
}

const businessService = require('../services/business.service')

const allowedWebhookEvents = new Set(['review.created', 'review.failed', 'usage.limit_reached', 'subscription.updated'])

module.exports.getDeveloperResources = async (req, res) => {
    const [apiKeys, webhooks, billing] = await Promise.all([
        businessService.listApiKeys(req.user.id),
        businessService.listWebhookEndpoints(req.user.id),
        businessService.getBillingState(req.user.id)
    ])

    return res.json({
        apiKeys,
        webhooks,
        limits: {
            apiKeys: billing.currentPlan.apiKeyLimit,
            webhooks: billing.currentPlan.webhookLimit
        }
    })
}

module.exports.createApiKey = async (req, res) => {
    const result = await businessService.createApiKey({
        userId: req.user.id,
        name: req.body.name,
        req
    })
    return res.status(201).json(result)
}

module.exports.revokeApiKey = async (req, res) => {
    const apiKey = await businessService.revokeApiKey({
        userId: req.user.id,
        keyId: req.params.keyId,
        req
    })
    return res.json({ apiKey })
}

module.exports.createWebhook = async (req, res) => {
    const events = Array.isArray(req.body.events)
        ? req.body.events.filter(event => allowedWebhookEvents.has(event))
        : []
    const result = await businessService.createWebhookEndpoint({
        userId: req.user.id,
        url: req.body.url,
        events,
        req
    })
    return res.status(201).json(result)
}

module.exports.deleteWebhook = async (req, res) => {
    const webhook = await businessService.deleteWebhookEndpoint({
        userId: req.user.id,
        webhookId: req.params.webhookId,
        req
    })
    return res.json({ webhook })
}

module.exports.getPublicDocs = (req, res) => {
    const baseUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3000}`
    return res.json({
        name: 'AI Powered Code Reveiwer Public API',
        baseUrl,
        authentication: 'Send x-api-key: acr_... or Authorization: Bearer acr_...',
        endpoints: [
            {
                method: 'POST',
                path: '/api/v1/reviews',
                description: 'Create an AI code review using a developer API key.',
                body: {
                    sourceType: 'paste',
                    code: 'function example() { return true }',
                    depth: 'standard',
                    model: 'gemini-3.7-flash'
                }
            }
        ],
        events: ['review.created', 'review.failed', 'usage.limit_reached', 'subscription.updated']
    })
}

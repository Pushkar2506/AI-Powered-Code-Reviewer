const businessService = require('../services/business.service')

module.exports.getCompliance = async (req, res) => {
    const [privacy, auditLogs] = await Promise.all([
        businessService.getPrivacySettings(req.user.id),
        businessService.getAuditLogs(req.user.id)
    ])
    return res.json({ privacy, auditLogs })
}

module.exports.updatePrivacy = async (req, res) => {
    const privacy = await businessService.updatePrivacySettings({
        userId: req.user.id,
        settings: req.body,
        req
    })
    return res.json({ privacy })
}

module.exports.applyRetention = async (req, res) => {
    const result = await businessService.applyRetention(req.user.id)
    await businessService.logAudit({
        userId: req.user.id,
        action: 'privacy.retention_applied',
        entityType: 'review',
        metadata: result,
        req
    })
    return res.json(result)
}

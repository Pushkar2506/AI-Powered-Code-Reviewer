const crypto = require('crypto')
const { query } = require('../config/database')

const PLANS = {
    free: {
        id: 'free',
        name: 'Free',
        priceLabel: '₹0',
        amountPaise: 0,
        description: 'For individual evaluation and light reviews.',
        includedReviews: 20,
        overagePriceCents: 0,
        apiKeyLimit: 1,
        webhookLimit: 1,
        features: ['Paste and multi-file reviews', 'Review history', 'Markdown export']
    },
    pro: {
        id: 'pro',
        name: 'Pro',
        priceLabel: '₹999/month',
        amountPaise: 99900,
        description: 'For professional developers who review code every week.',
        includedReviews: 500,
        overagePriceCents: 200,
        apiKeyLimit: 5,
        webhookLimit: 5,
        features: ['Everything in Free', 'API keys', 'Custom rules', 'Usage billing']
    },
    team: {
        id: 'team',
        name: 'Team',
        priceLabel: '₹2999/month',
        amountPaise: 299900,
        description: 'For teams that need shared governance and higher limits.',
        includedReviews: 3000,
        overagePriceCents: 100,
        apiKeyLimit: 20,
        webhookLimit: 20,
        features: ['Everything in Pro', 'Team workspaces', 'Webhook integrations', 'Audit logs']
    }
}

function hashSecret(value) {
    return crypto.createHash('sha256').update(value).digest('hex')
}

function createSecret(prefix) {
    return `${prefix}_${crypto.randomBytes(24).toString('hex')}`
}

function getEncryptionKey() {
    return crypto.createHash('sha256').update(process.env.WEBHOOK_SECRET_ENCRYPTION_KEY || process.env.JWT_SECRET || 'local-development-key').digest()
}

function encryptSecret(value) {
    const iv = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv)
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
    return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${encrypted.toString('hex')}`
}

function decryptSecret(value) {
    const [ivHex, authTagHex, encryptedHex] = String(value || '').split(':')
    if (!ivHex || !authTagHex || !encryptedHex) return ''
    const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(), Buffer.from(ivHex, 'hex'))
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'))
    return Buffer.concat([decipher.update(Buffer.from(encryptedHex, 'hex')), decipher.final()]).toString('utf8')
}

function ensurePaidPlan(plan) {
    if (!['pro', 'team'].includes(plan)) {
        const error = new Error('Choose Pro or Team for checkout.')
        error.statusCode = 400
        throw error
    }
}

async function logAudit({ userId, action, entityType, entityId, metadata = {}, req }) {
    await query(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, metadata, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
            userId || null,
            action,
            entityType,
            entityId ? String(entityId) : null,
            metadata,
            req?.ip || null,
            req?.headers?.['user-agent'] || null
        ]
    )
}

async function getCurrentSubscription(userId) {
    const result = await query('SELECT * FROM subscriptions WHERE user_id = $1', [userId])
    if (result.rows.length) return mapSubscription(result.rows[0])

    const plan = PLANS.free
    const created = await query(
        `INSERT INTO subscriptions (user_id, plan, provider, status, included_reviews, overage_price_cents)
         VALUES ($1, 'free', 'internal', 'active', $2, $3)
         RETURNING *`,
        [userId, plan.includedReviews, plan.overagePriceCents]
    )
    return mapSubscription(created.rows[0])
}

async function syncUserLimit(userId, planId) {
    const plan = PLANS[planId] || PLANS.free
    await query('UPDATE users SET monthly_limit = $1 WHERE id = $2', [plan.includedReviews, userId])
}

async function activatePlan({ userId, planId, provider = 'internal', providerSubscriptionId = null, providerPaymentId = null, metadata = {}, req }) {
    const plan = PLANS[planId] || PLANS.free
    const result = await query(
        `INSERT INTO subscriptions (
            user_id, plan, provider, provider_subscription_id, provider_payment_id, status,
            included_reviews, overage_price_cents, metadata, current_period_start, current_period_end, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, $8, NOW(), NOW() + INTERVAL '1 month', NOW())
         ON CONFLICT (user_id)
         DO UPDATE SET
            plan = EXCLUDED.plan,
            provider = EXCLUDED.provider,
            provider_subscription_id = EXCLUDED.provider_subscription_id,
            provider_payment_id = EXCLUDED.provider_payment_id,
            status = 'active',
            included_reviews = EXCLUDED.included_reviews,
            overage_price_cents = EXCLUDED.overage_price_cents,
            metadata = subscriptions.metadata || EXCLUDED.metadata,
            current_period_start = NOW(),
            current_period_end = NOW() + INTERVAL '1 month',
            updated_at = NOW()
         RETURNING *`,
        [userId, plan.id, provider, providerSubscriptionId, providerPaymentId, plan.includedReviews, plan.overagePriceCents, metadata]
    )
    await syncUserLimit(userId, plan.id)
    await logAudit({ userId, action: 'billing.plan_activated', entityType: 'subscription', entityId: result.rows[0].id, metadata: { plan: plan.id, provider }, req })
    return mapSubscription(result.rows[0])
}

async function createRazorpaySubscription({ user, planId, req }) {
    ensurePaidPlan(planId)
    const plan = PLANS[planId]

    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
        const error = new Error('Razorpay is not configured for this plan.')
        error.statusCode = 503
        throw error
    }

    await getCurrentSubscription(user.id)
    const receipt = `acr_${user.id}_${Date.now()}`.slice(0, 40)
    const response = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: {
            Authorization: `Basic ${Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64')}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            amount: plan.amountPaise,
            currency: 'INR',
            receipt,
            notes: {
                user_id: String(user.id),
                user_email: user.email,
                plan: plan.id,
                app: 'AI Powered Code Reveiwer'
            }
        })
    })

    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
        const error = new Error(payload.error?.description || 'Unable to create Razorpay checkout.')
        error.statusCode = 502
        throw error
    }

    await query(
        `UPDATE subscriptions
         SET provider = 'razorpay',
             provider_subscription_id = $2,
             status = CASE WHEN status = 'active' THEN status ELSE 'checkout_pending' END,
             metadata = subscriptions.metadata || $3::jsonb,
             updated_at = NOW()
         WHERE user_id = $1`,
        [user.id, payload.id, { pendingPlan: plan.id, pendingOrderId: payload.id, receipt }]
    )
    await logAudit({ userId: user.id, action: 'billing.checkout_created', entityType: 'subscription', entityId: payload.id, metadata: { plan: plan.id }, req })

    return {
        keyId: process.env.RAZORPAY_KEY_ID,
        orderId: payload.id,
        amount: payload.amount,
        currency: payload.currency,
        plan
    }
}

async function verifyRazorpayPayment({ userId, planId, paymentId, orderId, signature, req }) {
    ensurePaidPlan(planId)
    if (!paymentId || !orderId || !signature) {
        const error = new Error('Payment verification details are incomplete.')
        error.statusCode = 400
        throw error
    }

    const expected = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '')
        .update(`${orderId}|${paymentId}`)
        .digest('hex')

    const expectedBuffer = Buffer.from(expected)
    const signatureBuffer = Buffer.from(signature)
    if (expectedBuffer.length !== signatureBuffer.length || !crypto.timingSafeEqual(expectedBuffer, signatureBuffer)) {
        const error = new Error('Payment signature verification failed.')
        error.statusCode = 400
        throw error
    }

    return activatePlan({
        userId,
        planId,
        provider: 'razorpay',
        providerSubscriptionId: null,
        providerPaymentId: paymentId,
        metadata: { verifiedAt: new Date().toISOString(), orderId },
        req
    })
}

async function selectFreePlan({ userId, req }) {
    const current = await getCurrentSubscription(userId)
    if (current.status === 'active' && ['pro', 'team'].includes(current.plan)) {
        const result = await query(
            `UPDATE subscriptions
             SET metadata = metadata || $2::jsonb,
                 updated_at = NOW()
             WHERE user_id = $1
             RETURNING *`,
            [userId, { scheduledDowngradeTo: 'free', scheduledDowngradeAt: current.currentPeriodEnd }]
        )
        await logAudit({ userId, action: 'billing.downgrade_scheduled', entityType: 'subscription', entityId: result.rows[0].id, metadata: { from: current.plan, to: 'free' }, req })
        return mapSubscription(result.rows[0])
    }

    return activatePlan({ userId, planId: 'free', provider: 'internal', metadata: { selectedByUser: true }, req })
}

async function getBillingState(userId) {
    const subscription = await getCurrentSubscription(userId)
    const plan = subscription.status === 'active' ? (PLANS[subscription.plan] || PLANS.free) : PLANS.free
    const pendingPlan = subscription.status === 'checkout_pending' && subscription.metadata?.pendingPlan
        ? PLANS[subscription.metadata.pendingPlan] || null
        : null
    const usageResult = await query(
        `SELECT COUNT(*)::int AS used
         FROM reviews
         WHERE user_id = $1
         AND deleted_at IS NULL
         AND created_at >= date_trunc('month', NOW())`,
        [userId]
    )
    const used = usageResult.rows[0]?.used || 0
    const included = plan.includedReviews
    const overagePriceCents = plan.overagePriceCents
    const billableOverage = Math.max(used - included, 0)
    const estimatedOverageCents = billableOverage * overagePriceCents

    return {
        subscription,
        currentPlan: plan,
        pendingPlan,
        plans: Object.values(PLANS),
        usage: {
            used,
            included,
            remaining: Math.max(included - used, 0),
            billableOverage,
            estimatedOverageCents,
            estimatedOverageLabel: formatMinorCurrency(estimatedOverageCents)
        }
    }
}

async function recordUsageEvent({ userId, eventType, quantity = 1, metadata = {} }) {
    const subscription = await getCurrentSubscription(userId)
    const usedResult = await query(
        `SELECT COUNT(*)::int AS used
         FROM reviews
         WHERE user_id = $1
         AND deleted_at IS NULL
         AND created_at >= date_trunc('month', NOW())`,
        [userId]
    )
    const used = usedResult.rows[0]?.used || 0
    const unitPrice = used > subscription.includedReviews ? subscription.overagePriceCents : 0
    await query(
        `INSERT INTO usage_events (user_id, event_type, quantity, unit_price_cents, metadata)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, eventType, quantity, unitPrice, metadata]
    )
}

async function createApiKey({ userId, name, req }) {
    const billing = await getBillingState(userId)
    const currentKeys = await query(`SELECT COUNT(*)::int AS count FROM api_keys WHERE user_id = $1 AND status = 'active'`, [userId])
    if (currentKeys.rows[0].count >= billing.currentPlan.apiKeyLimit) {
        const error = new Error(`Your ${billing.currentPlan.name} plan allows ${billing.currentPlan.apiKeyLimit} active API key(s).`)
        error.statusCode = 403
        throw error
    }

    const rawKey = createSecret('acr')
    const result = await query(
        `INSERT INTO api_keys (user_id, name, key_hash, key_prefix)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, key_prefix, status, last_used_at, created_at`,
        [userId, String(name || 'Production key').trim().slice(0, 120), hashSecret(rawKey), rawKey.slice(0, 12)]
    )
    await logAudit({ userId, action: 'developer.api_key_created', entityType: 'api_key', entityId: result.rows[0].id, metadata: { name: result.rows[0].name }, req })
    return { apiKey: mapApiKey(result.rows[0]), rawKey }
}

async function listApiKeys(userId) {
    const result = await query(
        `SELECT id, name, key_prefix, status, last_used_at, created_at, revoked_at
         FROM api_keys
         WHERE user_id = $1
         ORDER BY created_at DESC`,
        [userId]
    )
    return result.rows.map(mapApiKey)
}

async function revokeApiKey({ userId, keyId, req }) {
    const result = await query(
        `UPDATE api_keys
         SET status = 'revoked', revoked_at = NOW()
         WHERE id = $1 AND user_id = $2
         RETURNING id, name, key_prefix, status, last_used_at, created_at, revoked_at`,
        [keyId, userId]
    )
    if (!result.rows.length) {
        const error = new Error('API key not found.')
        error.statusCode = 404
        throw error
    }
    await logAudit({ userId, action: 'developer.api_key_revoked', entityType: 'api_key', entityId: keyId, req })
    return mapApiKey(result.rows[0])
}

async function authenticateApiKey(rawKey) {
    if (!rawKey) return null
    const result = await query(
        `SELECT api_keys.*, users.name, users.email, users.role, users.status, users.monthly_limit, users.created_at AS user_created_at
         FROM api_keys
         JOIN users ON users.id = api_keys.user_id
         WHERE api_keys.key_hash = $1 AND api_keys.status = 'active'`,
        [hashSecret(rawKey)]
    )
    const row = result.rows[0]
    if (!row || row.status !== 'active') return null
    await query('UPDATE api_keys SET last_used_at = NOW() WHERE id = $1', [row.id])
    return {
        id: row.user_id,
        name: row.name,
        email: row.email,
        role: row.role,
        status: row.status,
        monthly_limit: row.monthly_limit,
        created_at: row.user_created_at,
        apiKeyId: row.id
    }
}

async function createWebhookEndpoint({ userId, url, events, req }) {
    const billing = await getBillingState(userId)
    const count = await query(`SELECT COUNT(*)::int AS count FROM webhook_endpoints WHERE user_id = $1 AND status = 'active'`, [userId])
    if (count.rows[0].count >= billing.currentPlan.webhookLimit) {
        const error = new Error(`Your ${billing.currentPlan.name} plan allows ${billing.currentPlan.webhookLimit} active webhook endpoint(s).`)
        error.statusCode = 403
        throw error
    }
    if (!/^https?:\/\/.+/i.test(url || '')) {
        const error = new Error('Webhook URL must start with http:// or https://.')
        error.statusCode = 400
        throw error
    }
    const secret = createSecret('whsec')
    const selectedEvents = Array.isArray(events) && events.length ? events : ['review.created']
    const result = await query(
        `INSERT INTO webhook_endpoints (user_id, url, events, signing_secret_hash, signing_secret_encrypted, secret_prefix)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, url, events, secret_prefix, status, last_delivery_status, last_delivered_at, created_at, updated_at`,
        [userId, url.trim(), selectedEvents, hashSecret(secret), encryptSecret(secret), secret.slice(0, 12)]
    )
    await logAudit({ userId, action: 'developer.webhook_created', entityType: 'webhook', entityId: result.rows[0].id, metadata: { url: result.rows[0].url, events: selectedEvents }, req })
    return { webhook: mapWebhook(result.rows[0]), signingSecret: secret }
}

async function deliverWebhookEvent({ userId, event, payload }) {
    const result = await query(
        `SELECT id, url, events, signing_secret_encrypted
         FROM webhook_endpoints
         WHERE user_id = $1
         AND status = 'active'
         AND events ? $2`,
        [userId, event]
    )

    await Promise.all(result.rows.map(async endpoint => {
        try {
            const body = JSON.stringify({
                id: `evt_${crypto.randomBytes(12).toString('hex')}`,
                event,
                createdAt: new Date().toISOString(),
                data: payload
            })
            const secret = decryptSecret(endpoint.signing_secret_encrypted)
            const signature = crypto.createHmac('sha256', secret).update(body).digest('hex')
            const response = await fetch(endpoint.url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-acr-event': event,
                    'x-acr-signature': signature
                },
                body
            })
            await query(
                `UPDATE webhook_endpoints
                 SET last_delivery_status = $1, last_delivered_at = NOW(), updated_at = NOW()
                 WHERE id = $2`,
                [response.ok ? 'delivered' : `failed_${response.status}`, endpoint.id]
            )
        } catch {
            await query(
                `UPDATE webhook_endpoints
                 SET last_delivery_status = 'failed', last_delivered_at = NOW(), updated_at = NOW()
                 WHERE id = $1`,
                [endpoint.id]
            )
        }
    }))
}

async function listWebhookEndpoints(userId) {
    const result = await query(
        `SELECT id, url, events, secret_prefix, status, last_delivery_status, last_delivered_at, created_at, updated_at
         FROM webhook_endpoints
         WHERE user_id = $1
         ORDER BY created_at DESC`,
        [userId]
    )
    return result.rows.map(mapWebhook)
}

async function deleteWebhookEndpoint({ userId, webhookId, req }) {
    const result = await query(
        `UPDATE webhook_endpoints
         SET status = 'disabled', updated_at = NOW()
         WHERE id = $1 AND user_id = $2
         RETURNING id, url, events, secret_prefix, status, last_delivery_status, last_delivered_at, created_at, updated_at`,
        [webhookId, userId]
    )
    if (!result.rows.length) {
        const error = new Error('Webhook endpoint not found.')
        error.statusCode = 404
        throw error
    }
    await logAudit({ userId, action: 'developer.webhook_disabled', entityType: 'webhook', entityId: webhookId, req })
    return mapWebhook(result.rows[0])
}

async function getPrivacySettings(userId) {
    const result = await query(
        `INSERT INTO privacy_settings (user_id)
         VALUES ($1)
         ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
         RETURNING *`,
        [userId]
    )
    return mapPrivacy(result.rows[0])
}

async function updatePrivacySettings({ userId, settings, req }) {
    const retentionDays = Number(settings.retentionDays)
    const result = await query(
        `INSERT INTO privacy_settings (user_id, save_reviews, allow_share_links, allow_product_emails, retention_days, delete_after_retention, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (user_id)
         DO UPDATE SET
            save_reviews = EXCLUDED.save_reviews,
            allow_share_links = EXCLUDED.allow_share_links,
            allow_product_emails = EXCLUDED.allow_product_emails,
            retention_days = EXCLUDED.retention_days,
            delete_after_retention = EXCLUDED.delete_after_retention,
            updated_at = NOW()
         RETURNING *`,
        [
            userId,
            Boolean(settings.saveReviews),
            Boolean(settings.allowShareLinks),
            Boolean(settings.allowProductEmails),
            [30, 90, 180, 365, 730].includes(retentionDays) ? retentionDays : 365,
            Boolean(settings.deleteAfterRetention)
        ]
    )
    await logAudit({ userId, action: 'privacy.settings_updated', entityType: 'privacy_settings', entityId: userId, metadata: mapPrivacy(result.rows[0]), req })
    return mapPrivacy(result.rows[0])
}

async function getAuditLogs(userId, limit = 50) {
    const result = await query(
        `SELECT action, entity_type, entity_id, metadata, ip_address, created_at
         FROM audit_logs
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [userId, Math.min(Math.max(Number(limit) || 50, 1), 100)]
    )
    return result.rows.map(row => ({
        action: row.action,
        entityType: row.entity_type,
        entityId: row.entity_id,
        metadata: row.metadata || {},
        ipAddress: row.ip_address,
        createdAt: row.created_at
    }))
}

async function applyRetention(userId) {
    const settings = await getPrivacySettings(userId)
    if (!settings.deleteAfterRetention) return { deleted: 0 }
    const result = await query(
        `UPDATE reviews
         SET deleted_at = NOW()
         WHERE user_id = $1
         AND deleted_at IS NULL
         AND created_at < NOW() - ($2::int * INTERVAL '1 day')`,
        [userId, settings.retentionDays]
    )
    return { deleted: result.rowCount }
}

function formatMinorCurrency(value) {
    return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 2
    }).format(Number(value || 0) / 100)
}

function mapSubscription(row) {
    return {
        id: row.id,
        plan: row.plan,
        provider: row.provider,
        providerSubscriptionId: row.provider_subscription_id,
        status: row.status,
        includedReviews: row.included_reviews,
        overagePriceCents: row.overage_price_cents,
        currentPeriodStart: row.current_period_start,
        currentPeriodEnd: row.current_period_end,
        metadata: row.metadata || {},
        createdAt: row.created_at,
        updatedAt: row.updated_at
    }
}

function mapApiKey(row) {
    return {
        id: row.id,
        name: row.name,
        keyPrefix: row.key_prefix,
        status: row.status,
        lastUsedAt: row.last_used_at,
        revokedAt: row.revoked_at,
        createdAt: row.created_at
    }
}

function mapWebhook(row) {
    return {
        id: row.id,
        url: row.url,
        events: row.events || [],
        secretPrefix: row.secret_prefix,
        status: row.status,
        lastDeliveryStatus: row.last_delivery_status,
        lastDeliveredAt: row.last_delivered_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    }
}

function mapPrivacy(row) {
    return {
        saveReviews: row.save_reviews,
        allowShareLinks: row.allow_share_links,
        allowProductEmails: row.allow_product_emails,
        retentionDays: row.retention_days,
        deleteAfterRetention: row.delete_after_retention,
        updatedAt: row.updated_at
    }
}

module.exports = {
    PLANS,
    activatePlan,
    applyRetention,
    authenticateApiKey,
    createApiKey,
    createRazorpaySubscription,
    createWebhookEndpoint,
    deleteWebhookEndpoint,
    deliverWebhookEvent,
    getAuditLogs,
    getBillingState,
    getPrivacySettings,
    listApiKeys,
    listWebhookEndpoints,
    logAudit,
    recordUsageEvent,
    revokeApiKey,
    selectFreePlan,
    updatePrivacySettings,
    verifyRazorpayPayment
}

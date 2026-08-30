const businessService = require('../services/business.service')

module.exports.getBilling = async (req, res) => {
    const billing = await businessService.getBillingState(req.user.id)
    return res.json({ billing })
}

module.exports.createCheckout = async (req, res) => {
    const checkout = await businessService.createRazorpaySubscription({
        user: req.user,
        planId: req.body.plan,
        req
    })
    return res.json({ checkout })
}

module.exports.verifyPayment = async (req, res) => {
    const subscription = await businessService.verifyRazorpayPayment({
        userId: req.user.id,
        planId: req.body.plan,
        paymentId: req.body.razorpay_payment_id,
        orderId: req.body.razorpay_order_id,
        signature: req.body.razorpay_signature,
        req
    })
    const billing = await businessService.getBillingState(req.user.id)
    return res.json({ subscription, billing })
}

module.exports.selectFreePlan = async (req, res) => {
    const subscription = await businessService.selectFreePlan({ userId: req.user.id, req })
    const billing = await businessService.getBillingState(req.user.id)
    return res.json({ subscription, billing })
}

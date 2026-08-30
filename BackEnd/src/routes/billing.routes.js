const express = require('express')
const billingController = require('../controllers/billing.controller')
const { requireAuth } = require('../middleware/auth.middleware')

const router = express.Router()
const wrap = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)

router.use(requireAuth)
router.get('/', wrap(billingController.getBilling))
router.post('/checkout', wrap(billingController.createCheckout))
router.post('/verify', wrap(billingController.verifyPayment))
router.post('/free', wrap(billingController.selectFreePlan))

module.exports = router

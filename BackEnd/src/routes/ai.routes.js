const express = require('express');
const aiController = require("../controllers/ai.controller")
const { requireAuth } = require('../middleware/auth.middleware')

const router = express.Router();

router.get("/models", requireAuth, aiController.getModels)

router.post("/get-review", requireAuth, aiController.getReview)


module.exports = router;

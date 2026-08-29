const express = require('express')
const projectController = require('../controllers/project.controller')
const { requireAuth } = require('../middleware/auth.middleware')

const router = express.Router()

router.get('/', requireAuth, projectController.getProjects)
router.post('/', requireAuth, projectController.createProject)

module.exports = router

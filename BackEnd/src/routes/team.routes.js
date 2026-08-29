const express = require('express')
const teamController = require('../controllers/team.controller')
const { requireAuth } = require('../middleware/auth.middleware')

const router = express.Router()
const wrap = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)

router.use(requireAuth)
router.get('/workspaces', wrap(teamController.getWorkspaces))
router.post('/workspaces', wrap(teamController.createWorkspace))
router.get('/workspaces/:workspaceId', wrap(teamController.getWorkspaceDetails))
router.post('/workspaces/:workspaceId/invitations', wrap(teamController.inviteMember))
router.patch('/workspaces/:workspaceId/members/:memberId/role', wrap(teamController.updateMemberRole))
router.post('/invitations/accept', wrap(teamController.acceptInvitation))

module.exports = router

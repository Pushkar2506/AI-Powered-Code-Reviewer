const teamService = require('../services/team.service')

module.exports.getWorkspaces = async (req, res) => {
    const workspaces = await teamService.getMyWorkspaces(req.user.id)
    return res.json({ workspaces })
}

module.exports.createWorkspace = async (req, res) => {
    const name = String(req.body.name || '').trim()

    if (!name) {
        return res.status(400).json({ error: 'Workspace name is required.' })
    }

    const workspace = await teamService.createWorkspace(req.user, name)
    return res.status(201).json({ workspace })
}

module.exports.getWorkspaceDetails = async (req, res) => {
    const details = await teamService.getWorkspaceDetails(req.user.id, Number(req.params.workspaceId))

    if (!details) {
        return res.status(404).json({ error: 'Workspace not found.' })
    }

    return res.json(details)
}

module.exports.inviteMember = async (req, res) => {
    try {
        const email = String(req.body.email || '').trim().toLowerCase()
        const role = String(req.body.role || 'member').trim()

        if (!email) {
            return res.status(400).json({ error: 'Invite email is required.' })
        }

        const invitation = await teamService.inviteMember({
            userId: req.user.id,
            workspaceId: Number(req.params.workspaceId),
            email,
            role
        })

        return res.status(201).json({
            invitation,
            message: 'Invitation email sent.'
        })
    } catch (error) {
        return res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Unable to create invitation.' })
    }
}

module.exports.acceptInvitation = async (req, res) => {
    try {
        const invitation = await teamService.acceptInvitation(req.user, String(req.body.token || '').trim())
        return res.json({ invitation })
    } catch (error) {
        return res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Unable to accept invitation.' })
    }
}

module.exports.updateMemberRole = async (req, res) => {
    try {
        await teamService.updateMemberRole({
            userId: req.user.id,
            workspaceId: Number(req.params.workspaceId),
            memberId: Number(req.params.memberId),
            role: String(req.body.role || '').trim()
        })
        return res.json({ message: 'Member role updated.' })
    } catch (error) {
        return res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Unable to update member role.' })
    }
}

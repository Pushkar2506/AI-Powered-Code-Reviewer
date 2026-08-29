const crypto = require('crypto')
const { query } = require('../config/database')
const emailService = require('./email.service')

const workspaceRoles = new Set(['owner', 'admin', 'reviewer', 'member'])

function createToken() {
    return crypto.randomBytes(24).toString('hex')
}

function canManage(role) {
    return ['owner', 'admin'].includes(role)
}

function mapWorkspace(row) {
    return {
        id: row.id,
        name: row.name,
        ownerId: row.owner_id,
        role: row.role,
        members: Number(row.members || 0),
        createdAt: row.created_at
    }
}

function mapMember(row) {
    return {
        id: row.id,
        userId: row.user_id,
        name: row.name,
        email: row.email,
        role: row.role,
        joinedAt: row.created_at
    }
}

function mapInvitation(row) {
    return {
        id: row.id,
        workspaceId: row.workspace_id,
        email: row.email,
        role: row.role,
        status: row.status,
        expiresAt: row.expires_at,
        acceptedAt: row.accepted_at,
        createdAt: row.created_at
    }
}

async function ensurePersonalWorkspace(user) {
    const existing = await query(
        `SELECT workspaces.id
         FROM workspaces
         JOIN workspace_members ON workspace_members.workspace_id = workspaces.id
         WHERE workspace_members.user_id = $1
         ORDER BY workspaces.created_at ASC
         LIMIT 1`,
        [user.id]
    )

    if (existing.rows.length) return existing.rows[0].id

    const workspace = await query(
        `INSERT INTO workspaces (name, owner_id)
         VALUES ($1, $2)
         RETURNING id`,
        [`${user.name}'s Workspace`, user.id]
    )

    await query(
        `INSERT INTO workspace_members (workspace_id, user_id, role)
         VALUES ($1, $2, 'owner')
         ON CONFLICT (workspace_id, user_id) DO NOTHING`,
        [workspace.rows[0].id, user.id]
    )

    return workspace.rows[0].id
}

async function getMyWorkspaces(userId) {
    const result = await query(
        `SELECT
            workspaces.id,
            workspaces.name,
            workspaces.owner_id,
            workspaces.created_at,
            workspace_members.role,
            COUNT(all_members.id)::int AS members
         FROM workspace_members
         JOIN workspaces ON workspaces.id = workspace_members.workspace_id
         LEFT JOIN workspace_members AS all_members ON all_members.workspace_id = workspaces.id
         WHERE workspace_members.user_id = $1
         GROUP BY workspaces.id, workspace_members.role
         ORDER BY workspaces.created_at ASC`,
        [userId]
    )

    return result.rows.map(mapWorkspace)
}

async function getWorkspaceDetails(userId, workspaceId) {
    const membership = await getMembership(userId, workspaceId)
    if (!membership) return null

    const [workspaceResult, membersResult, invitationsResult] = await Promise.all([
        query('SELECT * FROM workspaces WHERE id = $1', [workspaceId]),
        query(
            `SELECT workspace_members.*, users.name, users.email
             FROM workspace_members
             JOIN users ON users.id = workspace_members.user_id
             WHERE workspace_members.workspace_id = $1
             ORDER BY CASE workspace_members.role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 WHEN 'reviewer' THEN 3 ELSE 4 END, users.name`,
            [workspaceId]
        ),
        query(
            `SELECT *
             FROM invitations
             WHERE workspace_id = $1
             ORDER BY created_at DESC
             LIMIT 50`,
            [workspaceId]
        )
    ])

    return {
        workspace: { ...workspaceResult.rows[0], role: membership.role },
        members: membersResult.rows.map(mapMember),
        invitations: invitationsResult.rows.map(mapInvitation),
        canManage: canManage(membership.role)
    }
}

async function createWorkspace(user, name) {
    const workspace = await query(
        `INSERT INTO workspaces (name, owner_id)
         VALUES ($1, $2)
         RETURNING *`,
        [name, user.id]
    )

    await query(
        `INSERT INTO workspace_members (workspace_id, user_id, role)
         VALUES ($1, $2, 'owner')`,
        [workspace.rows[0].id, user.id]
    )

    return mapWorkspace({ ...workspace.rows[0], role: 'owner', members: 1 })
}

async function inviteMember({ userId, workspaceId, email, role }) {
    const [membership, workspaceResult, inviterResult] = await Promise.all([
        getMembership(userId, workspaceId),
        query('SELECT * FROM workspaces WHERE id = $1', [workspaceId]),
        query('SELECT name FROM users WHERE id = $1', [userId])
    ])

    if (!membership || !canManage(membership.role)) {
        const error = new Error('You do not have permission to invite members.')
        error.statusCode = 403
        throw error
    }

    if (!workspaceRoles.has(role) || role === 'owner') {
        const error = new Error('Invitation role must be admin, reviewer, or member.')
        error.statusCode = 400
        throw error
    }

    const token = createToken()
    const result = await query(
        `INSERT INTO invitations (workspace_id, invited_by, email, role, token, expires_at)
         VALUES ($1, $2, $3, $4, $5, NOW() + interval '7 days')
         RETURNING *`,
        [workspaceId, userId, email.toLowerCase(), role, token]
    )

    await emailService.sendInvitationEmail({
        email: email.toLowerCase(),
        inviterName: inviterResult.rows[0]?.name || 'A teammate',
        workspaceName: workspaceResult.rows[0]?.name || 'a workspace',
        role,
        token
    })

    return mapInvitation(result.rows[0])
}

async function acceptInvitation(user, token) {
    const invitationResult = await query(
        `SELECT *
         FROM invitations
         WHERE token = $1
         AND status = 'pending'
         AND expires_at > NOW()`,
        [token]
    )
    const invitation = invitationResult.rows[0]

    if (!invitation) {
        const error = new Error('Invitation is invalid or expired.')
        error.statusCode = 400
        throw error
    }

    if (invitation.email !== user.email) {
        const error = new Error('This invitation was sent to a different email address.')
        error.statusCode = 403
        throw error
    }

    await query(
        `INSERT INTO workspace_members (workspace_id, user_id, role)
         VALUES ($1, $2, $3)
         ON CONFLICT (workspace_id, user_id)
         DO UPDATE SET role = EXCLUDED.role`,
        [invitation.workspace_id, user.id, invitation.role]
    )

    await query(
        `UPDATE invitations
         SET status = 'accepted', accepted_at = NOW()
         WHERE id = $1`,
        [invitation.id]
    )

    return mapInvitation({ ...invitation, status: 'accepted', accepted_at: new Date() })
}

async function updateMemberRole({ userId, workspaceId, memberId, role }) {
    const membership = await getMembership(userId, workspaceId)
    if (!membership || !canManage(membership.role)) {
        const error = new Error('You do not have permission to change roles.')
        error.statusCode = 403
        throw error
    }

    if (!workspaceRoles.has(role) || role === 'owner') {
        const error = new Error('Role must be admin, reviewer, or member.')
        error.statusCode = 400
        throw error
    }

    const result = await query(
        `UPDATE workspace_members
         SET role = $1
         WHERE workspace_id = $2
         AND user_id = $3
         AND role <> 'owner'
         RETURNING *`,
        [role, workspaceId, memberId]
    )

    return result.rows[0]
}

async function getMembership(userId, workspaceId) {
    const result = await query(
        `SELECT *
         FROM workspace_members
         WHERE user_id = $1
         AND workspace_id = $2`,
        [userId, workspaceId]
    )
    return result.rows[0]
}

module.exports = {
    ensurePersonalWorkspace,
    getMyWorkspaces,
    getWorkspaceDetails,
    createWorkspace,
    inviteMember,
    acceptInvitation,
    updateMemberRole
}

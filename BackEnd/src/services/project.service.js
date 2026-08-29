const { query } = require('../config/database')

async function createProject({ userId, name, description }) {
    const result = await query(
        `INSERT INTO projects (user_id, name, description)
         VALUES ($1, $2, $3)
         RETURNING id, name, description, created_at`,
        [userId, name, description || null]
    )

    return mapProject(result.rows[0])
}

async function getProjects(userId) {
    const result = await query(
        `SELECT
            projects.id,
            projects.name,
            projects.description,
            projects.created_at,
            COUNT(reviews.id)::int AS review_count
         FROM projects
         LEFT JOIN reviews ON reviews.project_id = projects.id
         WHERE projects.user_id = $1
         GROUP BY projects.id
         ORDER BY projects.created_at DESC`,
        [userId]
    )

    return result.rows.map(mapProject)
}

async function ensureProjectAccess({ userId, projectId }) {
    if (!projectId) return null

    const result = await query(
        'SELECT id, name, description, created_at FROM projects WHERE id = $1 AND user_id = $2',
        [projectId, userId]
    )

    return result.rows[0] ? mapProject(result.rows[0]) : null
}

function mapProject(project) {
    return {
        id: project.id,
        name: project.name,
        description: project.description,
        reviewCount: project.review_count || 0,
        createdAt: project.created_at
    }
}

module.exports = {
    createProject,
    getProjects,
    ensureProjectAccess
}

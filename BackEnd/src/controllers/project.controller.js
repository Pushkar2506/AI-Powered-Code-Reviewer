const projectService = require('../services/project.service')

module.exports.getProjects = async (req, res) => {
    const projects = await projectService.getProjects(req.user.id)
    return res.json({ projects })
}

module.exports.createProject = async (req, res) => {
    const { name, description } = req.body

    if (typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ error: 'Project name is required.' })
    }

    const project = await projectService.createProject({
        userId: req.user.id,
        name: name.trim(),
        description: typeof description === 'string' ? description.trim() : ''
    })

    return res.status(201).json({ project })
}

const aiService = require("../services/ai.service")
const userService = require("../services/user.service")
const reviewService = require("../services/review.service")
const projectService = require("../services/project.service")
const githubService = require("../services/github.service")
const { availableModels, getModel } = require("../config/models")

const MAX_CODE_LENGTH = Number(process.env.MAX_CODE_LENGTH) || 20000
const MAX_FILES = Number(process.env.MAX_REVIEW_FILES) || 10
const allowedDepths = new Set(['quick', 'standard', 'deep'])
const allowedSources = new Set(['paste', 'multi_file', 'github_repo', 'pull_request'])

module.exports.getModels = (req, res) => {
    return res.json({ models: availableModels })
}

module.exports.getReview = async (req, res) => {
    try {
        const { depth, model, projectId } = req.body;
        const sourceType = allowedSources.has(req.body.sourceType) ? req.body.sourceType : 'paste'
        const source = await resolveSource(req.body, sourceType)
        const totalLength = source.files.reduce((total, file) => total + file.content.length, 0)

        if (!source.files.length) {
            return res.status(400).json({ error: 'At least one code file is required.' });
        }

        if (source.files.length > MAX_FILES) {
            return res.status(400).json({ error: `Please review ${MAX_FILES} files or fewer at once.` });
        }

        if (totalLength > MAX_CODE_LENGTH) {
            return res.status(413).json({ error: `Review content is too large. Please keep it under ${MAX_CODE_LENGTH} characters.` });
        }

        const project = await projectService.ensureProjectAccess({ userId: req.user.id, projectId })

        if (projectId && !project) {
            return res.status(404).json({ error: 'Project not found.' })
        }

        const used = await userService.getUsage(req.user.id)

        if (used >= req.user.monthly_limit) {
            return res.status(429).json({
                error: 'Monthly review limit reached.',
                usage: {
                    used,
                    limit: req.user.monthly_limit,
                    remaining: 0
                }
            })
        }

        const reviewDepth = allowedDepths.has(depth) ? depth : 'standard'
        const selectedModel = getModel(model)
        const structuredReview = await aiService({
            files: source.files,
            depth: reviewDepth,
            model: selectedModel.id,
            sourceType
        });

        const savedReview = await reviewService.saveReview({
            userId: req.user.id,
            projectId: project?.id,
            code: source.files.map(file => `// ${file.path}\n${file.content}`).join('\n\n'),
            review: structuredReview.markdown,
            model: structuredReview.model || selectedModel.id,
            depth: reviewDepth,
            sourceType,
            sourceUrl: source.sourceUrl,
            score: structuredReview.score,
            fixedCode: structuredReview.fixedCode,
            checklist: structuredReview.checklist,
            comments: structuredReview.comments,
            files: source.files.map(file => {
                const fixedFile = structuredReview.fixedFiles?.find(item => item.path === file.path)
                return {
                    path: file.path,
                    content: file.content,
                    fixedContent: fixedFile?.content || null,
                    fixes: structuredReview.fixes?.filter(item => item.file === file.path) || [],
                    status: file.status,
                    additions: file.additions,
                    deletions: file.deletions
                }
            })
        })

        return res.json({
            review: structuredReview.markdown,
            result: structuredReview,
            model: structuredReview.model || selectedModel.id,
            fallbackUsed: Boolean(structuredReview.fallbackUsed),
            savedReview,
            usage: {
                used: used + 1,
                limit: req.user.monthly_limit,
                remaining: Math.max(req.user.monthly_limit - used - 1, 0)
            }
        });
    } catch (error) {
        console.error('Code review failed:', {
            status: error.statusCode || error.status,
            message: error.message,
            failures: error.failures
        });
        return res.status(error.statusCode || 502).json({
            error: error.statusCode === 503
                ? 'AI models are temporarily busy. Please try again in a moment.'
                : 'Unable to generate a review right now. Please try again.'
        });
    }
}

async function resolveSource(body, sourceType) {
    if (sourceType === 'github_repo') {
        return githubService.importRepository(body.githubUrl)
    }

    if (sourceType === 'pull_request') {
        return githubService.importPullRequest(body.githubUrl)
    }

    if (sourceType === 'multi_file') {
        return {
            sourceType,
            sourceUrl: null,
            files: normalizeFiles(body.files)
        }
    }

    if (typeof body.code !== 'string' || !body.code.trim()) {
        return { sourceType, sourceUrl: null, files: [] }
    }

    return {
        sourceType,
        sourceUrl: null,
        files: [{ path: 'pasted-code.js', content: body.code.trim() }]
    }
}

function normalizeFiles(files) {
    if (!Array.isArray(files)) {
        return []
    }

    return files
        .filter(file => typeof file.content === 'string' && file.content.trim())
        .map((file, index) => ({
            path: typeof file.path === 'string' && file.path.trim() ? file.path.trim() : `file-${index + 1}.js`,
            content: file.content.trim()
        }))
}

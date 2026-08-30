const aiService = require("../services/ai.service")
const userService = require("../services/user.service")
const reviewService = require("../services/review.service")
const projectService = require("../services/project.service")
const githubService = require("../services/github.service")
const businessService = require("../services/business.service")
const { availableModels, getModel } = require("../config/models")

const MAX_CODE_LENGTH = Number(process.env.MAX_CODE_LENGTH) || 20000
const MAX_FILES = Number(process.env.MAX_REVIEW_FILES) || 10
const allowedDepths = new Set(['quick', 'standard', 'deep'])
const allowedSources = new Set(['paste', 'multi_file', 'github_repo', 'pull_request', 'compare_versions'])

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
            sourceType,
            options: req.body.aiOptions || {}
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
            files: source.files.map((file, index) => {
                const fixedFile = structuredReview.fixedFiles?.find(item => item.path === file.path)
                return {
                    path: file.path,
                    content: file.content,
                    fixedContent: fixedFile?.content || null,
                    fixes: structuredReview.fixes?.filter(item => item.file === file.path) || [],
                    language: structuredReview.detectedLanguages?.[index] || null,
                    status: file.status,
                    additions: file.additions,
                    deletions: file.deletions
                }
            }),
            aiOptions: {
                ...(structuredReview.options || req.body.aiOptions || {}),
                detectedLanguages: structuredReview.detectedLanguages || [],
                codeSmells: structuredReview.codeSmells || [],
                securityVulnerabilities: structuredReview.securityVulnerabilities || [],
                generatedTests: structuredReview.generatedTests || [],
                generatedDocumentation: structuredReview.generatedDocumentation || [],
                comparison: structuredReview.comparison || {}
            }
        })
        await businessService.recordUsageEvent({
            userId: req.user.id,
            eventType: 'review.created',
            metadata: {
                sourceType,
                model: structuredReview.model || selectedModel.id,
                score: structuredReview.score,
                saved: Boolean(savedReview),
                apiKeyId: req.apiKeyId || null
            }
        })
        await businessService.deliverWebhookEvent({
            userId: req.user.id,
            event: 'review.created',
            payload: {
                reviewId: savedReview?.id || null,
                sourceType,
                model: structuredReview.model || selectedModel.id,
                score: structuredReview.score
            }
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

module.exports.getReviewStream = async (req, res) => {
    res.setHeader('Content-Type', 'application/x-ndjson')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')

    function send(event) {
        res.write(`${JSON.stringify(event)}\n`)
    }

    try {
        const { depth, model, projectId } = req.body
        const sourceType = allowedSources.has(req.body.sourceType) ? req.body.sourceType : 'paste'
        const source = await resolveSource(req.body, sourceType)
        const totalLength = source.files.reduce((total, file) => total + file.content.length, 0)

        if (!source.files.length) {
            send({ type: 'error', error: 'At least one code file is required.' })
            return res.end()
        }

        if (source.files.length > MAX_FILES || totalLength > MAX_CODE_LENGTH) {
            send({ type: 'error', error: 'Review content is too large for one request.' })
            return res.end()
        }

        const project = await projectService.ensureProjectAccess({ userId: req.user.id, projectId })
        if (projectId && !project) {
            send({ type: 'error', error: 'Project not found.' })
            return res.end()
        }

        const used = await userService.getUsage(req.user.id)
        if (used >= req.user.monthly_limit) {
            send({ type: 'error', error: 'Monthly review limit reached.' })
            return res.end()
        }

        const reviewDepth = allowedDepths.has(depth) ? depth : 'standard'
        const selectedModel = getModel(model)
        let structuredReview
        let streamingFallbackUsed = false

        try {
            structuredReview = await aiService.stream({
                files: source.files,
                depth: reviewDepth,
                model: selectedModel.id,
                sourceType,
                options: req.body.aiOptions || {},
                onChunk: text => send({ type: 'chunk', text })
            })
        } catch (streamError) {
            streamingFallbackUsed = true
            console.error('Streaming unavailable, retrying without stream:', {
                status: streamError.statusCode || streamError.status,
                message: streamError.message,
                failures: streamError.failures
            })
            send({ type: 'status', text: 'Streaming is temporarily unavailable. Finishing the review without live streaming.' })
            structuredReview = await aiService({
                files: source.files,
                depth: reviewDepth,
                model: selectedModel.id,
                sourceType,
                options: req.body.aiOptions || {}
            })
        }

        const savedReview = await saveStructuredReview({
            req,
            project,
            source,
            sourceType,
            reviewDepth,
            selectedModel,
            structuredReview
        })
        await businessService.recordUsageEvent({
            userId: req.user.id,
            eventType: 'review.created',
            metadata: {
                sourceType,
                model: structuredReview.model || selectedModel.id,
                score: structuredReview.score,
                saved: Boolean(savedReview),
                apiKeyId: req.apiKeyId || null
            }
        })
        await businessService.deliverWebhookEvent({
            userId: req.user.id,
            event: 'review.created',
            payload: {
                reviewId: savedReview?.id || null,
                sourceType,
                model: structuredReview.model || selectedModel.id,
                score: structuredReview.score
            }
        })

        send({
            type: 'done',
            data: {
                review: structuredReview.markdown,
                result: structuredReview,
                model: structuredReview.model || selectedModel.id,
                fallbackUsed: Boolean(structuredReview.fallbackUsed || streamingFallbackUsed),
                streamingFallbackUsed,
                savedReview,
                usage: {
                    used: used + 1,
                    limit: req.user.monthly_limit,
                    remaining: Math.max(req.user.monthly_limit - used - 1, 0)
                }
            }
        })
        return res.end()
    } catch (error) {
        console.error('Streaming code review failed:', {
            status: error.statusCode || error.status,
            message: error.message,
            failures: error.failures
        })
        send({ type: 'error', error: 'Unable to generate a review right now. Please try again.' })
        return res.end()
    }
}

async function saveStructuredReview({ req, project, source, sourceType, reviewDepth, selectedModel, structuredReview }) {
    return reviewService.saveReview({
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
        files: source.files.map((file, index) => {
            const fixedFile = structuredReview.fixedFiles?.find(item => item.path === file.path)
            return {
                path: file.path,
                content: file.content,
                fixedContent: fixedFile?.content || null,
                fixes: structuredReview.fixes?.filter(item => item.file === file.path) || [],
                language: structuredReview.detectedLanguages?.[index] || null,
                status: file.status,
                additions: file.additions,
                deletions: file.deletions
            }
        }),
        aiOptions: {
            ...(structuredReview.options || req.body.aiOptions || {}),
            detectedLanguages: structuredReview.detectedLanguages || [],
            codeSmells: structuredReview.codeSmells || [],
            securityVulnerabilities: structuredReview.securityVulnerabilities || [],
            generatedTests: structuredReview.generatedTests || [],
            generatedDocumentation: structuredReview.generatedDocumentation || [],
            comparison: structuredReview.comparison || {}
        }
    })
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

    if (sourceType === 'compare_versions') {
        const before = typeof body.beforeCode === 'string' ? body.beforeCode.trim() : ''
        const after = typeof body.afterCode === 'string' ? body.afterCode.trim() : ''
        return {
            sourceType,
            sourceUrl: null,
            files: [
                { path: 'before-version.js', content: before, status: 'before' },
                { path: 'after-version.js', content: after, status: 'after' }
            ].filter(file => file.content)
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

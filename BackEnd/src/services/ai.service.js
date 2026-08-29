const { GoogleGenerativeAI } = require("@google/generative-ai");
const { availableModels } = require("../config/models")

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_KEY);

const systemInstruction = `
You are a senior code reviewer.

Infer programming languages from file content and paths. Review only the files provided.

Return valid JSON only. Do not wrap the JSON in Markdown.

Schema:
{
  "summary": "short executive summary",
  "score": 0,
  "severityCounts": { "critical": 0, "high": 0, "medium": 0, "low": 0 },
  "checklist": [
    { "label": "Correctness", "status": "pass|warning|fail", "note": "short note" }
  ],
  "comments": [
    {
      "file": "path/to/file.js",
      "line": 1,
      "severity": "critical|high|medium|low",
      "title": "short issue title",
      "message": "specific issue explanation",
      "suggestion": "specific fix"
    }
  ],
  "fixes": [
    {
      "file": "path/to/file.js",
      "title": "short fix title",
      "explanation": "what should change and why",
      "replacement": "short corrected snippet only, escaped as a JSON string"
    }
  ],
  "fixedFiles": [
    { "path": "path/to/file.js", "content": "single-line escaped complete improved code only when safe" }
  ],
  "fixedCode": "improved complete code when reasonable, otherwise empty string",
  "markdown": "full human-readable review in Markdown"
}

Score must be 0-100 where 100 is production ready.
Checklist must cover Correctness, Security, Performance, Maintainability, Tests, and Documentation.
For multi-file reviews, include findings for every provided file that has meaningful review feedback. Use file paths exactly as provided.
For pull request reviews, comments may describe changed lines from patches. If no issue exists, return an empty comments array and explain that in markdown.
Always return the checklist array with all six required checklist items, even when the score is high.
Prefer fixes with short replacement snippets. Only return fixedFiles/fixedCode when the full corrected code can be represented as valid escaped JSON.
`

const allowedDepths = new Set(['quick', 'standard', 'deep']);
const depthInstructions = {
    quick: 'Return no more than 4 comments. Focus only on critical and high-impact problems.',
    standard: 'Return no more than 8 comments. Cover correctness, security, maintainability, performance, and tests.',
    deep: 'Return no more than 14 comments. Be strict about edge cases, security, scalability, tests, and long-term maintenance.',
};

function createModel(modelId) {
    return genAI.getGenerativeModel({
        model: modelId || process.env.GEMINI_MODEL || "gemini-3.7-flash",
        systemInstruction,
        generationConfig: {
            responseMimeType: 'application/json'
        }
    });
}

async function generateReview({ files, depth, model, sourceType }) {
    const reviewDepth = allowedDepths.has(depth) ? depth : 'standard';
    const formattedFiles = files.map(file => `
File: ${file.path}
\`\`\`
${file.content}
\`\`\`
`).join('\n')

    const prompt = `
Source type: ${sourceType}
Review depth: ${reviewDepth}
Depth behavior: ${depthInstructions[reviewDepth]}

Files:
${formattedFiles}
`;

    const modelIds = getModelFallbackOrder(model)
    const failures = []

    for (const modelId of modelIds) {
        for (let attempt = 1; attempt <= 2; attempt += 1) {
            try {
                const result = await createModel(modelId).generateContent(prompt);
                return {
                    ...parseStructuredReview(result.response.text(), files),
                    model: modelId,
                    fallbackUsed: modelId !== model
                }
            } catch (error) {
                failures.push({ model: modelId, status: error.status, message: error.message })

                if (!isTransientProviderError(error)) {
                    throw createProviderError(error, failures)
                }

                if (attempt < 2) {
                    await wait(700 * attempt)
                }
            }
        }
    }

    throw createProviderError(failures[failures.length - 1], failures)
}

function getModelFallbackOrder(modelId) {
    const configuredModels = availableModels.map(item => item.id)
    const preferredModel = modelId || process.env.GEMINI_MODEL || configuredModels[0]
    return [preferredModel, ...configuredModels.filter(item => item !== preferredModel)]
}

function isTransientProviderError(error) {
    return [429, 500, 502, 503, 504].includes(Number(error.status))
        || error.code === 'UND_ERR_CONNECT_TIMEOUT'
        || error.name === 'TypeError'
        || /fetch failed|high demand|temporarily|unavailable/i.test(error.message || '')
}

function createProviderError(error, failures) {
    const providerError = new Error('AI provider is temporarily unavailable. Please try again in a moment.')
    providerError.statusCode = isTransientProviderError(error) ? 503 : 502
    providerError.failures = failures
    return providerError
}

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

function parseStructuredReview(rawText, files = []) {
    const cleaned = cleanModelText(rawText)
    const jsonCandidate = extractJsonObject(cleaned)
    const attempts = [
        cleaned,
        jsonCandidate,
        escapeControlCharactersInsideStrings(jsonCandidate),
        removeProblematicCodeFields(jsonCandidate),
        escapeControlCharactersInsideStrings(removeProblematicCodeFields(jsonCandidate))
    ].filter(Boolean)

    for (const attempt of attempts) {
        try {
            const parsed = JSON.parse(attempt)
            return normalizeReview(parsed, files)
        } catch {
            // Try the next cleanup strategy.
        }
    }

    return normalizeReview({
        summary: 'The AI returned an unstructured review.',
        score: 70,
        severityCounts: { critical: 0, high: 0, medium: 1, low: 0 },
        checklist: [],
        comments: [],
        fixedFiles: [],
        fixedCode: '',
        markdown: rawText
    }, files)
}

function cleanModelText(rawText) {
    return String(rawText || '')
        .trim()
        .replace(/^```json/i, '')
        .replace(/^```/, '')
        .replace(/```$/, '')
        .trim()
}

function extractJsonObject(text) {
    const source = String(text || '')
    const start = source.indexOf('{')

    if (start === -1) return ''

    let depth = 0
    let inString = false
    let escaped = false

    for (let index = start; index < source.length; index += 1) {
        const char = source[index]

        if (escaped) {
            escaped = false
            continue
        }

        if (char === '\\') {
            escaped = true
            continue
        }

        if (char === '"') {
            inString = !inString
            continue
        }

        if (inString) continue

        if (char === '{') depth += 1
        if (char === '}') depth -= 1

        if (depth === 0) {
            return source.slice(start, index + 1)
        }
    }

    return source.slice(start)
}

function escapeControlCharactersInsideStrings(text) {
    let repaired = ''
    let inString = false
    let escaped = false

    for (const char of String(text || '')) {
        if (escaped) {
            repaired += char
            escaped = false
            continue
        }

        if (char === '\\') {
            repaired += char
            escaped = true
            continue
        }

        if (char === '"') {
            repaired += char
            inString = !inString
            continue
        }

        if (inString && char === '\n') {
            repaired += '\\n'
            continue
        }

        if (inString && char === '\r') {
            continue
        }

        if (inString && char === '\t') {
            repaired += '\\t'
            continue
        }

        repaired += char
    }

    return repaired
}

function removeProblematicCodeFields(text) {
    const source = String(text || '')
    const fixedFilesIndex = source.indexOf('"fixedFiles"')
    const fixedCodeIndex = source.indexOf('"fixedCode"', fixedFilesIndex)

    if (fixedFilesIndex === -1 || fixedCodeIndex === -1) {
        return ''
    }

    const prefix = source.slice(0, fixedFilesIndex)
    const suffix = source.slice(fixedCodeIndex)
    return `${prefix}"fixedFiles": [], ${suffix}`
}

function normalizeReview(review, files = []) {
    const knownPaths = new Set(files.map(file => file.path))
    const comments = Array.isArray(review.comments) ? review.comments.map(comment => ({
        file: String(comment.file || 'pasted-code'),
        line: Number(comment.line) || 1,
        severity: normalizeSeverity(comment.severity),
        title: String(comment.title || 'Review comment'),
        message: String(comment.message || ''),
        suggestion: String(comment.suggestion || '')
    })) : []

    const severityCounts = comments.reduce((counts, comment) => {
        counts[comment.severity] += 1
        return counts
    }, { critical: 0, high: 0, medium: 0, low: 0 })

    const checklist = Array.isArray(review.checklist) ? review.checklist.map(item => ({
        label: String(item.label || 'Checklist item'),
        status: ['pass', 'warning', 'fail'].includes(item.status) ? item.status : 'warning',
        note: String(item.note || '')
    })) : []

    const fixes = Array.isArray(review.fixes)
        ? review.fixes
            .filter(fix => fix && fix.file)
            .map(fix => ({
                file: String(fix.file),
                title: String(fix.title || 'Suggested fix'),
                explanation: String(fix.explanation || ''),
                replacement: String(fix.replacement || '')
            }))
        : []

    const fixedFiles = Array.isArray(review.fixedFiles)
        ? review.fixedFiles
            .filter(file => file && typeof file.content === 'string')
            .map(file => ({
                path: knownPaths.has(String(file.path)) ? String(file.path) : String(file.path || files[0]?.path || 'pasted-code.js'),
                content: String(file.content || '')
            }))
        : []

    return {
        summary: String(review.summary || 'Review completed.'),
        score: Math.max(0, Math.min(Number(review.score) || 0, 100)),
        severityCounts: {
            critical: Number(review.severityCounts?.critical) || severityCounts.critical,
            high: Number(review.severityCounts?.high) || severityCounts.high,
            medium: Number(review.severityCounts?.medium) || severityCounts.medium,
            low: Number(review.severityCounts?.low) || severityCounts.low
        },
        checklist,
        comments,
        fixes,
        fixedFiles,
        fixedCode: String(review.fixedCode || ''),
        markdown: String(review.markdown || createMarkdownReview(review, comments, checklist))
    }
}

function createMarkdownReview(review, comments, checklist) {
    const sections = [
        '## Executive Summary',
        String(review.summary || 'Review completed.'),
        '',
        '## Key Findings'
    ]

    if (comments.length) {
        comments.forEach(comment => {
            sections.push(`- ${comment.file}:${comment.line} [${comment.severity}] ${comment.title}: ${comment.message}`)
        })
    } else {
        sections.push('- No line-level findings were returned for this review.')
    }

    sections.push('', '## Checklist')

    if (checklist.length) {
        checklist.forEach(item => {
            sections.push(`- ${item.label}: ${item.status} - ${item.note}`)
        })
    } else {
        sections.push('- Checklist data was not returned by the model.')
    }

    return sections.join('\n')
}

function normalizeSeverity(severity) {
    return ['critical', 'high', 'medium', 'low'].includes(severity) ? severity : 'medium'
}

module.exports = generateReview

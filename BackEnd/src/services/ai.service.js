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
  "detectedLanguages": ["JavaScript"],
  "codeSmells": [
    { "file": "path/to/file.js", "line": 1, "title": "short smell", "impact": "why it matters", "fix": "how to improve" }
  ],
  "securityVulnerabilities": [
    { "file": "path/to/file.js", "line": 1, "severity": "critical|high|medium|low", "title": "short vulnerability", "risk": "impact", "mitigation": "fix" }
  ],
  "generatedTests": [
    { "file": "path/to/test.js", "framework": "detected or recommended framework", "content": "complete useful unit test code" }
  ],
  "generatedDocumentation": [
    { "file": "path/to/file.md", "content": "developer documentation or JSDoc/README content" }
  ],
  "comparison": {
    "summary": "empty unless comparing versions",
    "regressions": [],
    "improvements": [],
    "recommendation": "ship|revise|block"
  },
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
const allowedExplanationLevels = new Set(['beginner', 'intermediate', 'senior']);
const allowedFocusAreas = new Set(['security', 'performance', 'readability', 'tests']);
const depthInstructions = {
    quick: 'Return no more than 4 comments. Focus only on critical and high-impact problems.',
    standard: 'Return no more than 8 comments. Cover correctness, security, maintainability, performance, and tests.',
    deep: 'Return no more than 14 comments. Be strict about edge cases, security, scalability, tests, and long-term maintenance.',
};

const templateInstructions = {
    balanced: 'Run a balanced production code review across correctness, maintainability, security, performance, tests, and documentation.',
    security_audit: 'Prioritize exploitable vulnerabilities, unsafe data handling, auth/session risks, injection, dependency and configuration risks.',
    performance_pass: 'Prioritize algorithmic complexity, memory use, repeated work, rendering/network bottlenecks, and scalability.',
    test_plan: 'Prioritize missing test cases, fragile behavior, regressions, mocking boundaries, and test implementation.',
    docs_pass: 'Prioritize unclear APIs, missing README/JSDoc/comments, onboarding gaps, and maintenance documentation.'
}

function createModel(modelId) {
    return genAI.getGenerativeModel({
        model: modelId || process.env.GEMINI_MODEL || "gemini-3.7-flash",
        systemInstruction,
        generationConfig: {
            responseMimeType: 'application/json'
        }
    });
}

async function generateReview({ files, depth, model, sourceType, options = {} }) {
    const reviewDepth = allowedDepths.has(depth) ? depth : 'standard';
    const normalizedOptions = normalizeOptions(options)
    const prompt = buildPrompt({ files, reviewDepth, sourceType, options: normalizedOptions })

    const modelIds = getModelFallbackOrder(model)
    const failures = []

    for (const modelId of modelIds) {
        for (let attempt = 1; attempt <= 2; attempt += 1) {
            try {
                const result = await createModel(modelId).generateContent(prompt);
                return {
                    ...parseStructuredReview(result.response.text(), files),
                    options: normalizedOptions,
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

async function generateReviewStream({ files, depth, model, sourceType, options = {}, onChunk }) {
    const reviewDepth = allowedDepths.has(depth) ? depth : 'standard'
    const normalizedOptions = normalizeOptions(options)
    const prompt = buildPrompt({ files, reviewDepth, sourceType, options: normalizedOptions })
    const modelIds = getModelFallbackOrder(model)
    const failures = []

    for (const modelId of modelIds) {
        try {
            const result = await createModel(modelId).generateContentStream(prompt)
            let rawText = ''

            for await (const chunk of result.stream) {
                const text = chunk.text()
                rawText += text
                if (text && onChunk) onChunk(text)
            }

            return {
                ...parseStructuredReview(rawText, files),
                options: normalizedOptions,
                model: modelId,
                fallbackUsed: modelId !== model
            }
        } catch (error) {
            failures.push({ model: modelId, status: error.status, message: error.message })
            if (!isTransientProviderError(error)) throw createProviderError(error, failures)
        }
    }

    throw createProviderError(failures[failures.length - 1], failures)
}

function buildPrompt({ files, reviewDepth, sourceType, options }) {
    const formattedFiles = files.map(file => `
File: ${file.path}
Detected language: ${detectLanguage(file)}
\`\`\`
${file.content}
\`\`\`
`).join('\n')

    const prompt = `
Source type: ${sourceType}
Review depth: ${reviewDepth}
Depth behavior: ${depthInstructions[reviewDepth]}
Explanation level: ${options.explanationLevel}
Review focus areas: ${options.focusAreas.join(', ') || 'balanced'}
Prompt template: ${options.promptTemplate}
Template behavior: ${templateInstructions[options.promptTemplate] || templateInstructions.balanced}
Generate unit tests: ${options.generateTests ? 'yes' : 'no'}
Generate documentation: ${options.generateDocumentation ? 'yes' : 'no'}
Streaming response requested: ${options.streamResponse ? 'yes' : 'no'}
Detect code smells: ${options.detectCodeSmells ? 'yes' : 'no'}
Detect security vulnerabilities: ${options.detectSecurityVulnerabilities ? 'yes' : 'no'}

Custom review rules:
${options.customRules || 'None'}

Organization coding standards:
${options.organizationStandards || 'None'}

When source type is compare_versions, compare old and new files with matching paths. Emphasize regressions, improvements, and whether the new version should ship.

Files:
${formattedFiles}
`;

    return prompt
}


function normalizeOptions(options = {}) {
    const focusAreas = Array.isArray(options.focusAreas)
        ? options.focusAreas.filter(area => allowedFocusAreas.has(area))
        : []

    const explanationLevel = allowedExplanationLevels.has(options.explanationLevel) ? options.explanationLevel : 'intermediate'
    const promptTemplate = templateInstructions[options.promptTemplate] ? options.promptTemplate : 'balanced'

    return {
        focusAreas,
        explanationLevel,
        customRules: String(options.customRules || '').slice(0, 3000),
        organizationStandards: String(options.organizationStandards || '').slice(0, 3000),
        promptTemplate,
        generateTests: Boolean(options.generateTests),
        generateDocumentation: Boolean(options.generateDocumentation),
        streamResponse: options.streamResponse !== false,
        detectCodeSmells: options.detectCodeSmells !== false,
        detectSecurityVulnerabilities: options.detectSecurityVulnerabilities !== false
    }
}

function detectLanguage(file) {
    const path = String(file.path || '').toLowerCase()
    const content = String(file.content || '')
    const extensionMap = [
        [/\.tsx?$/, 'TypeScript'],
        [/\.jsx?$/, 'JavaScript'],
        [/\.py$/, 'Python'],
        [/\.(java)$/, 'Java'],
        [/\.(cs)$/, 'C#'],
        [/\.(cpp|cc|cxx|hpp|h)$/, 'C++'],
        [/\.c$/, 'C'],
        [/\.go$/, 'Go'],
        [/\.rs$/, 'Rust'],
        [/\.php$/, 'PHP'],
        [/\.(rb)$/, 'Ruby'],
        [/\.(swift)$/, 'Swift'],
        [/\.(kt|kts)$/, 'Kotlin'],
        [/\.(sql)$/, 'SQL'],
        [/\.(html)$/, 'HTML'],
        [/\.(css|scss)$/, 'CSS'],
        [/\.(json)$/, 'JSON'],
        [/\.(md|mdx)$/, 'Markdown']
    ]

    const matched = extensionMap.find(([pattern]) => pattern.test(path))
    if (matched) return matched[1]
    if (/function\s+\w+|const\s+\w+|=>|console\.log/.test(content)) return 'JavaScript'
    if (/def\s+\w+\(|import\s+\w+|print\(/.test(content)) return 'Python'
    if (/#include\s*<|std::|int\s+main\s*\(/.test(content)) return 'C++'
    if (/public\s+class|System\.out\.println/.test(content)) return 'Java'
    return 'Unknown'
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
        detectedLanguages: Array.isArray(review.detectedLanguages) && review.detectedLanguages.length
            ? review.detectedLanguages.map(String)
            : [...new Set(files.map(detectLanguage))],
        codeSmells: normalizeCodeSmells(review.codeSmells),
        securityVulnerabilities: normalizeSecurityVulnerabilities(review.securityVulnerabilities),
        generatedTests: normalizeGeneratedFiles(review.generatedTests),
        generatedDocumentation: normalizeGeneratedFiles(review.generatedDocumentation),
        comparison: normalizeComparison(review.comparison),
        markdown: String(review.markdown || createMarkdownReview(review, comments, checklist))
    }
}

function normalizeCodeSmells(items) {
    return Array.isArray(items) ? items.map(item => ({
        file: String(item.file || 'pasted-code'),
        line: Number(item.line) || 1,
        title: String(item.title || 'Code smell'),
        impact: String(item.impact || ''),
        fix: String(item.fix || '')
    })) : []
}

function normalizeSecurityVulnerabilities(items) {
    return Array.isArray(items) ? items.map(item => ({
        file: String(item.file || 'pasted-code'),
        line: Number(item.line) || 1,
        severity: normalizeSeverity(item.severity),
        title: String(item.title || 'Security issue'),
        risk: String(item.risk || ''),
        mitigation: String(item.mitigation || '')
    })) : []
}

function normalizeGeneratedFiles(items) {
    return Array.isArray(items) ? items.map(item => ({
        file: String(item.file || 'generated.txt'),
        framework: item.framework ? String(item.framework) : '',
        content: String(item.content || '')
    })).filter(item => item.content.trim()) : []
}

function normalizeComparison(comparison = {}) {
    return {
        summary: String(comparison.summary || ''),
        regressions: Array.isArray(comparison.regressions) ? comparison.regressions.map(String) : [],
        improvements: Array.isArray(comparison.improvements) ? comparison.improvements.map(String) : [],
        recommendation: ['ship', 'revise', 'block'].includes(comparison.recommendation) ? comparison.recommendation : ''
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

generateReview.stream = generateReviewStream

module.exports = generateReview

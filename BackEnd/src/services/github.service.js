const CODE_EXTENSIONS = new Set([
    '.js', '.jsx', '.ts', '.tsx', '.py', '.java', '.c', '.cpp', '.h', '.hpp',
    '.cs', '.go', '.rb', '.php', '.rs', '.swift', '.kt', '.json', '.md'
])

const MAX_GITHUB_FILES = Number(process.env.MAX_GITHUB_FILES) || 8
const MAX_GITHUB_FILE_CHARS = Number(process.env.MAX_GITHUB_FILE_CHARS) || 12000

function parseGitHubUrl(url) {
    const parsed = new URL(url)

    if (parsed.hostname !== 'github.com') {
        throw new Error('Please provide a valid GitHub URL.')
    }

    const [owner, repo, type, ref] = parsed.pathname.split('/').filter(Boolean)

    if (!owner || !repo) {
        throw new Error('GitHub URL must include an owner and repository.')
    }

    return {
        owner,
        repo: repo.replace(/\.git$/, ''),
        type,
        ref
    }
}

async function fetchJson(url) {
    const response = await fetch(url, {
        headers: {
            'Accept': 'application/vnd.github+json',
            'User-Agent': 'AI-Powered-Code-Reveiwer'
        }
    })

    if (!response.ok) {
        throw new Error('Unable to fetch data from GitHub.')
    }

    return response.json()
}

async function fetchText(url) {
    const response = await fetch(url, {
        headers: { 'User-Agent': 'AI-Powered-Code-Reveiwer' }
    })

    if (!response.ok) {
        throw new Error('Unable to fetch file content from GitHub.')
    }

    return response.text()
}

async function importRepository(url) {
    const { owner, repo } = parseGitHubUrl(url)
    const repository = await fetchJson(`https://api.github.com/repos/${owner}/${repo}`)
    const branch = repository.default_branch
    const tree = await fetchJson(`https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`)

    const candidates = tree.tree
        .filter(item => item.type === 'blob' && isReviewablePath(item.path))
        .slice(0, MAX_GITHUB_FILES)

    const files = await Promise.all(candidates.map(async item => ({
        path: item.path,
        content: (await fetchText(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${item.path}`)).slice(0, MAX_GITHUB_FILE_CHARS)
    })))

    return {
        sourceType: 'github_repo',
        sourceUrl: url,
        files
    }
}

async function importPullRequest(url) {
    const { owner, repo, type, ref } = parseGitHubUrl(url)

    if (type !== 'pull' || !ref) {
        throw new Error('Please provide a valid GitHub pull request URL.')
    }

    const prFiles = await fetchJson(`https://api.github.com/repos/${owner}/${repo}/pulls/${ref}/files`)
    const files = prFiles
        .filter(file => isReviewablePath(file.filename))
        .slice(0, MAX_GITHUB_FILES)
        .map(file => ({
            path: file.filename,
            content: file.patch || `${file.status} file changed. Patch was not available.`,
            status: file.status,
            additions: file.additions,
            deletions: file.deletions
        }))

    return {
        sourceType: 'pull_request',
        sourceUrl: url,
        files
    }
}

function isReviewablePath(path) {
    const lowerPath = path.toLowerCase()
    return [...CODE_EXTENSIONS].some(extension => lowerPath.endsWith(extension))
        && !lowerPath.includes('package-lock.json')
        && !lowerPath.includes('node_modules/')
        && !lowerPath.includes('dist/')
        && !lowerPath.includes('build/')
}

module.exports = {
    importRepository,
    importPullRequest
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import MonacoEditor from '@monaco-editor/react'
import Markdown from "react-markdown"
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";
import axios from 'axios'
import './App.css'

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000').replace(/\/$/, '')
const RAZORPAY_KEY_ID = import.meta.env.VITE_RAZORPAY_KEY_ID || ''
const APP_NAME = 'AI Powered Code Reveiwer'
const SYSTEM_ADMIN_EMAIL = 'admin@gmail.com'
const TOKEN_KEY = 'ai-powered-code-reveiwer-token'
const LEGACY_TOKEN_KEY = 'reviewdesk-token'
const THEME_KEY = 'ai-powered-code-reveiwer-theme'
const LEGACY_THEME_KEY = 'reviewdesk-theme'
const DRAFT_KEY = 'ai-powered-code-reveiwer-review-draft'
const SPLIT_KEY = 'ai-powered-code-reveiwer-split-width'

const fallbackModels = [
  { id: 'gemini-3.7-flash', name: 'Gemini 3.7 Flash', description: 'Best quality for production code review.' },
]

const depthOptions = [
  { label: 'Quick', value: 'quick' },
  { label: 'Standard', value: 'standard' },
  { label: 'Deep', value: 'deep' },
]

const sourceModes = [
  { id: 'paste', label: 'Paste Code' },
  { id: 'multi_file', label: 'Multi-file' },
  { id: 'github_repo', label: 'GitHub Repo' },
  { id: 'pull_request', label: 'Pull Request' },
  { id: 'compare_versions', label: 'Compare Versions' },
]

const focusOptions = [
  { id: 'security', label: 'Security' },
  { id: 'performance', label: 'Performance' },
  { id: 'readability', label: 'Readability' },
  { id: 'tests', label: 'Tests' },
]

const explanationLevels = [
  { id: 'beginner', label: 'Beginner' },
  { id: 'intermediate', label: 'Intermediate' },
  { id: 'senior', label: 'Senior' },
]

const promptTemplates = [
  { id: 'balanced', label: 'Balanced review' },
  { id: 'security_audit', label: 'Security audit' },
  { id: 'performance_pass', label: 'Performance pass' },
  { id: 'test_plan', label: 'Test plan' },
  { id: 'docs_pass', label: 'Documentation pass' },
]

const initialAdminFilters = {
  search: '',
  role: 'all',
  status: 'all',
  sort: 'newest',
}

const initialHistoryFilters = {
  search: '',
  model: '',
  projectId: '',
  severity: '',
  dateFrom: '',
  dateTo: '',
  favorite: false,
}

const pagePaths = {
  dashboard: '/dashboard',
  admin: '/admin',
  review: '/review',
  history: '/history',
  team: '/team',
  profile: '/profile',
  billing: '/billing',
  developer: '/developer',
  compliance: '/compliance',
  settings: '/settings',
}

const publicPaths = {
  landing: '/',
  login: '/login',
  register: '/signup',
  forgot: '/forgot-password',
  reset: '/reset-password',
  verify: '/verify-email',
}

function getPageFromPath(pathname, role) {
  const path = pathname.replace(/\/$/, '') || '/'
  const page = Object.entries(pagePaths).find(([, value]) => value === path)?.[0]
  if (!page) return ''
  if (page === 'admin' && role !== 'admin') return 'dashboard'
  if (page === 'dashboard' && role === 'admin') return 'admin'
  return page
}

function getPublicViewFromPath(pathname) {
  const path = pathname.replace(/\/$/, '') || '/'
  return Object.entries(publicPaths).find(([, value]) => value === path)?.[0] || 'landing'
}

const starterCode = `function calculateDiscount(price, percentage) {
  if (!price || !percentage) return 0
  return price - price * percentage / 100
}`

const reviewableFilePattern = /\.(c|cc|cpp|cs|css|go|html|java|js|jsx|json|md|php|py|rb|rs|sh|sql|ts|tsx|txt|yaml|yml)$/i

function readJsonFromStorage(key, fallback) {
  try {
    return JSON.parse(window.localStorage.getItem(key) || '')
  } catch {
    return fallback
  }
}

function getStoredNumber(key, fallback) {
  const value = Number(window.localStorage.getItem(key))
  return Number.isFinite(value) ? value : fallback
}

function getEditorLanguage(path = '', value = '') {
  const source = `${path}\n${String(value).slice(0, 500)}`.toLowerCase()
  const extension = path.split('.').pop()?.toLowerCase()
  const extensionMap = {
    c: 'c',
    cc: 'cpp',
    cpp: 'cpp',
    cs: 'csharp',
    css: 'css',
    go: 'go',
    h: 'c',
    hpp: 'cpp',
    html: 'html',
    java: 'java',
    js: 'javascript',
    jsx: 'javascript',
    json: 'json',
    md: 'markdown',
    php: 'php',
    py: 'python',
    rb: 'ruby',
    rs: 'rust',
    sh: 'shell',
    sql: 'sql',
    ts: 'typescript',
    tsx: 'typescript',
    yaml: 'yaml',
    yml: 'yaml',
  }

  if (extensionMap[extension]) return extensionMap[extension]
  if (source.includes('def ') || source.includes('import pandas')) return 'python'
  if (source.includes('#include') || source.includes('std::')) return 'cpp'
  if (source.includes('package main') || source.includes('func main')) return 'go'
  if (source.includes('public static void main')) return 'java'
  if (source.includes('<html') || source.includes('</div>')) return 'html'
  if (source.includes('interface ') || source.includes(': string')) return 'typescript'
  return 'javascript'
}

function focusPrimaryEditor() {
  const editor = document.querySelector('.editor-fullscreen .monaco-editor textarea, .editor-panel .monaco-editor textarea')
  editor?.focus()
}

const emptyResult = {
  score: 0,
  severityCounts: { critical: 0, high: 0, medium: 0, low: 0 },
  checklist: [],
  comments: [],
  fixes: [],
  files: [],
  fixedFiles: [],
  fixedCode: '',
  detectedLanguages: [],
  codeSmells: [],
  securityVulnerabilities: [],
  generatedTests: [],
  generatedDocumentation: [],
  comparison: { summary: '', regressions: [], improvements: [], recommendation: '' },
  summary: ''
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function formatCurrency(value) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(Number(value || 0))
}

function formatRupeesFromCents(value) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(Number(value || 0) / 100)
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function loadRazorpayCheckout() {
  if (window.Razorpay) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://checkout.razorpay.com/v1/checkout.js'
    script.async = true
    script.onload = resolve
    script.onerror = () => reject(new Error('Unable to load Razorpay Checkout.'))
    document.body.appendChild(script)
  })
}

function hydrateReviewResult(result, reviewText, files = []) {
  const parsed = parseReviewJson(reviewText)
  const hasStructuredTabs = result?.comments?.length || result?.checklist?.length || result?.fixedFiles?.length || result?.fixedCode
  const source = parsed && !hasStructuredTabs ? parsed : result || emptyResult
  const fixedFiles = source.fixedFiles?.length
    ? source.fixedFiles
    : files.filter(file => file.fixedContent).map(file => ({ path: file.path, content: file.fixedContent }))
  const fileFixes = files.flatMap(file => (file.fixes || []).map(fix => ({ ...fix, file: fix.file || file.path })))

  return {
    ...emptyResult,
    ...source,
    files,
    fixes: source.fixes?.length ? source.fixes : fileFixes,
    fixedFiles,
    severityCounts: source.severityCounts || countSeverities(source.comments || []),
    markdown: source.markdown || reviewText
  }
}

function parseReviewJson(text) {
  const cleaned = String(text || '')
    .trim()
    .replace(/^```json/i, '')
    .replace(/^```/, '')
    .replace(/```$/, '')
    .trim()
  const candidate = extractJsonObject(cleaned)
  const strippedCandidate = removeProblematicCodeFields(candidate)
  const attempts = [
    cleaned,
    candidate,
    escapeControlCharactersInsideStrings(candidate),
    strippedCandidate,
    escapeControlCharactersInsideStrings(strippedCandidate)
  ].filter(Boolean)

  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt)
    } catch {
      // Try the next cleanup strategy.
    }
  }

  return null
}

function removeProblematicCodeFields(text) {
  const source = String(text || '')
  const fixedFilesIndex = source.indexOf('"fixedFiles"')
  const fixedCodeIndex = source.indexOf('"fixedCode"', fixedFilesIndex)

  if (fixedFilesIndex === -1 || fixedCodeIndex === -1) return ''

  return `${source.slice(0, fixedFilesIndex)}"fixedFiles": [], ${source.slice(fixedCodeIndex)}`
}

function extractJsonObject(text) {
  const start = text.indexOf('{')
  if (start === -1) return ''

  let depth = 0
  let inString = false
  let escaped = false

  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
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
    if (depth === 0) return text.slice(start, index + 1)
  }

  return text.slice(start)
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
    if (inString && char === '\r') continue
    if (inString && char === '\t') {
      repaired += '\\t'
      continue
    }
    repaired += char
  }

  return repaired
}

function App() {
  const savedDraft = useMemo(() => readJsonFromStorage(DRAFT_KEY, {}), [])
  const [token, setToken] = useState(() => {
    window.localStorage.removeItem(LEGACY_TOKEN_KEY)
    return window.localStorage.getItem(TOKEN_KEY) || ''
  })
  const [theme, setTheme] = useState(() => window.localStorage.getItem(THEME_KEY) || window.localStorage.getItem(LEGACY_THEME_KEY) || 'dark')
  const [publicView, setPublicViewState] = useState(() => token ? getPublicViewFromPath(window.location.pathname) : (getPageFromPath(window.location.pathname) ? 'login' : getPublicViewFromPath(window.location.pathname)))
  const [activePage, setActivePageState] = useState(() => getPageFromPath(window.location.pathname) || 'dashboard')
  const [user, setUser] = useState(null)
  const [usage, setUsage] = useState({ used: 0, limit: 0, remaining: 0 })
  const [reviews, setReviews] = useState([])
  const [historyFilters, setHistoryFilters] = useState(initialHistoryFilters)
  const [sharedReview, setSharedReview] = useState(null)
  const [projects, setProjects] = useState([])
  const [workspaces, setWorkspaces] = useState([])
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState('')
  const [teamDetails, setTeamDetails] = useState(null)
  const [models, setModels] = useState(fallbackModels)
  const [adminStats, setAdminStats] = useState(null)
  const [adminAnalytics, setAdminAnalytics] = useState(null)
  const [adminUsers, setAdminUsers] = useState([])
  const [adminFilters, setAdminFilters] = useState(initialAdminFilters)
  const [selectedAdminUser, setSelectedAdminUser] = useState(null)
  const [selectedUserReviews, setSelectedUserReviews] = useState([])
  const [billing, setBilling] = useState(null)
  const [developerResources, setDeveloperResources] = useState({ apiKeys: [], webhooks: [], limits: { apiKeys: 0, webhooks: 0 } })
  const [compliance, setCompliance] = useState({ privacy: null, auditLogs: [] })
  const [apiKeyForm, setApiKeyForm] = useState({ name: 'Production API key' })
  const [newApiKey, setNewApiKey] = useState('')
  const [webhookForm, setWebhookForm] = useState({ url: '', events: ['review.created'] })
  const [newWebhookSecret, setNewWebhookSecret] = useState('')
  const [code, setCode] = useState(savedDraft.code || starterCode)
  const [files, setFiles] = useState(Array.isArray(savedDraft.files) && savedDraft.files.length ? savedDraft.files : [{ path: 'src/app.js', content: starterCode }])
  const [githubRepoUrl, setGithubRepoUrl] = useState(savedDraft.githubRepoUrl || '')
  const [pullRequestUrl, setPullRequestUrl] = useState(savedDraft.pullRequestUrl || '')
  const [beforeCode, setBeforeCode] = useState(savedDraft.beforeCode || '')
  const [afterCode, setAfterCode] = useState(savedDraft.afterCode || '')
  const [sourceMode, setSourceMode] = useState(savedDraft.sourceMode || 'paste')
  const [editorWidth, setEditorWidth] = useState(() => Math.min(Math.max(getStoredNumber(SPLIT_KEY, 50), 35), 65))
  const [isEditorFullscreen, setIsEditorFullscreen] = useState(false)
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [newProjectName, setNewProjectName] = useState('')
  const [review, setReview] = useState('')
  const [result, setResult] = useState(emptyResult)
  const [depth, setDepth] = useState('standard')
  const [model, setModel] = useState(fallbackModels[0].id)
  const [aiOptions, setAiOptions] = useState({
    focusAreas: [],
    customRules: '',
    organizationStandards: '',
    promptTemplate: 'balanced',
    explanationLevel: 'intermediate',
    generateTests: false,
    generateDocumentation: false,
    detectCodeSmells: true,
    detectSecurityVulnerabilities: true,
    streamResponse: true,
  })
  const [resultView, setResultView] = useState('report')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [reviewLoadingSource, setReviewLoadingSource] = useState('')
  const [authForm, setAuthForm] = useState({ name: '', email: '', password: '' })
  const [pendingInviteToken, setPendingInviteToken] = useState('')
  const [securityForm, setSecurityForm] = useState({ currentPassword: '', newPassword: '', resetEmail: '', resetToken: '', resetPassword: '', verifyToken: '' })
  const [profileForm, setProfileForm] = useState({ name: '', bio: '', avatarUrl: '' })
  const [workspaceForm, setWorkspaceForm] = useState({ name: '', inviteEmail: '', inviteRole: 'member', inviteToken: '' })
  const sourceModeRef = useRef(sourceMode)
  const editorFocusRef = useRef(null)
  const reviewCodeRef = useRef(null)
  const saveDraftRef = useRef(null)

  const setPublicView = useCallback((view, options = {}) => {
    setPublicViewState(view)
    const path = publicPaths[view] || '/'
    if (!options.replace && window.location.pathname !== path) {
      window.history.pushState({}, '', path)
    }
    if (options.replace) {
      window.history.replaceState({}, '', path)
    }
  }, [])

  const setActivePage = useCallback((page, options = {}) => {
    setActivePageState(page)
    const path = pagePaths[page] || '/dashboard'
    if (!options.replace && window.location.pathname !== path) {
      window.history.pushState({}, '', path)
    }
    if (options.replace) {
      window.history.replaceState({}, '', path)
    }
  }, [])

  const api = useMemo(() => {
    const client = axios.create({ baseURL: API_URL })
    client.interceptors.request.use(config => {
      if (token) {
        config.headers.Authorization = `Bearer ${token}`
      }
      return config
    })
    return client
  }, [token])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    window.localStorage.setItem(THEME_KEY, theme)
    window.localStorage.removeItem(LEGACY_THEME_KEY)
  }, [theme])

  useEffect(() => {
    if (!notice && !error) return undefined
    const timeout = window.setTimeout(() => {
      setNotice('')
      setError('')
    }, 2000)
    return () => window.clearTimeout(timeout)
  }, [notice, error])

  useEffect(() => {
    sourceModeRef.current = sourceMode
  }, [sourceMode])

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify({
        sourceMode,
        code,
        files,
        githubRepoUrl,
        pullRequestUrl,
        beforeCode,
        afterCode,
      }))
    }, 700)

    return () => window.clearTimeout(timeout)
  }, [afterCode, beforeCode, code, files, githubRepoUrl, pullRequestUrl, sourceMode])

  useEffect(() => {
    window.localStorage.setItem(SPLIT_KEY, String(editorWidth))
  }, [editorWidth])

  useEffect(() => {
    function handleKeyboardShortcut(event) {
      const commandKey = event.ctrlKey || event.metaKey
      if (commandKey && event.key === 'Enter') {
        event.preventDefault()
        reviewCodeRef.current?.()
      }
      if (commandKey && event.key.toLowerCase() === 's') {
        event.preventDefault()
        saveDraftRef.current?.()
      }
      if (commandKey && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        if (typeof editorFocusRef.current?.focus === 'function') {
          editorFocusRef.current.focus()
        } else {
          focusPrimaryEditor()
        }
      }
      if (event.key === 'Escape') {
        setIsEditorFullscreen(false)
      }
    }

    window.addEventListener('keydown', handleKeyboardShortcut, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyboardShortcut, { capture: true })
  }, [])

  useEffect(() => {
    function handlePopState() {
      if (token && user) {
        setActivePageState(getPageFromPath(window.location.pathname, user.role) || (user.role === 'admin' ? 'admin' : 'dashboard'))
      } else {
        setPublicViewState(getPublicViewFromPath(window.location.pathname))
      }
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [token, user])

  const resetSessionState = useCallback(() => {
    setUser(null)
    setUsage({ used: 0, limit: 0, remaining: 0 })
    setReviews([])
    setHistoryFilters(initialHistoryFilters)
    setSharedReview(null)
    setProjects([])
    setWorkspaces([])
    setSelectedWorkspaceId('')
    setTeamDetails(null)
    setAdminStats(null)
    setAdminAnalytics(null)
    setAdminUsers([])
    setAdminFilters(initialAdminFilters)
    setSelectedAdminUser(null)
    setSelectedUserReviews([])
    setBilling(null)
    setDeveloperResources({ apiKeys: [], webhooks: [], limits: { apiKeys: 0, webhooks: 0 } })
    setCompliance({ privacy: null, auditLogs: [] })
    setNewApiKey('')
    setNewWebhookSecret('')
    setReview('')
    setResult(emptyResult)
    setReviewLoadingSource('')
    setError('')
    setNotice('')
    setPublicView('landing', { replace: true })
    setActivePage('dashboard', { replace: true })
  }, [setActivePage, setPublicView])

  const signOut = useCallback(() => {
    window.localStorage.removeItem(TOKEN_KEY)
    window.localStorage.removeItem(LEGACY_TOKEN_KEY)
    setToken('')
    resetSessionState()
  }, [resetSessionState])

  const loadAdminData = useCallback(async (filters = adminFilters) => {
    const params = {
      search: filters.search || undefined,
      role: filters.role === 'all' ? undefined : filters.role,
      status: filters.status === 'all' ? undefined : filters.status,
      sort: filters.sort,
    }
    const [statsResponse, analyticsResponse, usersResponse] = await Promise.all([
      api.get('/admin/stats'),
      api.get('/admin/analytics'),
      api.get('/admin/users', { params }),
    ])
    setAdminStats(statsResponse.data.stats)
    setAdminAnalytics(analyticsResponse.data.analytics)
    setAdminUsers(usersResponse.data.users)
  }, [api, adminFilters])

  const loadReviews = useCallback(async (filters = initialHistoryFilters) => {
    const response = await api.get('/reviews', {
      params: {
        search: filters.search || undefined,
        model: filters.model || undefined,
        projectId: filters.projectId || undefined,
        severity: filters.severity || undefined,
        dateFrom: filters.dateFrom || undefined,
        dateTo: filters.dateTo || undefined,
        favorite: filters.favorite ? 'true' : undefined,
      }
    })
    setReviews(response.data.reviews)
    return response.data.reviews
  }, [api])

  const loadBusinessData = useCallback(async () => {
    const [billingResponse, developerResponse, complianceResponse] = await Promise.all([
      api.get('/billing'),
      api.get('/developer'),
      api.get('/compliance'),
    ])
    setBilling(billingResponse.data.billing)
    setDeveloperResources(developerResponse.data)
    setCompliance(complianceResponse.data)
  }, [api])

  const loadAppData = useCallback(async () => {
    try {
      const [profileResponse, modelsResponse, projectsResponse] = await Promise.all([
        api.get('/auth/me'),
        api.get('/ai/models'),
        api.get('/projects'),
      ])
      setUser(profileResponse.data.user)
      setUsage(profileResponse.data.usage)
      setProjects(projectsResponse.data.projects)
      await loadReviews()
      setWorkspaces(profileResponse.data.workspaces || [])
      setSelectedWorkspaceId(current => current || String(profileResponse.data.workspaces?.[0]?.id || ''))
      setProfileForm({
        name: profileResponse.data.user.name || '',
        bio: profileResponse.data.user.bio || '',
        avatarUrl: profileResponse.data.user.avatarUrl || ''
      })
      setModels(modelsResponse.data.models)
      await loadBusinessData()
      setAdminStats(null)
      setAdminAnalytics(null)
      setAdminUsers([])
      setSelectedAdminUser(null)
      setSelectedUserReviews([])

      if (modelsResponse.data.models[0]?.id) {
        setModel(current => modelsResponse.data.models.some(item => item.id === current) ? current : modelsResponse.data.models[0].id)
      }

      if (profileResponse.data.user.role === 'admin') {
        await loadAdminData()
        const routePage = getPageFromPath(window.location.pathname, 'admin')
        setActivePage(routePage || 'admin', { replace: true })
      } else {
        const routePage = getPageFromPath(window.location.pathname, 'user')
        setActivePage(routePage || 'dashboard', { replace: true })
      }
    } catch {
      signOut()
    }
  }, [api, loadAdminData, loadBusinessData, loadReviews, setActivePage, signOut])

  const verifyEmailToken = useCallback(async (verificationToken) => {
    try {
      const response = await api.post('/auth/verify-email', { token: verificationToken })
      if (user) setUser(response.data.user)
      setNotice('Email verified.')
      setSecurityForm(current => ({ ...current, verifyToken: '' }))
      if (token) await loadAppData()
      if (!token) setPublicView('login')
    } catch (error) {
      setError(error.response?.data?.error || 'Unable to verify email.')
      setSecurityForm(current => ({ ...current, verifyToken: '' }))
    }
  }, [api, loadAppData, setPublicView, token, user])

  useEffect(() => {
    if (!token) return
    loadAppData()
  }, [token, loadAppData])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const oauthToken = params.get('oauthToken')
    const oauthError = params.get('oauthError')
    const resetToken = params.get('resetToken')
    const verifyToken = params.get('verifyToken')
    const inviteToken = params.get('inviteToken')
    const shareToken = params.get('share')

    if (!oauthToken && !oauthError && !resetToken && !verifyToken && !inviteToken && !shareToken) return

    if (oauthToken) {
      window.localStorage.setItem(TOKEN_KEY, oauthToken)
      window.localStorage.removeItem(LEGACY_TOKEN_KEY)
      setToken(oauthToken)
      setNotice('Signed in with Google.')
    }

    if (oauthError) setError(oauthError)
    if (resetToken) {
      setSecurityForm(current => ({ ...current, resetToken }))
      setPublicView('reset')
    }
    if (verifyToken) verifyEmailToken(verifyToken)
    if (inviteToken) {
      setPendingInviteToken(inviteToken)
      if (!token) setPublicView('login')
    }
    if (shareToken) {
      api.get(`/reviews/shared/${shareToken}`)
        .then(response => {
          setSharedReview(response.data.review)
          setPublicView('shared')
        })
        .catch(() => setError('Shared report was not found.'))
    }

    window.history.replaceState({}, document.title, window.location.pathname)
  }, [api, setPublicView, token, verifyEmailToken])

  async function handleAuth(event) {
    event.preventDefault()
    setError('')
    setNotice('')
    setIsLoading(true)

    try {
      const endpoint = publicView === 'login' ? '/auth/login' : '/auth/register'
      const payload = publicView === 'login'
        ? { email: authForm.email, password: authForm.password }
        : authForm
      const response = await api.post(endpoint, payload)

      resetSessionState()
      window.localStorage.setItem(TOKEN_KEY, response.data.token)
      window.localStorage.removeItem(LEGACY_TOKEN_KEY)
      setToken(response.data.token)
      setUser(response.data.user)
      setActivePage(response.data.user.role === 'admin' ? 'admin' : 'dashboard')
      if (!response.data.user.emailVerified && response.data.verificationSent) {
        setNotice('Account created. Check your email to verify your address.')
      } else if (!response.data.user.emailVerified) {
        setNotice('Account created. You can send a verification email from Settings.')
      }
    } catch (error) {
      setError(error.response?.data?.error || 'Authentication failed.')
    } finally {
      setIsLoading(false)
    }
  }

  async function createProject() {
    if (!newProjectName.trim()) {
      setError('Project name is required.')
      return
    }

    const response = await api.post('/projects', { name: newProjectName.trim() })
    setProjects(current => [response.data.project, ...current])
    setSelectedProjectId(String(response.data.project.id))
    setNewProjectName('')
    setNotice('Project created.')
  }

  async function reviewCode() {
    const sourceAtStart = sourceMode
    setIsLoading(true)
    setReviewLoadingSource(sourceAtStart)
    setError('')
    setNotice('')

    try {
      const payload = {
        sourceType: sourceAtStart,
        depth,
        model,
        projectId: selectedProjectId || null,
        aiOptions,
      }

      if (sourceAtStart === 'paste') {
        payload.code = code
      }

      if (sourceAtStart === 'multi_file') {
        payload.files = files
      }

      if (sourceAtStart === 'github_repo') {
        payload.githubUrl = githubRepoUrl
      }

      if (sourceAtStart === 'pull_request') {
        payload.githubUrl = pullRequestUrl
      }

      if (sourceAtStart === 'compare_versions') {
        payload.beforeCode = beforeCode
        payload.afterCode = afterCode
      }

      const responseData = aiOptions.streamResponse
        ? await streamReviewRequest(payload, sourceAtStart)
        : (await api.post('/ai/get-review', payload)).data

      const result = hydrateReviewResult(responseData.result, responseData.review, responseData.savedReview?.files || [])
      setUsage(responseData.usage)
      if (responseData.savedReview?.id) {
        setReviews(current => [responseData.savedReview, ...current.filter(item => item.id !== responseData.savedReview.id)])
      }

      if (sourceModeRef.current === sourceAtStart) {
        setReview(result.markdown || responseData.review)
        setResult(result)
        setResultView('report')
      }

      setNotice(sourceModeRef.current === sourceAtStart
        ? responseData.fallbackUsed
          ? `Review completed with ${responseData.model} because the selected model was busy.`
          : responseData.savedReview?.id ? 'Review completed and saved.' : 'Review completed. History saving is disabled.'
        : responseData.savedReview?.id ? 'Review completed and saved to History.' : 'Review completed. History saving is disabled.')
    } catch (error) {
      setError(error.response?.data?.error || error.message || 'Unable to generate a review.')
      if (error.response?.data?.usage) {
        setUsage(error.response.data.usage)
      }
    } finally {
      setIsLoading(false)
      setReviewLoadingSource('')
    }
  }

  async function streamReviewRequest(payload, sourceAtStart) {
    const response = await fetch(`${API_URL}/ai/get-review-stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    })

    if (!response.ok || !response.body) {
      throw new Error('Streaming request failed.')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let streamedText = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.trim()) continue
        const event = JSON.parse(line)
        if (event.type === 'chunk') {
          streamedText += event.text
          if (sourceModeRef.current === sourceAtStart) {
            setReview(streamedText)
            setResultView('report')
          }
        }
        if (event.type === 'status') {
          setNotice(event.text)
        }
        if (event.type === 'error') {
          throw new Error(event.error)
        }
        if (event.type === 'done') {
          return event.data
        }
      }
    }

    throw new Error('Streaming response ended before the review was saved.')
  }

  async function updateLimit(userId, monthlyLimit) {
    try {
      setError('')
      setNotice('')
      await api.patch(`/admin/users/${userId}/limit`, { monthlyLimit })
      await loadAdminData()
      setNotice('User limit updated.')
    } catch (error) {
      setError(error.response?.data?.error || 'Unable to update user limit.')
    }
  }

  async function updateAdminFilters(nextFilters) {
    setAdminFilters(nextFilters)
    await loadAdminData(nextFilters)
  }

  async function updateUserStatus(userId, status) {
    try {
      setError('')
      setNotice('')
      await api.patch(`/admin/users/${userId}/status`, { status })
      await loadAdminData()
      setNotice(status === 'active' ? 'User activated.' : 'User suspended.')
    } catch (error) {
      setError(error.response?.data?.error || 'Unable to update user status.')
    }
  }

  async function viewUserHistory(account) {
    try {
      setError('')
      setSelectedAdminUser(account)
      const response = await api.get(`/admin/users/${account.id}/reviews`)
      setSelectedUserReviews(response.data.reviews)
    } catch (error) {
      setError(error.response?.data?.error || 'Unable to load review history.')
    }
  }

  async function selectFreePlan() {
    try {
      setError('')
      const response = await api.post('/billing/free')
      setBilling(response.data.billing)
      setUsage(current => ({ ...current, limit: response.data.billing.subscription.includedReviews, remaining: Math.max(response.data.billing.subscription.includedReviews - current.used, 0) }))
      setNotice('Free plan selected.')
    } catch (error) {
      setError(error.response?.data?.error || 'Unable to select plan.')
    }
  }

  async function startRazorpayCheckout(plan) {
    try {
      setError('')
      setNotice('')
      await loadRazorpayCheckout()
      const response = await api.post('/billing/checkout', { plan })
      const checkout = response.data.checkout

      const razorpay = new window.Razorpay({
        key: checkout.keyId || RAZORPAY_KEY_ID,
        order_id: checkout.orderId,
        amount: checkout.amount,
        currency: checkout.currency || 'INR',
        name: APP_NAME,
        description: `${checkout.plan.name} plan`,
        prefill: {
          name: user.name,
          email: user.email
        },
        theme: {
          color: '#2563eb'
        },
        handler: async payment => {
          const verifyResponse = await api.post('/billing/verify', {
            plan,
            razorpay_payment_id: payment.razorpay_payment_id,
            razorpay_order_id: payment.razorpay_order_id,
            razorpay_signature: payment.razorpay_signature,
          })
          setBilling(verifyResponse.data.billing)
          setUsage(current => ({
            ...current,
            limit: verifyResponse.data.billing.subscription.includedReviews,
            remaining: Math.max(verifyResponse.data.billing.subscription.includedReviews - current.used, 0)
          }))
          setNotice(`${checkout.plan.name} plan activated.`)
        },
        modal: {
          ondismiss: () => setNotice('Checkout closed.')
        }
      })

      razorpay.open()
    } catch (error) {
      setError(error.response?.data?.error || error.message || 'Unable to start checkout.')
    }
  }

  async function createApiKey() {
    try {
      setError('')
      const response = await api.post('/developer/api-keys', { name: apiKeyForm.name })
      setNewApiKey(response.data.rawKey)
      setDeveloperResources(current => ({ ...current, apiKeys: [response.data.apiKey, ...current.apiKeys] }))
      setNotice('API key created.')
    } catch (error) {
      setError(error.response?.data?.error || 'Unable to create API key.')
    }
  }

  async function revokeApiKey(keyId) {
    try {
      const response = await api.delete(`/developer/api-keys/${keyId}`)
      setDeveloperResources(current => ({
        ...current,
        apiKeys: current.apiKeys.map(key => key.id === response.data.apiKey.id ? response.data.apiKey : key)
      }))
      setNotice('API key revoked.')
    } catch (error) {
      setError(error.response?.data?.error || 'Unable to revoke API key.')
    }
  }

  async function createWebhookEndpoint() {
    try {
      setError('')
      const response = await api.post('/developer/webhooks', webhookForm)
      setNewWebhookSecret(response.data.signingSecret)
      setWebhookForm(current => ({ ...current, url: '' }))
      setDeveloperResources(current => ({ ...current, webhooks: [response.data.webhook, ...current.webhooks] }))
      setNotice('Webhook endpoint created.')
    } catch (error) {
      setError(error.response?.data?.error || 'Unable to create webhook.')
    }
  }

  async function deleteWebhookEndpoint(webhookId) {
    try {
      const response = await api.delete(`/developer/webhooks/${webhookId}`)
      setDeveloperResources(current => ({
        ...current,
        webhooks: current.webhooks.map(webhook => webhook.id === response.data.webhook.id ? response.data.webhook : webhook)
      }))
      setNotice('Webhook disabled.')
    } catch (error) {
      setError(error.response?.data?.error || 'Unable to disable webhook.')
    }
  }

  async function updatePrivacySettings(settings) {
    try {
      const response = await api.patch('/compliance/privacy', settings)
      setCompliance(current => ({ ...current, privacy: response.data.privacy }))
      setNotice('Privacy controls updated.')
    } catch (error) {
      setError(error.response?.data?.error || 'Unable to update privacy controls.')
    }
  }

  async function applyDataRetention() {
    try {
      const response = await api.post('/compliance/retention/apply')
      await loadReviews(historyFilters)
      await loadBusinessData()
      setNotice(`${response.data.deleted || 0} old review record(s) retired.`)
    } catch (error) {
      setError(error.response?.data?.error || 'Unable to apply retention policy.')
    }
  }

  async function exportAdminReport(format) {
    try {
      setError('')
      setNotice('')
      const response = await api.get('/admin/export', {
        params: { format },
        responseType: 'blob',
      })
      const file = new Blob([response.data], { type: format === 'csv' ? 'text/csv' : 'application/json' })
      const url = URL.createObjectURL(file)
      const link = document.createElement('a')
      link.href = url
      link.download = `ai-powered-code-reveiwer-admin-report.${format}`
      link.click()
      URL.revokeObjectURL(url)
      setNotice('Admin report exported.')
    } catch (error) {
      setError(error.response?.data?.error || 'Unable to export admin report.')
    }
  }

  const loadWorkspaceDetails = useCallback(async (workspaceId = selectedWorkspaceId) => {
    if (!workspaceId) return
    const response = await api.get(`/teams/workspaces/${workspaceId}`)
    setTeamDetails(response.data)
    setSelectedWorkspaceId(String(workspaceId))
  }, [api, selectedWorkspaceId])

  async function createWorkspace() {
    try {
      setError('')
      const response = await api.post('/teams/workspaces', { name: workspaceForm.name.trim() })
      setWorkspaces(current => [...current, response.data.workspace])
      setSelectedWorkspaceId(String(response.data.workspace.id))
      setWorkspaceForm(current => ({ ...current, name: '' }))
      setNotice('Workspace created.')
      await loadWorkspaceDetails(response.data.workspace.id)
    } catch (error) {
      setError(error.response?.data?.error || 'Unable to create workspace.')
    }
  }

  async function inviteTeamMember() {
    try {
      setError('')
      const response = await api.post(`/teams/workspaces/${selectedWorkspaceId}/invitations`, {
        email: workspaceForm.inviteEmail,
        role: workspaceForm.inviteRole
      })
      setWorkspaceForm(current => ({ ...current, inviteEmail: '' }))
      setNotice(response.data.message || 'Invitation email sent.')
      await loadWorkspaceDetails(selectedWorkspaceId)
    } catch (error) {
      setError(error.response?.data?.error || 'Unable to invite member.')
    }
  }

  const acceptInvitationToken = useCallback(async (invitationToken = workspaceForm.inviteToken) => {
    try {
      setError('')
      await api.post('/teams/invitations/accept', { token: invitationToken })
      setWorkspaceForm(current => ({ ...current, inviteToken: '' }))
      setPendingInviteToken('')
      setNotice('Invitation accepted.')
      await loadAppData()
    } catch (error) {
      setError(error.response?.data?.error || 'Unable to accept invitation.')
    }
  }, [api, loadAppData, workspaceForm.inviteToken])

  useEffect(() => {
    if (!user || !pendingInviteToken) return
    acceptInvitationToken(pendingInviteToken)
  }, [user, pendingInviteToken, acceptInvitationToken])

  async function updateTeamRole(memberId, role) {
    try {
      setError('')
      await api.patch(`/teams/workspaces/${selectedWorkspaceId}/members/${memberId}/role`, { role })
      setNotice('Team role updated.')
      await loadWorkspaceDetails(selectedWorkspaceId)
    } catch (error) {
      setError(error.response?.data?.error || 'Unable to update team role.')
    }
  }

  async function saveProfile() {
    try {
      const response = await api.patch('/auth/me', profileForm)
      setUser(response.data.user)
      setNotice('Profile updated.')
    } catch (error) {
      setError(error.response?.data?.error || 'Unable to update profile.')
    }
  }

  async function savePassword() {
    try {
      await api.patch('/auth/password', {
        currentPassword: securityForm.currentPassword,
        newPassword: securityForm.newPassword
      })
      setSecurityForm(current => ({ ...current, currentPassword: '', newPassword: '' }))
      setNotice('Password updated.')
    } catch (error) {
      setError(error.response?.data?.error || 'Unable to update password.')
    }
  }

  async function requestPasswordReset() {
    try {
      await api.post('/auth/forgot-password', { email: securityForm.resetEmail })
      setNotice('If an account exists, a password reset email has been sent.')
      setPublicView('login')
    } catch (error) {
      setError(error.response?.data?.error || 'Unable to send reset email.')
    }
  }

  async function resetPassword() {
    try {
      await api.post('/auth/reset-password', {
        token: securityForm.resetToken,
        password: securityForm.resetPassword
      })
      setNotice('Password reset complete.')
      setSecurityForm(current => ({ ...current, resetPassword: '', resetToken: '' }))
      setPublicView('login')
    } catch (error) {
      setError(error.response?.data?.error || 'Unable to reset password.')
    }
  }

  async function requestEmailVerification() {
    try {
      const response = await api.post('/auth/email-verification')
      setNotice(response.data.message || 'Verification email sent.')
      if (response.data.alreadyVerified) {
        await loadAppData()
      }
    } catch (error) {
      setError(error.response?.data?.error || 'Unable to send verification email.')
    }
  }

  async function verifyEmail() {
    await verifyEmailToken(securityForm.verifyToken)
  }

  async function copyReview() {
    if (!review) return
    await navigator.clipboard.writeText(review)
    setNotice('Review copied.')
  }

  function downloadReview() {
    if (!review) return

    const file = new Blob([review], { type: 'text/markdown' })
    const url = URL.createObjectURL(file)
    const link = document.createElement('a')
    link.href = url
    link.download = `code-review-${Date.now()}.md`
    link.click()
    URL.revokeObjectURL(url)
  }

  async function updateHistoryFilters(nextFilters) {
    setHistoryFilters(nextFilters)
    await loadReviews(nextFilters)
  }

  function replaceReviewInState(updatedReview) {
    setReviews(current => current.map(item => item.id === updatedReview.id ? updatedReview : item))
  }

  async function toggleReviewFavorite(item) {
    try {
      const response = await api.patch(`/reviews/${item.id}/favorite`, { isFavorite: !item.isFavorite })
      replaceReviewInState(response.data.review)
      setNotice(response.data.review.isFavorite ? 'Review pinned.' : 'Review unpinned.')
    } catch (error) {
      setError(error.response?.data?.error || 'Unable to update pinned review.')
    }
  }

  async function saveReviewNotes(item, notes) {
    try {
      const response = await api.patch(`/reviews/${item.id}/notes`, { notes })
      replaceReviewInState(response.data.review)
      setNotice('Review notes saved.')
    } catch (error) {
      setError(error.response?.data?.error || 'Unable to save notes.')
    }
  }

  async function deleteReviewRecord(item) {
    const confirmed = window.confirm('Delete this review record? This removes it from your history.')
    if (!confirmed) return

    try {
      await api.delete(`/reviews/${item.id}`)
      setReviews(current => current.filter(reviewItem => reviewItem.id !== item.id))
      setNotice('Review deleted.')
    } catch (error) {
      setError(error.response?.data?.error || 'Unable to delete review.')
    }
  }

  async function shareReviewReport(item) {
    try {
      const response = await api.post(`/reviews/${item.id}/share`)
      await navigator.clipboard.writeText(response.data.shareUrl)
      replaceReviewInState(response.data.review)
      setNotice('Share link copied.')
    } catch (error) {
      setError(error.response?.data?.error || 'Unable to create share link.')
    }
  }

  async function exportReviewMarkdown(item) {
    try {
      const response = await api.get(`/reviews/${item.id}/export.md`, { responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([response.data], { type: 'text/markdown' }))
      const link = document.createElement('a')
      link.href = url
      link.download = `review-${item.id}.md`
      link.click()
      URL.revokeObjectURL(url)
      setNotice('Markdown report exported.')
    } catch (error) {
      setError(error.response?.data?.error || 'Unable to export Markdown.')
    }
  }

  function exportReviewPdf(item) {
    const popup = window.open('', '_blank', 'width=900,height=720')
    if (!popup) {
      setError('Popup blocked. Allow popups to export PDF.')
      return
    }

    popup.document.write(`
      <html>
        <head>
          <title>Review ${item.id}</title>
          <style>
            body { font-family: Arial, sans-serif; color: #172033; padding: 32px; line-height: 1.55; }
            h1 { margin: 0 0 8px; }
            .meta { color: #596579; margin-bottom: 24px; }
            pre { white-space: pre-wrap; background: #f3f6fb; border: 1px solid #dbe3ee; padding: 16px; border-radius: 8px; }
          </style>
        </head>
        <body>
          <h1>${escapeHtml(item.projectName || 'Code Review Report')}</h1>
          <div class="meta">Score ${item.score || 0}/100 - ${escapeHtml(item.model)} - ${escapeHtml(item.depth)} - ${escapeHtml(formatDate(item.createdAt))}</div>
          ${item.notes ? `<h2>Notes</h2><p>${escapeHtml(item.notes)}</p>` : ''}
          <h2>Report</h2>
          <pre>${escapeHtml(item.review)}</pre>
        </body>
      </html>
    `)
    popup.document.close()
    popup.focus()
    popup.print()
    setNotice('PDF export opened.')
  }

  function restoreReviewedCode(item) {
    loadReview(item)
    setNotice('Reviewed code restored to editor.')
  }

  function loadReview(item) {
    const result = hydrateReviewResult({
      summary: '',
      score: item.score || 0,
      severityCounts: countSeverities(item.comments || []),
      checklist: item.checklist || [],
      comments: item.comments || [],
      fixedCode: item.fixedCode || '',
      detectedLanguages: item.aiOptions?.detectedLanguages || item.files?.map(file => file.language).filter(Boolean) || [],
      codeSmells: item.aiOptions?.codeSmells || [],
      securityVulnerabilities: item.aiOptions?.securityVulnerabilities || [],
      generatedTests: item.aiOptions?.generatedTests || [],
      generatedDocumentation: item.aiOptions?.generatedDocumentation || [],
      comparison: item.aiOptions?.comparison || emptyResult.comparison
    }, item.review, item.files || [])
    setCode(item.code)
    setFiles(item.files?.length ? item.files : [{ path: 'reviewed-code.js', content: item.code }])
    setReview(result.markdown || item.review)
    setResult(result)
    setDepth(item.depth)
    setModel(item.model)
    setSourceMode(item.sourceType || 'paste')
    if (item.sourceType === 'github_repo') {
      setGithubRepoUrl(item.sourceUrl || '')
    }
    if (item.sourceType === 'pull_request') {
      setPullRequestUrl(item.sourceUrl || '')
    }
    if (item.sourceType === 'compare_versions') {
      const beforeFile = item.files?.find(file => file.status === 'before') || item.files?.[0]
      const afterFile = item.files?.find(file => file.status === 'after') || item.files?.[1]
      setBeforeCode(beforeFile?.content || '')
      setAfterCode(afterFile?.content || '')
    }
    setSelectedProjectId(item.projectId ? String(item.projectId) : '')
    setError('')
    setNotice('')
    setResultView('report')
    setActivePage('review')
  }

  function updateFile(index, changes) {
    setFiles(current => current.map((file, fileIndex) => fileIndex === index ? { ...file, ...changes } : file))
  }

  function addFile() {
    setFiles(current => [...current, { path: `src/file-${current.length + 1}.js`, content: '' }])
    setNotice('File added.')
  }

  function removeFile(index) {
    setFiles(current => current.filter((_, fileIndex) => fileIndex !== index))
    setNotice('File removed.')
  }

  async function handleFilesSelected(fileList) {
    const selectedFiles = Array.from(fileList || [])
      .filter(file => file.type.startsWith('text/') || reviewableFilePattern.test(file.name))
      .slice(0, 20)

    if (!selectedFiles.length) {
      setError('Choose text or source code files to import.')
      return
    }

    try {
      const importedFiles = await Promise.all(selectedFiles.map(async file => ({
        path: file.webkitRelativePath || file.name,
        content: await file.text(),
      })))

      if (sourceMode === 'compare_versions') {
        setBeforeCode(importedFiles[0]?.content || '')
        setAfterCode(importedFiles[1]?.content || importedFiles[0]?.content || '')
      } else if (sourceMode === 'multi_file' || importedFiles.length > 1) {
        setFiles(importedFiles)
        setSourceMode('multi_file')
      } else {
        setCode(importedFiles[0].content)
        setSourceMode('paste')
      }

      setReview('')
      setResult(emptyResult)
      setResultView('report')
      setError('')
      setNotice(importedFiles.length === 1 ? 'File imported.' : `${importedFiles.length} files imported.`)
    } catch {
      setError('Unable to read the selected files.')
    }
  }

  function saveDraftNow() {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify({
      sourceMode,
      code,
      files,
      githubRepoUrl,
      pullRequestUrl,
      beforeCode,
      afterCode,
    }))
    setNotice('Draft saved.')
  }

  function changeSourceMode(mode) {
    setSourceMode(mode)
    setReview('')
    setResult(emptyResult)
    setResultView('report')
    setError('')
    setNotice('')
  }

  function clearCurrentSource() {
    if (sourceMode === 'paste') {
      setCode('')
    } else if (sourceMode === 'github_repo') {
      setGithubRepoUrl('')
    } else if (sourceMode === 'pull_request') {
      setPullRequestUrl('')
    } else if (sourceMode === 'compare_versions') {
      setBeforeCode('')
      setAfterCode('')
    } else {
      setFiles([{ path: 'src/app.js', content: '' }])
    }

    setReview('')
    setResult(emptyResult)
    setResultView('report')
  }

  reviewCodeRef.current = reviewCode
  saveDraftRef.current = saveDraftNow

  if (publicView === 'shared') {
    return (
      <>
        <FlashMessage notice={notice} error={error} />
        <PublicExperience publicView={publicView} setPublicView={setPublicView} sharedReview={sharedReview} theme={theme} setTheme={setTheme} />
      </>
    )
  }

  if (!token || !user) {
    return (
      <>
        <FlashMessage notice={notice} error={error} />
        <PublicExperience
          publicView={publicView}
          setPublicView={setPublicView}
          authForm={authForm}
          setAuthForm={setAuthForm}
          handleAuth={handleAuth}
          securityForm={securityForm}
          setSecurityForm={setSecurityForm}
          requestPasswordReset={requestPasswordReset}
          resetPassword={resetPassword}
          verifyEmail={verifyEmail}
          sharedReview={sharedReview}
          isLoading={isLoading}
          error={error}
          theme={theme}
          setTheme={setTheme}
        />
      </>
    )
  }

  const pages = {
    dashboard: (
      <DashboardPage
        user={user}
        usage={usage}
        reviews={reviews}
        projects={projects}
        setActivePage={setActivePage}
        loadReview={loadReview}
      />
    ),
    review: (
      <ReviewPage
        code={code}
        setCode={setCode}
        files={files}
        updateFile={updateFile}
        addFile={addFile}
        removeFile={removeFile}
        githubRepoUrl={githubRepoUrl}
        setGithubRepoUrl={setGithubRepoUrl}
        pullRequestUrl={pullRequestUrl}
        setPullRequestUrl={setPullRequestUrl}
        beforeCode={beforeCode}
        setBeforeCode={setBeforeCode}
        afterCode={afterCode}
        setAfterCode={setAfterCode}
        sourceMode={sourceMode}
        setSourceMode={changeSourceMode}
        projects={projects}
        selectedProjectId={selectedProjectId}
        setSelectedProjectId={setSelectedProjectId}
        newProjectName={newProjectName}
        setNewProjectName={setNewProjectName}
        createProject={createProject}
        review={review}
        result={result}
        resultView={resultView}
        setResultView={setResultView}
        error={error}
        notice={notice}
        isLoading={isLoading && reviewLoadingSource === sourceMode}
        isReviewBusy={isLoading}
        depth={depth}
        setDepth={setDepth}
        model={model}
        setModel={setModel}
        models={models}
        editorWidth={editorWidth}
        setEditorWidth={setEditorWidth}
        isEditorFullscreen={isEditorFullscreen}
        setIsEditorFullscreen={setIsEditorFullscreen}
        handleFilesSelected={handleFilesSelected}
        editorFocusRef={editorFocusRef}
        saveDraftNow={saveDraftNow}
        aiOptions={aiOptions}
        setAiOptions={setAiOptions}
        usage={usage}
        reviewCode={reviewCode}
        clearCurrentSource={clearCurrentSource}
        copyReview={copyReview}
        downloadReview={downloadReview}
      />
    ),
    history: (
      <HistoryPage
        reviews={reviews}
        projects={projects}
        models={models}
        filters={historyFilters}
        setFilters={updateHistoryFilters}
        loadReview={loadReview}
        toggleReviewFavorite={toggleReviewFavorite}
        saveReviewNotes={saveReviewNotes}
        deleteReviewRecord={deleteReviewRecord}
        shareReviewReport={shareReviewReport}
        exportReviewMarkdown={exportReviewMarkdown}
        exportReviewPdf={exportReviewPdf}
        restoreReviewedCode={restoreReviewedCode}
      />
    ),
    team: (
      <TeamPage
        workspaces={workspaces}
        selectedWorkspaceId={selectedWorkspaceId}
        setSelectedWorkspaceId={setSelectedWorkspaceId}
        teamDetails={teamDetails}
        loadWorkspaceDetails={loadWorkspaceDetails}
        workspaceForm={workspaceForm}
        setWorkspaceForm={setWorkspaceForm}
        createWorkspace={createWorkspace}
        inviteTeamMember={inviteTeamMember}
        acceptInvitation={acceptInvitationToken}
        updateTeamRole={updateTeamRole}
      />
    ),
    profile: <ProfilePage user={user} usage={usage} reviews={reviews} profileForm={profileForm} setProfileForm={setProfileForm} saveProfile={saveProfile} />,
    billing: (
      <BillingPage
        billing={billing}
        selectFreePlan={selectFreePlan}
        startRazorpayCheckout={startRazorpayCheckout}
      />
    ),
    developer: (
      <DeveloperPage
        resources={developerResources}
        apiKeyForm={apiKeyForm}
        setApiKeyForm={setApiKeyForm}
        newApiKey={newApiKey}
        setNewApiKey={setNewApiKey}
        createApiKey={createApiKey}
        revokeApiKey={revokeApiKey}
        webhookForm={webhookForm}
        setWebhookForm={setWebhookForm}
        newWebhookSecret={newWebhookSecret}
        setNewWebhookSecret={setNewWebhookSecret}
        createWebhookEndpoint={createWebhookEndpoint}
        deleteWebhookEndpoint={deleteWebhookEndpoint}
      />
    ),
    compliance: (
      <CompliancePage
        compliance={compliance}
        updatePrivacySettings={updatePrivacySettings}
        applyDataRetention={applyDataRetention}
      />
    ),
    admin: (
      <AdminPage
        stats={adminStats}
        analytics={adminAnalytics}
        users={adminUsers}
        filters={adminFilters}
        setFilters={updateAdminFilters}
        updateLimit={updateLimit}
        updateUserStatus={updateUserStatus}
        selectedUser={selectedAdminUser}
        selectedReviews={selectedUserReviews}
        viewUserHistory={viewUserHistory}
        exportAdminReport={exportAdminReport}
      />
    ),
    settings: (
      <SettingsPage
        theme={theme}
        setTheme={setTheme}
        user={user}
        usage={usage}
        signOut={signOut}
        securityForm={securityForm}
        setSecurityForm={setSecurityForm}
        savePassword={savePassword}
        requestEmailVerification={requestEmailVerification}
      />
    ),
  }

  return (
    <main className="app-shell">
      <FlashMessage notice={notice} error={error} />
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">AI</div>
          <div>
            <strong>{APP_NAME}</strong>
            <span>Code review workspace</span>
          </div>
        </div>

        <nav className="nav-list">
          {(user.role === 'admin'
            ? [['admin', 'Admin Dashboard'], ['review', 'Review'], ['history', 'History'], ['team', 'Team'], ['billing', 'Billing'], ['developer', 'Developer'], ['compliance', 'Compliance'], ['profile', 'Profile'], ['settings', 'Settings']]
            : [['dashboard', 'Dashboard'], ['review', 'Review'], ['history', 'History'], ['team', 'Team'], ['billing', 'Billing'], ['developer', 'Developer'], ['compliance', 'Compliance'], ['profile', 'Profile'], ['settings', 'Settings']]
          ).map(([page, label]) => (
            <button key={page} type="button" className={activePage === page ? 'nav-item active' : 'nav-item'} onClick={() => setActivePage(page)}>
              {label}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div>
            <strong>{user.name}</strong>
            <span>{user.role}</span>
          </div>
          <button type="button" className="ghost-button" onClick={signOut}>Sign Out</button>
        </div>
      </aside>

      <section className="content-shell">{pages[activePage]}</section>
    </main>
  )
}

function PublicExperience(props) {
  if (props.publicView === 'shared') {
    return <SharedReportPage review={props.sharedReview} setPublicView={props.setPublicView} />
  }

  if (props.publicView === 'login' || props.publicView === 'register') {
    return <AuthPage {...props} mode={props.publicView} />
  }

  if (props.publicView === 'forgot') {
    return <ForgotPasswordPage {...props} />
  }

  if (props.publicView === 'reset') {
    return <ResetPasswordPage {...props} />
  }

  if (props.publicView === 'verify') {
    return <VerifyEmailPage {...props} />
  }

  return <LandingPage setPublicView={props.setPublicView} theme={props.theme} setTheme={props.setTheme} />
}

function LandingPage({ setPublicView, theme, setTheme }) {
  return (
    <main className="marketing-shell">
      <header className="marketing-header">
        <div className="brand"><div className="brand-mark" aria-hidden="true">AI</div><div><strong>{APP_NAME}</strong><span>AI code quality platform</span></div></div>
        <nav className="marketing-nav"><a href="#features">Features</a><a href="#workflow">Workflow</a><a href="#security">Security</a></nav>
        <div className="marketing-actions">
          <ThemeToggle theme={theme} setTheme={setTheme} compact />
          <button type="button" className="ghost-button" onClick={() => setPublicView('login')}>Sign In</button>
          <button type="button" className="primary-button" onClick={() => setPublicView('register')}>Get Started</button>
        </div>
      </header>

      <section className="hero-section">
        <div className="hero-copy">
          <p className="eyebrow">Production-ready code reviews</p>
          <h1>AI code review for repositories, pull requests, and multi-file changes.</h1>
          <p>{APP_NAME} turns code into scored reports with inline findings, severity labels, suggested fixes, and project-based history.</p>
          <div className="hero-actions"><button type="button" className="primary-button" onClick={() => setPublicView('register')}>Start Reviewing</button><button type="button" className="ghost-button" onClick={() => setPublicView('login')}>Sign In</button></div>
        </div>
        <div className="hero-product" aria-label="Product preview">
          <div className="preview-toolbar"><span /><span /><span /></div>
          <div className="preview-grid">
            <div className="preview-code"><span>Score: 84/100</span><span>High: validate checkout totals</span><span>Medium: add integration tests</span></div>
            <div className="preview-report"><strong>Suggested Fix</strong><p>Normalize totals, guard edge cases, and add regression coverage before merging.</p><strong>Inline Comments</strong><p>src/checkout.js:12 - missing input validation.</p></div>
          </div>
        </div>
      </section>

      <section className="logo-strip" aria-label="Capabilities"><span>GitHub Reviews</span><span>Pull Requests</span><span>Inline Comments</span><span>Projects</span></section>

      <section id="features" className="marketing-section">
        <SectionTitle eyebrow="Platform" title="A complete code review workspace" />
        <div className="feature-grid">
          <Feature title="Repository Review" text="Import reviewable files from a public GitHub repository." />
          <Feature title="Pull Request Mode" text="Review PR patches and changed files before merging." />
          <Feature title="Inline Findings" text="See line-level comments with critical, high, medium, and low severity." />
          <Feature title="Before/After Diff" text="Compare submitted code with the AI-generated fixed version." />
          <Feature title="Quality Score" text="Every review includes a score and production checklist." />
          <Feature title="Project Workspaces" text="Group reviews by project and keep a searchable audit trail." />
        </div>
      </section>

      <section id="workflow" className="marketing-section">
        <SectionTitle eyebrow="Workflow" title="Review any source in one flow" />
        <div className="steps-grid">
          <Step number="01" title="Choose Source" text="Paste code, add multiple files, or enter a GitHub URL." />
          <Step number="02" title="Run Review" text="Pick depth and model, then generate a structured report." />
          <Step number="03" title="Act on Findings" text="Use inline comments, severity badges, checklist, and fixed code." />
        </div>
      </section>

      <section id="security" className="marketing-section final-cta">
        <SectionTitle eyebrow="Governance" title="Built for controlled AI usage" />
        <p>Authentication, admin limits, database history, and server-side AI calls keep the workspace organized and safer for teams.</p>
        <button type="button" className="primary-button" onClick={() => setPublicView('register')}>Create Account</button>
      </section>

      <footer className="marketing-footer"><span>{APP_NAME}</span><span>AI-powered code review for modern teams.</span></footer>
    </main>
  )
}

function SharedReportPage({ review, setPublicView }) {
  if (!review) {
    return (
      <main className="auth-shell">
        <section className="auth-panel">
          <button type="button" className="back-button" onClick={() => setPublicView('landing')}>Back</button>
          <EmptyState title="Loading shared report" text="The report will appear here when the share link is valid." />
        </section>
      </main>
    )
  }

  return (
    <main className="marketing-shell shared-report-shell">
      <header className="marketing-header">
        <div className="brand"><div className="brand-mark" aria-hidden="true">AI</div><div><strong>{APP_NAME}</strong><span>Shared review report</span></div></div>
        <div className="marketing-actions"><button type="button" className="ghost-button" onClick={() => setPublicView('login')}>Sign In</button></div>
      </header>
      <section className="shared-report">
        <PageTitle eyebrow="Shared Report" title={review.projectName || 'Code Review Report'} />
        <div className="result-summary"><div className="score-card"><strong>{review.score || '-'}</strong><span>Review score</span></div><SeverityBadge label="Critical" value={countSeverities(review.comments || []).critical} tone="critical" /><SeverityBadge label="High" value={countSeverities(review.comments || []).high} tone="high" /><SeverityBadge label="Medium" value={countSeverities(review.comments || []).medium} tone="medium" /><SeverityBadge label="Low" value={countSeverities(review.comments || []).low} tone="low" /></div>
        <section className="wide-panel"><Markdown rehypePlugins={[rehypeHighlight]}>{review.review}</Markdown></section>
      </section>
    </main>
  )
}

function AuthPage({ mode, setPublicView, authForm, setAuthForm, handleAuth, isLoading }) {
  const isLogin = mode === 'login'

  function continueWithGoogle() {
    window.location.href = `${API_URL}/auth/oauth/google/start`
  }

  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <button type="button" className="back-button" onClick={() => setPublicView('landing')}>Back</button>
        <div><p className="eyebrow">Account access</p><h1>{isLogin ? `Sign in to ${APP_NAME}` : `Create your ${APP_NAME} account`}</h1><p className="panel-copy">{isLogin ? 'Continue to your review workspace.' : 'Start saving AI code reviews to your workspace.'}</p></div>
        <div className="auth-oauth">
          <button type="button" className="ghost-button" onClick={continueWithGoogle}>Continue with Google</button>
          <button type="button" className="ghost-button" disabled>GitHub coming soon</button>
        </div>
        <div className="auth-divider"><span>or</span></div>
        <form className="auth-form" onSubmit={handleAuth}>
          {!isLogin && <label><span>Name</span><input value={authForm.name} onChange={event => setAuthForm({ ...authForm, name: event.target.value })} /></label>}
          <label><span>Email</span><input type="email" value={authForm.email} onChange={event => setAuthForm({ ...authForm, email: event.target.value })} /></label>
          <label><span>Password</span><input type="password" value={authForm.password} onChange={event => setAuthForm({ ...authForm, password: event.target.value })} /></label>
          <button type="submit" className="primary-button" disabled={isLoading}>{isLoading ? 'Please wait...' : isLogin ? 'Sign In' : 'Create Account'}</button>
        </form>
        {isLogin && <button type="button" className="text-button" onClick={() => setPublicView('forgot')}>Forgot password?</button>}
        <button type="button" className="text-button" onClick={() => setPublicView(isLogin ? 'register' : 'login')}>{isLogin ? 'Need an account? Create one' : 'Already have an account? Sign in'}</button>
      </section>
    </main>
  )
}

function ForgotPasswordPage({ setPublicView, securityForm, setSecurityForm, requestPasswordReset }) {
  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <button type="button" className="back-button" onClick={() => setPublicView('login')}>Back</button>
        <div><p className="eyebrow">Account recovery</p><h1>Reset your password</h1><p className="panel-copy">Enter your account email and we will send a secure reset link.</p></div>
        <div className="auth-form">
          <label><span>Email</span><input type="email" value={securityForm.resetEmail} onChange={event => setSecurityForm({ ...securityForm, resetEmail: event.target.value })} /></label>
          <button type="button" className="primary-button" onClick={requestPasswordReset}>Send Reset Link</button>
        </div>
      </section>
    </main>
  )
}

function ResetPasswordPage({ setPublicView, securityForm, setSecurityForm, resetPassword }) {
  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <button type="button" className="back-button" onClick={() => setPublicView('login')}>Back</button>
        <div><p className="eyebrow">Secure reset</p><h1>Choose a new password</h1><p className="panel-copy">Use a strong password with at least 8 characters.</p></div>
        <div className="auth-form">
          <label><span>New password</span><input type="password" value={securityForm.resetPassword} onChange={event => setSecurityForm({ ...securityForm, resetPassword: event.target.value })} /></label>
          <button type="button" className="primary-button" onClick={resetPassword}>Reset Password</button>
        </div>
      </section>
    </main>
  )
}

function VerifyEmailPage({ setPublicView, verifyEmail }) {
  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <button type="button" className="back-button" onClick={() => setPublicView('login')}>Back</button>
        <div><p className="eyebrow">Email verification</p><h1>Confirm your email</h1><p className="panel-copy">Click below to complete verification for this account.</p></div>
        <button type="button" className="primary-button" onClick={verifyEmail}>Verify Email</button>
      </section>
    </main>
  )
}

function DashboardPage({ user, usage, reviews, projects, setActivePage, loadReview }) {
  const latestReview = reviews[0]
  const usagePercent = usage.limit ? Math.min((usage.used / usage.limit) * 100, 100) : 0
  const averageScore = reviews.length ? Math.round(reviews.reduce((total, item) => total + (item.score || 0), 0) / reviews.length) : 0

  return (
    <div className="page-stack">
      <PageTitle eyebrow="Overview" title={`Good to see you, ${user.name}`}><button type="button" className="primary-button" onClick={() => setActivePage('review')}>New Review</button></PageTitle>
      <section className="metric-grid"><Metric label="Reviews this month" value={`${usage.used}/${usage.limit}`} /><Metric label="Projects" value={projects.length} /><Metric label="Average score" value={averageScore || '-'} /></section>
      <section className="wide-panel"><div className="section-heading"><div><h2>Usage</h2><p>Monthly review allowance for this account.</p></div><span className="pill">{Math.round(usagePercent)}% used</span></div><div className="usage-bar"><span style={{ width: `${usagePercent}%` }} /></div></section>
      <section className="wide-panel"><div className="section-heading"><div><h2>Latest Review</h2><p>Resume your most recent saved report.</p></div><button type="button" className="ghost-button" onClick={() => setActivePage('history')}>View History</button></div>{latestReview ? <HistoryRow item={latestReview} onClick={() => loadReview(latestReview)} /> : <EmptyState title="No reviews yet" text="Run your first review to start building history." />}</section>
    </div>
  )
}

function ReviewPage(props) {
  const selectedModel = props.models.find(item => item.id === props.model) || props.models[0]
  const fileInputRef = useRef(null)
  const workspaceStyle = props.isEditorFullscreen
    ? undefined
    : { '--editor-width': `${props.editorWidth}%` }

  function handleDrop(event) {
    event.preventDefault()
    props.handleFilesSelected(event.dataTransfer.files)
  }

  return (
    <div className={props.isEditorFullscreen ? 'review-page editor-fullscreen' : 'review-page'}>
      <PageTitle eyebrow="Reviewer" title="Analyze source code">
        <div className="toolbar">
          <label><span>Project</span><select value={props.selectedProjectId} onChange={event => props.setSelectedProjectId(event.target.value)}><option value="">No project</option>{props.projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
          <label><span>Model</span><select value={props.model} onChange={event => props.setModel(event.target.value)}>{props.models.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>
          <label><span>Depth</span><select value={props.depth} onChange={event => props.setDepth(event.target.value)}>{depthOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <button type="button" className="primary-button" onClick={props.reviewCode} disabled={props.isReviewBusy || props.usage.remaining <= 0}>{props.isLoading ? 'Reviewing...' : 'Run Review'}</button>
        </div>
      </PageTitle>

      <section className="project-create"><input placeholder="Create project workspace" value={props.newProjectName} onChange={event => props.setNewProjectName(event.target.value)} /><button type="button" className="ghost-button" onClick={props.createProject}>Create Project</button></section>
      <section className="model-note"><strong>{selectedModel?.name}</strong><span>{selectedModel?.description}</span></section>
      <AiOptionsPanel aiOptions={props.aiOptions} setAiOptions={props.setAiOptions} />
      <section className="developer-toolbar">
        <div className="editor-actions">
          <input ref={fileInputRef} className="hidden-file-input" type="file" multiple onChange={event => props.handleFilesSelected(event.target.files)} />
          <button type="button" className="ghost-button" onClick={() => fileInputRef.current?.click()}>Upload Files</button>
          <button type="button" className="ghost-button" onClick={props.saveDraftNow}>Save Draft</button>
          <button type="button" className="ghost-button" onClick={() => props.setIsEditorFullscreen(!props.isEditorFullscreen)}>{props.isEditorFullscreen ? 'Exit Full Screen' : 'Full Screen'}</button>
        </div>
        <label className="split-control"><span>Editor width</span><input type="range" min="35" max="65" value={props.editorWidth} onChange={event => props.setEditorWidth(Number(event.target.value))} /></label>
      </section>
      <section className="source-tabs">{sourceModes.map(mode => <button key={mode.id} type="button" className={props.sourceMode === mode.id ? 'active' : ''} onClick={() => props.setSourceMode(mode.id)}>{mode.label}</button>)}</section>

      <section className="workspace" style={workspaceStyle}>
        <div className="panel editor-panel" onDrop={handleDrop} onDragOver={event => event.preventDefault()}>
          <div className="panel-header">
            <div><p className="eyebrow">Input</p><h2>{sourceModes.find(mode => mode.id === props.sourceMode)?.label}</h2></div>
            <div className="result-actions">
              {props.isEditorFullscreen && <button type="button" className="primary-button" onClick={() => props.setIsEditorFullscreen(false)}>Exit Full Screen</button>}
              <button type="button" className="ghost-button" onClick={props.clearCurrentSource}>Clear</button>
            </div>
          </div>
          <SourceInput {...props} />
        </div>

        <div className="panel review-panel">
          <div className="panel-header"><div><p className="eyebrow">Output</p><h2>Review Results</h2></div><div className="result-actions"><button type="button" className="ghost-button" onClick={props.copyReview} disabled={!props.review}>Copy</button><button type="button" className="ghost-button" onClick={props.downloadReview} disabled={!props.review}>Download</button></div></div>
          <ReviewResults {...props} />
        </div>
      </section>
    </div>
  )
}

function AiOptionsPanel({ aiOptions, setAiOptions }) {
  function toggleFocus(area) {
    setAiOptions(current => ({
      ...current,
      focusAreas: current.focusAreas.includes(area)
        ? current.focusAreas.filter(item => item !== area)
        : [...current.focusAreas, area]
    }))
  }

  return (
    <section className="ai-options-panel">
      <div className="section-heading"><div><h2>AI review configuration</h2><p>Shape the review using focus areas, standards, templates, and generated assets.</p></div></div>
      <div className="ai-options-grid">
        <div className="option-block">
          <span>Review focus</span>
          <div className="chip-list">{focusOptions.map(option => <button key={option.id} type="button" className={aiOptions.focusAreas.includes(option.id) ? 'chip active' : 'chip'} onClick={() => toggleFocus(option.id)}>{option.label}</button>)}</div>
        </div>
        <label><span>Prompt template</span><select value={aiOptions.promptTemplate} onChange={event => setAiOptions({ ...aiOptions, promptTemplate: event.target.value })}>{promptTemplates.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
        <label><span>Explanation level</span><select value={aiOptions.explanationLevel} onChange={event => setAiOptions({ ...aiOptions, explanationLevel: event.target.value })}>{explanationLevels.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
        <div className="option-block">
          <span>Generated outputs</span>
          <div className="toggle-list">
            <label><input type="checkbox" checked={aiOptions.generateTests} onChange={event => setAiOptions({ ...aiOptions, generateTests: event.target.checked })} /> Unit tests</label>
            <label><input type="checkbox" checked={aiOptions.generateDocumentation} onChange={event => setAiOptions({ ...aiOptions, generateDocumentation: event.target.checked })} /> Documentation</label>
            <label><input type="checkbox" checked={aiOptions.detectCodeSmells} onChange={event => setAiOptions({ ...aiOptions, detectCodeSmells: event.target.checked })} /> Code smells</label>
            <label><input type="checkbox" checked={aiOptions.detectSecurityVulnerabilities} onChange={event => setAiOptions({ ...aiOptions, detectSecurityVulnerabilities: event.target.checked })} /> Vulnerabilities</label>
            <label><input type="checkbox" checked={aiOptions.streamResponse} onChange={event => setAiOptions({ ...aiOptions, streamResponse: event.target.checked })} /> Streaming response</label>
          </div>
        </div>
        <label className="span-two"><span>Custom review rules</span><textarea value={aiOptions.customRules} onChange={event => setAiOptions({ ...aiOptions, customRules: event.target.value })} placeholder="Example: prefer early returns, avoid global mutable state, require input validation." /></label>
        <label className="span-two"><span>Organization coding standards</span><textarea value={aiOptions.organizationStandards} onChange={event => setAiOptions({ ...aiOptions, organizationStandards: event.target.value })} placeholder="Example: use camelCase, write tests for public functions, sanitize all user input." /></label>
      </div>
    </section>
  )
}

function SourceInput({ sourceMode, code, setCode, files, updateFile, addFile, removeFile, githubRepoUrl, setGithubRepoUrl, pullRequestUrl, setPullRequestUrl, beforeCode, setBeforeCode, afterCode, setAfterCode, editorFocusRef }) {
  if (sourceMode === 'github_repo') {
    return <div className="source-form"><label><span>Repository URL</span><input placeholder="https://github.com/owner/repo" value={githubRepoUrl} onChange={event => setGithubRepoUrl(event.target.value)} /></label><p>Reviews up to the first reviewable source files from a public repository.</p></div>
  }

  if (sourceMode === 'pull_request') {
    return <div className="source-form"><label><span>Pull request URL</span><input placeholder="https://github.com/owner/repo/pull/123" value={pullRequestUrl} onChange={event => setPullRequestUrl(event.target.value)} /></label><p>Reviews changed files and patches from a public pull request.</p></div>
  }

  if (sourceMode === 'multi_file') {
    return <div className="multi-file-editor">{files.map((file, index) => <div className="file-card" key={index}><div className="file-card-header"><input value={file.path} onChange={event => updateFile(index, { path: event.target.value })} /><button type="button" className="ghost-button" onClick={() => removeFile(index)} disabled={files.length === 1}>Remove</button></div><MonacoCodeEditor value={file.content} onChange={value => updateFile(index, { content: value })} path={file.path} /></div>)}<button type="button" className="ghost-button" onClick={addFile}>Add File</button></div>
  }

  if (sourceMode === 'compare_versions') {
    return <div className="compare-editor"><label><span>Before version</span><MonacoCodeEditor value={beforeCode} onChange={setBeforeCode} path="before.js" /></label><label><span>After version</span><MonacoCodeEditor value={afterCode} onChange={setAfterCode} path="after.js" /></label></div>
  }

  return <MonacoCodeEditor value={code} onChange={setCode} path="source.js" editorRef={editorFocusRef} />
}

function MonacoCodeEditor({ value, onChange, path = '', editorRef }) {
  const language = getEditorLanguage(path, value)

  return (
    <div className="code-editor monaco-code-editor">
      <MonacoEditor
        path={path}
        language={language}
        theme="vs-dark"
        value={value}
        onChange={nextValue => onChange(nextValue || '')}
        onMount={editor => {
          if (editorRef) editorRef.current = editor
        }}
        options={{
          automaticLayout: true,
          bracketPairColorization: { enabled: true },
          fontFamily: '"Fira Code", "Fira Mono", Consolas, monospace',
          fontSize: 14,
          lineHeight: 24,
          lineNumbers: 'on',
          minimap: { enabled: false },
          renderLineHighlight: 'all',
          scrollBeyondLastLine: false,
          smoothScrolling: true,
          tabSize: 2,
          wordWrap: 'on',
        }}
      />
    </div>
  )
}

function ReviewResults({ review, result, resultView, setResultView, error, isLoading, code }) {
  return (
    <div className="review-content" aria-live="polite">
      {isLoading && <EmptyState title="Review in progress" text="Analyzing code and preparing structured findings." />}
      {!isLoading && error && <EmptyState title="Review failed" text={error} tone="error" />}
      {!isLoading && !error && !review && <EmptyState title="Ready for review" text="Choose a source, select depth, and run the review." />}
      {!isLoading && !error && review && (
        <div className="results-stack">
          <ResultSummary result={result} />
          <div className="source-tabs compact-tabs">{['report', 'comments', 'checklist', 'diff', 'ai', 'tests', 'docs'].map(view => <button key={view} type="button" className={resultView === view ? 'active' : ''} onClick={() => setResultView(view)}>{view}</button>)}</div>
          {resultView === 'report' && <Markdown rehypePlugins={[rehypeHighlight]}>{review}</Markdown>}
          {resultView === 'comments' && <InlineComments comments={result.comments} score={result.score} />}
          {resultView === 'checklist' && <Checklist checklist={result.checklist} score={result.score} />}
          {resultView === 'diff' && <DiffView files={result.files} fixedFiles={result.fixedFiles} fixes={result.fixes} before={code} after={result.fixedCode} score={result.score} />}
          {resultView === 'ai' && <AiFindings result={result} />}
          {resultView === 'tests' && <GeneratedFiles items={result.generatedTests} emptyTitle="No unit tests generated" emptyText="Enable Unit tests in AI review configuration and run the review again." />}
          {resultView === 'docs' && <GeneratedFiles items={result.generatedDocumentation} emptyTitle="No documentation generated" emptyText="Enable Documentation in AI review configuration and run the review again." />}
        </div>
      )}
    </div>
  )
}

function AiFindings({ result }) {
  const languages = result.detectedLanguages || []
  const smells = result.codeSmells || []
  const vulnerabilities = result.securityVulnerabilities || []
  const comparison = result.comparison || {}

  return (
    <div className="ai-findings">
      <section><h3>Detected language</h3>{languages.length ? <div className="chip-list">{languages.map(language => <span className="chip active" key={language}>{language}</span>)}</div> : <EmptyState title="Language not detected" text="The model did not return language metadata for this review." />}</section>
      <section><h3>Code smells</h3>{smells.length ? <div className="comment-list">{smells.map((item, index) => <article className="comment-card" key={`${item.file}-${item.line}-${index}`}><div><strong>{item.file}:{item.line} - {item.title}</strong></div><p>{item.impact}</p><small>{item.fix}</small></article>)}</div> : <EmptyState title="No code smells detected" text="No maintainability smells were returned for this review." />}</section>
      <section><h3>Security vulnerabilities</h3>{vulnerabilities.length ? <div className="comment-list">{vulnerabilities.map((item, index) => <article className="comment-card" key={`${item.file}-${item.line}-${index}`}><div><span className={`severity-pill ${item.severity}`}>{item.severity}</span><strong>{item.file}:{item.line} - {item.title}</strong></div><p>{item.risk}</p><small>{item.mitigation}</small></article>)}</div> : <EmptyState title="No vulnerabilities detected" text="No security vulnerabilities were returned for this review." />}</section>
      {(comparison.summary || comparison.regressions?.length || comparison.improvements?.length) && <section><h3>Version comparison</h3><div className="comment-card"><p>{comparison.summary}</p><small>Recommendation: {comparison.recommendation || 'not specified'}</small>{comparison.regressions?.length > 0 && <ul>{comparison.regressions.map(item => <li key={item}>{item}</li>)}</ul>}{comparison.improvements?.length > 0 && <ul>{comparison.improvements.map(item => <li key={item}>{item}</li>)}</ul>}</div></section>}
    </div>
  )
}

function GeneratedFiles({ items = [], emptyTitle, emptyText }) {
  if (!items.length) return <EmptyState title={emptyTitle} text={emptyText} />
  return <div className="generated-files">{items.map((item, index) => <article key={`${item.file}-${index}`}><div><strong>{item.file}</strong>{item.framework && <span className="pill">{item.framework}</span>}</div><pre>{item.content}</pre></article>)}</div>
}

function ResultSummary({ result }) {
  const hasScore = Number(result.score) > 0
  return <div className="result-summary"><div className="score-card"><strong>{hasScore ? result.score : '-'}</strong><span>{hasScore ? 'Review score' : 'Score unavailable'}</span></div><SeverityBadge label="Critical" value={result.severityCounts?.critical || 0} tone="critical" /><SeverityBadge label="High" value={result.severityCounts?.high || 0} tone="high" /><SeverityBadge label="Medium" value={result.severityCounts?.medium || 0} tone="medium" /><SeverityBadge label="Low" value={result.severityCounts?.low || 0} tone="low" /></div>
}

function SeverityBadge({ label, value, tone }) {
  return <div className={`severity-card ${tone}`}><strong>{value}</strong><span>{label}</span></div>
}

function InlineComments({ comments, score }) {
  if (!comments?.length) return <EmptyState title="No inline comments returned" text={score >= 90 ? 'The review score is high, so the model did not find line-level issues worth flagging.' : 'The model returned a report but did not provide line-level comments. Try Standard or Deep review for more granular findings.'} />
  return <div className="comment-list">{comments.map((comment, index) => <article className="comment-card" key={`${comment.file}-${comment.line}-${index}`}><div><span className={`severity-pill ${comment.severity}`}>{comment.severity}</span><strong>{comment.file}:{comment.line} - {comment.title}</strong></div><p>{comment.message}</p><small>{comment.suggestion}</small></article>)}</div>
}

function Checklist({ checklist, score }) {
  if (!checklist?.length) return <EmptyState title="Checklist unavailable" text={score ? `The model scored this review ${score}/100 but did not return checklist fields. Run the review again to regenerate structured checklist data.` : 'No score or checklist was returned by the model. The response was incomplete.'} />
  return <div className="checklist">{checklist.map((item, index) => <div className={`check-item ${item.status}`} key={`${item.label}-${index}`}><strong>{item.label}</strong><span>{item.status}</span><p>{item.note}</p></div>)}</div>
}

function DiffView({ files = [], fixedFiles = [], fixes = [], before, after, score }) {
  const diffFiles = files.length ? files : [{ path: 'pasted-code.js', content: before }]
  const initialPath = diffFiles[0]?.path || fixedFiles[0]?.path || 'pasted-code.js'
  const fileSignature = diffFiles.map(file => file.path).join('|')
  const fixedSignature = fixedFiles.map(file => file.path).join('|')
  const [activePath, setActivePath] = useState(initialPath)
  const activeFile = diffFiles.find(file => file.path === activePath) || diffFiles[0]
  const fixedFile = fixedFiles.find(file => file.path === activeFile.path)
  const activeFixes = fixes.filter(fix => fix.file === activeFile.path)
  const fixedContent = fixedFile?.content || activeFile.fixedContent || after

  useEffect(() => {
    setActivePath(initialPath)
  }, [fileSignature, fixedSignature, initialPath])

  return (
    <div className="file-diff-stack">
      {diffFiles.length > 1 && (
        <div className="file-tabs">
          {diffFiles.map(file => (
            <button key={file.path} type="button" className={activeFile.path === file.path ? 'active' : ''} onClick={() => setActivePath(file.path)}>
              {file.path}
            </button>
          ))}
        </div>
      )}
      <div className="diff-grid">
        <div><h3>Before</h3><pre>{activeFile.content}</pre></div>
        <div>
          <h3>After</h3>
          {fixedContent ? <pre>{fixedContent}</pre> : <DiffEmptyState score={score} fixes={activeFixes} />}
        </div>
      </div>
    </div>
  )
}

function DiffEmptyState({ score, fixes }) {
  if (fixes.length) {
    return <div className="fix-list">{fixes.map((fix, index) => <article key={`${fix.file}-${index}`}><strong>{fix.title}</strong><p>{fix.explanation}</p>{fix.replacement && <pre>{fix.replacement}</pre>}</article>)}</div>
  }

  return <EmptyState title="No fixed code generated" text={score >= 90 ? 'The review score is high, so the model did not generate a replacement for this file.' : 'The model returned findings but no full replacement code for this file. Use Comments for exact issues, or run a Deep review for stronger fix generation.'} />
}

function HistoryPage({ reviews, projects, models, filters, setFilters, loadReview, toggleReviewFavorite, saveReviewNotes, deleteReviewRecord, shareReviewReport, exportReviewMarkdown, exportReviewPdf, restoreReviewedCode }) {
  function patchFilters(changes) {
    setFilters({ ...filters, ...changes })
  }

  return (
    <div className="page-stack">
      <PageTitle eyebrow="Reports" title="Review history" />
      <section className="history-filter-panel">
        <label><span>Search</span><input value={filters.search} onChange={event => patchFilters({ search: event.target.value })} placeholder="Search report, code, notes, project" /></label>
        <label><span>Model</span><select value={filters.model} onChange={event => patchFilters({ model: event.target.value })}><option value="">All models</option>{models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label>
        <label><span>Project</span><select value={filters.projectId} onChange={event => patchFilters({ projectId: event.target.value })}><option value="">All projects</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
        <label><span>Severity</span><select value={filters.severity} onChange={event => patchFilters({ severity: event.target.value })}><option value="">All severities</option><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label>
        <label><span>From</span><input type="date" value={filters.dateFrom} onChange={event => patchFilters({ dateFrom: event.target.value })} /></label>
        <label><span>To</span><input type="date" value={filters.dateTo} onChange={event => patchFilters({ dateTo: event.target.value })} /></label>
        <label className="inline-check"><input type="checkbox" checked={filters.favorite} onChange={event => patchFilters({ favorite: event.target.checked })} /> Pinned only</label>
      </section>
      <section className="history-report-grid">
        {reviews.length ? reviews.map(item => (
          <ReportCard
            key={item.id}
            item={item}
            loadReview={loadReview}
            toggleReviewFavorite={toggleReviewFavorite}
            saveReviewNotes={saveReviewNotes}
            deleteReviewRecord={deleteReviewRecord}
            shareReviewReport={shareReviewReport}
            exportReviewMarkdown={exportReviewMarkdown}
            exportReviewPdf={exportReviewPdf}
            restoreReviewedCode={restoreReviewedCode}
          />
        )) : <EmptyState title="No saved reports" text="Completed reviews that match your filters will appear here." />}
      </section>
    </div>
  )
}

function ReportCard({ item, loadReview, toggleReviewFavorite, saveReviewNotes, deleteReviewRecord, shareReviewReport, exportReviewMarkdown, exportReviewPdf, restoreReviewedCode }) {
  const [notes, setNotes] = useState(item.notes || '')
  const severityCounts = countSeverities(item.comments || [])

  useEffect(() => setNotes(item.notes || ''), [item.notes])

  return (
    <article className={item.isFavorite ? 'report-card pinned' : 'report-card'}>
      <header>
        <div>
          <strong>{item.projectName || item.sourceType || 'Review report'}</strong>
          <small>{formatDate(item.createdAt)} - {item.model} - Score {item.score || 0}</small>
        </div>
        <button type="button" className="pin-button" onClick={() => toggleReviewFavorite(item)}>{item.isFavorite ? 'Pinned' : 'Pin'}</button>
      </header>
      <div className="report-badges"><span>Critical {severityCounts.critical}</span><span>High {severityCounts.high}</span><span>Medium {severityCounts.medium}</span><span>Low {severityCounts.low}</span></div>
      <p>{item.review.slice(0, 260)}</p>
      <label><span>Notes</span><textarea value={notes} onChange={event => setNotes(event.target.value)} placeholder="Add private notes for this review." /></label>
      <div className="report-actions">
        <button type="button" className="ghost-button" onClick={() => loadReview(item)}>Open</button>
        <button type="button" className="ghost-button" onClick={() => restoreReviewedCode(item)}>Restore Code</button>
        <button type="button" className="ghost-button" onClick={() => saveReviewNotes(item, notes)}>Save Notes</button>
        <button type="button" className="ghost-button" onClick={() => shareReviewReport(item)}>Share</button>
        <button type="button" className="ghost-button" onClick={() => exportReviewMarkdown(item)}>Markdown</button>
        <button type="button" className="ghost-button" onClick={() => exportReviewPdf(item)}>PDF</button>
        <button type="button" className="ghost-button danger-button" onClick={() => deleteReviewRecord(item)}>Delete</button>
      </div>
    </article>
  )
}

function AdminPage({
  stats,
  analytics,
  users,
  filters,
  setFilters,
  updateLimit,
  updateUserStatus,
  selectedUser,
  selectedReviews,
  viewUserHistory,
  exportAdminReport,
}) {
  const overview = analytics?.overview || {}
  const monthlyUsage = analytics?.monthlyUsage || []
  const modelUsage = analytics?.modelUsage || []
  const costByUser = analytics?.costByUser || []

  function patchFilters(changes) {
    setFilters({ ...filters, ...changes })
  }

  return (
    <div className="page-stack">
      <PageTitle eyebrow="Administration" title="Admin command center">
        <div className="result-actions">
          <button type="button" className="ghost-button" onClick={() => exportAdminReport('csv')}>Export CSV</button>
          <button type="button" className="ghost-button" onClick={() => exportAdminReport('json')}>Export JSON</button>
        </div>
      </PageTitle>

      <section className="metric-grid admin-metrics">
        <Metric label="Total users" value={overview.totalUsers ?? stats?.users ?? 0} />
        <Metric label="Active users" value={overview.activeUsers || 0} />
        <Metric label="Suspended users" value={overview.suspendedUsers || 0} />
        <Metric label="Reviews this month" value={overview.reviewsThisMonth ?? stats?.reviews_this_month ?? 0} />
        <Metric label="Average score" value={overview.averageScore || 0} />
        <Metric label="Monthly cost" value={formatCurrency(overview.estimatedMonthlyCost)} />
      </section>

      <section className="admin-analytics-grid">
        <div className="wide-panel">
          <div className="section-heading">
            <div>
              <h2>Monthly usage</h2>
              <p>Review volume, active reviewers, score trend, and estimated spend.</p>
            </div>
          </div>
          <MonthlyUsageChart data={monthlyUsage} />
        </div>

        <div className="wide-panel">
          <div className="section-heading">
            <div>
              <h2>Model usage</h2>
              <p>Track which AI models are being used across the workspace.</p>
            </div>
          </div>
          <ModelUsageList data={modelUsage} />
        </div>
      </section>

      <section className="wide-panel">
        <div className="section-heading">
          <div>
            <h2>User management</h2>
            <p>Search members, update roles, suspend access, and inspect review activity.</p>
          </div>
        </div>

        <AdminFilters filters={filters} patchFilters={patchFilters} />

        <div className="admin-table">
          <div className="admin-row admin-head">
            <span>User</span>
            <span>Status</span>
            <span>Role</span>
            <span>Usage</span>
            <span>Quality</span>
            <span>Cost</span>
            <span>Limit</span>
            <span>Actions</span>
          </div>
          {users.length ? users.map(account => (
            <AdminUserRow
              key={account.id}
              account={account}
              updateLimit={updateLimit}
              updateUserStatus={updateUserStatus}
              viewUserHistory={viewUserHistory}
            />
          )) : <EmptyState title="No users found" text="Try changing the search, role, or status filters." />}
        </div>
      </section>

      <section className="admin-analytics-grid">
        <div className="wide-panel">
          <div className="section-heading">
            <div>
              <h2>Cost by user</h2>
              <p>Estimated review spend ranked by account activity.</p>
            </div>
          </div>
          <CostList users={costByUser} />
        </div>

        <div className="wide-panel">
          <div className="section-heading">
            <div>
              <h2>Review history</h2>
              <p>{selectedUser ? `${selectedUser.name}'s latest reviews` : 'Select a user to inspect their saved review history.'}</p>
            </div>
          </div>
          <AdminReviewHistory reviews={selectedReviews} hasSelection={Boolean(selectedUser)} />
        </div>
      </section>
    </div>
  )
}

function AdminFilters({ filters, patchFilters }) {
  return (
    <div className="admin-filter-bar">
      <label>
        Search users
        <input value={filters.search} onChange={event => patchFilters({ search: event.target.value })} placeholder="Name or email" />
      </label>
      <label>
        Role
        <select value={filters.role} onChange={event => patchFilters({ role: event.target.value })}>
          <option value="all">All roles</option>
          <option value="admin">Admins</option>
          <option value="user">Users</option>
        </select>
      </label>
      <label>
        Status
        <select value={filters.status} onChange={event => patchFilters({ status: event.target.value })}>
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
      </label>
      <label>
        Sort
        <select value={filters.sort} onChange={event => patchFilters({ sort: event.target.value })}>
          <option value="newest">Newest</option>
          <option value="name">Name</option>
          <option value="role">Role</option>
          <option value="status">Status</option>
          <option value="usage">Usage</option>
          <option value="score">Score</option>
          <option value="cost">Cost</option>
        </select>
      </label>
    </div>
  )
}

function AdminUserRow({ account, updateLimit, updateUserStatus, viewUserHistory }) {
  const [limit, setLimit] = useState(account.monthlyLimit)
  const isSystemAdmin = account.email === SYSTEM_ADMIN_EMAIL
  useEffect(() => setLimit(account.monthlyLimit), [account.monthlyLimit])

  return (
    <div className="admin-row">
      <span className="user-cell"><strong>{account.name}</strong><small>{account.email}</small></span>
      <span><span className={`status-pill ${account.status}`}>{account.status}</span></span>
      <span><span className={isSystemAdmin ? 'role-pill admin-role' : 'role-pill'}>{account.role}</span></span>
      <span>{account.reviewsThisMonth}/{account.monthlyLimit}<small>{account.totalReviews} total</small></span>
      <span>{account.averageScore || 0}<small>Avg score</small></span>
      <span>{formatCurrency(account.estimatedCost)}</span>
      <span><input type="number" min="0" max="10000" value={limit} onChange={event => setLimit(event.target.value)} /></span>
      <span className="admin-actions">
        <button type="button" className="ghost-button" onClick={() => updateLimit(account.id, Number(limit))}>Limit</button>
        <button type="button" className="ghost-button" onClick={() => updateUserStatus(account.id, account.status === 'active' ? 'suspended' : 'active')} disabled={isSystemAdmin}>
          {account.status === 'active' ? 'Suspend' : 'Activate'}
        </button>
        <button type="button" className="ghost-button" onClick={() => viewUserHistory(account)}>History</button>
      </span>
    </div>
  )
}

function MonthlyUsageChart({ data }) {
  const maxReviews = Math.max(...data.map(item => item.reviews), 1)

  if (!data.length) {
    return <EmptyState title="No usage yet" text="Monthly activity appears after reviews are created." />
  }

  return (
    <div className="bar-chart">
      {data.map(item => (
        <div className="bar-item" key={item.label}>
          <div className="bar-track"><span style={{ height: `${Math.max((item.reviews / maxReviews) * 100, item.reviews ? 8 : 0)}%` }} /></div>
          <strong>{item.reviews}</strong>
          <small>{item.label}</small>
        </div>
      ))}
    </div>
  )
}

function ModelUsageList({ data }) {
  if (!data.length) return <EmptyState title="No model data" text="Model usage appears after reviews are generated." />
  return <div className="compact-list">{data.map(item => <div key={item.model}><span><strong>{item.model}</strong><small>{item.users} users - Avg score {item.averageScore}</small></span><span>{item.reviews} reviews</span><span>{formatCurrency(item.estimatedCost)}</span></div>)}</div>
}

function CostList({ users }) {
  if (!users.length) return <EmptyState title="No costs yet" text="Estimated cost appears after users generate reviews." />
  return <div className="compact-list">{users.map(user => <div key={user.id}><span><strong>{user.name}</strong><small>{user.email}</small></span><span>{user.reviews} reviews</span><span>{formatCurrency(user.estimatedCost)}</span></div>)}</div>
}

function AdminReviewHistory({ reviews, hasSelection }) {
  if (!hasSelection) return <EmptyState title="No user selected" text="Choose History from the user table to load saved reviews." />
  if (!reviews.length) return <EmptyState title="No reviews" text="This user has not generated any saved reviews yet." />
  return <div className="admin-history-list">{reviews.map(item => <article key={item.id} className="admin-history-card"><div><strong>{item.projectName || item.sourceType}</strong><span className="score-chip">Score {item.score || 0}</span></div><small>{formatDate(item.createdAt)} - {item.model} - {item.depth}</small><p>{item.review.slice(0, 220)}</p></article>)}</div>
}

function TeamPage({ workspaces, selectedWorkspaceId, setSelectedWorkspaceId, teamDetails, loadWorkspaceDetails, workspaceForm, setWorkspaceForm, createWorkspace, inviteTeamMember, updateTeamRole }) {
  const canManage = teamDetails?.canManage
  useEffect(() => {
    if (selectedWorkspaceId) loadWorkspaceDetails(selectedWorkspaceId)
  }, [loadWorkspaceDetails, selectedWorkspaceId])

  return (
    <div className="page-stack">
      <PageTitle eyebrow="Teams" title="Workspace collaboration" />
      <section className="settings-grid">
        <div className="wide-panel">
          <div className="section-heading"><div><h2>Workspaces</h2><p>Create or select a team workspace.</p></div></div>
          <label><span>Current workspace</span><select value={selectedWorkspaceId} onChange={event => setSelectedWorkspaceId(event.target.value)}>{workspaces.map(workspace => <option key={workspace.id} value={workspace.id}>{workspace.name} - {workspace.role}</option>)}</select></label>
          <div className="project-create top-space"><input placeholder="New workspace name" value={workspaceForm.name} onChange={event => setWorkspaceForm({ ...workspaceForm, name: event.target.value })} /><button type="button" className="ghost-button" onClick={createWorkspace}>Create</button></div>
        </div>
        <div className="wide-panel">
          <div className="section-heading"><div><h2>Invite members</h2><p>Owners and admins can invite teammates.</p></div></div>
          <label><span>Email</span><input value={workspaceForm.inviteEmail} onChange={event => setWorkspaceForm({ ...workspaceForm, inviteEmail: event.target.value })} /></label>
          <label><span>Role</span><select value={workspaceForm.inviteRole} onChange={event => setWorkspaceForm({ ...workspaceForm, inviteRole: event.target.value })}><option value="member">Member</option><option value="reviewer">Reviewer</option><option value="admin">Admin</option></select></label>
          <button type="button" className="ghost-button top-space" onClick={inviteTeamMember} disabled={!canManage}>Send Invitation</button>
        </div>
      </section>
      <section className="wide-panel">
        <div className="section-heading"><div><h2>Members</h2><p>Manage workspace roles without changing global system admin access.</p></div></div>
        <div className="compact-list">
          {(teamDetails?.members || []).map(member => <div key={member.userId}><span><strong>{member.name}</strong><small>{member.email}</small></span><span>{member.role}</span><span>{canManage && member.role !== 'owner' ? <select value={member.role} onChange={event => updateTeamRole(member.userId, event.target.value)}><option value="member">Member</option><option value="reviewer">Reviewer</option><option value="admin">Admin</option></select> : 'Locked'}</span></div>)}
        </div>
      </section>
    </div>
  )
}

function ProfilePage({ user, usage, reviews, profileForm, setProfileForm, saveProfile }) {
  return (
    <div className="page-stack">
      <PageTitle eyebrow="Profile" title={user.name} />
      <section className="settings-grid">
        <div className="wide-panel">
          <div className="section-heading"><div><h2>Public profile</h2><p>Keep your reviewer identity up to date.</p></div></div>
          <label><span>Name</span><input value={profileForm.name} onChange={event => setProfileForm({ ...profileForm, name: event.target.value })} /></label>
          <label><span>Avatar URL</span><input value={profileForm.avatarUrl} onChange={event => setProfileForm({ ...profileForm, avatarUrl: event.target.value })} /></label>
          <label><span>Bio</span><textarea className="profile-textarea" value={profileForm.bio} onChange={event => setProfileForm({ ...profileForm, bio: event.target.value })} /></label>
          <button type="button" className="ghost-button top-space" onClick={saveProfile}>Save Profile</button>
        </div>
        <div className="wide-panel">
          <div className="section-heading"><div><h2>Activity</h2><p>Your account status and review activity.</p></div></div>
          <dl className="detail-list"><div><dt>Email</dt><dd>{user.email}</dd></div><div><dt>Email verified</dt><dd>{user.emailVerified ? 'Yes' : 'No'}</dd></div><div><dt>Global role</dt><dd>{user.role}</dd></div><div><dt>Monthly usage</dt><dd>{usage.used}/{usage.limit}</dd></div><div><dt>Saved reviews</dt><dd>{reviews.length}</dd></div></dl>
        </div>
      </section>
    </div>
  )
}

function BillingPage({ billing, selectFreePlan, startRazorpayCheckout }) {
  const plans = billing?.plans || []
  const currentPlan = billing?.currentPlan
  const pendingPlan = billing?.pendingPlan
  const scheduledDowngrade = billing?.subscription?.metadata?.scheduledDowngradeTo
  const usage = billing?.usage

  return (
    <div className="page-stack">
      <PageTitle eyebrow="Billing" title="Plans and usage" />
      <section className="metric-grid">
        <Metric label="Current plan" value={currentPlan?.name || '-'} />
        <Metric label="Included reviews" value={usage?.included ?? '-'} />
        <Metric label="Used this month" value={usage?.used ?? 0} />
        <Metric label="Estimated overage" value={usage?.estimatedOverageLabel || '₹0.00'} />
      </section>
      {pendingPlan && <section className="wide-panel"><div className="section-heading"><div><h2>Checkout not completed</h2><p>Your {pendingPlan.name} checkout is pending. The plan becomes current only after Razorpay returns a verified payment.</p></div></div></section>}
      {scheduledDowngrade && <section className="wide-panel"><div className="section-heading"><div><h2>Plan change scheduled</h2><p>Your account will move to Free at the end of the current billing period. Your current paid access remains active until then.</p></div></div></section>}
      <section className="plan-grid">
        {plans.map(plan => (
          <article className={currentPlan?.id === plan.id ? 'plan-card active' : 'plan-card'} key={plan.id}>
            <div>
              <span className="pill">{currentPlan?.id === plan.id ? 'Current' : 'Available'}</span>
              <h2>{plan.name}</h2>
              <strong>{plan.priceLabel}</strong>
              <p>{plan.description}</p>
            </div>
            <dl className="detail-list compact-details">
              <div><dt>Monthly reviews</dt><dd>{plan.includedReviews}</dd></div>
              <div><dt>Overage</dt><dd>{plan.overagePriceCents ? `${formatRupeesFromCents(plan.overagePriceCents)} / review` : 'Hard limit'}</dd></div>
              <div><dt>API keys</dt><dd>{plan.apiKeyLimit}</dd></div>
              <div><dt>Webhooks</dt><dd>{plan.webhookLimit}</dd></div>
            </dl>
            <ul className="feature-list">{plan.features.map(feature => <li key={feature}>{feature}</li>)}</ul>
            {plan.id === 'free'
              ? <button type="button" className="ghost-button" onClick={selectFreePlan} disabled={currentPlan?.id === 'free' || Boolean(scheduledDowngrade)}>{currentPlan?.id === 'free' ? 'Current Plan' : scheduledDowngrade ? 'Scheduled' : 'Move to Free'}</button>
              : <button type="button" className="primary-button" onClick={() => startRazorpayCheckout(plan.id)} disabled={currentPlan?.id === plan.id}>Upgrade to {plan.name}</button>}
          </article>
        ))}
      </section>
      <section className="wide-panel">
        <div className="section-heading"><div><h2>Usage-based billing</h2><p>Included reviews are counted monthly. Paid plans estimate overage for reviews beyond the included allowance.</p></div></div>
        <div className="usage-bar"><span style={{ width: `${Math.min(((usage?.used || 0) / Math.max(usage?.included || 1, 1)) * 100, 100)}%` }} /></div>
        <dl className="detail-list"><div><dt>Billable overage</dt><dd>{usage?.billableOverage || 0} review(s)</dd></div><div><dt>Projected overage</dt><dd>{usage?.estimatedOverageLabel || '₹0.00'}</dd></div><div><dt>Status</dt><dd>{billing?.subscription?.status || 'active'}</dd></div></dl>
      </section>
    </div>
  )
}

function DeveloperPage({ resources, apiKeyForm, setApiKeyForm, newApiKey, setNewApiKey, createApiKey, revokeApiKey, webhookForm, setWebhookForm, newWebhookSecret, setNewWebhookSecret, createWebhookEndpoint, deleteWebhookEndpoint }) {
  const apiDocs = {
    endpoint: '/api/v1/reviews',
    method: 'POST',
    body: JSON.stringify({ sourceType: 'paste', code: 'function sum(a, b) { return a + b }', depth: 'standard' }, null, 2)
  }
  const webhookEvents = ['review.created', 'review.failed', 'usage.limit_reached', 'subscription.updated']

  function toggleWebhookEvent(eventName) {
    setWebhookForm(current => ({
      ...current,
      events: current.events.includes(eventName)
        ? current.events.filter(item => item !== eventName)
        : [...current.events, eventName]
    }))
  }

  return (
    <div className="page-stack">
      <PageTitle eyebrow="Developer" title="API and integrations" />
      {newApiKey && <section className="wide-panel sensitive-panel"><div className="section-heading"><div><h2>New API key</h2><p>This key is shown once. Store it securely before closing this panel.</p></div><button type="button" className="ghost-button" onClick={() => setNewApiKey('')}>Close</button></div><code>{newApiKey}</code></section>}
      {newWebhookSecret && <section className="wide-panel sensitive-panel"><div className="section-heading"><div><h2>Webhook signing secret</h2><p>This secret is shown once. Use it to verify events delivered to your endpoint.</p></div><button type="button" className="ghost-button" onClick={() => setNewWebhookSecret('')}>Close</button></div><code>{newWebhookSecret}</code></section>}
      <section className="settings-grid">
        <div className="wide-panel">
          <div className="section-heading"><div><h2>API keys</h2><p>Create and revoke developer keys for server-to-server review requests.</p></div><span className="pill">{resources.apiKeys.length}/{resources.limits.apiKeys}</span></div>
          <div className="project-create"><input value={apiKeyForm.name} onChange={event => setApiKeyForm({ name: event.target.value })} placeholder="Key name" /><button type="button" className="ghost-button" onClick={createApiKey}>Create Key</button></div>
          <div className="compact-list top-space">{resources.apiKeys.length ? resources.apiKeys.map(key => <div key={key.id}><span><strong>{key.name}</strong><small>{key.keyPrefix}... · {key.status}</small></span><span>{key.lastUsedAt ? `Used ${formatDate(key.lastUsedAt)}` : 'Never used'}</span><button type="button" className="ghost-button" onClick={() => revokeApiKey(key.id)} disabled={key.status !== 'active'}>Revoke</button></div>) : <EmptyState title="No API keys" text="Create a key to call the public review API from backend services." />}</div>
        </div>
        <div className="wide-panel">
          <div className="section-heading"><div><h2>Webhook integrations</h2><p>Register endpoints for product events and review automation.</p></div><span className="pill">{resources.webhooks.length}/{resources.limits.webhooks}</span></div>
          <label><span>Endpoint URL</span><input value={webhookForm.url} onChange={event => setWebhookForm({ ...webhookForm, url: event.target.value })} placeholder="https://example.com/webhooks/code-reviewer" /></label>
          <div className="chip-list top-space">{webhookEvents.map(eventName => <button type="button" key={eventName} className={webhookForm.events.includes(eventName) ? 'chip active' : 'chip'} onClick={() => toggleWebhookEvent(eventName)}>{eventName}</button>)}</div>
          <button type="button" className="ghost-button top-space" onClick={createWebhookEndpoint}>Create Webhook</button>
          <div className="compact-list top-space">{resources.webhooks.length ? resources.webhooks.map(webhook => <div key={webhook.id}><span><strong>{webhook.url}</strong><small>{webhook.events.join(', ') || 'No events'} · {webhook.status}</small></span><span>{webhook.lastDeliveryStatus || 'No delivery yet'}</span><button type="button" className="ghost-button" onClick={() => deleteWebhookEndpoint(webhook.id)} disabled={webhook.status !== 'active'}>Disable</button></div>) : <EmptyState title="No webhooks" text="Create an endpoint when you want external systems to react to review events." />}</div>
        </div>
      </section>
      <section className="wide-panel">
        <div className="section-heading"><div><h2>Public API documentation</h2><p>Use API keys to create reviews from CI pipelines, internal tools, or automations.</p></div></div>
        <div className="api-doc-grid">
          <div><span className="pill">{apiDocs.method}</span><code>{apiDocs.endpoint}</code></div>
          <pre>{apiDocs.body}</pre>
          <pre>{`curl -X POST "$API_URL${apiDocs.endpoint}" \\
  -H "x-api-key: acr_..." \\
  -H "Content-Type: application/json" \\
  -d '${apiDocs.body.replace(/\n/g, '')}'`}</pre>
        </div>
      </section>
    </div>
  )
}

function CompliancePage({ compliance, updatePrivacySettings, applyDataRetention }) {
  const privacy = compliance.privacy || {
    saveReviews: true,
    allowShareLinks: true,
    allowProductEmails: false,
    retentionDays: 365,
    deleteAfterRetention: false
  }

  function patchPrivacy(changes) {
    updatePrivacySettings({ ...privacy, ...changes })
  }

  return (
    <div className="page-stack">
      <PageTitle eyebrow="Compliance" title="Privacy and audit controls" />
      <section className="settings-grid">
        <div className="wide-panel">
          <div className="section-heading"><div><h2>Privacy controls</h2><p>Control how reviews are stored, shared, and used for account communication.</p></div></div>
          <div className="toggle-list stacked-toggles">
            <label><input type="checkbox" checked={privacy.saveReviews} onChange={event => patchPrivacy({ saveReviews: event.target.checked })} /> Save review history</label>
            <label><input type="checkbox" checked={privacy.allowShareLinks} onChange={event => patchPrivacy({ allowShareLinks: event.target.checked })} /> Allow share links</label>
            <label><input type="checkbox" checked={privacy.allowProductEmails} onChange={event => patchPrivacy({ allowProductEmails: event.target.checked })} /> Product emails</label>
          </div>
        </div>
        <div className="wide-panel">
          <div className="section-heading"><div><h2>Data retention</h2><p>Choose how long saved review records are kept before they can be retired.</p></div></div>
          <label><span>Retention period</span><select value={privacy.retentionDays} onChange={event => patchPrivacy({ retentionDays: Number(event.target.value) })}><option value="30">30 days</option><option value="90">90 days</option><option value="180">180 days</option><option value="365">1 year</option><option value="730">2 years</option></select></label>
          <div className="toggle-list top-space"><label><input type="checkbox" checked={privacy.deleteAfterRetention} onChange={event => patchPrivacy({ deleteAfterRetention: event.target.checked })} /> Retire records after retention period</label></div>
          <button type="button" className="ghost-button top-space" onClick={applyDataRetention}>Apply Retention Now</button>
        </div>
      </section>
      <section className="wide-panel">
        <div className="section-heading"><div><h2>Audit logs</h2><p>Security, billing, developer, and privacy changes are recorded for traceability.</p></div></div>
        <div className="audit-list">{compliance.auditLogs.length ? compliance.auditLogs.map((item, index) => <article key={`${item.action}-${item.createdAt}-${index}`}><div><strong>{item.action}</strong><span>{formatDate(item.createdAt)}</span></div><small>{item.entityType}{item.entityId ? ` · ${item.entityId}` : ''}</small></article>) : <EmptyState title="No audit events yet" text="Audit records appear after account, billing, API, webhook, and privacy changes." />}</div>
      </section>
    </div>
  )
}

function SettingsPage({ theme, setTheme, user, usage, signOut, securityForm, setSecurityForm, savePassword, requestEmailVerification }) {
  return (
    <div className="page-stack">
      <PageTitle eyebrow="Preferences" title="Account settings" />
      <section className="settings-grid">
        <div className="wide-panel">
          <div className="section-heading"><div><h2>Security</h2><p>Password, email verification, and account protection.</p></div></div>
          <dl className="detail-list"><div><dt>Email</dt><dd>{user.email}</dd></div><div><dt>Email verified</dt><dd>{user.emailVerified ? 'Yes' : 'No'}</dd></div><div><dt>Monthly usage</dt><dd>{usage.used}/{usage.limit}</dd></div></dl>
          {!user.emailVerified && <button type="button" className="ghost-button top-space" onClick={requestEmailVerification}>Send Verification Email</button>}
          <label className="top-space"><span>Current password</span><input type="password" value={securityForm.currentPassword} onChange={event => setSecurityForm({ ...securityForm, currentPassword: event.target.value })} /></label>
          <label><span>New password</span><input type="password" value={securityForm.newPassword} onChange={event => setSecurityForm({ ...securityForm, newPassword: event.target.value })} /></label>
          <button type="button" className="ghost-button top-space" onClick={savePassword}>Update Password</button>
          <button type="button" className="ghost-button top-space" onClick={signOut}>Sign Out</button>
        </div>
        <div className="wide-panel">
          <div className="section-heading"><div><h2>Appearance</h2><p>Choose the interface theme for this browser.</p></div></div>
          <div className="segmented-control"><button type="button" className={theme === 'dark' ? 'active' : ''} onClick={() => setTheme('dark')}>Dark</button><button type="button" className={theme === 'light' ? 'active' : ''} onClick={() => setTheme('light')}>Light</button></div>
        </div>
      </section>
    </div>
  )
}

function PageTitle({ eyebrow, title, children }) {
  return <header className="page-title"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1></div>{children}</header>
}

function SectionTitle({ eyebrow, title }) {
  return <div className="section-title"><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div>
}

function Feature({ title, text }) {
  return <article className="feature-card"><h3>{title}</h3><p>{text}</p></article>
}

function Step({ number, title, text }) {
  return <article className="step-card"><span>{number}</span><h3>{title}</h3><p>{text}</p></article>
}

function Metric({ label, value }) {
  return <div className="metric-card"><span>{label}</span><strong>{value}</strong></div>
}

function HistoryRow({ item, onClick }) {
  return <button type="button" className="history-row" onClick={onClick}><span><strong>{item.projectName || item.sourceType || 'Review'}</strong><small>{formatDate(item.createdAt)} - {item.depth} - Score {item.score || 0}</small></span><span>{item.code.slice(0, 180)}</span></button>
}

function ThemeToggle({ theme, setTheme }) {
  return <button type="button" className="theme-chip" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>Theme</button>
}

function FlashMessage({ notice, error }) {
  const message = error || notice
  if (!message) return null
  return <div className={`toast-message ${error ? 'error-alert' : 'success-alert'}`} role="status">{message}</div>
}

function EmptyState({ title, text, tone = 'neutral' }) {
  return <div className={`state-message ${tone === 'error' ? 'error-message' : ''}`}><strong>{title}</strong><span>{text}</span></div>
}

function countSeverities(comments) {
  return comments.reduce((counts, comment) => {
    const severity = ['critical', 'high', 'medium', 'low'].includes(comment.severity) ? comment.severity : 'medium'
    counts[severity] += 1
    return counts
  }, { critical: 0, high: 0, medium: 0, low: 0 })
}

export default App

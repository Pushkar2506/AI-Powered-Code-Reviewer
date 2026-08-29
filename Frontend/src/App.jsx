import { useCallback, useEffect, useMemo, useState } from 'react'
import "prismjs/themes/prism-tomorrow.css"
import Editor from "react-simple-code-editor"
import prism from "prismjs"
import "prismjs/components/prism-javascript"
import Markdown from "react-markdown"
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";
import axios from 'axios'
import './App.css'

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000').replace(/\/$/, '')
const APP_NAME = 'AI Powered Code Reveiwer'
const SYSTEM_ADMIN_EMAIL = 'admin@gmail.com'
const TOKEN_KEY = 'ai-powered-code-reveiwer-token'
const LEGACY_TOKEN_KEY = 'reviewdesk-token'
const THEME_KEY = 'ai-powered-code-reveiwer-theme'
const LEGACY_THEME_KEY = 'reviewdesk-theme'

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
]

const initialAdminFilters = {
  search: '',
  role: 'all',
  status: 'all',
  sort: 'newest',
}

const starterCode = `function calculateDiscount(price, percentage) {
  if (!price || !percentage) return 0
  return price - price * percentage / 100
}`

const emptyResult = {
  score: 0,
  severityCounts: { critical: 0, high: 0, medium: 0, low: 0 },
  checklist: [],
  comments: [],
  files: [],
  fixedFiles: [],
  fixedCode: '',
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

function App() {
  const [token, setToken] = useState(() => {
    window.localStorage.removeItem(LEGACY_TOKEN_KEY)
    return window.localStorage.getItem(TOKEN_KEY) || ''
  })
  const [theme, setTheme] = useState(() => window.localStorage.getItem(THEME_KEY) || window.localStorage.getItem(LEGACY_THEME_KEY) || 'dark')
  const [publicView, setPublicView] = useState('landing')
  const [activePage, setActivePage] = useState('dashboard')
  const [user, setUser] = useState(null)
  const [usage, setUsage] = useState({ used: 0, limit: 0, remaining: 0 })
  const [reviews, setReviews] = useState([])
  const [projects, setProjects] = useState([])
  const [models, setModels] = useState(fallbackModels)
  const [adminStats, setAdminStats] = useState(null)
  const [adminAnalytics, setAdminAnalytics] = useState(null)
  const [adminUsers, setAdminUsers] = useState([])
  const [adminFilters, setAdminFilters] = useState(initialAdminFilters)
  const [selectedAdminUser, setSelectedAdminUser] = useState(null)
  const [selectedUserReviews, setSelectedUserReviews] = useState([])
  const [code, setCode] = useState(starterCode)
  const [files, setFiles] = useState([{ path: 'src/app.js', content: starterCode }])
  const [githubUrl, setGithubUrl] = useState('')
  const [sourceMode, setSourceMode] = useState('paste')
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [newProjectName, setNewProjectName] = useState('')
  const [review, setReview] = useState('')
  const [result, setResult] = useState(emptyResult)
  const [depth, setDepth] = useState('standard')
  const [model, setModel] = useState(fallbackModels[0].id)
  const [resultView, setResultView] = useState('report')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [authForm, setAuthForm] = useState({ name: '', email: '', password: '' })

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

  const resetSessionState = useCallback(() => {
    setUser(null)
    setUsage({ used: 0, limit: 0, remaining: 0 })
    setReviews([])
    setProjects([])
    setAdminStats(null)
    setAdminAnalytics(null)
    setAdminUsers([])
    setAdminFilters(initialAdminFilters)
    setSelectedAdminUser(null)
    setSelectedUserReviews([])
    setReview('')
    setResult(emptyResult)
    setError('')
    setNotice('')
    setPublicView('landing')
    setActivePage('dashboard')
  }, [])

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

  const loadAppData = useCallback(async () => {
    try {
      const [profileResponse, reviewsResponse, modelsResponse, projectsResponse] = await Promise.all([
        api.get('/auth/me'),
        api.get('/reviews'),
        api.get('/ai/models'),
        api.get('/projects'),
      ])
      setUser(profileResponse.data.user)
      setUsage(profileResponse.data.usage)
      setReviews(reviewsResponse.data.reviews)
      setProjects(projectsResponse.data.projects)
      setModels(modelsResponse.data.models)
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
        setActivePage(current => current === 'dashboard' ? 'admin' : current)
      } else {
        setActivePage(current => current === 'admin' ? 'dashboard' : current)
      }
    } catch {
      signOut()
    }
  }, [api, loadAdminData, signOut])

  useEffect(() => {
    if (!token) return
    loadAppData()
  }, [token, loadAppData])

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
    setIsLoading(true)
    setError('')
    setNotice('')

    try {
      const payload = {
        sourceType: sourceMode,
        depth,
        model,
        projectId: selectedProjectId || null,
      }

      if (sourceMode === 'paste') {
        payload.code = code
      }

      if (sourceMode === 'multi_file') {
        payload.files = files
      }

      if (sourceMode === 'github_repo' || sourceMode === 'pull_request') {
        payload.githubUrl = githubUrl
      }

      const response = await api.post('/ai/get-review', payload)
      setReview(response.data.review)
      setResult({ ...(response.data.result || emptyResult), files: response.data.savedReview?.files || [] })
      setUsage(response.data.usage)
      setReviews(current => [response.data.savedReview, ...current.filter(item => item.id !== response.data.savedReview.id)])
      setResultView('report')
      setNotice(response.data.fallbackUsed
        ? `Review completed with ${response.data.model} because the selected model was busy.`
        : 'Review completed and saved.')
    } catch (error) {
      setError(error.response?.data?.error || 'Unable to generate a review.')
      if (error.response?.data?.usage) {
        setUsage(error.response.data.usage)
      }
    } finally {
      setIsLoading(false)
    }
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

  function loadReview(item) {
    setCode(item.code)
    setFiles(item.files?.length ? item.files : [{ path: 'reviewed-code.js', content: item.code }])
    setReview(item.review)
      setResult({
      summary: '',
      score: item.score || 0,
      severityCounts: countSeverities(item.comments || []),
      checklist: item.checklist || [],
      comments: item.comments || [],
      files: item.files || [],
      fixedFiles: item.files?.filter(file => file.fixedContent).map(file => ({
        path: file.path,
        content: file.fixedContent
      })) || [],
      fixedCode: item.fixedCode || ''
    })
    setDepth(item.depth)
    setModel(item.model)
    setSourceMode(item.sourceType || 'paste')
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
        githubUrl={githubUrl}
        setGithubUrl={setGithubUrl}
        sourceMode={sourceMode}
        setSourceMode={setSourceMode}
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
        isLoading={isLoading}
        depth={depth}
        setDepth={setDepth}
        model={model}
        setModel={setModel}
        models={models}
        usage={usage}
        reviewCode={reviewCode}
        copyReview={copyReview}
        downloadReview={downloadReview}
      />
    ),
    history: <HistoryPage reviews={reviews} loadReview={loadReview} />,
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
    settings: <SettingsPage theme={theme} setTheme={setTheme} user={user} usage={usage} signOut={signOut} />,
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
            ? [['admin', 'Admin Dashboard'], ['review', 'Review'], ['history', 'History'], ['settings', 'Settings']]
            : [['dashboard', 'Dashboard'], ['review', 'Review'], ['history', 'History'], ['settings', 'Settings']]
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
  if (props.publicView === 'login' || props.publicView === 'register') {
    return <AuthPage {...props} mode={props.publicView} />
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

function AuthPage({ mode, setPublicView, authForm, setAuthForm, handleAuth, isLoading }) {
  const isLogin = mode === 'login'
  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <button type="button" className="back-button" onClick={() => setPublicView('landing')}>Back</button>
        <div><p className="eyebrow">Account access</p><h1>{isLogin ? `Sign in to ${APP_NAME}` : `Create your ${APP_NAME} account`}</h1><p className="panel-copy">{isLogin ? 'Continue to your review workspace.' : 'Start saving AI code reviews to your workspace.'}</p></div>
        <form className="auth-form" onSubmit={handleAuth}>
          {!isLogin && <label><span>Name</span><input value={authForm.name} onChange={event => setAuthForm({ ...authForm, name: event.target.value })} /></label>}
          <label><span>Email</span><input type="email" value={authForm.email} onChange={event => setAuthForm({ ...authForm, email: event.target.value })} /></label>
          <label><span>Password</span><input type="password" value={authForm.password} onChange={event => setAuthForm({ ...authForm, password: event.target.value })} /></label>
          <button type="submit" className="primary-button" disabled={isLoading}>{isLoading ? 'Please wait...' : isLogin ? 'Sign In' : 'Create Account'}</button>
        </form>
        <button type="button" className="text-button" onClick={() => setPublicView(isLogin ? 'register' : 'login')}>{isLogin ? 'Need an account? Create one' : 'Already have an account? Sign in'}</button>
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

  return (
    <div className="review-page">
      <PageTitle eyebrow="Reviewer" title="Analyze source code">
        <div className="toolbar">
          <label><span>Project</span><select value={props.selectedProjectId} onChange={event => props.setSelectedProjectId(event.target.value)}><option value="">No project</option>{props.projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
          <label><span>Model</span><select value={props.model} onChange={event => props.setModel(event.target.value)}>{props.models.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>
          <label><span>Depth</span><select value={props.depth} onChange={event => props.setDepth(event.target.value)}>{depthOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <button type="button" className="primary-button" onClick={props.reviewCode} disabled={props.isLoading || props.usage.remaining <= 0}>{props.isLoading ? 'Reviewing...' : 'Run Review'}</button>
        </div>
      </PageTitle>

      <section className="project-create"><input placeholder="Create project workspace" value={props.newProjectName} onChange={event => props.setNewProjectName(event.target.value)} /><button type="button" className="ghost-button" onClick={props.createProject}>Create Project</button></section>
      <section className="model-note"><strong>{selectedModel?.name}</strong><span>{selectedModel?.description}</span></section>
      <section className="source-tabs">{sourceModes.map(mode => <button key={mode.id} type="button" className={props.sourceMode === mode.id ? 'active' : ''} onClick={() => props.setSourceMode(mode.id)}>{mode.label}</button>)}</section>

      <section className="workspace">
        <div className="panel editor-panel">
          <div className="panel-header"><div><p className="eyebrow">Input</p><h2>{sourceModes.find(mode => mode.id === props.sourceMode)?.label}</h2></div><button type="button" className="ghost-button" onClick={() => props.setCode('')}>Clear</button></div>
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

function SourceInput({ sourceMode, code, setCode, files, updateFile, addFile, removeFile, githubUrl, setGithubUrl }) {
  if (sourceMode === 'github_repo') {
    return <div className="source-form"><label><span>Repository URL</span><input placeholder="https://github.com/owner/repo" value={githubUrl} onChange={event => setGithubUrl(event.target.value)} /></label><p>Reviews up to the first reviewable source files from a public repository.</p></div>
  }

  if (sourceMode === 'pull_request') {
    return <div className="source-form"><label><span>Pull request URL</span><input placeholder="https://github.com/owner/repo/pull/123" value={githubUrl} onChange={event => setGithubUrl(event.target.value)} /></label><p>Reviews changed files and patches from a public pull request.</p></div>
  }

  if (sourceMode === 'multi_file') {
    return <div className="multi-file-editor">{files.map((file, index) => <div className="file-card" key={index}><div className="file-card-header"><input value={file.path} onChange={event => updateFile(index, { path: event.target.value })} /><button type="button" className="ghost-button" onClick={() => removeFile(index)} disabled={files.length === 1}>Remove</button></div><textarea value={file.content} onChange={event => updateFile(index, { content: event.target.value })} /></div>)}<button type="button" className="ghost-button" onClick={addFile}>Add File</button></div>
  }

  return (
    <div className="code-editor">
      <Editor value={code} onValueChange={setCode} highlight={value => prism.highlight(value, prism.languages.javascript, 'javascript')} padding={16} textareaClassName="editor-textarea" preClassName="editor-preview" />
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
          <div className="source-tabs compact-tabs">{['report', 'comments', 'checklist', 'diff'].map(view => <button key={view} type="button" className={resultView === view ? 'active' : ''} onClick={() => setResultView(view)}>{view}</button>)}</div>
          {resultView === 'report' && <Markdown rehypePlugins={[rehypeHighlight]}>{review}</Markdown>}
          {resultView === 'comments' && <InlineComments comments={result.comments} />}
          {resultView === 'checklist' && <Checklist checklist={result.checklist} />}
          {resultView === 'diff' && <DiffView files={result.files} fixedFiles={result.fixedFiles} before={code} after={result.fixedCode} />}
        </div>
      )}
    </div>
  )
}

function ResultSummary({ result }) {
  return <div className="result-summary"><div className="score-card"><strong>{result.score || 0}</strong><span>Review score</span></div><SeverityBadge label="Critical" value={result.severityCounts?.critical || 0} tone="critical" /><SeverityBadge label="High" value={result.severityCounts?.high || 0} tone="high" /><SeverityBadge label="Medium" value={result.severityCounts?.medium || 0} tone="medium" /><SeverityBadge label="Low" value={result.severityCounts?.low || 0} tone="low" /></div>
}

function SeverityBadge({ label, value, tone }) {
  return <div className={`severity-card ${tone}`}><strong>{value}</strong><span>{label}</span></div>
}

function InlineComments({ comments }) {
  if (!comments?.length) return <EmptyState title="No inline comments" text="No line-level issues were returned for this review." />
  return <div className="comment-list">{comments.map((comment, index) => <article className="comment-card" key={`${comment.file}-${comment.line}-${index}`}><div><span className={`severity-pill ${comment.severity}`}>{comment.severity}</span><strong>{comment.file}:{comment.line} - {comment.title}</strong></div><p>{comment.message}</p><small>{comment.suggestion}</small></article>)}</div>
}

function Checklist({ checklist }) {
  if (!checklist?.length) return <EmptyState title="No checklist" text="The model did not return checklist items for this review." />
  return <div className="checklist">{checklist.map((item, index) => <div className={`check-item ${item.status}`} key={`${item.label}-${index}`}><strong>{item.label}</strong><span>{item.status}</span><p>{item.note}</p></div>)}</div>
}

function DiffView({ files = [], fixedFiles = [], before, after }) {
  const diffFiles = files.length ? files : [{ path: 'pasted-code.js', content: before }]
  const initialPath = diffFiles[0]?.path || fixedFiles[0]?.path || 'pasted-code.js'
  const fileSignature = diffFiles.map(file => file.path).join('|')
  const fixedSignature = fixedFiles.map(file => file.path).join('|')
  const [activePath, setActivePath] = useState(initialPath)
  const activeFile = diffFiles.find(file => file.path === activePath) || diffFiles[0]
  const fixedFile = fixedFiles.find(file => file.path === activeFile.path)
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
        <div><h3>After</h3><pre>{fixedContent || 'No fixed version was generated for this file.'}</pre></div>
      </div>
    </div>
  )
}

function HistoryPage({ reviews, loadReview }) {
  return <div className="page-stack"><PageTitle eyebrow="Reports" title="Review history" /><section className="wide-panel">{reviews.length ? <div className="history-list">{reviews.map(item => <HistoryRow key={item.id} item={item} onClick={() => loadReview(item)} />)}</div> : <EmptyState title="No saved reports" text="Completed reviews will appear here automatically." />}</section></div>
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

function SettingsPage({ theme, setTheme, user, usage, signOut }) {
  return <div className="page-stack"><PageTitle eyebrow="Preferences" title="Account settings" /><section className="settings-grid"><div className="wide-panel"><div className="section-heading"><div><h2>Profile</h2><p>Your current workspace identity.</p></div></div><dl className="detail-list"><div><dt>Name</dt><dd>{user.name}</dd></div><div><dt>Email</dt><dd>{user.email}</dd></div><div><dt>Role</dt><dd>{user.role}</dd></div><div><dt>Monthly usage</dt><dd>{usage.used}/{usage.limit}</dd></div></dl><button type="button" className="ghost-button top-space" onClick={signOut}>Sign Out</button></div><div className="wide-panel"><div className="section-heading"><div><h2>Appearance</h2><p>Choose the interface theme for this browser.</p></div></div><div className="segmented-control"><button type="button" className={theme === 'dark' ? 'active' : ''} onClick={() => setTheme('dark')}>Dark</button><button type="button" className={theme === 'light' ? 'active' : ''} onClick={() => setTheme('light')}>Light</button></div></div></section></div>
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

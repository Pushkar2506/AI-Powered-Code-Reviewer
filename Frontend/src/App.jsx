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
const TOKEN_KEY = 'reviewdesk-token'
const THEME_KEY = 'reviewdesk-theme'

const fallbackModels = [
  { id: 'gemini-3.7-flash', name: 'Gemini 3.7 Flash', description: 'Best quality for production code review.' },
]

const depthOptions = [
  { label: 'Quick', value: 'quick' },
  { label: 'Standard', value: 'standard' },
  { label: 'Deep', value: 'deep' },
]

const starterCode = `function calculateDiscount(price, percentage) {
  if (!price || !percentage) return 0
  return price - price * percentage / 100
}`

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function App() {
  const [token, setToken] = useState(() => window.localStorage.getItem(TOKEN_KEY) || '')
  const [theme, setTheme] = useState(() => window.localStorage.getItem(THEME_KEY) || 'dark')
  const [publicView, setPublicView] = useState('landing')
  const [activePage, setActivePage] = useState('dashboard')
  const [user, setUser] = useState(null)
  const [usage, setUsage] = useState({ used: 0, limit: 0, remaining: 0 })
  const [reviews, setReviews] = useState([])
  const [models, setModels] = useState(fallbackModels)
  const [adminStats, setAdminStats] = useState(null)
  const [adminUsers, setAdminUsers] = useState([])
  const [code, setCode] = useState(starterCode)
  const [review, setReview] = useState('')
  const [depth, setDepth] = useState('standard')
  const [model, setModel] = useState(fallbackModels[0].id)
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
  }, [theme])

  const signOut = useCallback(() => {
    window.localStorage.removeItem(TOKEN_KEY)
    setToken('')
    setUser(null)
    setUsage({ used: 0, limit: 0, remaining: 0 })
    setReviews([])
    setAdminStats(null)
    setAdminUsers([])
    setReview('')
    setError('')
    setNotice('')
    setPublicView('landing')
    setActivePage('dashboard')
  }, [])

  const loadAdminData = useCallback(async () => {
    const [statsResponse, usersResponse] = await Promise.all([
      api.get('/admin/stats'),
      api.get('/admin/users'),
    ])
    setAdminStats(statsResponse.data.stats)
    setAdminUsers(usersResponse.data.users)
  }, [api])

  const loadAppData = useCallback(async () => {
    try {
      const [profileResponse, reviewsResponse, modelsResponse] = await Promise.all([
        api.get('/auth/me'),
        api.get('/reviews'),
        api.get('/ai/models'),
      ])
      setUser(profileResponse.data.user)
      setUsage(profileResponse.data.usage)
      setReviews(reviewsResponse.data.reviews)
      setModels(modelsResponse.data.models)

      if (modelsResponse.data.models[0]?.id) {
        setModel(current => modelsResponse.data.models.some(item => item.id === current) ? current : modelsResponse.data.models[0].id)
      }

      if (profileResponse.data.user.role === 'admin') {
        await loadAdminData()
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

      window.localStorage.setItem(TOKEN_KEY, response.data.token)
      setToken(response.data.token)
      setUser(response.data.user)
      setActivePage('dashboard')
    } catch (error) {
      setError(error.response?.data?.error || 'Authentication failed.')
    } finally {
      setIsLoading(false)
    }
  }

  async function reviewCode() {
    const trimmedCode = code.trim()

    if (!trimmedCode) {
      setError('Please paste code before requesting a review.')
      return
    }

    setIsLoading(true)
    setError('')
    setNotice('')

    try {
      const response = await api.post('/ai/get-review', {
        code: trimmedCode,
        depth,
        model,
      })

      setReview(response.data.review)
      setUsage(response.data.usage)
      setReviews(current => [response.data.savedReview, ...current.filter(item => item.id !== response.data.savedReview.id)])
      setNotice('Review completed and saved.')
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
    setNotice('')
    await api.patch(`/admin/users/${userId}/limit`, { monthlyLimit })
    await loadAdminData()
    setNotice('User limit updated.')
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
    setReview(item.review)
    setDepth(item.depth)
    setModel(item.model)
    setError('')
    setNotice('')
    setActivePage('review')
  }

  if (!token || !user) {
    return (
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
    )
  }

  const pages = {
    dashboard: (
      <DashboardPage
        user={user}
        usage={usage}
        reviews={reviews}
        setActivePage={setActivePage}
        loadReview={loadReview}
      />
    ),
    review: (
      <ReviewPage
        code={code}
        setCode={setCode}
        review={review}
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
    admin: <AdminPage stats={adminStats} users={adminUsers} notice={notice} updateLimit={updateLimit} />,
    settings: <SettingsPage theme={theme} setTheme={setTheme} user={user} usage={usage} signOut={signOut} />,
  }

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">RD</div>
          <div>
            <strong>ReviewDesk</strong>
            <span>Code review workspace</span>
          </div>
        </div>

        <nav className="nav-list">
          {[
            ['dashboard', 'Dashboard'],
            ['review', 'Review'],
            ['history', 'History'],
            ...(user.role === 'admin' ? [['admin', 'Admin']] : []),
            ['settings', 'Settings'],
          ].map(([page, label]) => (
            <button
              key={page}
              type="button"
              className={activePage === page ? 'nav-item active' : 'nav-item'}
              onClick={() => setActivePage(page)}
            >
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

      <section className="content-shell">
        {pages[activePage]}
      </section>
    </main>
  )
}

function PublicExperience({ publicView, setPublicView, authForm, setAuthForm, handleAuth, isLoading, error, theme, setTheme }) {
  if (publicView === 'login' || publicView === 'register') {
    return (
      <AuthPage
        mode={publicView}
        setPublicView={setPublicView}
        authForm={authForm}
        setAuthForm={setAuthForm}
        handleAuth={handleAuth}
        isLoading={isLoading}
        error={error}
      />
    )
  }

  return <LandingPage setPublicView={setPublicView} theme={theme} setTheme={setTheme} />
}

function LandingPage({ setPublicView, theme, setTheme }) {
  return (
    <main className="marketing-shell">
      <header className="marketing-header">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">RD</div>
          <div>
            <strong>ReviewDesk</strong>
            <span>AI code quality platform</span>
          </div>
        </div>
        <nav className="marketing-nav">
          <a href="#features">Features</a>
          <a href="#workflow">Workflow</a>
          <a href="#security">Security</a>
        </nav>
        <div className="marketing-actions">
          <ThemeToggle theme={theme} setTheme={setTheme} compact />
          <button type="button" className="ghost-button" onClick={() => setPublicView('login')}>Sign In</button>
          <button type="button" className="primary-button" onClick={() => setPublicView('register')}>Get Started</button>
        </div>
      </header>

      <section className="hero-section">
        <div className="hero-copy">
          <p className="eyebrow">Production-ready code reviews</p>
          <h1>Review code faster with AI that understands quality, security, and maintainability.</h1>
          <p>ReviewDesk helps developers turn raw code into actionable review reports, saved history, usage controls, and admin oversight.</p>
          <div className="hero-actions">
            <button type="button" className="primary-button" onClick={() => setPublicView('register')}>Start Reviewing</button>
            <button type="button" className="ghost-button" onClick={() => setPublicView('login')}>Sign In</button>
          </div>
        </div>
        <div className="hero-product" aria-label="Product preview">
          <div className="preview-toolbar">
            <span />
            <span />
            <span />
          </div>
          <div className="preview-grid">
            <div className="preview-code">
              <span>function checkout(cart) {'{'}</span>
              <span>  return cart.total - discount</span>
              <span>{'}'}</span>
            </div>
            <div className="preview-report">
              <strong>Critical Issues</strong>
              <p>Validate discount input before applying price changes.</p>
              <strong>Suggested Fix</strong>
              <p>Add boundary checks and test coverage for empty carts.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="logo-strip" aria-label="Capabilities">
        <span>Secure Auth</span>
        <span>Usage Limits</span>
        <span>Admin Controls</span>
        <span>Database History</span>
      </section>

      <section id="features" className="marketing-section">
        <SectionTitle eyebrow="Platform" title="Everything teams expect from a professional review tool" />
        <div className="feature-grid">
          <Feature title="AI Review Reports" text="Structured Markdown feedback covering bugs, security, maintainability, tests, and fixes." />
          <Feature title="Review History" text="Every completed review is saved to PostgreSQL and available from the history page." />
          <Feature title="Model Control" text="Choose from backend-approved Gemini models directly in the review workflow." />
          <Feature title="Usage Governance" text="Monthly limits protect API spend and make team usage predictable." />
          <Feature title="Admin Panel" text="Admins can monitor workspace usage and update user limits." />
          <Feature title="Light and Dark UI" text="A polished theme system for different working environments." />
        </div>
      </section>

      <section id="workflow" className="marketing-section split-section">
        <SectionTitle eyebrow="Workflow" title="From paste to saved report in three steps" />
        <div className="steps-grid">
          <Step number="01" title="Paste Code" text="Drop a snippet into the review workspace." />
          <Step number="02" title="Choose Review Depth" text="Run quick checks or deeper production reviews." />
          <Step number="03" title="Share Results" text="Copy, download, or revisit saved reviews later." />
        </div>
      </section>

      <section id="security" className="marketing-section final-cta">
        <SectionTitle eyebrow="Governance" title="Built for safer AI usage" />
        <p>Authentication, server-side API keys, rate limits, per-user quotas, and database-backed history give the product a stronger production foundation.</p>
        <button type="button" className="primary-button" onClick={() => setPublicView('register')}>Create Account</button>
      </section>

      <footer className="marketing-footer">
        <span>ReviewDesk</span>
        <span>AI-powered code review for modern teams.</span>
      </footer>
    </main>
  )
}

function AuthPage({ mode, setPublicView, authForm, setAuthForm, handleAuth, isLoading, error }) {
  const isLogin = mode === 'login'

  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <button type="button" className="back-button" onClick={() => setPublicView('landing')}>Back</button>
        <div>
          <p className="eyebrow">Account access</p>
          <h1>{isLogin ? 'Sign in to ReviewDesk' : 'Create your ReviewDesk account'}</h1>
          <p className="panel-copy">{isLogin ? 'Continue to your review workspace.' : 'Start saving AI code reviews to your workspace.'}</p>
        </div>

        <form className="auth-form" onSubmit={handleAuth}>
          {!isLogin && (
            <label>
              <span>Name</span>
              <input value={authForm.name} onChange={event => setAuthForm({ ...authForm, name: event.target.value })} />
            </label>
          )}
          <label>
            <span>Email</span>
            <input type="email" value={authForm.email} onChange={event => setAuthForm({ ...authForm, email: event.target.value })} />
          </label>
          <label>
            <span>Password</span>
            <input type="password" value={authForm.password} onChange={event => setAuthForm({ ...authForm, password: event.target.value })} />
          </label>
          {error && <div className="alert error-alert">{error}</div>}
          <button type="submit" className="primary-button" disabled={isLoading}>
            {isLoading ? 'Please wait...' : isLogin ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        <button type="button" className="text-button" onClick={() => setPublicView(isLogin ? 'register' : 'login')}>
          {isLogin ? 'Need an account? Create one' : 'Already have an account? Sign in'}
        </button>
      </section>
    </main>
  )
}

function DashboardPage({ user, usage, reviews, setActivePage, loadReview }) {
  const latestReview = reviews[0]
  const usagePercent = usage.limit ? Math.min((usage.used / usage.limit) * 100, 100) : 0

  return (
    <div className="page-stack">
      <PageTitle eyebrow="Overview" title={`Good to see you, ${user.name}`}>
        <button type="button" className="primary-button" onClick={() => setActivePage('review')}>New Review</button>
      </PageTitle>

      <section className="metric-grid">
        <Metric label="Reviews this month" value={`${usage.used}/${usage.limit}`} />
        <Metric label="Remaining reviews" value={usage.remaining} />
        <Metric label="Saved reports" value={reviews.length} />
      </section>

      <section className="wide-panel">
        <div className="section-heading">
          <div>
            <h2>Usage</h2>
            <p>Monthly review allowance for this account.</p>
          </div>
          <span className="pill">{Math.round(usagePercent)}% used</span>
        </div>
        <div className="usage-bar"><span style={{ width: `${usagePercent}%` }} /></div>
      </section>

      <section className="wide-panel">
        <div className="section-heading">
          <div>
            <h2>Latest Review</h2>
            <p>Resume your most recent saved report.</p>
          </div>
          <button type="button" className="ghost-button" onClick={() => setActivePage('history')}>View History</button>
        </div>
        {latestReview ? <HistoryRow item={latestReview} onClick={() => loadReview(latestReview)} /> : <EmptyState title="No reviews yet" text="Run your first review to start building history." />}
      </section>
    </div>
  )
}

function ReviewPage({ code, setCode, review, error, notice, isLoading, depth, setDepth, model, setModel, models, usage, reviewCode, copyReview, downloadReview }) {
  const selectedModel = models.find(item => item.id === model) || models[0]

  return (
    <div className="review-page">
      <PageTitle eyebrow="Reviewer" title="Analyze source code">
        <div className="toolbar">
          <label>
            <span>Model</span>
            <select value={model} onChange={event => setModel(event.target.value)}>
              {models.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
            </select>
          </label>
          <label>
            <span>Depth</span>
            <select value={depth} onChange={event => setDepth(event.target.value)}>
              {depthOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <button type="button" className="primary-button" onClick={reviewCode} disabled={isLoading || usage.remaining <= 0}>
            {isLoading ? 'Reviewing...' : 'Run Review'}
          </button>
        </div>
      </PageTitle>

      <section className="model-note">
        <strong>{selectedModel?.name}</strong>
        <span>{selectedModel?.description}</span>
      </section>

      <section className="workspace">
        <div className="panel editor-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Input</p>
              <h2>Source Code</h2>
            </div>
            <button type="button" className="ghost-button" onClick={() => setCode('')}>Clear</button>
          </div>
          <div className="code-editor">
            <Editor
              value={code}
              onValueChange={setCode}
              highlight={value => prism.highlight(value, prism.languages.javascript, 'javascript')}
              padding={16}
              textareaClassName="editor-textarea"
              preClassName="editor-preview"
            />
          </div>
        </div>

        <div className="panel review-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Output</p>
              <h2>Review Results</h2>
            </div>
            <div className="result-actions">
              <button type="button" className="ghost-button" onClick={copyReview} disabled={!review}>Copy</button>
              <button type="button" className="ghost-button" onClick={downloadReview} disabled={!review}>Download</button>
            </div>
          </div>
          <div className="review-content" aria-live="polite">
            {notice && <div className="alert success-alert">{notice}</div>}
            {isLoading && <EmptyState title="Review in progress" text="Analyzing correctness, security, maintainability, and test coverage." />}
            {!isLoading && error && <EmptyState title="Review failed" text={error} tone="error" />}
            {!isLoading && !error && !review && <EmptyState title="Ready for review" text="Paste code, select review depth, and run the review." />}
            {!isLoading && !error && review && <Markdown rehypePlugins={[rehypeHighlight]}>{review}</Markdown>}
          </div>
        </div>
      </section>
    </div>
  )
}

function HistoryPage({ reviews, loadReview }) {
  return (
    <div className="page-stack">
      <PageTitle eyebrow="Reports" title="Review history" />
      <section className="wide-panel">
        {reviews.length ? (
          <div className="history-list">
            {reviews.map(item => <HistoryRow key={item.id} item={item} onClick={() => loadReview(item)} />)}
          </div>
        ) : (
          <EmptyState title="No saved reports" text="Completed reviews will appear here automatically." />
        )}
      </section>
    </div>
  )
}

function AdminPage({ stats, users, notice, updateLimit }) {
  return (
    <div className="page-stack">
      <PageTitle eyebrow="Administration" title="Workspace management" />
      {notice && <div className="alert success-alert">{notice}</div>}

      <section className="metric-grid">
        <Metric label="Total users" value={stats?.users || 0} />
        <Metric label="Total reviews" value={stats?.reviews || 0} />
        <Metric label="Reviews this month" value={stats?.reviews_this_month || 0} />
      </section>

      <section className="wide-panel">
        <div className="section-heading">
          <div>
            <h2>User Limits</h2>
            <p>Monitor workspace members and adjust monthly review quotas.</p>
          </div>
        </div>
        <div className="admin-table">
          <div className="admin-row admin-head">
            <span>User</span>
            <span>Role</span>
            <span>Usage</span>
            <span>Monthly limit</span>
            <span>Action</span>
          </div>
          {users.map(account => <AdminUserRow key={account.id} account={account} updateLimit={updateLimit} />)}
        </div>
      </section>
    </div>
  )
}

function AdminUserRow({ account, updateLimit }) {
  const [limit, setLimit] = useState(account.monthlyLimit)

  useEffect(() => {
    setLimit(account.monthlyLimit)
  }, [account.monthlyLimit])

  return (
    <div className="admin-row">
      <span>
        <strong>{account.name}</strong>
        <small>{account.email}</small>
      </span>
      <span><span className="role-pill">{account.role}</span></span>
      <span>{account.reviewsThisMonth}/{account.monthlyLimit}</span>
      <span>
        <input type="number" min="0" max="10000" value={limit} onChange={event => setLimit(event.target.value)} />
      </span>
      <span>
        <button type="button" className="ghost-button" onClick={() => updateLimit(account.id, Number(limit))}>Save</button>
      </span>
    </div>
  )
}

function SettingsPage({ theme, setTheme, user, usage, signOut }) {
  return (
    <div className="page-stack">
      <PageTitle eyebrow="Preferences" title="Account settings" />
      <section className="settings-grid">
        <div className="wide-panel">
          <div className="section-heading">
            <div>
              <h2>Profile</h2>
              <p>Your current workspace identity.</p>
            </div>
          </div>
          <dl className="detail-list">
            <div><dt>Name</dt><dd>{user.name}</dd></div>
            <div><dt>Email</dt><dd>{user.email}</dd></div>
            <div><dt>Role</dt><dd>{user.role}</dd></div>
            <div><dt>Monthly usage</dt><dd>{usage.used}/{usage.limit}</dd></div>
          </dl>
          <button type="button" className="ghost-button top-space" onClick={signOut}>Sign Out</button>
        </div>

        <div className="wide-panel">
          <div className="section-heading">
            <div>
              <h2>Appearance</h2>
              <p>Choose the interface theme for this browser.</p>
            </div>
          </div>
          <div className="segmented-control">
            <button type="button" className={theme === 'dark' ? 'active' : ''} onClick={() => setTheme('dark')}>Dark</button>
            <button type="button" className={theme === 'light' ? 'active' : ''} onClick={() => setTheme('light')}>Light</button>
          </div>
        </div>
      </section>
    </div>
  )
}

function PageTitle({ eyebrow, title, children }) {
  return (
    <header className="page-title">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
      </div>
      {children}
    </header>
  )
}

function SectionTitle({ eyebrow, title }) {
  return (
    <div className="section-title">
      <p className="eyebrow">{eyebrow}</p>
      <h2>{title}</h2>
    </div>
  )
}

function Feature({ title, text }) {
  return (
    <article className="feature-card">
      <h3>{title}</h3>
      <p>{text}</p>
    </article>
  )
}

function Step({ number, title, text }) {
  return (
    <article className="step-card">
      <span>{number}</span>
      <h3>{title}</h3>
      <p>{text}</p>
    </article>
  )
}

function Metric({ label, value }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function HistoryRow({ item, onClick }) {
  return (
    <button type="button" className="history-row" onClick={onClick}>
      <span>
        <strong>{item.model}</strong>
        <small>{formatDate(item.createdAt)} - {item.depth}</small>
      </span>
      <span>{item.code.slice(0, 180)}</span>
    </button>
  )
}

function ThemeToggle({ theme, setTheme, compact = false }) {
  return (
    <button type="button" className={compact ? 'theme-chip' : 'ghost-button'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
      Theme
    </button>
  )
}

function EmptyState({ title, text, tone = 'neutral' }) {
  return (
    <div className={`state-message ${tone === 'error' ? 'error-message' : ''}`}>
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  )
}

export default App

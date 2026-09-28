import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import {
  AlertTriangle,
  Boxes,
  Bot,
  Brain,
  CheckCircle2,
  ChevronLeft,
  Cloud,
  Code2,
  Copy,
  Cpu,
  Database,
  ExternalLink,
  File,
  Folder,
  GitBranch,
  Layers,
  Monitor,
  Network,
  Plus,
  Server,
  Smartphone,
  Sparkles,
  Terminal,
  Trash2,
  Workflow,
  XCircle,
} from 'lucide-react'
import {
  ARCHITECTURE_OPTIONS,
  GENERATION_CHECKLIST,
  IDE_TOOL_OPTIONS,
  NEXT_SDLC_COMMAND,
  PROVENANCE_LOG,
  REPO_MODEL_OPTIONS,
  TOPOLOGY_OPTIONS,
  defaultRepositories,
  defaultRepoTechnologies,
  ensurePlatformDefaults,
  githubRepoSlug,
  platformOptionsForCloud,
  workspaceRootName,
  buildDownloadStructure,
  sanitizeDownloadStructure,
} from '../wizard/defaults'
import { computeReadiness, type WizardState, type WizardStep } from '../wizard/types'
import { buildReviewIssues } from '../wizard/reviewIssues'

interface ScreenProps {
  state: WizardState
  onUpdate: (patch: Partial<WizardState>) => void
}

const TOPOLOGY_ICONS = {
  'single-app': Smartphone,
  'frontend-only': Monitor,
  'full-stack': Layers,
  'data-platform': Database,
  microservices: Network,
  'ai-ml': Brain,
} as const

const CLOUD_OPTIONS = [
  { id: 'aws', label: 'AWS', hint: 'EKS, ECS, Lambda' },
  { id: 'azure', label: 'Azure', hint: 'AKS, App Service' },
  { id: 'gcp', label: 'GCP', hint: 'GKE, Cloud Run' },
] as const

function shapeFrom(state: Pick<WizardState, 'topology' | 'repositoryModel' | 'architectureStyle'>) {
  return {
    topology: state.topology,
    repositoryModel: state.repositoryModel,
    architectureStyle: state.architectureStyle,
  }
}

function statusTone(status: string | undefined) {
  if (status === 'confirmed') return 'ok'
  if (status === 'recommendation') return 'soft'
  if (status === 'tbd') return 'warn'
  if (status === 'created' || status === 'exists') return 'ok'
  if (status === 'failed') return 'danger'
  return 'muted'
}

export function ProjectShapeScreen({ state, onUpdate }: ScreenProps) {
  const shape = shapeFrom(state)
  const suggested = defaultRepositories(state.projectName, shape)
  const topologyLabel = TOPOLOGY_OPTIONS.find((t) => t.id === state.topology)?.label
  const modelLabel = REPO_MODEL_OPTIONS.find((m) => m.id === state.repositoryModel)?.label
  const archLabel = ARCHITECTURE_OPTIONS.find((a) => a.id === state.architectureStyle)?.label

  const applyShape = (patch: Partial<WizardState>) => {
    const next = { ...state, ...patch }
    if (state.repositoriesTouched) {
      onUpdate(patch)
      return
    }
    const nextShape = shapeFrom(next)
    const repos = defaultRepositories(next.projectName, nextShape)
    onUpdate({
      ...patch,
      repositories: repos,
      repoTechnologies: defaultRepoTechnologies(repos, nextShape),
    })
  }

  return (
    <div className="screen shape-screen">
      <div className="screen-header">
        <h2>Project Shape</h2>
        <p>Choose how the product is structured.</p>
      </div>

      <div className="shape-layout">
        <div className="shape-controls">
          <section className="card shape-section">
            <div className="shape-section-head">
              <h3 className="card-title">Application topology</h3>
              <span className="shape-section-meta">What you are building</span>
            </div>
            <div className="topology-grid">
              {TOPOLOGY_OPTIONS.map((opt) => {
                const Icon = TOPOLOGY_ICONS[opt.id as keyof typeof TOPOLOGY_ICONS] ?? Boxes
                const active = state.topology === opt.id
                return (
                  <button
                    key={opt.id}
                    type="button"
                    className={`topology-card ${active ? 'active' : ''}`}
                    onClick={() => applyShape({ topology: opt.id })}
                    aria-pressed={active}
                  >
                    <span className="topo-icon" aria-hidden="true">
                      <Icon size={20} />
                    </span>
                    <span className="topo-label">{opt.label}</span>
                    {'hint' in opt && opt.hint ? <span className="topo-hint">{opt.hint}</span> : null}
                  </button>
                )
              })}
            </div>
          </section>

          <div className="setup-grid-2 shape-choice-grid">
            <section className="card shape-section">
              <div className="shape-section-head">
                <h3 className="card-title">Repository model</h3>
                <span className="shape-section-meta">How code is split</span>
              </div>
              <div className="choice-tile-list">
                {REPO_MODEL_OPTIONS.map((opt) => {
                  const active = state.repositoryModel === opt.id
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      className={`choice-tile ${active ? 'active' : ''}`}
                      onClick={() => applyShape({ repositoryModel: opt.id })}
                      aria-pressed={active}
                    >
                      <span className="choice-tile-check" aria-hidden="true">
                        {active ? <CheckCircle2 size={16} /> : <GitBranch size={16} />}
                      </span>
                      <span>
                        <strong>{opt.label}</strong>
                        {'hint' in opt && opt.hint ? <small className="option-hint">{opt.hint}</small> : null}
                      </span>
                    </button>
                  )
                })}
              </div>
            </section>

            <section className="card shape-section">
              <div className="shape-section-head">
                <h3 className="card-title">Architecture style</h3>
                <span className="shape-section-meta">Internal boundaries</span>
              </div>
              <div className="choice-tile-list">
                {ARCHITECTURE_OPTIONS.map((opt) => {
                  const active = state.architectureStyle === opt.id
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      className={`choice-tile ${active ? 'active' : ''}`}
                      onClick={() => applyShape({ architectureStyle: opt.id })}
                      aria-pressed={active}
                    >
                      <span className="choice-tile-check" aria-hidden="true">
                        {active ? <CheckCircle2 size={16} /> : <Workflow size={16} />}
                      </span>
                      <span>
                        <strong>{opt.label}</strong>
                        {'hint' in opt && opt.hint ? <small className="option-hint">{opt.hint}</small> : null}
                      </span>
                    </button>
                  )
                })}
              </div>
            </section>
          </div>

          <section className="card shape-section">
            <div className="shape-section-head">
              <h3 className="card-title">IDE &amp; platform defaults</h3>
              <span className="shape-section-meta">Not a tour — change later if needed</span>
            </div>
            <div className="platform-row">
              <div className="field-group">
                <label>Primary IDE</label>
                <select value={state.ideTool} onChange={(e) => onUpdate({ ideTool: e.target.value })}>
                  {IDE_TOOL_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id} disabled={!opt.enabled}>
                      {opt.label}{opt.enabled ? '' : ' (soon)'}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field-group">
                <label>Cloud</label>
                <select
                  value={state.cloudProvider}
                  onChange={(e) => {
                    const cloudProvider = e.target.value
                    onUpdate({
                      cloudProvider,
                      ...ensurePlatformDefaults(cloudProvider, {
                        deploymentModel: state.deploymentModel,
                        iac: state.iac,
                        secretsManagement: state.secretsManagement,
                        cicd: state.cicd,
                      }),
                    })
                  }}
                >
                  {CLOUD_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <div className="field-group">
                <label>CI/CD</label>
                <select value={state.cicd} onChange={(e) => onUpdate({ cicd: e.target.value })}>
                  {platformOptionsForCloud(state.cloudProvider).cicd.map((opt) => (
                    <option key={opt.id} value={opt.id}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </section>
        </div>

        <aside className="card shape-blueprint" aria-live="polite">
          <div className="shape-blueprint-head">
            <div>
              <p className="shape-kicker">Live blueprint</p>
              <h3>{state.projectName || 'Your project'}</h3>
            </div>
            <span className="shape-count-pill">{suggested.length} repo{suggested.length === 1 ? '' : 's'}</span>
          </div>
          <p className="shape-blueprint-summary">
            {topologyLabel} · {modelLabel} · {archLabel}
          </p>
          <ul className="shape-repo-preview">
            {suggested.map((repo, index) => (
              <li key={repo.id} style={{ '--i': index } as CSSProperties}>
                <span className="shape-repo-index">{index + 1}</span>
                <div className="shape-repo-body">
                  <code>{repo.name}</code>
                  <span className="shape-repo-purpose">{repo.purpose}</span>
                  <span className="muted">{repo.description}</span>
                </div>
              </li>
            ))}
          </ul>
          {state.repositoriesTouched ? (
            <p className="shape-lock-note">
              Repositories were edited later — changing shape here no longer rewrites that list.
            </p>
          ) : (
            <p className="shape-lock-note soft">Continue to edit planned names. Remotes are created on Ship after G-BOOTSTRAP.</p>
          )}
        </aside>
      </div>
    </div>
  )
}

export function RepositoriesScreen({
  state,
  onUpdate,
  creating,
}: ScreenProps & {
  creating?: boolean
}) {
  useEffect(() => {
    if (state.repositoriesTouched) return
    const shape = shapeFrom(state)
    const repos = defaultRepositories(state.projectName, shape)
    const current = state.repositories || []
    const unchanged =
      current.length === repos.length &&
      current.every((repo, index) => repo.id === repos[index]?.id && repo.name === repos[index]?.name)
    if (unchanged) return
    onUpdate({ repositories: repos, repoTechnologies: defaultRepoTechnologies(repos, shape) })
  }, [
    state.projectName,
    state.topology,
    state.repositoryModel,
    state.architectureStyle,
    state.repositoriesTouched,
    state.repositories,
    onUpdate,
  ])

  const repositories = state.repositories || []
  const repoTechnologies = state.repoTechnologies || []

  const markTouched = (nextRepos: WizardState['repositories']) => {
    const keptIds = new Set(nextRepos.map((repo) => repo.id))
    const existingTech = repoTechnologies.filter((tech) => keptIds.has(tech.repoId))
    const missing = nextRepos.filter((repo) => !existingTech.some((tech) => tech.repoId === repo.id))
    const shape = shapeFrom(state)
    onUpdate({
      repositories: nextRepos,
      repositoriesTouched: true,
      repoTechnologies: [...existingTech, ...defaultRepoTechnologies(missing, shape)],
    })
  }

  const updateRepo = (id: string, field: string, value: string) => {
    markTouched(repositories.map((r) => (r.id === id ? { ...r, [field]: value } : r)))
  }

  const addRepo = () => {
    const id = `repo-${Date.now()}`
    const slug = githubRepoSlug(state.projectName)
    markTouched([
      ...repositories,
      { id, name: `${slug}-service`, purpose: 'Service', description: '', owner: '', dependencies: '' },
    ])
  }

  const restoreFromShape = () => {
    const shape = shapeFrom(state)
    const repos = defaultRepositories(state.projectName, shape)
    onUpdate({
      repositories: repos,
      repositoriesTouched: false,
      repoTechnologies: defaultRepoTechnologies(repos, shape),
    })
  }

  const github = state.integrations?.find((item) => item.id === 'github')
  const githubReady = Boolean(github?.connected)
  const namedCount = repositories.filter((r) => r.name.trim()).length

  return (
    <div className="screen shape-screen">
      <div className="screen-header screen-header-row">
        <div>
          <h2>Repositories</h2>
          <p>Name the repositories for this project. Create remotes yourself when ready, then enter their URLs here.</p>
        </div>
        <div className="screen-header-actions">
          <button type="button" className="ghost-btn" onClick={restoreFromShape}>
            Reset from shape
          </button>
          <button type="button" className="secondary-btn" onClick={addRepo}>
            <Plus size={14} /> Add repository
          </button>
        </div>
      </div>

      <div className="repo-toolbar">
        <div className="repo-toolbar-stat">
          <strong>{namedCount}</strong>
          <span>named · {repositories.length} total</span>
        </div>
        <div className={`repo-github-pill ${githubReady ? 'ready' : ''}`}>
          <GitBranch size={14} />
          {githubReady
            ? `GitHub · ${github?.account ?? 'connected'}${github?.organization ? ` / ${github.organization}` : ''}`
            : 'GitHub not connected'}
        </div>
      </div>

      {repositories.length === 0 ? (
        <section className="card empty-panel">
          <Boxes size={28} />
          <h3>No repositories yet</h3>
          <p>Restore the shape suggestion or add a repository manually.</p>
          <div className="row-actions">
            <button type="button" className="primary-btn" onClick={restoreFromShape}>
              Restore from shape
            </button>
            <button type="button" className="secondary-btn" onClick={addRepo}>
              Add repository
            </button>
          </div>
        </section>
      ) : (
        <div className="repo-card-grid">
          {repositories.map((repo, index) => (
            <article key={repo.id} className="card repo-edit-card">
              <header className="repo-edit-head">
                <span className="repo-edit-index">#{index + 1}</span>
                <span className={`status-pill ${statusTone(repo.createStatus)}`}>
                  {repo.htmlUrl
                    ? repo.createStatus === 'exists'
                      ? 'Exists on GitHub'
                      : 'Connected manually'
                    : repo.createStatus === 'failed'
                      ? repo.createMessage || 'Failed'
                      : creating
                        ? 'Creating…'
                        : 'Local only'}
                </span>
                <button
                  type="button"
                  className="icon-btn"
                  title="Delete repository"
                  onClick={() => markTouched(repositories.filter((r) => r.id !== repo.id))}
                >
                  <Trash2 size={14} />
                </button>
              </header>

              <div className="repo-edit-fields">
                <label className="field-group">
                  <span>Repository name</span>
                  <input
                    className="table-input mono"
                    value={repo.name}
                    onChange={(e) => updateRepo(repo.id, 'name', e.target.value)}
                    placeholder="my-service"
                  />
                </label>
                <label className="field-group">
                  <span>Purpose / role</span>
                  <input
                    className="table-input"
                    value={repo.purpose}
                    onChange={(e) => updateRepo(repo.id, 'purpose', e.target.value)}
                    placeholder="Frontend"
                  />
                </label>
                <label className="field-group span-2">
                  <span>Description</span>
                  <input
                    className="table-input wide"
                    value={repo.description}
                    onChange={(e) => updateRepo(repo.id, 'description', e.target.value)}
                    placeholder="What this repo owns"
                  />
                </label>
                <label className="field-group">
                  <span>Owner</span>
                  <input
                    className="table-input"
                    value={repo.owner}
                    onChange={(e) => updateRepo(repo.id, 'owner', e.target.value)}
                    placeholder="Team or person"
                  />
                </label>
                <label className="field-group">
                  <span>Dependencies</span>
                  <input
                    className="table-input"
                    value={repo.dependencies}
                    onChange={(e) => updateRepo(repo.id, 'dependencies', e.target.value)}
                    placeholder="Depends on…"
                  />
                </label>
                <label className="field-group span-2">
                  <span>Repository URL (optional)</span>
                  <input
                    className="table-input wide"
                    value={repo.htmlUrl || ''}
                    onChange={(e) => updateRepo(repo.id, 'htmlUrl', e.target.value)}
                    placeholder="https://github.com/owner/repository"
                  />
                </label>
              </div>

              {repo.htmlUrl ? (
                <a className="repo-link" href={repo.htmlUrl} target="_blank" rel="noreferrer">
                  Open on GitHub <ExternalLink size={12} />
                </a>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </div>
  )
}

export function TechnologyPerRepoScreen({ state, onUpdate }: ScreenProps) {
  const shape = shapeFrom(state)
  const repositories = state.repositories || []
  const techRows = state.repoTechnologies || []

  useEffect(() => {
    const missing = repositories.filter((repo) => !techRows.some((t) => t.repoId === repo.id))
    const stale = techRows.filter((t) => !repositories.some((repo) => repo.id === t.repoId))
    if (!missing.length && !stale.length) return
    const kept = techRows.filter((t) => repositories.some((repo) => repo.id === t.repoId))
    onUpdate({
      repoTechnologies: [...kept, ...defaultRepoTechnologies(missing, shape)],
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- shape fields listed explicitly
  }, [
    state.repositories,
    state.repoTechnologies,
    state.topology,
    state.repositoryModel,
    state.architectureStyle,
    onUpdate,
  ])

  const updateTech = (repoId: string, field: string, value: string) => {
    onUpdate({
      repoTechnologies: techRows.map((t) =>
        t.repoId === repoId ? { ...t, [field]: value } : t,
      ),
    })
  }

  const confirmAll = () => {
    onUpdate({
      repoTechnologies: techRows.map((t) =>
        t.status === 'recommendation' || t.status === 'tbd' ? { ...t, status: 'confirmed' as const } : t,
      ),
    })
  }

  const pending = techRows.filter((t) => t.status !== 'confirmed').length

  return (
    <div className="screen shape-screen">
      <div className="screen-header screen-header-row">
        <div>
          <h2>Technology</h2>
          <p>Confirm the stack for each repository.</p>
        </div>
        {pending > 0 ? (
          <button type="button" className="primary-btn" onClick={confirmAll}>
            Confirm all ({pending})
          </button>
        ) : null}
      </div>

      {techRows.length === 0 ? (
        <section className="card empty-panel">
          <Cpu size={28} />
          <h3>No repositories to configure</h3>
          <p>Add repositories first, then return here to lock the stack.</p>
        </section>
      ) : (
        <div className="tech-card-grid">
          {techRows.map((tech) => {
            const repo = repositories.find((r) => r.id === tech.repoId)
            return (
              <article key={tech.repoId} className={`card tech-card status-${tech.status}`}>
                <header className="tech-card-head">
                  <div>
                    <p className="shape-kicker">Repository</p>
                    <h3>{repo?.name || tech.repoId}</h3>
                    <span className="muted">{repo?.purpose}</span>
                  </div>
                  <div className="status-seg" role="group" aria-label="Technology status">
                    {(['confirmed', 'recommendation', 'tbd'] as const).map((status) => (
                      <button
                        key={status}
                        type="button"
                        className={tech.status === status ? 'active' : ''}
                        onClick={() => updateTech(tech.repoId, 'status', status)}
                      >
                        {status === 'confirmed' ? 'Confirmed' : status === 'recommendation' ? 'Suggested' : 'TBD'}
                      </button>
                    ))}
                  </div>
                </header>
                <div className="tech-card-fields">
                  <label className="field-group">
                    <span>Language</span>
                    <input
                      className="table-input"
                      value={tech.language}
                      onChange={(e) => updateTech(tech.repoId, 'language', e.target.value)}
                    />
                  </label>
                  <label className="field-group">
                    <span>Framework / tech</span>
                    <input
                      className="table-input"
                      value={tech.framework}
                      onChange={(e) => updateTech(tech.repoId, 'framework', e.target.value)}
                    />
                  </label>
                  <label className="field-group">
                    <span>Database</span>
                    <input
                      className="table-input"
                      value={tech.database}
                      onChange={(e) => updateTech(tech.repoId, 'database', e.target.value)}
                    />
                  </label>
                  <label className="field-group">
                    <span>Build / testing</span>
                    <input
                      className="table-input"
                      value={tech.buildTool}
                      onChange={(e) => updateTech(tech.repoId, 'buildTool', e.target.value)}
                    />
                  </label>
                </div>
              </article>
            )
          })}
        </div>
      )}

      {techRows.length > 0 ? (
        <section className="card shape-section" style={{ marginTop: '1rem' }}>
          <div className="shape-section-head">
            <h3 className="card-title">Setup review</h3>
            <span className="shape-section-meta">Required before Work plan</span>
          </div>
          <p className="muted">
            Topology, repositories, and stacks below are what classify / spec / technical-plan will
            use. Changing them later clears the work plan, not scope or grooming.
          </p>
          <label className="checkbox-option" style={{ marginTop: '0.75rem' }}>
            <input
              type="checkbox"
              checked={Boolean(state.shapeAcknowledged)}
              onChange={(e) => onUpdate({ shapeAcknowledged: e.target.checked })}
            />
            I have reviewed this setup and it is ready for the work plan.
          </label>
        </section>
      ) : null}
    </div>
  )
}

const IDE_ICONS = {
  cursor: Sparkles,
  'claude-code': Terminal,
  'vscode-claude': Code2,
  'vscode-copilot': Bot,
} as const

export function IdeAndToolsScreen({ state, onUpdate }: ScreenProps) {
  const selected = IDE_TOOL_OPTIONS.find((o) => o.id === state.ideTool)

  return (
    <div className="screen shape-screen">
      <div className="screen-header">
        <h2>IDE and Tools</h2>
        <p>Choose where the team will work on this project.</p>
      </div>
      <section className="card shape-section">
        <div className="shape-section-head">
          <h3 className="card-title">Development environment</h3>
          <span className="shape-section-meta">One primary IDE</span>
        </div>
        <div className="ide-grid">
          {IDE_TOOL_OPTIONS.map((opt) => {
            const Icon = IDE_ICONS[opt.id as keyof typeof IDE_ICONS] ?? Monitor
            const isSelected = state.ideTool === opt.id
            return (
              <button
                key={opt.id}
                type="button"
                className={`ide-card ${isSelected ? 'active' : ''} ${opt.enabled ? '' : 'disabled'}`}
                disabled={!opt.enabled}
                onClick={() => opt.enabled && onUpdate({ ideTool: opt.id })}
                aria-pressed={isSelected}
              >
                {opt.id === 'cursor' && opt.enabled ? <span className="ide-badge">Recommended</span> : null}
                <span className="ide-icon">
                  <Icon size={22} />
                </span>
                <strong>{opt.label}</strong>
                <span className="ide-desc">{opt.description}</span>
                {!opt.enabled && <span className="ide-soon">Coming soon</span>}
              </button>
            )
          })}
        </div>
      </section>
      <div className="summary-cards ide-summary">
        <div className="summary-card">
          <strong>Selected</strong>
          <span>{selected?.label ?? 'None'}</span>
        </div>
        <div className="summary-card">
          <strong>Agent surface</strong>
          <span>{selected?.enabled ? 'Slash commands + Blink Chat' : 'Unavailable'}</span>
        </div>
      </div>
    </div>
  )
}

export function PlatformDeliveryScreen({ state, onUpdate }: ScreenProps) {
  const envs = ['dev', 'qa', 'staging', 'prod'] as const
  const platform = platformOptionsForCloud(state.cloudProvider)
  const envCount = envs.filter((env) => state.environments[env]).length

  useEffect(() => {
    const patch = ensurePlatformDefaults(state.cloudProvider, {
      deploymentModel: state.deploymentModel,
      iac: state.iac,
      secretsManagement: state.secretsManagement,
      cicd: state.cicd,
    })
    if (Object.keys(patch).length) onUpdate(patch)
  }, [state.cloudProvider, state.deploymentModel, state.iac, state.secretsManagement, state.cicd, onUpdate])

  return (
    <div className="screen shape-screen">
      <div className="screen-header">
        <h2>Platform &amp; Delivery</h2>
        <p>Choose cloud and how you will deliver.</p>
      </div>

      <section className="card shape-section">
        <div className="shape-section-head">
          <h3 className="card-title">Cloud provider</h3>
          <span className="shape-section-meta">Switches deployment defaults</span>
        </div>
        <div className="cloud-card-grid">
          {CLOUD_OPTIONS.map((opt) => {
            const active = state.cloudProvider === opt.id
            return (
              <button
                key={opt.id}
                type="button"
                className={`cloud-card ${active ? 'active' : ''}`}
                onClick={() => {
                  const cloudProvider = opt.id
                  onUpdate({
                    cloudProvider,
                    ...ensurePlatformDefaults(cloudProvider, {
                      deploymentModel: state.deploymentModel,
                      iac: state.iac,
                      secretsManagement: state.secretsManagement,
                      cicd: state.cicd,
                    }),
                  })
                }}
                aria-pressed={active}
              >
                <Cloud size={20} />
                <strong>{opt.label}</strong>
                <span>{opt.hint}</span>
              </button>
            )
          })}
        </div>
      </section>

      <section className="card shape-section platform-panel">
        <div className="shape-section-head">
          <h3 className="card-title">Delivery stack</h3>
          <span className="shape-section-meta">{envCount} environment{envCount === 1 ? '' : 's'} enabled</span>
        </div>

        <div className="platform-row">
          <div className="field-group">
            <label>Containerization</label>
            <select value={state.containerization} onChange={(e) => onUpdate({ containerization: e.target.value })}>
              <option value="docker">Docker</option>
              <option value="podman">Podman</option>
              <option value="none">None</option>
            </select>
          </div>
          <div className="field-group">
            <label>CI/CD</label>
            <select value={state.cicd} onChange={(e) => onUpdate({ cicd: e.target.value })}>
              {platform.cicd.map((opt) => (
                <option key={opt.id} value={opt.id}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div className="field-group">
            <label>Deployment model</label>
            <select value={state.deploymentModel} onChange={(e) => onUpdate({ deploymentModel: e.target.value })}>
              {platform.deployment.map((opt) => (
                <option key={opt.id} value={opt.id}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="platform-row">
          <div className="field-group">
            <label>Infrastructure as code</label>
            <select value={state.iac} onChange={(e) => onUpdate({ iac: e.target.value })}>
              {platform.iac.map((opt) => (
                <option key={opt.id} value={opt.id}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div className="field-group">
            <label>Secrets management</label>
            <select value={state.secretsManagement} onChange={(e) => onUpdate({ secretsManagement: e.target.value })}>
              {platform.secrets.map((opt) => (
                <option key={opt.id} value={opt.id}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div className="field-group">
            <label>Environments</label>
            <div className="env-chips">
              {envs.map((env) => (
                <button
                  key={env}
                  type="button"
                  className={`env-chip ${state.environments[env] ? 'active' : ''}`}
                  onClick={() => onUpdate({ environments: { ...state.environments, [env]: !state.environments[env] } })}
                >
                  {env.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="field-group">
          <label>Release strategy</label>
          <div className="pref-checks">
            <label className="checkbox-option">
              <input type="checkbox" checked={state.blueGreenDeploy} onChange={(e) => onUpdate({ blueGreenDeploy: e.target.checked })} />
              Blue/Green deployment
            </label>
            <label className="checkbox-option">
              <input type="checkbox" checked={state.canaryDeploy} onChange={(e) => onUpdate({ canaryDeploy: e.target.checked })} />
              Canary releases
            </label>
          </div>
        </div>
      </section>
    </div>
  )
}

export function ReviewResolveScreen({
  state,
  onNavigate,
}: {
  state: WizardState
  onNavigate: (step: WizardStep) => void
}) {
  const readiness = computeReadiness(state)
  const tech = state.repoTechnologies || []
  const confirmedCount = tech.filter((t) => t.status === 'confirmed').length
  const recommendedCount = tech.filter((t) => t.status === 'recommendation').length
  const tbdCount = tech.filter((t) => t.status === 'tbd').length
  const issues = buildReviewIssues(state)
  const blocking = issues.filter((i) => i.type === 'error' || i.type === 'warn')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const readinessCopy =
    readiness >= 90
      ? 'Ready to preview and ship.'
      : readiness >= 70
        ? 'Almost there — clear the remaining items.'
        : 'Resolve the open items before generating.'

  return (
    <div className="screen shape-screen">
      <div className="screen-header">
        <h2>Review &amp; Resolve</h2>
        <p>Check shape, stack, and delivery before you continue.</p>
      </div>

      <div className="review-status-bar">
        <div className="stat-card confirmed"><strong>{confirmedCount}</strong><span>Confirmed tech</span></div>
        <div className="stat-card recommended"><strong>{recommendedCount}</strong><span>Suggested</span></div>
        <div className="stat-card tbd"><strong>{tbdCount}</strong><span>TBD</span></div>
        <div className="stat-card missing"><strong>{blocking.length}</strong><span>Open issues</span></div>
      </div>

      <div className="review-body">
        <section className="card ref-card review-gauge-card">
          <div className="gauge-ring large" style={{ '--pct': readiness } as CSSProperties}>
            <span>{readiness}%</span>
          </div>
          <h3>Project readiness</h3>
          <p>{readinessCopy}</p>
        </section>

        <section className="card ref-card review-warnings-card">
          <h3 className="card-title">Items to resolve</h3>
          {issues.length === 0 ? (
            <div className="empty-inline">
              <CheckCircle2 size={22} />
              <div>
                <strong>All clear</strong>
                <p className="muted">No blocking gaps from shape through delivery.</p>
              </div>
            </div>
          ) : (
            <ul className="resolve-list">
              {issues.map((issue) => (
                <li key={issue.id} className={`resolve-item ${issue.type}${expandedId === issue.id ? ' expanded' : ''}`}>
                  <div className="resolve-row">
                    {issue.type === 'error' && <XCircle size={16} />}
                    {issue.type === 'warn' && <AlertTriangle size={16} />}
                    {issue.type === 'info' && <Server size={16} />}
                    <span>{issue.label}</span>
                    <button
                      type="button"
                      className="view-link"
                      onClick={() => setExpandedId((prev) => (prev === issue.id ? null : issue.id))}
                      aria-expanded={expandedId === issue.id}
                    >
                      {expandedId === issue.id ? 'Hide' : 'View'}
                    </button>
                  </div>
                  {expandedId === issue.id && (
                    <div className="resolve-detail">
                      <ul>
                        {issue.details.map((d) => (
                          <li key={d}>{d}</li>
                        ))}
                      </ul>
                      <button
                        type="button"
                        className="resolve-go-btn"
                        onClick={() => onNavigate(issue.targetStep)}
                      >
                        Go resolve →
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="card ref-card provenance-card">
        <h3 className="card-title">Latest updates</h3>
        <ul className="provenance-list">
          {PROVENANCE_LOG.map((entry, i) => (
            <li key={i}>
              <strong>{entry.who}</strong> — {entry.what}
              <span>{entry.when}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

export function ProjectPreviewScreen({ state, onGenerate, loading }: { state: WizardState; onGenerate: () => void; loading: boolean }) {
  const [tab, setTab] = useState<'overview' | 'repos' | 'stack'>('overview')
  const topologyLabel = TOPOLOGY_OPTIONS.find((t) => t.id === state.topology)?.label
  const ideLabel = IDE_TOOL_OPTIONS.find((o) => o.id === state.ideTool)?.label ?? 'Cursor'
  const stackSummary = useMemo(() => {
    const confirmed = state.repoTechnologies.filter((t) => t.status === 'confirmed' || t.status === 'recommendation')
    if (!confirmed.length) return 'No stack configured yet'
    return confirmed
      .slice(0, 3)
      .map((t) => {
        const repo = state.repositories.find((r) => r.id === t.repoId)
        return `${repo?.purpose || repo?.name || 'Repo'}: ${t.framework || t.language}`
      })
      .join(' · ')
  }, [state.repoTechnologies, state.repositories])

  return (
    <div className="screen shape-screen">
      <div className="screen-header">
        <h2>Preview</h2>
        <p>Confirm what will be generated.</p>
      </div>

      <div className="preview-hero card">
        <div>
          <p className="shape-kicker">Project</p>
          <h3>{state.projectName || 'Untitled project'}</h3>
          <p className="muted">{state.description || 'No description yet'}</p>
        </div>
        <dl className="preview-meta">
          <div><dt>Topology</dt><dd>{topologyLabel}</dd></div>
          <div><dt>Repos</dt><dd>{state.repositories.length}</dd></div>
          <div><dt>IDE</dt><dd>{ideLabel}</dd></div>
          <div><dt>Cloud</dt><dd>{state.cloudProvider.toUpperCase()}</dd></div>
        </dl>
      </div>

      <div className="tab-row">
        {(['overview', 'repos', 'stack'] as const).map((t) => (
          <button key={t} type="button" className={`tab-btn ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      <section className="card preview-panel">
        {tab === 'overview' && (
          <div className="preview-overview">
            <p><strong>Stack snapshot</strong> — {stackSummary}</p>
            <p>
              <strong>Delivery</strong> — {state.deploymentModel} · {state.cicd} · {state.iac}
              {(state.blueGreenDeploy || state.canaryDeploy) && (
                <> · {[state.blueGreenDeploy && 'Blue/Green', state.canaryDeploy && 'Canary'].filter(Boolean).join(', ')}</>
              )}
            </p>
            <p>
              <strong>Model</strong> — {state.repositoryModel.replace('-', ' ')} · {state.architectureStyle.replace('-', ' ')}
            </p>
          </div>
        )}
        {tab === 'repos' && (
          <ul className="preview-list">
            {state.repositories.map((r) => (
              <li key={r.id}>
                <code>{r.name}</code>
                <span>{r.purpose}</span>
                <span className="muted">{r.description}</span>
              </li>
            ))}
          </ul>
        )}
        {tab === 'stack' && (
          <ul className="preview-list">
            {state.repoTechnologies.map((t) => {
              const repo = state.repositories.find((r) => r.id === t.repoId)
              return (
                <li key={t.repoId}>
                  <code>{repo?.name}</code>
                  <span>{t.language} · {t.framework}</span>
                  <span className={`status-pill ${statusTone(t.status)}`}>{t.status}</span>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <div className="row-actions">
        <button type="button" className="primary-btn large" disabled={loading} onClick={onGenerate}>
          Generate kit
        </button>
      </div>
    </div>
  )
}

export function GenerationDownloadScreen({
  state,
  loading,
  onBack,
  exporting,
  onExportGithub,
}: {
  state: WizardState
  loading: boolean
  onBack?: () => void
  exporting?: boolean
  onExportGithub?: () => void
}) {
  const [copied, setCopied] = useState(false)
  const [copiedMcp, setCopiedMcp] = useState(false)

  if (!state.generationComplete && loading) {
    const steps = state.generationSteps
    const total = Math.max(steps.length, 1)
    const done = steps.filter((step) => step.status === 'done').length
    const running = steps.find((step) => step.status === 'running')
    const percent = running
      ? Math.min(99, Math.round((done / total) * 100) + Math.round(50 / total))
      : Math.round((done / total) * 100)

    return (
      <div className="screen screen-ref gen-loading">
        <h2>Generating your project…</h2>
        <p>{running?.label || 'Scaffolding repositories, configs, and SDLC structure.'}</p>
        <div className="gen-progress">
          <div className="gen-progress-copy">
            <span>{running?.label || 'Working…'}</span>
            <strong>{percent}%</strong>
          </div>
          <div
            className="gen-progress-bar"
            role="progressbar"
            aria-label="Generation progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <span className="gen-progress-bar-fill" style={{ width: `${percent}%` }} />
          </div>
        </div>
        <ul className="gen-progress-list">
          {steps.map((s) => (
            <li key={s.id} className={s.status}>{s.label}</li>
          ))}
        </ul>
      </div>
    )
  }

  if (!state.generationComplete) {
    return (
      <div className="screen screen-ref">
        <div className="screen-header">
          <h2>Generation</h2>
          <p>Generate and download the workspace.</p>
        </div>
        <section className="card ref-card"><p>Click Download Project to generate and download the workspace.</p></section>
      </div>
    )
  }

  const timeStr = state.generationTimeSec
    ? `${String(Math.floor(state.generationTimeSec / 60)).padStart(2, '0')}:${String(state.generationTimeSec % 60).padStart(2, '0')} min`
    : '00:00 min'
  const structure = sanitizeDownloadStructure(
    state.downloadStructure.length
      ? state.downloadStructure
      : buildDownloadStructure(
          state.repositoriesTouched
            ? state.repositories
            : defaultRepositories(state.projectName, shapeFrom(state)),
        ),
  )
  const nextCommand = state.nextSdlcCommand || NEXT_SDLC_COMMAND
  const github = state.integrations.find((item) => item.id === 'github')
  const githubReady = Boolean(github?.connected)
  const fileCount = state.filesGenerated > 0 ? state.filesGenerated : structure.length
  const rootName =
    state.downloadFilename?.replace(/\.zip$/i, '') || workspaceRootName(state.projectName)

  const copyCommand = async () => {
    try {
      await navigator.clipboard.writeText(nextCommand)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }

  const mcpSetupCommand =
    'Copy-Item automation_sdlc\\env.mcp.example automation_sdlc\\.env.mcp'

  const copyMcpSetup = async () => {
    try {
      await navigator.clipboard.writeText(mcpSetupCommand)
      setCopiedMcp(true)
      window.setTimeout(() => setCopiedMcp(false), 1600)
    } catch {
      setCopiedMcp(false)
    }
  }

  return (
    <div className="screen screen-ref success-screen success-screen-full">
      <div className="confetti-wrap full" aria-hidden="true">
        {Array.from({ length: 12 }).map((_, i) => (
          <span
            key={i}
            className="confetti"
            style={{ '--c': ['#5850EC', '#F472B6', '#FBBF24', '#34D399', '#60A5FA'][i % 5], '--i': i } as CSSProperties}
          />
        ))}
      </div>

      <section className="card ref-card success-card-full">
        <div className="success-grid">
          <div className="success-hero-col">
            <div className="success-badge lg">
              <CheckCircle2 size={48} strokeWidth={2.5} />
            </div>
            <h2>Your project is ready!</h2>
            <p className="success-sub">Blink has successfully generated your project.</p>

            <div className="gen-stats ref inline-stats">
              <div className="stat-block">
                <strong>{fileCount.toLocaleString()}</strong>
                <span>Files Generated</span>
              </div>
              <div className="stat-block">
                <strong>{timeStr}</strong>
                <span>Time Taken</span>
              </div>
            </div>

            <div className="next-command-box">
              <h4>Next SDLC command</h4>
              <p>Unzip the bundle, open it in Cursor, then run:</p>
              <div className="next-command-row">
                <code>{nextCommand}</code>
                <button type="button" className="ghost-btn" onClick={() => void copyCommand()}>
                  <Copy size={14} /> {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>

            <div className="next-command-box">
              <h4>MCP config in the zip</h4>
              <p>
                After unzip, open <code>{rootName}</code> in Cursor, copy the env example, then put your GitHub PAT in{' '}
                <code>GITHUB_PERSONAL_ACCESS_TOKEN</code> (and other tokens) in <code>.env.mcp</code>. Default{' '}
                <code>mcp.json</code> is already Windows-ready:
              </p>
              <div className="next-command-row">
                <code>{mcpSetupCommand}</code>
                <button type="button" className="ghost-btn" onClick={() => void copyMcpSetup()}>
                  <Copy size={14} /> {copiedMcp ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>

            {(state.setupStatus || state.setupOverlayCount > 0) && (
              <div className="next-command-box overlay-summary-box">
                <h4>Workspace overlay</h4>
                {state.setupOverlayCount > 0 ? (
                  <p>
                    Canonical setup added {state.setupOverlayCount} file{state.setupOverlayCount === 1 ? '' : 's'} under{' '}
                    <code>.cursor/ai-sdlc</code>
                    {state.setupIdentitySource
                      ? ` from ${state.setupIdentitySource === 'requirement' ? 'your requirement' : 'the project description'}.`
                      : '.'}
                  </p>
                ) : (
                  <p>Canonical workspace setup was not completed, so no download was created.</p>
                )}
                {state.setupOverlayCount > 0 && (
                  <p className="muted">
                    Context readiness: {state.setupContextReady ? 'ready' : 'needs follow-up'} · Delivery readiness:{' '}
                    {state.setupDeliveryReady ? 'ready' : 'topology confirmation required'}
                  </p>
                )}
              </div>
            )}

            <div className="success-actions row">
              <button
                type="button"
                className="secondary-btn"
                disabled={!githubReady || exporting}
                onClick={() => onExportGithub?.()}
              >
                <ExternalLink size={16} /> {exporting ? 'Creating repos…' : 'Export to GitHub'}
              </button>
              {!githubReady && (
                <span className="muted">Connect GitHub on Integrations to create repositories.</span>
              )}
            </div>

            {onBack && (
              <button type="button" className="back-dashboard" onClick={onBack}>
                <ChevronLeft size={14} /> Back to Dashboard
              </button>
            )}
          </div>

          <div className="success-summary-col">
            <div className="summary-box full">
              <h4>Generation Summary</h4>
              <ul className="checklist ref">
                {GENERATION_CHECKLIST.map((item) => (
                  <li key={item}>
                    <CheckCircle2 size={16} className="check-green" />
                    <span className="check-label">{item}</span>
                    <span className="done-tag">Completed</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="output-preview-box">
              <h4>Generated Downloaded Structure</h4>
              <div className="download-structure">
                <div className="download-structure-root">{rootName}</div>
                <ul className="download-structure-list">
                  {structure.map((entry) => (
                    <li key={`${entry.kind}-${entry.name}`} className={entry.kind}>
                      {entry.kind === 'file' ? <File size={16} /> : <Folder size={16} />}
                      <span>{entry.name}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

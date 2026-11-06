import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CheckCircle2,
  FileArchive,
  FolderOpen,
  GitBranch,
  Loader2,
  Lock,
  RefreshCw,
  Search,
  X,
} from 'lucide-react'
import { fetchGithubRepos, type GithubRepoItem } from '../api/blink'
import { pickLocalWorkspaceFolder } from '../desktop/tauriDesktop'
import { hasTauriInvoke } from '../desktop/detect'
import {
  applyExistingBind,
  existingDeliveryReady,
  parseGitRemote,
  type BoundExistingRepo,
} from '../wizard/existing'
import { extractZipRepositoryContext, upsertZipOverlay } from '../wizard/sourceZip'
import type { WizardState } from '../wizard/types'

interface Props {
  state: WizardState
  onUpdate: (patch: Partial<WizardState>) => void
}

function repoKey(repo: BoundExistingRepo): string {
  return (repo.htmlUrl || repo.name).trim().toLowerCase()
}

function repoParts(item: GithubRepoItem): { owner: string; name: string } {
  const full = (item.fullName || item.name).trim()
  const slash = full.indexOf('/')
  if (slash > 0) return { owner: full.slice(0, slash), name: full.slice(slash + 1) }
  return { owner: '', name: item.name }
}

export function ExistingSourceScreen({ state, onUpdate }: Props) {
  const zipInputRef = useRef<HTMLInputElement>(null)
  const github = state.integrations.find((item) => item.id === 'github')
  const [gitUrl, setGitUrl] = useState(state.gitRepositoryUrl)
  const [folderPath, setFolderPath] = useState(state.localFolderPath || '')
  const [repos, setRepos] = useState<GithubRepoItem[]>([])
  const [loadingRepos, setLoadingRepos] = useState(false)
  const [repoError, setRepoError] = useState<string | null>(null)
  const [repoTick, setRepoTick] = useState(0)
  const [folderError, setFolderError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const bound = useMemo<BoundExistingRepo[]>(() => {
    return (state.repositories || [])
      .filter((repo) => repo.name.trim())
      .map((repo) => ({
        name: repo.name.trim(),
        htmlUrl: repo.htmlUrl,
        description: repo.description,
        owner: repo.owner,
        purpose: repo.purpose,
      }))
  }, [state.repositories])

  const selectedKeys = useMemo(() => new Set(bound.map(repoKey)), [bound])

  useEffect(() => {
    setGitUrl(state.gitRepositoryUrl)
  }, [state.gitRepositoryUrl])

  useEffect(() => {
    setFolderPath(state.localFolderPath || '')
  }, [state.localFolderPath])

  useEffect(() => {
    if (!github?.connected) return
    let cancelled = false
    setLoadingRepos(true)
    setRepoError(null)
    const selectedOrg = github.availableOrganizations?.find((org) => org.login === github.organization)
    void fetchGithubRepos({
      projectId: state.projectId,
      token: github.token,
      organization: github.organization,
      personal: Boolean(selectedOrg?.personal) || !github.organization?.trim(),
    })
      .then((items) => {
        if (!cancelled) setRepos(items.filter((item) => !item.archived))
      })
      .catch((error) => {
        if (!cancelled) {
          setRepos([])
          setRepoError(error instanceof Error ? error.message : 'Could not list GitHub repositories.')
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingRepos(false)
      })
    return () => {
      cancelled = true
    }
  }, [github?.connected, github?.organization, github?.availableOrganizations, github?.token, state.projectId, repoTick])

  function commitBind(nextBound: BoundExistingRepo[], extras: Partial<WizardState> = {}) {
    onUpdate({
      ...applyExistingBind({ ...state, ...extras }, nextBound, extras),
      ...extras,
    })
  }

  function toggleRepo(item: GithubRepoItem) {
    const next: BoundExistingRepo = {
      name: item.name,
      htmlUrl: item.htmlUrl,
      description: item.description,
      language: item.language,
      owner: item.fullName?.split('/')[0],
    }
    const key = repoKey(next)
    const exists = selectedKeys.has(key)
    commitBind(exists ? bound.filter((repo) => repoKey(repo) !== key) : [...bound, next], {
      existingSourceMode: 'connect',
    })
  }

  function removeBound(key: string) {
    const next = bound.filter((repo) => repoKey(repo) !== key)
    commitBind(next, {
      gitRepositoryUrl: next.some((repo) => repo.htmlUrl === state.gitRepositoryUrl) ? state.gitRepositoryUrl : '',
      existingSourceMode: next.length ? 'connect' : folderPath.trim() ? 'folder' : 'none',
    })
    if (!next.some((repo) => repo.htmlUrl === gitUrl)) setGitUrl('')
  }

  function applyGitUrl(value: string) {
    setGitUrl(value)
    const parsed = parseGitRemote(value)
    const withoutGit = bound.filter((repo) => repo.htmlUrl !== state.gitRepositoryUrl)
    if (!parsed) {
      commitBind(withoutGit, { gitRepositoryUrl: value, existingSourceMode: bound.length ? 'connect' : 'none' })
      return
    }
    const next = [
      ...withoutGit.filter((repo) => repoKey(repo) !== parsed.htmlUrl.toLowerCase()),
      { name: parsed.name, htmlUrl: parsed.htmlUrl, owner: parsed.owner, purpose: 'Application' },
    ]
    commitBind(next, { gitRepositoryUrl: parsed.htmlUrl, existingSourceMode: 'git' })
  }

  async function pickFolder() {
    setFolderError(null)
    try {
      const selected = await pickLocalWorkspaceFolder(folderPath)
      if (!selected) return
      setFolderPath(selected)
      commitBind(bound, {
        localFolderPath: selected,
        existingSourceMode: bound.some((repo) => repo.htmlUrl) ? 'connect' : 'folder',
      })
    } catch (error) {
      setFolderError(error instanceof Error ? error.message : 'Could not pick a folder.')
    }
  }

  const filteredRepos = repos.filter((item) => {
    if (!query.trim()) return true
    const hay = `${item.fullName} ${item.description || ''} ${item.language || ''}`.toLowerCase()
    return hay.includes(query.trim().toLowerCase())
  })
  const deliveryReady = existingDeliveryReady({
    repositories: state.repositories,
    gitRepositoryUrl: state.gitRepositoryUrl,
    existingSourceMode: state.existingSourceMode,
  })

  return (
    <div className="screen screen-ref screen-requirements">
      <div className="screen-header">
        <h2>Bind existing</h2>
        <p>Select the GitHub repository Blink should open pull requests against.</p>
      </div>

      <section className="card ref-card req-capture-card">
        {github?.connected ? (
          <div className="bind-github">
            <div className="field-label-row">
              <label htmlFor="existingRepoSearch">GitHub repositories</label>
              <span className="shape-label-actions">
                <span className="field-count">
                  {bound.length ? `${bound.length} selected` : `${filteredRepos.length} available`}
                </span>
                <button
                  type="button"
                  className="mini-btn"
                  disabled={loadingRepos}
                  onClick={() => setRepoTick((tick) => tick + 1)}
                >
                  <RefreshCw size={11} className={loadingRepos ? 'spin' : ''} />
                  {loadingRepos ? 'Loading…' : 'Refresh'}
                </button>
              </span>
            </div>

            {bound.length ? (
              <div className="bind-selected" aria-label="Selected repositories">
                {bound.map((repo) => (
                  <span className="req-file-chip" key={repoKey(repo)}>
                    {repo.owner ? `${repo.owner}/${repo.name}` : repo.name}
                    <button
                      type="button"
                      className="req-file-chip-clear"
                      aria-label={`Remove ${repo.name}`}
                      onClick={() => removeBound(repoKey(repo))}
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}

            {loadingRepos && !repos.length ? (
              <p className="field-hint bind-loading">
                <Loader2 className="spin" size={14} /> Loading repositories…
              </p>
            ) : repoError ? (
              <p className="field-hint req-file-error" role="alert">
                {repoError} Paste a Git URL below, or{' '}
                <button type="button" className="text-btn" onClick={() => setRepoTick((tick) => tick + 1)}>
                  retry
                </button>
                .
              </p>
            ) : (
              <>
                <div className="search-wrap">
                  <Search size={14} aria-hidden />
                  <input
                    id="existingRepoSearch"
                    placeholder="Search by name or language"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </div>
                <div className="choice-tile-list bind-repo-list">
                  {filteredRepos.map((item) => {
                    const checked = selectedKeys.has(item.htmlUrl.toLowerCase())
                    const parts = repoParts(item)
                    return (
                      <button
                        key={item.htmlUrl}
                        type="button"
                        className={`choice-tile bind-repo-tile${checked ? ' active' : ''}`}
                        onClick={() => toggleRepo(item)}
                        aria-pressed={checked}
                      >
                        <span className="choice-tile-check" aria-hidden="true">
                          {checked ? <CheckCircle2 size={16} /> : <GitBranch size={16} />}
                        </span>
                        <span className="bind-repo-copy">
                          <span className="bind-repo-title">
                            {parts.owner ? <span className="bind-repo-owner">{parts.owner}/</span> : null}
                            <strong>{parts.name}</strong>
                          </span>
                          {item.description ? <small className="bind-repo-desc">{item.description}</small> : null}
                        </span>
                        <span className="bind-repo-meta">
                          {item.language ? <span className="bind-repo-pill">{item.language}</span> : null}
                          {item.privateRepo ? (
                            <span className="bind-repo-pill">
                              <Lock size={10} /> Private
                            </span>
                          ) : null}
                        </span>
                      </button>
                    )
                  })}
                </div>
                {!filteredRepos.length ? (
                  <p className="field-hint">No repositories matched this search.</p>
                ) : null}
              </>
            )}
          </div>
        ) : (
          <p className="field-hint">Connect GitHub on Integrations to pick a repository from the list.</p>
        )}

        <div className="req-existing">
          <div className="req-section-head">
            <h3>Or add another source</h3>
            <p>Paste a Git URL, or attach a ZIP / local folder for analysis.</p>
          </div>

          <div className="req-existing-grid">
            <div className="field-group">
              <label htmlFor="gitRepositoryUrl">
                <GitBranch size={12} /> Git repository
              </label>
              <input
                id="gitRepositoryUrl"
                className="full-input"
                placeholder="https://github.com/org/repo"
                value={gitUrl}
                onChange={(event) => applyGitUrl(event.target.value)}
              />
            </div>
            <div className="field-group">
              <label htmlFor="sourceZip">
                <FileArchive size={12} /> Project ZIP
              </label>
              <div className="req-zip-row">
                <button type="button" className="secondary-btn" onClick={() => zipInputRef.current?.click()}>
                  {state.sourceZipName ? 'Replace ZIP' : 'Choose ZIP'}
                </button>
                {state.sourceZipName ? (
                  <span className="req-file-chip">
                    {state.sourceZipName}
                    <button
                      type="button"
                      className="req-file-chip-clear"
                      aria-label="Remove ZIP"
                      onClick={() => {
                        if (zipInputRef.current) zipInputRef.current.value = ''
                        commitBind(bound, {
                          sourceZipName: null,
                          scopeOverlays: upsertZipOverlay(state.scopeOverlays, null),
                        })
                      }}
                    >
                      <X size={12} />
                    </button>
                  </span>
                ) : null}
                <input
                  id="sourceZip"
                  ref={zipInputRef}
                  type="file"
                  accept=".zip"
                  hidden
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (!file) return
                    commitBind(bound, { sourceZipName: file.name })
                    void extractZipRepositoryContext(file).then((zipContext) => {
                      onUpdate({ scopeOverlays: upsertZipOverlay(state.scopeOverlays, zipContext) })
                    })
                  }}
                />
              </div>
            </div>
          </div>

          <div className="field-group">
            <label htmlFor="existingFolder">
              <FolderOpen size={12} /> Local folder
            </label>
            <div className="req-zip-row">
              {hasTauriInvoke() ? (
                <button type="button" className="secondary-btn" onClick={() => void pickFolder()}>
                  Choose folder
                </button>
              ) : null}
              <input
                id="existingFolder"
                className="full-input"
                placeholder="C:\\work\\payments-api"
                value={folderPath}
                onChange={(event) => {
                  setFolderPath(event.target.value)
                  commitBind(bound, { localFolderPath: event.target.value })
                }}
              />
            </div>
            {folderError ? <p className="field-hint req-file-error">{folderError}</p> : null}
          </div>
        </div>

        {bound.length ? (
          <p className="sdlc-timeline__outcome is-inline">
            <CheckCircle2 size={16} className="check-green" />
            {deliveryReady
              ? `${bound.length} repositor${bound.length === 1 ? 'y' : 'ies'} ready — Continue when the selection looks right.`
              : 'Add a Git URL if the folder or ZIP is only a local snapshot.'}
          </p>
        ) : null}
      </section>
    </div>
  )
}

export { validateExistingSource } from '../wizard/existing'

import { AlertCircle, CheckCircle2, ExternalLink, GitPullRequest, Loader2, Plus, RefreshCw, ShieldCheck, Sparkles, Wrench } from 'lucide-react'
import { useMemo, useState } from 'react'
import { sdlcNext, streamCodexFixFindings, streamCodexPrReview } from '../api/blink'
import {
  CodexAgentConsole,
  emptyCodexConsole,
  reduceCodexEvent,
  type CodexConsoleState,
} from '../components/CodexAgentConsole'
import type { WizardState, WizardStep } from '../wizard/types'

interface Props {
  state: WizardState
  onUpdate: (patch: Partial<WizardState>) => void
  onNavigate: (step: WizardStep) => void
}

function issueId(state: WizardState): string | null {
  return state.sdlcStartIssueId || state.specification?.issueId || null
}

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function parseOwnerRepo(repository: string, url: string): { owner: string; repo: string } | null {
  const fromRepo = repository.trim()
  if (fromRepo.includes('/') && !fromRepo.includes('://')) {
    const [owner, repo] = fromRepo.split('/')
    if (owner && repo) return { owner, repo }
  }
  try {
    const path = new URL(url).pathname.replace(/^\/+|\/+$/g, '')
    const parts = path.split('/')
    if (parts.length >= 2) return { owner: parts[0], repo: parts[1].replace(/\.git$/, '') }
  } catch {
    /* ignore */
  }
  return null
}

export function ReviewPrScreen({ state, onUpdate, onNavigate }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pr, setPr] = useState({ url: '', repository: '', branch: '', candidateCommit: '' })
  const [finding, setFinding] = useState<{ summary: string; severity: 'must-fix' | 'advisory' }>({
    summary: '',
    severity: 'must-fix',
  })
  const [mergeAuthorizer, setMergeAuthorizer] = useState('')
  const [codexConsole, setCodexConsole] = useState<CodexConsoleState>(emptyCodexConsole)
  const [recommendation, setRecommendation] = useState<string | null>(null)
  const [githubCommentUrl, setGithubCommentUrl] = useState<string | null>(null)
  const [selectedFindingIds, setSelectedFindingIds] = useState<string[]>([])
  const selectedIssueId = issueId(state)

  const draftRegistered = useMemo(() => {
    const drafts = (state.draftPullRequests || [])
      .filter((item) => item.url && item.owner && item.repo)
      .map((item) => ({
        id: `draft-${item.number || item.url}`,
        issueId: selectedIssueId || '',
        url: item.url || '',
        repository: `${item.owner}/${item.repo}`,
        branch: item.branch || '',
        candidateCommit: item.sha || '',
        provider: 'GitHub',
        registeredAt: new Date().toISOString(),
        number: item.number,
        owner: item.owner,
        repo: item.repo,
      }))
    return drafts
  }, [selectedIssueId, state.draftPullRequests])

  const pullRequests = [
    ...draftRegistered,
    ...(state.registeredPullRequests || []).filter((item) => item.issueId === selectedIssueId),
  ]
  const findings = (state.reviewFindings || []).filter((item) => item.issueId === selectedIssueId)
  const openMustFix = findings.filter((item) => item.severity === 'must-fix' && item.status === 'open')
  const nextAction = state.nextSdlcCommand || null
  const mergeReady = Boolean(
    pullRequests.length &&
      !openMustFix.length &&
      nextAction?.toLowerCase().includes('merge-readiness'),
  )
  const authorizationCurrent =
    state.mergeAuthorization?.issueId === selectedIssueId ? state.mergeAuthorization : null

  const refreshNextAction = async () => {
    if (!state.projectId || !selectedIssueId) return
    setBusy(true)
    setError(null)
    try {
      const response = await sdlcNext(state.projectId, {
        requirementText: state.groomDraft || state.requirementsText,
        productScope: state.productScope,
        workClassification: state.workClassification,
        specification: state.specification,
        technicalPlan: state.technicalPlan,
        overlayFiles: state.scopeOverlays || [],
        issueId: selectedIssueId,
        groomAcknowledged: state.groomAcknowledged,
        planAcknowledged: state.planAcknowledged,
        shipPlanAcknowledged: state.shipPlanAcknowledged,
        bootstrapAcknowledged: state.bootstrapAcknowledged,
      })
      if (response.status !== 'ok') {
        throw new Error(response.message || 'The workflow did not return a next action.')
      }
      onUpdate({ nextSdlcCommand: response.nextCommand || null })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not refresh the workflow next action.')
    } finally {
      setBusy(false)
    }
  }

  const addPullRequest = () => {
    if (!selectedIssueId || !pr.url.trim() || !pr.repository.trim() || !pr.branch.trim()) return
    onUpdate({
      registeredPullRequests: [
        ...(state.registeredPullRequests || []),
        {
          id: makeId('pr'),
          issueId: selectedIssueId,
          url: pr.url.trim(),
          repository: pr.repository.trim(),
          branch: pr.branch.trim(),
          candidateCommit: pr.candidateCommit.trim(),
          provider: 'GitHub',
          registeredAt: new Date().toISOString(),
        },
      ],
    })
    setPr({ url: '', repository: '', branch: '', candidateCommit: '' })
  }

  const addFinding = () => {
    if (!selectedIssueId || !finding.summary.trim()) return
    onUpdate({
      reviewFindings: [
        ...(state.reviewFindings || []),
        {
          id: makeId('review'),
          issueId: selectedIssueId,
          summary: finding.summary.trim(),
          severity: finding.severity,
          status: 'open',
          createdAt: new Date().toISOString(),
        },
      ],
    })
    setFinding({ summary: '', severity: 'must-fix' })
  }

  const primaryPr = pullRequests[0]
  const runCodexReview = async () => {
    if (!state.projectId || !selectedIssueId || !primaryPr) return
    const parsed = parseOwnerRepo(primaryPr.repository, primaryPr.url)
    const numberMatch = primaryPr.url.match(/\/pull\/(\d+)/)
    const prNumber = 'number' in primaryPr && typeof primaryPr.number === 'number'
      ? primaryPr.number
      : numberMatch
        ? Number(numberMatch[1])
        : 0
    if (!parsed || !prNumber) {
      setError('Could not resolve owner/repo/PR number for Codex review.')
      return
    }
    setBusy(true)
    setError(null)
    setCodexConsole({ ...emptyCodexConsole(), busy: true, phase: 'provisioning' })
    try {
      const res = await streamCodexPrReview(
        state.projectId,
        {
          issueId: selectedIssueId,
          issueKey: selectedIssueId,
          owner: parsed.owner,
          repo: parsed.repo,
          prNumber,
          branch: primaryPr.branch,
          projectContext: state.productScope?.markdown || state.description || '',
          acceptanceCriteria: state.specification?.acceptanceCriteria || '',
          securityModel: '',
          workflowState: '',
        },
        {
          onThinking: (text) => setCodexConsole((prev) => reduceCodexEvent(prev, 'thinking', { text })),
          onEvent: (event, payload) => setCodexConsole((prev) => reduceCodexEvent(prev, event, payload)),
        },
      )
      setCodexConsole((prev) => reduceCodexEvent(prev, 'done', res as unknown as Record<string, unknown>))
      setRecommendation(res.recommendation || null)
      setGithubCommentUrl(res.githubCommentUrl || null)
      const mapped = (res.reviewFindings || []).map((item, index) => {
        const severityRaw = String(item.severity || item.Severity || 'advisory').toLowerCase()
        const severity = severityRaw.includes('must') || severityRaw === 'critical' || severityRaw === 'major'
          ? 'must-fix' as const
          : 'advisory' as const
        const summary = String(item.description || item.summary || item.message || `Finding ${index + 1}`)
        const fileRef = item.file_ref ? ` (${String(item.file_ref)})` : ''
        return {
          id: String(item.id || makeId('ai')),
          issueId: selectedIssueId,
          summary: `${summary}${fileRef}`,
          severity,
          status: 'open' as const,
          createdAt: new Date().toISOString(),
        }
      })
      if (mapped.length) {
        onUpdate({
          reviewFindings: [
            ...(state.reviewFindings || []).filter((item) => item.issueId !== selectedIssueId),
            ...mapped,
          ],
        })
        setSelectedFindingIds(mapped.filter((f) => f.severity === 'must-fix').map((f) => f.id))
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Codex PR review failed'
      setCodexConsole((prev) => reduceCodexEvent(prev, 'error', { message }))
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  const runFixSelected = async () => {
    if (!state.projectId || !selectedIssueId || !primaryPr || !selectedFindingIds.length) return
    const parsed = parseOwnerRepo(primaryPr.repository, primaryPr.url)
    const numberMatch = primaryPr.url.match(/\/pull\/(\d+)/)
    const prNumber = 'number' in primaryPr && typeof primaryPr.number === 'number'
      ? primaryPr.number
      : numberMatch
        ? Number(numberMatch[1])
        : 0
    if (!parsed) {
      setError('Could not resolve owner/repo for remediation.')
      return
    }
    setBusy(true)
    setError(null)
    setCodexConsole({ ...emptyCodexConsole(), busy: true, phase: 'provisioning' })
    try {
      const res = await streamCodexFixFindings(
        state.projectId,
        {
          issueId: selectedIssueId,
          owner: parsed.owner,
          repo: parsed.repo,
          branch: primaryPr.branch,
          prNumber,
          findingIds: selectedFindingIds,
          findings: findings.filter((f) => selectedFindingIds.includes(f.id)),
        },
        {
          onThinking: (text) => setCodexConsole((prev) => reduceCodexEvent(prev, 'thinking', { text })),
          onEvent: (event, payload) => setCodexConsole((prev) => reduceCodexEvent(prev, event, payload)),
        },
      )
      setCodexConsole((prev) => reduceCodexEvent(prev, 'done', res as unknown as Record<string, unknown>))
      if (res.status !== 'ok') {
        throw new Error(res.message || 'Codex remediation failed')
      }
      if (res.githubCommentUrl) setGithubCommentUrl(res.githubCommentUrl)
      onUpdate({
        reviewFindings: (state.reviewFindings || []).map((item) =>
          selectedFindingIds.includes(item.id)
            ? { ...item, status: 'resolved', resolvedAt: new Date().toISOString() }
            : item,
        ),
      })
      setSelectedFindingIds([])
      setRecommendation('NEEDS_FIXES')
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Codex remediation failed'
      setCodexConsole((prev) => reduceCodexEvent(prev, 'error', { message }))
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="screen review-pr-screen">
      {!selectedIssueId ? (
        <section className="card shape-section">
          <div className="empty-state-block">
            <h3>No active SDLC work item is recorded</h3>
            <p>Start work on a ticket in Cursor before recording pull-request or review evidence.</p>
            <button type="button" className="secondary-btn" onClick={() => onNavigate('implementation')}>
              Go to Work in Cursor <ExternalLink size={16} aria-hidden />
            </button>
          </div>
        </section>
      ) : (
        <>
          <section className="card shape-section review-pr-screen__next">
            <div className="sdlc-panel__head">
              <RefreshCw size={18} />
              <div>
                <h3>Authoritative next action</h3>
                <p className="muted">
                  Blink follows the workflow response rather than assuming whether QA or pull-request review comes first.
                </p>
              </div>
            </div>
            <code>{nextAction || 'No workflow action is recorded yet.'}</code>
            <button type="button" className="secondary-btn" disabled={busy} onClick={() => void refreshNextAction()}>
              {busy ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
              Refresh next action
            </button>
            {error ? <p className="error-text">{error}</p> : null}
          </section>

          <section className="card shape-section">
            <div className="sdlc-panel__head">
              <Sparkles size={18} />
              <div>
                <h3>Codex PR Review (AI-PR-01 / DEV-05)</h3>
                <p className="muted">Advisory only — never human merge authorization (G-PR-MERGE).</p>
              </div>
            </div>
            {recommendation ? (
              <span className={`codex-console__badge is-${recommendation.toLowerCase()}`}>
                {recommendation}
              </span>
            ) : null}
            {githubCommentUrl ? (
              <p className="muted small">
                <a href={githubCommentUrl} target="_blank" rel="noreferrer">GitHub review comment <ExternalLink size={12} /></a>
              </p>
            ) : null}
            <div className="review-pr-screen__authorization">
              <button
                type="button"
                className="primary-btn"
                disabled={busy || !primaryPr}
                onClick={() => void runCodexReview()}
              >
                {busy ? <Loader2 className="spin" size={16} /> : <Sparkles size={16} />}
                Run Codex PR Review
              </button>
              <button
                type="button"
                className="secondary-btn"
                disabled={busy || !selectedFindingIds.length || !primaryPr}
                onClick={() => void runFixSelected()}
              >
                <Wrench size={16} />
                Fix Selected Findings with Codex (DEV-10)
              </button>
            </div>
            <CodexAgentConsole
              projectId={state.projectId}
              issueId={selectedIssueId}
              state={codexConsole}
              title="Codex Cloud Agent · PR review / remediation"
            />
          </section>

          <section className="review-pr-screen__grid">
            <article className="card shape-section">
              <h3>Register pull request</h3>
              <p className="muted small">Draft PRs from implement-step appear automatically; you can also register one manually.</p>
              <div className="review-pr-screen__form">
                <input className="full-input" value={pr.url} onChange={(event) => setPr({ ...pr, url: event.target.value })} placeholder="Pull request URL" />
                <input className="full-input" value={pr.repository} onChange={(event) => setPr({ ...pr, repository: event.target.value })} placeholder="owner/repo" />
                <input className="full-input" value={pr.branch} onChange={(event) => setPr({ ...pr, branch: event.target.value })} placeholder="Feature branch" />
                <input className="full-input" value={pr.candidateCommit} onChange={(event) => setPr({ ...pr, candidateCommit: event.target.value })} placeholder="Candidate commit (optional)" />
                <button type="button" className="primary-btn" disabled={!pr.url.trim() || !pr.repository.trim() || !pr.branch.trim()} onClick={addPullRequest}>
                  <Plus size={16} /> Register PR
                </button>
              </div>
              {pullRequests.length ? (
                <ul className="review-pr-screen__list">
                  {pullRequests.map((item) => (
                    <li key={item.id}>
                      <GitPullRequest size={16} />
                      <span><strong>{item.repository}</strong> · {item.branch}{item.candidateCommit ? ` · ${item.candidateCommit}` : ''}</span>
                      <a href={item.url} target="_blank" rel="noreferrer">Open <ExternalLink size={12} /></a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </article>

            <article className="card shape-section">
              <h3>QA evidence</h3>
              <p className="muted small">Record reported QA evidence. Blink does not infer a passed status.</p>
              <select
                className="full-input"
                value={state.qaEvidence?.issueId === selectedIssueId ? state.qaEvidence.status : 'not-reported'}
                onChange={(event) => onUpdate({
                  qaEvidence: {
                    issueId: selectedIssueId,
                    status: event.target.value as NonNullable<WizardState['qaEvidence']>['status'],
                    evidence: state.qaEvidence?.issueId === selectedIssueId ? state.qaEvidence.evidence : '',
                    reportedAt: new Date().toISOString(),
                  },
                })}
              >
                <option value="not-reported">Not reported</option>
                <option value="passed">Passed (reported)</option>
                <option value="failed">Failed (reported)</option>
                <option value="not-required">Not required (reported)</option>
              </select>
              <textarea
                className="full-input"
                rows={4}
                value={state.qaEvidence?.issueId === selectedIssueId ? state.qaEvidence.evidence : ''}
                onChange={(event) => onUpdate({
                  qaEvidence: {
                    issueId: selectedIssueId,
                    status: state.qaEvidence?.issueId === selectedIssueId ? state.qaEvidence.status : 'not-reported',
                    evidence: event.target.value,
                    reportedAt: new Date().toISOString(),
                  },
                })}
                placeholder="Reported QA results, links, or evidence"
              />
            </article>
          </section>

          <section className="card shape-section">
            <h3>Review findings</h3>
            <div className="review-pr-screen__finding-form">
              <input className="full-input" value={finding.summary} onChange={(event) => setFinding({ ...finding, summary: event.target.value })} placeholder="Review finding" />
              <select className="full-input" value={finding.severity} onChange={(event) => setFinding({ ...finding, severity: event.target.value as 'must-fix' | 'advisory' })}>
                <option value="must-fix">Must fix</option>
                <option value="advisory">Advisory</option>
              </select>
              <button type="button" className="secondary-btn" disabled={!finding.summary.trim()} onClick={addFinding}>
                <Plus size={16} /> Add finding
              </button>
            </div>
            {findings.length ? (
              <ul className="review-pr-screen__findings">
                {findings.map((item) => (
                  <li key={item.id} className={item.severity === 'must-fix' && item.status === 'open' ? 'is-must-fix' : ''}>
                    {item.status === 'open' ? (
                      <label className="muted small" style={{ display: 'inline-flex', gap: '0.35rem', alignItems: 'center' }}>
                        <input
                          type="checkbox"
                          checked={selectedFindingIds.includes(item.id)}
                          onChange={(event) => {
                            setSelectedFindingIds((prev) =>
                              event.target.checked
                                ? [...prev, item.id]
                                : prev.filter((id) => id !== item.id),
                            )
                          }}
                        />
                        Fix
                      </label>
                    ) : null}
                    <span><strong>{item.severity === 'must-fix' ? 'Must fix' : 'Advisory'}:</strong> {item.summary}</span>
                    {item.status === 'open' ? (
                      <button type="button" className="ghost-btn" onClick={() => onUpdate({
                        reviewFindings: (state.reviewFindings || []).map((current) =>
                          current.id === item.id ? { ...current, status: 'resolved', resolvedAt: new Date().toISOString() } : current,
                        ),
                      })}>
                        Mark resolved
                      </button>
                    ) : <span className="review-pr-screen__resolved"><CheckCircle2 size={14} /> Resolved</span>}
                  </li>
                ))}
              </ul>
            ) : <p className="muted small">No review findings are recorded.</p>}
          </section>

          <section className={`card shape-section review-pr-screen__merge ${mergeReady ? 'is-ready' : ''}`}>
            <div className="sdlc-panel__head">
              <ShieldCheck size={18} />
              <div>
                <h3>Merge readiness and human authorization</h3>
                <p className="muted">Blink can record a human authorization only. It never performs a merge.</p>
              </div>
            </div>
            {openMustFix.length ? (
              <p className="error-text"><AlertCircle size={16} /> {openMustFix.length} must-fix item(s) still block readiness.</p>
            ) : null}
            <p className="muted small">
              {mergeReady
                ? 'The current workflow action allows merge-readiness review.'
                : 'Merge readiness remains unavailable until the workflow returns merge-readiness, a PR is registered, and must-fix items are resolved.'}
            </p>
            {authorizationCurrent ? (
              <p className="review-pr-screen__resolved"><CheckCircle2 size={15} /> Human merge authorization recorded for {authorizationCurrent.authorizedBy}.</p>
            ) : (
              <div className="review-pr-screen__authorization">
                <input className="full-input" value={mergeAuthorizer} onChange={(event) => setMergeAuthorizer(event.target.value)} placeholder="Name of human authorizer" />
                <button
                  type="button"
                  className="secondary-btn"
                  disabled={!mergeReady || !mergeAuthorizer.trim()}
                  onClick={() => onUpdate({
                    mergeAuthorization: {
                      issueId: selectedIssueId,
                      authorizedBy: mergeAuthorizer.trim(),
                      authorizedAt: new Date().toISOString(),
                    },
                  })}
                >
                  Record human merge authorization
                </button>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}

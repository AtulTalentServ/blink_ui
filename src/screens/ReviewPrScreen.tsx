import { AlertCircle, CheckCircle2, ExternalLink, GitPullRequest, Loader2, Plus, RefreshCw, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { sdlcNext } from '../api/blink'
import type { WizardState, WizardStep } from '../wizard/types'

interface Props {
  state: WizardState
  onUpdate: (patch: Partial<WizardState>) => void
  onNavigate: (step: WizardStep) => void
}

function issueId(state: WizardState): string | null {
  return state.implementationIssueId || state.sdlcStartIssueId || state.specification?.issueId || null
}

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
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
  const selectedIssueId = issueId(state)
  const acceptedResult = (state.implementationResultReviews || [])
    .filter((review) => review.issueId === selectedIssueId && review.decision === 'accepted')
    .at(-1)
  const pullRequests = (state.registeredPullRequests || []).filter((item) => item.issueId === selectedIssueId)
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

  return (
    <div className="screen review-pr-screen">
      <div className="screen-header">
        <div>
          <p className="shape-kicker">Review &amp; PR</p>
          <h2>Track review evidence before a human merge</h2>
          <p>Blink records the workflow’s next action, review evidence, and human authorization. It never merges code.</p>
        </div>
      </div>

      {!selectedIssueId ? (
        <section className="card shape-section">
          <h3>No implementation work item is selected</h3>
          <p className="muted">Return to Implementation and prepare a complete Cursor handoff first.</p>
          <button type="button" className="secondary-btn" onClick={() => onNavigate('implementation')}>
            Go to Implementation <ExternalLink size={14} aria-hidden />
          </button>
        </section>
      ) : !acceptedResult ? (
        <section className="card shape-section">
          <h3>Review the implementation result first</h3>
          <p className="muted">
            Import and accept a Cursor-reported result in Implementation before registering a pull request or review evidence.
          </p>
          <button type="button" className="secondary-btn" onClick={() => onNavigate('implementation')}>
            Review implementation result <ExternalLink size={14} aria-hidden />
          </button>
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
              {busy ? <Loader2 className="spin" size={15} /> : <RefreshCw size={15} />}
              Refresh next action
            </button>
            {error ? <p className="error-text">{error}</p> : null}
          </section>

          <section className="review-pr-screen__grid">
            <article className="card shape-section">
              <h3>Register pull request</h3>
              <p className="muted small">Record a draft or provider PR created from the reviewed implementation result.</p>
              <div className="review-pr-screen__form">
                <input className="full-input" value={pr.url} onChange={(event) => setPr({ ...pr, url: event.target.value })} placeholder="Pull request URL" />
                <input className="full-input" value={pr.repository} onChange={(event) => setPr({ ...pr, repository: event.target.value })} placeholder="Repository name" />
                <input className="full-input" value={pr.branch} onChange={(event) => setPr({ ...pr, branch: event.target.value })} placeholder="Feature branch" />
                <input className="full-input" value={pr.candidateCommit} onChange={(event) => setPr({ ...pr, candidateCommit: event.target.value })} placeholder="Candidate commit (optional)" />
                <button type="button" className="primary-btn" disabled={!pr.url.trim() || !pr.repository.trim() || !pr.branch.trim()} onClick={addPullRequest}>
                  <Plus size={15} /> Register PR
                </button>
              </div>
              {pullRequests.length ? (
                <ul className="review-pr-screen__list">
                  {pullRequests.map((item) => (
                    <li key={item.id}>
                      <GitPullRequest size={15} />
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
                <Plus size={15} /> Add finding
              </button>
            </div>
            {findings.length ? (
              <ul className="review-pr-screen__findings">
                {findings.map((item) => (
                  <li key={item.id} className={item.severity === 'must-fix' && item.status === 'open' ? 'is-must-fix' : ''}>
                    <span><strong>{item.severity === 'must-fix' ? 'Must fix' : 'Advisory'}:</strong> {item.summary}</span>
                    {item.status === 'open' ? (
                      <button type="button" className="text-btn" onClick={() => onUpdate({
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
              <p className="error-text"><AlertCircle size={15} /> {openMustFix.length} must-fix item(s) still block readiness.</p>
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

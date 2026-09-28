import { AlertCircle, CheckCircle2, ExternalLink, Rocket, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import type { ReleaseClosureState, WizardState, WizardStep } from '../wizard/types'

interface Props {
  state: WizardState
  onUpdate: (patch: Partial<WizardState>) => void
  onNavigate: (step: WizardStep) => void
}

function issueId(state: WizardState): string | null {
  return state.implementationIssueId || state.sdlcStartIssueId || state.specification?.issueId || null
}

function blankRelease(issue: string): ReleaseClosureState {
  return {
    issueId: issue,
    humanMerge: null,
    deploymentRequired: false,
    deployment: { status: 'not-required', approvedBy: '', approvedAt: '', evidence: '' },
    monitoring: { status: 'not-reported', evidence: '', blocker: '', reportedAt: '' },
    closure: null,
  }
}

export function ReleaseClosureScreen({ state, onUpdate, onNavigate }: Props) {
  const selectedIssueId = issueId(state)
  const current = selectedIssueId && state.releaseClosure?.issueId === selectedIssueId
    ? state.releaseClosure
    : selectedIssueId
      ? blankRelease(selectedIssueId)
      : null
  const [mergeBy, setMergeBy] = useState('')
  const [mergeEvidence, setMergeEvidence] = useState('')
  const [mergeCommit, setMergeCommit] = useState('')
  const [deployBy, setDeployBy] = useState('')
  const [closeBy, setCloseBy] = useState('')

  if (!selectedIssueId || !current) {
    return (
      <div className="screen release-screen">
        <section className="card shape-section">
          <h2>No implementation work item is selected</h2>
          <p className="muted">Complete Review &amp; PR evidence before recording a release or closure.</p>
          <button type="button" className="secondary-btn" onClick={() => onNavigate('review-pr')}>
            Go to Review &amp; PR <ExternalLink size={14} aria-hidden />
          </button>
        </section>
      </div>
    )
  }

  const humanMerge = current.humanMerge
  const deployment = current.deployment || { status: 'not-reported' as const, approvedBy: '', approvedAt: '', evidence: '' }
  const monitoring = current.monitoring || { status: 'not-reported' as const, evidence: '', blocker: '', reportedAt: '' }
  const deploymentSatisfied =
    !current.deploymentRequired ||
    (deployment.status === 'deployed' && Boolean(deployment.approvedBy.trim()) && Boolean(deployment.evidence.trim())) ||
    deployment.status === 'not-required'
  const monitoringSatisfied = monitoring.status === 'healthy' && Boolean(monitoring.evidence.trim())
  const closureEligible = Boolean(humanMerge && deploymentSatisfied && monitoringSatisfied)

  const update = (patch: Partial<ReleaseClosureState>) => onUpdate({
    releaseClosure: { ...current, ...patch },
  })

  return (
    <div className="screen release-screen">
      <div className="screen-header">
        <div>
          <p className="shape-kicker">Release</p>
          <h2>Record release evidence and closure</h2>
          <p>Merge, deployment, verification, and closure are separate human-recorded events. Blink performs none of them.</p>
        </div>
        <Rocket size={28} aria-hidden />
      </div>

      <section className={`release-screen__summary ${current.closure ? 'is-closed' : ''}`}>
        {current.closure ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
        <div>
          <strong>{current.closure ? 'Work item closed' : 'Closure evidence is still required'}</strong>
          <p>
            {current.closure
              ? `Closed by ${current.closure.closedBy} at ${new Date(current.closure.closedAt).toLocaleString()}.`
              : 'Record actual merge, deployment or verification evidence, and monitoring status before closing the work item.'}
          </p>
        </div>
      </section>

      <section className="release-screen__grid">
        <article className={`card shape-section ${humanMerge ? 'is-done' : ''}`}>
          <div className="sdlc-panel__head">
            <ShieldCheck size={18} />
            <div>
              <h3>Human merge result</h3>
              <p className="muted">A prior authorization is not proof that a merge happened.</p>
            </div>
            {humanMerge ? <CheckCircle2 className="ok" size={18} /> : null}
          </div>
          {humanMerge ? (
            <p className="muted small">
              Merged by {humanMerge.mergedBy} · {new Date(humanMerge.mergedAt).toLocaleString()}
              {humanMerge.commit ? ` · ${humanMerge.commit}` : ''}
            </p>
          ) : (
            <div className="release-screen__form">
              <input className="full-input" value={mergeBy} onChange={(event) => setMergeBy(event.target.value)} placeholder="Name of person who merged" />
              <input className="full-input" value={mergeEvidence} onChange={(event) => setMergeEvidence(event.target.value)} placeholder="Merge URL or evidence" />
              <input className="full-input" value={mergeCommit} onChange={(event) => setMergeCommit(event.target.value)} placeholder="Merged commit (optional)" />
              <button
                type="button"
                className="primary-btn"
                disabled={!mergeBy.trim() || !mergeEvidence.trim()}
                onClick={() => update({
                  humanMerge: {
                    mergedBy: mergeBy.trim(),
                    mergedAt: new Date().toISOString(),
                    evidenceUrl: mergeEvidence.trim(),
                    commit: mergeCommit.trim(),
                  },
                })}
              >
                Record human merge result
              </button>
            </div>
          )}
        </article>

        <article className={`card shape-section ${deploymentSatisfied ? 'is-done' : ''}`}>
          <div className="sdlc-panel__head">
            <Rocket size={18} />
            <div>
              <h3>Deployment and verification</h3>
              <p className="muted">Deployment is never inferred from a merge.</p>
            </div>
            {deploymentSatisfied ? <CheckCircle2 className="ok" size={18} /> : null}
          </div>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={current.deploymentRequired}
              onChange={(event) => update({
                deploymentRequired: event.target.checked,
                deployment: event.target.checked
                  ? { ...deployment, status: deployment.status === 'not-required' ? 'not-reported' : deployment.status }
                  : { ...deployment, status: 'not-required' },
              })}
            />
            <span>Deployment is required for this work item</span>
          </label>
          <select
            className="full-input"
            value={deployment.status}
            disabled={!current.deploymentRequired}
            onChange={(event) => update({
              deployment: {
                ...deployment,
                status: event.target.value as typeof deployment.status,
                approvedAt: new Date().toISOString(),
                approvedBy: deployBy || deployment.approvedBy,
              },
            })}
          >
            <option value="not-reported">Not reported</option>
            <option value="deployed">Deployed (human reported)</option>
            <option value="failed">Deployment failed (reported)</option>
            <option value="not-required">Not required</option>
          </select>
          {current.deploymentRequired ? (
            <div className="release-screen__form">
              <input className="full-input" value={deployBy} onChange={(event) => setDeployBy(event.target.value)} placeholder="Name of deployment approver/reporter" />
              <textarea
                className="full-input"
                rows={3}
                value={deployment.evidence}
                onChange={(event) => update({ deployment: { ...deployment, evidence: event.target.value } })}
                placeholder="Deployment or release-verification evidence"
              />
            </div>
          ) : null}
        </article>

        <article className={`card shape-section ${monitoringSatisfied ? 'is-done' : ''}`}>
          <div className="sdlc-panel__head">
            <CheckCircle2 size={18} />
            <div>
              <h3>Monitoring and post-release status</h3>
              <p className="muted">A post-release blocker prevents closure.</p>
            </div>
            {monitoringSatisfied ? <CheckCircle2 className="ok" size={18} /> : null}
          </div>
          <select
            className="full-input"
            value={monitoring.status}
            onChange={(event) => update({
              monitoring: {
                ...monitoring,
                status: event.target.value as typeof monitoring.status,
                reportedAt: new Date().toISOString(),
              },
            })}
          >
            <option value="not-reported">Not reported</option>
            <option value="healthy">Healthy / verification passed</option>
            <option value="blocker">Post-release blocker</option>
          </select>
          <textarea
            className="full-input"
            rows={3}
            value={monitoring.status === 'blocker' ? monitoring.blocker : monitoring.evidence}
            onChange={(event) => update({
              monitoring: monitoring.status === 'blocker'
                ? { ...monitoring, blocker: event.target.value }
                : { ...monitoring, evidence: event.target.value },
            })}
            placeholder={monitoring.status === 'blocker' ? 'Describe the post-release blocker' : 'Monitoring or verification evidence'}
          />
        </article>
      </section>

      <section className={`card shape-section release-screen__closure ${closureEligible ? 'is-ready' : ''}`}>
        <h3>Closure</h3>
        <p className="muted">
          {closureEligible
            ? 'All required release evidence is present. A human may record closure.'
            : 'Closure requires a human-recorded merge, satisfied deployment requirements, and healthy monitoring or verification.'}
        </p>
        {monitoring.status === 'blocker' && monitoring.blocker ? (
          <p className="error-text"><AlertCircle size={15} /> {monitoring.blocker}</p>
        ) : null}
        {current.closure ? (
          <p className="release-screen__closed"><CheckCircle2 size={16} /> Closed by {current.closure.closedBy}.</p>
        ) : (
          <div className="release-screen__form">
            <input className="full-input" value={closeBy} onChange={(event) => setCloseBy(event.target.value)} placeholder="Name of person closing the work item" />
            <button
              type="button"
              className="primary-btn"
              disabled={!closureEligible || !closeBy.trim()}
              onClick={() => update({
                closure: {
                  closedBy: closeBy.trim(),
                  closedAt: new Date().toISOString(),
                },
              })}
            >
              Record final closure
            </button>
          </div>
        )}
      </section>
    </div>
  )
}

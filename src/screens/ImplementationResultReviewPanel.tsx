import { AlertCircle, CheckCircle2, ExternalLink, FileSearch, GitBranch, RotateCcw, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { stageLabel } from '../wizard/implementationProgress'
import type { ImplementationHandoff } from '../wizard/implementationHandoff'
import type { ImplementationProgressReport, WizardState } from '../wizard/types'

interface Props {
  state: WizardState
  handoff: ImplementationHandoff
  onUpdate: (patch: Partial<WizardState>) => void
}

function List({ values, empty }: { values: string[]; empty: string }) {
  return values.length ? (
    <ul className="result-review__list">
      {values.map((value, index) => <li key={`${value}-${index}`}>{value}</li>)}
    </ul>
  ) : <p className="muted small">{empty}</p>
}

function ReportSummary({ report }: { report: ImplementationProgressReport }) {
  return (
    <div className="result-review__summary">
      <div>
        <strong>{report.repositories.length}</strong>
        <span>repositories</span>
      </div>
      <div>
        <strong>{report.changedFiles.length}</strong>
        <span>files reported</span>
      </div>
      <div>
        <strong>{report.validation.length}</strong>
        <span>validation entries</span>
      </div>
    </div>
  )
}

export function ImplementationResultReviewPanel({ state, handoff, onUpdate }: Props) {
  const reports = (state.implementationProgressHistory || [])
    .filter((report) => report.issueId === handoff.workItem.id)
    .slice()
    .reverse()
  const [reportId, setReportId] = useState(reports[0]?.id || '')
  const [feedback, setFeedback] = useState('')
  const report = reports.find((item) => item.id === reportId) || reports[0]
  const review = (state.implementationResultReviews || [])
    .filter((item) => item.reportId === report?.id)
    .at(-1)
  const repositoryLinks = new Map(state.repositories.map((repository) => [repository.name, repository.htmlUrl]))

  const saveReview = (decision: 'accepted' | 'revision-requested') => {
    if (!report) return
    onUpdate({
      implementationResultReviews: [
        ...(state.implementationResultReviews || []),
        {
          reportId: report.id,
          issueId: handoff.workItem.id,
          readinessDigest: state.implementationReadinessDigest || '',
          decision,
          feedback: feedback.trim(),
          decidedAt: new Date().toISOString(),
        },
      ],
    })
    setFeedback('')
  }

  return (
    <section className="card shape-section result-review">
      <div className="sdlc-panel__head">
        <FileSearch size={18} />
        <div>
          <h3>Implementation result review</h3>
          <p className="muted">
            Review the evidence Cursor reported before moving to Review &amp; PR. Blink does not verify source changes
            or validation automatically in this phase.
          </p>
        </div>
      </div>

      {!report ? (
        <p className="muted small">Import a Cursor result above before reviewing implementation evidence.</p>
      ) : (
        <>
          {reports.length > 1 ? (
            <label className="field-label result-review__select">
              <span>Cursor result to review</span>
              <select className="full-input" value={report.id} onChange={(event) => setReportId(event.target.value)}>
                {reports.map((item) => (
                  <option key={item.id} value={item.id}>
                    {stageLabel(item.stage)} · {new Date(item.reportedAt).toLocaleString()}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <div className={`result-review__report-head ${report.stage === 'blocked' ? 'is-blocked' : ''}`}>
            {report.stage === 'blocked' ? <AlertCircle size={19} /> : <CheckCircle2 size={19} />}
            <div>
              <p className="shape-kicker">Cursor-reported result</p>
              <h4>{stageLabel(report.stage)}</h4>
            </div>
            {review ? <span className={`result-review__decision is-${review.decision}`}>{review.decision === 'accepted' ? 'Accepted' : 'Revision requested'}</span> : null}
          </div>
          <ReportSummary report={report} />

          <div className="result-review__grid">
            <section>
              <h5><GitBranch size={15} /> Repositories, branches, and commits</h5>
              {report.repositories.length ? (
                <ul className="result-review__list">
                  {report.repositories.map((repository) => {
                    const url = repositoryLinks.get(repository.name)
                    return (
                      <li key={`${repository.name}-${repository.branch || ''}`}>
                        <strong>{repository.name}</strong>
                        {repository.branch ? ` · ${repository.branch}` : ''}
                        {repository.commits?.length ? ` · ${repository.commits.join(', ')}` : ''}
                        {url ? (
                          <>
                            {' · '}
                            <a href={url} target="_blank" rel="noreferrer">Open repository <ExternalLink size={12} /></a>
                          </>
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              ) : <p className="muted small">No repository or branch evidence was reported.</p>}
            </section>
            <section>
              <h5>Changed files</h5>
              <List values={report.changedFiles} empty="No changed files were reported." />
            </section>
            <section>
              <h5><ShieldCheck size={15} /> Validation reported by Cursor</h5>
              <List values={report.validation} empty="Cursor did not report validation." />
            </section>
            <section>
              <h5>Acceptance-criteria coverage</h5>
              {handoff.acceptanceCriteria.length ? (
                <ul className="result-review__criteria">
                  {handoff.acceptanceCriteria.map((criterion) => {
                    const covered = report.acceptanceCriteriaCovered.includes(criterion)
                    return (
                      <li key={criterion} className={covered ? 'is-covered' : 'is-uncovered'}>
                        {covered ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                        <span>{criterion}</span>
                      </li>
                    )
                  })}
                </ul>
              ) : <p className="muted small">No acceptance criteria were recorded in the handoff.</p>}
              {!report.acceptanceCriteriaCovered.length ? (
                <p className="muted small">Cursor did not report acceptance-criteria coverage.</p>
              ) : null}
            </section>
          </div>

          <section className="result-review__deviations">
            <h5><AlertCircle size={15} /> Plan deviations and remaining blockers</h5>
            <div>
              <strong>Deviations</strong>
              <List values={report.deviations} empty="No deviations were reported." />
            </div>
            <div>
              <strong>Blockers</strong>
              <List values={report.blockers} empty="No blockers were reported." />
            </div>
          </section>

          {!review ? (
            <section className="result-review__decision-form">
              <label className="field-label">
                <span>Review note (optional for acceptance; required for revision)</span>
                <textarea
                  className="full-input"
                  rows={3}
                  value={feedback}
                  onChange={(event) => setFeedback(event.target.value)}
                  placeholder="Explain what Cursor should revise, if anything"
                />
              </label>
              <div className="result-review__actions">
                <button
                  type="button"
                  className="primary-btn"
                  disabled={Boolean(report.blockers.length)}
                  onClick={() => saveReview('accepted')}
                >
                  <CheckCircle2 size={15} /> Accept reported result
                </button>
                <button
                  type="button"
                  className="secondary-btn"
                  disabled={!feedback.trim()}
                  onClick={() => saveReview('revision-requested')}
                >
                  <RotateCcw size={15} /> Return for revision
                </button>
              </div>
              {report.blockers.length ? (
                <p className="muted small">Resolve or import evidence resolving the reported blockers before accepting this result.</p>
              ) : null}
            </section>
          ) : (
            <p className="muted small">
              {review.decision === 'accepted'
                ? `Accepted ${new Date(review.decidedAt).toLocaleString()}.`
                : `Revision requested ${new Date(review.decidedAt).toLocaleString()}. Import the corrected Cursor result to review it separately.`}
              {review.feedback ? ` Note: ${review.feedback}` : ''}
            </p>
          )}
        </>
      )}
    </section>
  )
}

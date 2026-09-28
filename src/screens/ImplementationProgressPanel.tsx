import { AlertCircle, CheckCircle2, ClipboardPaste, Copy, FileCode2, LoaderCircle, MapPin, PlayCircle } from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  importProgressResult,
  progressResultTemplate,
  stageLabel,
} from '../wizard/implementationProgress'
import type { ImplementationHandoff } from '../wizard/implementationHandoff'
import type { WizardState } from '../wizard/types'

interface Props {
  state: WizardState
  handoff: ImplementationHandoff
  onUpdate: (patch: Partial<WizardState>) => void
}

function List({ values, empty }: { values: string[]; empty: string }) {
  return values.length ? (
    <ul className="implementation-progress__list">
      {values.map((value, index) => <li key={`${value}-${index}`}>{value}</li>)}
    </ul>
  ) : <p className="muted small">{empty}</p>
}

export function ImplementationProgressPanel({ state, handoff, onUpdate }: Props) {
  const [resultText, setResultText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const plan = state.implementationExecutionPlan
  const acceptedPlan =
    plan?.stage === 'accepted' &&
    plan.issueId === handoff.workItem.id &&
    plan.readinessDigest === state.implementationReadinessDigest
      ? plan
      : null
  const planAccepted = Boolean(acceptedPlan)
  const template = useMemo(
    () => (acceptedPlan ? progressResultTemplate(handoff.workItem.id, acceptedPlan) : ''),
    [acceptedPlan, handoff.workItem.id],
  )
  const history = (state.implementationProgressHistory || [])
    .filter((report) => report.issueId === handoff.workItem.id)
    .slice()
    .reverse()
  const latest = history[0]

  const copyTemplate = async () => {
    try {
      await navigator.clipboard.writeText(template)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }

  const importResult = () => {
    const imported = importProgressResult(resultText, handoff.workItem.id)
    if ('error' in imported) {
      setError(imported.error)
      return
    }
    onUpdate({
      implementationProgressHistory: [
        ...(state.implementationProgressHistory || []),
        imported.report,
      ],
    })
    setResultText('')
    setError(null)
  }

  return (
    <section className="card shape-section implementation-progress">
      <div className="sdlc-panel__head">
        <LoaderCircle size={18} />
        <div>
          <h3>Implementation progress</h3>
          <p className="muted">
            Blink shows only structured progress Cursor reports back. Imported results are kept as history and never
            overwrite earlier evidence.
          </p>
        </div>
      </div>

      {!planAccepted ? (
        <p className="muted small">Accept the current implementation step plan before importing Cursor progress.</p>
      ) : (
        <>
          {!latest ? (
            <div className="implementation-progress__waiting">
              <PlayCircle size={18} aria-hidden />
              <div>
                <strong>Waiting to start</strong>
                <p className="muted small">
                  The execution plan is accepted. Cursor has not reported implementation progress yet.
                </p>
              </div>
            </div>
          ) : (
            <article className={`implementation-progress__latest is-${latest.stage}`}>
              <div className="implementation-progress__latest-head">
                {latest.stage === 'blocked' ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
                <div>
                  <p className="shape-kicker">Latest Cursor report</p>
                  <h4>{stageLabel(latest.stage)}</h4>
                </div>
              </div>
              <p className="implementation-progress__next-action">
                <strong>Recommended next action:</strong> {latest.recommendedNextAction}
              </p>
              <div className="implementation-progress__details">
                <div>
                  <h5>Current step</h5>
                  <p>{latest.currentStepId || 'Not reported'}</p>
                </div>
                <div>
                  <h5>Completed step</h5>
                  <p>{latest.completedStepId || 'Not reported'}</p>
                </div>
                <div>
                  <h5>Reported</h5>
                  <p>{new Date(latest.reportedAt).toLocaleString()}</p>
                </div>
              </div>
              {latest.blockers.length ? (
                <div className="implementation-progress__blockers">
                  <h5><AlertCircle size={15} /> Blockers requiring attention</h5>
                  <List values={latest.blockers} empty="" />
                </div>
              ) : null}
              <div className="implementation-progress__evidence">
                <div>
                  <h5><MapPin size={15} /> Repositories and branches</h5>
                  {latest.repositories.length ? (
                    <ul className="implementation-progress__list">
                      {latest.repositories.map((repository) => (
                        <li key={`${repository.name}-${repository.branch || ''}`}>
                          {repository.name}{repository.branch ? ` · ${repository.branch}` : ''}
                          {repository.commits?.length ? ` · ${repository.commits.join(', ')}` : ''}
                        </li>
                      ))}
                    </ul>
                  ) : <p className="muted small">Not reported.</p>}
                </div>
                <div>
                  <h5><FileCode2 size={15} /> Changed files</h5>
                  <List values={latest.changedFiles} empty="Not reported." />
                </div>
                <div>
                  <h5>Validation reported</h5>
                  <List values={latest.validation} empty="No validation was reported." />
                </div>
                <div>
                  <h5>Plan deviations</h5>
                  <List values={latest.deviations} empty="No deviations were reported." />
                </div>
              </div>
            </article>
          )}

          <div className="implementation-progress__import">
            <div>
              <h4>Import a Cursor result</h4>
              <p className="muted small">
                Copy the template to Cursor, ask it to fill only factual progress, then paste the JSON result here.
              </p>
            </div>
            <div className="implementation-progress__actions">
              <button type="button" className="secondary-btn" onClick={() => void copyTemplate()}>
                <Copy size={15} /> {copied ? 'Copied result template' : 'Copy result template'}
              </button>
            </div>
            <textarea
              className="full-input implementation-progress__textarea"
              rows={10}
              value={resultText}
              onChange={(event) => setResultText(event.target.value)}
              placeholder="Paste the Cursor result JSON here"
              aria-label="Cursor result JSON"
            />
            <button type="button" className="primary-btn" disabled={!resultText.trim()} onClick={importResult}>
              <ClipboardPaste size={15} /> Import Cursor result
            </button>
            {error ? <p className="error-text">{error}</p> : null}
          </div>

          {history.length > 1 ? (
            <section className="implementation-progress__history">
              <h4>Earlier reports</h4>
              <ol>
                {history.slice(1).map((report) => (
                  <li key={report.id}>
                    <strong>{stageLabel(report.stage)}</strong> · {new Date(report.reportedAt).toLocaleString()} ·{' '}
                    {report.recommendedNextAction}
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </>
      )}
    </section>
  )
}

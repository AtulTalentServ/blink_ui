import { AlertCircle, CheckCircle2, ClipboardCheck, ExternalLink, ListChecks, RotateCcw } from 'lucide-react'
import {
  buildExecutionPlan,
  executionPlanIsCurrent,
} from '../wizard/implementationExecutionPlan'
import type { ImplementationHandoff } from '../wizard/implementationHandoff'
import type { WizardState, WizardStep } from '../wizard/types'

interface Props {
  state: WizardState
  handoff: ImplementationHandoff
  onUpdate: (patch: Partial<WizardState>) => void
  onNavigate: (step: WizardStep) => void
}

export function ExecutionPlanPanel({ state, handoff, onUpdate, onNavigate }: Props) {
  const started =
    state.implementationHandoffStartedDigest === state.implementationReadinessDigest &&
    Boolean(state.implementationHandoffStartedAt)
  const storedPlan = executionPlanIsCurrent(
    state.implementationExecutionPlan,
    handoff.workItem.id,
    state.implementationReadinessDigest,
  )
    && state.implementationExecutionPlan?.stage !== 'returned-to-work-plan'
    ? state.implementationExecutionPlan
    : null
  const plan = storedPlan || buildExecutionPlan(handoff, state.implementationReadinessDigest || '')
  const repositoryById = new Map(handoff.repositories.map((repository) => [repository.id, repository]))
  const isAccepted = plan.stage === 'accepted'
  const canReview = started && plan.stage === 'ready-for-review'

  return (
    <section className="card shape-section execution-plan">
      <div className="sdlc-panel__head">
        <ListChecks size={18} />
        <div>
          <h3>Implementation step plan</h3>
          <p className="muted">
            Blink translates the approved technical plan into a reviewable execution sequence. Cursor must confirm this
            sequence before code changes begin.
          </p>
        </div>
      </div>

      {!started ? (
        <p className="muted small">Start the Cursor handoff above before reviewing the execution sequence.</p>
      ) : (
        <>
          <div className={`execution-plan__status ${isAccepted ? 'is-accepted' : ''}`}>
            {isAccepted ? <CheckCircle2 size={17} aria-hidden /> : <AlertCircle size={17} aria-hidden />}
            <span>
              {isAccepted
                ? 'Execution plan accepted'
                : plan.stage === 'ready-for-review'
                  ? 'Cursor step planning reported — ready for your review'
                  : 'Awaiting Cursor confirmation of the step sequence'}
            </span>
          </div>

          <ol className="execution-plan__steps">
            {plan.steps.map((step, index) => (
              <li key={step.id}>
                <div className="execution-plan__step-index">{index + 1}</div>
                <div>
                  <h4>{step.title}</h4>
                  {step.detail ? <p className="muted">{step.detail}</p> : null}
                  <p className="execution-plan__meta">
                    <strong>Repositories:</strong>{' '}
                    {step.repositoryIds.length
                      ? step.repositoryIds.map((id) => repositoryById.get(id)?.name || id).join(', ')
                      : 'Cursor must identify the affected repository.'}
                  </p>
                  <p className="execution-plan__meta">
                    <strong>Acceptance criteria:</strong>{' '}
                    {step.acceptanceCriteria.length
                      ? step.acceptanceCriteria.join(' · ')
                      : 'Cursor must confirm coverage against the approved acceptance criteria.'}
                  </p>
                  {step.dependencies.length ? (
                    <p className="execution-plan__meta">
                      <strong>Depends on:</strong> {step.dependencies.join(', ')}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>

          {!isAccepted ? (
            <div className="execution-plan__actions">
              {plan.stage === 'awaiting-cursor-confirmation' ? (
                <button
                  type="button"
                  className="primary-btn"
                  onClick={() => onUpdate({
                    implementationExecutionPlan: {
                      ...plan,
                      stage: 'ready-for-review',
                      cursorPlanningReportedAt: new Date().toISOString(),
                    },
                  })}
                >
                  <ClipboardCheck size={15} /> Cursor confirmed these steps
                </button>
              ) : null}
              {canReview ? (
                <button
                  type="button"
                  className="primary-btn"
                  onClick={() => onUpdate({
                    implementationExecutionPlan: {
                      ...plan,
                      stage: 'accepted',
                      acceptedAt: new Date().toISOString(),
                    },
                  })}
                >
                  <CheckCircle2 size={15} /> Accept execution plan
                </button>
              ) : null}
              <button
                type="button"
                className="secondary-btn"
                onClick={() => {
                  onUpdate({
                    implementationExecutionPlan: {
                      ...plan,
                      stage: 'returned-to-work-plan',
                    },
                  })
                  onNavigate('sdlc-plan')
                }}
              >
                <RotateCcw size={15} /> Return to Work plan <ExternalLink size={14} aria-hidden />
              </button>
            </div>
          ) : (
            <p className="muted small">
              Accepted {plan.acceptedAt ? new Date(plan.acceptedAt).toLocaleString() : ''}. The next step is{' '}
              <strong>{plan.steps[0]?.title || 'to confirm implementation details in Cursor'}</strong>.
            </p>
          )}
          {!isAccepted ? (
            <p className="muted small">
              “Cursor confirmed these steps” is a human attestation. Blink does not claim a Cursor response was
              received automatically.
            </p>
          ) : null}
        </>
      )}
    </section>
  )
}

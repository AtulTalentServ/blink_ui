import { AlertCircle, CheckCircle2, CircleDashed, ExternalLink, GitBranch, Laptop } from 'lucide-react'
import { ImplementationHandoffPanel } from './ImplementationHandoffPanel'
import type { WizardState, WizardStep } from '../wizard/types'

interface Props {
  state: WizardState
  onUpdate: (patch: Partial<WizardState>) => void
  onNavigate: (step: WizardStep) => void
}

type ReadinessItem = {
  id: string
  label: string
  detail: string
  ready: boolean
  step: WizardStep
}

function scopeConfirmed(state: WizardState): boolean {
  return Boolean(state.productScope?.status === 'confirmed' || state.productScope?.confirmationDigest)
}

function issueChoices(state: WizardState): { id: string; label: string }[] {
  const stories = state.productScope?.stories || []
  if (stories.length) {
    return stories.map((story) => ({
      id: story.id,
      label: story.title ? `${story.id} — ${story.title}` : story.id,
    }))
  }
  const ids = [
    state.sdlcStartIssueId,
    state.specification?.issueId,
    state.workClassification?.issueId,
    ...(state.productScope?.storyIds || []),
  ].filter((value): value is string => Boolean(value?.trim()))
  return [...new Set(ids)].map((id) => ({ id, label: id }))
}

function readinessItems(state: WizardState, selectedIssueId: string | null): ReadinessItem[] {
  const technologiesReady =
    state.repoTechnologies.length > 0 && state.repoTechnologies.every((item) => item.status === 'confirmed')
  const hasRequirement = Boolean((state.groomDraft || state.requirementsText || '').trim() && state.groomConfirmed)
  const hasPlan = Boolean(state.technicalPlan?.markdown || state.technicalPlan?.steps?.length)

  return [
    {
      id: 'requirement',
      label: 'Requirement is finalized',
      detail: hasRequirement
        ? 'Blink will include the groomed requirement wording.'
        : 'Finalize the requirement wording before implementation.',
      ready: hasRequirement,
      step: 'requirements',
    },
    {
      id: 'scope',
      label: 'Product scope is confirmed',
      detail: scopeConfirmed(state)
        ? 'The approved scope will bound Cursor to the selected work item.'
        : 'Confirm scope after planning epics and stories.',
      ready: scopeConfirmed(state),
      step: 'requirements',
    },
    {
      id: 'work-item',
      label: 'Work item is selected',
      detail: selectedIssueId
        ? `Cursor will receive ${selectedIssueId} as the implementation target.`
        : 'Select a story or started SDLC work item.',
      ready: Boolean(selectedIssueId),
      step: 'requirements',
    },
    {
      id: 'grooming',
      label: 'Grooming is acknowledged',
      detail: state.groomAcknowledged
        ? 'Stakeholder decisions and grooming context are ready to carry forward.'
        : 'Resolve stakeholder questions and acknowledge grooming.',
      ready: Boolean(state.groomAcknowledged),
      step: 'stakeholder-qa',
    },
    {
      id: 'shape',
      label: 'Project shape and technology are reviewed',
      detail: state.shapeAcknowledged && technologiesReady
        ? 'Target repositories and confirmed stacks will be included.'
        : 'Review the project shape and confirm each repository stack.',
      ready: Boolean(state.shapeAcknowledged && technologiesReady),
      step: state.shapeAcknowledged ? 'technology-per-repo' : 'project-shape',
    },
    {
      id: 'specification',
      label: 'Specification and acceptance criteria are confirmed',
      detail: state.specification?.markdown && state.acceptanceCriteriaAcknowledged
        ? 'Cursor will receive the reviewed acceptance criteria.'
        : 'Create the specification and confirm its acceptance criteria.',
      ready: Boolean(state.specification?.markdown && state.acceptanceCriteriaAcknowledged),
      step: 'sdlc-plan',
    },
    {
      id: 'plan',
      label: 'Technical plan is acknowledged',
      detail: hasPlan && (state.planAcknowledged || state.shipPlanAcknowledged)
        ? 'Cursor will receive the approved plan and implementation steps.'
        : 'Create and acknowledge the technical plan first.',
      ready: Boolean(hasPlan && (state.planAcknowledged || state.shipPlanAcknowledged)),
      step: 'sdlc-plan',
    },
    {
      id: 'workspace',
      label: 'Workspace handoff is prepared',
      detail: state.gitWritten
        ? 'The workspace overlay has been committed and can be opened in Cursor.'
        : 'Prepare the workspace, repositories, and overlay before handing work to Cursor.',
      ready: Boolean(state.gitWritten),
      step: 'generation',
    },
  ]
}

function readinessDigest(state: WizardState, selectedIssueId: string | null): string {
  return JSON.stringify({
    issueId: selectedIssueId,
    requirement: state.groomDraft || state.requirementsText || '',
    scope: {
      status: state.productScope?.status || null,
      confirmationDigest: state.productScope?.confirmationDigest || null,
      stories: (state.productScope?.stories || []).map((story) => story.id),
    },
    groomingAcknowledged: Boolean(state.groomAcknowledged),
    shape: {
      acknowledged: Boolean(state.shapeAcknowledged),
      digest: state.shapeDigest || null,
      technologies: state.repoTechnologies.map((item) => `${item.repoId}:${item.status}`),
    },
    specification: state.specification?.markdown || '',
    acceptanceCriteriaAcknowledged: Boolean(state.acceptanceCriteriaAcknowledged),
    technicalPlan: state.technicalPlan?.markdown || state.technicalPlan?.steps?.map((step) => step.title).join('\n') || '',
    planAcknowledged: Boolean(state.planAcknowledged || state.shipPlanAcknowledged),
    workspaceCommit: state.gitApplyCommit?.sha || null,
    workspacePrepared: Boolean(state.gitWritten),
  })
}

export function ImplementationReadinessScreen({ state, onUpdate, onNavigate }: Props) {
  const choices = issueChoices(state)
  const selectedIssueId =
    state.implementationIssueId || choices.find((item) => item.id === state.sdlcStartIssueId)?.id || choices[0]?.id || null
  const items = readinessItems(state, selectedIssueId)
  const readyItems = items.filter((item) => item.ready)
  const missingItems = items.filter((item) => !item.ready)
  const currentDigest = readinessDigest(state, selectedIssueId)
  const readinessConfirmed = state.implementationReadinessDigest === currentDigest
  const readinessStale = Boolean(state.implementationReadinessDigest && !readinessConfirmed)
  const readyForCursor = missingItems.length === 0 && readinessConfirmed

  return (
    <div className="screen implementation-readiness">
      <div className="screen-header">
        <div>
          <p className="shape-kicker">Implementation</p>
          <h2>Prepare a complete Cursor handoff</h2>
          <p>
            Blink gathers the approved work context here. Cursor will implement the selected work item in a feature
            branch; Blink will not ask you to repeat earlier decisions.
          </p>
        </div>
        <Laptop size={28} aria-hidden className="implementation-readiness__icon" />
      </div>

      <section className={`implementation-readiness__summary ${readyForCursor ? 'is-ready' : ''}`}>
        {readyForCursor ? <CheckCircle2 size={20} aria-hidden /> : <CircleDashed size={20} aria-hidden />}
        <div>
          <strong>
            {readyForCursor
              ? 'Ready to build a Cursor handoff'
              : readinessStale
                ? 'Earlier readiness review is stale'
                : missingItems.length
                  ? `${missingItems.length} item${missingItems.length === 1 ? '' : 's'} need attention`
                  : 'Review the current readiness context'}
          </strong>
          <p>
            {readyForCursor
              ? 'The selected work item has the requirement, scope, plan, repositories, and workspace context Cursor needs.'
              : readinessStale
                ? 'An earlier decision changed. Review the current context again before handoff.'
                : missingItems.length
                  ? 'Finish the items below. Each one links back to the screen where it can be resolved.'
                  : 'All required context is present. Confirm that this is the context Cursor should receive.'}
          </p>
        </div>
      </section>

      <section className="card shape-section implementation-readiness__work-item">
        <div className="sdlc-panel__head">
          <GitBranch size={18} />
          <div>
            <h3>Choose the work item</h3>
            <p className="muted">Blink creates one implementation handoff per story or started SDLC work item.</p>
          </div>
        </div>
        {choices.length ? (
          <label className="field-label">
            <span>Implementation target</span>
            <select
              className="full-input"
              value={selectedIssueId || ''}
              onChange={(event) => onUpdate({ implementationIssueId: event.target.value || null })}
            >
              {choices.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className="implementation-readiness__empty">
            <AlertCircle size={18} aria-hidden />
            <p>Confirm product scope and start the SDLC from Requirements to choose an implementation target.</p>
            <button type="button" className="secondary-btn" onClick={() => onNavigate('requirements')}>
              Go to Requirements <ExternalLink size={14} aria-hidden />
            </button>
          </div>
        )}
      </section>

      <section className="implementation-readiness__grid" aria-label="Implementation readiness">
        <div className="implementation-readiness__column">
          <div className="implementation-readiness__section-head">
            <CheckCircle2 size={18} aria-hidden />
            <h3>Ready</h3>
            <span>{readyItems.length}</span>
          </div>
          {readyItems.map((item) => (
            <article key={item.id} className="implementation-readiness__item is-ready">
              <CheckCircle2 size={17} aria-hidden />
              <div>
                <strong>{item.label}</strong>
                <p>{item.detail}</p>
              </div>
            </article>
          ))}
        </div>

        <div className="implementation-readiness__column">
          <div className="implementation-readiness__section-head is-attention">
            <AlertCircle size={18} aria-hidden />
            <h3>Needs attention</h3>
            <span>{missingItems.length}</span>
          </div>
          {missingItems.map((item) => (
            <article key={item.id} className="implementation-readiness__item is-attention">
              <AlertCircle size={17} aria-hidden />
              <div>
                <strong>{item.label}</strong>
                <p>{item.detail}</p>
                <button type="button" className="text-btn" onClick={() => onNavigate(item.step)}>
                  Resolve in {item.step === 'generation' ? 'Workspace' : 'Blink'} <ExternalLink size={13} aria-hidden />
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="card shape-section implementation-readiness__next">
        <h3>Review the current context</h3>
        <p className="muted">
          Confirming readiness records the exact decision set that the handoff below is based on. If an earlier
          requirement, plan, shape, or workspace decision changes, review it again before using Cursor.
        </p>
        {missingItems.length === 0 && !readinessConfirmed ? (
          <button type="button" className="primary-btn" onClick={() => onUpdate({ implementationReadinessDigest: currentDigest })}>
            {readinessStale ? 'Review updated readiness' : 'Confirm readiness'}
          </button>
        ) : null}
        {!readyForCursor ? <p className="muted small">Complete and confirm the current readiness context before handoff.</p> : null}
      </section>

      <ImplementationHandoffPanel
        state={state}
        issueId={selectedIssueId || ''}
        ready={readyForCursor}
        onUpdate={onUpdate}
        onNavigate={onNavigate}
      />
    </div>
  )
}

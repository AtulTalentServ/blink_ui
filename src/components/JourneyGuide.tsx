import { AlertCircle, ArrowRight, CheckCircle2, CircleDashed, Compass, ExternalLink } from 'lucide-react'
import type { WizardState, WizardStep } from '../wizard/types'

type JourneyStage = 'plan' | 'workspace' | 'implementation' | 'review' | 'release'

type Guidance = {
  stage: JourneyStage
  title: string
  detail: string
  actionLabel: string
  target?: WizardStep
  returnInstruction?: string
  blocked?: boolean
}

const JOURNEY: { id: JourneyStage; label: string }[] = [
  { id: 'plan', label: 'Work plan' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'implementation', label: 'Implementation' },
  { id: 'review', label: 'Review & PR' },
  { id: 'release', label: 'Release' },
]

function selectedIssueId(state: WizardState): string | null {
  return (
    state.implementationIssueId ||
    state.sdlcStartIssueId ||
    state.specification?.issueId ||
    state.workClassification?.issueId ||
    state.productScope?.stories?.[0]?.id ||
    state.productScope?.storyIds?.[0] ||
    null
  )
}

function readinessGap(state: WizardState): { target: WizardStep; action: string; detail: string } | null {
  if (!((state.groomDraft || state.requirementsText || '').trim() && state.groomConfirmed)) {
    return {
      target: 'requirements',
      action: 'Finalize the requirement',
      detail: 'Blink needs the approved requirement wording before it can prepare a Cursor handoff.',
    }
  }
  if (!(state.productScope?.status === 'confirmed' || state.productScope?.confirmationDigest)) {
    return {
      target: 'requirements',
      action: 'Confirm product scope',
      detail: 'The selected work must be bounded before implementation starts.',
    }
  }
  if (!selectedIssueId(state)) {
    return {
      target: 'requirements',
      action: 'Select a work item',
      detail: 'Blink needs one story or started SDLC work item to hand off to Cursor.',
    }
  }
  if (!state.groomAcknowledged) {
    return {
      target: 'stakeholder-qa',
      action: 'Acknowledge grooming',
      detail: 'Resolve and carry forward the stakeholder context first.',
    }
  }
  if (!state.shapeAcknowledged || state.repoTechnologies.some((item) => item.status !== 'confirmed')) {
    return {
      target: state.shapeAcknowledged ? 'technology-per-repo' : 'project-shape',
      action: 'Confirm project shape and technology',
      detail: 'Cursor needs confirmed repositories and technology choices.',
    }
  }
  if (!state.specification?.markdown || !state.acceptanceCriteriaAcknowledged) {
    return {
      target: 'sdlc-plan',
      action: 'Confirm specification and acceptance criteria',
      detail: 'Cursor needs a reviewed definition of done.',
    }
  }
  if (
    !(state.technicalPlan?.markdown || state.technicalPlan?.steps?.length) ||
    !(state.planAcknowledged || state.shipPlanAcknowledged)
  ) {
    return {
      target: 'sdlc-plan',
      action: 'Review and acknowledge the technical plan',
      detail: 'Implementation cannot start without an approved plan.',
    }
  }
  if (!state.gitWritten) {
    return {
      target: 'generation',
      action: 'Prepare the workspace',
      detail: 'Commit the workspace guidance before handing work to Cursor.',
    }
  }
  return null
}

function guidanceFor(state: WizardState, step: WizardStep): Guidance | null {
  if (step === 'sdlc-plan') {
    return {
      stage: 'plan',
      title: 'Build the approved work plan',
      detail: 'Confirm the specification, acceptance criteria, and technical plan before preparing the workspace.',
      actionLabel: 'Complete the Work plan',
    }
  }
  if (step === 'generation') {
    if (!(state.planAcknowledged || state.shipPlanAcknowledged)) {
      return {
        stage: 'plan',
        title: 'Finish the Work plan first',
        detail: 'Workspace setup is available once the technical plan has been reviewed and acknowledged.',
        actionLabel: 'Go to Work plan',
        target: 'sdlc-plan',
        blocked: true,
      }
    }
    if (!state.bootstrapAcknowledged) {
      return {
        stage: 'workspace',
        title: 'Confirm repository setup',
        detail: 'Confirm that Blink may create or export the selected repository structure.',
        actionLabel: 'Confirm repository setup below',
      }
    }
    if (!state.gitWritten) {
      return {
        stage: 'workspace',
        title: 'Prepare the workspace guidance',
        detail: 'Create or export repositories, then commit the workspace guidance.',
        actionLabel: 'Complete workspace setup below',
      }
    }
    return {
      stage: 'implementation',
      title: 'Prepare the Cursor handoff',
      detail: 'The workspace is ready. Blink can now assemble the selected work for Cursor.',
      actionLabel: 'Go to Implementation',
      target: 'implementation',
    }
  }
  if (step === 'implementation') {
    const gap = readinessGap(state)
    if (gap) {
      return {
        stage: 'implementation',
        title: gap.action,
        detail: gap.detail,
        actionLabel: `Go to ${gap.target === 'generation' ? 'Workspace' : 'the required step'}`,
        target: gap.target,
        blocked: true,
      }
    }
    if (!state.implementationReadinessDigest) {
      return {
        stage: 'implementation',
        title: 'Confirm the current handoff context',
        detail: 'Review the carried-forward requirement, plan, repositories, and workspace before sharing it with Cursor.',
        actionLabel: 'Confirm readiness below',
      }
    }
    if (!state.implementationHandoffStartedAt) {
      return {
        stage: 'implementation',
        title: 'Start the Cursor handoff',
        detail: 'Use the prepared Cursor instruction, open the listed repositories, then confirm the handoff is open.',
        actionLabel: 'Use Cursor below',
        returnInstruction: 'After Cursor confirms the execution steps, return here to review and accept them.',
      }
    }
    if (state.implementationExecutionPlan?.stage !== 'accepted') {
      return {
        stage: 'implementation',
        title: 'Review Cursor’s execution steps',
        detail: 'Confirm that the proposed steps, repositories, and acceptance criteria match the approved plan.',
        actionLabel: 'Review the implementation step plan below',
        returnInstruction: 'After accepting the step plan, Cursor can start source changes.',
      }
    }
    const latest = (state.implementationProgressHistory || []).at(-1)
    if (!latest) {
      return {
        stage: 'implementation',
        title: 'Implement in Cursor',
        detail: 'The handoff and execution plan are ready. Cursor can now implement the approved work on its feature branch.',
        actionLabel: 'Work in Cursor, then import its result below',
        returnInstruction: 'Use the result template in Blink to import factual Cursor progress.',
      }
    }
    if (latest.stage === 'blocked' || latest.stage === 'waiting-for-user-decision') {
      return {
        stage: 'implementation',
        title: latest.stage === 'blocked' ? 'Resolve the reported blocker' : 'Make the requested decision',
        detail: latest.recommendedNextAction,
        actionLabel: 'Review the blocker and return to Cursor',
        returnInstruction: 'Import the next Cursor result after the blocker or decision is resolved.',
        blocked: true,
      }
    }
    if (latest.stage === 'complete' || latest.stage === 'draft-pr-ready') {
      const resultAccepted = (state.implementationResultReviews || []).some(
        (review) => review.reportId === latest.id && review.decision === 'accepted',
      )
      return {
        stage: 'review',
        title: resultAccepted ? 'Track Review & PR evidence' : 'Review the reported implementation result',
        detail: resultAccepted
          ? 'The implementation result is accepted. Register review, QA, PR, and human merge-readiness evidence.'
          : 'Check files, branches, validation, acceptance-criteria coverage, and deviations before PR handling.',
        actionLabel: resultAccepted ? 'Go to Review & PR' : 'Review the result below',
        target: resultAccepted ? 'review-pr' : undefined,
        returnInstruction: resultAccepted ? undefined : 'After accepting the result, Blink will guide the Review & PR path.',
      }
    }
    return {
      stage: 'implementation',
      title: 'Import Cursor’s latest progress',
      detail: latest.recommendedNextAction,
      actionLabel: 'Import the next Cursor result below',
      returnInstruction: 'Blink preserves each report so progress and blockers remain visible.',
    }
  }
  if (step === 'review-pr') {
    if (!state.mergeAuthorization) {
      return {
        stage: 'review',
        title: 'Complete Review & PR evidence',
        detail: 'Register the pull request, record review and QA evidence, resolve must-fix findings, and capture human merge authorization.',
        actionLabel: 'Complete the Review & PR evidence below',
      }
    }
    return {
      stage: 'release',
      title: 'Record the actual merge and release evidence',
      detail: 'A human merge authorization is not proof of a merge, deployment, or closure.',
      actionLabel: 'Go to Release',
      target: 'release',
    }
  }
  if (step === 'release') {
    const release = state.releaseClosure
    if (!release?.humanMerge) {
      return {
        stage: 'release',
        title: 'Record the human merge result',
        detail: 'Blink needs actual merge evidence; it will never merge code automatically.',
        actionLabel: 'Record the merge result below',
      }
    }
    if (release.deploymentRequired && release.deployment?.status !== 'deployed') {
      return {
        stage: 'release',
        title: 'Record deployment evidence',
        detail: 'A merge does not mean the work is deployed. Record a human-reported deployment result.',
        actionLabel: 'Record deployment evidence below',
      }
    }
    if (release.monitoring?.status === 'blocker') {
      return {
        stage: 'release',
        title: 'Resolve the post-release blocker',
        detail: release.monitoring.blocker || 'A post-release blocker is preventing closure.',
        actionLabel: 'Update monitoring status below',
        blocked: true,
      }
    }
    if (!release.closure) {
      return {
        stage: 'release',
        title: 'Verify and close the work item',
        detail: 'Record healthy monitoring or verification, then let a human record closure.',
        actionLabel: 'Complete closure evidence below',
      }
    }
    return {
      stage: 'release',
      title: 'Work item is closed',
      detail: 'Blink has recorded the human merge, release evidence, and final closure.',
      actionLabel: 'Review the closure record below',
    }
  }
  return null
}

interface Props {
  state: WizardState
  step: WizardStep
  onNavigate: (step: WizardStep) => void
}

export function JourneyGuide({ state, step, onNavigate }: Props) {
  const guidance = guidanceFor(state, step)
  if (!guidance) return null
  const activeIndex = JOURNEY.findIndex((stage) => stage.id === guidance.stage)

  return (
    <section className={`journey-guide ${guidance.blocked ? 'is-blocked' : ''}`} aria-label="What to do next">
      <div className="journey-guide__head">
        <Compass size={19} aria-hidden />
        <div>
          <p className="shape-kicker">What to do next</p>
          <h3>{guidance.title}</h3>
        </div>
        {guidance.blocked ? <AlertCircle size={18} aria-label="Action required" /> : <CircleDashed size={18} aria-hidden />}
      </div>
      <ol className="journey-guide__stages">
        {JOURNEY.map((stage, index) => (
          <li key={stage.id} className={index < activeIndex ? 'is-complete' : index === activeIndex ? 'is-current' : ''}>
            {index < activeIndex ? <CheckCircle2 size={13} aria-hidden /> : <span>{index + 1}</span>}
            {stage.label}
          </li>
        ))}
      </ol>
      <p className="journey-guide__detail">{guidance.detail}</p>
      <div className="journey-guide__action">
        {guidance.target ? (
          <button type="button" className="secondary-btn" onClick={() => onNavigate(guidance.target!)}>
            {guidance.actionLabel} <ArrowRight size={14} aria-hidden />
          </button>
        ) : (
          <span><strong>Now:</strong> {guidance.actionLabel}</span>
        )}
        {guidance.returnInstruction ? (
          <span className="journey-guide__return">
            <ExternalLink size={14} aria-hidden /> {guidance.returnInstruction}
          </span>
        ) : null}
      </div>
    </section>
  )
}

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

function journeyStep(step: WizardStep, state: WizardState): WizardStep {
  if (step !== 'ship') return step
  const sub = state.shipSubstage || 'workspace'
  if (sub === 'implementation') return 'implementation'
  if (sub === 'review-pr') return 'review-pr'
  if (sub === 'release') return 'release'
  return 'generation'
}

function guidanceFor(state: WizardState, step: WizardStep): Guidance | null {
  step = journeyStep(step, state)
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
      title: 'Open the workspace in Cursor',
      detail: 'The workspace is ready. Download it once, then use the AI-SDLC commands in Cursor to work eligible tickets.',
      actionLabel: 'Go to Work in Cursor',
      target: 'implementation',
    }
  }
  if (step === 'implementation') {
    return {
      stage: 'implementation',
      title: 'Work tickets in Cursor',
      detail: 'Open the downloaded workspace in Cursor. The AI-SDLC commands choose eligible tickets, load their context, and guide implementation.',
      actionLabel: 'Continue in Cursor',
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

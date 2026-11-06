import type { LucideIcon } from 'lucide-react'
import {
  ClipboardList,
  Cpu,
  FileText,
  FolderSearch,
  GitBranch,
  Home,
  Layers,
  Link2,
  MessageSquare,
  Rocket,
  Users,
} from 'lucide-react'
import { groomQaGateSatisfied } from './groomGate.ts'
import type { WizardState, WizardStep, WorkMode } from './types'

export type StepPath = {
  projectType?: string
  workMode?: WorkMode
}

function asPath(path?: string | StepPath, workMode?: WorkMode): StepPath {
  if (path && typeof path === 'object') {
    return { projectType: path.projectType, workMode: path.workMode ?? workMode }
  }
  return { projectType: path, workMode }
}

export interface StepDefinition {
  id: WizardStep
  label: string
  icon: LucideIcon
  iconColor: string
}

export interface PhaseDefinition {
  id: string
  label: string
  stepIds: WizardStep[]
}

export const WIZARD_STEPS: StepDefinition[] = [
  { id: 'welcome', label: 'Home', icon: Home, iconColor: '#2563eb' },
  { id: 'project-stakeholders', label: 'Project & Stakeholders', icon: Users, iconColor: '#2563eb' },
  { id: 'integrations', label: 'Integrations', icon: Link2, iconColor: '#2563eb' },
  { id: 'existing-source', label: 'Bind existing', icon: FolderSearch, iconColor: '#2563eb' },
  { id: 'requirements', label: 'Requirements', icon: FileText, iconColor: '#2563eb' },
  { id: 'stakeholder-qa', label: 'Stakeholder Q&A', icon: MessageSquare, iconColor: '#2563eb' },
  { id: 'project-shape', label: 'Project Shape', icon: Layers, iconColor: '#2563eb' },
  { id: 'repositories', label: 'Repositories', icon: GitBranch, iconColor: '#2563eb' },
  { id: 'technology-per-repo', label: 'Technology', icon: Cpu, iconColor: '#2563eb' },
  { id: 'sdlc-plan', label: 'Work plan', icon: ClipboardList, iconColor: '#2563eb' },
  { id: 'ship', label: 'Ship', icon: Rocket, iconColor: '#2563eb' },
]

export const WIZARD_PHASES: PhaseDefinition[] = [
  {
    id: 'setup',
    label: 'Project setup',
    stepIds: ['welcome', 'project-stakeholders', 'integrations', 'existing-source'],
  },
  {
    id: 'scope',
    label: 'Write & clarify',
    stepIds: ['requirements'],
  },
  {
    id: 'groom',
    label: 'Ask & tickets',
    stepIds: ['stakeholder-qa'],
  },
  {
    id: 'shape',
    label: 'Shape',
    stepIds: ['project-shape', 'repositories', 'technology-per-repo'],
  },
  {
    id: 'plan',
    label: 'Plan',
    stepIds: ['sdlc-plan'],
  },
  {
    id: 'ship',
    label: 'Ship',
    stepIds: ['ship'],
  },
]

export const STEP_ORDER = WIZARD_STEPS.map((s) => s.id)

export function isExistingOnlyStep(step: WizardStep): boolean {
  return step === 'existing-source'
}

/** Bound products already have topology and remotes. Maintenance also keeps the live stack. */
function isAdoptedSkipStep(step: WizardStep, path: StepPath): boolean {
  if (path.projectType !== 'existing') return false
  if (step === 'project-shape' || step === 'repositories') return true
  if (step === 'technology-per-repo') return path.workMode !== 'modernization'
  return false
}

export function isStepVisible(step: WizardStep, path?: string | StepPath, workMode?: WorkMode): boolean {
  const resolved = asPath(path, workMode)
  if (isExistingOnlyStep(step)) return resolved.projectType === 'existing'
  if (isAdoptedSkipStep(step, resolved)) return false
  return STEP_ORDER.includes(step)
}

export function visibleWizardSteps(path?: string | StepPath, workMode?: WorkMode): StepDefinition[] {
  return WIZARD_STEPS.filter((step) => isStepVisible(step.id, path, workMode))
}

export function stepIndex(step: WizardStep): number {
  return WIZARD_STEPS.findIndex((s) => s.id === step)
}

export function nextVisibleStep(step: WizardStep, path?: string | StepPath, workMode?: WorkMode): WizardStep | undefined {
  let idx = stepIndex(resolveNavStep(step)) + 1
  while (idx < STEP_ORDER.length && !isStepVisible(STEP_ORDER[idx], path, workMode)) idx += 1
  return STEP_ORDER[idx]
}

export function prevVisibleStep(step: WizardStep, path?: string | StepPath, workMode?: WorkMode): WizardStep | undefined {
  let idx = stepIndex(resolveNavStep(step)) - 1
  while (idx >= 0 && !isStepVisible(STEP_ORDER[idx], path, workMode)) idx -= 1
  return idx >= 0 ? STEP_ORDER[idx] : undefined
}

export function phaseForStep(step: WizardStep): PhaseDefinition {
  return WIZARD_PHASES.find((phase) => phase.stepIds.includes(step)) || WIZARD_PHASES[0]
}

/** Single progress line: "3 of 9" — no phase grouping. */
export function phaseProgressLabel(step: WizardStep, path?: string | StepPath, workMode?: WorkMode): string {
  const visible = visibleWizardSteps(path, workMode).filter((s) => s.id !== 'welcome')
  const idx = visible.findIndex((s) => s.id === step)
  if (idx < 0) return WIZARD_STEPS.find((s) => s.id === step)?.label || 'Home'
  return `${idx + 1} of ${visible.length}`
}

export function resolveNavStep(step: WizardStep): WizardStep {
  if (
    step === 'generation'
    || step === 'implementation'
    || step === 'review-pr'
    || step === 'release'
  ) {
    return 'ship'
  }
  return step
}

export function canNavigateToStep(
  target: WizardStep,
  current: WizardStep,
  completedThrough: number,
  groomingUnlocked = true,
  unrestricted = false,
  shapeAcknowledged = false,
  canonicalAllowedSteps?: string[] | null,
  path?: string | StepPath,
  workMode?: WorkMode,
): boolean {
  target = resolveNavStep(target)
  current = resolveNavStep(current)
  const resolved = asPath(path, workMode)
  if (unrestricted) return stepIndex(target) >= 0
  if (target === 'welcome') return true
  if (!isStepVisible(target, resolved)) return false
  // Leaving welcome is only via Start (unrestricted / completedThrough), not sidebar nav.
  if (current === 'welcome') return false
  const targetIdx = stepIndex(target)
  const currentIdx = stepIndex(current)
  if (targetIdx < 0) return false
  const reqIdx = stepIndex('requirements')
  if (targetIdx > reqIdx && !groomingUnlocked) return false
  const planIdx = stepIndex('sdlc-plan')
  const needsShapeReview =
    isStepVisible('project-shape', resolved) || isStepVisible('technology-per-repo', resolved)
  if (targetIdx >= planIdx && !shapeAcknowledged && needsShapeReview) return false
  const reachable = Math.max(completedThrough, currentIdx)
  // Always allow revisiting the current step and anything already completed.
  // Canonical eligibility must not trap the user on Ship after a soft checkpoint.
  if (targetIdx <= reachable) return true
  if (canonicalAllowedSteps?.length && !canonicalAllowedSteps.includes(target)) {
    return false
  }
  return false
}

export type StepAttention = 'idle' | 'active' | 'done' | 'attention' | 'skipped'

/** High-level step chrome: done / needs attention / active. */
export function stepAttention(
  stepId: WizardStep,
  current: WizardStep,
  completedThrough: number,
  generationComplete: boolean,
  state: Pick<
    WizardState,
    'questions' | 'responses' | 'groomConfirmed' | 'groomAcknowledged' | 'shapeAcknowledged'
  >,
): StepAttention {
  const idx = stepIndex(stepId)
  if (stepId === 'welcome') return current === 'welcome' ? 'active' : 'idle'
  const shipIdx = stepIndex('ship')
  const skipped = generationComplete && idx > completedThrough && idx < shipIdx
  if (skipped) return 'skipped'
  const currentNav = resolveNavStep(current)
  if (stepId === currentNav || (stepId === 'ship' && currentNav === 'ship')) return 'active'
  if (idx <= completedThrough || (generationComplete && stepId === 'ship')) {
    if (stepId === 'technology-per-repo' && !state.shapeAcknowledged) return 'attention'
    if (stepId === 'stakeholder-qa') {
      if (!groomQaGateSatisfied(state as WizardState)) return 'attention'
      const outboundPending = state.questions.filter((q) => {
        const emailed = q.sent
        const jiraDone =
          (q.jiraCommentStatus === 'posted' || q.jiraCommentStatus === 'replied') && Boolean(q.jiraCommentId)
        const answered = state.responses.find((r) => r.questionId === q.id)?.status === 'answered'
        return !(emailed || jiraDone || answered)
      })
      const answerPending = state.questions
        .filter((q) => q.mandatory)
        .filter((q) => {
          const response = state.responses.find((r) => r.questionId === q.id)
          const text = response?.response?.trim() || q.jiraReplyBody?.trim()
          return !(response?.status === 'answered' && text)
        })
      if (outboundPending.length > 0 || answerPending.length > 0) return 'attention'
    }
    return 'done'
  }
  return 'idle'
}

/** Floating footer primary label — step-aware so the bottom-right CTA is predictable across tabs. */
export function primaryContinueLabel(
  step: WizardStep,
  busy: { saving?: boolean; creatingRepos?: boolean },
  path?: string | StepPath,
  workMode?: WorkMode,
): string {
  if (busy.creatingRepos) return 'Creating on GitHub…'
  if (busy.saving) return 'Saving…'
  const resolved = asPath(path, workMode)
  const existing = resolved.projectType === 'existing'
  switch (step) {
    case 'project-stakeholders':
      return 'Save & continue'
    case 'integrations':
      return existing ? 'Continue to Bind' : 'Continue to Requirements'
    case 'existing-source':
      return 'Continue to Requirements'
    case 'requirements':
      return 'Clarify requirements'
    case 'stakeholder-qa':
      if (existing && resolved.workMode === 'modernization') return 'Continue to Technology'
      if (existing) return 'Continue to Work plan'
      return 'Continue'
    case 'project-shape':
      return 'Continue to Repositories'
    case 'repositories':
      return 'Continue to Technology'
    case 'technology-per-repo':
      return existing ? 'Confirm stack & continue' : 'Confirm stack & plan'
    case 'sdlc-plan':
      return 'Continue to Ship'
    default:
      return 'Continue'
  }
}

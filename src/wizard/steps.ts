import type { LucideIcon } from 'lucide-react'
import {
  ClipboardList,
  Cpu,
  FileText,
  GitBranch,
  Home,
  Laptop,
  Layers,
  Link2,
  MessageSquare,
  SearchCheck,
  Rocket,
  Users,
} from 'lucide-react'
import type { WizardState, WizardStep } from './types'

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
  { id: 'requirements', label: 'Requirements', icon: FileText, iconColor: '#2563eb' },
  { id: 'stakeholder-qa', label: 'Stakeholder Q&A', icon: MessageSquare, iconColor: '#2563eb' },
  { id: 'project-shape', label: 'Project Shape', icon: Layers, iconColor: '#2563eb' },
  { id: 'repositories', label: 'Repositories', icon: GitBranch, iconColor: '#2563eb' },
  { id: 'technology-per-repo', label: 'Technology', icon: Cpu, iconColor: '#2563eb' },
  { id: 'sdlc-plan', label: 'Work plan', icon: ClipboardList, iconColor: '#2563eb' },
  { id: 'generation', label: 'Workspace', icon: Rocket, iconColor: '#2563eb' },
  { id: 'implementation', label: 'Implementation', icon: Laptop, iconColor: '#2563eb' },
  { id: 'review-pr', label: 'Review & PR', icon: SearchCheck, iconColor: '#2563eb' },
  { id: 'release', label: 'Release', icon: Rocket, iconColor: '#2563eb' },
]

export const WIZARD_PHASES: PhaseDefinition[] = [
  {
    id: 'setup',
    label: 'Project setup',
    stepIds: ['welcome', 'project-stakeholders', 'integrations'],
  },
  {
    id: 'scope',
    label: 'Scope',
    stepIds: ['requirements'],
  },
  {
    id: 'groom',
    label: 'Groom',
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
    id: 'workspace',
    label: 'Workspace',
    stepIds: ['generation'],
  },
  {
    id: 'implementation',
    label: 'Implementation',
    stepIds: ['implementation'],
  },
  {
    id: 'review-pr',
    label: 'Review & PR',
    stepIds: ['review-pr'],
  },
  {
    id: 'release',
    label: 'Release',
    stepIds: ['release'],
  },
]

export const STEP_ORDER = WIZARD_STEPS.map((s) => s.id)

export function stepIndex(step: WizardStep): number {
  return WIZARD_STEPS.findIndex((s) => s.id === step)
}

export function phaseForStep(step: WizardStep): PhaseDefinition {
  return WIZARD_PHASES.find((phase) => phase.stepIds.includes(step)) || WIZARD_PHASES[0]
}

/** Single progress line: "3 of 9" — no phase grouping. */
export function phaseProgressLabel(step: WizardStep): string {
  const visible = WIZARD_STEPS.filter((s) => s.id !== 'welcome')
  const idx = visible.findIndex((s) => s.id === step)
  if (idx < 0) return WIZARD_STEPS.find((s) => s.id === step)?.label || 'Home'
  return `${idx + 1} of ${visible.length}`
}

export function canNavigateToStep(
  target: WizardStep,
  current: WizardStep,
  completedThrough: number,
  groomingUnlocked = true,
  unrestricted = false,
  shapeAcknowledged = false,
): boolean {
  if (unrestricted) return stepIndex(target) >= 0
  if (target === 'welcome') return true
  // Leaving welcome is only via Start (unrestricted / completedThrough), not sidebar nav.
  if (current === 'welcome') return false
  const targetIdx = stepIndex(target)
  const currentIdx = stepIndex(current)
  if (targetIdx < 0) return false
  const reqIdx = stepIndex('requirements')
  if (targetIdx > reqIdx && !groomingUnlocked) return false
  const planIdx = stepIndex('sdlc-plan')
  if (targetIdx >= planIdx && !shapeAcknowledged) return false
  return targetIdx <= Math.max(completedThrough, currentIdx)
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
  const generationIdx = stepIndex('generation')
  const skipped = generationComplete && idx > completedThrough && idx < generationIdx
  if (skipped) return 'skipped'
  if (stepId === current) return 'active'
  if (idx <= completedThrough || (generationComplete && stepId === 'generation')) {
    if (stepId === 'technology-per-repo' && !state.shapeAcknowledged) return 'attention'
    if (stepId === 'stakeholder-qa') {
      if (!state.groomAcknowledged) return 'attention'
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

/** Floating footer only — in-page actions must not reuse this word. */
export function primaryContinueLabel(
  _step: WizardStep,
  _state: Pick<WizardState, 'questions' | 'groomConfirmed' | 'repositories' | 'responses'>,
  busy: { saving?: boolean; creatingRepos?: boolean },
): string {
  if (busy.creatingRepos) return 'Creating on GitHub…'
  if (busy.saving) return 'Saving…'
  return 'Continue'
}

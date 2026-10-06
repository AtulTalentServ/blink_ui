import { DEFAULT_INTEGRATIONS } from './defaults.ts'
import { remapWizardProgress } from './shape.ts'
import { STEP_ORDER, WIZARD_STEPS } from './steps.ts'
import { defaultWizardState, type WizardState, type WizardStep } from './types.ts'

interface RemoteProject {
  id?: number
  projectName?: string
  description?: string
  projectType?: string
  stakeholders?: { roleCode: string; name: string; email: string }[]
  wizardStep?: string | null
  wizardCompletedThrough?: number | null
  wizardState?: unknown
  wizardUpdatedAt?: string | null
}

export const WIZARD_DRAFT_KEY = 'blink.wizard.v1'
export const WIZARD_SESSION_STEP_KEY = 'blink.wizard.session.v1'
export const OPEN_WELCOME_KEY = 'blink.openWelcome.v1'

type RemovedTicketHandoffState = {
  implementationIssueId?: unknown
  implementationReadinessDigest?: unknown
  implementationTool?: unknown
  implementationHandoffStartedAt?: unknown
  implementationHandoffStartedDigest?: unknown
  implementationExecutionPlan?: unknown
  implementationProgressHistory?: unknown
  implementationResultReviews?: unknown
}

export interface WizardDraft {
  email: string
  step: WizardStep
  completedThrough: number
  state: WizardState
  updatedAt: number
  freshStart?: boolean
}

const LEGACY_WIZARD_STEPS = [
  'sdlc-scope',
  'stakeholder-questions',
  'stakeholder-responses',
  'sdlc-planning',
  'ide-and-tools',
  'platform-delivery',
  'review-resolve',
  'project-preview',
] as const

export function isWizardStep(value: unknown): value is WizardStep {
  if (typeof value !== 'string') return false
  return STEP_ORDER.includes(value as WizardStep) || (LEGACY_WIZARD_STEPS as readonly string[]).includes(value)
}

export function normalizeWizardStep(
  step: string,
  state?: Pick<WizardState, 'productScope' | 'sdlcStartIssueId'>,
): WizardStep {
  if (step === 'stakeholder-questions' || step === 'stakeholder-responses') return 'stakeholder-qa'
  if (step === 'sdlc-scope') return 'requirements'
  if (step === 'sdlc-planning') {
    const confirmed = Boolean(state?.productScope?.status === 'confirmed' || state?.productScope?.confirmationDigest)
    if (confirmed && state?.sdlcStartIssueId) return 'sdlc-plan'
    return 'requirements'
  }
  if (step === 'ide-and-tools' || step === 'platform-delivery') return 'project-shape'
  if (step === 'review-resolve' || step === 'project-preview') return 'ship'
  if (
    step === 'generation'
    || step === 'implementation'
    || step === 'review-pr'
    || step === 'release'
  ) {
    return 'ship'
  }
  if (STEP_ORDER.includes(step as WizardStep)) return step as WizardStep
  return 'welcome'
}

export function serializeWizardState(state: WizardState): WizardState {
  const {
    implementationIssueId: _implementationIssueId,
    implementationReadinessDigest: _implementationReadinessDigest,
    implementationTool: _implementationTool,
    implementationHandoffStartedAt: _implementationHandoffStartedAt,
    implementationHandoffStartedDigest: _implementationHandoffStartedDigest,
    implementationExecutionPlan: _implementationExecutionPlan,
    implementationProgressHistory: _implementationProgressHistory,
    implementationResultReviews: _implementationResultReviews,
    ...currentState
  } = state as WizardState & RemovedTicketHandoffState
  return {
    ...currentState,
    requirementFile: null,
    integrations: (state.integrations || []).map((item) => {
      const { token: _token, ...rest } = item
      return rest
    }),
  }
}

export function restoreWizardState(raw: unknown): WizardState {
  const parsed = raw && typeof raw === 'object' ? (raw as Partial<WizardState>) : {}
  const {
    implementationIssueId: _implementationIssueId,
    implementationReadinessDigest: _implementationReadinessDigest,
    implementationTool: _implementationTool,
    implementationHandoffStartedAt: _implementationHandoffStartedAt,
    implementationHandoffStartedDigest: _implementationHandoffStartedDigest,
    implementationExecutionPlan: _implementationExecutionPlan,
    implementationProgressHistory: _implementationProgressHistory,
    implementationResultReviews: _implementationResultReviews,
    ...currentState
  } = parsed as Partial<WizardState> & RemovedTicketHandoffState
  const integrationsById = new Map(
    (Array.isArray(currentState.integrations) ? currentState.integrations : []).map((item) => [item.id, item]),
  )
  return {
    ...defaultWizardState,
    ...currentState,
    requirementFile: null,
    projectId: currentState.projectId ? String(currentState.projectId) : null,
    integrations: DEFAULT_INTEGRATIONS.map((item) => {
      const saved = integrationsById.get(item.id)
      if (!saved) return { ...item }
      const { token: _token, ...rest } = saved
      return { ...item, ...rest, token: undefined }
    }),
    wizardLayoutVersion: typeof currentState.wizardLayoutVersion === 'number' ? currentState.wizardLayoutVersion : 0,
  }
}

export function hasWizardProgress(
  draft: Pick<WizardDraft, 'step' | 'state'> & { completedThrough?: number } | null | undefined,
): boolean {
  if (!draft) return false
  if ((draft.completedThrough ?? 0) > 0) return true
  if (draft.step !== 'welcome') return true
  const state = draft.state
  return Boolean(
    state.projectId
      || state.projectName?.trim()
      || state.description?.trim()
      || state.requirementsText?.trim()
      || state.questions.length
      || state.groomQuestions.length,
  )
}

export function loadWizardDraft(email: string): WizardDraft | null {
  if (!email || typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(WIZARD_DRAFT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<WizardDraft>
    if (!parsed?.email || parsed.email.toLowerCase() !== email.trim().toLowerCase()) return null
    const state = restoreWizardState(parsed.state)
    const step = isWizardStep(parsed.step) ? normalizeWizardStep(parsed.step, state) : 'welcome'
    const remapped = remapWizardProgress({
      step,
      completedThrough: typeof parsed.completedThrough === 'number' ? parsed.completedThrough : 0,
      state,
    })
    return {
      email: parsed.email,
      step: persistedWizardStep(remapped.step, remapped.completedThrough, remapped.state),
      completedThrough: remapped.completedThrough,
      state: remapped.state,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
      freshStart: Boolean(parsed.freshStart),
    }
  } catch {
    return null
  }
}

export function saveWizardDraft(email: string, draft: Omit<WizardDraft, 'email'>): void {
  if (!email || typeof localStorage === 'undefined') return
  const payload: WizardDraft = {
    email: email.trim().toLowerCase(),
    step: draft.step,
    completedThrough: draft.completedThrough,
    state: serializeWizardState(draft.state),
    updatedAt: draft.updatedAt,
    freshStart: Boolean(draft.freshStart),
  }
  localStorage.setItem(WIZARD_DRAFT_KEY, JSON.stringify(payload))
}

export function loadSessionStep(): WizardStep | null {
  if (typeof sessionStorage === 'undefined') return null
  try {
    const value = sessionStorage.getItem(WIZARD_SESSION_STEP_KEY)
    return isWizardStep(value) ? normalizeWizardStep(value) : null
  } catch {
    return null
  }
}

export function saveSessionStep(step: WizardStep): void {
  if (typeof sessionStorage === 'undefined') return
  sessionStorage.setItem(WIZARD_SESSION_STEP_KEY, step)
}

export function clearSessionStep(): void {
  if (typeof sessionStorage === 'undefined') return
  sessionStorage.removeItem(WIZARD_SESSION_STEP_KEY)
}

/** After sign-in, open Welcome so Continue / Start over is always available. */
export function markOpenWelcome(): void {
  if (typeof sessionStorage === 'undefined') return
  sessionStorage.setItem(OPEN_WELCOME_KEY, '1')
}

export function peekOpenWelcome(): boolean {
  if (typeof sessionStorage === 'undefined') return false
  try {
    return sessionStorage.getItem(OPEN_WELCOME_KEY) === '1'
  } catch {
    return false
  }
}

export function consumeOpenWelcome(): void {
  if (typeof sessionStorage === 'undefined') return
  sessionStorage.removeItem(OPEN_WELCOME_KEY)
}

export function parkDraftForNextLogin(email: string | null | undefined): void {
  clearSessionStep()
  // Keep draft step/progress intact so the next login can offer Resume.
  // Do not bump updatedAt — that would make a "welcome" local draft beat the server.
  if (!email) return
  const draft = loadWizardDraft(email)
  if (!draft || !hasWizardProgress(draft)) return
  // Ensure draft remains keyed to this email for the next session.
  saveWizardDraft(email, {
    step: persistedWizardStep(draft.step, draft.completedThrough, draft.state),
    completedThrough: draft.completedThrough,
    state: draft.state,
    updatedAt: draft.updatedAt,
    freshStart: false,
  })
}

export function clearWizardDraft(email?: string): void {
  if (typeof localStorage === 'undefined') return
  if (!email) {
    localStorage.removeItem(WIZARD_DRAFT_KEY)
    return
  }
  const current = loadWizardDraft(email)
  if (current) localStorage.removeItem(WIZARD_DRAFT_KEY)
}

export function stepLabel(step: WizardStep): string {
  return WIZARD_STEPS.find((item) => item.id === step)?.label || step
}

export function parseRemoteUpdatedAt(value: string | null | undefined): number {
  if (!value) return 0
  const millis = Date.parse(value)
  if (!Number.isNaN(millis)) return millis
  const local = Date.parse(value.replace(' ', 'T'))
  return Number.isNaN(local) ? 0 : local
}

export function draftFromRemote(email: string, remote: RemoteProject): WizardDraft {
  const state = restoreWizardState(remote.wizardState)
  if (remote.id != null) state.projectId = String(remote.id)
  if (remote.projectName) state.projectName = remote.projectName
  if (remote.description) state.description = remote.description
  if (remote.projectType === 'new' || remote.projectType === 'existing') {
    state.projectType = remote.projectType
  }
  const remoteStakeholders = remote.stakeholders
  if ((!state.stakeholderAssignments.some((row) => row.personName.trim() || row.personEmail.trim()))
      && remoteStakeholders?.length) {
    state.stakeholderAssignments = state.stakeholderAssignments.map((row) => {
      const match = remoteStakeholders.find((item) => item.roleCode === row.roleId)
      return match
        ? { ...row, personName: match.name, personEmail: match.email }
        : row
    })
  }
  const step = isWizardStep(remote.wizardStep)
    ? normalizeWizardStep(remote.wizardStep, state)
    : state.projectId
      ? 'project-stakeholders'
      : 'welcome'
  const remapped = remapWizardProgress({
    step,
    completedThrough: remote.wizardCompletedThrough ?? 0,
    state,
  })
  return {
    email: email.trim().toLowerCase(),
    step: persistedWizardStep(remapped.step, remapped.completedThrough, remapped.state),
    completedThrough: remapped.completedThrough,
    state: remapped.state,
    updatedAt: parseRemoteUpdatedAt(remote.wizardUpdatedAt),
  }
}

export function canOfferResume(draft: Pick<WizardDraft, 'step' | 'state' | 'completedThrough'> & { freshStart?: boolean } | null | undefined): boolean {
  if (!draft) return false
  const named = Boolean(draft.state.projectId || draft.state.projectName?.trim())
  if (draft.freshStart) return named
  return named || draft.completedThrough > 0 || hasWizardProgress(draft)
}

/**
 * Continue from Home follows progress, not a later click on an earlier step.
 * Resume at the furthest of: last working screen, or the next step after the
 * last green (completedThrough).
 */
export function resumeTarget(draft: Pick<WizardDraft, 'step' | 'completedThrough' | 'state'>): WizardStep {
  const saved = normalizeWizardStep(draft.step, draft.state)
  if (!hasWizardProgress(draft) && draft.completedThrough <= 0) {
    return saved === 'welcome' ? 'welcome' : saved
  }
  const savedIdx = saved === 'welcome' ? 0 : Math.max(0, STEP_ORDER.indexOf(saved))
  const frontierIdx =
    draft.completedThrough > 0
      ? Math.min(draft.completedThrough + 1, STEP_ORDER.length - 1)
      : STEP_ORDER.indexOf('project-stakeholders')
  const idx = Math.max(savedIdx, frontierIdx, STEP_ORDER.indexOf('project-stakeholders'))
  const next = STEP_ORDER[Math.min(idx, STEP_ORDER.length - 1)]
  return next === 'welcome' ? 'project-stakeholders' : next
}

/** Persist this as wizardStep — never Home when a working screen exists. */
export function persistedWizardStep(
  uiStep: WizardStep,
  completedThrough: number,
  state: WizardState,
): WizardStep {
  return resumeTarget({ step: uiStep, completedThrough, state })
}

/** Pick the best step to open after refresh/login. Sign-in always lands on Welcome. */
export function resolveBootStep(
  draft: Pick<WizardDraft, 'step' | 'completedThrough' | 'state' | 'freshStart'>,
  sessionStep: WizardStep | null,
  urlStep: WizardStep | null,
): WizardStep {
  if (peekOpenWelcome()) return 'welcome'
  if (draft.freshStart && !draft.state.projectId) {
    return urlStep || sessionStep || draft.step || 'project-stakeholders'
  }
  const preferred =
    urlStep
    || sessionStep
    || (draft.step !== 'welcome' ? draft.step : null)
    || (hasWizardProgress(draft) ? resumeTarget(draft) : null)
  if (!preferred) return 'welcome'
  return preferred
}

export function initialDraft(email: string | null): WizardDraft {
  if (!email) {
    return {
      email: '',
      step: 'welcome',
      completedThrough: 0,
      state: defaultWizardState,
      updatedAt: 0,
    }
  }
  const local = loadWizardDraft(email)
  if (local?.freshStart || (local && hasWizardProgress(local))) return local
  return {
    email: email.trim().toLowerCase(),
    step: 'welcome',
    completedThrough: 0,
    state: defaultWizardState,
    updatedAt: 0,
  }
}

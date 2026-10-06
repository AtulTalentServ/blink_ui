import { substageFromLegacyStep } from './ship.ts'
import { STEP_ORDER } from './steps.ts'
import type { TopologyConfirmation, WizardState, WizardStep } from './types.ts'

/** Saved drafts from before Ship consolidated workspace/implementation/review/release. */
export const WIZARD_LAYOUT_VERSION = 7

/** Pre-ship sidebar order (welcome + 12 working steps). Used only for layout migrations. */
export const LEGACY_STEP_ORDER_PRE_SHIP: WizardStep[] = [
  'welcome',
  'project-stakeholders',
  'integrations',
  'requirements',
  'stakeholder-qa',
  'project-shape',
  'repositories',
  'technology-per-repo',
  'sdlc-plan',
  'generation',
  'implementation',
  'review-pr',
  'release',
]

export const WIZARD_STEPS_V1: WizardStep[] = [
  'welcome',
  'project-stakeholders',
  'integrations',
  'requirements',
  'sdlc-scope',
  'stakeholder-qa',
  'sdlc-plan',
  'project-shape',
  'repositories',
  'technology-per-repo',
  'generation',
]

/** Saved drafts from before Scope & start folded into Requirements. */
export const WIZARD_STEPS_V2: WizardStep[] = [
  'welcome',
  'project-stakeholders',
  'integrations',
  'requirements',
  'sdlc-scope',
  'stakeholder-qa',
  'project-shape',
  'repositories',
  'technology-per-repo',
  'sdlc-plan',
  'generation',
]

function indexIn(order: readonly WizardStep[], step: WizardStep): number {
  return order.indexOf(step)
}

export function shapeFingerprint(
  state: Pick<
    WizardState,
    'topology' | 'repositoryModel' | 'architectureStyle' | 'repositories' | 'repoTechnologies'
  >,
): string {
  const repos = (state.repositories || [])
    .map((repo) => `${repo.id}:${repo.name.trim()}`)
    .join('|')
  const tech = (state.repoTechnologies || [])
    .map(
      (row) =>
        `${row.repoId}:${row.language}:${row.framework}:${row.database}:${row.buildTool}:${row.status}`,
    )
    .join('|')
  return [state.topology, state.repositoryModel, state.architectureStyle, repos, tech].join('::')
}

export function hasWorkPlanArtifacts(
  state: Pick<
    WizardState,
    | 'workClassification'
    | 'specification'
    | 'technicalPlan'
    | 'planAcknowledged'
    | 'shipPlanAcknowledged'
    | 'acceptanceCriteriaAcknowledged'
  >,
): boolean {
  return Boolean(
    state.workClassification?.tier
      || state.specification?.markdown
      || state.specification?.title
      || state.technicalPlan?.markdown
      || state.technicalPlan?.steps?.length
      || state.planAcknowledged
      || state.shipPlanAcknowledged
      || state.acceptanceCriteriaAcknowledged,
  )
}

/** Scope, groom, and start stay. Classify / spec / technical-plan do not. */
export function clearWorkPlanPatch(): Partial<WizardState> {
  return {
    workClassification: null,
    specification: null,
    technicalPlan: null,
    planAcknowledged: false,
    shipPlanAcknowledged: false,
    acceptanceCriteriaAcknowledged: false,
    shapeAcknowledged: false,
    shapeDigest: null,
  }
}

export function withShapeInvalidation(
  prev: WizardState,
  updates: Partial<WizardState>,
): Partial<WizardState> {
  const next = { ...prev, ...updates }
  if (shapeFingerprint(prev) === shapeFingerprint(next)) return updates
  const structureChanged = prev.repositoryModel !== next.repositoryModel
  const dropConfirmation = structureChanged
    && Boolean(prev.topologyConfirmation)
    && updates.topologyConfirmation === undefined
  const confirmationPatch = dropConfirmation ? { topologyConfirmation: null as TopologyConfirmation | null } : {}
  if (!prev.shapeAcknowledged && !hasWorkPlanArtifacts(prev)) {
    return dropConfirmation ? { ...updates, ...confirmationPatch } : updates
  }
  return { ...updates, ...confirmationPatch, ...clearWorkPlanPatch() }
}

export function canonicalRepositoryStructure(value: string | undefined): string {
  const normalized = (value || '').trim().toLowerCase().replace(/_/g, '-')
  if (normalized === 'mono-repo' || normalized === 'monorepo') return 'monorepo'
  if (normalized === 'multirepo' || normalized === 'multi-repo') return 'multi-repo'
  if (normalized === 'singlerepo' || normalized === 'single-repo') return 'single-repo'
  return normalized
}

export function topologyConfirmer(state: WizardState): { name: string; email: string } | null {
  const rows = state.stakeholderAssignments || []
  const lead = rows.find((row) => row.roleId === 'tech_lead' && row.personName.trim() && row.personEmail.trim())
    || rows.find((row) => row.personName.trim() && row.personEmail.trim())
  if (!lead) return null
  return { name: lead.personName.trim(), email: lead.personEmail.trim() }
}

/** Groomed requirement plus later answers, so shape commands see the same story as earlier steps. */
export function shapeRequirementText(state: Pick<
  WizardState,
  'groomDraft' | 'requirementsText' | 'description' | 'groomQuestions' | 'groomAnswers' | 'questions' | 'responses' | 'productScope'
>): string {
  const parts: string[] = []
  const base = (state.groomDraft || state.requirementsText || state.description || '').trim()
  if (base) parts.push(base)

  const clarifications = (state.groomQuestions || [])
    .map((question) => {
      const answer = (state.groomAnswers || []).find((row) => row.questionId === question.id)
      const text = (answer?.otherText || answer?.optionLabel || '').trim()
      return text ? `${question.text} ${text}` : ''
    })
    .filter(Boolean)
  if (clarifications.length) parts.push(clarifications.join('\n'))

  const stakeholderAnswers = (state.questions || [])
    .map((question) => {
      const response = (state.responses || []).find((row) => row.questionId === question.id)
      const text = response?.status === 'answered' ? response.response.trim() : ''
      return text ? `${question.question} ${text}` : ''
    })
    .filter(Boolean)
  if (stakeholderAnswers.length) parts.push(stakeholderAnswers.join('\n'))

  const epics = (state.productScope?.epics || []).map((epic) => epic.title.trim()).filter(Boolean)
  if (epics.length) parts.push(`Epics: ${epics.join('; ')}`)
  const stories = (state.productScope?.stories || []).map((story) => story.title.trim()).filter(Boolean).slice(0, 12)
  if (stories.length) parts.push(`Stories: ${stories.join('; ')}`)

  return parts.join('\n\n')
}

export function technologyStackSummary(state: Pick<WizardState, 'repoTechnologies'>): string {
  return (state.repoTechnologies || [])
    .filter((row) => row.status === 'confirmed')
    .map((row) => {
      const piece = [row.language, row.framework].filter((part) => part && part !== '—').join(' / ')
      return piece ? `${row.repoId}: ${piece}` : ''
    })
    .filter(Boolean)
    .join('; ')
}

export function topologyRoster(state: Pick<WizardState, 'repositories'>) {
  return (state.repositories || [])
    .filter((repo) => repo.name.trim())
    .map((repo) => ({
      repo_id: repo.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || repo.id,
      name: repo.name.trim(),
      role: repo.purpose,
    }))
}

export function nextTopologyConfirmation(
  state: WizardState,
  patch: Partial<Pick<WizardState, 'repositories' | 'repoTechnologies'>> = {},
): TopologyConfirmation | null {
  const current = state.topologyConfirmation
  if (!current?.structure || !current.confirmedBy || !current.evidenceRef) return current || null
  const next = { ...state, ...patch }
  return {
    ...current,
    structure: canonicalRepositoryStructure(next.repositoryModel),
    roster: topologyRoster(next),
    technologyStack: technologyStackSummary(next),
  }
}

export function validateProjectShape(state: WizardState): string | null {
  if (!state.topology) return 'Pick an application topology before continuing.'
  if (!state.repositoryModel) return 'Pick a repository model before continuing.'
  if (!state.architectureStyle) return 'Pick an architecture style before continuing.'
  const confirmed = canonicalRepositoryStructure(state.topologyConfirmation?.structure)
  const selected = canonicalRepositoryStructure(state.repositoryModel)
  if (!confirmed || confirmed !== selected) {
    return 'Confirm the repository structure before continuing.'
  }
  return null
}

export function validateRepositories(state: WizardState): string | null {
  if (!(state.repositories || []).some((repo) => repo.name.trim())) {
    return 'Keep at least one named repository.'
  }
  return null
}

export function validateShapeReview(state: WizardState): string | null {
  const repos = validateRepositories(state)
  if (repos) return repos
  const rows = state.repoTechnologies || []
  if (!rows.length) return 'Confirm a technology stack for each repository.'
  if (rows.some((row) => row.status === 'tbd')) {
    return 'Resolve TBD stacks before the work plan.'
  }
  if (rows.some((row) => row.status !== 'confirmed')) {
    return 'Confirm each repository stack before the work plan.'
  }
  if (!state.shapeAcknowledged) {
    return 'Review this setup, then confirm it is ready for the work plan.'
  }
  return null
}

export function acknowledgeShapePatch(state: WizardState): Partial<WizardState> {
  return {
    shapeAcknowledged: true,
    shapeDigest: shapeFingerprint(state),
    wizardLayoutVersion: WIZARD_LAYOUT_VERSION,
  }
}

export function shapePlanContext(state: WizardState) {
  return {
    topology: state.topology,
    repositoryModel: state.repositoryModel,
    architectureStyle: state.architectureStyle,
    repositories: state.repositories,
    repoTechnologies: state.repoTechnologies,
  }
}

function applyV1ToV2(input: {
  step: WizardStep
  completedThrough: number
  state: WizardState
}): { step: WizardStep; completedThrough: number; state: WizardState } {
  const oldCompleted = Math.max(0, Math.min(input.completedThrough, WIZARD_STEPS_V1.length - 1))
  const generationIdx = indexIn(WIZARD_STEPS_V2, 'generation')
  const qaIdx = indexIn(WIZARD_STEPS_V2, 'stakeholder-qa')
  let step = input.step
  let completedThrough = input.completedThrough
  let state: WizardState = { ...input.state, wizardLayoutVersion: 2 }

  if (state.generationComplete || step === 'generation') {
    if (oldCompleted >= 9) {
      state = {
        ...state,
        shapeAcknowledged: true,
        shapeDigest: state.shapeDigest || shapeFingerprint(state),
      }
    }
    return {
      step: state.generationComplete ? 'generation' : step,
      completedThrough: Math.max(
        oldCompleted >= 9 ? generationIdx : qaIdx,
        completedThrough === 10 ? generationIdx : completedThrough,
      ),
      state,
    }
  }

  if (oldCompleted >= 9) {
    state = {
      ...state,
      shapeAcknowledged: true,
      shapeDigest: state.shapeDigest || shapeFingerprint(state),
    }
    completedThrough = indexIn(WIZARD_STEPS_V2, 'sdlc-plan')
    if (step === 'sdlc-plan' || WIZARD_STEPS_V2.includes(step)) {
      return { step, completedThrough, state }
    }
    return { step: 'sdlc-plan', completedThrough, state }
  }

  if (oldCompleted >= 8) {
    completedThrough = indexIn(WIZARD_STEPS_V2, 'repositories')
    if (step === 'sdlc-plan') step = 'technology-per-repo'
    return { step, completedThrough, state }
  }

  if (oldCompleted >= 7) {
    completedThrough = indexIn(WIZARD_STEPS_V2, 'project-shape')
    if (step === 'sdlc-plan') step = 'repositories'
    return { step, completedThrough, state }
  }

  if (oldCompleted >= 6 || step === 'sdlc-plan') {
    completedThrough = qaIdx
    if (step === 'sdlc-plan') step = 'project-shape'
    return { step, completedThrough, state }
  }

  return { step, completedThrough: oldCompleted, state }
}

function applyV2ToV3(input: {
  step: WizardStep
  completedThrough: number
  state: WizardState
}): { step: WizardStep; completedThrough: number; state: WizardState } {
  const step = input.step === 'sdlc-scope' ? 'requirements' : input.step
  let completedThrough = input.completedThrough
  if (completedThrough >= 4) completedThrough -= 1
  completedThrough = Math.max(0, Math.min(completedThrough, STEP_ORDER.length - 1))
  return {
    step,
    completedThrough,
    state: { ...input.state, wizardLayoutVersion: 3 },
  }
}

/**
 * Existing Generation progress is now the user-facing Workspace phase.
 * Do not advance saved projects into Implementation just because that step
 * was added after their draft was created.
 */
function applyV3ToV4(input: {
  step: WizardStep
  completedThrough: number
  state: WizardState
}): { step: WizardStep; completedThrough: number; state: WizardState } {
  const workspaceIdx = indexIn(LEGACY_STEP_ORDER_PRE_SHIP, 'generation')
  return {
    step: input.step === 'implementation' ? 'generation' : input.step,
    completedThrough: Math.min(input.completedThrough, workspaceIdx),
    state: { ...input.state, wizardLayoutVersion: 4 },
  }
}

/** Existing Implementation progress must not auto-advance into Review & PR. */
function applyV4ToV5(input: {
  step: WizardStep
  completedThrough: number
  state: WizardState
}): { step: WizardStep; completedThrough: number; state: WizardState } {
  const implementationIdx = indexIn(LEGACY_STEP_ORDER_PRE_SHIP, 'implementation')
  return {
    step: input.step === 'review-pr' ? 'implementation' : input.step,
    completedThrough: Math.min(input.completedThrough, implementationIdx),
    state: { ...input.state, wizardLayoutVersion: 5 },
  }
}

/** Existing Review & PR progress must not auto-advance into Release. */
function applyV5ToV6(input: {
  step: WizardStep
  completedThrough: number
  state: WizardState
}): { step: WizardStep; completedThrough: number; state: WizardState } {
  const reviewIdx = indexIn(LEGACY_STEP_ORDER_PRE_SHIP, 'review-pr')
  return {
    step: input.step === 'release' ? 'review-pr' : input.step,
    completedThrough: Math.min(input.completedThrough, reviewIdx),
    state: { ...input.state, wizardLayoutVersion: 6 },
  }
}

function applyV6ToV7(input: {
  step: WizardStep
  completedThrough: number
  state: WizardState
}): { step: WizardStep; completedThrough: number; state: WizardState } {
  const shipIdx = indexIn(STEP_ORDER, 'ship')
  let step = input.step
  let substage = input.state.shipSubstage || 'workspace'
  if (
    step === 'generation'
    || step === 'implementation'
    || step === 'review-pr'
    || step === 'release'
  ) {
    substage = substageFromLegacyStep(step)
    step = 'ship'
  }
  let completedThrough = input.completedThrough
  if (completedThrough >= indexIn(LEGACY_STEP_ORDER_PRE_SHIP, 'generation')) {
    completedThrough = shipIdx
  }
  completedThrough = Math.min(completedThrough, shipIdx)
  return {
    step,
    completedThrough,
    state: {
      ...input.state,
      shipSubstage: substage,
      wizardLayoutVersion: WIZARD_LAYOUT_VERSION,
    },
  }
}

export function remapWizardProgress(input: {
  step: WizardStep
  completedThrough: number
  state: WizardState
}): { step: WizardStep; completedThrough: number; state: WizardState } {
  const version = input.state.wizardLayoutVersion ?? 0
  if (version >= WIZARD_LAYOUT_VERSION) {
    if (input.step === 'sdlc-scope') return { ...input, step: 'requirements' }
    if (
      input.step === 'generation'
      || input.step === 'implementation'
      || input.step === 'review-pr'
      || input.step === 'release'
    ) {
      return applyV6ToV7(input)
    }
    return input
  }

  let next = { ...input, state: { ...input.state } }
  if (version < 2) {
    next = applyV1ToV2(next)
  }
  if ((next.state.wizardLayoutVersion ?? 0) < 3) {
    next = applyV2ToV3(next)
  }
  if ((next.state.wizardLayoutVersion ?? 0) < 4) {
    next = applyV3ToV4(next)
  }
  if ((next.state.wizardLayoutVersion ?? 0) < 5) {
    next = applyV4ToV5(next)
  }
  if ((next.state.wizardLayoutVersion ?? 0) < 6) {
    next = applyV5ToV6(next)
  }
  if ((next.state.wizardLayoutVersion ?? 0) < 7) {
    next = applyV6ToV7(next)
  }
  return next
}

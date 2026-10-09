import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, MessageSquare } from 'lucide-react'
import { downloadWorkspace, fetchWorkspaceStatus, isNotProjectOwnerError, isAutosavePaused, rehomeProject, saveProject, clarifyRequirement, createJiraComment, pollJiraComments, resetSimulatedJiraReplies, fetchMyProject, fetchMyIntegrations, fetchProjectIntegrations, applyMyIntegrationsToProject, configureStakeholders, confirmStakeholders, createRepositories, fetchCanonicalSnapshot, postJiraGateEvidence, recordCanonicalGroomingAnswer, shipCheckpoint, syncCanonicalWizardDraft, upsertCanonicalGroomingQuestion, apiUrl, type ProjectPayload } from './api/blink'
import { useAuth } from './auth/AuthContext'
import { publishDeveloperSession, useDeveloperCapability } from './developer'
import { sendStakeholderQuestions } from './api/email'
import { WizardSidebar, STEP_ORDER } from './components/WizardSidebar'
import { SessionControls } from './components/SessionControls'
import { ChatPanel, useChatPanelOpen } from './components/ChatPanel'
import { ThemeBackground } from './components/ThemeBackground'
import {
  GenerationDownloadScreen,
  ProjectShapeScreen,
  RepositoriesScreen,
  TechnologyPerRepoScreen,
  type ShapeConfirmAction,
} from './screens/ExtendedScreens'
import { WorkspaceScreen } from './screens/WorkspaceScreen'
import { ReviewPrScreen } from './screens/ReviewPrScreen'
import { ReleaseClosureScreen } from './screens/ReleaseClosureScreen'
import {
  ProjectStakeholdersScreen,
  validateProjectStakeholders,
} from './screens/ProjectStakeholdersScreen'
import { RequirementsScreen, validateRequirements } from './screens/RequirementsScreen'
import { IntegrationsScreen } from './screens/IntegrationsScreen'
import {
  StakeholderQaScreen,
  jiraCommentForQuestion,
  validateStakeholderQa,
} from './screens/StakeholderQaScreen'
import {
  SdlcPlanningScreen,
  validateSdlcPlan,
} from './screens/SdlcPlanningScreen'
import { ImplementationReadinessScreen } from './screens/ImplementationReadinessScreen'
import { ShipScreen } from './screens/ShipScreen'
import { WelcomeScreen } from './screens/WelcomeScreen'
import {
  assigneeForQuestion,
  carryClarifyQuestionsForward,
  simulatedStakeholderReply,
} from './wizard/questions'
import { roleLabel } from './wizard/stakeholders'
import { patchFromCanonicalSnapshot } from './wizard/canonical'
import { substageFromLegacyStep } from './wizard/ship'
import { primaryContinueLabel, phaseProgressLabel, stepIndex } from './wizard/steps'
import {
  acknowledgeShapePatch,
  validateProjectShape,
  validateRepositories,
  validateShapeReview,
  withShapeInvalidation,
} from './wizard/shape'
import { buildDownloadStructure, defaultRepositories, NEXT_SDLC_COMMAND } from './wizard/defaults'
import { mergeSavedIntegrations } from './wizard/mergeIntegrations'
import {
  clearGroomingPatch,
  defaultWizardState,
  generationStepDefs,
  type GroomAnswer,
  type ShipSubstage,
  type WizardState,
  type WizardStep,
} from './wizard/types'
import { assignQuestionBands, groomingComplete, unansweredRequired } from './wizard/grooming'
import { type JiraPublishState } from './wizard/thinking'
import { autoMapQuestionsToJira } from './wizard/jiraMatch'
import {
  applyGroomingRevisionToState,
  applyQuestionResponsePatch,
  patchAfterJiraAnswerSync,
  responsesForStakeholderQuestions,
  shouldRunGroomingRevisionAfterAnswers,
  stakeholderFeedbackFromState,
  syncStakeholderAnswerToJira,
} from './wizard/stakeholderSync'
import {
  allowedStep,
  isWizardHistoryState,
  seedWizardHistory,
  stepFromLocation,
  writeStepUrl,
} from './wizard/history'
import {
  draftFromRemote,
  hasWizardProgress,
  initialDraft,
  loadWizardDraft,
  loadSessionStep,
  normalizeWizardStep,
  resumeTarget,
  persistedWizardStep,
  resolveBootStep,
  saveWizardDraft,
  saveSessionStep,
  serializeWizardState,
  stepLabel,
  consumeOpenWelcome,
  peekOpenWelcome,
  canOfferResume,
} from './wizard/resume'

function withDraftProjectPayload(payload: ProjectPayload): ProjectPayload {
  const stakeholders = payload.stakeholders.filter((row) => row.name.trim() && row.email.trim())
  return {
    ...payload,
    projectName: payload.projectName.trim() || `Blink Dev ${new Date().toISOString().slice(0, 10)}`,
    description:
      payload.description.trim() ||
      'Developer-mode draft. Update this on Project & Stakeholders when you are ready.',
    stakeholders:
      stakeholders.length > 0
        ? stakeholders
        : defaultWizardState.stakeholderAssignments.map((row) => ({
            roleCode: row.roleId,
            name: row.personName,
            email: row.personEmail,
          })),
  }
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function buildEmailPayload(state: WizardState, questionIds: string[]) {
  return state.questions
    .filter((q) => questionIds.includes(q.id))
    .map((q) => {
      const assignee = assigneeForQuestion(state, q.assignedRoleId)
      return {
        question_id: q.id,
        question: q.question,
        recipient_email: assignee.email,
        recipient_name: assignee.name,
        role: roleLabel(q.assignedRoleId),
        project_name: state.projectName,
        proposed_answer: q.proposedAnswer || undefined,
      }
    })
    .filter((row) => Boolean(row.recipient_email.trim()))
}

export default function App() {
  const { session } = useAuth()
  const boot = initialDraft(session?.email ?? null)
  const sessionStep = loadSessionStep()
  const urlStep = stepFromLocation()
  const preferredBoot = normalizeWizardStep(resolveBootStep(boot, sessionStep, urlStep), boot.state)
  const bootStep = allowedStep(
    preferredBoot,
    preferredBoot,
    boot.completedThrough,
    groomingComplete(boot.state),
    false,
    Boolean(boot.state.shapeAcknowledged),
    boot.state.canonicalAllowedSteps,
  )
  const [state, setState] = useState<WizardState>(boot.state)
  const [step, setStep] = useState<WizardStep>(bootStep)
  const [completedThrough, setCompletedThrough] = useState(boot.completedThrough)
  const lastWorkingRef = useRef<WizardStep>(
    persistedWizardStep(boot.step, boot.completedThrough, boot.state),
  )
  const [status, setStatus] = useState<{ type: 'error' | 'success' | 'info'; message: string } | null>(null)

  useEffect(() => {
    if (step !== 'welcome') consumeOpenWelcome()
  }, [step])

  useEffect(() => {
    if (!status || status.type === 'error') return
    const timer = window.setTimeout(() => setStatus(null), 6000)
    return () => window.clearTimeout(timer)
  }, [status])

  const [loading, setLoading] = useState(false)
  const [grooming, setGrooming] = useState(false)
  const jiraPublish: JiraPublishState | null = null
  const groomAskInFlightRef = useRef(false)
  const lastRevisionFeedbackRef = useRef('')
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const [postingJira, setPostingJira] = useState(false)
  const [refreshingJira, setRefreshingJira] = useState(false)
  const [simulatingJira, setSimulatingJira] = useState(false)
  const [resettingSimJira, setResettingSimJira] = useState(false)
  const creatingReposRef = useRef(false)
  const [creatingRepos, setCreatingRepos] = useState(false)
  const [folderPrep, setFolderPrep] = useState<'idle' | 'preparing' | 'ready' | 'failed'>('idle')
  const [folderProgress, setFolderProgress] = useState({ percent: 0, copied: 0, total: 0 })
  const [folderQuery, setFolderQuery] = useState<{ name: string; id?: string } | null>(null)
  const [governancePrep, setGovernancePrep] = useState<'idle' | 'preparing' | 'ready' | 'failed'>('idle')
  /** Classic kit ZIP + folder tree (pre-Ship). Avoid jumping to Ship before Work plan. */
  const [kitResultOpen, setKitResultOpen] = useState(false)
  const lastSavedPayloadRef = useRef<string | null>(null)
  const lastGovernedPayloadRef = useRef<string | null>(null)
  const stakeholderGovernanceInFlightRef = useRef(false)
  const autosaveInFlightRef = useRef(false)
  const autosaveQueuedRef = useRef(false)
  const stepRef = useRef(step)
  const stateRef = useRef(state)
  const completedRef = useRef(completedThrough)
  const skipRemoteResumeRef = useRef(false)
  const freshStartRef = useRef(Boolean(boot.freshStart))
  stepRef.current = step
  stateRef.current = state
  completedRef.current = completedThrough
  if (step !== 'welcome') {
    const currentIdx = STEP_ORDER.indexOf(step)
    const savedIdx = STEP_ORDER.indexOf(lastWorkingRef.current)
    if (savedIdx < 1 || currentIdx >= savedIdx) lastWorkingRef.current = step
  }
  const skipStepValidation = useDeveloperCapability('skipStepValidation')
  const autoEnsureProject = useDeveloperCapability('autoEnsureProject')
  const unrestrictedNav = useDeveloperCapability('unrestrictedStepNav')
  const [chatOpen, setChatOpen] = useChatPanelOpen()
  const shapeConfirmRef = useRef<(() => Promise<void>) | null>(null)
  const handleGroomLooksGoodRef = useRef<() => Promise<boolean>>(async () => false)
  const [shapeConfirmUi, setShapeConfirmUi] = useState({ busy: false, pending: false, confirmed: false })
  const onShapeConfirm = useCallback((action: ShapeConfirmAction | null) => {
    shapeConfirmRef.current = action?.run ?? null
    setShapeConfirmUi((prev) => {
      const next = action
        ? { busy: action.busy, pending: action.pending, confirmed: action.confirmed }
        : { busy: false, pending: false, confirmed: false }
      if (prev.busy === next.busy && prev.pending === next.pending && prev.confirmed === next.confirmed) return prev
      return next
    })
  }, [])

  const patch = useCallback((updates: Partial<WizardState>) => {
    setState((prev) => ({ ...prev, ...withShapeInvalidation(prev, updates) }))
  }, [])

  const validateCurrentStep = useCallback((): string | null => {
    const current = stateRef.current
    switch (step) {
      case 'welcome':
        return null
      case 'project-stakeholders':
        return validateProjectStakeholders(current)
      case 'sdlc-scope':
      case 'requirements':
        return validateRequirements(current)
      case 'stakeholder-qa':
        return validateStakeholderQa(current)
      case 'project-shape':
        return validateProjectShape(current)
      case 'repositories':
        return validateRepositories(current)
      case 'technology-per-repo':
        return validateShapeReview(current)
      case 'sdlc-plan':
        return validateSdlcPlan(current)
      default:
        return null
    }
  }, [step])

  const projectPayload = useCallback((): ProjectPayload => ({
    projectType: state.projectType,
    projectName: state.projectName,
    description: state.description,
    stakeholders: state.stakeholderAssignments.map((row) => ({
      roleCode: row.roleId,
      name: row.personName,
      email: row.personEmail,
    })),
  }), [state.projectType, state.projectName, state.description, state.stakeholderAssignments])

  const wizardBookmark = useCallback((): WizardStep => {
    return persistedWizardStep(lastWorkingRef.current, completedRef.current, stateRef.current)
  }, [])

  const scheduleStakeholderGovernance = useCallback(
    (projectId: string, opts?: { draft?: boolean; force?: boolean }) => {
      const payload = opts?.draft ? withDraftProjectPayload(projectPayload()) : projectPayload()
      const payloadStr = JSON.stringify(payload)
      if (!payload.stakeholders.some((s) => s.name?.trim() || s.email?.trim())) {
        return
      }
      if (stakeholderGovernanceInFlightRef.current && !opts?.force) {
        return
      }
      const current = stateRef.current
      if (
        !opts?.force &&
        lastGovernedPayloadRef.current === payloadStr &&
        current.stakeholdersConfirmed
      ) {
        return
      }

      stakeholderGovernanceInFlightRef.current = true
      setGovernancePrep('preparing')
      patch({ governanceStatus: 'preparing' })

      void (async () => {
        let sodWarnings = current.sodWarnings || []
        let nextCommand = current.nextSdlcCommand
        let stakeholdersConfirmed = Boolean(current.stakeholdersConfirmed)
        let stakeholdersConfirmationDigest = current.stakeholdersConfirmationDigest || null
        try {
          const configured = await configureStakeholders(projectId)
          sodWarnings = configured.sodWarnings?.length ? configured.sodWarnings.map(String) : sodWarnings
          nextCommand = configured.nextCommand || nextCommand || '/plan-product-scope'
          lastGovernedPayloadRef.current = payloadStr
          patch({
            sodWarnings,
            nextSdlcCommand: nextCommand,
            governanceStatus: 'ready',
            stakeholdersConfirmed,
            stakeholdersConfirmationDigest,
          })
          setGovernancePrep('ready')
        } catch {
          patch({ governanceStatus: 'failed' })
          setGovernancePrep('failed')
        } finally {
          stakeholderGovernanceInFlightRef.current = false
        }
      })()
    },
    [patch, projectPayload],
  )

  const persistProject = useCallback(async (opts?: { draft?: boolean }): Promise<{
    id: string
    workspaceStatus?: 'preparing' | 'ready' | 'failed' | null
    sodWarnings?: string[]
    nextCommand?: string
    governanceStatus?: 'idle' | 'preparing' | 'ready' | 'failed' | null
  }> => {
    const payload = opts?.draft ? withDraftProjectPayload(projectPayload()) : projectPayload()
    const payloadStr = JSON.stringify(payload)
    const withWizard: ProjectPayload = {
      ...payload,
      wizardStep: wizardBookmark(),
      wizardCompletedThrough: completedRef.current,
      wizardState: serializeWizardState(state),
    }
    if (state.projectId && lastSavedPayloadRef.current === payloadStr) {
      try {
        await saveProject(withWizard, state.projectId)
      } catch {
        // Local draft is still stored; server can catch up on the next save.
      }
      return {
        id: state.projectId,
        workspaceStatus: folderPrep === 'idle' ? null : folderPrep,
        sodWarnings: state.sodWarnings,
        nextCommand: state.nextSdlcCommand || undefined,
        governanceStatus: governancePrep === 'idle' ? state.governanceStatus : governancePrep,
      }
    }
    const saved = await saveProject(withWizard, state.projectId)
    lastSavedPayloadRef.current = payloadStr
    const id = String(saved.id)

    patch({
      projectId: id,
      projectName: payload.projectName,
      description: payload.description,
    })
    void syncCanonicalWizardDraft(id, stateRef.current.canonicalRevision ?? undefined)
      .then((snap) => patch(patchFromCanonicalSnapshot(snap, stateRef.current)))
      .catch(() => undefined)
    setFolderQuery({ name: saved.projectName || payload.projectName, id })
    // Only show the bar when the API actually reports workspace work — avoids Neon auth spam.
    if (saved.workspaceStatus === 'preparing' || saved.workspaceStatus === 'ready' || saved.workspaceStatus === 'failed') {
      setFolderPrep(saved.workspaceStatus)
      if (saved.workspaceStatus === 'ready') {
        setFolderProgress({ percent: 100, copied: 0, total: 0 })
      }
    }
    return {
      id,
      workspaceStatus: saved.workspaceStatus,
      sodWarnings: state.sodWarnings,
      nextCommand: state.nextSdlcCommand || undefined,
      governanceStatus: state.governanceStatus,
    }
  }, [projectPayload, state, folderPrep, governancePrep, patch, wizardBookmark])

  const ensureDraftProject = useCallback(async (): Promise<{ id: string; created: boolean }> => {
    if (state.projectId) {
      return { id: state.projectId, created: false }
    }
    const saved = await persistProject({ draft: true })
    return { id: saved.id, created: true }
  }, [state.projectId, persistProject])

  const goToStep = useCallback((next: WizardStep, historyMode: 'push' | 'replace' | 'silent' = 'push') => {
    const mapped = normalizeWizardStep(next, stateRef.current)
    if (next !== mapped && mapped === 'ship') {
      patch({ shipSubstage: substageFromLegacyStep(next) })
    }
    if (mapped === stepRef.current && historyMode === 'push') {
      return
    }
    setStep(mapped)
    if (historyMode === 'silent') {
      return
    }
    writeStepUrl(mapped, historyMode)
  }, [patch])

  const goToShipSubstage = useCallback(
    (substage: ShipSubstage) => {
      const current = stateRef.current
      const allowed = new Set(
        current.canonicalAllowedShipSubstages?.length
          ? current.canonicalAllowedShipSubstages
          : (['workspace'] as ShipSubstage[]),
      )
      if (current.gitWritten) allowed.add('implementation')
      if (current.implementStep) allowed.add('review-pr')
      if (!allowed.has(substage)) {
        setStatus({ type: 'info', message: `Complete the prior Ship phase before opening ${substage}.` })
        return
      }
      setStatus(null)
      patch({ shipSubstage: substage, canonicalShipSubstage: substage })
      goToStep('ship')
      const projectId = current.projectId
      if (projectId) {
        void shipCheckpoint(projectId, {
          substage,
          idempotencyKey: `ship-nav-${substage}`,
          payload: { source: 'wizard-nav' },
        }).catch(() => undefined)
        void fetchCanonicalSnapshot(projectId)
          .then((snap) => {
            // Prefer the substage we just opened — snapshot often lags Neon git-apply.
            const preferred = {
              ...stateRef.current,
              shipSubstage: substage,
              canonicalShipSubstage: substage,
              gitWritten: stateRef.current.gitWritten || current.gitWritten,
            }
            patch(patchFromCanonicalSnapshot(snap, preferred))
          })
          .catch(() => undefined)
      }
    },
    [goToStep, patch],
  )

  const startFresh = useCallback((type: 'new' | 'existing') => {
    skipRemoteResumeRef.current = true
    freshStartRef.current = true
    lastSavedPayloadRef.current = null
    lastGovernedPayloadRef.current = null
    stakeholderGovernanceInFlightRef.current = false
    setFolderPrep('idle')
    setGovernancePrep('idle')
    setFolderQuery(null)
    setKitResultOpen(false)
    setStatus(null)
    const fresh: WizardState = {
      ...defaultWizardState,
      projectType: type,
      existingSourceMode: 'none',
    }
    setState(fresh)
    setCompletedThrough(0)
    lastWorkingRef.current = 'project-stakeholders'
    if (session?.email) {
      saveWizardDraft(session.email, {
        step: 'project-stakeholders',
        completedThrough: 0,
        state: fresh,
        updatedAt: Date.now(),
        freshStart: true,
      })
    }
    goToStep('project-stakeholders')
    seedWizardHistory('project-stakeholders', true)
  }, [goToStep, session?.email])

  useEffect(() => {
    seedWizardHistory(stepRef.current)
  }, [])

  useEffect(() => {
    const onPop = (event: PopStateEvent) => {
      const raw = isWizardHistoryState(event.state)
        ? event.state.step
        : stepFromLocation()
      if (raw) {
        const next = normalizeWizardStep(raw, stateRef.current)
        setStep(
          allowedStep(
            next,
            next,
            completedRef.current,
            groomingComplete(stateRef.current),
            false,
            Boolean(stateRef.current.shapeAcknowledged),
            stateRef.current.canonicalAllowedSteps,
          ),
        )
        return
      }
      const idx = stepIndex(stepRef.current)
      if (idx > 0) {
        const prev = STEP_ORDER[idx - 1]
        setStep(prev)
        writeStepUrl(prev, 'push')
      }
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  useEffect(() => {
    if (state.projectId) {
      freshStartRef.current = false
    }
  }, [state.projectId])

  useEffect(() => {
    if (!session?.email) return
    saveWizardDraft(session.email, {
      step: wizardBookmark(),
      completedThrough,
      state,
      updatedAt: Date.now(),
      freshStart: freshStartRef.current && !state.projectId,
    })
    saveSessionStep(step)
  }, [session?.email, step, completedThrough, state, wizardBookmark])

  useEffect(() => {
    if (!session?.email || !state.projectId) return
    const runSave = () => {
      if (isAutosavePaused()) {
        autosaveQueuedRef.current = true
        window.setTimeout(runSave, 2000)
        return
      }
      if (autosaveInFlightRef.current) {
        autosaveQueuedRef.current = true
        return
      }
      autosaveInFlightRef.current = true
      autosaveQueuedRef.current = false
      const payload = withDraftProjectPayload(projectPayload())
      const wizardPayload = {
        ...payload,
        wizardStep: wizardBookmark(),
        wizardCompletedThrough: completedThrough,
        wizardState: serializeWizardState(stateRef.current),
      }
      void saveProject(wizardPayload, state.projectId)
        .catch((error) => {
          if (!isNotProjectOwnerError(error)) return
          void rehomeProject(wizardPayload).then((saved) => {
            patch({ projectId: String(saved.id) })
          }).catch(() => undefined)
        })
        .finally(() => {
          autosaveInFlightRef.current = false
          if (autosaveQueuedRef.current) {
            autosaveQueuedRef.current = false
            window.setTimeout(runSave, 1500)
          }
        })
    }
    // Longer debounce + single in-flight PUT — stacked autosaves were starving Neon for confirm-stakeholders.
    const timer = window.setTimeout(runSave, 2500)
    return () => window.clearTimeout(timer)
  }, [session?.email, state, step, completedThrough, projectPayload, wizardBookmark, patch])

  // Flush draft + best-effort server save before tab close/refresh.
  useEffect(() => {
    if (!session?.email) return
    const flush = () => {
      saveWizardDraft(session.email, {
        step: wizardBookmark(),
        completedThrough: completedRef.current,
        state,
        updatedAt: Date.now(),
        freshStart: freshStartRef.current && !state.projectId,
      })
      saveSessionStep(stepRef.current)
      if (!state.projectId) return
      const payload = withDraftProjectPayload(projectPayload())
      const body = JSON.stringify({
        ...payload,
        wizardStep: wizardBookmark(),
        wizardCompletedThrough: completedRef.current,
        wizardState: serializeWizardState(state),
      })
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (session.token) headers.Authorization = `Bearer ${session.token}`
      try {
        void fetch(apiUrl(`/projects/${state.projectId}`), {
          method: 'PUT',
          headers,
          body,
          keepalive: true,
        }).catch(() => undefined)
      } catch {
        /* ignore unload errors */
      }
    }
    window.addEventListener('pagehide', flush)
    window.addEventListener('beforeunload', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('beforeunload', flush)
    }
  }, [session?.email, session?.token, state, projectPayload, wizardBookmark])

  useEffect(() => {
    if (!session?.email || skipRemoteResumeRef.current) return
    const localNow = loadWizardDraft(session.email)
    if (localNow?.freshStart) return
    let cancelled = false
    const email = session.email
    void fetchMyProject()
      .then((remote) => {
        if (cancelled || !remote) return
        if (freshStartRef.current || loadWizardDraft(email)?.freshStart) return
        const local = initialDraft(email)
        const remoteDraft = draftFromRemote(email, remote)
        const preferLocal = local.updatedAt >= remoteDraft.updatedAt && hasWizardProgress(local)
        if (preferLocal) {
          return
        }
        if (!hasWizardProgress(remoteDraft)) return
        skipRemoteResumeRef.current = true
        setState(remoteDraft.state)
        setCompletedThrough(remoteDraft.completedThrough)
        lastWorkingRef.current = persistedWizardStep(
          remoteDraft.step,
          remoteDraft.completedThrough,
          remoteDraft.state,
        )
        saveWizardDraft(email, {
          step: remoteDraft.step,
          completedThrough: remoteDraft.completedThrough,
          state: remoteDraft.state,
          updatedAt: Math.max(remoteDraft.updatedAt, Date.now()),
          freshStart: false,
        })
        if (peekOpenWelcome() || stepRef.current === 'welcome') {
          return
        }
        const nextStep = allowedStep(
          resolveBootStep(remoteDraft, loadSessionStep(), stepFromLocation()),
          remoteDraft.step,
          remoteDraft.completedThrough,
          groomingComplete(remoteDraft.state),
          false,
          Boolean(remoteDraft.state.shapeAcknowledged),
          remoteDraft.state.canonicalAllowedSteps,
        )
        void fetchCanonicalSnapshot(String(remote.id))
          .then((snap) => patch(patchFromCanonicalSnapshot(snap, stateRef.current)))
          .catch(() => undefined)
        goToStep(nextStep, 'replace')
        seedWizardHistory(nextStep, true)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [session?.email, goToStep])

  useEffect(() => {
    if (!session?.email) return
    let cancelled = false
    const run = async () => {
      try {
        const projectId = state.projectId
        let saved = projectId
          ? await fetchProjectIntegrations(projectId)
          : await fetchMyIntegrations()
        if (cancelled) return
        if (projectId && saved.length === 0) {
          saved = await applyMyIntegrationsToProject(projectId)
          if (cancelled) return
        }
        if (!saved.length) return
        setState((prev) => ({
          ...prev,
          integrations: mergeSavedIntegrations(prev.integrations, saved),
        }))
      } catch {
        /* keep local wizard snapshot if hydrate fails */
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [session?.email, state.projectId])

  useEffect(() => {
    if (!state.projectId) return
    let cancelled = false
    void fetchCanonicalSnapshot(state.projectId)
      .then((snap) => {
        if (!cancelled) patch(patchFromCanonicalSnapshot(snap, stateRef.current))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [state.projectId, patch])

  useEffect(() => {
    publishDeveloperSession({
      step,
      projectId: state.projectId,
      groomingUnlocked: groomingComplete(state),
    })
  }, [step, state])

  useEffect(() => {
    if (folderPrep !== 'preparing' || !folderQuery?.name.trim()) return
    let cancelled = false
    let emptyPolls = 0
    let inFlight = false
    const check = async () => {
      if (inFlight || cancelled) return
      inFlight = true
      try {
        const progress = await fetchWorkspaceStatus(folderQuery.name, folderQuery.id)
        if (cancelled) return
        setFolderProgress({
          percent: progress.percent ?? 0,
          copied: progress.filesCopied ?? 0,
          total: progress.filesTotal ?? 0,
        })
        if (progress.status === 'ready') {
          setFolderProgress((prev) => ({ ...prev, percent: 100 }))
          setFolderPrep('ready')
          return
        }
        if (progress.status === 'failed') {
          setFolderPrep('failed')
          return
        }
        if (!progress.status) {
          emptyPolls += 1
          if (emptyPolls >= 12) setFolderPrep('idle')
        } else {
          emptyPolls = 0
        }
      } catch {
        emptyPolls += 1
        if (emptyPolls >= 12) setFolderPrep('idle')
      } finally {
        inFlight = false
      }
    }
    void check()
    // Auth hits Neon on every poll — keep this rare so clarify/login stay responsive.
    const timer = window.setInterval(() => void check(), 8000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [folderQuery, folderPrep])

  useEffect(() => {
    if (folderPrep !== 'ready') return
    const timer = window.setTimeout(() => setFolderPrep('idle'), 5000)
    return () => window.clearTimeout(timer)
  }, [folderPrep])

  useEffect(() => {
    if (governancePrep !== 'ready' && governancePrep !== 'failed') return
    const timer = window.setTimeout(() => setGovernancePrep('idle'), 8000)
    return () => window.clearTimeout(timer)
  }, [governancePrep])

  const handleCreateGithubRepos = useCallback(async (): Promise<boolean> => {
    if (creatingReposRef.current) return false
    const github = state.integrations?.find((item) => item.id === 'github')
    if (!github?.connected || !state.projectId) {
      setStatus({ type: 'error', message: 'Connect GitHub on the Integrations screen first.' })
      return false
    }
    const repositories = state.repositories || []
    const pending = repositories.filter(
      (repository) =>
        repository.name.trim()
        && repository.createStatus !== 'created'
        && repository.createStatus !== 'exists',
    )
    if (!pending.length) {
      if (!repositories.some((repository) => repository.name.trim())) {
        setStatus({ type: 'error', message: 'Add at least one repository name.' })
        return false
      }
      return true
    }

    creatingReposRef.current = true
    setCreatingRepos(true)
    setStatus(null)
    const clearBusy = () => {
      creatingReposRef.current = false
      setCreatingRepos(false)
    }
    // Hard unlock if the request hangs past the client abort — button must not stay disabled forever.
    const stuckTimer = window.setTimeout(clearBusy, 65_000)
    try {
      const result = await createRepositories({
        provider: 'github',
        projectId: state.projectId,
        organization: github.organization,
        repositories: pending.map((repository) => ({
          name: repository.name.trim(),
          description: repository.description,
        })),
      })
      const createdRows = result.repositories || []
      patch({
        repositoriesTouched: true,
        repositories: repositories.map((repository) => {
          const created = createdRows.find((item) => item.name === repository.name.trim())
          if (!created) return repository
          return {
            ...repository,
            htmlUrl: created.htmlUrl || repository.htmlUrl,
            createStatus: created.status as 'created' | 'exists' | 'failed',
            createMessage: created.message,
          }
        }),
      })
      const created = createdRows.filter((item) => item.status === 'created').length
      const exists = createdRows.filter((item) => item.status === 'exists').length
      const failed = createdRows.filter((item) => item.status === 'failed').length
      if (failed && !created && !exists) {
        setStatus({
          type: 'error',
          message: createdRows.map((item) => item.message).filter(Boolean).join(' ') || 'Could not create GitHub repositories.',
        })
        return false
      }
      if (state.bootstrapAcknowledged && (created > 0 || exists > 0)) {
        const issueKey =
          state.jiraCreatedIssues?.find((item) => item.jiraKey)?.jiraKey
          || state.sdlcStartIssueId
          || state.workClassification?.issueId
          || state.specification?.issueId
          || state.productScope?.storyIds?.[0]
        if (issueKey) {
          void postJiraGateEvidence(state.projectId, {
            issueKey,
            gate: 'G-BOOTSTRAP',
            message: 'Human G-BOOTSTRAP acknowledgement plus remotes created.',
          }).catch(() => undefined)
        }
      }
      if (failed) {
        setStatus({
          type: 'info',
          message: `GitHub: ${created} created, ${exists} already existed, ${failed} failed. Use Reconcile to retry only the failed ones.`,
        })
      } else {
        setStatus({
          type: 'success',
          message: `GitHub: ${created} created, ${exists} already existed.`,
        })
      }
      return failed === 0
    } catch (err) {
      setStatus({ type: 'error', message: err instanceof Error ? err.message : 'Could not create GitHub repositories.' })
      return false
    } finally {
      window.clearTimeout(stuckTimer)
      clearBusy()
    }
  }, [patch, state.bootstrapAcknowledged, state.integrations, state.jiraCreatedIssues, state.productScope, state.projectId, state.repositories, state.sdlcStartIssueId, state.specification, state.workClassification])

  const goNext = useCallback(async () => {
    // Clarify lives on stakeholder-qa; Continue can confirm wording (same as the in-page CTA).
    if (
      step === 'stakeholder-qa' &&
      state.requirementsText.trim() &&
      !state.groomConfirmed &&
      !skipStepValidation
    ) {
      const ok = await handleGroomLooksGoodRef.current()
      if (!ok) return
    }
    const err = skipStepValidation ? null : validateCurrentStep()
    if (err) {
      setStatus({ type: 'error', message: err })
      return
    }
    if (step === 'project-stakeholders') {
      const draft =
        skipStepValidation && (!state.projectName.trim() || !state.description.trim())
      setStatus(null)

      const runStakeholderSideEffects = (projectId: string) => {
        if (!stateRef.current.stakeholdersConfirmed) {
          setGovernancePrep('preparing')
          patch({ governanceStatus: 'preparing' })
          void configureStakeholders(projectId).catch(() => undefined)
          void confirmStakeholders(projectId)
            .then((confirmed) => {
              if (confirmed.status !== 'ok') {
                throw new Error(confirmed.message || confirmed.errors?.join('; ') || 'Confirm stakeholders failed')
              }
              patch({
                stakeholdersConfirmed: true,
                stakeholdersConfirmationDigest: confirmed.confirmationDigest || null,
                nextSdlcCommand: confirmed.nextCommand || stateRef.current.nextSdlcCommand,
                governanceStatus: 'ready',
              })
              setGovernancePrep('ready')
            })
            .catch(() => {
              patch({
                stakeholdersConfirmed: false,
                stakeholdersConfirmationDigest: null,
                governanceStatus: 'failed',
              })
              setGovernancePrep('failed')
            })
        } else {
          scheduleStakeholderGovernance(projectId, { draft })
        }
      }

      // Existing projects: never block Continue on Neon save (was leaving the UI on "Saving…").
      if (state.projectId) {
        const existingId = state.projectId
        void persistProject({ draft })
          .then((saved) => {
            if (!draft && saved.id) runStakeholderSideEffects(saved.id)
          })
          .catch(() => {
            // Neon can be slow; Continue already advanced. Keep a soft note, not a hard block.
            setStatus({
              type: 'info',
              message: 'Project save is still catching up in the background. You can keep going.',
            })
          })
        if (!draft) runStakeholderSideEffects(existingId)
      } else {
        setSaving(true)
        try {
          const saved = await persistProject({ draft })
          if (!draft && saved.id) runStakeholderSideEffects(saved.id)
        } catch (e) {
          setStatus({ type: 'error', message: e instanceof Error ? e.message : 'Could not save project.' })
          setSaving(false)
          return
        } finally {
          setSaving(false)
        }
      }
    } else if (step === 'repositories') {
      if (!skipStepValidation && !(state.repositories || []).some((repo) => repo.name.trim())) {
        setStatus({ type: 'error', message: 'Keep at least one repository, or add one.' })
        return
      }
      // Physical GitHub create is deferred until Ship after G-PLAN / G-BOOTSTRAP.
      setStatus(null)
    } else if (step === 'technology-per-repo') {
      patch(acknowledgeShapePatch(state))
      setStatus(null)
    } else {
      setStatus(null)
    }
    const idx = stepIndex(step)
    setCompletedThrough((prev) => Math.max(prev, idx))
    const nextStep = STEP_ORDER[idx + 1]
    if (nextStep) goToStep(nextStep)
  }, [
    step,
    validateCurrentStep,
    persistProject,
    scheduleStakeholderGovernance,
    state,
    patch,
    skipStepValidation,
    goToStep,
    projectPayload,
  ])

  const retryStakeholderGovernance = useCallback(() => {
    const id = stateRef.current.projectId
    if (!id) return
    scheduleStakeholderGovernance(id, { force: true })
  }, [scheduleStakeholderGovernance])

  const goBack = useCallback(() => {
    setStatus(null)
    if (kitResultOpen) {
      setKitResultOpen(false)
      return
    }
    if (isWizardHistoryState(window.history.state) && stepIndex(step) > 0) {
      window.history.back()
      return
    }
    const idx = stepIndex(step)
    if (idx > 0) goToStep(STEP_ORDER[idx - 1])
  }, [step, goToStep, kitResultOpen])

  const groomAbortRef = useRef<AbortController | null>(null)

  const handleGroomAsk = useCallback(async () => {
    if (groomAskInFlightRef.current) return
    const text = (stateRef.current.groomOriginal || stateRef.current.requirementsText).trim()
    if (!text) {
      setStatus({ type: 'error', message: 'Paste a short description first.' })
      return
    }
    if (stateRef.current.groomQuestions.length) return
    groomAskInFlightRef.current = true
    setGrooming(true)
    setStatus(null)
    const controller = new AbortController()
    groomAbortRef.current = controller
    const hangTimer = window.setTimeout(() => controller.abort(), 90_000)
    try {
      // Prefer JSON over SSE — Vite proxy + hung Neon auth was stalling /sdlc/stream.
      const result = await clarifyRequirement(
        {
          projectId: stateRef.current.projectId,
          projectName: stateRef.current.projectName,
          requirementText: text,
        },
        controller.signal,
      )
      if (result.status === 'error' || result.status === 'invalid_request') {
        patch({
          groomStatus: result.status,
          groomMessage: result.message,
          groomDraft: result.requirementDraft || text,
          groomOriginal: stateRef.current.groomOriginal || result.originalRequirement || text,
        })
        setStatus({ type: 'error', message: result.message })
        return
      }
      patch({
        groomStatus: result.status,
        groomMessage: result.message,
        groomQuestions: assignQuestionBands(result.questions ?? []),
        groomDraft: result.requirementDraft || '',
        groomOriginal: stateRef.current.groomOriginal || result.originalRequirement || text,
        groomAnswers: [],
        groomConfirmed: false,
      })
      setStatus({
        type: 'info',
        message:
          result.status === 'draft_ready'
            ? 'This is already clear enough. Continue to save the wording, or Start over to change the paste.'
            : 'Answer the required questions. Important and suggestions are optional.',
      })
    } catch (e) {
      const message =
        e instanceof DOMException && e.name === 'AbortError'
          ? 'Clarify timed out. Check the local agent on port 8787, then retry.'
          : e instanceof Error
            ? e.message
            : 'Could not reach the grooming helper.'
      patch({
        groomStatus: 'error',
        groomMessage: message,
      })
      setStatus({ type: 'error', message })
    } finally {
      window.clearTimeout(hangTimer)
      if (groomAbortRef.current === controller) groomAbortRef.current = null
      groomAskInFlightRef.current = false
      setGrooming(false)
    }
  }, [patch])

  const handleGroomPick = useCallback((questionId: string, optionId: string, optionLabel: string) => {
    setState((prev) => {
      const q = prev.groomQuestions.find((item) => item.id === questionId)
      const isMultiple = Boolean(q?.allowMultiple)
      const isSame = (item: GroomAnswer) => item.questionId === questionId && item.optionId === optionId
      const exists = prev.groomAnswers.some(isSame)

      let nextAnswers: GroomAnswer[]
      if (isMultiple) {
        if (exists) {
          nextAnswers = prev.groomAnswers.filter((item) => !isSame(item))
        } else {
          nextAnswers = [...prev.groomAnswers, { questionId, optionId, optionLabel }]
        }
      } else {
        const withoutQuestion = prev.groomAnswers.filter((item) => item.questionId !== questionId)
        nextAnswers = exists ? withoutQuestion : [...withoutQuestion, { questionId, optionId, optionLabel }]
      }
      return { ...prev, groomAnswers: nextAnswers, groomConfirmed: false }
    })
  }, [])

  const handleGroomToggleOther = useCallback((questionId: string, checked: boolean) => {
    setState((prev) => {
      const q = prev.groomQuestions.find((item) => item.id === questionId)
      const isMultiple = Boolean(q?.allowMultiple)

      if (!checked) {
        const kept = prev.groomAnswers.filter(
          (item) => !(item.questionId === questionId && item.optionId === 'other'),
        )
        return { ...prev, groomAnswers: kept, groomConfirmed: false }
      }

      const existingOther = prev.groomAnswers.find(
        (item) => item.questionId === questionId && item.optionId === 'other',
      )
      const otherItem: GroomAnswer = {
        questionId,
        optionId: 'other',
        optionLabel: 'Other',
        otherText: existingOther?.otherText ?? '',
      }

      if (isMultiple) {
        const kept = prev.groomAnswers.filter(
          (item) => !(item.questionId === questionId && item.optionId === 'other'),
        )
        return { ...prev, groomAnswers: [...kept, otherItem], groomConfirmed: false }
      } else {
        const kept = prev.groomAnswers.filter((item) => item.questionId !== questionId)
        return { ...prev, groomAnswers: [...kept, otherItem], groomConfirmed: false }
      }
    })
  }, [])

  const handleGroomOther = useCallback((questionId: string, text: string) => {
    setState((prev) => {
      const rest = prev.groomAnswers.filter((item) => !(item.questionId === questionId && item.optionId === 'other'))
      const next: GroomAnswer = { questionId, optionId: 'other', optionLabel: 'Other', otherText: text }
      return { ...prev, groomAnswers: [...rest, next], groomConfirmed: false }
    })
  }, [])

  const handleGroomLooksGood = useCallback(async (): Promise<boolean> => {
    const current = stateRef.current
    if (current.groomConfirmed) return true
    if (unansweredRequired(current).length && current.groomStatus !== 'error') {
      setStatus({
        type: 'error',
        message: 'Answer every required question under Need clarification, or mark Jira later to ask on a ticket.',
      })
      return false
    }
    const original = (current.groomOriginal || current.requirementsText).trim()
    const answers = current.groomAnswers.filter(
      (item) => item.optionId !== 'other' || Boolean(item.otherText?.trim()),
    )
    let draft = (current.groomDraft || current.requirementsText).trim()
    if (answers.length && current.groomStatus !== 'error') {
      // Prefer a fast JSON rewrite. If Neon/auth is busy, keep the current draft so Start over / Continue aren't blocked.
      groomAbortRef.current?.abort()
      const controller = new AbortController()
      groomAbortRef.current = controller
      const hangTimer = window.setTimeout(() => controller.abort(), 45_000)
      setGrooming(true)
      setStatus(null)
      try {
        const result = await clarifyRequirement(
          {
            projectId: current.projectId,
            projectName: current.projectName,
            requirementText: original || draft,
            answers,
          },
          controller.signal,
        )
        if (result.status === 'error' || result.status === 'invalid_request') {
          setStatus({ type: 'info', message: `${result.message} Using the current draft.` })
        } else {
          draft = (result.requirementDraft || draft).trim()
        }
      } catch {
        setStatus({
          type: 'info',
          message: 'Rewrite is slow right now — saved your answers with the current draft.',
        })
      } finally {
        window.clearTimeout(hangTimer)
        if (groomAbortRef.current === controller) groomAbortRef.current = null
        setGrooming(false)
      }
    }
    if (!draft) return false
    const nextState = { ...current, requirementsText: draft, groomConfirmed: true, groomDraft: draft }
    const questions = carryClarifyQuestionsForward(nextState)
    const basePatch: Partial<WizardState> = {
      requirementsText: draft,
      groomDraft: draft,
      groomConfirmed: true,
      groomStatus: 'draft_ready',
      questions,
      requirementsAnalyzed: true,
      responses: responsesForStakeholderQuestions(questions, current.responses),
      questionsSent: false,
    }
    patch(basePatch)
    const mergedState: WizardState = { ...current, ...basePatch }
    stateRef.current = mergedState
    if (
      mergedState.projectId &&
      shouldRunGroomingRevisionAfterAnswers(mergedState) &&
      stakeholderFeedbackFromState(mergedState) !== lastRevisionFeedbackRef.current
    ) {
      const feedback = stakeholderFeedbackFromState(mergedState)
      lastRevisionFeedbackRef.current = feedback
      void applyGroomingRevisionToState(mergedState)
        .then((revisionPatch) => patch(revisionPatch))
        .catch(() => {
          lastRevisionFeedbackRef.current = ''
        })
    }
    setStatus({ type: 'success', message: 'Requirement wording saved.' })
    return true
  }, [patch])
  handleGroomLooksGoodRef.current = handleGroomLooksGood

  const handleGroomStartOver = useCallback(() => {
    groomAbortRef.current?.abort()
    groomAbortRef.current = null
    groomAskInFlightRef.current = false
    setGrooming(false)
    patch(clearGroomingPatch())
    setStatus(null)
  }, [patch])

  const applySendResults = useCallback(
    (results: { question_id: string; status: string; message: string }[], deliveryMode: string, _outboxDir: string | null) => {
      const now = new Date().toISOString()
      setState((prev) => {
        const questions = prev.questions.map((q) => {
          const result = results.find((r) => r.question_id === q.id)
          if (!result) return q
          return {
            ...q,
            sent: result.status === 'sent',
            deliveryStatus: result.status === 'sent' ? ('sent' as const) : ('failed' as const),
            sentAt: result.status === 'sent' ? now : q.sentAt,
            deliveryMessage: result.message,
          }
        })
        const responses = questions.map((q) => {
          const existing = prev.responses.find((r) => r.questionId === q.id)
          return existing ?? { questionId: q.id, status: 'pending' as const, response: '', receivedAt: null }
        })
        const allSent = questions.every((q) => q.sent)
        return { ...prev, questions, responses, questionsSent: allSent }
      })

      const failed = results.filter((r) => r.status === 'failed')
      if (failed.length) {
        setStatus({ type: 'error', message: failed.map((f) => f.message).join(' ') })
      } else if (deliveryMode === 'outbox') {
        setStatus({
          type: 'success',
          message: 'Demo mode: marked sent without SMTP. Live email comes later.',
        })
      } else {
        setStatus({ type: 'success', message: 'Emails sent successfully via SMTP.' })
      }
    },
    [],
  )

  const handleSendOne = useCallback(
    async (questionId: string) => {
      setSending(true)
      setStatus(null)
      try {
        const payload = buildEmailPayload(state, [questionId])
        if (!payload.length) {
          setStatus({ type: 'error', message: 'Assign name and email on Project & Stakeholders before emailing.' })
          return
        }
        const res = await sendStakeholderQuestions(payload)
        applySendResults(res.results, res.delivery_mode, res.outbox_dir)
      } catch (e) {
        setStatus({ type: 'error', message: e instanceof Error ? e.message : 'Failed to send email.' })
      } finally {
        setSending(false)
      }
    },
    [state, applySendResults],
  )

  const handleSendAll = useCallback(async () => {
    const unsent = state.questions
      .filter((q) => !q.sent && assigneeForQuestion(state, q.assignedRoleId).assigned)
      .map((q) => q.id)
    if (!unsent.length) {
      setStatus({ type: 'error', message: 'No questions with assigned recipients to email.' })
      return
    }
    setSending(true)
    setStatus(null)
    try {
      const payload = buildEmailPayload(state, unsent)
      if (!payload.length) {
        setStatus({ type: 'error', message: 'Assign name and email on Project & Stakeholders before emailing.' })
        return
      }
      const res = await sendStakeholderQuestions(payload)
      applySendResults(res.results, res.delivery_mode, res.outbox_dir)
    } catch (e) {
      setStatus({ type: 'error', message: e instanceof Error ? e.message : 'Failed to send emails.' })
    } finally {
      setSending(false)
    }
  }, [state, applySendResults])

  const applyJiraPollThreads = useCallback(
    (
      threads: {
        blinkQuestionId: string
        issueKey: string
        parentCommentId?: string | null
        parentBody?: string | null
        replies: {
          commentId: string
          body: string
          author?: string | null
          created?: string | null
          parentId?: string | null
        }[]
      }[],
    ) => {
      if (!threads.length) return
      const now = new Date().toISOString()
      const cleanBody = (raw: string) =>
        raw
          .replace(/\[blink-sim-reply\]/gi, '')
          .replace(/\n{3,}/g, '\n\n')
          .trim()

      setState((prev) => {
        const byId = new Map(threads.map((t) => [t.blinkQuestionId, t]))
        const questions = prev.questions.map((q) => {
          const thread = byId.get(q.id)
          if (!thread?.replies?.length) return q
          const cleaned = thread.replies
            .map((r) => ({
              commentId: r.commentId,
              body: cleanBody(r.body || ''),
              author: r.author || null,
              created: r.created || null,
              parentId: r.parentId || thread.parentCommentId || null,
            }))
            .filter((r) => r.body && r.commentId)
          if (!cleaned.length) return q
          const last = cleaned[cleaned.length - 1]
          const existing = prev.responses.find((r) => r.questionId === q.id)
          const alreadyResolved = existing?.status === 'answered' && Boolean(existing.response?.trim())
          const priorIds = new Set((q.jiraThread || []).map((r) => r.commentId))
          const hasNew = cleaned.some((r) => !priorIds.has(r.commentId))
          return {
            ...q,
            jiraCommentStatus: alreadyResolved ? ('resolved' as const) : ('discussion' as const),
            jiraCommentMessage: alreadyResolved
              ? hasNew
                ? 'New discussion activity since resolve'
                : 'Resolved from Jira thread'
              : `${cleaned.length} reply(ies) in discussion`,
            jiraThread: cleaned,
            jiraParentBody: cleanBody(thread.parentBody || '') || q.jiraParentBody || null,
            jiraParentCommentId: thread.parentCommentId || q.jiraParentCommentId || q.jiraCommentId || null,
            jiraThreadStale: alreadyResolved && hasNew,
            jiraReplyBody: last.body,
            jiraReplyAuthor: last.author,
            jiraReplyAt: last.created || now,
            jiraReplyCommentId: last.commentId,
            jiraIssueKey: thread.issueKey || q.jiraIssueKey,
          }
        })
        const responses = prev.questions.map((q) => {
          const thread = byId.get(q.id)
          const existing = prev.responses.find((r) => r.questionId === q.id)
          if (!thread?.replies?.length) {
            return (
              existing ?? {
                questionId: q.id,
                status: 'pending' as const,
                response: q.proposedAnswer || '',
                receivedAt: null,
              }
            )
          }
          // Keep an existing resolved answer; otherwise mark as open discussion.
          if (existing?.status === 'answered' && existing.response?.trim()) {
            return {
              ...existing,
              jiraIssueKey: thread.issueKey || existing.jiraIssueKey || q.jiraIssueKey || null,
            }
          }
          const last = thread.replies[thread.replies.length - 1]
          return {
            questionId: q.id,
            status: 'discussion' as const,
            response: '',
            receivedAt: last.created || now,
            source: 'thread' as const,
            author: last.author || null,
            jiraIssueKey: thread.issueKey || q.jiraIssueKey || null,
            jiraCommentId: last.commentId || null,
          }
        })
        return { ...prev, questions, responses }
      })
    },
    [],
  )

  const handleRefreshJira = useCallback(async () => {
    const items = state.questions
      .filter(
        (q) =>
          q.jiraIssueKey &&
          (q.jiraCommentStatus === 'posted' ||
            q.jiraCommentStatus === 'replied' ||
            q.jiraCommentStatus === 'discussion' ||
            q.jiraCommentStatus === 'resolved'),
      )
      .map((q) => ({ issueKey: q.jiraIssueKey!, blinkQuestionId: q.id }))
    if (!items.length || !state.projectId) {
      setStatus({ type: 'info', message: 'No posted Jira comments to refresh yet.' })
      return
    }
    setRefreshingJira(true)
    setStatus(null)
    try {
      const res = await pollJiraComments({ projectId: state.projectId, items })
      const threads = res.threads?.length
        ? res.threads
        : (res.replies || []).map((r) => ({
            blinkQuestionId: r.blinkQuestionId,
            issueKey: r.issueKey,
            parentCommentId: null,
            replies: [
              {
                commentId: r.commentId || `legacy-${r.blinkQuestionId}`,
                body: r.body,
                author: r.author,
                created: r.created,
                parentId: null,
              },
            ],
          }))
      applyJiraPollThreads(threads)
      const replyCount = threads.reduce((n, t) => n + (t.replies?.length || 0), 0)
      setStatus({
        type: 'success',
        message: replyCount
          ? `Loaded ${replyCount} reply(ies) across ${threads.length} discussion thread(s). Resolve each to continue.`
          : res.message || 'No new Jira replies.',
      })
    } catch (e) {
      setStatus({ type: 'error', message: e instanceof Error ? e.message : 'Failed to poll Jira comments.' })
    } finally {
      setRefreshingJira(false)
    }
  }, [state.questions, state.projectId, applyJiraPollThreads])

  const handlePostJiraOne = useCallback(
    async (questionId: string): Promise<boolean> => {
      const mapped = autoMapQuestionsToJira(state.questions, state)
      const question = mapped.find((q) => q.id === questionId)
      if (!question?.jiraIssueKey || !state.projectId) {
        setStatus({ type: 'error', message: 'Create Jira tickets first, or pick a ticket for this question.' })
        return false
      }
      if (!assigneeForQuestion(state, question.assignedRoleId).assigned) {
        setStatus({ type: 'error', message: 'Assign a person with email before posting to Jira.' })
        return false
      }
      if (mapped.some((q, i) => q.jiraIssueKey !== state.questions[i]?.jiraIssueKey)) {
        patch({ questions: mapped })
      }
      setPostingJira(true)
      setStatus(null)
      try {
        const body = jiraCommentForQuestion({ ...state, questions: mapped }, question)
        const res = await createJiraComment({
          projectId: state.projectId,
          issueKey: question.jiraIssueKey,
          body,
          blinkQuestionId: question.id,
        })
        if (!res.commentId) {
          throw new Error(`Jira did not return a comment id for ${question.jiraIssueKey}.`)
        }
        setState((prev) => ({
          ...prev,
          questions: prev.questions.map((q) =>
            q.id === questionId
              ? {
                  ...q,
                  jiraIssueKey: question.jiraIssueKey,
                  jiraIssueUrl: question.jiraIssueUrl || q.jiraIssueUrl || null,
                  jiraCommentId: res.commentId || null,
                  jiraCommentStatus: 'posted' as const,
                  jiraCommentMessage: res.message,
                  jiraParentCommentId: res.commentId || null,
                  jiraParentBody: body,
                }
              : q,
          ),
        }))
        setStatus({
          type: 'success',
          message: res.message || `Posted to ${question.jiraIssueKey}.`,
        })
        return true
      } catch (e) {
        setState((prev) => ({
          ...prev,
          questions: prev.questions.map((q) =>
            q.id === questionId
              ? {
                  ...q,
                  jiraCommentStatus: 'failed' as const,
                  jiraCommentMessage: e instanceof Error ? e.message : 'Post failed',
                }
              : q,
          ),
        }))
        setStatus({ type: 'error', message: e instanceof Error ? e.message : 'Failed to post Jira comment.' })
        return false
      } finally {
        setPostingJira(false)
      }
    },
    [state, patch],
  )

  const handlePostJiraAll = useCallback(async () => {
    const mapped = autoMapQuestionsToJira(state.questions, state)
    if (mapped.some((q, i) => q.jiraIssueKey !== state.questions[i]?.jiraIssueKey)) {
      patch({ questions: mapped })
    }
    const ids = mapped
      .filter(
        (q) =>
          q.jiraIssueKey &&
          assigneeForQuestion(state, q.assignedRoleId).assigned &&
          !(
            (q.jiraCommentStatus === 'posted' || q.jiraCommentStatus === 'replied') &&
            Boolean(q.jiraCommentId)
          ),
      )
      .map((q) => q.id)
    if (!ids.length) {
      setStatus({
        type: 'error',
        message: 'Nothing to post. Create Jira tickets and ensure each question is mapped to a ticket.',
      })
      return
    }
    let ok = 0
    let failed = 0
    for (const id of ids) {
      const success = await handlePostJiraOne(id)
      if (success) ok += 1
      else failed += 1
    }
    setStatus({
      type: failed ? 'error' : 'success',
      message: failed
        ? `Posted ${ok} clarification(s); ${failed} failed. Open the ticket link after a successful post, or reconnect Jira.`
        : `Posted ${ok} clarification comment(s) to Jira. Use Open ticket to verify, then Refresh for replies.`,
    })
  }, [state, handlePostJiraOne, patch])

  const handleSimulateResponses = useCallback(async () => {
    if (!state.projectId) {
      setStatus({ type: 'error', message: 'Save the project first so Blink can write to Jira.' })
      return
    }

    const targets = state.questions.filter(
      (q) =>
        q.jiraIssueKey &&
        q.jiraCommentId &&
        (q.jiraCommentStatus === 'posted' ||
          q.jiraCommentStatus === 'replied' ||
          q.jiraCommentStatus === 'discussion' ||
          q.jiraCommentStatus === 'resolved'),
    )

    if (!targets.length) {
      setStatus({
        type: 'error',
        message:
          'Proper simulation posts a real reply on each Jira ticket. Post clarifications to Jira first, then simulate.',
      })
      return
    }

    setSimulatingJira(true)
    setStatus({
      type: 'info',
      message: `Posting ${targets.length} simulated stakeholder reply(ies) to Jira…`,
    })

    let posted = 0
    let failed = 0
    const failures: string[] = []

    try {
      for (const q of targets) {
        const person = assigneeForQuestion(state, q.assignedRoleId).name
        const body = simulatedStakeholderReply(q, person)
        try {
          if (!q.jiraCommentId) {
            throw new Error('Missing parent clarification comment id — re-post to Jira first.')
          }
          // Reply as a threaded child under the clarification comment (not a sibling).
          await createJiraComment({
            projectId: state.projectId,
            issueKey: q.jiraIssueKey!,
            body,
            parentCommentId: q.jiraCommentId,
          })
          posted += 1
        } catch (e) {
          failed += 1
          failures.push(
            `${q.jiraIssueKey}: ${e instanceof Error ? e.message : 'failed to post reply'}`,
          )
        }
      }

      if (posted === 0) {
        setStatus({
          type: 'error',
          message: failures[0] || 'Could not post any simulated replies to Jira.',
        })
        return
      }

      setStatus({
        type: 'info',
        message: `Posted ${posted} reply(ies) on Jira. Pulling them back…`,
      })

      const items = targets.map((q) => ({
        issueKey: q.jiraIssueKey!,
        blinkQuestionId: q.id,
      }))
      const res = await pollJiraComments({ projectId: state.projectId, items })
      const threads = res.threads?.length
        ? res.threads
        : (res.replies || []).map((r) => ({
            blinkQuestionId: r.blinkQuestionId,
            issueKey: r.issueKey,
            parentCommentId: null as string | null,
            replies: [
              {
                commentId: r.commentId || `legacy-${r.blinkQuestionId}`,
                body: r.body,
                author: r.author,
                created: r.created,
                parentId: null as string | null,
              },
            ],
          }))
      applyJiraPollThreads(threads)

      const pulled = threads.reduce((n, t) => n + (t.replies?.length || 0), 0)
      setStatus({
        type: failed || pulled === 0 ? 'error' : 'success',
        message:
          pulled > 0
            ? `Simulation complete: posted ${posted} Jira reply(ies). Review the discussion and resolve each answer.`
            : `Posted ${posted} reply(ies), but poll did not find them yet. Open the ticket to verify, then Refresh Jira replies.${
                failures.length ? ` Issues: ${failures.join('; ')}` : ''
              }`,
      })
    } catch (e) {
      setStatus({
        type: 'error',
        message: e instanceof Error ? e.message : 'Jira simulation failed.',
      })
    } finally {
      setSimulatingJira(false)
    }
  }, [state, applyJiraPollThreads])

  const handleResetSimulatedReplies = useCallback(async () => {
    const targets = state.questions.filter((q) => {
      const response = state.responses.find((r) => r.questionId === q.id)
      const text = (response?.response || q.jiraReplyBody || '').trim()
      return Boolean(
        (response?.status === 'answered' && text) ||
          q.jiraReplyBody?.trim() ||
          q.jiraReplyCommentId ||
          q.jiraCommentStatus === 'replied',
      )
    })

    if (!targets.length) {
      setStatus({ type: 'info', message: 'No loaded replies to reset.' })
      return
    }

    setResettingSimJira(true)
    setStatus({ type: 'info', message: `Resetting ${targets.length} reply(ies)…` })

    const jiraTargets = targets.filter((q) => q.jiraIssueKey)
    let deleted = 0
    let jiraMessage = ''
    try {
      if (state.projectId && jiraTargets.length) {
        const res = await resetSimulatedJiraReplies({
          projectId: state.projectId,
          items: jiraTargets.map((q) => ({
            issueKey: q.jiraIssueKey!,
            blinkQuestionId: q.id,
            replyCommentId:
              q.jiraReplyCommentId ||
              state.responses.find((r) => r.questionId === q.id)?.jiraCommentId ||
              null,
          })),
        })
        deleted = res.deleted || 0
        jiraMessage = res.message || ''
      }

      setState((prev) => {
        const targetIds = new Set(targets.map((q) => q.id))
        const questions = prev.questions.map((q) => {
          if (!targetIds.has(q.id)) return q
          const keepPosted =
            Boolean(q.jiraCommentId) &&
            (q.jiraCommentStatus === 'posted' ||
              q.jiraCommentStatus === 'replied' ||
              q.jiraCommentStatus === 'discussion' ||
              q.jiraCommentStatus === 'resolved')
          return {
            ...q,
            jiraCommentStatus: keepPosted ? ('posted' as const) : q.jiraCommentStatus,
            jiraCommentMessage: keepPosted
              ? `Awaiting reply on ${q.jiraIssueKey}`
              : q.jiraCommentMessage,
            jiraThread: [],
            jiraThreadStale: false,
            jiraThreadSummary: null,
            jiraParentBody: keepPosted ? q.jiraParentBody : null,
            jiraParentCommentId: keepPosted ? q.jiraParentCommentId || q.jiraCommentId : null,
            jiraReplyBody: null,
            jiraReplyAuthor: null,
            jiraReplyAt: null,
            jiraReplyCommentId: null,
          }
        })
        const responses = prev.questions.map((q) => {
          const existing = prev.responses.find((r) => r.questionId === q.id)
          if (!targetIds.has(q.id)) {
            return (
              existing ?? {
                questionId: q.id,
                status: 'pending' as const,
                response: q.proposedAnswer || '',
                receivedAt: null,
              }
            )
          }
          return {
            questionId: q.id,
            status: 'pending' as const,
            response: '',
            receivedAt: null,
            jiraIssueKey: q.jiraIssueKey || null,
          }
        })
        return { ...prev, questions, responses }
      })

      setStatus({
        type: 'success',
        message:
          deleted > 0
            ? `Reset complete: cleared ${targets.length} answer(s) and deleted ${deleted} simulated Jira comment(s).`
            : `Cleared ${targets.length} loaded answer(s).${
                jiraTargets.length
                  ? ' No matching simulated comments were found on Jira (they may have been local-only).'
                  : ''
              }${jiraMessage ? ` ${jiraMessage}` : ''} You can simulate again.`,
      })
    } catch (e) {
      // Still clear local demo answers even if Jira delete fails.
      setState((prev) => {
        const targetIds = new Set(targets.map((q) => q.id))
        return {
          ...prev,
          questions: prev.questions.map((q) =>
            targetIds.has(q.id)
              ? {
                  ...q,
                  jiraCommentStatus:
                    q.jiraCommentId &&
                    (q.jiraCommentStatus === 'posted' ||
                      q.jiraCommentStatus === 'replied' ||
                      q.jiraCommentStatus === 'discussion' ||
                      q.jiraCommentStatus === 'resolved')
                      ? ('posted' as const)
                      : q.jiraCommentStatus,
                  jiraThread: [],
                  jiraThreadStale: false,
                  jiraThreadSummary: null,
                  jiraReplyBody: null,
                  jiraReplyAuthor: null,
                  jiraReplyAt: null,
                  jiraReplyCommentId: null,
                }
              : q,
          ),
          responses: prev.questions.map((q) =>
            targetIds.has(q.id)
              ? {
                  questionId: q.id,
                  status: 'pending' as const,
                  response: '',
                  receivedAt: null,
                  jiraIssueKey: q.jiraIssueKey || null,
                }
              : prev.responses.find((r) => r.questionId === q.id) ?? {
                  questionId: q.id,
                  status: 'pending' as const,
                  response: q.proposedAnswer || '',
                  receivedAt: null,
                },
          ),
        }
      })
      setStatus({
        type: 'error',
        message: `${e instanceof Error ? e.message : 'Jira reset failed.'} Local answers were still cleared.`,
      })
    } finally {
      setResettingSimJira(false)
    }
  }, [state])

  const handleUpdateResponse = useCallback(
    async (questionId: string, patchResponse: Partial<import('./wizard/types').QuestionResponse>) => {
      const nextState = applyQuestionResponsePatch(stateRef.current, questionId, patchResponse)
      setState(nextState)

      const body = (patchResponse.response || '').trim()
      const answered = (patchResponse.status || 'answered') === 'answered' && Boolean(body)
      if (!answered) {
        setStatus({ type: 'success', message: 'Answer updated.' })
        return
      }

      let working = nextState
      if (working.projectId) {
        const canonicalQuestion = working.questions.find((question) => question.id === questionId)
        if (canonicalQuestion) {
          try {
            await upsertCanonicalGroomingQuestion(working.projectId, {
              key: canonicalQuestion.id,
              prompt: canonicalQuestion.question,
              mandatory: Boolean(canonicalQuestion.mandatory),
              assignedRoleId: canonicalQuestion.assignedRoleId,
            })
            await recordCanonicalGroomingAnswer(working.projectId, {
              questionKey: canonicalQuestion.id,
              answer: body,
              status: 'answered',
              evidence: {
                source: patchResponse.source || 'manual',
                receivedAt: patchResponse.receivedAt || new Date().toISOString(),
                jiraCommentId: patchResponse.jiraCommentId || null,
              },
            })
          } catch (e) {
            // Legacy projects may predate project-grooming tables. Preserve the existing story workflow.
            setStatus({
              type: 'info',
              message: `Answer saved locally; canonical project grooming sync is unavailable: ${
                e instanceof Error ? e.message : 'unknown error'
              }`,
            })
          }
        }
        const mapped = autoMapQuestionsToJira(working.questions, working)
        const question = mapped.find((q) => q.id === questionId)
        if (question?.jiraIssueKey) {
          try {
            const sync = await syncStakeholderAnswerToJira(working.projectId, question, body)
            if (sync.posted) {
              setState((prev) => patchAfterJiraAnswerSync(prev, questionId, sync))
              working = patchAfterJiraAnswerSync(working, questionId, sync)
            }
          } catch (e) {
            setStatus({
              type: 'error',
              message: `Answer saved locally. Jira sync failed: ${
                e instanceof Error ? e.message : 'unknown error'
              }`,
            })
          }
        }
      }

      const feedback = stakeholderFeedbackFromState(working)
      if (
        shouldRunGroomingRevisionAfterAnswers(working) &&
        feedback !== lastRevisionFeedbackRef.current
      ) {
        lastRevisionFeedbackRef.current = feedback
        try {
          const revisionPatch = await applyGroomingRevisionToState(working)
          patch(revisionPatch)
          setStatus({
            type: 'success',
            message: 'Answer saved; Jira updated when linked; requirement revised.',
          })
          return
        } catch (e) {
          lastRevisionFeedbackRef.current = ''
          setStatus({
            type: 'error',
            message: `Answer saved. Grooming revision failed: ${
              e instanceof Error ? e.message : 'unknown error'
            }`,
          })
          return
        }
      }

      if (!working.projectId || !working.questions.find((q) => q.id === questionId)?.jiraIssueKey) {
        setStatus({ type: 'success', message: 'Answer resolved.' })
        return
      }
      setStatus({ type: 'success', message: 'Answer resolved and synced to Jira when a ticket was linked.' })
    },
    [patch, setState],
  )

  const handleResolveAllLatest = useCallback(() => {
    setState((prev) => {
      const now = new Date().toISOString()
      const questions = prev.questions.map((q) => {
        const thread = q.jiraThread || []
        if (!thread.length) return q
        const existing = prev.responses.find((r) => r.questionId === q.id)
        if (existing?.status === 'answered' && existing.response?.trim()) return q
        const last = thread[thread.length - 1]
        return {
          ...q,
          jiraCommentStatus: 'resolved' as const,
          jiraCommentMessage: last.body.length > 140 ? `${last.body.slice(0, 140)}…` : last.body,
          jiraReplyBody: last.body,
          jiraReplyAuthor: last.author || null,
          jiraReplyAt: last.created || now,
          jiraReplyCommentId: last.commentId,
          jiraThreadStale: false,
        }
      })
      const responses = prev.questions.map((q) => {
        const existing = prev.responses.find((r) => r.questionId === q.id)
        const thread = q.jiraThread || []
        if (existing?.status === 'answered' && existing.response?.trim()) {
          return existing
        }
        if (!thread.length) {
          return (
            existing ?? {
              questionId: q.id,
              status: 'pending' as const,
              response: q.proposedAnswer || '',
              receivedAt: null,
            }
          )
        }
        const last = thread[thread.length - 1]
        return {
          questionId: q.id,
          status: 'answered' as const,
          response: last.body,
          receivedAt: last.created || now,
          source: 'thread' as const,
          author: last.author || null,
          jiraIssueKey: q.jiraIssueKey || null,
          jiraCommentId: last.commentId,
          resolvedFromCommentId: last.commentId,
        }
      })
      return { ...prev, questions, responses }
    })
    setStatus({ type: 'success', message: 'Resolved open discussions using the latest reply in each thread.' })
  }, [])

  const runGeneration = useCallback(async () => {
    setLoading(true)
    setStatus(null)
    const start = Date.now()
    const steps = generationStepDefs(state.ideTool).map((s) => ({ ...s, status: 'pending' as const }))
    const fromIdx = stepIndex(step)
    setCompletedThrough((prev) => Math.max(prev, fromIdx))
    patch({ generationSteps: steps, generationComplete: false })
    // Header Download always stays on the classic kit/download panel and never
    // jumps to Ship (Ship is only via wizard Continue / sidebar).
    setKitResultOpen(true)

    const advanceStep = (id: string, st: 'running' | 'done' | 'error') => {
      setState((prev) => ({
        ...prev,
        generationSteps: prev.generationSteps.map((s) => (s.id === id ? { ...s, status: st } : s)),
      }))
    }

    try {
      for (const def of generationStepDefs(state.ideTool).slice(0, -1)) {
        advanceStep(def.id, 'running')
        await new Promise((r) => setTimeout(r, 350))
        advanceStep(def.id, 'done')
      }

      advanceStep('package', 'running')
      let projectId = state.projectId
      if (!projectId) {
        const saved = await persistProject()
        projectId = saved.id
        scheduleStakeholderGovernance(saved.id)
      }
      const repositories = (
        state.repositoriesTouched
          ? state.repositories
          : defaultRepositories(state.projectName, {
              topology: state.topology,
              repositoryModel: state.repositoryModel,
              architectureStyle: state.architectureStyle,
            })
      ).map((repo) => ({
        name: repo.name,
        purpose: repo.purpose,
        description: repo.description,
      }))
      const setupRequirement =
        state.groomConfirmed && state.groomDraft.trim() ? state.groomDraft.trim() : state.requirementsText
      const connected = state.integrations.filter((item) => item.connected)
      const jira = connected.find((item) => item.id === 'jira')
      const confluence = connected.find((item) => item.id === 'confluence')
      const {
        blob,
        filename,
        structure,
        fileCount,
        nextCommand,
        setupStatus,
        setupValidated,
        identitySource,
        overlayCount,
        contextReady,
        deliveryReady,
        folderStatus,
      } =
        await downloadWorkspace({
        projectId,
        file: state.requirementFile,
        requirementsText: setupRequirement,
        repositories,
        setupContext: {
          projectId,
          projectName: state.projectName,
          projectType: state.projectType,
          requirementConfirmed: state.groomConfirmed,
          stakeholderAssignments: state.stakeholderAssignments.map(({ roleId, personName, personEmail }) => ({
            roleId,
            personName,
            personEmail,
          })),
          topology: state.topology,
          repositoryModel: state.repositoryModel,
          architectureStyle: state.architectureStyle,
          topologyConfirmation: state.topologyConfirmation
            ? {
                ...state.topologyConfirmation,
                structure: state.repositoryModel,
                roster: repositories.map((repo) => ({
                  repo_id: repo.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || repo.name,
                  name: repo.name,
                  role: repo.purpose,
                })),
                technologyStack: (state.repoTechnologies || [])
                  .filter((row) => row.status === 'confirmed')
                  .map((row) => `${row.repoId}: ${[row.language, row.framework].filter(Boolean).join(' / ')}`)
                  .join('; '),
                repoTechnologies: state.repoTechnologies,
              }
            : undefined,
          repositories,
          integrations: state.integrations
            .filter((integration) => integration.connected)
            .map(({ id, account, baseUrl, organization, workspace, projectKey, projectName, cloudId, authType, spaceKey }) => ({
              provider: id,
              account,
              baseUrl,
              organization,
              workspace,
              projectKey,
              projectName,
              cloudId,
              authType,
              spaceKey,
            })),
        },
        mcpProviders: connected.map((item) => item.id),
        mcpSiteHints: {
          jiraUrl: jira?.baseUrl,
          jiraEmail: jira?.email,
          confluenceUrl: confluence?.baseUrl,
          confluenceEmail: confluence?.email,
          jiraCloudId: jira?.cloudId,
        },
      })
      if (!setupValidated) {
        advanceStep('package', 'error')
        patch({
          setupStatus: setupStatus || null,
          setupValidated: false,
          setupIdentitySource: identitySource || null,
          setupOverlayCount: overlayCount,
          setupContextReady: contextReady,
          setupDeliveryReady: deliveryReady,
        })
        setStatus({ type: 'error', message: 'Canonical workspace setup was not validated. Try again after updating the backend.' })
        return
      }

      advanceStep('package', 'done')
      downloadBlob(blob, filename)
      const fallbackStructure = buildDownloadStructure(repositories)
      patch({
        downloadFilename: filename,
        downloadStructure: structure.length ? structure : fallbackStructure,
        nextSdlcCommand: nextCommand || NEXT_SDLC_COMMAND,
        generationComplete: true,
        filesGenerated: fileCount || structure.length,
        generationTimeSec: Math.round((Date.now() - start) / 1000),
        setupStatus: setupStatus || null,
        setupValidated: true,
        setupIdentitySource: identitySource || null,
        setupOverlayCount: overlayCount,
        setupContextReady: contextReady,
        setupDeliveryReady: deliveryReady,
      })
      setStatus({
        type: folderStatus === 'preparing' ? 'info' : 'success',
        message:
          folderStatus === 'preparing'
            ? 'Your zip downloaded. The cloud project folder is still copying in the background.'
            : 'Project generated and downloaded.',
      })
      if (folderStatus === 'preparing') {
        setFolderQuery({ name: state.projectName, id: projectId })
        setFolderPrep('preparing')
      } else if (folderStatus === 'ready') {
        setFolderPrep('ready')
      }
    } catch (e) {
      advanceStep('package', 'error')
      setKitResultOpen(false)
      setStatus({ type: 'error', message: e instanceof Error ? e.message : 'Generation failed.' })
    } finally {
      setLoading(false)
    }
  }, [state, patch, persistProject, scheduleStakeholderGovernance])

  const handleQuickDownload = useCallback(() => {
    if (loading) return
    if (!state.requirementsText.trim() && !state.groomDraft.trim() && !state.requirementFileName) {
      setStatus({ type: 'error', message: 'Upload a document or paste requirements first.' })
      return
    }
    void runGeneration()
  }, [loading, state.requirementsText, state.groomDraft, state.requirementFileName, runGeneration])

  const renderScreen = () => {
    if (kitResultOpen) {
      return (
        <GenerationDownloadScreen
          state={state}
          loading={loading}
          exporting={creatingRepos}
          onExportGithub={() => void handleCreateGithubRepos()}
          onBack={() => setKitResultOpen(false)}
        />
      )
    }
    switch (step) {
      case 'welcome':
        return (
          <WelcomeScreen
            state={state}
            resume={
              canOfferResume({ step, completedThrough, state, freshStart: freshStartRef.current })
                ? {
                    projectName: state.projectName.trim() || 'your project',
                    stepLabel: stepLabel(resumeTarget({ step: lastWorkingRef.current, completedThrough, state })),
                  }
                : null
            }
            onContinue={(type) => startFresh(type)}
            onResume={() => {
              setStatus(null)
              goToStep(resumeTarget({ step: lastWorkingRef.current, completedThrough, state }))
            }}
            onStartNew={() => startFresh('new')}
          />
        )
      case 'project-stakeholders':
        return <ProjectStakeholdersScreen state={state} onUpdate={patch} />
      case 'integrations':
        return (
          <IntegrationsScreen
            state={state}
            onUpdate={patch}
            onEnsureProject={autoEnsureProject ? ensureDraftProject : undefined}
            jiraPublish={jiraPublish}
            stakeholderGovernanceBusy={governancePrep === 'preparing'}
            onRetryStakeholderGovernance={retryStakeholderGovernance}
          />
        )
      case 'repositories':
        return (
          <RepositoriesScreen
            state={state}
            onUpdate={patch}
            creating={creatingRepos}
          />
        )
      case 'sdlc-scope':
      case 'requirements':
        return (
          <RequirementsScreen
            state={state}
            onUpdate={(updates) => {
              const resetGroom =
                'requirementsText' in updates || 'requirementFileName' in updates || 'requirementFile' in updates
              patch(resetGroom ? { ...clearGroomingPatch(), ...updates } : updates)
            }}
          />
        )
      case 'stakeholder-qa':
        return (
          <StakeholderQaScreen
            state={state}
            onUpdate={patch}
            grooming={grooming}
            jiraPublish={jiraPublish}
            onAsk={() => void handleGroomAsk()}
            onPick={handleGroomPick}
            onOther={handleGroomOther}
            onToggleOther={handleGroomToggleOther}
            onUseWording={() => void handleGroomLooksGood()}
            onStartOver={handleGroomStartOver}
            onSendOne={handleSendOne}
            onSendAll={handleSendAll}
            onPostJira={handlePostJiraOne}
            onPostAllJira={handlePostJiraAll}
            onRefreshJira={handleRefreshJira}
            onSimulateResponses={handleSimulateResponses}
            onResetSimulatedReplies={handleResetSimulatedReplies}
            onUpdateResponse={handleUpdateResponse}
            onResolveAllLatest={handleResolveAllLatest}
            onPatchQuestion={(questionId, questionPatch) => {
              setState((prev) => ({
                ...prev,
                questions: prev.questions.map((q) => (q.id === questionId ? { ...q, ...questionPatch } : q)),
              }))
            }}
            onNavigate={(s) => {
              setStatus(null)
              goToStep(s)
            }}
            sending={sending}
            posting={postingJira}
            refreshing={refreshingJira}
            simulating={simulatingJira}
            resetting={resettingSimJira}
          />
        )
      case 'sdlc-plan':
        return <SdlcPlanningScreen state={state} onUpdate={patch} />
      case 'project-shape':
        return <ProjectShapeScreen state={state} onUpdate={patch} onShapeConfirm={onShapeConfirm} />
      case 'technology-per-repo':
        return <TechnologyPerRepoScreen state={state} onUpdate={patch} />
      case 'ship':
        return (
          <ShipScreen
            state={state}
            substage={state.shipSubstage || state.canonicalShipSubstage || 'workspace'}
            onSubstage={(substage) => goToShipSubstage(substage)}
            workspace={
              <WorkspaceScreen
                state={state}
                onUpdate={patch}
                loading={loading}
                exporting={creatingRepos}
                onExportGithub={() => void handleCreateGithubRepos()}
                onGenerateKit={() => void runGeneration()}
                onBack={() => goToStep('welcome')}
                onGoImplementation={() => goToShipSubstage('implementation')}
                onNavigate={(s) => {
                  setStatus(null)
                  goToStep(s)
                }}
              />
            }
            implementation={
              <ImplementationReadinessScreen
                state={state}
                onUpdate={patch}
                onContinueToReview={() => goToShipSubstage('review-pr')}
              />
            }
            reviewPr={
              <ReviewPrScreen
                state={state}
                onUpdate={patch}
                onNavigate={(next) => {
                  setStatus(null)
                  if (next === 'ship') goToShipSubstage('review-pr')
                  else goToStep(next)
                }}
              />
            }
            release={
              <ReleaseClosureScreen
                state={state}
                onUpdate={patch}
                onNavigate={(next) => {
                  setStatus(null)
                  goToStep(next)
                }}
              />
            }
          />
        )
    }
  }

  const shipSubstage = state.shipSubstage || 'workspace'
  const showBack = step !== 'welcome'
  const showNext =
    step !== 'welcome'
    && !(step === 'ship' && ['implementation', 'review-pr', 'release'].includes(shipSubstage))
  const isWelcome = step === 'welcome'
  const isSuccessScreen = kitResultOpen && (loading || state.generationComplete)
  const shipIdx = stepIndex('ship')
  const currentSkipped = state.generationComplete && stepIndex(step) > completedThrough && stepIndex(step) < shipIdx
  // Original gate: after Project & Stakeholders (not blocked on confirmed scope / Work plan).
  const showQuickDownload =
    !isWelcome &&
    !kitResultOpen &&
    step !== 'ship' &&
    stepIndex(step) > stepIndex('project-stakeholders')

  return (
    <div className={`app-shell${isWelcome ? ' welcome-mode' : ''}${chatOpen && !isWelcome ? ' chat-open' : ''}`}>
      <ThemeBackground />
      {!isWelcome && (
        <WizardSidebar
          currentStep={step}
          completedThrough={completedThrough}
          generationComplete={state.generationComplete}
          groomingUnlocked={groomingComplete(state)}
          unrestrictedNav={unrestrictedNav}
          state={state}
          onNavigate={(s) => {
            setStatus(null)
            setKitResultOpen(false)
            goToStep(s)
          }}
        />
      )}

      <div className={`main${isWelcome ? ' main-welcome' : ''}${isSuccessScreen ? ' main-success' : ''}`}>
        {(!isSuccessScreen || folderPrep === 'preparing' || governancePrep === 'preparing') && !isWelcome && (
          <header className="top-float" aria-label="Step actions">
            <div className="top-float-row">
            <div className="top-float-chip top-float-start">
              <span className="step-indicator">
                {phaseProgressLabel(step)}
              </span>
            </div>
            <div className="top-float-chip top-float-end">
              <button
                type="button"
                className={`header-chat-btn${chatOpen ? ' is-active' : ''}`}
                onClick={() => setChatOpen(!chatOpen)}
                title="Blink Chat"
                aria-label="Blink Chat"
              >
                <MessageSquare size={16} />
                <span className="header-btn-label">Blink Chat</span>
              </button>
              {showQuickDownload && (
                <button
                  type="button"
                  className="header-download-btn"
                  disabled={loading || grooming}
                  onClick={handleQuickDownload}
                  aria-label="Download Project"
                >
                  <Download size={16} />
                  <span className="header-btn-label">Download Project</span>
                </button>
              )}
              <SessionControls compact />
            </div>
            </div>
            {(folderPrep !== 'idle' || governancePrep !== 'idle') && (
              <div className="prep-stack">
                {folderPrep !== 'idle' && (
                  <div className={`header-progress${folderPrep === 'ready' ? ' is-ready' : ''}${folderPrep === 'failed' ? ' is-failed' : ''}${folderPrep === 'preparing' && folderProgress.total === 0 ? ' is-waiting' : ''}`}>
                    <div className="header-progress-copy">
                      <span>
                        {folderPrep === 'preparing'
                          ? 'Saving project folder'
                          : folderPrep === 'ready'
                            ? 'Project folder is ready'
                            : 'Folder will finish when you download'}
                      </span>
                      {folderPrep !== 'failed' && (
                        <strong>
                          {folderPrep === 'ready'
                            ? '100%'
                            : folderProgress.total > 0
                              ? `${folderProgress.percent}% · ${folderProgress.copied.toLocaleString()} / ${folderProgress.total.toLocaleString()}`
                              : 'Working'}
                        </strong>
                      )}
                    </div>
                    {folderPrep !== 'failed' && (
                      <div
                        className="header-progress-bar"
                        role="progressbar"
                        aria-label="Project folder progress"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={folderPrep === 'ready' ? 100 : folderProgress.percent}
                      >
                        <span
                          className="header-progress-fill"
                          style={folderPrep === 'ready' ? { width: '100%' } : folderProgress.total > 0 ? { width: `${folderProgress.percent}%` } : undefined}
                        />
                      </div>
                    )}
                  </div>
                )}
                {governancePrep !== 'idle' && (
                  <div className={`header-progress${governancePrep === 'ready' ? ' is-ready' : ''}${governancePrep === 'failed' ? ' is-failed' : ''}${governancePrep === 'preparing' ? ' is-waiting' : ''}`}>
                    <div className="header-progress-copy">
                      <span>
                        {governancePrep === 'preparing'
                          ? 'Checking stakeholder roles'
                          : governancePrep === 'ready'
                            ? state.sodWarnings.length
                              ? 'Stakeholder governance note is ready'
                              : 'Stakeholder roles are configured'
                            : 'Could not finish stakeholder checks. You can keep going'}
                      </span>
                      {governancePrep !== 'failed' && (
                        <strong>{governancePrep === 'ready' ? '100%' : 'Working'}</strong>
                      )}
                    </div>
                    {governancePrep !== 'failed' && (
                      <div
                        className="header-progress-bar"
                        role="progressbar"
                        aria-label="Stakeholder governance progress"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={governancePrep === 'ready' ? 100 : 35}
                      >
                        <span
                          className="header-progress-fill"
                          style={governancePrep === 'ready' ? { width: '100%' } : undefined}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </header>
        )}

        <div className={`content${isSuccessScreen ? ' content-fill' : ''}${isWelcome ? ' content-welcome' : ''}${currentSkipped ? ' content-skipped' : ''}`}>
          {status && !isWelcome && <div className={`status-banner ${status.type}`}>{status.message}</div>}
          {renderScreen()}
        </div>

        {!isSuccessScreen && !isWelcome && (
          <div className="action-float" aria-label="Wizard navigation">
            {showBack ? (
              <button type="button" className="secondary-btn action-float-btn action-float-back" onClick={goBack}>
                <ChevronLeft size={14} /> Back
              </button>
            ) : (
              <span className="action-float-slot" aria-hidden="true" />
            )}
            {showNext ? (
              <button
                type="button"
                className="primary-btn action-float-btn action-float-next"
                disabled={
                  saving
                  || loading
                  || grooming
                  || creatingRepos
                  || (step === 'project-shape' && !shapeConfirmUi.confirmed && (shapeConfirmUi.busy || shapeConfirmUi.pending))
                }
                onClick={() => {
                  if (step === 'project-shape' && !shapeConfirmUi.confirmed) {
                    void shapeConfirmRef.current?.()
                    return
                  }
                  void goNext()
                }}
              >
                {step === 'project-shape' && !shapeConfirmUi.confirmed
                  ? (shapeConfirmUi.busy ? 'Confirming…' : 'Confirm structure')
                  : <>{primaryContinueLabel(step, { saving, creatingRepos })} <ChevronRight size={14} /></>}
              </button>
            ) : (
              <span className="action-float-slot" aria-hidden="true" />
            )}
          </div>
        )}
      </div>

      {!isWelcome && (
        <ChatPanel
          projectId={state.projectId}
          currentStep={step}
          open={chatOpen}
          onOpenChange={setChatOpen}
          onNavigate={(s) => {
            setStatus(null)
            goToStep(s as WizardStep)
          }}
        />
      )}
    </div>
  )
}

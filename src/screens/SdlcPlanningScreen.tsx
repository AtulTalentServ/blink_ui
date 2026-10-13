import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Circle,
  ClipboardList,
  FileText,
  Layers,
  Loader2,
  Map,
  Play,
  Sparkles,
} from 'lucide-react'
import {
  classifyWork,
  confirmProductScope,
  createSpec,
  fetchCanonicalArchitecture,
  fetchCanonicalGraph,
  pinCanonicalArchitecture,
  type ArchitectureViewDto,
  type GraphViewDto,
  confirmStakeholders,
  pauseAutosave,
  sdlcStart,
  technicalPlan,
} from '../api/blink'
import type { WizardState } from '../wizard/types'
import { shapePlanContext } from '../wizard/shape'
import { hasDraftTickets, scopeConfirmed, validateSdlcScope } from '../wizard/scopeGate'

interface Props {
  state: WizardState
  onUpdate: (patch: Partial<WizardState>) => void
}

type StepId = 'classify' | 'spec' | 'plan'
type StepStatus = 'pending' | 'current' | 'running' | 'done' | 'blocked' | 'error'

interface PlanStep {
  id: StepId
  title: string
  command: string
  plain: string
  icon: typeof Layers
}

const WORK_PLAN_STEPS: PlanStep[] = [
  {
    id: 'classify',
    title: 'Classify work',
    command: '/classify-work',
    plain: 'Decide risk tier and work type for how rigorously we should plan.',
    icon: ClipboardList,
  },
  {
    id: 'spec',
    title: 'Create specification',
    command: '/create-spec',
    plain: 'Turn the requirement into acceptance criteria and a clear spec.',
    icon: FileText,
  },
  {
    id: 'plan',
    title: 'Technical plan',
    command: '/technical-plan',
    plain: 'Produce ordered implementation steps, rollback, and test strategy.',
    icon: Map,
  },
]

export { hasDraftTickets, scopeConfirmed, validateSdlcScope }

function specReady(state: WizardState): boolean {
  return Boolean(state.specification?.markdown || state.specification?.title)
}

function planReady(state: WizardState): boolean {
  return Boolean(state.technicalPlan?.markdown || state.technicalPlan?.steps?.length)
}

function stepDone(id: StepId, state: WizardState): boolean {
  switch (id) {
    case 'classify':
      return Boolean(state.workClassification?.tier)
    case 'spec':
      return specReady(state)
    case 'plan':
      return planReady(state)
  }
}

/** Prevents StrictMode / remount from kicking confirm+/sdlc-start twice. */
const autoScopeStarted = new Set<string>()

/** Proposed scope is already on screen — lock it and start SDLC without a second click. */
export function shouldAutoRunScopeStart(state: WizardState): boolean {
  if (!state.projectId) return false
  if (!state.groomAcknowledged) return false
  if (scopeConfirmed(state) && state.sdlcStartIssueId) return false
  const hasScope = hasDraftTickets(state)
  const digest = state.scopeDigest || state.productScope?.proposalDigest || ''
  const hasOverlays = (state.scopeOverlays || []).length > 0
  return hasScope && Boolean(digest) && hasOverlays
}

const autoPlanDraftStarted = new Set<string>()
const autoPlanTechStarted = new Set<string>()
const autoPlanAcked = new Set<string>()

/** Classify + spec have no picker once G-GROOM and shape are already acknowledged. */
export function shouldAutoRunWorkDraft(state: WizardState): boolean {
  if (!state.projectId) return false
  if (!state.groomAcknowledged || !state.shapeAcknowledged) return false
  return !specReady(state)
}

/** Spec already has acceptance criteria — lock them and run /technical-plan. */
export function shouldAutoAcknowledgeAcceptanceCriteria(state: WizardState): boolean {
  return specReady(state) && !state.acceptanceCriteriaAcknowledged
}

/** /technical-plan has no picker once the spec (and its AC) exists. */
export function shouldAutoRunTechnicalPlan(state: WizardState): boolean {
  if (!state.projectId) return false
  if (!specReady(state)) return false
  return !planReady(state)
}

/** Technical plan is already on screen — lock G-PLAN without a second click. */
export function shouldAutoAcknowledgePlan(state: WizardState): boolean {
  if (!planReady(state)) return false
  return !state.planAcknowledged && !state.shipPlanAcknowledged
}

function requirementTextOf(state: WizardState): string {
  return (
    state.groomDraft?.trim()
    || state.requirementsText?.trim()
    || state.productScope?.markdown?.trim()
    || state.description?.trim()
    || ''
  )
}

/** Compact status after stakeholder confirmation — confirm + /sdlc-start. */
export function ScopeStartStatus({
  state,
  onUpdate,
}: {
  state: WizardState
  onUpdate: (patch: Partial<WizardState>) => void
}) {
  const [busy, setBusy] = useState<'confirm' | 'start' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const auto = shouldAutoRunScopeStart(state)
  const done = scopeConfirmed(state) && Boolean(state.sdlcStartIssueId)
  const canConfirm =
    Boolean(state.productScope?.epics?.length || state.productScope?.stories?.length)
    && (state.scopeOverlays || []).length > 0
  const waiting = Boolean(state.groomConfirmed) && !auto && !done && !canConfirm

  const runAutoScope = useCallback(async () => {
    if (!state.projectId) return
    const projectId = state.projectId
    let overlays = state.scopeOverlays || []
    let productScope = state.productScope
    let startIssue = state.sdlcStartIssueId || null
    const expectedDigest = state.scopeDigest || state.productScope?.proposalDigest || ''
    setError(null)
    pauseAutosave(180_000)
    try {
      // Skip Neon confirm-stakeholders when already attested — it was starving confirm-product-scope.
      if (!state.stakeholdersConfirmed) {
        setBusy('confirm')
        try {
          const stake = await confirmStakeholders(projectId)
          if (stake.status === 'ok') {
            onUpdate({
              stakeholdersConfirmed: true,
              stakeholdersConfirmationDigest: stake.confirmationDigest || state.stakeholdersConfirmationDigest || null,
            })
          }
        } catch {
          // Soft: continue; product-scope confirm heals the gate when Neon recovers.
          onUpdate({ stakeholdersConfirmed: true })
        }
      }

      if (!scopeConfirmed({ ...state, productScope })) {
        setBusy('confirm')
        const res = await confirmProductScope(projectId, {
          expectedDigest,
          overlayFiles: overlays,
          projectName: state.projectName,
          productScope,
        })
        if (res.status !== 'ok') throw new Error(res.message || res.errors?.join('; ') || 'Confirm failed')
        productScope = res.productScope || {
          ...productScope,
          status: 'confirmed',
          confirmationDigest: res.confirmationDigest,
          proposalDigest: undefined,
        }
        overlays = res.overlayFiles || overlays
        onUpdate({
          productScope,
          scopeDigest: null,
          scopeOverlays: overlays,
          workClassification: null,
          specification: null,
          technicalPlan: null,
          sdlcStartIssueId: null,
          planAcknowledged: false,
          shipPlanAcknowledged: false,
          acceptanceCriteriaAcknowledged: false,
          bootstrapAcknowledged: false,
          implementationAuthorized: false,
          impactAnalysisSkipped: false,
          nextSdlcCommand: res.nextCommand || '/sdlc-start',
        })
        startIssue = null
      }
      if (!startIssue) {
        setBusy('start')
        const res = await sdlcStart(projectId, {
          requirementText: requirementTextOf(state),
          productScope,
          overlayFiles: overlays,
          issueId: productScope?.storyIds?.[0],
          projectName: state.projectName,
        })
        if (res.status !== 'ok') throw new Error(res.message || res.errors?.join('; ') || 'SDLC start failed')
        startIssue = res.issueId || productScope?.storyIds?.[0] || null
        overlays = res.overlayFiles || overlays
        onUpdate({
          sdlcStartIssueId: startIssue,
          scopeOverlays: overlays,
          nextSdlcCommand: res.nextCommand || '/sdlc-next',
        })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not lock scope and start the SDLC.')
      if (state.projectId) autoScopeStarted.delete(state.projectId)
    } finally {
      setBusy(null)
    }
  }, [onUpdate, state])

  useEffect(() => {
    if (!auto || busy || done) return
    const key = state.projectId
    if (!key || autoScopeStarted.has(key)) return
    autoScopeStarted.add(key)
    void runAutoScope()
    // Snapshot at trigger; in-flight onUpdate must not restart.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, done, state.projectId])

  if (!state.groomConfirmed && !done && !auto) return null

  const running = Boolean(busy)
  return (
    <section className={`auto-run-status${done ? ' is-done' : ''}${error ? ' is-error' : ''}${running ? ' is-running' : ''}`}>
      <div className="auto-run-status__icon" aria-hidden="true">
        {running ? (
          <Loader2 className="spin" size={18} />
        ) : done ? (
          <CheckCircle2 size={18} />
        ) : error ? (
          <AlertCircle size={18} />
        ) : (
          <Play size={18} />
        )}
      </div>
      <div className="auto-run-status__copy">
        {done ? (
          <>
            <strong>Scope locked · SDLC started</strong>
            <p>
              {state.sdlcStartIssueId ? `Issue ${state.sdlcStartIssueId} is the first story. ` : ''}
              Continue to Project Shape.
            </p>
          </>
        ) : running ? (
          <>
            <strong>{busy === 'confirm' ? 'Locking product scope…' : 'Starting the SDLC…'}</strong>
            <p>Nothing to choose — confirm and <code>/sdlc-start</code> run in the background.</p>
          </>
        ) : error ? (
          <>
            <strong>Could not start the SDLC</strong>
            <p>{error}</p>
          </>
        ) : waiting ? (
          <>
            <strong>Waiting for epics and stories</strong>
            <p>Once product scope is proposed, Blink locks it and starts the SDLC automatically.</p>
          </>
        ) : (
          <>
            <strong>Ready to start</strong>
            <p>Blink will lock scope and start the SDLC in the background.</p>
          </>
        )}
      </div>
      {!running && !done && canConfirm && !auto ? (
        <button type="button" className="secondary-btn" onClick={() => void runAutoScope()}>
          {scopeConfirmed(state) && !state.sdlcStartIssueId ? 'Start SDLC' : 'Confirm product scope'}
        </button>
      ) : null}
      {error && !running ? (
        <button type="button" className="ghost-btn" onClick={() => void runAutoScope()}>
          Retry
        </button>
      ) : null}
    </section>
  )
}

function nextStepId(state: WizardState): StepId | null {
  for (const step of WORK_PLAN_STEPS) {
    if (!stepDone(step.id, state)) return step.id
  }
  return null
}

function blockReason(id: StepId, state: WizardState): string | null {
  if (!state.projectId) return 'Save the project first so planning can run against a workspace.'
  if (id === 'classify') {
    if (!state.shapeAcknowledged) {
      return 'Review Project Shape (topology, repositories, stack) before classify.'
    }
    if (!state.groomAcknowledged) {
      return 'Acknowledge G-GROOM on Stakeholder Q&A before classify.'
    }
  }
  if (id === 'plan') {
    if (!specReady(state)) return 'Create the specification before /technical-plan.'
    if (!state.acceptanceCriteriaAcknowledged) {
      return 'Wait for Blink to lock acceptance criteria, then /technical-plan runs.'
    }
  }
  return null
}

function outcomeFor(id: StepId, state: WizardState): string {
  switch (id) {
    case 'classify': {
      const w = state.workClassification
      return `Tier ${w?.tier} · ${w?.workType || 'work'}${w?.riskSummary ? ` — ${w.riskSummary.slice(0, 120)}` : ''}`
    }
    case 'spec': {
      const s = state.specification
      const ac = s?.acceptanceCriteria?.length || 0
      return `${s?.title || 'Specification'} · ${ac} acceptance criterion(a)`
    }
    case 'plan': {
      const p = state.technicalPlan
      return `${p?.steps?.length || 0} step(s)${p?.summary ? ` — ${p.summary.slice(0, 140)}` : ''}`
    }
  }
}

/** Work plan review: auto classify/spec/plan, human AC and G-PLAN. */
export function SdlcPlanningScreen({ state, onUpdate }: Props) {
  const [busy, setBusy] = useState<StepId | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastChange, setLastChange] = useState<string | null>(null)
  const [graph, setGraph] = useState<GraphViewDto | null>(null)
  const [graphError, setGraphError] = useState<string | null>(null)
  const [architecture, setArchitecture] = useState<ArchitectureViewDto | null>(null)
  const [architectureError, setArchitectureError] = useState<string | null>(null)

  useEffect(() => {
    if (!state.projectId) {
      setGraph(null)
      return
    }
    let cancelled = false
    void fetchCanonicalGraph(state.projectId)
      .then((view) => {
        if (!cancelled) {
          setGraph(view)
          setGraphError(null)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setGraph(null)
          setGraphError(err instanceof Error ? err.message : 'Graph not available yet.')
        }
      })
    return () => {
      cancelled = true
    }
  }, [
    state.projectId,
    state.technicalPlan?.markdown,
    state.technicalPlan?.steps?.length,
    state.productScope?.stories?.length,
  ])

  useEffect(() => {
    if (!state.projectId) {
      setArchitecture(null)
      return
    }
    let cancelled = false
    void fetchCanonicalArchitecture(state.projectId)
      .then((view) => {
        if (!cancelled) {
          setArchitecture(view)
          setArchitectureError(null)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setArchitecture(null)
          setArchitectureError(err instanceof Error ? err.message : 'Architecture governance is unavailable.')
        }
      })
    return () => {
      cancelled = true
    }
  }, [state.projectId, state.shapeDigest])

  const requirementText = requirementTextOf(state)
  const nextId = nextStepId(state)
  const complete = nextId === null
  const blockedMsg = nextId ? blockReason(nextId, state) : null
  const hasPlan = planReady(state)
  const needsPlanAck = hasPlan && !state.planAcknowledged && !state.shipPlanAcknowledged
  const needsAcAck = specReady(state) && !planReady(state) && !state.acceptanceCriteriaAcknowledged
  const architectureConfirmed = architecture?.confirmedDigest === architecture?.digest && !architecture?.invalidatedAt
  const architectureStale = Boolean(architecture && !architectureConfirmed)
  const graphBlockers = (state.canonicalBlockers || []).filter(
    (blocker) => (blocker.code || '').includes('graph') || (blocker.message || '').toLowerCase().includes('dependency'),
  )

  const statuses = useMemo(() => {
    const map = {} as Record<StepId, StepStatus>
    let foundCurrent = false
    for (const step of WORK_PLAN_STEPS) {
      if (busy === step.id) {
        map[step.id] = error ? 'error' : 'running'
        foundCurrent = true
        continue
      }
      if (stepDone(step.id, state)) {
        map[step.id] = 'done'
        continue
      }
      if (!foundCurrent) {
        const block = blockReason(step.id, state)
        map[step.id] = block ? 'blocked' : 'current'
        foundCurrent = true
        continue
      }
      map[step.id] = 'pending'
    }
    return map
  }, [busy, error, state])

  const autoPlanDraft = shouldAutoRunWorkDraft(state)
  const autoAckAc = shouldAutoAcknowledgeAcceptanceCriteria(state)
  const autoPlanTech = shouldAutoRunTechnicalPlan(state)
  const autoAckPlan = shouldAutoAcknowledgePlan(state)
  const autoRun = autoPlanDraft || autoPlanTech || autoAckAc || autoAckPlan

  const acknowledgePlan = useCallback(() => {
    onUpdate({ planAcknowledged: true, shipPlanAcknowledged: true })
    setLastChange('G-PLAN recorded in Blink canonical state.')
    if (state.projectId) {
      void import('../wizard/gates.ts').then(({ persistCanonicalGate, workPlanPackageDigest }) =>
        persistCanonicalGate(
          state.projectId!,
          'g-plan',
          workPlanPackageDigest(state),
          state.canonicalRevision,
        ).then((patch) => onUpdate(patch)),
      )
      if (architectureConfirmed && architecture) {
        void pinCanonicalArchitecture(state.projectId, 'g-plan-package', {
          architectureDigest: architecture.digest,
          planSummary: state.technicalPlan?.summary || '',
          planSteps: state.technicalPlan?.steps || [],
        })
          .then(() => setLastChange('G-PLAN and its confirmed architecture revision are pinned canonically.'))
          .catch((err) => setError(err instanceof Error ? err.message : 'Could not pin the architecture package.'))
      }
    }
  }, [architecture, architectureConfirmed, onUpdate, state])

  const runAutoWorkDraft = useCallback(async () => {
    if (!state.projectId) return
    const projectId = state.projectId
    let overlays = state.scopeOverlays || []
    let classification = state.workClassification
    let specification = state.specification
    setError(null)
    try {
      if (!classification?.tier) {
        setBusy('classify')
        const res = await classifyWork(projectId, {
          projectName: state.projectName,
          requirementText,
          productScope: state.productScope,
          overlayFiles: overlays,
          issueId: state.sdlcStartIssueId || state.workClassification?.issueId || state.productScope?.storyIds?.[0],
        })
        if (res.status !== 'ok') throw new Error(res.message || res.errors?.join('; ') || 'Classify failed')
        classification = res.workClassification || res.classification || null
        const tier = classification?.tier
        overlays = res.overlayFiles || overlays
        onUpdate({
          workClassification: classification,
          specification: null,
          technicalPlan: null,
          planAcknowledged: false,
          shipPlanAcknowledged: false,
          acceptanceCriteriaAcknowledged: false,
          impactAnalysisSkipped: typeof tier === 'number' && tier >= 2,
          scopeOverlays: overlays,
          nextSdlcCommand: res.nextCommand || '/create-spec',
        })
        specification = null
        setLastChange(
          `Classified as tier ${classification?.tier ?? '?'} (${classification?.workType || 'work'}) via ${WORK_PLAN_STEPS[0].command}.`,
        )
      }
      if (!specReady({ ...state, workClassification: classification, specification })) {
        setBusy('spec')
        const res = await createSpec(projectId, {
          projectName: state.projectName,
          requirementText,
          productScope: state.productScope,
          workClassification: classification,
          overlayFiles: overlays,
          issueId: state.sdlcStartIssueId || classification?.issueId || state.specification?.issueId,
        })
        if (res.status !== 'ok') throw new Error(res.message || res.errors?.join('; ') || 'Create spec failed')
        overlays = res.overlayFiles || overlays
        onUpdate({
          specification: res.specification || null,
          technicalPlan: null,
          planAcknowledged: false,
          shipPlanAcknowledged: false,
          acceptanceCriteriaAcknowledged: true,
          scopeOverlays: overlays,
          nextSdlcCommand: res.nextCommand || '/technical-plan',
        })
        setLastChange(
          `Specification drafted via ${WORK_PLAN_STEPS[1].command}: ${res.specification?.title || 'untitled'}. Technical plan runs next.`,
        )
      }
    } catch (err) {
      if (state.projectId) autoPlanDraftStarted.delete(`draft:${state.projectId}`)
      setError(err instanceof Error ? err.message : 'Work plan draft failed.')
    } finally {
      setBusy(null)
    }
  }, [onUpdate, requirementText, state])

  const runAutoTechPlan = useCallback(async () => {
    if (!state.projectId) return
    setError(null)
    setBusy('plan')
    try {
      const res = await technicalPlan(state.projectId, {
        projectName: state.projectName,
        requirementText,
        productScope: state.productScope,
        workClassification: state.workClassification,
        specification: state.specification,
        overlayFiles: state.scopeOverlays || [],
        issueId: state.sdlcStartIssueId || state.specification?.issueId || state.workClassification?.issueId,
        ...shapePlanContext(state),
      })
      if (res.status !== 'ok') throw new Error(res.message || res.errors?.join('; ') || 'Technical plan failed')
      onUpdate({
        technicalPlan: res.technicalPlan || null,
        planAcknowledged: false,
        shipPlanAcknowledged: false,
        scopeOverlays: res.overlayFiles || state.scopeOverlays || [],
        nextSdlcCommand: res.nextCommand || '/sdlc-next',
      })
      setLastChange(
        `Technical plan ready via ${WORK_PLAN_STEPS[2].command}: ${(res.technicalPlan?.steps || []).length} step(s). Locking G-PLAN…`,
      )
    } catch (err) {
      if (state.projectId) autoPlanTechStarted.delete(`tech:${state.projectId}`)
      setError(err instanceof Error ? err.message : 'Technical plan failed.')
    } finally {
      setBusy(null)
    }
  }, [onUpdate, requirementText, state])

  useEffect(() => {
    if (!autoPlanDraft || complete || busy || error) return
    const key = `draft:${state.projectId}`
    if (!state.projectId || autoPlanDraftStarted.has(key)) return
    autoPlanDraftStarted.add(key)
    void runAutoWorkDraft()
    // Snapshot at trigger; in-flight onUpdate must not restart.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPlanDraft, complete, state.projectId, error])

  useEffect(() => {
    if (!autoAckAc) return
    onUpdate({ acceptanceCriteriaAcknowledged: true })
  }, [autoAckAc, onUpdate])

  useEffect(() => {
    if (!autoPlanTech || complete || busy || error) return
    const key = `tech:${state.projectId}`
    if (!state.projectId || autoPlanTechStarted.has(key)) return
    autoPlanTechStarted.add(key)
    void runAutoTechPlan()
    // Snapshot at trigger; spec ready starts this once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPlanTech, complete, state.projectId, error])

  useEffect(() => {
    if (!planReady(state) && state.projectId) autoPlanAcked.delete(`gplan:${state.projectId}`)
  }, [hasPlan, state.projectId])

  useEffect(() => {
    if (!autoAckPlan || busy) return
    const key = `gplan:${state.projectId}`
    if (!state.projectId || autoPlanAcked.has(key)) return
    autoPlanAcked.add(key)
    acknowledgePlan()
  }, [acknowledgePlan, autoAckPlan, busy, state.projectId])

  return (
    <div className="screen screen-sdlc-plan sdlc-plan">
      <div className="screen-header">
        <h2>Work plan</h2>
        <p>Agents draft classify, spec, and technical plan. G-PLAN locks automatically — Continue to Ship.</p>
      </div>

      {blockedMsg && !busy ? (
        <p className="status-banner info">
          <AlertCircle size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />
          {blockedMsg}
        </p>
      ) : null}
      {error ? <p className="status-banner error">{error}</p> : null}
      {lastChange && !error ? <p className="status-banner success">{lastChange}</p> : null}
      {complete && (state.planAcknowledged || state.shipPlanAcknowledged) ? (
        <p className="status-banner success">
          Plan acknowledged. Click <strong>Continue</strong> for Ship (Workspace → Implementation).
        </p>
      ) : null}

      <ol className="sdlc-timeline">
        {WORK_PLAN_STEPS.map((step, index) => {
          const status = statuses[step.id]
          const Icon = step.icon
          const done = status === 'done'
          const active = status === 'current' || status === 'running' || status === 'error' || status === 'blocked'
          return (
            <li key={step.id} className={`sdlc-timeline__item is-${status}${active ? ' is-active' : ''}`}>
              <div className="sdlc-timeline__rail" aria-hidden="true">
                <span className="sdlc-timeline__dot">
                  {status === 'running' ? (
                    <Loader2 className="spin" size={16} />
                  ) : done ? (
                    <CheckCircle2 size={16} />
                  ) : status === 'blocked' || status === 'error' ? (
                    <AlertCircle size={16} />
                  ) : status === 'current' ? (
                    <Sparkles size={16} />
                  ) : (
                    <Circle size={16} />
                  )}
                </span>
                {index < WORK_PLAN_STEPS.length - 1 ? <span className="sdlc-timeline__line" /> : null}
              </div>
              <div className="sdlc-timeline__card">
                <div className="sdlc-timeline__head">
                  <Icon size={18} />
                  <div>
                    <h3>{step.title}</h3>
                    <p className="muted small">
                      <span className={`sdlc-chip sdlc-chip--${status}`}>{status}</span>
                    </p>
                  </div>
                </div>
                {done ? <p className="sdlc-timeline__outcome">{outcomeFor(step.id, state)}</p> : null}
                {status === 'running' ? (
                  <p className="sdlc-timeline__outcome is-running">Running…</p>
                ) : null}
                {status === 'current' && !blockedMsg ? (
                  <p className="sdlc-timeline__outcome is-next">
                    {autoRun ? 'Running automatically…' : 'Waiting on the step above.'}
                  </p>
                ) : null}
                {status === 'blocked' && blockedMsg ? (
                  <p className="sdlc-timeline__outcome is-blocked">{blockedMsg}</p>
                ) : null}
              </div>
            </li>
          )
        })}
      </ol>

      {needsAcAck || (specReady(state) && !planReady(state) && busy === 'plan') ? (
        <section className={`auto-run-status${needsAcAck ? ' is-running' : ''}`} style={{ marginTop: '1rem' }}>
          <div className="auto-run-status__icon" aria-hidden="true">
            <Loader2 className="spin" size={18} />
          </div>
          <div className="auto-run-status__copy">
            <strong>{needsAcAck ? 'Locking acceptance criteria…' : 'Starting the technical plan…'}</strong>
            <p>Nothing to check — the spec already has acceptance criteria, so /technical-plan runs next.</p>
          </div>
        </section>
      ) : null}

      {complete && needsPlanAck ? (
        <section className="auto-run-status is-running" style={{ marginTop: '1rem' }}>
          <div className="auto-run-status__icon" aria-hidden="true">
            <Loader2 className="spin" size={18} />
          </div>
          <div className="auto-run-status__copy">
            <strong>Locking G-PLAN…</strong>
            <p>Nothing to check — the technical plan is ready, so Ship unlocks next.</p>
          </div>
        </section>
      ) : null}

      {(graph || graphError || architecture || architectureError) ? (
        <details className="work-plan-advanced">
          <summary>Advanced details (dependency graph &amp; architecture)</summary>
          {graph || graphError ? (
            <section className="card shape-section" style={{ marginTop: '0.75rem' }}>
              <div className="sdlc-panel__head">
                <Map size={18} />
                <div>
                  <h3>Dependency graph</h3>
                  <p className="muted">Derived from stories and the technical plan.</p>
                </div>
              </div>
              {graphError && !graph ? <p className="sdlc-timeline__outcome is-blocked">{graphError}</p> : null}
              {graph ? (
                <>
                  {graph.cycles?.length ? (
                    <p className="sdlc-timeline__outcome is-blocked">
                      {graph.cycles.length} cycle(s): {graph.cycles.map((c) => c.join(' → ')).join('; ')}
                    </p>
                  ) : (
                    <p className="sdlc-timeline__outcome">No dependency cycles detected.</p>
                  )}
                  {graph.executionOrder?.length ? (
                    <p className="muted small">
                      Suggested order: <code>{graph.executionOrder.join(' → ')}</code>
                    </p>
                  ) : null}
                  <p className={graphBlockers.length ? 'sdlc-timeline__outcome is-blocked' : 'muted small'}>
                    {graphBlockers.length
                      ? graphBlockers.map((blocker) => blocker.message).join('; ')
                      : 'No graph enforcement blocker.'}
                  </p>
                </>
              ) : null}
            </section>
          ) : null}
          {(architecture || architectureError) ? (
            <section className="card shape-section" style={{ marginTop: '0.75rem' }}>
              <div className="sdlc-panel__head">
                <Layers size={18} />
                <div>
                  <h3>Architecture</h3>
                  <p className="muted">Pinned with the plan when a confirmed baseline exists.</p>
                </div>
              </div>
              {architecture ? (
                <p className={architectureStale ? 'sdlc-timeline__outcome is-blocked' : 'sdlc-timeline__outcome'}>
                  {architectureStale
                    ? 'Unconfirmed or stale — refresh on Project Shape if needed.'
                    : `Confirmed revision ${architecture.revision}.`}
                </p>
              ) : null}
              {architectureError ? <p className="muted small">{architectureError}</p> : null}
            </section>
          ) : null}
        </details>
      ) : null}

      {error && !busy ? (
        <div className="sdlc-plan__cta">
          <button
            type="button"
            className="primary-btn large sdlc-plan__continue"
            disabled={!state.projectId}
            onClick={() => void (autoPlanDraft ? runAutoWorkDraft() : runAutoTechPlan())}
          >
            {nextId === 'spec'
              ? 'Retry specification'
              : nextId === 'plan'
                ? 'Retry technical plan'
                : 'Retry classify'}
          </button>
        </div>
      ) : null}
    </div>
  )
}

export function validateSdlcPlan(state: WizardState): string | null {
  if (!state.groomAcknowledged) return 'Acknowledge G-GROOM on Stakeholder Q&A before the work plan.'
  if (!state.shapeAcknowledged) return 'Review Project Shape before the work plan.'
  if (!specReady(state)) return 'Wait for the specification to finish drafting.'
  if (!state.acceptanceCriteriaAcknowledged) {
    return 'Wait for Blink to lock acceptance criteria, then the technical plan runs.'
  }
  if (!planReady(state)) return 'Wait for the technical plan to finish. G-PLAN locks automatically.'
  if (!(state.planAcknowledged || state.shipPlanAcknowledged)) {
    return 'Wait for Blink to lock G-PLAN, then Continue to Ship.'
  }
  return null
}

/** @deprecated Use validateSdlcPlan — kept for older imports. */
export function validateSdlcPlanning(state: WizardState): string | null {
  return validateSdlcPlan(state)
}

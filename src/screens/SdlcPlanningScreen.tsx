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
  sdlcStart,
  technicalPlan,
} from '../api/blink'
import type { WizardState } from '../wizard/types'
import { shapePlanContext } from '../wizard/shape'

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

function scopeConfirmed(state: WizardState): boolean {
  return Boolean(state.productScope?.status === 'confirmed' || state.productScope?.confirmationDigest)
}

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

/** Scope already locked on Requirements — nothing left to pick. */
export function shouldAutoRunScopeStart(state: WizardState): boolean {
  if (!state.projectId) return false
  if (scopeConfirmed(state) && state.sdlcStartIssueId) return false
  const hasScope = Boolean(state.productScope?.epics?.length || state.productScope?.stories?.length)
  const digest = state.scopeDigest || state.productScope?.proposalDigest || ''
  const hasOverlays = (state.scopeOverlays || []).length > 0
  return hasScope && Boolean(digest) && hasOverlays
}

const autoPlanDraftStarted = new Set<string>()
const autoPlanTechStarted = new Set<string>()

/** Classify + spec have no picker once G-GROOM and shape are already acknowledged. */
export function shouldAutoRunWorkDraft(state: WizardState): boolean {
  if (!state.projectId) return false
  if (!state.groomAcknowledged || !state.shapeAcknowledged) return false
  return !specReady(state)
}

/** /technical-plan has no picker after the human AC checkbox. */
export function shouldAutoRunTechnicalPlan(state: WizardState): boolean {
  if (!state.projectId) return false
  if (!specReady(state) || !state.acceptanceCriteriaAcknowledged) return false
  return !planReady(state)
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

/** Compact status on Requirements — confirm + /sdlc-start, no extra tab. */
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
  const waiting = Boolean(state.groomConfirmed) && !auto && !done

  const runAutoScope = useCallback(async () => {
    if (!state.projectId) return
    const projectId = state.projectId
    let overlays = state.scopeOverlays || []
    let productScope = state.productScope
    let startIssue = state.sdlcStartIssueId || null
    const expectedDigest = state.scopeDigest || state.productScope?.proposalDigest || ''
    setError(null)
    try {
      if (!scopeConfirmed({ ...state, productScope })) {
        setBusy('confirm')
        const res = await confirmProductScope(projectId, {
          expectedDigest,
          overlayFiles: overlays,
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
              {state.sdlcStartIssueId ? `Issue ${state.sdlcStartIssueId}. ` : ''}
              You can move on to Stakeholder Q&A.
            </p>
          </>
        ) : running ? (
          <>
            <strong>{busy === 'confirm' ? 'Locking product scope…' : 'Starting the SDLC…'}</strong>
            <p>Nothing to choose — confirm and <code>/sdlc-start</code> run here.</p>
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
      {error && !running ? (
        <button type="button" className="secondary-btn" onClick={() => void runAutoScope()}>
          {scopeConfirmed(state) && !state.sdlcStartIssueId ? 'Start SDLC' : 'Confirm scope'}
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
      return 'Confirm acceptance criteria before /technical-plan.'
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

  const requirementText = requirementTextOf(state)
  const nextId = nextStepId(state)
  const complete = nextId === null
  const blockedMsg = nextId ? blockReason(nextId, state) : null
  const hasPlan = planReady(state)
  const needsPlanAck = hasPlan && !state.planAcknowledged && !state.shipPlanAcknowledged
  const needsAcAck = specReady(state) && !planReady(state) && !state.acceptanceCriteriaAcknowledged

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
  const autoPlanTech = shouldAutoRunTechnicalPlan(state)
  const autoRun = autoPlanDraft || autoPlanTech

  const acknowledgePlan = useCallback(() => {
    onUpdate({ planAcknowledged: true, shipPlanAcknowledged: true })
    setLastChange('G-PLAN acknowledgement is local product state, not an approval gate.')
  }, [onUpdate, state])

  const rejectPlan = useCallback(() => {
    onUpdate({
      technicalPlan: null,
      planAcknowledged: false,
      shipPlanAcknowledged: false,
    })
    setLastChange('G-PLAN rejected. /technical-plan will run again after you confirm.')
    setError(null)
  }, [onUpdate])

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
          acceptanceCriteriaAcknowledged: false,
          scopeOverlays: overlays,
          nextSdlcCommand: res.nextCommand || '/technical-plan',
        })
        setLastChange(
          `Specification drafted via ${WORK_PLAN_STEPS[1].command}: ${res.specification?.title || 'untitled'}. Confirm acceptance criteria next.`,
        )
      }
    } catch (err) {
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
        `Technical plan ready via ${WORK_PLAN_STEPS[2].command}: ${(res.technicalPlan?.steps || []).length} step(s). Acknowledge G-PLAN before continuing.`,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Technical plan failed.')
    } finally {
      setBusy(null)
    }
  }, [onUpdate, requirementText, state])

  useEffect(() => {
    if (!autoPlanDraft || complete || busy) return
    const key = `draft:${state.projectId}`
    if (!state.projectId || autoPlanDraftStarted.has(key)) return
    autoPlanDraftStarted.add(key)
    void runAutoWorkDraft()
    // Snapshot at trigger; in-flight onUpdate must not restart.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPlanDraft, complete, state.projectId])

  useEffect(() => {
    if (!autoPlanTech || complete || busy) return
    const key = `tech:${state.projectId}`
    if (!state.projectId || autoPlanTechStarted.has(key)) return
    autoPlanTechStarted.add(key)
    void runAutoTechPlan()
    // Snapshot at trigger; AC check starts this once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPlanTech, complete, state.projectId])

  return (
    <div className="sdlc-plan">
      <div className="screen-header">
        <h2>Work plan</h2>
        <p>
          {autoPlanDraft
            ? 'Drafting the spec. Confirm acceptance criteria when it is ready.'
            : autoPlanTech
              ? 'Writing the technical plan. Review it when it is ready.'
              : 'Review the spec and technical plan, then continue to Ship.'}
        </p>
      </div>

      {blockedMsg && !busy ? (
        <p className="status-banner info">
          <AlertCircle size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />
          {blockedMsg}
        </p>
      ) : null}
      {error ? <p className="status-banner error">{error}</p> : null}
      {lastChange && !error ? <p className="status-banner success">{lastChange}</p> : null}
      {complete ? (
        <p className="status-banner success">
          Work plan drafted. Acknowledge G-PLAN, then continue to <strong>Ship</strong>. Remotes are
          created on Ship after <code>G-BOOTSTRAP</code>.
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
                      <code>{step.command}</code>
                      <span className={`sdlc-chip sdlc-chip--${status}`}>{status}</span>
                    </p>
                  </div>
                </div>
                <p className="sdlc-timeline__plain">{step.plain}</p>
                {done ? <p className="sdlc-timeline__outcome">{outcomeFor(step.id, state)}</p> : null}
                {status === 'running' ? (
                  <p className="sdlc-timeline__outcome is-running">Calling hosted agent…</p>
                ) : null}
                {status === 'current' && !blockedMsg ? (
                  <p className="sdlc-timeline__outcome is-next">
                    {autoRun ? 'This runs in the background.' : 'Waiting on the step above.'}
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

      {needsAcAck ? (
        <section className="card shape-section" style={{ marginTop: '1rem' }}>
          <div className="sdlc-panel__head">
            <CheckCircle2 size={18} />
            <div>
              <h3>Confirm acceptance criteria (human)</h3>
              <p className="muted">
                Human confirmation that the spec&apos;s acceptance criteria were reviewed — not an LLM step and
                not an approve-gate. Required before <code>/technical-plan</code>.
              </p>
            </div>
          </div>
          <label className="muted small" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <input
              type="checkbox"
              checked={Boolean(state.acceptanceCriteriaAcknowledged)}
              onChange={(e) => onUpdate({ acceptanceCriteriaAcknowledged: e.target.checked })}
            />
            I have reviewed the acceptance criteria
          </label>
        </section>
      ) : null}

      {complete && needsPlanAck ? (
        <section className="card shape-section" style={{ marginTop: '1rem' }}>
          <div className="sdlc-panel__head">
            <CheckCircle2 size={18} />
            <div>
              <h3>Acknowledge G-PLAN (human)</h3>
              <p className="muted">
                Human acknowledgement that the technical plan was reviewed — not an approve-gate. Required
                before continuing past Work plan.
              </p>
            </div>
          </div>
          <label className="muted small" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <input
              type="checkbox"
              checked={Boolean(state.planAcknowledged || state.shipPlanAcknowledged)}
              onChange={(e) => {
                if (e.target.checked) acknowledgePlan()
              }}
            />
            I have reviewed the technical plan (G-PLAN)
          </label>
          <div className="ship-actions">
            <button type="button" className="primary-btn" onClick={acknowledgePlan}>
              Acknowledge G-PLAN (human)
            </button>
            <button type="button" className="secondary-btn" onClick={rejectPlan}>
              Reject G-PLAN
            </button>
          </div>
        </section>
      ) : null}

      {complete && (state.planAcknowledged || state.shipPlanAcknowledged) ? (
        <p className="status-banner success">G-PLAN acknowledged. You can continue to Ship.</p>
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
              ? 'Create specification'
              : nextId === 'plan'
                ? 'Create technical plan'
                : 'Classify work'}
          </button>
        </div>
      ) : null}
    </div>
  )
}

export function validateSdlcScope(state: WizardState): string | null {
  if (!scopeConfirmed(state)) {
    if (shouldAutoRunScopeStart(state)) {
      return 'Wait for Blink to lock scope and start the SDLC, then continue.'
    }
    if (!state.productScope?.epics?.length && !state.productScope?.stories?.length) {
      return 'Wait for epics and stories, then Blink will start the SDLC automatically.'
    }
    return 'Wait for Blink to lock product scope, then continue.'
  }
  if (!state.sdlcStartIssueId) {
    return shouldAutoRunScopeStart(state)
      ? 'Wait for Blink to start the SDLC, then continue to Stakeholder Q&A.'
      : 'Start the SDLC chain before Stakeholder Q&A.'
  }
  return null
}

export function validateSdlcPlan(state: WizardState): string | null {
  if (!state.groomAcknowledged) return 'Acknowledge G-GROOM on Stakeholder Q&A before the work plan.'
  if (!state.shapeAcknowledged) return 'Review Project Shape before the work plan.'
  if (!specReady(state)) return 'Wait for the specification to finish drafting, then confirm acceptance criteria.'
  if (!state.acceptanceCriteriaAcknowledged) return 'Confirm acceptance criteria before the technical plan.'
  if (!planReady(state)) return 'Wait for the technical plan to finish, then acknowledge G-PLAN.'
  if (!(state.planAcknowledged || state.shipPlanAcknowledged)) {
    return 'Acknowledge G-PLAN before continuing.'
  }
  return null
}

/** @deprecated Use validateSdlcPlan — kept for older imports. */
export function validateSdlcPlanning(state: WizardState): string | null {
  return validateSdlcPlan(state)
}

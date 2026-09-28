import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { AlertCircle, Loader2, Pause, Play, RotateCcw, Square } from 'lucide-react'
import { SHIP_SUBSTAGES } from '../wizard/ship.ts'
import type { ShipSubstage, WizardState } from '../wizard/types.ts'
import {
  acquireExecutionLease,
  fetchCanonicalGraph,
  fetchShipSession,
  openExecutionScope,
  recordExecutionEvidence,
  recoverExecutionScope,
  type ExecutionLeaseDto,
  type ExecutionScopeDto,
  type ShipSessionDetailDto,
} from '../api/blink.ts'

interface ShipScreenProps {
  state: WizardState
  substage: ShipSubstage
  onSubstage: (substage: ShipSubstage) => void
  workspace: ReactNode
  implementation: ReactNode
  reviewPr: ReactNode
  release: ReactNode
}

function allowedSubstages(state: WizardState): ShipSubstage[] {
  if (state.canonicalAllowedShipSubstages?.length) {
    return state.canonicalAllowedShipSubstages
  }
  return ['workspace']
}

export function ShipScreen({
  state,
  substage,
  onSubstage,
  workspace,
  implementation,
  reviewPr,
  release,
}: ShipScreenProps) {
  const [session, setSession] = useState<ShipSessionDetailDto | null>(null)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [scopeRef, setScopeRef] = useState('')
  const [frontierRefs, setFrontierRefs] = useState<string[]>([])
  const [scope, setScope] = useState<ExecutionScopeDto | null>(null)
  const [lease, setLease] = useState<ExecutionLeaseDto | null>(null)
  const [executionBusy, setExecutionBusy] = useState<'start' | 'pause' | 'resume' | 'stop' | 'recover' | null>(null)
  const [executionError, setExecutionError] = useState<string | null>(null)

  useEffect(() => {
    if (!state.projectId) {
      setSession(null)
      return
    }
    let cancelled = false
    void fetchShipSession(state.projectId)
      .then((res) => {
        if (!cancelled) {
          setSession(res.session)
          setSessionError(null)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setSession(null)
          setSessionError(err instanceof Error ? err.message : 'Could not load ship session.')
        }
      })
    return () => {
      cancelled = true
    }
  }, [state.projectId, state.canonicalRevision, substage])

  const permitted = useMemo(() => new Set(allowedSubstages(state)), [state.canonicalAllowedShipSubstages])
  const storyRefs = useMemo(
    () => state.productScope?.storyIds?.filter(Boolean) || [],
    [state.productScope?.storyIds],
  )
  const selectableStories = useMemo(
    () => Array.from(new Set([...frontierRefs, ...storyRefs])),
    [frontierRefs, storyRefs],
  )

  const shipHints = (state.canonicalBlockers || []).filter(
    (b) => b.step === 'ship' || (b.code || '').startsWith('ship-'),
  )

  useEffect(() => {
    if (!state.projectId) {
      setFrontierRefs([])
      return
    }
    let cancelled = false
    void fetchCanonicalGraph(state.projectId)
      .then((graph) => {
        if (cancelled) return
        setFrontierRefs(graph.frontier || [])
        setScopeRef((current) => current || graph.frontier[0] || storyRefs[0] || '')
      })
      .catch(() => {
        if (!cancelled) setScopeRef((current) => current || storyRefs[0] || '')
      })
    return () => {
      cancelled = true
    }
  }, [state.projectId, storyRefs])

  const startFrontier = async () => {
    if (!state.projectId || !scopeRef) return
    setExecutionBusy('start')
    setExecutionError(null)
    try {
      const opened = await openExecutionScope(state.projectId, { kind: 'story', ref: scopeRef })
      const acquired = await acquireExecutionLease(state.projectId, { scopeId: opened.id, ttlSeconds: 900 })
      await recordExecutionEvidence(state.projectId, {
        scopeId: opened.id,
        leaseId: acquired.id,
        fencingToken: acquired.fencingToken,
        kind: 'frontier-start',
        evidence: { storyRef: scopeRef, source: 'ship-ui' },
      })
      setScope(opened)
      setLease(acquired)
      const refreshed = await fetchShipSession(state.projectId)
      setSession(refreshed.session)
    } catch (cause) {
      setExecutionError(cause instanceof Error ? cause.message : 'Could not start the selected frontier scope.')
    } finally {
      setExecutionBusy(null)
    }
  }

  const recordControl = async (control: 'pause' | 'resume' | 'stop') => {
    if (!state.projectId || !scope || !lease) return
    setExecutionBusy(control)
    setExecutionError(null)
    try {
      await recordExecutionEvidence(state.projectId, {
        scopeId: scope.id,
        leaseId: lease.id,
        fencingToken: lease.fencingToken,
        kind: `operator-${control}`,
        evidence: { scopeRef: scope.scopeRef, source: 'ship-ui' },
      })
    } catch (cause) {
      setExecutionError(cause instanceof Error ? cause.message : `Could not record ${control}.`)
    } finally {
      setExecutionBusy(null)
    }
  }

  const recover = async () => {
    if (!state.projectId || !scope) return
    setExecutionBusy('recover')
    setExecutionError(null)
    try {
      await recoverExecutionScope(state.projectId, { scopeId: scope.id, reason: 'operator requested recovery from Ship' })
      setScope({ ...scope, status: 'recovering' })
      setLease(null)
    } catch (cause) {
      setExecutionError(cause instanceof Error ? cause.message : 'Could not recover the execution scope.')
    } finally {
      setExecutionBusy(null)
    }
  }

  return (
    <div className="ship-screen">
      <section className="card shape-section ship-session-panel">
        <div className="shape-section-head">
          <h3 className="card-title">Ship session</h3>
          <span className="shape-section-meta">
            Scope {session?.scopeRef || '—'} · max {state.canonicalMaxShipSubstage || session?.maxSubstage || 'workspace'}
          </span>
        </div>
        {sessionError ? <p className="muted small">{sessionError}</p> : null}
        {session?.recentSteps?.length ? (
          <ul className="ship-step-list">
            {session.recentSteps.slice(0, 8).map((step) => (
              <li key={step.id}>
                <code>{step.stepKind}</code>
                <span className="muted small">{step.status}</span>
                {step.finishedAt ? (
                  <span className="muted small">{new Date(step.finishedAt).toLocaleString()}</span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">Delivery steps (Git apply, implement, QA) will appear here as you run them.</p>
        )}
        {shipHints.length > 0 ? (
          <ul className="ship-hint-list">
            {shipHints.map((b) => (
              <li key={b.code || b.message}>{b.message}</li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="card shape-section ship-session-panel">
        <div className="shape-section-head">
          <h3 className="card-title">Execution scope</h3>
          <span className="shape-section-meta">{scope ? `${scope.scopeKind} · ${scope.status}` : 'Story scope first'}</span>
        </div>
        <p className="muted small">
          Blink selects a canonical frontier story, obtains a fenced lease, and records durable evidence. Epic and
          project scopes remain disabled until their Backend recovery policy is enabled.
        </p>
        <label className="field-group">
          <span>Current frontier story</span>
          <select value={scopeRef} onChange={(event) => setScopeRef(event.target.value)} disabled={Boolean(scope)}>
            <option value="">Select a story</option>
            {selectableStories.map((story) => <option key={story} value={story}>{story}</option>)}
          </select>
        </label>
        {lease ? <p className="muted small">Lease {lease.id.slice(0, 8)} · fencing token {lease.fencingToken} · expires {new Date(lease.expiresAt).toLocaleTimeString()}</p> : null}
        {executionError ? <p className="sdlc-timeline__outcome is-blocked">{executionError}</p> : null}
        <div className="ship-actions">
          <button type="button" className="primary-btn" disabled={!scopeRef || Boolean(scope) || Boolean(executionBusy)} onClick={() => void startFrontier()}>
            {executionBusy === 'start' ? <Loader2 size={14} className="spin" /> : <Play size={14} />} Start frontier
          </button>
          <button type="button" className="secondary-btn" disabled={!lease || Boolean(executionBusy)} onClick={() => void recordControl('pause')}>
            <Pause size={14} /> Pause
          </button>
          <button type="button" className="secondary-btn" disabled={!lease || Boolean(executionBusy)} onClick={() => void recordControl('resume')}>
            <Play size={14} /> Resume
          </button>
          <button type="button" className="secondary-btn" disabled={!lease || Boolean(executionBusy)} onClick={() => void recordControl('stop')}>
            <Square size={14} /> Stop
          </button>
          <button type="button" className="ghost-btn" disabled={!scope || Boolean(executionBusy)} onClick={() => void recover()}>
            <RotateCcw size={14} /> Recover
          </button>
        </div>
        {scope ? (
          <p className="muted small">
            <AlertCircle size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />
            Pause/resume/stop are auditable evidence events in the current Backend contract; recovery changes the
            canonical scope to recoverable and releases its lease.
          </p>
        ) : null}
      </section>

      <nav className="ship-subnav" aria-label="Ship phases">
        {SHIP_SUBSTAGES.map((item) => {
          const enabled = permitted.has(item.id)
          return (
            <button
              key={item.id}
              type="button"
              className={item.id === substage ? 'ship-subnav-item active' : 'ship-subnav-item'}
              disabled={!enabled}
              title={enabled ? undefined : 'Complete the prior Ship phase first'}
              onClick={() => enabled && onSubstage(item.id)}
            >
              {item.label}
            </button>
          )
        })}
      </nav>
      <div className="ship-substage-panel">
        {substage === 'workspace' ? workspace : null}
        {substage === 'implementation' ? implementation : null}
        {substage === 'review-pr' ? reviewPr : null}
        {substage === 'release' ? release : null}
      </div>
    </div>
  )
}

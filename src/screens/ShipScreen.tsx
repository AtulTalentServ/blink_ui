import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { SHIP_SUBSTAGES } from '../wizard/ship.ts'
import type { ShipSubstage, WizardState } from '../wizard/types.ts'
import { fetchShipSession, type ShipSessionDetailDto } from '../api/blink.ts'

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

  const shipHints = (state.canonicalBlockers || []).filter(
    (b) => b.step === 'ship' || (b.code || '').startsWith('ship-'),
  )

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

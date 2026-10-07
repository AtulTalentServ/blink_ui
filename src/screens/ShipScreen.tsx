import { useMemo, type ReactNode } from 'react'
import { SHIP_SUBSTAGES } from '../wizard/ship.ts'
import type { ShipSubstage, WizardState } from '../wizard/types.ts'

interface ShipScreenProps {
  state: WizardState
  substage: ShipSubstage
  onSubstage: (substage: ShipSubstage) => void
  workspace: ReactNode
  implementation: ReactNode
  reviewPr: ReactNode
  release: ReactNode
}

const SUBSTAGE_COPY: Record<ShipSubstage, { title: string; detail: string }> = {
  workspace: {
    title: 'Workspace',
    detail: 'Link GitHub remotes if needed, refresh guidance, then mark ready for Implementation.',
  },
  implementation: {
    title: 'Implementation',
    detail: 'Pick a story, run the agent, then continue to Review & PR.',
  },
  'review-pr': {
    title: 'Review & PR',
    detail: 'Register the draft PR, record QA evidence, then authorize a human merge. Blink never merges.',
  },
  release: {
    title: 'Release',
    detail: 'Record merge, deployment, and closure evidence. Blink performs none of these actions.',
  },
}

function allowedSubstages(state: WizardState): ShipSubstage[] {
  const fromCanonical = state.canonicalAllowedShipSubstages?.length
    ? [...state.canonicalAllowedShipSubstages]
    : (['workspace'] as ShipSubstage[])
  if (state.gitWritten && !fromCanonical.includes('implementation')) {
    fromCanonical.push('implementation')
  }
  if (state.implementStep && !fromCanonical.includes('review-pr')) {
    fromCanonical.push('review-pr')
  }
  return fromCanonical as ShipSubstage[]
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
  const permitted = useMemo(
    () => new Set(allowedSubstages(state)),
    [state.canonicalAllowedShipSubstages, state.gitWritten, state.implementStep],
  )
  const shipHints = (state.canonicalBlockers || []).filter(
    (b) => b.step === 'ship' || (b.code || '').startsWith('ship-'),
  )
  const copy = SUBSTAGE_COPY[substage]
  const activeIndex = SHIP_SUBSTAGES.findIndex((item) => item.id === substage)

  return (
    <div className="screen ship-screen">
      <div className="screen-header">
        <h2>{copy.title}</h2>
        <p>{copy.detail}</p>
      </div>

      <ol className="ship-stepper" aria-label="Ship phases">
        {SHIP_SUBSTAGES.map((item, index) => {
          const enabled = permitted.has(item.id)
          const active = item.id === substage
          const done = index < activeIndex
          return (
            <li key={item.id} className={active ? 'is-active' : done ? 'is-done' : ''}>
              <button
                type="button"
                aria-current={active ? 'step' : undefined}
                disabled={!enabled}
                title={enabled ? undefined : 'Complete the prior Ship phase first'}
                onClick={() => enabled && onSubstage(item.id)}
              >
                <span className="ship-step-index">{index + 1}</span>
                <span className="ship-step-label">{item.label.replace(/^\d+\s·\s/, '')}</span>
              </button>
            </li>
          )
        })}
      </ol>

      {shipHints.length > 0 ? (
        <ul className="ship-hint-list">
          {shipHints.map((b) => (
            <li key={b.code || b.message}>{b.message}</li>
          ))}
        </ul>
      ) : null}

      <div className="ship-substage-panel">
        {substage === 'workspace' ? workspace : null}
        {substage === 'implementation' ? implementation : null}
        {substage === 'review-pr' ? reviewPr : null}
        {substage === 'release' ? release : null}
      </div>
    </div>
  )
}

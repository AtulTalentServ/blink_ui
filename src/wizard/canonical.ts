import type { CanonicalSnapshotDto } from '../api/blink.ts'
import { shipSubstageIndex } from './ship.ts'
import type { ShipSubstage, WizardState } from './types.ts'

export type CanonicalBlocker = { code?: string; message?: string; step?: string; substage?: string }

export type CanonicalPatchCurrent = Pick<
  WizardState,
  'shipSubstage' | 'canonicalShipSubstage' | 'gitWritten' | 'implementStep'
>

export function blockersFromSnapshot(snap: CanonicalSnapshotDto): CanonicalBlocker[] {
  if (!snap.blockers) return []
  if (!Array.isArray(snap.blockers)) return []
  return snap.blockers.flatMap((blocker) => {
    if (typeof blocker === 'string') return [{ message: blocker }]
    if (!blocker || typeof blocker !== 'object') return []
    const row = blocker as Record<string, unknown>
    const message = typeof row.message === 'string' ? row.message : ''
    const code = typeof row.code === 'string' ? row.code : undefined
    const step = typeof row.step === 'string' ? row.step : undefined
    const substage = typeof row.substage === 'string' ? row.substage : undefined
    return message || code ? [{ code, message, step, substage }] : []
  })
}

function mergeAllowedShipSubstages(
  snapAllowed: string[] | undefined,
  current?: CanonicalPatchCurrent | null,
): ShipSubstage[] {
  const allowed = new Set<ShipSubstage>(
    (snapAllowed?.length ? snapAllowed : ['workspace']) as ShipSubstage[],
  )
  if (current?.gitWritten) allowed.add('implementation')
  if (current?.implementStep) allowed.add('review-pr')
  return [...allowed]
}

/**
 * Map a canonical snapshot into wizard fields.
 * When `current` is provided, never regress `shipSubstage` past a locally unlocked phase
 * (Neon often still reports workspace after Mark ready / Implement).
 */
export function patchFromCanonicalSnapshot(
  snap: CanonicalSnapshotDto,
  current?: CanonicalPatchCurrent | null,
): Partial<WizardState> {
  const snapSubstage = (snap.eligibility.shipSubstage || 'workspace') as ShipSubstage
  const allowed = mergeAllowedShipSubstages(snap.eligibility.allowedShipSubstages, current)
  const localSubstage = (current?.shipSubstage || current?.canonicalShipSubstage || 'workspace') as ShipSubstage
  let shipSubstage = snapSubstage
  if (
    current
    && shipSubstageIndex(localSubstage) > shipSubstageIndex(snapSubstage)
    && allowed.includes(localSubstage)
  ) {
    shipSubstage = localSubstage
  }
  return {
    canonicalRevision: snap.revision,
    canonicalAllowedSteps: snap.eligibility.allowedSteps || null,
    canonicalAllowedShipSubstages: allowed,
    canonicalMaxShipSubstage: (snap.eligibility.maxShipSubstage as ShipSubstage | undefined) || null,
    canonicalShipSubstage: snapSubstage,
    shipSubstage,
    canonicalBlockers: blockersFromSnapshot(snap),
  }
}

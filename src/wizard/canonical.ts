import type { CanonicalSnapshotDto } from '../api/blink.ts'
import type { ShipSubstage, WizardState } from './types.ts'

export type CanonicalBlocker = { code?: string; message?: string; step?: string; substage?: string }

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

export function patchFromCanonicalSnapshot(snap: CanonicalSnapshotDto): Partial<WizardState> {
  const substage = (snap.eligibility.shipSubstage || 'workspace') as ShipSubstage
  return {
    canonicalRevision: snap.revision,
    canonicalAllowedSteps: snap.eligibility.allowedSteps || null,
    canonicalAllowedShipSubstages: (snap.eligibility.allowedShipSubstages as ShipSubstage[] | undefined) || null,
    canonicalMaxShipSubstage: (snap.eligibility.maxShipSubstage as ShipSubstage | undefined) || null,
    canonicalShipSubstage: substage,
    shipSubstage: substage,
    canonicalBlockers: blockersFromSnapshot(snap),
  }
}

import type { CanonicalSnapshotDto } from '../api/blink.ts'
import type { ShipSubstage, WizardState } from './types.ts'

export type CanonicalBlocker = { code?: string; message?: string; step?: string }

export function blockersFromSnapshot(snap: CanonicalSnapshotDto): CanonicalBlocker[] {
  if (!snap.blockers) return []
  if (Array.isArray(snap.blockers)) return snap.blockers as CanonicalBlocker[]
  return []
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

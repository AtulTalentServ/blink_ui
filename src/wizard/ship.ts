import type { ShipSubstage, WizardStep } from './types.ts'

export const SHIP_SUBSTAGES: { id: ShipSubstage; label: string }[] = [
  { id: 'workspace', label: '1 · Workspace' },
  { id: 'implementation', label: '2 · Implementation' },
  { id: 'review-pr', label: '3 · Review & PR' },
  { id: 'release', label: '4 · Release' },
]

export function shipSubstageIndex(substage: string | undefined | null): number {
  const id = String(substage || 'workspace').toLowerCase().trim()
  const idx = SHIP_SUBSTAGES.findIndex((item) => item.id === id)
  return idx >= 0 ? idx : 0
}

const LEGACY_SHIP_STEPS = new Set<WizardStep>([
  'generation',
  'implementation',
  'review-pr',
  'release',
])

export function isLegacyShipStep(step: WizardStep): boolean {
  return LEGACY_SHIP_STEPS.has(step)
}

export function substageFromLegacyStep(step: WizardStep): ShipSubstage {
  switch (step) {
    case 'implementation':
      return 'implementation'
    case 'review-pr':
      return 'review-pr'
    case 'release':
      return 'release'
    default:
      return 'workspace'
  }
}

export function normalizeShipNavigation(step: WizardStep, substage: ShipSubstage | undefined): {
  step: WizardStep
  shipSubstage: ShipSubstage
} {
  if (step === 'ship') {
    return { step: 'ship', shipSubstage: substage || 'workspace' }
  }
  if (isLegacyShipStep(step)) {
    return { step: 'ship', shipSubstage: substageFromLegacyStep(step) }
  }
  return { step, shipSubstage: substage || 'workspace' }
}

import type { ShipSubstage, WizardStep } from './types.ts'

export const SHIP_SUBSTAGES: { id: ShipSubstage; label: string }[] = [
  { id: 'workspace', label: 'Workspace' },
  { id: 'implementation', label: 'Work in Cursor' },
  { id: 'review-pr', label: 'Review & PR' },
  { id: 'release', label: 'Release' },
]

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

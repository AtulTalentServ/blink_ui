import type { WizardState } from './types'
import { groomingLoopSettled, mandatoryResponsesReady } from './stakeholderSync.ts'

export function groomAcknowledgementPatch(): Partial<WizardState> {
  return { groomAcknowledged: true, groomRejectPending: false }
}

/** True when Continue / next sub-step may record G-GROOM without a separate button. */
export function readyForImplicitGroomAck(state: WizardState): boolean {
  if (state.groomAcknowledged) return false
  if (state.groomRejectPending && !groomingLoopSettled(state)) return false
  if ((state.questions?.length ?? 0) === 0) return true
  return mandatoryResponsesReady(state)
}

export function groomQaGateSatisfied(state: WizardState): boolean {
  return Boolean(state.groomAcknowledged) || readyForImplicitGroomAck(state)
}

export async function persistGroomGateAck(
  projectId: string,
  state: WizardState,
): Promise<Partial<WizardState>> {
  const { groomSessionDigest, persistCanonicalGate } = await import('./gates.ts')
  return persistCanonicalGate(projectId, 'g-groom', groomSessionDigest(state), state.canonicalRevision)
}

/** Record G-GROOM when the operator advances (Continue or Scope & tickets). */
export function applyImplicitGroomAck(
  state: WizardState,
  patch: (updates: Partial<WizardState>) => void,
): Partial<WizardState> | null {
  if (!readyForImplicitGroomAck(state)) return null
  const ack = groomAcknowledgementPatch()
  patch(ack)
  const merged = { ...state, ...ack }
  if (merged.projectId) {
    void persistGroomGateAck(merged.projectId, merged).then((snapPatch) => {
      if (snapPatch && Object.keys(snapPatch).length) patch(snapPatch)
    })
  }
  return ack
}

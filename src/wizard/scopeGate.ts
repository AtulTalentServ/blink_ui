import type { WizardState } from './types'
import { groomQaGateSatisfied } from './groomGate.ts'

type ScopeSlice = Pick<
  WizardState,
  | 'groomAcknowledged'
  | 'groomRejectPending'
  | 'questions'
  | 'responses'
  | 'groomingLoopFeedbackAt'
  | 'groomingSignOff'
  | 'stakeholderPack'
  | 'groomingRevision'
  | 'productScope'
>

/** Proposed epics/stories on Scope & tickets — Jira create is optional. */
export function hasDraftTickets(state: ScopeSlice): boolean {
  return Boolean(state.productScope?.epics?.length || state.productScope?.stories?.length)
}

export function scopeConfirmed(state: ScopeSlice): boolean {
  return Boolean(state.productScope?.status === 'confirmed' || state.productScope?.confirmationDigest)
}

export function validateSdlcScope(state: ScopeSlice): string | null {
  if (!groomQaGateSatisfied(state as WizardState)) {
    return 'Resolve mandatory stakeholder answers before Scope & tickets.'
  }
  if (!hasDraftTickets(state)) {
    return 'Propose epics and stories on Scope & tickets, then continue.'
  }
  return null
}

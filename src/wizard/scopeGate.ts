type ScopeSlice = {
  groomAcknowledged?: boolean
  productScope?: {
    status?: string
    confirmationDigest?: string
    epics?: unknown[]
    stories?: unknown[]
  } | null
}

/** Proposed epics/stories on Scope & tickets — Jira create is optional. */
export function hasDraftTickets(state: ScopeSlice): boolean {
  return Boolean(state.productScope?.epics?.length || state.productScope?.stories?.length)
}

export function scopeConfirmed(state: ScopeSlice): boolean {
  return Boolean(state.productScope?.status === 'confirmed' || state.productScope?.confirmationDigest)
}

export function validateSdlcScope(state: ScopeSlice): string | null {
  if (!state.groomAcknowledged) {
    return 'Acknowledge G-GROOM on Stakeholder Q&A → Stakeholders before Scope & tickets.'
  }
  if (!hasDraftTickets(state)) {
    return 'Open Scope & tickets after G-GROOM so Blink can propose epics and stories, then continue.'
  }
  return null
}

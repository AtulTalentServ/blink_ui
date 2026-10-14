/** UI mode on Implementation readiness — batch runner ships in desktop Phase 3. */

export type ImplementRunMode = 'individual' | 'batch-all'

export const IMPLEMENT_RUN_MODE_KEY = 'blink.implementRunMode'

export function loadImplementRunMode(): ImplementRunMode {
  try {
    const raw = localStorage.getItem(IMPLEMENT_RUN_MODE_KEY)
    if (raw === 'individual' || raw === 'batch-all') return raw
  } catch {
    /* ignore */
  }
  return 'individual'
}

export function saveImplementRunMode(mode: ImplementRunMode): void {
  localStorage.setItem(IMPLEMENT_RUN_MODE_KEY, mode)
}

export interface RequirementsBatchContext {
  text: string
  sourceLabel: string
}

/** Text the implement-all batch will use (not Jira tickets). */
export function requirementsBatchContext(state: {
  groomDraft?: string | null
  requirementsText?: string | null
  productScope?: { markdown?: string | null } | null
  description?: string | null
}): RequirementsBatchContext | null {
  if (state.groomDraft?.trim()) {
    return { text: state.groomDraft.trim(), sourceLabel: 'Grooming draft' }
  }
  if (state.requirementsText?.trim()) {
    return { text: state.requirementsText.trim(), sourceLabel: 'Requirements' }
  }
  if (state.productScope?.markdown?.trim()) {
    return { text: state.productScope.markdown.trim(), sourceLabel: 'Product scope' }
  }
  if (state.description?.trim()) {
    return { text: state.description.trim(), sourceLabel: 'Project description' }
  }
  return null
}

export function excerptRequirements(text: string, max = 2400): string {
  if (text.length <= max) return text
  return `${text.slice(0, max).trimEnd()}…`
}

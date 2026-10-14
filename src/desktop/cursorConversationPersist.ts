import type { CursorConversationTurn, CursorThinkingBlock, ImplementRunState } from './implementRunTypes'

const STORAGE_PREFIX = 'blink.cursorCli.conversation.v1'

export type CursorCliModelPreference = {
  model: string
  continueSession: boolean
}

export type PersistedCursorConversation = {
  workspace: string
  model: string
  continueSession: boolean
  sessionId?: string
  turns: CursorConversationTurn[]
  thinkingBlocks: CursorThinkingBlock[]
  updatedAt: string
}

function normalizeWorkspace(workspace: string): string {
  return workspace.trim().replace(/\\/g, '/').toLowerCase()
}

function storageKey(workspace: string): string {
  const norm = normalizeWorkspace(workspace)
  let hash = 0
  for (let i = 0; i < norm.length; i += 1) {
    hash = (hash * 31 + norm.charCodeAt(i)) | 0
  }
  return `${STORAGE_PREFIX}.${Math.abs(hash).toString(36)}`
}

export function loadCursorConversation(workspace: string): PersistedCursorConversation | null {
  if (!workspace.trim()) return null
  try {
    const raw = localStorage.getItem(storageKey(workspace))
    if (!raw) return null
    const parsed = JSON.parse(raw) as PersistedCursorConversation
    if (normalizeWorkspace(parsed.workspace) !== normalizeWorkspace(workspace)) return null
    return parsed
  } catch {
    return null
  }
}

export function saveCursorConversation(
  workspace: string,
  state: Pick<ImplementRunState, 'turns' | 'thinkingBlocks' | 'sessionId'>,
  prefs: CursorCliModelPreference,
): void {
  if (!workspace.trim()) return
  const payload: PersistedCursorConversation = {
    workspace: workspace.trim(),
    model: prefs.model,
    continueSession: prefs.continueSession,
    sessionId: state.sessionId,
    turns: state.turns.slice(-80),
    thinkingBlocks: state.thinkingBlocks.slice(-40),
    updatedAt: new Date().toISOString(),
  }
  try {
    localStorage.setItem(storageKey(workspace), JSON.stringify(payload))
  } catch {
    /* quota */
  }
}

export function mergePersistedIntoRunState(
  base: ImplementRunState,
  persisted: PersistedCursorConversation | null,
): ImplementRunState {
  if (!persisted) return base
  return {
    ...base,
    turns: persisted.turns,
    thinkingBlocks: persisted.thinkingBlocks.map((b) => ({ ...b, streaming: false })),
    sessionId: persisted.sessionId,
  }
}

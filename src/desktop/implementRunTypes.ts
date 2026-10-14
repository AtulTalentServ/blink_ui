export type ImplementRunPhase =
  | 'validating'
  | 'preparing_workspace'
  | 'cursor_cli'
  | 'completed'
  | 'failed'

export type ImplementRunStepStatus = 'active' | 'completed' | 'failed'

export interface ImplementRunStep {
  stepId: string
  phase: ImplementRunPhase
  title: string
  detail?: string
  status: ImplementRunStepStatus
  timestamp: string
}

export interface ImplementRunLogLine {
  message: string
  stream: string
  timestamp: string
}

export interface ImplementRunActivity {
  activity: string
  toolIndex?: number
  path?: string
  detail?: string
  timestamp: string
}

export interface CursorThinkingBlock {
  id: string
  sessionId?: string
  text: string
  collapsed: boolean
  streaming: boolean
  timestamp: string
}

export interface CursorConversationTurn {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  timestamp: string
  meta?: string
}

export type CursorFileChangeStatus = 'added' | 'modified' | 'deleted'

export interface CursorFileChange {
  path: string
  status: CursorFileChangeStatus
  additions: number
  deletions: number
  timestamp: string
}

export interface ImplementRunState {
  running: boolean
  steps: ImplementRunStep[]
  logs: ImplementRunLogLine[]
  activities: ImplementRunActivity[]
  thinkingBlocks: CursorThinkingBlock[]
  fileChanges: CursorFileChange[]
  turns: CursorConversationTurn[]
  sessionId?: string
  finished?: { ok: boolean; exitCode: number; summary?: string }
}

export type ImplementRunEvent =
  | {
      type: 'step'
      phase: ImplementRunPhase
      stepId?: string
      title: string
      detail?: string
      status?: ImplementRunStepStatus
      timestamp: string
    }
  | { type: 'log'; message: string; stream?: string; timestamp: string }
  | {
      type: 'cursor_activity'
      activity: string
      toolIndex?: number
      path?: string
      detail?: string
      timestamp: string
    }
  | {
      type: 'cursor_thinking'
      phase: 'delta' | 'completed'
      text?: string
      sessionId?: string
      timestamp: string
    }
  | {
      type: 'cursor_message'
      role: 'user' | 'assistant' | 'system'
      content: string
      sessionId?: string
      timestamp: string
    }
  | {
      type: 'cursor_tool'
      phase: 'started' | 'completed'
      toolKind?: string
      path?: string
      detail?: string
      toolIndex?: number
      timestamp: string
    }
  | { type: 'cursor_session'; sessionId: string; timestamp: string }
  | {
      type: 'cursor_file_change'
      path: string
      fileStatus: CursorFileChangeStatus
      additions: number
      deletions: number
      timestamp: string
    }
  | {
      type: 'finished'
      ok: boolean
      exitCode: number
      summary?: string
      timestamp: string
    }

export function emptyImplementRunState(): ImplementRunState {
  return {
    running: false,
    steps: [],
    logs: [],
    activities: [],
    thinkingBlocks: [],
    fileChanges: [],
    turns: [],
  }
}

function upsertFileChange(state: ImplementRunState, change: CursorFileChange): ImplementRunState {
  const files = [...state.fileChanges]
  const idx = files.findIndex((row) => row.path === change.path)
  if (change.status === 'deleted') {
    if (idx >= 0) {
      const prev = files[idx]
      files[idx] = {
        ...change,
        additions: 0,
        deletions: prev.additions + prev.deletions,
      }
    } else {
      files.push(change)
    }
  } else if (idx >= 0) {
    const prev = files[idx]
    files[idx] = {
      path: change.path,
      status: prev.status === 'added' && change.status === 'added' ? 'added' : 'modified',
      additions: prev.additions + change.additions,
      deletions: prev.deletions + change.deletions,
      timestamp: change.timestamp,
    }
  } else {
    files.push(change)
  }
  return { ...state, fileChanges: files.slice(-200) }
}

function appendTurn(state: ImplementRunState, turn: CursorConversationTurn): ImplementRunState {
  const turns = [...state.turns.filter((t) => t.id !== turn.id), turn].slice(-80)
  return { ...state, turns }
}

function lastUserTurnIndex(turns: CursorConversationTurn[]): number {
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].role === 'user') return i
  }
  return -1
}

function upsertAssistantMessage(
  state: ImplementRunState,
  content: string,
  sessionId: string | undefined,
  timestamp: string,
): ImplementRunState {
  const sid = sessionId || 'default'
  const trimmed = content.trim()
  if (!trimmed) return state

  const turns = [...state.turns]
  const userIdx = lastUserTurnIndex(turns)
  for (let i = turns.length - 1; i > userIdx; i--) {
    const turn = turns[i]
    if (turn.role !== 'assistant') continue
    if ((turn.meta || 'default') !== sid) continue

    const prev = turn.content
    let merged = trimmed
    if (trimmed.startsWith(prev)) merged = trimmed
    else if (prev.startsWith(trimmed)) merged = prev
    else if (!prev.includes(trimmed)) merged = `${prev}${trimmed}`

    turns[i] = { ...turn, content: merged, timestamp }
    return { ...state, turns }
  }

  return appendTurn(state, {
    id: `assistant-${sid}-${timestamp}`,
    role: 'assistant',
    content: trimmed,
    timestamp,
    meta: sid,
  })
}

function appendUserMessage(state: ImplementRunState, content: string, timestamp: string): ImplementRunState {
  const trimmed = content.trim()
  if (!trimmed) return state
  if (state.turns.some((t) => t.role === 'user' && t.content.trim() === trimmed)) {
    return state
  }
  return appendTurn(state, {
    id: `user-${timestamp}-${state.turns.length}`,
    role: 'user',
    content: trimmed,
    timestamp,
  })
}

function upsertThinkingDelta(
  state: ImplementRunState,
  sessionId: string | undefined,
  text: string,
  timestamp: string,
): ImplementRunState {
  const sid = sessionId || 'default'
  const blocks = [...state.thinkingBlocks]
  const idx = blocks.findIndex((b) => b.streaming && (b.sessionId || 'default') === sid)
  if (idx < 0) {
    blocks.push({
      id: `${sid}-${timestamp}`,
      sessionId: sid,
      text,
      collapsed: true,
      streaming: true,
      timestamp,
    })
  } else {
    blocks[idx] = { ...blocks[idx], text: blocks[idx].text + text }
  }
  return { ...state, thinkingBlocks: blocks.slice(-40) }
}

function completeThinking(state: ImplementRunState, sessionId: string | undefined): ImplementRunState {
  const sid = sessionId || 'default'
  const blocks = state.thinkingBlocks.map((b) =>
    b.streaming && (b.sessionId || 'default') === sid ? { ...b, streaming: false, collapsed: true } : b,
  )
  return { ...state, thinkingBlocks: blocks }
}

export function toggleThinkingCollapsed(state: ImplementRunState, blockId: string): ImplementRunState {
  return {
    ...state,
    thinkingBlocks: state.thinkingBlocks.map((b) =>
      b.id === blockId ? { ...b, collapsed: !b.collapsed } : b,
    ),
  }
}

export function addUserTurn(state: ImplementRunState, content: string): ImplementRunState {
  const timestamp = new Date().toISOString()
  return appendTurn(state, {
    id: `user-${timestamp}`,
    role: 'user',
    content,
    timestamp,
  })
}

export function reduceImplementRunEvent(state: ImplementRunState, raw: string): ImplementRunState {
  let event: ImplementRunEvent
  try {
    event = JSON.parse(raw) as ImplementRunEvent
  } catch {
    if (raw.includes('"type":"thinking"') || raw.includes('"type": "thinking"')) {
      return state
    }
    return {
      ...state,
      logs: [
        ...state.logs,
        { message: raw, stream: 'parse', timestamp: new Date().toISOString() },
      ].slice(-80),
    }
  }

  if (event.type === 'step') {
    const stepId = event.stepId || event.phase
    const next: ImplementRunStep = {
      stepId,
      phase: event.phase,
      title: event.title,
      detail: event.detail,
      status: event.status || 'active',
      timestamp: event.timestamp,
    }
    const steps = [...state.steps.filter((s) => s.stepId !== stepId), next].sort(
      (a, b) => a.timestamp.localeCompare(b.timestamp),
    )
    return { ...state, steps }
  }

  if (event.type === 'log') {
    if (event.stream === 'cursor_json') {
      return state
    }
    return {
      ...state,
      logs: [
        ...state.logs,
        {
          message: event.message,
          stream: event.stream || 'info',
          timestamp: event.timestamp,
        },
      ].slice(-80),
    }
  }

  if (event.type === 'cursor_activity') {
    return {
      ...state,
      activities: [
        ...state.activities,
        {
          activity: event.activity,
          toolIndex: event.toolIndex,
          path: event.path,
          detail: event.detail,
          timestamp: event.timestamp,
        },
      ].slice(-100),
    }
  }

  if (event.type === 'cursor_thinking') {
    if (event.phase === 'delta') {
      return upsertThinkingDelta(state, event.sessionId, event.text || '', event.timestamp)
    }
    return completeThinking(state, event.sessionId)
  }

  if (event.type === 'cursor_message') {
    if (event.role === 'user') {
      return appendUserMessage(state, event.content, event.timestamp)
    }
    if (event.role === 'assistant') {
      return upsertAssistantMessage(state, event.content, event.sessionId, event.timestamp)
    }
    return appendTurn(state, {
      id: `${event.role}-${event.timestamp}-${state.turns.length}`,
      role: event.role,
      content: event.content,
      timestamp: event.timestamp,
    })
  }

  if (event.type === 'cursor_tool') {
    const label =
      event.phase === 'started'
        ? `${event.toolKind || 'tool'} ${event.path || ''}`.trim()
        : `${event.toolKind || 'tool'} done ${event.detail || ''}`.trim()
    return appendTurn(state, {
      id: `tool-${event.timestamp}-${state.turns.length}`,
      role: 'tool',
      content: label,
      timestamp: event.timestamp,
      meta: event.path,
    })
  }

  if (event.type === 'cursor_session') {
    return { ...state, sessionId: event.sessionId }
  }

  if (event.type === 'cursor_file_change') {
    return upsertFileChange(state, {
      path: event.path,
      status: event.fileStatus,
      additions: event.additions,
      deletions: event.deletions,
      timestamp: event.timestamp,
    })
  }

  if (event.type === 'finished') {
    const thinkingBlocks = state.thinkingBlocks.map((b) => ({ ...b, streaming: false }))
    return {
      ...state,
      running: false,
      thinkingBlocks,
      finished: { ok: event.ok, exitCode: event.exitCode, summary: event.summary },
    }
  }

  return state
}

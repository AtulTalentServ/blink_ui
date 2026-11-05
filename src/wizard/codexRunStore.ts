import {
  emptyCodexConsole,
  reduceCodexEvent,
  type CodexConsoleState,
} from '../components/CodexAgentConsole'

export type CodexRunSnapshot = {
  busy: boolean
  sessionId: string | null
  error: string | null
  message: string | null
  console: CodexConsoleState
}

export type ProjectCodexMeta = {
  runningAll: boolean
  error: string | null
  message: string | null
}

const STORAGE_KEY = 'blink.codexRuns.v1'

const IDLE_RUN: CodexRunSnapshot = {
  busy: false,
  sessionId: null,
  error: null,
  message: null,
  console: emptyCodexConsole(),
}

const IDLE_META: ProjectCodexMeta = { runningAll: false, error: null, message: null }

const runs = new Map<string, CodexRunSnapshot>()
const metas = new Map<string, ProjectCodexMeta>()
const abortFlags = new Map<string, boolean>()
const inflight = new Map<string, Promise<unknown>>()
const listeners = new Set<() => void>()
let version = 0

function emit() {
  version += 1
  persist()
  for (const listener of listeners) listener()
}

export function codexRunKey(projectId: string, issueId: string) {
  return `${projectId}:${issueId}`
}

export function subscribeCodexRuns(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getCodexRunVersion() {
  return version
}

export function getCodexRun(key: string): CodexRunSnapshot {
  return runs.get(key) ?? IDLE_RUN
}

export function projectCodexMeta(projectId: string): ProjectCodexMeta {
  return metas.get(projectId) ?? IDLE_META
}

export function busyIssueId(projectId: string): string | null {
  return busyIssueIds(projectId)[0] || null
}

export function busyIssueIds(projectId: string): string[] {
  const prefix = `${projectId}:`
  const out: string[] = []
  for (const [key, run] of runs) {
    if (key.startsWith(prefix) && run.busy) out.push(key.slice(prefix.length))
  }
  return out
}

export function patchCodexRun(key: string, update: (prev: CodexRunSnapshot) => CodexRunSnapshot) {
  const prev = getCodexRun(key)
  const next = update(prev)
  if (next === prev) return
  if (
    !next.busy
    && !next.sessionId
    && !next.error
    && !next.message
    && next.console.events.length === 0
    && !next.console.output
  ) {
    runs.delete(key)
  } else {
    runs.set(key, next)
  }
  emit()
}

export function patchProjectCodexMeta(projectId: string, patch: Partial<ProjectCodexMeta>) {
  const prev = projectCodexMeta(projectId)
  const next = { ...prev, ...patch }
  if (next.runningAll === prev.runningAll && next.error === prev.error && next.message === prev.message) return
  if (!next.runningAll && !next.error && !next.message) metas.delete(projectId)
  else metas.set(projectId, next)
  emit()
}

export function beginCodexRun(projectId: string, issueId: string) {
  patchCodexRun(codexRunKey(projectId, issueId), (prev) => ({
    ...prev,
    busy: true,
    error: null,
    message: null,
    console: { ...emptyCodexConsole(), busy: true, phase: 'provisioning' },
  }))
}

export function applyCodexEvent(projectId: string, issueId: string, event: string, payload: Record<string, unknown>) {
  patchCodexRun(codexRunKey(projectId, issueId), (prev) => {
    const console = reduceCodexEvent(prev.console, event, payload)
    const sessionId = typeof payload.codexSessionId === 'string' && payload.codexSessionId
      ? payload.codexSessionId
      : prev.sessionId
    return { ...prev, busy: console.busy, sessionId, console }
  })
}

export function rememberCodexSession(projectId: string, issueId: string, sessionId: string | null | undefined) {
  if (!sessionId) return
  patchCodexRun(codexRunKey(projectId, issueId), (prev) => (
    prev.sessionId === sessionId ? prev : { ...prev, sessionId }
  ))
}

export function failCodexRun(projectId: string, issueId: string, message: string) {
  applyCodexEvent(projectId, issueId, 'error', { message })
  finishCodexRun(projectId, issueId, { error: message, message: null })
}

export function finishCodexRun(projectId: string, issueId: string, patch?: { error?: string | null; message?: string | null }) {
  patchCodexRun(codexRunKey(projectId, issueId), (prev) => ({
    ...prev,
    busy: false,
    error: patch && 'error' in patch ? patch.error ?? null : prev.error,
    message: patch && 'message' in patch ? patch.message ?? null : prev.message,
    console: { ...prev.console, busy: false },
  }))
}

export function requestCodexAbort(projectId: string) {
  abortFlags.set(projectId, true)
}

export function clearCodexAbort(projectId: string) {
  abortFlags.set(projectId, false)
}

export function codexAbortRequested(projectId: string) {
  return abortFlags.get(projectId) === true
}

export function codexRunInflight(key: string) {
  return inflight.has(key)
}

export function trackCodexRun(key: string, work: Promise<unknown>) {
  inflight.set(key, work)
  void work.finally(() => {
    if (inflight.get(key) === work) inflight.delete(key)
  })
}

function persist() {
  if (typeof sessionStorage === 'undefined') return
  try {
    const slimRuns: Record<string, CodexRunSnapshot> = {}
    for (const [key, run] of runs) {
      slimRuns[key] = {
        ...run,
        console: {
          ...run.console,
          output: run.console.output.slice(-8000),
          commands: run.console.commands.slice(-4000),
          thinking: '',
          events: run.console.events.slice(-80),
        },
      }
    }
    const slimMeta: Record<string, ProjectCodexMeta> = {}
    for (const [key, meta] of metas) slimMeta[key] = meta
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ runs: slimRuns, metas: slimMeta }))
  } catch {
    /* quota or private mode */
  }
}

function hydrate() {
  if (typeof sessionStorage === 'undefined') return
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as { runs?: Record<string, CodexRunSnapshot>; metas?: Record<string, ProjectCodexMeta> }
    for (const [key, run] of Object.entries(parsed.runs || {})) {
      if (!run || typeof run !== 'object') continue
      runs.set(key, {
        busy: Boolean(run.busy),
        sessionId: run.sessionId ?? null,
        error: run.error ?? null,
        message: run.message ?? null,
        console: {
          ...emptyCodexConsole(),
          ...(run.console || {}),
          events: Array.isArray(run.console?.events) ? run.console.events : [],
        },
      })
    }
    for (const [key, meta] of Object.entries(parsed.metas || {})) {
      if (!meta) continue
      metas.set(key, {
        runningAll: Boolean(meta.runningAll),
        error: meta.error ?? null,
        message: meta.message ?? null,
      })
    }
  } catch {
    /* ignore corrupt cache */
  }
}

hydrate()

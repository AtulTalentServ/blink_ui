import { useMemo, useState } from 'react'
import { Loader2, Square, Terminal } from 'lucide-react'
import { cancelCodexSession } from '../api/blink'

export type CodexPhase =
  | 'idle'
  | 'provisioning'
  | 'connected'
  | 'running'
  | 'retry'
  | 'turn_completed'
  | 'completed'
  | 'deleted'
  | 'cancelled'
  | 'failed'
  | 'artifact_warning'
  | 'requires_action'

export type CodexConsoleEvent = {
  id: string
  kind: 'status' | 'session' | 'command' | 'output' | 'thinking' | 'error' | 'info'
  text: string
  at: string
}

export type CodexConsoleState = {
  phase: CodexPhase
  openaiSessionId?: string
  codexSessionId?: string
  model?: string
  containerSize?: string
  events: CodexConsoleEvent[]
  output: string
  commands: string
  thinking: string
  busy: boolean
}

export function emptyCodexConsole(): CodexConsoleState {
  return {
    phase: 'idle',
    events: [],
    output: '',
    commands: '',
    thinking: '',
    busy: false,
  }
}

export function reduceCodexEvent(
  state: CodexConsoleState,
  event: string,
  payload: Record<string, unknown>,
): CodexConsoleState {
  const at = new Date().toISOString()
  const push = (kind: CodexConsoleEvent['kind'], text: string): CodexConsoleState => ({
    ...state,
    events: [
      ...state.events.slice(-199),
      { id: `${at}-${Math.random().toString(36).slice(2, 7)}`, kind, text, at },
    ],
  })

  if (event === 'status') {
    const phase = (typeof payload.phase === 'string' ? payload.phase : state.phase) as CodexPhase
    const next = push('status', `phase: ${phase}${payload.message ? ` — ${String(payload.message)}` : ''}`)
    return {
      ...next,
      phase,
      model: typeof payload.model === 'string' ? payload.model : next.model,
      containerSize: typeof payload.containerSize === 'string' ? payload.containerSize : next.containerSize,
      codexSessionId: typeof payload.codexSessionId === 'string' ? payload.codexSessionId : next.codexSessionId,
      busy: !['completed', 'deleted', 'cancelled', 'failed', 'idle'].includes(phase),
    }
  }
  if (event === 'session') {
    return {
      ...push('session', `session ${String(payload.openaiSessionId || '')}`),
      openaiSessionId: typeof payload.openaiSessionId === 'string' ? payload.openaiSessionId : state.openaiSessionId,
      codexSessionId: typeof payload.codexSessionId === 'string' ? payload.codexSessionId : state.codexSessionId,
      phase: 'connected',
      busy: true,
    }
  }
  if (event === 'command') {
    const delta = typeof payload.delta === 'string' ? payload.delta : ''
    return { ...push('command', delta), commands: state.commands + delta, phase: 'running', busy: true }
  }
  if (event === 'output') {
    const delta = typeof payload.delta === 'string' ? payload.delta : ''
    return { ...push('output', delta), output: state.output + delta, phase: 'running', busy: true }
  }
  if (event === 'thinking') {
    const text = typeof payload.text === 'string' ? payload.text : ''
    return { ...push('thinking', text), thinking: state.thinking + text, busy: true }
  }
  if (event === 'error') {
    const message = typeof payload.message === 'string' ? payload.message : 'Codex error'
    return { ...push('error', message), phase: 'failed', busy: false }
  }
  if (event === 'done') {
    return {
      ...push('info', 'done'),
      phase: 'completed',
      busy: false,
      codexSessionId: typeof payload.codexSessionId === 'string' ? payload.codexSessionId : state.codexSessionId,
    }
  }
  return push('info', `${event}`)
}

type Props = {
  projectId?: string | null
  issueId?: string | null
  state: CodexConsoleState
  onFollowUp?: (instruction: string) => void | Promise<void>
  onCancelled?: () => void
  followUpDisabled?: boolean
  title?: string
}

export function CodexAgentConsole({
  projectId,
  issueId,
  state,
  onFollowUp,
  onCancelled,
  followUpDisabled,
  title = 'Codex Cloud Agent',
}: Props) {
  const [followUp, setFollowUp] = useState('')
  const [cancelling, setCancelling] = useState(false)

  const phaseLabel = useMemo(() => {
    switch (state.phase) {
      case 'provisioning':
        return 'Provisioning sandbox…'
      case 'connected':
        return 'Sandbox connected'
      case 'running':
        return 'Running turn…'
      case 'completed':
        return 'Turn completed (session deleted)'
      case 'deleted':
        return 'Sandbox deleted'
      case 'cancelled':
        return 'Cancelled'
      case 'failed':
        return 'Failed'
      default:
        return state.phase === 'idle' ? 'Idle' : state.phase
    }
  }, [state.phase])

  const cancel = async () => {
    if (!projectId || !issueId || cancelling) return
    setCancelling(true)
    try {
      await cancelCodexSession(projectId, { issueId })
      onCancelled?.()
    } finally {
      setCancelling(false)
    }
  }

  const sendFollowUp = async () => {
    const text = followUp.trim()
    if (!text || !onFollowUp) return
    setFollowUp('')
    await onFollowUp(text)
  }

  return (
    <section className="card shape-section codex-console">
      <div className="codex-console__head">
        <Terminal size={18} aria-hidden />
        <div>
          <h3>{title}</h3>
          <p className="muted small">
            {phaseLabel}
            {state.model ? ` · ${state.model}` : ''}
            {state.containerSize ? ` · ${state.containerSize}` : ''}
          </p>
        </div>
        {state.busy ? (
          <button type="button" className="ghost-btn" disabled={cancelling || !projectId} onClick={() => void cancel()}>
            {cancelling ? <Loader2 className="spin" size={14} /> : <Square size={14} />}
            Cancel
          </button>
        ) : null}
      </div>

      {state.thinking ? (
        <details className="codex-console__panel">
          <summary>Reasoning</summary>
          <pre>{state.thinking}</pre>
        </details>
      ) : null}

      {state.commands ? (
        <details className="codex-console__panel" open>
          <summary>Shell</summary>
          <pre>{state.commands}</pre>
        </details>
      ) : null}

      {state.output ? (
        <details className="codex-console__panel" open>
          <summary>Output</summary>
          <pre>{state.output}</pre>
        </details>
      ) : null}

      {state.events.length ? (
        <div className="codex-console__events" aria-live="polite">
          {state.events.slice(-12).map((event) => (
            <div key={event.id} className={`codex-console__event is-${event.kind}`}>
              <span>{event.kind}</span>
              <code>{event.text.slice(0, 240)}</code>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted small">Live sandbox events will appear here when a Codex turn starts.</p>
      )}

      {onFollowUp ? (
        <div className="codex-console__followup">
          <input
            className="full-input"
            value={followUp}
            disabled={Boolean(followUpDisabled) || state.busy}
            onChange={(event) => setFollowUp(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void sendFollowUp()
            }}
            placeholder="Send follow-up instruction to Codex…"
          />
          <button
            type="button"
            className="secondary-btn"
            disabled={!followUp.trim() || Boolean(followUpDisabled) || state.busy}
            onClick={() => void sendFollowUp()}
          >
            Steer
          </button>
        </div>
      ) : null}
    </section>
  )
}

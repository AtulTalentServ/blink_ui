import { useMemo, type ReactNode } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  Square,
} from 'lucide-react'
import { CursorAgentMarkdown } from './CursorAgentMarkdown'
import type {
  CursorConversationTurn,
  CursorFileChange,
  CursorThinkingBlock,
  ImplementRunState,
} from './implementRunTypes'

const THINKING_VISIBLE_LINES = 10
import type { CursorCliModelOption } from './tauriDesktop'

type Props = {
  state: ImplementRunState
  models: CursorCliModelOption[]
  modelsLoading?: boolean
  model: string
  continueSession: boolean
  chatDraft: string
  chatDisabled: boolean
  onModelChange: (model: string) => void
  onContinueSessionChange: (value: boolean) => void
  onChatDraftChange: (value: string) => void
  onSendChat: () => void
  onStop?: () => void
  onToggleThinking: (blockId: string) => void
}

export function CursorAgentConversationPanel({
  state,
  models,
  modelsLoading,
  model,
  continueSession,
  chatDraft,
  chatDisabled,
  onModelChange,
  onContinueSessionChange,
  onChatDraftChange,
  onSendChat,
  onStop,
  onToggleThinking,
}: Props) {
  const cursorBrandModels = models.filter((m) => m.group === 'cursor')
  const otherModels = models.filter((m) => m.group === 'other')
  const modelLabel =
    models.find((m) => m.id === model)?.label ??
    (model === 'auto' ? 'Auto' : model)

  const exchanges = useMemo(
    () => groupIntoExchanges(state.turns, state.thinkingBlocks),
    [state.turns, state.thinkingBlocks],
  )

  const activityStats = useMemo(() => summarizeActivities(state), [state])
  const runningSteps = state.steps.filter((s) => s.status === 'active')
  const latestTaskLabel = activityStats.currentTask || runningSteps.at(-1)?.title

  const fileChanges = state.fileChanges || []

  return (
    <section className="cursor-agent-shell">
      <div className="cursor-agent-shell__body">
      <div className="cursor-agent-shell__thread">
        {exchanges.length === 0 && !state.running ? (
          <p className="cursor-agent-shell__empty">
            Send a follow-up to Cursor CLI. Thinking, tools, and replies stream here like Composer.
          </p>
        ) : null}

        {exchanges.map((exchange, idx) => (
          <article key={exchange.key} className="cursor-agent-exchange">
            {exchange.userTurn ? (
              <header className="cursor-agent-request">
                <div className="cursor-agent-user-prompt">{exchange.userTurn.content}</div>
              </header>
            ) : null}

            <div className="cursor-agent-response">
              {renderExchangeItems(exchange, onToggleThinking, state.running && idx === exchanges.length - 1)}

              {idx === exchanges.length - 1 && state.running ? (
              <div className="cursor-agent-live-block">
                {activityStats.summary ? (
                  <p className="cursor-agent-activity-line">{activityStats.summary}</p>
                ) : null}
                {latestTaskLabel ? (
                  <p className="cursor-agent-activity-line is-running">
                    <Loader2 size={14} className="spin" aria-hidden />
                    Running {latestTaskLabel}
                  </p>
                ) : (
                  <p className="cursor-agent-activity-line is-running">
                    <Loader2 size={14} className="spin" aria-hidden />
                    Agent running…
                  </p>
                )}
              </div>
            ) : null}
            </div>
          </article>
        ))}
      </div>

      <aside className="cursor-agent-changes" aria-label="Files changed">
        <div className="cursor-agent-changes__head">
          <strong>Changes</strong>
          <span className="cursor-agent-changes__count">{fileChanges.length}</span>
        </div>
        {fileChanges.length === 0 ? (
          <p className="cursor-agent-changes__empty muted small">Edited files appear here as the agent runs.</p>
        ) : (
          <ul className="cursor-agent-changes__list">
            {fileChanges.map((row) => (
              <FileChangeRow key={row.path} change={row} />
            ))}
          </ul>
        )}
      </aside>
      </div>

      <footer className="cursor-agent-composer-bar">
        <label className="cursor-agent-composer-bar__continue" title="Continue previous agent session">
          <input
            type="checkbox"
            checked={continueSession}
            disabled={state.running}
            onChange={(e) => onContinueSessionChange(e.target.checked)}
          />
          <span>Continue session</span>
        </label>
        <div className="cursor-agent-composer-bar__input-wrap">
          <input
            type="text"
            className="cursor-agent-composer-bar__input"
            placeholder="Send follow-up"
            value={chatDraft}
            disabled={chatDisabled}
            onChange={(e) => onChatDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                if (!chatDisabled && chatDraft.trim()) onSendChat()
              }
            }}
          />
          <div className="cursor-agent-composer-bar__trailing">
            <label className="cursor-agent-composer-bar__model">
              <span className="sr-only">Model</span>
              <select
                value={models.some((m) => m.id === model) ? model : 'auto'}
                disabled={state.running || modelsLoading}
                onChange={(e) => onModelChange(e.target.value)}
                title={modelLabel}
              >
                {cursorBrandModels.length > 0 ? (
                  <optgroup label="Cursor">
                    {cursorBrandModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                {otherModels.length > 0 ? (
                  <optgroup label="Other models">
                    {otherModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </select>
              <ChevronDown size={14} className="cursor-agent-composer-bar__model-chevron" aria-hidden />
            </label>
            {state.running && onStop ? (
              <button type="button" className="cursor-agent-stop-btn" aria-label="Stop agent" onClick={onStop}>
                <Square size={12} fill="currentColor" />
              </button>
            ) : (
              <button
                type="button"
                className="cursor-agent-send-btn"
                disabled={chatDisabled || !chatDraft.trim()}
                aria-label="Send message"
                onClick={onSendChat}
              >
                ↑
              </button>
            )}
          </div>
        </div>
      </footer>
    </section>
  )
}

function ThoughtBlock({
  block,
  onToggle,
}: {
  block: CursorThinkingBlock
  onToggle: () => void
}) {
  const tail = thinkingTail(block.text, THINKING_VISIBLE_LINES)
  const hiddenLineCount = Math.max(0, block.text.split(/\n/).length - THINKING_VISIBLE_LINES)
  const title = block.streaming ? 'Thinking…' : block.collapsed ? 'Thought (last 10 lines)' : 'Thought process'

  return (
    <div className={`cursor-agent-thought${block.streaming ? ' is-streaming' : ''}`}>
      <button type="button" className="cursor-agent-thought__toggle" onClick={onToggle} aria-expanded={!block.collapsed}>
        {block.collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
        <span>{title}</span>
      </button>
      {block.collapsed && tail ? (
        <pre className="cursor-agent-thought__preview">{tail}</pre>
      ) : null}
      {!block.collapsed ? (
        <div className="cursor-agent-thought__body">
          {hiddenLineCount > 0 ? (
            <p className="cursor-agent-thought__trunc muted small">{hiddenLineCount} earlier line(s) hidden</p>
          ) : null}
          <pre className="cursor-agent-thought__lines">{tail || '…'}</pre>
        </div>
      ) : null}
    </div>
  )
}

function thinkingTail(text: string, maxLines: number): string {
  const lines = text.split(/\n/)
  const slice = lines.length > maxLines ? lines.slice(-maxLines) : lines
  return slice.join('\n').trimEnd()
}

function FileChangeRow({ change }: { change: CursorFileChange }) {
  const label = displayPath(change.path)
  const statusLabel =
    change.status === 'added' ? 'A' : change.status === 'deleted' ? 'D' : 'M'
  return (
    <li className={`cursor-file-change cursor-file-change--${change.status}`} title={change.path}>
      <span className={`cursor-file-change__badge cursor-file-change__badge--${change.status}`}>{statusLabel}</span>
      <span className="cursor-file-change__path">{label}</span>
      <span className="cursor-file-change__stats">
        {change.additions > 0 ? <span className="cursor-file-change__add">+{change.additions}</span> : null}
        {change.deletions > 0 ? <span className="cursor-file-change__del">−{change.deletions}</span> : null}
        {change.status === 'deleted' && change.additions === 0 && change.deletions === 0 ? (
          <span className="cursor-file-change__del">deleted</span>
        ) : null}
      </span>
    </li>
  )
}

function displayPath(path: string): string {
  const norm = path.replace(/\\/g, '/')
  const parts = norm.split('/').filter(Boolean)
  if (parts.length <= 2) return parts.join('/')
  return `…/${parts.slice(-2).join('/')}`
}

function formatToolLine(turn: CursorConversationTurn): string {
  return turn.content.replace(/\s+/g, ' ').trim()
}

function summarizeActivities(state: ImplementRunState): {
  summary: string
  currentTask: string
} {
  const tools = state.turns.filter((t) => t.role === 'tool')
  const acts = state.activities
  let searches = 0
  let commands = 0
  for (const t of tools) {
    const c = t.content.toLowerCase()
    if (c.includes('search') || c.includes('grep') || c.includes('explor')) searches += 1
    if (c.includes('shell') || c.includes('run') || c.includes('command') || c.includes('terminal')) commands += 1
  }
  for (const a of acts) {
    const c = a.activity.toLowerCase()
    if (c.includes('search') || c.includes('grep')) searches += 1
    if (c.includes('command') || c.includes('shell') || c.includes('run')) commands += 1
  }

  const parts: string[] = []
  if (searches > 0) parts.push(`${searches} ${searches === 1 ? 'search' : 'searches'}`)
  if (commands > 0) parts.push(`ran ${commands} ${commands === 1 ? 'command' : 'commands'}`)
  const summary = parts.length ? `Exploring ${parts.join(', ')}` : ''

  const lastTool = tools.at(-1)
  const lastAct = acts.at(-1)
  const currentTask =
    (lastTool && formatToolLine(lastTool)) ||
    lastAct?.activity ||
    lastAct?.detail ||
    ''

  return { summary, currentTask }
}

type ExchangeItem =
  | { kind: 'thinking'; block: CursorThinkingBlock }
  | { kind: 'turn'; turn: CursorConversationTurn }
  | { kind: 'tool'; turn: CursorConversationTurn }

type Exchange = {
  key: string
  userTurn?: CursorConversationTurn
  items: ExchangeItem[]
}

function renderExchangeItems(
  exchange: Exchange,
  onToggleThinking: (id: string) => void,
  streamingAssistant: boolean,
): ReactNode[] {
  const nodes: ReactNode[] = []
  let assistantParts: string[] = []

  const flushAssistant = () => {
    if (!assistantParts.length) return
    const text = assistantParts.join('\n\n')
    nodes.push(
      <div
        key={`assistant-${nodes.length}`}
        className={`cursor-agent-assistant-text${streamingAssistant ? ' is-streaming' : ''}`}
      >
        <CursorAgentMarkdown text={text} streaming={streamingAssistant} />
      </div>,
    )
    assistantParts = []
  }

  for (const item of exchange.items) {
    if (item.kind === 'turn' && item.turn.role === 'assistant') {
      assistantParts.push(item.turn.content)
      continue
    }
    flushAssistant()
    if (item.kind === 'thinking') {
      nodes.push(
        <ThoughtBlock
          key={item.block.id}
          block={item.block}
          onToggle={() => onToggleThinking(item.block.id)}
        />,
      )
    } else if (item.kind === 'tool') {
      nodes.push(
        <p key={item.turn.id} className="cursor-agent-activity-line is-tool">
          {formatToolLine(item.turn)}
        </p>,
      )
    } else if (item.turn.role === 'system') {
      nodes.push(
        <p key={item.turn.id} className="cursor-agent-activity-line muted">
          {item.turn.content}
        </p>,
      )
    }
  }
  flushAssistant()
  return nodes
}

function exchangeItemOrder(item: ExchangeItem): string {
  if (item.kind === 'thinking') return item.block.timestamp
  return item.turn.timestamp
}

function groupIntoExchanges(
  turns: CursorConversationTurn[],
  thinkingBlocks: CursorThinkingBlock[],
): Exchange[] {
  const exchanges: Exchange[] = []
  let current: Exchange | null = null

  const pushCurrent = () => {
    if (current) exchanges.push(current)
    current = null
  }

  for (const turn of turns) {
    if (turn.role === 'user') {
      pushCurrent()
      current = { key: turn.id, userTurn: turn, items: [] }
      continue
    }
    if (!current) current = { key: 'session', items: [] }
    if (turn.role === 'tool') current.items.push({ kind: 'tool', turn })
    else current.items.push({ kind: 'turn', turn })
  }
  pushCurrent()

  for (const block of thinkingBlocks) {
    let target: Exchange | undefined = exchanges[0]
    for (const ex of exchanges) {
      if (ex.userTurn && block.timestamp >= ex.userTurn.timestamp) target = ex
    }
    if (target) target.items.push({ kind: 'thinking', block })
  }

  for (const ex of exchanges) {
    ex.items.sort((a, b) => exchangeItemOrder(a).localeCompare(exchangeItemOrder(b)))
  }

  return exchanges
}

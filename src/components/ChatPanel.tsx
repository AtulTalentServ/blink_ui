import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowUp,
  Check,
  ChevronDown,
  Copy,
  MessageSquare,
  Square,
  Trash2,
  X,
} from 'lucide-react'
import {
  clearProjectChat,
  fetchProjectChat,
  streamProjectChatMessage,
  type ChatMessageDto,
} from '../api/blink'
import { WIZARD_STEPS } from '../wizard/steps'
import { ChatMarkdown } from './ChatMarkdown'
import { CHAT_MODELS, CHAT_MODEL_STORAGE_KEY } from '../developer/chatModels'

const OPEN_KEY = 'blink.chatPanel.open'

type ChatMode = 'ask' | 'agent'

function suggestionsForStep(step: string): string[] {
  switch (step) {
    case 'project-stakeholders':
      return ['Who should own clarify questions?', 'Is this stakeholder roster enough?', 'What happens after I continue?']
    case 'integrations':
      return ['Which integrations do I need next?', 'How do I connect Jira?', 'Is GitHub required for repos?']
    case 'requirements':
      return [
        'What makes a good requirement source?',
        'Can I upload a document instead?',
        'What happens in Stakeholder Q&A?',
      ]
    case 'stakeholder-qa':
      return [
        'How do I clarify this requirement?',
        'When can I create Jira tickets?',
        'Which questions are still pending?',
        'How do Jira comments get posted?',
        'What is still waiting on replies?',
        'How do I record an answer here?',
      ]
    case 'sdlc-plan':
      return ['Does classify run automatically?', 'What is G-PLAN?', 'When do I confirm acceptance criteria?']
    case 'project-shape':
      return ['Which topology fits this product?', 'What happens after I continue?', 'Can I change this after planning?']
    case 'repositories':
      return ['How many repos do I need?', 'When are GitHub remotes created?', 'Should this be a monorepo?']
    case 'technology-per-repo':
      return ['What does setup review mean?', 'Why confirm each stack?', 'Does this affect the work plan?']
    default:
      return ['What should I do on this step?', 'Summarize my project so far', 'What is blocking me from continuing?']
  }
}

function stepLabel(step: string): string {
  return WIZARD_STEPS.find((s) => s.id === step)?.label || step
}

interface Props {
  projectId: string | null
  currentStep: string
  onNavigate: (step: string) => void
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ChatPanel({ projectId, currentStep, onNavigate, open, onOpenChange }: Props) {
  const [model, setModel] = useState<string>(() => {
    try {
      return localStorage.getItem(CHAT_MODEL_STORAGE_KEY) || 'gpt-5.6-luna'
    } catch {
      return 'gpt-5.6-luna'
    }
  })
  const [mode, setMode] = useState<ChatMode>('ask')
  const [messages, setMessages] = useState<ChatMessageDto[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [streamingText, setStreamingText] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<number | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const contextLabel = useMemo(() => stepLabel(currentStep), [currentStep])
  const suggestions = useMemo(() => suggestionsForStep(currentStep), [currentStep])

  const load = useCallback(async () => {
    if (!projectId) {
      setMessages([])
      return
    }
    try {
      const data = await fetchProjectChat(projectId)
      setMessages(data.messages || [])
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load chat')
    }
  }, [projectId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (open) {
      window.setTimeout(() => inputRef.current?.focus(), 50)
    } else {
      setConfirmClear(false)
    }
  }, [open])

  useEffect(() => {
    if (messages.length === 0) setConfirmClear(false)
  }, [messages.length])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingText, open])

  useEffect(() => {
    try {
      localStorage.setItem(CHAT_MODEL_STORAGE_KEY, model)
    } catch {
      /* ignore */
    }
  }, [model])

  useEffect(() => {
    const syncModel = (event: StorageEvent) => {
      if (event.key === CHAT_MODEL_STORAGE_KEY && event.newValue) setModel(event.newValue)
    }
    window.addEventListener('storage', syncModel)
    return () => window.removeEventListener('storage', syncModel)
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && open) {
        const target = event.target as HTMLElement | null
        if (target === inputRef.current || !target?.closest?.('input, textarea, [contenteditable="true"]')) {
          event.preventDefault()
          onOpenChange(false)
        }
        return
      }
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'l') return
      if (event.shiftKey) return
      event.preventDefault()
      if (!open) {
        onOpenChange(true)
        return
      }
      // Panel already open: focus composer (Cursor Ctrl+L behavior).
      inputRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onOpenChange])

  function stop() {
    abortRef.current?.abort()
    abortRef.current = null
    setBusy(false)
    setStreamingText(null)
  }

  async function send(textOverride?: string) {
    const text = (textOverride ?? draft).trim()
    if (!text || !projectId || busy) return
    if (mode === 'agent') {
      setError('Agent mode (writes) is coming next. Stay in Ask for now.')
      return
    }
    stop()
    const ac = new AbortController()
    abortRef.current = ac
    setBusy(true)
    setError(null)
    setDraft('')
    if (inputRef.current) inputRef.current.style.height = 'auto'

    const optimisticId = -Date.now()
    const optimistic: ChatMessageDto = {
      id: optimisticId,
      threadId: 0,
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, optimistic])
    setStreamingText('')

    let streamTurnId = ''
    let replacedUser = false
    let gotDone = false
    let localStream = ''

    try {
      await streamProjectChatMessage(
        projectId,
        { text, mode: 'ask', model, currentStep },
        {
          onUser: (msg, turnId) => {
            streamTurnId = turnId
            replacedUser = true
            setMessages((prev) => {
              const withoutOptimistic = prev.filter((m) => m.id !== optimisticId)
              return [...withoutOptimistic, msg]
            })
          },
          onAssistantStart: (turnId) => {
            streamTurnId = turnId || streamTurnId
            localStream = ''
            setStreamingText('')
          },
          onToken: (chunk) => {
            localStream += chunk
            setStreamingText(localStream)
          },
          onDone: (message, turnId) => {
            gotDone = true
            streamTurnId = turnId || streamTurnId
            setStreamingText(null)
            setMessages((prev) => {
              const withoutOptimistic = prev.filter((m) => m.id !== optimisticId)
              return [...withoutOptimistic.filter((m) => m.id !== message.id), message]
            })
          },
          onError: (message) => {
            if (!gotDone) setError(message)
          },
        },
        ac.signal,
      )
      // If the socket closed after tokens but before message_done, keep what we have.
      if (!gotDone && localStream.trim() && !ac.signal.aborted) {
        setStreamingText(null)
        setMessages((prev) => [
          ...prev.filter((m) => m.id !== optimisticId),
          {
            id: Date.now(),
            threadId: 0,
            role: 'assistant',
            content: localStream,
            turnId: streamTurnId || null,
            createdAt: new Date().toISOString(),
          },
        ])
      } else if (ac.signal.aborted && localStream.trim()) {
        setStreamingText(null)
        setMessages((prev) => [
          ...prev.filter((m) => m.id !== optimisticId),
          {
            id: Date.now(),
            threadId: 0,
            role: 'assistant',
            content: localStream,
            turnId: streamTurnId || null,
            createdAt: new Date().toISOString(),
          },
        ])
      } else if (!gotDone) {
        setStreamingText(null)
      }
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') {
        setError(e instanceof Error ? e.message : 'Send failed')
        void load()
      }
      setStreamingText(null)
      if (!replacedUser) {
        setMessages((prev) => prev.filter((m) => m.id !== optimisticId))
      }
    } finally {
      setBusy(false)
      abortRef.current = null
      inputRef.current?.focus()
    }
  }

  async function clearChat() {
    if (!projectId || busy) return
    try {
      await clearProjectChat(projectId)
      setMessages([])
      setError(null)
      setStreamingText(null)
      setConfirmClear(false)
      inputRef.current?.focus()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not clear chat')
      setConfirmClear(false)
    }
  }

  async function copyMessage(msg: ChatMessageDto) {
    try {
      await navigator.clipboard.writeText(msg.content)
      setCopiedId(msg.id)
      window.setTimeout(() => setCopiedId((id) => (id === msg.id ? null : id)), 1500)
    } catch {
      /* ignore */
    }
  }

  function needsConnect(msg: ChatMessageDto): string | null {
    if (!msg.toolJson || typeof msg.toolJson !== 'object') return null
    const raw = msg.toolJson as { needsConnect?: string }
    return raw.needsConnect || null
  }

  function autoGrow() {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }

  if (!open) {
    return (
      <button
        type="button"
        className="chat-fab"
        onClick={() => onOpenChange(true)}
        title="Open Blink Chat (Ctrl+L)"
        aria-label="Open Blink Chat"
      >
        <MessageSquare size={18} />
      </button>
    )
  }

  return (
    <aside className="chat-panel" aria-label="Blink Chat">
      <header className="chat-panel-head">
        <div className="chat-panel-title">
          <span className="chat-panel-icon" aria-hidden="true">
            <MessageSquare size={15} />
          </span>
          <strong>Blink Chat</strong>
        </div>
        <div className="chat-panel-actions">
          {projectId && messages.length > 0 && !confirmClear ? (
            <button
              type="button"
              className="ghost-btn chat-text-btn"
              onClick={() => setConfirmClear(true)}
              disabled={busy}
              title="Clear this conversation"
            >
              <Trash2 size={13} />
              Clear
            </button>
          ) : null}
          {confirmClear ? (
            <div className="chat-clear-confirm" role="group" aria-label="Confirm clear chat">
              <span>Clear chat?</span>
              <button type="button" className="ghost-btn chat-text-btn" onClick={() => setConfirmClear(false)} disabled={busy}>
                Cancel
              </button>
              <button type="button" className="ghost-btn chat-text-btn is-danger" onClick={() => void clearChat()} disabled={busy}>
                Clear
              </button>
            </div>
          ) : null}
          <button type="button" className="ghost-btn chat-icon-btn" onClick={() => onOpenChange(false)} aria-label="Close chat" title="Close (Ctrl+L)">
            <X size={16} />
          </button>
        </div>
      </header>

      <div className="chat-context-bar" title="Current wizard context sent with each message">
        <span className="chat-context-chip">{contextLabel}</span>
        {projectId ? <span className="chat-context-meta">Project attached</span> : <span className="chat-context-meta warn">Save project to chat</span>}
      </div>

      {!projectId ? (
        <div className="chat-empty">
          <h3>Save the project first</h3>
          <p>Chat needs a Blink project so it can load stakeholders, integrations, and step context.</p>
        </div>
      ) : (
        <>
          <div className="chat-messages">
            {messages.length === 0 && !streamingText ? (
              <div className="chat-empty">
                <h3>Blink Chat</h3>
                <p>Ask about this step, integrations, or what to do next. Context updates as you move through the wizard.</p>
                <div className="chat-suggestions">
                  {suggestions.map((s) => (
                    <button key={s} type="button" className="chat-suggestion" onClick={() => void send(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {messages.map((m) => {
              const connect = needsConnect(m)
              return (
                <article key={`${m.id}-${m.createdAt}`} className={`chat-msg ${m.role}`}>
                  <div className="chat-msg-role">{m.role === 'user' ? 'You' : 'Blink'}</div>
                  <div className="chat-msg-body">
                    {m.role === 'assistant' ? <ChatMarkdown text={m.content} /> : m.content}
                  </div>
                  {m.role === 'assistant' && m.content ? (
                    <div className="chat-msg-actions">
                      <button type="button" className="ghost-btn chat-mini-btn" onClick={() => void copyMessage(m)} title="Copy">
                        {copiedId === m.id ? <Check size={12} /> : <Copy size={12} />}
                        {copiedId === m.id ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  ) : null}
                  {connect ? (
                    <button type="button" className="secondary-btn chat-connect-btn" onClick={() => onNavigate('integrations')}>
                      Connect {connect}
                    </button>
                  ) : null}
                </article>
              )
            })}
            {streamingText !== null ? (
              <article className="chat-msg assistant">
                <div className="chat-msg-role">Blink</div>
                <div className={`chat-msg-body is-streaming`}>
                  <ChatMarkdown text={streamingText} />
                  <span className="chat-caret" aria-hidden />
                </div>
              </article>
            ) : null}
            <div ref={bottomRef} />
          </div>

          {error ? <p className="chat-error">{error}</p> : null}
          {busy ? <p className="chat-status">Generating…</p> : null}

          <div className="chat-composer-wrap">
            <div className="chat-composer-box">
              <textarea
                ref={inputRef}
                rows={1}
                placeholder="Ask about this step… (Enter to send, Shift+Enter for newline)"
                value={draft}
                disabled={!projectId}
                onChange={(e) => {
                  setDraft(e.target.value)
                  autoGrow()
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void send()
                  }
                }}
              />
              <div className="chat-composer-toolbar">
                <div className="chat-toolbar-left">
                  <div className="chat-mode-toggle" role="group" aria-label="Chat mode">
                    <button
                      type="button"
                      className={mode === 'ask' ? 'active' : ''}
                      onClick={() => setMode('ask')}
                      disabled={busy}
                    >
                      Ask
                    </button>
                    <button
                      type="button"
                      className={mode === 'agent' ? 'active' : ''}
                      onClick={() => setMode('agent')}
                      disabled={busy}
                      title="Agent writes (Jira/GitHub/Figma) — coming soon"
                    >
                      Agent
                    </button>
                  </div>
                  <label className="chat-model-select">
                    <span className="sr-only">Model</span>
                    <select
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      disabled={busy}
                      title="Model"
                    >
                      {CHAT_MODELS.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label} · {m.hint}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={12} aria-hidden />
                  </label>
                </div>
                {busy ? (
                  <button type="button" className="chat-send-btn is-stop" onClick={stop} title="Stop">
                    <Square size={12} fill="currentColor" />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="chat-send-btn"
                    disabled={!draft.trim() || !projectId}
                    onClick={() => void send()}
                    title="Send"
                  >
                    <ArrowUp size={16} strokeWidth={2.4} />
                  </button>
                )}
              </div>
            </div>
            <p className="chat-composer-hint">Ask is read-only. Agent (writes) lands next. Ctrl+L toggles chat.</p>
          </div>
        </>
      )}
    </aside>
  )
}

export function useChatPanelOpen(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(OPEN_KEY) === '1'
    } catch {
      return false
    }
  })
  const set = useCallback((next: boolean) => {
    setOpen(next)
    try {
      localStorage.setItem(OPEN_KEY, next ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [])
  return [open, set]
}

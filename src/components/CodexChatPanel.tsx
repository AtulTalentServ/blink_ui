import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ImagePlus, Loader2, Paperclip, Send, Square, User, X } from 'lucide-react'
import type { CodexAttachment, CodexWorkbenchTurn } from '../api/blink'
import type { CodexConsoleEvent } from './CodexAgentConsole'
import { BlinkLogo } from './BlinkLogo'
import { CodexMarkdown } from './CodexMarkdown'

export const CODEX_MODELS = [
  { id: 'gpt-6-luna', label: 'GPT-6 Luna' },
  { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' },
  { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' },
  { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
]

export type ChatSend = { text: string; attachments: CodexAttachment[] }

type Queued = ChatSend & { id: string }

type Props = {
  storyId?: string
  title?: string
  projectName?: string
  branch?: string
  prUrl?: string
  acceptance?: string[]
  busy: boolean
  canRun: boolean
  hasSession: boolean
  turns: CodexWorkbenchTurn[]
  additions?: number
  deletions?: number
  liveEvents: CodexConsoleEvent[]
  liveOutput: string
  livePhase: string
  files: Array<{ path: string }>
  model: string
  onModel: (model: string) => void
  onImplement: (send: ChatSend) => void
  onFollowUp: (send: ChatSend) => void
  onSteer: (send: ChatSend) => void
  onStop: () => void
  onOpenFile: (path: string) => void
  onViewDiff: () => void
}

function statusLabel(status: string): string {
  if (status === 'running' || status === 'provisioning' || status === 'connected') return 'Running'
  if (status === 'cancelled') return 'Cancelled'
  if (status === 'failed') return 'Failed'
  if (status === 'completed' || status === 'ok') return 'Completed'
  return status || 'Idle'
}

export function CodexChatPanel({
  storyId,
  title,
  projectName,
  branch,
  prUrl,
  acceptance,
  busy,
  canRun,
  hasSession,
  turns,
  additions,
  deletions,
  liveEvents,
  liveOutput,
  livePhase,
  files,
  model,
  onModel,
  onImplement,
  onFollowUp,
  onSteer,
  onStop,
  onOpenFile,
  onViewDiff,
}: Props) {
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<CodexAttachment[]>([])
  const [queue, setQueue] = useState<Queued[]>([])
  const [mention, setMention] = useState('')
  const [acOpen, setAcOpen] = useState(false)
  const wasBusy = useRef(false)
  const threadRef = useRef<HTMLDivElement>(null)

  const mentionQuery = mention.replace(/^@/, '').toLowerCase()
  const mentionHits = useMemo(() => {
    if (!mention.startsWith('@')) return []
    return files.filter((f) => f.path.toLowerCase().includes(mentionQuery)).slice(0, 8)
  }, [files, mention, mentionQuery])

  const liveActivity = liveEvents.filter((ev) => ev.kind === 'activity' || ev.kind === 'command' || ev.kind === 'status')

  useEffect(() => {
    if (wasBusy.current && !busy && queue.length) {
      const next = queue[0]
      setQueue((q) => q.slice(1))
      onFollowUp({ text: next.text, attachments: next.attachments })
    }
    wasBusy.current = busy
  }, [busy, onFollowUp, queue])

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight })
  }, [turns.length, liveOutput, busy])

  const addFiles = async (list: FileList | null) => {
    if (!list) return
    const next: CodexAttachment[] = []
    for (const file of Array.from(list)) {
      if (file.type.startsWith('image/')) {
        const dataUrl = await readDataUrl(file)
        next.push({ name: file.name, kind: 'image', dataUrl })
      } else {
        const content = await file.text()
        next.push({ name: file.name, kind: 'file', content, path: file.name })
      }
    }
    setAttachments((prev) => [...prev, ...next])
  }

  const send = () => {
    const payload = { text: text.trim(), attachments }
    if (!payload.text && payload.attachments.length === 0) {
      onImplement(payload)
      return
    }
    if (busy) {
      setQueue((q) => [...q, { ...payload, id: `${Date.now()}` }])
      setText('')
      setAttachments([])
      return
    }
    if (hasSession) onFollowUp(payload)
    else onImplement(payload)
    setText('')
    setAttachments([])
    setMention('')
  }

  return (
    <section className="codex-chat">
      <header className="codex-chat__story">
        <div>
          <p className="codex-chat__kicker">{projectName || storyId || 'Story'}</p>
          <h3>{title || 'Select a story'}</h3>
          <p className="codex-chat__meta">
            {storyId}
            {branch ? <span>· {branch}</span> : null}
            <span className={`codex-pill ${busy ? 'is-running' : hasSession ? 'is-drafted' : 'is-pending'}`}>
              {busy ? 'Running' : hasSession ? 'Drafted' : 'Pending'}
            </span>
          </p>
        </div>
        <div className="codex-chat__actions">
          {prUrl ? <a className="codex-btn" href={prUrl} target="_blank" rel="noreferrer">View PR</a> : null}
          <button type="button" className="codex-btn codex-btn--ghost" disabled={!canRun || busy || !storyId} onClick={() => onImplement({ text: text.trim(), attachments })}>
            {busy ? <Loader2 className="spin" size={14} /> : null}
            {hasSession ? 'Re-run' : 'Implement'}
          </button>
        </div>
      </header>
      {acceptance?.length ? (
        <div className="codex-chat__ac">
          <button type="button" className="codex-disclosure" onClick={() => setAcOpen((v) => !v)}>
            <span className="codex-chevron" aria-hidden>{acOpen ? '▾' : '▸'}</span>
            Acceptance criteria
            <span className="codex-activity__count">{acceptance.length}</span>
          </button>
          {acOpen ? <ul>{acceptance.map((item) => <li key={item}>{item}</li>)}</ul> : null}
        </div>
      ) : null}
      <div className="codex-chat__thread" ref={threadRef}>
        {turns.map((turn, index) => {
          if (
            busy
            && (turn.status === 'running' || turn.status === 'provisioning')
            && !(turn.markdown || '').trim()
            && !(turn.activity || []).length
            && Object.keys(turn.files || {}).length === 0
          ) return null
          const answer = presentAnswer(turn.markdown || '')
          const steps = realSteps(turn, answer.files)
          const fileCount = Object.keys(turn.files || {}).length || answer.files.length
          const isLast = index === turns.length - 1
          return (
            <article key={turn.id} className="codex-turn">
              <div className="codex-user-bubble">
                <span className="codex-avatar" aria-hidden><User size={14} /></span>
                <div>
                  <p>{friendlyPrompt(turn.prompt || '')}</p>
                  <AttachmentRow items={turn.attachments || []} onOpenFile={onOpenFile} />
                </div>
              </div>
              <div className="codex-agent-card">
                <header>
                  <BlinkLogo size="sm" />
                  <strong>Blink Agent</strong>
                  <span className={`codex-pill is-${statusLabel(turn.status).toLowerCase()}`}>{statusLabel(turn.status)}</span>
                </header>
                {steps.length ? (
                  <ul className="codex-steps">
                    {steps.map((step) => (
                      <li key={step}>
                        <Check size={14} />
                        <span>{step}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {answer.prose ? (
                  <div className="codex-agent-reply">
                    <CodexMarkdown text={answer.prose} onOpenFile={onOpenFile} />
                  </div>
                ) : null}
                {fileCount > 0 ? (
                  <div className="codex-done">
                    <strong>Turn completed</strong>
                    <span>
                      {fileCount} {fileCount === 1 ? 'file' : 'files'} changed
                      {isLast && (additions || deletions) ? <> <span className="codex-diff__stat is-add">+{additions || 0}</span> <span className="codex-diff__stat is-del">−{deletions || 0}</span></> : null}
                    </span>
                    <button type="button" className="codex-btn codex-btn--ghost" onClick={onViewDiff}>View diff</button>
                  </div>
                ) : null}
              </div>
            </article>
          )
        })}
        {busy ? (
          <article className="codex-turn">
            <div className="codex-agent-card">
              <header>
                <BlinkLogo size="sm" />
                <strong>Blink Agent</strong>
                <span className="codex-pill is-running">{statusLabel(livePhase || 'running')}</span>
              </header>
              <ul className="codex-steps">
                {realStepsFromLines(liveActivity.map((ev) => ev.text)).map((step) => (
                  <li key={step}><Check size={14} /><span>{step}</span></li>
                ))}
                {realStepsFromLines(liveActivity.map((ev) => ev.text)).length === 0 ? <li><Loader2 className="spin" size={14} /><span>Waiting for the sandbox</span></li> : null}
              </ul>
              {liveOutput ? <div className="codex-agent-reply"><CodexMarkdown text={liveOutput} onOpenFile={onOpenFile} /></div> : null}
            </div>
          </article>
        ) : null}
      </div>
      {queue.length ? (
        <ul className="codex-queue">
          {queue.map((item) => (
            <li key={item.id}>
              <span>{item.text || 'Attachment'}</span>
              <button type="button" className="codex-btn" onClick={() => { setText(item.text); setAttachments(item.attachments); setQueue((q) => q.filter((row) => row.id !== item.id)) }}>Edit</button>
              <button type="button" className="codex-btn" onClick={() => setQueue((q) => q.filter((row) => row.id !== item.id))}>Remove</button>
              <button type="button" className="codex-btn" onClick={() => { setQueue((q) => q.filter((row) => row.id !== item.id)); onSteer(item) }}>Send now</button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="codex-composer">
        {attachments.length ? (
          <div className="codex-composer__files">
            {attachments.map((item, index) => (
              <span key={`${item.name}-${index}`} className="codex-file-chip">
                {item.kind === 'image' && item.dataUrl ? <img src={item.dataUrl} alt="" /> : null}
                {item.name}
                <button type="button" className="codex-chip-x" aria-label="Remove" onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== index))}><X size={12} /></button>
              </span>
            ))}
          </div>
        ) : null}
        {mentionHits.length ? (
          <ul className="codex-mention">
            {mentionHits.map((file) => (
              <li key={file.path}>
                <button type="button" className="codex-mention__item" onClick={() => {
                  setText((prev) => prev.replace(/@[\w./-]*$/, `@${file.path} `))
                  setAttachments((prev) => [...prev, { name: file.path, path: file.path, kind: 'file_ref' }])
                  setMention('')
                }}>{file.path}</button>
              </li>
            ))}
          </ul>
        ) : null}
        <textarea
          value={text}
          placeholder={busy ? 'Queue a follow-up, or steer the running turn' : 'Ask Blink to make changes…'}
          onChange={(e) => {
            setText(e.target.value)
            const match = e.target.value.match(/@[\w./-]*$/)
            setMention(match ? match[0] : '')
          }}
          onPaste={(e) => {
            const image = Array.from(e.clipboardData.items).find((item) => item.type.startsWith('image/'))
            const file = image?.getAsFile()
            if (!file) return
            e.preventDefault()
            void readDataUrl(file).then((dataUrl) => setAttachments((prev) => [...prev, { name: 'screenshot.png', kind: 'image', dataUrl }]))
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              send()
            }
          }}
        />
        <div className="codex-composer__bar">
          <label className="codex-icon-btn">
            <Paperclip size={15} />
            <input type="file" multiple hidden onChange={(e) => { void addFiles(e.target.files); e.target.value = '' }} />
          </label>
          <label className="codex-icon-btn">
            <ImagePlus size={15} />
            <input type="file" accept="image/*" hidden onChange={(e) => { void addFiles(e.target.files); e.target.value = '' }} />
          </label>
          <button type="button" className="codex-icon-btn" title="Reference a file" onClick={() => { setText((prev) => `${prev}@`); setMention('@') }}>@</button>
          <span className="codex-composer__spacer" />
          <select className="codex-select" value={model} onChange={(e) => onModel(e.target.value)} aria-label="Model">
            {CODEX_MODELS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
          {busy ? (
            <>
              <button type="button" className="codex-btn" onClick={onStop}><Square size={13} /> Stop</button>
              <button type="button" className="codex-btn" disabled={!text.trim() && attachments.length === 0} onClick={() => { onSteer({ text: text.trim(), attachments }); setText(''); setAttachments([]) }}>Steer</button>
              <button type="button" className="codex-btn codex-btn--primary" disabled={!text.trim() && attachments.length === 0} onClick={send}>Queue</button>
            </>
          ) : (
            <button type="button" className="codex-btn codex-btn--primary codex-send" disabled={!canRun} onClick={send} aria-label={hasSession ? 'Send' : 'Implement'}>
              <Send size={14} />
            </button>
          )}
        </div>
      </div>
    </section>
  )
}

function realSteps(turn: CodexWorkbenchTurn, reportedFiles: string[]): string[] {
  const stored = Object.keys(turn.files || {})
  const files = (stored.length ? stored : reportedFiles).slice(0, 4).map((path) => `Updated ${path}`)
  const lines = (turn.activity || []).map((item) => item.text || '')
  return uniqueSteps([...realStepsFromLines(lines).slice(0, 4), ...files])
}

function presentAnswer(markdown: string): { prose: string; files: string[] } {
  const marker = markdown.indexOf('"filesChanged"')
  if (marker < 0) return { prose: markdown, files: [] }
  const start = markdown.lastIndexOf('{', marker)
  if (start < 0) return { prose: markdown, files: [] }
  let depth = 0
  let end = -1
  for (let i = start; i < markdown.length; i += 1) {
    if (markdown[i] === '{') depth += 1
    else if (markdown[i] === '}') {
      depth -= 1
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  if (end < 0) return { prose: markdown, files: [] }
  try {
    const parsed = JSON.parse(markdown.slice(start, end + 1)) as { summary?: unknown; filesChanged?: unknown }
    const files = Array.isArray(parsed.filesChanged) ? parsed.filesChanged.filter((item): item is string => typeof item === 'string') : []
    const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : ''
    const prose = `${markdown.slice(0, start).trim()}${summary ? `\n\n${summary}` : ''}`.trim()
    return { prose, files }
  } catch {
    return { prose: markdown, files: [] }
  }
}

function realStepsFromLines(lines: string[]): string[] {
  const steps: string[] = []
  for (const raw of lines) {
    const step = stepText(raw)
    if (step) steps.push(step)
  }
  return uniqueSteps(steps).slice(-8)
}

function stepText(raw: string): string | null {
  const line = raw.trim()
  if (!line || line.length > 180) return null
  if (/^(warning|requirement already|# |error:|note:|make:)/i.test(line)) return null
  if (/\*\*\*|traceback|error \d/i.test(line)) return null
  if (/^phase:\s*/i.test(line)) {
    const phase = line.replace(/^phase:\s*/i, '').split('—')[0].trim()
    if (!phase || phase === 'running' || phase === 'idle') return null
    return phase.replace(/_/g, ' ')
  }
  return line.replace(/["']/g, '').trim() || null
}

function uniqueSteps(steps: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const step of steps) {
    if (seen.has(step)) continue
    seen.add(step)
    out.push(step)
  }
  return out
}

function friendlyPrompt(prompt: string): string {
  const match = prompt.match(/^Implement the approved plan step for issue (\S+?)\./)
  if (match) return `Implement ${match[1].replace(/\.$/, '')}`
  return prompt
}

function AttachmentRow({ items, onOpenFile }: { items: CodexAttachment[]; onOpenFile: (path: string) => void }) {
  if (!items.length) return null
  return (
    <div className="codex-composer__files">
      {items.map((item, index) => (
        item.kind === 'image' && item.dataUrl
          ? <img key={index} className="codex-thumb" src={item.dataUrl} alt={item.name} />
          : (
            <button key={index} type="button" className="codex-file-chip" onClick={() => item.path && onOpenFile(item.path)}>
              {item.name || item.path}
            </button>
          )
      ))}
    </div>
  )
}

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

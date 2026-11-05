import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Folder } from 'lucide-react'
import type { CodexFileDiff } from '../api/blink'

export type LineComment = { id: string; path: string; line: number; text: string; snippet: string }

type Props = {
  diffs: CodexFileDiff[]
  additions: number
  deletions: number
  scope: string
  commits: Array<{ sha: string; message: string }>
  scopeNote?: string
  stagedPaths?: string[]
  onScope: (scope: string, commitSha?: string) => void
  onGit: (action: string, path?: string, hunkIndex?: number) => void
  onSendComments: (comments: LineComment[]) => void
}

export function CodexDiffViewer({ diffs, additions, deletions, scope, commits, scopeNote, stagedPaths = [], onScope, onGit, onSendComments }: Props) {
  const [split, setSplit] = useState(false)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [cursor, setCursor] = useState(0)
  const [draft, setDraft] = useState<{ path: string; line: number; snippet: string } | null>(null)
  const [draftText, setDraftText] = useState('')
  const [comments, setComments] = useState<LineComment[]>([])
  const [commitSha, setCommitSha] = useState(commits[0]?.sha || '')
  const [selected, setSelected] = useState('')
  const staged = useMemo(() => new Set(scope === 'staged' ? diffs.map((file) => file.path) : stagedPaths), [diffs, scope, stagedPaths])

  useEffect(() => {
    if (!diffs.some((file) => file.path === selected)) setSelected(diffs[0]?.path || '')
  }, [diffs, selected])

  const changes = useMemo(() => {
    const rows: Array<{ path: string; hunk: number; line: number }> = []
    diffs.forEach((file) => file.hunks.forEach((hunk) => hunk.lines.forEach((line, index) => {
      if (line.kind !== 'context') rows.push({ path: file.path, hunk: hunk.index, line: index })
    })))
    return rows
  }, [diffs])

  const jump = (dir: 1 | -1) => {
    if (!changes.length) return
    const next = (cursor + dir + changes.length) % changes.length
    setCursor(next)
    const hit = changes[next]
    setSelected(hit.path)
    setOpen((prev) => ({ ...prev, [hit.path]: true }))
    window.setTimeout(() => {
      document.getElementById(`diff-${hit.path}-${hit.hunk}-${hit.line}`)?.scrollIntoView({ block: 'center' })
    }, 0)
  }

  const fileCount = `${diffs.length} ${diffs.length === 1 ? 'file' : 'files'}`

  return (
    <div className="codex-diff">
      <div className="codex-diff__toolbar">
        <span className="codex-diff__stat is-add">+{additions}</span>
        <span className="codex-diff__stat is-del">−{deletions}</span>
        <span className="codex-diff__count">· {diffs.length === 0 ? '0 files' : fileCount}</span>
        <span className="codex-diff__spacer" />
        <select className="codex-diff__scope" value={scope} aria-label="Change scope" onChange={(e) => onScope(e.target.value, e.target.value === 'commit' ? commitSha : undefined)}>
          <option value="last_turn">Last turn</option>
          <option value="uncommitted">Uncommitted</option>
          <option value="staged">Staged</option>
          <option value="branch">Branch</option>
          <option value="commit">Commit</option>
        </select>
        {diffs.length > 0 ? (
          <>
            <div className="codex-seg" role="group" aria-label="Diff layout">
              <button type="button" className={!split ? 'is-active' : ''} onClick={() => setSplit(false)}>Inline</button>
              <button type="button" className={split ? 'is-active' : ''} onClick={() => setSplit(true)}>Split</button>
            </div>
            <button type="button" className="codex-nav-btn" aria-label="Previous change" onClick={() => jump(-1)}><ChevronLeft size={14} /></button>
            <button type="button" className="codex-nav-btn" aria-label="Next change" onClick={() => jump(1)}><ChevronRight size={14} /></button>
          </>
        ) : null}
      </div>
      {scope === 'commit' ? (
        <select className="codex-select" value={commitSha} aria-label="Commit" onChange={(e) => { setCommitSha(e.target.value); onScope('commit', e.target.value) }}>
          {commits.map((c) => <option key={c.sha} value={c.sha}>{c.sha.slice(0, 7)} {c.message}</option>)}
        </select>
      ) : null}
      {diffs.length > 0 ? (
        <div className="codex-diff__actions">
          <button type="button" className="codex-btn" onClick={() => onGit('stage_all')}>Stage all</button>
          <button type="button" className="codex-btn" onClick={() => onGit('unstage_all')}>Unstage all</button>
          <button type="button" className="codex-btn" onClick={() => onGit('revert_all')}>Revert all</button>
          <span className="codex-diff__spacer" />
          <button type="button" className="codex-btn codex-btn--primary" onClick={() => onGit('commit_staged')}>Commit staged</button>
        </div>
      ) : null}
      {scopeNote ? <p className="codex-empty">{scopeNote}</p> : null}
      {diffs.length === 0 ? (
        <div className="codex-empty-state">
          <p>No changes in this scope.</p>
          <span>Files the agent writes show up here, with additions and deletions.</span>
        </div>
      ) : (
        <DiffFileList
          diffs={diffs}
          selected={selected}
          staged={staged}
          onSelect={setSelected}
          onToggleStage={(path) => onGit(staged.has(path) ? 'unstage' : 'stage', path)}
        />
      )}
      {diffs.filter((file) => file.path === selected).map((file) => {
        const expanded = open[file.path] !== false
        return (
          <article key={file.path} className="codex-diff-file">
            <header>
              <LangBadge path={file.path} />
              <button type="button" className="codex-diff-file__path" onClick={() => setOpen((prev) => ({ ...prev, [file.path]: !expanded }))}>
                {file.path.split('/').pop()}
              </button>
              <span className="codex-diff__stat is-add">+{file.additions}</span>
              <span className="codex-diff__stat is-del">−{file.deletions}</span>
              <button type="button" className="codex-nav-btn" aria-label={expanded ? 'Collapse diff' : 'Expand diff'} onClick={() => setOpen((prev) => ({ ...prev, [file.path]: !expanded }))}>
                {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
            </header>
            {expanded ? file.hunks.map((hunk) => (
              <div key={hunk.index} className="codex-hunk">
                <div className="codex-hunk__head">
                  <code>{hunk.header}</code>
                  <span className="codex-hunk__actions">
                    <button type="button" className="codex-btn" onClick={() => onGit('stage', file.path, hunk.index)}>Stage</button>
                    <button type="button" className="codex-btn" onClick={() => onGit('unstage', file.path, hunk.index)}>Unstage</button>
                    <button type="button" className="codex-btn" onClick={() => onGit('revert', file.path, hunk.index)}>Revert</button>
                  </span>
                </div>
                {split ? (
                  <div className="codex-split">
                    <pre>{hunk.lines.filter((l) => l.kind !== 'add').map((l) => l.text).join('\n')}</pre>
                    <pre>{hunk.lines.filter((l) => l.kind !== 'del').map((l) => l.text).join('\n')}</pre>
                  </div>
                ) : (
                  <ol>
                    {hunk.lines.map((line, index) => (
                      <li
                        id={`diff-${file.path}-${hunk.index}-${index}`}
                        key={index}
                        className={`codex-diff-line is-${line.kind}`}
                        onClick={() => { setDraft({ path: file.path, line: line.newNo || line.oldNo || index + 1, snippet: line.text }); setDraftText('') }}
                      >
                        <span className="codex-diff-line__no">{line.kind === 'del' ? line.oldNo || '' : line.newNo || ''}</span>
                        <span className="codex-diff-line__mark">{line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ''}</span>
                        <code>{line.text}</code>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )) : null}
          </article>
        )
      })}
      {draft ? (
        <form className="codex-line-comment" onSubmit={(e) => {
          e.preventDefault()
          if (!draftText.trim()) return
          setComments((prev) => [...prev, { id: `${Date.now()}`, path: draft.path, line: draft.line, text: draftText.trim(), snippet: draft.snippet }])
          setDraft(null)
        }}>
          <p>{draft.path}:{draft.line}</p>
          <textarea value={draftText} onChange={(e) => setDraftText(e.target.value)} placeholder="Comment on this line" />
          <button type="submit" className="codex-btn codex-btn--primary">Save comment</button>
        </form>
      ) : null}
      {comments.length ? (
        <div className="codex-line-comment__bar">
          <span>{comments.length} line comments</span>
          <button type="button" className="codex-btn codex-btn--primary" onClick={() => { onSendComments(comments); setComments([]) }}>
            Send {comments.length} line comments to Agent
          </button>
        </div>
      ) : null}
    </div>
  )
}

function DiffFileList({
  diffs,
  selected,
  staged,
  onSelect,
  onToggleStage,
}: {
  diffs: CodexFileDiff[]
  selected: string
  staged: Set<string>
  onSelect: (path: string) => void
  onToggleStage: (path: string) => void
}) {
  const groups = useMemo(() => {
    const folders: Record<string, CodexFileDiff[]> = {}
    for (const file of diffs) {
      const slash = file.path.lastIndexOf('/')
      const folder = slash >= 0 ? file.path.slice(0, slash) : ''
      folders[folder] = folders[folder] || []
      folders[folder].push(file)
    }
    return Object.entries(folders)
  }, [diffs])
  const [closed, setClosed] = useState<Record<string, boolean>>({})
  return (
    <div className="codex-change-list">
      {groups.map(([folder, files]) => {
        const hidden = Boolean(folder && closed[folder])
        return (
          <section key={folder || 'root'}>
            {folder ? (
              <button type="button" className="codex-change-folder" onClick={() => setClosed((prev) => ({ ...prev, [folder]: !prev[folder] }))}>
                {hidden ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                <Folder size={14} />
                <span>{folder}</span>
              </button>
            ) : null}
            {hidden ? null : (
              <ul>
                {files.map((file) => {
                  const on = staged.has(file.path)
                  return (
                    <li key={file.path} className={selected === file.path ? 'is-active' : ''}>
                      <button type="button" className="codex-change-row" onClick={() => onSelect(file.path)}>
                        <LangBadge path={file.path} />
                        <span className="codex-change-row__name">{file.path.split('/').pop()}</span>
                        <span className="codex-diff__stat is-add">+{file.additions}</span>
                        <span className="codex-diff__stat is-del">−{file.deletions}</span>
                      </button>
                      <button
                        type="button"
                        className={`codex-check${on ? ' is-on' : ''}`}
                        aria-pressed={on}
                        aria-label={on ? `Unstage ${file.path}` : `Stage ${file.path}`}
                        onClick={() => onToggleStage(file.path)}
                      >
                        {on ? <Check size={11} strokeWidth={3} /> : null}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        )
      })}
    </div>
  )
}

function LangBadge({ path }: { path: string }) {
  return <span className="codex-lang" aria-hidden>{langBadge(path)}</span>
}

function langBadge(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || ''
  const known: Record<string, string> = {
    ts: 'TS', tsx: 'TS', js: 'JS', jsx: 'JS', css: 'CSS', scss: 'CSS',
    json: 'JSON', md: 'MD', go: 'GO', py: 'PY', html: 'HTML', sql: 'SQL',
  }
  return known[ext] || (ext ? ext.slice(0, 4).toUpperCase() : 'FILE')
}

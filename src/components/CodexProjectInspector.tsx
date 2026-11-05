import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { fetchCodexFile, type CodexWorkbench, type CodexWorkbenchFile } from '../api/blink'
import type { CodexConsoleState } from './CodexAgentConsole'
import { CodexDiffViewer, type LineComment } from './CodexDiffViewer'
import { CodexMarkdown } from './CodexMarkdown'

type Tab = 'changes' | 'files' | 'terminal' | 'git'

type Props = {
  projectId?: string | null
  issueId?: string
  prUrls: string[]
  workbench: CodexWorkbench | null
  scope: string
  consoleState: CodexConsoleState
  openPath?: string
  tab: Tab
  onTab: (tab: Tab) => void
  onScope: (scope: string, commitSha?: string) => void
  onGit: (action: string, path?: string, hunkIndex?: number) => void
  onSendComments: (comments: LineComment[]) => void
  onReference: (path: string) => void
  onContinue?: () => void
  onClose?: () => void
}

export function CodexProjectInspector(props: Props) {
  const files = props.workbench?.files || []
  const changed = (props.workbench?.diff || []).length
  return (
    <section className="codex-inspector">
      <header className="codex-inspector__head">
        <nav className="codex-tabs" aria-label="Project inspector">
          {(['changes', 'files', 'terminal', 'git'] as Tab[]).map((tab) => (
            <button key={tab} type="button" className={props.tab === tab ? 'is-active' : ''} onClick={() => props.onTab(tab)}>
              {tab === 'git' ? 'Git / PR' : tab[0].toUpperCase() + tab.slice(1)}
              {tab === 'changes' && changed ? <span className="codex-tab-count">{changed}</span> : null}
            </button>
          ))}
        </nav>
        {props.onClose ? <button type="button" className="codex-icon-btn" aria-label="Close inspector" onClick={props.onClose}><X size={16} /></button> : null}
      </header>
      <div className="codex-inspector__body">
        {props.tab === 'changes' ? (
          <CodexDiffViewer
            diffs={props.workbench?.diff || []}
            additions={props.workbench?.additions || 0}
            deletions={props.workbench?.deletions || 0}
            scope={props.scope}
            commits={props.workbench?.commits || []}
            scopeNote={props.workbench?.scopeNote}
            stagedPaths={props.workbench?.stagedPaths || []}
            onScope={props.onScope}
            onGit={props.onGit}
            onSendComments={props.onSendComments}
          />
        ) : null}
        {props.tab === 'files' ? (
          <FileBrowser
            projectId={props.projectId}
            issueId={props.issueId}
            files={files}
            openPath={props.openPath}
            onReference={props.onReference}
          />
        ) : null}
        {props.tab === 'terminal' ? (
          <pre className="codex-terminal">{props.consoleState.commands || 'No sandbox commands yet.'}</pre>
        ) : null}
        {props.tab === 'git' ? (
          <div className="codex-git">
            <p>Branch <code>{props.workbench?.branch || '—'}</code></p>
            {props.prUrls.map((url) => <p key={url}><a href={url} target="_blank" rel="noreferrer">{url}</a></p>)}
            <ul>
              {(props.workbench?.commits || []).map((c) => <li key={c.sha}><code>{c.sha.slice(0, 7)}</code> {c.message}</li>)}
            </ul>
            {props.onContinue ? <button type="button" className="codex-btn codex-btn--primary" onClick={props.onContinue}>Continue to Review & PR</button> : null}
          </div>
        ) : null}
      </div>
    </section>
  )
}

function FileBrowser({ projectId, issueId, files, openPath, onReference }: { projectId?: string | null; issueId?: string; files: CodexWorkbenchFile[]; openPath?: string; onReference: (path: string) => void }) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(openPath || '')
  const [content, setContent] = useState('')
  const shown = useMemo(() => files.filter((f) => f.path.toLowerCase().includes(query.toLowerCase())).slice(0, 200), [files, query])

  useEffect(() => {
    if (openPath) setSelected(openPath)
  }, [openPath])

  useEffect(() => {
    if (!projectId || !issueId || !selected) return
    let cancelled = false
    fetchCodexFile(projectId, issueId, selected).then((res) => {
      if (!cancelled) setContent(res.content || '')
    }).catch(() => {
      if (!cancelled) setContent('')
    })
    return () => { cancelled = true }
  }, [projectId, issueId, selected])

  const tree = useMemo(() => groupFiles(shown), [shown])

  return (
    <div className="codex-files">
      <div>
        <input className="codex-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search files" />
        <ul>
          {Object.entries(tree).map(([folder, rows]) => (
            <li key={folder}>
              <strong>{folder}</strong>
              <ul>
                {rows.map((file) => (
                  <li key={file.path}>
                    <button type="button" className={`codex-tree-btn${selected === file.path ? ' is-active' : ''}`} onClick={() => setSelected(file.path)}>
                      <span className={`codex-file-mark is-${file.status || 'clean'}`}>{(file.status || 'clean')[0].toUpperCase()}</span>
                      {file.path.split('/').pop()}
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <div className="codex-files__bar">
          <code>{selected || 'No file open'}</code>
          {selected ? <button type="button" className="codex-btn" onClick={() => onReference(selected)}>Reference in chat</button> : null}
        </div>
        {content ? <CodexMarkdown text={'```\n' + content + '\n```'} /> : <p className="muted">Open a file to view it.</p>}
      </div>
    </div>
  )
}

function groupFiles(files: CodexWorkbenchFile[]): Record<string, CodexWorkbenchFile[]> {
  const out: Record<string, CodexWorkbenchFile[]> = {}
  for (const file of files) {
    const parts = file.path.split('/')
    const folder = parts.length > 1 ? parts.slice(0, -1).join('/') : '.'
    out[folder] = out[folder] || []
    out[folder].push(file)
  }
  return out
}

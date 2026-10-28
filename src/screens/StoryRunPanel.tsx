import { useState } from 'react'
import { MonitorPlay } from 'lucide-react'
import { previewPullRequestApp } from '../api/blink'

interface PreviewPage {
  title: string
  previewHtml: string
  entryPath?: string
  pullRequest?: string
}

interface Props {
  projectId: string | null
  issueId?: string
  title?: string
  requirement: string
  pullRequests: string[]
}

export function StoryRunPanel({ projectId, title, pullRequests }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [pages, setPages] = useState<PreviewPage[]>([])
  const [active, setActive] = useState(0)

  const openPreview = async () => {
    if (!projectId) {
      setError('Save the project before opening the preview.')
      return
    }
    if (pullRequests.length === 0) {
      setPages([])
      setError('Run Implement first. Preview opens the application from the draft pull request.')
      return
    }
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const local = import.meta.env.DEV
        ? await fetch('/local-pr-preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pullRequests }),
          }).then(async (response) => {
            if (!response.ok) return null
            return response.json() as Promise<{
              status?: string
              message?: string
              previewHtml?: string
              entryPath?: string
              pullRequest?: string
              pages?: PreviewPage[]
            }>
          }).catch(() => null)
        : null
      const server = local?.status === 'ready'
        ? local
        : await previewPullRequestApp(projectId, pullRequests).catch((err: unknown) => {
            const message = err instanceof Error ? err.message : ''
            return { status: 'unavailable' as const, message, previewHtml: undefined, entryPath: undefined, pullRequest: undefined, pages: undefined as PreviewPage[] | undefined }
          })
      const page = server
      const opened = page.pages?.filter((item) => item.previewHtml) ?? []
      const readyPages = opened.length > 0
        ? opened
        : page.previewHtml
          ? [{ title: page.entryPath || 'Draft', previewHtml: page.previewHtml, entryPath: page.entryPath, pullRequest: page.pullRequest }]
          : []
      if (page.status === 'ready' && readyPages.length > 0) {
        setPages(readyPages)
        setActive(0)
        setMessage(page.message || 'This is the blink/implement-all branch. Nothing is merged.')
        return
      }
      setPages([])
      setError(page.message || server.message || 'Could not open the application from the pull request.')
    } catch (err) {
      setPages([])
      setError(err instanceof Error ? err.message : 'Could not open the application.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card story-run-card">
      <div className="story-run-head">
        <div>
          <p className="shape-kicker">Before merge</p>
          <h3>See the application before it merges</h3>
          <p className="muted">
            {title ? `${title}. ` : ''}
            This opens the draft application. Click through what will be there after merge. Nothing is installed or merged.
          </p>
        </div>
        <button type="button" className="primary-btn" onClick={() => void openPreview()} disabled={busy}>
          <MonitorPlay size={16} />
          {busy ? 'Opening…' : 'Preview story'}
        </button>
      </div>

      {error ? <p className="status-banner error">{error}</p> : null}
      {message && pages.length > 0 ? <p className="status-banner success">{message}</p> : null}
      {pages.length > 1 ? (
        <div className="story-run-tabs" role="tablist" aria-label="Implemented drafts">
          {pages.map((page, index) => (
            <button
              key={`${page.pullRequest}-${page.entryPath}`}
              type="button"
              role="tab"
              aria-selected={index === active}
              className={`story-run-tab${index === active ? ' is-active' : ''}`}
              onClick={() => setActive(index)}
            >
              {page.title}
            </button>
          ))}
        </div>
      ) : null}
      {pages[active] ? (
        <iframe
          className="story-run-frame"
          title={pages[active].title}
          sandbox="allow-scripts allow-forms allow-popups allow-modals"
          srcDoc={pages[active].previewHtml}
        />
      ) : null}
    </section>
  )
}

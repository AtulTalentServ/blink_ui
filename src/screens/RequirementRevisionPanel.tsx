import { useEffect, useState } from 'react'
import { fetchRequirementRevisionHistory } from '../api/blink'

const VIEWS = ['brd', 'prd', 'frd', 'source'] as const

type Revision = {
  id: number
  revisionNo: number
  viewKind: string
  contentDigest: string
  createdAt: string
}

export function RequirementRevisionPanel({ projectId }: { projectId?: string | null }) {
  const [view, setView] = useState<(typeof VIEWS)[number]>('source')
  const [revisions, setRevisions] = useState<Revision[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!projectId) {
      setRevisions([])
      return
    }
    let cancelled = false
    setLoading(true)
    void fetchRequirementRevisionHistory(projectId, view)
      .then((res) => {
        if (!cancelled) {
          setRevisions(res.revisions || [])
          setError(null)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setRevisions([])
          setError(err instanceof Error ? err.message : 'Could not load revision history.')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectId, view])

  if (!projectId) return null

  return (
    <section className="card ref-card req-revision-history">
      <div className="req-section-head">
        <h3>Requirement revisions</h3>
        <p>Canonical history for BRD, PRD, FRD, and source text (server-side dedupe).</p>
      </div>
      <div className="req-revision-tabs" role="tablist" aria-label="Requirement view">
        {VIEWS.map((kind) => (
          <button
            key={kind}
            type="button"
            role="tab"
            aria-selected={view === kind}
            className={view === kind ? 'active' : ''}
            onClick={() => setView(kind)}
          >
            {kind.toUpperCase()}
          </button>
        ))}
      </div>
      {loading ? <p className="muted small">Loading…</p> : null}
      {error ? <p className="groom-blocker-hint">{error}</p> : null}
      {!loading && !error && revisions.length === 0 ? (
        <p className="muted small">No revisions recorded for {view.toUpperCase()} yet.</p>
      ) : null}
      {revisions.length > 0 ? (
        <ul className="req-revision-list">
          {revisions.map((rev) => (
            <li key={rev.id}>
              <span className="mono">#{rev.revisionNo}</span>
              <span className="muted small">{new Date(rev.createdAt).toLocaleString()}</span>
              <code className="req-revision-digest">{rev.contentDigest.slice(0, 12)}…</code>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

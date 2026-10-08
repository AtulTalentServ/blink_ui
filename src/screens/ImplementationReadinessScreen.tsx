import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, Circle, Loader2, Play } from 'lucide-react'
import {
  fetchCanonicalSnapshot,
  fetchShipSession,
  implementStep,
  type DraftPullRequest,
  type ShipStepDto,
} from '../api/blink'
import { patchFromCanonicalSnapshot } from '../wizard/canonical'
import type { StorySummary, WizardState } from '../wizard/types'

interface Props {
  state: WizardState
  onUpdate: (patch: Partial<WizardState>) => void
  onContinueToReview?: () => void
}

interface StoryRow {
  id: string
  title: string
  hasDraft: boolean
  lastSummary?: string
  prCount: number
  /** GitHub draft PR URLs for this story (first one powers the Drafted badge). */
  prUrls: string[]
}

function requirementTextOf(state: WizardState): string {
  return (
    state.groomDraft?.trim()
    || state.requirementsText?.trim()
    || state.productScope?.markdown?.trim()
    || state.description?.trim()
    || ''
  )
}

function defaultIssueId(state: WizardState): string | undefined {
  return (
    state.sdlcStartIssueId
    || state.implementStep?.issueId
    || state.specification?.issueId
    || state.workClassification?.issueId
    || state.productScope?.storyIds?.[0]
    || state.productScope?.stories?.[0]?.id
    || undefined
  )
}

function storiesFromScope(state: WizardState): StorySummary[] {
  const scoped = state.productScope?.stories
  if (scoped?.length) return scoped
  const ids = state.productScope?.storyIds || []
  return ids.map((id) => ({ id, title: id }))
}

function shortStoryLabel(id: string): string {
  // Prefer E001-S001 over full FITNESSAPP-E001-S001 when the prefix is long.
  const parts = id.split('-')
  if (parts.length >= 3) return parts.slice(-2).join('-')
  return id
}

function cleanTitle(title: string, id: string): string {
  const t = (title || '').trim()
  if (!t || t === id) return 'Untitled story'
  return t.replace(/^Use\s+/i, '')
}

function payloadIssueId(step: ShipStepDto): string | null {
  const payload = step.payload
  if (!payload || typeof payload !== 'object') return null
  const rec = payload as Record<string, unknown>
  const issue = rec.issueId ?? rec.issueKey
  return typeof issue === 'string' && issue.trim() ? issue.trim() : null
}

function prUrlsFromUnknown(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const urls: string[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const url = String((item as { url?: unknown }).url || '').trim()
    if (!url || seen.has(url)) continue
    seen.add(url)
    urls.push(url)
  }
  return urls
}

function resultSummary(step: ShipStepDto): { summary?: string; prCount: number; prUrls: string[] } {
  const result = step.result
  if (!result || typeof result !== 'object') return { prCount: 0, prUrls: [] }
  const rec = result as Record<string, unknown>
  const prUrls = prUrlsFromUnknown(rec.draftPullRequests)
  const prCount = prUrls.length || (Array.isArray(rec.draftPullRequests) ? rec.draftPullRequests.length : 0)
  const summary = typeof rec.summary === 'string' && rec.summary.trim() ? rec.summary.trim() : undefined
  return { summary, prCount, prUrls }
}

function mergePrUrls(...groups: (string[] | undefined)[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const group of groups) {
    for (const url of group || []) {
      const trimmed = url.trim()
      if (!trimmed || seen.has(trimmed)) continue
      seen.add(trimmed)
      out.push(trimmed)
    }
  }
  return out
}

function buildStoryRows(
  stories: StorySummary[],
  implementSteps: ShipStepDto[],
  latestIssueId: string | undefined,
  latestSummary: string | undefined,
  latestPrUrls: string[],
  registered: { issueId: string; url: string }[],
): StoryRow[] {
  const byIssue = new Map<string, { summary?: string; prCount: number; prUrls: string[] }>()
  for (const step of implementSteps) {
    const id = payloadIssueId(step)
    if (!id) continue
    const { summary, prCount, prUrls } = resultSummary(step)
    const prev = byIssue.get(id)
    byIssue.set(id, {
      summary: summary || prev?.summary,
      prCount: Math.max(prev?.prCount || 0, prCount),
      prUrls: mergePrUrls(prev?.prUrls, prUrls),
    })
  }
  for (const pr of registered) {
    if (!pr.issueId || !pr.url) continue
    const prev = byIssue.get(pr.issueId) || { prCount: 0, prUrls: [] as string[] }
    const prUrls = mergePrUrls(prev.prUrls, [pr.url])
    byIssue.set(pr.issueId, {
      summary: prev.summary,
      prCount: Math.max(prev.prCount, prUrls.length),
      prUrls,
    })
  }
  if (latestIssueId) {
    const prev = byIssue.get(latestIssueId) || { prCount: 0, prUrls: [] as string[] }
    const prUrls = mergePrUrls(prev.prUrls, latestPrUrls)
    byIssue.set(latestIssueId, {
      summary: latestSummary || prev.summary,
      prCount: Math.max(prev.prCount, prUrls.length),
      prUrls,
    })
  }

  const knownIds = new Set(stories.map((s) => s.id))
  const rows: StoryRow[] = stories.map((story) => {
    const hit = byIssue.get(story.id)
    return {
      id: story.id,
      title: cleanTitle(story.title || story.id, story.id),
      hasDraft: Boolean(hit),
      lastSummary: hit?.summary,
      prCount: hit?.prCount || 0,
      prUrls: hit?.prUrls || [],
    }
  })

  for (const [id, hit] of byIssue) {
    if (knownIds.has(id)) continue
    rows.push({
      id,
      title: cleanTitle(id, id),
      hasDraft: true,
      lastSummary: hit.summary,
      prCount: hit.prCount,
      prUrls: hit.prUrls,
    })
  }
  return rows
}

function openDraftPr(url: string, event: { preventDefault(): void; stopPropagation(): void }) {
  event.preventDefault()
  event.stopPropagation()
  window.open(url, '_blank', 'noopener,noreferrer')
}

export function ImplementationReadinessScreen({ state, onUpdate, onContinueToReview }: Props) {
  const [busy, setBusy] = useState(false)
  const [busyIssueId, setBusyIssueId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [prs, setPrs] = useState<DraftPullRequest[]>([])
  const [implementSteps, setImplementSteps] = useState<ShipStepDto[]>([])
  const [selectedIssueId, setSelectedIssueId] = useState<string | undefined>(() => defaultIssueId(state))

  const readyForAgent = Boolean(state.projectId && (state.planAcknowledged || state.shipPlanAcknowledged))
  const workspaceReady = Boolean(state.gitWritten || state.generationComplete || state.bootstrapAcknowledged)
  const stories = useMemo(() => storiesFromScope(state), [state.productScope])

  const refreshShipProgress = useCallback(async () => {
    if (!state.projectId) return
    try {
      const res = await fetchShipSession(state.projectId)
      const steps = (res.session?.recentSteps || []).filter(
        (s) => s.stepKind === 'implement-step' && s.status === 'completed',
      )
      setImplementSteps(steps)
    } catch {
      /* best-effort */
    }
  }, [state.projectId])

  useEffect(() => {
    void refreshShipProgress()
  }, [refreshShipProgress, state.canonicalRevision, state.implementStep?.issueId])

  useEffect(() => {
    const next = defaultIssueId(state)
    if (!selectedIssueId && next) setSelectedIssueId(next)
  }, [
    selectedIssueId,
    state.sdlcStartIssueId,
    state.implementStep?.issueId,
    state.productScope?.storyIds,
    state.productScope?.stories,
  ])

  const latestSessionPrUrls = useMemo(() => {
    const fromState = prUrlsFromUnknown(state.draftPullRequests)
    const fromLive = prs.map((pr) => String(pr.url || '').trim()).filter(Boolean)
    return mergePrUrls(fromState, fromLive)
  }, [state.draftPullRequests, prs])

  const rows = useMemo(
    () => buildStoryRows(
      stories,
      implementSteps,
      state.implementStep?.issueId,
      state.implementStep?.summary,
      latestSessionPrUrls,
      (state.registeredPullRequests || []).map((pr) => ({ issueId: pr.issueId, url: pr.url })),
    ),
    [
      stories,
      implementSteps,
      state.implementStep?.issueId,
      state.implementStep?.summary,
      latestSessionPrUrls,
      state.registeredPullRequests,
    ],
  )

  const nextPending = rows.find((r) => !r.hasDraft)
  const selectedRow = rows.find((r) => r.id === selectedIssueId) || rows[0]
  const draftedCount = rows.filter((r) => r.hasDraft).length
  const selectedHasDraft = Boolean(selectedRow?.hasDraft)
  const selectedPrUrls = useMemo(() => {
    if (!selectedRow) return [] as string[]
    if (selectedRow.id === state.implementStep?.issueId) {
      return mergePrUrls(selectedRow.prUrls, latestSessionPrUrls)
    }
    return selectedRow.prUrls
  }, [selectedRow, state.implementStep?.issueId, latestSessionPrUrls])

  const runImplement = useCallback(
    async (issueId: string) => {
      if (!state.projectId) {
        setError('Save the project before running implementation.')
        return
      }
      if (!issueId) {
        setError('Select a story before running implementation.')
        return
      }
      setBusy(true)
      setBusyIssueId(issueId)
      setSelectedIssueId(issueId)
      setError(null)
      setMessage(null)
      try {
        const res = await implementStep(state.projectId, {
          confirm: true,
          gitWritten: Boolean(state.gitWritten || state.generationComplete || state.bootstrapAcknowledged),
          requirementText: requirementTextOf(state),
          productScope: state.productScope,
          workClassification: state.workClassification,
          specification: state.specification,
          technicalPlan: state.technicalPlan,
          overlayFiles: state.scopeOverlays || [],
          repositories: (state.repositories || []).map((r) => ({
            name: r.name,
            htmlUrl: r.htmlUrl,
            purpose: r.purpose,
          })),
          issueId,
          issueKey: issueId,
        })
        if (res.status !== 'ok') {
          throw new Error(res.message || res.errors?.join('; ') || 'Implementation agent failed')
        }
        const draftPrs = res.draftPullRequests || []
        setPrs(draftPrs)
        const impl = res.implementStep
        const resolvedIssue = impl?.issueId || res.issueId || issueId
        onUpdate({
          implementStep: impl || {
            issueId: resolvedIssue,
            summary: res.message,
          },
          draftPullRequests: draftPrs,
          sdlcStartIssueId: resolvedIssue,
          implementationAuthorized: true,
          scopeOverlays: res.overlayFiles || state.scopeOverlays || [],
          nextSdlcCommand: res.nextCommand || '/qa-validation',
        })
        setSelectedIssueId(resolvedIssue)
        setMessage(
          draftPrs.length
            ? `${shortStoryLabel(resolvedIssue)} drafted · ${draftPrs.length} PR(s) opened`
            : `${shortStoryLabel(resolvedIssue)} drafted`,
        )
        await refreshShipProgress()
        try {
          const snap = await fetchCanonicalSnapshot(state.projectId)
          onUpdate(patchFromCanonicalSnapshot(snap, {
            ...state,
            shipSubstage: 'implementation',
            gitWritten: Boolean(state.gitWritten || state.generationComplete || state.bootstrapAcknowledged),
          }))
        } catch {
          /* best-effort */
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not run implementation.')
      } finally {
        setBusy(false)
        setBusyIssueId(null)
      }
    },
    [onUpdate, refreshShipProgress, state],
  )

  const selectStory = (id: string) => {
    setSelectedIssueId(id)
    onUpdate({ sdlcStartIssueId: id })
  }

  return (
    <div className="screen cursor-work-screen">
      {!readyForAgent ? (
        <p className="status-banner info">Acknowledge the plan on Work plan before implementation.</p>
      ) : null}
      {!workspaceReady && readyForAgent ? (
        <p className="status-banner info">Finish Workspace first, then run stories here.</p>
      ) : null}
      {error ? <p className="status-banner error">{error}</p> : null}
      {message && !error ? (
        <p className="status-banner success">
          {message}
          {selectedPrUrls[0] ? (
            <>
              {' · '}
              <a href={selectedPrUrls[0]} target="_blank" rel="noreferrer">
                Open PR
              </a>
            </>
          ) : null}
        </p>
      ) : null}

      <section className="card shape-section implement-queue-card">
        <div className="implement-queue-card__meta">
          <span>
            {rows.length ? `${draftedCount}/${rows.length} drafted` : 'No stories yet'}
          </span>
          {selectedRow ? (
            <span className="muted">
              Selected <code>{shortStoryLabel(selectedRow.id)}</code>
            </span>
          ) : null}
        </div>

        {rows.length ? (
          <ul className="implement-story-queue">
            {rows.map((row) => {
              const isSelected = row.id === selectedIssueId
              const isBusy = busy && busyIssueId === row.id
              const draftPrUrl = row.prUrls[0]
              return (
                <li
                  key={row.id}
                  className={`implement-story-queue__item${isSelected ? ' is-selected' : ''}${row.hasDraft ? ' is-drafted' : ''}`}
                >
                  <button
                    type="button"
                    className="implement-story-queue__select"
                    onClick={() => selectStory(row.id)}
                    disabled={busy}
                  >
                    <span className="implement-story-queue__icon" aria-hidden>
                      {row.hasDraft ? <CheckCircle2 size={16} /> : <Circle size={16} />}
                    </span>
                    <span className="implement-story-queue__copy">
                      <code className="implement-story-queue__id">{shortStoryLabel(row.id)}</code>
                      <span className="implement-story-queue__title">{row.title}</span>
                    </span>
                    {row.hasDraft && draftPrUrl ? (
                      <span
                        className="implement-story-queue__badge is-drafted is-link"
                        role="link"
                        tabIndex={0}
                        title="Open draft PR on GitHub"
                        onClick={(event) => openDraftPr(draftPrUrl, event)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            openDraftPr(draftPrUrl, event)
                          }
                        }}
                      >
                        Drafted
                      </span>
                    ) : (
                      <span className={`implement-story-queue__badge is-${row.hasDraft ? 'drafted' : isSelected ? 'selected' : 'pending'}`}>
                        {row.hasDraft ? 'Drafted' : isSelected ? 'Selected' : 'Pending'}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    className="implement-story-queue__action"
                    disabled={busy || !readyForAgent || !workspaceReady}
                    onClick={() => void runImplement(row.id)}
                  >
                    {isBusy ? <Loader2 className="spin" size={14} /> : <Play size={14} />}
                    {row.hasDraft ? 'Re-run' : 'Implement'}
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="muted small">Add stories in Scope &amp; tickets first.</p>
        )}

        {selectedRow?.hasDraft && (selectedRow.lastSummary || selectedPrUrls.length > 0 || (state.implementStep?.issueId === selectedRow.id && state.implementStep?.notes?.length)) ? (
          <div className="implement-result">
            {selectedRow.lastSummary || (state.implementStep?.issueId === selectedRow.id ? state.implementStep?.summary : null) ? (
              <p className="implement-result__summary">
                {selectedRow.lastSummary
                  || (state.implementStep?.issueId === selectedRow.id ? state.implementStep?.summary : null)}
              </p>
            ) : null}
            {selectedPrUrls.length > 0 ? (
              <ul className="implement-result__prs">
                {selectedPrUrls.map((url, index) => (
                  <li key={url}>
                    <a href={url} target="_blank" rel="noreferrer">
                      Draft PR{selectedPrUrls.length > 1 ? ` ${index + 1}` : ''}
                    </a>
                  </li>
                ))}
              </ul>
            ) : selectedRow.prCount > 0 ? (
              <p className="muted small">{selectedRow.prCount} draft PR(s) recorded</p>
            ) : null}
          </div>
        ) : null}

        <div className="ship-actions implement-queue-actions">
          {nextPending ? (
            <button
              type="button"
              className="primary-btn"
              disabled={busy || !readyForAgent || !workspaceReady}
              onClick={() => void runImplement(nextPending.id)}
            >
              {busy && busyIssueId === nextPending.id ? <Loader2 className="spin" size={16} /> : <Play size={16} />}
              Next pending · {shortStoryLabel(nextPending.id)}
            </button>
          ) : selectedIssueId ? (
            <button
              type="button"
              className="primary-btn"
              disabled={busy || !readyForAgent || !workspaceReady}
              onClick={() => void runImplement(selectedIssueId)}
            >
              {busy ? <Loader2 className="spin" size={16} /> : <Play size={16} />}
              {selectedHasDraft ? 'Re-run selected' : 'Implement selected'}
            </button>
          ) : null}
          {selectedHasDraft && onContinueToReview ? (
            <button type="button" className="secondary-btn" onClick={onContinueToReview}>
              Continue to Review &amp; PR
            </button>
          ) : null}
        </div>

        {!workspaceReady ? (
          <p className="muted small implement-queue-hint">
            <AlertCircle size={14} /> Workspace must be ready before the agent can run.
          </p>
        ) : null}
      </section>
    </div>
  )
}

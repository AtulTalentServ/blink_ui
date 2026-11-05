import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Loader2, Play, Search } from 'lucide-react'
import {
  cancelCodexSession,
  fetchCanonicalSnapshot,
  fetchCodexWorkbench,
  fetchShipSession,
  postCodexGitAction,
  streamCodexFollowUp,
  streamCodexImplementStep,
  streamCodexSteer,
  type CodexAttachment,
  type CodexWorkbench,
  type DraftPullRequest,
  type ShipStepDto,
} from '../api/blink'
import { emptyCodexConsole } from '../components/CodexAgentConsole'
import { CodexChatPanel, type ChatSend } from '../components/CodexChatPanel'
import { CodexProjectInspector } from '../components/CodexProjectInspector'
import type { LineComment } from '../components/CodexDiffViewer'
import { patchFromCanonicalSnapshot } from '../wizard/canonical'
import {
  applyCodexEvent,
  beginCodexRun,
  busyIssueIds,
  codexRunInflight,
  clearCodexAbort,
  codexAbortRequested,
  codexRunKey,
  failCodexRun,
  finishCodexRun,
  getCodexRun,
  getCodexRunVersion,
  patchProjectCodexMeta,
  projectCodexMeta,
  rememberCodexSession,
  requestCodexAbort,
  subscribeCodexRuns,
  trackCodexRun,
} from '../wizard/codexRunStore'
import type { ScopeOverlayFile, StorySummary, WizardState } from '../wizard/types'

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
  /** Why a draft PR was not opened (token missing, docs-only stub, etc.). */
  skipReason?: string
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

function urlFromRecord(item: Record<string, unknown>): string {
  for (const key of ['url', 'html_url', 'htmlUrl', 'pr_url', 'prUrl', 'draftPrUrl']) {
    const value = String(item[key] || '').trim()
    if (value.startsWith('http://') || value.startsWith('https://')) return value
  }
  return ''
}

function prUrlsFromText(text: string | undefined): string[] {
  if (!text) return []
  const matches = text.match(/https?:\/\/(?:www\.)?github\.com\/[^\s)]+\/pull\/\d+/gi) || []
  return matches.map((url) => url.replace(/[.,;]+$/, ''))
}

function prUrlsFromUnknown(value: unknown): string[] {
  const urls: string[] = []
  const seen = new Set<string>()
  const push = (url: string) => {
    const trimmed = url.trim()
    if (!trimmed || seen.has(trimmed)) return
    seen.add(trimmed)
    urls.push(trimmed)
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === 'string') {
        push(item)
        continue
      }
      if (!item || typeof item !== 'object') continue
      const url = urlFromRecord(item as Record<string, unknown>)
      if (url) push(url)
    }
    return urls
  }
  if (value && typeof value === 'object') {
    const url = urlFromRecord(value as Record<string, unknown>)
    if (url) push(url)
  }
  return urls
}

function resultSummary(step: ShipStepDto): { summary?: string; prCount: number; prUrls: string[]; skipReason?: string } {
  const result = step.result
  if (!result || typeof result !== 'object') return { prCount: 0, prUrls: [] }
  const rec = result as Record<string, unknown>
  const evidence = rec.evidence && typeof rec.evidence === 'object'
    ? rec.evidence as Record<string, unknown>
    : null
  const summary = typeof rec.summary === 'string' && rec.summary.trim() ? rec.summary.trim() : undefined
  const prUrls = mergePrUrls(
    prUrlsFromUnknown(rec.draftPullRequests),
    prUrlsFromUnknown(rec.pullRequests),
    prUrlsFromText(summary),
  )
  const prCount = prUrls.length || (Array.isArray(rec.draftPullRequests) ? rec.draftPullRequests.length : 0)
  const skipReason = typeof evidence?.draftPrSkipped === 'string'
    ? evidence.draftPrSkipped
    : typeof evidence?.draftPrError === 'string'
      ? evidence.draftPrError
      : undefined
  return { summary, prCount, prUrls, skipReason }
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
  const byIssue = new Map<string, { summary?: string; prCount: number; prUrls: string[]; skipReason?: string }>()
  // implementSteps arrive newest first. Keep the newest draft link and ignore older closed ones.
  for (const step of implementSteps) {
    const id = payloadIssueId(step)
    if (!id) continue
    const { summary, prUrls, skipReason } = resultSummary(step)
    const prev = byIssue.get(id)
    const kept = prev?.prUrls.length ? prev.prUrls : prUrls
    byIssue.set(id, {
      summary: prev?.summary || summary,
      prCount: kept.length,
      prUrls: kept,
      skipReason: kept.length ? undefined : (prev?.skipReason || skipReason),
    })
  }
  for (const pr of registered) {
    if (!pr.issueId || !pr.url) continue
    const prev = byIssue.get(pr.issueId)
    if (prev?.prUrls.length) continue
    byIssue.set(pr.issueId, {
      summary: prev?.summary,
      prCount: 1,
      prUrls: [pr.url],
      skipReason: undefined,
    })
  }
  if (latestIssueId && latestPrUrls.length) {
    const prev = byIssue.get(latestIssueId)
    byIssue.set(latestIssueId, {
      summary: latestSummary || prev?.summary,
      prCount: latestPrUrls.length,
      prUrls: latestPrUrls,
      skipReason: undefined,
    })
  }

  const knownIds = new Set(stories.map((s) => s.id))
  const rows: StoryRow[] = stories.map((story) => {
    const hit = byIssue.get(story.id)
    return {
      id: story.id,
      title: cleanTitle(story.title || story.id, story.id),
      hasDraft: (hit?.prUrls.length || 0) > 0,
      lastSummary: hit?.summary,
      prCount: hit?.prCount || 0,
      prUrls: hit?.prUrls || [],
      skipReason: hit?.skipReason,
    }
  })

  for (const [id, hit] of byIssue) {
    if (knownIds.has(id)) continue
    rows.push({
      id,
      title: cleanTitle(id, id),
      hasDraft: hit.prUrls.length > 0,
      lastSummary: hit.summary,
      prCount: hit.prCount,
      prUrls: hit.prUrls,
      skipReason: hit.skipReason,
    })
  }
  return rows
}

function draftedSkipMessage(reason: string | undefined): string {
  switch (reason) {
    case 'docs_only_stub':
      return 'No GitHub PR — agent returned docs/stub only. Fix LLM config and re-run Implement.'
    case 'github_token_missing':
      return 'No GitHub PR — connect GitHub on Integrations, then re-run Implement.'
    case 'app_repos_missing':
      return 'No GitHub PR — create/link app repositories first, then re-run Implement.'
    case 'patches_empty':
      return 'No GitHub PR — implement-step returned no code patches.'
    default:
      return reason
        ? `No GitHub PR URL recorded (${reason}).`
        : 'No GitHub PR URL was recorded for this story. Re-run Implement after GitHub is connected.'
  }
}

export function ImplementationReadinessScreen({ state, onUpdate, onContinueToReview }: Props) {
  const projectKey = state.projectId ? String(state.projectId) : ''
  useSyncExternalStore(subscribeCodexRuns, getCodexRunVersion, getCodexRunVersion)
  const [prs, setPrs] = useState<DraftPullRequest[]>([])
  const [implementSteps, setImplementSteps] = useState<ShipStepDto[]>([])
  const [selectedIssueId, setSelectedIssueId] = useState<string | undefined>(() => defaultIssueId(state))
  const [workbench, setWorkbench] = useState<CodexWorkbench | null>(null)
  const [scope, setScope] = useState('uncommitted')
  const [commitSha, setCommitSha] = useState('')
  const [inspectorTab, setInspectorTab] = useState<'changes' | 'files' | 'terminal' | 'git'>('changes')
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [openPath, setOpenPath] = useState('')
  const [storyQuery, setStoryQuery] = useState('')
  const [turnCounts, setTurnCounts] = useState<Record<string, number>>({})
  const [model, setModel] = useState('gpt-6-luna')
  const [railOpen, setRailOpen] = useState(true)

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

  const selectedRow = rows.find((r) => r.id === selectedIssueId) || rows[0]
  const pendingIds = rows.filter((r) => !r.hasDraft).map((r) => r.id)
  const selectedPrUrls = useMemo(() => {
    if (!selectedRow) return [] as string[]
    if (selectedRow.id === state.implementStep?.issueId && latestSessionPrUrls.length) {
      return latestSessionPrUrls
    }
    return selectedRow.prUrls
  }, [selectedRow, state.implementStep?.issueId, latestSessionPrUrls])

  const implementPayload = useCallback(
    (issueId: string, overlayFiles: WizardState['scopeOverlays']) => {
      return {
        confirm: true,
        gitWritten: Boolean(state.gitWritten || state.generationComplete || state.bootstrapAcknowledged),
        overlayFiles: overlayFiles || [],
        repositories: (state.repositories || []).map((r) => ({
          name: r.name,
          htmlUrl: r.htmlUrl,
          purpose: r.purpose,
        })),
        issueId,
        issueKey: issueId,
      }
    },
    [state],
  )

  const runImplement = useCallback(
    async (issueId: string, extra?: ChatSend) => {
      const projectId = state.projectId ? String(state.projectId) : ''
      if (!projectId) {
        patchProjectCodexMeta('0', { error: 'Save the project before running implementation.', message: null })
        return
      }
      if (!issueId) {
        patchProjectCodexMeta(projectId, { error: 'Select a story before running implementation.', message: null })
        return
      }
      const work = (async () => {
        setSelectedIssueId(issueId)
        beginCodexRun(projectId, issueId)
        patchProjectCodexMeta(projectId, { error: null, message: null })
        const sessionId = getCodexRun(codexRunKey(projectId, issueId)).sessionId
        try {
          const res = await streamCodexImplementStep(
            projectId,
            { ...implementPayload(issueId, state.scopeOverlays), ...(sessionId ? { codexSessionId: sessionId } : {}), instruction: extra?.text || undefined, attachments: extra?.attachments || undefined, model },
            {
              onThinking: (text) => applyCodexEvent(projectId, issueId, 'thinking', { text }),
              onEvent: (event, payload) => applyCodexEvent(projectId, issueId, event, payload),
            },
          )
          if (res.status === 'blocked') {
            throw new Error(res.message || 'Quality gate blocked the GitHub commit.')
          }
          if (res.status !== 'ok') {
            throw new Error(res.message || res.errors?.join('; ') || 'Implementation agent failed')
          }
          rememberCodexSession(projectId, issueId, res.codexSessionId)
          applyCodexEvent(projectId, issueId, 'done', res as unknown as Record<string, unknown>)
          const draftPrs = res.draftPullRequests || []
          setPrs(draftPrs)
          const impl = res.implementStep
          const resolvedIssue = impl?.issueId || res.issueId || issueId
          const evidence = res.evidence && typeof res.evidence === 'object'
            ? res.evidence as Record<string, unknown>
            : null
          const skipReason = typeof evidence?.draftPrSkipped === 'string'
            ? evidence.draftPrSkipped
            : typeof evidence?.draftPrError === 'string'
              ? evidence.draftPrError
              : undefined
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
          if (draftPrs.length) {
            finishCodexRun(projectId, issueId, { error: null, message: `${shortStoryLabel(resolvedIssue)} drafted · ${draftPrs.length} PR(s) opened` })
          } else {
            finishCodexRun(projectId, issueId, { message: null, error: draftedSkipMessage(skipReason) })
          }
          await refreshShipProgress()
          try {
            const snap = await fetchCanonicalSnapshot(projectId)
            onUpdate(patchFromCanonicalSnapshot(snap, {
              ...state,
              shipSubstage: 'implementation',
              gitWritten: Boolean(state.gitWritten || state.generationComplete || state.bootstrapAcknowledged),
            }))
          } catch {
            /* best-effort */
          }
        } catch (err) {
          failCodexRun(projectId, issueId, err instanceof Error ? err.message : 'Could not run implementation.')
        } finally {
          finishCodexRun(projectId, issueId)
        }
      })()
      trackCodexRun(codexRunKey(projectId, issueId), work)
      await work
    },
    [implementPayload, model, onUpdate, refreshShipProgress, state, stories],
  )

  const runCodexFollowUp = useCallback(
    async (instruction: string, attachments?: CodexAttachment[]) => {
      const projectId = state.projectId ? String(state.projectId) : ''
      if (!projectId || !selectedIssueId) return
      const issueId = selectedIssueId
      const work = (async () => {
        beginCodexRun(projectId, issueId)
        const sessionId = getCodexRun(codexRunKey(projectId, issueId)).sessionId
        try {
          const selectedPr = (prs[0] || (state.draftPullRequests || [])[0]) as DraftPullRequest | undefined
          const res = await streamCodexFollowUp(
            projectId,
            {
              ...implementPayload(issueId, state.scopeOverlays),
              followUp: instruction,
              instruction,
              attachments,
              confirm: true,
              gitWritten: true,
              codexSessionId: sessionId || undefined,
              owner: selectedPr?.owner,
              repo: selectedPr?.repo,
              branch: selectedPr?.branch || `blink/implement-${issueId}`,
              model,
            },
            {
              onThinking: (text) => applyCodexEvent(projectId, issueId, 'thinking', { text }),
              onEvent: (event, payload) => applyCodexEvent(projectId, issueId, event, payload),
            },
          )
          rememberCodexSession(projectId, issueId, res.codexSessionId)
          applyCodexEvent(projectId, issueId, 'done', res as unknown as Record<string, unknown>)
          if (res.draftPullRequests?.length) setPrs(res.draftPullRequests)
          finishCodexRun(projectId, issueId, { error: null, message: res.summary || res.message || 'Follow-up applied' })
          await refreshShipProgress()
        } catch (err) {
          failCodexRun(projectId, issueId, err instanceof Error ? err.message : 'Follow-up failed')
        } finally {
          finishCodexRun(projectId, issueId)
        }
      })()
      trackCodexRun(codexRunKey(projectId, issueId), work)
      await work
    },
    [implementPayload, model, prs, refreshShipProgress, selectedIssueId, state],
  )

  const runImplementAll = useCallback(
    async (issueIds: string[]) => {
      const projectId = state.projectId ? String(state.projectId) : ''
      if (!projectId) {
        return
      }
      if (!issueIds.length) {
        patchProjectCodexMeta(projectId, { error: 'Add stories in Scope & tickets before implementing the project.', message: null })
        return
      }
      const work = (async () => {
        patchProjectCodexMeta(projectId, { runningAll: true, error: null, message: null })
        clearCodexAbort(projectId)
        let overlays = state.scopeOverlays || []
        const failures: string[] = []
        let completed = 0
        try {
          const storyById = new Map(stories.map((item) => [item.id, item]))
          const pending = new Set(issueIds)
          const completedIds = new Set<string>()
          let waveNumber = 0
          const runStory = async (issueId: string): Promise<ScopeOverlayFile[] | null> => {
            setSelectedIssueId(issueId)
            beginCodexRun(projectId, issueId)
            patchProjectCodexMeta(projectId, { message: `Implementing ${shortStoryLabel(issueId)} (wave ${waveNumber})…` })
            try {
              const res = await streamCodexImplementStep(
                projectId,
                { ...implementPayload(issueId, overlays), model },
                {
                  onThinking: (text) => applyCodexEvent(projectId, issueId, 'thinking', { text }),
                  onEvent: (event, payload) => applyCodexEvent(projectId, issueId, event, payload),
                },
              )
              if (res.status === 'blocked') {
                throw new Error(res.message || 'Quality gate blocked the GitHub commit.')
              }
              if (res.status !== 'ok') {
                throw new Error(res.message || res.errors?.join('; ') || 'Implementation agent failed')
              }
              if (res.codexSessionId) rememberCodexSession(projectId, issueId, res.codexSessionId)
              applyCodexEvent(projectId, issueId, 'done', res as unknown as Record<string, unknown>)
              const draftPrs = res.draftPullRequests || []
              setPrs(draftPrs)
              const impl = res.implementStep
              const resolvedIssue = impl?.issueId || res.issueId || issueId
              const nextOverlays = res.overlayFiles || overlays
              onUpdate({
                implementStep: impl || { issueId: resolvedIssue, summary: res.message },
                draftPullRequests: draftPrs,
                sdlcStartIssueId: resolvedIssue,
                implementationAuthorized: true,
                scopeOverlays: nextOverlays,
                nextSdlcCommand: res.nextCommand || '/qa-validation',
              })
              setSelectedIssueId(resolvedIssue)
              await refreshShipProgress()
              if (!draftPrs.length) {
                const evidence = res.evidence && typeof res.evidence === 'object'
                  ? res.evidence as Record<string, unknown>
                  : null
                const skipReason = typeof evidence?.draftPrSkipped === 'string'
                  ? evidence.draftPrSkipped
                  : typeof evidence?.draftPrError === 'string'
                    ? evidence.draftPrError
                    : undefined
                const reason = draftedSkipMessage(skipReason)
                finishCodexRun(projectId, issueId, { error: reason, message: null })
                failures.push(`${shortStoryLabel(issueId)}: ${reason}`)
                return null
              }
              finishCodexRun(projectId, issueId, { error: null, message: null })
              completed += 1
              return nextOverlays
            } catch (err) {
              const reason = err instanceof Error ? err.message : 'Could not run implementation.'
              failCodexRun(projectId, issueId, reason)
              failures.push(`${shortStoryLabel(issueId)}: ${reason}`)
              return null
            } finally {
              finishCodexRun(projectId, issueId)
            }
          }

          while (pending.size > 0 && !codexAbortRequested(projectId)) {
            const ready = [...pending].filter((issueId) => {
              const deps = storyById.get(issueId)?.dependsOn || []
              return deps.every((dependency) => completedIds.has(dependency) || !issueIds.includes(dependency))
            })
            if (!ready.length) {
              failures.push(`Dependency cycle or unresolved dependency among: ${[...pending].join(', ')}`)
              break
            }
            waveNumber += 1
            const batch = ready.slice(0, 3)
            const results = await Promise.all(batch.map((issueId) => runStory(issueId)))
            batch.forEach((issueId, index) => {
              pending.delete(issueId)
              if (results[index]) {
                completedIds.add(issueId)
                overlays = results[index] || overlays
              }
            })
          }
          if (pending.size > 0 && codexAbortRequested(projectId)) {
            failures.push('Cancelled remaining tickets.')
          }
          try {
            const snap = await fetchCanonicalSnapshot(projectId)
            onUpdate(patchFromCanonicalSnapshot(snap, {
              ...state,
              shipSubstage: 'implementation',
              gitWritten: Boolean(state.gitWritten || state.generationComplete || state.bootstrapAcknowledged),
            }))
          } catch {
            /* best-effort */
          }
          patchProjectCodexMeta(projectId, {
            message: completed ? `Opened draft PRs for ${completed} ${completed === 1 ? 'story' : 'stories'}` : null,
            error: failures.length ? failures.join(' ') : null,
          })
        } finally {
          patchProjectCodexMeta(projectId, { runningAll: false })
        }
      })()
      trackCodexRun(`${projectId}:all`, work)
      await work
    },
    [implementPayload, model, onUpdate, refreshShipProgress, state],
  )

  const selectStory = (id: string) => {
    setSelectedIssueId(id)
    onUpdate({ sdlcStartIssueId: id })
  }

  const story = stories.find((item) => item.id === (selectedRow?.id || selectedIssueId))
  const activeIssue = selectedRow?.id || selectedIssueId || ''
  const selectedRun = projectKey && activeIssue ? getCodexRun(codexRunKey(projectKey, activeIssue)) : null
  const busy = Boolean(selectedRun?.busy)
  const runningIssueIds = projectKey ? busyIssueIds(projectKey) : []
  const runningIssueId = runningIssueIds[0] || null
  const anyBusy = runningIssueIds.length > 0
  const codexConsole = selectedRun?.console ?? emptyCodexConsole()
  const codexSessionId = selectedRun?.sessionId ?? null
  const meta = projectKey ? projectCodexMeta(projectKey) : { runningAll: false, error: null, message: null }
  const runningAll = meta.runningAll
  const error = selectedRun?.error || meta.error
  const message = selectedRun?.message || meta.message

  useEffect(() => {
    if (!state.projectId || !activeIssue) return
    let cancelled = false
    const load = () => fetchCodexWorkbench(state.projectId as string, activeIssue, scope, commitSha || undefined)
      .then((res) => {
        if (cancelled) return
        setWorkbench(res)
        if (
          busy
          && res.sessionStatus
          && res.sessionStatus !== 'running'
          && !codexRunInflight(codexRunKey(String(state.projectId), activeIssue))
        ) {
          finishCodexRun(String(state.projectId), activeIssue)
        }
      })
      .catch(() => { if (!cancelled) setWorkbench(null) })
    void load()
    if (!busy) return () => { cancelled = true }
    const timer = window.setInterval(() => { void load() }, 4000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [state.projectId, activeIssue, scope, commitSha, busy])

  const sendFollowUp = (send: ChatSend) => {
    if (!send.text && send.attachments.length === 0) return
    void runCodexFollowUp(send.text, send.attachments)
  }

  const stopTurn = () => {
    if (!projectKey || !state.projectId) return
    requestCodexAbort(projectKey)
    const issueId = runningIssueId || activeIssue
    void cancelCodexSession(state.projectId, { issueId: issueId || '' })
      .then(() => {
        if (issueId) finishCodexRun(projectKey, issueId)
        patchProjectCodexMeta(projectKey, { error: null, message: 'Cancelled the running turn.' })
      })
      .catch((err) => {
        patchProjectCodexMeta(projectKey, { error: err instanceof Error ? err.message : 'Could not cancel the turn.' })
      })
  }

  const steer = (send: ChatSend) => {
    if (!state.projectId || !activeIssue) return
    void streamCodexSteer(
      state.projectId,
      {
        ...implementPayload(activeIssue, state.scopeOverlays),
        instruction: send.text,
        followUp: send.text,
        attachments: send.attachments,
        confirm: true,
        gitWritten: true,
        model,
        codexSessionId: codexSessionId || undefined,
      },
      { onEvent: (event, payload) => applyCodexEvent(projectKey, activeIssue, event, payload) },
    ).then((res) => {
      rememberCodexSession(projectKey, activeIssue, res.codexSessionId)
      if (res.status === 'injected') finishCodexRun(projectKey, activeIssue, { message: 'Steering message sent to the live session.' })
      else applyCodexEvent(projectKey, activeIssue, 'done', res as unknown as Record<string, unknown>)
    }).catch((err) => failCodexRun(projectKey, activeIssue, err instanceof Error ? err.message : 'Steer failed'))
  }

  const git = async (action: string, filePath?: string, hunkIndex?: number) => {
    if (!state.projectId || !activeIssue) return
    const pr = (prs[0] || (state.draftPullRequests || [])[0]) as DraftPullRequest | undefined
    try {
      await postCodexGitAction(state.projectId, {
        issueId: activeIssue,
        action,
        path: filePath,
        hunkIndex,
        owner: pr?.owner,
        repo: pr?.repo,
        branch: pr?.branch,
      })
      const res = await fetchCodexWorkbench(state.projectId, activeIssue, scope, commitSha || undefined)
      setWorkbench(res)
    } catch (err) {
      patchProjectCodexMeta(projectKey, { error: err instanceof Error ? err.message : 'Git action failed' })
    }
  }

  const sendComments = (comments: LineComment[]) => {
    const text = comments.map((c) => `${c.path}:${c.line}\n${c.snippet}\n${c.text}`).join('\n\n')
    void runCodexFollowUp(`Apply these review comments:\n\n${text}`)
  }

  const storyKey = rows.map((row) => row.id).join('|')
  useEffect(() => {
    if (!state.projectId || !storyKey) return
    let cancelled = false
    const ids = storyKey.split('|')
    void Promise.all(ids.map(async (id) => {
      try {
        const loaded = await fetchCodexWorkbench(state.projectId as string, id, 'last_turn')
        return [id, loaded.turns?.length ?? 0] as const
      } catch {
        return [id, 0] as const
      }
    })).then((pairs) => {
      if (cancelled) return
      const next: Record<string, number> = {}
      for (const [id, count] of pairs) next[id] = count
      setTurnCounts(next)
    })
    return () => { cancelled = true }
  }, [state.projectId, storyKey, busy])

  const visibleRows = rows.filter((row) => {
    const q = storyQuery.trim().toLowerCase()
    if (!q) return true
    return row.id.toLowerCase().includes(q) || row.title.toLowerCase().includes(q)
  })

  return (
    <div className={`codex-workbench${railOpen ? '' : ' is-rail-collapsed'}${inspectorOpen ? '' : ' is-inspector-collapsed'}`}>
      {!readyForAgent ? <p className="status-banner info">Acknowledge the plan on Work plan before implementation.</p> : null}
      {!workspaceReady && readyForAgent ? <p className="status-banner info">Finish Workspace first, then run stories here.</p> : null}
      {error ? (
        <p className="status-banner error">
          {error}
          {/already running/i.test(error) ? (
            <button type="button" className="codex-btn" onClick={stopTurn}>Cancel turn</button>
          ) : null}
        </p>
      ) : null}
      {message && !error ? <p className="status-banner success">{message}</p> : null}
      <div className="codex-workbench__grid">
        {railOpen ? (
          <aside className="codex-rail">
            <header className="codex-rail__head">
              <strong>Stories ({rows.length})</strong>
              <label className="codex-rail__search">
                <Search size={14} />
                <input value={storyQuery} onChange={(e) => setStoryQuery(e.target.value)} placeholder="Search" aria-label="Search stories" />
              </label>
            </header>
            <ul>
              {visibleRows.map((row) => {
                const isSelected = row.id === activeIssue
                const isBusy = projectKey ? getCodexRun(codexRunKey(projectKey, row.id)).busy : false
                const status = isBusy ? 'Running' : row.hasDraft ? 'Drafted' : 'Pending'
                const turns = isSelected && workbench?.turns ? workbench.turns.length : turnCounts[row.id]
                const caption = turns && turns > 0
                  ? `${turns} ${turns === 1 ? 'turn' : 'turns'}`
                  : status === 'Running' ? 'In progress' : ''
                return (
                  <li key={row.id} className={isSelected ? 'is-selected' : ''}>
                    <button type="button" className={`codex-story-card is-${status.toLowerCase()}`} onClick={() => selectStory(row.id)}>
                      <span className="codex-story-card__top">
                        <code>{shortStoryLabel(row.id)}</code>
                        <span className={`codex-pill is-${status.toLowerCase()}`}>{status}</span>
                      </span>
                      <span className="codex-story-card__title">{row.title}</span>
                      <span className="codex-story-bar" aria-hidden><span /></span>
                      {caption ? <span className="codex-story-card__meta">{caption}</span> : null}
                    </button>
                  </li>
                )
              })}
            </ul>
            <button type="button" className="codex-btn codex-btn--ghost codex-rail__run" disabled={anyBusy || runningAll || !readyForAgent || !workspaceReady || pendingIds.length === 0} onClick={() => void runImplementAll(pendingIds)}>
              {runningAll ? <Loader2 className="spin" size={14} /> : <Play size={14} />}
              Run all pending
            </button>
          </aside>
        ) : (
          <button type="button" className="codex-btn codex-rail__show" onClick={() => setRailOpen(true)}>Stories</button>
        )}
        <CodexChatPanel
          storyId={activeIssue}
          title={selectedRow?.title}
          projectName={state.projectName}
          branch={workbench?.branch}
          prUrl={selectedPrUrls[0]}
          acceptance={story?.acceptanceCriteria}
          busy={busy}
          canRun={readyForAgent && workspaceReady && Boolean(activeIssue) && !(anyBusy && !busy)}
          hasSession={Boolean(codexSessionId || selectedRow?.hasDraft)}
          turns={workbench?.turns || []}
          additions={workbench?.additions}
          deletions={workbench?.deletions}
          liveEvents={codexConsole.events}
          liveOutput={codexConsole.output}
          livePhase={codexConsole.phase}
          files={workbench?.files || []}
          model={model}
          onModel={setModel}
          onImplement={(send) => { if (activeIssue) void runImplement(activeIssue, send) }}
          onFollowUp={sendFollowUp}
          onSteer={steer}
          onStop={stopTurn}
          onOpenFile={(filePath) => { setOpenPath(filePath); setInspectorOpen(true); setInspectorTab('files') }}
          onViewDiff={() => { setInspectorOpen(true); setInspectorTab('changes') }}
        />
        {inspectorOpen ? (
        <CodexProjectInspector
          projectId={state.projectId}
          issueId={activeIssue}
          prUrls={selectedPrUrls}
          workbench={workbench}
          scope={scope}
          consoleState={codexConsole}
          openPath={openPath}
          tab={inspectorTab}
          onTab={setInspectorTab}
          onScope={(next, sha) => { setScope(next); setCommitSha(sha || '') }}
          onGit={(action, filePath, hunkIndex) => { void git(action, filePath, hunkIndex) }}
          onSendComments={sendComments}
          onReference={(filePath) => setOpenPath(filePath)}
          onContinue={onContinueToReview}
          onClose={() => setInspectorOpen(false)}
        />
        ) : (
          <button type="button" className="codex-btn codex-rail__show" onClick={() => setInspectorOpen(true)}>Changes</button>
        )}
      </div>
    </div>
  )
}

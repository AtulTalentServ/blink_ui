import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, ChevronRight, ExternalLink, Layers, Loader2, RefreshCw, Ticket } from 'lucide-react'
import {
  fetchJiraIssueStatuses,
  saveFigmaDesign,
  type JiraIssueStatusItem,
} from '../api/blink'
import type { FigmaScreenBinding, JiraCreatedIssue, WizardState } from '../wizard/types'
import { autoLinkFigmaScreens, figmaJiraRefs, figmaStoryRefs } from '../wizard/figmaDesign'
import {
  createdTicketsOnScreen,
  isJiraReady,
  jiraConnection,
  markTicketsPipelineBusy,
  pendingJiraTicketCount,
  planScopeFromWording,
} from '../wizard/jiraTickets'
import {
  isScopeOptionSelected,
  patchScopeOther,
  patchScopePick,
  patchScopeToggleOther,
  scopeAnswersForQuestion,
} from '../wizard/scopeClarify'
import { isAnswered, unansweredRequired } from '../wizard/grooming'
import type { GroomQuestion } from '../wizard/types'
import { shouldAutoStartTickets, type JiraPublishState } from '../wizard/thinking'

interface Props {
  state: WizardState
  onUpdate: (patch: Partial<WizardState>) => void
  sourceText: string
  jiraPublish?: JiraPublishState | null
}

function jiraBrowseUrl(
  item: { jiraUrl?: string | null; url?: string | null; jiraKey?: string | null },
  baseUrl?: string | null,
): string | null {
  const direct = item.jiraUrl || item.url
  if (direct) return direct
  if (item.jiraKey && baseUrl) {
    return `${baseUrl.replace(/\/$/, '')}/browse/${item.jiraKey}`
  }
  return null
}

function TicketBadge({
  created,
  baseUrl,
}: {
  created?: JiraCreatedIssue
  baseUrl?: string | null
}) {
  if (!created) return null

  if (created.status === 'creating') {
    return <span className="jira-ticket-badge jira-ticket-badge--pending">Creating…</span>
  }

  if (created.status === 'created' && created.jiraKey) {
    const href = jiraBrowseUrl(created, baseUrl)
    if (!href) {
      return <span className="jira-ticket-badge jira-ticket-badge--plain">{created.jiraKey}</span>
    }
    return (
      <a
        className="jira-ticket-badge"
        href={href}
        target="_blank"
        rel="noreferrer"
        title={`Open ${created.jiraKey} in Jira`}
        onClick={(e) => e.stopPropagation()}
      >
        <span>{created.jiraKey}</span>
        <ExternalLink size={11} aria-hidden />
      </a>
    )
  }

  if (created.status === 'failed') {
    return (
      <span className="jira-ticket-badge jira-ticket-badge--failed" title={created.message || 'Create failed'}>
        Failed
      </span>
    )
  }

  return null
}

function statusTone(item?: JiraIssueStatusItem | null): string {
  if (!item || item.category === 'missing' || !item.name) return 'is-missing'
  if (item.name.trim().toLowerCase() === 'closed') return 'is-closed'
  if (item.category === 'done') return 'is-done'
  if (item.category === 'in-progress') return 'is-progress'
  if (item.category === 'todo') return 'is-todo'
  return 'is-unknown'
}

function TicketStatus({
  jiraKey,
  item,
  loading,
  busy,
  locked,
  onMark,
}: {
  jiraKey?: string | null
  item?: JiraIssueStatusItem | null
  loading: boolean
  busy: boolean
  locked: boolean
  onMark: (target: 'done' | 'closed') => void
}) {
  if (!jiraKey) {
    return <span className="jira-status-pill is-draft">Draft</span>
  }
  const closed = item?.name?.trim().toLowerCase() === 'closed'
  const done = item?.name?.trim().toLowerCase() === 'done'
  const label = busy
    ? 'Updating…'
    : loading && !item?.name
      ? 'Loading…'
      : item?.name || (item?.category === 'missing' ? 'Not in Jira' : 'Status unavailable')
  return (
    <span className="jira-status">
      <span className={`jira-status-pill ${item?.name ? statusTone(item) : loading ? 'is-draft' : 'is-missing'}`}>{label}</span>
      {closed ? null : (
        <select
          className="jira-status-action"
          value=""
          disabled={locked || busy || (loading && !item?.name)}
          aria-label={`Update status for ${jiraKey}`}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            const value = e.target.value
            e.target.value = ''
            if (value === 'done' || value === 'closed') onMark(value)
          }}
        >
          <option value="">Update</option>
          <option value="done" disabled={done}>Mark done</option>
          <option value="closed">Mark closed</option>
        </select>
      )}
    </span>
  )
}

function bindStoryScreen(
  screens: FigmaScreenBinding[] | undefined,
  storyId: string,
  nodeId: string,
  jiraKey?: string | null,
): FigmaScreenBinding[] {
  return (screens || []).map((screen) => {
    if (nodeId && screen.nodeId === nodeId) {
      return { ...screen, storyId, jiraKey: jiraKey || screen.jiraKey || null }
    }
    if (screen.storyId === storyId) {
      return { ...screen, storyId: null, jiraKey: null }
    }
    return screen
  })
}

export function JiraPublishStatus({
  publish,
  jiraReady,
  pendingCount,
  projectKey,
}: {
  publish?: JiraPublishState | null
  jiraReady: boolean
  pendingCount: number
  projectKey?: string
}) {
  if (publish?.active) {
    return (
      <div className="jira-publish-status is-active" role="status">
        <Loader2 size={14} className="spin" />
        <span>
          Creating in Jira — {publish.linked} of {publish.total} linked
          {projectKey ? ` in ${projectKey}` : ''}
        </span>
      </div>
    )
  }
  if (!jiraReady && pendingCount > 0) {
    return (
      <div className="jira-publish-status" role="status">
        <span>
          {pendingCount} draft ticket{pendingCount === 1 ? '' : 's'} ready. Connect Atlassian, pick a Jira project,
          then click Create in Jira.
        </span>
      </div>
    )
  }
  if (publish?.message && !publish.active) {
    return (
      <div className={`jira-publish-status${publish.failed ? ' is-error' : ' is-done'}`} role="status">
        {publish.failed ? null : <CheckCircle2 size={14} />}
        <span>{publish.message}</span>
      </div>
    )
  }
  return null
}

export function JiraScopePanel({ state, onUpdate, sourceText, jiraPublish = null }: Props) {
  const [planningScope, setPlanningScope] = useState(false)
  const [scopeError, setScopeError] = useState<string | null>(null)
  const creatingIssues = false
  const [createError, setCreateError] = useState<string | null>(null)
  const [issueStatuses, setIssueStatuses] = useState<Record<string, JiraIssueStatusItem>>({})
  const [statusLoading, setStatusLoading] = useState(false)
  const [statusError, setStatusError] = useState<string | null>(null)
  const transitionKey: string | null = null
  const [expandedEpicIds, setExpandedEpicIds] = useState<string[]>([])
  const [replanningScope, setReplanningScope] = useState(false)

  const planInFlight = useRef(false)

  const jira = jiraConnection(state)
  const epics = state.productScope?.epics || []
  const stories = state.productScope?.stories || []
  const scopeQuestions = state.scopeQuestions || []
  const scopeAnswers = state.scopeAnswers || []
  const scopeClarifyPending =
    scopeQuestions.length > 0 &&
    unansweredRequired({ groomQuestions: scopeQuestions, groomAnswers: scopeAnswers }).length > 0
  const jiraReady = isJiraReady(state)
  const createdOnScreen = createdTicketsOnScreen(state)
  const createdOk = createdOnScreen.length
  const pendingCount = pendingJiraTicketCount(state)
  const wording = sourceText.trim()
  const autoPlan = shouldAutoStartTickets({
    hasWording: Boolean(wording),
    epicCount: epics.length,
    failed: Boolean(scopeError),
  })
  const ticketsBusy = planningScope || creatingIssues || autoPlan || Boolean(jiraPublish?.active)
  const issueKeySig = createdOnScreen.map((item) => item.jiraKey).filter(Boolean).join(',')

  const createdBySource = useMemo(() => {
    const map = new Map<string, JiraCreatedIssue>()
    for (const item of state.jiraCreatedIssues || []) {
      if (item.sourceId) map.set(item.sourceId, item)
    }
    return map
  }, [state.jiraCreatedIssues])

  const figmaAutoLinkSig = useRef('')
  useEffect(() => {
    if (!state.projectId || !state.figmaDesign?.fileKey) return
    const screens = state.figmaDesign.screens || []
    const storyRefs = figmaStoryRefs(state)
    if (!screens.length || !storyRefs.length) return
    if (screens.some((screen) => screen.storyId)) return
    const jiraIssues = (state.jiraCreatedIssues || []).filter(
      (item) => item.sourceId && item.jiraKey && item.status === 'created',
    )
    if (!jiraIssues.length) return
    const linked = autoLinkFigmaScreens(screens, storyRefs, jiraIssues)
    const after = linked.map((screen) => `${screen.nodeId}:${screen.storyId || ''}:${screen.jiraKey || ''}`).join('|')
    const sig = `${state.figmaDesign.fileKey}:${after}`
    if (figmaAutoLinkSig.current === sig) return
    figmaAutoLinkSig.current = sig
    onUpdate({ figmaDesign: { ...state.figmaDesign, screens: linked } })
    void saveFigmaDesign({
      projectId: state.projectId,
      fileKey: state.figmaDesign.fileKey,
      fileUrl: state.figmaDesign.fileUrl,
      fileName: state.figmaDesign.fileName,
      syncJira: state.figmaDesign.syncJira !== false,
      screens: linked,
      stories: storyRefs,
      jiraIssues: jiraIssues.map((item) => ({ sourceId: item.sourceId as string, jiraKey: item.jiraKey as string })),
    }).catch(() => undefined)
  }, [onUpdate, state.figmaDesign, state.jiraCreatedIssues, state.productScope, state.projectId])

  const runProductScope = useCallback(async () => {
    if (planInFlight.current) return
    if (!wording) {
      setScopeError('Clear the requirement wording first so Blink can propose epics and stories.')
      return
    }
    planInFlight.current = true
    setPlanningScope(true)
    setScopeError(null)
    markTicketsPipelineBusy(true)
    try {
      const patch = await planScopeFromWording(state, wording)
      onUpdate(patch)
    } catch (err) {
      setScopeError(err instanceof Error ? err.message : 'Could not plan product scope.')
    } finally {
      planInFlight.current = false
      setPlanningScope(false)
      if (!isJiraReady(state)) markTicketsPipelineBusy(false)
    }
  }, [onUpdate, state, wording])

  const handleScopeReplan = useCallback(async () => {
    if (scopeClarifyPending) {
      setScopeError('Answer the scope questions below before re-planning.')
      return
    }
    if (!wording || planInFlight.current) return
    planInFlight.current = true
    setReplanningScope(true)
    setScopeError(null)
    markTicketsPipelineBusy(true)
    try {
      const patch = await planScopeFromWording(state, wording, undefined, {
        refresh: true,
        productScope: state.productScope,
        answers: scopeAnswers,
        skipClarify: true,
      })
      onUpdate(patch)
    } catch (err) {
      setScopeError(err instanceof Error ? err.message : 'Could not re-plan product scope.')
    } finally {
      planInFlight.current = false
      setReplanningScope(false)
      if (!isJiraReady(state)) markTicketsPipelineBusy(false)
    }
  }, [onUpdate, scopeAnswers, scopeClarifyPending, state, wording])

  const handleCreateInJira = useCallback(async () => {
    setCreateError(
      'Blink does not create Jira issues. Create the proposed epics and stories manually in Jira, then return the resulting links as evidence.',
    )
  }, [])

  useEffect(() => {
    if (!state.projectId || !jiraReady || !issueKeySig) {
      setIssueStatuses({})
      setStatusLoading(false)
      return
    }
    const projectId = state.projectId
    const issueKeys = issueKeySig.split(',')
    let cancelled = false
    const load = async (silent: boolean) => {
      if (!silent) setStatusLoading(true)
      try {
        const result = await fetchJiraIssueStatuses({ projectId, issueKeys })
        if (cancelled) return
        const next: Record<string, JiraIssueStatusItem> = {}
        for (const item of result.issues) {
          if (item.key) next[item.key.toUpperCase()] = item
        }
        setIssueStatuses(next)
        setStatusError(null)
      } catch (err) {
        if (!cancelled && !silent) {
          setStatusError(err instanceof Error ? err.message : 'Could not load Jira statuses.')
        }
      } finally {
        if (!cancelled) setStatusLoading(false)
      }
    }
    void load(false)
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load(true)
    }, 30_000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load(true)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [issueKeySig, jiraReady, state.projectId])

  const markTicket = useCallback(
    (issueKey: string, target: 'done' | 'closed') => {
      setStatusError(`Mark ${issueKey} as ${target} manually in Jira, then refresh its status in Blink.`)
    },
    [],
  )

  const statusFor = useCallback(
    (issueKey?: string | null) => (issueKey ? issueStatuses[issueKey.toUpperCase()] : undefined),
    [issueStatuses],
  )

  const toggleEpic = useCallback((epicId: string) => {
    setExpandedEpicIds((ids) => (ids.includes(epicId) ? ids.filter((id) => id !== epicId) : [...ids, epicId]))
  }, [])

  useEffect(() => {
    if (jiraReady && createError && /connect atlassian/i.test(createError)) {
      setCreateError(null)
    }
  }, [createError, jiraReady])

  useEffect(() => {
    if (!autoPlan || planningScope || planInFlight.current) return
    void runProductScope()
  }, [autoPlan, planningScope, runProductScope])

  const canCreate = pendingCount > 0 && !planningScope
  const alreadyCreated = createdOk > 0

  return (
    <section className="card ref-card jira-scope-panel">
      <div className="jira-scope-head">
        <div className="req-section-head">
          <h3>Epics for Jira</h3>
          <p>Review proposed epics and stories here. Create and transition Jira issues manually; Blink does not modify Jira.</p>
        </div>
        <button
          type="button"
          className="text-btn"
          disabled={planningScope || !wording}
          onClick={() => void runProductScope()}
        >
          {planningScope ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}
          {planningScope ? 'Planning…' : 'Run planner'}
        </button>
      </div>

      <div className="jira-scope-metrics">
        <span className="jira-chip epic">{epics.length} epic{epics.length === 1 ? '' : 's'}</span>
        <span className="jira-chip story">{stories.length} stor{stories.length === 1 ? 'y' : 'ies'}</span>
        {jiraReady ? (
          <span className="jira-chip project">Target {jira?.projectKey}</span>
        ) : (
          <span className="jira-chip muted">Jira project not selected</span>
        )}
        {pendingCount > 0 ? (
          <span className="jira-chip muted">{pendingCount} not in Jira yet</span>
        ) : null}
      </div>

      {planningScope || autoPlan ? <p className="muted">Planning epics and stories…</p> : null}
      {replanningScope ? <p className="muted">Re-planning epics and stories from your scope choices…</p> : null}

      {scopeQuestions.length > 0 ? (
        <div className="scope-clarify-panel groom-panel">
          <div className="req-section-head">
            <h4>Shape the backlog</h4>
            <p>Choose how v1 should be split. Then re-plan to refresh epics and stories.</p>
          </div>
          {scopeQuestions.map((question: GroomQuestion) => {
            const rows = scopeAnswersForQuestion(question.id, scopeAnswers)
            const otherRow = rows.find((item) => item.optionId === 'other')
            const otherSelected = Boolean(otherRow)
            return (
              <fieldset key={question.id} className="groom-question-card">
                <legend>{question.text}</legend>
                <div className="groom-options">
                  {question.options.map((option) => (
                    <label key={option.id} className="groom-option">
                      <input
                        type={question.allowMultiple ? 'checkbox' : 'radio'}
                        name={`scope-${question.id}`}
                        checked={isScopeOptionSelected(question, scopeAnswers, option.id)}
                        onChange={() =>
                          onUpdate({
                            scopeAnswers: patchScopePick(
                              { scopeQuestions, scopeAnswers },
                              question.id,
                              option.id,
                              option.label,
                            ),
                          })
                        }
                      />
                      <span>
                        <strong>{option.label}</strong>
                        {option.description ? <span className="muted"> — {option.description}</span> : null}
                      </span>
                    </label>
                  ))}
                  {question.allowOther !== false ? (
                    <label className="groom-option">
                      <input
                        type={question.allowMultiple ? 'checkbox' : 'radio'}
                        name={`scope-${question.id}`}
                        checked={otherSelected}
                        onChange={(e) =>
                          onUpdate({
                            scopeAnswers: patchScopeToggleOther(
                              { scopeQuestions, scopeAnswers },
                              question.id,
                              e.target.checked,
                            ),
                          })
                        }
                      />
                      <span>Other</span>
                    </label>
                  ) : null}
                  {otherSelected ? (
                    <textarea
                      className="full-input groom-other-input"
                      rows={2}
                      placeholder="Describe your scope preference…"
                      value={otherRow?.otherText ?? ''}
                      onChange={(e) =>
                        onUpdate({
                          scopeAnswers: patchScopeOther(
                            { scopeQuestions, scopeAnswers },
                            question.id,
                            e.target.value,
                          ),
                        })
                      }
                    />
                  ) : null}
                </div>
                {!isAnswered(question, scopeAnswers) ? (
                  <p className="muted groom-question-hint">Pick an option to include this in re-planning.</p>
                ) : null}
              </fieldset>
            )
          })}
          <button
            type="button"
            className="primary-btn"
            disabled={scopeClarifyPending || replanningScope || planningScope || !wording}
            onClick={() => void handleScopeReplan()}
          >
            {replanningScope ? 'Re-planning…' : 'Re-plan with these choices'}
          </button>
        </div>
      ) : null}

      <JiraPublishStatus
        publish={
          jiraPublish ||
          (creatingIssues
            ? {
                active: true,
                total: Math.max(pendingCount, createdOk),
                linked: createdOk,
                failed: 0,
                message: `Creating ${pendingCount} ticket(s) in Jira…`,
              }
            : null)
        }
        jiraReady={jiraReady}
        pendingCount={pendingCount}
        projectKey={jira?.projectKey}
      />

      {!ticketsBusy && !wording && (
        <div className="jira-scope-empty">
          <Layers size={22} />
          <p>Save the requirement wording first. This panel then proposes the Jira backlog from that text.</p>
        </div>
      )}

      {!ticketsBusy && wording && epics.length === 0 && (
        <div className="jira-scope-empty">
          <Layers size={22} />
          <p>{scopeError || 'No epics yet. Retry the planner if this stays empty.'}</p>
        </div>
      )}

      {scopeError && epics.length > 0 && <p className="connect-error">{scopeError}</p>}

      {epics.length > 0 && (
        <div className="jira-epic-list">
          {epics.map((epic) => {
            const childStories = stories.filter((story) => story.epicId === epic.id || epic.storyIds?.includes(story.id))
            const epicCreated = createdBySource.get(epic.id)
            const canExpand = childStories.length > 0 || Boolean(epic.objective)
            const open = canExpand && expandedEpicIds.includes(epic.id)
            const storyLabel = `${childStories.length} ${childStories.length === 1 ? 'story' : 'stories'}`
            return (
              <article
                key={epic.id}
                className={`jira-epic-card${epicCreated?.status === 'created' ? ' is-linked' : ''}${open ? ' is-open' : ''}`}
              >
                <header className="jira-row">
                  {canExpand ? (
                    <button
                      type="button"
                      className="jira-epic-toggle"
                      aria-expanded={open}
                      aria-label={open ? `Hide stories for ${epic.title}` : `Show stories for ${epic.title}`}
                      onClick={() => toggleEpic(epic.id)}
                    >
                      <ChevronRight size={16} className={open ? 'chevron open' : 'chevron'} aria-hidden />
                      <span className="jira-type epic">Epic</span>
                      <strong className="jira-row-title">{epic.title}</strong>
                      {childStories.length > 0 ? <span className="jira-story-count">{storyLabel}</span> : null}
                    </button>
                  ) : (
                    <div className="jira-epic-toggle is-static">
                      <span className="jira-type epic">Epic</span>
                      <strong className="jira-row-title">{epic.title}</strong>
                    </div>
                  )}
                  <div className="jira-row-meta">
                    <TicketBadge created={epicCreated} baseUrl={jira?.baseUrl} />
                    {epicCreated?.status === 'creating' || epicCreated?.status === 'failed' ? null : (
                      <TicketStatus
                        jiraKey={epicCreated?.status === 'created' ? epicCreated.jiraKey : null}
                        item={statusFor(epicCreated?.jiraKey)}
                        loading={statusLoading && Boolean(epicCreated?.jiraKey)}
                        busy={transitionKey === epicCreated?.jiraKey}
                        locked={ticketsBusy}
                        onMark={(target) => {
                          if (epicCreated?.jiraKey) void markTicket(epicCreated.jiraKey, target)
                        }}
                      />
                    )}
                  </div>
                </header>
                {open && epic.objective ? <p>{epic.objective}</p> : null}
                {open && childStories.length > 0 && (
                  <ul>
                    {childStories.map((story) => {
                      const storyCreated = createdBySource.get(story.id)
                      return (
                        <li
                          key={story.id}
                          className={`jira-row${storyCreated?.status === 'created' ? ' is-linked' : ''}`}
                        >
                          <span className="jira-type story">Story</span>
                          <span className="jira-row-title">{story.title}</span>
                          <div className="jira-row-meta">
                            <TicketBadge created={storyCreated} baseUrl={jira?.baseUrl} />
                            {(state.figmaDesign?.screens || []).length > 0 ? (
                              <label className="figma-story-bind-wrap">
                                <span className="sr-only">Link a Figma screen to this Jira story</span>
                                <select
                                  className={`figma-story-bind${
                                    state.figmaDesign?.screens?.some((screen) => screen.storyId === story.id)
                                      ? ' is-linked'
                                      : ''
                                  }`}
                                  value={
                                    state.figmaDesign?.screens?.find((screen) => screen.storyId === story.id)?.nodeId
                                    || ''
                                  }
                                  title="Link a Figma frame to this Jira story so design changes can update the ticket"
                                  onChange={(e) => {
                                    const nodeId = e.target.value
                                    const screens = bindStoryScreen(
                                      state.figmaDesign?.screens,
                                      story.id,
                                      nodeId,
                                      storyCreated?.jiraKey,
                                    )
                                    onUpdate({ figmaDesign: { ...state.figmaDesign, screens } })
                                    if (state.projectId && state.figmaDesign?.fileKey) {
                                      void saveFigmaDesign({
                                        projectId: state.projectId,
                                        fileKey: state.figmaDesign.fileKey,
                                        fileUrl: state.figmaDesign.fileUrl,
                                        fileName: state.figmaDesign.fileName,
                                        syncJira: state.figmaDesign.syncJira !== false,
                                        screens,
                                        stories: figmaStoryRefs({ ...state, figmaDesign: { ...state.figmaDesign, screens } }),
                                        jiraIssues: figmaJiraRefs(state),
                                      }).catch(() => undefined)
                                    }
                                  }}
                                >
                                  <option value="">Link screen</option>
                                  {(state.figmaDesign?.screens || []).map((screen) => (
                                    <option key={screen.nodeId} value={screen.nodeId}>
                                      {screen.name}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            ) : null}
                            {storyCreated?.status === 'creating' || storyCreated?.status === 'failed' ? null : (
                              <TicketStatus
                                jiraKey={storyCreated?.status === 'created' ? storyCreated.jiraKey : null}
                                item={statusFor(storyCreated?.jiraKey)}
                                loading={statusLoading && Boolean(storyCreated?.jiraKey)}
                                busy={transitionKey === storyCreated?.jiraKey}
                                locked={ticketsBusy}
                                onMark={(target) => {
                                  if (storyCreated?.jiraKey) void markTicket(storyCreated.jiraKey, target)
                                }}
                              />
                            )}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </article>
            )
          })}
        </div>
      )}

      {createError && <p className="connect-error">{createError}</p>}
      {statusError && <p className="connect-error">{statusError}</p>}

      {alreadyCreated || (epics.length > 0 && !ticketsBusy) ? (
        <div className="card-footer-actions">
          {createdOk > 0 && (
            <span className="quiet-hint">
              <CheckCircle2 size={14} /> {createdOk} from this screen in {jira?.projectKey}
            </span>
          )}
          <span className="action-spacer" />
          <button type="button" className="primary-btn" disabled={!canCreate} onClick={() => void handleCreateInJira()}>
            {creatingIssues || jiraPublish?.active ? <Loader2 size={16} className="spin" /> : <Ticket size={16} />}
            View manual Jira instructions
          </button>
        </div>
      ) : null}
    </section>
  )
}

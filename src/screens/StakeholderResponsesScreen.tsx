import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Bell,
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  MessageSquareText,
  RefreshCw,
  RotateCcw,
  Sparkles,
} from 'lucide-react'
import {
  summarizeDiscussion,
  groomingStakeholderPack,
  groomingRevision,
  groomingSignOffCapture,
} from '../api/blink'
import {
  groomingLoopSettled,
  mergeScopeOverlays,
  requirementTextFromState,
  stakeholderFeedbackFromState,
} from '../wizard/stakeholderSync'
import { useDeveloperMode } from '../developer/DeveloperModeContext'
import { assigneeForQuestion } from '../wizard/questions'
import { roleLabel } from '../wizard/stakeholders'
import type { JiraThreadReply, QuestionResponse, StakeholderQuestion, WizardState } from '../wizard/types'

interface Props {
  state: WizardState
  onUpdate?: (patch: Partial<WizardState>) => void
  onSimulateResponses: () => void | Promise<void>
  onResetSimulatedReplies?: () => void | Promise<void>
  onRefreshJira?: () => void
  onUpdateResponse?: (questionId: string, patch: Partial<QuestionResponse>) => void
  onResolveAllLatest?: () => void
  onPatchQuestion?: (questionId: string, patch: Partial<StakeholderQuestion>) => void
  refreshing?: boolean
  simulating?: boolean
  resetting?: boolean
  /** When true, omit outer page header (used inside Stakeholder Q&A). */
  embedded?: boolean
}

type Filter = 'all' | 'responded' | 'discussion' | 'pending'
type GroomBusy = 'pack' | 'revision' | 'signoff' | 'auto' | null

function isResolved(response?: QuestionResponse, q?: { jiraReplyBody?: string | null }): boolean {
  const text = response?.response?.trim() || q?.jiraReplyBody?.trim() || ''
  return response?.status === 'answered' && Boolean(text)
}

function outboundHandled(q: StakeholderQuestion, state: WizardState): boolean {
  const emailed = q.sent
  const jiraDone =
    (q.jiraCommentStatus === 'posted' || q.jiraCommentStatus === 'replied') && Boolean(q.jiraCommentId)
  const answered = state.responses.find((r) => r.questionId === q.id)?.status === 'answered'
  return Boolean(emailed || jiraDone || answered)
}

/** Nothing left for the human to pick: no leftover send/resolve work, no G-GROOM reject. */
export function shouldAutoRunGroomingLoop(state: WizardState): boolean {
  if (state.groomRejectPending) return false
  if (state.questions.length === 0) return true
  if (state.questions.some((q) => !outboundHandled(q, state))) return false
  if (
    state.questions.some((q) => {
      if (!q.mandatory) return false
      const response = state.responses.find((r) => r.questionId === q.id)
      return !isResolved(response, q)
    })
  ) {
    return false
  }
  return !state.questions.some((q) => {
    const response = state.responses.find((r) => r.questionId === q.id)
    return !isResolved(response, q)
  })
}

function statusLabel(
  response?: QuestionResponse,
  q?: { jiraCommentStatus?: string; jiraThread?: JiraThreadReply[]; jiraThreadStale?: boolean },
): { label: string; tone: string } {
  if (isResolved(response)) {
    return {
      label: q?.jiraThreadStale ? 'Resolved · new activity' : 'Resolved',
      tone: q?.jiraThreadStale ? 'info' : 'answered',
    }
  }
  if ((q?.jiraThread?.length || 0) > 0 || response?.status === 'discussion') {
    return { label: `Discussion · ${q?.jiraThread?.length || 0}`, tone: 'info' }
  }
  if (q?.jiraCommentStatus === 'posted') return { label: 'Awaiting replies', tone: 'pending' }
  return { label: 'Pending', tone: 'pending' }
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}

export function StakeholderResponsesScreen({
  state,
  onUpdate,
  onSimulateResponses,
  onResetSimulatedReplies,
  onRefreshJira,
  onUpdateResponse,
  onResolveAllLatest,
  onPatchQuestion,
  refreshing,
  simulating,
  resetting,
  embedded,
}: Props) {
  const [filter, setFilter] = useState<Filter>('all')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [summaryDraft, setSummaryDraft] = useState<Record<string, string>>({})
  const [summarizingId, setSummarizingId] = useState<string | null>(null)
  const [summaryMeta, setSummaryMeta] = useState<Record<string, string>>({})
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [groomBusy, setGroomBusy] = useState<GroomBusy>(null)
  const [groomError, setGroomError] = useState<string | null>(null)
  const [revisionSkipped, setRevisionSkipped] = useState(false)

  useEffect(() => {
    if (!onRefreshJira) return
    const hasPosted = state.questions.some(
      (q) =>
        q.jiraIssueKey &&
        (q.jiraCommentStatus === 'posted' ||
          q.jiraCommentStatus === 'replied' ||
          q.jiraCommentStatus === 'discussion' ||
          q.jiraCommentStatus === 'resolved') &&
        Boolean(q.jiraCommentId),
    )
    if (hasPosted) onRefreshJira()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const rows = useMemo(
    () =>
      state.questions.map((q) => {
        const assignee = assigneeForQuestion(state, q.assignedRoleId)
        const response = state.responses.find((r) => r.questionId === q.id)
        const thread = q.jiraThread || []
        const resolved = isResolved(response, q)
        return { q, assignee, response, thread, resolved }
      }),
    [state],
  )

  const filtered = rows.filter(({ response, thread, resolved }) => {
    if (filter === 'all') return true
    if (filter === 'responded') return resolved
    if (filter === 'discussion') return !resolved && (thread.length > 0 || response?.status === 'discussion')
    return !resolved && thread.length === 0 && response?.status !== 'discussion'
  })

  const mandatory = state.questions.filter((q) => q.mandatory)
  const answeredMandatory = mandatory.filter((q) => {
    const response = state.responses.find((r) => r.questionId === q.id)
    return isResolved(response, q)
  })
  const openDiscussions = rows.filter((r) => !r.resolved && r.thread.length > 0).length

  const startEdit = (questionId: string, current: string) => {
    setEditingId(questionId)
    setDraft(current)
  }

  const saveEdit = (questionId: string) => {
    const text = draft.trim()
    if (!text || !onUpdateResponse) return
    void onUpdateResponse(questionId, {
      status: 'answered',
      response: text,
      receivedAt: new Date().toISOString(),
      source: 'manual',
    })
    setEditingId(null)
    setDraft('')
  }

  const applyProposedAnswer = (questionId: string, text: string) => {
    if (!onUpdateResponse || !text.trim()) return
    void onUpdateResponse(questionId, {
      status: 'answered',
      response: text.trim(),
      receivedAt: new Date().toISOString(),
      source: 'mcq',
    })
  }

  const useReply = (questionId: string, reply: JiraThreadReply) => {
    onUpdateResponse?.(questionId, {
      status: 'answered',
      response: reply.body,
      receivedAt: reply.created || new Date().toISOString(),
      source: 'thread',
      author: reply.author || null,
      jiraCommentId: reply.commentId,
      resolvedFromCommentId: reply.commentId,
    })
  }

  const handleSummarize = async (q: StakeholderQuestion) => {
    const thread = q.jiraThread || []
    if (!thread.length) return
    setSummarizingId(q.id)
    setSummaryError(null)
    try {
      const res = await summarizeDiscussion({
        question: q.question,
        parentBody: q.jiraParentBody || null,
        issueKey: q.jiraIssueKey || null,
        replies: thread.map((r) => ({
          commentId: r.commentId,
          author: r.author,
          body: r.body,
          created: r.created,
          parentId: r.parentId || q.jiraParentCommentId || q.jiraCommentId || null,
        })),
      })
      const summary = res.summary || ''
      const resolved = res.resolvedAnswer || ''
      setSummaryDraft((prev) => ({ ...prev, [q.id]: summary }))
      setSummaryMeta((prev) => ({
        ...prev,
        [q.id]: res.source === 'agent' ? 'AI summary' : 'Local digest (not LLM)',
      }))
      onPatchQuestion?.(q.id, { jiraThreadSummary: summary })
      startEdit(q.id, resolved || summary)
      if (res.source === 'local') {
        setSummaryError(
          `Used local digest (not LLM).${res.agentError ? ` Agent: ${res.agentError}` : ''}`,
        )
      } else {
        setSummaryError(null)
      }
    } catch (e) {
      setSummaryError(e instanceof Error ? e.message : 'Could not summarize discussion.')
    } finally {
      setSummarizingId(null)
    }
  }

  const requirementText = requirementTextFromState(state)
  const stakeholderFeedback = stakeholderFeedbackFromState(state)
  const revisionNeeded = Boolean(stakeholderFeedback.trim())
  const autoReady = shouldAutoRunGroomingLoop(state)
  const loopSettled = groomingLoopSettled(state)
  const { state: developerState } = useDeveloperMode()
  const groomRunInFlightRef = useRef(false)

  const runPack = async () => {
    if (!state.projectId || !onUpdate) return
    setGroomBusy('pack')
    setGroomError(null)
    try {
      const res = await groomingStakeholderPack(state.projectId, {
        requirementText,
        overlayFiles: state.scopeOverlays || [],
        issueId: state.productScope?.storyIds?.[0],
      })
      if (res.status !== 'ok') throw new Error(res.message || 'Stakeholder pack failed')
      onUpdate({
        stakeholderPack: res.stakeholderPack || null,
        scopeOverlays: mergeScopeOverlays(state.scopeOverlays, res.overlayFiles),
        nextSdlcCommand: res.nextCommand || '/grooming-revision',
      })
    } catch (e) {
      setGroomError(e instanceof Error ? e.message : 'Could not build stakeholder pack.')
    } finally {
      setGroomBusy(null)
    }
  }

  const runRevision = async () => {
    if (!state.projectId || !onUpdate) return
    setGroomBusy('revision')
    setGroomError(null)
    try {
      const res = await groomingRevision(state.projectId, {
        requirementText,
        stakeholderFeedback,
        overlayFiles: state.scopeOverlays || [],
        groomingRevision: state.groomingRevision,
        issueId: state.stakeholderPack?.issueId,
      })
      if (res.status !== 'ok') throw new Error(res.message || 'Grooming revision failed')
      const draftText = res.requirementDraft || res.groomingRevision?.requirementMarkdown || ''
      onUpdate({
        groomingRevision: res.groomingRevision || null,
        groomDraft: draftText || state.groomDraft,
        requirementsText: draftText || state.requirementsText,
        scopeOverlays: mergeScopeOverlays(state.scopeOverlays, res.overlayFiles),
        nextSdlcCommand: res.nextCommand || '/grooming-sign-off-capture',
        groomingLoopFeedbackAt: stakeholderFeedback,
      })
    } catch (e) {
      setGroomError(e instanceof Error ? e.message : 'Could not apply grooming revision.')
    } finally {
      setGroomBusy(null)
    }
  }

  const runSignOff = async () => {
    if (!state.projectId || !onUpdate) return
    setGroomBusy('signoff')
    setGroomError(null)
    try {
      const res = await groomingSignOffCapture(state.projectId, {
        requirementText: state.groomDraft || requirementText,
        stakeholderFeedback,
        overlayFiles: state.scopeOverlays || [],
        issueId: state.groomingRevision?.issueId || state.stakeholderPack?.issueId,
      })
      if (res.status !== 'ok') throw new Error(res.message || 'Sign-off capture failed')
      onUpdate({
        groomingSignOff: res.groomingSignOff || null,
        scopeOverlays: mergeScopeOverlays(state.scopeOverlays, res.overlayFiles),
        nextSdlcCommand: res.nextCommand || '/sdlc-next',
        groomingLoopFeedbackAt: stakeholderFeedback,
      })
    } catch (e) {
      setGroomError(e instanceof Error ? e.message : 'Could not capture sign-off summary.')
    } finally {
      setGroomBusy(null)
    }
  }

  const runAutoGroom = async () => {
    if (!state.projectId || !onUpdate || !requirementText) return
    const projectId = state.projectId
    let overlays = state.scopeOverlays || []
    let pack = state.stakeholderPack || null
    let revision = state.groomingRevision || null
    let draftText = state.groomDraft || requirementText
    const feedback = stakeholderFeedback.trim()
    const needPack = !pack
    const needRevision =
      Boolean(feedback) && (!revision || state.groomingLoopFeedbackAt !== feedback)
    const needSignOff = !state.groomingSignOff || state.groomingLoopFeedbackAt !== feedback
    if (!needPack && !needRevision && !needSignOff) return

    setGroomError(null)
    setRevisionSkipped(!needRevision)
    try {
      if (needRevision) {
        if (needPack) {
          setGroomBusy('pack')
          const res = await groomingStakeholderPack(projectId, {
            requirementText,
            overlayFiles: overlays,
            issueId: state.productScope?.storyIds?.[0],
          })
          if (res.status !== 'ok') throw new Error(res.message || 'Stakeholder pack failed')
          pack = res.stakeholderPack || pack
          overlays = mergeScopeOverlays(overlays, res.overlayFiles)
          onUpdate({
            stakeholderPack: pack,
            scopeOverlays: overlays,
            nextSdlcCommand: res.nextCommand || '/grooming-revision',
          })
        }
        setGroomBusy('revision')
        const rev = await groomingRevision(projectId, {
          requirementText: draftText,
          stakeholderFeedback: feedback,
          overlayFiles: overlays,
          groomingRevision: revision,
          issueId: pack?.issueId,
        })
        if (rev.status !== 'ok') throw new Error(rev.message || 'Grooming revision failed')
        revision = rev.groomingRevision || revision
        draftText = rev.requirementDraft || rev.groomingRevision?.requirementMarkdown || draftText
        overlays = mergeScopeOverlays(overlays, rev.overlayFiles)
          onUpdate({
            groomingRevision: revision,
            groomDraft: draftText,
            requirementsText: draftText,
            scopeOverlays: overlays,
            nextSdlcCommand: rev.nextCommand || '/grooming-sign-off-capture',
          })
          if (needSignOff) {
            setGroomBusy('signoff')
            const sign = await groomingSignOffCapture(projectId, {
              requirementText: draftText,
              stakeholderFeedback: feedback,
              overlayFiles: overlays,
              issueId: revision?.issueId || pack?.issueId,
            })
            if (sign.status !== 'ok') throw new Error(sign.message || 'Sign-off capture failed')
            overlays = mergeScopeOverlays(overlays, sign.overlayFiles)
            onUpdate({
              groomingSignOff: sign.groomingSignOff || null,
              scopeOverlays: overlays,
              nextSdlcCommand: sign.nextCommand || '/sdlc-next',
              groomingLoopFeedbackAt: feedback,
            })
          } else {
            onUpdate({ groomingLoopFeedbackAt: feedback })
          }
        return
      }

      setGroomBusy('auto')
      const packPromise = needPack
        ? groomingStakeholderPack(projectId, {
            requirementText,
            overlayFiles: overlays,
            issueId: state.productScope?.storyIds?.[0],
          })
        : Promise.resolve(null)
      const signPromise = needSignOff
        ? groomingSignOffCapture(projectId, {
            requirementText: draftText,
            stakeholderFeedback: feedback,
            overlayFiles: overlays,
            issueId: pack?.issueId,
          })
        : Promise.resolve(null)
      const [packRes, signRes] = await Promise.all([packPromise, signPromise])
      if (packRes) {
        if (packRes.status !== 'ok') throw new Error(packRes.message || 'Stakeholder pack failed')
        pack = packRes.stakeholderPack || pack
        overlays = mergeScopeOverlays(overlays, packRes.overlayFiles)
      }
      if (signRes) {
        if (signRes.status !== 'ok') throw new Error(signRes.message || 'Sign-off capture failed')
        overlays = mergeScopeOverlays(overlays, signRes.overlayFiles)
      }
      onUpdate({
        ...(packRes
          ? { stakeholderPack: pack }
          : {}),
        ...(signRes
          ? { groomingSignOff: signRes.groomingSignOff || null }
          : {}),
        scopeOverlays: overlays,
        nextSdlcCommand: signRes?.nextCommand || packRes?.nextCommand || '/sdlc-next',
        groomingLoopFeedbackAt: feedback,
      })
    } catch (e) {
      setGroomError(e instanceof Error ? e.message : 'Could not run the grooming loop.')
    } finally {
      setGroomBusy(null)
    }
  }

  useEffect(() => {
    if (!autoReady || loopSettled || !state.projectId || !onUpdate || !requirementText || groomBusy) {
      return
    }
    if (groomRunInFlightRef.current) return

    const timer = window.setTimeout(() => {
      if (groomRunInFlightRef.current || groomingLoopSettled(state)) return
      groomRunInFlightRef.current = true
      setGroomError(null)
      void runAutoGroom().finally(() => {
        groomRunInFlightRef.current = false
      })
    }, 400)

    return () => window.clearTimeout(timer)
    // Re-run when resolved Q&A changes; not only once per project.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    autoReady,
    loopSettled,
    stakeholderFeedback,
    state.projectId,
    state.groomingLoopFeedbackAt,
    state.groomingRevision?.revisionNumber,
    requirementText,
    groomBusy,
  ])

  return (
    <div className={embedded ? 'stakeholder-qa-pane' : 'screen'}>
      {!embedded ? (
        <div className="screen-header">
          <h2>Stakeholder Responses</h2>
          <p>Read replies and resolve one answer Blink can continue with.</p>
        </div>
      ) : null}

      <section className="sdlc-panel" style={{ marginBottom: '1.5rem' }}>
        <div className="sdlc-panel__head">
          <Sparkles size={18} />
          <div>
            <h3>Requirement grooming</h3>
            <p className="muted">
              {autoReady
                ? 'Blink updates the requirement draft from your answers in the background. You only need to acknowledge G-GROOM when ready.'
                : 'Resolve clarifications first. Grooming agents run automatically when nothing is left to send or answer.'}
            </p>
          </div>
        </div>
        <div className="grooming-status-block">
          {groomBusy ? (
            <p className="muted small grooming-status grooming-status--busy">
              <Loader2 className="spin" size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
              {groomBusy === 'pack'
                ? 'Building stakeholder pack…'
                : groomBusy === 'revision'
                  ? 'Updating requirement from your answers…'
                  : groomBusy === 'signoff'
                    ? 'Capturing grooming sign-off summary…'
                    : 'Finishing grooming steps…'}
            </p>
          ) : loopSettled ? (
            <p className="muted small grooming-status grooming-status--ready">
              <CheckCircle2 size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
              Requirement draft is up to date with your answers.
              {state.groomingRevision?.revisionNumber
                ? ` Revision #${state.groomingRevision.revisionNumber}.`
                : ''}
            </p>
          ) : autoReady ? (
            <p className="muted small grooming-status">Preparing grooming update…</p>
          ) : (
            <p className="muted small grooming-status">Waiting for clarifications to be resolved.</p>
          )}
          {revisionSkipped && !revisionNeeded && !state.groomingRevision && loopSettled ? (
            <p className="muted small">No stakeholder feedback to apply — revision skipped.</p>
          ) : null}
          {groomError ? (
            <div className="grooming-status-actions">
              <p className="error-text">{groomError}</p>
              <button
                type="button"
                className="secondary-btn"
                disabled={!state.projectId || !requirementText || !!groomBusy}
                onClick={() => {
                  setGroomError(null)
                  void runAutoGroom()
                }}
              >
                Retry grooming
              </button>
            </div>
          ) : null}
        </div>
        {developerState.enabled ? (
          <details className="grooming-advanced" style={{ marginTop: '0.75rem' }}>
            <summary className="muted small">Developer: manual grooming steps</summary>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.5rem' }}>
              <button
                type="button"
                className="ghost-btn"
                disabled={!state.projectId || !requirementText || !!groomBusy}
                onClick={() => void runPack()}
              >
                Stakeholder pack
              </button>
              <button
                type="button"
                className="ghost-btn"
                disabled={!state.projectId || !state.stakeholderPack || !revisionNeeded || !!groomBusy}
                onClick={() => void runRevision()}
              >
                Apply revision
              </button>
              <button
                type="button"
                className="ghost-btn"
                disabled={
                  !state.projectId ||
                  !state.stakeholderPack ||
                  (revisionNeeded && !state.groomingRevision) ||
                  !!groomBusy
                }
                onClick={() => void runSignOff()}
              >
                Sign-off capture
              </button>
            </div>
          </details>
        ) : null}
        {(() => {
          const emptyQa = state.questions.length === 0
          const rejectBlocks = Boolean(state.groomRejectPending && !loopSettled)
          const canAck = Boolean(onUpdate) && !rejectBlocks && (emptyQa || loopSettled)
          if (!canAck && !state.groomAcknowledged && !state.groomRejectPending) return null
          return (
            <div style={{ marginTop: '0.75rem' }}>
              {state.groomAcknowledged ? (
                <>
                  <p className="muted small">
                    <CheckCircle2 size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                    G-GROOM acknowledged (human) — not an approve-gate; classify can proceed.
                  </p>
                  <button
                    type="button"
                    className="secondary-btn"
                    disabled={!onUpdate}
                    onClick={() => {
                      onUpdate?.({
                        groomAcknowledged: false,
                        groomRejectPending: true,
                        groomingSignOff: null,
                        groomingLoopFeedbackAt: null,
                      })
                    }}
                  >
                    Reject G-GROOM
                  </button>
                </>
              ) : rejectBlocks ? (
                <p className="muted small">
                  G-GROOM was rejected. Grooming will re-run from your answers; acknowledge again when the
                  requirement shows as up to date.
                </p>
              ) : (
                <>
                  <p className="muted small" style={{ marginBottom: '0.5rem' }}>
                    {emptyQa
                      ? 'No leftover clarifications. Acknowledge G-GROOM before classify and planning. This is not an approve-gate.'
                      : loopSettled
                        ? 'Acknowledge G-GROOM before continuing to Project Shape and classify. This is not an approve-gate.'
                        : 'Finish resolving clarifications (or wait for grooming to finish), then acknowledge G-GROOM.'}
                  </p>
                  <button
                    type="button"
                    className="primary-btn"
                    disabled={!onUpdate || (!emptyQa && !loopSettled)}
                    onClick={() => {
                      onUpdate?.({ groomAcknowledged: true, groomRejectPending: false })
                    }}
                  >
                    Acknowledge G-GROOM
                  </button>
                </>
              )}
            </div>
          )
        })()}
      </section>

      {state.questions.length === 0 ? (
        <section className="card">
          <div className="empty-state-block">
            <h3>No responses to track</h3>
            <p>
              {groomBusy
                ? 'Grooming is running in the background. Acknowledge G-GROOM when you are ready.'
                : 'Acknowledge G-GROOM above, then continue to Project Shape.'}
            </p>
          </div>
        </section>
      ) : (
        <>
          <div className="response-hero-stats">
            <div>
              <strong>
                {answeredMandatory.length}/{mandatory.length || 0}
              </strong>
              <span>Mandatory resolved</span>
            </div>
            <div>
              <strong>{openDiscussions}</strong>
              <span>Open discussions</span>
            </div>
            <div>
              <strong>{rows.filter((r) => r.resolved).length}</strong>
              <span>Resolved answers</span>
            </div>
          </div>

          <div className="tab-row">
            {(['all', 'discussion', 'responded', 'pending'] as Filter[]).map((f) => (
              <button
                key={f}
                type="button"
                className={`tab-btn ${filter === f ? 'active' : ''}`}
                onClick={() => setFilter(f)}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>

          <div className="response-toolbar">
            <button
              type="button"
              className="secondary-btn"
              disabled={refreshing || simulating || resetting || !onRefreshJira}
              onClick={() => onRefreshJira?.()}
            >
              <RefreshCw size={14} className={refreshing ? 'spin' : undefined} />{' '}
              {refreshing ? 'Fetching threads…' : 'Refresh threads'}
            </button>
            <button
              type="button"
              className="secondary-btn"
              disabled={refreshing || simulating || resetting || openDiscussions === 0 || !onResolveAllLatest}
              onClick={() => onResolveAllLatest?.()}
            >
              <CheckCircle2 size={14} /> Resolve all with latest
            </button>
            <button
              type="button"
              className="secondary-btn"
              disabled={refreshing || simulating || resetting}
              onClick={() => void onSimulateResponses()}
            >
              <Clock size={14} className={simulating ? 'spin' : undefined} />{' '}
              {simulating ? 'Simulating…' : 'Simulate Jira replies'}
            </button>
            <button
              type="button"
              className="secondary-btn"
              disabled={refreshing || simulating || resetting || !onResetSimulatedReplies}
              onClick={() => void onResetSimulatedReplies?.()}
            >
              <RotateCcw size={14} className={resetting ? 'spin' : undefined} />{' '}
              {resetting ? 'Resetting…' : 'Reset simulated'}
            </button>
            <button type="button" className="secondary-btn" disabled title="Outlook reminders — future">
              <Bell size={14} /> Send Reminder
            </button>
          </div>

          {summaryError ? <p className="connect-error">{summaryError}</p> : null}

          <div className="discussion-board">
            {filtered.length === 0 ? (
              <section className="card">
                <p className="muted">No rows in this filter.</p>
              </section>
            ) : (
              filtered.map(({ q, assignee, response, thread, resolved }) => {
                const chip = statusLabel(response, q)
                const isEditing = editingId === q.id
                const digest = summaryDraft[q.id] || q.jiraThreadSummary || ''
                return (
                  <article
                    key={q.id}
                    className={`discussion-card ${resolved ? 'is-resolved' : thread.length ? 'is-live' : 'is-waiting'}`}
                  >
                    <header className="discussion-card-head">
                      <div className="discussion-owner">
                        <span className="discussion-avatar" aria-hidden>
                          {initials(assignee.name)}
                        </span>
                        <div>
                          <strong>{assignee.name}</strong>
                          <span className="sub">
                            {roleLabel(q.assignedRoleId)}
                            {assignee.email ? ` · ${assignee.email}` : ''}
                            {q.mandatory ? ' · mandatory' : ''}
                          </span>
                        </div>
                      </div>
                      <div className="response-card-badges">
                        <span className={`status-pill ${chip.tone}`}>{chip.label}</span>
                        {q.jiraIssueKey ? (
                          q.jiraIssueUrl ? (
                            <a className="jira-ticket-badge" href={q.jiraIssueUrl} target="_blank" rel="noreferrer">
                              {q.jiraIssueKey} <ExternalLink size={11} />
                            </a>
                          ) : (
                            <span className="jira-ticket-badge jira-ticket-badge--plain">{q.jiraIssueKey}</span>
                          )
                        ) : null}
                      </div>
                    </header>

                    <h3 className="discussion-question">{q.question}</h3>

                    <div className="thread-tree">
                      <div className="thread-node is-parent">
                        <div className="thread-rail" aria-hidden />
                        <div className="thread-bubble parent">
                          <div className="thread-bubble-meta">
                            <span className="thread-role">Parent · Blink clarification</span>
                            {q.jiraParentCommentId ? <code>{q.jiraParentCommentId}</code> : null}
                          </div>
                          <p>
                            {q.jiraParentBody?.trim() ||
                              q.proposedAnswer ||
                              'Clarification posted to Jira. Child replies appear below.'}
                          </p>
                        </div>
                      </div>

                      {thread.length === 0 ? (
                        <div className="thread-node is-child">
                          <div className="thread-rail" aria-hidden />
                          <div className="thread-empty">No child replies yet. Refresh after stakeholders comment.</div>
                        </div>
                      ) : (
                        thread.map((reply, index) => (
                          <div key={reply.commentId || `${q.id}-${index}`} className="thread-node is-child">
                            <div className="thread-rail" aria-hidden />
                            <div className={`thread-bubble child${index === thread.length - 1 ? ' is-latest' : ''}`}>
                              <div className="thread-bubble-meta">
                                <span className="thread-role">
                                  Child · {reply.author || 'Someone'}
                                  {index === thread.length - 1 ? ' · latest' : ''}
                                </span>
                                <span>
                                  {reply.created ? new Date(reply.created).toLocaleString() : ''}
                                  {reply.parentId ? ` · parent ${reply.parentId}` : ''}
                                </span>
                              </div>
                              <p>{reply.body}</p>
                              {onUpdateResponse && !isEditing ? (
                                <button type="button" className="ghost-btn" onClick={() => useReply(q.id, reply)}>
                                  Use this reply as resolution
                                </button>
                              ) : null}
                            </div>
                          </div>
                        ))
                      )}
                    </div>

                    {thread.length > 0 ? (
                      <div className="discussion-actions">
                        <button
                          type="button"
                          className="secondary-btn summarize-btn"
                          disabled={summarizingId === q.id}
                          onClick={() => void handleSummarize(q)}
                        >
                          {summarizingId === q.id ? (
                            <Loader2 size={14} className="spin" />
                          ) : (
                            <Sparkles size={14} />
                          )}
                          {summarizingId === q.id ? 'Summarizing…' : 'Summarize discussion'}
                        </button>
                        <button
                          type="button"
                          className="ghost-btn"
                          onClick={() => startEdit(q.id, thread[thread.length - 1]?.body || '')}
                        >
                          Compose resolution
                        </button>
                      </div>
                    ) : null}

                    {digest ? (
                      <div className="discussion-digest">
                        <div className="discussion-digest-label">
                          <MessageSquareText size={14} /> {summaryMeta[q.id] || 'Thread digest'}
                        </div>
                        <pre>{digest}</pre>
                      </div>
                    ) : null}

                    {resolved || isEditing ? (
                      <div className="discussion-resolution">
                        <div className="response-card-answer-meta">
                          <CheckCircle2 size={14} />
                          <span>
                            Resolution
                            {response?.author ? ` · ${response.author}` : ''}
                            {response?.receivedAt
                              ? ` · ${new Date(response.receivedAt).toLocaleString()}`
                              : ''}
                          </span>
                        </div>
                        {isEditing ? (
                          <>
                            <textarea
                              className="response-card-editor"
                              rows={5}
                              value={draft}
                              onChange={(e) => setDraft(e.target.value)}
                              placeholder="Resolved answer Blink should use going forward…"
                            />
                            <div className="response-card-actions">
                              <button
                                type="button"
                                className="mini-btn"
                                onClick={() => saveEdit(q.id)}
                                disabled={!draft.trim()}
                              >
                                <CheckCircle2 size={13} /> Save resolution
                              </button>
                              <button
                                type="button"
                                className="ghost-btn"
                                onClick={() => {
                                  setEditingId(null)
                                  setDraft('')
                                }}
                              >
                                Cancel
                              </button>
                            </div>
                          </>
                        ) : (
                          <>
                            <p className="response-card-answer-body">
                              {response?.response?.trim() || q.jiraReplyBody || ''}
                            </p>
                            {q.jiraThreadStale ? (
                              <p className="response-card-stale">
                                New child replies arrived after resolve. Re-open or summarize again if the decision
                                changed.
                              </p>
                            ) : null}
                            {onUpdateResponse ? (
                              <div className="response-card-actions">
                                <button
                                  type="button"
                                  className="ghost-btn"
                                  onClick={() =>
                                    startEdit(q.id, response?.response?.trim() || q.jiraReplyBody || '')
                                  }
                                >
                                  Edit resolution
                                </button>
                                {thread.length > 0 ? (
                                  <button
                                    type="button"
                                    className="ghost-btn"
                                    onClick={() =>
                                      onUpdateResponse(q.id, {
                                        status: 'discussion',
                                        response: '',
                                        receivedAt: null,
                                        source: 'thread',
                                      })
                                    }
                                  >
                                    Re-open discussion
                                  </button>
                                ) : null}
                              </div>
                            ) : null}
                          </>
                        )}
                      </div>
                    ) : thread.length === 0 ? (
                      <div className="response-card-waiting">
                        <p>
                          {q.jiraCommentStatus === 'posted'
                            ? 'Parent clarification is on Jira. Waiting for child replies in the thread.'
                            : 'No discussion yet. Post to Jira first, then refresh — or use your in-app answer.'}
                        </p>
                        {onUpdateResponse && q.proposedAnswer?.trim() ? (
                          <button
                            type="button"
                            className="secondary-btn"
                            onClick={() => applyProposedAnswer(q.id, q.proposedAnswer!)}
                          >
                            Use in-app answer ({q.proposedAnswer.trim().slice(0, 48)}
                            {q.proposedAnswer.trim().length > 48 ? '…' : ''})
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </article>
                )
              })
            )}
          </div>

          <div className="progress-block response-progress">
            <div className="progress-label">
              <span>Mandatory resolved</span>
              <strong>
                {answeredMandatory.length} / {mandatory.length || 0}
              </strong>
            </div>
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{
                  width: `${mandatory.length ? (answeredMandatory.length / mandatory.length) * 100 : 100}%`,
                }}
              />
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export function validateStakeholderResponses(state: WizardState): string | null {
  if (state.questions.length === 0) return null
  const pending = state.questions
    .filter((q) => q.mandatory)
    .filter((q) => {
      const response = state.responses.find((r) => r.questionId === q.id)
      return !isResolved(response, q)
    })
  if (pending.length > 0) {
    const discussing = pending.filter(
      (q) =>
        (q.jiraThread?.length || 0) > 0 ||
        state.responses.find((r) => r.questionId === q.id)?.status === 'discussion',
    ).length
    if (discussing > 0) {
      return `${pending.length} mandatory question(s) still need a resolved answer (${discussing} in discussion).`
    }
    return `${pending.length} mandatory question(s) still pending.`
  }
  return null
}

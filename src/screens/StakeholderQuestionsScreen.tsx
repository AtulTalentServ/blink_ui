import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ExternalLink, Mail, MessageSquare, RefreshCw } from 'lucide-react'
import { assigneeForQuestion } from '../wizard/questions'
import { roleLabel } from '../wizard/stakeholders'
import {
  autoMapQuestionsToJira,
  buildJiraClarifyComment,
  matchableJiraIssues,
  type MatchableIssue,
} from '../wizard/jiraMatch'
import { isJiraReady } from '../wizard/jiraTickets'
import type { StakeholderQuestion, WizardState, WizardStep } from '../wizard/types'

interface Props {
  state: WizardState
  onUpdate: (patch: Partial<WizardState>) => void
  onSendOne: (questionId: string) => Promise<void>
  onSendAll: () => Promise<void>
  onPostJira: (questionId: string) => Promise<boolean | void>
  onPostAllJira: () => Promise<void>
  onRefreshJira: () => Promise<void>
  onNavigate?: (step: WizardStep) => void
  sending?: boolean
  posting?: boolean
  refreshing?: boolean
  /** When true, omit outer page header (used inside Stakeholder Q&A). */
  embedded?: boolean
}

type PersonGroup = {
  key: string
  roleId: string
  name: string
  email: string
  assigned: boolean
  questions: StakeholderQuestion[]
}

function ensureMatches(state: WizardState): StakeholderQuestion[] {
  return autoMapQuestionsToJira(state.questions, state)
}

function outboundDone(q: StakeholderQuestion, state: WizardState): boolean {
  const emailed = q.sent
  const jiraDone =
    (q.jiraCommentStatus === 'posted' || q.jiraCommentStatus === 'replied') && Boolean(q.jiraCommentId)
  const answered = state.responses.find((r) => r.questionId === q.id)?.status === 'answered'
  return Boolean(emailed || jiraDone || answered)
}

function statusChip(q: StakeholderQuestion, state: WizardState): { label: string; tone: string } {
  const response = state.responses.find((r) => r.questionId === q.id)
  const answer = response?.response?.trim() || q.jiraReplyBody?.trim() || ''
  if (response?.status === 'answered' && answer) return { label: 'Resolved', tone: 'ok' }
  if ((q.jiraThread?.length || 0) > 0 || response?.status === 'discussion' || q.jiraCommentStatus === 'discussion') {
    return { label: `Discussion · ${q.jiraThread?.length || 0}`, tone: 'info' }
  }
  if (q.jiraCommentStatus === 'resolved' && answer) return { label: 'Resolved', tone: 'ok' }
  if (q.jiraCommentStatus === 'replied' && q.jiraCommentId) return { label: 'Answered on Jira', tone: 'ok' }
  if (q.jiraCommentStatus === 'posted' && q.jiraCommentId) return { label: 'Posted · awaiting reply', tone: 'info' }
  if (q.jiraCommentStatus === 'failed') return { label: 'Jira failed', tone: 'err' }
  if (q.sent) return { label: 'Emailed', tone: 'ok' }
  if (q.jiraIssueKey) return { label: `Mapped · ${q.jiraIssueKey}`, tone: 'pending' }
  return { label: 'Pending', tone: 'pending' }
}

export function StakeholderQuestionsScreen({
  state,
  onUpdate,
  onSendOne,
  onSendAll,
  onPostJira,
  onPostAllJira,
  onRefreshJira,
  onNavigate,
  sending,
  posting,
  refreshing,
  embedded,
}: Props) {
  const issues = useMemo(() => matchableJiraIssues(state), [state])
  const jiraReady = isJiraReady(state) && issues.length > 0
  const [openTickets, setOpenTickets] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (!state.questions.length || !issues.length) return
    const next = ensureMatches(state)
    const changed = next.some(
      (q, i) =>
        q.jiraIssueKey !== state.questions[i]?.jiraIssueKey ||
        q.jiraIssueUrl !== state.questions[i]?.jiraIssueUrl,
    )
    if (changed) onUpdate({ questions: next })
  }, [state.questions, state.jiraCreatedIssues, state.productScope, issues.length, onUpdate, state])

  useEffect(() => {
    if (!jiraReady || !state.questions.some((q) => q.jiraCommentStatus === 'posted' && q.jiraCommentId)) return
    void onRefreshJira()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const groups: PersonGroup[] = useMemo(() => {
    const map = new Map<string, PersonGroup>()
    for (const q of state.questions) {
      const assignee = assigneeForQuestion(state, q.assignedRoleId)
      const key = `${q.assignedRoleId}|${assignee.email || assignee.name}`
      const existing = map.get(key)
      if (existing) {
        existing.questions.push(q)
      } else {
        map.set(key, {
          key,
          roleId: q.assignedRoleId,
          name: assignee.name,
          email: assignee.email,
          assigned: assignee.assigned,
          questions: [q],
        })
      }
    }
    return [...map.values()]
  }, [state])

  const emailable = state.questions.filter((q) => !q.sent && assigneeForQuestion(state, q.assignedRoleId).assigned)
  const jiraPostable = state.questions.filter(
    (q) =>
      Boolean(q.jiraIssueKey) &&
      assigneeForQuestion(state, q.assignedRoleId).assigned &&
      !(
        (q.jiraCommentStatus === 'posted' || q.jiraCommentStatus === 'replied') &&
        Boolean(q.jiraCommentId)
      ),
  )
  const pendingCount = state.questions.filter((q) => !outboundDone(q, state)).length
  const activity = useMemo(() => {
    const lines: string[] = []
    for (const q of state.questions) {
      const short = q.question.length > 48 ? `${q.question.slice(0, 48)}…` : q.question
      if (q.jiraCommentStatus === 'replied' && q.jiraCommentId) {
        lines.push(`Answered on Jira · ${q.jiraIssueKey || 'ticket'} · ${short}`)
      } else if (q.jiraCommentStatus === 'posted' && q.jiraCommentId) {
        lines.push(`Posted → ${q.jiraIssueKey || 'ticket'} · ${short}`)
      } else if (q.jiraCommentStatus === 'failed') {
        lines.push(`Jira failed · ${q.jiraIssueKey || 'ticket'} · ${short}`)
      } else if (q.sent) {
        lines.push(`Emailed · ${short}`)
      }
    }
    return lines.slice(0, 6)
  }, [state.questions])

  function setIssue(questionId: string, issue: MatchableIssue | null) {
    onUpdate({
      questions: state.questions.map((q) =>
        q.id === questionId
          ? {
              ...q,
              jiraIssueKey: issue?.key || null,
              jiraIssueUrl: issue?.url || null,
            }
          : q,
      ),
    })
  }

  return (
    <div className={embedded ? 'stakeholder-qa-pane' : 'screen screen-ref'}>
      {!embedded ? (
        <div className="screen-header">
          <h2>Questions for Stakeholders</h2>
          <p>Leftover questions, grouped by person.</p>
        </div>
      ) : null}

      {!jiraReady && state.questions.some((q) => q.queueJira) ? (
        <div className="ux-blocker">
          <strong>Jira comments need tickets</strong>
          <span>
            Email works now. After G-GROOM, open Scope &amp; tickets to propose epics, then post Jira comments
            there — or connect Atlassian first.
          </span>
          {onNavigate ? (
            <div className="ux-blocker-actions">
              <button type="button" className="ghost-btn" onClick={() => onNavigate('integrations')}>
                Open Integrations
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {activity.length > 0 ? (
        <div className="activity-log" aria-label="Outbound activity">
          <strong>Recent outbound</strong>
          <ul>
            {activity.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <section className="card ref-card">
        {state.questions.length === 0 ? (
          <div className="empty-state-block">
            <h3>Nothing left to ask</h3>
            <p>
              All clarify items were resolved on Requirements. Open Inbox &amp; grooming to acknowledge G-GROOM,
              then Scope &amp; tickets for epics.
            </p>
          </div>
        ) : (
          <div className="person-groups">
            {groups.map((group) => {
              const groupEmailable = group.questions.filter((q) => !q.sent && group.assigned)
              const groupJiraable = group.questions.filter(
                (q) =>
                  group.assigned &&
                  q.jiraIssueKey &&
                  !(
                    (q.jiraCommentStatus === 'posted' || q.jiraCommentStatus === 'replied') &&
                    Boolean(q.jiraCommentId)
                  ),
              )
              return (
                <article key={group.key} className="person-group">
                  <header className="person-group-head">
                    <div>
                      <strong>{group.name}</strong>
                      <div className="sub">
                        {roleLabel(group.roleId)}
                        {group.email ? ` · ${group.email}` : ' · unassigned'}
                      </div>
                    </div>
                    <div className="person-group-actions">
                      <button
                        type="button"
                        className="outlook-btn ref"
                        disabled={sending || groupEmailable.length === 0}
                        title={!group.assigned ? 'Assign this role on Project & Stakeholders' : undefined}
                        onClick={() => void Promise.all(groupEmailable.map((q) => onSendOne(q.id)))}
                      >
                        <Mail size={14} />
                        Email {groupEmailable.length || ''}
                      </button>
                      <button
                        type="button"
                        className="outlook-btn ref"
                        disabled={posting || groupJiraable.length === 0 || !jiraReady}
                        onClick={() => void Promise.all(groupJiraable.map((q) => onPostJira(q.id)))}
                      >
                        <MessageSquare size={14} />
                        Post {groupJiraable.length || ''} to Jira
                      </button>
                    </div>
                  </header>

                  {!group.assigned && onNavigate ? (
                    <p className="groom-blocker-hint">
                      Assign this role before email or Jira ·{' '}
                      <button type="button" className="link-btn" onClick={() => onNavigate('project-stakeholders')}>
                        Open Project & Stakeholders
                      </button>
                    </p>
                  ) : null}

                  <ul className="person-question-list">
                    {group.questions.map((q) => {
                      const chip = statusChip(q, state)
                      const alreadyOnJira =
                        (q.jiraCommentStatus === 'posted' || q.jiraCommentStatus === 'replied') &&
                        Boolean(q.jiraCommentId)
                      const showPicker = openTickets[q.id] || !q.jiraIssueKey
                      const replyText =
                        state.responses.find((r) => r.questionId === q.id)?.response?.trim() ||
                        q.jiraReplyBody?.trim() ||
                        ''
                      return (
                        <li key={q.id} className="person-question">
                          <div className="person-question-main">
                            <p>{q.question}</p>
                            {q.proposedAnswer ? (
                              <p className="sub">Proposed: {q.proposedAnswer}</p>
                            ) : null}
                            {replyText ? (
                              <blockquote className="jira-reply-excerpt">
                                <strong>Jira reply</strong>
                                <span>{replyText}</span>
                              </blockquote>
                            ) : null}
                            <div className="person-question-meta">
                              <span className={`status-chip ${chip.tone}`}>{chip.label}</span>
                              {q.jiraIssueKey ? (
                                q.jiraIssueUrl ? (
                                  <a
                                    className="jira-ticket-badge"
                                    href={q.jiraIssueUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    title={`Open ${q.jiraIssueKey} in Jira`}
                                  >
                                    {q.jiraIssueKey} <ExternalLink size={11} />
                                  </a>
                                ) : (
                                  <span className="jira-ticket-badge jira-ticket-badge--plain">{q.jiraIssueKey}</span>
                                )
                              ) : null}
                            </div>
                          </div>
                          <div className="person-question-side">
                            {issues.length === 0 ? (
                              <span className="muted">No tickets yet</span>
                            ) : showPicker ? (
                              <select
                                className="jira-match-select"
                                value={q.jiraIssueKey || ''}
                                onChange={(event) => {
                                  const key = event.target.value
                                  const issue = issues.find((item) => item.key === key) || null
                                  setIssue(q.id, issue)
                                  setOpenTickets((prev) => ({ ...prev, [q.id]: false }))
                                }}
                              >
                                <option value="">Select ticket…</option>
                                {issues.map((issue) => (
                                  <option key={issue.key} value={issue.key}>
                                    {issue.key} · {issue.title} ({issue.type})
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <button
                                type="button"
                                className="ghost-btn"
                                onClick={() => setOpenTickets((prev) => ({ ...prev, [q.id]: true }))}
                              >
                                Change ticket <ChevronDown size={12} />
                              </button>
                            )}
                            <div className="stake-actions">
                              <button
                                type="button"
                                className="outlook-btn ref"
                                disabled={sending || !group.assigned || q.sent}
                                onClick={() => void onSendOne(q.id)}
                              >
                                <Mail size={14} />
                                {q.sent ? 'Emailed ✓' : 'Email'}
                              </button>
                              <button
                                type="button"
                                className="outlook-btn ref"
                                disabled={posting || !group.assigned || !jiraReady || !q.jiraIssueKey || alreadyOnJira}
                                onClick={() => void onPostJira(q.id)}
                              >
                                <MessageSquare size={14} />
                                {alreadyOnJira ? 'Posted ✓' : q.jiraCommentStatus === 'failed' ? 'Retry' : 'Jira'}
                              </button>
                            </div>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </article>
              )
            })}
          </div>
        )}

        <div className="card-footer-actions right stake-footer">
          <span className="sub">
            {state.questions.length === 0
              ? 'Queue empty'
              : `${pendingCount} still need email, Jira, or an answer`}
          </span>
          <button
            type="button"
            className="ghost-btn"
            disabled={refreshing || !jiraReady}
            onClick={() => void onRefreshJira()}
          >
            <RefreshCw size={14} />
            {refreshing ? 'Refreshing…' : 'Refresh Jira replies'}
          </button>
          <button
            type="button"
            className="secondary-btn"
            disabled={posting || jiraPostable.length === 0}
            onClick={() => void onPostAllJira()}
          >
            <MessageSquare size={14} />
            Post all to Jira
          </button>
          <button
            type="button"
            className="secondary-btn"
            disabled={sending || emailable.length === 0}
            onClick={() => void onSendAll()}
          >
            <Mail size={14} />
            Send all emails
          </button>
        </div>
      </section>
    </div>
  )
}

export function validateStakeholderQuestions(state: WizardState): string | null {
  if (state.questions.length === 0) return null
  const pending = state.questions.filter((q) => !outboundDone(q, state))
  if (pending.length > 0) {
    return `Email, post to Jira, or record an answer for ${pending.length} leftover question(s).`
  }
  return null
}

export function jiraCommentForQuestion(state: WizardState, question: StakeholderQuestion): string {
  const assignee = assigneeForQuestion(state, question.assignedRoleId)
  return buildJiraClarifyComment({
    questionId: question.id,
    question: question.question,
    personName: assignee.name,
    roleLabel: roleLabel(question.assignedRoleId),
    proposedAnswer: question.proposedAnswer,
  })
}

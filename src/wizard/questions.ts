import type { GroomAnswer, GroomQuestion, StakeholderQuestion, WizardState } from './types'
import { isAnswered, questionPriority } from './grooming'
import { roleLabel } from './stakeholders'

function uid(): string {
  return `q-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

/** @deprecated Prefer carryClarifyQuestionsForward — canned list removed by plan. */
export function generateQuestionsFromRequirements(_state: WizardState): StakeholderQuestion[] {
  return []
}

export function assigneeForQuestion(
  state: WizardState,
  roleId: string,
): { name: string; email: string; assigned: boolean } {
  const assignment = state.stakeholderAssignments.find((a) => a.roleId === roleId)
  if (assignment?.personName?.trim() && assignment?.personEmail?.trim()) {
    return {
      name: assignment.personName.trim(),
      email: assignment.personEmail.trim(),
      assigned: true,
    }
  }
  return { name: `Unassigned ${roleLabel(roleId)}`, email: '', assigned: false }
}

function proposedAnswerText(question: GroomQuestion, answers: GroomAnswer[]): string {
  const rows = answers.filter((item) => item.questionId === question.id)
  if (!rows.length) return ''
  const parts = rows.map((row) => {
    if (row.optionId === 'other') return (row.otherText || '').trim()
    return (row.optionLabel || row.optionId || '').trim()
  })
  return parts.filter(Boolean).join('; ')
}

/**
 * Leftover clarify items become the Stakeholder Questions queue:
 * - unanswered optional (important/suggestion) questions
 * - any question flagged queueEmail / queueJira (even if answered as proxy)
 * - required questions deferred with Jira later (answered on the ticket)
 */
export function carryClarifyQuestionsForward(state: WizardState): StakeholderQuestion[] {
  const out: StakeholderQuestion[] = []
  for (const q of state.groomQuestions) {
    const answered = isAnswered(q, state.groomAnswers)
    const priority = questionPriority(q)
    const mandatory = priority === 'need_clarification'
    const queueJira = Boolean(q.queueJira)
    const queueEmail = Boolean(q.queueEmail)
    const queued = queueEmail || queueJira
    // Required answered in Blink with no outbound queue → complete in Stakeholder Q&A.
    if (mandatory && answered && !queued) continue
    // Required unanswered without Jira later should be blocked by wording gate
    if (mandatory && !answered && !queueJira) continue
    // Optional unanswered, deferred to Jira, or anything explicitly queued
    if (!answered || queued) {
      out.push({
        id: q.id || uid(),
        question: q.text,
        assignedRoleId: q.ownerRole || 'product_owner',
        mandatory,
        sent: false,
        deliveryStatus: 'pending',
        sentAt: null,
        deliveryMessage: '',
        priority,
        proposedAnswer: proposedAnswerText(q, state.groomAnswers) || undefined,
        queueEmail: queueEmail || (!answered && !queueJira),
        queueJira: queueJira || !answered,
        jiraIssueKey: null,
        jiraIssueUrl: null,
        jiraCommentId: null,
        jiraCommentStatus: 'pending',
      })
    }
  }
  return out
}

/** Marker embedded in simulated Jira replies so reset can find/delete them. */
export const BLINK_SIM_REPLY_MARKER = '[blink-sim-reply]'

/** Build a realistic stakeholder-style reply for Jira simulation (posted as a real comment). */
export function simulatedStakeholderReply(
  question: StakeholderQuestion,
  personName: string,
): string {
  const who = personName.trim() || 'stakeholder'
  const proposed = question.proposedAnswer?.trim()
  const topic = question.question.trim().replace(/\s+/g, ' ')
  const shortTopic = topic.length > 160 ? `${topic.slice(0, 157)}…` : topic

  const lines = proposed
    ? [
        `Hi — ${who} here (Blink simulation).`,
        '',
        `Re: ${shortTopic}`,
        '',
        proposed,
        '',
        'Please treat this as my confirmation on the ticket.',
        '',
        BLINK_SIM_REPLY_MARKER,
      ]
    : [
        `Hi — ${who} here (Blink simulation).`,
        '',
        `Re: ${shortTopic}`,
        '',
        'Happy to proceed with the recommended approach for now. If anything material changes, I will follow up on this ticket.',
        '',
        'Please treat this as my confirmation on the ticket.',
        '',
        BLINK_SIM_REPLY_MARKER,
      ]
  return lines.join('\n')
}

/** @deprecated Prefer simulatedStakeholderReply — kept for local-only fallbacks. */
export function mockResponsesForQuestions(questions: StakeholderQuestion[]): Record<string, string> {
  const responses: Record<string, string> = {}
  for (const q of questions) {
    responses[q.id] = simulatedStakeholderReply(q, 'Stakeholder')
  }
  return responses
}

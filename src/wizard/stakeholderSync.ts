import { createJiraComment, groomingRevision, type OverlayFilePayload } from '../api/blink'
import type { QuestionResponse, ScopeOverlayFile, StakeholderQuestion, WizardState } from './types'
import { blinkQuestionMarker } from './jiraMatch'

export function mergeScopeOverlays(
  base: ScopeOverlayFile[] | undefined,
  incoming: OverlayFilePayload[] | undefined,
): ScopeOverlayFile[] {
  const map = new Map<string, ScopeOverlayFile>()
  for (const file of base || []) {
    if (file?.path) map.set(file.path, file)
  }
  for (const file of incoming || []) {
    if (file?.path) map.set(file.path, { path: file.path, content: file.content })
  }
  return [...map.values()]
}

export function requirementTextFromState(state: WizardState): string {
  return (
    state.groomDraft?.trim() ||
    state.requirementsText?.trim() ||
    state.description?.trim() ||
    ''
  )
}

export function stakeholderFeedbackFromState(state: WizardState): string {
  return state.responses
    .filter((r) => r.status === 'answered' && r.response.trim())
    .map((r) => {
      const q = state.questions.find((qq) => qq.id === r.questionId)
      return `Q: ${q?.question || r.questionId}\nA: ${r.response.trim()}`
    })
    .join('\n\n')
}

export function mandatoryStakeholderQuestionsResolved(state: WizardState): boolean {
  const mandatory = state.questions.filter((q) => q.mandatory)
  if (!mandatory.length) return false
  return mandatory.every((q) => {
    const response = state.responses.find((r) => r.questionId === q.id)
    const text = response?.response?.trim() || q.jiraReplyBody?.trim() || ''
    return response?.status === 'answered' && Boolean(text)
  })
}

/** Pre-fill responses when MCQ answers were captured on Requirements (including Jira later + in-app choice). */
export function responsesForStakeholderQuestions(
  questions: StakeholderQuestion[],
  previous: QuestionResponse[] = [],
): QuestionResponse[] {
  return questions.map((q) => {
    const existing = previous.find((r) => r.questionId === q.id)
    const proposed = q.proposedAnswer?.trim() || ''
    const existingText = existing?.response?.trim() || ''
    const text = existingText || proposed
    const answeredInApp = existing?.status === 'answered' || Boolean(proposed)
    return {
      questionId: q.id,
      status: answeredInApp && text ? ('answered' as const) : existing?.status ?? ('pending' as const),
      response: text,
      receivedAt:
        answeredInApp && text
          ? existing?.receivedAt ?? new Date().toISOString()
          : existing?.receivedAt ?? null,
      source: existing?.source ?? (proposed ? ('mcq' as const) : undefined),
    }
  })
}

export function applyQuestionResponsePatch(
  prev: WizardState,
  questionId: string,
  patchResponse: Partial<QuestionResponse>,
): WizardState {
  const body = (patchResponse.response || '').trim()
  const answered = (patchResponse.status || 'answered') === 'answered' && Boolean(body)
  const responses = prev.questions.map((q) => {
    const existing = prev.responses.find((r) => r.questionId === q.id)
    if (q.id !== questionId) {
      return (
        existing ?? {
          questionId: q.id,
          status: 'pending' as const,
          response: q.proposedAnswer || '',
          receivedAt: null,
        }
      )
    }
    return {
      questionId: q.id,
      status: answered ? ('answered' as const) : patchResponse.status || 'pending',
      response: body || existing?.response || '',
      receivedAt: patchResponse.receivedAt || new Date().toISOString(),
      source: patchResponse.source || existing?.source || 'manual',
      author: patchResponse.author ?? existing?.author ?? null,
      jiraIssueKey: patchResponse.jiraIssueKey ?? existing?.jiraIssueKey ?? q.jiraIssueKey ?? null,
      jiraCommentId: patchResponse.jiraCommentId ?? existing?.jiraCommentId ?? null,
      resolvedFromCommentId:
        patchResponse.resolvedFromCommentId ?? existing?.resolvedFromCommentId ?? null,
    }
  })
  const questions = prev.questions.map((q) => {
    if (q.id !== questionId) return q
    if (!answered) {
      return {
        ...q,
        jiraCommentStatus:
          (q.jiraThread?.length || 0) > 0 ? ('discussion' as const) : q.jiraCommentStatus,
        jiraThreadStale: false,
      }
    }
    return {
      ...q,
      jiraCommentStatus: 'resolved' as const,
      jiraCommentMessage: body.length > 140 ? `${body.slice(0, 140)}…` : body,
      jiraReplyBody: body,
      jiraReplyAuthor: patchResponse.author ?? q.jiraReplyAuthor ?? null,
      jiraReplyAt: patchResponse.receivedAt || new Date().toISOString(),
      jiraReplyCommentId: patchResponse.resolvedFromCommentId || q.jiraReplyCommentId || null,
      jiraThreadStale: false,
    }
  })
  const loopInvalid =
    answered && prev.groomingLoopFeedbackAt !== stakeholderFeedbackFromState({ ...prev, responses, questions })
  return {
    ...prev,
    responses,
    questions,
    ...(loopInvalid ? invalidateGroomingLoopPatch() : {}),
  }
}

export function buildJiraConfirmationComment(questionId: string, answer: string): string {
  const lines = [
    blinkQuestionMarker(questionId),
    'Confirmed in Blink (in-app answer):',
    answer.trim(),
  ]
  return lines.join('\n')
}

export async function syncStakeholderAnswerToJira(
  projectId: string,
  question: StakeholderQuestion,
  answer: string,
): Promise<{ posted: boolean; commentId?: string | null; message?: string }> {
  const text = answer.trim()
  if (!text || !question.jiraIssueKey) {
    return { posted: false }
  }
  const body = buildJiraConfirmationComment(question.id, text)
  const parentId = question.jiraCommentId || undefined
  const res = await createJiraComment({
    projectId,
    issueKey: question.jiraIssueKey,
    body,
    blinkQuestionId: question.id,
    parentCommentId: parentId,
  })
  return {
    posted: Boolean(res.commentId),
    commentId: res.commentId,
    message: res.message,
  }
}

export function patchAfterJiraAnswerSync(
  prev: WizardState,
  questionId: string,
  sync: { commentId?: string | null },
): WizardState {
  if (!sync.commentId) return prev
  return {
    ...prev,
    questions: prev.questions.map((q) =>
      q.id === questionId
        ? {
            ...q,
            jiraReplyCommentId: sync.commentId,
            jiraCommentStatus: 'resolved' as const,
          }
        : q,
    ),
  }
}

export async function applyGroomingRevisionToState(
  state: WizardState,
): Promise<Partial<WizardState>> {
  const feedback = stakeholderFeedbackFromState(state)
  if (!feedback.trim() || !state.projectId) {
    throw new Error('Nothing to revise — resolve at least one question first.')
  }
  const requirementText = requirementTextFromState(state)
  if (!requirementText) {
    throw new Error('Requirement text is missing.')
  }
  const res = await groomingRevision(state.projectId, {
    requirementText,
    stakeholderFeedback: feedback,
    overlayFiles: state.scopeOverlays || [],
    groomingRevision: state.groomingRevision,
    issueId: state.stakeholderPack?.issueId || state.productScope?.storyIds?.[0],
  })
  if (res.status !== 'ok') {
    throw new Error(res.message || 'Grooming revision failed')
  }
  const draftText = res.requirementDraft || res.groomingRevision?.requirementMarkdown || ''
  return {
    groomingRevision: res.groomingRevision || null,
    groomDraft: draftText || state.groomDraft,
    requirementsText: draftText || state.requirementsText,
    scopeOverlays: mergeScopeOverlays(state.scopeOverlays, res.overlayFiles),
    nextSdlcCommand: res.nextCommand || '/grooming-sign-off-capture',
    groomingSignOff: null,
    groomingLoopFeedbackAt: null,
  }
}

export function shouldRunGroomingRevisionAfterAnswers(state: WizardState): boolean {
  const feedback = stakeholderFeedbackFromState(state).trim()
  if (!feedback) return false
  return mandatoryStakeholderQuestionsResolved(state)
}

export function invalidateGroomingLoopPatch(): Pick<
  WizardState,
  'groomingLoopFeedbackAt' | 'groomingSignOff'
> {
  return { groomingLoopFeedbackAt: null, groomingSignOff: null }
}

/** True when background pack / revision / sign-off match the current resolved Q&A. */
export function groomingLoopSettled(state: WizardState): boolean {
  const feedback = stakeholderFeedbackFromState(state)
  // Nothing to send/answer — no agent loop required; operator can acknowledge G-GROOM.
  if (!state.questions.length && !feedback.trim()) {
    return state.groomingLoopFeedbackAt === '' || state.groomingLoopFeedbackAt === feedback
  }
  if (!state.stakeholderPack || !state.groomingSignOff) return false
  const revisionNeeded = Boolean(feedback.trim())
  if (revisionNeeded && !state.groomingRevision) return false
  return state.groomingLoopFeedbackAt === feedback
}

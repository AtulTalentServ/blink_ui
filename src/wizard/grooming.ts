import type { GroomAnswer, GroomQuestion, WizardState } from './types'
import { hasRequirementSource } from './groomingEligibility.ts'

export type GroomPriority = 'need_clarification' | 'important' | 'suggestion'

const BRACKET_PREFIX = /^\s*\[[^\]]{1,48}\]\s*/
const LEADING_TITLE_COLON =
  /^\s*(?!what\b|which\b|who\b|where\b|when\b|why\b|how\b|should\b|can\b|could\b|would\b|will\b|do\b|does\b|did\b|is\b|are\b|may\b)([A-Za-z][A-Za-z0-9 /&'_-]{1,42}):\s+([\s\S]+)$/i
const STACKED_ASK =
  /(?:(?<=[.?])|(?<=,))\s+(?:also|additionally)\s+(?:confirm|specify|include|choose|decide|clarify|ask)\b[\s\S]*$/i
const TRAILING_META_FILLER =
  /(?<=\?)\s+(?:please\s+(?:specify|confirm|list|choose|clarify)\b|may\s+the\s+proposed\s+default\b)[\s\S]*$/i

/** Extract or preserve `<question title>` while stripping `[Category]` prefixes and stacked asks. */
export function splitQuestionTitleAndText(
  rawTitle: string | undefined,
  rawText: string,
): { title?: string; text: string } {
  const explicitTitle = (rawTitle || '').replace(/\s+/g, ' ').trim().replace(/:$/, '')
  const original = (rawText || '').trim()
  if (!original) {
    return { ...(explicitTitle ? { title: explicitTitle } : {}), text: '' }
  }
  let cleaned = original.replace(BRACKET_PREFIX, '').trim()
  cleaned = cleaned.replace(STACKED_ASK, '').trim()
  cleaned = cleaned.replace(TRAILING_META_FILLER, '').trim()
  let inferredTitle: string | undefined
  const m = LEADING_TITLE_COLON.exec(cleaned)
  if (m) {
    inferredTitle = m[1].replace(/\s+/g, ' ').trim()
    cleaned = m[2].trim()
  }
  cleaned = cleaned.replace(BRACKET_PREFIX, '').trim()
  cleaned = cleaned.replace(/[ \t]+/g, ' ').trim()
  const title = explicitTitle || inferredTitle || undefined
  return {
    ...(title ? { title } : {}),
    text: cleaned || original,
  }
}

/** Drop [Category] prefixes and stacked "also confirm" clauses while preserving question body. */
export function compactQuestionText(text: string): string {
  return splitQuestionTitleAndText(undefined, text).text
}

export function questionPriority(question: GroomQuestion): GroomPriority {
  const value = question.priority
  if (value === 'important' || value === 'suggestion') return value
  return 'need_clarification'
}

type IncomingQuestion = Omit<GroomQuestion, 'priority'> & { priority?: GroomPriority }

/** Normalize incoming frontier questions without artificial band quotas. */
export function assignQuestionBands(questions: IncomingQuestion[], round = 1): GroomQuestion[] {
  return questions.map((question) => {
    const options = Array.isArray(question.options) ? [...question.options] : []
    const explicitRecId = question.recommendedOptionId?.trim()
    let recOpt =
      options.find((opt) => opt.recommended) ||
      (explicitRecId ? options.find((opt) => opt.id === explicitRecId) : undefined)
    if (!recOpt && options.length > 0) {
      options[0] = { ...options[0], recommended: true }
      recOpt = options[0]
    }
    const { title, text } = splitQuestionTitleAndText(question.title, question.text)
    return {
      ...question,
      ...(title ? { title } : {}),
      options,
      recommendedOptionId: recOpt?.id || question.recommendedOptionId,
      round: question.round ?? round,
      text,
      priority: questionPriority(question as GroomQuestion),
    }
  })
}

export function recommendedOptionForQuestion(question: GroomQuestion): GroomQuestion['options'][number] | undefined {
  const options = Array.isArray(question.options)
    ? question.options.filter((opt) => opt.id !== 'other' && opt.label.trim().toLowerCase() !== 'other')
    : []
  if (!options.length) return undefined
  return (
    options.find((opt) => opt.recommended) ||
    (question.recommendedOptionId ? options.find((opt) => opt.id === question.recommendedOptionId) : undefined) ||
    options[0]
  )
}

/**
 * Select the recommended option for questions that just appeared.
 * Questions already on the list keep whatever answer they have, including none.
 */
export function answersWithNewDefaults(
  previousQuestions: GroomQuestion[],
  nextQuestions: GroomQuestion[],
  answers: GroomAnswer[],
): GroomAnswer[] {
  const known = new Set(previousQuestions.map((question) => question.id))
  const fresh = nextQuestions.filter((question) => question.id && !known.has(question.id))
  if (!fresh.length) return answers
  return applyRecommendedAnswers(fresh, answers)
}

/** Fill any unanswered non-deferred questions with their recommended option. */
export function applyRecommendedAnswers(
  questions: GroomQuestion[],
  existingAnswers: GroomAnswer[],
): GroomAnswer[] {
  const next = [...existingAnswers]
  for (const question of questions) {
    if (isResolvedForWording(question, next)) continue
    const rec = recommendedOptionForQuestion(question)
    if (!rec) continue
    next.push({
      questionId: question.id,
      optionId: rec.id,
      optionLabel: rec.label,
    })
  }
  return next
}

export function requiredGroomQuestions(questions: GroomQuestion[]): GroomQuestion[] {
  return questions.filter((question) => questionPriority(question) === 'need_clarification')
}

export function answersForQuestion(questionId: string, answers: GroomAnswer[]): GroomAnswer[] {
  return answers.filter((item) => item.questionId === questionId)
}

export function isAnswered(question: GroomQuestion, answers: GroomAnswer[]): boolean {
  const rows = answersForQuestion(question.id, answers)
  const pickedOption = rows.some((item) => item.optionId !== 'other' && Boolean(item.optionId))
  const otherFilled = rows.some((item) => item.optionId === 'other' && Boolean(item.otherText?.trim()))
  return pickedOption || otherFilled
}

/** Jira later defers the answer to a ticket comment — no in-app MCQ required. */
export function isDeferredToJira(question: GroomQuestion): boolean {
  return Boolean(question.queueJira)
}

/** Answered in Blink, or explicitly deferred to a Jira comment. */
export function isResolvedForWording(question: GroomQuestion, answers: GroomAnswer[]): boolean {
  return isAnswered(question, answers) || isDeferredToJira(question)
}

export function unansweredRequired(state: Pick<WizardState, 'groomQuestions' | 'groomAnswers'>): GroomQuestion[] {
  return requiredGroomQuestions(state.groomQuestions).filter(
    (question) => !isResolvedForWording(question, state.groomAnswers),
  )
}

/** Append a next design-tree frontier round without duplicating earlier questions or capping at 3. */
export function mergeFollowUpQuestions(
  existing: GroomQuestion[],
  incoming: GroomQuestion[],
  round = 2,
): GroomQuestion[] {
  const usedIds = new Set(existing.map((question) => question.id))
  const usedText = new Set(existing.map((question) => question.text.trim().toLowerCase()).filter(Boolean))
  const extra: GroomQuestion[] = []
  for (const question of incoming) {
    const textKey = question.text.trim().toLowerCase()
    if (!textKey || usedText.has(textKey)) continue
    let id = question.id.trim() || `r${round}-${extra.length + 1}`
    if (usedIds.has(id)) id = `r${round}-${id}`
    usedIds.add(id)
    usedText.add(textKey)
    extra.push({ ...question, id, round: question.round ?? round, priority: 'need_clarification' })
  }
  return extra.length ? [...existing, ...extra] : existing
}

export function groomingComplete(state: WizardState): boolean {
  return hasRequirementSource(state)
}

/** True when every answer is a picked option (no free-text Other). Safe to stitch locally. */
export function answersAreAllOptionPicks(answers: GroomAnswer[]): boolean {
  return answers.length > 0 && answers.every((item) => item.optionId !== 'other')
}

/** Strip any legacy 'Decisions from clarification:' Q&A trailer from a requirement draft. */
export function stripClarificationTrailer(text: string): string {
  const base = (text || '').trim()
  if (!base) return ''
  if (base.includes('Decisions from clarification:')) {
    return base.replace(/\n*Decisions from clarification:[\s\S]*$/m, '').trim()
  }
  return base
}

/**
 * Offline fallback when the LLM rewrite is unreachable: append concise settled decisions
 * without repeating full interrogative question sentences or a 'Decisions from clarification:' Q&A header.
 */
export function stitchWordingFromAnswers(
  draft: string,
  questions: GroomQuestion[],
  answers: GroomAnswer[],
): string {
  const base = stripClarificationTrailer(draft)
  if (!answers.length) return base
  const byId = new Map(questions.map((question) => [question.id, question]))
  const grouped = new Map<string, string[]>()
  const order: string[] = []
  for (const answer of answers) {
    const question = byId.get(answer.questionId)
    const label =
      answer.optionId === 'other'
        ? answer.otherText?.trim() || ''
        : answer.optionLabel?.trim() ||
          question?.options.find((option) => option.id === answer.optionId)?.label?.trim() ||
          answer.optionId
    if (!label) continue
    let list = grouped.get(answer.questionId)
    if (!list) {
      list = []
      grouped.set(answer.questionId, list)
      order.push(answer.questionId)
    }
    if (!list.includes(label)) list.push(label)
  }
  if (!order.length) return base
  const lines: string[] = []
  for (const questionId of order) {
    const question = byId.get(questionId)
    const values = grouped.get(questionId) || []
    if (!values.length) continue
    const { title } = splitQuestionTitleAndText(question?.title, question?.text || '')
    const line = title ? `- ${title}: ${values.join(', ')}` : `- ${values.join(', ')}`
    if (!base.includes(line)) lines.push(line)
  }
  if (!lines.length) return base
  const block = lines.join('\n')
  return base ? `${base}\n\n${block}` : block
}

export interface ClarifyFrontierState {
  asked: boolean
  round: number
  frontierEmpty: boolean
  frontierQuestions: GroomQuestion[]
  settledQuestions: GroomQuestion[]
  resolvedCount: number
  unresolvedCount: number
  canLockNow: boolean
  finishNowLabel: string
  primaryLabel: string
}

/** Compute the active design-tree frontier and primary/secondary CTA state for Clarify. */
export function computeClarifyFrontierState(
  state: Pick<
    WizardState,
    'groomQuestions' | 'groomAnswers' | 'groomRound' | 'groomStatus' | 'groomConfirmed'
  >,
): ClarifyFrontierState {
  const questions = state.groomQuestions || []
  const asked =
    questions.length > 0 || state.groomStatus === 'draft_ready' || state.groomStatus === 'error'
  const round = Math.max(1, state.groomRound || 1)
  const frontierEmpty = state.groomStatus === 'draft_ready' && !state.groomConfirmed
  const currentRoundQuestions =
    round > 1 ? questions.filter((q) => (q.round ?? 1) === round) : questions
  const frontierQuestions = frontierEmpty
    ? []
    : currentRoundQuestions.length > 0
      ? currentRoundQuestions
      : questions
  const settledQuestions = frontierEmpty
    ? questions
    : round > 1 && currentRoundQuestions.length > 0
      ? questions.filter((q) => (q.round ?? 1) < round)
      : []
  const resolvedCount = frontierQuestions.filter((question) =>
    isResolvedForWording(question, state.groomAnswers),
  ).length
  const unresolvedCount = frontierQuestions.length - resolvedCount
  const canLockNow = !state.groomConfirmed && frontierQuestions.length > 0
  const finishNowLabel = 'Finish clarifying now'
  const primaryLabel = state.groomConfirmed
    ? 'Wording saved'
    : frontierQuestions.length > 0
      ? unresolvedCount > 0
        ? 'Accept recommended & next round'
        : 'Submit round answers'
      : 'Confirm shared understanding'
  return {
    asked,
    round,
    frontierEmpty,
    frontierQuestions,
    settledQuestions,
    resolvedCount,
    unresolvedCount,
    canLockNow,
    finishNowLabel,
    primaryLabel,
  }
}

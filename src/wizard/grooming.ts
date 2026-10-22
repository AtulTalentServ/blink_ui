import type { GroomAnswer, GroomQuestion, WizardState } from './types'
import { hasRequirementSource } from './groomingEligibility.ts'

export type GroomPriority = 'need_clarification' | 'important' | 'suggestion'

export const GROOM_BANDS: {
  id: GroomPriority
  title: string
  hint: string
  required: boolean
}[] = [
  {
    id: 'need_clarification',
    title: 'Need clarification',
    hint: 'Required. These gaps block a first version.',
    required: true,
  },
  {
    id: 'important',
    title: 'Important',
    hint: 'Optional. Answer if you already know.',
    required: false,
  },
  {
    id: 'suggestion',
    title: 'Suggestions',
    hint: 'Optional ideas. Skip anything that does not fit.',
    required: false,
  },
]

const CATEGORY_PREFIX = /^\s*(?:\[[^\]]{1,48}\]\s*|[A-Za-z][A-Za-z /&]{0,40}:\s+)/
const STACKED_ASK =
  /(?:(?<=[.?])|(?<=,))\s+(?:also|additionally)\s+(?:confirm|specify|include|choose|decide|clarify|ask)\b.*$/is

/** Drop [Category] prefixes and stacked "also confirm" clauses from MCQ text. */
export function compactQuestionText(text: string): string {
  const original = (text || '').trim()
  if (!original) return original
  let cleaned = original.replace(CATEGORY_PREFIX, '').trim()
  cleaned = cleaned.replace(STACKED_ASK, '').trim()
  cleaned = cleaned.replace(CATEGORY_PREFIX, '').trim()
  cleaned = cleaned.replace(/\s+/g, ' ')
  const qmark = cleaned.indexOf('?')
  if (qmark >= 0) cleaned = cleaned.slice(0, qmark + 1).trim()
  return cleaned || original
}

export function questionPriority(question: GroomQuestion): GroomPriority {
  const value = question.priority
  if (value === 'important' || value === 'suggestion') return value
  return 'need_clarification'
}

export function questionsInBand(questions: GroomQuestion[], band: GroomPriority): GroomQuestion[] {
  return questions.filter((question) => questionPriority(question) === band)
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
    return {
      ...question,
      options,
      recommendedOptionId: recOpt?.id || question.recommendedOptionId,
      round: question.round ?? round,
      text: compactQuestionText(question.text),
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
  return questionsInBand(questions, 'need_clarification')
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

/**
 * Merge MCQ and free-text Other answers into the current draft without an LLM rewrite.
 */
export function stitchWordingFromAnswers(
  draft: string,
  questions: GroomQuestion[],
  answers: GroomAnswer[],
): string {
  const base = (draft || '').trim()
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
    const prompt = compactQuestionText(question?.text || '').replace(/\?$/, '') || 'Decision'
    const values = grouped.get(questionId) || []
    if (values.length) lines.push(`- ${prompt}: ${values.join(', ')}`)
  }
  if (!lines.length) return base
  const block = ['Decisions from clarification:', ...lines].join('\n')
  if (!base) return block
  if (/\nDecisions from clarification:\n/.test(base) || base.includes('Decisions from clarification:')) {
    return `${base.replace(/\n*Decisions from clarification:[\s\S]*$/m, '').trim()}\n\n${block}`
  }
  return `${base}\n\n${block}`
}

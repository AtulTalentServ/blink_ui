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

/** Fill missing bands: unbanded questions split 2 required / rest optional. Always keep at least two required when possible. */
export function assignQuestionBands(questions: IncomingQuestion[]): GroomQuestion[] {
  const explicit = questions.some((question) => Boolean(question.priority))
  const mapped: GroomQuestion[] = explicit
    ? questions.map((question) => ({
        ...question,
        text: compactQuestionText(question.text),
        priority: questionPriority(question as GroomQuestion),
      }))
    : questions.map((question, index) => ({
        ...question,
        text: compactQuestionText(question.text),
        priority: (index < 2 ? 'need_clarification' : index < 5 ? 'important' : 'suggestion') as GroomPriority,
      }))
  if (mapped.length === 0) return mapped
  return mapped
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

/** Append a second clarify round without duplicating round-1 questions. */
export function mergeFollowUpQuestions(
  existing: GroomQuestion[],
  incoming: GroomQuestion[],
): GroomQuestion[] {
  const usedIds = new Set(existing.map((question) => question.id))
  const usedText = new Set(existing.map((question) => question.text.trim().toLowerCase()).filter(Boolean))
  const extra: GroomQuestion[] = []
  for (const question of incoming) {
    const textKey = question.text.trim().toLowerCase()
    if (!textKey || usedText.has(textKey)) continue
    let id = question.id.trim() || `r2-${extra.length + 1}`
    if (usedIds.has(id)) id = `r2-${id}`
    usedIds.add(id)
    usedText.add(textKey)
    extra.push({ ...question, id, priority: 'need_clarification' })
    if (extra.length >= 3) break
  }
  return extra.length ? [...existing, ...extra] : existing
}

export function groomingComplete(state: WizardState): boolean {
  return hasRequirementSource(state)
}

import type { GroomAnswer, ProductScopeData, WizardState } from './types'
import { shapePlanContext } from './shape.ts'
import { stakeholderFeedbackFromState } from './stakeholderSync'

/** Epic/story roster for classify / spec / technical-plan agents. */
export function productScopeSummaryForPlan(scope: ProductScopeData | null | undefined): string {
  if (!scope) return ''
  const lines: string[] = []
  if (scope.status) lines.push(`Scope status: ${scope.status}`)
  for (const epic of scope.epics || []) {
    const objective = epic.objective?.trim()
    lines.push(`Epic ${epic.id}: ${epic.title}${objective ? ` — ${objective}` : ''}`)
  }
  for (const story of scope.stories || []) {
    const objective = story.objective?.trim()
    const ac =
      story.acceptanceCriteria?.filter(Boolean).slice(0, 5).join('; ') || ''
    const acLine = ac ? `\n  Acceptance: ${ac}` : ''
    lines.push(
      `Story ${story.id}${story.epicId ? ` (epic ${story.epicId})` : ''}: ${story.title}${
        objective ? ` — ${objective}` : ''
      }${acLine}`,
    )
  }
  if (!lines.length && scope.markdown?.trim()) {
    return scope.markdown.trim().slice(0, 6000)
  }
  return lines.join('\n').trim()
}

/** Shared context from earlier wizard steps for work-plan advisory calls. */
export function workPlanAgentPayload(state: WizardState) {
  const stakeholderFeedback = stakeholderFeedbackFromState(state).trim()
  const scopeFeedback = productScopeSummaryForPlan(state.productScope)
  return {
    ...shapePlanContext(state),
    ...(stakeholderFeedback ? { stakeholderFeedback } : {}),
    ...(scopeFeedback ? { scopeFeedback } : {}),
  }
}

function stakeholderRoleSummary(state: WizardState) {
  return (state.stakeholderAssignments || [])
    .filter((row) => row.roleId || row.personName)
    .slice(0, 12)
    .map((row) => ({
      role_id: row.roleId,
      name: row.personName,
      email: row.personEmail,
    }))
}

/** Payload for plan-product-scope — original intent, groomed draft, people, prior tickets. */
export function scopePlanAgentPayload(state: WizardState, requirementText: string) {
  const wording = requirementText.trim()
  const original = (state.groomOriginal || state.requirementsText || '').trim()
  const stakeholderFeedback = stakeholderFeedbackFromState(state).trim()
  const stakeholders = stakeholderRoleSummary(state)
  const answers = (state.scopeAnswers || []).filter((row: GroomAnswer) => row.questionId)
  return {
    projectName: state.projectName,
    requirementText: wording,
    projectDescription: state.description?.trim() || undefined,
    originalRequirement: original && original !== wording ? original : undefined,
    actor: 'operator' as const,
    ...(stakeholderFeedback ? { stakeholderFeedback } : {}),
    ...(stakeholders.length ? { stakeholders } : {}),
    ...(answers.length ? { answers } : {}),
  }
}

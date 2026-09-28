import type { ImplementationHandoff } from './implementationHandoff'
import type { ImplementationExecutionPlan } from './types'

function tokenize(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9]{3,}/g) || []
}

function repositoriesForStep(handoff: ImplementationHandoff, stepText: string): string[] {
  const productRepositories = handoff.repositories.filter(
    (repository) =>
      repository.purpose.toLowerCase() !== 'workspace' && !repository.name.toLowerCase().endsWith('-workspace'),
  )
  const stepTerms = new Set(tokenize(stepText))
  const matched = productRepositories.filter((repository) => {
    const repositoryTerms = tokenize(`${repository.name} ${repository.purpose} ${repository.description}`)
    return repositoryTerms.some((term) => stepTerms.has(term))
  })
  return (matched.length ? matched : productRepositories).map((repository) => repository.id)
}

export function buildExecutionPlan(
  handoff: ImplementationHandoff,
  readinessDigest: string,
): ImplementationExecutionPlan {
  const sourceSteps = handoff.technicalPlan.steps.length
    ? handoff.technicalPlan.steps
    : ['Inspect the selected work item and propose the first executable change.']

  return {
    issueId: handoff.workItem.id,
    readinessDigest,
    stage: 'awaiting-cursor-confirmation',
    source: 'approved-technical-plan',
    steps: sourceSteps.map((source, index) => {
      const [, title = source, detail = ''] = source.match(/^\d+\.\s*([^:]+)(?::\s*(.*))?$/) || []
      return {
        id: `step-${index + 1}`,
        title: title.trim(),
        detail: detail.trim(),
        repositoryIds: repositoriesForStep(handoff, source),
        acceptanceCriteria: handoff.acceptanceCriteria,
        dependencies: index === 0 ? [] : [`step-${index}`],
      }
    }),
  }
}

export function executionPlanIsCurrent(
  plan: ImplementationExecutionPlan | null | undefined,
  issueId: string,
  readinessDigest: string | null | undefined,
): boolean {
  return Boolean(plan && readinessDigest && plan.issueId === issueId && plan.readinessDigest === readinessDigest)
}

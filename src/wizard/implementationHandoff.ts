import type { RepoDefinition, RepoTechnology } from './defaults'
import type { StorySummary, WizardState } from './types'

export const IMPLEMENTATION_HANDOFF_VERSION = '1.0'

export type HandoffRepository = {
  id: string
  name: string
  purpose: string
  description: string
  technology: {
    language: string
    framework: string
    database: string
    buildTool: string
  } | null
  suggestedBranch: string
}

export type ImplementationHandoff = {
  version: typeof IMPLEMENTATION_HANDOFF_VERSION
  project: {
    name: string
    description: string
  }
  workItem: {
    id: string
    title: string
    objective: string
  }
  requirement: string
  scope: string[]
  acceptanceCriteria: string[]
  stakeholderDecisions: string[]
  unresolvedConditions: string[]
  repositories: HandoffRepository[]
  technicalPlan: {
    summary: string
    steps: string[]
    rollback: string
    testStrategy: string
  }
  approvalsAndConditions: string[]
  cursorInstructions: string[]
  secretsFiltered: true
}

const REDACTED = '[REDACTED]'

/**
 * Removes credentials from copied or downloaded handoff material. It is a
 * defence-in-depth filter; integrations and raw configuration are never
 * included in the handoff in the first place.
 */
export function redactSecrets(value: string | null | undefined): string {
  if (!value) return ''
  return value
    .replace(
      /(\b(?:api[_ -]?key|access[_ -]?token|auth[_ -]?token|password|secret|private[_ -]?key)\b\s*[:=]\s*)[^\s,;]+/gi,
      `$1${REDACTED}`,
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/\-=]{12,}/gi, `Bearer ${REDACTED}`)
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,}|glpat-[A-Za-z0-9_-]{16,}|sk-[A-Za-z0-9_-]{16,})\b/gi, REDACTED)
}

function safe(value: string | null | undefined, fallback = 'Not recorded'): string {
  return redactSecrets(value?.trim()) || fallback
}

function safeList(values: readonly string[] | null | undefined): string[] {
  return (values || []).map((value) => safe(value, '')).filter(Boolean)
}

function selectedStory(state: WizardState, issueId: string): StorySummary | undefined {
  return state.productScope?.stories?.find((story) => story.id === issueId)
}

function branchSlug(issueId: string): string {
  const normalized = issueId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return normalized || 'work-item'
}

function repositoryHandoff(
  repo: RepoDefinition,
  technologies: RepoTechnology[],
  issueId: string,
): HandoffRepository {
  const technology = technologies.find((item) => item.repoId === repo.id)
  return {
    id: safe(repo.id, 'repository'),
    name: safe(repo.name, 'Unnamed repository'),
    purpose: safe(repo.purpose, 'Product repository'),
    description: safe(repo.description, ''),
    technology: technology
      ? {
          language: safe(technology.language, ''),
          framework: safe(technology.framework, ''),
          database: safe(technology.database, ''),
          buildTool: safe(technology.buildTool, ''),
        }
      : null,
    suggestedBranch: `feature/${branchSlug(issueId)}`,
  }
}

function stakeholderDecisions(state: WizardState): string[] {
  return state.questions
    .map((question) => {
      const response = state.responses.find((item) => item.questionId === question.id)
      const answer = response?.response?.trim() || question.jiraReplyBody?.trim()
      return response?.status === 'answered' && answer
        ? `${safe(question.question)} — ${safe(answer)}`
        : null
    })
    .filter((item): item is string => Boolean(item))
}

function unresolvedConditions(state: WizardState): string[] {
  return [
    ...safeList(state.scopeQuestions?.map((question) => question.text)),
    ...safeList(state.workClassification?.openQuestions),
    ...safeList(state.specification?.openQuestions),
    ...safeList(state.technicalPlan?.openQuestions),
  ].filter((item, index, values) => values.indexOf(item) === index)
}

export function buildImplementationHandoff(state: WizardState, issueId: string): ImplementationHandoff {
  const story = selectedStory(state, issueId)
  const requirement = safe(state.groomDraft || state.requirementsText)
  const storyScope = [
    story?.objective,
    story?.asA && story?.iWant
      ? `As ${story.asA}, I want ${story.iWant}${story.soThat ? `, so that ${story.soThat}` : ''}.`
      : null,
  ].filter((item): item is string => Boolean(item)).map((item) => safe(item))
  const acceptanceCriteria = safeList(story?.acceptanceCriteria).length
    ? safeList(story?.acceptanceCriteria)
    : safeList(state.specification?.acceptanceCriteria)
  const planSteps = state.technicalPlan?.steps?.map((step, index) => {
    const title = safe(step.title, `Step ${index + 1}`)
    const detail = safe(step.detail, '')
    return detail ? `${index + 1}. ${title}: ${detail}` : `${index + 1}. ${title}`
  }) || []

  return {
    version: IMPLEMENTATION_HANDOFF_VERSION,
    project: {
      name: safe(state.projectName, 'Unnamed project'),
      description: safe(state.description, ''),
    },
    workItem: {
      id: safe(issueId, 'Unspecified work item'),
      title: safe(story?.title || state.specification?.title, 'Selected implementation work item'),
      objective: safe(story?.objective || state.specification?.summary, ''),
    },
    requirement,
    scope: storyScope.length ? storyScope : ['Implement only the selected work item. Do not expand into unrelated product scope.'],
    acceptanceCriteria,
    stakeholderDecisions: stakeholderDecisions(state),
    unresolvedConditions: unresolvedConditions(state),
    repositories: state.repositories.map((repo) => repositoryHandoff(repo, state.repoTechnologies, issueId)),
    technicalPlan: {
      summary: safe(state.technicalPlan?.summary || state.technicalPlan?.markdown, ''),
      steps: planSteps,
      rollback: safe(state.technicalPlan?.rollback, ''),
      testStrategy: safe(state.technicalPlan?.testStrategy, ''),
    },
    approvalsAndConditions: [
      state.groomAcknowledged ? 'Grooming context acknowledged' : 'Grooming acknowledgement is missing',
      state.shapeAcknowledged ? 'Project shape and repository technologies reviewed' : 'Project shape review is missing',
      state.acceptanceCriteriaAcknowledged
        ? 'Acceptance criteria acknowledged'
        : 'Acceptance criteria acknowledgement is missing',
      state.planAcknowledged || state.shipPlanAcknowledged
        ? 'Technical plan acknowledged'
        : 'Technical plan acknowledgement is missing',
      state.gitApplyCommit?.sha
        ? `Workspace overlay committed at ${safe(state.gitApplyCommit.sha)}`
        : 'Workspace overlay commit is not recorded',
    ],
    cursorInstructions: [
      'Read this handoff before changing code.',
      'Inspect the listed repositories and their existing conventions before planning files.',
      'Run /sdlc-next and follow the returned stage guidance.',
      'Implement only the selected work item and its stated acceptance criteria on the suggested feature branch.',
      'Report blockers or missing information; do not bypass them or invent product decisions.',
      'Return a structured result to Blink with branch, changed repositories, validation performed, and blockers.',
    ],
    secretsFiltered: true,
  }
}

function markdownList(values: readonly string[], empty = 'None recorded'): string {
  return values.length ? values.map((value) => `- ${value}`).join('\n') : `- ${empty}`
}

export function renderImplementationHandoff(handoff: ImplementationHandoff): string {
  const repositories = handoff.repositories.length
    ? handoff.repositories.map((repo) => {
        const technology = repo.technology
          ? `${repo.technology.language}; ${repo.technology.framework}; ${repo.technology.database}; ${repo.technology.buildTool}`
          : 'Technology not recorded'
        return [
          `### ${repo.name}`,
          `- Purpose: ${repo.purpose}`,
          repo.description ? `- Description: ${repo.description}` : null,
          `- Technology: ${technology}`,
          `- Suggested branch: \`${repo.suggestedBranch}\``,
        ].filter(Boolean).join('\n')
      }).join('\n\n')
    : 'No repositories are recorded.'

  return [
    `# Cursor implementation handoff — ${handoff.workItem.id}`,
    '',
    `Handoff version: ${handoff.version}`,
    'Credentials and token-shaped values have been redacted.',
    '',
    '## Project',
    `- Name: ${handoff.project.name}`,
    `- Description: ${handoff.project.description}`,
    '',
    '## Work item',
    `- ID: ${handoff.workItem.id}`,
    `- Title: ${handoff.workItem.title}`,
    `- Objective: ${handoff.workItem.objective}`,
    '',
    '## Requirement',
    handoff.requirement,
    '',
    '## Scope',
    markdownList(handoff.scope),
    '',
    '## Acceptance criteria',
    markdownList(handoff.acceptanceCriteria),
    '',
    '## Stakeholder decisions',
    markdownList(handoff.stakeholderDecisions),
    '',
    '## Unresolved conditions',
    markdownList(handoff.unresolvedConditions),
    '',
    '## Repositories and technology',
    repositories,
    '',
    '## Technical plan',
    `Summary: ${handoff.technicalPlan.summary}`,
    '',
    'Steps:',
    markdownList(handoff.technicalPlan.steps),
    '',
    `Rollback: ${handoff.technicalPlan.rollback}`,
    `Test strategy: ${handoff.technicalPlan.testStrategy}`,
    '',
    '## Approvals and conditions',
    markdownList(handoff.approvalsAndConditions),
    '',
    '## Cursor instructions',
    markdownList(handoff.cursorInstructions),
    '',
  ].join('\n')
}

import type {
  ImplementationExecutionPlan,
  ImplementationProgressReport,
  ImplementationStage,
} from './types'

const STAGES: readonly ImplementationStage[] = [
  'waiting-to-start',
  'preparing',
  'implementing',
  'waiting-for-user-decision',
  'blocked',
  'reviewing',
  'validation-reported',
  'draft-pr-ready',
  'complete',
]

type JsonRecord = Record<string, unknown>

function redactProgressValue(value: string): string {
  return value
    .replace(
      /(\b(?:api[_ -]?key|access[_ -]?token|auth[_ -]?token|password|secret|private[_ -]?key)\b\s*[:=]\s*)[^\s,;]+/gi,
      '$1[REDACTED]',
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/\-=]{12,}/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,}|glpat-[A-Za-z0-9_-]{16,}|sk-[A-Za-z0-9_-]{16,})\b/gi, '[REDACTED]')
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? redactProgressValue(value).trim() || fallback : fallback
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => stringValue(item)).filter(Boolean)
    : []
}

function repositoryList(value: unknown): ImplementationProgressReport['repositories'] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!isRecord(item)) return []
    const name = stringValue(item.name)
    if (!name) return []
    return [{
      name,
      branch: stringValue(item.branch) || undefined,
      commits: stringList(item.commits),
    }]
  })
}

function createId(): string {
  return `cursor-result-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function progressResultTemplate(
  issueId: string,
  plan: ImplementationExecutionPlan,
): string {
  return JSON.stringify({
    issueId,
    stage: 'implementing',
    completedStepId: null,
    currentStepId: plan.steps[0]?.id || null,
    repositories: [
      {
        name: 'repository-name',
        branch: 'feature/work-item',
        commits: ['abc1234'],
      },
    ],
    changedFiles: ['path/to/changed-file.ts'],
    acceptanceCriteriaCovered: ['Copy the approved acceptance criterion covered by this result'],
    validation: ['Describe validation Cursor performed'],
    blockers: [],
    deviations: [],
    recommendedNextAction: 'Describe the next user or Cursor action',
    reportedAt: new Date().toISOString(),
  }, null, 2)
}

export function importProgressResult(
  text: string,
  expectedIssueId: string,
): { report: ImplementationProgressReport } | { error: string } {
  let input: unknown
  try {
    input = JSON.parse(text)
  } catch {
    return { error: 'Paste a valid JSON result from Cursor.' }
  }
  if (!isRecord(input)) return { error: 'The Cursor result must be a JSON object.' }

  const issueId = stringValue(input.issueId)
  if (!issueId) return { error: 'The Cursor result must include issueId.' }
  if (issueId !== expectedIssueId) {
    return { error: `This result is for ${issueId}, but the active handoff is ${expectedIssueId}.` }
  }
  const stage = stringValue(input.stage) as ImplementationStage
  if (!STAGES.includes(stage)) {
    return { error: `stage must be one of: ${STAGES.join(', ')}.` }
  }

  const importedAt = new Date().toISOString()
  return {
    report: {
      id: createId(),
      issueId,
      stage,
      completedStepId: stringValue(input.completedStepId) || null,
      currentStepId: stringValue(input.currentStepId) || null,
      repositories: repositoryList(input.repositories),
      changedFiles: stringList(input.changedFiles),
      acceptanceCriteriaCovered: stringList(input.acceptanceCriteriaCovered),
      validation: stringList(input.validation),
      blockers: stringList(input.blockers),
      deviations: stringList(input.deviations),
      recommendedNextAction: stringValue(input.recommendedNextAction, 'No next action was reported.'),
      reportedAt: stringValue(input.reportedAt, importedAt),
      importedAt,
    },
  }
}

export function stageLabel(stage: ImplementationStage): string {
  return stage.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

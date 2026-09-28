/**
 * Lightweight checks for the Cursor handoff model.
 * Run: node --experimental-strip-types src/wizard/implementationHandoff.check.ts
 */
import assert from 'node:assert/strict'
import { buildExecutionPlan } from './implementationExecutionPlan.ts'
import { buildImplementationHandoff, redactSecrets, renderImplementationHandoff } from './implementationHandoff.ts'
import { importProgressResult } from './implementationProgress.ts'

const state = {
  projectName: 'Fitoyo',
  description: 'Fitness planning',
  groomDraft: 'Add profile preferences. api_key=secret-value',
  requirementsText: '',
  productScope: {
    stories: [
      {
        id: 'FIT-42',
        title: 'Profile preferences',
        objective: 'Let members manage profile preferences.',
        acceptanceCriteria: ['Save a preference'],
      },
      { id: 'FIT-99', title: 'Unrelated billing work', acceptanceCriteria: ['Do not include'] },
    ],
  },
  repositories: [
    { id: 'workspace', name: 'fitoyo-workspace', purpose: 'Workspace', description: 'Planning artifacts' },
    { id: 'web', name: 'fitoyo-web', purpose: 'Frontend', description: 'Member UI' },
  ],
  repoTechnologies: [
    { repoId: 'web', language: 'TypeScript', framework: 'React', database: 'none', buildTool: 'Vite', status: 'confirmed' },
  ],
  questions: [],
  responses: [],
  scopeQuestions: [],
  workClassification: { openQuestions: [] },
  specification: { acceptanceCriteria: ['Fallback acceptance criterion'], openQuestions: [] },
  technicalPlan: {
    summary: 'Update profile form',
    steps: [{ title: 'Build the form', detail: 'Persist preferences' }],
    rollback: 'Revert the feature branch',
    testStrategy: 'Manual browser validation',
    openQuestions: [],
  },
  groomAcknowledged: true,
  shapeAcknowledged: true,
  acceptanceCriteriaAcknowledged: true,
  planAcknowledged: true,
  shipPlanAcknowledged: false,
  gitApplyCommit: { sha: 'abc1234' },
} as any

const handoff = buildImplementationHandoff(state, 'FIT-42')
const markdown = renderImplementationHandoff(handoff)

assert.equal(handoff.version, '1.0')
assert.equal(handoff.workItem.id, 'FIT-42')
assert.equal(handoff.workItem.title, 'Profile preferences')
assert.equal(markdown.includes('Unrelated billing work'), false)
assert.equal(markdown.includes('secret-value'), false)
assert.equal(markdown.includes('[REDACTED]'), true)
assert.equal(handoff.repositories[1].suggestedBranch, 'feature/fit-42')
assert.equal(redactSecrets('Authorization: Bearer abcdefghijklmnop'), 'Authorization: Bearer [REDACTED]')

const executionPlan = buildExecutionPlan(handoff, 'readiness-digest')
assert.equal(executionPlan.issueId, 'FIT-42')
assert.equal(executionPlan.stage, 'awaiting-cursor-confirmation')
assert.equal(executionPlan.steps[0].dependencies.length, 0)

const imported = importProgressResult(JSON.stringify({
  issueId: 'FIT-42',
  stage: 'blocked',
  currentStepId: 'step-1',
  repositories: [{ name: 'fitoyo-web', branch: 'feature/fit-42', commits: ['abc1234'] }],
  changedFiles: ['src/profile.ts'],
  validation: ['Manual check reported'],
  blockers: ['Need a product decision'],
  deviations: [],
  recommendedNextAction: 'Resolve the product decision.',
  reportedAt: '2026-09-25T00:00:00.000Z',
}), 'FIT-42')
assert.equal('error' in imported, false)
if (!('error' in imported)) {
  assert.equal(imported.report.stage, 'blocked')
  assert.equal(imported.report.blockers[0], 'Need a product decision')
}
assert.equal('error' in importProgressResult('{"issueId":"OTHER","stage":"implementing"}', 'FIT-42'), true)

console.log('implementationHandoff.check.ts: ok')

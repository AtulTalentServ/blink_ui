/**
 * Run: node --experimental-strip-types src/wizard/workPlanContext.check.ts
 */
import assert from 'node:assert/strict'
import { productScopeSummaryForPlan, scopePlanAgentPayload, workPlanAgentPayload } from './workPlanContext.ts'
import type { WizardState } from './types.ts'

const scope = productScopeSummaryForPlan({
  status: 'confirmed',
  epics: [{ id: 'E1', title: 'Auth' }],
  stories: [{ id: 'S1', epicId: 'E1', title: 'Login', acceptanceCriteria: ['User can sign in'] }],
})
assert.match(scope, /Epic E1/)
assert.match(scope, /Story S1/)

const payload = workPlanAgentPayload({
  topology: 'full-stack',
  repositoryModel: 'multi-repo',
  architectureStyle: 'microservices',
  repositories: [{ id: 'r1', name: 'api', purpose: 'backend', owner: '', htmlUrl: '' }],
  repoTechnologies: [
    { repoId: 'r1', language: 'Go', framework: 'chi', database: 'PostgreSQL', buildTool: 'go test', status: 'confirmed' },
  ],
  productScope: {
    epics: [{ id: 'E1', title: 'Auth' }],
    stories: [{ id: 'S1', epicId: 'E1', title: 'Login' }],
  },
  questions: [{ id: 'q1', question: 'Who pays?', mandatory: true, assignedRoleId: 'product_owner', sent: false }],
  responses: [{ questionId: 'q1', status: 'answered', response: 'Customer' }],
} as WizardState)
assert.equal(payload.topology, 'full-stack')
assert.match(payload.stakeholderFeedback || '', /Who pays/)
assert.match(payload.scopeFeedback || '', /Epic E1/)

const scopePayload = scopePlanAgentPayload(
  {
    projectName: 'SciCalc',
    description: 'Desktop scientific calculator',
    requirementsText: 'Build a calculator',
    groomOriginal: 'Build a calculator',
    groomDraft: '# Requirement: SciCalc\n## 1. Requirement metadata\n',
    stakeholderAssignments: [{ id: 'a1', roleId: 'product_owner', personName: 'Ada', personEmail: 'ada@x' }],
    questions: [{ id: 'q1', question: 'Who pays?', mandatory: true, assignedRoleId: 'product_owner', sent: false }],
    responses: [{ questionId: 'q1', status: 'answered', response: 'Customer' }],
    scopeAnswers: [],
  } as WizardState,
  '# Requirement: SciCalc\n## 1. Requirement metadata\n',
)
assert.equal(scopePayload.projectName, 'SciCalc')
assert.equal(scopePayload.originalRequirement, 'Build a calculator')
assert.match(scopePayload.stakeholderFeedback || '', /Who pays/)

console.log('workPlanContext.check.ts ok')

/**
 * Existing-project bind helpers.
 * Run: node --experimental-strip-types src/wizard/existing.check.ts
 */
import assert from 'node:assert/strict'
import { defaultWizardState } from './types.ts'
import {
  applyExistingBind,
  existingChangeBrief,
  existingDeliveryReady,
  existingProjectBound,
  humanizeRepoName,
  inferExistingShape,
  isExistingChangeBrief,
  parseGitRemote,
  validateExistingSource,
} from './existing.ts'
import { resumeTarget } from './resume.ts'
import { isStepVisible, nextVisibleStep, STEP_ORDER } from './steps.ts'

assert.deepEqual(parseGitRemote('https://github.com/acme/payments-api.git'), {
  host: 'github.com',
  owner: 'acme',
  name: 'payments-api',
  htmlUrl: 'https://github.com/acme/payments-api',
  fullName: 'acme/payments-api',
})
assert.equal(parseGitRemote('not-a-url'), null)
assert.deepEqual(inferExistingShape(1), {
  topology: 'full-stack',
  repositoryModel: 'single-repo',
  architectureStyle: 'layered',
})

const freshExisting = {
  ...defaultWizardState,
  projectType: 'existing' as const,
  repositories: [],
}
assert.equal(validateExistingSource(freshExisting), 'Bind at least one existing GitHub repository or Git URL.')
assert.ok(validateExistingSource({
  ...freshExisting,
  sourceZipName: 'app.zip',
})?.includes('ZIP'))

assert.equal(humanizeRepoName('payments-api'), 'Payments API')
const bound = applyExistingBind(freshExisting, [{
  name: 'payments-api',
  htmlUrl: 'https://github.com/acme/payments-api',
  language: 'Java',
  owner: 'acme',
  description: 'Card payments service',
}])
assert.equal(bound.projectName, 'Payments API')
assert.equal(bound.description, 'Card payments service')
assert.equal(bound.existingSourceMode, 'connect')
assert.equal(bound.setupContextReady, true)
assert.equal(bound.setupDeliveryReady, true)
assert.equal(bound.repositories?.[0]?.createStatus, 'exists')
assert.equal(bound.repoTechnologies?.[0]?.language, 'Java')
assert.ok(isExistingChangeBrief(bound.requirementsText))
assert.equal(
  bound.requirementsText,
  existingChangeBrief({ workMode: freshExisting.workMode, repos: [{ name: 'payments-api' }] }),
)
assert.equal(
  applyExistingBind({ ...freshExisting, requirementsText: 'Fix login timeout on checkout.' }, [{
    name: 'payments-api',
    htmlUrl: 'https://github.com/acme/payments-api',
  }]).requirementsText,
  'Fix login timeout on checkout.',
)
assert.equal(validateExistingSource({ ...freshExisting, ...bound }), null)
assert.equal(existingProjectBound({ ...freshExisting, ...bound }), true)
assert.equal(existingDeliveryReady({ ...freshExisting, ...bound }), true)

assert.equal(nextVisibleStep('integrations', 'new'), 'requirements')
assert.equal(nextVisibleStep('integrations', 'existing'), 'existing-source')
assert.equal(nextVisibleStep('stakeholder-qa', { projectType: 'existing', workMode: 'maintenance' }), 'sdlc-plan')
assert.equal(nextVisibleStep('stakeholder-qa', { projectType: 'existing', workMode: 'modernization' }), 'technology-per-repo')
assert.equal(nextVisibleStep('technology-per-repo', { projectType: 'existing', workMode: 'modernization' }), 'sdlc-plan')
assert.equal(isStepVisible('project-shape', { projectType: 'existing', workMode: 'maintenance' }), false)
assert.equal(isStepVisible('repositories', { projectType: 'existing', workMode: 'modernization' }), false)
assert.equal(isStepVisible('technology-per-repo', { projectType: 'existing', workMode: 'modernization' }), true)
assert.equal(isStepVisible('technology-per-repo', { projectType: 'existing', workMode: 'maintenance' }), false)
assert.equal(
  resumeTarget({
    step: 'integrations',
    completedThrough: STEP_ORDER.indexOf('integrations'),
    state: { ...defaultWizardState, projectType: 'new', projectName: 'Fitoyo' },
  }),
  'requirements',
)
assert.equal(
  resumeTarget({
    step: 'integrations',
    completedThrough: STEP_ORDER.indexOf('integrations'),
    state: { ...defaultWizardState, projectType: 'existing', projectName: 'Fitoyo' },
  }),
  'existing-source',
)

console.log('existing.check.ts: ok')

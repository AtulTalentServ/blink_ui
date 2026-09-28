/**
 * Wizard layout / shape-review checks.
 * Run: node --experimental-strip-types src/wizard/shape.check.ts
 */
import assert from 'node:assert/strict'
import { defaultWizardState } from './types.ts'
import { STEP_ORDER } from './steps.ts'
import {
  hasWorkPlanArtifacts,
  remapWizardProgress,
  shapeFingerprint,
  validateShapeReview,
  withShapeInvalidation,
} from './shape.ts'

assert.deepEqual(
  STEP_ORDER.slice(STEP_ORDER.indexOf('stakeholder-qa'), STEP_ORDER.indexOf('generation') + 1),
  ['stakeholder-qa', 'project-shape', 'repositories', 'technology-per-repo', 'sdlc-plan', 'generation'],
)
assert.equal(STEP_ORDER[STEP_ORDER.indexOf('generation') + 1], 'implementation')
assert.equal(STEP_ORDER[STEP_ORDER.indexOf('implementation') + 1], 'review-pr')
assert.equal(STEP_ORDER[STEP_ORDER.indexOf('review-pr') + 1], 'release')
assert.equal(STEP_ORDER.includes('sdlc-scope'), false)
assert.equal(STEP_ORDER.indexOf('requirements') + 1, STEP_ORDER.indexOf('stakeholder-qa'))

const planned = {
  ...defaultWizardState,
  wizardLayoutVersion: 0,
  workClassification: { tier: 2 },
  technicalPlan: { markdown: '# plan', steps: [{ title: 'one' }] },
  planAcknowledged: true,
}
assert.equal(hasWorkPlanArtifacts(planned), true)

const remappedPlan = remapWizardProgress({
  step: 'sdlc-plan',
  completedThrough: 6,
  state: { ...planned, shapeAcknowledged: false },
})
assert.equal(remappedPlan.step, 'project-shape')
assert.equal(remappedPlan.completedThrough, STEP_ORDER.indexOf('stakeholder-qa'))
assert.equal(remappedPlan.state.wizardLayoutVersion, 6)
assert.equal(remappedPlan.state.technicalPlan?.markdown, '# plan')

const remappedDone = remapWizardProgress({
  step: 'generation',
  completedThrough: 9,
  state: { ...defaultWizardState, wizardLayoutVersion: 0, generationComplete: true },
})
assert.equal(remappedDone.step, 'generation')
assert.equal(remappedDone.state.shapeAcknowledged, true)

const remappedScope = remapWizardProgress({
  step: 'sdlc-scope',
  completedThrough: 4,
  state: { ...defaultWizardState, wizardLayoutVersion: 2, sdlcStartIssueId: 'ST-1' },
})
assert.equal(remappedScope.step, 'requirements')
assert.equal(remappedScope.completedThrough, STEP_ORDER.indexOf('requirements'))
assert.equal(remappedScope.state.wizardLayoutVersion, 6)

const remappedWorkspace = remapWizardProgress({
  step: 'generation',
  completedThrough: STEP_ORDER.indexOf('generation'),
  state: { ...defaultWizardState, wizardLayoutVersion: 3, generationComplete: true },
})
assert.equal(remappedWorkspace.step, 'generation')
assert.equal(remappedWorkspace.completedThrough, STEP_ORDER.indexOf('generation'))
assert.equal(remappedWorkspace.state.wizardLayoutVersion, 6)

const remappedImplementation = remapWizardProgress({
  step: 'implementation',
  completedThrough: STEP_ORDER.indexOf('implementation'),
  state: { ...defaultWizardState, wizardLayoutVersion: 4 },
})
assert.equal(remappedImplementation.step, 'implementation')
assert.equal(remappedImplementation.completedThrough, STEP_ORDER.indexOf('implementation'))
assert.equal(remappedImplementation.state.wizardLayoutVersion, 6)

const remappedReview = remapWizardProgress({
  step: 'review-pr',
  completedThrough: STEP_ORDER.indexOf('review-pr'),
  state: { ...defaultWizardState, wizardLayoutVersion: 5 },
})
assert.equal(remappedReview.step, 'review-pr')
assert.equal(remappedReview.completedThrough, STEP_ORDER.indexOf('review-pr'))
assert.equal(remappedReview.state.wizardLayoutVersion, 6)

const before = { ...defaultWizardState, shapeAcknowledged: true, technicalPlan: { markdown: '# plan' } }
const invalidated = withShapeInvalidation(before, { topology: 'microservices' })
assert.equal(invalidated.shapeAcknowledged, false)
assert.equal(invalidated.technicalPlan, null)
assert.notEqual(shapeFingerprint(before), shapeFingerprint({ ...before, topology: 'microservices' }))

const untouched = withShapeInvalidation(before, { projectName: 'Fitoyo' })
assert.equal(untouched.technicalPlan, undefined)

const review = validateShapeReview({
  ...defaultWizardState,
  repositories: [{ id: 'web', name: 'fitoyo-web', purpose: 'UI', description: '', owner: '', dependencies: '' }],
  repoTechnologies: [
    {
      repoId: 'web',
      language: 'TypeScript',
      framework: 'React',
      database: 'none',
      buildTool: 'vite',
      status: 'confirmed',
    },
  ],
  shapeAcknowledged: false,
})
assert.equal(review, 'Review this setup, then confirm it is ready for the work plan.')

console.log('shape.check.ts: ok')

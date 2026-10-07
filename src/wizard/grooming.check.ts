/**
 * Requirement capture unlocks Stakeholder Q&A; wording confirmation controls tickets.
 * Run: node --experimental-strip-types src/wizard/grooming.check.ts
 */
import assert from 'node:assert/strict'
import { hasRequirementSource } from './groomingEligibility.ts'

assert.equal(hasRequirementSource({ requirementsText: '', requirementFileName: null }), false)
assert.equal(hasRequirementSource({ requirementsText: 'Build a calculator', requirementFileName: null }), true)
assert.equal(hasRequirementSource({ requirementsText: '', requirementFileName: 'requirements.pdf' }), true)

console.log('grooming.check.ts: ok')

/**
 * Requirement capture unlocks Stakeholder Q&A.
 * Wording confirm unlocks compose/send; G-GROOM unlocks Scope & tickets.
 * Run: node --experimental-strip-types src/wizard/grooming.check.ts
 */
import assert from 'node:assert/strict'
import { compactQuestionText, mergeFollowUpQuestions } from './grooming.ts'
import { hasRequirementSource } from './groomingEligibility.ts'
import type { GroomQuestion } from './types.ts'

assert.equal(hasRequirementSource({ requirementsText: '', requirementFileName: null }), false)
assert.equal(hasRequirementSource({ requirementsText: 'Build a calculator', requirementFileName: null }), true)
assert.equal(hasRequirementSource({ requirementsText: '', requirementFileName: 'requirements.pdf' }), true)

const roundOne: GroomQuestion[] = [
  {
    id: 'q1',
    text: 'Who books the visits?',
    options: [
      { id: 'opt-1', label: 'Receptionist' },
      { id: 'opt-2', label: 'Patients' },
    ],
    allowOther: true,
    priority: 'need_clarification',
  },
]
const merged = mergeFollowUpQuestions(roundOne, [
  {
    id: 'q1',
    text: 'Who books the visits?',
    options: [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ],
    allowOther: true,
    priority: 'important',
  },
  {
    id: 'q-platform',
    text: 'Where should v1 run?',
    options: [
      { id: 'web', label: 'Web' },
      { id: 'mobile', label: 'Mobile' },
    ],
    allowOther: true,
    priority: 'suggestion',
  },
])
assert.equal(merged.length, 2)
assert.equal(merged[1].id, 'q-platform')
assert.equal(merged[1].priority, 'need_clarification')
assert.equal(mergeFollowUpQuestions(roundOne, roundOne).length, 1)

assert.equal(
  compactQuestionText(
    '[Product behavior] What mathematical conventions should users see and control: degrees, radians, or a selectable angle mode? Also confirm required display precision and rounding behavior, including whether results should use a fixed decimal limit, significant digits, or an automatic format.',
  ),
  'What mathematical conventions should users see and control: degrees, radians, or a selectable angle mode?',
)
assert.equal(compactQuestionText('Who books the visits?'), 'Who books the visits?')
assert.equal(
  compactQuestionText(
    'Which scientific functions are required for the MVP? Please specify the exact list, such as square root, power, and sine.',
  ),
  'Which scientific functions are required for the MVP?',
)

console.log('grooming.check.ts: ok')

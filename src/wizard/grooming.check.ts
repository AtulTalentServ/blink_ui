/**
 * Requirement capture unlocks Stakeholder Q&A.
 * Wording confirm unlocks compose/send; G-GROOM unlocks Scope & tickets.
 * Run: node --experimental-strip-types src/wizard/grooming.check.ts
 */
import assert from 'node:assert/strict'
import {
  answersAreAllOptionPicks,
  answersWithNewDefaults,
  applyRecommendedAnswers,
  assignQuestionBands,
  compactQuestionText,
  computeClarifyFrontierState,
  mergeFollowUpQuestions,
  recommendedOptionForQuestion,
  splitQuestionTitleAndText,
  stitchWordingFromAnswers,
  stripClarificationTrailer,
} from './grooming.ts'
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

assert.equal(answersAreAllOptionPicks([{ questionId: 'q1', optionId: 'a', optionLabel: 'Web' }]), true)
assert.equal(
  answersAreAllOptionPicks([{ questionId: 'q1', optionId: 'other', otherText: 'tablet' }]),
  false,
)
assert.equal(
  stitchWordingFromAnswers('Build a calculator.', roundOne, [
    { questionId: 'q1', optionId: 'opt-1', optionLabel: 'Receptionist' },
  ]),
  'Build a calculator.\n\n- Receptionist',
)
assert.equal(
  stitchWordingFromAnswers(
    'Build a clinic app.\n\nDecisions from clarification:\n- Should it use degrees: Use degrees',
    [{ ...roundOne[0], title: 'Booking actor' }],
    [{ questionId: 'q1', optionId: 'other', otherText: 'Front-desk kiosk' }],
  ),
  'Build a clinic app.\n\n- Booking actor: Front-desk kiosk',
)
assert.equal(
  stripClarificationTrailer('Build a calculator.\n\nDecisions from clarification:\n- Q: A'),
  'Build a calculator.',
)

assert.equal(recommendedOptionForQuestion(roundOne[0])?.id, 'opt-1')
assert.deepEqual(applyRecommendedAnswers(roundOne, []), [
  { questionId: 'q1', optionId: 'opt-1', optionLabel: 'Receptionist' },
])
assert.deepEqual(answersWithNewDefaults([], roundOne, []), [
  { questionId: 'q1', optionId: 'opt-1', optionLabel: 'Receptionist' },
])
assert.deepEqual(
  answersWithNewDefaults(roundOne, roundOne, [{ questionId: 'q1', optionId: 'opt-2', optionLabel: 'Patients' }]),
  [{ questionId: 'q1', optionId: 'opt-2', optionLabel: 'Patients' }],
)

const split = splitQuestionTitleAndText(
  undefined,
  'Walk-in slot override: Should receptionists book urgent walk-ins into locked slots? Clinic leads audit overrides at end of day.',
)
assert.equal(split.title, 'Walk-in slot override')
assert.equal(
  split.text,
  'Should receptionists book urgent walk-ins into locked slots? Clinic leads audit overrides at end of day.',
)

const banded = assignQuestionBands([
  {
    id: 'q-walkin',
    text: 'Walk-in slot override: Should receptionists book urgent walk-ins into locked slots?',
    options: [
      { id: 'yes', label: 'Yes, allow override' },
      { id: 'no', label: 'No, block override' },
    ],
    allowOther: true,
  },
])
assert.equal(banded[0].title, 'Walk-in slot override')
assert.equal(banded[0].text, 'Should receptionists book urgent walk-ins into locked slots?')
assert.equal(banded[0].recommendedOptionId, 'yes')

const frontierUnanswered = computeClarifyFrontierState({
  groomQuestions: roundOne,
  groomAnswers: [],
  groomRound: 1,
  groomStatus: 'need_choices',
  groomConfirmed: false,
})
assert.equal(frontierUnanswered.canLockNow, true)
assert.equal(frontierUnanswered.finishNowLabel, 'Finish clarifying now')
assert.equal(frontierUnanswered.primaryLabel, 'Accept recommended & next round')

const frontierAnswered = computeClarifyFrontierState({
  groomQuestions: roundOne,
  groomAnswers: [{ questionId: 'q1', optionId: 'opt-1', optionLabel: 'Receptionist' }],
  groomRound: 1,
  groomStatus: 'need_choices',
  groomConfirmed: false,
})
assert.equal(frontierAnswered.primaryLabel, 'Submit round answers')

const frontierReady = computeClarifyFrontierState({
  groomQuestions: roundOne,
  groomAnswers: [{ questionId: 'q1', optionId: 'opt-1', optionLabel: 'Receptionist' }],
  groomRound: 1,
  groomStatus: 'draft_ready',
  groomConfirmed: false,
})
assert.equal(frontierReady.canLockNow, false)
assert.equal(frontierReady.primaryLabel, 'Confirm shared understanding')

console.log('grooming.check.ts: ok')

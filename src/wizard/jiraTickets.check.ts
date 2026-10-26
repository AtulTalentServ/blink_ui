/**
 * Node checks for Jira link reconciliation (no vitest dependency).
 * Run: node --experimental-strip-types src/wizard/jiraTickets.check.ts
 */
import assert from 'node:assert/strict'
import { reconcileBlinkJiraLinks, ticketTitlesMatch } from './jiraLink.ts'

assert.equal(ticketTitlesMatch('Sign in with a code', 'Sign in with a code'), true)
assert.equal(ticketTitlesMatch('Sign in with a code', '  sign   in with a code '), true)
assert.equal(ticketTitlesMatch('New calculator epic', 'Scientific calculator from March'), false)
assert.equal(ticketTitlesMatch('New calculator epic', ''), false)

const scope = {
  epics: [{ id: 'CALC-E001', title: 'Expression evaluator' }],
  stories: [{ id: 'CALC-E001-S001', title: 'Degree trig functions' }],
}

const oldIssues = [
  {
    key: 'FIT-12',
    sourceId: 'CALC-E001',
    summary: 'Scientific calculator from March',
    url: 'https://jira.example/browse/FIT-12',
    sourceKind: 'epic',
  },
  {
    key: 'FIT-13',
    sourceId: 'CALC-E001-S001',
    summary: 'Old sine story',
    url: 'https://jira.example/browse/FIT-13',
    sourceKind: 'story',
  },
]

const stored = reconcileBlinkJiraLinks(
  [
    { sourceId: 'CALC-E001', jiraKey: 'FIT-12', status: 'created' },
    { sourceId: 'CALC-E001-S001', jiraKey: 'FIT-13', status: 'created' },
  ],
  oldIssues,
  scope,
)
assert.equal(stored.changed, true)
assert.equal(stored.issues.length, 0)

const openRows = reconcileBlinkJiraLinks([], oldIssues, {
  epics: [{ id: 'CALC-E001', title: 'Scientific calculator from March' }],
  stories: [{ id: 'CALC-E001-S001', title: 'Something else' }],
})
assert.equal(openRows.changed, false)
assert.equal(openRows.issues.length, 0)

const recovered = reconcileBlinkJiraLinks(
  [],
  oldIssues,
  {
    epics: [{ id: 'CALC-E001', title: 'Scientific calculator from March' }],
    stories: [{ id: 'CALC-E001-S001', title: 'Something else' }],
  },
  { recover: true },
)
assert.deepEqual(
  recovered.issues.map((item) => item.jiraKey),
  ['FIT-12'],
)

const newest = reconcileBlinkJiraLinks(
  [],
  [
    { key: 'FIT-12', sourceId: 'CALC-E001', summary: 'Expression evaluator' },
    { key: 'FIT-40', sourceId: 'CALC-E001', summary: 'Expression evaluator' },
  ],
  { epics: [{ id: 'CALC-E001', title: 'Expression evaluator' }] },
  { recover: true },
)
assert.equal(newest.issues[0]?.jiraKey, 'FIT-40')

const sameTitle = reconcileBlinkJiraLinks(
  [{ sourceId: 'CALC-E001', jiraKey: 'FIT-40', status: 'created' }],
  [
    { key: 'FIT-12', sourceId: 'CALC-E001', summary: 'Expression evaluator' },
    { key: 'FIT-40', sourceId: 'CALC-E001', summary: 'Expression evaluator' },
  ],
  { epics: [{ id: 'CALC-E001', title: 'Expression evaluator' }] },
)
assert.equal(sameTitle.changed, false)
assert.equal(sameTitle.issues[0]?.jiraKey, 'FIT-40')

const inFlight = reconcileBlinkJiraLinks(
  [{ sourceId: 'CALC-E001', jiraKey: 'FIT-99', status: 'created' }],
  oldIssues,
  scope,
)
assert.equal(inFlight.changed, false)
assert.equal(inFlight.issues[0]?.jiraKey, 'FIT-99')

console.log('jiraTickets.check.ts: ok')

/**
 * Draft tickets (proposed epics/stories) are enough to leave Stakeholder Q&A.
 * Jira create and confirm-product-scope are not required for Continue.
 * Run: node --experimental-strip-types src/wizard/scopeGate.check.ts
 */
import assert from 'node:assert/strict'
import { hasDraftTickets, scopeConfirmed, validateSdlcScope } from './scopeGate.ts'

assert.equal(hasDraftTickets({}), false)
assert.equal(
  validateSdlcScope({ groomAcknowledged: true }),
  'Propose epics and stories on Scope & tickets, then continue.',
)

const drafts = {
  groomAcknowledged: true,
  productScope: {
    status: 'proposed',
    epics: [{ id: 'E1' }],
    stories: [{ id: 'S1' }],
  },
}
assert.equal(hasDraftTickets(drafts), true)
assert.equal(scopeConfirmed(drafts), false)
assert.equal(validateSdlcScope(drafts), null)

assert.equal(
  validateSdlcScope({
    ...drafts,
    productScope: { ...drafts.productScope, status: 'confirmed', confirmationDigest: 'abc' },
  }),
  null,
)

assert.equal(
  validateSdlcScope({}),
  'Acknowledge G-GROOM on Stakeholder Q&A → Stakeholders before Scope & tickets.',
)

console.log('scopeGate.check.ts ok')

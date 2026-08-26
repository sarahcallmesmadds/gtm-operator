'use strict'

/**
 * Tests for the organisation's rules: the alias map, the required-fields
 * rule, the member-status grid, and personas. Each declared shape is refused
 * by name when it does not hold, and each application shows its work.
 *
 * Run: node tests/import-leads-rules.test.js
 */

const assert = require('assert')

const rules = require('../plugins/import-leads/scripts/rules')

let failures = 0
const check = (name, fn) => {
  try {
    fn()
    console.log(`  ok    ${name}`)
  } catch (err) {
    failures++
    console.log(`  FAIL  ${name}`)
    console.log(`        ${err.message.split('\n').join('\n        ')}`)
  }
}

console.log('\nimport-leads rules\n')

const row = (index, fields) => ({ index, source: {}, fields, fieldSources: Object.fromEntries(Object.keys(fields).map(k => [k, 'list'])) })

// ------------------------------------------------------------- the alias map

check('the alias map shape is refused by name when it does not hold', () => {
  assert.ok(rules.aliasMapProblems(null).length)
  assert.ok(rules.aliasMapProblems({}).some(p => /no "aliases" object/.test(p)))
  assert.ok(rules.aliasMapProblems({ aliases: { X: '' } }).some(p => /non-empty string/.test(p)))
})

check('two foldings of one variant with different answers are refused: one variant, one answer', () => {
  const wrong = rules.aliasMapProblems({ aliases: { 'IBM  Corp': 'IBM', 'ibm corp': 'International Business Machines' } })
  assert.ok(wrong.some(p => /different canonical names/.test(p)), `expected the collision, got: ${wrong.join(' | ')}`)
})

check('aliases fire case-insensitively with whitespace collapsed, and each firing shows its work', () => {
  const map = { aliases: { 'ibm corp': 'IBM' } }
  const { rows, applied } = rules.applyAliases([row(1, { company: 'IBM   CORP' }), row(2, { company: 'Acme' })], map)
  assert.strictEqual(rows[0].fields.company, 'IBM')
  assert.deepStrictEqual(rows[0].aliasApplied, { from: 'IBM   CORP', to: 'IBM' })
  assert.strictEqual(rows[1].fields.company, 'Acme', 'a name the map does not carry passes through unchanged')
  assert.deepStrictEqual(applied, [{ index: 1, from: 'IBM   CORP', to: 'IBM' }])
})

check('nothing looser than case and whitespace fires: suffix stripping is judgment, not normalisation', () => {
  const map = { aliases: { IBM: 'International Business Machines' } }
  const { rows } = rules.applyAliases([row(1, { company: 'IBM Inc' })], map)
  assert.strictEqual(rows[0].fields.company, 'IBM Inc', 'IBM Inc is not the variant IBM, and deciding they are one company is the person\'s call')
})

// ------------------------------------------- free-mail and derived domains

check('free-mail flags the consumer providers, folded, and skips rows with no email', () => {
  const flagged = rules.freeMailRows([
    row(1, { email: ' Ivy.Lark@GMAIL.com ' }),
    row(2, { email: 'jon@yahoo.com' }),
    row(3, { email: 'cora@harborlane.example' }),
    row(4, {})
  ])
  assert.deepStrictEqual(flagged, [
    { index: 1, email: ' Ivy.Lark@GMAIL.com ', domain: 'gmail.com' },
    { index: 2, email: 'jon@yahoo.com', domain: 'yahoo.com' }
  ], 'a work domain passes and a no-email row is the dedupe step\'s question, not this one\'s')
})

check('a provider the list does not know passes through: absence of a flag is not a guarantee', () => {
  assert.deepStrictEqual(rules.freeMailRows([row(1, { email: 'a@obscure-free-mail.example' })]), [])
})

check('a company domain derives from the rows\' work emails only when they agree on one', () => {
  const agreed = rules.deriveCompanyDomain([
    row(1, { email: 'ada@acme.example' }),
    row(2, { email: 'ben@ACME.example' })
  ])
  assert.deepStrictEqual(agreed, { domain: 'acme.example', fromEmails: 2 })
})

check('zero or several distinct work domains derive nothing: choosing between them is the person\'s judgment', () => {
  assert.strictEqual(rules.deriveCompanyDomain([
    row(1, { email: 'ada@acme.example' }),
    row(2, { email: 'ben@other.example' })
  ]), null, 'two domains is a question, not a coin flip')
  assert.strictEqual(rules.deriveCompanyDomain([row(1, {})]), null, 'no emails derives nothing')
})

check('a personal address never becomes a company\'s search domain', () => {
  assert.strictEqual(rules.deriveCompanyDomain([row(1, { email: 'jon@yahoo.com' })]), null)
  const mixed = rules.deriveCompanyDomain([
    row(1, { email: 'jon@yahoo.com' }),
    row(2, { email: 'gus@brightquay.example' })
  ])
  assert.deepStrictEqual(mixed, { domain: 'brightquay.example', fromEmails: 1 }, 'the personal address is ignored, not counted as a second domain')
})

// ----------------------------------------------- the required-fields rule

check('a required field the plugin cannot fill is refused, not silently skipped', () => {
  const wrong = rules.requiredFieldsProblems({ required: ['title', 'starSign'] })
  assert.ok(wrong.some(p => /starSign/.test(p)))
})

check('an empty leadSourceValue is refused: leave it out or fill it', () => {
  assert.ok(rules.requiredFieldsProblems({ required: [], leadSourceValue: ' ' }).some(p => /leadSourceValue/.test(p)))
  assert.deepStrictEqual(rules.requiredFieldsProblems({ required: [] }), [])
})

// ------------------------------------------------------------------ the grid

const grid = () => ({
  naming: '{campaign} - {status}',
  types: { Event: ['Invited', 'Attended'], Content: ['Downloaded'] }
})

check('a naming template missing either placeholder is refused: two lists would share one name', () => {
  assert.ok(rules.gridProblems({ naming: '{campaign} members', types: { Event: ['Invited'] } }).some(p => /naming/.test(p)))
  assert.ok(rules.gridProblems({ naming: '{status} only', types: { Event: ['Invited'] } }).some(p => /naming/.test(p)))
  assert.deepStrictEqual(rules.gridProblems(grid()), [])
})

check('a duplicate status inside one type is refused', () => {
  assert.ok(rules.gridProblems({ naming: '{campaign} - {status}', types: { Event: ['Invited', 'Invited'] } }).some(p => /twice/.test(p)))
})

check('listName realises the grid\'s own convention', () => {
  assert.strictEqual(rules.listName(grid(), 'Autumn Summit', 'Attended'), 'Autumn Summit - Attended')
})

check('assignments are validated against the grid: uncovered types and statuses are questions, not defaults', () => {
  const campaigns = [{ name: 'Autumn Summit', type: 'Event' }, { name: 'Whitepaper', type: 'Webinar' }]
  const assignments = [
    { index: 1, campaign: 'Autumn Summit', status: 'Attended' },
    { index: 2, campaign: 'Autumn Summit', status: 'Ghosted' },
    { index: 3, campaign: 'Nowhere', status: 'Invited' }
  ]
  const wrong = rules.assignmentProblems(grid(), campaigns, assignments)
  assert.ok(wrong.some(p => /type "Webinar", which the grid does not cover|"Webinar", which the grid does not cover/.test(p)), `uncovered type: ${wrong.join(' | ')}`)
  assert.ok(wrong.some(p => /Ghosted/.test(p)), 'the uncovered status is named')
  assert.ok(wrong.some(p => /Nowhere/.test(p)), 'the unknown campaign is named')
  assert.ok(!wrong.some(p => /Row 1 /.test(p)), 'a covered assignment is not a problem')
})

check('no campaigns at all is a refusal pointing at the multi-event check', () => {
  assert.ok(rules.assignmentProblems(grid(), [], []).some(p => /multi-event/.test(p)))
})

// ------------------------------------------------------------------ personas

const personas = () => ({
  personas: ['Marketing Leader', 'Technology Leader'],
  rules: [
    { persona: 'Marketing Leader', titleContains: ['cmo', 'marketing'] },
    { persona: 'Technology Leader', titleContains: ['cto', 'engineering'] }
  ]
})

check('the personas shape is refused by name, including a rule naming an unlisted persona', () => {
  assert.ok(rules.personasProblems({ personas: [], rules: [] }).some(p => /personas has to be/.test(p)))
  const unlisted = personas()
  unlisted.rules.push({ persona: 'Sales Leader', titleContains: ['sales'] })
  assert.ok(rules.personasProblems(unlisted).some(p => /not in the personas list/.test(p)))
})

check('a single clear match fills the persona and names its source', () => {
  const { rows, flagged } = rules.applyPersonas([row(1, { title: 'VP Marketing Operations' })], personas())
  assert.strictEqual(rows[0].persona, 'Marketing Leader')
  assert.strictEqual(rows[0].personaSource, 'personas-artifact')
  assert.deepStrictEqual(flagged, [])
})

check('no match, more than one persona, and no title are flagged for review, never guessed', () => {
  const { rows, flagged } = rules.applyPersonas([
    row(1, { title: 'Head of Facilities' }),
    row(2, { title: 'CMO and CTO' }),
    row(3, {})
  ], personas())
  assert.ok(rows.every(r => !r.persona), 'nothing was guessed')
  assert.strictEqual(flagged.length, 3)
  assert.ok(/No rule/.test(flagged[0].why))
  assert.ok(/more than one persona/.test(flagged[1].why))
  assert.ok(/no title/.test(flagged[2].why))
})

console.log(failures ? `\n${failures} failed.\n` : '\nAll checks passed.\n')
process.exit(failures ? 1 : 0)

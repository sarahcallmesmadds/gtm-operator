'use strict'

/**
 * Tests for the judgment half: the gate, the multi-event signals, the dedupe
 * verdicts, and the assembly that refuses anything undecided.
 *
 * The assembly cases matter most here. Every one of its refusals guards a
 * rule the design states in as many words (no contact without its company,
 * no auto-resolved duplicate, no owner without a source, no campaign setup
 * without the multi-event check), and each case below fails when its guard
 * is removed.
 *
 * Run: node tests/import-leads-plan.test.js
 */

const assert = require('assert')

const plan = require('../plugins/import-leads/scripts/plan')

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

console.log('\nimport-leads planning\n')

const row = (index, fields, extra) => Object.assign({
  index,
  source: {},
  fields,
  fieldSources: Object.fromEntries(Object.keys(fields).map(k => [k, 'list']))
}, extra)

// --------------------------------------------------------------------- gates

check('the floor refuses a row without first and last name, with the gap named', () => {
  const { passed, refused } = plan.gate([row(1, { firstName: 'Ada', email: 'a@b.com' })], { required: [] })
  assert.deepStrictEqual(passed, [])
  assert.ok(refused[0].gaps.some(g => /lastName/.test(g)))
})

check('the org\'s required fields add to the floor and cannot subtract from it', () => {
  const rows = [row(1, { firstName: 'Ada', lastName: 'Lovelace', email: 'a@b.com' })]
  const { refused } = plan.gate(rows, { required: ['title'] })
  assert.ok(refused[0].gaps.some(g => /title/.test(g)))
})

check('a filled value with no source is refused, not repaired', () => {
  const bad = row(1, { firstName: 'Ada', lastName: 'Lovelace' })
  bad.fields.email = 'a@b.com'
  const { refused } = plan.gate([bad], { required: [] })
  assert.ok(refused[0].gaps.some(g => /names no source/.test(g)))
})

check('a broken required-fields rule is refused before any row is judged', () => {
  assert.throws(() => plan.gate([], { required: ['starSign'] }), /starSign/)
})

// ------------------------------------------------- the multi-event signals

check('a column whose few distinct values partition the rows is a grouping candidate', () => {
  const rows = [1, 2, 3, 4].map(i => row(i, {}, { source: { Event: i < 3 ? 'Summit' : 'Roadshow', Email: `p${i}@x.com` } }))
  const signals = plan.eventSignals(rows)
  assert.strictEqual(signals.checked, true)
  const candidate = signals.groupingCandidates.find(c => c.column === 'Event')
  assert.ok(candidate, 'the Event column partitions the rows')
  assert.ok(!signals.groupingCandidates.find(c => c.column === 'Email'), 'a unique-per-row column is not a grouping')
})

check('more than one distinct date in any column is flagged, even outside an obvious date column', () => {
  const rows = [
    row(1, {}, { source: { Notes: '2026-09-10' } }),
    row(2, {}, { source: { Notes: '2026-10-02' } })
  ]
  const signals = plan.eventSignals(rows)
  assert.ok(signals.dateColumns.find(c => c.column === 'Notes'))
})

check('event words are surfaced wherever they appear', () => {
  const rows = [row(1, {}, { source: { Campaign: 'Autumn Webinar Series' } }), row(2, {}, { source: { Campaign: 'Autumn Webinar Series' } })]
  const signals = plan.eventSignals(rows)
  assert.ok(signals.eventWordHits.find(h => h.column === 'Campaign'))
})

check('no rows at all is a refusal, not an empty answer', () => {
  assert.throws(() => plan.eventSignals([]), /there are none/)
})

// ------------------------------------------------------------------- dedupe

const existing = byEmail => ({ byEmail })

check('no match plans a create, a match with blanks plans a blanks-only fill, a full match plans nothing', () => {
  const rows = [
    row(1, { firstName: 'Ada', lastName: 'Lovelace', email: 'new@x.com', company: 'Acme' }),
    row(2, { firstName: 'Grace', lastName: 'Hopper', email: 'grace@x.com', title: 'Admiral', company: 'Navy' }),
    row(3, { firstName: 'Mary', lastName: 'Shelley', email: 'mary@x.com' })
  ]
  const result = plan.dedupeVerdicts(rows, existing({
    'grace@x.com': { id: '201', properties: { email: 'grace@x.com', title: '', company: 'Navy' } },
    'mary@x.com': { id: '202', properties: { email: 'mary@x.com', firstName: 'Mary', lastName: 'Shelley' } }
  }))
  assert.deepStrictEqual(result.verdicts[0], { index: 1, verdict: 'create' })
  assert.strictEqual(result.verdicts[1].verdict, 'update')
  assert.deepStrictEqual(result.verdicts[1].fill, { firstName: 'Grace', lastName: 'Hopper', title: 'Admiral' }, 'only blank fields are in the fill')
  assert.strictEqual(result.verdicts[2].verdict, 'nothing')
})

check('the fill never carries a field the existing record has a value in', () => {
  const rows = [row(1, { firstName: 'Ada', lastName: 'Byron', email: 'ada@x.com' })]
  const result = plan.dedupeVerdicts(rows, existing({
    'ada@x.com': { id: '7', properties: { email: 'ada@x.com', lastName: 'Lovelace' } }
  }))
  assert.ok(!('lastName' in result.verdicts[0].fill), 'a value a person or another tool wrote is never overwritten')
})

check('a company disagreement is a conflict, presented and never resolved', () => {
  const rows = [row(1, { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@x.com', company: 'Acme' })]
  const result = plan.dedupeVerdicts(rows, existing({
    'ada@x.com': { id: '7', properties: { email: 'ada@x.com', company: 'Initech' } }
  }))
  assert.strictEqual(result.conflicts.length, 1)
  assert.strictEqual(result.conflicts[0].listSays, 'Acme')
  assert.strictEqual(result.conflicts[0].crmSays, 'Initech')
})

check('rows sharing an email inside the list are reported together', () => {
  const rows = [
    row(1, { firstName: 'A', lastName: 'A', email: 'same@x.com' }),
    row(2, { firstName: 'B', lastName: 'B', email: 'same@x.com' })
  ]
  const result = plan.dedupeVerdicts(rows, existing({}))
  assert.deepStrictEqual(result.inListDuplicates, [{ email: 'same@x.com', rows: [1, 2] }])
})

check('a row with no email is unchecked, which is a different answer from new', () => {
  const result = plan.dedupeVerdicts([row(1, { firstName: 'A', lastName: 'A' })], existing({}))
  assert.deepStrictEqual(result.verdicts, [])
  assert.ok(/[Uu]nknown and new are different answers/.test(result.unchecked[0].why))
})

check('raw search responses are refused: dedupe reads only the judged results', () => {
  assert.throws(() => plan.dedupeVerdicts([], { results: [] }), /byEmail/)
})

check('an email enrichment spelled loosely still matches and still collides in-list', () => {
  // Enrichment fills emails after ingest, as the tool spelled them. Both the
  // match lookup and the in-list check fold before comparing.
  const loose = row(1, { firstName: 'Ada', lastName: 'Lovelace' })
  loose.fields.email = ' Ada@X.com '
  loose.fieldSources.email = 'enrichment:some-tool'
  const twin = row(2, { firstName: 'Ada', lastName: 'L', email: 'ada@x.com' })
  const result = plan.dedupeVerdicts([loose, twin], existing({
    'ada@x.com': { id: '7', properties: { email: 'ada@x.com', firstName: 'Ada', lastName: 'Lovelace' } }
  }))
  assert.ok(result.verdicts.every(v => v.verdict !== 'create'), 'both spellings matched the existing record')
  assert.deepStrictEqual(result.inListDuplicates, [{ email: 'ada@x.com', rows: [1, 2] }])
})

check('persona and owner join the blanks-only fill, never over a value already there, and lead source does not', () => {
  const carrying = row(1, { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@x.com' },
    { persona: 'Marketing Leader', personaSource: 'personas-artifact', owner: 'owner-9', ownerSource: 'routing' })
  const blankBoth = plan.dedupeVerdicts([carrying], existing({
    'ada@x.com': { id: '7', properties: { email: 'ada@x.com', firstName: 'Ada', lastName: 'Lovelace' } }
  }))
  assert.strictEqual(blankBoth.verdicts[0].fill.persona, 'Marketing Leader')
  assert.strictEqual(blankBoth.verdicts[0].fill.owner, 'owner-9')

  const filledBoth = plan.dedupeVerdicts([carrying], existing({
    'ada@x.com': { id: '7', properties: { email: 'ada@x.com', firstName: 'Ada', lastName: 'Lovelace', persona: 'Technology Leader', owner: 'owner-1' } }
  }))
  assert.strictEqual(filledBoth.verdicts[0].verdict, 'nothing', 'a persona or owner already there is never overwritten')
})

check('an impossible date is not date evidence: shape alone reported 2026-13-40 as a signal', () => {
  const rows = [
    row(1, {}, { source: { Notes: '2026-02-31' } }),
    row(2, {}, { source: { Notes: '2026-13-40' } })
  ]
  assert.deepStrictEqual(plan.eventSignals(rows).dateColumns, [])
  const real = [
    row(1, {}, { source: { Notes: '2026-09-10' } }),
    row(2, {}, { source: { Notes: 'Oct 2, 2026' } })
  ]
  assert.ok(plan.eventSignals(real).dateColumns.find(c => c.column === 'Notes'), 'real dates still signal')
})

// ------------------------------------------------------------- the assembly

const goodInput = () => ({
  rows: [
    row(1, { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@x.com', company: 'Acme' }),
    row(2, { firstName: 'Grace', lastName: 'Hopper', email: 'grace@x.com', title: 'Admiral' })
  ],
  events: { checked: true },
  dedupe: {
    verdicts: [
      { index: 1, verdict: 'create' },
      { index: 2, verdict: 'update', contactId: '201', fill: { title: 'Admiral' } }
    ],
    inListDuplicates: [],
    conflicts: [],
    unchecked: []
  },
  grid: { naming: '{campaign} - {status}', types: { Event: ['Invited', 'Attended'] } },
  requiredFields: { required: [] },
  campaigns: [{ name: 'Autumn Summit', type: 'Event' }],
  assignments: [
    { index: 1, campaign: 'Autumn Summit', status: 'Invited' },
    { index: 2, campaign: 'Autumn Summit', status: 'Attended' }
  ],
  companyDecisions: { Acme: { decision: 'create', website: 'acme.example' } },
  listDecisions: {
    'Autumn Summit - Invited': { outcome: 'absent' },
    'Autumn Summit - Attended': { outcome: 'exists', listId: '701' }
  },
  resolutions: {},
  config: {
    properties: { contact: { email: 'email' }, company: { name: 'name', website: 'website' } }
  }
})

check('a complete set of decided inputs assembles the whole plan', () => {
  const result = plan.assemble(goodInput())
  assert.strictEqual(result.ok, true, JSON.stringify(result.problems || []))
  assert.strictEqual(result.plan.contacts.creates.length, 1)
  assert.strictEqual(result.plan.contacts.updates.length, 1)
  assert.deepStrictEqual(result.plan.companies.creates, [{ name: 'Acme', website: 'acme.example', rows: [1] }])
  assert.deepStrictEqual(result.plan.lists.names, ['Autumn Summit - Attended', 'Autumn Summit - Invited'])
  assert.deepStrictEqual(result.plan.lists.creates, ['Autumn Summit - Invited'], 'a list judged absent is planned for creation')
  assert.deepStrictEqual(result.plan.lists.matched, [{ name: 'Autumn Summit - Attended', listId: '701' }], 'a list judged existing is matched by its id')
  assert.deepStrictEqual(result.plan.lists.memberships.find(m => m.list === 'Autumn Summit - Invited').rows, [1])
  assert.strictEqual(result.plan.writeback.kind, 'none')
  assert.strictEqual(result.plan.leadSource, null)
})

check('a list with no judged lookup blocks the plan: matched or planned means the portal was asked', () => {
  const input = goodInput()
  delete input.listDecisions['Autumn Summit - Invited']
  const result = plan.assemble(input)
  assert.strictEqual(result.ok, false)
  assert.ok(result.problems.some(p => /"Autumn Summit - Invited" has no judged lookup/.test(p)))
})

check('an incomplete dedupe search blocks the plan: a withheld contact is an unseen duplicate', () => {
  const input = goodInput()
  input.dedupe.searchIncomplete = [{ response: 1, why: 'The response carries paging, so results were withheld.' }]
  const result = plan.assemble(input)
  assert.strictEqual(result.ok, false)
  assert.ok(result.problems.some(p => /incomplete/.test(p) && /Re-run the search/.test(p)))
})

check('the assembly re-runs the gate: a sourceless value or a missing name cannot slip between the steps', () => {
  const input = goodInput()
  input.rows[0].fields.title = 'Countess'
  const result = plan.assemble(input)
  assert.strictEqual(result.ok, false)
  assert.ok(result.problems.some(p => /Row 1 fails the gate/.test(p) && /names no source/.test(p)))

  const nameless = goodInput()
  delete nameless.rows[1].fields.lastName
  delete nameless.rows[1].fieldSources.lastName
  assert.ok(plan.assemble(nameless).problems.some(p => /Row 2 fails the gate/.test(p) && /lastName/.test(p)))
})

check('two assignments realising one list name are a collision, named with both pairs', () => {
  const input = goodInput()
  input.grid.types.Event.push('B - Invited')
  input.campaigns.push({ name: 'Autumn Summit - B', type: 'Event' })
  input.rows.push(row(3, { firstName: 'Mary', lastName: 'Shelley', email: 'mary@x.com', company: 'Acme' }))
  input.dedupe.verdicts.push({ index: 3, verdict: 'create' })
  input.assignments = [
    { index: 1, campaign: 'Autumn Summit', status: 'B - Invited' },
    { index: 3, campaign: 'Autumn Summit - B', status: 'Invited' },
    { index: 2, campaign: 'Autumn Summit', status: 'Attended' }
  ]
  const result = plan.assemble(input)
  assert.strictEqual(result.ok, false)
  assert.ok(result.problems.some(p => /one list name, "Autumn Summit - B - Invited", to two different assignments/.test(p)))
})

check('a created company takes its website from the rows\' domain when the decision gives none', () => {
  const input = goodInput()
  input.companyDecisions = { Acme: { decision: 'create' } }
  input.rows[0].fields.companyDomain = 'acme-from-list.example'
  input.rows[0].fieldSources.companyDomain = 'list'
  const result = plan.assemble(input)
  assert.strictEqual(result.ok, true, JSON.stringify(result.problems || []))
  assert.strictEqual(result.plan.companies.creates[0].website, 'acme-from-list.example')
})

check('a confirmed owner with no mapped owner property blocks rather than silently vanishing', () => {
  const input = goodInput()
  input.rows[0].owner = 'owner-9'
  input.rows[0].ownerSource = 'confirmed'
  const result = plan.assemble(input)
  assert.strictEqual(result.ok, false)
  assert.ok(result.problems.some(p => /maps no owner property/.test(p)))

  input.config.properties.contact.owner = 'hubspot_owner_id'
  assert.strictEqual(plan.assemble(input).ok, true, 'with the property mapped, the confirmed owner assembles')
})

check('a missing input is refused by name, and campaign setup without the multi-event check is refused', () => {
  const missing = goodInput()
  delete missing.dedupe
  assert.throws(() => plan.assemble(missing), /cannot be assembled without dedupe/)

  const unchecked = goodInput()
  unchecked.events = { checked: false }
  assert.throws(() => plan.assemble(unchecked), /multi-event check has not run/)
})

check('a create whose company has no decision is refused: matched or planned, never neither', () => {
  const input = goodInput()
  input.companyDecisions = {}
  const result = plan.assemble(input)
  assert.strictEqual(result.ok, false)
  assert.ok(result.problems.some(p => /"Acme" has no match-or-create decision/.test(p)))
})

check('a create with no company at all is refused by the floor', () => {
  const input = goodInput()
  delete input.rows[0].fields.company
  delete input.rows[0].fieldSources.company
  const result = plan.assemble(input)
  assert.strictEqual(result.ok, false)
  assert.ok(result.problems.some(p => /no company and is planned as a create/.test(p)))
})

check('an unresolved in-list duplicate blocks the plan until excluded or deliberately kept', () => {
  const input = goodInput()
  input.dedupe.inListDuplicates = [{ email: 'ada@x.com', rows: [1, 2] }]
  const result = plan.assemble(input)
  assert.strictEqual(result.ok, false)
  assert.ok(result.problems.some(p => /share the email/.test(p)))

  input.resolutions = { decided: [1, 2] }
  assert.strictEqual(plan.assemble(input).ok, true, 'marking them decided is the person keeping both, deliberately')
})

check('an undecided conflict and an undecided no-email row block the plan', () => {
  const input = goodInput()
  input.dedupe.conflicts = [{ index: 1, email: 'ada@x.com', listSays: 'Acme', crmSays: 'Initech' }]
  const result = plan.assemble(input)
  assert.strictEqual(result.ok, false)
  assert.ok(result.problems.some(p => /never auto-resolved/.test(p)))

  const second = goodInput()
  second.dedupe.unchecked = [{ index: 2, why: 'no email' }]
  assert.ok(plan.assemble(second).problems.some(p => /could not be dedupe-checked/.test(p)))
})

check('an excluded row needs no assignment and appears only under excluded', () => {
  const input = goodInput()
  input.assignments = [{ index: 1, campaign: 'Autumn Summit', status: 'Invited' }]
  input.resolutions = { excluded: [{ index: 2, why: 'not our segment' }] }
  const result = plan.assemble(input)
  assert.strictEqual(result.ok, true, JSON.stringify(result.problems || []))
  assert.deepStrictEqual(result.plan.contacts.excluded, [{ index: 2, why: 'not our segment' }])
  assert.strictEqual(result.plan.contacts.updates.length, 0)
})

check('an owner with no recorded source is refused: routing or explicit confirmation, never a default', () => {
  const input = goodInput()
  input.rows[0].owner = 'owner-1'
  const result = plan.assemble(input)
  assert.strictEqual(result.ok, false)
  assert.ok(result.problems.some(p => /owner with no recorded source/.test(p)))

  input.rows[0].ownerSource = 'confirmed'
  input.config.properties.contact.owner = 'hubspot_owner_id'
  assert.strictEqual(plan.assemble(input).ok, true)
})

check('the lead source needs both halves: the artifact value and the mapped property, together or not at all', () => {
  const valueOnly = goodInput()
  valueOnly.requiredFields = { required: [], leadSourceValue: 'Content' }
  assert.ok(plan.assemble(valueOnly).problems.some(p => /maps no leadSource property/.test(p)))

  const propertyOnly = goodInput()
  propertyOnly.config.properties.contact.leadSource = 'lead_source'
  assert.ok(plan.assemble(propertyOnly).problems.some(p => /no value for it/.test(p)))

  const both = goodInput()
  both.requiredFields = { required: [], leadSourceValue: 'Content' }
  both.config.properties.contact.leadSource = 'lead_source'
  const result = plan.assemble(both)
  assert.strictEqual(result.ok, true)
  assert.deepStrictEqual(result.plan.leadSource, { property: 'lead_source', value: 'Content' })
})

check('a Notion-sourced plan writes back and a CSV plan never does', () => {
  const input = goodInput()
  input.rows[0].notionPageId = 'page-1'
  const result = plan.assemble(input)
  assert.strictEqual(result.plan.writeback.kind, 'notion')
})

console.log(failures ? `\n${failures} failed.\n` : '\nAll checks passed.\n')
process.exit(failures ? 1 : 0)

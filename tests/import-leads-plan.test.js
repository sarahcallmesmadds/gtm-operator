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

check('a contact stored under a replaced address is surfaced: the original is an identity too', () => {
  // An approved enrichment replacement moves the row to the work address
  // and keeps the personal one on `replacedEmail`. Without this check the
  // CRM contact under the personal address is missed and the portal
  // accepts a second record, because the emails differ.
  const replaced = row(1, { firstName: 'Vik', lastName: 'Moss', email: 'vik.moss@peatmarsh.example' }, { replacedEmail: ' Vik.Moss@GMAIL.com ' })
  replaced.fieldSources.email = 'enrichment:some-tool'
  const result = plan.dedupeVerdicts([replaced], existing({
    'vik.moss@gmail.com': { id: '88', properties: { email: 'vik.moss@gmail.com', firstName: 'Vik' } }
  }))
  assert.strictEqual(result.verdicts[0].verdict, 'create', 'the new address matched nothing, so the verdict alone would create')
  assert.strictEqual(result.replacedEmailMatches.length, 1)
  assert.strictEqual(result.replacedEmailMatches[0].contactId, '88')
  assert.strictEqual(result.replacedEmailMatches[0].replacedEmail, 'vik.moss@gmail.com', 'folded before matching')
  assert.ok(/never auto-resolved/.test(result.replacedEmailMatches[0].why))

  const clean = plan.dedupeVerdicts([replaced], existing({}))
  assert.deepStrictEqual(clean.replacedEmailMatches, [], 'no contact under either address, nothing surfaced')
})

check('replaced addresses collide in-list: a row still carrying the original, or two rows replacing the same one', () => {
  const moved = row(1, { firstName: 'Vik', lastName: 'Moss', email: 'vik@peatmarsh.example' }, { replacedEmail: 'vik.moss@gmail.com' })
  const stayed = row(2, { firstName: 'Vik', lastName: 'M', email: 'vik.moss@gmail.com' })
  const first = plan.dedupeVerdicts([moved, stayed], existing({}))
  assert.deepStrictEqual(first.inListDuplicates, [{ email: 'vik.moss@gmail.com', rows: [1, 2] }],
    'different current emails, same person: the replaced address is the shared identity')

  const twinA = row(1, { firstName: 'Vik', lastName: 'Moss', email: 'vik@peatmarsh.example' }, { replacedEmail: 'vik.moss@gmail.com' })
  const twinB = row(2, { firstName: 'Vik', lastName: 'Moss', email: 'v.moss@peatmarsh.example' }, { replacedEmail: 'vik.moss@gmail.com' })
  const second = plan.dedupeVerdicts([twinA, twinB], existing({}))
  assert.deepStrictEqual(second.inListDuplicates, [{ email: 'vik.moss@gmail.com', rows: [1, 2] }],
    'two rows that replaced the same address are one person twice')
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

check('a named-month day has to exist in its month', () => {
  const impossible = [
    row(1, {}, { source: { When: 'Feb 31, 2026' } }),
    row(2, {}, { source: { When: 'Apr 31' } })
  ]
  assert.deepStrictEqual(plan.eventSignals(impossible).dateColumns, [])
  const real = [
    row(1, {}, { source: { When: 'Feb 28, 2026' } }),
    row(2, {}, { source: { When: 'Apr 30' } })
  ]
  assert.ok(plan.eventSignals(real).dateColumns.find(c => c.column === 'When'))
})

check('full month names work the same as their three-letter forms', () => {
  // A round-4 review claimed the capture took the whole word and the month
  // lookup missed; run against the real code, the capture group takes only
  // the three-letter prefix. This case keeps that measured answer true.
  const real = [
    row(1, {}, { source: { When: 'January 15, 2026' } }),
    row(2, {}, { source: { When: 'February 2, 2026' } })
  ]
  assert.ok(plan.eventSignals(real).dateColumns.find(c => c.column === 'When'))
  const impossible = [
    row(1, {}, { source: { When: 'February 31, 2026' } }),
    row(2, {}, { source: { When: 'April 31, 2026' } })
  ]
  assert.deepStrictEqual(plan.eventSignals(impossible).dateColumns, [])
})

check('a word that merely starts like a month is not a date', () => {
  // The loose `[a-z]*` tail read "Janitor 15, 2026" as a date. The names
  // are now spelled out as their real forms.
  const notDates = [
    row(1, {}, { source: { What: 'Janitor 15, 2026' } }),
    row(2, {}, { source: { What: 'Febrile 2, 2026' } })
  ]
  assert.deepStrictEqual(plan.eventSignals(notDates).dateColumns, [])
  const abbreviated = [
    row(1, {}, { source: { What: 'Sept 5' } }),
    row(2, {}, { source: { What: 'Dec. 12, 2026' } })
  ]
  assert.ok(plan.eventSignals(abbreviated).dateColumns.find(c => c.column === 'What'), 'the real abbreviations still signal')
})

check('a slash date has to be a real day-and-month in one of its two orders', () => {
  const impossible = [
    row(1, {}, { source: { When: '31/02/2026' } }),
    row(2, {}, { source: { When: '45/45/2026' } })
  ]
  assert.deepStrictEqual(plan.eventSignals(impossible).dateColumns, [], 'February 31 is not a date in either order')
  const american = [
    row(1, {}, { source: { When: '12/31/2026' } }),
    row(2, {}, { source: { When: '01/05/2026' } })
  ]
  assert.ok(plan.eventSignals(american).dateColumns.find(c => c.column === 'When'), 'month-first readings still signal')
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

check('excluding one of a three-way duplicate and deciding the kept two is a valid resolution', () => {
  // The guard used to demand the EXCLUDED row in decided as well, so the
  // exclusion itself made the resolution impossible.
  const input = goodInput()
  input.rows.push(row(3, { firstName: 'Ada', lastName: 'Byron', email: 'ada@x.com', company: 'Acme' }))
  input.dedupe.verdicts.push({ index: 3, verdict: 'create' })
  input.dedupe.inListDuplicates = [{ email: 'ada@x.com', rows: [1, 2, 3] }]
  input.assignments.push({ index: 3, campaign: 'Autumn Summit', status: 'Invited' })
  input.resolutions = { excluded: [{ index: 3, why: 'same person as row 1, thinner row' }], decided: [1, 2] }
  const result = plan.assemble(input)
  assert.strictEqual(result.ok, true, JSON.stringify(result.problems || []))

  input.resolutions = { excluded: [{ index: 3, why: 'same person as row 1' }], decided: [1] }
  assert.ok(plan.assemble(input).problems.some(p => /share the email/.test(p)), 'a kept row nobody decided still blocks')
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

check('a personal address still on a row blocks the plan until excluded or deliberately decided', () => {
  const input = goodInput()
  input.rows[0].fields.email = 'ada@gmail.com'
  const result = plan.assemble(input)
  assert.strictEqual(result.ok, false)
  assert.ok(result.problems.some(p => /Row 1/.test(p) && /personal address ada@gmail\.com/.test(p) && /a decision, not a default/.test(p)))

  input.resolutions = { decided: [1] }
  assert.strictEqual(plan.assemble(input).ok, true, 'keeping it is the person\'s deliberate call')

  const excludedInstead = goodInput()
  excludedInstead.rows[0].fields.email = 'ada@gmail.com'
  excludedInstead.resolutions = { excluded: [{ index: 1, why: 'personal address, no work email found' }] }
  assert.strictEqual(plan.assemble(excludedInstead).ok, true, 'an excluded flagged row no longer blocks')

  const replacedRow = goodInput()
  replacedRow.rows[0].replacedEmail = 'ada@gmail.com'
  assert.strictEqual(plan.assemble(replacedRow).ok, true, 'a replaced row carries a work address now and is not flagged')
})

check('an empty adoption fill is refused: the portal reads an empty PATCH value as a clear', () => {
  const empties = [{ name: '' }, { name: null }, { website: '   ' }]
  for (const fill of empties) {
    const input = goodInput()
    input.rows[0].fields.company = 'Bright Quay Ops'
    input.companyDecisions = { 'Bright Quay Ops': { decision: 'match', companyId: '77', fill } }
    const result = plan.assemble(input)
    assert.strictEqual(result.ok, false, JSON.stringify(fill))
    assert.ok(result.problems.some(p => /empty (name|website) fill/.test(p) && /clear, not a fill/.test(p)), JSON.stringify(result.problems))
  }
})

check('an undecided replaced-email match blocks the plan like a conflict does', () => {
  const input = goodInput()
  input.dedupe.replacedEmailMatches = [{ index: 1, replacedEmail: 'ada@gmail.com', contactId: '88', why: 'presented' }]
  const result = plan.assemble(input)
  assert.strictEqual(result.ok, false)
  assert.ok(result.problems.some(p => /Row 1/.test(p) && /address this row replaced/.test(p) && /ada@gmail\.com/.test(p)))

  input.resolutions = { decided: [1] }
  assert.strictEqual(plan.assemble(input).ok, true, 'deciding the row is the person keeping it, deliberately')
})

check('an adoption fill on a matched company rides the plan, validated against the contract\'s company fields', () => {
  const input = goodInput()
  input.rows[0].fields.company = 'Bright Quay Ops'
  input.companyDecisions = { 'Bright Quay Ops': { decision: 'match', companyId: '77', fill: { name: 'Bright Quay Ops' } } }
  const result = plan.assemble(input)
  assert.strictEqual(result.ok, true, JSON.stringify(result.problems || []))
  assert.deepStrictEqual(result.plan.companies.matched, [{ name: 'Bright Quay Ops', companyId: '77', rows: [1], fill: { name: 'Bright Quay Ops' } }])

  const unknownField = goodInput()
  unknownField.rows[0].fields.company = 'Bright Quay Ops'
  unknownField.companyDecisions = { 'Bright Quay Ops': { decision: 'match', companyId: '77', fill: { name: 'X', lifecycle: 'lead' } } }
  assert.ok(plan.assemble(unknownField).problems.some(p => /fill for lifecycle/.test(p) && /only name and website/.test(p)))

  const unmappedWebsite = goodInput()
  delete unmappedWebsite.config.properties.company.website
  unmappedWebsite.rows[0].fields.company = 'Bright Quay Ops'
  unmappedWebsite.companyDecisions = { 'Bright Quay Ops': { decision: 'match', companyId: '77', fill: { website: 'x.example' } } }
  assert.ok(plan.assemble(unmappedWebsite).problems.some(p => /website fill/.test(p) && /silently lost/.test(p)))
})

check('an adoption no create needs still rides the plan: the run that taught this had only an update on the company', () => {
  const input = goodInput()
  input.companyDecisions.Adopted = { decision: 'match', companyId: '42', fill: { name: 'Adopted Co' } }
  const result = plan.assemble(input)
  assert.strictEqual(result.ok, true, JSON.stringify(result.problems || []))
  const adopted = result.plan.companies.matched.find(m => m.name === 'Adopted Co' || m.name === 'Adopted')
  assert.ok(adopted, 'the fill-carrying match is in the plan without any create needing it')
  assert.deepStrictEqual(adopted.fill, { name: 'Adopted Co' })
  assert.deepStrictEqual(adopted.rows, [])

  const plainMatch = goodInput()
  plainMatch.companyDecisions.Elsewhere = { decision: 'match', companyId: '43' }
  const second = plan.assemble(plainMatch)
  assert.ok(!second.plan.companies.matched.some(m => m.name === 'Elsewhere'), 'a fill-less match nothing needs stays out of the plan')
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

check('an update fill is proved against the gated row: a smuggled value or a lead source blocks', () => {
  // The verdicts arrive as caller input, so a fill is a claim. Without this
  // check, a hand-edited fill pushed a value the gate never saw.
  const smuggled = goodInput()
  smuggled.dedupe.verdicts[1].fill = { title: 'Invented', leadSource: 'Imported' }
  const result = plan.assemble(smuggled)
  assert.strictEqual(result.ok, false)
  assert.ok(result.problems.some(p => /Row 2: the update fill carries title/.test(p)))
  assert.ok(result.problems.some(p => /leadSource/.test(p)))

  const honest = goodInput()
  assert.strictEqual(plan.assemble(honest).ok, true, 'the row\'s own sourced title still fills')
})

check('a smuggled persona or owner in the fill blocks the same way a smuggled list field does', () => {
  const persona = goodInput()
  persona.dedupe.verdicts[1].fill = { persona: 'Invented Leader' }
  assert.ok(plan.assemble(persona).problems.some(p => /Row 2: the update fill carries persona/.test(p)), 'a persona the row does not carry with a source is refused')

  const owner = goodInput()
  owner.dedupe.verdicts[1].fill = { owner: 'owner-9' }
  assert.ok(plan.assemble(owner).problems.some(p => /Row 2: the update fill carries owner/.test(p)), 'an owner with no recorded source is refused in the fill too')
})

check('the domain fallback fires only when a website property is mapped; an explicit website without one blocks', () => {
  const unmapped = goodInput()
  delete unmapped.config.properties.company.website
  unmapped.companyDecisions = { Acme: { decision: 'create' } }
  unmapped.rows[0].fields.companyDomain = 'acme.example'
  unmapped.rows[0].fieldSources.companyDomain = 'list'
  const bare = plan.assemble(unmapped)
  assert.strictEqual(bare.ok, true, JSON.stringify(bare.problems || []))
  assert.strictEqual(bare.plan.companies.creates[0].website, null, 'no mapping, so the automatic fallback does not fire and the company is created bare')

  unmapped.companyDecisions = { Acme: { decision: 'create', website: 'acme.example' } }
  const explicit = plan.assemble(unmapped)
  assert.strictEqual(explicit.ok, false)
  assert.ok(explicit.problems.some(p => /decided as a create with a website/.test(p)))
})

check('a Notion-sourced plan writes back and a CSV plan never does', () => {
  const input = goodInput()
  input.rows[0].notionPageId = 'page-1'
  const result = plan.assemble(input)
  assert.strictEqual(result.plan.writeback.kind, 'notion')
})

// ------------------------------------------------ the salesforce assembly

const salesforceInput = () => {
  const input = goodInput()
  delete input.listDecisions
  input.config = {
    crm: 'salesforce',
    orgAlias: 'acceptance-org',
    properties: { contact: { email: 'Email' }, company: { name: 'Name', website: 'Website' } }
  }
  input.campaigns = [
    { name: 'Autumn Summit', type: 'Event' },
    { name: 'Spring Roadshow', type: 'Event' }
  ]
  input.assignments = [
    { index: 1, campaign: 'Autumn Summit', status: 'Invited' },
    { index: 2, campaign: 'Spring Roadshow', status: 'Attended' }
  ]
  input.campaignDecisions = {
    'Autumn Summit': { outcome: 'absent' },
    'Spring Roadshow': { outcome: 'exists', campaignId: '701M' }
  }
  input.campaignStatuses = {
    'Spring Roadshow': { labels: ['Sent', 'Responded'], maxSortOrder: 2 }
  }
  input.marketingUser = { userId: '005U', on: true }
  return input
}

check('a salesforce plan realises memberships as campaigns and native statuses, with no lists at all', () => {
  const result = plan.assemble(salesforceInput())
  assert.strictEqual(result.ok, true, JSON.stringify(result.problems || []))
  assert.ok(!('lists' in result.plan), 'the list realisation is HubSpot\'s and does not travel')
  const m = result.plan.campaignMemberships
  assert.deepStrictEqual(m.campaigns.creates, [{ name: 'Autumn Summit', type: 'Event' }])
  assert.deepStrictEqual(m.campaigns.matched, [{ name: 'Spring Roadshow', campaignId: '701M' }])
  assert.deepStrictEqual(m.statuses.creates, [
    { campaign: 'Autumn Summit', label: 'Invited', sortOrder: 3 },
    { campaign: 'Spring Roadshow', label: 'Attended', sortOrder: 3 }
  ], 'a fresh campaign already carries Sent and Responded, so a new status starts at 3; a matched one starts past its own rows')
  assert.deepStrictEqual(m.members, [
    { campaign: 'Autumn Summit', status: 'Invited', rows: [1] },
    { campaign: 'Spring Roadshow', status: 'Attended', rows: [2] }
  ])
  assert.strictEqual(m.userFlagFix, null, 'the flag reads on, so there is nothing to fix')
})

check('Sent and Responded are never planned as creates on a new campaign: a fresh campaign carries them', () => {
  const input = salesforceInput()
  input.grid.types.Event.push('Sent')
  input.assignments[0].status = 'Sent'
  const result = plan.assemble(input)
  assert.strictEqual(result.ok, true, JSON.stringify(result.problems || []))
  assert.ok(!result.plan.campaignMemberships.statuses.creates.some(s => s.label === 'Sent'))
  assert.ok(result.plan.campaignMemberships.members.some(m => m.status === 'Sent'), 'the membership itself still lands')
})

check('the flag off puts the one-call fix in the plan; unread or malformed, the plan refuses to assemble', () => {
  const off = salesforceInput()
  off.marketingUser = { userId: '005U', on: false }
  const result = plan.assemble(off)
  assert.strictEqual(result.ok, true, JSON.stringify(result.problems || []))
  assert.deepStrictEqual(result.plan.campaignMemberships.userFlagFix, { userId: '005U' })

  const malformed = salesforceInput()
  malformed.marketingUser = { on: 'maybe' }
  const refused = plan.assemble(malformed)
  assert.strictEqual(refused.ok, false)
  assert.ok(refused.problems.some(p => /Marketing User flag has not been read/.test(p)))

  const absent = salesforceInput()
  delete absent.marketingUser
  assert.throws(() => plan.assemble(absent), /cannot be assembled without marketingUser/)
})

check('a campaign with no judged lookup blocks: matched or planned means the org was asked', () => {
  const input = salesforceInput()
  delete input.campaignDecisions['Autumn Summit']
  const result = plan.assemble(input)
  assert.strictEqual(result.ok, false)
  assert.ok(result.problems.some(p => /"Autumn Summit" has no judged lookup/.test(p)))
})

check('a matched campaign whose status rows were never read blocks, because a blind create is a second copy', () => {
  const input = salesforceInput()
  delete input.campaignStatuses['Spring Roadshow']
  const result = plan.assemble(input)
  assert.strictEqual(result.ok, false)
  assert.ok(result.problems.some(p => /"Spring Roadshow" exists and its member-status rows have not been read/.test(p)))
})

check('a CRM holding two contacts under one email blocks the row until decided, and dedupe gives it no verdict', () => {
  const rows = [row(1, { firstName: 'Ada', lastName: 'Lovelace', email: 'shared@x.com', company: 'Acme' })]
  const result = plan.dedupeVerdicts(rows, { byEmail: {}, ambiguousInCrm: [{ email: 'shared@x.com', contactIds: ['003A', '003B'] }] })
  assert.deepStrictEqual(result.verdicts, [], 'a create would add a third record and an update would pick one')
  assert.strictEqual(result.crmAmbiguousMatches.length, 1)
  assert.deepStrictEqual(result.crmAmbiguousMatches[0].contactIds, ['003A', '003B'])

  const input = goodInput()
  input.dedupe.crmAmbiguousMatches = [{ index: 1, email: 'ada@x.com', contactIds: ['003A', '003B'] }]
  const blocked = plan.assemble(input)
  assert.strictEqual(blocked.ok, false)
  assert.ok(blocked.problems.some(p => /Row 1/.test(p) && /more than one contact under ada@x\.com/.test(p)))
  input.resolutions = { excluded: [{ index: 1, why: 'ambiguous in the CRM, handled by hand' }] }
  assert.strictEqual(plan.assemble(input).ok, true, 'excluding the row resolves it')
})

check('a replaced address the CRM holds two contacts under is surfaced the same way', () => {
  const moved = row(1, { firstName: 'Vik', lastName: 'Moss', email: 'vik@peatmarsh.example' }, { replacedEmail: 'vik.moss@gmail.com' })
  const result = plan.dedupeVerdicts([moved], { byEmail: {}, ambiguousInCrm: [{ email: 'vik.moss@gmail.com', contactIds: ['003A', '003B'] }] })
  assert.strictEqual(result.crmAmbiguousMatches.length, 1)
  assert.ok(/address this row replaced/.test(result.crmAmbiguousMatches[0].why))
})

check('the flag fix is planned only for a campaign create, the measured refusal, never for members alone', () => {
  const input = salesforceInput()
  input.campaignDecisions['Autumn Summit'] = { outcome: 'exists', campaignId: '701A' }
  input.campaignStatuses['Autumn Summit'] = { labels: ['Sent', 'Responded', 'Invited'], maxSortOrder: 3 }
  input.marketingUser = { userId: '005U', on: false }
  const result = plan.assemble(input)
  assert.strictEqual(result.ok, true, JSON.stringify(result.problems || []))
  assert.strictEqual(result.plan.campaignMemberships.campaigns.creates.length, 0)
  assert.strictEqual(result.plan.campaignMemberships.userFlagFix, null,
    'members and statuses alone do not justify a privileged User write; a refusal there is the push\'s per-record report to make')
})

check('listDecisions are not demanded on salesforce, and campaignDecisions are not demanded on hubspot', () => {
  assert.strictEqual(plan.assemble(salesforceInput()).ok, true, 'no listDecisions anywhere in the input')
  const hubspotInput = goodInput()
  assert.strictEqual(plan.assemble(hubspotInput).ok, true, 'no campaignDecisions, campaignStatuses or marketingUser in the input')
  assert.ok(!('campaignMemberships' in plan.assemble(hubspotInput).plan), 'a hubspot plan carries lists, not campaigns')
})

console.log(failures ? `\n${failures} failed.\n` : '\nAll checks passed.\n')
process.exit(failures ? 1 : 0)

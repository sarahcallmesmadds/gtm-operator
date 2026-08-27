'use strict'

/**
 * Building and validating one Calendar row.
 *
 * The rules under test are the ones Notion does not enforce and a model will
 * drift on:
 *
 *   - a date is required at Confirmed and Done, and NOT at Canceled
 *   - Our role, Format and Location are Events only; Channel is not for Events
 *   - a field that means nothing on this type is REFUSED, never dropped
 *   - validation is against the row as it would END UP, not the fields submitted
 *   - a person property is omitted when config records no person, never emptied
 *   - every name is resolved through the workspace's map, not the shipped names
 *
 * Run: node tests/calendar-row.test.js
 */

const assert = require('assert')
const row = require('../plugins/calendar/scripts/row')
const schema = require('../shared/calendar-schema')

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

/**
 * A stand-in for what `shared/config-read.js` hands back.
 *
 * `renames` lets a test prove the payload follows the workspace's names rather
 * than the shipped ones, which is the whole reason the map exists.
 */
const fakeContext = (options = {}) => ({
  personId: 'personId' in options ? options.personId : 'person-1',
  property: logical => (options.renames && options.renames[logical]) || logical,
  value: (property, value) => (options.valueRenames && options.valueRenames[`${property}.${value}`]) || value
})

const codes = list => list.map(p => p.code).sort()
const fields = list => list.map(p => p.field).sort()

console.log('\nbuilding and validating a Calendar row\n')

// ------------------------------------------------------------------ the basics

check('a complete row has no problems', () => {
  assert.deepStrictEqual(
    row.problems({ Name: 'Q3 webinar', Type: 'Event', Status: 'Confirmed', date: { start: '2026-09-10' } }),
    []
  )
})

check('every problem is reported, not just the first', () => {
  // A validator that stops at the first makes somebody fix one thing, run
  // again, and find the next.
  const found = row.problems({ Type: 'Nonsense', Status: 'Nonsense' })
  assert.ok(found.length >= 3, `expected several problems, got ${found.length}`)
  assert.ok(fields(found).includes('Name'))
})

check('a type that is not in the schema is refused', () => {
  const found = row.problems({ Name: 'x', Type: 'Webinar', Status: 'Idea' })
  assert.deepStrictEqual(codes(found), ['NOT_A_VALUE'])
  // The message lists the real values, because "not a type" without them sends
  // somebody to go and look.
  assert.ok(found[0].message.includes('Event'))
})

// -------------------------------------------------------------- the date rule

check('Confirmed with no date is refused', () => {
  const found = row.problems({ Name: 'x', Type: 'Event', Status: 'Confirmed' })
  assert.deepStrictEqual(codes(found), ['DATE_REQUIRED'])
})

check('Done with no date is refused', () => {
  const found = row.problems({ Name: 'x', Type: 'Content', Status: 'Done' })
  assert.deepStrictEqual(codes(found), ['DATE_REQUIRED'])
})

check('Idea with no date is fine', () => {
  // "We should do a customer dinner in Q4" is a real row, and pinning it to a
  // made-up Tuesday makes the calendar lie.
  assert.deepStrictEqual(row.problems({ Name: 'Customer dinner in Q4', Type: 'Event', Status: 'Idea' }), [])
})

check('Planned with no date is fine', () => {
  assert.deepStrictEqual(row.problems({ Name: 'x', Type: 'Event', Status: 'Planned' }), [])
})

check('Canceled with no date is fine', () => {
  // The correction of 2026-08-19. A canceled row promises nothing, so requiring
  // a date on one reports a row that is not broken.
  assert.deepStrictEqual(row.problems({ Name: 'x', Type: 'Event', Status: 'Canceled' }), [])
})

check('the date rule and the shared schema are the same rule', () => {
  // Rather than restating the list, which is the copy this repository distrusts.
  for (const status of schema.STATUSES) {
    assert.strictEqual(
      row.dateRequiredAt(status),
      schema.DATE_REQUIRED_AT.includes(status),
      `${status} is treated differently by row.js and by the shared schema`
    )
  }
})

// ------------------------------------------------------ fields that fit a type

check('Format on a Social post is refused, not dropped', () => {
  // Refused rather than dropped, because silently discarding something somebody
  // supplied is worse here than elsewhere: the value looks saved.
  const found = row.problems({ Name: 'x', Type: 'Social post', Status: 'Idea', Format: 'Webinar' })
  assert.deepStrictEqual(codes(found), ['WRONG_TYPE_FOR_FIELD'])
  assert.deepStrictEqual(fields(found), ['Format'])
})

check('Our role and Location on a Launch are both refused', () => {
  const found = row.problems({ Name: 'x', Type: 'Launch', Status: 'Idea', 'Our role': 'Hosting', Location: 'Boston' })
  assert.deepStrictEqual(fields(found), ['Location', 'Our role'])
})

check('Channel on an Event is refused', () => {
  const found = row.problems({ Name: 'x', Type: 'Event', Status: 'Idea', Channel: ['LinkedIn'] })
  assert.deepStrictEqual(codes(found), ['WRONG_TYPE_FOR_FIELD'])
})

check('Channel on a Social post is fine', () => {
  assert.deepStrictEqual(row.problems({ Name: 'x', Type: 'Social post', Status: 'Idea', Channel: ['LinkedIn'] }), [])
})

check('Format on an Event is fine', () => {
  assert.deepStrictEqual(row.problems({ Name: 'x', Type: 'Event', Status: 'Idea', Format: 'Webinar' }), [])
})

check('an empty value for a field that does not fit is not a problem', () => {
  // Nobody supplied anything, so there is nothing to refuse. Treating an empty
  // array as a supplied value would refuse a row for a field that is not set.
  assert.deepStrictEqual(row.problems({ Name: 'x', Type: 'Event', Status: 'Idea', Channel: [], Location: '' }), [])
})

// --------------------------------------------------------- changing the type

check('a type change reports which existing values it would invalidate', () => {
  // update must not change Type silently. This is what lets the skill show what
  // would be lost rather than either refusing or quietly leaving stale values.
  const invalidated = row.fieldsInvalidatedByTypeChange(
    { Type: 'Event', 'Our role': 'Hosting', Format: 'Conference', Location: 'Boston' },
    'Social post'
  )
  assert.deepStrictEqual(invalidated.map(i => i.field).sort(), ['Format', 'Location', 'Our role'])
  assert.strictEqual(invalidated.find(i => i.field === 'Location').was, 'Boston')
})

check('a type change reports nothing when nothing would be invalidated', () => {
  assert.deepStrictEqual(row.fieldsInvalidatedByTypeChange({ Type: 'Content', Channel: ['Blog'] }, 'Social post'), [])
})

check('changing an Event to a Social post invalidates Channel in the other direction', () => {
  assert.deepStrictEqual(
    row.fieldsInvalidatedByTypeChange({ Type: 'Social post', Channel: ['LinkedIn'] }, 'Event').map(i => i.field),
    ['Channel']
  )
})

check('no type change means nothing is invalidated', () => {
  assert.deepStrictEqual(row.fieldsInvalidatedByTypeChange({ Type: 'Event', Format: 'Dinner' }, 'Event'), [])
})

check('validation judges the merged row, not the submitted fields', () => {
  // The failure this catches: turning an Event into a Social post while Format
  // stays behind. Validating only what was submitted, which is {Type}, calls
  // that clean and leaves a Social post carrying a Format.
  const existing = { Name: 'x', Type: 'Event', Status: 'Idea', Format: 'Conference' }
  const merged = Object.assign({}, existing, { Type: 'Social post' })
  assert.deepStrictEqual(codes(row.problems(merged)), ['WRONG_TYPE_FOR_FIELD'])
})

// ------------------------------------------------------------- the payload

check('the payload uses the workspace names, not the shipped ones', () => {
  const context = fakeContext({ renames: { Name: 'Thing', Status: 'Stage' }, valueRenames: { 'Status.Idea': 'Thinking' } })
  const out = row.properties(context, { Name: 'x', Type: 'Content', Status: 'Idea' })
  assert.ok('Thing' in out, 'the title was written to the shipped name rather than the workspace name')
  assert.strictEqual(out.Stage, 'Thinking')
  assert.ok(!('Name' in out))
})

check('a row with problems is refused rather than sent', () => {
  // Building the payload anyway just moves the failure to Notion, where the
  // error names a property rather than the rule that was broken.
  assert.throws(
    () => row.properties(fakeContext(), { Name: 'x', Type: 'Social post', Status: 'Idea', Format: 'Webinar' }),
    /cannot be written yet/
  )
})

check('a date range is written as a range', () => {
  const out = row.properties(fakeContext(), {
    Name: 'x', Type: 'Event', Status: 'Confirmed', date: { start: '2026-09-15', end: '2026-09-18' }
  })
  // A date is written through its two columns, the same ones a query selects.
  const keys = row.dateKeys(fakeContext())
  assert.strictEqual(out[keys.start], '2026-09-15')
  assert.strictEqual(out[keys.end], '2026-09-18')
  assert.ok(!('Date' in out), 'the date was written under the property name, which is not queryable')
})

check('a single day is written without an end', () => {
  const out = row.properties(fakeContext(), { Name: 'x', Type: 'Event', Status: 'Confirmed', date: { start: '2026-09-15' } })
  // A SINGLE DAY WRITES AN EXPLICIT NULL END, and that is the fix rather than an
  // accident. Omitting the end left a stale one behind when a range was
  // shortened to one day: `clearing` does not see that as a clear, so nothing
  // emptied it, and `proveWrite` only compares keys that were emitted, so the
  // write proved clean over a row still carrying its old end date. The client's
  // own definition says the end must be null for a single date.
  const keys = row.dateKeys(fakeContext())
  assert.strictEqual(out[keys.start], '2026-09-15')
  assert.ok(keys.end in out, 'a single day did not write its end column, so a stale end would survive')
  assert.strictEqual(out[keys.end], null)
})

check('multi-select values go through the value map', () => {
  const context = fakeContext({ valueRenames: { 'Segment.Enterprise': 'Ent' } })
  const out = row.properties(context, { Name: 'x', Type: 'Email send', Status: 'Idea', Segment: ['Enterprise', 'SMB'] })
  assert.deepStrictEqual(out.Segment, ['Ent', 'SMB'])
})

// ------------------------------------------------------- the nullable person

check('Owner is set when config records a person', () => {
  const out = row.properties(fakeContext({ personId: 'person-1' }), { Name: 'x', Type: 'Content', Status: 'Idea' })
  assert.deepStrictEqual(out.Owner, ['person-1'])
})

check('Owner is omitted entirely when config records no person', () => {
  // plugins/setup/SKILLS.md tier 3: omit the property rather than writing an empty
  // value. An empty people array is the plugin asserting the row has no owner,
  // which is a different claim from not knowing who the user is.
  const out = row.properties(fakeContext({ personId: null }), { Name: 'x', Type: 'Content', Status: 'Idea' })
  assert.ok(!('Owner' in out), 'Owner was written as an empty value rather than omitted')
})

check('no person means no failure', () => {
  assert.doesNotThrow(() => row.properties(fakeContext({ personId: null }), { Name: 'x', Type: 'Content', Status: 'Idea' }))
})

check('every person field in the shared schema is covered', () => {
  const out = row.properties(fakeContext({ personId: 'person-1' }), { Name: 'x', Type: 'Content', Status: 'Idea' })
  for (const field of schema.PERSON_FIELDS) {
    assert.ok(field in out, `${field} is a person field in the schema and the payload never sets it`)
  }
})

/**
 * PROVED BY BREAKING, 2026-08-19, in `plugins/calendar/scripts/row.js`:
 *
 *   `dateRequiredAt` returning true for every status
 *     red: Idea, Planned and Canceled with no date are fine
 *   `fieldsNotAllowedOn` returning []
 *     red: Format on a Social post, Our role and Location on a Launch, Channel on an Event
 *   `problems` returning after the first push
 *     red: every problem is reported, not just the first
 *   the personId guard removed, so Owner is always written
 *     red: Owner is omitted entirely when config records no person
 *   `put` writing the logical name instead of `context.property(logical)`
 *     red: the payload uses the workspace names, not the shipped ones
 */

console.log(failures ? `\n${failures} failed.\n` : `\nAll checks passed.\n`)
process.exit(failures ? 1 : 0)

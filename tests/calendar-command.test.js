'use strict'

/**
 * The command layer: the queries it builds, the grouping it does, and the
 * read-back proof.
 *
 * The two things most worth holding here:
 *
 *   - the window query is widened by the same number of days the judge uses.
 *     If the query fetched only the proposed range, `clash.js` would be handed a
 *     candidate list that could never contain what it is looking for, and the
 *     whole check would pass cleanly while seeing nothing.
 *   - `prove` fails on a property that came back missing or changed. A create
 *     that returned without an error proves nothing: Notion accepts some things
 *     it cannot do and discards them silently.
 *
 * Run: node tests/calendar-command.test.js
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const assert = require('assert')

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'gtm-calendar-command-'))
process.env.GTM_OPERATOR_CONFIG = path.join(SANDBOX, 'gtm-operator.config.json')

const setupSchema = require('../plugins/setup/scripts/schema')
const identity = setupSchema.identityNames('calendar')

fs.writeFileSync(process.env.GTM_OPERATOR_CONFIG, JSON.stringify({
  configVersion: 3,
  state: 'complete',
  notion: { parentPageId: 'p', personId: 'person-1' },
  databases: {
    calendar: {
      databaseId: 'db', dataSourceId: 'ds', displayName: 'Calendar',
      properties: identity.properties, values: identity.values
    }
  },
  verified: { at: 'x', definitions: 'y' },
  defaults: {}, sources: {}, taxonomyPath: '/tmp/x'
}, null, 2))

const command = require('../plugins/calendar/scripts/calendar')
const clash = require('../plugins/calendar/scripts/clash')
const row = require('../plugins/calendar/scripts/row')
const config = require('../shared/config-read')
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

const context = config.contextFor('calendar', schema.IDENTITY)

console.log('\nthe calendar command layer\n')

check('the context this test rests on is usable', () => {
  assert.strictEqual(context.ok, true, context.message)
})

// ------------------------------------------------------------- the window

check('the query window is widened by the same number of days the judge uses', () => {
  // The one that matters. Two files decide how wide "around the same time" is,
  // and if they disagree the check passes cleanly while never seeing the rows
  // it was looking for.
  const query = command.windowQuery(context, '2026-09-10')
  assert.strictEqual(query.windowDays, clash.WINDOW_DAYS)
  assert.strictEqual(query.from, '2026-09-03')
  assert.strictEqual(query.to, '2026-09-17')
})

check('a row at the edge of the query window is also inside the judge window', () => {
  // Asserted against the judge rather than against a number, so the two cannot
  // drift apart by both being edited to different values.
  const query = command.windowQuery(context, '2026-09-10')
  for (const date of [query.from, query.to]) {
    const result = clash.clashes(
      { id: 'new', date: { start: '2026-09-10' }, Segment: ['Enterprise'] },
      [{ id: 'edge', date: { start: date }, Segment: ['Enterprise'] }]
    )
    assert.strictEqual(result.overlapping.length, 1, `a row on ${date} is fetched by the query and ignored by the judge`)
  }
})

check('the query is inclusive at both ends, in the SQL and not only in the judge', () => {
  // WHY THIS IS SEPARATE FROM THE CHECK ABOVE. That one runs the judge on the
  // window's edge dates and never reads the SQL, so changing every comparison
  // from >= to > left it green while the query stopped fetching the rows the
  // judge was being asked about. Found by review on 2026-08-19.
  //
  // It is a text assertion because there is no SQL engine here. Nothing in this
  // repository can run one of these queries, which is why the comparison
  // operators are read out of the string rather than exercised.
  const sql = command.windowQuery(context, '2026-09-10').sql
  const bounds = sql.match(/(>=|<=|>|<)\s*'2026-09-(03|17)'/g) || []
  assert.ok(bounds.length >= 4, `expected at least four comparisons against the window edges, found ${bounds.length}`)
  for (const bound of bounds) {
    assert.ok(
      bound.startsWith('>=') || bound.startsWith('<='),
      `"${bound}" excludes the edge of the window, and the judge includes it`
    )
  }
})

check('a range widens the window at both ends', () => {
  const query = command.windowQuery(context, '2026-09-10', '2026-09-12')
  assert.strictEqual(query.from, '2026-09-03')
  assert.strictEqual(query.to, '2026-09-19')
})

check('the window query excludes canceled rows', () => {
  // A canceled thing is not in market, so it cannot clash with anything.
  assert.ok(command.windowQuery(context, '2026-09-10').sql.includes("!= 'Canceled'"))
})

check('the query selects the url rather than identifying rows by title', () => {
  // A title is not an identity: two rows can share one, and a report naming
  // rows by title cannot be clicked through. setup made this same correction.
  assert.ok(command.windowQuery(context, '2026-09-10').sql.includes('c.url'))
})

const renamed = {
  ok: true,
  property: logical => (logical === 'Date' ? 'When' : logical),
  value: (property, value) => value
}

check('a date is queried through the columns Notion actually exposes', () => {
  // Measured in this repository and applied by setup/scripts/views.js: a date
  // property is not queryable under its own name. Asking for c."Date" fails or
  // returns nothing, and nothing is what a clean calendar looks like.
  const sql = command.windowQuery(context, '2026-09-10').sql
  assert.ok(sql.includes('"date:Date:start"'), 'the query asks for the date column under its own name')
  assert.ok(sql.includes('"date:Date:end"'), 'the query never looks at the end of a range')
  assert.ok(!sql.includes('c."Date"'), 'the query still asks for the bare property name')
})

check('the date columns carry the workspace name, not the shipped one', () => {
  const sql = command.windowQuery(renamed, '2026-09-10').sql
  assert.ok(sql.includes('"date:When:start"'), 'the query asks about the shipped name on a renamed workspace')
  assert.ok(!sql.includes('date:Date:'))
})

check('a long event that began before the window is still fetched', () => {
  // A start-only comparison misses exactly the conference somebody is most
  // likely to be clashing with.
  //
  // The spanning clause is asserted by its own shape rather than by the string
  // containing "end" and "OR" somewhere. It used to be the looser test, and
  // deleting the whole third clause left it green, because the second clause
  // also mentions the end column and also sits after an OR.
  const sql = command.windowQuery(context, '2026-09-10').sql
  const spanning = /\(c\."date:Date:start"\s*<=\s*'2026-09-03'\s*AND\s*c\."date:Date:end"\s*>=\s*'2026-09-17'\)/
  assert.ok(
    spanning.test(sql),
    `no clause fetches a row that starts before the window and ends after it. The query was:\n${sql}`
  )
})

check('the query hands back what each column is called, so results can be read', () => {
  // Without this a renamed workspace returns rows whose keys the judge does not
  // recognise, and every one reads as undated and untargeted: a clean result
  // from a check that saw nothing.
  const columns = command.windowQuery(renamed, '2026-09-10').columns
  assert.strictEqual(columns['Date:start'], 'date:When:start')
  assert.strictEqual(columns.Segment, 'Segment')
})

check('rows come back normalised into the shape the judge reads', () => {
  const raw = [{
    url: 'https://app.notion.com/00000000000000000000000000000abc',
    Name: 'A thing',
    Segment: ['Enterprise'],
    'date:When:start': '2026-09-10',
    'date:When:end': '2026-09-12'
  }]
  const [row] = command.normaliseRows(renamed, raw)
  assert.deepStrictEqual(row.date, { start: '2026-09-10', end: '2026-09-12' })
  assert.deepStrictEqual(row.Segment, ['Enterprise'])
  assert.strictEqual(row.identity, '00000000000000000000000000000abc')
})

check('a normalised row with no start date has no date at all', () => {
  const [row] = command.normaliseRows(renamed, [{ url: 'x', 'date:When:start': null }])
  assert.strictEqual(row.date, null)
})

check('the duplicate query filters on nothing, because the comparator is looser than SQL', () => {
  // A duplicate is not bounded by a date: the same link is the same thing
  // whenever it is, and an undated row is not inside any window. Handing both
  // checks the clash window meant most duplicate rules could never fire.
  //
  // It is not bounded by name or link either, and that was the 2026-08-19
  // correction. The old query fetched an exact link match and a lowercased name
  // match, while the comparator drops the scheme, a leading www., trailing
  // slashes and runs of space. Every pair the comparator exists to catch was
  // filtered out before it could be judged. Having no WHERE at all is what makes
  // the fetched set a superset of what the comparator can match, so that is what
  // is asserted rather than the absence of any particular clause.
  const query = command.duplicateQuery(context, { Name: 'Q3   launch ', Link: 'https://www.example.com/x/' })
  assert.ok(!/\bWHERE\b/.test(query.sql), `the duplicate query narrows before the comparator sees the rows:\n${query.sql}`)
})

check('the pairs the comparator matches are pairs the query would have returned', () => {
  // The check that would have caught it. The comparator tests all called
  // `duplicates` directly with hand-built rows, so a pair could pass the judge
  // while never being fetched, and every one of them stayed green.
  const proposed = { Name: 'Q3   launch ', Link: 'https://example.com/thing', identity: 'a'.repeat(32) }
  const existing = { Name: 'q3 launch', Link: 'http://www.example.com/thing/', identity: 'b'.repeat(32) }

  assert.strictEqual(clash.duplicates(proposed, [existing]).length, 1, 'the comparator does not match this pair, so this test proves nothing')
  const query = command.duplicateQuery(context, proposed)
  assert.ok(!/\bWHERE\b/.test(query.sql), 'the query has a filter, so a row the comparator matches may never reach it')
})

check('the duplicate query includes canceled rows, unlike the clash window', () => {
  // A canceled row cannot compete for an audience and can absolutely be the row
  // somebody is about to enter again.
  const query = command.duplicateQuery(context, { Name: 'Q3 launch' })
  assert.ok(!query.sql.includes('Canceled'))
  assert.ok(command.windowQuery(context, '2026-09-10').sql.includes('Canceled'))
})

check('a row with no status at all is still fetched, rather than dropped by the status test', () => {
  // `c."Status" != 'Canceled'` is UNKNOWN for a null, not true, and SQL keeps
  // only what a WHERE is true for. So the obvious spelling drops exactly the
  // half-built rows these queries exist to surface, and `soon` promises in its
  // own SKILL.md that it never drops a row it cannot place.
  const queries = command.soonQueries(context, '2026-09-01', '2026-09-30')
  for (const [which, sql] of [['window', command.windowQuery(context, '2026-09-10').sql], ['dated', queries.dated.sql], ['undated', queries.undated.sql]]) {
    assert.ok(
      /"Status"\s+IS NULL/.test(sql),
      `the ${which} query drops a row whose status is null:\n${sql}`
    )
  }
})

check('a row with neither a name nor a link has no duplicate query, and says so', () => {
  const query = command.duplicateQuery(context, {})
  assert.strictEqual(query.sql, null)
  assert.ok(query.why.includes('nothing to look for'))
})

check('a backwards range widens outward rather than producing an empty window', () => {
  // from after to returns nothing, which reads as a clean calendar.
  const query = command.windowQuery(context, '2026-09-20', '2026-09-01')
  assert.ok(query.from < query.to, `window runs from ${query.from} to ${query.to}`)
  assert.strictEqual(query.from, '2026-08-25')
  assert.strictEqual(query.to, '2026-09-27')
})

check('a date shift does not depend on the local timezone', () => {
  // new Date('2026-08-19') is midnight UTC, which is the previous day west of
  // Greenwich. That would move every window by a day for half the world.
  assert.strictEqual(command.shiftDay('2026-01-01', -1), '2025-12-31')
  assert.strictEqual(command.shiftDay('2026-03-01', -1), '2026-02-28')
  assert.strictEqual(command.shiftDay('2026-12-31', 1), '2027-01-01')
})

check('a date that is not a date is refused rather than shifted to nonsense', () => {
  assert.throws(() => command.shiftDay('next tuesday', 1), /is not a date/)
})

// --------------------------------------------------------------- soon

check('soon asks two questions, and one of them is for undated rows', () => {
  // A date-bounded query cannot return a row with no date, so asking once and
  // reporting the result says "nothing else is happening" when it is not true.
  const queries = command.soonQueries(context, '2026-09-01', '2026-09-30')
  assert.ok(queries.dated && queries.dated.sql)
  assert.ok(queries.undated && queries.undated.sql)
  assert.ok(queries.undated.sql.includes('IS NULL'))
})

check('locked and hoped-for are kept apart', () => {
  const { locked, hopedFor } = command.separateByCertainty([
    { id: 'a', Status: 'Confirmed' }, { id: 'b', Status: 'Idea' },
    { id: 'c', Status: 'Done' }, { id: 'd', Status: 'Planned' }
  ])
  assert.deepStrictEqual(locked.map(r => r.id), ['a', 'c'])
  assert.deepStrictEqual(hopedFor.map(r => r.id), ['b', 'd'])
})

check('grouping is by segment, ordered with the crowded audience first', () => {
  const grouped = command.groupByAudience([
    { id: 'a', Segment: ['Enterprise'] },
    { id: 'b', Segment: ['Enterprise'] },
    { id: 'c', Segment: ['SMB'] }
  ])
  assert.strictEqual(grouped.groups[0].segment, 'Enterprise')
  assert.strictEqual(grouped.groups[0].count, 2)
})

check('a row in two segments appears under both, and says the counts will not add up', () => {
  const grouped = command.groupByAudience([{ id: 'a', Segment: ['Enterprise', 'SMB'] }])
  assert.strictEqual(grouped.groups.length, 2)
  assert.ok(grouped.note.includes('do not add up'))
})

check('rows that said nothing about their audience are separated, not called everybody', () => {
  const grouped = command.groupByAudience([{ id: 'a' }, { id: 'b', Segment: ['SMB'] }])
  assert.deepStrictEqual(grouped.unsaid.map(r => r.id), ['a'])
  assert.strictEqual(grouped.groups.length, 1)
})

// ------------------------------------------------------------- the body rules

check('a blank Why We Are Doing It is a finding on every type', () => {
  const problems = command.bodyProblems(
    { Name: 'x', Type: 'Social post', Status: 'Idea' },
    { 'What It Is': 'A post.' }
  )
  assert.ok(problems.some(p => p.section === 'Why We Are Doing It' && p.code === 'BLANK'))
})

check('a row marked Done with no debrief is a finding', () => {
  const problems = command.bodyProblems(
    { Name: 'x', Type: 'Event', Status: 'Done' },
    { 'What It Is': 'A thing.', 'Why We Are Doing It': 'A reason, and we would know it worked if people came.' }
  )
  assert.ok(problems.some(p => p.code === 'DEBRIEF_MISSING'))
})

check('a row not yet Done is not asked for a debrief', () => {
  const problems = command.bodyProblems(
    { Name: 'x', Type: 'Event', Status: 'Confirmed' },
    { 'What It Is': 'A thing.', 'Why We Are Doing It': 'A reason, and we would know it worked if people came.' }
  )
  assert.ok(!problems.some(p => p.code === 'DEBRIEF_MISSING'))
})

check('the debrief section appears in the sections for a Done row and not before', () => {
  assert.ok(command.sectionsFor({ Status: 'Done' }).includes(schema.DEBRIEF.section))
  assert.ok(!command.sectionsFor({ Status: 'Confirmed' }).includes(schema.DEBRIEF.section))
})

check('only the required sections count toward the ceiling', () => {
  const long = 'word '.repeat(schema.WORD_CEILING + 50)
  // In a conditional section: no finding, which is what lets a conference carry
  // a real run-up list without breaking the rule.
  assert.ok(!command.bodyProblems(
    { Status: 'Confirmed' },
    { 'What It Is': 'a', 'Why We Are Doing It': 'b', 'What We Need To Do': long }
  ).some(p => p.code === 'TOO_LONG'))

  assert.ok(command.bodyProblems(
    { Status: 'Confirmed' },
    { 'What It Is': long, 'Why We Are Doing It': 'b' }
  ).some(p => p.code === 'TOO_LONG'))
})

// -------------------------------------------------------------- the proof

const intendedFor = final => ({
  properties: row.properties(context, final),
  headings: command.sectionsFor(final, final.body || {})
})

const goodRow = {
  Name: 'Q3 webinar', Type: 'Event', Status: 'Confirmed',
  Description: 'A webinar about the third quarter.',
  Link: 'https://example.com/webinar',
  Location: 'Online',
  date: { start: '2026-09-10' }, Segment: ['Enterprise']
}

check('a read-back matching what was sent proves clean, and still says what it did not check', () => {
  const intended = intendedFor(goodRow)
  const result = command.proveWrite(context, intended, {
    properties: intended.properties,
    headings: intended.headings
  })
  assert.deepStrictEqual(result.problems, [])
  assert.ok(result.checked.length >= Object.keys(intended.properties).length, 'a property was neither checked nor reported as unchecked')
  assert.ok(
    result.unchecked.some(u => u.what === 'the body text'),
    'a clean result claims the body was compared, and nothing here reads the body back'
  )
})

check('every property sent is either checked or named as unchecked', () => {
  // THE CHECK THAT WOULD HAVE CAUGHT THE OLD ONE. `proveWrite` compared select
  // and multi_select and let every other type pass on merely being present, so
  // a truncated title, an emptied url and a date on the wrong day all read as a
  // match, and the command then printed that the properties matched. Counting
  // what was compared is what makes that impossible to write again.
  const intended = intendedFor(goodRow)
  const result = command.proveWrite(context, intended, { properties: intended.properties, headings: intended.headings })
  const accountedFor = new Set([].concat(result.checked, result.unchecked, result.problems).map(entry => entry.what))
  for (const name of Object.keys(intended.properties)) {
    assert.ok(accountedFor.has(name), `"${name}" was sent and does not appear in checked, unchecked or problems`)
  }
})

check('a select value Notion discarded is caught', () => {
  // The specific failure CLAUDE.md warns about: accepted, reported as created,
  // silently absent afterwards.
  const intended = intendedFor(goodRow)
  const readback = { properties: Object.assign({}, intended.properties, { Status: null }), headings: intended.headings }
  const result = command.proveWrite(context, intended, readback)
  assert.strictEqual(result.problems.length, 1)
  assert.ok(result.problems[0].why.includes('"Confirmed"'))
})

check('a multi-select that lost a value is caught', () => {
  const intended = intendedFor(goodRow)
  const readback = { properties: Object.assign({}, intended.properties, { Segment: [] }), headings: intended.headings }
  assert.strictEqual(command.proveWrite(context, intended, readback).problems.length, 1)
})

check('a title that came back truncated is caught', () => {
  // Not caught before 2026-08-19. A title was checked for existing and nothing
  // else, so any title at all passed.
  const intended = intendedFor(goodRow)
  const readback = {
    properties: Object.assign({}, intended.properties, { Name: 'Q3 web' }),
    headings: intended.headings
  }
  const result = command.proveWrite(context, intended, readback)
  assert.strictEqual(result.problems.length, 1, 'a truncated title passed the proof')
  assert.strictEqual(result.problems[0].what, 'Name')
})

check('a url that came back empty is caught', () => {
  const intended = intendedFor(goodRow)
  const readback = { properties: Object.assign({}, intended.properties, { Link: null }), headings: intended.headings }
  assert.strictEqual(command.proveWrite(context, intended, readback).problems.length, 1, 'an emptied url passed the proof')
})

check('a date that came back on the wrong day is caught', () => {
  const intended = intendedFor(goodRow)
  const dateKey = row.dateKeys(context).start
  const readback = { properties: Object.assign({}, intended.properties, { [dateKey]: '2026-09-11' }), headings: intended.headings }
  assert.strictEqual(command.proveWrite(context, intended, readback).problems.length, 1, 'a date on the wrong day passed the proof')
})

check('a rich text that came back empty is caught', () => {
  const intended = intendedFor(goodRow)
  const readback = { properties: Object.assign({}, intended.properties, { Description: null }), headings: intended.headings }
  assert.strictEqual(command.proveWrite(context, intended, readback).problems.length, 1, 'an emptied description passed the proof')
})

check('a person property that came back empty is caught', () => {
  const intended = intendedFor(goodRow)
  assert.ok(intended.properties.Owner, 'this config records no person, so this test proves nothing')
  const readback = { properties: Object.assign({}, intended.properties, { Owner: [] }), headings: intended.headings }
  assert.strictEqual(command.proveWrite(context, intended, readback).problems.length, 1, 'an emptied owner passed the proof')
})

check('two different lists never compare equal', () => {
  // BOTH OF THESE PROVED CLEAN BEFORE. The comparison coerced every entry with
  // String, so ["1"] and [1] matched, and joined on a separator character a
  // value is allowed to contain, so ["a\u241Fb"] and ["a","b"] matched. A
  // comparison that is not one-to-one is a false success waiting for the right
  // input.
  const flat = { property: n => n, value: (p, v) => v, personId: null, names: { properties: { Segment: 'Segment' }, values: {} } }
  const result = (sent, got) => command.proveWrite(
    flat, { properties: { Segment: sent }, headings: [] }, { properties: { Segment: got }, headings: [] }
  )
  const problems = (sent, got) => result(sent, got).problems.length
  const unchecked = (sent, got) => result(sent, got).unchecked.filter(u => u.what === 'Segment').length

  // A separator inside a value used to forge a match. Now a real difference.
  assert.strictEqual(problems(['a\u241Fb'], ['a', 'b']), 1, 'the separator character forged a match')
  assert.strictEqual(problems(['Enterprise'], '["SMB"]'), 1, 'two different lists compared equal')

  // A LIST THIS CANNOT RENDER ONE-TO-ONE IS REPORTED, NOT GUESSED AT. Rendering
  // a non-string means choosing how it stringifies, and every choice collapses
  // something: -0 and 0 render alike, and a list mixing 1 with "1" sorts on a
  // key that cannot separate them. Saying "not checked" is the honest answer.
  for (const [sent, got, why] of [
    [['1'], [1], 'a string and a number'],
    [[-0], [0], 'negative and positive zero'],
    [['1', 1], [1, '1'], 'a mixed list in two orders']
  ]) {
    assert.strictEqual(problems(sent, got), 0, `${why} was reported as a difference rather than as unchecked`)
    assert.strictEqual(unchecked(sent, got), 1, `${why} was compared rather than reported as unchecked`)
  }

  // And the measured asymmetry still matches, which is the whole point.
  assert.strictEqual(problems(['Enterprise', 'Mid-Market'], '["Enterprise","Mid-Market"]'), 0)
  assert.strictEqual(unchecked(['Enterprise', 'Mid-Market'], '["Enterprise","Mid-Market"]'), 0)
  assert.strictEqual(problems(['Mid-Market', 'Enterprise'], '["Enterprise","Mid-Market"]'), 0, 'order was treated as a difference')
})

check('a JSON-string column carrying objects is refused, not just a direct array', () => {
  // The measured shape is the JSON string, and the check was only on the branch
  // nobody has seen. '[{"name":"Enterprise"}]' went straight through, then got
  // dropped by the comparator, and the row read as targeting nobody.
  const asString = [{ url: 'https://app.notion.com/00000000000000000000000000000abc', Segment: '[{"name":"Enterprise"}]' }]
  assert.throws(() => command.normaliseRows(context, asString), /not a value name/)

  const asArray = [{ url: 'https://app.notion.com/00000000000000000000000000000abc', Segment: [{ name: 'Enterprise' }] }]
  assert.throws(() => command.normaliseRows(context, asArray), /not a value name/)

  const good = [{ url: 'https://app.notion.com/00000000000000000000000000000abc', Segment: '["Enterprise"]' }]
  assert.deepStrictEqual(command.normaliseRows(context, good)[0].Segment, ['Enterprise'])
})

check('shortening a range to one day clears the old end date', () => {
  // THE FAULT THE DATE SPLIT CREATED. `clearing` does not see {start,end} to
  // {start} as a clear, `properties` used to stop emitting the end, and
  // `proveWrite` only compares emitted keys, so the stale end survived and the
  // write proved clean.
  const keys = row.dateKeys(context)
  const before = { url: 'https://app.notion.com/00000000000000000000000000000f01', Name: 'Conference', Type: 'Event', Status: 'Confirmed', date: { start: '2026-09-10', end: '2026-09-12' } }
  const after = Object.assign({}, before, { date: { start: '2026-09-10' } })

  const { properties } = command.updatePayload(context, before, after)
  assert.ok(keys.end in properties, 'the shortened range does not write its end column')
  assert.strictEqual(properties[keys.end], null)

  // A read-back still holding the old end is caught.
  const stale = { url: before.url, properties: Object.assign({}, properties, { [keys.end]: '2026-09-12' }), headings: [] }
  assert.strictEqual(command.proveWrite(context, { properties, headings: [] }, stale).problems.length, 1,
    'a stale end date passed the proof')
})

check('a person written bare and read back prefixed is not a difference', () => {
  // MEASURED 2026-08-20. `["00000000-..."]` goes in, `["user://00000000-..."]`
  // comes back. The first real proof of a create reported the owner as not
  // having landed, on a write that was perfect.
  const intended = intendedFor(goodRow)
  const owner = intended.properties.Owner
  assert.ok(Array.isArray(owner) && owner.length, 'the fixture row writes no owner, so this proves nothing')

  const prefixed = {
    properties: Object.assign({}, intended.properties, { Owner: JSON.stringify(owner.map(id => `user://${id}`)) }),
    headings: intended.headings
  }
  assert.deepStrictEqual(command.proveWrite(context, intended, prefixed).problems, [],
    'a person id read back with its user:// prefix was reported as a difference')

  // A genuinely different person is still caught.
  const somebodyElse = {
    properties: Object.assign({}, intended.properties, { Owner: '["user://11111111-2222-3333-4444-555555555555"]' }),
    headings: intended.headings
  }
  assert.strictEqual(command.proveWrite(context, intended, somebodyElse).problems.length, 1,
    'a different owner passed the proof')
})

check('a multi-select written as a list and read back as a string is not a difference', () => {
  // THE ASYMMETRY THE LIVE RUN MEASURED. A multi-select is written as a list of
  // names and comes back as a JSON array inside a string. A comparison that read
  // only one of the two would fail every real read-back.
  const intended = intendedFor(goodRow)
  const readback = {
    properties: Object.assign({}, intended.properties, { Segment: '["Enterprise"]' }),
    headings: intended.headings
  }
  assert.deepStrictEqual(command.proveWrite(context, intended, readback).problems, [])

  // And a list that really did lose a value is still caught.
  const lost = {
    properties: Object.assign({}, intended.properties, { Segment: '[]' }),
    headings: intended.headings
  }
  assert.strictEqual(command.proveWrite(context, intended, lost).problems.length, 1)
})

check('a property type this does not understand is reported as unchecked, not as a match', () => {
  const intended = { properties: { Odd: { relation: [{ id: 'x' }] } }, headings: [] }
  const result = command.proveWrite(context, intended, { properties: { Odd: { relation: [] } }, headings: [] })
  assert.deepStrictEqual(result.problems, [], 'an unknown type was reported as a problem rather than as unchecked')
  assert.deepStrictEqual(result.checked, [], 'an unknown type was counted as checked')
  assert.strictEqual(result.unchecked.length, 1)
  assert.strictEqual(result.unchecked[0].what, 'Odd')
})

check('a property missing from the read-back is caught', () => {
  const intended = intendedFor(goodRow)
  const properties = Object.assign({}, intended.properties)
  delete properties[row.dateKeys(context).start]
  assert.ok(command.proveWrite(context, intended, { properties, headings: intended.headings })
    .problems.some(p => p.why.includes('discarded it without reporting an error')))
})

check('a section heading that did not write is caught', () => {
  const withBody = Object.assign({}, goodRow, { body: { 'What It Is': 'a', 'Why We Are Doing It': 'b' } })
  const intended = intendedFor(withBody)
  const result = command.proveWrite(context, intended, { properties: intended.properties, headings: ['What It Is'] })
  assert.ok(result.problems.some(p => p.what === 'Why We Are Doing It'))
})

check('no read-back at all proves nothing, and says so', () => {
  // Rather than passing vacuously, which is how a missing read-back becomes a
  // clean bill of health.
  const result = command.proveWrite(context, intendedFor(goodRow), null)
  assert.strictEqual(result.problems.length, 1)
  assert.ok(result.problems[0].why.includes('nothing about this write has been proved'))
})

// ------------------------------------------------------- what came back at all

check('a response envelope is accepted, and an unrecognised shape is refused by name', () => {
  // `normaliseRows` used to call .map on whatever it was handed, so anything but
  // a bare array died with "rows.map is not a function", which names a line in
  // calendar.js and tells a user nothing about the file they saved.
  //
  // NOTHING HERE IS MEASURED. No query in this repository has been run against a
  // real workspace, so these are the shapes worth accepting rather than the ones
  // anybody has seen come back.
  const one = { url: 'https://app.notion.com/00000000000000000000000000000abc', Name: 'A thing' }
  for (const shape of [[one], { results: [one] }, { rows: [one] }, { data: [one] }]) {
    assert.strictEqual(command.normaliseRows(context, shape).length, 1, `${JSON.stringify(Object.keys(shape))} was not read as a list of rows`)
  }
  // A MISSING RESULT IS REFUSED, NOT READ AS AN EMPTY ONE. This used to assert
  // `.length === 0`, which pinned the behaviour that let a file holding `null`
  // be reported as a checked duplicate lookup that found nothing.
  assert.throws(() => command.normaliseRows(context, null), /holds null rather than a list/)
  assert.throws(() => command.normaliseRows(context, undefined), /holds null rather than a list/)
  // Two candidate keys are refused rather than ranked: picking the first would
  // silently choose an empty list over a populated one.
  assert.throws(
    () => command.normaliseRows(context, { results: [], data: [one] }),
    /more than one of \[results, data\]/
  )
  assert.throws(() => command.normaliseRows(context, { object: 'list' }), /no list of rows in it/)
  assert.throws(() => command.normaliseRows(context, 'rows'), /holds a string/)
})

check('the three spellings of an absent value all read as absent', () => {
  // The queries treat null, the empty string and '[]' as one thing. This is
  // defensive, not measured: nothing here has seen which spelling the SQL
  // surface returns. A status that came back as '' would otherwise be a status
  // nothing matches and nothing reports.
  const [normalised] = command.normaliseRows(context, [{ url: 'x', Status: '', Segment: '[]', 'date:Date:start': '' }])
  assert.strictEqual(normalised.Status, null)
  assert.strictEqual(normalised.Segment, null)
  assert.strictEqual(normalised.date, null)
})

check('a row with no status is reported separately rather than counted as hoped-for', () => {
  const separated = command.separateByCertainty([
    { id: 'a', Status: 'Confirmed' }, { id: 'b', Status: 'Idea' }, { id: 'c', Status: null }
  ])
  assert.deepStrictEqual(separated.locked.map(r => r.id), ['a'])
  assert.deepStrictEqual(separated.hopedFor.map(r => r.id), ['b'])
  assert.deepStrictEqual(separated.noStatus.map(r => r.id), ['c'])
})

// ------------------------------------------------------------------ the owner

const ownerRow = { Name: 'x', Type: 'Social post', Status: 'Idea', Channel: ['LinkedIn'] }
const SOMEBODY = '11111111-2222-3333-4444-555555555555'

check('an owner nobody named is the person the install is configured with', () => {
  const built = row.properties(context, ownerRow)
  assert.deepStrictEqual(built.Owner, ['person-1'])
})

check('a named owner is written, rather than being rewritten back to the configured person', () => {
  // The gap that made "change the owner" a call that succeeded and changed
  // nothing. Only the configured person could ever be written, so an update
  // naming somebody else quietly put the same person back.
  const built = row.properties(context, Object.assign({}, ownerRow, { Owner: SOMEBODY }))
  assert.deepStrictEqual(built.Owner, [SOMEBODY])
})

check('an owner given as an object with an id is accepted, because that is the shape Notion returns', () => {
  const built = row.properties(context, Object.assign({}, ownerRow, { Owner: { id: SOMEBODY, name: 'Somebody' } }))
  assert.deepStrictEqual(built.Owner, [SOMEBODY])
})

check('two owners are both written, and one bad id in the list refuses the whole row', () => {
  const second = '66666666-7777-8888-9999-000000000000'
  const built = row.properties(context, Object.assign({}, ownerRow, { Owner: [SOMEBODY, second] }))
  assert.deepStrictEqual(built.Owner, [SOMEBODY, second])

  // Not "the ones that parsed". A row half of whose owners were dropped is a
  // row written wrong and reported as written.
  const problems = row.problems(Object.assign({}, ownerRow, { Owner: [SOMEBODY, 'Priya'] }))
  assert.strictEqual(problems.filter(p => p.code === 'NOT_A_PERSON_ID').length, 1)
})

check('an owner given as a name is refused rather than sent', () => {
  // Notion answers a bad person id with a 400 naming the property, which sends
  // somebody looking at the property rather than at the name they typed.
  const problems = row.problems(Object.assign({}, ownerRow, { Owner: 'Priya' }))
  assert.ok(problems.some(p => p.code === 'NOT_A_PERSON_ID'), 'a name was accepted as a person id')
  assert.throws(() => row.properties(context, Object.assign({}, ownerRow, { Owner: 'Priya' })), /not a Notion person id/)
})

check('an emptied owner is not written by properties, because clearing is what empties it', () => {
  // Both writing an empty list and omitting the property would be answers here,
  // and a payload carrying one of them plus a clear would be two answers to one
  // question.
  const built = row.properties(context, Object.assign({}, ownerRow, { Owner: null }))
  assert.strictEqual(built.Owner, undefined)
  const cleared = row.clearing(Object.assign({}, ownerRow, { Owner: SOMEBODY }), Object.assign({}, ownerRow, { Owner: null }))
  assert.deepStrictEqual(cleared.map(c => c.field), ['Owner'])
  assert.strictEqual(row.clearedProperties(context, cleared).Owner, null)
})

check('an owner read back with its user:// prefix is accepted and written bare', () => {
  // MEASURED 2026-08-20: a person goes in bare and comes back `user://<id>`, so
  // the prefixed form is what a caller holds after re-fetching a row. Refusing
  // it told them to go and search the workspace for a name whose id they were
  // already holding, while the comparison side had been stripping the same
  // prefix since the day it was measured.
  const built = row.properties(context, Object.assign({}, ownerRow, { Owner: `user://${SOMEBODY}` }))
  assert.deepStrictEqual(built.Owner, [SOMEBODY], 'the prefix was not stripped before writing')
  assert.deepStrictEqual(row.problems(Object.assign({}, ownerRow, { Owner: `user://${SOMEBODY}` })), [])
})

check('a prefix on something that is not an id is still refused', () => {
  // The prefix is not a passphrase. Stripping it must not turn a name into an
  // id, which would send the name to Notion and get back a 400 about a property.
  assert.strictEqual(row.personIdFrom('user://Priya'), null)
  const problems = row.problems(Object.assign({}, ownerRow, { Owner: 'user://Priya' }))
  assert.strictEqual(problems.length, 1)
  assert.strictEqual(problems[0].code, 'NOT_A_PERSON_ID')
})

// ------------------------------------------------- one rule for a multi-select

const MALFORMED = [
  ['a bare string', 'Enterprise'],
  ['the query shape', '["Enterprise"]'],
  ['a list of objects', [{ name: 'Enterprise' }]],
  ['a list of numbers', [1]],
  ['a list holding an empty string', ['']]
]

check('a multi-select that is not a list of names is refused rather than dropped', () => {
  // ROUND 9. `properties` writes a multi-select only when it is a non-empty
  // array, so `Segment: "Enterprise"` was dropped from the payload without a
  // word and `problems` reported nothing wrong. A list holding `1` or
  // `{name: "Enterprise"}` went to Notion exactly as it arrived.
  //
  // EVERY FIELD, NOT JUST SEGMENT. Written against `Segment` alone first, and
  // dropping `Channel` and `Audience` from `MULTI_SELECT_FIELDS` then left the
  // whole suite green: the check covered one field and read as covering four.
  // A Social post allows all four, which is why the row is one.
  assert.deepStrictEqual(schema.MULTI_SELECT_FIELDS.slice().sort(),
    ['Audience', 'Channel', 'L2C Lifecycle', 'Segment'],
    'the field list changed, so this test is no longer covering what it says')

  for (const field of schema.MULTI_SELECT_FIELDS) {
    for (const [name, value] of MALFORMED) {
      const bad = Object.assign({}, ownerRow, { [field]: value })
      const problems = row.problems(bad)
      assert.strictEqual(problems.length, 1, `${field}: ${name} was accepted`)
      assert.strictEqual(problems[0].field, field, `${field}: ${name} was blamed on the wrong field`)
      assert.strictEqual(problems[0].code, 'NOT_A_VALUE_LIST', `${field}: ${name} got the wrong code`)
      assert.throws(() => row.properties(context, bad), /is not a list|not a value name/,
        `${field}: ${name} was built into a payload`)
    }
  }
})

check('a padded value is written in the same form the clash check compared', () => {
  // DEVIN ROUND 4, the last unpaired guard. `targetingValues` trimmed each value
  // before comparing and `properties` wrote it exactly as it arrived, so
  // `" Enterprise "` matched an existing row in the clash check and then went to
  // Notion with its spaces on, where it maps to no option and comes back a 400.
  // Verified against fixtures before the fix: clash reported one overlap, the
  // payload carried `" Enterprise "`, and `problems` reported nothing.
  const padded = ' Enterprise '
  const built = row.properties(context, Object.assign({}, ownerRow, { Segment: [padded] }))
  assert.deepStrictEqual(built.Segment, [context.value('Segment', 'Enterprise')],
    'the write path sent a value the clash check would not have compared')

  // Both paths, one form. This is the assertion that fails if either side starts
  // canonicalising for itself again.
  const candidate = { identity: 'other', date: { start: '2026-09-10' }, Segment: ['Enterprise'] }
  const result = clash.clashes(
    { date: { start: '2026-09-10' }, Segment: [padded], url: `https://app.notion.com/${'a'.repeat(32)}` },
    [candidate]
  )
  assert.strictEqual(result.overlapping.length, 1, 'the clash check stopped matching the padded value')
})

check('an absent or empty multi-select is still legal, and is not a fault', () => {
  // The guard against curing a silent drop by refusing the row that said
  // nothing. Saying nothing is a real answer on these fields.
  for (const value of [undefined, null, '', []]) {
    assert.deepStrictEqual(row.problems(Object.assign({}, ownerRow, { Segment: value })), [],
      `${JSON.stringify(value)} was reported as a fault`)
  }
})

check('the read, clash and write paths agree about what a multi-select may hold', () => {
  // THE DRIFT GUARD, AND THE POINT OF THE WHOLE CHANGE. Round 9 found one value
  // getting three answers: the read path refused it, the clash path filtered it
  // away and read the row as targeting nobody, and the write path forwarded it.
  // They share `schema.listProblem` now, and this fails if any one of them
  // starts deciding for itself again.
  const candidate = { identity: 'other', date: { start: '2026-09-10' }, Segment: ['Enterprise'] }
  const values = [['Enterprise'], [], undefined].concat(MALFORMED.map(m => m[1]))

  for (const value of values) {
    const legal = schema.listProblem(value) === null

    const writeRefused = row.problems(Object.assign({}, ownerRow, { Segment: value })).length > 0
    assert.strictEqual(writeRefused, !legal, `the write path disagrees about ${JSON.stringify(value)}`)

    let clashRefused = false
    try {
      clash.clashes({ date: { start: '2026-09-10' }, Segment: value, url: `https://app.notion.com/${'a'.repeat(32)}` }, [candidate])
    } catch (error) { clashRefused = true }
    assert.strictEqual(clashRefused, !legal, `the clash path disagrees about ${JSON.stringify(value)}`)

    // The read path only ever sees a parsed array, so it is checked on the
    // shapes that can reach it rather than on the string forms.
    if (Array.isArray(value)) {
      let readRefused = false
      try { command.parseArrayColumn('Segment', value) } catch (error) { readRefused = true }
      assert.strictEqual(readRefused, !legal, `the read path disagrees about ${JSON.stringify(value)}`)
    }
  }
})

// ------------------------------------------------------------- the update call

const before = {
  Name: 'Q3 webinar', Type: 'Event', Status: 'Confirmed',
  date: { start: '2026-09-10' }, Location: 'Online', Format: 'Webinar', 'Our role': 'Hosting'
}

check('a type change clears the fields it invalidates, in the payload and not only in the report', () => {
  // THE ONE THAT LEAVES WRONG DATA BEHIND. `properties` builds a payload from
  // the fields that HAVE values, so a field that lost one is simply absent, and
  // Notion leaves an absent property exactly as it was. The update skill
  // promised to clear these; nothing in the call did.
  const after = { Name: 'Q3 webinar', Type: 'Social post', Status: 'Confirmed', date: { start: '2026-09-10' }, Channel: ['LinkedIn'] }
  const cleared = row.clearing(before, after)
  assert.deepStrictEqual(cleared.map(c => c.field).sort(), ['Format', 'Location', 'Our role'])
  assert.ok(cleared.every(c => c.because === 'type-change'))

  const payload = row.clearedProperties(context, cleared)
  assert.deepStrictEqual(payload.Format, null)
  assert.deepStrictEqual(payload.Location, null)
})

check('a field the user emptied is cleared too, and is not called a type change', () => {
  const after = Object.assign({}, before, { Location: '' })
  const cleared = row.clearing(before, after)
  assert.deepStrictEqual(cleared.map(c => c.field), ['Location'])
  assert.strictEqual(cleared[0].because, 'emptied')
})

check('a field that did not change is not cleared', () => {
  assert.deepStrictEqual(row.clearing(before, Object.assign({}, before)), [])
})

// ------------------------------------------- the command layer, run for real
//
// These run the script as a user runs it. Everything else in this file calls the
// exported functions, so `report` and `judge` had no coverage at all: both live
// only inside the `commands` object, and both were reporting an absent result as
// an empty one.

const { execFileSync } = require('child_process')
const CLI = path.join(__dirname, '..', 'plugins', 'calendar', 'scripts', 'calendar.js')

const runCli = (...args) => {
  try {
    return { code: 0, out: execFileSync('node', [CLI, ...args], { encoding: 'utf8', env: process.env }) }
  } catch (error) {
    return { code: error.status, out: `${error.stdout || ''}${error.stderr || ''}` }
  }
}

const fixture = (name, value) => {
  const file = path.join(SANDBOX, name)
  fs.writeFileSync(file, JSON.stringify(value))
  return file
}

check('report refuses to run without the undated rows', () => {
  // It used to accept one file and substitute an empty list for the other, so
  // "nothing could not be placed" and "nobody ran the second query" were the
  // same output. `soon` returns two queries and its SKILL.md says both are sent.
  const dated = fixture('dated.json', [])
  const one = runCli('report', dated)
  assert.strictEqual(one.code, 1, 'report ran with only the dated rows')
  assert.match(one.out, /both result sets/)

  const both = runCli('report', dated, fixture('undated.json', []))
  assert.strictEqual(both.code, 0, `report failed with both files: ${both.out}`)
  assert.strictEqual(JSON.parse(both.out).couldNotPlace.count, 0)
})

check('a rows file holding null is refused rather than read as nothing found', () => {
  const proposed = fixture('proposed.json', goodRow)
  const result = runCli('judge', proposed, fixture('null-rows.json', null))
  assert.strictEqual(result.code, 1, 'a null rows file was accepted')
  assert.match(result.out, /holds null rather than a list/)
})

check('coverage is proved from has_more, and never sits in a boolean-shaped field', () => {
  // NO UNKNOWN IN A FIELD THAT READS AS YES. This returned `complete: 'unknown'`,
  // and `if (duplicates.complete)` takes that for a yes. `has_more` is the real
  // signal: measured on 2026-08-19, the SQL surface answers with
  // {results, has_more, data_source_ids}.
  const two = [
    { url: 'https://app.notion.com/00000000000000000000000000000abc', Name: 'One' },
    { url: 'https://app.notion.com/00000000000000000000000000000abd', Name: 'Two' }
  ]
  const complete = runCli('judge', fixture('p1.json', goodRow), fixture('w1.json', []),
    fixture('d1.json', { results: two, has_more: false }))
  assert.strictEqual(complete.code, 0, `judge failed: ${complete.out}`)
  const whole = JSON.parse(complete.out).duplicates
  assert.strictEqual(whole.ran, true)
  assert.strictEqual(whole.completeProved, true, 'has_more false did not prove coverage')
  // Two rows, not zero: hard-coding rowsCompared would otherwise stay green.
  assert.strictEqual(whole.rowsCompared, 2)

  const truncated = runCli('judge', fixture('p2.json', goodRow), fixture('w2.json', []),
    fixture('d2.json', { results: two, has_more: true }))
  const partial = JSON.parse(truncated.out).duplicates
  assert.strictEqual(partial.completeProved, false, 'has_more true was treated as complete')
  assert.match(partial.coverage, /left unsent/)

  const silent = runCli('judge', fixture('p3.json', goodRow), fixture('w3.json', []), fixture('d3.json', two))
  assert.strictEqual(JSON.parse(silent.out).duplicates.completeProved, false,
    'a result with no has_more was treated as complete')

  for (const field of [whole, partial]) {
    assert.strictEqual(typeof field.completeProved, 'boolean', 'completeProved is not a boolean')
    assert.ok(!('complete' in field), 'the old truthy `complete` field is back')
  }
})

check('judge reports the duplicate check as not run when no duplicate rows are passed', () => {
  const proposed = fixture('proposed3.json', goodRow)
  const result = runCli('judge', proposed, fixture('window2.json', []))
  assert.strictEqual(result.code, 0, `judge failed: ${result.out}`)
  const d = JSON.parse(result.out).duplicates
  assert.strictEqual(d.ran, false)
  assert.strictEqual(d.completeProved, false)
})

check('a real response is read the way the workspace actually answers', () => {
  // THE FIXTURE IS A REAL RESPONSE, copied from a live query on 2026-08-19, not
  // a shape anybody reasoned toward. THE IDENTIFIERS ARE REMAPPED, per the rule
  // in CLAUDE.md that a test fixture is a publishing surface: the shapes are
  // exactly what came back, the page and data source ids are not. A multi-select comes back as a JSON array
  // inside a string. Four review rounds assumed it came back as an array, and
  // the whole JSON string was read as one segment name matching nothing.
  const real = {
    results: [{
      url: 'https://app.notion.com/00000000000000000000000000000f01',
      Name: 'Live run Q3 webinar',
      Type: 'Event',
      Status: 'Confirmed',
      Segment: '["Enterprise","Mid-Market"]',
      'L2C Lifecycle': null,
      Link: 'https://example.com/live-run-webinar',
      'date:Date:start': '2026-09-10',
      'date:Date:end': null
    }],
    has_more: false,
    data_source_ids: ['00000000-0000-4000-8000-000000000001']
  }
  const [normalised] = command.normaliseRows(context, real)
  assert.deepStrictEqual(normalised.Segment, ['Enterprise', 'Mid-Market'], 'the JSON array column was not parsed')
  assert.strictEqual(normalised['L2C Lifecycle'], null)
  assert.strictEqual(normalised.identity, '00000000000000000000000000000f01')
  assert.deepStrictEqual(normalised.date, { start: '2026-09-10' })

  // The consequence, which is the reason this matters: a shared segment is a
  // clash, and against the unparsed string it was not one.
  const proposed = { Name: 'Another', Type: 'Event', Status: 'Confirmed', Segment: ['Enterprise'], date: { start: '2026-09-10' } }
  assert.strictEqual(clash.clashes(proposed, [normalised]).overlapping.length, 1,
    'a real row sharing a segment did not register as a clash')
})

check('every command the skills tell a reader to run exists', () => {
  // ROUNDS 2 AND 3 BOTH FOUND THE SKILLS DESCRIBING AN INTERFACE THE CODE DID
  // NOT HAVE, and round 5 found the `prove-update` signature changing underneath
  // its own page. Reading the skills rather than restating them is the point: a
  // command renamed in the script and not on the page fails here.
  const skillsDir = path.join(__dirname, '..', 'plugins', 'calendar', 'skills')
  // The CLI's own list, read the way a user meets it: run it with no command.
  const listed = runCli().out
  assert.match(listed, /One of: /, `the CLI did not print its command list: ${listed}`)
  const real = new Set(listed.replace(/^[\s\S]*One of: /, '').trim().split(/,\s*/))

  // A SIZE CHECK IS NOT A PARSE CHECK. The first version of this asserted only
  // `size > 5`, and it passed against a set holding the strings "0" to "11",
  // because it read the array's keys instead of its values. Naming a command
  // that must be there is what makes a garbage parse fail.
  for (const known of ['context', 'create', 'prove-update']) {
    assert.ok(real.has(known), `the command list did not parse: ${JSON.stringify([...real])}`)
  }

  const documented = new Set()
  for (const skill of fs.readdirSync(skillsDir)) {
    const file = path.join(skillsDir, skill, 'SKILL.md')
    if (!fs.existsSync(file)) continue
    const text = fs.readFileSync(file, 'utf8')
    for (const match of text.matchAll(/calendar\.js"?\s+([a-z][a-z-]*)/g)) {
      documented.add(match[1])
    }
  }
  assert.ok(documented.size > 3, `no commands were found in the skill files: ${JSON.stringify([...documented])}`)

  for (const name of documented) {
    assert.ok(real.has(name), `the skills tell a reader to run \`${name}\`, which is not a command this script has`)
  }

  // NAMES ARE NOT THE CONTRACT, ARGUMENTS ARE HALF OF IT. `prove` and
  // `prove-update` both changed how many files they take while keeping their
  // names, and a name-only check would have stayed green through both.
  for (const skill of fs.readdirSync(skillsDir)) {
    const file = path.join(skillsDir, skill, 'SKILL.md')
    if (!fs.existsSync(file)) continue
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      // `[<end date>]` counts too. The first version of this regex accepted
      // only bare `<argument>` tokens, so every documented call with an optional
      // argument was skipped in silence, including `window <date> [<end date>]`.
      const call = /calendar\.js"?\s+([a-z][a-z-]*)((?:\s+\[?<[^>]+>\]?)*)\s*$/.exec(line.trim())
      if (!call) continue
      const [, name, argsText] = call
      const allArgs = (argsText.match(/\[?<[^>]+>\]?/g) || [])
      const documentedArgs = allArgs.length
      const requiredArgs = allArgs.filter(a => !a.startsWith('[')).length
      const fn = command.commands[name]
      assert.ok(fn, `${skill}/SKILL.md documents \`${name}\`, which is not a command`)

      // Never more arguments than the command accepts.
      assert.ok(documentedArgs <= fn.length,
        `${skill}/SKILL.md shows \`${name}\` taking ${documentedArgs} arguments and the command accepts ${fn.length}`)

      // AND NEVER FEWER THAN IT REQUIRES, checked by running it. Arity cannot
      // say which arguments are optional, so this asks the command: called the
      // way the page documents it, does it refuse for want of an argument? The
      // files do not exist, so it fails either way; what matters is which
      // failure. `judge`'s third file is genuinely optional and passes here.
      // Called with only the arguments the page marks as required.
      //
      // MATCHING ON THE WORD "needs" WAS NOT ENOUGH. A command reworded to
      // "requires a start and end" would refuse the documented call and stay
      // green. Where a command takes plain arguments rather than files, this
      // runs it for real and requires it to succeed.
      const plainArgs = { window: ['2026-09-10'], soon: ['2026-09-01', '2026-09-30'], context: [] }
      if (plainArgs[name] && plainArgs[name].length === requiredArgs) {
        const ran = runCli(name, ...plainArgs[name])
        assert.strictEqual(ran.code, 0,
          `${skill}/SKILL.md shows \`${name}\` with ${requiredArgs} required argument(s) and it fails when called that way:\n${ran.out}`)
      } else {
        const dummies = Array.from({ length: requiredArgs }, (_, i) => path.join(SANDBOX, `nope-${name}-${i}.json`))
        const called = runCli(name, ...dummies)
        assert.ok(
          !/needs|requires/i.test(called.out),
          `${skill}/SKILL.md shows \`${name}\` with ${documentedArgs} argument(s) and the command refuses that as too few:\n${called.out}`
        )
      }
    }
  }
})

check('every queried multi-select column is in the parse list', () => {
  // DRIFT GUARD, not a restatement. `JSON_ARRAY_COLUMNS` holds Segment and
  // L2C Lifecycle because those are the only multi-selects `SELECTED` queries.
  // Channel and Audience are multi-selects too and are correctly absent, because
  // no query asks for them. Add one to `SELECTED` without adding it here and its
  // JSON string would be copied through exactly as Segment's was, which is the
  // bug the live run found. This fails the moment those two lists disagree.
  const multiSelect = Object.entries(row.FIELD_TYPES)
    .filter(([, type]) => type === 'multi_select')
    .map(([field]) => field)

  const queriedMultiSelect = multiSelect.filter(field => command.SELECTED.includes(field))
  for (const field of queriedMultiSelect) {
    assert.ok(command.JSON_ARRAY_COLUMNS.has(field),
      `${field} is queried and is a multi-select, but nothing parses its JSON array`)
  }
  for (const field of command.JSON_ARRAY_COLUMNS) {
    assert.ok(multiSelect.includes(field), `${field} is parsed as a JSON array but is not a multi-select`)
    assert.ok(command.SELECTED.includes(field), `${field} is parsed as a JSON array but no query selects it`)
  }
  // If this number changes, one of the two lists moved and the other did not.
  assert.strictEqual(queriedMultiSelect.length, command.JSON_ARRAY_COLUMNS.size)
})

check('a column that should be a JSON array and is not is refused by name', () => {
  const bad = [{ url: 'https://app.notion.com/00000000000000000000000000000abc', Segment: 'Enterprise' }]
  assert.throws(() => command.normaliseRows(context, bad), /not the JSON array this column is/)
})

// -------------------------------------------------- proving the update landed

check('update and prove-update catch a failed clear, run as a user runs them', () => {
  // THE ONLY TEST THAT CROSSES BOTH COMMAND BOUNDARIES. The previous version
  // called `updatePayload` and `proveWrite` directly, so reverting the real
  // `prove-update` route, or making `update` bypass the shared builder, left it
  // green. This runs the two commands and reads what they print.
  const url = 'https://app.notion.com/00000000000000000000000000000f01'
  const beforeRow = Object.assign({}, before, { url })
  const afterRow = Object.assign({}, before, {
    url,
    Location: '',
    body: {
      'What It Is': 'A row whose location is being emptied.',
      'Why We Are Doing It': 'To prove that a clear which fails is caught rather than reported as landed.'
    }
  })

  const updated = runCli('update', fixture('u-before.json', beforeRow), fixture('u-after.json', afterRow))
  assert.strictEqual(updated.code, 0, `update failed: ${updated.out}`)
  const emitted = JSON.parse(updated.out)
  assert.deepStrictEqual(emitted.clearing.map(c => c.field), ['Location'])
  assert.deepStrictEqual(emitted.properties[context.property('Location')], null,
    'update did not emit the clear')
  assert.strictEqual(emitted.target, '00000000000000000000000000000f01')

  const updateFile = fixture('u-emitted.json', emitted)

  // Notion kept the old value: the clear did not land.
  const stale = {
    url,
    properties: Object.assign({}, emitted.properties, {
      [context.property('Location')]: 'Online'
    }),
    headings: emitted.headings
  }
  const failed = runCli('prove-update', updateFile, fixture('u-stale.json', stale))
  assert.strictEqual(failed.code, 1, 'prove-update passed a clear that did not land')
  assert.match(failed.out, /did not fully land/)

  const landed = { url, properties: emitted.properties, headings: emitted.headings }
  const clean = runCli('prove-update', updateFile, fixture('u-landed.json', landed))
  assert.strictEqual(clean.code, 0, `prove-update failed on a good read-back: ${clean.out}`)
})

check('judge refuses rows that have already been normalised', () => {
  // THE ONE A REVIEWER REACHED BY FOLLOWING THE INSTRUCTIONS. The generated
  // query note used to say to run `normalise` before judging, and `judge`
  // normalises itself, so the second pass emptied every row including its date
  // and a real same-day clash came back as zero with checked: true.
  const raw = { results: [{ url: 'https://app.notion.com/00000000000000000000000000000abc', Name: 'A thing', Segment: '["Enterprise"]', 'date:Date:start': '2026-09-10' }], has_more: false }
  const once = command.normaliseRows(context, raw)
  const proposed = fixture('dn-proposed.json', goodRow)

  const twice = runCli('judge', proposed, fixture('dn-window.json', once))
  assert.strictEqual(twice.code, 1, 'judge accepted rows that had already been normalised')
  assert.match(twice.out, /already been through/)

  const dupes = runCli('judge', proposed, fixture('dn-w2.json', raw), fixture('dn-d2.json', once))
  assert.strictEqual(dupes.code, 1, 'judge accepted pre-normalised duplicate rows')

  // And the raw form still works, so this refuses the mistake rather than the job.
  assert.strictEqual(runCli('judge', proposed, fixture('dn-w3.json', raw)).code, 0)
})

check('no generated note tells the caller to normalise before judging', () => {
  // The note is what made the bug above reachable, so it is asserted rather than
  // left to a reader.
  const notes = [
    command.windowQuery(context, '2026-09-10').note,
    command.duplicateQuery(context, goodRow).note,
    command.soonQueries(context, '2026-09-01', '2026-09-30').dated.note
  ].filter(Boolean)
  assert.ok(notes.length >= 2, 'the queries stopped carrying notes, so this checks nothing')
  for (const note of notes) {
    assert.ok(!/through `normalise` before judging/.test(note),
      `a query note still tells the caller to normalise before judging:\n${note}`)
  }
})

check('a multi-select list of anything other than names is refused', () => {
  // `[{name: 'Enterprise'}]` used to pass through and then be filtered to
  // nothing, so the row read as targeting nobody. Same false negative as the
  // JSON string, through the other door.
  const objects = [{ url: 'https://app.notion.com/00000000000000000000000000000abc', Segment: [{ name: 'Enterprise' }] }]
  assert.throws(() => command.normaliseRows(context, objects), /not a value name/)
  // A real list of names is still fine.
  const names = [{ url: 'https://app.notion.com/00000000000000000000000000000abc', Segment: ['Enterprise'] }]
  assert.deepStrictEqual(command.normaliseRows(context, names)[0].Segment, ['Enterprise'])
})

check('coverage is not proved from an envelope nobody has measured', () => {
  // `rowList` also accepts `rows` and `data`, which no run has ever returned.
  // Reading has_more off one of those is a guess wearing a measurement's clothes.
  const rows = [{ url: 'https://app.notion.com/00000000000000000000000000000abc', Name: 'One' }]
  const guessed = runCli('judge', fixture('ce-p.json', goodRow), fixture('ce-w.json', []),
    fixture('ce-d.json', { rows, has_more: false }))
  assert.strictEqual(guessed.code, 0, `judge failed: ${guessed.out}`)
  assert.strictEqual(JSON.parse(guessed.out).duplicates.completeProved, false,
    'coverage was proved from an envelope that has never been seen')

  const measured = runCli('judge', fixture('ce-p2.json', goodRow), fixture('ce-w2.json', []),
    fixture('ce-d2.json', { results: rows, has_more: false }))
  assert.strictEqual(JSON.parse(measured.out).duplicates.completeProved, true)
})

check('prove-update refuses an update output with no headings', () => {
  // `update` always emits headings, so a file without them is not an update
  // output. Defaulting to [] would skip every section check and still report a
  // clean proof, which is a heading that failed to write reported as landed.
  const url = 'https://app.notion.com/00000000000000000000000000000f01'
  const emitted = { target: '00000000000000000000000000000f01', properties: {} }
  const result = runCli('prove-update', fixture('h-emitted.json', emitted), fixture('h-back.json', { url, properties: {} }))
  assert.strictEqual(result.code, 1, 'prove-update accepted an update output with no headings')
  assert.match(result.out, /not the output of `update`/)
})

check('prove refuses a read-back of a page other than the one created', () => {
  // The same binding `prove-update` has. Without it a read-back from any page
  // whose properties happen to match passes as a landed create.
  const created = 'https://app.notion.com/00000000000000000000000000000f01'
  const intended = intendedFor(goodRow)
  const rowFile = fixture('pv-row.json', goodRow)

  const right = { url: created, properties: intended.properties, headings: intended.headings }
  assert.strictEqual(runCli('prove', rowFile, fixture('pv-ok.json', right), created).code, 0,
    'prove failed on the page it was told about')

  const wrong = { url: 'https://app.notion.com/00000000000000000000000000000abc', properties: intended.properties, headings: intended.headings }
  const other = runCli('prove', rowFile, fixture('pv-other.json', wrong), created)
  assert.strictEqual(other.code, 1, 'prove proved a create against a different page')
  assert.match(other.out, /different page/)

  const noUrl = runCli('prove', rowFile, fixture('pv-nourl.json', { properties: intended.properties, headings: intended.headings }), created)
  assert.strictEqual(noUrl.code, 1, 'prove accepted a read-back it cannot identify')

  assert.strictEqual(runCli('prove', rowFile, fixture('pv-ok2.json', right)).code, 1,
    'prove ran without being told which page was created')
})

check('neither query can be truncated without a check going red', () => {
  // NAMED BY TWO REVIEWERS AS THE MUTATION THAT STAYS GREEN. Adding LIMIT 1 to
  // either query destroys what it exists to do while every higher-level test
  // stays green, because those feed hand-built rows rather than running the SQL.
  // The duplicate query in particular selects the whole table on purpose: a
  // truncation there is a duplicate that is never compared.
  const duplicate = command.duplicateQuery(context, goodRow).sql
  const window = command.windowQuery(context, '2026-09-10').sql
  const queries = command.soonQueries(context, '2026-09-01', '2026-09-30')
  for (const [which, sql] of [['duplicate', duplicate], ['window', window], ['dated', queries.dated.sql], ['undated', queries.undated.sql]]) {
    assert.ok(sql, `${which} produced no sql`)
    assert.ok(!/\bLIMIT\b/i.test(sql), `the ${which} query is truncated by a LIMIT:\n${sql}`)
    assert.ok(!/\bOFFSET\b/i.test(sql), `the ${which} query skips rows with an OFFSET:\n${sql}`)
  }
})

check('shiftDay refuses a day that does not exist', () => {
  // dayNumber was fixed and this was not, so a window could still be widened
  // from 2026-02-31 rolled forward to 2026-03-03.
  for (const impossible of ['2026-02-31', '2026-13-01', '2025-02-29', '2026-04-31']) {
    assert.throws(() => command.shiftDay(impossible, 7), /not a day that exists/, `${impossible} was accepted`)
  }
  assert.strictEqual(command.shiftDay('2026-09-10', 7), '2026-09-17')
  assert.strictEqual(command.shiftDay('2024-02-29', 1), '2024-03-01')
  assert.strictEqual(command.shiftDay('2026-01-01', -1), '2025-12-31')
})

check('update refuses a before row with no url', () => {
  // Without it `update` cannot name the page it is for, and `prove-update` would
  // have nothing to check the read-back against.
  const afterRow = Object.assign({}, before, { Location: '', body: { 'What It Is': 'x', 'Why We Are Doing It': 'y' } })
  const result = runCli('update', fixture('n-before.json', before), fixture('n-after.json', afterRow))
  assert.strictEqual(result.code, 1, 'update accepted a row it cannot identify')
  assert.match(result.out, /no usable `url`/)
})

check('prove-update refuses a read-back of a different page', () => {
  // Without this it would check some other row and report a clean write.
  const url = 'https://app.notion.com/00000000000000000000000000000f01'
  const beforeRow = Object.assign({}, before, { url })
  const afterRow = Object.assign({}, before, {
    url,
    Location: '',
    body: { 'What It Is': 'x', 'Why We Are Doing It': 'y' }
  })
  const emitted = JSON.parse(runCli('update', fixture('x-before.json', beforeRow), fixture('x-after.json', afterRow)).out)
  const elsewhere = {
    url: 'https://app.notion.com/00000000000000000000000000000abc',
    properties: emitted.properties,
    headings: emitted.headings
  }
  const result = runCli('prove-update', fixture('x-emitted.json', emitted), fixture('x-other.json', elsewhere))
  assert.strictEqual(result.code, 1, 'prove-update proved a write against a different page')
  assert.match(result.out, /different page/)
})

check('prove-update refuses the update inputs in place of what update printed', () => {
  // Passing `after.json` for both arguments used to remove every clear from the
  // recomputed payload, and a read-back holding the old value then proved clean.
  const afterRow = Object.assign({}, before, { url: 'https://app.notion.com/00000000000000000000000000000f01', Location: '' })
  const result = runCli('prove-update', fixture('y-after.json', afterRow), fixture('y-back.json', { url: 'x', properties: {} }))
  assert.strictEqual(result.code, 1)
  assert.match(result.out, /not the output of `update`/)
})

check('a clear that failed is caught, and the old proof route misses it', () => {
  // THE END-TO-END CASE FOR THE UPDATE PROOF. `update` emits an explicit empty
  // for a property being cleared, but `prove` rebuilt the payload from the
  // merged row with `properties`, which omits an empty value. The cleared
  // property was therefore not in what the proof compared, so a `Location` that
  // Notion failed to empty came back with its old value and the write was
  // reported as landed. Both halves are asserted here: the new route catches it,
  // and the old route does not, because a test that only asserts the fix passes
  // cannot tell that it was ever needed.
  const after = Object.assign({}, before, { Location: '' })
  const { properties, cleared } = command.updatePayload(context, before, after)

  assert.deepStrictEqual(cleared.map(c => c.field), ['Location'], 'Location was not treated as cleared')
  assert.deepStrictEqual(properties[context.property('Location')], null, 'the clear is not in the payload')

  // Notion kept the old value: the clear did not land.
  const readback = {
    properties: Object.assign({}, properties, {
      [context.property('Location')]: 'Online'
    }),
    headings: command.sectionsFor(after, after.body || {})
  }

  const proved = command.proveWrite(context, { properties, headings: readback.headings }, readback)
  assert.strictEqual(proved.problems.length, 1, 'a failed clear passed the update proof')
  assert.strictEqual(proved.problems[0].what, context.property('Location'))

  // The route `prove` used before: rebuild from the merged row alone.
  //
  // BUILT IN THE SAME PERSON MODE `updatePayload` USES, so the only difference
  // between the two routes is the clear. Left in create mode this defaults an
  // absent Owner to the configured person, the real payload does not, and the
  // proof then fails on Owner rather than on the missing Location clear: a
  // green-to-red that would have looked like this test working when it was
  // measuring the wrong difference.
  const oldRoute = { properties: row.properties(context, after, { defaultsPerson: false }), headings: readback.headings }
  assert.ok(
    !(context.property('Location') in oldRoute.properties),
    'the old route now carries the cleared property, so this test no longer proves anything'
  )
  assert.deepStrictEqual(
    command.proveWrite(context, oldRoute, readback).problems, [],
    'the old route caught the failed clear, so the bug this test exists for was never real'
  )
})

check('the update payload is built once, so the proof checks what the update sent', () => {
  // `update` and `prove-update` both go through `updatePayload`. If either
  // rebuilt the payload its own way they could disagree about a clear, which is
  // the fault above in a different shape.
  const after = Object.assign({}, before, { Location: '' })
  const once = command.updatePayload(context, before, after)
  const twice = command.updatePayload(context, before, after)
  assert.deepStrictEqual(once.properties, twice.properties)
  // Same person mode on both sides, for the reason given in the test above: the
  // count being compared is "with clears" against "without clears", and a
  // difference in person defaulting would move it for an unrelated reason.
  assert.ok(Object.keys(once.properties).length > Object.keys(row.properties(context, after, { defaultsPerson: false })).length,
    'the payload carries no more than the set properties, so it holds no clears')
})

check('an update that does not carry the owner across clears it, rather than dying', () => {
  // THE WHOLE CALL USED TO DIE HERE, blaming the plugin. `after` is the merged
  // row, so an absent Owner is a field that lost its value and `clearing`
  // empties it. `properties` also defaulted an absent person to the configured
  // one, so the payload held a set and a clear for Owner and `updatePayload`
  // refused it: "this is a bug in this plugin, not in the row", which it was.
  // Reachable by following update/SKILL.md, which says to build the merged row
  // by hand field by field, and Owner is the field a date change forgets.
  const owned = Object.assign({}, before, { Owner: SOMEBODY })
  const moved = Object.assign({}, before, { date: { start: '2026-09-17' } })

  const { properties, cleared } = command.updatePayload(context, owned, moved)

  assert.deepStrictEqual(cleared.map(c => c.field), ['Owner'], 'the owner was not reported as being emptied')
  assert.strictEqual(properties.Owner, null, 'the owner is not cleared in the payload')
  // Not the configured person, which is what made the two halves disagree.
  assert.notDeepStrictEqual(properties.Owner, [context.personId])
})

check('"me" on an update is still the configured person, and is not a default', () => {
  // `peopleAsked` returns null for both "not mentioned" and "me", and only one
  // of them is a request. Collapsing them again would either break the fix
  // above or stop "me" working on an update, and nothing else tells them apart.
  const owned = Object.assign({}, before, { Owner: SOMEBODY })
  const toMe = Object.assign({}, before, { Owner: 'me' })
  const { properties, cleared } = command.updatePayload(context, owned, toMe)
  assert.deepStrictEqual(properties.Owner, [context.personId], '"me" did not resolve on an update')
  assert.deepStrictEqual(cleared.map(c => c.field), [], '"me" was read as an empty owner')
})

check('a create still defaults an absent owner to the configured person', () => {
  // The other half of the same change. The default is right where there is
  // nothing to leave alone, and removing it everywhere would have been the
  // easier fix and the wrong one.
  assert.deepStrictEqual(row.properties(context, ownerRow).Owner, [context.personId])
})

check('a property cannot be both set and cleared by one call', () => {
  // Location is still set in `after`, so forcing `clearing` to report it makes
  // the two halves of the payload disagree about one property. It has to refuse
  // rather than let one of them win: a call carrying two answers for one
  // property would resolve to whichever the merge kept.
  const after = Object.assign({}, before)
  const original = row.clearing
  row.clearing = () => [{ field: 'Location', because: 'emptied' }]
  try {
    assert.throws(() => command.updatePayload(context, before, after), /both set and cleared/)
  } finally {
    row.clearing = original
  }
})

check('a date that was removed is cleared with the empty a date takes', () => {
  const after = Object.assign({}, before, { Status: 'Planned' })
  delete after.date
  const cleared = row.clearing(before, after)
  assert.deepStrictEqual(cleared.map(c => c.field), ['Date'])
  // A date clears through the column it is written through, not under its name.
  assert.deepStrictEqual(row.clearedProperties(context, cleared), {
    [row.dateKeys(context).start]: null,
    [row.dateKeys(context).end]: null
  })
})

check('every field that can be cleared clears with null', () => {
  // Three types were measured on 2026-08-19: rich_text, select and multi-select
  // all cleared with null in one call. Title, url, date and people are the
  // client's null convention applied by extension, not measured. There is no
  // per-type empty payload any more, so this asserts the uniformity rather than
  // a table of shapes.
  const everyField = Object.keys(row.FIELD_TYPES).filter(f => !['Name', 'Type', 'Status'].includes(f))
  const payload = row.clearedProperties(context, everyField.map(field => ({ field, because: 'emptied' })))
  for (const value of Object.values(payload)) {
    assert.strictEqual(value, null, `a field cleared with ${JSON.stringify(value)} rather than null`)
  }
  // Every field is represented, and the date takes two keys rather than one.
  assert.strictEqual(Object.keys(payload).length, everyField.length + 1)
})

check('a field this plugin does not know is refused rather than cleared', () => {
  assert.throws(
    () => row.clearedProperties(context, [{ field: 'Nonsense', because: 'emptied' }]),
    /not a field this plugin knows how to clear/
  )
})

check('every field FIELD_TYPES names is one `properties` actually writes', () => {
  // FIELD_TYPES decides what can be cleared, and `properties` decides what gets
  // written. A field in one and not the other is a field that can be emptied and
  // never set, or set and never emptied. The per-type empty payloads this used
  // to compare are gone: every type clears with null. THREE TYPES WERE MEASURED
  // on 2026-08-19, a rich_text, a select and a multi-select; the rest are the
  // client's null convention applied by extension. `row.js` was narrowed to say
  // so when round 8 raised it and this copy was missed, which is the drift the
  // rule against restating a claim beside the thing it describes exists to stop.
  const full = {
    Name: 'x', Type: 'Event', Status: 'Confirmed', date: { start: '2026-09-10' },
    Description: 'd', Link: 'https://example.com', Location: 'Online',
    'Our role': 'Hosting', Format: 'Webinar', Domain: 'GTM Strategy & ICP',
    Audience: ['Sales'], Segment: ['SMB'], 'L2C Lifecycle': ['2 - Eval & Demo']
  }
  // Channel is not allowed on an Event, so it gets a row of a type that does
  // allow it rather than an exemption. Skipping it left a mutation green: drop
  // 'Channel' from `properties` and nothing noticed.
  const social = {
    Name: 'x', Type: 'Social post', Status: 'Confirmed', date: { start: '2026-09-10' },
    Channel: ['LinkedIn'], Audience: ['Sales'], Segment: ['SMB']
  }
  const built = Object.assign({}, row.properties(context, full), row.properties(context, social))
  for (const [field, type] of Object.entries(row.FIELD_TYPES)) {
    const key = type === 'date' ? row.dateKeys(context).start : context.property(field)
    assert.ok(key in built, `"${field}" is in FIELD_TYPES and \`properties\` did not write it`)

    // THE VALUE, NOT JUST THE KEY. Emitting Channel as null or [] kept the key
    // and lost the channel, and this stayed green. A multi-select carries names,
    // a date carries its day, and everything else carries a non-empty value.
    const wrote = built[key]
    if (type === 'multi_select' || type === 'people') {
      assert.ok(Array.isArray(wrote) && wrote.length, `"${field}" was written as ${JSON.stringify(wrote)}, which carries no value`)
      assert.ok(wrote.every(v => typeof v === 'string' && v), `"${field}" was written with an entry that is not a name`)
    } else {
      assert.ok(wrote !== null && wrote !== undefined && wrote !== '', `"${field}" was written as ${JSON.stringify(wrote)}`)
    }
  }
})

fs.rmSync(SANDBOX, { recursive: true, force: true })

/**
 * PROVED BY BREAKING, 2026-08-19:
 *
 *   windowQuery using the proposed dates without widening
 *     red: the query window is widened by the same number of days the judge uses
 *   soonQueries returning only the dated half
 *     red: soon asks two questions, and one of them is for undated rows
 *   proveWrite returning problems: [] when the read-back is absent
 *     red: no read-back at all proves nothing, and says so
 *   bodyProblems counting conditional sections toward the ceiling
 *     red: only the required sections count toward the ceiling
 *
 * PROVED BY BREAKING, later the same day, answering a review round. Every one of
 * these was green against the code as it stood, which is the point of listing
 * them separately: they are the checks the earlier set did not contain.
 *
 *   windowQuery with every >= and <= made strict
 *     red: the query is inclusive at both ends, in the SQL and not only in the judge
 *     still green: a row at the edge of the query window is also inside the judge window
 *   windowQuery with the third, spanning clause deleted
 *     red: a long event that began before the window is still fetched
 *   the status test written back as `c."Status" != 'Canceled'`
 *     red: a row with no status at all is still fetched
 *   duplicateQuery with its name and link filter restored
 *     red: the duplicate query filters on nothing
 *     red: the pairs the comparator matches are pairs the query would have returned
 *   proveWrite comparing only select and multi_select, as it did before this round
 *     red: a read-back matching what was sent proves clean, and still says what it did not check
 *     red: a title that came back truncated is caught
 *     red: a url that came back empty is caught
 *     red: a date that came back on the wrong day is caught
 *     red: a rich text that came back empty is caught
 *     red: a person property that came back empty is caught
 *     still green: every property sent is either checked or named as unchecked.
 *       It counts what was accounted for and the old code accounted for
 *       everything, as checked or as unchecked. It is the guard against a
 *       property being dropped from the report entirely, which is a different
 *       failure from a property being reported without being compared, and it
 *       is listed here so nobody reads it as covering the second one.
 *
 * PROVED BY BREAKING, round 9, 2026-08-21. Applied one at a time.
 *
 *   the person default put back on updates, `if (context.personId)`
 *     red: an update that does not carry the owner across clears it, rather
 *          than dying
 *   updatePayload no longer passing `defaultsPerson: false`
 *     red: an update that does not carry the owner across clears it, rather
 *          than dying
 *   the default removed from creates as well, `if (value === 'me' && ...)`
 *     red: a create still defaults an absent owner to the configured person
 *     red: an owner nobody named is the person the install is configured with
 *     red: Owner is set when config records a person
 *     red: every person field in the shared schema is covered
 *     and three more. This is the easier fix and the wrong one, and it is listed
 *     because the two halves of the person rule have to be broken separately or
 *     a fix that removes the rule entirely reads as a fix that split it.
 *   the user:// strip removed from personIdFrom
 *     red: an owner read back with its user:// prefix is accepted and written bare
 *     still green: a prefix on something that is not an id is still refused. The
 *       guard against the strip turning a name into an id.
 *
 * PROVED BY BREAKING, round 9 answers, 2026-08-21. One rule for a multi-select,
 * after both reviewers found the read, clash and write paths disagreeing.
 *
 *   listProblem no longer checking list contents
 *     red: five checks across both files, including the drift guard
 *   listProblem no longer checking that the value is a list
 *     red: a multi-select that is not a list of names is refused rather than dropped
 *   listProblem waving every array through
 *     red: five checks. The guard against curing a silent drop by refusing
 *       nothing, which would have left the whole change looking done.
 *   row.problems no longer consulting the rule
 *     red: the read, clash and write paths agree about what a multi-select may hold
 *   clash.targetingValues filtering non-names away again, as it did before this
 *     red: a list holding something that is not a name is refused, not filtered away
 *   namesOnly no longer consulting the rule
 *     red: a JSON-string column carrying objects is refused, not just a direct array
 *   two of the four fields dropped from MULTI_SELECT_FIELDS
 *     red: a multi-select that is not a list of names is refused rather than dropped
 *     THIS ONE STAYED GREEN AT FIRST. The check was written against `Segment`
 *     alone and read as covering four fields, which is the fault it was written
 *     to catch, one level up. It loops the fields now and asserts the list.
 *   clearing returning nothing, which is what an update built from `properties`
 *   alone amounts to
 *     red: a type change clears the fields it invalidates
 *     red: a field the user emptied is cleared too, and is not called a type change
 *     red: a date that was removed is cleared with the empty a date takes
 *   FIELD_TYPES saying Location is a select
 *     red: a type change clears the fields it invalidates
 *     GREEN, AND THIS ENTRY WAS FALSE UNTIL 2026-08-21. It claimed a second red,
 *     on a test called "the type each field is cleared as is the type it is
 *     written as". No such test has ever existed in this suite. Both reviewers
 *     found it in round 9 and the mutation was re-run here: it stays green.
 *     `properties` writes Location through `String()` whatever FIELD_TYPES says,
 *     and every non-date type clears with null, so the key and the value are
 *     both unchanged by the mutation and nothing can see it. Left recorded
 *     rather than deleted, because a break list that quietly loses an entry
 *     reads as a mutation nobody tried. THIS IS AN OPEN GAP, not a proved check.
 *   the person block writing the configured person whatever was asked for,
 *   which is what it did before this round
 *     red: a named owner is written, rather than being rewritten back
 *     red: an owner given as an object with an id is accepted
 *     red: two owners are both written
 *   the person id check accepting anything truthy
 *     red: an owner given as a name is refused rather than sent
 *     red: two owners are both written, and one bad id refuses the whole row
 *
 * Round 4, 2026-08-19. Each mutation below was applied on its own, the suite was
 * run, and what is recorded is what went red rather than what was expected to.
 * READ THESE AS "AT LEAST THESE WENT RED". They were produced by running the
 * suite and reading its failures, so they name every check that failed for that
 * mutation, but a mutation nobody tried is not evidence of anything.
 *
 *   rowList returning [] for null or undefined, which is what let a rows file
 *   holding null be reported as a duplicate lookup that found nothing
 *     red: a response envelope is accepted, and an unrecognised shape is refused
 *     red: a rows file holding null is refused rather than read as nothing found
 *   rowList taking the first of results/rows/data instead of refusing two
 *     red: a response envelope is accepted, and an unrecognised shape is refused
 *   updatePayload returning only the set properties, which is the route `prove`
 *   used and the reason a failed clear was reported as a successful write
 *     red: a clear that failed is caught, and the old proof route misses it
 *     red: the update payload is built once, so the proof checks what the update sent
 *   the set-and-cleared guard removed
 *     red: a property cannot be both set and cleared by one call
 *   report accepting only the dated file
 *     red: report refuses to run without the undated rows
 *   judge dropping complete and rowsCompared from the duplicate result
 *     red: judge says what it compared rather than claiming the check was complete
 *
 * Round 5 and the live run, 2026-08-19. Same method: applied one at a time, the
 * suite run, the failures read off the run. All four mutations round 5 named as
 * leaving the tests green now go red.
 *
 *   prove-update rebuilding the payload from its input files instead of using
 *   what update emitted
 *     red: update and prove-update catch a failed clear, run as a user runs them
 *   update bypassing the shared payload builder
 *     red: update and prove-update catch a failed clear, run as a user runs them
 *   prove-update no longer checking page identity
 *     red: prove-update refuses a read-back of a different page
 *   rowsCompared hard-coded to zero
 *     red: coverage is proved from has_more, and never sits in a boolean field
 *   duplicateCoverage always claiming proved
 *     red: coverage is proved from has_more, and never sits in a boolean field
 *   normaliseRows no longer parsing the JSON array columns
 *     red: a real response is read the way the workspace actually answers
 *     red: a column that should be a JSON array and is not is refused by name
 *   Channel added to SELECTED without adding it to JSON_ARRAY_COLUMNS, which is
 *   the drift that would reintroduce the bug the live run found
 *     red: every queried multi-select column is in the parse list
 *   a command the skills document renamed in the script, prove-update to
 *   prove-the-update
 *     red: every command the skills tell a reader to run exists
 *     red: update and prove-update catch a failed clear, run as a user runs them
 *     red: prove-update refuses a read-back of a different page
 *     red: prove-update refuses the update inputs in place of what update printed
 *   Segment dropped from JSON_ARRAY_COLUMNS
 *     red: a real response is read the way the workspace actually answers
 *     red: every queried multi-select column is in the parse list
 *     red: a column that should be a JSON array and is not is refused by name
 *
 * Round 7 and the dialect change, 2026-08-20. Every mutation named by round 7 as
 * leaving the tests green now goes red.
 *
 *   the date end column omitted for a single day, which is what let a shortened
 *   range keep its old end and still prove clean
 *     red: shortening a range to one day clears the old end date
 *     red: a single day is written without an end
 *   the list comparison coercing with String and joining on a character
 *     red: two different lists never compare equal
 *   the parsed JSON array skipping its contents check
 *     red: a JSON-string column carrying objects is refused, not just an array
 *   Channel dropped from the emitted payload
 *     red: every field FIELD_TYPES names is one `properties` actually writes
 *   the user:// prefix no longer stripped
 *     red: a person written bare and read back prefixed is not a difference
 *   window made to require its documented-optional end argument
 *     red: every command the skills tell a reader to run exists
 *
 * ONE MUTATION CHANGED NOTHING, and it is recorded because a silent one is how a
 * break list starts lying. Restoring `undatedFile ? take(...) : []` in `report`
 * leaves every check green. That is not a hole in the tests: the guard above it
 * now refuses a missing file, so the fallback is unreachable and the mutation is
 * equivalent code. The guard is what the `report refuses to run` check covers.
 */

console.log(failures ? `\n${failures} failed.\n` : `\nAll checks passed.\n`)
process.exit(failures ? 1 : 0)

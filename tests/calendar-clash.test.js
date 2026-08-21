'use strict'

/**
 * The clash check and the duplicate check.
 *
 * The semantics under test are specified in `SKILLS-calendar.md`, and the ones
 * that matter most are the ones that are easy to get subtly wrong and impossible
 * to notice afterwards:
 *
 *   - the window is seven days either side, NOT range overlap. Range overlap was
 *     the original specification and it could not catch the failure the check
 *     exists to prevent, which is three emails to one list in a week.
 *   - "either side blank" means BOTH targeting fields empty, not one of them.
 *   - both sides blank is dropped entirely, because two rows saying nothing is
 *     not evidence of anything.
 *   - a name matching on any date is NOT a duplicate. A monthly newsletter is
 *     the same name twelve times and every one is real.
 *
 * PROVED BY BREAKING, 2026-08-19. Each break and what went red is recorded at
 * the bottom of this file.
 *
 * Run: node tests/calendar-clash.test.js
 */

const assert = require('assert')
const clash = require('../plugins/calendar/scripts/clash')
const command = require('../plugins/calendar/scripts/calendar')
const { pageIdentity } = require('../shared/page-id')

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
 * A row in the shape the real query produces, GENUINELY VIA `normaliseRows`.
 *
 * DELIBERATELY NOT A HAND-MADE `id` FIELD. These tests used to manufacture one,
 * and no query in this plugin ever asks for `id`, so the self-exclusion they
 * were proving could never fire on a real row. Rows are identified by page url,
 * which is what the queries select.
 *
 * AND DELIBERATELY NOT A HAND-MADE NORMALISED ROW EITHER. Until 2026-08-19 this
 * comment said "via normaliseRows" and the helper below built the normalised
 * shape by hand, so every test on this page judged rows that had never been
 * through the function that produces them, while the comment said otherwise. A
 * change to how a date or an absent value is normalised would have left the
 * whole suite green. Review found the comment; the fix is to make it true.
 *
 * The context is a pass-through rather than a real one, because a real one needs
 * a config file on disk and this suite deliberately has no temporary directory.
 * A renamed workspace is covered where the naming is the point, in
 * `tests/calendar-command.test.js`.
 *
 * ONLY THE CANDIDATE ROWS GO THROUGH IT, and that is correct rather than an
 * oversight. A candidate is a row the query returned. The proposed row is the
 * one being written, which comes from the user through the skill and never
 * through a query, so the tests build it directly and it is the one shape in
 * here that is meant to be hand-made.
 */
const urlFor = key => `https://app.notion.com/${String(key).padStart(32, "0").slice(-32).replace(/[^0-9a-f]/g, "a")}`

const passThrough = { property: logical => logical, value: (property, value) => value }

const normalise = raw => command.normaliseRows(passThrough, [raw])[0]

/** One row, written in the columns the query selects, then normalised. */
const row = (key, date, extra) => {
  const span = typeof date === 'string' ? { start: date } : (date || {})
  const written = Object.assign({ Name: key }, extra || {})
  const raw = { url: urlFor(key) }
  for (const [field, value] of Object.entries(written)) raw[field] = value
  raw['date:Date:start'] = span.start === undefined ? null : span.start
  raw['date:Date:end'] = span.end === undefined ? null : span.end
  return normalise(raw)
}


console.log('\nthe clash check and the duplicate check\n')

// ------------------------------------------------------------- the window

check('the motivating failure is caught: two emails in one week, not overlapping', () => {
  // The whole reason the window exists. Monday and Wednesday are one-day rows
  // whose ranges do not overlap. Under the original specification this returned
  // nothing, which meant the check could not see its own worked example.
  const result = clash.clashes(
    row('new', '2026-09-07', { Segment: ['Enterprise'] }),
    [row('other', '2026-09-09', { Segment: ['Enterprise'] })]
  )
  assert.strictEqual(result.checked, true)
  assert.strictEqual(result.overlapping.length, 1)
  assert.strictEqual(result.overlapping[0].row.Name, 'other')
})

check('seven days either side is inclusive at the edge', () => {
  const inside = clash.clashes(
    row('new', '2026-09-10', { Segment: ['Enterprise'] }),
    [row('edge', '2026-09-17', { Segment: ['Enterprise'] })]
  )
  assert.strictEqual(inside.overlapping.length, 1, 'a row exactly seven days out was not surfaced')
})

check('eight days out is outside the window', () => {
  const outside = clash.clashes(
    row('new', '2026-09-10', { Segment: ['Enterprise'] }),
    [row('far', '2026-09-18', { Segment: ['Enterprise'] })]
  )
  assert.strictEqual(outside.overlapping.length, 0)
})

check('a multi-day range is a candidate when any part of it is in the window', () => {
  const result = clash.clashes(
    row('new', '2026-09-10', { Segment: ['Enterprise'] }),
    [row('conference', { start: '2026-09-15', end: '2026-09-20' }, { Segment: ['Enterprise'] })]
  )
  assert.strictEqual(result.overlapping.length, 1, 'a conference starting inside the window was missed')
})

check('a row is never surfaced against itself', () => {
  // `update` re-runs this on a moved date, and the row being moved is in its own
  // window by definition. Without this, every date change reports a clash with
  // the thing being changed.
  const result = clash.clashes(
    row('same', '2026-09-10', { Segment: ['Enterprise'] }),
    [row('same', '2026-09-10', { Segment: ['Enterprise'] })]
  )
  assert.strictEqual(result.overlapping.length, 0)
  assert.strictEqual(result.unknown.length, 0)
})

check('an undated row reports that it did not check, rather than finding nothing', () => {
  // Nothing found and nothing looked for read identically to a user, and only
  // one of them is information.
  const result = clash.clashes(
    row('new', null, { Segment: ['Enterprise'] }),
    [row('other', '2026-09-10', { Segment: ['Enterprise'] })]
  )
  assert.strictEqual(result.checked, false)
  assert.ok(result.why.includes('no date'))
  assert.strictEqual(result.overlapping.length, 0)
})

// ---------------------------------------------------------- what counts as a clash

check('one shared segment is enough to surface', () => {
  const result = clash.clashes(
    row('new', '2026-09-10', { Segment: ['Enterprise', 'Mid-market'] }),
    [row('other', '2026-09-11', { Segment: ['Enterprise'] })]
  )
  assert.strictEqual(result.overlapping.length, 1)
  assert.deepStrictEqual(result.overlapping[0].shared.Segment, ['Enterprise'])
})

check('different segments in the window are not a clash', () => {
  const result = clash.clashes(
    row('new', '2026-09-10', { Segment: ['Enterprise'] }),
    [row('other', '2026-09-11', { Segment: ['SMB'] })]
  )
  assert.strictEqual(result.overlapping.length, 0)
  assert.strictEqual(result.unknown.length, 0, 'two rows that both said who they target and disagreed were reported as unknown')
})

check('L2C Lifecycle alone can produce a clash', () => {
  const result = clash.clashes(
    row('new', '2026-09-10', { 'L2C Lifecycle': ['3'] }),
    [row('other', '2026-09-11', { 'L2C Lifecycle': ['3'] })]
  )
  assert.strictEqual(result.overlapping.length, 1)
})

check('one field filled is not blank: it is compared on what it said', () => {
  // The distinction that decides whether "unknown" is a useful bucket or one
  // holding most of the database. A row with a Segment and no Lifecycle has
  // said something.
  const result = clash.clashes(
    row('new', '2026-09-10', { Segment: ['Enterprise'] }),
    [row('other', '2026-09-11', { Segment: ['Enterprise'] })]
  )
  assert.strictEqual(result.overlapping.length, 1)
  assert.strictEqual(result.unknown.length, 0)
})

check('a row saying nothing at all is unknown, not universal', () => {
  const result = clash.clashes(
    row('new', '2026-09-10', { Segment: ['Enterprise'] }),
    [row('quiet', '2026-09-11', {})]
  )
  assert.strictEqual(result.overlapping.length, 0)
  assert.strictEqual(result.unknown.length, 1)
  assert.ok(result.unknown[0].why.includes('does not say'))
})

check('both sides saying nothing is dropped entirely', () => {
  const result = clash.clashes(
    row('new', '2026-09-10', {}),
    [row('quiet', '2026-09-11', {})]
  )
  assert.strictEqual(result.overlapping.length, 0)
  assert.strictEqual(result.unknown.length, 0, 'two rows that both said nothing were reported as a possible overlap')
})

check('a proposed row still in the query shape is refused, not read as targeting nobody', () => {
  // THE SILENT FALSE NEGATIVE, ON THE SIDE NOBODY GUARDED. `normaliseRows`
  // parses the candidate rows and `judge` refuses ones parsed twice, but the
  // proposed row goes to `clashes` exactly as the caller built it. A
  // multi-select comes back from the query as a JSON array inside a string, and
  // `targetingValues` returned [] for anything that was not an array, so a
  // same-day same-segment clash reported `overlapping: 0` with the proposed row
  // in `unknown`, saying it had not said who it was aimed at when it had.
  //
  // REPRODUCED THROUGH THE CLI AGAINST FIXTURES on 2026-08-21. Nothing here has
  // been near a workspace: the false negative was reproduced that way and the
  // refusal that cures it is proved by this fixture and by mutation, not by a
  // live run.
  // Built raw rather than through `row`, which normalises: the case under test
  // is a caller who did NOT normalise, and the helper cannot express one.
  const proposed = { Name: 'new', url: urlFor('new'), date: { start: '2026-09-10' }, Segment: '["Enterprise"]' }
  const candidates = [row('existing', '2026-09-10', { Segment: ['Enterprise'] })]
  assert.throws(() => clash.clashes(proposed, candidates), /not a list/,
    'a row in the query shape was read as targeting nobody instead of being refused')
})

check('a list holding something that is not a name is refused, not filtered away', () => {
  // THE HALF THE ROUND 9 FIX LEFT OPEN. Refusing a non-array closed one door and
  // left the other: `.filter(v => typeof v === 'string')` quietly removed every
  // entry that was not a name, so a list of objects or numbers emptied itself
  // and the row read as targeting nobody. Verified against fixtures on
  // 2026-08-21, before this: a real same-day, same-segment clash reported
  // `overlapping: 0` for both shapes below. The candidate side already refused
  // them through `namesOnly`; the proposal side did not.
  const candidate = row('existing', '2026-09-10', { Segment: ['Enterprise'] })
  for (const bad of [[{ name: 'Enterprise' }], [1], ['']]) {
    const proposed = { Name: 'new', url: urlFor('new'), date: { start: '2026-09-10' }, Segment: bad }
    assert.throws(() => clash.clashes(proposed, [candidate]), /not a value name/,
      `${JSON.stringify(bad)} was filtered away instead of refused`)
  }
})

check('an absent targeting field is still a real answer, and does not throw', () => {
  // The refusal above must not swallow the case it sits next to. A row that
  // genuinely said nothing is information, and `unknown` is where it belongs.
  const result = clash.clashes(
    row('new', '2026-09-10', {}),
    [row('existing', '2026-09-10', { Segment: ['Enterprise'] })]
  )
  assert.strictEqual(result.unknown.length, 1)
  assert.strictEqual(result.overlapping.length, 0)
})

check('an empty targeting array is the same as an absent one', () => {
  const result = clash.clashes(
    row('new', '2026-09-10', { Segment: [] }),
    [row('quiet', '2026-09-11', { Segment: [], 'L2C Lifecycle': [] })]
  )
  assert.strictEqual(result.unknown.length, 0)
})

check('Audience is not treated as targeting', () => {
  // Audience records which internal teams need to know, which is a different
  // question. Counting it would surface two rows as competing because the same
  // internal team was told about both.
  const result = clash.clashes(
    row('new', '2026-09-10', { Audience: ['Sales'] }),
    [row('other', '2026-09-11', { Audience: ['Sales'] })]
  )
  assert.strictEqual(result.overlapping.length, 0)
  assert.strictEqual(result.unknown.length, 0)
})

// ------------------------------------------------------------- dates and zones

check('a date is read as a calendar day, not a moment', () => {
  assert.strictEqual(clash.dayNumber('2026-09-10'), clash.dayNumber('2026-09-10T17:30:00.000-04:00'))
})

check('a range recorded backwards is still read as a range', () => {
  assert.deepStrictEqual(
    clash.span({ start: '2026-09-20', end: '2026-09-15' }),
    clash.span({ start: '2026-09-15', end: '2026-09-20' })
  )
})

// --------------------------------------------------------------- duplicates

check('the same link is a duplicate whatever the dates say', () => {
  const found = clash.duplicates(
    { url: urlFor('new'), identity: pageIdentity(urlFor('new')), Name: 'Something', Link: 'https://example.com/thing', date: { start: '2026-09-10' } },
    [row('old', '2027-01-01', { Name: 'Different name entirely', Link: 'http://www.example.com/thing/' })]
  )
  assert.strictEqual(found.length, 1)
  assert.strictEqual(found[0].because, 'link')
})

check('a matching name on the same date is a duplicate', () => {
  const found = clash.duplicates(
    { url: urlFor('new'), identity: pageIdentity(urlFor('new')), Name: 'Q3 Launch', date: { start: '2026-09-10' } },
    [row('old', '2026-09-10', { Name: 'q3   launch ' })]
  )
  assert.strictEqual(found.length, 1)
  assert.strictEqual(found[0].because, 'name-and-date')
})

check('a matching name on a different date is NOT a duplicate', () => {
  // The monthly newsletter case. Flagging all twelve teaches people to click
  // through the warning, which is worse than not having it.
  const found = clash.duplicates(
    { url: urlFor('new'), identity: pageIdentity(urlFor('new')), Name: 'Monthly newsletter', date: { start: '2026-09-10' } },
    [row('old', '2026-08-10', { Name: 'Monthly newsletter' })]
  )
  assert.strictEqual(found.length, 0)
})

check('a matching name inside a range counts as the same date', () => {
  const found = clash.duplicates(
    { url: urlFor('new'), identity: pageIdentity(urlFor('new')), Name: 'Summit', date: { start: '2026-09-16' } },
    [row('old', { start: '2026-09-15', end: '2026-09-18' }, { Name: 'Summit' })]
  )
  assert.strictEqual(found.length, 1)
})

check('a matching name with no date is reported as the weaker thing it is', () => {
  const found = clash.duplicates(
    { url: urlFor('new'), identity: pageIdentity(urlFor('new')), Name: 'Customer dinner', date: { start: '2026-09-10' } },
    [row('old', null, { Name: 'Customer dinner' })]
  )
  assert.strictEqual(found.length, 1)
  assert.strictEqual(found[0].because, 'name-undated')
})

check('a row is never a duplicate of itself', () => {
  const found = clash.duplicates(
    { url: urlFor('same'), identity: pageIdentity(urlFor('same')), Name: 'Thing', Link: 'https://example.com/x', date: { start: '2026-09-10' } },
    [row('same', '2026-09-10', { Name: 'Thing', Link: 'https://example.com/x' })]
  )
  assert.strictEqual(found.length, 0)
})

check('a differing query string is not the same link', () => {
  // Deliberate: dropping the query would merge two genuinely different pages on
  // sites that route by parameter, and merging two real rows is the worse error.
  const found = clash.duplicates(
    { url: urlFor('new'), identity: pageIdentity(urlFor('new')), Name: 'A', Link: 'https://example.com/e?id=1', date: { start: '2026-09-10' } },
    [row('old', '2026-09-10', { Name: 'B', Link: 'https://example.com/e?id=2' })]
  )
  assert.strictEqual(found.length, 0)
})

// ------------------------------------------- identity, on the real row shape

check('self-exclusion fires on a url, which is what the query actually returns', () => {
  // The hole review found: this used to compare an `id` field that no query in
  // this plugin asks for, so on real rows the guard never fired and `update`
  // reported every moved date as clashing with the row being moved. Proved here
  // with url only, and no identity or id field at all.
  const url = urlFor('same')
  const result = clash.clashes(
    { url, Name: 'x', date: { start: '2026-09-10' }, Segment: ['Enterprise'] },
    [{ url, Name: 'x', date: { start: '2026-09-10' }, Segment: ['Enterprise'] }]
  )
  assert.strictEqual(result.overlapping.length, 0, 'a row was compared against itself')
})

check('the same page in two url spellings is still one row', () => {
  // Notion hands the same page back as a bare id, a dashed id and several url
  // shapes. A literal comparison says these are two rows.
  const bare = '00000000000000000000000000000abc'
  const result = clash.clashes(
    { url: `https://app.notion.com/${bare}`, date: { start: '2026-09-10' }, Segment: ['Enterprise'] },
    [{ url: `https://app.notion.com/p/${bare}`, date: { start: '2026-09-10' }, Segment: ['Enterprise'] }]
  )
  assert.strictEqual(result.overlapping.length, 0)
})

check('two different rows are still compared', () => {
  // The guard above must not swallow everything: a self-exclusion that matched
  // any two rows would produce a permanently clean calendar.
  const result = clash.clashes(
    { url: urlFor('a'), date: { start: '2026-09-10' }, Segment: ['Enterprise'] },
    [{ url: urlFor('b'), date: { start: '2026-09-10' }, Segment: ['Enterprise'] }]
  )
  assert.strictEqual(result.overlapping.length, 1)
})

check('a day that does not exist is refused rather than rolled forward', () => {
  // `Date.UTC(2026, 1, 31)` is 2026-03-03, so 2026-02-31 used to become a real
  // day three days later and every window and clash was then computed against a
  // date nobody wrote. The round trip is the check: a day that does not survive
  // it did not exist.
  for (const impossible of ['2026-02-31', '2026-13-01', '2025-02-29', '2026-04-31', '2026-00-10']) {
    assert.strictEqual(clash.dayNumber(impossible), null, `${impossible} was accepted as a real day`)
  }
  // Real days, including the leap day the rule must not eat.
  for (const real of ['2026-09-10', '2026-02-28', '2024-02-29', '2026-12-31', '2026-01-01']) {
    assert.notStrictEqual(clash.dayNumber(real), null, `${real} was refused`)
  }
})

check('an impossible date keeps a row out of the window rather than moving it', () => {
  // The consequence, which is why the parser matters: a row dated 2026-02-31
  // used to land in the window for early March.
  const proposed = { Name: 'A thing', Type: 'Event', Status: 'Confirmed', date: { start: '2026-03-03' } }
  const candidate = { url: 'https://app.notion.com/00000000000000000000000000000abc', identity: '00000000000000000000000000000abc', Name: 'Rolled forward', Type: 'Event', Status: 'Confirmed', date: { start: '2026-02-31' } }
  const result = clash.clashes(proposed, [candidate])
  assert.strictEqual(result.overlapping.length, 0, 'a row on a date that does not exist was placed in the window')
  assert.strictEqual(result.unknown.length, 1, 'the row was dropped rather than reported as unplaceable')
})

check('a row with no identifiable page is not excluded as a self-match', () => {
  // Two rows both lacking a usable identity must not read as the same row.
  const result = clash.clashes(
    { date: { start: '2026-09-10' }, Segment: ['Enterprise'] },
    [{ date: { start: '2026-09-11' }, Segment: ['Enterprise'] }]
  )
  assert.strictEqual(result.overlapping.length, 1)
})

/**
 * PROVED BY BREAKING, 2026-08-19, in `plugins/calendar/scripts/clash.js`:
 *
 *   WINDOW_DAYS 7 -> 0
 *     red: the motivating failure, seven days either side is inclusive
 *   `hasTargeting` some -> every
 *     red: one field filled is not blank
 *   dropping the both-blank guard
 *     red: both sides saying nothing is dropped entirely
 *   duplicates matching on name alone, without the date test
 *     red: a matching name on a different date is NOT a duplicate
 *   removing the self-comparison guard
 *     red: a row is never surfaced against itself, a row is never a duplicate of itself
 */

/**
 * PROVED BY BREAKING, 2026-08-19, after the helper was made to go through
 * `normaliseRows` rather than only claiming to:
 *
 *   normaliseRows dropping the end of a range
 *     red: a matching name inside a range counts as the same date
 *
 * That is the point of the change. Before it, nothing on this page could go red
 * for a change to how a row is normalised, because no row on this page had been.
 *
 * Round 5, 2026-08-19. Applied one at a time and read off the run.
 *
 *   the impossible-day round trip removed from dayNumber
 *     red: a day that does not exist is refused rather than rolled forward
 *     red: an impossible date keeps a row out of the window rather than moving it
 *   an unreadable date skipped again instead of reported as unplaceable
 *     red: an impossible date keeps a row out of the window rather than moving it
 *
 * The second one is worth reading twice. Refusing the impossible date was the
 * first fix, and on its own it turned a row placed on the wrong day into a row
 * that appeared nowhere at all while the check called itself complete. The fix
 * made a quieter version of the bug it cured, which is the failure this project
 * keeps repeating, and only the second check caught it.
 *
 * Round 9, 2026-08-21. Applied one at a time and read off the run.
 *
 *   targetingValues returning [] again for a value that is not a list
 *     red: a proposed row still in the query shape is refused, not read as
 *          targeting nobody
 *     still green: an absent targeting field is still a real answer. It is the
 *       guard against curing the silent drop by refusing the row that genuinely
 *       said nothing, which is the quieter version of this same bug and the one
 *       the round 5 note above warns about.
 */

console.log(failures ? `\n${failures} failed.\n` : `\nAll checks passed.\n`)
process.exit(failures ? 1 : 0)

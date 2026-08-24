'use strict'

/**
 * The memo builder: the shapes it refuses and the payloads it builds.
 *
 * Everything here is pure: `memo.js` sends nothing, so these tests hand it
 * rows and read what it says. The context is faked two ways, once with the
 * shipped names and once with everything renamed, because a payload that
 * only works when the workspace kept the shipped names is the silent failure
 * this repository keeps finding.
 *
 * Run: node tests/memos-memo.test.js
 */

const assert = require('assert')
const memo = require('../plugins/memos/scripts/memo')
const schema = require('../shared/memos-schema')

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

/** A context whose workspace kept the shipped names. */
const identity = {
  property: logical => logical,
  value: (property, logical) => logical,
  personId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
}

/** A context whose workspace renamed every property and every value. */
const renamed = {
  property: logical => `R ${logical}`,
  value: (property, logical) => `R ${logical}`,
  personId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
}

/** A context with no configured person, which is a working install. */
const nobody = {
  property: logical => logical,
  value: (property, logical) => logical,
  personId: null
}

const A_PAGE = 'https://www.notion.so/A-memo-0123456789abcdef0123456789abcdef'
const B_PAGE = 'https://www.notion.so/B-memo-fedcba9876543210fedcba9876543210'

/** A memo that passes every gate, to mutate one field at a time. */
const clean = overrides => Object.assign({
  Name: 'Pricing changes on the first',
  Description: 'what changes and for whom',
  Type: 'Memo',
  Domain: 'Deal Execution',
  Audience: ['Sales'],
  body: {
    Recommendation: 'Move list pricing on the first of the month.',
    'What It Changes': 'Every open quote issued after the first.',
    'Why This And Not The Alternative': 'Grandfathering forever was the alternative and it leaks.',
    'What I Need From You': 'A yes by Friday.'
  }
}, overrides)

const kinds = found => found.map(p => p.kind)

console.log('\nthe memo builder\n')

// ------------------------------------------------------------------- problems

check('a clean memo has no problems', () => {
  assert.deepStrictEqual(memo.problems(clean()), [])
})

check('missing and malformed names are different refusals', () => {
  assert.ok(kinds(memo.problems(clean({ Name: undefined }))).includes('missing'))
  assert.ok(kinds(memo.problems(clean({ Name: '   ' }))).includes('missing'))
  assert.ok(kinds(memo.problems(clean({ Name: { title: 'x' } }))).includes('not-text'))
})

check('an unknown type is refused by name', () => {
  const found = memo.problems(clean({ Type: 'Newsletter' }))
  assert.ok(kinds(found).includes('unknown-value'))
  assert.ok(found.some(p => p.field === 'Type'))
})

check('only Published is writable, and the refusal names both other statuses', () => {
  for (const status of ['Draft', 'Canceled', 'Active']) {
    const found = memo.problems(clean({ Status: status }))
    assert.ok(found.some(p => p.field === 'Status' && p.kind === 'not-writable'), `${status} was accepted`)
  }
  assert.deepStrictEqual(memo.problems(clean({ Status: 'Published' })), [])
})

check('a bare string to a multi-select is refused before Notion refuses it', () => {
  const found = memo.problems(clean({ Audience: 'Sales' }))
  assert.ok(kinds(found).includes('not-a-list'))
})

check('an invented select value is refused by name', () => {
  assert.ok(kinds(memo.problems(clean({ Domain: 'Invented' }))).includes('unknown-value'))
  assert.ok(kinds(memo.problems(clean({ Tags: ['AI', 'Invented'] }))).includes('unknown-value'))
})

check('a fourth tag is refused, because nothing downstream can watch the cap', () => {
  const found = memo.problems(clean({ Tags: ['AI', 'Data', 'Tools', 'Products'] }))
  assert.ok(kinds(found).includes('too-many'))
})

check('a published date that does not exist is refused, not rolled forward', () => {
  // Date.parse takes 2026-02-30 and hands back the 2nd of March, so the
  // round trip is what catches it.
  const found = memo.problems(clean({ 'Published date': '2026-02-30' }))
  assert.ok(kinds(found).includes('not-a-day'))
  assert.deepStrictEqual(memo.problems(clean({ 'Published date': '2026-02-28' })), [])
})

check('a Team Update requires Period covered, with both ends, the right way round', () => {
  const teamUpdate = period => clean({
    Type: 'Team Update',
    'Period covered': period,
    body: {
      TLDR: 'The week.',
      'What Shipped': 'One thing.',
      'What Is Still Open': 'Two things.',
      'Needs A Decision From You': 'Nothing this week.'
    }
  })
  assert.ok(kinds(memo.problems(teamUpdate(undefined))).includes('period-missing'))
  assert.ok(kinds(memo.problems(teamUpdate({ start: '2026-08-17' }))).includes('period-open'))
  assert.ok(kinds(memo.problems(teamUpdate({ start: '2026-08-23', end: '2026-08-17' }))).includes('period-backwards'))
  assert.ok(kinds(memo.problems(teamUpdate({ start: '2026-02-30', end: '2026-03-05' }))).includes('not-a-day'))
  assert.deepStrictEqual(memo.problems(teamUpdate({ start: '2026-08-17', end: '2026-08-23' })), [])
})

check('Period covered on any other type is refused rather than dropped', () => {
  const found = memo.problems(clean({ 'Period covered': { start: '2026-08-17', end: '2026-08-23' } }))
  assert.ok(kinds(found).includes('period-wrong-type'))
})

check('a correction names exactly one identifiable memo', () => {
  assert.deepStrictEqual(memo.problems(clean({ Corrects: A_PAGE })), [])
  assert.deepStrictEqual(memo.problems(clean({ Corrects: [A_PAGE] })), [])
  assert.ok(kinds(memo.problems(clean({ Corrects: [A_PAGE, B_PAGE] }))).includes('corrects-several'))
  assert.ok(kinds(memo.problems(clean({ Corrects: 'the memo from Tuesday' }))).includes('corrects-unidentifiable'))
})

check('a body that is not a section map is refused rather than read as empty', () => {
  const found = memo.problems(clean({ body: 'Recommendation: move pricing' }))
  assert.ok(kinds(found).includes('not-a-section-map'))
})

check('a required section left empty is refused, a conditional one is not', () => {
  const body = clean().body
  delete body.Recommendation
  const found = memo.problems(clean({ body }))
  assert.ok(found.some(p => p.field === 'Recommendation' && p.kind === 'section-missing'))
  // Sources is conditional on a Memo and absent throughout these fixtures.
  assert.ok(!found.some(p => p.field === 'Sources'))
})

check('a source with no name or no contribution line is refused', () => {
  assert.ok(kinds(memo.problems(clean({ sources: 'the deck' }))).includes('not-a-list'))
  assert.ok(kinds(memo.problems(clean({ sources: [{ contributed: 'numbers' }] }))).includes('source-unnamed'))
  assert.ok(kinds(memo.problems(clean({ sources: [{ what: 'the deck' }] }))).includes('source-uncontributed'))
  assert.deepStrictEqual(memo.problems(clean({ sources: [{ what: 'the deck', contributed: 'numbers' }] })), [])
})

// ------------------------------------------------------------------- concerns

check('the ceiling is a concern and not a refusal', () => {
  const long = 'word '.repeat(schema.WORD_CEILING + 1).trim()
  const over = clean({ body: Object.assign(clean().body, { Recommendation: long }) })
  assert.deepStrictEqual(memo.problems(over), [])
  const raised = memo.concerns(over)
  assert.strictEqual(raised.length, 1)
  assert.strictEqual(raised[0].kind, 'over-ceiling')
  assert.deepStrictEqual(memo.concerns(clean()), [])
})

// ----------------------------------------------------------------- properties

check('the payload writes Published, the stamp, and both date columns', () => {
  const out = memo.properties(identity, clean(), { today: '2026-08-24' })
  assert.strictEqual(out.Status, 'Published')
  assert.strictEqual(out['date:Published date:start'], '2026-08-24')
  assert.strictEqual(out['date:Published date:end'], null,
    'the end column has to be written as null: omitting it leaves a stale end behind')
  assert.strictEqual(out.Name, 'Pricing changes on the first')
  assert.strictEqual(out.Domain, 'Deal Execution')
  assert.deepStrictEqual(out.Audience, ['Sales'])
})

check('a supplied published date beats today, so a memo can be dated to when it was said', () => {
  const out = memo.properties(identity, clean({ 'Published date': '2026-08-20' }), { today: '2026-08-24' })
  assert.strictEqual(out['date:Published date:start'], '2026-08-20')
})

check('every property and value goes out under the workspace\'s own names', () => {
  const out = memo.properties(renamed, clean(), { today: '2026-08-24' })
  assert.strictEqual(out['R Status'], 'R Published')
  assert.strictEqual(out['R Name'], 'Pricing changes on the first')
  assert.strictEqual(out['R Domain'], 'R Deal Execution')
  assert.deepStrictEqual(out['R Audience'], ['R Sales'])
  assert.strictEqual(out['date:R Published date:start'], '2026-08-24')
  assert.ok(!('Status' in out), 'a shipped name leaked into a renamed payload')
})

check('a Team Update writes Period covered through its date columns', () => {
  const out = memo.properties(identity, clean({
    Type: 'Team Update',
    'Period covered': { start: '2026-08-17', end: '2026-08-23' },
    body: {
      TLDR: 'The week.',
      'What Shipped': 'One thing.',
      'What Is Still Open': 'Two things.',
      'Needs A Decision From You': 'Nothing this week.'
    }
  }), { today: '2026-08-24' })
  assert.strictEqual(out['date:Period covered:start'], '2026-08-17')
  assert.strictEqual(out['date:Period covered:end'], '2026-08-23')
})

check('the author defaults to the configured person and honours the three askings', () => {
  const id = identity.personId
  assert.deepStrictEqual(memo.properties(identity, clean(), { today: '2026-08-24' }).Author, [id])
  assert.deepStrictEqual(memo.properties(identity, clean({ Author: 'me' }), { today: '2026-08-24' }).Author, [id])
  const other = '11111111-2222-3333-4444-555555555555'
  assert.deepStrictEqual(memo.properties(identity, clean({ Author: [other] }), { today: '2026-08-24' }).Author, [other])
  // A prefixed id is what a caller holds after fetching a row; the bare id is
  // what gets written. Measured 2026-08-20.
  assert.deepStrictEqual(memo.properties(identity, clean({ Author: [`user://${other}`] }), { today: '2026-08-24' }).Author, [other])
})

check('asking for no author, and having no person configured, both omit the property', () => {
  assert.ok(!('Author' in memo.properties(identity, clean({ Author: [] }), { today: '2026-08-24' })))
  assert.ok(!('Author' in memo.properties(identity, clean({ Author: '[]' }), { today: '2026-08-24' })))
  assert.ok(!('Author' in memo.properties(nobody, clean(), { today: '2026-08-24' })))
})

check('an author that is a name and not an id is refused', () => {
  assert.throws(
    () => memo.properties(identity, clean({ Author: ['Priya'] }), { today: '2026-08-24' }),
    /not a Notion person id/
  )
})

check('no relation ever reaches the payload', () => {
  const out = memo.properties(identity, clean({ Corrects: A_PAGE }), { today: '2026-08-24' })
  for (const name of ['Corrects', 'Artifacts', 'Projects', 'Corrected by']) {
    assert.ok(!(name in out), `${name} is in the payload, and no relation write has been measured on this surface`)
  }
})

check('a memo with problems cannot be built into a payload', () => {
  assert.throws(() => memo.properties(identity, clean({ Type: 'Newsletter' }), { today: '2026-08-24' }), /cannot be written yet/)
})

// ----------------------------------------------------------------------- body

check('the body keeps section order and omits an empty conditional section', () => {
  const built = memo.body(clean())
  assert.deepStrictEqual(built.map(s => s.heading), [
    'Recommendation', 'What It Changes', 'Why This And Not The Alternative', 'What I Need From You'
  ])
})

check('the Sources section is generated from the record, and comes last', () => {
  const withSources = clean({ sources: [{ what: 'the deck', contributed: 'numbers' }] })
  const built = memo.body(withSources)
  assert.strictEqual(built[built.length - 1].heading, 'Sources')
  assert.strictEqual(built[built.length - 1].text, '- the deck: numbers')
  assert.ok(memo.expectedHeadings(withSources).includes('Sources'))
})

check('a hand-written Sources section with no record behind it is refused', () => {
  // The section is an unchecked claim without the structured list, and the
  // skill promises the script refuses a source with no line of context. That
  // promise only holds if this is the one path to the section. Found by
  // review on round 1: the list was validated and then dropped, while the
  // text a reader sees went out unchecked.
  const found = memo.problems(clean({ body: Object.assign(clean().body, { Sources: '- the deck: numbers' }) }))
  assert.ok(kinds(found).includes('sources-hand-written'))
})

check('a Sources section that disagrees with the record is refused, a copy of it is not', () => {
  const record = [{ what: 'the deck', contributed: 'numbers' }]
  const disagreeing = clean({
    sources: record,
    body: Object.assign(clean().body, { Sources: '- a different deck: vibes' })
  })
  assert.ok(kinds(memo.problems(disagreeing)).includes('sources-disagree'))

  const copying = clean({
    sources: record,
    body: Object.assign(clean().body, { Sources: '- the deck: numbers' })
  })
  assert.deepStrictEqual(memo.problems(copying), [])
})

check('sources on a type whose template has no Sources section are refused, not dropped', () => {
  const found = memo.problems(clean({
    Type: 'Incident Report',
    sources: [{ what: 'the pager log', contributed: 'the timeline' }],
    body: {
      Impact: 'Everyone, for an hour.',
      'What Happened': 'The sync stopped.',
      Timeline: 'Started 09:00, noticed 09:40, fixed 10:00.',
      'Why It Happened': 'The token expired and nothing watched it.',
      'What Changed': 'The token is monitored now.'
    }
  }))
  assert.ok(kinds(found).includes('sources-no-section'))
})

check('the headings the proof expects are the sections the body writes', () => {
  assert.deepStrictEqual(memo.expectedHeadings(clean()), memo.body(clean()).map(s => s.heading))
})

check('an unknown type has no template and says so', () => {
  assert.throws(() => memo.body({ Type: 'Newsletter', body: {} }), /No template/)
})

console.log(failures ? `\n${failures} failed.\n` : '\nAll passed.\n')
process.exit(failures ? 1 : 0)

'use strict'

/**
 * Tests for the view compiler and the view verifier.
 *
 * These exist because of a measurement on 2026-08-18 that was worse than the
 * one that started this plugin. `FILTER "Date" > "today"` was accepted by
 * Notion, stored, and read back looking exactly like a working filter. It
 * matched no rows at all. A row dated four months in the future did not appear,
 * and the identical view with an ISO date returned it.
 *
 * So there are two jobs here. Refuse to send a filter that cannot work, which
 * is the ISO date guard and the operator list. And be honest about what reading
 * a view back can and cannot prove, which is why `verifyView` is tested
 * alongside a note that it cannot catch a filter matching nothing.
 *
 * Run: node tests/views.test.js
 */

const path = require('path')
const assert = require('assert')

const ROOT = path.join(__dirname, '..')
const views = require(path.join(ROOT, 'plugins/setup/scripts/views.js'))
const { VIEWS } = require(path.join(ROOT, 'plugins/setup/scripts/manifest.js'))

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

const find = (database, name) => VIEWS.find(v => v.database === database && v.name === name)

console.log('\nthe view compiler and what it refuses\n')

check('every view in the manifest compiles', () => {
  const problems = views.validate()
  assert.strictEqual(problems.length, 0, problems.join('\n'))
})

check('a filter compiles to the DSL that was measured working', () => {
  // This exact string was sent to a live workspace on 2026-08-18 and the view
  // it made returned exactly the one row breaking the rule.
  assert.strictEqual(
    views.configureFor(find('calendar', 'Needs attention')),
    'FILTER "Status" IN ("Confirmed", "Done") AND "Date" IS EMPTY; SORT BY "Name" ASC'
  )
})

check('a relation filter compiles, and it is one phase B creates', () => {
  assert.strictEqual(
    views.configureFor(find('projects', 'Needs attention')),
    'FILTER "Memos" IS EMPTY; SORT BY "Name" ASC'
  )
})

check('a relative date is refused rather than sent', () => {
  const broken = { ...find('calendar', 'Upcoming'), filter: [{ property: 'Date', op: '=', value: 'today' }] }
  assert.throws(() => views.configureFor(broken), /not an ISO date/,
    'the compiler let "today" through, which Notion accepts and then matches nothing with')
})

check('the refusal says why, because the reason is not guessable', () => {
  const broken = { ...find('calendar', 'Upcoming'), filter: [{ property: 'Date', op: '=', value: 'next month' }] }
  assert.throws(() => views.configureFor(broken), /matches no row at all/)
})

check('an ISO date is allowed, so the guard is about the shape and not about dates', () => {
  const fine = { ...find('calendar', 'Upcoming'), filter: [{ property: 'Date', op: '=', value: '2026-08-18' }] }
  assert.ok(views.configureFor(fine).includes('"Date" = "2026-08-18"'))
})

check('an unmeasured operator is refused', () => {
  const broken = { ...find('calendar', 'Undated'), filter: [{ property: 'Status', op: 'CONTAINS', value: 'Idea' }] }
  assert.throws(() => views.configureFor(broken), /is not one this plugin emits/)
})

check('a property the database does not have is caught before it is sent', () => {
  const broken = { ...find('calendar', 'Undated'), filter: [{ property: 'Nonexistent', op: 'IS EMPTY' }] }
  assert.throws(() => views.configureFor(broken), /which that database does not have/)
})

check('a sort on a property the database does not have is caught too', () => {
  const broken = { ...find('calendar', 'Undated'), sort: [{ property: 'Nonexistent', direction: 'ASC' }] }
  assert.throws(() => views.configureFor(broken), /which that database does not have/)
})

console.log('\nverifyView catches what it claims to catch\n')

// What Notion actually returned for this view on 2026-08-18, transcribed.
const asNotionReturnedIt = () => ({
  name: 'Needs attention',
  type: 'table',
  dataSourceUrl: 'collection://00000000-0000-4000-8000-0000calendr',
  advancedFilter: {
    type: 'group',
    operator: 'and',
    filters: [
      { type: 'group', operator: 'or', filters: [
        { type: 'property', property: 'Status', propertyType: 'select', operator: 'enum_is', value: { type: 'exact', value: 'Confirmed' } },
        { type: 'property', property: 'Status', propertyType: 'select', operator: 'enum_is', value: { type: 'exact', value: 'Done' } }
      ] },
      { type: 'group', operator: 'and', filters: [
        { type: 'property', property: 'Date', propertyType: 'date', operator: 'is_empty' }
      ] }
    ]
  },
  sorts: [{ property: 'Name', direction: 'ascending' }]
})

const complains = (actual, mustMention, view = find('calendar', 'Needs attention')) => {
  const problems = views.verifyView(view, actual)
  assert.ok(problems.length > 0, `verifyView passed something it should have caught (expected a complaint about ${mustMention})`)
  assert.ok(problems.join('\n').includes(mustMention),
    `complained about the wrong thing.\n  wanted: ${mustMention}\n  got:\n${problems.join('\n')}`)
}

check('the view Notion really returned passes', () => {
  const problems = views.verifyView(find('calendar', 'Needs attention'), asNotionReturnedIt())
  assert.strictEqual(problems.length, 0, problems.join('\n'))
})

check('a silently discarded filter is caught', () => {
  // The 2026-08-17 rollup failure, exactly: created, reported as created, and
  // the filter came back empty.
  const broken = asNotionReturnedIt()
  broken.advancedFilter = { type: 'group', operator: 'and', filters: [] }
  complains(broken, 'silently discarded')
})

check('a filter that came back different is caught', () => {
  const broken = asNotionReturnedIt()
  broken.advancedFilter.filters[0].filters[1].value.value = 'Canceled'
  complains(broken, 'not the one that was asked for')
})

check('a missing clause is caught, not averaged out', () => {
  const broken = asNotionReturnedIt()
  broken.advancedFilter.filters.pop()
  complains(broken, 'not the one that was asked for')
})

check('the wrong layout is caught', () => {
  const broken = asNotionReturnedIt()
  broken.type = 'board'
  complains(broken, 'expected a table view')
})

check('a dropped sort is caught', () => {
  const broken = asNotionReturnedIt()
  delete broken.sorts
  complains(broken, 'sorts differ')
})

check('a view that is not there at all is caught', () => {
  complains(undefined, 'not found on the database')
})

check('a calendar view is checked for the property it runs on', () => {
  const calendar = find('calendar', 'Calendar')
  const problems = views.verifyView(calendar, { name: 'Calendar', type: 'calendar', calendarBy: 'Created time' })
  assert.ok(problems.join('\n').includes('expected the calendar to run on "Date"'))
})

check('the nesting Notion chooses does not matter, only the filter does', () => {
  // Measured 2026-08-18: one clause comes back sitting directly in the top
  // group, two come back wrapped in a sub-group each. A verifier that insisted
  // on the shape would call a correct view broken.
  const flat = {
    name: 'Needs attention',
    type: 'table',
    advancedFilter: {
      type: 'group',
      operator: 'and',
      filters: [{ type: 'property', property: 'Memos', propertyType: 'relation', operator: 'is_empty' }]
    },
    sorts: [{ property: 'Name', direction: 'ascending' }]
  }
  const problems = views.verifyView(find('projects', 'Needs attention'), flat)
  assert.strictEqual(problems.length, 0, problems.join('\n'))
})

console.log('\nthe SQL that proves a view by its rows\n')

check('a date property is queried by its start column, not by its own name', () => {
  // Notion does not expose a date property under its own name in SQL. It
  // exposes date:<name>:start, which the SQLite table definition shows.
  assert.ok(views.expectedRows(find('calendar', 'Needs attention')).includes('"date:Date:start"'))
})

check('the rule query and the view filter name the same values', () => {
  const sql = views.expectedRows(find('calendar', 'Undated'))
  assert.ok(sql.includes("'Idea', 'Planned'"), sql)
})

check('a view with no filter has no rule query, rather than a query matching everything', () => {
  assert.strictEqual(views.expectedRows(find('calendar', 'Calendar')), null)
})

console.log('\nthe structure and the grouping, which the flat signature threw away\n')

const fixture = require(path.join(ROOT, 'tests/fixtures/full-install-as-notion-returned-it.json'))
const asReturned = (database, name) => JSON.parse(JSON.stringify(
  fixture.databases[database].views.find(v => v.name === name)
))

check('every filter in the real read-back still passes, bar one dated exception', () => {
  // The guard against the new check being stricter than Notion. If this fails,
  // the verifier is calling a correct install broken, which is how a verifier
  // gets switched off.
  //
  // The exception is not a loosening. The fixture records an install built when
  // Projects / Needs attention filtered on `Problem Statement`, a relation
  // dropped on 2026-08-18, so that one view is expected to disagree and the
  // disagreement is asserted rather than skipped. Re-record the fixture and this
  // whole check goes back to no exceptions.
  for (const view of VIEWS) {
    const actual = asReturned(view.database, view.name)
    const problems = views.verifyView(view, actual)
    if (view.database === 'projects' && view.name === 'Needs attention') {
      assert.strictEqual(problems.length, 1, problems.join('\n'))
      assert.ok(problems[0].includes('wanted: Memos (relation) is_empty'), problems[0])
      assert.ok(problems[0].includes('got:    Problem Statement (relation) is_empty'), problems[0])
      continue
    }
    assert.deepStrictEqual(problems, [], `${view.database} / ${view.name}`)
  }
})

check('an OR sitting where an AND was asked for is caught', () => {
  // It used to pass. The signature was a sorted flat list, so a view showing
  // rows matching ANY clause was indistinguishable from one showing rows
  // matching ALL of them.
  const view = find('calendar', 'Undated')
  const actual = asReturned('calendar', 'Undated')
  actual.advancedFilter.operator = 'or'
  assert.ok(views.verifyView(view, actual).join('\n').includes('not the one that was asked for'))
})

check('the same filter on a different property type is caught', () => {
  const view = find('calendar', 'Undated')
  const actual = asReturned('calendar', 'Undated')
  actual.advancedFilter.filters[1].filters[0].propertyType = 'rich_text'
  assert.ok(views.verifyView(view, actual).join('\n').includes('not the one that was asked for'))
})

check('a silently dropped GROUP BY is caught', () => {
  // GROUP BY was emitted and never read back, so a view could lose its
  // grouping the same way a filter can and nothing would say so.
  const view = find('calendar', 'In market')
  const actual = asReturned('calendar', 'In market')
  actual.groupBy = null
  assert.ok(views.verifyView(view, actual).join('\n').includes('expected it to be grouped by "Type"'))
})

check('grouping on the right property but the wrong type is caught', () => {
  const view = find('calendar', 'In market')
  const actual = asReturned('calendar', 'In market')
  actual.groupBy.propertyType = 'rich_text'
  assert.ok(views.verifyView(view, actual).join('\n').includes('grouped by "Type"'))
})

check('grouping nobody asked for is caught', () => {
  const view = find('calendar', 'Upcoming')
  const actual = asReturned('calendar', 'Upcoming')
  actual.groupBy = { property: 'Status', propertyType: 'select' }
  assert.ok(views.verifyView(view, actual).join('\n').includes('no grouping was asked for'))
})

check('an unmeasured operator is not in the whitelist', () => {
  // IS NOT EMPTY sat in the measured-only list marked "not measured", which is
  // an assumption inside the one guard whose job is to keep assumptions out.
  assert.ok(!('IS NOT EMPTY' in views.OPS), Object.keys(views.OPS).join(', '))
  for (const [name, op] of Object.entries(views.OPS)) {
    assert.ok(!/not measured/.test(op.measured), `${name} is in the whitelist and says it was not measured`)
  }
})

console.log('\nthe rule query proves rows by identity, not by what they are called\n')

check('the rule query selects the page url, not the title', () => {
  // Titles are not unique, and the separator the caller joins on can appear in
  // one.
  const sql = views.expectedRows(find('projects', 'Needs attention'))
  assert.ok(/^SELECT url FROM/.test(sql), sql)
})

check('a url, a dashed id and a bare id all name the same row', () => {
  const bare = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1'
  assert.strictEqual(views.pageIdentity(`https://www.notion.so/A-Title-${bare}`), bare)
  assert.strictEqual(views.pageIdentity('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'), bare)
  assert.strictEqual(views.pageIdentity(bare.toUpperCase()), bare)
  assert.strictEqual(views.pageIdentity(`https://www.notion.so/A-Title-${bare}?pvs=4`), bare)
})

check('the two halves of the proof come back in different url shapes, and still match', () => {
  // Measured 2026-08-18 against the live test workspace, on Calendar / Upcoming.
  // The SQL half returns https://app.notion.com/<id> and the view half returns
  // https://app.notion.com/p/<id>. Same three pages, two notations. Comparing
  // the strings as they arrive would have reported every row as different.
  //
  // The ids are placeholders, the same convention the fixture uses and for the
  // same reason: the real ones point at pages in a private workspace and this
  // repository is public. The url SHAPES are exactly as measured, which is the
  // whole of what this test is about.
  const fromSql = [
    'https://app.notion.com/ca1e0da40000000000000000000000a1',
    'https://app.notion.com/ca1e0da40000000000000000000000a2',
    'https://app.notion.com/ca1e0da40000000000000000000000a3'
  ]
  const fromView = [
    'https://app.notion.com/p/ca1e0da40000000000000000000000a3',
    'https://app.notion.com/p/ca1e0da40000000000000000000000a1',
    'https://app.notion.com/p/ca1e0da40000000000000000000000a2'
  ]
  assert.notStrictEqual(fromSql[0], fromView[1], 'the shapes really do differ')
  assert.deepStrictEqual(
    fromSql.map(views.pageIdentity).sort(),
    fromView.map(views.pageIdentity).sort()
  )
})

check('something that is not a page reference is refused, not handed back', () => {
  // It used to be handed back unchanged, which is why two lists of titles
  // matched each other and the view was reported proved.
  assert.strictEqual(views.pageIdentity('Confirmed with no date'), null)
  assert.strictEqual(views.pageIdentity('alpha | beta'), null)
  assert.strictEqual(views.pageIdentity(''), null)
  assert.strictEqual(views.pageIdentity(null), null)
  assert.strictEqual(views.pageIdentity(42), null)
})

check('a trailing slash and a query string do not change the row', () => {
  const bare = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1'
  assert.strictEqual(views.pageIdentity(`https://app.notion.com/p/${bare}/`), bare)
  assert.strictEqual(views.pageIdentity(`https://app.notion.com/p/${bare}?pvs=4`), bare)
})

check('a clause Notion returns in a shape this does not model is caught, not dropped', () => {
  // It used to be dropped. The group was then left with one child, the
  // one-child collapse turned the group into that child, and a filter doing
  // something else compared equal to the one asked for.
  const view = find('projects', 'Needs attention')
  const withExtra = {
    name: 'Needs attention',
    type: 'table',
    sorts: [{ property: 'Name', direction: 'ascending' }],
    advancedFilter: {
      type: 'group',
      operator: 'and',
      filters: [
        { type: 'property', property: 'Memos', propertyType: 'relation', operator: 'is_empty' },
        { type: 'timestamp', timestamp: 'created_time', operator: 'after', value: { value: '2026-01-01' } }
      ]
    }
  }
  const problems = views.verifyView(view, withExtra)
  assert.ok(problems.join('\n').includes('not the one that was asked for'), problems.join('\n'))
  assert.ok(problems.join('\n').includes('timestamp'), problems.join('\n'))
})

check('a filter that came back empty still reads as discarded, not as unrecognised', () => {
  // Measured 2026-08-17: a rollup filter came back as filters: []. That is a
  // real case and has to keep its own wording, so the fix above must not
  // swallow it.
  const view = find('projects', 'Needs attention')
  const discarded = {
    name: 'Needs attention',
    type: 'table',
    sorts: [{ property: 'Name', direction: 'ascending' }],
    advancedFilter: { type: 'group', operator: 'and', filters: [] }
  }
  assert.ok(views.verifyView(view, discarded).join('\n').includes('silently discarded'))
})

console.log(failures ? `\n${failures} failed.\n` : `\nAll checks passed. ${VIEWS.length} views.\n`)
process.exit(failures ? 1 : 0)

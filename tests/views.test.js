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
    'FILTER "Problem Statement" IS EMPTY; SORT BY "Name" ASC'
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
      filters: [{ type: 'property', property: 'Problem Statement', propertyType: 'relation', operator: 'is_empty' }]
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

console.log(failures ? `\n${failures} failed.\n` : `\nAll checks passed. ${VIEWS.length} views.\n`)
process.exit(failures ? 1 : 0)

'use strict'

/**
 * The Calendar facts the writer carries agree with the ones the builder uses.
 *
 * `plugins/setup/scripts/schema.js` is what `setup` builds the database from.
 * `shared/calendar-schema.js` is what a writing plugin carries, because an
 * installed plugin cannot reach `setup`'s files. Two files, one database.
 *
 * If they disagree, `calendar` writes a value the database does not have, and
 * Notion rejects the whole write with a 400. That failure is loud, which is the
 * good case. The quiet one is the rules: the statuses that require a date exist
 * in `manifest.js` as a view filter and in `shared/calendar-schema.js` as a
 * list, and those disagreeing produces a plugin that enforces one rule while
 * Notion reports another, with nothing failing anywhere.
 *
 * That is not hypothetical. It is exactly what was found on 2026-08-19:
 * `SCHEMA-calendar.md` said a date was required "from `Confirmed` onwards" and
 * `manifest.js` had already excluded `Canceled`. Both were approved. This test
 * is the thing that would have caught it.
 *
 * Run: node tests/calendar-schema-agrees.test.js
 */

const assert = require('assert')

const setupSchema = require('../plugins/setup/scripts/schema')
const manifest = require('../plugins/setup/scripts/manifest')
const shared = require('../shared/calendar-schema')

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

console.log('\nthe shared Calendar schema agrees with what setup builds\n')

const built = setupSchema.DATABASES ? setupSchema.DATABASES.calendar : null
const definition = built || (setupSchema.definitionFor && setupSchema.definitionFor('calendar'))

check('setup has a Calendar definition to compare against', () => {
  assert.ok(definition, 'could not reach setup\'s calendar schema, so this test proves nothing')
  assert.ok(Array.isArray(definition.properties) && definition.properties.length, 'the calendar definition has no properties')
})

const propertyNamed = name => definition.properties.find(p => p.name === name)
const optionsOf = name => {
  const property = propertyNamed(name)
  if (!property || !Array.isArray(property.options)) return null
  // Options are [value, colour] pairs in setup's schema.
  return property.options.map(o => (Array.isArray(o) ? o[0] : o))
}

// --------------------------------------------------------------- value lists

check('the type list matches, in the same order', () => {
  assert.deepStrictEqual(
    shared.TYPES,
    optionsOf('Type'),
    'the shared type list and the one setup creates are not the same list. A value here that setup never created is a 400 on the first write.'
  )
})

check('the status list matches, in the same order', () => {
  assert.deepStrictEqual(shared.STATUSES, optionsOf('Status'))
})

// Order is asserted as well as membership, and deliberately. Option order is
// what a user sees in the dropdown, and `SCHEMA-calendar.md` sets it on purpose:
// types heaviest first, statuses in lifecycle order.

// ------------------------------------------------------------- field names

for (const field of [].concat(shared.EVENT_ONLY, shared.NOT_FOR_EVENTS, shared.PERSON_FIELDS)) {
  check(`"${field}" is a property setup actually creates`, () => {
    assert.ok(
      propertyNamed(field),
      `the shared schema names "${field}" and setup creates no such property, so every rule about it is about nothing`
    )
  })
}

check('the person fields are the properties setup made person-typed', () => {
  const personProperties = definition.properties.filter(p => p.type === 'person').map(p => p.name)
  assert.deepStrictEqual(
    shared.PERSON_FIELDS.slice().sort(),
    personProperties.slice().sort(),
    'the fields the writer treats as people and the ones setup created as people are not the same set'
  )
})

// ------------------------------------------------- the rule Notion cannot hold

const needsAttention = manifest.VIEWS.find(v => v.database === 'calendar' && v.name === 'Needs attention')

check('the Needs attention view exists to enforce the date rule', () => {
  assert.ok(needsAttention, 'no Needs attention view on calendar, so the date rule is caught nowhere')
})

check('the statuses that require a date match the view that catches them', () => {
  const statusFilter = needsAttention.filter.find(f => f.property === 'Status')
  assert.ok(statusFilter, 'the Needs attention view does not filter on Status')
  assert.deepStrictEqual(
    shared.DATE_REQUIRED_AT.slice().sort(),
    statusFilter.values.slice().sort(),
    'the writer requires a date at different statuses than the view reports on. ' +
    'One of them is wrong, and neither would fail: the plugin would refuse a row Notion is happy with, or accept one the view flags.'
  )
})

check('Canceled does not require a date', () => {
  // Named on its own rather than left to the list comparison, because it is the
  // specific disagreement review found on 2026-08-19 and a regression here would
  // otherwise read as a list that changed for some other reason.
  assert.ok(
    !shared.DATE_REQUIRED_AT.includes('Canceled'),
    'Canceled is back in the date rule. A canceled row promises nothing, so requiring a date reports a row that is not broken.'
  )
})

check('the Undated view covers the statuses that may have no date', () => {
  const undated = manifest.VIEWS.find(v => v.database === 'calendar' && v.name === 'Undated')
  assert.ok(undated, 'no Undated view on calendar')
  const statusFilter = undated.filter.find(f => f.property === 'Status')
  for (const status of statusFilter.values) {
    assert.ok(
      shared.DATE_OPTIONAL_AT.includes(status),
      `the Undated view collects "${status}" rows with no date, and the writer requires a date at that status. The view is showing rows the plugin would refuse to create.`
    )
  }
})

// ------------------------------------------------------------- body sections

check('the required body sections are the unconditional ones', () => {
  assert.deepStrictEqual(
    shared.REQUIRED_SECTIONS,
    shared.BODY_SECTIONS.filter(s => !s.conditional).map(s => s.heading),
    'REQUIRED_SECTIONS was written out rather than derived, and it has drifted from BODY_SECTIONS'
  )
})

check('the debrief section is one of the body sections', () => {
  assert.ok(
    shared.BODY_SECTIONS.some(s => s.heading === shared.DEBRIEF.section),
    `the debrief writes to "${shared.DEBRIEF.section}" and no such section exists in the template`
  )
})

check('the status that triggers the debrief is a real status', () => {
  assert.ok(shared.STATUSES.includes(shared.DEBRIEF.triggeredBy))
})

console.log(failures ? `\n${failures} failed.\n` : `\nAll checks passed.\n`)
process.exit(failures ? 1 : 0)

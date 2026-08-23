'use strict'

/**
 * The Process facts the writer carries agree with the ones the builder uses.
 *
 * `plugins/setup/scripts/schema.js` is what `setup` builds the database from.
 * `shared/process-schema.js` is what a writing plugin carries, because an
 * installed plugin cannot reach `setup`'s files. Two files, one database.
 *
 * If they disagree the loud case is a 400 on the first write, because Notion
 * refuses a select value the property does not have. The quiet case is the
 * rules, and it is the one worth a test: the Tags cap and the parent-type rule
 * live in `manifest.js` as things `setup:check` reports, and in
 * `shared/process-schema.js` as things a writer refuses. Those disagreeing
 * produces a plugin that enforces one number while `check` reports another, with
 * nothing failing anywhere.
 *
 * WHAT THIS TEST CANNOT DO. It compares this checkout against itself. An
 * installed `setup` and an installed `process` are separate releases updated
 * separately, and nothing here can reach them. `configVersion` in
 * `shared/config-read.js` is what covers that gap.
 *
 * Run: node tests/process-schema-agrees.test.js
 */

const assert = require('assert')
const fs = require('fs')
const path = require('path')

const setupSchema = require('../plugins/setup/scripts/schema')
const manifest = require('../plugins/setup/scripts/manifest')
const shared = require('../shared/process-schema')

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

console.log('\nthe shared Process schema agrees with what setup builds\n')

const definition = setupSchema.DATABASES ? setupSchema.DATABASES.process : null

check('setup has a Process definition to compare against', () => {
  assert.ok(definition, 'could not reach setup\'s process schema, so this test proves nothing')
  assert.ok(
    Array.isArray(definition.properties) && definition.properties.length,
    'the process definition has no properties'
  )
})

const propertyNamed = name => definition.properties.find(p => p.name === name)
const optionsOf = name => {
  const property = propertyNamed(name)
  if (!property || !Array.isArray(property.options)) return null
  // Options are [value, colour] pairs in setup's schema.
  return property.options.map(o => (Array.isArray(o) ? o[0] : o))
}

// --------------------------------------------------------------- value lists

const lists = [
  ['type', 'TYPES', 'Type'],
  ['status', 'STATUSES', 'Status'],
  ['domain', 'DOMAINS', 'Domain'],
  ['audience', 'AUDIENCES', 'Audience'],
  ['segment', 'SEGMENTS', 'Segment'],
  ['L2C lifecycle', 'L2C', 'L2C Lifecycle'],
  ['tag', 'TAGS', 'Tags'],
  ['review cadence', 'CADENCES', 'Review cadence']
]

for (const [label, exported, property] of lists) {
  check(`the ${label} list matches, in the same order`, () => {
    assert.deepStrictEqual(
      shared[exported],
      optionsOf(property),
      `the shared ${label} list and the one setup creates are not the same list. ` +
      'A value here that setup never created is a 400 on the first write, and the whole page is lost.'
    )
  })
}

// ------------------------------------------------------------ the name contract

check('IDENTITY equals what setup would record, in both directions', () => {
  const built = setupSchema.identityNames('process')

  assert.deepStrictEqual(
    shared.IDENTITY_PROPERTIES.slice().sort(),
    Object.keys(built.properties).sort(),
    'the properties this plugin expects and the ones setup records are not the same set. ' +
    'A property setup creates and this file omits is one the config reader will not check, ' +
    'so a renamed workspace writes to a property that is not there.'
  )

  assert.deepStrictEqual(
    Object.keys(shared.IDENTITY_VALUES).sort(),
    Object.keys(built.values).sort(),
    'the properties carrying value lists disagree'
  )

  for (const property of Object.keys(built.values)) {
    assert.deepStrictEqual(
      shared.IDENTITY_VALUES[property].slice().sort(),
      Object.keys(built.values[property]).sort(),
      `the values for "${property}" disagree`
    )
  }
})

// ------------------------------------------------------------- property types

check('every person field is a person property in setup\'s definition', () => {
  for (const name of shared.PERSON_FIELDS) {
    const property = propertyNamed(name)
    assert.ok(property, `"${name}" is listed as a person field and setup creates no such property`)
    assert.strictEqual(
      property.type,
      'person',
      `"${name}" is treated as a person field here and setup creates it as "${property.type}"`
    )
  }
})

check('every multi-select field is a multi_select in setup\'s definition', () => {
  for (const name of shared.MULTI_SELECT_FIELDS) {
    const property = propertyNamed(name)
    assert.ok(property, `"${name}" is listed as multi-select and setup creates no such property`)
    assert.strictEqual(
      property.type,
      'multi_select',
      `"${name}" is sent as a list here and setup creates it as "${property.type}". ` +
      'Sending a bare string to a multi_select, or a list to a select, is a 400.'
    )
  }
})

check('the three verification fields all exist', () => {
  for (const name of shared.VERIFICATION_FIELDS) {
    assert.ok(propertyNamed(name), `"${name}" is one of the three verification fields and setup creates no such property`)
  }
})

check('the cadence day table matches setup\'s, including the two nulls', () => {
  assert.deepStrictEqual(
    shared.CADENCE_DAYS,
    setupSchema.CADENCE_DAYS,
    'the cadence tables disagree, so audit would call an artifact due on a different day from check'
  )
  assert.strictEqual(shared.DEFAULT_CADENCE, setupSchema.DEFAULT_CADENCE, 'the default cadences disagree')
  assert.ok(
    shared.CADENCES.includes(shared.DEFAULT_CADENCE),
    'the default cadence is not one of the cadences the property offers'
  )
})

check('an unknown cadence is undefined rather than null', () => {
  // The distinction is load-bearing. `null` means no time-based check by design.
  // `undefined` means nobody here knows the value. A caller that collapses them
  // reports an unrecognised cadence as deliberately exempt from checking.
  assert.strictEqual(shared.cadenceDays('None'), null)
  assert.strictEqual(shared.cadenceDays('On change only'), null)
  assert.strictEqual(shared.cadenceDays('Quarterly'), 90)
  assert.strictEqual(shared.cadenceDays('Every other Thursday'), undefined)
})

// ------------------------------------------------------------------ the rules

check('the Tags cap here is the number setup:check reports on', () => {
  const rule = manifest.RULES.find(r => r.key === 'tags-max-3')
  assert.ok(rule, 'manifest has no tags-max-3 rule, so nothing reports rows that break the cap')
  assert.ok(
    (rule.databases || []).includes('process') || rule.database === 'process',
    'the tags cap rule does not cover Process'
  )
  assert.ok(
    rule.checkQuery.includes(`> ${shared.TAGS_MAX}`),
    `the writer refuses more than ${shared.TAGS_MAX} tags and check reports on "${rule.checkQuery}". ` +
    'One of the two numbers has moved and the other has not.'
  )
})

check('only a Strategy Decision may be a parent, in both places', () => {
  const rule = manifest.RULES.find(r => r.key === 'process-parent-type')
  assert.ok(rule, 'manifest has no process-parent-type rule')
  assert.ok(
    rule.rule.includes(shared.PARENT_TYPE),
    `the writer allows "${shared.PARENT_TYPE}" as a parent and the rule reads "${rule.rule}"`
  )
  assert.ok(shared.TYPES.includes(shared.PARENT_TYPE), 'the parent type is not one of the types')

  assert.strictEqual(shared.canBeParent('Strategy Decision'), true)
  for (const type of shared.TYPES.filter(t => t !== shared.PARENT_TYPE)) {
    assert.strictEqual(shared.canBeParent(type), false, `${type} must not be allowed as a parent`)
  }
  assert.strictEqual(shared.canBeParent(undefined), false, 'a row with no type must not be allowed as a parent')
})

check('a skill can write neither Draft nor a status the property lacks', () => {
  assert.ok(!shared.WRITABLE_STATUSES.includes('Draft'), 'a skill that writes a draft has written nothing useful')
  for (const status of shared.WRITABLE_STATUSES) {
    assert.ok(shared.STATUSES.includes(status), `"${status}" is writable here and is not a status the property has`)
  }
})

// --------------------------------------------------------------- the templates

check('the word ceiling is the number the design document states', () => {
  // The ceiling is not derivable from anything setup builds, because Notion has
  // no concept of it. So the design document is the only other place it exists,
  // and this reads it rather than restating it. `CLAUDE.md` calls a count
  // written beside the thing it counts a copy; this makes it a check.
  //
  // A rewording of that sentence fails this test rather than passing it
  // silently, which is the right direction to fail in: the number moving
  // unnoticed is the failure worth catching.
  const design = fs.readFileSync(path.join(__dirname, '..', 'SCHEMA-process.md'), 'utf8')
  const stated = design.match(/Ceiling of (\d+) words across the required sections/)

  assert.ok(
    stated,
    'SCHEMA-process.md no longer states the ceiling in the form this test reads. ' +
    'Either the number moved or the sentence was reworded, and this cannot tell which.'
  )
  assert.strictEqual(
    Number(stated[1]),
    shared.WORD_CEILING,
    `the design document says ${stated[1]} words and the writer enforces ${shared.WORD_CEILING}`
  )
})

check('every type has body sections and every section list belongs to a type', () => {
  for (const type of shared.TYPES) {
    assert.ok(shared.sectionsFor(type), `${type} has no body sections, so new cannot write one`)
  }
  for (const type of Object.keys(shared.BODY_SECTIONS)) {
    assert.ok(shared.TYPES.includes(type), `"${type}" has a template and is not a type the property offers`)
  }
})

check('Sources is last and conditional on every type', () => {
  for (const type of shared.TYPES) {
    const sections = shared.sectionsFor(type)
    const last = sections[sections.length - 1]
    assert.strictEqual(last.heading, 'Sources', `Sources is not last on ${type}`)
    assert.strictEqual(last.conditional, true, `Sources is not conditional on ${type}`)
    assert.strictEqual(
      sections.filter(s => s.conditional).length,
      1,
      `${type} has a conditional section other than Sources, which the ceiling rule does not account for`
    )
  }
})

check('a never-empty section is a required one', () => {
  // "None known" written in place is the point of the rule, and a conditional
  // section can be omitted entirely, which is the opposite.
  for (const type of shared.TYPES) {
    for (const heading of shared.neverEmptySectionsFor(type)) {
      const section = shared.sectionsFor(type).find(s => s.heading === heading)
      assert.strictEqual(section.conditional, false, `${type}/${heading} is never-empty and conditional at once`)
    }
  }
  assert.deepStrictEqual(shared.neverEmptySectionsFor('SOP/ROE'), ['Exceptions'])
  assert.deepStrictEqual(shared.neverEmptySectionsFor('Technical Reference'), ['Known Limitations'])
})

check('every type names a related view over a property that exists', () => {
  for (const type of shared.TYPES) {
    const view = shared.RELATED_VIEW[type]
    assert.ok(view, `${type} names no related view, and every type gets exactly one`)
    assert.ok(
      shared.IDENTITY_PROPERTIES.includes(view.relation),
      `${type}'s related view is over "${view.relation}", which is not a property on this database`
    )
  }
  for (const type of Object.keys(shared.RELATED_VIEW)) {
    assert.ok(shared.TYPES.includes(type), `"${type}" has a related view and is not a type`)
  }
})

check('an unknown type gets undefined from every lookup, never a default', () => {
  // A type this file does not know must not silently borrow another type's
  // template. Returning undefined is what makes the caller handle it.
  assert.strictEqual(shared.sectionsFor('Runbook'), undefined)
  assert.strictEqual(shared.requiredSectionsFor('Runbook'), undefined)
  assert.strictEqual(shared.neverEmptySectionsFor('Runbook'), undefined)
})

console.log(failures ? `\n${failures} failed.\n` : '\nAll passed.\n')
process.exit(failures ? 1 : 0)

'use strict'

/**
 * The Memos facts the writer carries agree with the ones the builder uses.
 *
 * `plugins/setup/scripts/schema.js` is what `setup` builds the database from.
 * `shared/memos-schema.js` is what the writing plugin carries, because an
 * installed `memos` cannot reach `setup`'s files. Two files, one database.
 *
 * The loud case of a disagreement is a 400 on the first write, because Notion
 * refuses a select value the property does not have. The quiet cases are the
 * rules: the tags cap lives in `manifest.js` as a thing `setup:check` reports
 * and here as a thing a writer refuses, and the append-only status rule lives
 * only here, so both are pinned.
 *
 * WHAT THIS TEST CANNOT DO. It compares this checkout against itself. An
 * installed `setup` and an installed `memos` are separate releases updated
 * separately, and nothing here can reach them. `configVersion` in
 * `shared/config-read.js` is what covers that gap.
 *
 * Run: node tests/memos-schema-agrees.test.js
 */

const assert = require('assert')
const fs = require('fs')
const path = require('path')

const setupSchema = require('../plugins/setup/scripts/schema')
const manifest = require('../plugins/setup/scripts/manifest')
const shared = require('../shared/memos-schema')

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

console.log('\nthe shared Memos schema agrees with what setup builds\n')

const definition = setupSchema.DATABASES ? setupSchema.DATABASES.memos : null

check('setup has a Memos definition to compare against', () => {
  assert.ok(definition, 'could not reach setup\'s memos schema, so this test proves nothing')
  assert.ok(
    Array.isArray(definition.properties) && definition.properties.length,
    'the memos definition has no properties'
  )
})

const propertyNamed = name => definition.properties.find(p => p.name === name)
const optionsOf = name => {
  const property = propertyNamed(name)
  if (!property || !Array.isArray(property.options)) return null
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
  ['tag', 'TAGS', 'Tags']
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
  const built = setupSchema.identityNames('memos')

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

check('the two date fields the writer touches are date properties', () => {
  // Both are written through `date:<name>:start` and `date:<name>:end`, so a
  // property that is not a date would take the write in a shape nothing reads.
  for (const name of ['Published date', 'Period covered']) {
    const property = propertyNamed(name)
    assert.ok(property, `"${name}" is written by this plugin and setup creates no such property`)
    assert.strictEqual(property.type, 'date', `"${name}" is written as a date and setup creates it as "${property.type}"`)
  }
})

// ------------------------------------------------------------------ the rules

check('a skill can write only Published, and Published is a status the property has', () => {
  assert.deepStrictEqual(
    shared.WRITABLE_STATUSES,
    ['Published'],
    'the append-only design writes exactly one status: Draft is a person\'s to set, and Canceled is a retraction a person makes with a correcting memo'
  )
  for (const status of shared.WRITABLE_STATUSES) {
    assert.ok(shared.STATUSES.includes(status), `"${status}" is writable here and is not a status the property has`)
  }
})

check('the Tags cap here is the number setup:check reports on, and the rule covers Memos', () => {
  const rule = manifest.RULES.find(r => r.key === 'tags-max-3')
  assert.ok(rule, 'manifest has no tags-max-3 rule, so nothing reports rows that break the cap')
  assert.ok(
    (rule.databases || []).includes('memos') || rule.database === 'memos',
    'the tags cap rule does not cover Memos, so a row a person writes over the cap would never be reported'
  )
  assert.ok(
    rule.checkQuery.includes(`> ${shared.TAGS_MAX}`),
    `the writer refuses more than ${shared.TAGS_MAX} tags and check reports on "${rule.checkQuery}". ` +
    'One of the two numbers has moved and the other has not.'
  )
})

check('the period type is one of the types, and only it carries Period covered', () => {
  assert.ok(shared.TYPES.includes(shared.PERIOD_TYPE), 'the period type is not one of the types')
  assert.strictEqual(shared.carriesPeriod(shared.PERIOD_TYPE), true)
  for (const type of shared.TYPES.filter(t => t !== shared.PERIOD_TYPE)) {
    assert.strictEqual(shared.carriesPeriod(type), false, `${type} must not carry Period covered`)
  }
  assert.strictEqual(shared.carriesPeriod(undefined), false, 'a row with no type must not carry Period covered')
})

check('the correction relation exists in the manifest, one self-relation with both sides named', () => {
  // `new` enforces the one-target rule on Corrects and `find` follows
  // Corrected by, so both properties have to be the two sides of one two-way
  // self-relation, or the chain this plugin walks does not exist.
  const relation = manifest.RELATIONS.find(r => r.from === 'memos' && r.to === 'memos')
  assert.ok(relation, 'the manifest has no memos self-relation, so a correction has no mechanism')
  assert.strictEqual(relation.property, 'Corrects')
  assert.strictEqual(relation.reverse, 'Corrected by')
  assert.strictEqual(relation.kind, 'two-way', 'a one-way Corrects would make the chain unfollowable from the corrected side')
})

// --------------------------------------------------------------- the templates

check('the word ceiling is the number the design document states', () => {
  // The ceiling is not derivable from anything setup builds, because Notion
  // has no concept of it. The design document is the only other place it
  // exists, and this reads it rather than restating it, so the number moving
  // unnoticed is the failure that gets caught.
  const design = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'memos', 'SCHEMA.md'), 'utf8')
  const stated = design.match(/Ceiling of (\d+) words across the required\s+sections/)

  assert.ok(
    stated,
    'plugins/memos/SCHEMA.md no longer states the ceiling in the form this test reads. ' +
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

check('at most one conditional section per type, always last', () => {
  // The design rule: conditional sections are marked as such and always come
  // last. More than one, or one in the middle, is a template the ceiling rule
  // and the omit-when-empty rule were not written for.
  for (const type of shared.TYPES) {
    const sections = shared.sectionsFor(type)
    const conditional = sections.filter(s => s.conditional)
    assert.ok(conditional.length <= 1, `${type} has ${conditional.length} conditional sections and the design allows one`)
    if (conditional.length) {
      assert.strictEqual(
        sections[sections.length - 1].conditional,
        true,
        `${type}'s conditional section is not last`
      )
    }
  }
})

check('five required sections is the ceiling, and four is better is not enforced', () => {
  // "Five sections is the ceiling, and four is better. The counts below are
  // limits rather than targets." Only the limit is enforceable.
  for (const type of shared.TYPES) {
    const required = shared.requiredSectionsFor(type)
    assert.ok(required.length <= 5, `${type} has ${required.length} required sections against a ceiling of five`)
    assert.ok(required.length >= 3, `${type} has only ${required.length} required sections, which is fewer than any template the design defines`)
  }
})

check('an unknown type gets undefined from every lookup, never a default', () => {
  assert.strictEqual(shared.sectionsFor('Newsletter'), undefined)
  assert.strictEqual(shared.requiredSectionsFor('Newsletter'), undefined)
})

console.log(failures ? `\n${failures} failed.\n` : '\nAll passed.\n')
process.exit(failures ? 1 : 0)

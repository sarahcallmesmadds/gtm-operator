'use strict'

/**
 * The Software facts the writer carries agree with the ones the builder uses.
 *
 * `plugins/setup/scripts/schema.js` is what `setup` builds the database from.
 * `shared/software-schema.js` is what the writing plugin carries, because an
 * installed `software` cannot reach `setup`'s files. Two files, one
 * definition.
 *
 * The loud case of a disagreement is a 400 on the first write. The quiet
 * cases are the rules: the fill events, the ceiling and the never-cleared
 * list live only in the shared file, so they are pinned here against the
 * design documents.
 *
 * WHAT THIS TEST CANNOT DO. It compares this checkout against itself. An
 * installed `setup` and an installed `software` are separate releases updated
 * separately; `configVersion` in `shared/config-read.js` covers that gap.
 *
 * Run: node tests/software-schema-agrees.test.js
 */

const assert = require('assert')
const fs = require('fs')
const path = require('path')

const setupSchema = require('../plugins/setup/scripts/schema')
const shared = require('../shared/software-schema')
const tool = require('../plugins/software/scripts/tool')

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

console.log('\nthe shared Software schema agrees with what setup builds\n')

const software = setupSchema.DATABASES ? setupSchema.DATABASES.software : null

check('setup has a Software definition to compare against', () => {
  assert.ok(software && Array.isArray(software.properties) && software.properties.length,
    'could not reach setup\'s software schema, so this test proves nothing')
})

const optionsOf = name => {
  const property = software.properties.find(p => p.name === name)
  if (!property || !Array.isArray(property.options)) return null
  return property.options.map(o => (Array.isArray(o) ? o[0] : o))
}
const typeOf = name => {
  const property = software.properties.find(p => p.name === name)
  return property ? property.type : null
}

// --------------------------------------------------------------- value lists

const lists = [
  ['status', 'STATUSES', 'Status'],
  ['importance', 'IMPORTANCE', 'Importance'],
  ['domain', 'DOMAINS', 'Domain'],
  ['audience', 'AUDIENCES', 'Audience'],
  ['renews', 'RENEWS', 'Renews'],
  ['AI access', 'AI_ACCESS', 'AI access'],
  ['stores-PII', 'STORES_PII', 'Stores PII'],
  ['SOC 2', 'SOC_2', 'SOC 2'],
  ['SSO', 'SSO', 'SSO']
]

for (const [label, exported, property] of lists) {
  check(`the ${label} list matches, in the same order`, () => {
    assert.deepStrictEqual(
      shared[exported],
      optionsOf(property),
      `the shared ${label} list and the one setup creates are not the same list. ` +
      'A value here that setup never created is a 400 on the first write, and the whole page is lost. ' +
      'Order matters too: Notion sorts a select by option order.'
    )
  })
}

// ------------------------------------------------------------ the name contract

check('the IDENTITY equals what setup would record, in both directions', () => {
  const built = setupSchema.identityNames('software')
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

check('every field group names properties of the type setup creates', () => {
  for (const name of shared.PERSON_FIELDS) {
    assert.strictEqual(typeOf(name), 'person', `"${name}" is treated as a person field here and setup creates it as "${typeOf(name)}"`)
  }
  for (const name of shared.MULTI_SELECT_FIELDS) {
    assert.strictEqual(typeOf(name), 'multi_select', `"${name}" is sent as a list here and setup creates it as "${typeOf(name)}". Sending a bare string to a multi_select, or a list to a select, is a 400.`)
  }
  for (const name of shared.URL_FIELDS) {
    assert.strictEqual(typeOf(name), 'url', `"${name}" is written as a url here and setup creates it as "${typeOf(name)}"`)
  }
  for (const name of shared.CHECKBOX_FIELDS) {
    assert.strictEqual(typeOf(name), 'checkbox', `"${name}" is written as true/false here and setup creates it as "${typeOf(name)}"`)
  }
  for (const name of shared.DATE_RANGE_FIELDS.concat(shared.DAY_FIELDS)) {
    assert.strictEqual(typeOf(name), 'date', `"${name}" is written through date columns and setup creates it as "${typeOf(name)}"`)
  }
  assert.strictEqual(typeOf('Annual cost'), 'number', 'Annual cost is one number, annualised; a price plus a billing period was deliberately not built')
  assert.strictEqual(typeOf('Last reviewed'), 'date', 'Last reviewed is the freshness stamp for the whole row')
})

check('the writer\'s FIELD_TYPES agrees with setup, through the read-back naming', () => {
  // setup writes `text` and `person`; the payload layer speaks the client's
  // `rich_text` and `people`. The mapping is the measured READ_BACK_AS pair
  // plus identity for everything else.
  const spoken = { text: 'rich_text', person: 'people' }
  for (const [field, type] of Object.entries(tool.FIELD_TYPES)) {
    const created = typeOf(field)
    assert.ok(created, `FIELD_TYPES names "${field}", which setup does not create as a non-relation property`)
    assert.strictEqual(type, spoken[created] || created,
      `"${field}" is written as ${type} and setup creates it as ${created}`)
  }
  for (const property of software.properties) {
    if (property.type === 'created_time') continue
    assert.ok(property.name in tool.FIELD_TYPES,
      `setup creates "${property.name}" and FIELD_TYPES does not know it, so it could be neither written nor cleared`)
  }
})

// ------------------------------------------------------------------ the rules

check('there is no Tags property, the design rule pinned', () => {
  // A tag is what a row is ABOUT, and a tool is not about anything. Matching
  // the other databases for its own sake is how a field with no meaning gets
  // shipped, so its absence is asserted rather than assumed.
  assert.strictEqual(typeOf('Tags'), null, 'Software deliberately has no Tags; plugins/software/SCHEMA.md says why')
  assert.ok(!shared.IDENTITY_PROPERTIES.includes('Tags'))
})

check('Contract link carries the property description the design states, word for word', () => {
  const design = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'software', 'SCHEMA.md'), 'utf8')
  const stated = design.match(/The text is:\n\n((?:> .*\n)+)/)
  assert.ok(stated, 'plugins/software/SCHEMA.md no longer states the Contract link description in the form this test reads')
  const wanted = stated[1].split('\n').map(l => l.replace(/^> /, '').trim()).filter(Boolean).join(' ')
  const property = software.properties.find(p => p.name === 'Contract link')
  assert.strictEqual(property && property.description, wanted,
    'the description setup writes and the one the design states are not the same text. ' +
    'It is the one place a rule reaches a person at the moment they are filling the field in.')
})

check('the required-at-create and never-cleared lists name fields the database has', () => {
  const names = new Set(shared.IDENTITY_PROPERTIES)
  for (const field of shared.REQUIRED_AT_CREATE) {
    assert.ok(names.has(field), `new requires "${field}", which is not a property this database has, so the gate gates nothing`)
  }
  for (const field of shared.NEVER_CLEARED) {
    assert.ok(names.has(field), `update refuses to clear "${field}", which is not a property this database has`)
  }
  // Person fields are deliberately clearable: an owner who left is cleared by
  // name, and that clear is the whole point.
  for (const field of shared.PERSON_FIELDS) {
    assert.ok(!shared.NEVER_CLEARED.includes(field), `"${field}" is a person field and must stay clearable`)
  }
})

check('Last reviewed is written by exactly the skills the fill-event table names', () => {
  // The fill-event table in plugins/software/SCHEMA.md names software:new and
  // software:review, the reading Sarah ruled for on 2026-08-25 (creation is a
  // full pass). This reads that table rather than hardcoding the answer, so
  // the constant tracks the document it claims to follow: change the table
  // without the constant, or the constant without the table, and this goes
  // red.
  const design = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'software', 'SCHEMA.md'), 'utf8')
  // Anchored on the fill-event row's own wording, because "| Last reviewed |"
  // also opens a row in the field table, whose third cell names no skill.
  const row = design.match(/\| Last reviewed \| Creation[^|]*\| ([^|]+)\|/)
  assert.ok(row, 'plugins/software/SCHEMA.md no longer states Last reviewed\'s fill event in the table form this test reads')
  const named = (row[1].match(/`software:([a-z-]+)`/g) || []).map(m => m.replace(/`software:([a-z-]+)`/, '$1'))
  assert.deepStrictEqual(shared.LAST_REVIEWED_WRITERS, named,
    `the fill-event table names ${JSON.stringify(named)} and the writer enforces ${JSON.stringify(shared.LAST_REVIEWED_WRITERS)}`)
})

check('the single-person fields are the three accountability fields, and Admins stays the list', () => {
  for (const field of shared.SINGLE_PERSON_FIELDS) {
    assert.ok(shared.PERSON_FIELDS.includes(field), `"${field}" is pinned singular and is not a person field at all`)
  }
  assert.ok(!shared.SINGLE_PERSON_FIELDS.includes('Admins'),
    'Admins is the one field designed as Person (multi): who holds an admin seat is a list')
  assert.deepStrictEqual(shared.SINGLE_PERSON_FIELDS, ['Owner', 'Technical owner', 'Billing owner'])
})

// --------------------------------------------------------------- the template

check('the body is the four sections the design defines, Notes conditional and last', () => {
  const design = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'software', 'SCHEMA.md'), 'utf8')
  const stated = design.match(/\*\*Body sections, in order:\*\* ([^.]+)\./)
  assert.ok(stated, 'plugins/software/SCHEMA.md no longer states the body sections in the form this test reads')
  const wanted = stated[1].split(',').map(s => s.trim().replace(/\s+/g, ' '))
  assert.deepStrictEqual(
    shared.SECTIONS.map(s => s.conditional ? `${s.heading} (conditional)` : s.heading),
    wanted,
    'the shared section list and the design document disagree, conditionality included'
  )
})

check('the word ceiling is the number the design document states', () => {
  // Not derivable from anything setup builds; the design document is the only
  // other place it lives, so the two are held together. This is the exact gap
  // the 2026-08-23 mutation run found in process: a ceiling nothing checked
  // could move to 900 and everything stayed green.
  const design = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'software', 'SCHEMA.md'), 'utf8')
  const stated = design.match(/Ceiling of (\d+) words across the required sections/)
  assert.ok(stated,
    'plugins/software/SCHEMA.md no longer states the ceiling in the form this test reads. ' +
    'Fix the regex rather than deleting the check.')
  assert.strictEqual(shared.WORD_CEILING, Number(stated[1]),
    `the design document says ${stated[1]} words and the writer enforces ${shared.WORD_CEILING}`)
})

console.log(failures ? `\n${failures} failed.\n` : '\nAll passed.\n')
process.exit(failures ? 1 : 0)

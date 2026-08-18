'use strict'

/**
 * Tests for the name map: the thing that lets this plugin follow a rename.
 *
 * Until 2026-08-18 the config carried `properties: {}` and `values: {}` on every
 * database and nothing ever wrote to them. Two consequences, and the second is
 * the one that mattered:
 *
 *   Every lookup indexed the read-back by the SHIPPED name, so a renamed
 *   property read as one property missing plus one stranger nobody owns, and
 *   the repair path was one approval away from re-adding a property somebody
 *   had deliberately renamed.
 *
 *   An empty map meant both "nothing was renamed" and "no map was ever taken",
 *   with nothing to tell them apart. `check` has to tell a renamed property
 *   from a deleted one, which is impossible without knowing which of the two an
 *   empty map is.
 *
 * Every case below fails against the code as it was before that date.
 *
 * Run: node tests/names.test.js
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const assert = require('assert')

const ROOT = path.join(__dirname, '..')
const SCRIPTS = path.join(ROOT, 'plugins/setup/scripts')

// A config of its own, so nothing here can read or write the real one.
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gtm-names-'))
process.env.GTM_OPERATOR_CONFIG = path.join(TEMP, 'config.json')

const schema = require(path.join(SCRIPTS, 'schema.js'))
const relations = require(path.join(SCRIPTS, 'relations.js'))
const config = require(path.join(SCRIPTS, 'config.js'))
const mapped = require(path.join(SCRIPTS, 'names.js'))

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

const fresh = () => {
  if (fs.existsSync(process.env.GTM_OPERATOR_CONFIG)) fs.unlinkSync(process.env.GTM_OPERATOR_CONFIG)
  config.begin('parent-page-id')
  config.recordDatabase('process', { databaseId: 'db-process', dataSourceId: 'ds-process' })
  config.recordDatabase('memos', { databaseId: 'db-memos', dataSourceId: 'ds-memos' })
}

const clean = () => {
  const f = JSON.parse(JSON.stringify(require('./fixtures/process-as-notion-returned-it.json')))
  delete f._comment
  return f
}

console.log('\nthe map records what is there, including what nobody changed\n')

check('recording a database writes a complete map, not an empty one', () => {
  fresh()
  const names = config.namesFor('process')
  assert.ok(names, 'no map was recorded when the database was recorded')
  for (const p of schema.DATABASES.process.properties) {
    assert.strictEqual(names.properties[p.name], p.name, `${p.name} is not in the recorded map`)
  }
})

check('relation properties are in the map too, both directions', () => {
  fresh()
  const names = config.namesFor('process')
  for (const name of relations.propertyNamesFor('process')) {
    assert.strictEqual(names.properties[name], name,
      `${name} is a relation property on Process and is not in the map, so a rename of it would read as absent and invite a second relation beside it`)
  }
})

check('a database that was never recorded has no map, and says so rather than guessing', () => {
  fresh()
  assert.strictEqual(config.namesFor('calendar'), null,
    'an unrecorded database answered with a map, so "never recorded" and "nothing renamed" are indistinguishable again')
})

check('an empty map is not a map', () => {
  assert.strictEqual(mapped.recorded({ properties: {}, values: {} }), false)
  assert.strictEqual(mapped.recorded({ properties: { Domain: 'Domain' } }), true)
})

console.log('\na renamed property is followed, not reported twice\n')

check('a renamed property passes when the map knows about it', () => {
  const broken = clean()
  broken['Business Area'] = broken.Domain
  broken['Business Area'].name = 'Business Area'
  delete broken.Domain

  const names = schema.identityNames('process')
  names.properties.Domain = 'Business Area'

  const problems = schema.verify('process', broken, relations.propertyNamesFor('process'), names)
  assert.deepStrictEqual(problems, [],
    `a rename the map knows about was still reported:\n${problems.join('\n')}`)
})

check('the same rename without the map is reported as missing AND as a stranger', () => {
  const broken = clean()
  broken['Business Area'] = broken.Domain
  broken['Business Area'].name = 'Business Area'
  delete broken.Domain

  const problems = schema.verify('process', broken, relations.propertyNamesFor('process')).join('\n')
  assert.ok(problems.includes('Domain: missing'), `expected the shipped name to be reported missing, got:\n${problems}`)
  assert.ok(problems.includes('Business Area'), `expected the new name to be reported as a stranger, got:\n${problems}`)
})

check('a renamed property that is genuinely gone is still caught', () => {
  const broken = clean()
  delete broken.Domain

  const names = schema.identityNames('process')
  names.properties.Domain = 'Business Area'

  const problems = schema.verify('process', broken, relations.propertyNamesFor('process'), names).join('\n')
  assert.ok(problems.includes('Business Area'),
    `a property the map points at, which is not in the workspace, passed. The map cannot be allowed to hide an absence:\n${problems}`)
})

console.log('\na renamed option value is followed, and a missing one still fails\n')

check('a renamed option passes when the map knows about it', () => {
  const broken = clean()
  const type = broken.Type
  type.options = type.options.map(o => o.name === 'Strategy Decision' ? { ...o, name: 'Strategy Call' } : o)

  const names = schema.identityNames('process')
  names.values.Type['Strategy Decision'] = 'Strategy Call'

  const problems = schema.verify('process', broken, relations.propertyNamesFor('process'), names)
  assert.deepStrictEqual(problems, [], `a renamed option the map knows about was reported:\n${problems.join('\n')}`)
})

check('an option the map points at, which is not there, is still missing', () => {
  const broken = clean()
  broken.Type.options = broken.Type.options.filter(o => o.name !== 'Strategy Decision')

  const names = schema.identityNames('process')
  names.values.Type['Strategy Decision'] = 'Strategy Call'

  const problems = schema.verify('process', broken, relations.propertyNamesFor('process'), names).join('\n')
  assert.ok(problems.includes('"Strategy Call" is missing'),
    `a missing option was not reported once the map was in play, which is the failure the map must not introduce:\n${problems}`)
})

console.log('\nthe map refuses what would make every later read wrong\n')

check('two logical properties cannot map to one Notion property', () => {
  fresh()
  const names = schema.identityNames('process')
  names.properties.Domain = 'Audience'
  assert.throws(() => config.recordNames('process', names), /both map to/,
    'two logical names were allowed to point at one property, so every read through the map after it answers about the wrong one')
})

check('a map missing a logical name is refused, because a map is complete or absent', () => {
  fresh()
  const names = schema.identityNames('process')
  delete names.properties.Domain
  assert.throws(() => config.recordNames('process', names), /is not in the map/)
})

check('a map naming a property this database does not have is refused', () => {
  fresh()
  const names = schema.identityNames('process')
  names.properties['Invented Field'] = 'Whatever'
  assert.throws(() => config.recordNames('process', names), /is not a property this database has/)
})

check('recording names throws away a verify taken against the old ones', () => {
  fresh()
  config.recordVerified(new Date().toISOString())
  assert.ok(config.read().verified, 'the fixture did not record a verify, so this proves nothing')
  const names = schema.identityNames('process')
  names.properties.Domain = 'Business Area'
  config.recordNames('process', names)
  assert.strictEqual(config.read().verified, null,
    'a rename left the old proof standing, so `complete` could rest on a verify taken against different names')
})

check('a database cannot be renamed before it is recorded', () => {
  fresh()
  assert.throws(() => config.recordNames('calendar', schema.identityNames('calendar')), /not recorded yet/)
})

console.log('\nrelations follow the map as well\n')

check('a renamed relation property is not reported missing, and no second one is added', () => {
  // Every database gets an id. Phase B refuses to build a statement for a
  // target that is not recorded, so a partial set makes this fail for a reason
  // that has nothing to do with renaming.
  const ids = {}
  for (const d of require(path.join(SCRIPTS, 'manifest.js')).DATABASES) ids[d.key] = { dataSourceId: `ds-${d.key}` }

  // Process with both sides of its Parent relation present, and the near side
  // renamed by hand in Notion.
  const renamed = {
    process: {
      'Parent Doc': { type: 'relation', dataSourceUrl: 'collection://ds-process', propertyUrl: 'collectionProperty://ds-process/abc' },
      'Child Docs': { type: 'relation', dataSourceUrl: 'collection://ds-process', propertyUrl: 'collectionProperty://ds-process/def' }
    }
  }
  const names = { process: { properties: { Parent: 'Parent Doc', 'Child Docs': 'Child Docs' }, values: {} } }

  const relation = require(path.join(SCRIPTS, 'manifest.js')).RELATIONS.find(r => r.from === 'process' && r.property === 'Parent')

  const withoutMap = relations.verifyRelation(relation, renamed, ids).join('\n')
  assert.ok(withoutMap.includes('missing from'),
    `the fixture does not reproduce the problem: without the map a renamed relation should read as missing.\n${withoutMap}`)

  const withMap = relations.verifyRelation(relation, renamed, ids, names).join('\n')
  assert.ok(!withMap.includes('missing from'),
    `a renamed relation still read as missing with the map in play:\n${withMap}`)

  const repairs = relations.repairStatements(renamed, ids, names)
  assert.ok(!(repairs.process || '').includes('"Parent"'),
    `a renamed relation produced an ADD COLUMN, which is how a rename becomes two relations:\n${repairs.process}`)
})

check('the relation property names handed to verify are the observed ones', () => {
  const names = { properties: { Parent: 'Parent Doc' }, values: {} }
  const observed = relations.observedPropertyNamesFor('process', names)
  assert.ok(observed.includes('Parent Doc'), 'the renamed relation property was not resolved through the map')
  assert.ok(!observed.includes('Parent'), 'the shipped name came through as well, which would report the rename as a stranger')
})

fs.rmSync(TEMP, { recursive: true, force: true })

if (failures) {
  console.log(`\n${failures} failed.\n`)
  process.exit(1)
}
console.log('\nAll checks passed.\n')

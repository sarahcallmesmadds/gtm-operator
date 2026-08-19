'use strict'

/**
 * `schema.inspect`, which is `schema.verify` with the findings said in a shape
 * a caller can act on.
 *
 * `check` has to know which finding it is holding, because a missing property
 * and a missing option have different repairs. The alternative was reading the
 * category back out of the English sentence, which makes a reworded message
 * silently change what gets repaired.
 *
 * Run: node tests/schema-inspect.test.js
 */

const path = require('path')
const assert = require('assert')

const ROOT = path.join(__dirname, '..')
const schema = require(path.join(ROOT, 'plugins/setup/scripts/schema.js'))
const relations = require(path.join(ROOT, 'plugins/setup/scripts/relations.js'))

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

const KEY = 'process'
const RELATION_NAMES = relations.propertyNamesFor(KEY)

const fs = require('fs')
/** The install this repository measured, as Notion returned it. */
const clean = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/full-install-as-notion-returned-it.json'), 'utf8')).databases[KEY].schema

const kinds = findings => findings.map(f => f.kind)
const of = (findings, kind) => findings.filter(f => f.kind === kind)

console.log('\nthe findings are produced beside the sentences\n')

check('a read-back this schema is happy with produces neither', () => {
  // The baseline, asserted first. Every test below says a finding APPEARED, and
  // that is only evidence if the same input without the fault produces none.
  const actual = clean()
  const { problems, findings } = schema.inspect(KEY, actual, RELATION_NAMES)
  assert.deepStrictEqual(problems, [], `the clean fixture reported problems:\n${problems.join('\n')}`)
  assert.deepStrictEqual(findings, [], `the clean fixture reported findings:\n${JSON.stringify(findings)}`)
})

check('nothing read back at all is a finding, not an empty pass', () => {
  const { problems, findings } = schema.inspect(KEY, null, RELATION_NAMES)
  assert.strictEqual(problems.length, 1)
  assert.deepStrictEqual(kinds(findings), ['schema-absent'])
})

check('a missing property is one finding carrying the name to look for', () => {
  const actual = clean()
  const want = schema.DATABASES[KEY].properties.find(p => !p.options)
  delete actual[want.name]

  const { problems, findings } = schema.inspect(KEY, actual, RELATION_NAMES)
  const missing = of(findings, 'property-missing')
  assert.strictEqual(missing.length, 1, `expected exactly one, got ${JSON.stringify(kinds(findings))}`)
  assert.strictEqual(missing[0].logical, want.name)
  assert.strictEqual(missing[0].observed, want.name)
  assert.ok(problems.some(p => p.includes(want.name)), 'the sentence stopped naming the property')
})

check('a missing option and an extra one are two different findings', () => {
  const actual = clean()
  const want = schema.DATABASES[KEY].properties.find(p => p.options && p.options.length > 2)
  const [dropped] = want.options[1]
  const got = actual[want.name]
  got.options = got.options.filter(o => o.name !== dropped)
  got.options.push({ name: 'Something They Added', color: 'blue' })

  const { findings } = schema.inspect(KEY, actual, RELATION_NAMES)
  const missing = of(findings, 'option-missing')
  const extra = of(findings, 'option-extra')
  assert.strictEqual(missing.length, 1, `expected one missing option, got ${JSON.stringify(kinds(findings))}`)
  assert.strictEqual(missing[0].observedValue, dropped)
  assert.strictEqual(extra.length, 1, 'the value they added was not recorded, so an option rename cannot be recognised')
  assert.strictEqual(extra[0].observedValue, 'Something They Added')
})

check('an extra option value is not a problem, only a finding', () => {
  // The pairing rule and its one exception. An extra value is the user's and is
  // never removed, so it gets no sentence, and a caller counting problems to
  // learn how many findings there are would be wrong.
  const actual = clean()
  const want = schema.DATABASES[KEY].properties.find(p => p.options)
  actual[want.name].options.push({ name: 'Theirs', color: 'blue' })

  const { problems, findings } = schema.inspect(KEY, actual, RELATION_NAMES)
  assert.deepStrictEqual(problems, [], `an added option value was reported as a problem:\n${problems.join('\n')}`)
  assert.deepStrictEqual(kinds(findings), ['option-extra'])
})

check('verify returns exactly the sentences inspect produces', () => {
  // The two must not drift. `install.verify` and its tests read the sentences,
  // and `check` reads the findings, and they are one pass over one read-back.
  const actual = clean()
  const want = schema.DATABASES[KEY].properties.find(p => !p.options)
  delete actual[want.name]

  assert.deepStrictEqual(
    schema.verify(KEY, actual, RELATION_NAMES),
    schema.inspect(KEY, actual, RELATION_NAMES).problems
  )
  assert.ok(schema.verify(KEY, actual, RELATION_NAMES).length > 0, 'the fixture stopped reproducing a problem, so this compares two empty lists')
})

if (failures) {
  console.log(`\n${failures} failed.\n`)
  process.exit(1)
}
console.log('\nAll checks passed.\n')

'use strict'

/**
 * The rule queries, and the compiler that resolves the names in them.
 *
 * The two strings asserted first are the ones proved against real rows on
 * 2026-08-17: the tags query returned exactly the 4-tag and 5-tag rows and
 * correctly excluded the 2-tag one, and the parent query returned the child of
 * an SOP and not the child of a Strategy Decision. Templating them is only safe
 * if a default install still sends those exact strings, so that is the first
 * thing checked here.
 *
 * Run: node tests/rules.test.js
 */

const path = require('path')
const assert = require('assert')

const ROOT = path.join(__dirname, '..')
const rules = require(path.join(ROOT, 'plugins/setup/scripts/rules.js'))
const { RULES } = require(path.join(ROOT, 'plugins/setup/scripts/manifest.js'))

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

const MEASURED = {
  'tags-max-3': 'SELECT "Name" FROM <ds> WHERE json_array_length("Tags") > 3',
  'process-parent-type': 'SELECT c."Name" FROM <ds> c JOIN <ds> p ON p.url = json_extract(c."Parent", \'$[0]\') WHERE c."Parent" IS NOT NULL AND p."Type" != \'Strategy Decision\''
}

const rule = key => RULES.find(r => r.key === key)

console.log('\nwhat a default install sends is what was measured\n')

check('the tags query is the string that was proved on real rows', () => {
  assert.strictEqual(rules.compile(rule('tags-max-3'), 'process'), MEASURED['tags-max-3'])
})

check('the parent query is the string that was proved on real rows', () => {
  assert.strictEqual(rules.compile(rule('process-parent-type'), 'process'), MEASURED['process-parent-type'])
})

check('no placeholder survives compiling', () => {
  for (const q of rules.queries()) {
    assert.ok(!/\{(prop|value):/.test(q.query), `a placeholder was left in ${q.rule}:\n${q.query}`)
  }
})

console.log('\ntwo rules are three queries\n')

check('Memos is queried, not only Process', () => {
  // The arithmetic that hides a whole database: two rules read as two queries
  // when one of them covers two databases.
  const all = rules.queries()
  assert.strictEqual(all.length, 3, `expected three, got ${all.length}: ${all.map(q => q.title + '/' + q.rule).join(', ')}`)
  const tags = all.filter(q => q.rule === 'tags-max-3').map(q => q.database).sort()
  assert.deepStrictEqual(tags, ['memos', 'process'])
})

console.log('\na renamed workspace is asked about in its own words\n')

check('a renamed property changes the query for that database only', () => {
  const names = { memos: { properties: { Tags: 'Labels' }, values: {} } }
  const all = rules.queries(names)
  const memos = all.find(q => q.database === 'memos' && q.rule === 'tags-max-3')
  const process = all.find(q => q.database === 'process' && q.rule === 'tags-max-3')

  assert.ok(memos.query.includes('"Labels"'), `Memos was asked about a property it does not have:\n${memos.query}`)
  assert.ok(!memos.query.includes('"Tags"'), `the shipped name was asked about as well:\n${memos.query}`)
  assert.strictEqual(process.query, MEASURED['tags-max-3'], 'renaming on Memos changed the Process query')
})

check('every name in the parent query is resolved, including Name', () => {
  // Five distinct tokens, renamed separately so that one shared answer cannot
  // pass for all of them. `Name` is the one an earlier draft of this missed.
  const names = { process: { properties: { Name: 'Title', Parent: 'Parent Doc', Type: 'Kind' }, values: { Type: { 'Strategy Decision': 'Strategy Call' } } } }
  const query = rules.compile(rule('process-parent-type'), 'process', names.process)

  assert.ok(query.includes('c."Title"'), `Name was not resolved:\n${query}`)
  assert.ok(query.includes('c."Parent Doc"'), `Parent was not resolved:\n${query}`)
  assert.ok(query.includes('p."Kind"'), `Type was not resolved:\n${query}`)
  assert.ok(query.includes("'Strategy Call'"), `the option value was not resolved:\n${query}`)
  for (const shipped of ['"Name"', '"Parent"', '"Type"', "'Strategy Decision'"]) {
    assert.ok(!query.includes(shipped), `${shipped} survived, so the workspace is asked about a name it does not use:\n${query}`)
  }
})

check('both occurrences of a name are resolved, not just the first', () => {
  // `Parent` appears twice in that query, once in the join and once in the
  // WHERE. A replace that stops at the first leaves a query that is half right
  // and still runs.
  const names = { properties: { Parent: 'Parent Doc' }, values: {} }
  const query = rules.compile(rule('process-parent-type'), 'process', names)
  assert.strictEqual((query.match(/"Parent Doc"/g) || []).length, 2, `expected both occurrences:\n${query}`)
})

console.log('\nquoting\n')

check('a name holding a double quote does not break the query', () => {
  const names = { properties: { Tags: 'The "real" tags' }, values: {} }
  const query = rules.compile(rule('tags-max-3'), 'process', names)
  assert.ok(query.includes('"The ""real"" tags"'), `the quote was not doubled:\n${query}`)
})

check('a value holding an apostrophe does not break the query', () => {
  const names = { properties: {}, values: { Type: { 'Strategy Decision': "Bill's call" } } }
  const query = rules.compile(rule('process-parent-type'), 'process', names)
  assert.ok(query.includes("'Bill''s call'"), `the apostrophe was not doubled:\n${query}`)
})

console.log('\nthe rules themselves are checked\n')

check('the shipped rules pass their own validation', () => {
  assert.deepStrictEqual(rules.validate(), [])
})

check('a rule that cannot be asked is refused', () => {
  const cases = [
    [{ key: 'a', caughtBy: 'check', database: 'process' }, /no query/],
    [{ key: 'b', caughtBy: 'check', checkQuery: 'SELECT 1' }, /names no database/],
    [{ key: 'c', caughtBy: 'check', database: 'nowhere', checkQuery: 'SELECT 1' }, /has no schema/],
    [{ key: 'd', caughtBy: 'check', database: 'process', checkQuery: 'SELECT {prop:Nonsense}' }, /does not have/],
    [{ key: 'e', caughtBy: 'check', database: 'process', checkQuery: 'SELECT {value:Name:whatever}' }, /has no options/],
    [{ key: 'f', caughtBy: 'check', database: 'process', checkQuery: 'SELECT {value:Type:Not A Type}' }, /not one of its values/]
  ]
  for (const [bad, expected] of cases) {
    RULES.push(bad)
    let problems
    try {
      problems = rules.validate()
    } finally {
      RULES.pop()
    }
    assert.ok(problems.some(p => expected.test(p)),
      `a rule that ${expected} was accepted. Problems were:\n${problems.join('\n') || '  none at all'}`)
  }
  assert.deepStrictEqual(rules.validate(), [], 'the manifest was left modified by this test')
})

if (failures) {
  console.log(`\n${failures} failed.\n`)
  process.exit(1)
}
console.log('\nAll checks passed.\n')

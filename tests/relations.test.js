'use strict'

/**
 * Tests for phase B: the relation statements, and the check that says whether a
 * relation is really there and pointing the way it should.
 *
 * The statements below are the ones measured against a live workspace on
 * 2026-08-18. That matters most for self-relations, where the tool's own
 * documentation shows a two-statement form, one column per side. The measured
 * behaviour is that ONE statement creates both sides. Following the
 * documentation would have created four properties where the design wants two,
 * which is the duplicate this plugin is arranged to avoid, arrived at by doing
 * what the docs said.
 *
 * Run: node tests/relations.test.js
 */

const path = require('path')
const assert = require('assert')

const ROOT = path.join(__dirname, '..')
const relations = require(path.join(ROOT, 'plugins/setup/scripts/relations.js'))
const { RELATIONS, counts } = require(path.join(ROOT, 'plugins/setup/scripts/manifest.js'))

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

const relation = n => RELATIONS.find(r => r.n === n)

const IDS = {
  process:  { databaseId: 'db-process',  dataSourceId: 'ds-process'  },
  memos:    { databaseId: 'db-memos',    dataSourceId: 'ds-memos'    },
  projects: { databaseId: 'db-projects', dataSourceId: 'ds-projects' },
  tasks:    { databaseId: 'db-tasks',    dataSourceId: 'ds-tasks'    },
  software: { databaseId: 'db-software', dataSourceId: 'ds-software' },
  calendar: { databaseId: 'db-calendar', dataSourceId: 'ds-calendar' }
}

/** A schema read-back where every relation was created correctly. */
function correctSchemas () {
  const out = { process: {}, memos: {}, projects: {}, tasks: {}, software: {}, calendar: {} }
  for (const r of RELATIONS) {
    out[r.from][r.property] = {
      name: r.property,
      type: 'relation',
      dataSourceUrl: `collection://${IDS[r.to].dataSourceId}`,
      // Measured 2026-08-18: a two-way relation carries propertyUrl and a
      // one-way one does not. It is the only difference in the read-back.
      ...(r.kind === 'two-way' ? { propertyUrl: `collectionProperty://${IDS[r.to].dataSourceId}/xxxx` } : {})
    }
    if (r.reverse) {
      out[r.to][r.reverse] = {
        name: r.reverse,
        type: 'relation',
        dataSourceUrl: `collection://${IDS[r.from].dataSourceId}`,
        propertyUrl: `collectionProperty://${IDS[r.from].dataSourceId}/yyyy`
      }
    }
  }
  return out
}

console.log('\nthe statements phase B sends\n')

check('a cross-database two-way relation is one statement', () => {
  assert.strictEqual(
    relations.statementFor(relation(4), IDS),
    `ADD COLUMN "Artifacts" RELATION('ds-process', DUAL 'Memos')`
  )
})

check('a self-relation is also one statement, not the two the tool docs show', () => {
  assert.strictEqual(
    relations.statementFor(relation(1), IDS),
    `ADD COLUMN "Parent" RELATION('ds-process', DUAL 'Child Docs')`
  )
})

check('a one-way relation has no DUAL, so nothing is created on the target', () => {
  assert.strictEqual(
    relations.statementFor(relation(11), IDS),
    `ADD COLUMN "Integrates with" RELATION('ds-software')`
  )
})

check('a collection:// url is accepted where a bare id is wanted', () => {
  const prefixed = { ...IDS, process: { dataSourceId: 'collection://ds-process' } }
  assert.strictEqual(relations.statementFor(relation(4), prefixed), relations.statementFor(relation(4), IDS))
})

check('phase B refuses to run before phase A has finished', () => {
  assert.throws(() => relations.statementFor(relation(4), {}), /has no data source id yet/)
})

check('every relation in the manifest produces a statement', () => {
  const all = Object.values(IDS).length
  assert.ok(all > 0)
  const produced = RELATIONS.map(r => relations.statementFor(r, IDS))
  assert.strictEqual(produced.length, counts.relations)
  assert.strictEqual(new Set(produced).size, counts.relations, 'two relations produced the same statement')
})

console.log('\nverifyRelation catches what it claims to catch\n')

const complains = (n, breakIt, mustMention) => {
  const schemas = correctSchemas()
  breakIt(schemas)
  const problems = relations.verifyRelation(relation(n), schemas, IDS)
  assert.ok(problems.length > 0, `passed something it should have caught (expected a complaint about ${mustMention})`)
  assert.ok(problems.join('\n').includes(mustMention),
    `complained about the wrong thing.\n  wanted: ${mustMention}\n  got:\n${problems.join('\n')}`)
}

check('a correctly built set of relations passes', () => {
  const problems = relations.verifyAll(correctSchemas(), IDS)
  assert.strictEqual(problems.length, 0, problems.join('\n'))
})

check('a missing relation is caught', () => {
  complains(4, s => { delete s.memos.Artifacts }, 'missing from Memos')
})

check('a relation built one-way where the design says two-way is caught', () => {
  // This is the failure that has no other symptom: the property is there, it
  // points at the right database, and the far side simply never appears.
  complains(4, s => { delete s.memos.Artifacts.propertyUrl }, 'created one-way where the design says two-way')
})

check('a relation built two-way where the design says one-way is caught', () => {
  complains(11, s => { s.software['Integrates with'].propertyUrl = 'collectionProperty://ds-software/zzzz' },
    'created two-way where the design says one-way')
})

check('a missing property on the far side is caught', () => {
  complains(4, s => { delete s.process.Memos }, 'has no "Memos"')
})

check('a relation pointing at the wrong database is caught', () => {
  complains(4, s => { s.memos.Artifacts.dataSourceUrl = 'collection://ds-tasks' }, 'points at')
})

check('a property of the wrong type is caught', () => {
  complains(4, s => { s.memos.Artifacts.type = 'text' }, 'expected a relation, got text')
})

check('a far side pointing somewhere else is caught', () => {
  complains(4, s => { s.process.Memos.dataSourceUrl = 'collection://ds-tasks' }, 'rather than back at')
})

check('a database that was never read back is said to be unverified, not passed', () => {
  const schemas = correctSchemas()
  delete schemas.memos
  const problems = relations.verifyRelation(relation(4), schemas, IDS)
  assert.ok(problems.join('\n').includes('was not read back'))
})

console.log('\nre-running phase B\n')

check('nothing is missing when everything is there', () => {
  assert.strictEqual(relations.missing(correctSchemas(), IDS).length, 0)
})

check('a half-finished phase B lists only what is absent', () => {
  const schemas = correctSchemas()
  delete schemas.memos.Artifacts
  delete schemas.process.Memos
  const missing = relations.missing(schemas, IDS)
  assert.strictEqual(missing.length, 1)
  assert.strictEqual(missing[0].n, 4)
})

check('a repair run adds the missing relation and only that one', () => {
  const schemas = correctSchemas()
  delete schemas.memos.Artifacts
  delete schemas.process.Memos
  const statements = relations.repairStatements(schemas, IDS)
  assert.deepStrictEqual(Object.keys(statements), ['memos'])
  assert.strictEqual(statements.memos, `ADD COLUMN "Artifacts" RELATION('ds-process', DUAL 'Memos')`)
})

check('a relation that is present but wrong is never added a second time', () => {
  // Adding it again is how duplicates appear, and a duplicate cannot be
  // repaired by this plugin: it does not delete anything, ever.
  const schemas = correctSchemas()
  delete schemas.memos.Artifacts.propertyUrl
  assert.strictEqual(relations.missing(schemas, IDS).length, 1, 'the broken relation should be reported')
  assert.deepStrictEqual(relations.repairStatements(schemas, IDS), {}, 'and it should not be re-added')
})

check('the relation property names include both directions', () => {
  const names = relations.propertyNamesFor('process')
  assert.ok(names.includes('Parent'), 'the ones this database owns')
  assert.ok(names.includes('Memos'), 'and the ones other databases put on it')
})

console.log(failures ? `\n${failures} failed.\n` : `\nAll checks passed. ${counts.relations} relations.\n`)
process.exit(failures ? 1 : 0)

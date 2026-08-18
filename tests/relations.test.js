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

// Looked up by what it is, not by its number. The numbers shifted on 2026-08-18
// when relation 5 was dropped, and two tests here silently started exercising a
// different relation than the one they are named after.
const numberOf = (from, property) => RELATIONS.find(r => r.from === from && r.property === property).n
const INTEGRATES_WITH = numberOf('software', 'Integrates with')

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
    relations.statementFor(relation(INTEGRATES_WITH), IDS),
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
  complains(INTEGRATES_WITH, s => { s.software['Integrates with'].propertyUrl = 'collectionProperty://ds-software/zzzz' },
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

check('a near side that is present and correct is not announced as the wrong one', () => {
  // The relation is missing because the FAR half is gone. The near half is
  // there and correct, and the reason used to call it wrong, which points a
  // person at the half that is fine.
  const relation = RELATIONS.find(r => r.from === 'memos' && r.property === 'Artifacts')
  const schemas = correctSchemas()
  delete schemas.process[relation.reverse]

  const problems = relations.verifyRelation(relation, schemas, IDS).join('\n')
  assert.ok(problems.includes(relation.reverse), `the fixture is wrong: the far half should be the thing reported:\n${problems}`)

  const said = relations.unrepairable(schemas, IDS).find(u => u.n === relation.n)
  assert.ok(said, 'it was withheld without saying so')
  assert.ok(!/wrong/.test(said.reason), `the near half is correct and was described as wrong:\n${said.reason}`)
})

check('a two-way relation whose far side survived is never re-added', () => {
  // The near side was deleted and Notion left the synced property standing on
  // the far database. Re-adding the near side sends the SAME statement that
  // builds a fresh two-way pair, so it asks for a counterpart that is already
  // there.
  //
  // Measured 2026-08-18: `repairStatements` produced a byte-identical statement
  // for this fixture and for the one above, where both sides are genuinely
  // gone. It decides on the near side alone, so it cannot tell them apart.
  // Whether Notion then leaves two properties on the far side is NOT measured
  // and would need a live workspace. This takes the safe direction and reports
  // instead of sending.
  const relation = RELATIONS.find(r => r.from === 'memos' && r.property === 'Artifacts')
  const schemas = correctSchemas()
  delete schemas.memos.Artifacts

  assert.ok(schemas.process[relation.reverse], 'the fixture is wrong: the far side should still be there')
  assert.ok(relations.missing(schemas, IDS).some(r => r.n === relation.n), 'the broken relation should be reported')
  assert.deepStrictEqual(relations.repairStatements(schemas, IDS), {}, 'and it should not be re-added')

  const said = relations.unrepairable(schemas, IDS).find(u => u.n === relation.n)
  assert.ok(said, 'skipping it silently is the same as not noticing it')
  assert.ok(said.reason.includes(relation.reverse) && /already has/.test(said.reason),
    `the reason should name the surviving far side property:\n${said.reason}`)
})

check('a self-relation whose far side survived is never re-added', () => {
  // Both halves live on one database, so this is the case a cross-database
  // fixture cannot reach.
  const relation = RELATIONS.find(r => r.self && r.kind === 'two-way')
  const schemas = correctSchemas()
  delete schemas[relation.from][relation.property]

  assert.ok(schemas[relation.to][relation.reverse], 'the fixture is wrong: the far side should still be there')
  // Asserted before the repair is asked about. Without this the test passes if
  // the fixture failed to delete the near side, or if `missing` stopped
  // reporting the relation at all, which are both the thing going wrong rather
  // than the guard working.
  assert.ok(relations.missing(schemas, IDS).some(r => r.n === relation.n), 'the broken relation should be reported')
  assert.strictEqual(relations.repairStatements(schemas, IDS)[relation.from], undefined,
    'a self-relation was rebuilt while its other half was still on the database')
  const said = relations.unrepairable(schemas, IDS).find(u => u.n === relation.n)
  assert.ok(said && /already has/.test(said.reason), `the reason should name the surviving far side:\n${said && said.reason}`)
})

check('a far side of the wrong type still withholds the repair, and is not called a synced half', () => {
  // The guard refuses on the NAME being taken, and a property of any type takes
  // the name. The reason has to be true of all of them.
  const relation = RELATIONS.find(r => r.from === 'memos' && r.property === 'Artifacts')
  const schemas = correctSchemas()
  delete schemas.memos.Artifacts
  schemas.process[relation.reverse] = { name: relation.reverse, type: 'rich_text' }

  assert.strictEqual(relations.repairStatements(schemas, IDS).memos, undefined,
    'a relation was rebuilt into a name that was already taken')
  const said = relations.unrepairable(schemas, IDS).find(u => u.n === relation.n)
  assert.ok(said, 'it was withheld without saying so')
  assert.ok(!/syncs/.test(said.reason), `a rich_text property was described as the half Notion syncs:\n${said.reason}`)
})

check('a relation whose far side was never read back is not re-added', () => {
  // Not knowing is not the same as knowing it is absent, and only one of the
  // two is safe to send a statement about.
  const relation = RELATIONS.find(r => r.kind === 'two-way' && r.from !== r.to)
  const schemas = correctSchemas()
  delete schemas[relation.from][relation.property]
  delete schemas[relation.to]

  // Its own database only. Removing the far side's schema also makes every
  // relation that STARTS there read as absent, and those are a different case.
  assert.strictEqual(relations.repairStatements(schemas, IDS)[relation.from], undefined,
    'a relation was rebuilt without anybody having looked at the side it syncs to')
  const said = relations.unrepairable(schemas, IDS).find(u => u.n === relation.n)
  assert.ok(said && /not read back/.test(said.reason), `the reason should say the far side was not read back:\n${said && said.reason}`)
})

check('a relation that is present but wrong is reported as unrepairable, not dropped', () => {
  const schemas = correctSchemas()
  delete schemas.memos.Artifacts.propertyUrl
  const relation = RELATIONS.find(r => r.from === 'memos' && r.property === 'Artifacts')
  const said = relations.unrepairable(schemas, IDS).find(u => u.n === relation.n)
  assert.ok(said, 'the existing guard skipped it without saying so, which reads as nothing being wrong')
  assert.ok(/already carries/.test(said.reason), `the reason should say the property is already there:\n${said.reason}`)
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

console.log('\nwhat the check used to skip rather than fail\n')

check('a relation is not passed just because the config forgot where it points', () => {
  // The destination check used to be gated on the target being in the config,
  // so a workspace read back but never recorded had every relation destination
  // go unchecked and every relation pass.
  const withoutTarget = { ...IDS }
  delete withoutTarget.memos
  const problems = relations.verifyRelation(relation(4), correctSchemas(), withoutTarget)
  assert.ok(problems.length > 0, 'an unrecorded target should not be a pass')
  assert.ok(problems.join('\n').includes('not recorded in the config'), problems.join('\n'))
})

check('the far side with no synced counterpart at all is caught', () => {
  // The near side was fixed and the far side kept the old shape:
  // `if (propertyUrl && back && !same)` reported nothing when propertyUrl was
  // absent. Reverting that branch fails this.
  complains(4, s => { delete s.process.Memos.propertyUrl }, 'has no synced counterpart')
})

check('the far side with a counterpart url this cannot parse is caught', () => {
  complains(4, s => { s.process.Memos.propertyUrl = 'wrong-shape' }, 'cannot be checked')
})

check('a relation pointing at nothing is caught', () => {
  // What the previous version of this test actually checked, under the name of
  // something else. Keeping it, with the honest title.
  const schemas = correctSchemas()
  delete schemas.memos.Artifacts.dataSourceUrl
  const problems = relations.verifyRelation(relation(4), schemas, IDS)
  assert.ok(problems.some(p => p.includes('points at nothing')), problems.join('\n'))
})

check('two missing data source ids do not count as pointing at the same place', () => {
  // sameDataSource returned true when both sides were absent, which is a check
  // answering "I do not know" with "yes".
  //
  // Asserted directly, because it cannot be reached any other way: both callers
  // in verifyRelation now report a missing id themselves before they get here.
  // Two earlier versions of this test went through verifyRelation and passed
  // with the guard reverted, having exercised a different branch entirely.
  assert.strictEqual(relations.sameDataSource(undefined, undefined), false)
  assert.strictEqual(relations.sameDataSource('', ''), false)
  assert.strictEqual(relations.sameDataSource('ds-memos', undefined), false)
  assert.strictEqual(relations.sameDataSource('collection://ds-memos', 'ds-memos'), true)
})

check('a synced counterpart living on the wrong database is caught', () => {
  // It used to be enough for propertyUrl to exist. Where it pointed was never
  // read, which is one bit for the thing that separates two-way from one-way.
  complains(4, s => { s.memos.Artifacts.propertyUrl = 'collectionProperty://ds-calendar/xxxx' }, 'its synced counterpart sits on')
})

check('a counterpart url in a shape this cannot read is said out loud', () => {
  complains(4, s => { s.memos.Artifacts.propertyUrl = 'something-else-entirely' }, 'cannot be checked')
})

check('the far side pointing at the wrong database is caught by its counterpart too', () => {
  complains(4, s => { s.process.Memos.propertyUrl = 'collectionProperty://ds-tasks/yyyy' }, 'rather than back at')
})

console.log(failures ? `\n${failures} failed.\n` : `\nAll checks passed. ${counts.relations} relations.\n`)
process.exit(failures ? 1 : 0)

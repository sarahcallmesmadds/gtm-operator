'use strict'

/**
 * Tests for the config file and for `verify`, the step that decides whether an
 * install worked.
 *
 * THE CONFIG PATH IS OVERRIDDEN BEFORE ANYTHING IS REQUIRED. These tests write
 * real files, and the file they would otherwise write is the live one holding
 * the ids of six real databases. A test that writes to the thing it is testing
 * the writing of is not a test, it is an incident.
 *
 * Run: node tests/install.test.js
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const assert = require('assert')

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'gtm-operator-test-'))
process.env.GTM_OPERATOR_CONFIG = path.join(SANDBOX, 'gtm-operator.config.json')

const ROOT = path.join(__dirname, '..')
const config = require(path.join(ROOT, 'plugins/setup/scripts/config.js'))
const install = require(path.join(ROOT, 'plugins/setup/scripts/install.js'))
const { DATABASES, VIEWS, counts } = require(path.join(ROOT, 'plugins/setup/scripts/manifest.js'))
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

const reset = () => { if (fs.existsSync(config.CONFIG_PATH)) fs.unlinkSync(config.CONFIG_PATH) }

console.log('\nthe config file\n')

check('it is not written anywhere near the real one during a test', () => {
  assert.ok(config.CONFIG_PATH.startsWith(SANDBOX), `tests would have written to ${config.CONFIG_PATH}`)
})

check('a run starts as creating, not as complete', () => {
  reset()
  const started = config.begin('parent-page')
  assert.strictEqual(started.state, 'creating')
  assert.strictEqual(started.notion.parentPageId, 'parent-page')
  assert.strictEqual(started.notion.personId, null)
})

check('a second begin with a different parent page is refused, not silently obeyed', () => {
  reset()
  config.begin('00000000-0000-4000-8000-00000000aaaa')
  assert.throws(
    () => config.begin('00000000-0000-4000-8000-00000000bbbb'),
    /already records .* as the parent page/,
    'a retry that created a second page would have moved the install to it, leaving the first page and anything under it behind'
  )
  assert.strictEqual(
    config.read().notion.parentPageId,
    '00000000-0000-4000-8000-00000000aaaa',
    'the refused call still changed the recorded parent'
  )
})

check('the same page in a different shape is the same page, and is allowed', () => {
  reset()
  const dashed = '00000000-0000-4000-8000-00000000aaaa'
  const bare = '0000000000004000800000000000aaaa'
  config.begin(dashed)
  const again = config.begin(bare)
  assert.strictEqual(again.state, 'creating', 'a retry pasting the same page in its other shape was refused as a different page')
  assert.strictEqual(again.notion.parentPageId, bare, 'the id given last is the one recorded')
})

check('the same page as a url and as an id is the same page, which a dash stripper would miss', () => {
  reset()
  const bare = '0000000000004000800000000000aaaa'
  config.begin('https://app.notion.com/p/' + bare)
  const again = config.begin(bare)
  assert.strictEqual(
    again.state,
    'creating',
    'the url and the id name one page, and a guard that only strips dashes cannot tell'
  )
})

check('two different things that are not page references at all are still refused', () => {
  reset()
  config.begin('parent-page')
  assert.throws(
    () => config.begin('some-other-page'),
    /already records .* as the parent page/,
    'two values this cannot parse as pages are still two different strings, and a guard that shrugs at what it cannot parse is not a guard'
  )
})

check('the same unparseable value twice is one parent, not two', () => {
  reset()
  config.begin('parent-page')
  const again = config.begin('parent-page')
  assert.strictEqual(
    again.state,
    'creating',
    'the literal fallback refused a value that matched itself, so nothing that is not a page id can ever be retried'
  )
})

check('a page id on one side and something unparseable on the other is refused', () => {
  reset()
  config.begin('0000000000004000800000000000aaaa')
  assert.throws(
    () => config.begin('parent-page'),
    /already records .* as the parent page/,
    'one side parsing and the other not is missing evidence, and missing evidence is not a match'
  )
})

check('both ids are stored for every database, never just one', () => {
  reset()
  config.begin('parent-page')
  config.recordDatabase('process', { databaseId: 'db-1', dataSourceId: 'ds-1' })
  const stored = config.read().databases.process
  assert.strictEqual(stored.databaseId, 'db-1')
  assert.strictEqual(stored.dataSourceId, 'ds-1')
})

check('recording one id and not the other is refused', () => {
  reset()
  config.begin('parent-page')
  assert.throws(() => config.recordDatabase('process', { databaseId: 'db-1' }), /data source id/)
})

check('a database that is not in the manifest is refused', () => {
  reset()
  config.begin('parent-page')
  assert.throws(() => config.recordDatabase('teammates', { databaseId: 'x', dataSourceId: 'y' }), /not a database in the manifest/)
})

check('a second database for a name already recorded is refused, not overwritten', () => {
  // This is the one that stops a re-run quietly pointing config at a second
  // Process and orphaning the first, which holds the user's rows.
  reset()
  config.begin('parent-page')
  config.recordDatabase('process', { databaseId: 'db-1', dataSourceId: 'ds-1' })
  assert.throws(() => config.recordDatabase('process', { databaseId: 'db-2', dataSourceId: 'ds-2' }), /a person has to say which one to keep/)
})

check('recording the same database twice is fine, so a retry is not punished', () => {
  reset()
  config.begin('parent-page')
  config.recordDatabase('process', { databaseId: 'db-1', dataSourceId: 'ds-1' })
  config.recordDatabase('process', { databaseId: 'db-1', dataSourceId: 'ds-1' })
  assert.strictEqual(Object.keys(config.read().databases).length, 1)
})

check('no person id is recorded as an explicit null, not left absent', () => {
  reset()
  config.begin('parent-page')
  config.recordPerson(null)
  assert.strictEqual(config.read().notion.personId, null)
})

check('a config from a future version is refused rather than misread', () => {
  reset()
  fs.writeFileSync(config.CONFIG_PATH, JSON.stringify({ configVersion: 99, state: 'complete' }))
  assert.throws(() => config.read(), /Refusing to read it/)
})

check('a config that will not parse is never overwritten', () => {
  reset()
  fs.writeFileSync(config.CONFIG_PATH, '{ this is not json')
  assert.throws(() => config.read(), /may hold the only record/)
  assert.strictEqual(fs.readFileSync(config.CONFIG_PATH, 'utf8'), '{ this is not json')
})

check('an install is not complete until it has been verified', () => {
  reset()
  config.begin('parent-page')
  for (const d of DATABASES) config.recordDatabase(d.key, { databaseId: `db-${d.key}`, dataSourceId: `ds-${d.key}` })
  assert.throws(() => config.complete(), /no verify has passed/)
})

check('an install missing a database cannot be completed', () => {
  reset()
  config.begin('parent-page')
  config.recordDatabase('process', { databaseId: 'db-1', dataSourceId: 'ds-1' })
  assert.throws(() => config.complete(), /not recorded/)
})

check('a complete install cannot be started over by accident', () => {
  reset()
  config.begin('parent-page')
  for (const d of DATABASES) config.recordDatabase(d.key, { databaseId: `db-${d.key}`, dataSourceId: `ds-${d.key}` })
  config.recordVerified('2026-08-18T00:00:00Z')
  config.complete()
  assert.throws(() => config.begin('parent-page'), /already complete/)
})

// `recordPerson` used to clear the proof, which demoted state to `creating`,
// and `creating` is the whole of what the refusal above tests for. Saving a
// person was therefore a way to get past it. The refusal is asserted here as
// well as the state, because a fix that kept `state` and dropped the proof
// would satisfy a state-only check while leaving `complete` unreachable.
check('recording a person does not demote a finished install', () => {
  reset()
  config.begin('parent-page')
  for (const d of DATABASES) config.recordDatabase(d.key, { databaseId: `db-${d.key}`, dataSourceId: `ds-${d.key}` })
  config.recordVerified('2026-08-18T00:00:00Z')
  config.complete()

  const after = config.recordPerson('person-1')
  assert.strictEqual(after.notion.personId, 'person-1')
  assert.strictEqual(after.state, 'complete', 'saving a person knocked the install back to creating')
  assert.strictEqual(after.verifiedAt, '2026-08-18T00:00:00Z', 'saving a person threw away a proof it does not affect')
  assert.throws(
    () => config.begin('parent-page'),
    /already complete/,
    'saving a person opened the door to installing over a finished workspace'
  )
})

check('clearing a person does not demote a finished install either', () => {
  // The null path is the one a tier 3 install takes, so it is the likelier of
  // the two to run and was equally able to defeat the refusal.
  reset()
  config.begin('parent-page')
  for (const d of DATABASES) config.recordDatabase(d.key, { databaseId: `db-${d.key}`, dataSourceId: `ds-${d.key}` })
  config.recordVerified('2026-08-18T00:00:00Z')
  config.complete()

  const after = config.recordPerson(null)
  assert.strictEqual(after.notion.personId, null)
  assert.strictEqual(after.state, 'complete')
  assert.throws(() => config.begin('parent-page'), /already complete/)
})

console.log('\nthe plan\n')

check('phase A creates every database and puts no relation in any of them', () => {
  reset()
  const steps = install.phaseA('parent-page')
  assert.strictEqual(steps.length, counts.databases)
  for (const step of steps) assert.ok(!step.arguments.schema.includes('RELATION('), `${step.title} has a relation in its create statement`)
})

check('phase A leaves out what config already records, so a resume does not create a second one', () => {
  reset()
  config.begin('parent-page')
  config.recordDatabase('process', { databaseId: 'db-process', dataSourceId: 'ds-process' })
  config.recordDatabase('memos', { databaseId: 'db-memos', dataSourceId: 'ds-memos' })
  const steps = install.phaseA('parent-page')
  assert.strictEqual(
    steps.length,
    counts.databases - 2,
    'phase A offered to create databases that config already records, and record refuses a duplicate only after the create call has been sent'
  )
  assert.ok(!steps.some(s => s.key === 'process' || s.key === 'memos'), steps.map(s => s.key).join(', '))
})

check('phase B refuses to build a statement it has no id for', () => {
  assert.throws(() => install.phaseB({}), /has no data source id yet/)
})

check('the plan can still be printed before anything exists, which is when it is shown', () => {
  // The plan is what the one confirmation gate shows, and the gate is before
  // anything is created. On a first run there are no ids at all, so this is the
  // ordinary case rather than an edge one.
  reset()
  const ids = install.planningIds()
  assert.strictEqual(Object.keys(ids).length, counts.databases)
  assert.doesNotThrow(() => install.phaseA('<parent page id, from the question above>'))
  assert.doesNotThrow(() => install.phaseB(ids))
  assert.doesNotThrow(() => install.viewCalls(ids))
})

check('and the command that prints it actually runs, on an empty config', () => {
  // A text check on the functions above would pass while the CLI wrapping them
  // threw. This runs the command a person is told to run.
  reset()
  const { execFileSync } = require('child_process')
  const printed = execFileSync('node', [path.join(ROOT, 'plugins/setup/scripts/install.js'), 'plan'], {
    env: { ...process.env, GTM_OPERATOR_CONFIG: config.CONFIG_PATH },
    encoding: 'utf8'
  })
  assert.ok(printed.includes('Phase A'), printed)
  assert.ok(printed.includes('Phase B'), printed)
  for (const d of DATABASES) assert.ok(printed.includes(d.title), `the plan never mentions ${d.title}`)
  for (const view of VIEWS) assert.ok(printed.includes(view.name), `the plan never mentions the ${view.name} view`)
})

check('every view call names the database id and the data source id', () => {
  reset()
  config.begin('parent-page')
  for (const d of DATABASES) config.recordDatabase(d.key, { databaseId: `db-${d.key}`, dataSourceId: `ds-${d.key}` })
  const calls = install.viewCalls(config.ids())
  assert.strictEqual(calls.length, VIEWS.length)
  for (const call of calls) {
    assert.ok(call.arguments.database_id.startsWith('db-'), `${call.name} has no database id`)
    assert.ok(call.arguments.data_source_id.startsWith('ds-'), `${call.name} has no data source id`)
  }
})

console.log('\nverify, the only thing that reports success\n')

/** A read-back where the whole install went correctly. */
function goodReadback () {
  const databases = {}
  for (const d of DATABASES) {
    const properties = {}
    for (const p of schema.DATABASES[d.key].properties) {
      const type = p.type === 'text' ? 'text' : p.type === 'person' ? 'person' : p.type
      // Every property carries a description, empty where there is none.
      // Measured against the live workspace 2026-08-18 on Projects and Software:
      // Notion returns the key on all of them. This builder omitted it, so the
      // verifier's description check was never exercised here at all.
      properties[p.name] = { name: p.name, type, description: p.description || '' }
      if (p.options) properties[p.name].options = p.options.map(([name, color]) => ({ name, color }))
    }
    databases[d.key] = { schema: properties, views: [] }
  }

  for (const r of relations.propertyNamesFor('process')) void r

  const { RELATIONS } = require(path.join(ROOT, 'plugins/setup/scripts/manifest.js'))
  for (const r of RELATIONS) {
    databases[r.from].schema[r.property] = {
      name: r.property,
      type: 'relation',
      description: '',
      dataSourceUrl: `collection://ds-${r.to}`,
      ...(r.kind === 'two-way' ? { propertyUrl: `collectionProperty://ds-${r.to}/xxxx` } : {})
    }
    if (r.reverse) {
      databases[r.to].schema[r.reverse] = {
        name: r.reverse,
        type: 'relation',
        description: '',
        dataSourceUrl: `collection://ds-${r.from}`,
        propertyUrl: `collectionProperty://ds-${r.from}/yyyy`
      }
    }
  }

  const views = require(path.join(ROOT, 'plugins/setup/scripts/views.js'))
  const notionType = (database, property) => {
    const definition = views.propertiesFor(database).get(property)
    return views.NOTION_PROPERTY_TYPE[definition.type]
  }

  // Built to match what Notion was measured to return on 2026-08-18, recorded
  // in tests/fixtures/full-install-as-notion-returned-it.json, rather than to
  // whatever the verifier happened to accept. Before that fixture was compared
  // against, this builder emitted one flat AND group with no property types and
  // no grouping, which is a shape Notion never produces, and the test named "a
  // correct install passes" was passing against it.
  for (const view of VIEWS) {
    const clauses = (view.filter || []).map(condition => {
      const op = views.OPS[condition.op]
      const propertyType = notionType(view.database, condition.property)
      const leaf = value => ({
        type: 'property',
        property: condition.property,
        propertyType,
        operator: op.readsBackAs,
        ...(value === null ? {} : { value: { type: 'exact', value } })
      })
      if (op.arity === 'many') return { type: 'group', operator: 'or', filters: condition.values.map(leaf) }
      return { type: 'group', operator: 'and', filters: [leaf(op.arity === 'one' ? condition.value : null)] }
    })

    // One clause comes back as the top group itself, more than one comes back
    // as a sub-group each. Both measured.
    const advancedFilter = !clauses.length
      ? null
      : clauses.length === 1
        ? clauses[0]
        : { type: 'group', operator: 'and', filters: clauses }

    databases[view.database].views.push({
      name: view.name,
      type: view.layout,
      ...(view.calendarBy ? { calendarBy: view.calendarBy } : {}),
      ...(view.groupBy ? { groupBy: { property: view.groupBy, propertyType: notionType(view.database, view.groupBy) } } : {}),
      ...(advancedFilter ? { advancedFilter } : {}),
      sorts: (view.sort || []).map(s => ({ property: s.property, direction: s.direction === 'DESC' ? 'descending' : 'ascending' }))
    })
  }

  return { databases }
}

const setUpConfig = () => {
  reset()
  config.begin('parent-page')
  for (const d of DATABASES) config.recordDatabase(d.key, { databaseId: `db-${d.key}`, dataSourceId: `ds-${d.key}` })
}

check('a correct install passes', () => {
  setUpConfig()
  const { problems } = install.verify(goodReadback())
  assert.strictEqual(problems.length, 0, problems.join('\n'))
})

check('the relation properties are not reported as somebody else additions', () => {
  setUpConfig()
  const { problems } = install.verify(goodReadback())
  assert.ok(!problems.join('\n').includes('present in Notion and not in the schema'))
})

check('a database that was never read back is a failure, not a pass', () => {
  setUpConfig()
  const readback = goodReadback()
  delete readback.databases.calendar
  const { problems } = install.verify(readback)
  assert.ok(problems.join('\n').includes('nothing was read back for it'))
})

check('a missing property is caught', () => {
  setUpConfig()
  const readback = goodReadback()
  delete readback.databases.process.schema['Review cadence']
  const { problems } = install.verify(readback)
  assert.ok(problems.join('\n').includes('Review cadence: missing'))
})

check('a missing relation is caught', () => {
  setUpConfig()
  const readback = goodReadback()
  delete readback.databases.calendar.schema.Project
  const { problems } = install.verify(readback)
  assert.ok(problems.join('\n').includes('missing from Calendar'))
})

check('a missing view is caught', () => {
  setUpConfig()
  const readback = goodReadback()
  readback.databases.tasks.views = []
  const { problems } = install.verify(readback)
  assert.ok(problems.join('\n').includes('not found on the database'))
})

check('a view whose filter was discarded is caught', () => {
  setUpConfig()
  const readback = goodReadback()
  const view = readback.databases.projects.views.find(v => v.name === 'Needs attention')
  view.advancedFilter = { type: 'group', operator: 'and', filters: [] }
  const { problems } = install.verify(readback)
  assert.ok(problems.join('\n').includes('silently discarded'))
})

console.log('\nand the half that reading a filter back cannot prove\n')

check('a view whose rows were never checked says so, rather than passing quietly', () => {
  // The 2026-08-18 measurement: a filter can read back perfectly and match
  // nothing. Silence here would be the plugin making the same mistake it was
  // built to catch.
  setUpConfig()
  const { problems, unchecked, verified } = install.verify(goodReadback())
  assert.strictEqual(problems.length, 0)
  assert.ok(unchecked.some(n => n.includes('which rows it returns was not checked')), unchecked.join('\n'))
  // Nothing wrong, and still not verified. That distinction is the fix.
  assert.strictEqual(verified, false)
})

check('a view returning different rows from its own rule is caught', () => {
  setUpConfig()
  const readback = goodReadback()
  readback.viewRows = { 'projects::Needs attention': [] }
  readback.sqlRows = { 'projects::Needs attention': ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1'] }
  const { problems } = install.verify(readback)
  assert.ok(problems.join('\n').includes('different rows from the rule'), problems.join('\n'))
})

check('a view whose two rows match its rule is reported proved', () => {
  // Titled for what it proves. It used to claim it covered the row COMPARISON,
  // and it does not: both sides are valid page ids in a different order, which
  // the element-by-element comparison and the join it replaced accept equally,
  // so reverting the comparison leaves this green. The comparison cannot be
  // reached from here at all, and the reason is recorded at the comparison
  // itself in install.js rather than implied by a name here.
  setUpConfig()
  const readback = goodReadback()
  readback.viewRows = { 'projects::Needs attention': ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2'] }
  readback.sqlRows = { 'projects::Needs attention': ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1'] }
  const { problems, unchecked } = install.verify(readback)
  assert.strictEqual(problems.length, 0, problems.join('\n'))
  assert.ok(!unchecked.some(n => n.includes('projects') && n.includes('Needs attention')))
})

check('two empty row sets prove nothing, and are not a pass', () => {
  // The whole point. Both sides empty used to compare equal and report the view
  // as proved, so on a fresh workspace every filtered view "passed" without a
  // single row ever being looked at.
  setUpConfig()
  const readback = goodReadback()
  readback.viewRows = { 'projects::Needs attention': [] }
  readback.sqlRows = { 'projects::Needs attention': [] }
  const { problems, unchecked, verified } = install.verify(readback)
  assert.strictEqual(problems.length, 0, problems.join('\n'))
  assert.ok(unchecked.some(n => n.includes('neither one proved the other')), unchecked.join('\n'))
  assert.strictEqual(verified, false)
})

check('one side empty and the other not is a mismatch, not an unchecked view', () => {
  // The fix for the line above must not swallow this one with it.
  setUpConfig()
  const readback = goodReadback()
  readback.viewRows = { 'projects::Needs attention': [] }
  readback.sqlRows = { 'projects::Needs attention': ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1'] }
  const { problems } = install.verify(readback)
  assert.ok(problems.join('\n').includes('different rows from the rule'), problems.join('\n'))
})

check('rows are compared by page identity, so a url and its id are the same row', () => {
  setUpConfig()
  const readback = goodReadback()
  readback.viewRows = { 'projects::Needs attention': ['https://app.notion.com/p/A-Project-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1'] }
  readback.sqlRows = { 'projects::Needs attention': ['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'] }
  const { problems } = install.verify(readback)
  assert.strictEqual(problems.length, 0, problems.join('\n'))
})

check('two different rows sharing a title are not averaged into one', () => {
  // Why the rule query selects url and not the title.
  setUpConfig()
  const readback = goodReadback()
  readback.viewRows = { 'projects::Needs attention': ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1'] }
  readback.sqlRows = { 'projects::Needs attention': ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2'] }
  const { problems } = install.verify(readback)
  assert.ok(problems.join('\n').includes('different rows from the rule'), problems.join('\n'))
})

check('rows recorded as titles are refused, not proved', () => {
  // The one that mattered. pageIdentity used to hand back anything it did not
  // recognise, so two lists of titles matched each other and the view was
  // reported proved with no identity compared at all. Reverting either half of
  // that fix fails this.
  setUpConfig()
  const readback = goodReadback()
  readback.viewRows = { 'projects::Needs attention': ['Unscoped project'] }
  readback.sqlRows = { 'projects::Needs attention': ['Unscoped project'] }
  const { problems, verified } = install.verify(readback)
  assert.ok(problems.join('\n').includes('cannot prove which rows came back'), problems.join('\n'))
  assert.strictEqual(verified, false)
})

check('a row named with the comparison separator is refused before it can collide', () => {
  // This used to be titled as a test of the row COMPARISON, and it is not one.
  // A single row called "alpha | beta" did once compare equal to two rows called
  // "alpha" and "beta", because the two lists were joined on ' | ' first. That
  // collision is now closed one step earlier, by pageIdentity refusing anything
  // that is not a page reference, and this test never reaches the comparison at
  // all: reverting the element-by-element comparison back to a join leaves it
  // green.
  //
  // Kept under a title that says what it proves. The comparison itself cannot be
  // tested through this path, because every value that survives pageIdentity is
  // 32 hex characters and none of them can contain a separator. That is recorded
  // at the comparison in install.js rather than implied by a test name here.
  setUpConfig()
  const readback = goodReadback()
  readback.viewRows = { 'projects::Needs attention': ['alpha | beta'] }
  readback.sqlRows = { 'projects::Needs attention': ['alpha', 'beta'] }
  const { problems, verified } = install.verify(readback)
  assert.ok(problems.join('\n').includes('cannot prove which rows came back'), problems.join('\n'))
  assert.strictEqual(verified, false)
})

console.log('\nwhat complete will accept as proof\n')

check('complete refuses when no verify has passed', () => {
  setUpConfig()
  assert.throws(() => config.complete(), /no verify has passed/)
})

check('complete accepts a verify that was recorded', () => {
  setUpConfig()
  config.recordVerified('2026-08-18T00:00:00Z')
  const done = config.complete()
  assert.strictEqual(done.state, 'complete')
  assert.strictEqual(done.verifiedAt, '2026-08-18T00:00:00Z')
})

check('recording a database after a verify throws the verify away', () => {
  // Otherwise complete rests on a proof taken against a different workspace.
  setUpConfig()
  config.recordVerified('2026-08-18T00:00:00Z')
  config.recordDatabase('process', { databaseId: 'db-process', dataSourceId: 'ds-process' })
  assert.throws(() => config.complete(), /no verify has passed/)
})

check('a database recorded twice with a different database id is refused', () => {
  // The guard used to compare the data source id alone, so this overwrote.
  setUpConfig()
  assert.throws(
    () => config.recordDatabase('process', { databaseId: 'db-somewhere-else', dataSourceId: 'ds-process' }),
    /has to say which one to keep/
  )
})

check('status hands over the recorded ids, not only the titles', () => {
  setUpConfig()
  const reported = install.status()
  assert.ok(reported.recordedIds, 'status reported no ids at all, so nothing reading it can tell one Process from another')
  assert.deepStrictEqual(
    reported.recordedIds.process,
    { databaseId: 'db-process', dataSourceId: 'ds-process' },
    'the caller deciding whether a database under the parent belongs to this install has only a title to go on'
  )
})

check('status still reports on a config holding a key this version does not know', () => {
  setUpConfig()
  const current = config.read()
  current.databases.marketing_ops = { databaseId: 'db-x', dataSourceId: 'ds-x' }
  config.write(current)
  const reported = install.status()
  assert.ok(reported.recorded.some(r => r.includes('marketing_ops')), reported.recorded.join(', '))
})

/**
 * A read-back that verifies clean, rows and all.
 *
 * `goodReadback` deliberately carries no row evidence, because one of the checks
 * above is that a view whose rows were never supplied says so. Nothing built on
 * it can ever pass a whole verify, so anything testing the passing path needs
 * this instead.
 */
const provenReadback = () => {
  const readback = goodReadback()
  readback.viewRows = {}
  readback.sqlRows = {}
  VIEWS.filter(v => v.filter).forEach((view, index) => {
    const key = `${view.database}::${view.name}`
    const id = `${String(index).repeat(2)}aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`.slice(0, 32)
    readback.viewRows[key] = [id]
    readback.sqlRows[key] = [`https://app.notion.com/p/${id}`]
  })
  return readback
}

// Run the real CLI, because the point of these three is the command and not the
// helper it calls. The previous versions called recordVerified then
// clearVerified by hand and passed with the clearVerified call deleted from
// install.js entirely, which is the same "prove the helper, skip the command"
// fault they were written to close.
const runVerify = readbackPath => {
  const { execFileSync } = require('child_process')
  try {
    const out = execFileSync('node', [path.join(ROOT, 'plugins/setup/scripts/install.js'), 'verify', readbackPath], {
      env: { ...process.env, GTM_OPERATOR_CONFIG: config.CONFIG_PATH },
      encoding: 'utf8',
      stdio: 'pipe'
    })
    return { status: 0, output: out }
  } catch (error) {
    // The reason, not only the code. A test asserting "it failed" passes when it
    // failed for a completely different reason, which is how the preflight test
    // below was passing on a missing file rather than on the preflight.
    return {
      status: error.status === undefined ? 1 : error.status,
      output: `${error.stdout || ''}${error.stderr || ''}`
    }
  }
}

const writeReadback = (name, value) => {
  const file = path.join(SANDBOX, name)
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value))
  return file
}

check('a verify that fails leaves no usable record behind, through the CLI', () => {
  // The sequence that matters: one run passes, the workspace drifts, the next
  // run fails, and complete must refuse. Deleting the clearVerified call from
  // install.js fails this.
  setUpConfig()
  config.recordVerified('2026-08-18T00:00:00Z')

  // From a readback that WOULD pass, so the missing database is the only thing
  // wrong with it. Starting from goodReadback made this fail as "not proved",
  // because that one carries no row evidence on purpose, so the test stayed
  // green whatever happened to the mismatch it was written for.
  const broken = provenReadback()
  delete broken.databases.process
  const { status, output } = runVerify(writeReadback('broken.json', broken))

  assert.notStrictEqual(status, 0, 'a failing verify must not exit 0')
  assert.ok(output.includes('nothing was read back for it'), `it failed for the wrong reason:\n${output}`)
  assert.strictEqual(config.read().verified, null, 'the old record survived a failed verify')
  assert.throws(() => config.complete(), /no verify has passed/)
})

check('a readback that will not parse also leaves no usable record, through the CLI', () => {
  setUpConfig()
  config.recordVerified('2026-08-18T00:00:00Z')

  const { status, output } = runVerify(writeReadback('not-json.json', '{ this is not json'))

  assert.notStrictEqual(status, 0)
  assert.ok(/JSON/i.test(output), `it failed for the wrong reason:\n${output}`)
  assert.strictEqual(config.read().verified, null, 'a parse error left the old record standing')
})

check('a verify that dies on the definitions preflight leaves no usable record', () => {
  // The preflight exits before the command is dispatched, so clearing inside
  // the verify case was too late: correct the definitions afterwards and the
  // old proof is usable again with nothing checked in between.
  //
  // Run against a COPY of the scripts with a deliberately contradictory
  // manifest, because that is the only way to reach the preflight's exit as the
  // CLI really reaches it. Requiring install.js from another file does not work:
  // `require.main === module` is false there and the CLI block never runs at
  // all, which is how the first version of this test passed the wrong thing.
  setUpConfig()
  config.recordVerified('2026-08-18T00:00:00Z')

  const copy = path.join(SANDBOX, 'scripts')
  fs.mkdirSync(copy, { recursive: true })
  for (const file of fs.readdirSync(path.join(ROOT, 'plugins/setup/scripts'))) {
    fs.copyFileSync(path.join(ROOT, 'plugins/setup/scripts', file), path.join(copy, file))
  }
  const manifestPath = path.join(copy, 'manifest.js')
  const broken = fs.readFileSync(manifestPath, 'utf8').replace(
    'const VIEWS = [',
    "const VIEWS = [\n  { database: 'projects', name: 'Broken', layout: 'table', filter: [{ property: 'No Such Property', op: 'IS EMPTY' }], describe: 'deliberately contradictory' },"
  )
  fs.writeFileSync(manifestPath, broken)

  // A readback that would otherwise verify clean, so the preflight is the only
  // thing that can fail this. Pointing it at a file that does not exist made the
  // test pass on the missing file instead, which would have let the preflight
  // regression come straight back.
  const readbackPath = path.join(SANDBOX, 'preflight-readback.json')
  fs.writeFileSync(readbackPath, JSON.stringify(provenReadback()))

  const { execFileSync } = require('child_process')
  let status = 0
  let output = ''
  try {
    execFileSync('node', [path.join(copy, 'install.js'), 'verify', readbackPath], {
      env: { ...process.env, GTM_OPERATOR_CONFIG: config.CONFIG_PATH },
      encoding: 'utf8',
      stdio: 'pipe'
    })
  } catch (error) {
    status = error.status === undefined ? 1 : error.status
    output = `${error.stdout || ''}${error.stderr || ''}`
  }

  assert.notStrictEqual(status, 0, 'a contradictory manifest should not exit 0')
  assert.ok(
    output.includes('The definitions contradict themselves'),
    `it should have died on the definitions preflight, and did not:\n${output}`
  )
  assert.strictEqual(config.read().verified, null, 'the preflight exit left the old record standing')
})

check('a passing re-verify of a finished install leaves it finished', () => {
  // The other direction, and the regression the demotion above caused when it
  // was first written: clearing the proof demoted the state, and a verify that
  // then PASSED left `creating` sitting beside a fresh verifiedAt. A check
  // succeeding must not un-finish a finished install.
  setUpConfig()
  config.recordVerified('2026-08-18T00:00:00Z')
  config.complete()

  const { status, output } = runVerify(writeReadback('good.json', provenReadback()))

  assert.strictEqual(status, 0, `a correct readback should verify:\n${output}`)
  const after = config.read()
  assert.strictEqual(after.state, 'complete', 'a passing re-verify un-completed the install')
  assert.notStrictEqual(after.verifiedAt, '2026-08-18T00:00:00Z', 'it should record the new verify, not the old one')
})

check('a resume works on a config that has no databases key at all', () => {
  // `blank` always writes the key, so this is a truncated or hand-edited file.
  // It is also the file most in need of a working resume, and it threw
  // "Cannot convert undefined or null to object" out of `Object.keys` because
  // the fallback guarded an absent CONFIG rather than an absent KEY.
  //
  // Found from the other side on 2026-08-22: `shared/config-read.js` tells the
  // reader of an unfinished config to run the install, and for this config the
  // install threw. The message was right and the code it pointed at was wrong.
  reset()
  fs.writeFileSync(config.CONFIG_PATH, JSON.stringify({
    configVersion: config.CONFIG_VERSION,
    state: 'creating',
    notion: { parentPageId: 'parent-page', personId: null },
    verified: null
  }))
  assert.strictEqual(
    config.missingDatabases().length, DATABASES.length,
    'with nothing recorded, every database in the manifest is still to create'
  )

  // AND IT RECORDS, which is the half this check was missing. Its first version
  // called `missingDatabases` alone and passed, while `recordDatabase` still
  // threw on the same file one line into `config.databases[key]`. That made the
  // fault worse rather than better: the throw moved from before the first Notion
  // call to after it, so phase A created a database it could not record and a
  // retry would have created a second. A check named "a resume works" that only
  // proves the planning half is how that shipped.
  config.recordDatabase(DATABASES[0].key, {
    databaseId: 'db-1', dataSourceId: 'ds-1', displayName: DATABASES[0].displayName
  })
  assert.strictEqual(
    config.missingDatabases().length, DATABASES.length - 1,
    'the recorded database should drop out of the list phase A still has to create'
  )
  assert.deepStrictEqual(
    config.read().databases[DATABASES[0].key].databaseId, 'db-1',
    'and it should actually be in the file'
  )
})

check('complete refuses a recorded verify time that is not a string', () => {
  // The second way in. `recordVerified` is where the timestamp is written and it
  // refuses a non-string, but `complete` copies `verified.at` into `verifiedAt`
  // and only tested it for truthiness. A hand-edited file carrying a valid
  // fingerprint and an object put the object back through a different exported
  // writer. Found on 2026-08-22, one round after the first guard was added and
  // called sufficient.
  reset()
  const dbs = {}
  for (const d of DATABASES) dbs[d.key] = { databaseId: 'db', dataSourceId: 'ds' }
  fs.writeFileSync(config.CONFIG_PATH, JSON.stringify({
    configVersion: config.CONFIG_VERSION,
    state: 'creating',
    notion: { parentPageId: 'parent-page', personId: null },
    databases: dbs,
    verified: { at: {}, definitions: require(path.join(ROOT, 'plugins/setup/scripts/fingerprint.js')).fingerprint() }
  }))
  assert.throws(() => config.complete(), /rather than a string/)
  assert.notStrictEqual(config.read().state, 'complete', 'nothing should have been completed')
})

check('the writer refuses a verify timestamp that is not a string', () => {
  // Truthiness was the only guard, so `recordVerified({})` wrote an object and
  // every reader of the config rendered it as "[object Object]". This was
  // written down as a gap needing a hand-edited file, and review on 2026-08-22
  // reached it through the exported writer in one call.
  reset()
  config.begin('parent-page')
  assert.throws(() => config.recordVerified({}), /needs the time as a string/)
  assert.throws(() => config.recordVerified(42), /needs the time as a string/)
  assert.strictEqual(config.read().verifiedAt, null, 'a refused timestamp should leave the config untouched')
})

check('a passing verify does not finish an install that was never finished', () => {
  // And the fix for that must not become an auto-complete. An install still
  // being built is not complete because a check passed.
  setUpConfig()
  const { status, output } = runVerify(writeReadback('good-2.json', provenReadback()))
  assert.strictEqual(status, 0, output)
  assert.strictEqual(config.read().state, 'creating')
})

check('verify with no readback argument does not destroy an existing proof', () => {
  // Clearing runs before the command is dispatched, so the argument has to be
  // checked before the clearing. Without that, `install.js verify` on its own
  // demoted a complete install and erased its record with no check attempted:
  // the clearing causing the fault it was added to prevent.
  setUpConfig()
  config.recordVerified('2026-08-18T00:00:00Z')
  config.complete()

  const { execFileSync } = require('child_process')
  let status = 0
  try {
    execFileSync('node', [path.join(ROOT, 'plugins/setup/scripts/install.js'), 'verify'], {
      env: { ...process.env, GTM_OPERATOR_CONFIG: config.CONFIG_PATH },
      encoding: 'utf8',
      stdio: 'pipe'
    })
  } catch (error) {
    status = error.status === undefined ? 1 : error.status
  }

  assert.notStrictEqual(status, 0, 'it should still refuse without a readback')
  const after = config.read()
  assert.strictEqual(after.state, 'complete', 'a usage error demoted a complete install')
  assert.ok(after.verified, 'a usage error erased the proof')
})

check('a proof taken against different definitions is refused', () => {
  // `state: complete` claims the workspace matches THIS manifest. Nothing tied
  // the proof to the manifest, so one taken before a relation was added or
  // removed stayed usable afterwards, and what was checked was not what would
  // be built.
  setUpConfig()
  config.recordVerified('2026-08-18T00:00:00Z')

  const tampered = config.read()
  assert.ok(tampered.verified.definitions, 'the proof should record which definitions it checked')
  tampered.verified.definitions = 'definitely-not-the-current-one'
  config.write(tampered)

  assert.throws(() => config.complete(), /different set of definitions/)
})

check('a proof is refused when the code that builds the calls changes', () => {
  // The fingerprint hashed the manifest, then the manifest and the schema data,
  // and both times it missed the generators. Changing DDL_TYPE.date from DATE to
  // DATETIME alters every create statement an install sends and left the hash
  // byte for byte identical, so a proof taken before the change stayed valid.
  //
  // Asserted through the generated calls rather than by editing a source file:
  // this is what a change to the generator does to the thing that is hashed.
  setUpConfig()
  config.recordVerified('2026-08-18T00:00:00Z')
  assert.doesNotThrow(() => config.complete())

  const schemaModule = require(path.join(ROOT, 'plugins/setup/scripts/schema.js'))
  const original = schemaModule.DDL_TYPE.date
  schemaModule.DDL_TYPE.date = () => 'DATETIME'
  try {
    assert.ok(
      schemaModule.createStatement('tasks').includes('DATETIME'),
      'the probe should really have changed what is sent'
    )
    assert.throws(() => config.complete(), /different set of definitions/)
  } finally {
    schemaModule.DDL_TYPE.date = original
  }
})

check('a relation number is not in the proof, because it is in no statement', () => {
  // Titled for what it proves. It used to claim it covered RENUMBERING, and it
  // did not: it changed `n` in place and left the relation where it was, a state
  // `manifest.validate()` rejects outright because it requires n to equal the
  // array index. So it asserted something about a manifest that cannot exist.
  //
  // What it does prove is still worth keeping. `n` numbers the design table and
  // reaches no statement, so it must not be in the hash, and an earlier version
  // of the fingerprint had it there.
  const fingerprint = require(path.join(ROOT, 'plugins/setup/scripts/fingerprint.js'))
  const { RELATIONS } = require(path.join(ROOT, 'plugins/setup/scripts/manifest.js'))
  const before = fingerprint.fingerprint()
  const relation = RELATIONS[RELATIONS.length - 1]
  const wasN = relation.n
  relation.n = 99
  try {
    assert.strictEqual(fingerprint.fingerprint(), before)
  } finally {
    relation.n = wasN
  }
})

check('reordering relations on one database does move the proof, and should', () => {
  // Raised as over-hashing on 2026-08-18: renumber a relation and the proof is
  // discarded although "the same set of statements" is sent. The set is the
  // same and the bytes are not. Phase B sends one statement per database with
  // its relations joined in order, so swapping two of them changes the string
  // that goes to Notion.
  //
  // The fingerprint is over what is sent. So it moves, and that is right. The
  // proposed alternative was to sort both the hash and the statements, which
  // means changing what an install sends in order to keep a hash still. That is
  // backwards, and the sorted order has never been measured against Notion.
  const fingerprint = require(path.join(ROOT, 'plugins/setup/scripts/fingerprint.js'))
  const { RELATIONS } = require(path.join(ROOT, 'plugins/setup/scripts/manifest.js'))
  const relations = require(path.join(ROOT, 'plugins/setup/scripts/relations.js'))

  const sameSource = RELATIONS.filter(r => r.from === 'process')
  assert.ok(sameSource.length > 1, 'this needs a database owning more than one relation')
  const i = RELATIONS.indexOf(sameSource[0])
  const j = RELATIONS.indexOf(sameSource[1])

  const sentBefore = relations.statementsFor('process', fingerprint.PLACEHOLDER)
  const hashBefore = fingerprint.fingerprint()

  ;[RELATIONS[i], RELATIONS[j]] = [RELATIONS[j], RELATIONS[i]]
  try {
    const sentAfter = relations.statementsFor('process', fingerprint.PLACEHOLDER)
    assert.notStrictEqual(sentAfter, sentBefore, 'the statement really should differ')
    assert.notStrictEqual(fingerprint.fingerprint(), hashBefore, 'and the proof should follow it')
  } finally {
    ;[RELATIONS[i], RELATIONS[j]] = [RELATIONS[j], RELATIONS[i]]
  }
})

check('a proof is refused after a schema change, not only a manifest change', () => {
  // The fingerprint covered the manifest and not schema.js, while the refusal
  // it powers called itself a check on "definitions". So editing a property,
  // its type, its description or an option colour left a proof from before the
  // edit fully usable, which is the reuse the fingerprint exists to stop.
  setUpConfig()
  config.recordVerified('2026-08-18T00:00:00Z')
  assert.doesNotThrow(() => config.complete())

  const status = schema.DATABASES.tasks.properties.find(p => p.name === 'Status')
  const original = status.options
  status.options = original.map(([name, colour], i) => (i === 0 ? [name, 'purple'] : [name, colour]))
  try {
    assert.throws(() => config.complete(), /different set of definitions/)
  } finally {
    status.options = original
  }
})

check('rewording a note does not throw away a proof', () => {
  // The other direction. `note` is for whoever reads schema.js and never
  // reaches Notion, so it is outside the fingerprint: a check that discarded a
  // real proof every time somebody reworded a comment is one that gets removed.
  setUpConfig()
  config.recordVerified('2026-08-18T00:00:00Z')

  const property = schema.DATABASES.tasks.properties.find(p => p.name === 'Description')
  const original = property.note
  property.note = 'reworded for whoever reads this'
  try {
    assert.doesNotThrow(() => config.complete())
  } finally {
    if (original === undefined) delete property.note
    else property.note = original
  }
})

check('a proof with no recorded definitions is refused too', () => {
  // An older config or a hand-edited one. Absent is not a match.
  setUpConfig()
  config.recordVerified('2026-08-18T00:00:00Z')
  const stripped = config.read()
  delete stripped.verified.definitions
  config.write(stripped)

  assert.throws(() => config.complete(), /different set of definitions/)
})

check('a withdrawn proof takes the completion claim with it', () => {
  // Every other plugin decides whether to trust this workspace by reading
  // `state`, not by reading the proof. A config left saying `complete` with no
  // verification is the proof being withdrawn where nobody looks.
  setUpConfig()
  config.recordVerified('2026-08-18T00:00:00Z')
  config.complete()
  assert.strictEqual(config.read().state, 'complete')

  config.clearVerified()
  assert.strictEqual(config.read().state, 'creating')
  assert.strictEqual(config.read().verifiedAt, null)
})

check('phase A refuses to build a create call with no parent page id', () => {
  assert.throws(() => install.phaseA(), /needs the parent page id/)
})

check('phase A puts the real parent page id in every create call', () => {
  // It used to send the literal string <parent page id>.
  for (const step of install.phaseA('a-real-page-id')) {
    assert.strictEqual(step.arguments.parent.page_id, 'a-real-page-id')
  }
})

fs.rmSync(SANDBOX, { recursive: true, force: true })

console.log(failures ? `\n${failures} failed.\n` : '\nAll checks passed.\n')
process.exit(failures ? 1 : 0)

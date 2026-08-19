'use strict'

/**
 * `setup:check`: whether the plugin can still see what it created.
 *
 * The read-backs here are built from
 * `tests/fixtures/full-install-as-notion-returned-it.json`, which is a real
 * install as Notion returned it, with its identifiers remapped. Every test
 * starts from a workspace this command is happy with and breaks exactly one
 * thing, because a finding appearing is only evidence if the same input without
 * the fault produces none.
 *
 * Run: node tests/check.test.js
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const assert = require('assert')

const ROOT = path.join(__dirname, '..')
const SCRIPTS = path.join(ROOT, 'plugins/setup/scripts')
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gtm-check-'))
process.env.GTM_OPERATOR_CONFIG = path.join(TEMP, 'config.json')

const config = require(path.join(SCRIPTS, 'config.js'))
const check = require(path.join(SCRIPTS, 'check.js'))
const rules = require(path.join(SCRIPTS, 'rules.js'))
const schema = require(path.join(SCRIPTS, 'schema.js'))
const { DATABASES, RELATIONS } = require(path.join(SCRIPTS, 'manifest.js'))

const FIXTURE = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/full-install-as-notion-returned-it.json'), 'utf8'))

let failures = 0
const check_ = (name, fn) => {
  try {
    fn()
    console.log(`  ok    ${name}`)
  } catch (err) {
    failures++
    console.log(`  FAIL  ${name}`)
    console.log(`        ${err.message.split('\n').join('\n        ')}`)
  }
}

/** A config recording the install the fixture came from. */
function installed ({ person = 'person-1', verified = true } = {}) {
  fs.rmSync(process.env.GTM_OPERATOR_CONFIG, { force: true })
  config.begin('page-1')
  for (const d of DATABASES) {
    config.recordDatabase(d.key, { databaseId: FIXTURE.ids[d.key].databaseId, dataSourceId: FIXTURE.ids[d.key].dataSourceId })
  }
  config.recordPerson(person)
  if (verified) {
    config.recordVerified(new Date().toISOString())
    config.complete()
  }
}

/**
 * What a healthy workspace sends back, built from the manifest.
 *
 * NOT from the fixture. `full-install-as-notion-returned-it.json` knowingly
 * lags the manifest and each difference is asserted by name elsewhere, so a
 * baseline taken from it starts with three findings already in it and every
 * test below would be measuring against a workspace that is not healthy. Only
 * its identifiers are borrowed here.
 */
function healthy () {
  const databases = {}
  for (const d of DATABASES) {
    const properties = {}
    for (const want of schema.DATABASES[d.key].properties) {
      // The name a type is WRITTEN as is not the name it is READ back as,
      // measured 2026-08-17, and a fixture that ignores that reports a correct
      // database as broken.
      const property = { name: want.name, type: want.type, description: want.description || '' }
      if (want.options) property.options = want.options.map(([name, color]) => ({ name, color }))
      properties[want.name] = property
    }
    for (const r of RELATIONS) {
      if (r.from === d.key) {
        properties[r.property] = {
          name: r.property,
          type: 'relation',
          dataSourceUrl: `collection://${FIXTURE.ids[r.to].dataSourceId}`,
          ...(r.kind === 'two-way' ? { propertyUrl: `collectionProperty://${FIXTURE.ids[r.to].dataSourceId}/near` } : {})
        }
      }
      if (r.to === d.key && r.reverse) {
        properties[r.reverse] = {
          name: r.reverse,
          type: 'relation',
          dataSourceUrl: `collection://${FIXTURE.ids[r.from].dataSourceId}`,
          propertyUrl: `collectionProperty://${FIXTURE.ids[r.from].dataSourceId}/far`
        }
      }
    }
    databases[d.key] = {
      found: true,
      title: d.title,
      dataSources: [FIXTURE.ids[d.key].dataSourceId],
      schema: properties
    }
  }
  const ruleRows = {}
  for (const q of rules.queries()) ruleRows[`${q.rule}::${q.database}`] = []
  return { databases, person: { found: true }, rules: ruleRows }
}

const ids = list => list.map(x => x.id)
const has = (list, id) => list.some(x => x.id === id)

console.log('\nthe baseline\n')

check_('a healthy workspace is not reported broken', () => {
  installed()
  const result = check.judge(healthy())
  assert.deepStrictEqual(result.broken, [], `a healthy workspace reported problems:\n${result.broken.map(b => b.say).join('\n')}`)
  assert.strictEqual(result.passed, true)
})

check_('it says every time that it did not look at the views', () => {
  // Not only when something else is wrong. This command checks nine things and
  // none of them is a view, and a person reading a clean result would otherwise
  // reasonably think everything was looked at.
  installed()
  const result = check.judge(healthy())
  assert.ok(has(result.unchecked, 'views'), `the unchecked list was ${JSON.stringify(ids(result.unchecked))}`)
})

check_('an install with no proof standing is checked, not refused', () => {
  // The state a repair leaves behind. Refusing here would refuse the second
  // time this is run in a row.
  installed({ verified: false })
  const result = check.judge(healthy())
  assert.deepStrictEqual(result.broken, [], 'an unverified install was reported broken')
  assert.ok(has(result.unchecked, 'proof'), 'nothing said the install has never been proved')
})

console.log('\nwhat it finds\n')

check_('a database that does not resolve names both readings and offers no repair', () => {
  installed()
  const back = healthy()
  back.databases.process.found = false
  const result = check.judge(back)
  const found = result.broken.find(b => b.id === 'database:process')
  assert.ok(found, `nothing was reported: ${JSON.stringify(ids(result.broken))}`)
  assert.ok(/deleted/.test(found.say) && /cannot see/.test(found.say), `only one reading was given:\n${found.say}`)
  assert.strictEqual(check.repairs(back).config.length, 0, 'a repair was offered for a database that may have been deleted')
})

check_('a data source that is gone is broken, and a second one is only a warning', () => {
  installed()
  const gone = healthy()
  gone.databases.process.dataSources = ['ds-somethingelse']
  assert.ok(has(check.judge(gone).broken, 'datasource:process'), 'a replaced data source was not reported')

  const extra = healthy()
  extra.databases.process.dataSources = [FIXTURE.ids.process.dataSourceId, 'ds-new']
  const result = check.judge(extra)
  assert.deepStrictEqual(result.broken, [], 'a second data source was reported as broken')
  assert.ok(has(result.warnings, 'datasource-extra:process'), 'a second data source was not mentioned at all')
})

check_('a second data source is never adopted while the recorded one is healthy', () => {
  // The repair and the warning pull in opposite directions, and the warning
  // wins. Adopting here would move every read to a data source nobody chose.
  installed()
  const extra = healthy()
  extra.databases.process.dataSources = [FIXTURE.ids.process.dataSourceId, 'ds-new']
  const offered = check.repairs(extra)
  assert.deepStrictEqual(offered.config.filter(r => r.kind === 'datasource'), [])
  assert.strictEqual(config.read().databases.process.dataSourceId, FIXTURE.ids.process.dataSourceId)
})

check_('an absent person id is healthy and a recorded one that is gone is not', () => {
  installed({ person: null })
  const back = healthy()
  delete back.person
  assert.deepStrictEqual(check.judge(back).broken, [], 'having no person id was reported as a failure')

  installed({ person: 'person-1' })
  const missing = healthy()
  missing.person = { found: false }
  assert.ok(has(check.judge(missing).broken, 'person'), 'a person id that no longer resolves was not reported')
})

check_('a person id that was never looked up is unchecked, not passed', () => {
  installed({ person: 'person-1' })
  const back = healthy()
  delete back.person
  const result = check.judge(back)
  assert.ok(has(result.unchecked, 'person'), 'it passed without the lookup having happened')
  assert.ok(!has(result.broken, 'person'))
})

console.log('\nthe two rules, which are three queries\n')

check_('all three run, and Memos is one of them', () => {
  installed()
  const back = healthy()
  const keys = Object.keys(back.rules).sort()
  assert.deepStrictEqual(keys, ['process-parent-type::process', 'tags-max-3::memos', 'tags-max-3::process'])
  assert.deepStrictEqual(check.judge(back).broken, [])
})

check_('a rule result that is absent is unchecked, never a pass', () => {
  // Two empty lists proving each other is the failure `install.verify` already
  // fell into once. Here it is a missing list and an empty one.
  installed()
  const back = healthy()
  delete back.rules['tags-max-3::memos']
  const result = check.judge(back)
  assert.ok(has(result.unchecked, 'rule:tags-max-3:memos'), `a query nobody ran was not reported: ${JSON.stringify(ids(result.unchecked))}`)
  assert.ok(!has(result.broken, 'rule:tags-max-3:memos'))
})

check_('rows that break a rule are counted, reported and never repaired', () => {
  installed()
  const back = healthy()
  back.rules['tags-max-3::memos'] = [{ url: 'page-a' }, { url: 'page-b' }]
  const result = check.judge(back)
  const found = result.broken.find(b => b.id === 'rule:tags-max-3:memos')
  assert.ok(found && /2 rows/.test(found.say), `the count was not reported:\n${found && found.say}`)
  const offered = check.repairs(back)
  assert.ok(!has(offered.config, 'rule:tags-max-3:memos') && !has(offered.workspace, 'rule:tags-max-3:memos'),
    'a repair was offered for content somebody wrote')
})

console.log('\nrenames, which are adopted and never applied to Notion\n')

check_('a renamed property is a candidate, and judging alone adopts nothing', () => {
  installed()
  const back = healthy()
  const want = schema.DATABASES.process.properties.find(p => p.name === 'Domain')
  back.databases.process.schema['Area'] = back.databases.process.schema[want.name]
  delete back.databases.process.schema[want.name]

  const result = check.judge(back)
  assert.ok(has(result.broken, 'property:process:Domain'), `the missing property was not reported: ${JSON.stringify(ids(result.broken))}`)

  const offered = check.repairs(back)
  const repair = offered.config.find(r => r.id === 'property:process:Domain')
  assert.ok(repair, `no rename was proposed: ${JSON.stringify(ids(offered.config))}`)
  assert.ok(/"Area"/.test(repair.say), `the proposal did not name the property that is there:\n${repair.say}`)
  assert.deepStrictEqual(config.namesFor('process').properties.Domain, 'Domain', 'judging adopted a rename on its own')
})

check_('two properties that could be it stops and asks', () => {
  installed()
  const back = healthy()
  const want = schema.DATABASES.process.properties.find(p => p.name === 'Domain')
  back.databases.process.schema['Area'] = back.databases.process.schema[want.name]
  back.databases.process.schema['Region'] = back.databases.process.schema[want.name]
  delete back.databases.process.schema[want.name]

  const offered = check.repairs(back)
  assert.ok(!has(offered.config, 'property:process:Domain'), 'it picked one of two candidates by itself')
  assert.ok(has(offered.withheld, 'property:process:Domain'), 'it went quiet instead of asking')
})

check_('adopting a rename writes the map, demotes the install and says how to get back', () => {
  installed()
  const back = healthy()
  const want = schema.DATABASES.process.properties.find(p => p.name === 'Domain')
  back.databases.process.schema['Area'] = back.databases.process.schema[want.name]
  delete back.databases.process.schema[want.name]

  assert.strictEqual(config.read().state, 'complete', 'the fixture never reached complete, so the demotion proves nothing')
  const { applied, next } = check.adopt(back, ['property:process:Domain'])

  assert.strictEqual(applied.length, 1)
  assert.strictEqual(config.namesFor('process').properties.Domain, 'Area')
  assert.strictEqual(config.read().state, 'creating', 'a complete install stayed complete after its record changed')
  assert.ok(next.join('\n').includes('install.js verify') && next.join('\n').includes('install.js complete'),
    `the way back was not printed:\n${next.join('\n')}`)
})

check_('the adopted rename makes the finding go away, on the same read-back', () => {
  installed()
  const back = healthy()
  const want = schema.DATABASES.process.properties.find(p => p.name === 'Domain')
  back.databases.process.schema['Area'] = back.databases.process.schema[want.name]
  delete back.databases.process.schema[want.name]

  const result = check.adopt(back, ['property:process:Domain'])
  assert.strictEqual(result.proved, true, `the rename was adopted and the finding survived:\n${result.results.map(r => r.say).join('\n')}`)
  assert.strictEqual(result.results.length, 1)
})

check_('an id that was never a finding is not reported as repaired', () => {
  // Asked of the sent path, which has both read-backs and can answer it. The
  // adopted path cannot, and `adopt` is what stops such an id ever reaching it
  // by refusing an id it was not offering.
  installed()
  const back = healthy()
  const result = check.proved(back, back, ['property:process:Domain'])
  assert.strictEqual(result.proved, false)
  assert.ok(/nothing for/.test(result.results[0].say), result.results[0].say)
})

check_('adopting proves itself, because nothing run afterwards could', () => {
  // Both halves are only in hand inside `adopt`. Afterwards, whether the
  // finding was ever there needs the config as it was, and that is the thing
  // that just changed, so a separate proof command answered `proved` to an id
  // somebody invented.
  installed()
  assert.throws(() => check.adopt(healthy(), ['property:process:Domain']), /not one of the config repairs/)
})

console.log('\nproving a repair that was sent\n')

check_('the same read-back handed back twice is not evidence', () => {
  // The finding was derived from that file, so it is still in it. This is the
  // guarantee rather than comparing the two files, because a reordered file
  // differs without the workspace having changed.
  installed()
  const back = healthy()
  const want = schema.DATABASES.process.properties.find(p => p.options)
  const [value] = want.options[1]
  back.databases.process.schema[want.name].options = back.databases.process.schema[want.name].options.filter(o => o.name !== value)

  const id = `option:process:${want.name}:${value}:lost`
  assert.ok(has(check.repairs(back).workspace, id), `the add-back was not offered: ${JSON.stringify(ids(check.repairs(back).workspace))}`)

  const result = check.proved(back, back, [id])
  assert.strictEqual(result.proved, false, 'the same file was accepted as proof a statement landed')
  assert.ok(/still reported/.test(result.results[0].say), result.results[0].say)
})

check_('a statement Notion accepted and discarded is caught', () => {
  installed()
  const before = healthy()
  const want = schema.DATABASES.process.properties.find(p => p.options)
  const [value] = want.options[1]
  before.databases.process.schema[want.name].options = before.databases.process.schema[want.name].options.filter(o => o.name !== value)

  // The fetch after the statement, showing the workspace unchanged.
  const after = JSON.parse(JSON.stringify(before))
  after.databases.memos.title = 'Memos, renamed since'

  const id = `option:process:${want.name}:${value}:lost`
  const result = check.proved(before, after, [id])
  assert.strictEqual(result.proved, false, 'a discarded statement was reported as a repair that worked')
})

check_('a value that came back is proved', () => {
  installed()
  const before = healthy()
  const want = schema.DATABASES.process.properties.find(p => p.options)
  const [value] = want.options[1]
  before.databases.process.schema[want.name].options = before.databases.process.schema[want.name].options.filter(o => o.name !== value)

  const after = healthy()
  const id = `option:process:${want.name}:${value}:lost`
  const result = check.proved(before, after, [id])
  assert.strictEqual(result.proved, true, `a repair that landed was not proved:\n${result.results.map(r => r.say).join('\n')}`)
})

check_('a missing value offers both readings, and they are different repairs', () => {
  // Renamed or lost. One is a write to config and one is a write to Notion, and
  // choosing between them is a person's job.
  installed()
  const back = healthy()
  const want = schema.DATABASES.process.properties.find(p => p.options)
  const [value] = want.options[1]
  const options = back.databases.process.schema[want.name].options
  back.databases.process.schema[want.name].options = options.map(o => o.name === value ? { ...o, name: 'Their word for it' } : o)

  const offered = check.repairs(back)
  assert.ok(has(offered.config, `option:process:${want.name}:${value}:renamed`), `the rename reading was not offered: ${JSON.stringify(ids(offered.config))}`)
  assert.ok(has(offered.workspace, `option:process:${want.name}:${value}:lost`), `the lost reading was not offered: ${JSON.stringify(ids(offered.workspace))}`)
})

console.log('\nadopting\n')

check_('an id that was not offered is refused, not skipped', () => {
  installed()
  const back = healthy()
  assert.throws(() => check.adopt(back, ['property:process:Nonsense']), /not one of the config repairs/)
})

check_('a workspace repair cannot be adopted', () => {
  installed()
  const back = healthy()
  const want = schema.DATABASES.process.properties.find(p => p.options)
  const [value] = want.options[1]
  back.databases.process.schema[want.name].options = back.databases.process.schema[want.name].options.filter(o => o.name !== value)
  assert.throws(() => check.adopt(back, [`option:process:${want.name}:${value}:lost`]), /is a workspace repair/)
})

check_('adopting nothing is refused rather than reported as done', () => {
  installed()
  assert.throws(() => check.adopt(healthy(), []), /No repair was named/)
})

console.log('\ngetting a statement clears the proof\n')

check_('a workspace repair carries no statement until it is asked for', () => {
  // The statement is the thing that changes the workspace, so handing it over
  // is the moment the proof stops being true. Leaving it in `repairs` made that
  // a step somebody could skip.
  installed()
  const back = healthy()
  const want = schema.DATABASES.process.properties.find(p => p.options)
  const [value] = want.options[1]
  back.databases.process.schema[want.name].options = back.databases.process.schema[want.name].options.filter(o => o.name !== value)

  const offered = check.repairs(back)
  for (const repair of offered.workspace) {
    assert.strictEqual(repair.statement, undefined, `a statement was available without the proof being cleared: ${repair.id}`)
  }
})

check_('asking for a statement demotes the install and says how to get back', () => {
  installed()
  const back = healthy()
  const want = schema.DATABASES.process.properties.find(p => p.options)
  const [value] = want.options[1]
  back.databases.process.schema[want.name].options = back.databases.process.schema[want.name].options.filter(o => o.name !== value)

  assert.strictEqual(config.read().state, 'complete', 'the fixture never reached complete, so the demotion proves nothing')
  const { statements, next } = check.send(back, [`option:process:${want.name}:${value}:lost`])

  assert.strictEqual(statements.length, 1)
  assert.ok(statements[0].statement.includes(value), `the statement does not name the value it adds back:\n${statements[0].statement}`)
  assert.strictEqual(statements[0].unproved, true, 'a statement nothing here has measured was presented as proved')
  assert.strictEqual(config.read().state, 'creating', 'the workspace was about to change and the install still claimed to be verified')
  assert.strictEqual(config.read().verified, null)
  assert.ok(next.join('\n').includes('install.js verify'), 'the way back was not printed')
})

check_('a config repair cannot be sent and a workspace repair cannot be adopted', () => {
  installed()
  const back = healthy()
  const want = schema.DATABASES.process.properties.find(p => p.name === 'Domain')
  back.databases.process.schema['Area'] = back.databases.process.schema[want.name]
  delete back.databases.process.schema[want.name]

  assert.throws(() => check.send(back, ['property:process:Domain']), /is a config repair/)
  assert.strictEqual(config.read().state, 'complete', 'the proof was cleared by a call that then refused')
})

console.log('\nwhat it will not judge\n')

check_('a config it cannot read is one finding, not a crash', () => {
  installed()
  const raw = JSON.parse(fs.readFileSync(process.env.GTM_OPERATOR_CONFIG, 'utf8'))
  raw.configVersion = 999
  fs.writeFileSync(process.env.GTM_OPERATOR_CONFIG, JSON.stringify(raw))

  const result = check.judge(healthy())
  assert.ok(has(result.broken, 'config'), 'a config from another version did not come back as a finding')
  assert.ok(/999/.test(result.broken[0].say), `the finding does not say which version:\n${result.broken[0].say}`)
})

check_('a read-back with nothing in it is entirely unchecked and nothing is broken', () => {
  installed()
  const result = check.judge({})
  assert.strictEqual(result.passed, true, 'this is about the unchecked list, not the broken one')
  for (const d of DATABASES) {
    assert.ok(has(result.unchecked, `database:${d.key}`), `${d.title} was passed over silently`)
  }
  assert.ok(result.unchecked.length > DATABASES.length, 'nothing was said about the views or the rules')
})

check_('a property whose type changed is never offered as a rename', () => {
  installed()
  const back = healthy()
  back.databases.process.schema.Domain.type = 'number'
  const result = check.judge(back)
  assert.ok(has(result.broken, 'type:process:Domain'), `a changed type was not reported: ${JSON.stringify(ids(result.broken))}`)
  const offered = check.repairs(back)
  assert.deepStrictEqual(offered.config, [], 'a property that is present with the wrong type was treated as a rename')
})

check_('proving a rebuilt relation looks for the relations, not the database', () => {
  // The repair id names a database because one statement covers every relation
  // missing from it. The findings name the relations. Asking for the repair id
  // among the findings answers no every time, so a repair that worked was
  // reported as one that never had anything to fix.
  installed()
  const before = healthy()
  const relation = RELATIONS.find(r => r.kind === 'two-way' && r.from !== r.to)
  delete before.databases[relation.from].schema[relation.property]
  delete before.databases[relation.to].schema[relation.reverse]

  const offered = check.repairs(before)
  const id = `relation:${relation.from}`
  assert.ok(has(offered.workspace, id), `the rebuild was not offered: ${JSON.stringify(ids(offered.workspace))}`)
  assert.ok(check.judge(before).broken.some(b => b.id === `relation:${relation.n}`), 'the fixture did not break the relation')

  const failed = check.proved(before, before, [id])
  assert.strictEqual(failed.proved, false, 'the same read-back was accepted as proof')
  assert.ok(/still reported/.test(failed.results[0].say), `it claimed there was nothing to fix:\n${failed.results[0].say}`)

  const worked = check.proved(before, healthy(), [id])
  assert.strictEqual(worked.proved, true, `a rebuild that landed was not proved:\n${worked.results.map(r => r.say).join('\n')}`)
})

check_('a proof taken against a different manifest is not a proof', () => {
  // `config.complete` already refuses one. This asked only whether a proof
  // existed, so a workspace passed on a check run against an earlier manifest.
  installed()
  const raw = JSON.parse(fs.readFileSync(process.env.GTM_OPERATOR_CONFIG, 'utf8'))
  raw.verified.definitions = 'something-else'
  fs.writeFileSync(process.env.GTM_OPERATOR_CONFIG, JSON.stringify(raw))

  const result = check.judge(healthy())
  const said = result.unchecked.find(u => u.id === 'proof')
  assert.ok(said, `nothing said the proof was stale: ${JSON.stringify(ids(result.unchecked))}`)
  assert.ok(/different set of definitions/.test(said.say), said.say)
})

check_('a fetch that did not say whether it resolved is not read as success', () => {
  installed()
  const back = healthy()
  delete back.databases.process.found
  delete back.databases.memos.title

  const result = check.judge(back)
  assert.ok(has(result.unchecked, 'database:process'), 'a fetch with no answer was treated as one that resolved')
  assert.ok(has(result.unchecked, 'title:memos'), 'a missing title passed as a title that matches')
})

console.log('\nthe name map itself\n')

check_('a map that cannot be read stops that database being checked, and says so', () => {
  installed()
  const current = config.read()
  current.databases.process.properties = { Domain: 'Area' }
  fs.writeFileSync(process.env.GTM_OPERATOR_CONFIG, JSON.stringify(current, null, 2))

  const result = check.judge(healthy())
  assert.ok(has(result.broken, 'names:process'), `a broken map was not reported: ${JSON.stringify(ids(result.broken))}`)
  assert.ok(has(result.unchecked, 'schema:process'), 'its properties were checked through a map that cannot be read')
})

check_('a map that cannot be read does not stop the plan being produced', () => {
  // `config.allNames` throws on a map it cannot use, so one hand-edited entry
  // made the whole command die before it emitted a step, which is the opposite
  // of what this skill promises to do with a broken install.
  installed()
  const raw = JSON.parse(fs.readFileSync(process.env.GTM_OPERATOR_CONFIG, 'utf8'))
  raw.databases.process.properties = { Domain: 'Area' }
  fs.writeFileSync(process.env.GTM_OPERATOR_CONFIG, JSON.stringify(raw))

  const result = check.plan()
  assert.ok(Array.isArray(result.steps) && result.steps.length, 'no plan came back at all')
  assert.ok(result.steps.some(s => s.kind === 'fetch-database' && s.database === 'process'),
    'the database with the bad map is not even fetched, so nothing would diagnose it')
  assert.ok(!result.steps.some(s => s.kind === 'rule' && s.database === 'process'),
    'a rule query was built for a database whose names are not known')
  assert.ok(result.steps.some(s => s.kind === 'rule' && s.database === 'memos'),
    'one bad map stopped every other rule query')
})

check_('the usage line names exactly the commands that exist', () => {
  // It listed a command that had been removed and omitted one that had been
  // added. A usage line is the only description of this tool most people read.
  const source = fs.readFileSync(path.join(SCRIPTS, 'check.js'), 'utf8')
  const implemented = [...source.matchAll(/^      case '([a-z-]+)':/gm)].map(m => m[1]).sort()
  // The line with the pipes, not the first "Usage:" in the file. Several
  // commands throw their own single-command usage message, and matching one of
  // those compared the command list against one command and passed.
  const usage = source.match(/Usage: check\.js ([a-z-]+(?: \| [a-z-]+)+)'/)
  assert.ok(usage, 'there is no usage line at all')
  const listed = usage[1].split('|').map(s => s.trim()).sort()
  assert.deepStrictEqual(listed, implemented,
    `the usage line and the commands have drifted.\n  listed:      ${listed.join(', ')}\n  implemented: ${implemented.join(', ')}`)
})

fs.rmSync(TEMP, { recursive: true, force: true })

if (failures) {
  console.log(`\n${failures} failed.\n`)
  process.exit(1)
}
console.log('\nAll checks passed.\n')

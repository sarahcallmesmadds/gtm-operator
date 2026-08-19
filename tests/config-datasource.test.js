'use strict'

/**
 * `config.reresolveDataSource`, the one legitimate way a recorded data source
 * id changes.
 *
 * `recordDatabase` refuses a recorded pair being offered a different data
 * source, deliberately, because a mismatch there is a mangled create response,
 * a hand-edited config or a bug. This is the narrow exception, and these tests
 * are mostly about what it still refuses.
 *
 * Run: node tests/config-datasource.test.js
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const assert = require('assert')

const ROOT = path.join(__dirname, '..')
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gtm-ds-'))
process.env.GTM_OPERATOR_CONFIG = path.join(TEMP, 'config.json')

const config = require(path.join(ROOT, 'plugins/setup/scripts/config.js'))

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

const start = () => {
  fs.rmSync(process.env.GTM_OPERATOR_CONFIG, { force: true })
  config.begin('page-1')
  config.recordDatabase('process', { databaseId: 'db-process', dataSourceId: 'ds-old' })
}

console.log('\nre-resolving a data source\n')

check('the recorded id moves, and only that', () => {
  start()
  const before = config.read().databases.process
  config.reresolveDataSource('process', { databaseId: 'db-process', from: 'ds-old', to: 'ds-new' })
  const after = config.read().databases.process

  assert.strictEqual(after.dataSourceId, 'ds-new')
  assert.strictEqual(after.databaseId, before.databaseId, 'the database id moved as well')
  assert.deepStrictEqual(after.properties, before.properties, 'the name map was disturbed')
})

check('a database that is not recorded is refused', () => {
  start()
  assert.throws(() => config.reresolveDataSource('memos', { databaseId: 'db-memos', from: 'a', to: 'b' }),
    /not recorded/)
})

check('a different database id is refused', () => {
  start()
  assert.throws(() => config.reresolveDataSource('process', { databaseId: 'db-other', from: 'ds-old', to: 'ds-new' }),
    /not a re-resolve/)
  assert.strictEqual(config.read().databases.process.dataSourceId, 'ds-old', 'it was written anyway')
})

check('a config that moved since it was judged is refused', () => {
  // The approval was given about a pair somebody has since changed, so it is an
  // adoption of a decision taken about a different workspace.
  start()
  assert.throws(() => config.reresolveDataSource('process', { databaseId: 'db-process', from: 'ds-somethingelse', to: 'ds-new' }),
    /changed the config in between/)
  assert.strictEqual(config.read().databases.process.dataSourceId, 'ds-old', 'it was written anyway')
})

check('moving to the id already recorded is refused', () => {
  start()
  assert.throws(() => config.reresolveDataSource('process', { databaseId: 'db-process', from: 'ds-old', to: 'ds-old' }),
    /nothing to change/)
})

check('a missing argument is refused rather than guessed at', () => {
  start()
  for (const args of [{ databaseId: 'db-process', from: 'ds-old' }, { databaseId: 'db-process', to: 'ds-new' }, { from: 'ds-old', to: 'ds-new' }]) {
    assert.throws(() => config.reresolveDataSource('process', args), /needs the database id/)
  }
})

check('adopting one demotes a complete install', () => {
  // It changes what the verify was run against, so the proof goes with it.
  start()
  for (const d of require(path.join(ROOT, 'plugins/setup/scripts/manifest.js')).DATABASES) {
    if (d.key !== 'process') config.recordDatabase(d.key, { databaseId: `db-${d.key}`, dataSourceId: `ds-${d.key}` })
  }
  config.recordVerified(new Date().toISOString())
  config.complete()
  assert.strictEqual(config.read().state, 'complete', 'the fixture never reached complete, so this proves nothing')

  config.reresolveDataSource('process', { databaseId: 'db-process', from: 'ds-old', to: 'ds-new' })
  const after = config.read()
  assert.strictEqual(after.state, 'creating', 'a complete install stayed complete after its data source moved')
  assert.strictEqual(after.verified, null, 'the proof survived a change to what it was taken against')
})

fs.rmSync(TEMP, { recursive: true, force: true })

if (failures) {
  console.log(`\n${failures} failed.\n`)
  process.exit(1)
}
console.log('\nAll checks passed.\n')

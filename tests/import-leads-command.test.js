'use strict'

/**
 * Tests for the command layer, run the way a skill runs it: as a child
 * process, with the config path overridden into a temp directory so nothing
 * here can read or write the real file.
 *
 * `check-standing` is the main subject. It is the one command whose output
 * IS the report a person acts on, so what it says about the key file, the
 * alias map and the artifacts is behaviour, not formatting.
 *
 * Run: node tests/import-leads-command.test.js
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const assert = require('assert')
const { execFileSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
const SCRIPT = path.join(ROOT, 'plugins/import-leads/scripts/import-leads.js')
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'import-leads-command-'))
const CONFIG = path.join(TEMP, 'config.json')

/** Run a command; return {status, stdout, stderr} whether it exits 0 or not. */
function run (...args) {
  try {
    const stdout = execFileSync('node', [SCRIPT, ...args], {
      env: Object.assign({}, process.env, { IMPORT_LEADS_CONFIG: CONFIG }),
      encoding: 'utf8'
    })
    return { status: 0, stdout, stderr: '' }
  } catch (error) {
    return { status: error.status, stdout: error.stdout || '', stderr: error.stderr || '' }
  }
}

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

console.log('\nimport-leads command layer\n')

check('check-standing with no config exits 2 and says it is a first run', () => {
  const result = run('check-standing')
  assert.strictEqual(result.status, 2)
  assert.ok(/first run/.test(result.stdout + result.stderr))
})

// A working config pointing at a key file and an alias map in the temp dir.
const keyPath = path.join(TEMP, 'service-key.txt')
const aliasPath = path.join(TEMP, 'aliases.json')
fs.writeFileSync(CONFIG, JSON.stringify({
  configVersion: 1,
  portalId: '111222333',
  serviceKeyPath: keyPath,
  aliasMapPath: aliasPath,
  properties: {
    contact: { firstName: 'firstname', lastName: 'lastname', email: 'email', phone: 'phone', title: 'jobtitle', city: 'city', state: 'state', country: 'country' },
    company: { name: 'name' }
  }
}, null, 2))

check('a missing key file and a missing alias map are reported by path, and the key is never read', () => {
  const result = run('check-standing')
  const standing = JSON.parse(result.stdout)
  assert.strictEqual(standing.config.ok, true)
  assert.strictEqual(standing.serviceKey.ok, false)
  assert.ok(standing.serviceKey.why.includes(keyPath))
  assert.strictEqual(standing.aliasMap.ok, false)
})

check('an empty key file is not a working key file', () => {
  fs.writeFileSync(keyPath, '')
  const standing = JSON.parse(run('check-standing').stdout)
  assert.strictEqual(standing.serviceKey.ok, false)
  assert.ok(/empty/.test(standing.serviceKey.why))
})

check('a present key and a valid alias map report ok, with the probe emitted and no key contents anywhere', () => {
  fs.writeFileSync(keyPath, 'pat-na1-notarealkey-fixture')
  fs.writeFileSync(aliasPath, JSON.stringify({ aliases: {} }))
  const result = run('check-standing')
  const standing = JSON.parse(result.stdout)
  assert.strictEqual(standing.serviceKey.ok, true)
  assert.strictEqual(standing.aliasMap.ok, true)
  assert.strictEqual(standing.probe.request.method, 'GET')
  assert.ok(!result.stdout.includes('notarealkey'), 'the key contents must never enter any output')
})

check('the artifacts note keeps unreachable and missing apart, because those are different answers', () => {
  const standing = JSON.parse(run('check-standing').stdout)
  assert.ok(/UNREACHABLE/.test(standing.artifacts.note))
  assert.ok(/MISSING/.test(standing.artifacts.note))
  assert.ok(/process:new/.test(standing.artifacts.note))
})

check('a broken alias map is reported with its problems rather than crashing the standing report', () => {
  fs.writeFileSync(aliasPath, '{"aliases": {"X": ""}}')
  const standing = JSON.parse(run('check-standing').stdout)
  assert.strictEqual(standing.aliasMap.ok, false)
  fs.writeFileSync(aliasPath, JSON.stringify({ aliases: {} }))
})

check('list-queries realises names from the grid and refuses an uncovered assignment', () => {
  const grid = path.join(TEMP, 'grid.json')
  const campaigns = path.join(TEMP, 'campaigns.json')
  const assignments = path.join(TEMP, 'assignments.json')
  fs.writeFileSync(grid, JSON.stringify({ naming: '{campaign} - {status}', types: { Event: ['Invited'] } }))
  fs.writeFileSync(campaigns, JSON.stringify([{ name: 'Summit', type: 'Event' }]))
  fs.writeFileSync(assignments, JSON.stringify([{ index: 1, campaign: 'Summit', status: 'Invited' }]))
  const good = run('list-queries', grid, campaigns, assignments)
  assert.strictEqual(good.status, 0)
  const parsed = JSON.parse(good.stdout)
  assert.deepStrictEqual(parsed.names, ['Summit - Invited'])
  assert.strictEqual(parsed.requests.length, 1)

  fs.writeFileSync(assignments, JSON.stringify([{ index: 1, campaign: 'Summit', status: 'Ghosted' }]))
  const bad = run('list-queries', grid, campaigns, assignments)
  assert.notStrictEqual(bad.status, 0)
  assert.ok(/Ghosted/.test(bad.stderr))
})

console.log(failures ? `\n${failures} failed.\n` : '\nAll checks passed.\n')
process.exit(failures ? 1 : 0)

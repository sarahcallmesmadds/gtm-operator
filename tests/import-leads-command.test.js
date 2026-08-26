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

check('free-mail presents the flagged rows and says the call is the person\'s', () => {
  const rows = path.join(TEMP, 'rows.json')
  fs.writeFileSync(rows, JSON.stringify([
    { index: 1, source: {}, fields: { email: 'ivy@gmail.com' }, fieldSources: { email: 'list' } },
    { index: 2, source: {}, fields: { email: 'cora@harborlane.example' }, fieldSources: { email: 'list' } }
  ]))
  const result = run('free-mail', rows)
  assert.strictEqual(result.status, 0)
  const parsed = JSON.parse(result.stdout)
  assert.deepStrictEqual(parsed.rows, [{ index: 1, email: 'ivy@gmail.com', domain: 'gmail.com' }])
  assert.ok(/never silently swapped/.test(parsed.note))

  fs.writeFileSync(rows, JSON.stringify([
    { index: 2, source: {}, fields: { email: 'cora@harborlane.example' }, fieldSources: { email: 'list' } }
  ]))
  const clean = JSON.parse(run('free-mail', rows).stdout)
  assert.deepStrictEqual(clean.rows, [])
  assert.ok(/absence of flags, not a guarantee/.test(clean.note))
})

check('company-queries derives a search domain from agreeing work emails and says where it came from', () => {
  const rows = path.join(TEMP, 'company-rows.json')
  fs.writeFileSync(rows, JSON.stringify([
    { index: 1, source: {}, fields: { email: 'ada@acme.example', company: 'Acme' }, fieldSources: { email: 'list', company: 'list' } },
    { index: 2, source: {}, fields: { email: 'ben@acme.example', company: 'Acme' }, fieldSources: { email: 'list', company: 'list' } },
    { index: 3, source: {}, fields: { email: 'x@one.example', company: 'Split Co' }, fieldSources: { email: 'list', company: 'list' } },
    { index: 4, source: {}, fields: { email: 'y@two.example', company: 'Split Co' }, fieldSources: { email: 'list', company: 'list' } }
  ]))
  const result = run('company-queries', rows)
  assert.strictEqual(result.status, 0)
  const parsed = JSON.parse(result.stdout)
  const acme = parsed.companies.find(c => c.name === 'Acme')
  assert.strictEqual(acme.domain, 'acme.example')
  assert.ok(/derived from 2 work emails/.test(acme.domainSource))
  const split = parsed.companies.find(c => c.name === 'Split Co')
  assert.strictEqual(split.domain, null, 'disagreeing domains derive nothing: the choice is the person\'s')
  const acmeRequest = parsed.requests.find(r => r.label === 'company search: Acme')
  assert.strictEqual(acmeRequest.body.filterGroups.length, 1, 'the name search stays a name search')
  const acmeDomainRequest = parsed.requests.find(r => r.label === 'company search by domain: Acme')
  assert.ok(acmeDomainRequest, 'the derived domain becomes its own request, never OR-ed into the name search')
  assert.deepStrictEqual(acmeDomainRequest.body.filterGroups[0].filters[0], { propertyName: 'domain', operator: 'EQ', value: 'acme.example' })
  assert.ok(!parsed.requests.find(r => r.label === 'company search by domain: Split Co'), 'no derived domain, name search only')
})

check('dedupe-queries searches a replaced address as an identity of its own', () => {
  const rows = path.join(TEMP, 'replaced-rows.json')
  fs.writeFileSync(rows, JSON.stringify([
    { index: 1, source: {}, fields: { email: 'vik@peatmarsh.example' }, fieldSources: { email: 'enrichment:some-tool' }, replacedEmail: 'vik.moss@gmail.com' }
  ]))
  const parsed = JSON.parse(run('dedupe-queries', rows).stdout)
  const values = parsed.requests[0].body.filterGroups[0].filters[0].values
  assert.deepStrictEqual(values.sort(), ['vik.moss@gmail.com', 'vik@peatmarsh.example'], 'both addresses are searched')
  assert.ok(/replaced/.test(parsed.note))
})

check('a domain column still wins over derivation, recorded as such', () => {
  const rows = path.join(TEMP, 'column-rows.json')
  fs.writeFileSync(rows, JSON.stringify([
    { index: 1, source: {}, fields: { email: 'ada@other.example', company: 'Acme', companyDomain: 'acme.example' }, fieldSources: { email: 'list', company: 'list', companyDomain: 'list' } }
  ]))
  const parsed = JSON.parse(run('company-queries', rows).stdout)
  const acme = parsed.companies.find(c => c.name === 'Acme')
  assert.strictEqual(acme.domain, 'acme.example')
  assert.strictEqual(acme.domainSource, 'column')
})

// ------------------------------------------------- the salesforce dispatch

// The same commands against a salesforce config emit sf CLI specs, and the
// backend-specific commands refuse the other backend by name. The config
// file is the suite's own temp file, swapped in place; each run() is a
// fresh child process reading it cold.
fs.writeFileSync(CONFIG, JSON.stringify({
  configVersion: 1,
  crm: 'salesforce',
  orgAlias: 'acceptance-org',
  aliasMapPath: aliasPath,
  properties: {
    contact: { firstName: 'FirstName', lastName: 'LastName', email: 'Email', phone: 'Phone', title: 'Title', city: 'MailingCity', state: 'MailingState', country: 'MailingCountry' },
    company: { name: 'Name', website: 'Website' }
  }
}, null, 2))

check('check-standing on salesforce reports the alias with nothing key-shaped, and names the flag', () => {
  const result = run('check-standing')
  assert.strictEqual(result.status, 0)
  const standing = JSON.parse(result.stdout)
  assert.strictEqual(standing.config.crm, 'salesforce')
  assert.strictEqual(standing.config.orgAlias, 'acceptance-org')
  assert.ok(!('serviceKey' in standing), 'the credential lives in the CLI keychain, so there is no key file to check')
  assert.strictEqual(standing.orgDisplay.request.transport, 'cli')
  assert.ok(/Marketing User/.test(standing.marketingUserFlag.note))
  assert.strictEqual(standing.probe.request.transport, 'query')
  assert.ok(/unmeasured rather than known absent/.test(standing.autoCompanyCreation))
})

check('dedupe-queries on salesforce emits SOQL specs and the sf send note', () => {
  const rows = path.join(TEMP, 'sf-rows.json')
  fs.writeFileSync(rows, JSON.stringify([
    { index: 1, source: {}, fields: { email: 'ada@acme.example' }, fieldSources: { email: 'list' } }
  ]))
  const parsed = JSON.parse(run('dedupe-queries', rows).stdout)
  assert.strictEqual(parsed.requests[0].transport, 'query')
  assert.ok(parsed.requests[0].soql.includes('Email IN ('))
  assert.ok(/sf data query/.test(parsed.note))
  assert.ok(!/Service Key/.test(parsed.note), 'nothing key-shaped is mentioned on this backend')
})

check('list-queries refuses a salesforce config and points at the campaign route, and the reverse', () => {
  const grid = path.join(TEMP, 'sf-grid.json')
  fs.writeFileSync(grid, JSON.stringify({ naming: '{campaign} - {status}', types: { Event: ['Invited'] } }))
  const refused = run('list-queries', grid, grid, grid)
  assert.notStrictEqual(refused.status, 0)
  assert.ok(/campaign-queries/.test(refused.stderr))

  const campaigns = path.join(TEMP, 'sf-campaigns.json')
  fs.writeFileSync(campaigns, JSON.stringify([{ name: 'Summit', type: 'Event' }]))
  const good = run('campaign-queries', campaigns)
  assert.strictEqual(good.status, 0)
  const parsed = JSON.parse(good.stdout)
  assert.ok(parsed.requests[0].soql.includes("WHERE Name = 'Summit'"))
})

check('the flag flow runs whoami first and the flag read second, judged by one command', () => {
  const first = JSON.parse(run('flag-query').stdout)
  assert.deepStrictEqual(first.request.args, ['org', 'display', 'user'])
  const whoami = path.join(TEMP, 'whoami.json')
  fs.writeFileSync(whoami, JSON.stringify({ status: 0, result: { id: '005U' } }))
  const step1 = JSON.parse(run('flag-judge', whoami).stdout)
  assert.strictEqual(step1.userId, '005U')
  const second = JSON.parse(run('flag-query', '005U').stdout)
  assert.ok(second.request.soql.includes('UserPermissionsMarketingUser'))
  const flag = path.join(TEMP, 'flag.json')
  fs.writeFileSync(flag, JSON.stringify({ status: 0, result: { records: [{ Id: '005U', UserPermissionsMarketingUser: false }], totalSize: 1, done: true } }))
  const step2 = JSON.parse(run('flag-judge', flag).stdout)
  assert.deepStrictEqual(step2, { ok: true, userId: '005U', on: false })
})

check('status-queries with no existing campaign says so instead of emitting nothing silently', () => {
  const decisions = path.join(TEMP, 'sf-decisions.json')
  fs.writeFileSync(decisions, JSON.stringify({ campaignDecisions: { Summit: { outcome: 'absent' } } }))
  const parsed = JSON.parse(run('status-queries', decisions).stdout)
  assert.deepStrictEqual(parsed.requests, [])
  assert.ok(/Sent and Responded/.test(parsed.note))
})

console.log(failures ? `\n${failures} failed.\n` : '\nAll checks passed.\n')
process.exit(failures ? 1 : 0)

'use strict'

/**
 * The software backfill gates: what may be read, what becomes a candidate,
 * and what is allowed onto a page nobody has reviewed.
 *
 * MUTATION-PROVED WHERE IT SAYS SO, each mutation asserted landed before the
 * suite ran (the 2026-08-23 lesson). The three run for this file, each
 * confirmed red then restored:
 *   1. `NEVER_FILLED` emptied in backfill.js — SURVIVED on the first run,
 *      because the check iterated the emptied list zero times and passed
 *      vacuously. The list is now pinned by value first, and the re-run went
 *      red in the named check. A test defeated by deleting the thing it
 *      tests, found by mutation and not by reading, again.
 *   2. `plan` with the settings-without-source check removed — its refusal
 *      check went red.
 *   3. `proveAbsent` returning [] unconditionally — the arrived-stamped
 *      check went red.
 *
 * Run: node tests/software-backfill.test.js
 */

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'gtm-software-backfill-'))
process.env.GTM_OPERATOR_CONFIG = path.join(SANDBOX, 'gtm-operator.config.json')

const setupSchema = require('../plugins/setup/scripts/schema')
const backfill = require('../plugins/software/scripts/backfill')
const { cameBackEmpty } = require('../shared/notion-compare')

const identity = setupSchema.identityNames('software')
const renamed = {
  properties: Object.fromEntries(Object.keys(identity.properties).map(k => [k, `R ${k}`])),
  values: Object.fromEntries(
    Object.entries(identity.values).map(([property, options]) => [
      property,
      Object.fromEntries(Object.keys(options).map(v => [v, `R ${v}`]))
    ])
  )
}
const writeConfig = map => fs.writeFileSync(process.env.GTM_OPERATOR_CONFIG, JSON.stringify({
  configVersion: 3,
  state: 'complete',
  notion: { parentPageId: 'p', personId: null },
  databases: {
    software: { databaseId: 'software-db', dataSourceId: 'software-ds', displayName: 'software', properties: map.properties, values: map.values }
  },
  verified: { at: 'x', definitions: 'y' },
  defaults: {},
  sources: {},
  taxonomyPath: '/tmp/x'
}, null, 2))
writeConfig(identity)

const command = require('../plugins/software/scripts/software')

const capture = fn => {
  const printed = []
  const real = console.log
  console.log = (...args) => printed.push(args.join(' '))
  try { fn() } finally { console.log = real }
  return JSON.parse(printed.join('\n'))
}
const save = (name, value) => {
  const file = path.join(SANDBOX, name)
  fs.writeFileSync(file, JSON.stringify(value))
  return file
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

console.log('\nthe software backfill gates\n')

const context = {
  personId: null,
  property: logical => `W ${logical}`,
  value: (property, value) => `V ${value}`
}

const cleanScope = () => ({
  sources: ['contracts', 'email'],
  contracts: { folder: 'Always Allow › Contracts' },
  email: { from: '2025-08-25', to: '2026-08-25' }
})

const kindsOf = result => (result.problems || []).map(p => `${p.field}:${p.kind}`)

// ----------------------------------------------------------------------- scope

check('a clean scope gets a plan, with the email rules and what is not being read', () => {
  const plan = backfill.plan(cleanScope())
  assert.strictEqual(plan.ok, true)
  assert.deepStrictEqual(plan.reading, ['contracts', 'email'])
  assert.deepStrictEqual(plan.notReading, ['docusign', 'ramp', 'quickbooks', 'slack'])
  assert.ok(/READ-ONLY/.test(plan.emailRules))
  const one = backfill.plan({ sources: ['contracts'], contracts: { folder: 'x' } })
  assert.deepStrictEqual(one.notReading, ['docusign', 'ramp', 'quickbooks', 'email', 'slack'])
  assert.strictEqual(one.emailRules, null)
})

check('an unknown source is refused, not dropped', () => {
  const scope = cleanScope(); scope.sources.push('salesforce')
  assert.ok(kindsOf(backfill.plan(scope)).includes('sources:unknown-source'))
})

check('the connector sources require bounded, account-specific scopes', () => {
  assert.deepStrictEqual(backfill.SOURCES, ['contracts', 'docusign', 'ramp', 'quickbooks', 'email', 'slack'])
  const clean = {
    sources: ['docusign', 'ramp', 'quickbooks', 'slack'],
    docusign: { account: 'Always Allow', from: '2025-08-27', to: '2026-08-27' },
    ramp: { account: 'Always Allow', from: '2025-08-27', to: '2026-08-27' },
    quickbooks: { account: 'Always Allow', from: '2025-08-27', to: '2026-08-27' },
    slack: { channels: ['#revops'], directMessages: [], from: '2025-08-27', to: '2026-08-27' }
  }
  const planned = backfill.plan(clean)
  assert.strictEqual(planned.ok, true)
  assert.strictEqual(planned.connectorRules.length, 4)

  const noAccount = JSON.parse(JSON.stringify(clean)); delete noAccount.ramp.account
  assert.ok(kindsOf(backfill.plan(noAccount)).includes('ramp:no-account'))
  const noSlackLocation = JSON.parse(JSON.stringify(clean)); noSlackLocation.slack.channels = []
  assert.ok(kindsOf(backfill.plan(noSlackLocation)).includes('slack:no-locations'))
  const allDms = JSON.parse(JSON.stringify(clean)); allDms.slack.directMessages = ['all']
  assert.ok(kindsOf(backfill.plan(allDms)).includes('slack:all-direct-messages'))
})

check('settings for a source that is not listed are a contradiction, not a spare part', () => {
  const scope = { sources: ['contracts'], contracts: { folder: 'x' }, email: { from: '2025-01-01', to: '2026-01-01' } }
  assert.ok(kindsOf(backfill.plan(scope)).includes('email:settings-without-source'))
})

check('the contracts source needs a named folder, not a whole Drive', () => {
  const missing = { sources: ['contracts'] }
  assert.ok(kindsOf(backfill.plan(missing)).includes('contracts:missing-settings'))
  const blank = { sources: ['contracts'], contracts: { folder: '  ' } }
  assert.ok(kindsOf(backfill.plan(blank)).includes('contracts:no-folder'))
})

check('email needs a whole range of real days, forwards, and half a range is no scope', () => {
  const half = cleanScope(); delete half.email.to
  assert.ok(kindsOf(backfill.plan(half)).includes('email:half-a-range'))
  const rolled = cleanScope(); rolled.email.from = '2026-02-30'
  assert.ok(kindsOf(backfill.plan(rolled)).includes('email:not-a-day'))
  const backwards = cleanScope(); backwards.email = { from: '2026-08-25', to: '2025-08-25' }
  assert.ok(kindsOf(backfill.plan(backwards)).includes('email:range-backwards'))
})

check('there is no mailbox setting: naming one refuses the scope, whatever it names', () => {
  // The earlier gate accepted any non-empty string and held the ownership
  // question in prose, which made the scope advertise a guarantee it did
  // not hold: finance@example.com came back ok while claiming the read was
  // restricted to the user's own mailbox. No approval gate follows a read.
  for (const mailbox of ['finance@example.com', 'all', ['everyone@example.com'], '']) {
    const scope = cleanScope(); scope.email.mailbox = mailbox
    assert.ok(kindsOf(backfill.plan(scope)).includes('email:mailbox-not-a-setting'), `${JSON.stringify(mailbox)} got through`)
  }
})

check('a refused scope carries no plan at all, not the half that was fine', () => {
  const scope = cleanScope(); scope.email.from = 'January'
  const refused = backfill.plan(scope)
  assert.strictEqual(refused.ok, false)
  assert.ok(!('reading' in refused) && !('notReading' in refused), 'a refused scope leaked its plan')
})

// ------------------------------------------------------------------ candidates

const finding = over => ({ what: 'Gong', where: 'invoice, 2026-07-02, billing@vendor.example', kind: 'invoice', ...over })

check('every candidate says where it came from, down to the message or the file', () => {
  const result = backfill.candidates([finding({ where: '' })])
  assert.strictEqual(result.ok, false)
  assert.ok(kindsOf(result).some(k => k.endsWith(':missing')))
})

check('an unknown kind is refused now, a missing kind is a question', () => {
  const unknown = backfill.candidates([finding({ kind: 'tweet' })])
  assert.ok(kindsOf(unknown).some(k => k.endsWith(':unknown-kind')))
  const asked = backfill.candidates([finding({ kind: undefined })])
  assert.strictEqual(asked.ok, true)
  assert.strictEqual(asked.needKind.length, 1)
  assert.deepStrictEqual(asked.candidates, [])
})

check('candidates carry their evidence strength, and the announcement is the weak one', () => {
  const result = backfill.candidates([
    finding({ what: 'Gong', kind: 'contract' }),
    finding({ what: 'Loom', kind: 'receipt' }),
    finding({ what: 'Clip', kind: 'announcement' })
  ])
  assert.strictEqual(result.ok, true)
  const byName = Object.fromEntries(result.candidates.map(c => [c.what, c]))
  assert.ok(/whole contract group/.test(byName.Gong.strength))
  assert.ok(/thin fill/.test(byName.Loom.strength))
  assert.ok(/weak/.test(byName.Clip.strength))
  assert.ok(/duplicates/.test(result.note), 'the note must route every candidate through the duplicate check')
})

// ----------------------------------------------------------------------- draft

const candidate = rowOver => ({
  what: 'Gong',
  where: 'contract PDF, Always Allow › Contracts › Gong-2026.pdf',
  kind: 'contract',
  row: {
    Name: 'Gong',
    Status: 'Active',
    Renews: 'Automatically',
    'Annual cost': 60000,
    'Notice deadline': '2026-11-14',
    'Contract dates': { start: '2026-01-01', end: '2026-12-31' },
    'Contract link': 'https://drive.google.com/file/d/abc/view',
    ...rowOver
  }
})

check('a clean candidate drafts, carrying only the fillable fields and saying what stays empty', () => {
  const drafted = backfill.draft(candidate())
  assert.strictEqual(drafted.ok, true)
  assert.strictEqual(drafted.backfill, true)
  assert.ok(/review/.test(drafted.leftEmpty.lastReviewed))
})

check('every never-filled field refuses the whole draft, not just its own field', () => {
  // The list is pinned by value first: iterating the module's own list would
  // pass vacuously if the list were emptied, which mutation run 1 proved by
  // doing exactly that — the loop ran zero times and the check stayed green.
  assert.deepStrictEqual(backfill.NEVER_FILLED,
    ['Owner', 'Technical owner', 'Admins', 'Billing owner', 'Last reviewed'])
  for (const field of backfill.NEVER_FILLED) {
    const one = candidate({ [field]: field === 'Last reviewed' ? '2026-08-25' : 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' })
    const drafted = backfill.draft(one)
    assert.strictEqual(drafted.ok, false, `${field} did not refuse`)
    assert.ok(kindsOf(drafted).includes(`${field}:never-filled`))
  }
})

check('Importance needs exact Slack consequence evidence and still travels through the approval draft', () => {
  assert.ok(kindsOf(backfill.draft(candidate({ Importance: 'Business critical' }))).includes('Importance:unsupported'))

  const supported = candidate({ Importance: 'Business critical' })
  supported.importanceEvidence = {
    source: 'slack',
    where: '#sales, thread 1724800000.000000, 2026-08-21',
    whatBreaks: 'Sales cannot review calls or coach live deals',
    howFast: 'The workflow stops the same day'
  }
  const drafted = backfill.draft(supported)
  assert.strictEqual(drafted.ok, true)
  assert.strictEqual(drafted.row.Importance, 'Business critical')
  assert.ok(!('importance' in drafted.leftEmpty))
  assert.strictEqual(drafted.importanceEvidence.source, 'slack')

  const wrongSource = candidate({ Importance: 'Important' })
  wrongSource.importanceEvidence = { ...supported.importanceEvidence, source: 'contract' }
  assert.ok(kindsOf(backfill.draft(wrongSource)).includes('importanceEvidence.source:wrong-source'))

  const evidenceOnly = candidate()
  evidenceOnly.importanceEvidence = supported.importanceEvidence
  assert.ok(kindsOf(backfill.draft(evidenceOnly)).includes('Importance:evidence-without-value'))
})

check('a field outside the fillable set is refused, and so is a missing name, status or provenance', () => {
  assert.ok(kindsOf(backfill.draft(candidate({ SSO: 'Enforced' }))).includes('SSO:not-backfills-field'))
  assert.ok(kindsOf(backfill.draft(candidate({ Name: ' ' }))).includes('Name:missing'))
  assert.ok(kindsOf(backfill.draft(candidate({ Status: undefined }))).includes('Status:missing'))
  const anonymous = candidate(); anonymous.where = ''
  assert.ok(kindsOf(backfill.draft(anonymous)).includes('where:missing'))
})

check('the candidate top level has its own allowlist, so nothing outside row is silently dropped', () => {
  // { Owner: ..., row: validRow } used to pass with the Owner silently
  // dropped: the refused-not-dropped invariant breaking one layer above the
  // gate that enforces it.
  const owned = candidate(); owned.Owner = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
  assert.ok(kindsOf(backfill.draft(owned)).includes('Owner:never-filled'))
  const stamped = candidate(); stamped['Last reviewed'] = '2026-08-25'
  assert.ok(kindsOf(backfill.draft(stamped)).includes('Last reviewed:never-filled'))
  const stranger = candidate(); stranger.Plan = 'Enterprise'
  assert.ok(kindsOf(backfill.draft(stranger)).includes('Plan:unknown-candidate-field'))
  assert.throws(() => backfill.properties(context, owned), /never fills|refused/)
})

check('the kind is settled by draft time, and the contract group comes from a contract only', () => {
  const unkinded = candidate(); delete unkinded.kind
  assert.ok(kindsOf(backfill.draft(unkinded)).includes('kind:missing'))
  const receipt = candidate(); receipt.kind = 'receipt'
  const refused = kindsOf(backfill.draft(receipt))
  for (const field of backfill.CONTRACT_GROUP) {
    assert.ok(refused.includes(`${field}:not-from-this-evidence`), `${field} from a receipt got through`)
  }
  // The honest receipt row: the name and little else.
  const thin = { what: 'Loom', where: 'receipt, 2026-07-02', kind: 'receipt', row: { Name: 'Loom', Status: 'Active' } }
  assert.strictEqual(backfill.draft(thin).ok, true)
})

check('the shared value gates run at draft time, with the candidate still on the table', () => {
  assert.ok(kindsOf(backfill.draft(candidate({ Renews: 'Auto' }))).includes('Renews:unknown-value'))
  assert.ok(kindsOf(backfill.draft(candidate({ 'Notice deadline': '2026-02-30' }))).includes('Notice deadline:not-a-day'))
})

// ------------------------------------------------------------------ the payload

check('the payload writes every fillable field through the map and never carries the review stamp', () => {
  const supported = candidate({
    Description: 'Records calls; Sales depends on it.',
    Importance: 'Business critical',
    Domain: 'Sales Enablement',
    Audience: ['Sales', 'RevOps']
  })
  supported.importanceEvidence = {
    source: 'slack',
    where: '#sales, thread 1724800000.000000, 2026-08-21',
    whatBreaks: 'Sales cannot review calls or coach live deals',
    howFast: 'The workflow stops the same day'
  }
  const out = backfill.properties(context, supported)
  assert.strictEqual(out['W Name'], 'Gong')
  assert.strictEqual(out['W Status'], 'V Active')
  assert.strictEqual(out['W Importance'], 'V Business critical')
  assert.strictEqual(out['W Description'], 'Records calls; Sales depends on it.')
  assert.strictEqual(out['W Domain'], 'V Sales Enablement')
  assert.deepStrictEqual(out['W Audience'], ['V Sales', 'V RevOps'])
  assert.strictEqual(out['W Renews'], 'V Automatically')
  assert.strictEqual(out['W Annual cost'], 60000)
  assert.strictEqual(out['W Contract link'], 'https://drive.google.com/file/d/abc/view')
  assert.strictEqual(out['date:W Notice deadline:start'], '2026-11-14')
  assert.strictEqual(out['date:W Contract dates:start'], '2026-01-01')
  assert.strictEqual(out['date:W Contract dates:end'], '2026-12-31')
  // Named alternatives, not a substring net: /Owner/ never matched the
  // lowercase o in "Technical owner" or "Billing owner".
  for (const key of Object.keys(out)) {
    assert.ok(!/Last reviewed|W Owner|Technical owner|Billing owner|Admins/.test(key), `the payload carries ${key}`)
  }
})

check('the payload builder refuses what draft refuses, rather than building around it', () => {
  assert.throws(() => backfill.properties(context, candidate({ Importance: 'Standard' })), /unsupported|Importance/)
})

check('the draft output composes: it can be handed straight back to the payload builder', () => {
  // backfill-create and prove-backfill re-validate by calling draft again,
  // and a saved draft output used to be refused for kind:missing plus the
  // fields draft itself had added — the commands were not composable on
  // their own output.
  const drafted = backfill.draft(candidate())
  assert.strictEqual(drafted.ok, true)
  assert.strictEqual(drafted.kind, 'contract', 'the candidate identity must travel on the output')
  const out = backfill.properties(context, drafted)
  assert.strictEqual(out['W Name'], 'Gong')
})

check('whitespace text is refused as nothing wearing a value\'s shape, and real values travel trimmed', () => {
  assert.ok(kindsOf(backfill.draft(candidate({ Description: '   ' }))).includes('Description:blank'))
  assert.ok(kindsOf(backfill.draft(candidate({ 'Contract link': '  ' }))).includes('Contract link:blank'))
  const padded = backfill.properties(context, candidate({ Description: '  Records calls.  ' }))
  assert.strictEqual(padded['W Description'], 'Records calls.', 'a failure here means the backfill payload carried Description untrimmed, where new trims it')
  assert.strictEqual(padded['W Contract link'], 'https://drive.google.com/file/d/abc/view')
})

// ------------------------------------------------------------------- the proof

check('a backfilled page is proved by what is absent, and an arrived stamp fails it', () => {
  const clean = { 'W Name': 'Gong' }
  assert.deepStrictEqual(backfill.proveAbsent(context, clean, cameBackEmpty), [])
  const stamped = { 'W Name': 'Gong', 'date:W Last reviewed:start': '2026-08-25' }
  const caught = backfill.proveAbsent(context, stamped, cameBackEmpty)
  assert.strictEqual(caught.length, 1)
  assert.strictEqual(caught[0].field, 'Last reviewed')
  const owned = { 'W Name': 'Gong', 'W Owner': '["user://aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"]' }
  assert.ok(backfill.proveAbsent(context, owned, cameBackEmpty).some(p => p.field === 'Owner'))
  const unexpectedImportance = { 'W Name': 'Gong', 'W Importance': 'V Standard' }
  assert.ok(backfill.proveAbsent(context, unexpectedImportance, cameBackEmpty).some(p => p.field === 'Importance'))
  assert.deepStrictEqual(backfill.proveAbsent(context, unexpectedImportance, cameBackEmpty, true), [],
    'an evidence-supported Importance value is expected rather than treated as an accidental fill')
  const emptyShapes = { 'W Owner': '[]', 'W Importance': '' }
  assert.deepStrictEqual(backfill.proveAbsent(context, emptyShapes, cameBackEmpty), [], 'Notion\'s three empty shapes must all read as absent')
})

// ------------------------------------------------------------------------ fill

check('fill takes a mapped row only, fills only genuine blanks, and never overwrites', () => {
  const raw = backfill.fill({ url: 'x', properties: {} }, candidate())
  assert.strictEqual(raw.ok, false)

  const existing = { url: 'https://www.notion.so/Tool-' + 'a'.repeat(32), values: { 'Annual cost': 58000, Renews: '' } }
  const result = backfill.fill(existing, candidate())
  assert.strictEqual(result.ok, true)
  assert.strictEqual(result.changes.Renews, 'Automatically')
  assert.ok(!('Annual cost' in result.changes), 'a held field was overwritten')
  assert.ok(result.alreadyHeld.some(h => h.field === 'Annual cost'))
  assert.ok(!('Name' in result.changes) && !('Status' in result.changes), 'identity and state belong to the row that exists')
})

check('a forbidden field on the candidate refuses the whole fill, and filling nothing is a finished answer', () => {
  const existing = { url: 'x', values: {} }
  const refused = backfill.fill(existing, candidate({ Owner: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }))
  assert.strictEqual(refused.ok, false)

  const full = { url: 'x', values: { Renews: 'Automatically', 'Annual cost': 60000, 'Notice deadline': '2026-11-14', 'Contract dates': { start: '2026-01-01' }, 'Contract link': 'https://drive.google.com/x' } }
  const nothing = backfill.fill(full, candidate())
  assert.strictEqual(nothing.ok, true)
  assert.strictEqual(nothing.nothingToFill, true)
  assert.ok(/finished answer/.test(nothing.note))
})

// ---------------------------------------------------------- the command layer

const ID = letter => letter.repeat(32)
const URL = letter => `https://www.notion.so/Tool-${letter.toUpperCase()}-${ID(letter)}`

check('backfill-create carries a stamp-free payload, no body, and the say-it-is-a-backfill note', () => {
  const out = capture(() => command.commands['backfill-create'](save('candidate.json', candidate())))
  assert.deepStrictEqual(out.parent, { data_source_id: 'software-ds' })
  assert.strictEqual(out.properties.Name, 'Gong')
  assert.deepStrictEqual(out.headings, [])
  assert.ok(!('date:Last reviewed:start' in out.properties), 'a backfill create stamped the row')
  assert.ok(/backfill/.test(out.leftEmpty))
})

check('prove-backfill fails a page that arrived stamped, even when everything sent came back', () => {
  const sent = capture(() => command.commands['backfill-create'](save('candidate.json', candidate())))
  const faithful = { url: URL('a'), properties: { ...sent.properties } }
  const clean = capture(() => command.commands['prove-backfill'](save('candidate.json', candidate()), save('back.json', faithful), URL('a')))
  assert.strictEqual(clean.proved, true)
  const stamped = { url: URL('a'), properties: { ...sent.properties, 'date:Last reviewed:start': '2026-08-25' } }
  const caught = capture(() => command.commands['prove-backfill'](save('candidate.json', candidate()), save('stamped.json', stamped), URL('a')))
  assert.strictEqual(caught.proved, false)
  assert.ok(caught.problems.some(p => p.what === 'Last reviewed'))
})

check('backfill-fill maps a renamed workspace back before deciding what is blank', () => {
  writeConfig(renamed)
  try {
    // On a renamed workspace the fetched page carries R-prefixed names and
    // values. Read raw, every field would look blank and the fill would
    // offer everything; mapped, the held cost is seen and left alone. One
    // held field per shape: a number, a select, a multi-select and a date,
    // because deleting the reverse mapping for any one of them must go red
    // here, and alreadyHeld is shown to a person, who reads logical values.
    const page = {
      url: URL('a'),
      properties: {
        'R Name': 'Gong',
        'R Status': 'R Active',
        'R Annual cost': 58000,
        'R Renews': 'R Manually',
        'R Audience': '["R Sales"]',
        'date:R Notice deadline:start': '2026-10-01'
      }
    }
    const out = capture(() => command.commands['backfill-fill'](save('existing.json', page), save('candidate.json', candidate({ Audience: ['Sales'] }))))
    assert.strictEqual(out.ok, true)
    for (const field of ['Annual cost', 'Renews', 'Audience', 'Notice deadline']) {
      assert.ok(!(field in out.changes), `held ${field} read as blank through the raw names`)
    }
    const held = Object.fromEntries(out.alreadyHeld.map(h => [h.field, h.holds]))
    assert.strictEqual(held.Renews, 'Manually', 'alreadyHeld shows the workspace value, not the logical one')
    assert.deepStrictEqual(held.Audience, ['Sales'], 'a held multi-select is not reverse-mapped')
    assert.strictEqual(held['Notice deadline'], '2026-10-01')
    assert.strictEqual(out.changes['Contract link'], 'https://drive.google.com/file/d/abc/view', 'a genuinely blank field is still offered')
  } finally {
    writeConfig(identity)
  }
})

check('the backfill commands refuse the wrong shape at the door, non-zero', () => {
  const scope = capture(() => { command.commands['backfill-scope'](save('scope.json', { sources: ['slack'] })) })
  assert.strictEqual(scope.ok, false)
  assert.strictEqual(process.exitCode, 1)
  process.exitCode = 0
})

console.log(failures ? `\n${failures} failed.\n` : '\nAll passed.\n')
process.exit(failures ? 1 : 0)

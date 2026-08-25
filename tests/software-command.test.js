'use strict'

/**
 * The Software command layer: the queries it builds and the judgments it
 * makes.
 *
 * TWO CONFIGS, AND THAT IS THE POINT. One records the shipped property names
 * and one records a workspace that renamed every property and every value. A
 * query built against the second that still carries the shipped names would
 * come back with no rows, and no rows is exactly what an empty directory
 * looks like.
 *
 * WHAT THIS DOES NOT PROVE. No SQL here has been sent. The queries are
 * asserted as strings, and whether Notion's SQL surface accepts them is a
 * live-run question this cannot answer. That constraint stands for the whole
 * `process` plugin too and is recorded as one.
 *
 * Run: node tests/software-command.test.js
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const assert = require('assert')
const { execFileSync } = require('child_process')

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'gtm-software-command-'))
process.env.GTM_OPERATOR_CONFIG = path.join(SANDBOX, 'gtm-operator.config.json')

const setupSchema = require('../plugins/setup/scripts/schema')

const identity = setupSchema.identityNames('software')

/** Every property and every value renamed, so a raw name in a query shows. */
const renamed = {
  properties: Object.fromEntries(Object.keys(identity.properties).map(k => [k, `R ${k}`])),
  values: Object.fromEntries(
    Object.entries(identity.values).map(([property, values]) => [
      property,
      Object.fromEntries(Object.keys(values).map(v => [v, `R ${v}`]))
    ])
  )
}

const PERSON = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

const configWith = map => ({
  configVersion: 3,
  state: 'complete',
  notion: { parentPageId: 'p', personId: PERSON },
  databases: {
    software: {
      databaseId: 'software-db',
      dataSourceId: 'software-ds',
      displayName: 'software',
      properties: map.properties,
      values: map.values
    }
  },
  verified: { at: 'x', definitions: 'y' },
  defaults: {},
  sources: {},
  taxonomyPath: '/tmp/x'
})

const writeConfig = map => fs.writeFileSync(process.env.GTM_OPERATOR_CONFIG, JSON.stringify(configWith(map), null, 2))

writeConfig(identity)

const command = require('../plugins/software/scripts/software')

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
  process.exitCode = 0
}

const withConfig = (map, fn) => {
  writeConfig(map)
  try { return fn() } finally { writeConfig(identity) }
}

const capture = fn => {
  const printed = []
  const real = console.log
  console.log = (...args) => printed.push(args.join(' '))
  try { fn() } finally { console.log = real }
  return JSON.parse(printed.join('\n'))
}

const save = (name, value) => {
  const file = path.join(SANDBOX, name)
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value))
  return file
}

const ID = letter => letter.repeat(32)
const URL = letter => `https://www.notion.so/Tool-${letter.toUpperCase()}-${ID(letter)}`

const SCRIPT = path.join(__dirname, '..', 'plugins', 'software', 'scripts', 'software.js')
const run = (args, env) => {
  try {
    return { status: 0, out: execFileSync('node', [SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, ...env } }) }
  } catch (err) {
    return { status: err.status, out: `${err.stdout || ''}${err.stderr || ''}` }
  }
}

console.log('\nthe software command layer\n')

// ------------------------------------------------------------------- refusals

check('without a config, every command refuses and names setup', () => {
  const gone = path.join(SANDBOX, 'no-such-config.json')
  const result = run(['context'], { GTM_OPERATOR_CONFIG: gone })
  assert.notStrictEqual(result.status, 0)
  assert.ok(/setup/.test(result.out), 'the refusal does not name setup')
})

check('an unknown command and an unknown flag are refused, not guessed at', () => {
  const unknown = run(['audit'])
  assert.notStrictEqual(unknown.status, 0)
  assert.ok(/Unknown command/.test(unknown.out))
  const flag = run(['review', save('c.json', {}), save('e.json', { url: URL('a'), properties: {} }), '--force', '--confirmed', '--today', '2026-08-25'])
  assert.notStrictEqual(flag.status, 0)
  assert.ok(/Unknown flag/.test(flag.out))
})

check('contracts refuses its arguments before reading any input', () => {
  // The argument gate runs first, so a bad --today is named even when the
  // rows file does not exist: the slop-check lesson, refuse what you do not
  // recognise before reading anything.
  const result = run(['contracts', path.join(SANDBOX, 'never-written.json'), '--today', 'someday'])
  assert.notStrictEqual(result.status, 0)
  assert.ok(/--today/.test(result.out) && !/never-written/.test(result.out), 'the file was reached before the argument was judged')
})

check('valid JSON of the wrong shape is refused at the door', () => {
  const result = run(['check', save('list.json', [1, 2])])
  assert.notStrictEqual(result.status, 0)
  assert.ok(/set of fields/.test(result.out))
})

// -------------------------------------------------------------------- queries

check('directory and contracts-survey resolve every name through the map', () => {
  withConfig(renamed, () => {
    const directory = capture(() => command.commands.directory())
    assert.ok(directory.sql.includes('"R Name"'), 'the directory query carries a shipped name')
    assert.ok(!directory.sql.includes('"Name"'), 'the directory query carries a raw name nobody uses')
    const survey = capture(() => command.commands['contracts-survey']())
    assert.ok(survey.sql.includes('"R Renews"'))
    assert.ok(survey.sql.includes('"date:R Notice deadline:start"'), 'the notice deadline is not read through its date column')
    assert.ok(survey.sql.includes('FROM <software-ds> AS s'))
  })
})

// ----------------------------------------------------------------- duplicates

check('duplicates finds the exact match, offers the near match, and says what it cannot see', () => {
  const rows = [
    { url: URL('a'), Name: 'Gong', Status: 'Active' },
    { url: URL('b'), Name: 'Google Workspace', Status: 'Active' },
    { url: URL('c'), Name: 'Figma', Status: 'Active' }
  ]
  const exact = capture(() => command.commands.duplicates(save('rows.json', rows), 'gong'))
  assert.strictEqual(exact.duplicates.length, 1)
  assert.strictEqual(exact.duplicates[0].name, 'Gong')
  const near = capture(() => command.commands.duplicates(save('rows.json', rows), 'Google'))
  assert.strictEqual(near.duplicates.length, 0)
  assert.strictEqual(near.nearMatches.length, 1)
  const none = capture(() => command.commands.duplicates(save('rows.json', rows), 'Loom'))
  assert.ok(/by name only/.test(none.note), 'a clean answer must still say the check is by name')
})

check('duplicates refuses a result that was never saved, rather than reading it as empty', () => {
  assert.throws(() => command.commands.duplicates(save('null.json', 'null'), 'Gong'), /not sent|null/)
})

// --------------------------------------------------------------- create, prove

const cleanTool = () => ({
  Name: 'Gong',
  Description: 'Records customer calls; Sales depends on it.',
  Status: 'Active',
  Importance: 'Important',
  Domain: 'Sales Enablement',
  Audience: ['Sales'],
  Renews: 'Automatically',
  'Notice deadline': '2026-11-14',
  'Annual cost': 60000,
  today: '2026-08-25',
  body: {
    'What It Does For Us': 'Records calls. If it stops, coaching stops that week.',
    'How To Get Access': 'Ask Priya Shah.',
    'Vendor Contacts': 'No rep; support tickets only.'
  }
})

check('check reports writable with the word count, and a broken row non-zero with the reasons', () => {
  const good = capture(() => command.commands.check(save('good.json', cleanTool())))
  assert.strictEqual(good.writable, true)
  assert.ok(good.wordCount > 0 && good.ceiling === 400)
  const bad = run(['check', save('bad.json', { ...cleanTool(), Status: 'Live' })])
  assert.notStrictEqual(bad.status, 0)
  assert.ok(/Live/.test(bad.out))
})

check('create carries the payload, the body, and the notes that stop over-reporting', () => {
  const out = capture(() => command.commands.create(save('tool.json', cleanTool())))
  assert.deepStrictEqual(out.parent, { data_source_id: 'software-ds' })
  assert.strictEqual(out.properties.Name, 'Gong')
  assert.strictEqual(out.properties['date:Last reviewed:start'], '2026-08-25')
  assert.deepStrictEqual(out.headings, ['What It Does For Us', 'How To Get Access', 'Vendor Contacts'])
  assert.ok(/NOT WRITTEN/.test(out.relationNote), 'the relation note must say the relations are not written')
  assert.ok(/proves nothing/.test(out.note))
})

check('prove passes a faithful read-back and fails a discarded property', () => {
  const tool = save('tool.json', cleanTool())
  const sent = capture(() => command.commands.create(tool))
  const faithful = {
    url: URL('a'),
    properties: { ...sent.properties, 'Last reviewed': '2026-08-25' },
    headings: sent.headings
  }
  const proved = capture(() => command.commands.prove(tool, save('back.json', faithful), URL('a')))
  assert.strictEqual(proved.proved, true)
  const dropped = { ...faithful, properties: { ...faithful.properties } }
  delete dropped.properties.Renews
  const failed = capture(() => command.commands.prove(tool, save('dropped.json', dropped), URL('a')))
  assert.strictEqual(failed.proved, false)
  assert.ok(failed.problems.some(p => p.what === 'Renews'))
})

check('prove refuses to check a different page than the one written to', () => {
  const tool = save('tool.json', cleanTool())
  const back = save('back.json', { url: URL('b'), properties: { Name: 'Gong' } })
  const result = capture(() => command.commands.prove(tool, back, URL('a')))
  assert.strictEqual(result.proved, false)
  assert.ok(result.problems.some(p => /not the page/.test(p.why)))
})

// -------------------------------------------------------------- update, review

check('update targets the fetched page, lists its clears, and never carries Last reviewed', () => {
  const existing = save('existing.json', { url: URL('a'), properties: { Name: 'Gong' } })
  const out = capture(() => command.commands.update(save('changes.json', { 'Annual cost': 61000, Owner: null }), existing))
  assert.strictEqual(out.target, ID('a'))
  assert.strictEqual(out.properties['Annual cost'], 61000)
  assert.deepStrictEqual(out.cleared, ['Owner'])
  assert.ok(!('date:Last reviewed:start' in out.properties), 'update moved the freshness stamp')
  assert.ok(/never moves it/.test(out.preserved))
})

check('update refuses a summary saved instead of the page', () => {
  const result = run(['update', save('c.json', { 'Annual cost': 1 }), save('summary.json', { name: 'Gong' })])
  assert.notStrictEqual(result.status, 0)
  assert.ok(/url/.test(result.out))
})

check('review stamps only under --confirmed --today, and says which happened', () => {
  const existing = save('existing.json', { url: URL('a'), properties: { Name: 'Gong' } })
  const changes = save('changes.json', { 'Annual cost': 61000 })
  const stamped = capture(() => command.commands.review(changes, existing, '--confirmed', '--today', '2026-08-25'))
  assert.strictEqual(stamped.stamped, true)
  assert.strictEqual(stamped.properties['date:Last reviewed:start'], '2026-08-25')
  const unstamped = capture(() => command.commands.review(changes, existing))
  assert.strictEqual(unstamped.stamped, false)
  assert.ok(!('date:Last reviewed:start' in unstamped.properties))
  assert.ok(/NOT moved/.test(unstamped.stampNote))
})

check('prove-update takes the command output, not the inputs', () => {
  const result = run(['prove-update', save('inputs.json', { 'Annual cost': 1 }), save('back.json', { url: URL('a'), properties: {} })])
  assert.notStrictEqual(result.status, 0)
  assert.ok(/target/.test(result.out))
})

// ------------------------------------------------------------------- contracts

const contractRow = (letter, over) => ({
  url: URL(letter),
  Name: `Tool ${letter.toUpperCase()}`,
  Status: 'Active',
  Importance: 'Important',
  Renews: 'Automatically',
  'Annual cost': 1000,
  'date:Notice deadline:start': '2026-09-10',
  'date:Contract dates:start': '2026-01-01',
  'date:Contract dates:end': '2026-12-31',
  ...over
})

check('contracts orders by consequence: cost outranks date, and manual is a diary note', () => {
  const rows = [
    contractRow('a', { 'Annual cost': 300, 'date:Notice deadline:start': '2026-09-01' }),
    contractRow('b', { 'Annual cost': 60000, 'date:Notice deadline:start': '2026-09-15' }),
    contractRow('c', { Renews: 'Manually', 'date:Notice deadline:start': '2026-08-30' })
  ]
  const out = capture(() => command.commands.contracts(save('rows.json', rows), '--today', '2026-08-25'))
  assert.deepStrictEqual(out.deadlines.map(r => r.name), ['Tool B', 'Tool A'],
    'the sixty-thousand-dollar deadline two weeks out must outrank the three-hundred-dollar one next week')
  assert.deepStrictEqual(out.diary.map(r => r.name), ['Tool C'])
  assert.ok(/commits you to another term/.test(out.deadlines[0].why))
  assert.ok(/diary note/.test(out.diary[0].why))
})

check('contracts counts every row it could not assess, with why, and never drops the line', () => {
  const rows = [
    contractRow('a'),
    contractRow('b', { 'date:Notice deadline:start': null }),
    contractRow('c', { Renews: 'Unknown' }),
    contractRow('d', { Renews: null, 'date:Notice deadline:start': null, 'date:Contract dates:start': null, 'date:Contract dates:end': null })
  ]
  const out = capture(() => command.commands.contracts(save('rows.json', rows), '--today', '2026-08-25'))
  assert.strictEqual(out.couldNotAssess.length, 3)
  const reasons = Object.fromEntries(out.couldNotAssess.map(r => [r.name, r.reasons]))
  assert.deepStrictEqual(reasons['Tool B'], ['no notice deadline'])
  assert.deepStrictEqual(reasons['Tool C'], ['Renews unknown'])
  assert.deepStrictEqual(reasons['Tool D'], ['no notice deadline', 'no contract dates', 'Renews unknown'])
  assert.ok(/HALF THE ANSWER/.test(out.couldNotAssessNote))
})

check('contracts flags an overdue automatic deadline as already committed', () => {
  const rows = [contractRow('a', { 'date:Notice deadline:start': '2026-08-20' })]
  const out = capture(() => command.commands.contracts(save('rows.json', rows), '--today', '2026-08-25'))
  assert.ok(/passed 5 days ago/.test(out.deadlines[0].why))
  assert.ok(/already committed/.test(out.deadlines[0].why))
})

check('contracts leaves Retired and Rejected out, counted, and respects the window', () => {
  const rows = [
    contractRow('a', { Status: 'Retired' }),
    contractRow('b', { Status: 'Rejected' }),
    contractRow('c', { 'date:Notice deadline:start': '2027-08-01' }),
    contractRow('d')
  ]
  const out = capture(() => command.commands.contracts(save('rows.json', rows), '--today', '2026-08-25'))
  assert.deepStrictEqual(out.leftOut, { retired: 1, rejected: 1, note: out.leftOut.note })
  assert.strictEqual(out.beyondWindow, 1)
  assert.deepStrictEqual(out.deadlines.map(r => r.name), ['Tool D'])
  const wide = capture(() => command.commands.contracts(save('rows.json', rows), '--today', '2026-08-25', '--window', '400'))
  assert.strictEqual(wide.beyondWindow, 0)
})

check('contracts reads a renamed workspace back through the map', () => {
  withConfig(renamed, () => {
    const rows = [{
      url: URL('a'),
      'R Name': 'Gong',
      'R Status': 'R Active',
      'R Importance': 'R Important',
      'R Renews': 'R Automatically',
      'R Annual cost': 500,
      'date:R Notice deadline:start': '2026-09-01',
      'date:R Contract dates:start': '2026-01-01',
      'date:R Contract dates:end': '2026-12-31'
    }]
    const out = capture(() => command.commands.contracts(save('rows.json', rows), '--today', '2026-08-25'))
    assert.strictEqual(out.deadlines.length, 1, 'a renamed workspace read as unassessable: the map was not used on the way back')
    assert.strictEqual(out.deadlines[0].renews, 'Automatically')
  })
})

check('contracts refuses a null result rather than reading it as an empty directory', () => {
  assert.throws(() => command.commands.contracts(save('null.json', 'null'), '--today', '2026-08-25'), /not sent|null/)
})

console.log(failures ? `\n${failures} failed.\n` : '\nAll passed.\n')
process.exit(failures ? 1 : 0)

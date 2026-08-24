'use strict'

/**
 * `audit`, `flags`, `update` and `prove-update`.
 *
 * TWO DATABASES HERE, NOT ONE. `audit` reads Memos for the newer-related-memo
 * signal, which is the only place this plugin touches another database, so the
 * config carries both and one test removes Memos to prove the refusal.
 *
 * WHAT THIS DOES NOT PROVE. No SQL here has been sent. The queries are asserted
 * as strings, and whether Notion's SQL surface accepts them is a live-run
 * question this cannot answer.
 *
 * Run: node tests/process-audit-update.test.js
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const assert = require('assert')

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'gtm-audit-update-'))
process.env.GTM_OPERATOR_CONFIG = path.join(SANDBOX, 'gtm-operator.config.json')

const setupSchema = require('../plugins/setup/scripts/schema')
const artifact = require('../plugins/process/scripts/artifact')
const processNames = setupSchema.identityNames('process')
const memoNames = setupSchema.identityNames('memos')

const rename = names => ({
  properties: Object.fromEntries(Object.keys(names.properties).map(k => [k, `R ${k}`])),
  values: Object.fromEntries(
    Object.entries(names.values).map(([property, values]) => [
      property,
      Object.fromEntries(Object.keys(values).map(v => [v, `R ${v}`]))
    ])
  )
})

const writeConfig = ({ process: p = processNames, memos: m = memoNames, withMemos = true, personId = 'person-1' } = {}) => {
  const databases = {
    process: {
      databaseId: 'db1', dataSourceId: 'ds1', displayName: 'Process',
      properties: p.properties, values: p.values
    }
  }
  if (withMemos) {
    databases.memos = {
      databaseId: 'db2', dataSourceId: 'ds2', displayName: 'Memos',
      properties: m.properties, values: m.values
    }
  }
  fs.writeFileSync(process.env.GTM_OPERATOR_CONFIG, JSON.stringify({
    configVersion: 3,
    state: 'complete',
    notion: { parentPageId: 'p', personId },
    databases,
    verified: { at: 'x', definitions: 'y' },
    defaults: {}, sources: {}, taxonomyPath: '/tmp/x'
  }, null, 2))
  for (const mod of ['../shared/config-read', '../plugins/process/scripts/process']) {
    delete require.cache[require.resolve(mod)]
  }
  return require('../plugins/process/scripts/process')
}

let command = writeConfig()

/** The context for whatever config `writeConfig` last wrote. */
const contextNow = () => {
  delete require.cache[require.resolve('../shared/config-read')]
  const fresh = require('../shared/config-read')
  return fresh.contextFor('process', require('../shared/process-schema').IDENTITY)
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

/** Run a command that prints, and give back what it printed. */
const capture = (fn) => {
  const printed = []
  const real = console.log
  console.log = (...args) => printed.push(args.join(' '))
  try { fn() } finally { console.log = real }
  return JSON.parse(printed.join('\n'))
}

const write = (name, value) => {
  const file = path.join(SANDBOX, name)
  fs.writeFileSync(file, JSON.stringify(value))
  return file
}

const URL_A = 'https://notion.so/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1'
const URL_B = 'https://notion.so/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2'
const URL_C = 'https://notion.so/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa3'

console.log('\naudit, flags, update and prove-update\n')

// ------------------------------------------------------------------- audit

check('audit builds both queries and writes nothing', () => {
  const out = capture(() => command.commands.audit())
  assert.ok(out.artifactSql.includes('FROM <process-ds>'), out.artifactSql)
  assert.ok(out.memoSql.includes('FROM <memos-ds>'), out.memoSql)
  assert.ok(!/INSERT|UPDATE |DELETE/i.test(out.artifactSql + out.memoSql), 'audit built something that writes')
})

check('THE MEMO QUERY GOES THROUGH THE REVERSE RELATION, sorted by published date', () => {
  // Reading the artifact's own relation returns at most 25 references and caps
  // at 100 pages, so on a long-lived artifact the newest memo is invisible and
  // the strongest signal degrades to nothing without saying so.
  const out = capture(() => command.commands.audit())
  assert.ok(/FROM <memos-ds> AS m/.test(out.memoSql), 'the memo query does not read from Memos')
  assert.ok(/ORDER BY .*Published date.* DESC/.test(out.memoSql), `not sorted by published date:\n${out.memoSql}`)
  assert.ok(!/Memos/.test(out.artifactSql), 'the artifact query reads the relation property, which caps and hides the newest memo')
})

check('the date columns carry the date: prefix in both queries', () => {
  const out = capture(() => command.commands.audit())
  assert.ok(out.artifactSql.includes('"date:Last checked for accuracy:start"'), out.artifactSql)
  assert.ok(out.memoSql.includes('"date:Published date:start"'), out.memoSql)
})

check('audit selects Verified by, which find does not', () => {
  const out = capture(() => command.commands.audit())
  assert.ok(out.artifactSql.includes('"Verified by"'), 'signal 4 has nothing to read')
  assert.ok(!command.selectList(require('../shared/config-read').contextFor('process', require('../shared/process-schema').IDENTITY)).includes('Verified by'),
    'find now carries a person column it never looks at')
})

check('both queries follow a renamed workspace', () => {
  command = writeConfig({ process: rename(processNames), memos: rename(memoNames) })
  const out = capture(() => command.commands.audit())
  assert.ok(out.artifactSql.includes('"R Name"'), out.artifactSql)
  assert.ok(out.memoSql.includes('"R Artifacts"'), out.memoSql)
  assert.ok(out.memoSql.includes('"date:R Published date:start"'), out.memoSql)
  command = writeConfig()
})

check('WITH NO MEMOS DATABASE IT REFUSES, rather than running three signals quietly', () => {
  command = writeConfig({ withMemos: false })
  const realError = console.error
  const realExit = process.exit
  let said = ''
  let exited = null
  console.error = msg => { said += msg }
  process.exit = code => { exited = code; throw new Error('exited') }
  try { command.commands.audit() } catch (_) { /* the fake exit */ } finally {
    console.error = realError
    process.exit = realExit
  }
  assert.strictEqual(exited, 1, 'it carried on without Memos')
  assert.ok(/newer-related-memo/.test(said), said)
  command = writeConfig()
})

// ------------------------------------------------------------------- flags

const artifactRow = (over = {}) => Object.assign({
  url: URL_A,
  Name: 'Lead routing',
  Type: 'SOP/ROE',
  Status: 'Active',
  'Review cadence': 'Quarterly',
  'date:Last checked for accuracy:start': '2026-08-20',
  'Verified by': 'person-1'
}, over)

const memoRow = (over = {}) => Object.assign({
  url: 'https://notion.so/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb1',
  Artifacts: JSON.stringify([URL_A]),
  'date:Published date:start': '2026-06-01'
}, over)

const runFlags = (artifacts, memos, today = '2026-08-23') =>
  capture(() => command.commands.flags(write('a.json', artifacts), write('m.json', memos), today))

const signals = out => out.flagged.map(f => f.signal)

check('signal 1: past its review cadence', () => {
  const out = runFlags([artifactRow({ 'date:Last checked for accuracy:start': '2026-01-01' })], [])
  assert.ok(signals(out).includes('past-cadence'), JSON.stringify(signals(out)))
})

check('an artifact inside its cadence is not flagged for it', () => {
  const out = runFlags([artifactRow()], [])
  assert.ok(!signals(out).includes('past-cadence'), 'a fresh artifact was flagged as stale')
})

check('signal 2: a memo newer than the last check', () => {
  const out = runFlags([artifactRow({ 'date:Last checked for accuracy:start': '2026-01-01' })], [memoRow()])
  assert.ok(signals(out).includes('memo-newer'), JSON.stringify(signals(out)))
})

check('a memo OLDER than the last check is not a flag', () => {
  const out = runFlags([artifactRow()], [memoRow({ 'date:Published date:start': '2026-01-01' })])
  assert.ok(!signals(out).includes('memo-newer'), 'an old memo was reported as unfolded work')
})

check('THE MEMO MATCHES ACROSS URL SHAPES, not as raw strings', () => {
  // A relation and a row's own url do not come back in one shape. Compared as
  // strings the signal finds nothing while looking perfectly healthy.
  const bare = URL_A.split('/').pop()
  const out = runFlags(
    [artifactRow({ 'date:Last checked for accuracy:start': '2026-01-01' })],
    [memoRow({ Artifacts: JSON.stringify([bare]) })]
  )
  assert.ok(signals(out).includes('memo-newer'), 'a memo named by bare id did not match the artifact url')
})

check('the newest memo wins even if the rows arrive out of order', () => {
  const out = runFlags(
    [artifactRow({ 'date:Last checked for accuracy:start': '2026-07-01' })],
    [memoRow({ 'date:Published date:start': '2026-01-01' }), memoRow({ 'date:Published date:start': '2026-08-01' })]
  )
  assert.ok(signals(out).includes('memo-newer'), 'it trusted the first row it saw rather than the newest')
})

check('ONLY PUBLISHED MEMOS ARE QUERIED, not drafts or canceled ones', () => {
  const out = capture(() => command.commands.audit())
  assert.ok(/"Status" = 'Published'/.test(out.memoSql), `a retracted memo could drive the signal:\n${out.memoSql}`)
})

check('and a canceled memo handed in anyway is skipped', () => {
  const out = runFlags(
    [artifactRow({ 'date:Last checked for accuracy:start': '2026-01-01' })],
    [memoRow({ Status: 'Canceled' })]
  )
  assert.ok(!signals(out).includes('memo-newer'), 'a retracted memo sent somebody to re-read an artifact')
})

check('a memo published the SAME DAY as the check is not newer than it', () => {
  // Published date can come back carrying a time and the check date cannot, so
  // comparing the raw strings flagged everything checked that morning.
  const out = runFlags(
    [artifactRow({ 'date:Last checked for accuracy:start': '2026-08-20' })],
    [memoRow({ 'date:Published date:start': '2026-08-20T09:00:00.000Z' })]
  )
  assert.ok(!signals(out).includes('memo-newer'), 'a same-day memo read as unfolded work')
})

check('a memo published the day AFTER still is', () => {
  const out = runFlags(
    [artifactRow({ 'date:Last checked for accuracy:start': '2026-08-20' })],
    [memoRow({ 'date:Published date:start': '2026-08-21T09:00:00.000Z' })]
  )
  assert.ok(signals(out).includes('memo-newer'), 'a genuinely newer memo stopped being caught')
})

check('AN EMPTY PERSON LIST IS EMPTY, in both shapes it arrives in', () => {
  // `!value` is false for `[]` and for `"[]"`, which are the two shapes a person
  // property with nobody in it actually arrives as, so signal 4 missed exactly
  // the rows it exists to catch and called the library fully verified.
  for (const empty of [[], '[]', '', null, undefined]) {
    const out = runFlags([artifactRow({ 'Verified by': empty })], [])
    assert.ok(
      signals(out).includes('never-verified'),
      `Verified by as ${JSON.stringify(empty)} was read as verified`
    )
  }
})

check('and somebody actually named is not flagged', () => {
  for (const filled of [['person-1'], '["person-1"]', 'person-1']) {
    const out = runFlags([artifactRow({ 'Verified by': filled })], [])
    assert.ok(
      !signals(out).includes('never-verified'),
      `Verified by as ${JSON.stringify(filled)} was read as empty`
    )
  }
})

check('A MULTI-SELECT IS TRANSLATED INSIDE A JSON STRING TOO', () => {
  // A list arrives as a string holding a JSON array, which is the shape this
  // surface actually returns. The first reverse map handled a real array and a
  // bare scalar and let the string fall through, so a renamed workspace came
  // back with its own option names on every multi-select: the fault the reverse
  // map exists to fix, in the shape it was most likely to arrive in.
  command = writeConfig({ process: rename(processNames) })
  const raw = [{ url: 'u', 'R Audience': JSON.stringify(['R Sales', 'R RevOps']) }]
  const [row] = command.normaliseRows(contextNow(), raw)
  assert.deepStrictEqual(row.Audience, ['Sales', 'RevOps'], `came back as ${JSON.stringify(row.Audience)}`)
  command = writeConfig()
})

check('and a value the workspace added is still passed through inside a string', () => {
  command = writeConfig({ process: rename(processNames) })
  const raw = [{ url: 'u', 'R Audience': JSON.stringify(['R Sales', 'Something they invented']) }]
  const [row] = command.normaliseRows(contextNow(), raw)
  assert.deepStrictEqual(row.Audience, ['Sales', 'Something they invented'], JSON.stringify(row.Audience))
  command = writeConfig()
})

check('AN INSTALL WITH NO PERSON SAYS WHY EVERY ARTIFACT IS FLAGGED', () => {
  // Nothing fills Verified by on such an install, so every artifact carries the
  // flag every run. Reported without the reason it is noise, and a list where
  // every row says the same thing teaches the reader to skip the whole report.
  command = writeConfig({ personId: null })
  const out = runFlags([artifactRow({ 'Verified by': null })], [])
  assert.ok(signals(out).includes('never-verified'), 'the signal stopped firing')
  assert.ok(/RECORDS NO PERSON/.test(out.neverVerifiedNote || ''), out.neverVerifiedNote)
  command = writeConfig()
})

check('and an install that does record one says nothing about it', () => {
  const out = runFlags([artifactRow({ 'Verified by': null })], [])
  assert.strictEqual(out.neverVerifiedNote, null, 'the caveat fired on an install that has a person')
})

check('a today that is not a date is refused', () => {
  assert.throws(
    () => runFlags([artifactRow()], [], 'last Tuesday'),
    /is not a date/,
    'a mistyped date was carried through and every cadence would read as unknown'
  )
  assert.throws(() => runFlags([artifactRow()], [], '2026-13-45'), /is not a date/)
})

check('signal 4: never verified', () => {
  const out = runFlags([artifactRow({ 'Verified by': null })], [])
  assert.ok(signals(out).includes('never-verified'), JSON.stringify(signals(out)))
})

check('signal 3: two Active Strategy Decisions that look alike are CANDIDATES', () => {
  const out = runFlags([
    artifactRow({ url: URL_B, Name: 'Pricing policy', Type: 'Strategy Decision' }),
    artifactRow({ url: URL_C, Name: 'Pricing policy', Type: 'Strategy Decision' })
  ], [])
  assert.strictEqual(out.supersedeCandidates.length, 1, JSON.stringify(out.supersedeCandidates))
  assert.ok(/NOT A VERDICT/.test(out.supersedeNote), out.supersedeNote)
  assert.ok(!signals(out).includes('supersede'), 'a supersede was reported as a flag rather than a candidate')
})

check('an archived Strategy Decision is not a supersede candidate', () => {
  const out = runFlags([
    artifactRow({ url: URL_B, Name: 'Pricing policy', Type: 'Strategy Decision' }),
    artifactRow({ url: URL_C, Name: 'Pricing policy', Type: 'Strategy Decision', Status: 'Archive' })
  ], [])
  assert.strictEqual(out.supersedeCandidates.length, 0, 'an archived decision was offered as a live clash')
})

check('NO MEMOS READ IS SAID OUT LOUD, not reported as nothing stale', () => {
  const out = runFlags([artifactRow()], [])
  assert.ok(/NO MEMOS WERE READ/.test(out.memoSignalNote || ''), out.memoSignalNote)
})

check('flags refuses to run without the memo rows at all', () => {
  assert.throws(
    () => command.commands.flags(write('a.json', [artifactRow()])),
    /strongest of the four/,
    'a missing memo file defaulted to none and turned signal 2 off silently'
  )
})

// ------------------------------------------------------------------ update

const BODY = { Scope: 'a', 'Trigger Condition': 'b', Steps: 'c', 'System Behavior': 'd', Exceptions: 'none known' }
const BEFORE = {
  url: URL_A, Name: 'Lead routing', Type: 'SOP/ROE', Status: 'Active',
  // Description is here on purpose. Without it the omit and clear checks below
  // both passed whatever the code did, because there was nothing to omit or
  // clear: another fixture that could not fail.
  Description: 'the original description',
  Domain: 'Deal Execution', Tags: ['AI', 'Data'], 'Review cadence': 'Quarterly',
  'Last checked for accuracy': '2026-01-01',
  Owner: '11111111-2222-3333-4444-555555555555'
}
const runUpdate = after =>
  capture(() => command.commands.update(write('before.json', BEFORE), write('after.json', after), '2026-08-23'))

check('only what changed is sent', () => {
  const out = runUpdate({ ...BEFORE, Description: 'new text', body: BODY, reviewed: false })
  assert.deepStrictEqual(out.changed, ['Description'])
  assert.deepStrictEqual(Object.keys(out.properties), ['Description'])
})

check('THE THREE VERIFICATION FIELDS MOVE TOGETHER on a review', () => {
  const out = runUpdate({ ...BEFORE, Description: 'new text', body: BODY, reviewed: true })
  assert.deepStrictEqual(
    out.verificationFields.slice().sort(),
    ['Last checked for accuracy', 'Verified by', 'Verified date']
  )
})

check('AND NONE OF THEM MOVE when the edit was not a review', () => {
  // Last checked for accuracy drives the staleness check, so stamping it on an
  // edit nobody reviewed makes a stale document look fresh.
  const out = runUpdate({ ...BEFORE, Description: 'new text', body: BODY, reviewed: false })
  assert.deepStrictEqual(out.verificationFields, [])
  assert.ok(!('Last checked for accuracy' in out.properties), 'the staleness stamp moved on a non-review')
  assert.ok(!('Verified by' in out.properties))
  assert.ok(!('Verified date' in out.properties))
})

check('a missing `reviewed` is refused, not read as false', () => {
  assert.throws(
    () => runUpdate({ ...BEFORE, Description: 'x', body: BODY }),
    /re-read the artifact for accuracy/,
    'an unanswered question was answered by the script'
  )
})

check('A LIST IS THE SAME LIST IN EITHER SHAPE IT ARRIVES IN', () => {
  // A row fetched from Notion carries a multi-select as a string holding a JSON
  // array. Compared against an after row written as a real array, every
  // multi-select read as changed, went into the payload unasked, and on a
  // reviewed update dragged the verification stamp with it.
  const fetched = { ...BEFORE, Tags: JSON.stringify(['AI', 'Data']) }
  const out = capture(() => command.commands.update(
    write('before.json', fetched),
    write('after.json', { ...BEFORE, Tags: ['AI', 'Data'], reviewed: false }),
    '2026-08-23'
  ))
  assert.deepStrictEqual(out.changed, [], `a list read as changed across shapes: ${JSON.stringify(out.changed)}`)
})

check('and a real list change is still seen across shapes', () => {
  const fetched = { ...BEFORE, Tags: JSON.stringify(['AI', 'Data']) }
  const out = capture(() => command.commands.update(
    write('before.json', fetched),
    write('after.json', { ...BEFORE, Tags: ['AI'], reviewed: false }),
    '2026-08-23'
  ))
  assert.deepStrictEqual(out.changed, ['Tags'], 'a genuine list change stopped being seen')
})

check('A PROPERTY-ONLY EDIT NEED NOT REPEAT THE NAME AND TYPE', () => {
  // problems needs a Name and a Type to judge anything and is right to. But an
  // edit to a Status is changing neither, and under the rule that an absent key
  // means untouched, demanding them contradicted that rule one screen above.
  const out = capture(() => command.commands.update(
    write('before.json', BEFORE),
    write('after.json', { url: URL_A, Status: 'Archive', reviewed: false }),
    '2026-08-23'
  ))
  assert.deepStrictEqual(out.changed, ['Status'], JSON.stringify(out.changed))
  assert.ok(out.untouched.includes('Name'), 'Name was not reported as untouched')
})

check('but a genuinely unknown type is still refused', () => {
  assert.throws(
    () => capture(() => command.commands.update(
      write('before.json', BEFORE),
      write('after.json', { url: URL_A, Type: 'Not A Real Type', reviewed: false }),
      '2026-08-23'
    )),
    /not a type this database has/,
    'an invented type was accepted'
  )
})

check('the memo query returns the Status column its map promises', () => {
  // ASSERTED AGAINST THE SELECT LIST, NOT THE WHOLE STATEMENT. The WHERE clause
  // filters on Status too, so a check for the name anywhere passed with the
  // column missing from what comes back, and the map promised a column the rows
  // would not carry.
  const out = capture(() => command.commands.audit())
  assert.ok(out.memoColumns.Status, 'the map names a Status column')
  const select = out.memoSql.split('\nFROM')[0]
  assert.ok(select.includes('m."Status"'), `the query does not return it:\n${select}`)
})

check('REORDERING A MULTI-SELECT IS NOT A CHANGE', () => {
  const out = runUpdate({ ...BEFORE, Tags: ['Data', 'AI'], body: BODY, reviewed: false })
  assert.deepStrictEqual(out.changed, [], 'reordering the same tags read as an edit')
})

check('adding a tag IS a change, and Tags is reachable at all', () => {
  // Tags is not in SELECTED, which is a reading list. Driving this loop from
  // SELECTED meant update silently could not change Tags, Segment, L2C
  // Lifecycle or Owner, and reported "nothing changed" for a real edit.
  const out = runUpdate({ ...BEFORE, Tags: ['AI', 'Data', 'Tools'], body: BODY, reviewed: false })
  assert.deepStrictEqual(out.changed, ['Tags'])
})

check('every field a person can edit is reachable', () => {
  for (const [field, value] of [['Owner', 'me'], ['Segment', ['Enterprise']], ['L2C Lifecycle', ['3 - Contracting']]]) {
    const out = runUpdate({ ...BEFORE, [field]: value, body: BODY, reviewed: false })
    assert.deepStrictEqual(out.changed, [field], `${field} cannot be changed by update`)
  }
})

check('OMITTING A FIELD LEAVES IT ALONE, and never clears it', () => {
  // Leaving Description out used to read as emptying it: the comparison saw
  // undefined against the old text, called it a change, found no value to send
  // and sent an explicit empty. A caller that built the after row by hand and
  // forgot a field deleted it, and the output called that a clear as if it had
  // been asked for.
  const { Description, ...omitted } = { ...BEFORE, reviewed: false }
  const out = runUpdate(omitted)
  assert.deepStrictEqual(out.changed, [], `an omitted field was treated as an edit: ${JSON.stringify(out.changed)}`)
  assert.deepStrictEqual(out.clearing, [], 'an omitted field was cleared')
  assert.ok(out.untouched.includes('Description'), 'the omitted field was not reported as untouched')
})

check('and clearing is still something you can say out loud', () => {
  const out = runUpdate({ ...BEFORE, Description: null, reviewed: false })
  assert.deepStrictEqual(out.clearing, ['Description'], 'an explicit null stopped clearing')
})

check('A ROW KEYED BY THE WORKSPACE NAMES IS REFUSED, not read as no change', () => {
  // A page fetched from Notion is keyed by the workspace's own property names.
  // Handed one on a renamed workspace, every logical lookup returns undefined,
  // nothing looks changed, and update reports a clean no-op for an edit that was
  // asked for. Silent, and it reads as already applied.
  command = writeConfig({ process: rename(processNames) })
  const raw = { url: URL_A, 'R Name': 'Lead routing', 'R Type': 'R SOP/ROE', 'R Status': 'R Active' }
  assert.throws(
    () => capture(() => command.commands.update(
      write('braw.json', raw),
      write('araw.json', { ...raw, 'R Status': 'R Archive', reviewed: false }),
      '2026-08-23'
    )),
    /rather than the logical/,
    'a raw Notion fetch was accepted and would have reported a clean no-op'
  )
  command = writeConfig()
})

check('AND A PARTIALLY RENAMED WORKSPACE DOES NOT SLIP THROUGH', () => {
  // The first guard asked whether the row had ANY logical key. A workspace that
  // renamed some properties and not others produces a row carrying both, so a
  // raw fetch with an unrenamed Name on it passed, and the renamed field it was
  // actually editing stayed invisible. The silent no-op survived inside the
  // guard written to stop it.
  const partial = {
    properties: { ...processNames.properties, Status: 'Workflow State' },
    values: processNames.values
  }
  command = writeConfig({ process: partial })
  const raw = { url: URL_A, Name: 'Lead routing', Type: 'SOP/ROE', 'Workflow State': 'Active' }
  assert.throws(
    () => capture(() => command.commands.update(
      write('bpart.json', raw),
      write('apart.json', { ...raw, 'Workflow State': 'Archive', reviewed: false }),
      '2026-08-23'
    )),
    /Workflow State/,
    'a partially renamed workspace let a raw row through'
  )
  command = writeConfig()
})

check('A WORKSPACE NAME THAT IS ANOTHER FIELD\'S LOGICAL NAME DOES NOT CAUSE A FALSE REFUSAL', () => {
  // The guard asks two things, and this is what the second one is for. Here the
  // workspace calls Domain "Segment", which is a real logical name for a
  // different field. A normalised row carrying both keys would trip a guard that
  // only asked "is the workspace name present", and refusing a row that is
  // perfectly fine is the mirror of letting a raw one through.
  const collides = {
    properties: { ...processNames.properties, Domain: 'Segment', Segment: 'Audience Group' },
    values: processNames.values
  }
  command = writeConfig({ process: collides })
  const out = capture(() => command.commands.update(
    write('bcol.json', { url: URL_A, Name: 'Lead routing', Type: 'SOP/ROE', Domain: 'Deal Execution', Segment: ['Enterprise'] }),
    write('acol.json', { url: URL_A, Name: 'Lead routing', Type: 'SOP/ROE', Domain: 'Deal Execution', Segment: ['SMB'], reviewed: false }),
    '2026-08-23'
  ))
  assert.deepStrictEqual(out.changed, ['Segment'], 'a legitimate row was refused, or the edit was lost')
  command = writeConfig()
})

check('and a properly normalised row is still accepted on a partial rename', () => {
  const partial = {
    properties: { ...processNames.properties, Status: 'Workflow State' },
    values: processNames.values
  }
  command = writeConfig({ process: partial })
  const out = capture(() => command.commands.update(
    write('bok.json', { url: URL_A, Name: 'Lead routing', Type: 'SOP/ROE', Status: 'Active' }),
    write('aok.json', { url: URL_A, Name: 'Lead routing', Type: 'SOP/ROE', Status: 'Archive', reviewed: false }),
    '2026-08-23'
  ))
  assert.deepStrictEqual(out.changed, ['Status'], 'a logical row was refused on a partial rename')
  assert.ok('Workflow State' in out.properties, `the payload does not use the workspace name: ${JSON.stringify(out.properties)}`)
  command = writeConfig()
})

check('AN EMPTIED FIELD IS SENT AS AN EXPLICIT EMPTY VALUE', () => {
  // Left out of the payload the write is a no-op, the old value survives, and
  // the person is told the change was saved.
  const out = runUpdate({ ...BEFORE, Domain: null, body: BODY, reviewed: false })
  assert.deepStrictEqual(out.clearing, ['Domain'])
  assert.ok('Domain' in out.properties, 'the cleared field was not in the payload at all')
  assert.strictEqual(out.properties.Domain, null)
})

check('a cleared multi-select clears with a list, not a null', () => {
  const out = runUpdate({ ...BEFORE, Tags: [], body: BODY, reviewed: false })
  assert.deepStrictEqual(out.clearing, ['Tags'])
  assert.deepStrictEqual(out.properties.Tags, [])
})

check('ARCHIVING IS CALLED OUT and never silent', () => {
  const out = runUpdate({ ...BEFORE, Status: 'Archive', body: BODY, reviewed: false })
  assert.strictEqual(out.archiving, true)
  assert.ok(/Ask before sending/.test(out.archiveNote || ''), out.archiveNote)
})

check('an update that is not archiving says so rather than leaving the field out', () => {
  const out = runUpdate({ ...BEFORE, Description: 'x', body: BODY, reviewed: false })
  assert.strictEqual(out.archiving, false)
  assert.strictEqual(out.archiveNote, null)
})

check('it binds to the page it is for', () => {
  const out = runUpdate({ ...BEFORE, Description: 'x', body: BODY, reviewed: false })
  assert.ok(out.target, 'no page identity, so nothing could prove the write landed on the right artifact')
})

check('an artifact with no url is refused', () => {
  const { url, ...noUrl } = BEFORE
  assert.throws(
    () => capture(() => command.commands.update(write('b2.json', noUrl), write('a2.json', { ...noUrl, Description: 'x', body: BODY, reviewed: false }), '2026-08-23')),
    /which page it is for/
  )
})

check('A PROPERTY-ONLY EDIT NEEDS NO BODY AT ALL', () => {
  // `update` sends only the sections that changed, so an absent section is one
  // that stays as it is on the page. Judging those as empty made this refuse any
  // edit that did not carry the whole body, which is most edits: changing a
  // Status or a tag meant reconstructing every section first.
  const out = runUpdate({ ...BEFORE, Status: 'Archive', reviewed: false })
  assert.deepStrictEqual(out.changed, ['Status'])
  assert.strictEqual(out.body, null, 'a body was invented for an edit that passed none')
})

check('A PARTIAL BODY WRITES ONLY THE SECTIONS IT WAS GIVEN', () => {
  // The other half of making a partial body legal. Validating an absent section
  // as fine while still emitting it to write sends an empty string for every
  // section nobody touched, and writing that wipes them, Exceptions included,
  // which can never be blank. A fix that creates a worse bug than it cured.
  const out = runUpdate({ ...BEFORE, body: { Steps: 'new text' }, reviewed: false })
  assert.deepStrictEqual(out.body.map(s => s.heading), ['Steps'], JSON.stringify(out.body))
  assert.deepStrictEqual(out.headings, ['Steps'], 'the headings disagree with the body being sent')
})

check('A BEFORE BODY NEVER LEAKS INTO AN UPDATE THAT SENDS NO BODY', () => {
  // The merge that supplies an untouched Name and Type must not supply a body.
  //
  // THE BEFORE BODY HERE IS DELIBERATELY BROKEN, with a required section blank,
  // which is what a page written before these rules existed looks like. Pulled
  // into the merge it gets validated, and a Status edit on an old page is
  // refused for the state of a body nobody is touching. Written with a valid
  // body this check passed either way: the merge has no other visible effect,
  // which a mutation showed and reading did not.
  const legacy = { ...BEFORE, body: { ...BODY, Exceptions: '' } }
  const out = capture(() => command.commands.update(
    write('before.json', legacy),
    write('after.json', { url: URL_A, Status: 'Archive', reviewed: false }),
    '2026-08-23'
  ))
  assert.deepStrictEqual(out.changed, ['Status'], 'an edit was refused for a body it never touched')
  assert.strictEqual(out.body, null, `a body was sent for an edit that passed none: ${JSON.stringify(out.body)}`)
  assert.strictEqual(out.headings, null, 'headings were sent for an edit that passed no body')
})

check('and no untouched section is sent as empty text', () => {
  const out = runUpdate({ ...BEFORE, body: { Steps: 'new text' }, reviewed: false })
  assert.ok(!out.body.some(s => s.text === ''), `an empty section was in the payload: ${JSON.stringify(out.body)}`)
})

check('a create still writes every section, empty ones included', () => {
  // The create contract is the opposite and must not move: a section left out
  // has to appear as considered-and-empty rather than vanish.
  //
  // THE BODY HERE IS DELIBERATELY INCOMPLETE. Written with a full body this
  // check passed whatever the default was, because every section was present
  // either way. That is the same fixture-that-cannot-fail as the read-back one,
  // caught by mutating the default and seeing nothing go red.
  const { Steps, ...missingSteps } = BODY
  const full = artifact.body({ Name: 'x', Type: 'SOP/ROE', body: missingSteps })
  assert.strictEqual(full.length, 5, `a create dropped a section: ${JSON.stringify(full.map(s => s.heading))}`)
  const steps = full.find(s => s.heading === 'Steps')
  assert.ok(steps, 'the absent section vanished instead of being written empty')
  assert.strictEqual(steps.text, '', 'the absent section was not written as empty')
})

check('a section that IS sent still has to be filled', () => {
  // The other half. A heading sent with nothing under it is how a section gets
  // emptied by accident, and that is the case the check was written for.
  assert.throws(
    () => runUpdate({ ...BEFORE, body: { ...BODY, Steps: '   ' }, reviewed: false }),
    /Steps section is empty/,
    'a section sent blank was accepted'
  )
})

check('CLEARING THE OWNER EMPTIES IT, and does not hand it to the config person', () => {
  // `properties` fills an absent person field with the config person, which is
  // right on a create and silent reassignment on an edit. The changed-field loop
  // found the name present and never reached the clear branch, so an artifact
  // was quietly reassigned to whoever installed the plugin.
  const out = runUpdate({ ...BEFORE, Owner: null, reviewed: false })
  assert.deepStrictEqual(out.clearing, ['Owner'], 'the owner was not treated as cleared')
  assert.deepStrictEqual(out.properties.Owner, [], `the owner came back as ${JSON.stringify(out.properties.Owner)}`)
  assert.ok(!JSON.stringify(out.properties).includes('person-1'), 'the config person was written into the payload')
})

check('a person field clears with a list, not a null', () => {
  const out = runUpdate({ ...BEFORE, Owner: null, reviewed: false })
  assert.ok(Array.isArray(out.properties.Owner), 'a null would be accepted by Notion and leave the old owner in place')
})

check('CLAIMING OWNERSHIP WITH NOBODY CONFIGURED IS REFUSED, not read as emptying it', () => {
  // `properties` drops a person field it cannot resolve, and "me" with no
  // configured person is exactly that. It fell into the clear branch, so "make
  // me the owner" was carried out as "remove the owner": the reverse of what was
  // asked, silently, on the field that says who is accountable.
  command = writeConfig({ personId: null })
  assert.throws(
    () => runUpdate({ ...BEFORE, Owner: 'me', reviewed: false }),
    /opposite intentions/,
    'asking to own it emptied it'
  )
  command = writeConfig()
})

check('and emptying it on purpose still works with nobody configured', () => {
  command = writeConfig({ personId: null })
  const out = runUpdate({ ...BEFORE, Owner: null, reviewed: false })
  assert.deepStrictEqual(out.clearing, ['Owner'], 'an explicit clear was refused')
  command = writeConfig()
})

check('A BODY-ONLY EDIT DOES NOT HAVE TO REPEAT THE TYPE', () => {
  // The sections a body has are decided by the Type, and an edit that changes
  // only the body is not changing the type. Built from the after row alone it
  // threw "No template for undefined" on exactly the edit this command is most
  // for.
  const out = capture(() => command.commands.update(
    write('before.json', BEFORE),
    write('after.json', { url: URL_A, body: { Steps: 'new text' }, reviewed: false }),
    '2026-08-23'
  ))
  assert.deepStrictEqual(out.body.map(s => s.heading), ['Steps'], JSON.stringify(out.body))
  assert.deepStrictEqual(out.changed, [], 'a body-only edit reported a property change')
})

check('THE PAGE ID IS MATCHED, NOT ASSEMBLED FROM WHATEVER HEX IS AROUND', () => {
  // The first version stripped every non-hex character out of the segment and
  // took the last 32, concatenating the title's letters with the id. That is
  // right when an id is there and invents one when it is not, and an invented
  // key matches nothing, which reads as a memo pointing at no artifact.
  // THE TITLE HERE CARRIES EXACTLY 32 HEX CHARACTERS AND NO ID. That matters:
  // written with a title holding fewer than 32, the old assembling version
  // returned null too and the check passed either way. Mutating it back showed
  // that, and reading it did not. It ends in `zz`, so there is no trailing run
  // for the strict match to find.
  const noId = 'https://notion.so/deadbeef-cafebabe-deadbeef-cafebabe-zz'
  assert.strictEqual(noId.split('/').pop().replace(/[^0-9a-fA-F]/g, '').length, 32, 'the fixture no longer holds 32 hex characters')
  const sent = runUpdate({ ...BEFORE, Description: 'new text', reviewed: false })
  const out = capture(() => command.commands['prove-update'](
    write('sent.json', sent),
    write('back.json', { url: noId, properties: sent.properties })
  ))
  assert.strictEqual(out.proved, false, 'a url with no page id in it produced a key and passed')
  assert.ok(/no usable url/.test(out.problems.join(' ')), out.problems.join(' '))
})

check('and a dashed uuid is the same page as the bare one', () => {
  const sent = runUpdate({ ...BEFORE, Description: 'new text', reviewed: false })
  const dashed = 'https://notion.so/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
  const out = capture(() => command.commands['prove-update'](
    write('sent.json', sent),
    write('back.json', { url: dashed, properties: sent.properties })
  ))
  assert.strictEqual(out.proved, true, `the same page written two ways read as two pages: ${JSON.stringify(out.problems)}`)
})

check('A PAGE OPENED FROM A VIEW IS THE SAME PAGE', () => {
  // The last 32 hex characters of `.../page-<id>?v=<view id>` are the view's id.
  // Run over the whole string, the same page opened from a view keyed as a
  // different page, so the binding check would have refused a correct read-back.
  const sent = runUpdate({ ...BEFORE, Description: 'new text', reviewed: false })
  const out = capture(() => command.commands['prove-update'](
    write('sent.json', sent),
    write('back.json', { url: `${URL_A}?v=abcdef0123456789abcdef0123456789`, properties: sent.properties })
  ))
  assert.strictEqual(out.proved, true, `a correct read-back was refused: ${JSON.stringify(out.problems)}`)
})

check('and a genuinely different page is still refused', () => {
  const sent = runUpdate({ ...BEFORE, Description: 'new text', reviewed: false })
  const out = capture(() => command.commands['prove-update'](
    write('sent.json', sent),
    write('back.json', { url: `${URL_B}?v=abcdef0123456789abcdef0123456789`, properties: sent.properties })
  ))
  assert.strictEqual(out.proved, false, 'the wrong page passed once a query string was on it')
})

check('NOTHING IS CHECKED ON A PAGE THAT IS NOT THE ONE WRITTEN, headings included', () => {
  // The headings block used to run whatever the binding check found, so a
  // read-back of another page had its headings compared and reported as checked,
  // under a result that had already said nothing below was looked at.
  const sent = runUpdate({ ...BEFORE, body: { Steps: 'new text' }, reviewed: false })
  const out = capture(() => command.commands['prove-update'](
    write('sent.json', sent),
    write('back.json', { url: URL_B, properties: sent.properties, headings: ['Steps'] })
  ))
  assert.strictEqual(out.proved, false)
  assert.deepStrictEqual(out.checked, [], `something was checked on the wrong page: ${JSON.stringify(out.checked)}`)
})

check('A PERSON COMPARES THE SAME WITH OR WITHOUT THE PREFIX', () => {
  // A person is written bare and read back prefixed. An owner fetched as
  // `user://abc` and left alone in the after row compared as a change, went into
  // the payload, and on a review moved the verification stamp for an edit
  // nobody made.
  const fetched = { ...BEFORE, Owner: JSON.stringify(['user://11111111-2222-3333-4444-555555555555']) }
  const out = capture(() => command.commands.update(
    write('before.json', fetched),
    write('after.json', { ...BEFORE, reviewed: false }),
    '2026-08-23'
  ))
  assert.deepStrictEqual(out.changed, [], `the owner read as changed across shapes: ${JSON.stringify(out.changed)}`)
})

check('SETTING THE OWNER TO "me" WHEN THEY ALREADY OWN IT IS NOT A CHANGE', () => {
  // `properties` understands "me" and the comparison did not, so this reported
  // a change and rewrote the same value, which on a review would also have moved
  // the verification stamp for an edit nobody made.
  const owned = { ...BEFORE, Owner: ['person-1'] }
  const out = capture(() => command.commands.update(
    write('before.json', owned),
    write('after.json', { ...owned, Owner: 'me', reviewed: false }),
    '2026-08-23'
  ))
  assert.deepStrictEqual(out.changed, [], `"me" against the same person read as a change: ${JSON.stringify(out.changed)}`)
})

check('and "me" against a different owner still is one', () => {
  const out = capture(() => command.commands.update(
    write('before.json', BEFORE),
    write('after.json', { ...BEFORE, Owner: 'me', reviewed: false }),
    '2026-08-23'
  ))
  assert.deepStrictEqual(out.changed, ['Owner'], 'a real handover stopped being seen')
  assert.deepStrictEqual(out.properties.Owner, ['person-1'], JSON.stringify(out.properties.Owner))
})

check('AND THE REVIEW STAMP STILL RECORDS WHO READ IT', () => {
  // Turning the person default off outright would have broken this: `Verified
  // by` is a person field too and depends on that default.
  const out = runUpdate({ ...BEFORE, Description: 'new text', reviewed: true })
  assert.ok(out.verificationFields.includes('Verified by'), 'the review recorded nobody')
  assert.deepStrictEqual(out.properties['Verified by'], ['person-1'], JSON.stringify(out.properties['Verified by']))
})

check('clearing the owner and reviewing at once keeps both straight', () => {
  const out = runUpdate({ ...BEFORE, Owner: null, reviewed: true })
  assert.deepStrictEqual(out.properties.Owner, [], 'the owner was refilled by the review stamp')
  assert.deepStrictEqual(out.properties['Verified by'], ['person-1'], 'the review stamp lost its person')
})

// ------------------------------------------------------------ prove-update

check('a write that landed is proved', () => {
  const sent = runUpdate({ ...BEFORE, Description: 'new text', body: BODY, reviewed: false })
  const out = capture(() => command.commands['prove-update'](
    write('sent.json', sent),
    write('back.json', { url: URL_A, properties: sent.properties })
  ))
  assert.strictEqual(out.proved, true, JSON.stringify(out.problems))
})

check('A REAL NOTION READ-BACK PROVES CLEAN, not just the payload handed back', () => {
  // The first version compared raw strings, so every real read-back mismatched
  // and a landed update reported itself as failed. Its test passed only because
  // the fixture fed the flat payload back instead of a page, which is a fixture
  // that cannot fail. These shapes are the measured ones: a person comes back
  // prefixed, a list as a string holding a JSON array, a date with a time.
  const sent = runUpdate({
    ...BEFORE, Owner: '99999999-8888-7777-6666-555555555555', Tags: ['Data', 'AI', 'Tools'], reviewed: true
  })
  const out = capture(() => command.commands['prove-update'](
    write('sent.json', sent),
    write('back.json', {
      url: URL_A,
      properties: {
        Owner: JSON.stringify(['user://99999999-8888-7777-6666-555555555555']),
        Tags: JSON.stringify(['Tools', 'AI', 'Data']),
        'Last checked for accuracy': '2026-08-23T09:00:00.000Z',
        'Verified date': '2026-08-23T09:00:00.000Z',
        'Verified by': JSON.stringify(['user://person-1'])
      }
    })
  ))
  assert.strictEqual(out.proved, true, `a landed update reported as failed: ${JSON.stringify(out.problems)}`)
  assert.ok(out.checked.includes('Owner'), 'the owner was not actually compared')
})

check('AND A REAL CHANGE IS STILL CAUGHT through the same readers', () => {
  // The risk of teaching a comparison to forgive shapes is that it forgives
  // values too.
  const sent = runUpdate({ ...BEFORE, Tags: ['AI'], reviewed: false })
  const out = capture(() => command.commands['prove-update'](
    write('sent.json', sent),
    write('back.json', { url: URL_A, properties: { Tags: JSON.stringify(['AI', 'Data']) } })
  ))
  assert.strictEqual(out.proved, false, 'a tag that did not come off passed as a clean write')
})

check('A PROPERTY WHOSE TYPE IS UNKNOWN IS UNCHECKED, never quietly passed', () => {
  const sent = runUpdate({ ...BEFORE, Description: 'new text', reviewed: false })
  sent.properties['Some Rollup'] = 'whatever'
  const out = capture(() => command.commands['prove-update'](
    write('sent.json', sent),
    write('back.json', { url: URL_A, properties: { ...sent.properties, 'Some Rollup': 'something else' } })
  ))
  assert.ok(out.unchecked.some(u => /Some Rollup/.test(u)), JSON.stringify(out.unchecked))
  assert.ok(!out.checked.includes('Some Rollup'), 'an uncomparable property was reported as checked')
})

check('TWO OPTIONS ARE NOT ONE OPTION WITH A SPACE IN IT', () => {
  // Joined on a space, ["AI Data"] and ["AI","Data"] both rendered as "AI Data",
  // so a multi-select split into two options proved clean against the one it
  // came from.
  //
  // THE VALUES HERE ARE IN ALPHABETICAL ORDER ON PURPOSE. The render sorts
  // before joining, so a pair that sorts into a different order does not
  // collide however it is joined, and the first version of this check used one
  // of those: it passed on a space join and proved nothing.
  const compare = require('../shared/notion-compare')
  assert.strictEqual(
    compare.compareProperty('multi_select', ['AI Data'], JSON.stringify(['AI', 'Data'])).state,
    'different',
    'a split option compared equal to the one it came from'
  )
  // And the ordinary reorder still has to read as the same value.
  assert.strictEqual(
    compare.compareProperty('multi_select', ['AI', 'Data'], JSON.stringify(['Data', 'AI'])).state,
    'same',
    'a reordered multi-select read as a failed write'
  )
})

check('A MISSING HEADING IS CAUGHT, not filed under "not checked"', () => {
  // A Notion page can come back with a heading missing on a silent partial
  // failure. This used to list the whole body as unchecked without looking at
  // the part it could check.
  const sent = runUpdate({ ...BEFORE, body: { Steps: 'new text' }, reviewed: false })
  const out = capture(() => command.commands['prove-update'](
    write('sent.json', sent),
    write('back.json', { url: URL_A, properties: sent.properties, headings: [] })
  ))
  assert.ok(out.unchecked.some(u => /heading/.test(u)), JSON.stringify(out.unchecked))

  const landed = capture(() => command.commands['prove-update'](
    write('sent.json', sent),
    write('back.json', { url: URL_A, properties: sent.properties, headings: ['Steps'] })
  ))
  assert.ok(landed.checked.some(c => /heading "Steps"/.test(c)), JSON.stringify(landed.checked))

  const wrong = capture(() => command.commands['prove-update'](
    write('sent.json', sent),
    write('back.json', { url: URL_A, properties: sent.properties, headings: ['Scope'] })
  ))
  assert.strictEqual(wrong.proved, false, 'a heading that never landed passed as a clean write')
})

check('THE WRONG FILE IS REFUSED, rather than proving nothing cleanly', () => {
  // Given a before row, the binding check found no target and the property loop
  // found no properties, so it printed a clean proof having looked at nothing.
  assert.throws(
    () => capture(() => command.commands['prove-update'](
      write('wrong.json', BEFORE),
      write('back.json', { url: URL_A, properties: {} })
    )),
    /not the output of `update`/,
    'a before row passed as an update to prove'
  )
})

check('A READ-BACK OF A DIFFERENT PAGE IS CAUGHT', () => {
  const sent = runUpdate({ ...BEFORE, Description: 'new text', body: BODY, reviewed: false })
  const out = capture(() => command.commands['prove-update'](
    write('sent.json', sent),
    write('back.json', { url: URL_B, properties: sent.properties })
  ))
  assert.strictEqual(out.proved, false, 'a read-back of another page passed as a landed write')
  assert.ok(/not the one that was updated/.test(out.problems.join(' ')), out.problems.join(' '))
})

check('A CLEAR THAT DID NOT LAND IS CAUGHT', () => {
  // The reason prove-update takes the update output rather than the two files:
  // a payload rebuilt from a merged row has no record of what was emptied.
  const sent = runUpdate({ ...BEFORE, Domain: null, body: BODY, reviewed: false })
  const out = capture(() => command.commands['prove-update'](
    write('sent.json', sent),
    write('back.json', { url: URL_A, properties: { Domain: 'Deal Execution' } })
  ))
  assert.strictEqual(out.proved, false, 'a failed clear read as a clean write')
})

check('IT SAYS WHAT IT DID NOT CHECK, including when it passes', () => {
  const sent = runUpdate({ ...BEFORE, Domain: null, body: BODY, reviewed: false })
  const out = capture(() => command.commands['prove-update'](
    write('sent.json', sent),
    write('back.json', { url: URL_A, properties: sent.properties })
  ))
  assert.strictEqual(out.proved, true, JSON.stringify(out.problems))
  assert.ok(out.unchecked.length, 'it reported a pass with no account of what it did not look at')
})

check('a page that came back with no properties is a failure, not a pass', () => {
  const sent = runUpdate({ ...BEFORE, Description: 'x', body: BODY, reviewed: false })
  const out = capture(() => command.commands['prove-update'](
    write('sent.json', sent),
    write('back.json', { url: URL_A })
  ))
  assert.strictEqual(out.proved, false, 'a summary with no properties passed as proof')
})

console.log(failures ? `\n${failures} failed.\n` : '\nAll passed.\n')
process.exit(failures ? 1 : 0)

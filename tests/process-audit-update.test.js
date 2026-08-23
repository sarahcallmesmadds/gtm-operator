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

const writeConfig = ({ process: p = processNames, memos: m = memoNames, withMemos = true } = {}) => {
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
    notion: { parentPageId: 'p', personId: 'person-1' },
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

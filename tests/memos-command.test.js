'use strict'

/**
 * The Memos command layer: the queries it builds and the judgments it makes.
 *
 * TWO CONFIGS, AND THAT IS THE POINT. One records the shipped property names
 * and one records a workspace that renamed every property and every value. A
 * query built against the second that still carries the shipped names would
 * come back with no rows, and no rows is exactly what a log with nothing in it
 * looks like. So the renamed config is what proves the map is being used, and
 * the plain one keeps the other assertions readable.
 *
 * WHAT THIS DOES NOT PROVE. No SQL here has been sent. The queries are
 * asserted as strings, and whether Notion's SQL surface accepts them is a
 * live-run question this cannot answer.
 *
 * Run: node tests/memos-command.test.js
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const assert = require('assert')
const { execFileSync } = require('child_process')

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'gtm-memos-command-'))
process.env.GTM_OPERATOR_CONFIG = path.join(SANDBOX, 'gtm-operator.config.json')

const setupSchema = require('../plugins/setup/scripts/schema')

const DATABASES = ['memos', 'projects', 'calendar', 'tasks']
const identityMaps = {}
for (const key of DATABASES) identityMaps[key] = setupSchema.identityNames(key)

/** Every property and every value renamed, so a raw name in a query shows. */
const renameMap = map => ({
  properties: Object.fromEntries(Object.keys(map.properties).map(k => [k, `R ${k}`])),
  values: Object.fromEntries(
    Object.entries(map.values).map(([property, values]) => [
      property,
      Object.fromEntries(Object.keys(values).map(v => [v, `R ${v}`]))
    ])
  )
})
const renamedMaps = {}
for (const key of DATABASES) renamedMaps[key] = renameMap(identityMaps[key])

const PERSON = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

const configWith = maps => ({
  configVersion: 3,
  state: 'complete',
  notion: { parentPageId: 'p', personId: PERSON },
  databases: Object.fromEntries(DATABASES.map(key => [key, {
    databaseId: `${key}-db`,
    dataSourceId: `${key}-ds`,
    displayName: key,
    properties: maps[key].properties,
    values: maps[key].values
  }])),
  verified: { at: 'x', definitions: 'y' },
  defaults: {},
  sources: {},
  taxonomyPath: '/tmp/x'
})

const writeConfig = maps => fs.writeFileSync(process.env.GTM_OPERATOR_CONFIG, JSON.stringify(configWith(maps), null, 2))

writeConfig(identityMaps)

const command = require('../plugins/memos/scripts/memos')
const config = require('../shared/config-read')
const schema = require('../shared/memos-schema')

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

/** Rewrite the config, drop the module-level context cache, run, capture. */
const withConfig = (maps, fn) => {
  writeConfig(maps)
  return fn()
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
const URL = letter => `https://www.notion.so/Memo-${letter.toUpperCase()}-${ID(letter)}`

console.log('\nthe Memos command layer\n')

check('the context these tests rest on is usable', () => {
  const context = config.contextFor('memos', schema.IDENTITY)
  assert.strictEqual(context.ok, true, context.message)
  assert.strictEqual(context.dataSourceId, 'memos-ds')
})

// ------------------------------------------------------------------- row lists

check('a missing result is refused rather than read as an empty log', () => {
  for (const nothing of [null, undefined]) {
    assert.throws(() => command.rowList(nothing), /no rows to read/)
  }
})

check('the measured envelope is unwrapped and an unknown shape is refused by name', () => {
  assert.deepStrictEqual(command.rowList({ results: [1, 2] }), [1, 2])
  assert.deepStrictEqual(command.rowList([3]), [3])
  assert.throws(() => command.rowList({ nope: true }), /shape this does not recognise/)
})

// ------------------------------------------------------------------------ find

check('find narrows by Type and Domain and excludes drafts and canceled by default', () => {
  const out = capture(() => command.commands.find(save('q1.json', { Type: 'Release' })))
  assert.ok(out.sql.includes(`"Type" = 'Release'`))
  assert.ok(out.sql.includes('ORDER BY'), 'newest first is part of the judgment and has to be in the query')
  assert.deepStrictEqual(out.excluded, ['Draft', 'Canceled'])
  assert.ok(out.sql.includes(`!= 'Draft'`) && out.sql.includes(`!= 'Canceled'`))
  assert.ok(out.sql.includes('IS NULL'), 'a row with no status must still qualify: != alone drops it')
})

check('find can include the retracted, and says drafts are still out', () => {
  const out = capture(() => command.commands.find(save('q2.json', { includeCanceled: true })))
  assert.deepStrictEqual(out.excluded, ['Draft'])
})

check('find refuses a value the database does not have', () => {
  assert.throws(
    () => command.commands.find(save('q3.json', { Type: 'Newsletter' })),
    /not a Type this database has/
  )
})

check('on a renamed workspace every name in the find query is the workspace\'s own', () => {
  withConfig(renamedMaps, () => {
    const out = capture(() => command.commands.find(save('q4.json', { Type: 'Release', Domain: 'Deal Execution' })))
    assert.ok(out.sql.includes(`"R Type" = 'R Release'`), out.sql)
    assert.ok(out.sql.includes(`"R Domain" = 'R Deal Execution'`))
    assert.ok(out.sql.includes('date:R Published date:start'))
    assert.ok(!out.sql.includes(`"Type"`), 'a shipped name leaked into a renamed query')
  })
  writeConfig(identityMaps)
})

check('chain deliberately has no WHERE clause', () => {
  const out = capture(() => command.commands.chain())
  assert.ok(!out.sql.includes('WHERE'), 'a correction chain crosses every filter, so the chain query must not carry one')
})

// ---------------------------------------------------------------------- follow

const memoRow = (letter, extra = {}) => Object.assign({
  url: URL(letter),
  Name: `Memo ${letter.toUpperCase()}`,
  Description: '',
  Type: 'Memo',
  Domain: null,
  Status: 'Published',
  Corrects: '[]',
  'Corrected by': '[]',
  'date:Published date:start': '2026-08-01'
}, extra)

check('follow walks a chain to its end and counts the versions passed', () => {
  const rows = save('chain1.json', {
    results: [
      memoRow('a', { 'Corrected by': JSON.stringify([URL('b')]) }),
      memoRow('b', { Corrects: JSON.stringify([URL('a')]), 'Corrected by': JSON.stringify([URL('c')]) }),
      memoRow('c', { Corrects: JSON.stringify([URL('b')]) })
    ]
  })
  const out = capture(() => command.commands.follow(rows, URL('a')))
  assert.strictEqual(out.answered.url, URL('c'))
  assert.strictEqual(out.versionsPassed, 2)
  assert.deepStrictEqual(out.violations, [])
})

check('a memo nothing corrects answers as it stands', () => {
  const rows = save('chain2.json', { results: [memoRow('a')] })
  const out = capture(() => command.commands.follow(rows, URL('a')))
  assert.strictEqual(out.answered.url, URL('a'))
  assert.strictEqual(out.versionsPassed, 0)
})

check('a branch is shown and neither side is picked', () => {
  const rows = save('chain3.json', {
    results: [
      memoRow('a', { 'Corrected by': JSON.stringify([URL('b'), URL('c')]) }),
      memoRow('b', { Corrects: JSON.stringify([URL('a')]) }),
      memoRow('c', { Corrects: JSON.stringify([URL('a')]) })
    ]
  })
  const out = capture(() => command.commands.follow(rows, URL('a')))
  assert.strictEqual(out.answered, null, 'a branch is a disagreement between two people, and picking the newer is how a log starts lying')
  assert.ok(out.violations.some(v => v.kind === 'branch'))
})

check('a cycle is reported with its members and never broken', () => {
  const rows = save('chain4.json', {
    results: [
      memoRow('a', { 'Corrected by': JSON.stringify([URL('b')]) }),
      memoRow('b', { Corrects: JSON.stringify([URL('a')]), 'Corrected by': JSON.stringify([URL('a')]) })
    ]
  })
  const out = capture(() => command.commands.follow(rows, URL('a')))
  assert.strictEqual(out.answered, null)
  assert.ok(out.violations.some(v => v.kind === 'cycle'))
})

check('a memo correcting several is a violation a person clicking in Notion can build', () => {
  const rows = save('chain5.json', {
    results: [
      memoRow('a', { 'Corrected by': JSON.stringify([URL('b')]) }),
      memoRow('b', { Corrects: JSON.stringify([URL('a'), URL('c')]) }),
      memoRow('c')
    ]
  })
  const out = capture(() => command.commands.follow(rows, URL('a')))
  assert.ok(out.violations.some(v => v.kind === 'corrects-several'))
})

check('a chain pointing outside the rows is reported, not resolved', () => {
  const rows = save('chain6.json', {
    results: [memoRow('a', { 'Corrected by': JSON.stringify([URL('e')]) })]
  })
  const out = capture(() => command.commands.follow(rows, URL('a')))
  assert.strictEqual(out.answered, null)
  assert.ok(out.violations.some(v => v.kind === 'chain-leaves-the-rows'))
})

check('a chain ending in a canceled memo is flagged as retracted', () => {
  const rows = save('chain7.json', {
    results: [
      memoRow('a', { 'Corrected by': JSON.stringify([URL('b')]) }),
      memoRow('b', { Corrects: JSON.stringify([URL('a')]), Status: 'Canceled' })
    ]
  })
  const out = capture(() => command.commands.follow(rows, URL('a')))
  assert.strictEqual(out.answered.status, 'Canceled')
  assert.ok(out.note.includes('CANCELED'), 'the retraction has to be said, not left in a status field')
})

check('follow refuses a start memo that is not in the rows', () => {
  const rows = save('chain8.json', { results: [memoRow('a')] })
  assert.throws(() => command.commands.follow(rows, URL('f')), /not in the rows/)
})

check('follow reads a renamed workspace\'s rows through the map', () => {
  withConfig(renamedMaps, () => {
    const rows = save('chain9.json', {
      results: [
        {
          url: URL('a'),
          'R Name': 'Memo A',
          'R Description': '',
          'R Type': 'R Memo',
          'R Domain': null,
          'R Status': 'R Published',
          'R Corrects': '[]',
          'R Corrected by': JSON.stringify([URL('b')]),
          'date:R Published date:start': '2026-08-01'
        },
        {
          url: URL('b'),
          'R Name': 'Memo B',
          'R Description': '',
          'R Type': 'R Memo',
          'R Domain': null,
          'R Status': 'R Published',
          'R Corrects': JSON.stringify([URL('a')]),
          'R Corrected by': '[]',
          'date:R Published date:start': '2026-08-02'
        }
      ]
    })
    const out = capture(() => command.commands.follow(rows, URL('a')))
    assert.strictEqual(out.answered.url, URL('b'))
    assert.strictEqual(out.answered.status, 'Published', 'the status came back in the workspace\'s own value name and was not mapped back')
  })
  writeConfig(identityMaps)
})

// ----------------------------------------------------------- create and prove

const cleanMemo = () => ({
  Name: 'Pricing changes on the first',
  Description: 'what changes and for whom',
  Type: 'Memo',
  Audience: ['Sales'],
  today: '2026-08-24',
  Corrects: URL('a'),
  body: {
    Recommendation: 'Move list pricing on the first of the month.',
    'What It Changes': 'Every open quote issued after the first.',
    'Why This And Not The Alternative': 'Grandfathering forever was the alternative and it leaks.',
    'What I Need From You': 'A yes by Friday.'
  }
})

check('create builds the payload and says the correction link is not being written', () => {
  const out = capture(() => command.commands.create(save('m1.json', cleanMemo())))
  assert.deepStrictEqual(out.parent, { data_source_id: 'memos-ds' })
  assert.strictEqual(out.properties.Status, 'Published')
  assert.strictEqual(out.corrects, ID('a'))
  assert.ok(out.correctsNote.includes('NOT BEING WRITTEN'))
  assert.ok(out.appendOnly.includes('FROZEN'))
  assert.deepStrictEqual(out.headings, [
    'Recommendation', 'What It Changes', 'Why This And Not The Alternative', 'What I Need From You'
  ])
})

/** The page as Notion would return it: values respelled the measured ways. */
const readbackFor = (properties, letter, headings) => ({
  url: URL(letter),
  properties: Object.fromEntries(Object.entries(properties).map(([name, value]) => {
    if (Array.isArray(value)) {
      const respelled = value.map(one => (/^[0-9a-f-]{36}$/i.test(one) ? `user://${one}` : one))
      return [name, JSON.stringify(respelled)]
    }
    return [name, value]
  })),
  headings
})

check('prove passes a write that came back respelled the way Notion respells it', () => {
  const memoFile = save('m2.json', cleanMemo())
  const created = capture(() => command.commands.create(memoFile))
  const readback = save('r1.json', readbackFor(created.properties, 'a', created.headings))
  const out = capture(() => command.commands.prove(memoFile, readback, URL('a')))
  assert.strictEqual(out.proved, true, JSON.stringify(out.problems))
  assert.ok(out.unchecked.some(u => String(u.why || u).includes('headings were compared')),
    'the proof has to say the body text was not read')
})

check('prove refuses to check a different page from the one created', () => {
  const memoFile = save('m3.json', cleanMemo())
  const created = capture(() => command.commands.create(memoFile))
  const readback = save('r2.json', readbackFor(created.properties, 'b', created.headings))
  const out = capture(() => command.commands.prove(memoFile, readback, URL('a')))
  assert.strictEqual(out.proved, false)
  assert.ok(out.problems.some(p => p.why.includes('not the page that was created')))
})

check('prove fails a page that came back missing a heading', () => {
  const memoFile = save('m4.json', cleanMemo())
  const created = capture(() => command.commands.create(memoFile))
  const readback = save('r3.json', readbackFor(created.properties, 'a', created.headings.slice(1)))
  const out = capture(() => command.commands.prove(memoFile, readback, URL('a')))
  assert.strictEqual(out.proved, false)
  assert.ok(out.problems.some(p => p.what === 'Recommendation'))
})

check('prove fails a property Notion discarded silently', () => {
  const memoFile = save('m5.json', cleanMemo())
  const created = capture(() => command.commands.create(memoFile))
  const stripped = { ...created.properties }
  delete stripped.Name
  const readback = save('r4.json', readbackFor(stripped, 'a', created.headings))
  const out = capture(() => command.commands.prove(memoFile, readback, URL('a')))
  assert.strictEqual(out.proved, false)
  assert.ok(out.problems.some(p => p.what === 'Name'))
})

check('on a renamed workspace the payload carries the workspace\'s names end to end', () => {
  withConfig(renamedMaps, () => {
    const out = capture(() => command.commands.create(save('m6.json', cleanMemo())))
    assert.strictEqual(out.properties['R Status'], 'R Published')
    assert.strictEqual(out.properties['date:R Published date:start'], '2026-08-24')
    assert.ok(!('Status' in out.properties), 'a shipped name leaked into a renamed payload')
  })
  writeConfig(identityMaps)
})

// ------------------------------------------------------------------ team-update

check('team-update refuses a period that is backwards, open, or not days', () => {
  assert.throws(() => command.commands['team-update'](save('p1.json', { from: '2026-08-23', to: '2026-08-17' })), /backwards/)
  assert.throws(() => command.commands['team-update'](save('p2.json', { from: '2026-08-17' })), /both ends/)
  assert.throws(() => command.commands['team-update'](save('p3.json', { from: '2026-02-30', to: '2026-03-05' })), /not a day/)
})

check('team-update emits one query per database, whole tables, with the maps to read them', () => {
  const out = capture(() => command.commands['team-update'](save('p4.json', { from: '2026-08-17', to: '2026-08-23' })))
  assert.ok(out.memos.sql.includes(`"Status" = 'Published'`))
  assert.ok(!out.projects.sql.includes('WHERE'), 'the window filtering happens in the script, where the comparison is measured')
  assert.ok(!out.calendar.sql.includes('WHERE'))
  assert.strictEqual(out.tasks.optional, true)
  assert.ok(out.projects.columns['Timeline:start'].startsWith('date:'))
})

check('on a renamed workspace the team-update queries carry the workspace\'s names', () => {
  withConfig(renamedMaps, () => {
    const out = capture(() => command.commands['team-update'](save('p5.json', { from: '2026-08-17', to: '2026-08-23' })))
    assert.ok(out.memos.sql.includes(`"R Status" = 'R Published'`), out.memos.sql)
    assert.ok(out.calendar.sql.includes('date:R Date:start'))
  })
  writeConfig(identityMaps)
})

check('a config missing a database this read needs is a refusal naming the remedy', () => {
  const partial = configWith(identityMaps)
  delete partial.databases.projects
  const file = path.join(SANDBOX, 'partial-config.json')
  fs.writeFileSync(file, JSON.stringify(partial))
  const period = save('p6.json', { from: '2026-08-17', to: '2026-08-23' })
  let failed = null
  try {
    execFileSync('node', [path.join(__dirname, '../plugins/memos/scripts/memos.js'), 'team-update', period], {
      env: { ...process.env, GTM_OPERATOR_CONFIG: file },
      encoding: 'utf8'
    })
  } catch (err) {
    failed = err
  }
  assert.ok(failed, 'a missing projects entry was accepted, so the read would have gone nowhere')
  assert.ok(String(failed.stderr).includes('records no "projects" database'))
  assert.ok(String(failed.stderr).includes('`add`'), 'the refusal has to name the remedy')
})

// ----------------------------------------------------------------------- window

check('window partitions the period and counts everything it leaves out', () => {
  const period = save('w-period.json', { from: '2026-08-17', to: '2026-08-23' })
  const memos = save('w-memos.json', {
    results: [
      memoRow('a', { Type: 'Release', 'date:Published date:start': '2026-08-20' }),
      memoRow('b', { Type: 'Release', 'date:Published date:start': '2026-08-10' }),
      memoRow('c', { Type: 'Project Update', 'date:Published date:start': '2026-08-18' }),
      memoRow('d', { Type: 'Memo', 'date:Published date:start': '2026-08-19' })
    ]
  })
  const projects = save('w-projects.json', {
    results: [
      { url: 'p1', Name: 'Done project', Status: 'Done', Description: '', 'date:Timeline:start': null, 'date:Timeline:end': null },
      { url: 'p2', Name: 'Open project', Status: 'In progress', Description: '', 'date:Timeline:start': null, 'date:Timeline:end': null },
      { url: 'p3', Name: 'Dead project', Status: 'Canceled', Description: '', 'date:Timeline:start': null, 'date:Timeline:end': null }
    ]
  })
  const calendar = save('w-calendar.json', {
    results: [
      { url: 'c1', Name: 'Went out', Type: 'Email send', Status: 'Done', 'date:Date:start': '2026-08-19', 'date:Date:end': null },
      { url: 'c2', Name: 'Coming soon', Type: 'Webinar', Status: 'Confirmed', 'date:Date:start': '2026-08-25', 'date:Date:end': null },
      { url: 'c3', Name: 'Far away', Type: 'Event', Status: 'Confirmed', 'date:Date:start': '2026-09-15', 'date:Date:end': null },
      { url: 'c4', Name: 'Not happening', Type: 'Event', Status: 'Canceled', 'date:Date:start': '2026-08-19', 'date:Date:end': null }
    ]
  })
  const tasks = save('w-tasks.json', {
    results: [
      { url: 't1', 'Task name': 'Stuck task', Status: 'Blocked', 'date:Due date:start': '2026-08-18' },
      { url: 't2', 'Task name': 'Finished task', Status: 'Done', 'date:Due date:start': '2026-08-18' }
    ]
  })

  const out = capture(() => command.commands.window(period, projects, calendar, memos, tasks))
  assert.strictEqual(out.shipped.releases.length, 1)
  assert.strictEqual(out.shipped.releases[0].url, URL('a'))
  assert.strictEqual(out.detail.projectUpdates.length, 1)
  assert.strictEqual(out.shipped.wentOut.length, 1)
  assert.strictEqual(out.shipped.doneProjects.length, 1)
  assert.ok(out.shipped.doneProjectsNote.includes('Done NOW'), 'the unknowable when has to be said')
  assert.strictEqual(out.stillOpen.projects.length, 1)
  assert.strictEqual(out.stillOpen.blocked.length, 1)
  assert.strictEqual(out.upcoming.rows.length, 1, 'the lookahead is the period\'s own length, so c2 is in and c3 is out')
  assert.strictEqual(out.needsADecision, null)
  assert.ok(out.needsADecisionNote.includes('CANNOT BE ASSEMBLED'))
  assert.deepStrictEqual(out.leftOut, {
    memosOutsidePeriod: 1,
    memosOtherTypes: 1,
    calendarCanceled: 1,
    calendarOutsideWindow: 1,
    projectsCanceled: 1,
    note: out.leftOut.note
  })
})

check('window without the tasks read says the stuck list rests on project statuses', () => {
  const period = save('w2-period.json', { from: '2026-08-17', to: '2026-08-23' })
  const empty = save('w2-empty.json', { results: [] })
  const out = capture(() => command.commands.window(period, empty, empty, empty))
  assert.strictEqual(out.stillOpen.blocked, null)
  assert.ok(out.stillOpen.blockedNote.includes('not read'))
})

// ------------------------------------------------------------------------ tasks

check('tasks builds one payload per action, into the Tasks data source', () => {
  const actions = save('a1.json', [
    { what: 'Send the revised deck', who: PERSON, due: '2026-09-01', description: 'the one from the call' },
    { what: 'Book the venue', who: 'me', due: '2026-09-03' }
  ])
  const out = capture(() => command.commands.tasks(actions))
  assert.strictEqual(out.tasks.length, 2)
  assert.deepStrictEqual(out.tasks[0].parent, { data_source_id: 'tasks-ds' })
  assert.strictEqual(out.tasks[0].properties['Task name'], 'Send the revised deck')
  assert.strictEqual(out.tasks[0].properties.Status, 'Not started')
  assert.deepStrictEqual(out.tasks[0].properties.Assignee, [PERSON])
  assert.strictEqual(out.tasks[0].properties['date:Due date:start'], '2026-09-01')
  assert.strictEqual(out.tasks[0].properties['date:Due date:end'], null)
  assert.deepStrictEqual(out.tasks[1].properties.Assignee, [PERSON], '`me` resolves to the configured person')
  assert.ok(out.projectRelationNote.includes('NOT WRITTEN'))
})

check('an action without a person or a date is a wish and is refused', () => {
  assert.throws(() => command.commands.tasks(save('a2.json', [{ what: 'Drift', due: '2026-09-01' }])), /no `who`/)
  assert.throws(() => command.commands.tasks(save('a3.json', [{ what: 'Drift', who: PERSON }])), /no `due`/)
  assert.throws(() => command.commands.tasks(save('a4.json', [{ what: 'Drift', who: 'Priya', due: '2026-09-01' }])), /not a Notion person id/)
  assert.throws(() => command.commands.tasks(save('a5.json', [])), /empty/)
})

check('tasks land under the workspace\'s own names on a renamed workspace', () => {
  withConfig(renamedMaps, () => {
    const actions = save('a6.json', [{ what: 'Send the deck', who: PERSON, due: '2026-09-01' }])
    const out = capture(() => command.commands.tasks(actions))
    assert.strictEqual(out.tasks[0].properties['R Task name'], 'Send the deck')
    assert.strictEqual(out.tasks[0].properties['R Status'], 'R Not started')
    assert.strictEqual(out.tasks[0].properties['date:R Due date:start'], '2026-09-01')
  })
  writeConfig(identityMaps)
})

check('prove-task proves one task the same way prove proves a memo', () => {
  const actions = save('a7.json', [{ what: 'Send the deck', who: PERSON, due: '2026-09-01' }])
  const built = capture(() => command.commands.tasks(actions))
  const task = save('t1.json', built.tasks[0])
  const good = save('t1-readback.json', readbackFor(built.tasks[0].properties, 'a', []))
  const out = capture(() => command.commands['prove-task'](task, good, URL('a')))
  assert.strictEqual(out.proved, true, JSON.stringify(out.problems))

  const stripped = { ...built.tasks[0].properties }
  delete stripped['Task name']
  const bad = save('t1-bad.json', readbackFor(stripped, 'a', []))
  const failed = capture(() => command.commands['prove-task'](task, bad, URL('a')))
  assert.strictEqual(failed.proved, false)
})

console.log(failures ? `\n${failures} failed.\n` : '\nAll passed.\n')
process.exit(failures ? 1 : 0)

'use strict'

/**
 * The Projects command layer: the queries it builds and the judgments it
 * makes.
 *
 * TWO CONFIGS, AND THAT IS THE POINT. One records the shipped property names
 * and one records a workspace that renamed every property and every value. A
 * query built against the second that still carries the shipped names would
 * come back with no rows, and no rows is exactly what a board with nothing on
 * it looks like.
 *
 * WHAT THIS DOES NOT PROVE. No SQL here has been sent. The queries are
 * asserted as strings, and whether Notion's SQL surface accepts them is a
 * live-run question this cannot answer.
 *
 * Run: node tests/projects-command.test.js
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const assert = require('assert')

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'gtm-projects-command-'))
process.env.GTM_OPERATOR_CONFIG = path.join(SANDBOX, 'gtm-operator.config.json')

const setupSchema = require('../plugins/setup/scripts/schema')

const DATABASES = ['projects', 'tasks', 'memos', 'process']
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

const command = require('../plugins/projects/scripts/projects')
const config = require('../shared/config-read')
const schema = require('../shared/projects-schema')

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
const URL = letter => `https://www.notion.so/Page-${letter.toUpperCase()}-${ID(letter)}`

console.log('\nthe Projects command layer\n')

check('the context these tests rest on is usable, for both databases this plugin owns', () => {
  const projects = config.contextFor('projects', schema.IDENTITY)
  assert.strictEqual(projects.ok, true, projects.message)
  assert.strictEqual(projects.dataSourceId, 'projects-ds')
  const tasks = config.contextFor('tasks', schema.TASKS_IDENTITY)
  assert.strictEqual(tasks.ok, true, tasks.message)
  assert.strictEqual(tasks.dataSourceId, 'tasks-ds')
})

// -------------------------------------------------------------------- survey

check('survey emits three whole-table reads, and only the problem statements carry a WHERE', () => {
  const out = capture(() => command.commands.survey())
  assert.ok(!out.projects.sql.includes('WHERE'), 'what exists is judged over all the rows, not over what a keyword hit')
  assert.ok(!out.process.sql.includes('WHERE'))
  assert.ok(out.problemStatements.sql.includes(`"Type" = 'Problem Statement'`))
  assert.ok(out.problemStatements.sql.includes('<memos-ds>'))
  assert.ok(out.process.sql.includes('<process-ds>'))
  assert.ok(out.projects.sql.includes('<projects-ds>'))
})

check('on a renamed workspace every name in the survey queries is the workspace\'s own', () => {
  withConfig(renamedMaps, () => {
    const out = capture(() => command.commands.survey())
    assert.ok(out.problemStatements.sql.includes(`"R Type" = 'R Problem Statement'`), out.problemStatements.sql)
    assert.ok(out.projects.sql.includes('"R Status"'))
    assert.ok(out.process.sql.includes('"R Name"'))
    assert.ok(!out.projects.sql.includes('"Status"'), 'a shipped name leaked into a renamed query')
  })
  writeConfig(identityMaps)
})

check('a config missing the process database is a refusal naming the remedy', () => {
  const { execFileSync } = require('child_process')
  const partial = configWith(identityMaps)
  delete partial.databases.process
  const file = path.join(SANDBOX, 'partial-config.json')
  fs.writeFileSync(file, JSON.stringify(partial))
  let failed = null
  try {
    execFileSync('node', [path.join(__dirname, '../plugins/projects/scripts/projects.js'), 'survey'], {
      env: { ...process.env, GTM_OPERATOR_CONFIG: file },
      encoding: 'utf8'
    })
  } catch (err) {
    failed = err
  }
  assert.ok(failed, 'a missing process entry was accepted, so the read would have gone nowhere')
  assert.ok(String(failed.stderr).includes('records no "process" database'))
  assert.ok(String(failed.stderr).includes('`add`'), 'the refusal has to name the remedy')
})

// --------------------------------------------------------------------- board

const projectRow = (letter, extra = {}) => Object.assign({
  url: URL(letter),
  Name: `Project ${letter.toUpperCase()}`,
  Status: 'In progress',
  Priority: 'Prio 2',
  'Level of Effort': 'Med',
  Domain: null,
  Description: ''
}, extra)

check('board groups what is competing for time and counts what is off it', () => {
  const rows = save('board1.json', {
    results: [
      projectRow('a', { Priority: 'Prio 1' }),
      projectRow('b', { Status: 'Scoped', Priority: 'Prio 2' }),
      projectRow('c', { Status: 'Done' }),
      projectRow('d', { Status: 'Canceled' }),
      projectRow('e', { Priority: null })
    ]
  })
  const out = capture(() => command.commands.board(rows))
  assert.strictEqual(out.board['Prio 1'].length, 1)
  assert.strictEqual(out.board['Prio 2'].length, 1)
  assert.strictEqual(out.board.unset.length, 1)
  assert.deepStrictEqual([out.leftOut.done, out.leftOut.canceled], [1, 1])
})

check('board reads a renamed workspace\'s rows through the map', () => {
  withConfig(renamedMaps, () => {
    const rows = save('board2.json', {
      results: [{
        url: URL('a'),
        'R Name': 'Project A',
        'R Status': 'R Scoped',
        'R Priority': 'R Prio 1',
        'R Level of Effort': 'R Low',
        'R Domain': null,
        'R Description': ''
      }]
    })
    const out = capture(() => command.commands.board(rows))
    assert.strictEqual(out.board['Prio 1'].length, 1, 'the priority came back in the workspace\'s own value name and was not mapped back')
    assert.strictEqual(out.board['Prio 1'][0].status, 'Scoped')
  })
  writeConfig(identityMaps)
})

check('a missing result is refused rather than read as an empty board', () => {
  assert.throws(() => command.rowList(null), /no rows to read/)
  assert.throws(() => command.rowList({ nope: true }), /shape this does not recognise/)
})

// ----------------------------------------------------------- create and prove

const PS_PAGE = URL('f')

const cleanProject = () => ({
  Name: 'Wire the lead router',
  Description: 'Route inbound leads to an owner by segment.',
  'Level of Effort': 'Med',
  Priority: 'Prio 2',
  Domain: 'Pipeline & Demand Gen',
  problemStatement: PS_PAGE,
  'Business outcome': 'No lead waits on a human.',
  body: {
    'What We Are Building': 'A router. The smallest version that would prove this works: one segment routed live.',
    'Out Of Scope': 'Enrichment, which already exists as an SOP.',
    'Success Criteria': 'A new lead reaches the right owner within a minute.',
    'Risks And Dependencies': 'none known'
  }
})

check('check reports writable on a clean row and refuses a broken one with the exit code', () => {
  const out = capture(() => command.commands.check(save('c1.json', cleanProject())))
  assert.strictEqual(out.writable, true)
  const bad = capture(() => command.commands.check(save('c2.json', { ...cleanProject(), problemStatement: undefined })))
  assert.strictEqual(bad.writable, false)
  assert.strictEqual(process.exitCode, 1)
})

check('create builds the payload and says the problem statement link is not being written', () => {
  const out = capture(() => command.commands.create(save('c3.json', cleanProject())))
  assert.deepStrictEqual(out.parent, { data_source_id: 'projects-ds' })
  assert.strictEqual(out.properties.Status, 'Scoped')
  assert.strictEqual(out.problemStatement, ID('f'))
  assert.ok(out.problemStatementNote.includes('NOT BEING WRITTEN'))
  assert.deepStrictEqual(out.headings, ['What We Are Building', 'Out Of Scope', 'Success Criteria', 'Risks And Dependencies'])
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
  const file = save('c4.json', cleanProject())
  const created = capture(() => command.commands.create(file))
  const readback = save('c4-r.json', readbackFor(created.properties, 'a', created.headings))
  const out = capture(() => command.commands.prove(file, readback, URL('a')))
  assert.strictEqual(out.proved, true, JSON.stringify(out.problems))
})

check('prove refuses a different page and fails a missing heading or discarded property', () => {
  const file = save('c5.json', cleanProject())
  const created = capture(() => command.commands.create(file))

  const wrongPage = capture(() => command.commands.prove(file, save('c5-w.json', readbackFor(created.properties, 'b', created.headings)), URL('a')))
  assert.strictEqual(wrongPage.proved, false)

  const noHeading = capture(() => command.commands.prove(file, save('c5-h.json', readbackFor(created.properties, 'a', created.headings.slice(1))), URL('a')))
  assert.strictEqual(noHeading.proved, false)
  assert.ok(noHeading.problems.some(p => p.what === 'What We Are Building'))

  const stripped = { ...created.properties }
  delete stripped.Name
  const noName = capture(() => command.commands.prove(file, save('c5-n.json', readbackFor(stripped, 'a', created.headings)), URL('a')))
  assert.strictEqual(noName.proved, false)
  assert.ok(noName.problems.some(p => p.what === 'Name'))
})

check('on a renamed workspace the payload carries the workspace\'s names end to end', () => {
  withConfig(renamedMaps, () => {
    const out = capture(() => command.commands.create(save('c6.json', cleanProject())))
    assert.strictEqual(out.properties['R Status'], 'R Scoped')
    assert.ok(!('Status' in out.properties), 'a shipped name leaked into a renamed payload')
  })
  writeConfig(identityMaps)
})

// ------------------------------------------------------------- fill and start

const fetchedProject = (letter, status, extra = {}) => ({
  url: URL(letter),
  properties: Object.assign({
    Name: 'Hand-made project',
    Status: status,
    Domain: '',
    Segment: '[]',
    'L2C Lifecycle': '[]'
  }, extra)
})

check('fill fills only a row at Intake, and refuses every other state', () => {
  const file = save('f1.json', cleanProject())
  const out = capture(() => command.commands.fill(file, save('f1-e.json', fetchedProject('a', 'Intake'))))
  assert.strictEqual(out.target, ID('a'))
  assert.strictEqual(out.properties.Status, 'Scoped')
  assert.ok(Array.isArray(out.headings))
  for (const status of ['Scoped', 'In progress', 'Done', 'Canceled']) {
    assert.throws(
      () => capture(() => command.commands.fill(file, save(`f1-${status}.json`, fetchedProject('a', status)))),
      /only at Intake/,
      `${status} was accepted`
    )
  }
})

check('start moves a Scoped row, and reads the fetched page through the map on a renamed workspace', () => {
  const out = capture(() => command.commands.start(save('s1.json', {}), save('s1-e.json', fetchedProject('a', 'Scoped'))))
  assert.strictEqual(out.target, ID('a'))
  assert.strictEqual(out.properties.Status, 'In progress')
  assert.deepStrictEqual(out.properties.Owner, [PERSON])

  withConfig(renamedMaps, () => {
    const fetched = {
      url: URL('b'),
      properties: { 'R Name': 'P', 'R Status': 'R Scoped', 'R Domain': '', 'R Segment': '[]', 'R L2C Lifecycle': '[]' }
    }
    const renamedOut = capture(() => command.commands.start(save('s2.json', {}), save('s2-e.json', fetched)))
    assert.strictEqual(renamedOut.properties['R Status'], 'R In progress',
      'the fetched status came back in the workspace\'s own value name and was not mapped back')
  })
  writeConfig(identityMaps)
})

check('start refuses an unscoped row and a fetched multi-select blocks a second write', () => {
  assert.throws(
    () => capture(() => command.commands.start(save('s3.json', {}), save('s3-e.json', fetchedProject('a', 'Intake')))),
    /cannot be started/
  )
  assert.throws(
    () => capture(() => command.commands.start(
      save('s4.json', { Segment: ['SMB'] }),
      save('s4-e.json', fetchedProject('a', 'Scoped', { Segment: '["Enterprise"]' }))
    )),
    /already holds/,
    'a segment already on the row was overwritten'
  )
})

// -------------------------------------------------------- tasks and the close

check('tasks builds ordered payloads and says the project relation is not written', () => {
  const out = capture(() => command.commands.tasks(save('t1.json', [
    { what: 'Wire the webhook', who: 'me', due: '2026-09-01' },
    { what: 'Verify live' }
  ])))
  assert.strictEqual(out.tasks.length, 2)
  assert.deepStrictEqual(out.tasks[0].parent, { data_source_id: 'tasks-ds' })
  assert.strictEqual(out.tasks[0].properties.Order, 1)
  assert.strictEqual(out.tasks[1].properties.Order, 2)
  assert.ok(out.projectRelationNote.includes('NOT WRITTEN'))
  assert.ok(out.concerns.some(c => c.kind === 'count-outside-band'), 'two tasks is outside the band and worth asking about')
})

check('prove-task proves one task and fails a stripped one', () => {
  const built = capture(() => command.commands.tasks(save('t2.json', [{ what: 'Send the deck', who: PERSON, due: '2026-09-01' }])))
  const task = save('t2-task.json', built.tasks[0])
  const good = capture(() => command.commands['prove-task'](task, save('t2-r.json', readbackFor(built.tasks[0].properties, 'a', [])), URL('a')))
  assert.strictEqual(good.proved, true, JSON.stringify(good.problems))
  assert.ok(good.unchecked.some(u => String(u.what).includes('Order')), 'how a number reads back is unmeasured, so Order is reported unchecked rather than guessed')

  const stripped = { ...built.tasks[0].properties }
  delete stripped['Task name']
  const bad = capture(() => command.commands['prove-task'](task, save('t2-b.json', readbackFor(stripped, 'a', [])), URL('a')))
  assert.strictEqual(bad.proved, false)
})

check('open-tasks reads the whole table with the relation column, unfinished filters in the script', () => {
  const sql = capture(() => command.commands['open-tasks']())
  assert.ok(!sql.sql.includes('WHERE'), 'filtering through a relation in SQL is unmeasured, so the whole table is fetched')
  assert.ok(sql.sql.includes('"Project"'))

  const rows = save('u1.json', {
    results: [
      { url: URL('a'), 'Task name': 'Open here', Status: 'In progress', Project: JSON.stringify([URL('1')]) },
      { url: URL('b'), 'Task name': 'Done here', Status: 'Done', Project: JSON.stringify([URL('1')]) },
      { url: URL('c'), 'Task name': 'Half-built', Status: '', Project: JSON.stringify([URL('1')]) },
      { url: URL('d'), 'Task name': 'Elsewhere', Status: 'In progress', Project: JSON.stringify([URL('2')]) },
      { url: URL('e'), 'Task name': 'Orphan', Status: 'In progress', Project: '[]' }
    ]
  })
  const out = capture(() => command.commands.unfinished(rows, URL('1')))
  assert.strictEqual(out.open.length, 2, 'the open task and the statusless one count; done and other-project rows do not')
  assert.ok(out.open.some(t => t.name === 'Half-built' && t.status === null), 'a task with no status counts as open')
  assert.deepStrictEqual(out.leftOut, { finishedOrCanceled: 1, otherProjects: 2 })
})

check('close needs an In progress row and the release memo, and emits the one move', () => {
  const out = capture(() => command.commands.close(save('cl1.json', fetchedProject('a', 'In progress')), URL('3')))
  assert.strictEqual(out.target, ID('a'))
  assert.deepStrictEqual(out.properties, { Status: 'Done' })
  assert.strictEqual(out.release, ID('3'))
  assert.ok(out.relationNote.includes('NOT WRITTEN'))

  assert.throws(
    () => capture(() => command.commands.close(save('cl2.json', fetchedProject('a', 'Scoped')), URL('3'))),
    /cannot be closed/
  )
})

check('prove-update takes a command\'s own output, binds to its target, and refuses anything else', () => {
  const sent = capture(() => command.commands.close(save('cl3.json', fetchedProject('a', 'In progress')), URL('3')))
  const output = save('cl3-out.json', sent)
  const good = capture(() => command.commands['prove-update'](output, save('cl3-r.json', readbackFor(sent.properties, 'a', []))))
  assert.strictEqual(good.proved, true, JSON.stringify(good.problems))

  const wrongPage = capture(() => command.commands['prove-update'](output, save('cl3-w.json', readbackFor(sent.properties, 'b', []))))
  assert.strictEqual(wrongPage.proved, false)

  assert.throws(
    () => capture(() => command.commands['prove-update'](save('cl3-x.json', { properties: {} }), save('cl3-y.json', {}))),
    /not the output of/
  )
})

// ---------------------------------------------------------------- the memos

const cleanUpdateMemo = () => ({
  Name: 'Routing changes on the first',
  Description: 'what changes and for whom',
  Type: 'Project Update',
  project: URL('1'),
  today: '2026-08-24',
  body: {
    'What Changed': 'Inbound leads route by segment now.',
    Why: 'The queue was eating a day per lead.',
    'Who Is Affected And When': 'Sales and RevOps, from the first.',
    'What You Need To Do': 'Nothing.'
  }
})

check('memo-check gates the three types and refuses the other four with a pointer', () => {
  const out = capture(() => command.commands['memo-check'](save('m1.json', cleanUpdateMemo())))
  assert.strictEqual(out.writable, true)
  assert.throws(
    () => capture(() => command.commands['memo-check'](save('m2.json', { ...cleanUpdateMemo(), Type: 'Meeting Notes' }))),
    /memos:new/
  )
})

check('memo-create holds the same restriction itself, because check is advisory and create is the write', () => {
  // Found by mutation: deleting create's own type gate left the suite green,
  // because only memo-check was tested. A memo type valid in the Memos
  // database and outside this plugin's three must be refused at the payload
  // too, or a caller that skips check writes it.
  assert.throws(
    () => capture(() => command.commands['memo-create'](save('m2b.json', { ...cleanUpdateMemo(), Type: 'Memo' }))),
    /memos:new/
  )
})

check('memo-create requires the project on an update or release, and not on a problem statement', () => {
  const out = capture(() => command.commands['memo-create'](save('m3.json', cleanUpdateMemo())))
  assert.deepStrictEqual(out.parent, { data_source_id: 'memos-ds' })
  assert.strictEqual(out.properties.Status, 'Published')
  assert.strictEqual(out.project, ID('1'))
  assert.ok(out.projectNote.includes('NOT BEING WRITTEN'))

  assert.throws(
    () => capture(() => command.commands['memo-create'](save('m4.json', { ...cleanUpdateMemo(), project: undefined }))),
    /about one project/
  )

  const problemStatement = capture(() => command.commands['memo-create'](save('m5.json', {
    Name: 'Leads wait a day',
    Description: 'the case for routing',
    Type: 'Problem Statement',
    today: '2026-08-24',
    body: {
      'What This Blocks': 'The pipeline goal, owned by Sam, decision due 2026-09-15.',
      "What's Happening": 'Leads sit unrouted.',
      'Who Feels It': 'Sales.',
      Evidence: 'Observed daily in #leads since July.',
      'Cost Of Doing Nothing': 'A day of latency per lead.'
    }
  })))
  assert.strictEqual(problemStatement.project, null)
  assert.ok(problemStatement.projectNote.includes('legal only for a problem statement'))
})

check('a release names the artifacts note, and the memo payload resolves renamed workspaces', () => {
  const release = () => ({
    Name: 'The router is live',
    Description: 'what shipped',
    Type: 'Release',
    project: URL('1'),
    today: '2026-08-24',
    body: {
      'What This Lets You Do': 'Stop routing by hand.',
      'What Shipped': 'Wired the enrichment webhook to the Segment field on Leads.',
      'How To Get It': 'Nothing, it is already live.',
      'Known Gaps': 'Outbound is untouched; keep the old sheet for it.'
    }
  })
  const out = capture(() => command.commands['memo-create'](save('m6.json', release())))
  assert.ok(out.artifactsNote && out.artifactsNote.includes('audit'))

  withConfig(renamedMaps, () => {
    const renamedOut = capture(() => command.commands['memo-create'](save('m7.json', release())))
    assert.strictEqual(renamedOut.properties['R Status'], 'R Published')
    assert.ok(!('Status' in renamedOut.properties), 'a shipped name leaked into a renamed payload')
  })
  writeConfig(identityMaps)
})

check('memo-prove proves the write the same way the memos plugin does', () => {
  const file = save('m8.json', cleanUpdateMemo())
  const created = capture(() => command.commands['memo-create'](file))
  const good = capture(() => command.commands['memo-prove'](file, save('m8-r.json', readbackFor(created.properties, 'a', created.headings)), URL('a')))
  assert.strictEqual(good.proved, true, JSON.stringify(good.problems))

  const stripped = { ...created.properties }
  delete stripped.Type
  const bad = capture(() => command.commands['memo-prove'](file, save('m8-b.json', readbackFor(stripped, 'a', created.headings)), URL('a')))
  assert.strictEqual(bad.proved, false)
})

console.log(failures ? `\n${failures} failed.\n` : '\nAll passed.\n')
process.exit(failures ? 1 : 0)

'use strict'

/**
 * The Projects and Tasks facts the writer carries agree with the ones the
 * builder uses.
 *
 * `plugins/setup/scripts/schema.js` is what `setup` builds both databases
 * from. `shared/projects-schema.js` is what the writing plugin carries,
 * because an installed `projects` cannot reach `setup`'s files. Two files,
 * two databases, one definition each.
 *
 * The loud case of a disagreement is a 400 on the first write. The quiet
 * cases are the rules: the status transitions live only in the shared file,
 * so they are pinned here against the value lists they move between.
 *
 * WHAT THIS TEST CANNOT DO. It compares this checkout against itself. An
 * installed `setup` and an installed `projects` are separate releases updated
 * separately, and nothing here can reach them. `configVersion` in
 * `shared/config-read.js` is what covers that gap.
 *
 * Run: node tests/projects-schema-agrees.test.js
 */

const assert = require('assert')
const fs = require('fs')
const path = require('path')

const setupSchema = require('../plugins/setup/scripts/schema')
const shared = require('../shared/projects-schema')
const memosShared = require('../shared/memos-schema')

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

console.log('\nthe shared Projects and Tasks schema agrees with what setup builds\n')

const projects = setupSchema.DATABASES ? setupSchema.DATABASES.projects : null
const tasks = setupSchema.DATABASES ? setupSchema.DATABASES.tasks : null

check('setup has Projects and Tasks definitions to compare against', () => {
  assert.ok(projects && Array.isArray(projects.properties) && projects.properties.length,
    'could not reach setup\'s projects schema, so this test proves nothing')
  assert.ok(tasks && Array.isArray(tasks.properties) && tasks.properties.length,
    'could not reach setup\'s tasks schema, so this test proves nothing')
})

const optionsOf = (db, name) => {
  const property = db.properties.find(p => p.name === name)
  if (!property || !Array.isArray(property.options)) return null
  return property.options.map(o => (Array.isArray(o) ? o[0] : o))
}
const typeOf = (db, name) => {
  const property = db.properties.find(p => p.name === name)
  return property ? property.type : null
}

// --------------------------------------------------------------- value lists

const lists = [
  [projects, 'project status', 'PROJECT_STATUSES', 'Status'],
  [projects, 'priority', 'PRIORITIES', 'Priority'],
  [projects, 'effort', 'EFFORTS', 'Level of Effort'],
  [projects, 'domain', 'DOMAINS', 'Domain'],
  [projects, 'segment', 'SEGMENTS', 'Segment'],
  [projects, 'L2C lifecycle', 'L2C', 'L2C Lifecycle'],
  [tasks, 'task status', 'TASK_STATUSES', 'Status']
]

for (const [db, label, exported, property] of lists) {
  check(`the ${label} list matches, in the same order`, () => {
    assert.deepStrictEqual(
      shared[exported],
      optionsOf(db, property),
      `the shared ${label} list and the one setup creates are not the same list. ` +
      'A value here that setup never created is a 400 on the first write, and the whole page is lost.'
    )
  })
}

check('the two status lists differ exactly as the design says', () => {
  // Deliberately different: Scoped has no meaning on a task, and Blocked has
  // real meaning on one. A helper that assumed one list would be wrong, so
  // the difference is pinned rather than discovered.
  assert.ok(!shared.TASK_STATUSES.includes('Scoped'), 'Scoped has no meaning on a task')
  assert.ok(!shared.TASK_STATUSES.includes('Intake'), 'Intake has no meaning on a task')
  assert.ok(shared.TASK_STATUSES.includes('Blocked'), 'Blocked is the task status a standup needs')
  assert.ok(!shared.PROJECT_STATUSES.includes('Blocked'), 'a blocked project is a note on one still in progress, not a status')
})

// ------------------------------------------------------------ the name contract

check('the Projects IDENTITY equals what setup would record, in both directions', () => {
  const built = setupSchema.identityNames('projects')
  assert.deepStrictEqual(
    shared.IDENTITY_PROPERTIES.slice().sort(),
    Object.keys(built.properties).sort(),
    'the properties this plugin expects and the ones setup records are not the same set. ' +
    'A property setup creates and this file omits is one the config reader will not check, ' +
    'so a renamed workspace writes to a property that is not there.'
  )
  assert.deepStrictEqual(
    Object.keys(shared.IDENTITY_VALUES).sort(),
    Object.keys(built.values).sort(),
    'the properties carrying value lists disagree'
  )
  for (const property of Object.keys(built.values)) {
    assert.deepStrictEqual(
      shared.IDENTITY_VALUES[property].slice().sort(),
      Object.keys(built.values[property]).sort(),
      `the values for "${property}" disagree`
    )
  }
})

check('the Tasks IDENTITY equals what setup would record, in both directions', () => {
  const built = setupSchema.identityNames('tasks')
  assert.deepStrictEqual(
    shared.TASK_IDENTITY_PROPERTIES.slice().sort(),
    Object.keys(built.properties).sort(),
    'the task properties this plugin expects and the ones setup records are not the same set'
  )
  assert.deepStrictEqual(
    Object.keys(shared.TASK_IDENTITY_VALUES).sort(),
    Object.keys(built.values).sort(),
    'the task properties carrying value lists disagree'
  )
  for (const property of Object.keys(built.values)) {
    assert.deepStrictEqual(
      shared.TASK_IDENTITY_VALUES[property].slice().sort(),
      Object.keys(built.values[property]).sort(),
      `the task values for "${property}" disagree`
    )
  }
})

check('the Tasks title is "Task name", the detail a generator gets wrong', () => {
  assert.strictEqual(typeOf(tasks, 'Task name'), 'title')
  assert.strictEqual(typeOf(tasks, 'Name'), null, 'Tasks has no "Name" property; its title is "Task name"')
})

// ------------------------------------------------------------- property types

check('every person field is a person property in setup\'s definition', () => {
  for (const name of shared.PERSON_FIELDS) {
    assert.strictEqual(typeOf(projects, name), 'person', `"${name}" is treated as a person field here and setup creates it as "${typeOf(projects, name)}"`)
  }
  for (const name of shared.TASK_PERSON_FIELDS) {
    assert.strictEqual(typeOf(tasks, name), 'person', `"${name}" is treated as a person field here and setup creates it as "${typeOf(tasks, name)}"`)
  }
})

check('every multi-select field is a multi_select in setup\'s definition', () => {
  for (const name of shared.MULTI_SELECT_FIELDS) {
    assert.strictEqual(
      typeOf(projects, name),
      'multi_select',
      `"${name}" is sent as a list here and setup creates it as "${typeOf(projects, name)}". ` +
      'Sending a bare string to a multi_select, or a list to a select, is a 400.'
    )
  }
})

check('the date fields the writer touches are date properties, and Order is a number', () => {
  assert.strictEqual(typeOf(projects, 'Timeline'), 'date', 'Timeline is written through date columns')
  assert.strictEqual(typeOf(tasks, 'Due date'), 'date', 'Due date is written through date columns')
  assert.strictEqual(typeOf(tasks, 'Order'), 'number', 'Order ships as a plain number: the reference\'s fractional strings are deliberately not reproduced')
})

// ------------------------------------------------------------------ the rules

check('the transitions move between statuses the property actually has, one step, no overlap', () => {
  for (const status of shared.SCOPE_WRITABLE_STATUSES) {
    assert.ok(shared.PROJECT_STATUSES.includes(status), `scope may write "${status}", which is not a status the property has`)
  }
  for (const transition of [shared.ADVANCE, shared.CLOSE]) {
    assert.ok(shared.PROJECT_STATUSES.includes(transition.from), `a transition starts at "${transition.from}", which is not a status`)
    assert.ok(shared.PROJECT_STATUSES.includes(transition.to), `a transition ends at "${transition.to}", which is not a status`)
    assert.strictEqual(
      shared.PROJECT_STATUSES.indexOf(transition.to) - shared.PROJECT_STATUSES.indexOf(transition.from),
      1,
      `${transition.from} to ${transition.to} is not one step: no skill moves a project more than one step`
    )
  }
  assert.notStrictEqual(shared.ADVANCE.from, shared.CLOSE.from, 'two skills earning the same move would blur who owns it')
  // Intake is the one state no skill ever writes: it is where a hand-made row
  // starts, and a person sets it. Scoped IS both written (by scope) and
  // required (by new); that is the pipeline, not an overlap.
  const skillWritable = new Set([...shared.SCOPE_WRITABLE_STATUSES, shared.ADVANCE.to, shared.CLOSE.to])
  assert.ok(!skillWritable.has('Intake'), 'Intake is where a hand-made row starts, and no skill writes it')
})

check('tasks are created at a status the property has, and nothing here moves one', () => {
  assert.ok(shared.TASK_STATUSES.includes(shared.TASK_CREATE_STATUS))
  assert.strictEqual(shared.TASK_CREATE_STATUS, 'Not started', 'tasks are created at Not started and people move them')
})

check('the fields new preserves are fields the database has', () => {
  const names = new Set(shared.IDENTITY_PROPERTIES)
  for (const field of shared.SCOPE_OWNED) {
    assert.ok(names.has(field), `new preserves "${field}", which is not a property this database has, so the guard guards nothing`)
  }
  for (const field of shared.NEW_ONLY_IF_EMPTY) {
    assert.ok(names.has(field), `new fills "${field}" when empty, which is not a property this database has`)
  }
})

check('the three memo types this plugin writes are types the Memos database has', () => {
  const types = Object.values(shared.MEMO_TYPES)
  assert.strictEqual(types.length, 3, 'the design names exactly three: Problem Statement, Project Update, Release')
  for (const type of types) {
    assert.ok(memosShared.TYPES.includes(type), `"${type}" is not a memo type the Memos database has`)
    assert.ok(memosShared.BODY_SECTIONS[type], `"${type}" has no template, so the memo-writing skills could not write one`)
  }
})

// --------------------------------------------------------------- the template

check('the scope document is the four sections the design defines, all required', () => {
  const design = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'projects', 'SCHEMA.md'), 'utf8')
  const stated = design.match(/\*\*Body sections, in order:\*\* ([^.]+)\./)
  assert.ok(stated, 'plugins/projects/SCHEMA.md no longer states the project body sections in the form this test reads')
  assert.deepStrictEqual(
    shared.PROJECT_SECTIONS.map(s => s.heading),
    // The document wraps lines, so a heading can carry a newline mid-phrase.
    stated[1].split(',').map(s => s.trim().replace(/\s+/g, ' ')),
    'the shared section list and the design document disagree'
  )
  assert.ok(shared.PROJECT_SECTIONS.every(s => !s.conditional), 'all four scope sections are required; a conditional one would make the scope document optional in parts')
})

check('the task template is three sections with Notes conditional and last', () => {
  assert.deepStrictEqual(shared.TASK_SECTIONS.map(s => s.heading), ['What Needs Doing', 'Done When', 'Notes'])
  assert.strictEqual(shared.TASK_SECTIONS[2].conditional, true)
  assert.ok(shared.TASK_SECTIONS.slice(0, 2).every(s => !s.conditional))
})

check('the task count band is the design\'s four to seven', () => {
  const design = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'projects', 'SKILLS.md'), 'utf8')
  assert.ok(/Four to seven tasks/.test(design), 'plugins/projects/SKILLS.md no longer states the band in the form this test reads')
  assert.deepStrictEqual(shared.TASK_COUNT, { min: 4, max: 7 })
})

console.log(failures ? `\n${failures} failed.\n` : '\nAll passed.\n')
process.exit(failures ? 1 : 0)

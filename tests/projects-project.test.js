'use strict'

/**
 * The project gate: the shapes it refuses and the payloads it builds.
 *
 * Everything here is pure: `project.js` sends nothing, so these tests hand it
 * rows and read what it says. The context is faked two ways, once with the
 * shipped names and once with everything renamed, because a payload that only
 * works when the workspace kept the shipped names is the silent failure this
 * repository keeps finding.
 *
 * Run: node tests/projects-project.test.js
 */

const assert = require('assert')
const project = require('../plugins/projects/scripts/project')
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
}

const PERSON = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

/** A context whose workspace kept the shipped names. */
const identity = {
  property: logical => logical,
  value: (property, logical) => logical,
  personId: PERSON,
  dataSourceId: 'projects-ds'
}

/** A context whose workspace renamed every property and every value. */
const renamed = {
  property: logical => `R ${logical}`,
  value: (property, logical) => `R ${logical}`,
  personId: PERSON,
  dataSourceId: 'projects-ds'
}

/** A context with no configured person, which is a working install. */
const nobody = {
  property: logical => logical,
  value: (property, logical) => logical,
  personId: null,
  dataSourceId: 'projects-ds'
}

const tasksContext = personId => ({
  property: logical => logical,
  value: (property, logical) => logical,
  personId,
  dataSourceId: 'tasks-ds'
})

const PS_PAGE = 'https://www.notion.so/PS-0123456789abcdef0123456789abcdef'
const RELEASE_PAGE = 'https://www.notion.so/Release-fedcba9876543210fedcba9876543210'

/** A scope row that passes every gate, to mutate one field at a time. */
const clean = overrides => Object.assign({
  Name: 'Wire the lead router',
  Description: 'Route inbound leads to an owner by segment.',
  'Level of Effort': 'Med',
  Priority: 'Prio 2',
  Domain: 'Pipeline & Demand Gen',
  problemStatement: PS_PAGE,
  'Business outcome': 'No lead waits on a human.',
  body: {
    'What We Are Building': 'A router for inbound leads. The smallest version that would prove this works: one segment routed live for a week.',
    'Out Of Scope': 'Enrichment, which already exists as an SOP. Outbound routing, later, once this is proven.',
    'Success Criteria': 'A new lead reaches the right owner within a minute, checkable from the timestamps.',
    'Risks And Dependencies': 'none known'
  }
}, overrides)

const kinds = found => found.map(p => p.kind)

console.log('\nthe project gate\n')

// ------------------------------------------------------------------- scoping

check('a clean scope row has no problems', () => {
  assert.deepStrictEqual(project.scopeProblems(clean()), [])
})

check('missing and malformed names are different refusals', () => {
  assert.ok(kinds(project.scopeProblems(clean({ Name: undefined }))).includes('missing'))
  assert.ok(kinds(project.scopeProblems(clean({ Name: '  ' }))).includes('missing'))
  assert.ok(kinds(project.scopeProblems(clean({ Name: { title: 'x' } }))).includes('not-text'))
})

check('scope may leave a row at Scoped or Canceled and nowhere else', () => {
  assert.deepStrictEqual(project.scopeProblems(clean({ Status: 'Scoped' })), [])
  for (const status of ['Intake', 'In progress', 'Done', 'Backlog']) {
    const found = project.scopeProblems(clean({ Status: status }))
    assert.ok(found.some(p => p.field === 'Status' && p.kind === 'not-writable'), `${status} was accepted`)
  }
})

check('a Canceled outcome does not demand effort, priority or an outcome line', () => {
  const canceled = clean({
    Status: 'Canceled',
    Priority: undefined,
    'Level of Effort': undefined,
    'Business outcome': undefined
  })
  assert.deepStrictEqual(project.scopeProblems(canceled), [])
})

check('a priority with no effort is refused on a Canceled outcome too', () => {
  // Devin round 1 flagged this line range as reachable on a Canceled row, and
  // the behaviour is intended rather than accidental, so it is pinned: the
  // design says priority is relative to effort in every outcome it describes.
  // A canceled row may carry both (worked out during scoping, then not built)
  // or neither, but never a priority hanging on nothing.
  const found = project.scopeProblems(clean({ Status: 'Canceled', 'Level of Effort': undefined }))
  assert.ok(kinds(found).includes('priority-before-effort'))
  assert.deepStrictEqual(project.scopeProblems(clean({ Status: 'Canceled' })), [],
    'a canceled row carrying both effort and priority is legal')
})

check('a scoped row without effort and priority is refused, and priority never comes first', () => {
  assert.ok(kinds(project.scopeProblems(clean({ 'Level of Effort': undefined, Priority: undefined }))).includes('missing'))
  const found = project.scopeProblems(clean({ 'Level of Effort': undefined }))
  assert.ok(kinds(found).includes('priority-before-effort'),
    'a priority with no effort behind it was set relative to nothing')
})

check('TBD at Scoped is a concern, not a refusal', () => {
  const row = clean({ Priority: 'TBD' })
  assert.deepStrictEqual(project.scopeProblems(row), [])
  assert.ok(project.scopeConcerns(row).some(c => c.kind === 'tbd-at-scoped'))
  assert.deepStrictEqual(project.scopeConcerns(clean()), [])
})

check('an invented select value is refused by name', () => {
  assert.ok(kinds(project.scopeProblems(clean({ Domain: 'Invented' }))).includes('unknown-value'))
  assert.ok(kinds(project.scopeProblems(clean({ Priority: 'P0' }))).includes('unknown-value'))
  assert.ok(kinds(project.scopeProblems(clean({ Segment: ['Enterprise', 'Invented'] }))).includes('unknown-value'))
  assert.ok(kinds(project.scopeProblems(clean({ Segment: 'Enterprise' }))).includes('not-a-list'))
})

check('Owner, Stakeholders and Timeline are refused at scope, because new owns them', () => {
  for (const field of ['Owner', 'Stakeholders', 'Timeline']) {
    const found = project.scopeProblems(clean({ [field]: field === 'Timeline' ? { start: '2026-09-01' } : 'me' }))
    assert.ok(found.some(p => p.field === field && p.kind === 'not-scopes-field'), `${field} was accepted`)
  }
})

check('a missing problem statement is refused, and so is an unidentifiable or plural one', () => {
  assert.ok(kinds(project.scopeProblems(clean({ problemStatement: undefined }))).includes('missing'))
  assert.ok(kinds(project.scopeProblems(clean({ problemStatement: 'the memo from Tuesday' }))).includes('unidentifiable-page'))
  assert.ok(kinds(project.scopeProblems(clean({ problemStatement: [PS_PAGE, RELEASE_PAGE] }))).includes('several-pages'))
})

check('a body that is not a section map is refused rather than read as empty', () => {
  assert.ok(kinds(project.scopeProblems(clean({ body: 'What We Are Building: a router' }))).includes('not-a-section-map'))
})

check('every one of the four sections is required', () => {
  for (const section of schema.PROJECT_SECTIONS.map(s => s.heading)) {
    const body = { ...clean().body }
    delete body[section]
    const found = project.scopeProblems(clean({ body }))
    assert.ok(found.some(p => p.field === section && p.kind === 'section-missing'), `${section} was allowed to be empty`)
  }
})

check('"nothing" is not an acceptable Out Of Scope, and a real one is', () => {
  for (const dismissal of ['Nothing', 'none', 'N/A', 'nothing really.']) {
    const found = project.scopeProblems(clean({ body: { ...clean().body, 'Out Of Scope': dismissal } }))
    assert.ok(kinds(found).includes('out-of-scope-dismissed'), `${JSON.stringify(dismissal)} was accepted`)
  }
  assert.deepStrictEqual(project.scopeProblems(clean()), [])
})

check('"none known" stays acceptable in Risks And Dependencies', () => {
  // The two sections deliberately differ: everything has an out of scope,
  // while "none known" in risks records that the question was asked.
  assert.deepStrictEqual(project.scopeProblems(clean()), [])
})

// ----------------------------------------------------------- scope properties

check('the payload carries the scope fields and no relation', () => {
  const out = project.scopeProperties(identity, clean())
  assert.strictEqual(out.Status, 'Scoped')
  assert.strictEqual(out.Priority, 'Prio 2')
  assert.strictEqual(out['Level of Effort'], 'Med')
  assert.strictEqual(out['Business outcome'], 'No lead waits on a human.')
  for (const name of ['Memos', 'Artifacts', 'Tasks', 'Calendar', 'problemStatement']) {
    assert.ok(!(name in out), `${name} is in the payload, and no relation write has been measured on this surface`)
  }
})

check('every property and value goes out under the workspace\'s own names', () => {
  const out = project.scopeProperties(renamed, clean())
  assert.strictEqual(out['R Status'], 'R Scoped')
  assert.strictEqual(out['R Priority'], 'R Prio 2')
  assert.strictEqual(out['R Name'], 'Wire the lead router')
  assert.ok(!('Status' in out), 'a shipped name leaked into a renamed payload')
})

check('the body keeps the template order and the headings derive from it', () => {
  const built = project.scopeBody(clean())
  assert.deepStrictEqual(built.map(s => s.heading), schema.PROJECT_SECTIONS.map(s => s.heading))
  assert.deepStrictEqual(project.scopeHeadings(clean()), built.map(s => s.heading))
})

check('a row with problems cannot be built into a payload', () => {
  assert.throws(() => project.scopeProperties(identity, clean({ problemStatement: undefined })), /cannot be written yet/)
})

// ------------------------------------------------------------------- advance

const scoped = values => ({ status: 'Scoped', values: Object.assign({ Domain: null, Segment: [], 'L2C Lifecycle': [] }, values) })

check('an advance from anywhere but Scoped is refused, naming who owns the state', () => {
  for (const status of ['Intake', 'In progress', 'Done', 'Canceled']) {
    const found = project.advanceProblems({}, { status, values: {} })
    assert.ok(found.some(p => p.kind === 'wrong-state'), `${status} was accepted`)
  }
  assert.deepStrictEqual(project.advanceProblems({}, scoped()), [])
})

check('the fields scope owns are preserved and refused by name', () => {
  for (const field of ['Priority', 'Level of Effort', 'Business outcome', 'Memos', 'Name', 'Description', 'Status', 'body']) {
    const found = project.advanceProblems({ [field]: 'x' }, scoped())
    assert.ok(found.some(p => p.field === field && p.kind === 'preserved'), `${field} was accepted`)
  }
})

check('Domain, Segment and L2C are set only where scope left them empty', () => {
  assert.deepStrictEqual(project.advanceProblems({ Domain: 'Deal Execution' }, scoped()), [])
  const taken = project.advanceProblems({ Domain: 'Deal Execution' }, scoped({ Domain: 'Sales Enablement' }))
  assert.ok(taken.some(p => p.field === 'Domain' && p.kind === 'already-set'))
  const segTaken = project.advanceProblems({ Segment: ['SMB'] }, scoped({ Segment: ['Enterprise'] }))
  assert.ok(segTaken.some(p => p.field === 'Segment' && p.kind === 'already-set'))
})

check('a timeline is a real range of real days', () => {
  assert.ok(kinds(project.advanceProblems({ Timeline: '2026-09-01' }, scoped())).includes('not-a-range'))
  assert.ok(kinds(project.advanceProblems({ Timeline: { end: '2026-09-01' } }, scoped())).includes('range-open'))
  assert.ok(kinds(project.advanceProblems({ Timeline: { start: '2026-02-30' } }, scoped())).includes('not-a-day'))
  assert.ok(kinds(project.advanceProblems({ Timeline: { start: '2026-09-05', end: '2026-09-01' } }, scoped())).includes('range-backwards'))
  assert.deepStrictEqual(project.advanceProblems({ Timeline: { start: '2026-09-01', end: '2026-09-05' } }, scoped()), [])
})

check('the advance payload moves the status and defaults the owner to whoever runs it', () => {
  const out = project.advanceProperties(identity, {}, scoped())
  assert.strictEqual(out.Status, 'In progress')
  assert.deepStrictEqual(out.Owner, [PERSON])
})

check('with no configured person and nobody named, Owner is omitted rather than written empty', () => {
  const out = project.advanceProperties(nobody, {}, scoped())
  assert.strictEqual(out.Status, 'In progress')
  assert.ok(!('Owner' in out))
})

check('a named owner and stakeholders resolve, and a bare name is refused', () => {
  const other = '11111111-2222-3333-4444-555555555555'
  const out = project.advanceProperties(identity, { Owner: other, Stakeholders: ['me', `user://${other}`] }, scoped())
  assert.deepStrictEqual(out.Owner, [other])
  assert.deepStrictEqual(out.Stakeholders, [PERSON, other])
  assert.throws(() => project.advanceProperties(identity, { Owner: 'Priya' }, scoped()), /not a Notion person id/)
})

check('the advance writes the timeline through its date columns, under the workspace\'s names', () => {
  const out = project.advanceProperties(renamed, { Timeline: { start: '2026-09-01', end: '2026-09-05' } }, scoped())
  assert.strictEqual(out['date:R Timeline:start'], '2026-09-01')
  assert.strictEqual(out['date:R Timeline:end'], '2026-09-05')
  assert.strictEqual(out['R Status'], 'R In progress')
})

// --------------------------------------------------------------------- tasks

const fourTasks = [
  { what: 'Wire the Clay webhook', due: '2026-09-01', who: 'me' },
  { what: 'Map the segment field' },
  { what: 'Review and confirm the routing table with RevOps' },
  { what: 'Verify a live lead routes end to end' }
]

check('a clean task list has no problems and no concerns', () => {
  assert.deepStrictEqual(project.taskProblems(fourTasks), [])
  assert.deepStrictEqual(project.taskConcerns(fourTasks), [])
})

check('a count outside four to seven is a concern, never a refusal', () => {
  const two = fourTasks.slice(0, 2)
  assert.deepStrictEqual(project.taskProblems(two), [])
  assert.ok(project.taskConcerns(two).some(c => c.kind === 'count-outside-band'))
  const eight = [...fourTasks, ...fourTasks].map((t, i) => ({ ...t, what: `${t.what} ${i}` }))
  assert.ok(project.taskConcerns(eight).some(c => c.kind === 'count-outside-band'))
})

check('a task with no name, a bad day, or a named person instead of an id is refused', () => {
  assert.ok(kinds(project.taskProblems([{ due: '2026-09-01' }])).includes('missing'))
  assert.ok(kinds(project.taskProblems([{ what: 'x', due: '2026-02-30' }])).includes('not-a-day'))
  assert.ok(kinds(project.taskProblems([{ what: 'x', who: 'Priya' }])).includes('not-a-person-id'))
  assert.ok(kinds(project.taskProblems('do the things')).includes('not-a-list'))
  assert.ok(kinds(project.taskProblems([])).includes('empty'))
})

check('the payloads carry order, status and the optional fields, and no project relation', () => {
  const out = project.taskPayloads(tasksContext(PERSON), fourTasks)
  assert.strictEqual(out.length, 4)
  assert.deepStrictEqual(out[0].parent, { data_source_id: 'tasks-ds' })
  assert.strictEqual(out[0].properties.Status, 'Not started')
  assert.strictEqual(out[0].properties.Order, 1)
  assert.strictEqual(out[3].properties.Order, 4)
  assert.deepStrictEqual(out[0].properties.Assignee, [PERSON])
  assert.strictEqual(out[0].properties['date:Due date:start'], '2026-09-01')
  assert.strictEqual(out[0].properties['date:Due date:end'], null)
  assert.ok(!('Assignee' in out[1].properties), 'an unassigned task is created unassigned, not guessed')
  for (const payload of out) {
    assert.ok(!('Project' in payload.properties), 'the Project relation is in a payload, and no relation write has been measured')
  }
})

check('a "me" assignee with no configured person is refused with the remedy', () => {
  assert.throws(() => project.taskPayloads(tasksContext(null), [{ what: 'x', who: 'me' }]), /records no person/)
})

// --------------------------------------------------------------------- close

check('a close from anywhere but In progress is refused', () => {
  for (const status of ['Intake', 'Scoped', 'Done', 'Canceled']) {
    const found = project.closeProblems({ status }, RELEASE_PAGE)
    assert.ok(found.some(p => p.kind === 'wrong-state'), `${status} was accepted`)
  }
  assert.deepStrictEqual(project.closeProblems({ status: 'In progress' }, RELEASE_PAGE), [])
})

check('a close without the release memo is refused, because the two are one action', () => {
  assert.ok(kinds(project.closeProblems({ status: 'In progress' }, undefined)).includes('missing'))
  assert.ok(kinds(project.closeProblems({ status: 'In progress' }, 'the release from Tuesday')).includes('unidentifiable-page'))
})

check('the close payload is the one earned status move, under the workspace\'s names', () => {
  assert.deepStrictEqual(project.closeProperties(identity, { status: 'In progress' }, RELEASE_PAGE), { Status: 'Done' })
  assert.deepStrictEqual(project.closeProperties(renamed, { status: 'In progress' }, RELEASE_PAGE), { 'R Status': 'R Done' })
})

check('an unrecognisable status is refused rather than reasoned about', () => {
  const found = project.closeProblems({ status: 'R In progress' }, RELEASE_PAGE)
  assert.ok(found.some(p => p.kind === 'wrong-state' && p.message.includes('not a status')),
    'a status the mapping failed to resolve was treated as a known state')
})

console.log(failures ? `\n${failures} failed.\n` : '\nAll passed.\n')
process.exit(failures ? 1 : 0)

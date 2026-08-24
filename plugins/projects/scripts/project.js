'use strict'

/**
 * Building and validating project rows and their tasks.
 *
 * Every rule Notion cannot enforce and every rule a model will drift on lives
 * here rather than in the skill prose, because prose is advice and this is a
 * gate. `SCHEMA-projects.md` defines the fields, the values and the template;
 * this file does not restate a value list, it reads them from the shipped
 * schema.
 *
 * PURE. It builds payloads and judges shapes. It sends nothing.
 *
 * THE RULE THIS FILE HOLDS HARDEST: a skill never advances a status it did
 * not earn, and no skill moves a project more than one step. `scope` may
 * leave a row at Scoped or Canceled, `advance` moves Scoped to In progress,
 * `close` moves In progress to Done, and every other transition is refused
 * with the name of whoever owns it. Cancelling work already in progress is a
 * person's move in Notion, deliberately unautomated.
 *
 * TWO KINDS OF FINDING, the same split as memos and process. `problems` are
 * refusals: a write carrying one is wrong and the payload builders throw
 * rather than sending it. `concerns` are questions for a person: a task
 * breakdown outside four-to-seven, or a TBD shipped from a scoping session,
 * are worth asking about and wrong to refuse.
 */

const path = require('path')

const schema = require(path.join(__dirname, 'vendor', 'projects-schema'))
// The memo builder carries the measured shapes this file would otherwise
// copy: the day round-trip, the person-id rules, the body-map check.
const memoWrite = require(path.join(__dirname, 'vendor', 'memo-write'))
const { pageIdentity } = require(path.join(__dirname, 'vendor', 'page-id'))
const {
  PROJECT_STATUSES, SCOPE_WRITABLE_STATUSES, ADVANCE, CLOSE, TASK_CREATE_STATUS,
  PRIORITIES, EFFORTS, MULTI_SELECT_FIELDS, PROJECT_SECTIONS, TASK_COUNT,
  SCOPE_OWNED, NEW_ONLY_IF_EMPTY, IDENTITY_VALUES,
  listProblem, listValues
} = schema

const { dayProblem, bodyIsMap, personIdFrom } = memoWrite

/**
 * The dismissals the Out Of Scope gate can see. Everything has an out of
 * scope, and a blank or a "nothing" there is the single best predictor that
 * the project will grow. A writer who has genuinely thought about it has
 * something to say; these are the spellings of not having thought.
 */
const OUT_OF_SCOPE_DISMISSALS = /^(nothing|none|n\/?a|nothing (yet|really|so far))[.!]?$/i

/**
 * One page reference, or a refusal naming what would have gone wrong.
 * Returns `{ target }`, null where nothing was asked, or `{ problem }`.
 */
function pageAsked (value, field, oneOf) {
  if (value === undefined || value === null || value === '' ||
      (Array.isArray(value) && value.length === 0)) return null
  const entries = Array.isArray(value) ? value : [value]
  if (entries.length > 1) {
    return {
      problem: {
        field,
        kind: 'several-pages',
        message: `${field} names ${entries.length} pages and it takes exactly one. ${oneOf}`
      }
    }
  }
  const target = pageIdentity(entries[0])
  if (!target) {
    return {
      problem: {
        field,
        kind: 'unidentifiable-page',
        message: `${field} holds ${JSON.stringify(entries[0])}, which is not a Notion page this can identify. Pass the page's url.`
      }
    }
  }
  return { target }
}

/** Missing-versus-malformed for a text field, the split every gate here uses. */
function textProblems (row, field, { required, requiredWhy } = {}) {
  const found = []
  const value = row[field]
  if (value !== undefined && value !== null && typeof value !== 'string') {
    found.push({
      field,
      kind: 'not-text',
      message: `${field} is ${JSON.stringify(value)}, which is not text. Written as it stands it reaches Notion as whatever \`String()\` makes of it, and nothing downstream would report that as wrong.`
    })
  } else if (required && (typeof value !== 'string' || !value.trim())) {
    found.push({ field, kind: 'missing', message: requiredWhy })
  }
  return found
}

/** The select and multi-select checks every project write shares. */
function valueProblems (row) {
  const found = []
  const add = (field, kind, message) => found.push({ field, kind, message })

  if (row.Domain !== undefined && row.Domain !== null && row.Domain !== '') {
    if (!IDENTITY_VALUES.Domain.includes(row.Domain)) {
      add('Domain', 'unknown-value', `"${row.Domain}" is not a Domain this database has. Notion refuses the whole write on an unknown select value, so the page would not be created at all.`)
    }
  }

  for (const field of MULTI_SELECT_FIELDS) {
    const value = row[field]
    const shape = listProblem(value)
    if (shape) {
      add(
        field,
        shape.kind,
        shape.kind === 'not-a-list'
          ? `${field} takes a list of values, and got ${JSON.stringify(shape.value)}. A bare string sent to a multi-select is a 400.`
          : `${field} holds ${JSON.stringify(shape.entry)}, which is not a value name.`
      )
      continue
    }
    for (const one of listValues(value)) {
      if (!IDENTITY_VALUES[field].includes(one)) {
        add(field, 'unknown-value', `"${one}" is not a ${field} this database has. The write fails as a whole, so nothing is saved.`)
      }
    }
  }

  return found
}

/**
 * Everything wrong with a scope row that makes it unwritable.
 *
 * The same gate serves `create` and `fill`: the fields are the fields either
 * way, and whether the row already exists is the command layer's to check
 * against the fetched page.
 */
function scopeProblems (final) {
  const found = []
  const add = (field, kind, message) => found.push({ field, kind, message })
  const row = final || {}

  found.push(...textProblems(row, 'Name', {
    required: true,
    requiredWhy: 'Every project needs a name. It is the title property and Notion will not create a page without one.'
  }))

  const status = row.Status === undefined || row.Status === null ? 'Scoped' : row.Status
  if (!SCOPE_WRITABLE_STATUSES.includes(status)) {
    add(
      'Status',
      'not-writable',
      `scope may leave a project at ${SCOPE_WRITABLE_STATUSES.join(' or ')}, and "${status}" is not it. ` +
      'Intake is where a hand-made row starts and a person sets it. In progress is earned by `new` creating the tasks. ' +
      'Done is earned by `ship` writing the release. A skill never advances a status it did not earn.'
    )
  }
  const scoped = status === 'Scoped'

  // THE PROPERTIES ARE SUMMARIES OF THE BODY, AND SCOPE WRITES BOTH. The
  // schema rule: where a property and a section overlap, the body is the
  // content and the property is a short summary derived from it, so a scope
  // write that leaves the summary off ships a table view nobody can read.
  found.push(...textProblems(row, 'Description', {
    required: true,
    requiredWhy: 'Description is the one-sentence summary of What We Are Building, derived from the body. A row without it is unreadable in every table view.'
  }))
  found.push(...textProblems(row, 'Business outcome', {
    required: scoped,
    requiredWhy: 'Business outcome is the one-sentence summary of Success Criteria, derived from the body. scope writes it; leaving it off ships a board nobody can read.'
  }))

  // EFFORT BEFORE PRIORITY, MECHANICALLY. Priority needs severity from the
  // problem statement and effort from the scope, so a priority with no effort
  // recorded was set relative to nothing.
  const effort = row['Level of Effort']
  const priority = row.Priority
  if (effort !== undefined && effort !== null && effort !== '' && !EFFORTS.includes(effort)) {
    add('Level of Effort', 'unknown-value', `"${effort}" is not a Level of Effort this database has. One of: ${EFFORTS.join(', ')}.`)
  }
  if (priority !== undefined && priority !== null && priority !== '' && !PRIORITIES.includes(priority)) {
    add('Priority', 'unknown-value', `"${priority}" is not a Priority this database has. One of: ${PRIORITIES.join(', ')}.`)
  }
  if (scoped) {
    if (effort === undefined || effort === null || effort === '') {
      add('Level of Effort', 'missing', 'A scoped project has an effort. scope sets Level of Effort, then Priority, in that order, because priority is relative to effort.')
    }
    if (priority === undefined || priority === null || priority === '') {
      add('Priority', 'missing', 'A scoped project has a priority, set after Level of Effort and after seeing what is already at each priority. A board where everything is unprioritised carries no information.')
    }
  }
  if (priority && PRIORITIES.includes(priority) && (effort === undefined || effort === null || effort === '')) {
    add('Priority', 'priority-before-effort', 'Priority is set and Level of Effort is not. Priority needs severity from the problem statement and effort from the scope, so setting it first is setting it relative to nothing.')
  }

  found.push(...valueProblems(row))

  // Owner, Stakeholders and Timeline are `new`'s, not scope's. Refused rather
  // than dropped, because a value somebody supplied that silently does not
  // arrive looks saved.
  for (const field of ['Owner', 'Stakeholders', 'Timeline']) {
    if (row[field] !== undefined && row[field] !== null && row[field] !== '') {
      add(field, 'not-scopes-field', `${field} is set by \`new\` when the work starts, not by scope. It is refused rather than dropped, so nobody believes it was saved.`)
    }
  }

  // A PROBLEM STATEMENT IS REQUIRED, AND THIS GATE IS WHERE THE RULE LIVES
  // EXACTLY. The Needs attention view is wider (projects with no memos at
  // all), because a view cannot filter through a relation; scope is the check
  // that holds the rule as written. A project that cannot name its problem
  // statement has not been scoped, and the stakes then live nowhere.
  const problem = pageAsked(
    row.problemStatement,
    'problemStatement',
    'A project has one problem statement, the memo of that Type attached through Memos.'
  )
  if (problem && problem.problem) {
    found.push(problem.problem)
  } else if (!problem) {
    add(
      'problemStatement',
      'missing',
      'No problem statement is named, and scope refuses to finish without one. Pass the url of the memo whose Type is ' +
      'Problem Statement. If none exists, write it first through `problem-statement`: scoping something whose stakes ' +
      'were never written down is how teams build the wrong thing carefully.'
    )
  }

  // ------------------------------------------------------------------- the body

  if (!bodyIsMap(row.body)) {
    add(
      'body',
      'not-a-section-map',
      `\`body\` is ${JSON.stringify(row.body)}, which is not a set of sections. It is read as heading to text, one key per heading, and anything else indexes to nothing for every heading, so the scope document would publish empty without a word. It is refused rather than read as an empty body.`
    )
  } else {
    const body = row.body || {}
    for (const section of PROJECT_SECTIONS) {
      const text = body[section.heading]
      const filled = typeof text === 'string' && text.trim()
      if (!filled) {
        add(
          section.heading,
          'section-missing',
          `The ${section.heading} section is empty. All four sections are required: this is the scope document, and a missing section is a question nobody asked.` +
          (section.heading === 'Risks And Dependencies' ? ' If there are genuinely none, write "none known" so it is clear the question was asked.' : '')
        )
        continue
      }
      if (section.heading === 'Out Of Scope' && OUT_OF_SCOPE_DISMISSALS.test(text.trim())) {
        add(
          'Out Of Scope',
          'out-of-scope-dismissed',
          `Out Of Scope says ${JSON.stringify(text.trim())}, and "nothing" is not an acceptable answer there. Everything has an out of scope, and a blank here is the single best predictor that the project will grow. What already exists, and what is deferred until the approach is proven, both belong in it.`
        )
      }
    }
  }

  return found
}

/** Questions for a person about a scope row. Not faults. */
function scopeConcerns (final) {
  const raised = []
  const row = final || {}
  const status = row.Status === undefined || row.Status === null ? 'Scoped' : row.Status
  if (status !== 'Scoped') return raised

  for (const field of ['Priority', 'Level of Effort']) {
    if (row[field] === 'TBD') {
      raised.push({
        kind: 'tbd-at-scoped',
        field,
        message: `${field} is TBD on a row leaving scope at Scoped. TBD is a legal value for a hand-made row, and shipping it from a scoping session means the session deferred the one decision it exists to make. Ask rather than write it.`
      })
    }
  }
  return raised
}

/**
 * The Notion property payload for a scope row, shared by create and fill.
 * Throws on any problem rather than sending a payload Notion will refuse as a
 * whole.
 *
 * NO RELATION IS WRITTEN, the standing marketplace rule: no plugin has
 * measured a relation write on this surface. The problem statement is checked
 * and named, and the command layer says the link is made by hand.
 */
function scopeProperties (context, final) {
  const found = scopeProblems(final)
  if (found.length) {
    throw new Error(`This project cannot be written yet:\n  ${found.map(p => p.message).join('\n  ')}`)
  }

  const out = {}
  const put = (logical, value) => { out[context.property(logical)] = value }

  put('Name', String(final.Name))
  put('Description', String(final.Description))
  put('Status', context.value('Status', final.Status === undefined || final.Status === null ? 'Scoped' : final.Status))
  if (final.Priority) put('Priority', context.value('Priority', final.Priority))
  if (final['Level of Effort']) put('Level of Effort', context.value('Level of Effort', final['Level of Effort']))
  if (final.Domain) put('Domain', context.value('Domain', final.Domain))
  for (const field of MULTI_SELECT_FIELDS) {
    const values = listValues(final[field])
    if (values.length) put(field, values.map(v => context.value(field, v)))
  }
  if (final['Business outcome']) put('Business outcome', String(final['Business outcome']))

  return out
}

/** The scope document, as headings and their text, in template order. */
function scopeBody (final) {
  const content = (final && final.body) || {}
  return PROJECT_SECTIONS.map(section => ({
    heading: section.heading,
    text: typeof content[section.heading] === 'string' ? content[section.heading].trim() : ''
  }))
}

/** The headings the proof expects, derived from the body so they agree. */
function scopeHeadings (final) {
  return scopeBody(final).map(section => section.heading)
}

/**
 * Why a project in this state cannot take this transition, said with the name
 * of whoever owns the move. Null when the transition is allowed.
 */
function transitionProblem (currentStatus, transition, verb) {
  if (currentStatus === transition.from) return null
  const explain = {
    Intake: 'It has not been scoped. `scope` fills the row in and leaves it at Scoped; run that first.',
    Scoped: '`new` is what moves a Scoped project to In progress, by creating its tasks.',
    'In progress': 'It is already in progress.',
    Done: 'It is already done. Reopening a project is a person\'s move in Notion.',
    Canceled: 'It was canceled. Reviving a canceled project is a person\'s move in Notion.'
  }
  const where = PROJECT_STATUSES.includes(currentStatus)
    ? explain[currentStatus]
    : `Its status reads ${JSON.stringify(currentStatus)}, which is not a status this database has, so what state it is in is not knowable from here.`
  return `This project cannot be ${verb}: it is at ${JSON.stringify(currentStatus)} and ${verb === 'started' ? '`new`' : '`ship`'} moves a project from ${transition.from} to ${transition.to} and nothing else. ${where} A skill never advances a status it did not earn, and no skill moves a project more than one step.`
}

/**
 * A person value resolved to ids: 'me' becomes the configured person, an id
 * is checked as one, and a name is refused. Null means nothing was asked.
 */
function peopleFor (value, personId, field) {
  if (value === undefined || value === null || value === '') return null
  const entries = Array.isArray(value) ? value : [value]
  const out = []
  for (const one of entries) {
    if (one === 'me') {
      if (!personId) {
        throw new Error(
          `${field} says "me" and the config records no person, so there is nobody to write. ` +
          'Search the workspace users for the person and pass their id.'
        )
      }
      out.push(personId)
      continue
    }
    out.push(personIdFrom(one))
  }
  return out
}

/**
 * Everything wrong with an advance (`new` moving Scoped to In progress).
 *
 * `existing` is the fetched row, already mapped to logical names and values
 * by the command layer: `{ status, values }` where `values` holds the current
 * Domain, Segment and L2C Lifecycle.
 */
function advanceProblems (changes, existing) {
  const found = []
  const add = (field, kind, message) => found.push({ field, kind, message })
  const row = changes || {}

  const wrong = transitionProblem(existing && existing.status, ADVANCE, 'started')
  if (wrong) add('Status', 'wrong-state', wrong)

  // THE FIELDS SCOPE OWNS ARE PRESERVED, NEVER WRITTEN. Overwriting them
  // silently discards a scoping conversation, so they are refused by name.
  for (const field of [...SCOPE_OWNED, 'Name', 'Description', 'Status', 'body']) {
    if (row[field] !== undefined) {
      add(
        field,
        'preserved',
        field === 'Status'
          ? 'Status is not passed: the advance IS the status move, Scoped to In progress, and nothing else is this skill\'s to write.'
          : `${field} is \`scope\`'s output and \`new\` preserves it. Overwriting it silently discards a scoping conversation; change it through a fresh scoping pass, not here.`
      )
    }
  }

  // Domain, Segment and L2C are set only if scope left them empty.
  for (const field of NEW_ONLY_IF_EMPTY) {
    if (row[field] === undefined || row[field] === null || row[field] === '') continue
    const current = existing && existing.values && existing.values[field]
    const empty = current === undefined || current === null || current === '' ||
      (Array.isArray(current) && current.length === 0)
    if (!empty) {
      add(field, 'already-set', `${field} already holds ${JSON.stringify(current)} on this row. \`new\` sets it only if scope left it empty; changing a set value is a person's edit or a fresh scoping pass.`)
    }
  }
  const domain = row.Domain
  if (domain !== undefined && domain !== null && domain !== '' && !IDENTITY_VALUES.Domain.includes(domain)) {
    add('Domain', 'unknown-value', `"${domain}" is not a Domain this database has.`)
  }
  for (const field of MULTI_SELECT_FIELDS) {
    const value = row[field]
    if (value === undefined || value === null || value === '') continue
    const shape = listProblem(value)
    if (shape) {
      add(field, shape.kind, `${field} takes a list of value names, and got ${JSON.stringify(shape.value !== undefined ? shape.value : shape.entry)}.`)
      continue
    }
    for (const one of listValues(value)) {
      if (!IDENTITY_VALUES[field].includes(one)) add(field, 'unknown-value', `"${one}" is not a ${field} this database has.`)
    }
  }

  const timeline = row.Timeline
  if (timeline !== undefined && timeline !== null && timeline !== '') {
    if (typeof timeline !== 'object' || Array.isArray(timeline)) {
      add('Timeline', 'not-a-range', 'Timeline is a date range: pass { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" }, the start and the target end.')
    } else {
      if (!timeline.start) {
        add('Timeline', 'range-open', 'Timeline has no start. A timeline without one is a target end floating on nothing.')
      } else {
        const wrongStart = dayProblem(timeline.start, 'Timeline start')
        if (wrongStart) add('Timeline', 'not-a-day', wrongStart)
      }
      if (timeline.end !== undefined && timeline.end !== null && timeline.end !== '') {
        const wrongEnd = dayProblem(timeline.end, 'Timeline end')
        if (wrongEnd) add('Timeline', 'not-a-day', wrongEnd)
        if (timeline.start && !dayProblem(timeline.start, 'x') && !wrongEnd &&
            String(timeline.start) > String(timeline.end)) {
          add('Timeline', 'range-backwards', `Timeline runs from ${timeline.start} to ${timeline.end}, which is backwards.`)
        }
      }
    }
  }

  return found
}

/**
 * The update payload for an advance. Owner defaults to the configured person,
 * which is "whoever runs it"; where config records nobody and nobody was
 * named, Owner is omitted rather than written empty, the nullable-person
 * rule.
 */
function advanceProperties (context, changes, existing) {
  const found = advanceProblems(changes, existing)
  if (found.length) {
    throw new Error(`This project cannot be started yet:\n  ${found.map(p => p.message).join('\n  ')}`)
  }
  const row = changes || {}
  const out = {}
  const put = (logical, value) => { out[context.property(logical)] = value }

  put('Status', context.value('Status', ADVANCE.to))

  const owner = peopleFor(row.Owner === undefined ? (context.personId ? 'me' : null) : row.Owner, context.personId, 'Owner')
  if (owner && owner.length) put('Owner', owner)
  const stakeholders = peopleFor(row.Stakeholders, context.personId, 'Stakeholders')
  if (stakeholders && stakeholders.length) put('Stakeholders', stakeholders)

  if (row.Timeline && row.Timeline.start) {
    const name = context.property('Timeline')
    out[`date:${name}:start`] = row.Timeline.start
    out[`date:${name}:end`] = row.Timeline.end || null
  }

  if (row.Domain) put('Domain', context.value('Domain', row.Domain))
  for (const field of MULTI_SELECT_FIELDS) {
    const values = listValues(row[field])
    if (values.length) put(field, values.map(v => context.value(field, v)))
  }

  return out
}

/**
 * Everything wrong with a task list that makes it unwritable, and the
 * concerns worth raising about it.
 *
 * The judgment rules — verb first, one task per integration, the last task is
 * live verification, unverified facts become "review and confirm" — are the
 * skill's to hold in conversation. What is enforceable here is shape: a task
 * has a name, a due date is a real day, a person is an id.
 */
function taskProblems (tasks) {
  const found = []
  const add = (index, field, kind, message) => found.push({ index, field, kind, message })

  if (!Array.isArray(tasks)) {
    return [{ index: null, field: 'tasks', kind: 'not-a-list', message: `The tasks are ${JSON.stringify(tasks)}, and this reads a list, one entry per task.` }]
  }
  if (!tasks.length) {
    return [{ index: null, field: 'tasks', kind: 'empty', message: 'The task list is empty. Nothing to build, and building nothing is not worth reporting as done.' }]
  }

  tasks.forEach((task, index) => {
    if (!task || typeof task !== 'object' || Array.isArray(task)) {
      add(index, 'task', 'not-a-record', `tasks[${index}] is ${JSON.stringify(task)}, and a task is a set of fields: what, and optionally description, who, due.`)
      return
    }
    if (typeof task.what !== 'string' || !task.what.trim()) {
      add(index, 'what', 'missing', `tasks[${index}] has no \`what\`. A task with no name is not a task.`)
    }
    if (task.description !== undefined && task.description !== null && typeof task.description !== 'string') {
      add(index, 'description', 'not-text', `tasks[${index}].description is ${JSON.stringify(task.description)}, which is not text.`)
    }
    if (task.due !== undefined && task.due !== null && task.due !== '') {
      const wrong = dayProblem(task.due, `tasks[${index}].due`)
      if (wrong) add(index, 'due', 'not-a-day', wrong)
    }
    if (task.who !== undefined && task.who !== null && task.who !== '' && task.who !== 'me') {
      try {
        personIdFrom(task.who)
      } catch (err) {
        add(index, 'who', 'not-a-person-id', `tasks[${index}]: ${err.message}`)
      }
    }
  })

  return found
}

function taskConcerns (tasks) {
  if (!Array.isArray(tasks)) return []
  const raised = []
  if (tasks.length < TASK_COUNT.min || tasks.length > TASK_COUNT.max) {
    raised.push({
      kind: 'count-outside-band',
      count: tasks.length,
      message:
        `${tasks.length} tasks, against the design's ${TASK_COUNT.min} to ${TASK_COUNT.max}, five typical. ` +
        (tasks.length < TASK_COUNT.min
          ? 'Fewer usually means steps are hiding inside one another; ask whether each could be picked up by a person who would know when they are done.'
          : 'More usually means the project is doing two jobs, and one project does one job. Ask before writing.')
    })
  }
  return raised
}

/**
 * One Tasks payload per task, in order, with `Order` carrying that order as a
 * plain number. Throws on any problem.
 *
 * THE PROJECT RELATION IS NOT WRITTEN, the standing rule, so every task is an
 * orphan the Tasks "Needs attention" view surfaces until a person links it.
 * The command layer says so in its output.
 *
 * NO BODY IS WRITTEN. Requirements live in the task body, written when the
 * task is picked up, by a person. A PRD written at creation time is a
 * document about work nobody has started.
 */
function taskPayloads (tasksContext, tasks) {
  const found = taskProblems(tasks)
  if (found.length) {
    throw new Error(`These tasks cannot be written yet:\n  ${found.map(p => p.message).join('\n  ')}`)
  }

  return tasks.map((task, index) => {
    const properties = {
      [tasksContext.property('Task name')]: String(task.what).trim(),
      [tasksContext.property('Status')]: tasksContext.value('Status', TASK_CREATE_STATUS),
      [tasksContext.property('Order')]: index + 1
    }
    if (task.description) properties[tasksContext.property('Description')] = String(task.description)
    if (task.due) {
      const name = tasksContext.property('Due date')
      properties[`date:${name}:start`] = String(task.due)
      properties[`date:${name}:end`] = null
    }
    const who = peopleFor(task.who, tasksContext.personId, `tasks[${index}].who`)
    if (who && who.length) properties[tasksContext.property('Assignee')] = who

    return { parent: { data_source_id: tasksContext.dataSourceId }, properties }
  })
}

/**
 * Everything wrong with a close (`ship` moving In progress to Done).
 *
 * THE RELEASE COMES FIRST AND THE CLOSE DEMANDS EVIDENCE OF IT. Marking a
 * project Done and writing the release are one action, because a project that
 * closes with no record of what shipped leaves the library with a gap exactly
 * where someone will look. The release memo's url is that evidence, checked
 * as a page rather than taken as a claim.
 */
function closeProblems (existing, releaseUrl) {
  const found = []
  const wrong = transitionProblem(existing && existing.status, CLOSE, 'closed')
  if (wrong) found.push({ field: 'Status', kind: 'wrong-state', message: wrong })

  const release = pageAsked(releaseUrl, 'the release memo', 'A project ships once; its release is one memo.')
  if (!release) {
    found.push({
      field: 'release',
      kind: 'missing',
      message: 'No release memo is named, and a project is not marked Done without one: the two are one action. Write the Release through this plugin first and pass its url.'
    })
  } else if (release.problem) {
    found.push(release.problem)
  }
  return found
}

function closeProperties (context, existing, releaseUrl) {
  const found = closeProblems(existing, releaseUrl)
  if (found.length) {
    throw new Error(`This project cannot be closed yet:\n  ${found.map(p => p.message).join('\n  ')}`)
  }
  return { [context.property('Status')]: context.value('Status', CLOSE.to) }
}

/**
 * Which Notion type each written Projects column holds, keyed by the column
 * name the payload actually uses, so a proof compares through the right
 * reader.
 */
function propertyTypes (context) {
  const types = {}
  const simple = {
    Name: 'title',
    Description: 'rich_text',
    Status: 'select',
    Priority: 'select',
    'Level of Effort': 'select',
    Owner: 'people',
    Stakeholders: 'people',
    Domain: 'select',
    Segment: 'multi_select',
    'L2C Lifecycle': 'multi_select',
    'Business outcome': 'rich_text'
  }
  for (const [logical, type] of Object.entries(simple)) types[context.property(logical)] = type
  const timeline = context.property('Timeline')
  types[`date:${timeline}:start`] = 'date'
  types[`date:${timeline}:end`] = 'date'
  return types
}

/** The same map for written Tasks columns. `Order` is a number, and how a
 * number reads back is unmeasured, so the proof reports it unchecked rather
 * than guessing. */
function taskPropertyTypes (tasksContext) {
  const types = {
    [tasksContext.property('Task name')]: 'title',
    [tasksContext.property('Description')]: 'rich_text',
    [tasksContext.property('Status')]: 'select',
    [tasksContext.property('Assignee')]: 'people'
  }
  const due = tasksContext.property('Due date')
  types[`date:${due}:start`] = 'date'
  types[`date:${due}:end`] = 'date'
  return types
}

module.exports = {
  OUT_OF_SCOPE_DISMISSALS,
  pageAsked,
  peopleFor,
  transitionProblem,
  scopeProblems,
  scopeConcerns,
  scopeProperties,
  scopeBody,
  scopeHeadings,
  advanceProblems,
  advanceProperties,
  taskProblems,
  taskConcerns,
  taskPayloads,
  closeProblems,
  closeProperties,
  propertyTypes,
  taskPropertyTypes
}

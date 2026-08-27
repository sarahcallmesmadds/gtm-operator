'use strict'

/**
 * The command layer. This file decides what to send; the skill sends it.
 *
 * The Notion calls go through the connected client, which a script cannot
 * reach, so every query is built here, every answer is judged here, and the
 * model makes the calls in between. The same shape as `setup`, `calendar`,
 * `process` and `memos`, so there is one convention in this marketplace
 * rather than five.
 *
 * WHY NOT LET THE SKILL COMPOSE THE QUERIES. A workspace renames properties
 * and option values. A query carrying the names this plugin shipped with asks
 * about names nobody uses and comes back with no rows, and no rows is exactly
 * what a board with nothing on it looks like. Every query below resolves its
 * names through the config map for that reason.
 *
 * `<ds>` markers are left for the caller to replace with the quoted data
 * source url, the convention the other plugins use.
 *
 *   node projects.js context                                what config says, or why it refuses
 *   node projects.js survey                                 the three reads scope starts from
 *   node projects.js board <projects.json>                  what is already at each priority
 *   node projects.js check <proposed.json>                  what is wrong with this scope row
 *   node projects.js create <project.json>                  the creation payload and the body
 *   node projects.js fill <project.json> <existing.json>    the update payload for a hand-made Intake row
 *   node projects.js prove <project.json> <readback.json> <created-url>
 *   node projects.js start <changes.json> <existing.json>   new: Scoped to In progress, and the fields new owns
 *   node projects.js tasks <tasks.json>                     one Tasks payload per task, in order
 *   node projects.js prove-task <task.json> <readback.json> <created-url>
 *   node projects.js open-tasks                             the whole-table read ship checks before closing
 *   node projects.js unfinished <tasks.json> <project-url>  the open tasks of one project
 *   node projects.js close <existing.json> <release-url>    ship: In progress to Done, after the release
 *   node projects.js prove-update <output.json> <readback.json>   did fill, start or close land
 *   node projects.js memo-check <proposed.json>             gate one of this plugin's three memo types
 *   node projects.js memo-create <memo.json>                the Memos payload and body
 *   node projects.js memo-prove <memo.json> <readback.json> <created-url>
 *
 * WHAT NO COMMAND HERE DOES: create a database, write config, edit a
 * published memo, move a task's status, or cancel work already in progress.
 * The last two are people's moves in Notion, recorded as decisions in
 * `plugins/projects/SKILLS.md` rather than gaps.
 */

const fs = require('fs')
const path = require('path')

const config = require(path.join(__dirname, 'vendor', 'config-read'))
const schema = require(path.join(__dirname, 'vendor', 'projects-schema'))
const memosSchema = require(path.join(__dirname, 'vendor', 'memos-schema'))
const memoWrite = require(path.join(__dirname, 'vendor', 'memo-write'))
const project = require(path.join(__dirname, 'project'))
const { proveCreate } = require(path.join(__dirname, 'vendor', 'prove-create'))
const { listOfNames } = require(path.join(__dirname, 'vendor', 'notion-compare'))
const { pageIdentity } = require(path.join(__dirname, 'vendor', 'page-id'))

const KEY = 'projects'
const TASKS_KEY = 'tasks'
const MEMOS_KEY = 'memos'

/** `"` inside an identifier is doubled, which is how SQL escapes it. */
const identifier = name => `"${String(name).split('"').join('""')}"`
/** `'` inside a literal is doubled, the same way. */
const literal = value => `'${String(value).split("'").join("''")}'`

function contextOrExit (key, identity) {
  const context = config.contextFor(key, identity)
  if (!context.ok) {
    console.error(context.message)
    process.exit(1)
  }
  return context
}

const projectsContext = () => contextOrExit(KEY, schema.IDENTITY)
const tasksContext = () => contextOrExit(TASKS_KEY, schema.TASKS_IDENTITY)
const memosContext = () => contextOrExit(MEMOS_KEY, memosSchema.IDENTITY)

/**
 * A file read, parsed, and checked for being the shape the caller reads it
 * as. Valid JSON of the wrong shape is the failure the `process` plugin has
 * been corrected for five times: a list where a set of fields was expected
 * has none of those fields, so every one reads as absent, and the run reports
 * there was nothing to do. Refused at the door rather than in each command.
 */
function readJson (file, what, expected) {
  let raw
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch (err) {
    throw new Error(`Could not read ${what} at ${file}: ${err.message}`)
  }

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(`${file} is not valid JSON, so ${what} could not be read: ${err.message}`)
  }

  if (expected === undefined) return parsed

  const isList = Array.isArray(parsed)
  const isFields = parsed !== null && typeof parsed === 'object' && !isList

  if (expected === 'list' && !isList) {
    throw new Error(
      `${file} holds ${describeShape(parsed)}, and ${what} is read as a list. ` +
      'Every entry would be missed and the run would report there was nothing to do.'
    )
  }

  if (expected === 'fields' && !isFields) {
    throw new Error(
      `${file} holds ${describeShape(parsed)}, and ${what} is read as a set of fields, one key per field. ` +
      'Read that way it has no fields at all, so every one would look absent and the run would report there was ' +
      'nothing to do rather than that it could not read this.'
    )
  }

  return parsed
}

/** What a value is, in words a person can act on rather than a type name. */
function describeShape (value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'a list'
  if (typeof value === 'object') return 'a set of fields'
  if (typeof value === 'string') return 'a piece of text'
  return `a ${typeof value}`
}

/**
 * The list of rows inside whatever the query returned.
 *
 * A MISSING RESULT IS NOT AN EMPTY ONE: null is a query that was never sent,
 * and it is refused rather than read as a board with nothing on it. `results`
 * is the envelope measured on 2026-08-19 for this SQL surface; `rows` and
 * `data` are accepted and have never been seen here.
 */
function rowList (rows) {
  if (rows === null || rows === undefined) {
    throw new Error(
      'There are no rows to read. That is a query that was not sent or a result saved as null, ' +
      'which is a different thing from a board with nothing on it, and it is not being reported as one.'
    )
  }
  if (Array.isArray(rows)) return rows
  for (const envelope of ['results', 'rows', 'data']) {
    if (Array.isArray(rows[envelope])) return rows[envelope]
  }
  throw new Error(
    `The rows are in a shape this does not recognise: ${Object.keys(rows).join(', ') || typeof rows}. ` +
    'Expected an array, or an object with results, rows or data. Refusing rather than guessing, ' +
    'because a guess that returns nothing reads exactly like an empty board.'
  )
}

/**
 * The workspace's option names mapped back to the logical ones. Same shape as
 * the other command layers, because it is the same problem: the map is used
 * on the way out and has to be used on the way back, or a renamed workspace's
 * rows compare against values that are not theirs.
 */
function reverseValues (values) {
  const reverse = {}
  for (const [property, options] of Object.entries(values || {})) {
    reverse[property] = {}
    for (const [logical, workspace] of Object.entries(options || {})) {
      reverse[property][workspace] = logical
    }
  }
  return reverse
}

function toLogical (reverse, property, value) {
  const options = reverse[property]
  if (!options) return value
  if (typeof value === 'string' && value in options) return options[value]
  return value
}

/**
 * A fetched project page, read into the shape the gate judges: its identity,
 * its logical status, and the current values of the fields `new` may only
 * fill when empty.
 *
 * The page is `{ url, properties }` as it came back from a fetch. Multi-select
 * and relation values come back as JSON arrays inside strings, and
 * `listOfNames` is the one reader of that shape.
 */
function existingRow (context, page, what) {
  if (!page || typeof page !== 'object' || Array.isArray(page)) {
    throw new Error(`${what} is ${describeShape(page)}, and this reads the fetched page: { url, properties }.`)
  }
  const identity = pageIdentity(page.url || (page.page && page.page.url))
  if (!identity) {
    throw new Error(`${what} carries no usable url, so nothing can say which page an update would go to. Save the whole page, keeping its url.`)
  }
  if (!page.properties || typeof page.properties !== 'object' || Array.isArray(page.properties)) {
    throw new Error(`${what} has no properties to read, so the row's status cannot be known from it. Save the whole page, not a summary of it.`)
  }
  const back = reverseValues((context.names && context.names.values) || {})
  const raw = page.properties[context.property('Status')]
  const status = toLogical(back, 'Status', raw === undefined || raw === null ? null : raw)

  const values = {}
  const domain = page.properties[context.property('Domain')]
  values.Domain = domain === undefined || domain === null || domain === '' ? null : toLogical(back, 'Domain', domain)
  for (const field of ['Segment', 'L2C Lifecycle']) {
    values[field] = listOfNames(page.properties[context.property(field)])
  }
  return { identity, url: page.url, status, values }
}

/**
 * Everything a command needs to READ another plugin's database, straight from
 * the recorded map rather than through `contextFor`.
 *
 * WHY NOT `contextFor`: it validates the map against a full identity, both
 * ways, and this plugin does not carry the Process schema and should not. Any
 * identity it offered would be a subset, and every property it never looks at
 * would be reported as a fault in the user's config. The cost, said plainly:
 * the one-to-one check does not run here; `setup`'s `check` owns validating
 * those maps as a whole. Every name this plugin actually reads is required
 * rather than defaulted.
 */
function foreignContextOrExit (key, { properties = [], why }) {
  const raw = config.readRaw()
  if (!raw.ok) {
    console.error(raw.message)
    process.exit(1)
  }
  const entry = (raw.config && raw.config.databases && raw.config.databases[key]) || null
  if (!entry) {
    console.error(
      `The config records no "${key}" database, and ${why} ` +
      'Run the `setup` plugin\'s `add` skill for it. Nothing here creates a database.'
    )
    process.exit(1)
  }
  if (!entry.databaseId || !entry.dataSourceId) {
    console.error(
      `"${key}" is recorded with only ${entry.databaseId ? 'a database id' : 'a data source id'}. ` +
      'Both are needed. Run the `setup` plugin\'s `check` skill.'
    )
    process.exit(1)
  }
  const recorded = entry.properties || {}
  const missing = properties.filter(name => !recorded[name])
  if (missing.length) {
    console.error(
      `The ${key} map records no name for ${missing.map(m => `"${m}"`).join(' or ')}, and ${why} ` +
      'It is refusing rather than falling back to the names this plugin shipped with: on a renamed workspace ' +
      'that queries properties which do not exist, returns nothing, and reads as a workspace with nothing in it. ' +
      'Run the `setup` plugin\'s `check` skill, which records them.'
    )
    process.exit(1)
  }
  return {
    key,
    dataSourceId: entry.dataSourceId,
    property: name => recorded[name],
    reverse: reverseValues(entry.values || {})
  }
}

/** The columns the survey and board read from Projects, in one place. */
const PROJECT_COLUMNS = ['Name', 'Status', 'Priority', 'Level of Effort', 'Domain', 'Description']

function projectColumnMap (context) {
  const map = { url: 'url' }
  for (const logical of PROJECT_COLUMNS) map[logical] = context.property(logical)
  return map
}

function projectSelectList (context) {
  return ['p.url'].concat(PROJECT_COLUMNS.map(l => `p.${identifier(context.property(l))}`)).join(', ')
}

/** Fetched project rows keyed by logical name, carrying logical values. */
function normaliseProjectRows (context, rows) {
  const map = projectColumnMap(context)
  const back = reverseValues((context.names && context.names.values) || {})
  return rowList(rows).map(raw => {
    if (!raw || typeof raw !== 'object') {
      throw new Error(`A row came back as ${JSON.stringify(raw)} rather than as an object. Save what the query returned.`)
    }
    const out = { url: raw[map.url] !== undefined ? raw[map.url] : raw.url }
    for (const logical of PROJECT_COLUMNS) {
      const value = raw[map[logical]]
      out[logical] = ['Status', 'Priority', 'Level of Effort', 'Domain'].includes(logical)
        ? toLogical(back, logical, value === undefined ? null : value)
        : (value === undefined ? null : value)
    }
    return out
  })
}

// --------------------------------------------------------------------- commands

const commands = {
  context () {
    const context = projectsContext()
    const tasks = tasksContext()
    console.log(JSON.stringify({
      projects: { databaseId: context.databaseId, dataSourceId: context.dataSourceId, displayName: context.displayName },
      tasks: { databaseId: tasks.databaseId, dataSourceId: tasks.dataSourceId, displayName: tasks.displayName },
      personId: context.personId,
      personIdNote: context.personId
        ? null
        : 'No person is recorded, so Owner, Stakeholders and Assignee are omitted rather than written empty. That is a working install, not a failed one.',
      names: { projects: context.names, tasks: tasks.names }
    }, null, 2))
  },

  /**
   * The three reads scope starts from: what projects exist, what the Process
   * library already covers, and which problem statements are on the record.
   *
   * WHOLE TABLES, DELIBERATELY. What already exists is the single largest
   * source of trimming, and text matching is not in the SQL: which existing
   * thing overlaps the new scope is the skill's judgment, made over all the
   * rows rather than over whatever a keyword happened to hit.
   */
  survey () {
    const context = projectsContext()
    const memos = memosContext()
    const processLibrary = foreignContextOrExit('process', {
      properties: ['Name', 'Type', 'Status', 'Domain'],
      why: 'scope checks what already exists before scoping, and Process is always there.'
    })

    const publishedColumn = `date:${memos.property('Published date')}:start`

    console.log(JSON.stringify({
      projects: {
        columns: projectColumnMap(context),
        sql: `SELECT ${projectSelectList(context)}\nFROM <projects-ds> AS p`,
        what: 'Every project. Overlaps become Out Of Scope lines reading "already exists", and `board` shows what sits at each priority.'
      },
      process: {
        columns: {
          url: 'url',
          Name: processLibrary.property('Name'),
          Type: processLibrary.property('Type'),
          Status: processLibrary.property('Status'),
          Domain: processLibrary.property('Domain')
        },
        sql:
          `SELECT a.url, a.${identifier(processLibrary.property('Name'))}, a.${identifier(processLibrary.property('Type'))}, ` +
          `a.${identifier(processLibrary.property('Status'))}, a.${identifier(processLibrary.property('Domain'))}\n` +
          'FROM <process-ds> AS a',
        what: 'Every artifact. An SOP or decision that already covers part of the new scope is the classic thing a competent scoper over-scopes past.'
      },
      problemStatements: {
        columns: {
          url: 'url',
          Name: memos.property('Name'),
          Description: memos.property('Description'),
          Status: memos.property('Status'),
          Projects: memos.property('Projects'),
          'Published date': publishedColumn
        },
        sql:
          `SELECT m.url, m.${identifier(memos.property('Name'))}, m.${identifier(memos.property('Description'))}, ` +
          `m.${identifier(memos.property('Status'))}, m.${identifier(memos.property('Projects'))}, m.${identifier(publishedColumn)}\n` +
          'FROM <memos-ds> AS m\n' +
          `WHERE m.${identifier(memos.property('Type'))} = ${literal(memos.value('Type', 'Problem Statement'))}`,
        what:
          'Every problem statement, whatever its status, with the projects already attached to each. scope needs the one ' +
          'this project answers; a Draft was never published and a Canceled one was retracted, so say the status when offering them.'
      },
      note:
        'Replace each <...-ds> with that database\'s quoted data source url. Run all three and save each result whole. ' +
        'Pass the projects result to `board` before Priority is set.'
    }, null, 2))
  },

  /**
   * What is already at each priority, so a new priority is set relative to
   * something. A priority set without seeing the others is not relative to
   * anything, and a board where everything is Prio 1 carries no information.
   */
  board (file) {
    if (!file) throw new Error('Usage: node projects.js board <projects.json>')
    const context = projectsContext()
    const rows = normaliseProjectRows(context, readJson(file, 'the project rows'))

    const byPriority = {}
    for (const priority of schema.PRIORITIES) byPriority[priority] = []
    byPriority.unset = []
    let done = 0
    let canceled = 0
    for (const row of rows) {
      if (row.Status === 'Done') { done++; continue }
      if (row.Status === 'Canceled') { canceled++; continue }
      const bucket = schema.PRIORITIES.includes(row.Priority) ? row.Priority : 'unset'
      byPriority[bucket].push({ url: row.url, name: row.Name, status: row.Status, effort: row['Level of Effort'] })
    }

    console.log(JSON.stringify({
      board: byPriority,
      leftOut: {
        done,
        canceled,
        note: 'Done and Canceled projects are off the board: a priority is relative to what is still competing for time. Counted rather than silent.'
      },
      note: 'Show this before writing Priority. A priority set without seeing the others is not relative to anything.'
    }, null, 2))
  },

  check (file) {
    if (!file) throw new Error('Usage: node projects.js check <proposed.json>')
    const proposed = readJson(file, 'the proposed project', 'fields')

    const problems = project.scopeProblems(proposed)
    const concerns = project.scopeConcerns(proposed)

    console.log(JSON.stringify({
      writable: problems.length === 0,
      problems,
      concerns,
      note: problems.length
        ? 'Every problem here is a refusal. Notion rejects a bad select value as a whole, so a drafted scope is lost at write time rather than partly saved.'
        : 'Nothing blocks this write. Anything under concerns is a question for the user, not a fault.'
    }, null, 2))

    if (problems.length) process.exitCode = 1
  },

  create (file) {
    if (!file) throw new Error('Usage: node projects.js create <project.json>')
    const final = readJson(file, 'the project', 'fields')
    const context = projectsContext()

    const properties = project.scopeProperties(context, final)
    const problem = project.pageAsked(final.problemStatement, 'problemStatement', '')

    console.log(JSON.stringify({
      parent: { data_source_id: context.dataSourceId },
      properties,
      body: project.scopeBody(final),
      headings: project.scopeHeadings(final),
      problemStatement: problem && problem.target ? problem.target : null,
      problemStatementNote:
        'THE PROBLEM STATEMENT WAS CHECKED AND THE RELATION IS NOT BEING WRITTEN. No plugin in this marketplace has ' +
        'measured a relation write on this surface, so the project and its problem statement will not point at each ' +
        'other until a person links them through Memos in Notion. Say so when reporting, name both pages, and ask for ' +
        'the link: until it is made, this project sits in the Needs attention view, which is that view doing its job.',
      note:
        'Create the page, then read it back and run `prove` with the url the create returned. A create call that ' +
        'returned without an error proves nothing.'
    }, null, 2))
  },

  /**
   * The scope payload as an update, for the one existing row scope may fill:
   * a hand-made row at Intake. Filling anything else is overwriting somebody's
   * project, and it is refused by state rather than warned about.
   */
  fill (file, existingFile) {
    if (!file || !existingFile) throw new Error('Usage: node projects.js fill <project.json> <existing.json>')
    const final = readJson(file, 'the project', 'fields')
    const context = projectsContext()
    const existing = existingRow(context, readJson(existingFile, 'the existing row', 'fields'), 'the existing row')

    if (existing.status !== 'Intake') {
      throw new Error(
        `The existing row is at ${JSON.stringify(existing.status)}, and scope fills a row only at Intake, the state a ` +
        'hand-made row starts in. A row anywhere else is a project somebody has already worked on, and overwriting it ' +
        'discards that work. If this project genuinely needs rescoping, that is a conversation with the person, not a fill.'
      )
    }

    const properties = project.scopeProperties(context, final)
    const problem = project.pageAsked(final.problemStatement, 'problemStatement', '')

    console.log(JSON.stringify({
      target: existing.identity,
      targetUrl: existing.url,
      properties,
      body: project.scopeBody(final),
      headings: project.scopeHeadings(final),
      problemStatement: problem && problem.target ? problem.target : null,
      problemStatementNote:
        'THE RELATION IS NOT BEING WRITTEN; a person links the problem statement through Memos in Notion. Say so and name both pages.',
      note:
        'Send these properties as an update to the page named by `target`, and write the body sections onto it. Then ' +
        're-fetch the page, keeping its url, and pass THIS OUTPUT and the re-fetched page to `prove-update`.'
    }, null, 2))
  },

  prove (projectFile, readbackFile, createdUrl) {
    if (!projectFile || !readbackFile) {
      throw new Error('Usage: node projects.js prove <project.json> <readback.json> <created-url>')
    }
    const final = readJson(projectFile, 'the project', 'fields')
    const readback = readJson(readbackFile, 'the page as it came back', 'fields')
    const context = projectsContext()

    const result = proveCreate({
      what: 'project',
      createdUrl,
      readback,
      intended: project.scopeProperties(context, final),
      headings: project.scopeHeadings(final),
      types: project.propertyTypes(context)
    })
    console.log(JSON.stringify(result, null, 2))
    if (!result.proved) process.exitCode = 1
  },

  /**
   * The advance: `new` moving one project from Scoped to In progress, with
   * the fields `new` owns and none of the ones it preserves.
   */
  start (changesFile, existingFile) {
    if (!changesFile || !existingFile) throw new Error('Usage: node projects.js start <changes.json> <existing.json>')
    const changes = readJson(changesFile, 'the changes', 'fields')
    const context = projectsContext()
    const existing = existingRow(context, readJson(existingFile, 'the existing row', 'fields'), 'the existing row')

    const properties = project.advanceProperties(context, changes, existing)

    console.log(JSON.stringify({
      target: existing.identity,
      targetUrl: existing.url,
      properties,
      // Owner defaults to the configured person, so it is absent only when
      // nobody was named AND config records no person: the nullable rule.
      ownerNote: context.property('Owner') in properties
        ? null
        : 'No Owner was written: nobody was named and the config records no person. That is the nullable-person rule working, not a failure, and the project shows no owner until a person sets one.',
      preserved: 'Memos, Priority, Level of Effort, Business outcome and the page body are scope\'s output and were not touched.',
      note:
        'Send these properties as an update to the page named by `target`. Then re-fetch it, keeping its url, and pass ' +
        'THIS OUTPUT and the re-fetched page to `prove-update`. Create the tasks through `tasks` in the same session, ' +
        'because a project at In progress with no tasks is the state this skill exists to prevent.'
    }, null, 2))
  },

  tasks (file) {
    if (!file) throw new Error('Usage: node projects.js tasks <tasks.json>')
    const list = readJson(file, 'the tasks', 'list')
    const tasks = tasksContext()

    const payloads = project.taskPayloads(tasks, list)
    const concerns = project.taskConcerns(list)

    console.log(JSON.stringify({
      tasks: payloads,
      concerns,
      projectRelationNote:
        'THE PROJECT RELATION IS NOT WRITTEN. No plugin here has measured a relation write on this surface, so every ' +
        'task created from these payloads is an orphan until a person links it to its project in Notion, and orphan ' +
        'tasks are exactly what the Tasks "Needs attention" view surfaces. Say so when reporting, and name the project ' +
        'so the links can be made.',
      bodyNote:
        'No task body is written. Requirements live in the task body, written when the task is picked up, by a person.',
      note:
        'Create each task one at a time, then re-fetch it and run `prove-task` per task. A create call that returned ' +
        'without an error proves nothing.'
    }, null, 2))
  },

  'prove-task' (taskFile, readbackFile, createdUrl) {
    if (!taskFile || !readbackFile) {
      throw new Error('Usage: node projects.js prove-task <task.json> <readback.json> <created-url>')
    }
    const intended = readJson(taskFile, 'the task that was sent', 'fields')
    if (!intended.properties || typeof intended.properties !== 'object' || Array.isArray(intended.properties)) {
      throw new Error('That file is not one task from `tasks`. It needs the `properties` that command printed for the task.')
    }
    const readback = readJson(readbackFile, 'the page as it came back', 'fields')
    const tasks = tasksContext()

    const result = proveCreate({
      what: 'task',
      createdUrl,
      readback,
      intended: intended.properties,
      headings: [],
      types: project.taskPropertyTypes(tasks)
    })
    console.log(JSON.stringify(result, null, 2))
    if (!result.proved) process.exitCode = 1
  },

  /**
   * The whole-table Tasks read `ship` runs before closing. The Project column
   * is a relation, read as a query column, which is measured: `process`'s
   * audit reads Memos.Artifacts the same way, proved live on 2026-08-24.
   * `unfinished` does the filtering in the script, where the comparison is
   * measured, rather than in SQL that has not been.
   */
  'open-tasks' () {
    const tasks = tasksContext()
    console.log(JSON.stringify({
      columns: {
        url: 'url',
        'Task name': tasks.property('Task name'),
        Status: tasks.property('Status'),
        Project: tasks.property('Project')
      },
      sql:
        `SELECT t.url, t.${identifier(tasks.property('Task name'))}, t.${identifier(tasks.property('Status'))}, ` +
        `t.${identifier(tasks.property('Project'))}\n` +
        'FROM <tasks-ds> AS t',
      note:
        'Replace <tasks-ds> with the quoted data source url. The whole table on purpose: filtering through a relation ' +
        'in SQL is unmeasured on this surface, so pass what comes back to `unfinished` with the project\'s url.'
    }, null, 2))
  },

  unfinished (rowsFile, projectUrl) {
    if (!rowsFile || !projectUrl) throw new Error('Usage: node projects.js unfinished <tasks.json> <project-url>')
    const tasks = tasksContext()
    const wanted = pageIdentity(projectUrl)
    if (!wanted) {
      throw new Error(`"${projectUrl}" is not a Notion page this can identify. Pass the project's url.`)
    }

    const back = reverseValues((tasks.names && tasks.names.values) || {})
    const open = []
    let finished = 0
    let elsewhere = 0
    for (const raw of rowList(readJson(rowsFile, 'the task rows'))) {
      if (!raw || typeof raw !== 'object') {
        throw new Error(`A row came back as ${JSON.stringify(raw)} rather than as an object. Save what the query returned.`)
      }
      const related = listOfNames(raw[tasks.property('Project')])
        .map(entry => pageIdentity(typeof entry === 'string' ? entry : (entry && entry.url)))
        .filter(Boolean)
      if (!related.includes(wanted)) { elsewhere++; continue }
      const status = toLogical(back, 'Status', raw[tasks.property('Status')])
      // A task with no status at all is a half-built row somebody made by
      // hand, and it counts as open: reporting it closed would close a
      // project over work nobody can account for.
      if (status === 'Done' || status === 'Canceled') { finished++; continue }
      open.push({ url: raw.url, name: raw[tasks.property('Task name')], status: status === undefined || status === null || status === '' ? null : status })
    }

    console.log(JSON.stringify({
      project: wanted,
      open,
      leftOut: { finishedOrCanceled: finished, otherProjects: elsewhere },
      note: open.length
        ? `${open.length} task${open.length === 1 ? ' is' : 's are'} still open on this project. Nothing in v1 moves a task's status, so open tasks at ship time are ordinary. LIST THEM AND ASK before closing: \`ship\` neither refuses over them nor pretends they are not there. A task with no status counts as open.`
        : 'No open tasks on this project, among the rows that relate to it. A task never linked to the project is invisible here; the Tasks "Needs attention" view holds those.'
    }, null, 2))
  },

  /**
   * The close: `ship` moving one project from In progress to Done, after the
   * release memo exists. The release url is the evidence the two happened as
   * one action.
   */
  close (existingFile, releaseUrl) {
    if (!existingFile || !releaseUrl) throw new Error('Usage: node projects.js close <existing.json> <release-url>')
    const context = projectsContext()
    const existing = existingRow(context, readJson(existingFile, 'the existing row', 'fields'), 'the existing row')

    const properties = project.closeProperties(context, existing, releaseUrl)

    console.log(JSON.stringify({
      target: existing.identity,
      targetUrl: existing.url,
      properties,
      release: pageIdentity(releaseUrl),
      relationNote:
        'THE MEMOS AND ARTIFACTS RELATIONS ARE NOT WRITTEN. The release memo, this project, and any artifact the ' +
        'release changed are linked by a person in Notion. Name all of them when reporting so the links can be made: ' +
        'the Artifacts link in particular is what makes the audit signal work, and leaving it unmade quietly is how ' +
        'that signal degrades.',
      note:
        'Send these properties as an update to the page named by `target`. Then re-fetch it, keeping its url, and pass ' +
        'THIS OUTPUT and the re-fetched page to `prove-update`.'
    }, null, 2))
  },

  /**
   * Did an update land: `fill`, `start` or `close`, proved against the page
   * it was sent to. Takes the command's own output rather than its inputs,
   * because rebuilding the payload cannot see what the command decided.
   */
  'prove-update' (outputFile, readbackFile) {
    if (!outputFile || !readbackFile) {
      throw new Error('Usage: node projects.js prove-update <output.json> <readback.json>')
    }
    const intended = readJson(outputFile, 'the update that was sent', 'fields')
    if (!intended.target || !intended.properties || typeof intended.properties !== 'object' || Array.isArray(intended.properties)) {
      throw new Error(
        'That file is not the output of `fill`, `start` or `close`. It needs the `target` and `properties` one of ' +
        'those commands printed, because a payload rebuilt from the inputs cannot see what the command decided.'
      )
    }
    const readback = readJson(readbackFile, 'the page as it came back', 'fields')
    const context = projectsContext()

    const result = proveCreate({
      what: 'update',
      createdUrl: intended.target,
      readback,
      intended: intended.properties,
      headings: Array.isArray(intended.headings) ? intended.headings : [],
      types: project.propertyTypes(context)
    })
    console.log(JSON.stringify(result, null, 2))
    if (!result.proved) process.exitCode = 1
  },

  // ---------------------------------------------------------------- the memos

  /**
   * The memo gate, restricted to the three types this plugin writes. The
   * builder is the same vendored `memo-write` the memos plugin runs, so the
   * shapes cannot disagree; what is added here is the restriction and the
   * project-context property rule.
   */
  'memo-check' (file) {
    if (!file) throw new Error('Usage: node projects.js memo-check <proposed.json>')
    const proposed = readJson(file, 'the proposed memo', 'fields')

    const allowed = Object.values(schema.MEMO_TYPES)
    if (proposed.Type && !allowed.includes(proposed.Type)) {
      throw new Error(
        `"${proposed.Type}" is not a memo type this plugin writes. It writes ${allowed.join(', ')}, the ` +
        'project-context entry points. Every other type goes through `memos:new`, the general path.'
      )
    }

    const problems = memoWrite.problems(proposed)
    const concerns = memoWrite.concerns(proposed)

    console.log(JSON.stringify({
      writable: problems.length === 0,
      problems,
      concerns,
      wordCount: memoWrite.wordCount(proposed),
      ceiling: memosSchema.WORD_CEILING,
      note: problems.length
        ? 'Every problem here is a refusal. Notion rejects a bad select value as a whole, so a drafted memo is lost at write time rather than partly saved.'
        : 'Nothing blocks this write. Anything under concerns is a question for the user, not a fault.'
    }, null, 2))

    if (problems.length) process.exitCode = 1
  },

  'memo-create' (file) {
    if (!file) throw new Error('Usage: node projects.js memo-create <memo.json>')
    const final = readJson(file, 'the memo', 'fields')
    const memos = memosContext()

    const allowed = Object.values(schema.MEMO_TYPES)
    if (!allowed.includes(final.Type)) {
      throw new Error(
        `"${final.Type}" is not a memo type this plugin writes. It writes ${allowed.join(', ')}, the ` +
        'project-context entry points. Every other type goes through `memos:new`, the general path.'
      )
    }

    const properties = memoWrite.properties(memos, final, { today: final.today })
    const projectRef = project.pageAsked(final.project, 'project', 'A memo about a project names one project.')
    if (projectRef && projectRef.problem) {
      throw new Error(projectRef.problem.message)
    }
    // A Project Update or Release IS about one project; without it the memo
    // is a plain Memo and belongs to `memos:new`. A Problem Statement may
    // have none, because it comes before the project exists.
    if (!projectRef && final.Type !== 'Problem Statement') {
      throw new Error(
        `A ${final.Type} is about one project and none is named. Pass \`project\` with the project's url: the ` +
        'relation is not written anyway, but the reporting has to name the project so a person can make the link, ' +
        'and a ' + final.Type + ' about no project in particular is a plain Memo, which `memos:new` writes.'
      )
    }

    console.log(JSON.stringify({
      parent: { data_source_id: memos.dataSourceId },
      properties,
      body: memoWrite.body(final),
      headings: memoWrite.expectedHeadings(final),
      project: projectRef && projectRef.target ? projectRef.target : null,
      projectNote: projectRef && projectRef.target
        ? 'THE PROJECTS RELATION IS NOT BEING WRITTEN. The memo and its project will not point at each other until a ' +
          'person links them in Notion. Say so when reporting and name both pages: an unlinked problem statement is ' +
          'exactly what the Projects "Needs attention" view surfaces, and an unlinked update is invisible from its project.'
        : 'No project is named, which is legal only for a problem statement: it comes before the project exists. `scope` will need this memo\'s url.',
      artifactsNote: final.Type === 'Release'
        ? 'A release usually changes an SOP, and the Artifacts relation on the memo is what makes the audit signal ' +
          'work. It is not written here; name the changed artifacts when reporting so a person can link them.'
        : null,
      appendOnly:
        'THIS PAGE IS FROZEN THE MOMENT IT PUBLISHES. The body and every content property are never edited, not for a ' +
        'typo. A correction is a new memo through `memos:new`.',
      note:
        'Create the page, then read it back and run `memo-prove`. A create call that returned without an error proves nothing.'
    }, null, 2))
  },

  'memo-prove' (memoFile, readbackFile, createdUrl) {
    if (!memoFile || !readbackFile) {
      throw new Error('Usage: node projects.js memo-prove <memo.json> <readback.json> <created-url>')
    }
    const final = readJson(memoFile, 'the memo', 'fields')
    const readback = readJson(readbackFile, 'the page as it came back', 'fields')
    const memos = memosContext()

    const result = proveCreate({
      what: 'memo',
      createdUrl,
      readback,
      intended: memoWrite.properties(memos, final, { today: final.today }),
      headings: memoWrite.expectedHeadings(final),
      types: memoWrite.propertyTypes(memos)
    })
    console.log(JSON.stringify(result, null, 2))
    if (!result.proved) process.exitCode = 1
  }
}

if (require.main === module) {
  const [command, ...args] = process.argv.slice(2)
  if (!command || !commands[command]) {
    console.error(`Unknown command ${command ? `"${command}"` : ''}. One of: ${Object.keys(commands).join(', ')}`)
    process.exit(1)
  }
  try {
    commands[command](...args)
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}

module.exports = {
  commands,
  readJson,
  describeShape,
  rowList,
  reverseValues,
  toLogical,
  existingRow,
  normaliseProjectRows,
  identifier,
  literal
}

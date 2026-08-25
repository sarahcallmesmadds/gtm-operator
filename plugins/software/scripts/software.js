'use strict'

/**
 * The command layer. This file decides what to send; the skill sends it.
 *
 * The Notion calls go through the connected client, which a script cannot
 * reach, so every query is built here, every answer is judged here, and the
 * model makes the calls in between. The same shape as the other five plugins,
 * so there is one convention in this marketplace rather than six.
 *
 * Every query resolves its names through the config map, because a workspace
 * renames properties and option values, and a query carrying shipped names
 * asks about names nobody uses and comes back empty, which is exactly what a
 * directory with nothing in it looks like.
 *
 * `<ds>` markers are left for the caller to replace with the quoted data
 * source url, the convention the other plugins use.
 *
 *   node software.js context                                  what config says, or why it refuses
 *   node software.js directory                                the whole-table read new starts from
 *   node software.js duplicates <rows.json> <name>            is this tool already in the directory
 *   node software.js check <proposed.json>                    what is wrong with this new row
 *   node software.js create <tool.json>                       the creation payload and the body
 *   node software.js prove <tool.json> <readback.json> <created-url>
 *   node software.js update <changes.json> <existing.json>    the update payload: sets and clears
 *   node software.js review <changes.json> <existing.json> [--confirmed] --today YYYY-MM-DD
 *   node software.js prove-update <output.json> <readback.json>
 *   node software.js contracts-survey                         the whole-table read contracts runs
 *   node software.js contracts <rows.json> --today YYYY-MM-DD [--window days]
 *
 * WHAT NO COMMAND HERE DOES: create a database, write config, delete or
 * archive a row, fill a person field nobody named, or move `Last reviewed`
 * outside `create` and a confirmed `review`. A tool that is gone goes to
 * `Retired` through `update`, which keeps the record of what was dropped.
 */

const fs = require('fs')
const path = require('path')

const config = require(path.join(__dirname, 'vendor', 'config-read'))
const schema = require(path.join(__dirname, 'vendor', 'software-schema'))
const tool = require(path.join(__dirname, 'tool'))
const { proveCreate } = require(path.join(__dirname, 'vendor', 'prove-create'))
const { pageIdentity } = require(path.join(__dirname, 'vendor', 'page-id'))

const KEY = 'software'

/** `"` inside an identifier is doubled, which is how SQL escapes it. */
const identifier = name => `"${String(name).split('"').join('""')}"`

function contextOrExit () {
  const context = config.contextFor(KEY, schema.IDENTITY)
  if (!context.ok) {
    console.error(context.message)
    process.exit(1)
  }
  return context
}

/**
 * A file read, parsed, and checked for being the shape the caller reads it
 * as. Valid JSON of the wrong shape is the failure the `process` plugin was
 * corrected for five times: a list where a set of fields was expected has
 * none of those fields, so every one reads as absent, and the run reports
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
 * The list of rows inside whatever the query returned. A MISSING RESULT IS
 * NOT AN EMPTY ONE: null is a query that was never sent, and it is refused
 * rather than read as a directory with nothing in it.
 */
function rowList (rows) {
  if (rows === null || rows === undefined) {
    throw new Error(
      'There are no rows to read. That is a query that was not sent or a result saved as null, ' +
      'which is a different thing from a directory with nothing in it, and it is not being reported as one.'
    )
  }
  if (Array.isArray(rows)) return rows
  for (const envelope of ['results', 'rows', 'data']) {
    if (Array.isArray(rows[envelope])) return rows[envelope]
  }
  throw new Error(
    `The rows are in a shape this does not recognise: ${Object.keys(rows).join(', ') || typeof rows}. ` +
    'Expected an array, or an object with results, rows or data. Refusing rather than guessing, ' +
    'because a guess that returns nothing reads exactly like an empty directory.'
  )
}

/** The workspace's option names mapped back to the logical ones. */
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
 * A fetched Software page, read into the shape the update commands need: its
 * identity and its url. Nothing else is judged from it here, because no
 * transition gates on state: `update` changes facts on any row, and the
 * before-and-after preview is the skill's to show from the fetched page.
 */
function existingRow (page, what) {
  if (!page || typeof page !== 'object' || Array.isArray(page)) {
    throw new Error(`${what} is ${describeShape(page)}, and this reads the fetched page: { url, properties }.`)
  }
  const identity = pageIdentity(page.url || (page.page && page.page.url))
  if (!identity) {
    throw new Error(`${what} carries no usable url, so nothing can say which page an update would go to. Save the whole page, keeping its url.`)
  }
  if (!page.properties || typeof page.properties !== 'object' || Array.isArray(page.properties)) {
    throw new Error(`${what} has no properties to read, so the before half of the before-and-after cannot be shown from it. Save the whole page, not a summary of it.`)
  }
  return { identity, url: page.url }
}

/** The columns `directory` and `duplicates` read, in one place. */
const DIRECTORY_COLUMNS = ['Name', 'Status', 'Domain', 'Description']

/**
 * A day argument, refused before any input file is read.
 *
 * ROUND-TRIPPED, NOT SHAPE-CHECKED. `2026-02-30` matches the shape and
 * `Date.parse` quietly hands back the 2nd of March, which would shift every
 * deadline in the report while looking exactly like a real run. The same
 * round trip `memo-write`'s dayProblem learned the hard way.
 */
function dayArgument (value, name) {
  if (!value) {
    throw new Error(`Pass ${name} as YYYY-MM-DD. The script does not read the clock: the caller says what day it is.`)
  }
  const text = String(value)
  const parsed = Date.parse(`${text}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(parsed) ||
      new Date(parsed).toISOString().slice(0, 10) !== text) {
    throw new Error(`${name} is ${JSON.stringify(value)}, and it is a day that exists, YYYY-MM-DD. Parsed loosely a day like 2026-02-30 rolls into March, and every deadline in the report shifts with it.`)
  }
  return text
}

/** Days between two YYYY-MM-DD days, positive when `to` is later. */
function daysBetween (from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000)
}

const IMPORTANCE_RANK = Object.fromEntries(schema.IMPORTANCE.map((v, i) => [v, i]))

// --------------------------------------------------------------------- commands

const commands = {
  context () {
    const context = contextOrExit()
    console.log(JSON.stringify({
      software: { databaseId: context.databaseId, dataSourceId: context.dataSourceId, displayName: context.displayName },
      personId: context.personId,
      personIdNote: context.personId
        ? null
        : 'No person is recorded, so Owner, Technical owner, Admins and Billing owner are omitted rather than written empty. That is a working install, not a failed one.',
      names: context.names
    }, null, 2))
  },

  /**
   * The whole-table read `new` starts from, for the duplicate check, and the
   * general answer to "what do we already use". WHOLE TABLE, DELIBERATELY:
   * text matching is not in the SQL, because which existing row is the same
   * tool is a judgment made over all the rows rather than over whatever a
   * keyword happened to hit.
   */
  directory () {
    const context = contextOrExit()
    const select = ['s.url'].concat(DIRECTORY_COLUMNS.map(l => `s.${identifier(context.property(l))}`)).join(', ')
    const columns = { url: 'url' }
    for (const logical of DIRECTORY_COLUMNS) columns[logical] = context.property(logical)
    console.log(JSON.stringify({
      columns,
      sql: `SELECT ${select}\nFROM <software-ds> AS s`,
      what: 'Every tool in the directory. Run this before drafting a new row, save the result whole, and pass it to `duplicates` with the proposed name.',
      note: 'Replace <software-ds> with the quoted data source url.'
    }, null, 2))
  },

  /**
   * Is this tool already in the directory. BY NAME, AND THE COST IS RECORDED:
   * `Name` is the vendor's own spelling and a rename keeps no former name, so
   * a renamed product can arrive as a fresh candidate and costs one "no" at
   * the approval gate. An exact match is a duplicate; a containment either
   * way is a question. Anything subtler is the skill's judgment over the full
   * list, which is why the list is printed back beside the answer.
   */
  duplicates (rowsFile, ...nameParts) {
    const name = nameParts.join(' ').trim()
    if (!rowsFile || !name) throw new Error('Usage: node software.js duplicates <rows.json> <name>')
    const context = contextOrExit()

    const wanted = name.toLowerCase()
    const exact = []
    const near = []
    for (const raw of rowList(readJson(rowsFile, 'the directory rows'))) {
      if (!raw || typeof raw !== 'object') {
        throw new Error(`A row came back as ${JSON.stringify(raw)} rather than as an object. Save what the query returned.`)
      }
      const rowName = raw[context.property('Name')]
      if (typeof rowName !== 'string' || !rowName.trim()) continue
      const have = rowName.trim().toLowerCase()
      const entry = { url: raw.url, name: rowName.trim(), status: raw[context.property('Status')] }
      if (have === wanted) exact.push(entry)
      else if (have.includes(wanted) || wanted.includes(have)) near.push(entry)
    }

    console.log(JSON.stringify({
      name,
      duplicates: exact,
      nearMatches: near,
      note: exact.length
        ? 'This tool is already in the directory. Changing its facts is `update`; a second row for the same contract is exactly what the duplicate check exists to prevent.'
        : near.length
          ? 'No exact match, and the near matches above share words with the proposed name. Judge them before drafting: a renamed or bundled product is one row, a separately-cancellable one is its own.'
          : 'No match by name. The check is by name only, so a renamed product can still be a duplicate; the one-row-per-thing-you-could-cancel-separately test is the skill\'s to apply.'
    }, null, 2))
  },

  check (file) {
    if (!file) throw new Error('Usage: node software.js check <proposed.json>')
    const proposed = readJson(file, 'the proposed tool', 'fields')

    const problems = tool.newProblems(proposed)
    const concerns = tool.newConcerns(proposed)

    console.log(JSON.stringify({
      writable: problems.length === 0,
      problems,
      concerns,
      wordCount: tool.wordCount(proposed),
      ceiling: schema.WORD_CEILING,
      note: problems.length
        ? 'Every problem here is a refusal. Notion rejects a bad select value as a whole, so a drafted row is lost at write time rather than partly saved.'
        : 'Nothing blocks this write. Anything under concerns is a question for the user, not a fault.'
    }, null, 2))

    if (problems.length) process.exitCode = 1
  },

  create (file) {
    if (!file) throw new Error('Usage: node software.js create <tool.json>')
    const final = readJson(file, 'the tool', 'fields')
    const context = contextOrExit()

    const properties = tool.newProperties(context, final)

    console.log(JSON.stringify({
      parent: { data_source_id: context.dataSourceId },
      properties,
      body: tool.toolBody(final),
      headings: tool.toolHeadings(final),
      relationNote:
        'THE ARTIFACTS AND INTEGRATES WITH RELATIONS ARE NOT WRITTEN. No plugin in this marketplace has measured a ' +
        'relation write on this surface. Artifacts is filled by `process:new` when a doc about this tool is written, ' +
        'and Integrates with by a person or a review. Say so when reporting rather than reporting the row as fully wired.',
      lastReviewedNote:
        'Last reviewed is stamped with today: creation is a full pass, the person just answered every group. ' +
        'After this, only a confirmed `review` moves it.',
      note:
        'Run `directory` and `duplicates` BEFORE drafting, not after. Create the page, then read it back and run ' +
        '`prove` with the url the create returned. A create call that returned without an error proves nothing.'
    }, null, 2))
  },

  prove (toolFile, readbackFile, createdUrl) {
    if (!toolFile || !readbackFile) {
      throw new Error('Usage: node software.js prove <tool.json> <readback.json> <created-url>')
    }
    const final = readJson(toolFile, 'the tool', 'fields')
    const readback = readJson(readbackFile, 'the page as it came back', 'fields')
    const context = contextOrExit()

    const result = proveCreate({
      what: 'tool',
      createdUrl,
      readback,
      intended: tool.newProperties(context, final),
      headings: tool.toolHeadings(final),
      types: tool.propertyTypes(context)
    })
    console.log(JSON.stringify(result, null, 2))
    if (!result.proved) process.exitCode = 1
  },

  /**
   * The update: facts that changed, one row at a time. Sets and clears in one
   * payload; a field explicitly emptied is a clear, and every type clears
   * with null, measured 2026-08-19 in the calendar plugin. `Last reviewed` is
   * never in it.
   */
  update (changesFile, existingFile) {
    if (!changesFile || !existingFile) throw new Error('Usage: node software.js update <changes.json> <existing.json>')
    const changes = readJson(changesFile, 'the changes', 'fields')
    const context = contextOrExit()
    const existing = existingRow(readJson(existingFile, 'the existing row', 'fields'), 'the existing row')

    const built = tool.updateProperties(context, changes)
    const body = changes.body && typeof changes.body === 'object'
      ? Object.entries(changes.body).map(([heading, text]) => ({ heading, text: typeof text === 'string' ? text.trim() : text }))
      : []

    console.log(JSON.stringify({
      target: existing.identity,
      targetUrl: existing.url,
      properties: built.properties,
      cleared: built.cleared,
      body,
      headings: body.map(section => section.heading),
      preserved: 'Last reviewed was not touched: update never moves it, whatever it changed. Fields not named were left alone, including any that are visibly stale.',
      retirementNote:
        'A tool that is gone goes to Status: Retired and the row stays, which is what keeps the record of what was dropped. ' +
        'A replacement is two operations (retire here, then `new` for the successor) and a merge is a retirement plus an edit, ' +
        'with the spend landing on one row and not both.',
      note:
        'Show the before and after inline and wait for the yes. Send these properties as one update to the page named by ' +
        '`target`; write only the body sections listed, replacing each section under its heading rather than the whole body. ' +
        'Then re-fetch the page, keeping its url, and pass THIS OUTPUT and the re-fetched page to `prove-update`.'
    }, null, 2))
  },

  /**
   * The review: an update plus the stamp, and the stamp only on --confirmed.
   * A review that finds nothing wrong is a real review and stamps the date; a
   * review that did not look is not, and this flag is where that line is held.
   */
  review (changesFile, existingFile, ...flags) {
    if (!changesFile || !existingFile) {
      throw new Error('Usage: node software.js review <changes.json> <existing.json> [--confirmed] --today YYYY-MM-DD')
    }
    const confirmed = flags.includes('--confirmed')
    const todayAt = flags.indexOf('--today')
    const today = confirmed ? dayArgument(todayAt >= 0 ? flags[todayAt + 1] : null, '--today') : null
    const unknown = flags.filter((f, i) => f.startsWith('--') && !['--confirmed', '--today'].includes(f))
    if (unknown.length) {
      throw new Error(`Unknown flag ${unknown.join(', ')}. This takes --confirmed and --today YYYY-MM-DD, nothing else.`)
    }

    const changes = readJson(changesFile, 'the changes', 'fields')
    const context = contextOrExit()
    const existing = existingRow(readJson(existingFile, 'the existing row', 'fields'), 'the existing row')

    const built = tool.reviewProperties(context, changes, { confirmed, today })
    const body = changes.body && typeof changes.body === 'object'
      ? Object.entries(changes.body).map(([heading, text]) => ({ heading, text: typeof text === 'string' ? text.trim() : text }))
      : []

    console.log(JSON.stringify({
      target: existing.identity,
      targetUrl: existing.url,
      properties: built.properties,
      cleared: built.cleared,
      body,
      headings: body.map(section => section.heading),
      stamped: confirmed,
      stampNote: confirmed
        ? 'Last reviewed moves to today, because the person confirmed this counted as actually confirming the row: the four groups were walked, in order. A review that finds nothing wrong is a real review.'
        : 'Last reviewed was NOT moved: the pass is unconfirmed. Ask whether this counted as actually confirming the row, and re-run with --confirmed on a yes. Forty stamped dates with nothing confirmed is a directory that looks maintained and is not.',
      securityNote:
        'The security group is not changed without asking: those answers came from somewhere, and replacing them silently loses the fact that they were checked.',
      note:
        'Send these properties as one update to the page named by `target`. Then re-fetch it, keeping its url, and pass ' +
        'THIS OUTPUT and the re-fetched page to `prove-update`.'
    }, null, 2))
  },

  'prove-update' (outputFile, readbackFile) {
    if (!outputFile || !readbackFile) {
      throw new Error('Usage: node software.js prove-update <output.json> <readback.json>')
    }
    const intended = readJson(outputFile, 'the update that was sent', 'fields')
    if (!intended.target || !intended.properties || typeof intended.properties !== 'object' || Array.isArray(intended.properties)) {
      throw new Error(
        'That file is not the output of `update` or `review`. It needs the `target` and `properties` one of those ' +
        'commands printed, because a payload rebuilt from the inputs cannot see what the command decided.'
      )
    }
    const readback = readJson(readbackFile, 'the page as it came back', 'fields')
    const context = contextOrExit()

    const result = proveCreate({
      what: 'update',
      createdUrl: intended.target,
      readback,
      intended: intended.properties,
      headings: Array.isArray(intended.headings) ? intended.headings : [],
      types: tool.propertyTypes(context)
    })
    console.log(JSON.stringify(result, null, 2))
    if (!result.proved) process.exitCode = 1
  },

  /**
   * The whole-table read `contracts` runs. WHOLE TABLE, DELIBERATELY, and
   * this is the trap the design names: an empty date does not match a
   * "before" filter in Notion, so any date-filtered query silently omits
   * every row with no contract data, and a contracts report that omits half
   * the directory reads as "nothing is due". The filtering happens in
   * `contracts`, in the script, where the omission can be counted and said.
   */
  'contracts-survey' () {
    const context = contextOrExit()
    const noticeStart = `date:${context.property('Notice deadline')}:start`
    const contractStart = `date:${context.property('Contract dates')}:start`
    const contractEnd = `date:${context.property('Contract dates')}:end`
    const plain = ['Name', 'Status', 'Importance', 'Renews', 'Annual cost']

    const columns = { url: 'url' }
    for (const logical of plain) columns[logical] = context.property(logical)
    columns['Notice deadline'] = noticeStart
    columns['Contract dates start'] = contractStart
    columns['Contract dates end'] = contractEnd

    const select = ['s.url']
      .concat(plain.map(l => `s.${identifier(context.property(l))}`))
      .concat([noticeStart, contractStart, contractEnd].map(c => `s.${identifier(c)}`))
      .join(', ')

    console.log(JSON.stringify({
      columns,
      sql: `SELECT ${select}\nFROM <software-ds> AS s`,
      note: 'Replace <software-ds> with the quoted data source url. Save the result whole and pass it to `contracts` with --today.'
    }, null, 2))
  },

  /**
   * What is coming up and what happens if you do nothing.
   *
   * ORDERED BY CONSEQUENCE, NOT BY DATE. A three hundred dollar tool
   * auto-renewing next week matters less than a sixty thousand dollar one
   * with a notice deadline in three weeks. Automatic renewals are the
   * deadlines; the same date on a manually renewing contract is a diary note.
   *
   * THE LAST LINE IS HALF THE ANSWER: every row this could not assess is
   * counted, with why. Reads only, writes nothing, and `Last reviewed` in
   * particular does not move, because reading a list is not reviewing a row.
   */
  contracts (rowsFile, ...flags) {
    if (!rowsFile) throw new Error('Usage: node software.js contracts <rows.json> --today YYYY-MM-DD [--window days]')
    // Flags are judged before any input is read, and one this does not
    // recognise is refused rather than skipped: `--widnow 30` silently
    // running the default window is a valid-looking report for a window
    // nobody set.
    const unknown = flags.filter(f => f.startsWith('--') && !['--today', '--window'].includes(f))
    if (unknown.length) {
      throw new Error(`Unknown flag ${unknown.join(', ')}. This takes --today YYYY-MM-DD and --window days, nothing else.`)
    }
    const todayAt = flags.indexOf('--today')
    const today = dayArgument(todayAt >= 0 ? flags[todayAt + 1] : null, '--today')
    const windowAt = flags.indexOf('--window')
    let window = 90
    if (windowAt >= 0) {
      window = Number(flags[windowAt + 1])
      if (!Number.isInteger(window) || window <= 0) {
        throw new Error(`--window is ${JSON.stringify(flags[windowAt + 1])}, and it is a positive number of days.`)
      }
    }

    const context = contextOrExit()
    const back = reverseValues((context.names && context.names.values) || {})
    const noticeStart = `date:${context.property('Notice deadline')}:start`
    const contractStart = `date:${context.property('Contract dates')}:start`
    const contractEnd = `date:${context.property('Contract dates')}:end`

    const day = value => {
      if (value === undefined || value === null || value === '') return null
      return String(value).slice(0, 10)
    }
    const money = (value, wrong) => {
      if (value === undefined || value === null || value === '') return null
      if (typeof value === 'number' && Number.isFinite(value)) return value
      const parsed = Number(value)
      if (typeof value === 'string' && value.trim() && Number.isFinite(parsed)) return parsed
      wrong.push(value)
      return null
    }

    const deadlines = []
    const diary = []
    // EVERY row with missing contract data lands here, with its reasons —
    // including rows whose deadline could still be ordered. The design's
    // three reasons are "no notice deadline, no contract dates, or Renews
    // unknown", and a row missing only its contract range was assessed for
    // ordering while still being incomplete; counting only the unorderable
    // ones understates the gap.
    const incomplete = []
    const beyondWindow = []
    let retired = 0
    let rejected = 0

    for (const raw of rowList(readJson(rowsFile, 'the contract rows'))) {
      if (!raw || typeof raw !== 'object') {
        throw new Error(`A row came back as ${JSON.stringify(raw)} rather than as an object. Save what the query returned.`)
      }
      const status = toLogical(back, 'Status', raw[context.property('Status')])
      if (status === 'Retired') { retired++; continue }
      if (status === 'Rejected') { rejected++; continue }

      const badCost = []
      const row = {
        url: raw.url,
        name: raw[context.property('Name')],
        status,
        importance: toLogical(back, 'Importance', raw[context.property('Importance')]),
        renews: toLogical(back, 'Renews', raw[context.property('Renews')]),
        annualCost: money(raw[context.property('Annual cost')], badCost),
        noticeDeadline: day(raw[noticeStart]),
        contractStart: day(raw[contractStart]),
        contractEnd: day(raw[contractEnd])
      }

      const reasons = []
      if (!row.noticeDeadline) reasons.push('no notice deadline')
      if (!row.contractStart && !row.contractEnd) reasons.push('no contract dates')
      if (!row.renews || row.renews === 'Unknown') reasons.push('Renews unknown')
      if (badCost.length) reasons.push(`Annual cost is ${JSON.stringify(badCost[0])}, which is not a number`)

      // Orderable needs a deadline and a known renewal mode; incomplete is
      // wider, and a row can be both.
      const orderable = Boolean(row.noticeDeadline && row.renews && row.renews !== 'Unknown')
      if (reasons.length) {
        incomplete.push({ url: row.url, name: row.name, reasons, ordered: orderable })
      }
      if (!orderable) continue

      const inDays = daysBetween(today, row.noticeDeadline)
      if (inDays > window) { beyondWindow.push(row); continue }

      const overdue = inDays < 0
      const automatic = row.renews === 'Automatically'
      row.deadlineInDays = inDays
      row.why =
        (overdue
          ? `The notice deadline passed ${-inDays} day${inDays === -1 ? '' : 's'} ago. `
          : `The notice deadline is in ${inDays} day${inDays === 1 ? '' : 's'}. `) +
        (automatic
          ? overdue
            ? 'It renews automatically, so doing nothing has already committed you to another term unless the vendor says otherwise.'
            : 'It renews automatically, so doing nothing commits you to another term.'
          : row.renews === 'No renewal'
            ? 'There is no renewal: doing nothing means the contract ends and the tool switches off.'
            : 'It renews manually, so this date is a diary note: doing nothing means it lapses rather than renews.') +
        (row.annualCost === null ? ' No annual cost is recorded, so the size of the consequence is not on the row.' : '') +
        (reasons.length ? ` (Also: ${reasons.join('; ')}.)` : '')

      if (automatic) deadlines.push(row)
      else diary.push(row)
    }

    const byConsequence = (a, b) =>
      (b.annualCost === null ? -1 : b.annualCost) - (a.annualCost === null ? -1 : a.annualCost) ||
      (IMPORTANCE_RANK[a.importance] ?? 99) - (IMPORTANCE_RANK[b.importance] ?? 99) ||
      a.deadlineInDays - b.deadlineInDays
    deadlines.sort(byConsequence)
    diary.sort((a, b) => a.deadlineInDays - b.deadlineInDays)

    console.log(JSON.stringify({
      today,
      windowDays: window,
      deadlines,
      diary,
      diaryNote: diary.length ? 'Manual and non-renewing contracts inside the window. The same date without an automatic renewal is a diary note, not a deadline.' : null,
      beyondWindow: beyondWindow.length,
      leftOut: { retired, rejected, note: 'Retired and Rejected rows carry no live commitment. Counted rather than silent.' },
      incomplete,
      incompleteNote:
        `${incomplete.length} row${incomplete.length === 1 ? ' has' : 's have'} incomplete contract data, for the reasons listed per row. ` +
        'Rows marked ordered: false could not be placed in the lists above at all; ones marked ordered: true appear above AND here, because a deadline that could be ordered is still a contract nobody has fully recorded. ' +
        'THIS LINE IS HALF THE ANSWER: an empty date does not match a date filter in Notion, so these rows are exactly the ones any filtered view silently omits, and a report without this count reads as "nothing is due".',
      note: 'Read-only. Nothing was changed, nothing was cancelled, no vendor was contacted, and Last reviewed did not move: reading a list is not reviewing a row. Hand what needs attention to `review`.'
    }, null, 2))
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
  daysBetween,
  identifier
}

'use strict'

/**
 * The command layer. This file decides what to send; the skill sends it.
 *
 * The Notion calls go through the connected client, which a script cannot
 * reach, so every query is built here, every answer is judged here, and the
 * model makes the calls in between. That is the shape `setup`'s `check.js`,
 * `calendar.js` and `process.js` already use, and following it means one
 * convention in this marketplace rather than four.
 *
 * WHY NOT LET THE SKILL COMPOSE THE QUERIES. A workspace renames properties
 * and option values. A query carrying the names this plugin shipped with asks
 * about names nobody uses and comes back with no rows, and no rows is exactly
 * what a log with nothing in it looks like. Every query below resolves its
 * names through the config map for that reason.
 *
 * `<ds>` is left where it is, for the caller to replace with the quoted data
 * source url, the convention `setup`'s `views.js` and `rules.js` use.
 *
 *   node memos.js context                                  what config says, or why it refuses
 *   node memos.js check <proposed.json>                    what is wrong with this memo, and what to ask about
 *   node memos.js create <memo.json>                       the properties payload and the body
 *   node memos.js prove <memo.json> <readback.json> <created-url>  did the create land, on that page
 *   node memos.js find <question.json>                     the query find reads
 *   node memos.js chain                                    the whole-table query correction-following reads
 *   node memos.js follow <rows.json> <memo-url>            the end of the correction chain, or what stops it being followed
 *   node memos.js team-update <period.json>                the four queries a team update is assembled from
 *   node memos.js window <period.json> <projects.json> <calendar.json> <memos.json> [tasks.json]
 *                                                          those rows, partitioned into the period
 *   node memos.js tasks <actions.json>                     one Tasks payload per confirmed action
 *   node memos.js prove-task <task.json> <readback.json> <created-url>  did one task land
 *
 * WHAT NO COMMAND HERE DOES: edit. Memos is append-only. There is no update,
 * no backfill and no audit, and their absence is recorded in
 * `SKILLS-memos.md` as decisions rather than gaps.
 */

const fs = require('fs')
const path = require('path')

const config = require(path.join(__dirname, 'vendor', 'config-read'))
const schema = require(path.join(__dirname, 'vendor', 'memos-schema'))
// The memo builder is vendored from `shared/memo-write.js` since 2026-08-24,
// because `projects` writes three of the seven memo types and the shapes must
// be one definition in every plugin that writes them.
const memo = require(path.join(__dirname, 'vendor', 'memo-write'))
const { compareProperty, listOfNames, cameBackEmpty } = require(path.join(__dirname, 'vendor', 'notion-compare'))
const { pageIdentity } = require(path.join(__dirname, 'vendor', 'page-id'))

const KEY = 'memos'

/** `"` inside an identifier is doubled, which is how SQL escapes it. */
const identifier = name => `"${String(name).split('"').join('""')}"`
/** `'` inside a literal is doubled, the same way. */
const literal = value => `'${String(value).split("'").join("''")}'`

function contextOrExit () {
  const context = config.contextFor(KEY, schema.IDENTITY)
  if (!context.ok) {
    console.error(context.message)
    process.exit(1)
  }
  return context
}

/**
 * A file read, parsed, and checked for being the shape the caller reads it as.
 *
 * Valid JSON of the wrong shape is the failure the `process` plugin has been
 * corrected for five times: a list where a set of fields was expected has none
 * of those fields, so every one reads as absent, and the run reports there was
 * nothing to do. Refused at the door rather than in each command.
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
 * and it is refused rather than read as a log with nothing in it. `results` is
 * the envelope measured on 2026-08-19 for this SQL surface; `rows` and `data`
 * are accepted and have never been seen here. This is the one reader that
 * knows the measured envelopes, and every command reads rows through it, so
 * there is one opinion about the shape rather than several.
 */
function rowList (rows) {
  if (rows === null || rows === undefined) {
    throw new Error(
      'There are no rows to read. That is a query that was not sent or a result saved as null, ' +
      'which is a different thing from a log with nothing in it, and it is not being reported as one.'
    )
  }
  if (Array.isArray(rows)) return rows
  for (const envelope of ['results', 'rows', 'data']) {
    if (Array.isArray(rows[envelope])) return rows[envelope]
  }
  throw new Error(
    `The rows are in a shape this does not recognise: ${Object.keys(rows).join(', ') || typeof rows}. ` +
    'Expected an array, or an object with results, rows or data. Refusing rather than guessing, ' +
    'because a guess that returns nothing reads exactly like an empty log.'
  )
}

/**
 * A day that exists, or a refusal. Same round trip as `memo.dayProblem`, as an
 * argument gate: `Date.parse` rolls 2026-02-30 to March, so the string is
 * rendered back out and compared.
 */
function dayOrRefuse (value, what) {
  const text = String(value)
  const wrong = memo.dayProblem(text, what)
  if (wrong) throw new Error(wrong)
  return text
}

/**
 * The workspace's option names, mapped back to the logical ones, for one
 * recorded values map. Same shape as `logicalValues` in `calendar.js` and
 * `process.js`, because it is the same problem: the map is used on the way out
 * and has to be used on the way back, or a renamed workspace's rows compare
 * against values that are not theirs. A value the map does not carry passes
 * through unchanged: it is the workspace's own, and reporting it as itself
 * beats reporting it as nothing.
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
 * The page identities a relation column names, however the surface encoded
 * them. Measured on the audit path in `process`: a relation comes back as a
 * JSON array inside a string, and an empty one three ways.
 */
function relatedIdentities (value) {
  return listOfNames(value)
    .map(entry => pageIdentity(typeof entry === 'string' ? entry : (entry && entry.url)))
    .filter(Boolean)
}

/**
 * Everything `find` and `follow` select from Memos, and what each column is
 * called logically. `url` rather than the title, because a title is not an
 * identity and cannot be clicked through.
 *
 * `Corrects` and `Corrected by` are relation columns. Reading a relation as a
 * query column is measured: `process`'s audit reads Memos.Artifacts the same
 * way, proved against the live workspace on 2026-08-24.
 */
const SELECTED = ['Name', 'Description', 'Type', 'Domain', 'Status', 'Corrects', 'Corrected by']

function publishedColumn (context) {
  return `date:${context.property('Published date')}:start`
}

function selectList (context) {
  return ['m.url']
    .concat(SELECTED.map(logical => `m.${identifier(context.property(logical))}`))
    .concat([`m.${identifier(publishedColumn(context))}`])
    .join(', ')
}

function columnMap (context) {
  const map = { url: 'url' }
  for (const logical of SELECTED) map[logical] = context.property(logical)
  map['Published date'] = publishedColumn(context)
  return map
}

/**
 * Rows keyed by logical name, carrying logical option values, with the two
 * relation columns parsed into page identities.
 */
function normaliseRows (context, rows) {
  const map = columnMap(context)
  const back = reverseValues((context.names && context.names.values) || {})

  return rowList(rows).map(raw => {
    if (!raw || typeof raw !== 'object') {
      throw new Error(`A row came back as ${JSON.stringify(raw)} rather than as an object. Save what the query returned.`)
    }
    const out = { url: raw[map.url] !== undefined ? raw[map.url] : raw.url }
    out.identity = pageIdentity(out.url)
    for (const logical of ['Name', 'Description', 'Type', 'Domain', 'Status']) {
      out[logical] = toLogical(back, logical, raw[map[logical]] === undefined ? null : raw[map[logical]])
    }
    out['Published date'] = raw[map['Published date']] === undefined ? null : raw[map['Published date']]
    out.corrects = relatedIdentities(raw[map.Corrects])
    out.correctedBy = relatedIdentities(raw[map['Corrected by']])
    out._raw = raw
    return out
  })
}

/**
 * "Not this status", written so a row with no status at all still qualifies.
 * `!=` alone is UNKNOWN for null and the row is dropped, which is how a
 * half-built row somebody made by hand disappears from every answer. Same
 * reasoning and same defensive spellings as `calendar.js`'s `notCanceled`.
 */
function notStatus (context, logicalStatuses) {
  const status = identifier(context.property('Status'))
  const values = logicalStatuses.map(one => `m.${status} != ${literal(context.value('Status', one))}`)
  return `(m.${status} IS NULL OR m.${status} = '' OR m.${status} = '[]' OR (${values.join(' AND ')}))`
}

/**
 * Everything a command needs to read or write ANOTHER plugin's database, read
 * straight from the recorded map rather than through `contextFor`.
 *
 * WHY NOT `contextFor`. It validates the map against a full identity, both
 * ways, and this plugin does not carry the other databases' schemas and should
 * not: any identity it offered would be a subset, and every property it never
 * looks at would be reported as a fault in the user's config.
 *
 * WHAT IS GIVEN UP, SAID PLAINLY. The one-to-one check does not run, so two
 * properties mapped to one Notion name would not be caught here. `setup`'s
 * `check` owns validating those maps as a whole. Every name and value this
 * plugin actually reads or writes is required rather than defaulted, because
 * falling back to shipped names on a renamed workspace queries properties that
 * do not exist and reads as a workspace with nothing in it.
 */
function foreignContextOrExit (key, { properties = [], values = {}, why }) {
  const raw = config.readRaw()
  if (!raw.ok) {
    console.error(raw.message)
    process.exit(1)
  }
  const entry = (raw.config && raw.config.databases && raw.config.databases[key]) || null
  if (!entry) {
    console.error(
      `The config records no "${key}" database, and ${why} ` +
      `Run the \`setup\` plugin's \`add\` skill for it. Nothing here creates a database.`
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
  const missingProperties = properties.filter(name => !recorded[name])
  if (missingProperties.length) {
    console.error(
      `The ${key} map records no name for ${missingProperties.map(m => `"${m}"`).join(' or ')}, and ${why} ` +
      'It is refusing rather than falling back to the names this plugin shipped with: on a renamed workspace ' +
      'that queries properties which do not exist, returns nothing, and reads as a workspace with nothing in it. ' +
      'Run the `setup` plugin\'s `check` skill, which records them.'
    )
    process.exit(1)
  }
  for (const [property, wanted] of Object.entries(values)) {
    const recordedValues = (entry.values && entry.values[property]) || {}
    const missingValues = wanted.filter(one => !recordedValues[one])
    if (missingValues.length) {
      console.error(
        `The ${key} map records no name for the ${missingValues.map(m => `"${m}"`).join(' or ')} value of "${property}", and ${why} ` +
        'A missing value name means a row carrying it would be misread rather than matched. ' +
        'Run the `setup` plugin\'s `check` skill, which records them.'
      )
      process.exit(1)
    }
  }
  return {
    key,
    databaseId: entry.databaseId,
    dataSourceId: entry.dataSourceId,
    property: name => recorded[name],
    value: (property, logical) => ((entry.values && entry.values[property]) || {})[logical],
    reverse: reverseValues(entry.values || {})
  }
}

/** What the three team-update reads need from each database, in one place. */
const FOREIGN = {
  projects: {
    properties: ['Name', 'Status', 'Description', 'Timeline'],
    values: { Status: ['Done', 'Canceled'] },
    why: 'a team update reads Projects for what moved and what is stuck.'
  },
  calendar: {
    properties: ['Name', 'Type', 'Status', 'Date'],
    values: { Status: ['Done', 'Confirmed', 'Canceled'] },
    why: 'a team update reads Calendar for what went out and what is coming.'
  },
  tasks: {
    properties: ['Task name', 'Status', 'Due date'],
    values: { Status: ['Blocked', 'Done', 'Canceled'] },
    why: 'a team update reads Tasks only when a project\'s own status is not enough to tell the story.'
  }
}

/** A foreign date property's two queryable columns. */
function foreignDateColumns (foreign, logical) {
  const name = foreign.property(logical)
  return { start: `date:${name}:start`, end: `date:${name}:end` }
}

/** A day inside an inclusive window, compared as ISO strings. */
function inWindow (day, from, to) {
  if (!day) return false
  const text = String(day).slice(0, 10)
  return text >= from && text <= to
}

/** The period file, validated once for both commands that take it. */
function periodOrRefuse (file) {
  const period = readJson(file, 'the period', 'fields')
  if (!period.from || !period.to) {
    throw new Error('The period needs both ends: { "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" }.')
  }
  const from = dayOrRefuse(period.from, 'from')
  const to = dayOrRefuse(period.to, 'to')
  if (from > to) {
    throw new Error(`The period runs from ${from} to ${to}, which is backwards.`)
  }
  return { from, to }
}

// --------------------------------------------------------------------- commands

const commands = {
  context () {
    const context = contextOrExit()
    console.log(JSON.stringify({
      databaseId: context.databaseId,
      dataSourceId: context.dataSourceId,
      displayName: context.displayName,
      personId: context.personId,
      personIdNote: context.personId
        ? null
        : 'No person is recorded, so Author is omitted rather than written empty. That is a working install, not a failed one.',
      names: context.names
    }, null, 2))
  },

  check (file) {
    if (!file) throw new Error('Usage: node memos.js check <proposed.json>')
    const proposed = readJson(file, 'the proposed memo', 'fields')

    const problems = memo.problems(proposed)
    const concerns = memo.concerns(proposed)

    console.log(JSON.stringify({
      writable: problems.length === 0,
      problems,
      concerns,
      wordCount: memo.wordCount(proposed),
      ceiling: schema.WORD_CEILING,
      note: problems.length
        ? 'Every problem here is a refusal. Notion rejects a bad select value as a whole, so a drafted memo is lost at write time rather than partly saved.'
        : 'Nothing blocks this write. Anything under concerns is a question for the user, not a fault.'
    }, null, 2))

    if (problems.length) process.exitCode = 1
  },

  create (file) {
    if (!file) throw new Error('Usage: node memos.js create <memo.json>')
    const final = readJson(file, 'the memo', 'fields')
    const context = contextOrExit()

    const properties = memo.properties(context, final, { today: final.today })
    const correction = memo.correctionAsked(final.Corrects)

    console.log(JSON.stringify({
      parent: { data_source_id: context.dataSourceId },
      properties,
      body: memo.body(final),
      headings: memo.expectedHeadings(final),
      /*
       * A NAMED CORRECTION IS CHECKED AND THEN NOT WRITTEN, AND THAT HAS TO BE
       * SAID. `problems` refuses a Corrects naming several memos, because the
       * one-target rule cannot be enforced anywhere else. It then builds no
       * relation at all: no plugin in this marketplace has measured a relation
       * write on this surface, and an unmeasured write that fails silently
       * would report a correction as filed while nothing points anywhere.
       * Left unsaid, a user who named a valid target has every reason to
       * believe the link was set.
       */
      corrects: correction && correction.target ? correction.target : null,
      correctsNote: correction && correction.target
        ? 'THE CORRECTION WAS CHECKED AND THE RELATION IS NOT BEING WRITTEN. This version builds no Corrects link, so ' +
          'the new memo and the one it corrects will not point at each other until a person sets the relation in ' +
          'Notion. Say so when reporting, name both memos, and ask them to make the link. Reporting the correction ' +
          'as filed would be wrong, and `find` follows chains through that relation, so an unmade link is an ' +
          'unfollowable correction.'
        : 'No correction was named. This version writes no relation either way: Corrects, Artifacts and Projects are all set by hand for now.',
      appendOnly:
        'THIS PAGE IS FROZEN THE MOMENT IT PUBLISHES. The body and every content property are never edited, not for a ' +
        'typo. A correction is a new memo with Corrects set. There is no update command in this plugin to reach for.',
      note:
        'Create the page, then read it back and run `prove`. A Notion page can be created with an empty body on a ' +
        'silent partial failure, and a create call that returned without an error proves nothing.'
    }, null, 2))
  },

  prove (memoFile, readbackFile, createdUrl) {
    if (!memoFile || !readbackFile) {
      throw new Error('Usage: node memos.js prove <memo.json> <readback.json> <created-url>')
    }
    const final = readJson(memoFile, 'the memo', 'fields')
    const readback = readJson(readbackFile, 'the page as it came back', 'fields')
    const context = contextOrExit()

    proveCreate({
      what: 'memo',
      createdUrl,
      readback,
      intended: memo.properties(context, final, { today: final.today }),
      headings: memo.expectedHeadings(final),
      types: propertyTypes(context)
    })
  },

  find (file) {
    if (!file) throw new Error('Usage: node memos.js find <question.json>')
    const question = readJson(file, 'the question', 'fields')
    const context = contextOrExit()

    const where = []
    for (const field of ['Type', 'Domain']) {
      if (!question[field]) continue
      if (!schema.IDENTITY_VALUES[field].includes(question[field])) {
        throw new Error(`"${question[field]}" is not a ${field} this database has, so a query for it would return nothing and read as no answer.`)
      }
      where.push(`m.${identifier(context.property(field))} = ${literal(context.value(field, question[field]))}`)
    }

    /*
     * DRAFTS AND CANCELED MEMOS ARE EXCLUDED BY DEFAULT, AND THE RESULT SAYS
     * SO. `find` answers "what was said": a draft was never said, and a
     * canceled memo was retracted, so serving either silently is the log
     * lying. Both exclusions can be lifted, because "what did we retract" is a
     * real question too.
     */
    const excluded = []
    if (question.includeDrafts !== true) excluded.push('Draft')
    if (question.includeCanceled !== true) excluded.push('Canceled')
    if (excluded.length) where.push(notStatus(context, excluded))

    console.log(JSON.stringify({
      columns: columnMap(context),
      sql:
        `SELECT ${selectList(context)}\n` +
        'FROM <ds> AS m' +
        (where.length ? `\nWHERE ${where.join('\n  AND ')}` : '') +
        `\nORDER BY m.${identifier(publishedColumn(context))} DESC`,
      excluded,
      excludedNote: excluded.length
        ? `${excluded.join(' and ')} memos are excluded. Say so when reporting, rather than letting their absence read as nothing having been said.`
        : 'Nothing is excluded by status, because the question asked for everything.',
      note:
        'Replace <ds> with the quoted data source url. Text matching is not in the SQL: Type and Domain narrow it, ' +
        'newest first is the order, and which memo actually answers the question is the skill\'s judgment. ' +
        'BEFORE ANSWERING FROM ANY ROW whose Corrected by column is not empty, run `chain` and `follow`: ' +
        'a log that serves a superseded record silently is worse than one with no answer.'
    }, null, 2))
  },

  /**
   * The whole-table query correction-following reads.
   *
   * SEPARATE FROM `find` ON PURPOSE. `find` filters by type, domain and
   * status, and a correction chain does not respect any of those: the memo
   * that corrects a Release can be a plain Memo, and a retracted link in the
   * middle of a chain is still a link. Following a chain through filtered rows
   * reports a chain end that is only the end of what the filter let through.
   */
  chain () {
    const context = contextOrExit()
    console.log(JSON.stringify({
      columns: columnMap(context),
      sql:
        `SELECT ${selectList(context)}\n` +
        'FROM <ds> AS m',
      note:
        'Replace <ds> with the quoted data source url. This deliberately has no WHERE clause: a correction chain ' +
        'crosses types, domains and statuses, and a chain followed through filtered rows ends wherever the filter ' +
        'ran out rather than where the chain does. Pass what comes back to `follow` with the memo to start from.'
    }, null, 2))
  },

  /**
   * Walk the correction chain to its end, or report exactly what stops it.
   *
   * THE WRITE-TIME RULES BIND `new` AND A PERSON CLICKING IN NOTION IS BOUND
   * BY NOTHING, so this assumes nothing about its input. A cycle is reported
   * with its members and never broken. A branch, one memo corrected twice
   * independently, is a real disagreement between two people: both are shown
   * and neither is picked, because picking silently is how a log starts lying.
   */
  follow (rowsFile, memoUrl) {
    if (!rowsFile || !memoUrl) {
      throw new Error('Usage: node memos.js follow <rows.json> <memo-url>')
    }
    const context = contextOrExit()
    const rows = normaliseRows(context, readJson(rowsFile, 'the rows that came back'))

    const start = pageIdentity(memoUrl)
    if (!start) {
      throw new Error(`"${memoUrl}" is not a Notion page this can identify. Pass the memo's url.`)
    }

    const byIdentity = new Map()
    for (const row of rows) {
      if (row.identity) byIdentity.set(row.identity, row)
    }
    if (!byIdentity.has(start)) {
      throw new Error(
        'The memo to follow from is not in the rows. `chain` returns the whole table, so either these rows came ' +
        'from a filtered query, or the url names a page outside this database. Run `chain` and pass its result.'
      )
    }

    const violations = []
    const chain = []
    const visited = new Set()
    let current = start
    let stoppedBy = null

    while (true) {
      const row = byIdentity.get(current)
      if (!row) {
        // A correction pointing at a page the whole table does not hold is a
        // link out of the database, or a deleted memo. Either needs a person.
        violations.push({
          kind: 'chain-leaves-the-rows',
          at: current,
          say: `The chain points at ${current}, which is not in the rows. The whole table was fetched, so this is a correction pointing outside the Memos database or at a page that is gone. Reported, not resolved.`
        })
        stoppedBy = 'chain-leaves-the-rows'
        break
      }
      visited.add(current)
      chain.push({
        url: row.url,
        name: row.Name,
        publishedDate: row['Published date'],
        status: row.Status
      })

      // Rule 1, read back at read time: a memo corrects exactly one memo.
      // `new` refuses this at write time; a person in Notion is not bound.
      if (row.corrects.length > 1) {
        violations.push({
          kind: 'corrects-several',
          at: row.url,
          targets: row.corrects,
          say: `${row.Name || row.url} corrects ${row.corrects.length} memos, and a memo corrects exactly one. All are shown and no path is chosen.`
        })
      }

      const next = row.correctedBy
      if (!next.length) break

      if (next.length > 1) {
        // A branch is a disagreement between two people, not a tie to break.
        violations.push({
          kind: 'branch',
          at: row.url,
          corrections: next,
          say: `${row.Name || row.url} has been corrected ${next.length} times independently. That is a real disagreement: show every correction rather than picking the newer one.`
        })
        stoppedBy = 'branch'
        break
      }

      if (visited.has(next[0])) {
        violations.push({
          kind: 'cycle',
          members: [...visited],
          say: 'The corrections form a cycle, which a person built by hand. The memos in it are shown, and no place to break it is chosen, because where to break a cycle is a judgment about what somebody meant.'
        })
        stoppedBy = 'cycle'
        break
      }

      current = next[0]
    }

    const answered = stoppedBy ? null : chain[chain.length - 1]

    console.log(JSON.stringify({
      start,
      answered,
      versionsPassed: Math.max(0, chain.length - 1),
      chain,
      violations,
      note: stoppedBy
        ? 'The chain could not be followed to a single end. Every violation above is reported and none is resolved, because each one is a judgment about what somebody meant. Show them.'
        : answered && chain.length > 1
          ? `The answer is the end of the chain, ${chain.length - 1} version${chain.length === 2 ? '' : 's'} past the memo asked about. Say that an earlier version exists.` +
            (answered.status === 'Canceled' ? ' THE END OF THE CHAIN IS ITSELF CANCELED, so the most recent word on this was retracted. Say so.' : '')
          : 'Nothing corrects this memo. Answer from it as it stands.'
    }, null, 2))
    if (violations.length) process.exitCode = 1
  },

  /**
   * The queries a team update is assembled from, and it writes nothing here.
   *
   * ONE READ PER DATABASE. The date filtering happens in `window`, in
   * this script, rather than in SQL: the only date SQL measured on this
   * surface is calendar's window query, and duplicating its shape against
   * three more databases would be sending unmeasured SQL to save a fetch.
   * These tables are small; the honest route is fetch and partition.
   */
  'team-update' (file) {
    if (!file) throw new Error('Usage: node memos.js team-update <period.json>')
    const period = periodOrRefuse(file)
    const context = contextOrExit()
    const projects = foreignContextOrExit('projects', FOREIGN.projects)
    const calendar = foreignContextOrExit('calendar', FOREIGN.calendar)
    const tasks = foreignContextOrExit('tasks', FOREIGN.tasks)

    const projectsTimeline = foreignDateColumns(projects, 'Timeline')
    const calendarDate = foreignDateColumns(calendar, 'Date')
    const tasksDue = foreignDateColumns(tasks, 'Due date')

    console.log(JSON.stringify({
      period,
      memos: {
        columns: columnMap(context),
        sql:
          `SELECT ${selectList(context)}\n` +
          'FROM <memos-ds> AS m\n' +
          `WHERE m.${identifier(context.property('Status'))} = ${literal(context.value('Status', 'Published'))}`,
        what: 'Published memos. `window` keeps the Project Updates and Releases inside the period.'
      },
      projects: {
        columns: {
          url: 'url',
          Name: projects.property('Name'),
          Status: projects.property('Status'),
          Description: projects.property('Description'),
          'Timeline:start': projectsTimeline.start,
          'Timeline:end': projectsTimeline.end
        },
        sql:
          `SELECT p.url, p.${identifier(projects.property('Name'))}, p.${identifier(projects.property('Status'))}, ` +
          `p.${identifier(projects.property('Description'))}, p.${identifier(projectsTimeline.start)}, p.${identifier(projectsTimeline.end)}\n` +
          'FROM <projects-ds> AS p',
        what: 'Every project. `window` separates what is done from what is open and stuck.'
      },
      calendar: {
        columns: {
          url: 'url',
          Name: calendar.property('Name'),
          Type: calendar.property('Type'),
          Status: calendar.property('Status'),
          'Date:start': calendarDate.start,
          'Date:end': calendarDate.end
        },
        sql:
          `SELECT c.url, c.${identifier(calendar.property('Name'))}, c.${identifier(calendar.property('Type'))}, ` +
          `c.${identifier(calendar.property('Status'))}, c.${identifier(calendarDate.start)}, c.${identifier(calendarDate.end)}\n` +
          'FROM <calendar-ds> AS c',
        what: 'Every calendar row. `window` keeps what went out in the period and what is confirmed and coming.'
      },
      tasks: {
        optional: true,
        columns: {
          url: 'url',
          'Task name': tasks.property('Task name'),
          Status: tasks.property('Status'),
          'Due date:start': tasksDue.start,
          'Due date:end': tasksDue.end
        },
        sql:
          `SELECT t.url, t.${identifier(tasks.property('Task name'))}, t.${identifier(tasks.property('Status'))}, ` +
          `t.${identifier(tasksDue.start)}, t.${identifier(tasksDue.end)}\n` +
          'FROM <tasks-ds> AS t',
        what: 'Every task. Optional: read it only when a project\'s own status is not enough to tell the story. `window` surfaces the blocked ones.'
      },
      note:
        'Replace each <...-ds> with that database\'s quoted data source url. Run the first three, tasks only if ' +
        'needed, and pass everything to `window` with the same period file. The queries deliberately fetch whole ' +
        'tables: no date filter has been measured on this surface outside calendar\'s own window query, and an ' +
        'unmeasured filter that silently matches nothing would read as a quiet week.'
    }, null, 2))
  },

  /**
   * The fetched rows, partitioned into the period.
   *
   * IT PARTITIONS AND COUNTS, AND JUDGES NOTHING. What is worth a line is the
   * skill's call, made over these buckets. The one section that cannot be
   * assembled is named in the output rather than left to be noticed:
   * `SKILLS-memos.md` says Needs A Decision From You is the whole point, and
   * it cannot be derived from status fields.
   */
  window (periodFile, projectsFile, calendarFile, memosFile, tasksFile) {
    if (!periodFile || !projectsFile || !calendarFile || !memosFile) {
      throw new Error(
        'Usage: node memos.js window <period.json> <projects.json> <calendar.json> <memos.json> [tasks.json]. ' +
        'All three reads are required; pass a file holding [] only if a query genuinely returned nothing.'
      )
    }
    const { from, to } = periodOrRefuse(periodFile)
    const context = contextOrExit()
    const projects = foreignContextOrExit('projects', FOREIGN.projects)
    const calendar = foreignContextOrExit('calendar', FOREIGN.calendar)

    const memoRows = normaliseRows(context, readJson(memosFile, 'the memo rows'))

    const projectsTimeline = foreignDateColumns(projects, 'Timeline')
    const projectRows = rowList(readJson(projectsFile, 'the project rows')).map(raw => ({
      url: raw.url,
      name: raw[projects.property('Name')],
      status: toLogical(projects.reverse, 'Status', raw[projects.property('Status')] === undefined ? null : raw[projects.property('Status')]),
      description: raw[projects.property('Description')] === undefined ? null : raw[projects.property('Description')],
      timeline: {
        start: raw[projectsTimeline.start] === undefined ? null : raw[projectsTimeline.start],
        end: raw[projectsTimeline.end] === undefined ? null : raw[projectsTimeline.end]
      }
    }))

    const calendarDate = foreignDateColumns(calendar, 'Date')
    const calendarRows = rowList(readJson(calendarFile, 'the calendar rows')).map(raw => ({
      url: raw.url,
      name: raw[calendar.property('Name')],
      type: toLogical(calendar.reverse, 'Type', raw[calendar.property('Type')] === undefined ? null : raw[calendar.property('Type')]),
      status: toLogical(calendar.reverse, 'Status', raw[calendar.property('Status')] === undefined ? null : raw[calendar.property('Status')]),
      start: raw[calendarDate.start] === undefined ? null : raw[calendarDate.start],
      end: raw[calendarDate.end] === undefined ? null : raw[calendarDate.end]
    }))

    let blocked = null
    if (tasksFile) {
      const tasks = foreignContextOrExit('tasks', FOREIGN.tasks)
      const tasksDue = foreignDateColumns(tasks, 'Due date')
      blocked = rowList(readJson(tasksFile, 'the task rows'))
        .map(raw => ({
          url: raw.url,
          name: raw[tasks.property('Task name')],
          status: toLogical(tasks.reverse, 'Status', raw[tasks.property('Status')] === undefined ? null : raw[tasks.property('Status')]),
          due: raw[tasksDue.start] === undefined ? null : raw[tasksDue.start]
        }))
        .filter(task => task.status === 'Blocked')
    }

    const releases = []
    const projectUpdates = []
    let memosOutsidePeriod = 0
    let memosOtherTypes = 0
    for (const row of memoRows) {
      if (row.Type !== 'Release' && row.Type !== 'Project Update') { memosOtherTypes++; continue }
      if (!inWindow(row['Published date'], from, to)) { memosOutsidePeriod++; continue }
      const entry = { url: row.url, name: row.Name, publishedDate: row['Published date'] }
      if (row.Type === 'Release') releases.push(entry)
      else projectUpdates.push(entry)
    }

    const wentOut = []
    const upcoming = []
    let calendarCanceled = 0
    let calendarElsewhere = 0
    // The lookahead is the window's own length, so a weekly update looks a
    // week ahead and a monthly one a month, and the number is derived rather
    // than invented.
    const lookahead = new Date(Date.parse(`${to}T00:00:00Z`) + (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) + 86400000).toISOString().slice(0, 10)
    for (const row of calendarRows) {
      if (row.status === 'Canceled') { calendarCanceled++; continue }
      const touches = inWindow(row.start, from, to) || inWindow(row.end, from, to)
      if (touches && row.status === 'Done') { wentOut.push(row); continue }
      if (row.status === 'Confirmed' && row.start && String(row.start).slice(0, 10) > to &&
          String(row.start).slice(0, 10) <= lookahead) { upcoming.push(row); continue }
      calendarElsewhere++
    }

    const doneNow = []
    const open = []
    let projectsCanceled = 0
    for (const row of projectRows) {
      if (row.status === 'Canceled') { projectsCanceled++; continue }
      if (row.status === 'Done') { doneNow.push(row); continue }
      open.push(row)
    }

    console.log(JSON.stringify({
      period: { from, to },
      shipped: {
        releases,
        wentOut,
        doneProjects: doneNow,
        doneProjectsNote:
          'These projects are Done NOW. When each one finished is not recorded on a status field, so a project done ' +
          'long before this period appears here too. Cross-check against the releases and updates above before ' +
          'writing one into What Shipped, and say which evidence dated it.'
      },
      stillOpen: {
        projects: open,
        blocked,
        blockedNote: blocked === null
          ? 'Tasks were not read. Say the stuck list rests on project statuses alone.'
          : 'Blocked tasks, from the optional Tasks read.'
      },
      detail: {
        projectUpdates,
        projectUpdatesNote: 'The Project Updates inside the period. The related view carries the depth; What Shipped stays one line per item.'
      },
      upcoming: {
        rows: upcoming,
        lookahead,
        note: `Confirmed calendar rows starting after the period, up to ${lookahead}. The lookahead is the period's own length.`
      },
      needsADecision: null,
      needsADecisionNote:
        'THIS CANNOT BE ASSEMBLED, and that is the design. Knowing what is stuck and on whom requires reading ' +
        'between the status fields. Propose candidates from the stuck items above, ask the person, and if the ' +
        'honest answer is nothing this week, write that rather than deleting the section.',
      leftOut: {
        memosOutsidePeriod,
        memosOtherTypes,
        calendarCanceled,
        calendarOutsideWindow: calendarElsewhere,
        projectsCanceled,
        note: 'Counted rather than silent, so a quiet report can be told from a report that dropped things.'
      }
    }, null, 2))
  },

  /**
   * One Tasks payload per confirmed action out of a meeting.
   *
   * WRITES INTO ANOTHER PLUGIN'S DATABASE, WHICH IS THE DESIGN: any plugin may
   * write to any database, no plugin may call another plugin's skill. It is
   * the same Notion database either way, and config holds every id.
   *
   * AN ACTION WITHOUT A PERSON AND A DATE IS A WISH, and it never reaches
   * here: `SKILLS-memos.md` sends it to Open Questions instead. So both are
   * required, and the person is an id, because Notion identifies people by
   * uuid and a guessed owner is the fastest way to make a team stop trusting
   * the notes.
   */
  tasks (file) {
    if (!file) throw new Error('Usage: node memos.js tasks <actions.json>')
    const actions = readJson(file, 'the confirmed actions', 'list')
    const context = contextOrExit()
    const tasks = foreignContextOrExit('tasks', {
      properties: ['Task name', 'Status', 'Assignee', 'Due date', 'Description'],
      values: { Status: ['Not started'] },
      why: 'meeting-notes writes confirmed actions into Tasks.'
    })

    if (!actions.length) {
      throw new Error('The actions list is empty. Nothing to build, and building nothing is not worth reporting as done.')
    }

    const due = foreignDateColumns(tasks, 'Due date')
    const payloads = actions.map((action, index) => {
      if (!action || typeof action !== 'object' || Array.isArray(action)) {
        throw new Error(`actions[${index}] is ${describeShape(action)}, and an action is a set of fields: what, who, due.`)
      }
      if (typeof action.what !== 'string' || !action.what.trim()) {
        throw new Error(`actions[${index}] has no \`what\`. A task with no name is not a task.`)
      }
      if (!action.due) {
        throw new Error(`"${action.what}" has no \`due\`. An action without a date is a wish, and it belongs under Open Questions rather than in Tasks.`)
      }
      dayOrRefuse(action.due, `actions[${index}].due`)
      let assignee
      if (action.who === 'me') {
        if (!context.personId) {
          throw new Error(
            `"${action.what}" is assigned to "me" and the config records no person, so there is nobody to write. ` +
            'Search the workspace users for the person and pass their id.'
          )
        }
        assignee = context.personId
      } else {
        if (action.who === undefined || action.who === null || action.who === '') {
          throw new Error(`"${action.what}" has no \`who\`. An action without a person is a wish, and it belongs under Open Questions rather than in Tasks.`)
        }
        assignee = memo.personIdFrom(action.who)
      }

      const properties = {
        [tasks.property('Task name')]: String(action.what).trim(),
        [tasks.property('Status')]: tasks.value('Status', 'Not started'),
        [tasks.property('Assignee')]: [assignee],
        [due.start]: dayOrRefuse(action.due, `actions[${index}].due`),
        [due.end]: null
      }
      if (action.description) properties[tasks.property('Description')] = String(action.description)

      return { parent: { data_source_id: tasks.dataSourceId }, properties }
    })

    console.log(JSON.stringify({
      tasks: payloads,
      projectRelationNote:
        'THE PROJECT RELATION IS NOT WRITTEN. No plugin here has measured a relation write on this surface, so ' +
        'every task created from these payloads is an orphan until a person links it to its project in Notion, and ' +
        'orphan tasks are exactly what the Tasks "Needs attention" view surfaces. Say so when reporting, and name ' +
        'the project each task belongs to so the links can be made.',
      note:
        'Create each task, then re-fetch it and run `prove-task` per task. A create call that returned without an ' +
        'error proves nothing.'
    }, null, 2))
  },

  'prove-task' (taskFile, readbackFile, createdUrl) {
    if (!taskFile || !readbackFile) {
      throw new Error('Usage: node memos.js prove-task <task.json> <readback.json> <created-url>')
    }
    const intended = readJson(taskFile, 'the task that was sent', 'fields')
    if (!intended.properties || typeof intended.properties !== 'object' || Array.isArray(intended.properties)) {
      throw new Error('That file is not one task from `tasks`. It needs the `properties` that command printed for the task.')
    }
    const readback = readJson(readbackFile, 'the page as it came back', 'fields')
    const tasks = foreignContextOrExit('tasks', {
      properties: ['Task name', 'Status', 'Assignee', 'Due date', 'Description'],
      values: { Status: ['Not started'] },
      why: 'proving a task write needs the same names the write used.'
    })

    const due = foreignDateColumns(tasks, 'Due date')
    const types = {
      [tasks.property('Task name')]: 'title',
      [tasks.property('Status')]: 'select',
      [tasks.property('Assignee')]: 'people',
      [tasks.property('Description')]: 'rich_text',
      [due.start]: 'date',
      [due.end]: 'date'
    }

    proveCreate({
      what: 'task',
      createdUrl,
      readback,
      intended: intended.properties,
      headings: [],
      types
    })
  }
}

// Which Notion type each written Memos column holds. Lives in the vendored
// memo builder since 2026-08-24, beside the `properties` it has to agree with.
const propertyTypes = memo.propertyTypes

/**
 * The one proof for a create, shared by `prove` and `prove-task`.
 *
 * THE PROOF IS BOUND TO THE PAGE THAT WAS CREATED, for the reason `process`
 * and `calendar` both learned: without the url, this checks that SOME page has
 * the right shape, and a page created malformed passes as long as the one read
 * back is fine.
 *
 * VALUES ARE COMPARED THROUGH THE TYPE, NOT AS STRINGS. A person comes back
 * prefixed, a list as a JSON array in a string, a date can carry a time.
 * Compared raw, a perfect write reads as a failed one, and a proof that fails
 * on a perfect write teaches the next person to ignore it.
 */
function proveCreate ({ what, createdUrl, readback, intended, headings, types }) {
  const problems = []
  const checked = []
  const unchecked = []

  const created = pageIdentity(createdUrl)
  if (!created) {
    throw new Error(
      `prove needs the url the create call returned, and got ${JSON.stringify(createdUrl)}. Without it this checks ` +
      `that some page has the right shape rather than that the ${what} just written does.`
    )
  }
  const got = pageIdentity(readback && (readback.url || (readback.page && readback.page.url)))
  if (!got) {
    problems.push({ what: 'the page that came back', why: 'It carries no usable url, so nothing can say it is the page that was just created. Save the whole page, keeping its url.' })
  } else if (got !== created) {
    problems.push({
      what: 'the page that came back',
      why: `It is not the page that was created. Created ${created}, read back ${got}. Nothing below was checked, because checking a different page reports a clean write on the wrong ${what}.`
    })
  }

  if (!problems.length && (!readback || !readback.properties || typeof readback.properties !== 'object' || Array.isArray(readback.properties))) {
    problems.push({ what: 'the read-back', why: 'There are no properties to check, so nothing about this write has been proved. Save the whole page, not a summary of it.' })
  }

  if (!problems.length) {
    for (const [name, sent] of Object.entries(intended)) {
      const back = readback.properties[name]
      if (back === undefined) {
        // A null sent on purpose, the empty half of a date pair, is allowed to
        // be absent: Notion leaves an empty property off a page.
        if (sent === null || cameBackEmpty(sent)) {
          checked.push({ what: name, type: 'empty, and absent from the page, which is how Notion returns an empty property' })
          continue
        }
        problems.push({ what: name, why: 'The property is not on the page that came back. Notion discarded it without reporting an error.' })
        continue
      }
      const type = types[name]
      if (!type) {
        unchecked.push({ what: name, why: 'Nothing here knows which type this column holds, so its value was not compared. It is on the page.' })
        continue
      }
      const verdict = compareProperty(type, sent, back)
      if (verdict.state === 'same') { checked.push({ what: name, type }); continue }
      if (verdict.state === 'unchecked') { unchecked.push({ what: name, why: verdict.why }); continue }
      problems.push({ what: name, why: `Sent ${JSON.stringify(verdict.sent)} and the page came back with ${JSON.stringify(verdict.back)}.` })
    }

    const backHeadings = (readback.headings || []).map(h => String(h).trim())
    for (const heading of headings) {
      if (backHeadings.includes(heading)) checked.push({ what: heading, type: 'heading' })
      else problems.push({ what: heading, why: 'The section heading is not on the page. Write it again rather than reporting success.' })
    }
    if (headings.length) {
      unchecked.push({
        what: 'the body text',
        why: 'Only the headings were compared. What is written under them was not read back, so a heading with nothing under it passes this check.'
      })
    }
  }

  const comparedNothing = checked.length === 0

  console.log(JSON.stringify({
    proved: problems.length === 0 && !comparedNothing,
    problems,
    checked,
    unchecked,
    note: problems.length
      ? `The ${what} did not land as sent. Do not report it as done.`
      : comparedNothing
        ? 'Nothing was compared, so nothing is proved.'
        : 'Everything sent came back matching. The list above says what was not looked at.'
  }, null, 2))
  if (problems.length || comparedNothing) process.exitCode = 1
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
  normaliseRows,
  columnMap,
  selectList,
  reverseValues,
  relatedIdentities,
  notStatus,
  inWindow,
  identifier,
  literal,
  propertyTypes
}

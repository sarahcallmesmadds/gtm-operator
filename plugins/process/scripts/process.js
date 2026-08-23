'use strict'

/**
 * The command layer. This file decides what to send; the skill sends it.
 *
 * The Notion calls go through the connected client, which a script cannot
 * reach, so every query is built here, every answer is judged here, and the
 * model makes the calls in between. That is the shape `setup`'s `check.js` and
 * `calendar.js` already use, and following it means one convention in this
 * marketplace rather than three.
 *
 * WHY NOT LET THE SKILL COMPOSE THE QUERIES. A workspace renames properties and
 * option values. A query carrying the names this plugin shipped with asks about
 * names nobody uses and comes back with no rows, and no rows is exactly what an
 * empty library looks like. Every query below resolves its names through the
 * config map for that reason.
 *
 * `<ds>` is left where it is, for the caller to replace with the quoted data
 * source url, which is the convention `setup`'s `views.js` and `rules.js`
 * already use.
 *
 *   node process.js context                                what config says, or why it refuses
 *   node process.js check <proposed.json>                  what is wrong with this artifact, and what to ask about
 *   node process.js duplicates <proposed.json>             the query the near-duplicate check reads
 *   node process.js judge <proposed.json> <rows.json>      which existing artifacts are near matches
 *   node process.js create <artifact.json>                 the properties payload and the body
 *   node process.js prove <artifact.json> <readback.json>  did the create land
 *   node process.js find <question.json>                   the query find reads
 *   node process.js trust <rows.json> [YYYY-MM-DD]         which of these is still worth trusting
 */

const fs = require('fs')
const path = require('path')

const config = require(path.join(__dirname, 'vendor', 'config-read'))
const schema = require(path.join(__dirname, 'vendor', 'process-schema'))
const artifact = require(path.join(__dirname, 'artifact'))

const KEY = 'process'

/** `"` inside an identifier is doubled, which is how SQL escapes it. */
const identifier = name => `"${String(name).split('"').join('""')}"`
/** `'` inside a literal is doubled, the same way. */
const literal = value => `'${String(value).split("'").join("''")}'`

/**
 * The similarity threshold above which two artifacts are a near match.
 *
 * DELIBERATELY NOT INHERITED. The reference used 70% on title and topic, and
 * `SKILLS-process.md` says in as many words to pick this against real artifacts
 * rather than taking that number, because a similarity threshold set blind ends
 * up either silent or unusable.
 *
 * NOTHING HAS MEASURED THIS. 0.5 is here so the check runs at all, it is
 * reported in every result so nobody reads a score as calibrated, and it is
 * overridable per call. The first real library is what settles it, and until
 * then the skill shows the candidates and the person decides, which is the whole
 * reason a wrong threshold is survivable here.
 */
const DEFAULT_THRESHOLD = 0.5
const THRESHOLD_IS_MEASURED = false

function contextOrExit () {
  const context = config.contextFor(KEY, schema.IDENTITY)
  if (!context.ok) {
    console.error(context.message)
    process.exit(1)
  }
  return context
}

function readJson (file, what) {
  let raw
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch (err) {
    throw new Error(`Could not read ${what} at ${file}: ${err.message}`)
  }
  try {
    return JSON.parse(raw)
  } catch (err) {
    throw new Error(`${file} is not valid JSON, so ${what} could not be read: ${err.message}`)
  }
}

/**
 * The columns every query selects, and what each one is called logically.
 *
 * BOTH HALVES MATTER, for the reason written on the calendar equivalent: the
 * SQL has to ask for the workspace's names and everything downstream reads
 * logical ones, so the mapping travels with the query. Without it a renamed
 * workspace returns rows whose keys the judge does not recognise, and every one
 * of them reads as untyped and unverified: a clean result from a check that saw
 * nothing.
 *
 * `url` rather than the title, deliberately: a title is not an identity, two
 * artifacts can share one, and a report naming rows by title cannot be clicked
 * through to the row it means.
 */
const SELECTED = [
  'Name',
  'Description',
  'Type',
  'Domain',
  'Audience',
  'Status',
  'Review cadence',
  'Last checked for accuracy',
  'Verified date'
]

function selectList (context) {
  return ['c.url']
    .concat(SELECTED.map(logical => `c.${identifier(context.property(logical))}`))
    .join(', ')
}

function columnMap (context) {
  const map = { url: 'url' }
  for (const logical of SELECTED) map[logical] = context.property(logical)
  return map
}

/**
 * The list of rows inside whatever the query returned.
 *
 * A MISSING RESULT IS NOT AN EMPTY ONE. Returning `[]` for null is how a query
 * that was never sent reads as a library with nothing in it, and then gets
 * reported as checked. `results` is the envelope measured on 2026-08-19 for this
 * SQL surface; `rows` and `data` are accepted and have never been seen here.
 */
function rowList (rows) {
  if (rows === null || rows === undefined) {
    throw new Error(
      'There are no rows to read. That is a query that was not sent or a result saved as null, ' +
      'which is a different thing from a library with nothing in it, and it is not being reported as one.'
    )
  }
  if (Array.isArray(rows)) return rows
  for (const envelope of ['results', 'rows', 'data']) {
    if (Array.isArray(rows[envelope])) return rows[envelope]
  }
  throw new Error(
    `The rows are in a shape this does not recognise: ${Object.keys(rows).join(', ') || typeof rows}. ` +
    'Expected an array, or an object with results, rows or data. Refusing rather than guessing, ' +
    'because a guess that returns nothing reads exactly like an empty library.'
  )
}

/**
 * The workspace's option names, mapped back to the logical ones. Deliberately
 * the same shape as `logicalValues` in `plugins/calendar/scripts/calendar.js`,
 * because it is the same problem.
 *
 * A value the map does not carry is passed through unchanged rather than
 * dropped. It is a value the workspace added and this plugin never shipped, and
 * reporting it as itself is better than reporting it as nothing.
 */
function logicalValues (context) {
  const values = (context.names && context.names.values) || {}
  const reverse = {}
  for (const [property, options] of Object.entries(values)) {
    reverse[property] = {}
    for (const [logical, workspace] of Object.entries(options || {})) {
      reverse[property][workspace] = logical
    }
  }
  return reverse
}

/**
 * Rows keyed by logical name rather than by whatever the workspace calls them,
 * AND carrying logical option values rather than the workspace's.
 *
 * BOTH HALVES ARE NEEDED AND ONLY ONE USED TO BE DONE. Queries go out carrying
 * the workspace's own value names, through `context.value`, so what comes back
 * is renamed on both axes. Every judgment downstream compares against the
 * logical constants: `staleness` looks the cadence up in `CADENCES`, and `judge`
 * compares the type against `PARENT_TYPE`. With the names mapped and the values
 * left raw, a renamed workspace read every artifact's cadence as unrecognised,
 * so every trust judgment came back "unknown" and no Strategy Decision was ever
 * recognised as one. Both failures are silent, and "unknown" is the answer this
 * plugin gives for a cadence it has genuinely never seen, so nothing about the
 * output said the map was the cause.
 *
 * `_raw` still carries the row exactly as it arrived, for anything that needs
 * what the workspace actually said.
 */
function normaliseRows (context, rows) {
  const map = columnMap(context)
  const back = logicalValues(context)
  const toLogical = (logical, value) => {
    const options = back[logical]
    if (!options) return value
    if (Array.isArray(value)) return value.map(entry => (entry in options ? options[entry] : entry))
    return value in options ? options[value] : value
  }

  return rowList(rows).map(row => {
    const out = {}
    for (const [logical, actual] of Object.entries(map)) out[logical] = toLogical(logical, row[actual])
    out._raw = row
    return out
  })
}

// ---------------------------------------------------------------- similarity

/** Words worth comparing: lowercased, punctuation dropped, stop words removed. */
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'how', 'in',
  'is', 'it', 'of', 'on', 'or', 'our', 'the', 'to', 'we', 'what', 'when',
  'where', 'which', 'why', 'with'
])

function tokens (text) {
  if (typeof text !== 'string') return []
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word && !STOP_WORDS.has(word))
}

/**
 * How alike two artifacts are, between 0 and 1.
 *
 * Overlap over union across the name and the description together, which is the
 * "title and topic" the reference compared. It is a blunt measure and is meant
 * to be: it produces candidates for a person to look at, and `SKILLS-process.md`
 * says the duplicate check runs before structuring precisely so a near match
 * costs one question rather than a merged-away document.
 */
function similarity (left, right) {
  const a = new Set(tokens(left))
  const b = new Set(tokens(right))
  if (!a.size || !b.size) return 0

  let shared = 0
  for (const word of a) if (b.has(word)) shared++

  const union = a.size + b.size - shared
  return union ? shared / union : 0
}

// ------------------------------------------------------------------- staleness

/**
 * Whether an artifact is past its review cadence, and everything that stops
 * this from being able to say.
 *
 * THREE ANSWERS, NOT TWO. `due` and `fresh` are the easy ones. `unknown` covers
 * an artifact that has never been checked, one whose cadence this version does
 * not recognise, and one whose date will not parse, and collapsing any of those
 * into `fresh` is how a library serves a stale document silently, which
 * `SKILLS-process.md` calls worse than having no answer.
 *
 * A cadence of `None` or `On change only` is `exempt` rather than `fresh`: it
 * has opted out of time-based checking and is still subject to every other
 * audit signal.
 */
function staleness (row, today) {
  const cadence = row['Review cadence']
  const checked = row['Last checked for accuracy']

  if (!cadence) {
    return { state: 'unknown', why: 'No review cadence is set, so there is nothing to measure against.' }
  }

  const days = schema.cadenceDays(cadence)
  if (days === undefined) {
    return { state: 'unknown', why: `The cadence is "${cadence}", which this version does not recognise. It is not being read as exempt.` }
  }
  if (days === null) {
    return { state: 'exempt', why: `The cadence is "${cadence}", which opts out of time-based checking. Every other audit signal still applies.` }
  }

  if (!checked) {
    return { state: 'unknown', why: 'It has never been checked for accuracy, so there is no date to measure from.' }
  }

  const from = Date.parse(`${String(checked).slice(0, 10)}T00:00:00Z`)
  const now = Date.parse(`${String(today).slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(from) || Number.isNaN(now)) {
    return { state: 'unknown', why: `Could not read "${checked}" as a date, so nothing has been measured.` }
  }

  const elapsed = Math.floor((now - from) / 86400000)
  if (elapsed > days) {
    return {
      state: 'due',
      elapsed,
      days,
      why: `Last checked ${elapsed} days ago against a ${cadence.toLowerCase()} cadence, which is ${days} days.`
    }
  }
  return { state: 'fresh', elapsed, days, why: `Checked ${elapsed} days ago, inside its ${days}-day cadence.` }
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
        : 'No person is recorded, so Owner and Verified by are omitted rather than written empty. That is a working install, not a failed one.',
      names: context.names
    }, null, 2))
  },

  check (file) {
    if (!file) throw new Error('Usage: node process.js check <proposed.json>')
    const proposed = readJson(file, 'the proposed artifact')

    const problems = artifact.problems(proposed, { parentType: proposed.parentType })
    const concerns = artifact.concerns(proposed)

    console.log(JSON.stringify({
      writable: problems.length === 0,
      problems,
      concerns,
      wordCount: artifact.wordCount(proposed),
      ceiling: schema.WORD_CEILING,
      note: problems.length
        ? 'Every problem here is a refusal. Notion rejects a bad select value as a whole, so a drafted artifact is lost at write time rather than partly saved.'
        : 'Nothing blocks this write. Anything under concerns is a question for the user, not a fault.'
    }, null, 2))
  },

  duplicates (file) {
    if (!file) throw new Error('Usage: node process.js duplicates <proposed.json>')
    const proposed = readJson(file, 'the proposed artifact')
    const context = contextOrExit()

    const name = String(proposed.Name || '').trim()
    if (!name) {
      console.log(JSON.stringify({
        sql: null,
        why: 'This artifact has no name, so there is nothing to look for a near match of.'
      }, null, 2))
      return
    }

    console.log(JSON.stringify({
      columns: columnMap(context),
      // ARCHIVED ROWS ARE INCLUDED. An archived artifact is exactly the thing
      // somebody is about to write again, and a duplicate check that cannot see
      // it is a check that misses its most likely hit.
      sql:
        `SELECT ${selectList(context)}\n` +
        `FROM <ds> AS c`,
      note:
        'Replace <ds> with the quoted data source url. This deliberately has no WHERE clause: the comparison ' +
        'is over tokens in the name and description, and no SQL filter here reproduces that. Pass what comes ' +
        'back to `judge`, which does the comparing.',
      threshold: DEFAULT_THRESHOLD,
      thresholdIsMeasured: THRESHOLD_IS_MEASURED
    }, null, 2))
  },

  judge (proposedFile, rowsFile, thresholdArg) {
    if (!proposedFile || !rowsFile) {
      throw new Error('Usage: node process.js judge <proposed.json> <rows.json> [threshold]')
    }
    const proposed = readJson(proposedFile, 'the proposed artifact')
    const rows = readJson(rowsFile, 'the rows that came back')
    const context = contextOrExit()

    const threshold = thresholdArg === undefined ? DEFAULT_THRESHOLD : Number(thresholdArg)
    if (Number.isNaN(threshold) || threshold < 0 || threshold > 1) {
      throw new Error(`"${thresholdArg}" is not a threshold. It is a number between 0 and 1.`)
    }

    const subject = `${proposed.Name || ''} ${proposed.Description || ''}`
    const scored = normaliseRows(context, rows).map(row => ({
      url: row.url,
      name: row.Name,
      type: row.Type,
      status: row.Status,
      score: Number(similarity(subject, `${row.Name || ''} ${row.Description || ''}`).toFixed(3))
    })).sort((a, b) => b.score - a.score)

    const matches = scored.filter(row => row.score >= threshold)

    // A REPLACEMENT IS NOT A DUPLICATE, and the difference decides what happens
    // next. A Strategy Decision reaching a different decision on the same
    // problem is a supersede: show both decisions side by side, ask, and only on
    // a yes set the relation and archive the old one.
    const replacements = matches.filter(
      row => row.type === schema.PARENT_TYPE && proposed.Type === schema.PARENT_TYPE
    )

    console.log(JSON.stringify({
      threshold,
      thresholdIsMeasured: THRESHOLD_IS_MEASURED,
      thresholdNote:
        'This number is not calibrated. It is here so the check runs, and the candidates below are for a person ' +
        'to look at rather than a verdict. Set it against real artifacts once there are some.',
      compared: scored.length,
      matches,
      possibleReplacements: replacements,
      replacementNote: replacements.length
        ? 'Both this and the match are Strategy Decisions. If the existing one reaches a different decision on the same problem, ' +
          'that is a replacement rather than a duplicate: show both decisions side by side, ask, and only on a yes set Supersedes and archive the old one.'
        : null,
      top: scored.slice(0, 5)
    }, null, 2))
  },

  create (file) {
    if (!file) throw new Error('Usage: node process.js create <artifact.json>')
    const final = readJson(file, 'the artifact')
    const context = contextOrExit()

    const properties = artifact.properties(context, final, {
      parentType: final.parentType,
      today: final.today
    })

    console.log(JSON.stringify({
      parent: { data_source_id: context.dataSourceId },
      properties,
      body: artifact.body(final),
      headings: artifact.expectedHeadings(final),
      relatedView: schema.RELATED_VIEW[final.Type],
      note:
        'Create the page, then read it back and run `prove`. A Notion page can be created with an empty body ' +
        'on a silent partial failure, and a create call that returned without an error proves nothing.'
    }, null, 2))
  },

  prove (artifactFile, readbackFile) {
    if (!artifactFile || !readbackFile) {
      throw new Error('Usage: node process.js prove <artifact.json> <readback.json>')
    }
    const final = readJson(artifactFile, 'the artifact')
    const readback = readJson(readbackFile, 'the page as it came back')
    const context = contextOrExit()

    const problems = []
    const checked = []
    const unchecked = []

    if (!readback || !readback.properties) {
      console.log(JSON.stringify({
        proved: false,
        problems: [{ what: 'the read-back', why: 'There is no read-back to check, so nothing about this write has been proved.' }],
        checked,
        unchecked
      }, null, 2))
      process.exitCode = 1
      return
    }

    const intended = artifact.properties(context, final, { parentType: final.parentType, today: final.today })

    for (const [name, value] of Object.entries(intended)) {
      const got = readback.properties[name]
      if (got === undefined) {
        problems.push({ what: name, why: 'The property is not on the page that came back. Notion discarded it without reporting an error.' })
        continue
      }
      // Only presence is compared here. Notion spells a value back in its own
      // shape, and comparing those without a per-type reader is how a false
      // difference gets reported as a failed write.
      unchecked.push({ what: name, why: 'The property is on the page. What it holds was not compared, because that needs a reader per property type.' })
    }

    const headings = (readback.headings || []).map(h => String(h).trim())
    for (const heading of artifact.expectedHeadings(final)) {
      if (headings.includes(heading)) checked.push({ what: heading, type: 'heading' })
      else problems.push({ what: heading, why: 'The section heading is not on the page. Write it again rather than reporting success.' })
    }

    unchecked.push({
      what: 'the body text',
      why: 'Only the headings were compared. What is written under them was not read back, so a heading with nothing under it passes this check.'
    })

    console.log(JSON.stringify({ proved: problems.length === 0, problems, checked, unchecked }, null, 2))
    if (problems.length) process.exitCode = 1
  },

  find (file) {
    if (!file) throw new Error('Usage: node process.js find <question.json>')
    const question = readJson(file, 'the question')
    const context = contextOrExit()

    const where = []
    // ONLY Type AND Domain GO INTO THE SQL. `SKILLS-process.md` gives this skill
    // Type, Domain and Audience as its judgment, but Audience holds several
    // values at once and no multi-value predicate on this surface has been
    // proved: `plugins/setup/scripts/views.js` records a multi-select filter
    // rejected with a 400, alongside two more Notion filters that were accepted
    // and then did not work. So Audience is answered below rather than queried,
    // and the one thing it must never do is vanish without a word.
    for (const field of ['Type', 'Domain']) {
      if (!question[field]) continue
      if (!schema.IDENTITY_VALUES[field].includes(question[field])) {
        throw new Error(`"${question[field]}" is not a ${field} this database has, so a query for it would return nothing and read as no answer.`)
      }
      where.push(`c.${identifier(context.property(field))} = ${literal(context.value(field, question[field]))}`)
    }

    // ARCHIVED IS EXCLUDED BY DEFAULT AND SAYS SO. An archived artifact is a
    // wrong answer to "what do we do", and silently dropping it is different
    // from saying it was dropped.
    const includeArchived = question.includeArchived === true
    if (!includeArchived) {
      where.push(`(c.${identifier(context.property('Status'))} IS NULL OR c.${identifier(context.property('Status'))} != ${literal(context.value('Status', 'Archive'))})`)
    }

    console.log(JSON.stringify({
      columns: columnMap(context),
      sql:
        `SELECT ${selectList(context)}\n` +
        'FROM <ds> AS c' +
        (where.length ? `\nWHERE ${where.join('\n  AND ')}` : ''),
      includeArchived,
      archivedNote: includeArchived
        ? 'Archived artifacts are included, because the question asked for them.'
        : 'Archived artifacts are excluded. Say so when reporting, rather than letting their absence read as nothing existing.',
      audience: question.Audience === undefined ? null : question.Audience,
      audienceNote: question.Audience === undefined
        ? 'No Audience was asked for. Type and Domain are the only filters in the SQL.'
        : 'AUDIENCE IS NOT IN THE SQL. It was asked for and it did not narrow this query, so these rows are wider than the question. Weigh it yourself over the rows that come back, and say you did.',
      note:
        'Replace <ds> with the quoted data source url. Text matching is not in the SQL: ' +
        'Type and Domain narrow it, Audience does not and is read back to you above, ' +
        'and which artifact actually answers the question is the skill\'s judgment. ' +
        'Pass what comes back to `trust` before answering from any of it.'
    }, null, 2))
  },

  trust (rowsFile, todayArg) {
    if (!rowsFile) throw new Error('Usage: node process.js trust <rows.json> [YYYY-MM-DD]')
    const rows = readJson(rowsFile, 'the rows that came back')
    const context = contextOrExit()

    const today = todayArg || new Date().toISOString().slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) {
      throw new Error(`"${today}" is not a date in YYYY-MM-DD form.`)
    }

    const judged = normaliseRows(context, rows).map(row => ({
      url: row.url,
      name: row.Name,
      type: row.Type,
      status: row.Status,
      cadence: row['Review cadence'],
      lastChecked: row['Last checked for accuracy'],
      trust: staleness(row, today)
    }))

    const counts = judged.reduce((out, row) => {
      out[row.trust.state] = (out[row.trust.state] || 0) + 1
      return out
    }, {})

    console.log(JSON.stringify({
      today,
      counts,
      rows: judged,
      note:
        'Say the trust state in the same breath as the answer. A library that serves a stale document silently ' +
        'is worse than one with no answer, because the reader has no way to know. "unknown" is not "fresh".'
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
  DEFAULT_THRESHOLD,
  THRESHOLD_IS_MEASURED,
  SELECTED,
  identifier,
  literal,
  selectList,
  columnMap,
  rowList,
  normaliseRows,
  tokens,
  similarity,
  staleness
}

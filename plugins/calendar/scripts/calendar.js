'use strict'

/**
 * The command layer. This file decides what to send; the skill sends it.
 *
 * The Notion calls go through the connected client, which a script cannot
 * reach, so every query is built here, every answer is judged here, and the
 * model makes the calls in between. That is the same shape `setup`'s `check.js`
 * uses, and following it means one convention in this marketplace rather than
 * two.
 *
 * WHY NOT LET THE SKILL COMPOSE THE QUERIES. A workspace renames properties and
 * option values. A query carrying the names this plugin shipped with asks about
 * names nobody uses and comes back with no rows, and no rows is exactly what a
 * clean calendar looks like. Every query below resolves its names through the
 * config map for that reason.
 *
 * `<ds>` is left where it is, for the caller to replace with the quoted data
 * source url. That is the convention `setup`'s `views.js` and `rules.js`
 * already use, and nothing in this repository has measured what that
 * substitution looks like, so nothing here invents it.
 *
 *   node calendar.js context                            what config says, or why it refuses
 *   node calendar.js window <YYYY-MM-DD> [<YYYY-MM-DD>] the query for the clash window
 *   node calendar.js judge <proposed.json> <rows.json>  clashes and duplicates
 *   node calendar.js normalise <rows.json>              rows in the shape the judge reads
 *
 * `judge` and `report` normalise what they are given, so no skill calls
 * `normalise` in a working sequence. It is here to look at rows by hand when a
 * result does not read the way somebody expected.
 *   node calendar.js check <proposed.json>              what is wrong with this row
 *   node calendar.js create <row.json>                  the properties payload and the body
 *   node calendar.js update <before.json> <after.json>  the update payload, including what to empty
 *   node calendar.js prove <row.json> <readback.json> <url>   did the create land
 *   node calendar.js prove-update <update.json> <readback.json>  did the update land
 *   node calendar.js soon <from> <to>                   the query soon reads
 *   node calendar.js report <dated.json> <undated.json> what soon reports, from the rows as they came back
 */

const fs = require('fs')
const path = require('path')

const config = require(path.join(__dirname, 'vendor', 'config-read'))
const schema = require(path.join(__dirname, 'vendor', 'calendar-schema'))
const clash = require(path.join(__dirname, 'clash'))
const row = require(path.join(__dirname, 'row'))
const { pageIdentity } = require(path.join(__dirname, 'vendor', 'page-id'))

const KEY = 'calendar'

/** `"` inside an identifier is doubled, which is how SQL escapes it. */
const identifier = name => `"${String(name).split('"').join('""')}"`
/** `'` inside a literal is doubled, the same way. */
const literal = value => `'${String(value).split("'").join("''")}'`

/**
 * "Not canceled", written so a row with no status at all still qualifies.
 *
 * `c."Status" != 'Canceled'` IS NOT FALSE FOR A ROW WITH NO STATUS, IT IS
 * UNKNOWN, and SQL keeps only the rows a WHERE clause is true for. So the
 * obvious spelling drops every row whose status is null, which is a row
 * somebody created by hand or a row an import left half-built: exactly the
 * malformed rows a clash check and a `soon` report exist to surface. Silently
 * dropping them contradicts the promise `soon` makes in its own SKILL.md, that
 * it never drops a row it cannot place.
 *
 * The empty string and `'[]'` are here for the same reason the undated test
 * carries them: they are defensive, covering three plausible spellings of an
 * absent value. NOTHING HERE HAS MEASURED WHICH ONE THIS SQL SURFACE ACTUALLY
 * RETURNS. An earlier version of this comment said all three had been observed;
 * no run in this repository supports that.
 * `normaliseRows` turns each of them back into a missing status, and `report`
 * counts them.
 */
function notCanceled (context) {
  const status = identifier(context.property('Status'))
  const canceled = literal(context.value('Status', 'Canceled'))
  return `(c.${status} IS NULL OR c.${status} = '' OR c.${status} = '[]' OR c.${status} != ${canceled})`
}

/**
 * The context, or a message and a non-zero exit.
 *
 * Every command needs it, and every command fails the same way without it, so
 * the refusal is written once. The message is the whole remedy: a skill that
 * printed "could not read config" would send somebody looking in the wrong file.
 */
function contextOrExit () {
  const context = config.contextFor(KEY, schema.IDENTITY)
  if (!context.ok) {
    console.error(context.message)
    process.exit(context.code === config.REFUSAL.NO_CONFIG ? 2 : 1)
  }
  return context
}

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'))

/**
 * A date shifted by a number of days, as YYYY-MM-DD.
 *
 * Built off the string rather than through the local timezone, for the reason
 * given in `clash.js`: `new Date('2026-08-19')` is midnight UTC, and west of
 * Greenwich that is the previous day, which would shift every window by a day.
 */
function shiftDay (date, days) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date).trim())
  if (!match) throw new Error(`"${date}" is not a date. Use YYYY-MM-DD.`)
  const [, y, m, d] = match

  // THE SAME ROUND TRIP `clash.dayNumber` DOES, and for the same reason. Fixing
  // the comparison side alone left this one rolling 2026-02-31 forward to
  // 2026-03-03, so a window was widened from a day nobody wrote while the README
  // said the date parser had been fixed. A partial fix that gets announced as a
  // whole one is worse than no fix.
  const exact = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)))
  if (exact.getUTCFullYear() !== Number(y) ||
      exact.getUTCMonth() !== Number(m) - 1 ||
      exact.getUTCDate() !== Number(d)) {
    throw new Error(`"${date}" is not a day that exists. Check the month length before building a window from it.`)
  }

  const at = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d) + days))
  return at.toISOString().slice(0, 10)
}

/**
 * The two columns a date property is actually queryable through.
 *
 * A DATE PROPERTY IS NOT QUERYABLE UNDER ITS OWN NAME. Notion exposes it as
 * `date:<name>:start` and `date:<name>:end`, which is what the SQLite table
 * definition shows. Measured in this repository and applied by
 * `plugins/setup/scripts/views.js`; asking for `c."Date"` fails or returns
 * nothing, and returning nothing is exactly what a clean calendar looks like.
 *
 * The name inside the prefix is the workspace's name for the property, not the
 * one this plugin shipped with.
 */
function dateColumns (context) {
  const name = context.property('Date')
  return {
    start: `"date:${String(name).split('"').join('""')}:start"`,
    end: `"date:${String(name).split('"').join('""')}:end"`
  }
}

/**
 * The columns every query selects, and what each one is called logically.
 *
 * BOTH HALVES MATTER. The SQL has to ask for the workspace's names, and
 * everything downstream reads logical ones, so the mapping between them travels
 * with the query rather than being reconstructed by whoever gets the rows.
 * Without it a renamed workspace returns rows whose keys the judge does not
 * recognise, and every one of them reads as undated and untargeted: a clean
 * result, from a check that saw nothing.
 *
 * `url` rather than the title, deliberately: a title is not an identity, two
 * rows can share one, and a report naming rows by title cannot be clicked
 * through to the row it means.
 */
const SELECTED = ['Name', 'Type', 'Status', 'Segment', 'L2C Lifecycle', 'Link']

function selectList (context) {
  const dates = dateColumns(context)
  const parts = ['c.url'].concat(
    SELECTED.map(logical => `c.${identifier(context.property(logical))}`),
    [`c.${dates.start}`, `c.${dates.end}`]
  )
  return parts.join(', ')
}

/** What each selected column is called in the workspace, keyed by logical name. */
/**
 * THE KEYS ARE THE RAW PROPERTY NAME, NOT THE SQL SPELLING, and that is
 * deliberate. `dateColumns` doubles any quote in the name because that is how a
 * quoted identifier is written in SQL. What comes back in the response is keyed
 * by the actual column name, with no doubling, so escaping here would build a
 * key that never matches. Nothing has measured a workspace whose `Date` property
 * contains a quote, so neither spelling is proved; this is the one that follows
 * from what a quoted identifier means.
 */
function columnMap (context) {
  const map = { url: 'url' }
  for (const logical of SELECTED) map[logical] = context.property(logical)
  map['Date:start'] = `date:${context.property('Date')}:start`
  map['Date:end'] = `date:${context.property('Date')}:end`
  return map
}

/**
 * The list of rows inside whatever the query returned.
 *
 * THE SHAPE IS DECLARED HERE RATHER THAN ASSUMED. `normaliseRows` used to call
 * `.map` on its argument, so anything but a bare array died with
 * "rows.map is not a function", which names a line in this file and tells a user
 * nothing about the file they saved.
 *
 * `results` IS THE MEASURED ENVELOPE. A live query on 2026-08-19 answered with
 * `{results, has_more, data_source_ids}`. `rows` and `data` are still accepted
 * and have never been seen; they are kept because refusing a shape a different
 * client might use costs more than accepting one, and `duplicateCoverage`
 * deliberately trusts `has_more` only on `results`. An earlier version of this
 * comment said nothing here had been measured against a real response, which
 * stopped being true the moment one arrived.
 *
 * An unrecognised shape is refused by name rather than guessed at, because a
 * guess that returns an empty list reads exactly like a calendar with nothing
 * on it.
 */
function rowList (rows) {
  // A MISSING RESULT IS NOT AN EMPTY ONE. This used to return `[]` for null and
  // undefined, which is the exact fault the comment above warns about: a query
  // that was never sent, or whose result was saved as `null`, read as a calendar
  // with nothing on it and was then reported as checked.
  if (rows === null || rows === undefined) {
    throw new Error(
      'The rows file holds null rather than a list of rows. Nothing found and nobody looked are different answers, ' +
      'and this cannot tell them apart from the file alone. Save what the query returned, ' +
      'or leave the argument off so the caller reports the check as not run.'
    )
  }
  if (Array.isArray(rows)) return rows
  if (typeof rows === 'object') {
    // MORE THAN ONE CANDIDATE IS REFUSED RATHER THAN RANKED. Taking the first
    // match in a fixed order silently picks a winner, and an envelope holding an
    // empty `results` beside a populated `data` would report nothing found.
    // Which key a real response uses has not been measured.
    const holding = ['results', 'rows', 'data'].filter(key => Array.isArray(rows[key]))
    if (holding.length > 1) {
      throw new Error(
        `The rows file is an object holding a list under more than one of [${holding.join(', ')}], ` +
        `and which one is the result has not been measured here. Choosing between them would be a guess. ` +
        `Save the query result on its own.`
      )
    }
    if (holding.length === 1) return rows[holding[0]]
    throw new Error(
      `The rows file is an object with the keys [${Object.keys(rows).join(', ') || 'none'}] and no list of rows in it. ` +
      `Expected a JSON array, or an object with "results", "rows" or "data" holding one. ` +
      `Save what the query returned rather than a summary of it.`
    )
  }
  throw new Error(`The rows file holds a ${typeof rows}, not a list of rows. Save what the query returned.`)
}

/**
 * Rows as they came back, turned into the one shape everything downstream reads.
 *
 * THIS IS NOT COSMETIC. `clash.js` reads `row.date`, `row.Segment` and
 * `row.Name`, and a renamed workspace hands back `When` and `Audience Segment`.
 * Judging those directly is the silent failure this whole normalisation exists
 * to remove.
 *
 * `identity` is the page, derived from the url. The judge needs to exclude a row
 * from being compared against itself, and it used to do that on an `id` field
 * that no query here ever asked for, so the exclusion never fired on real rows.
 *
 * The three spellings of absence are collapsed here, not downstream. The
 * queries treat null, the empty string and `'[]'` as one thing, and a row whose
 * status came back as `''` would otherwise be a status nothing matches and
 * nothing reports.
 */
/**
 * THE COLUMNS THE SQL SURFACE RETURNS AS A JSON ARRAY IN A STRING, measured
 * against a live workspace on 2026-08-19.
 *
 * A multi-select does not come back as an array. It comes back as the TEXT
 * `'["Enterprise","Mid-Market"]'`, which is what the data source's own SQLite
 * definition says: `"Segment" TEXT, -- JSON array with zero or more of [...]`.
 *
 * WHAT THE RUN ACTUALLY SAW WAS `Segment` HOLDING TWO VALUES. `L2C Lifecycle`
 * came back null on that row, so the populated shape is measured for one of
 * these two columns and read off the shared SQLite definition for the other.
 * That definition is the same sentence for both, which is why the rule applies
 * to both, but the second column is one step further from the measurement.
 *
 * This was reasoned about wrongly for four review rounds. `normaliseRows` copied
 * the value through, `clash.targetingValues` keeps only strings, and the whole
 * JSON string was therefore read as ONE segment name matching nothing. Two
 * Enterprise webinars on the same day reported as not clashing, and the row went
 * to `unknown` rather than to `overlapping`. Measured by creating a row, running
 * the real window query, and comparing the answer against the same row with the
 * column parsed.
 */
const JSON_ARRAY_COLUMNS = new Set(['Segment', 'L2C Lifecycle'])

function parseArrayColumn (logical, value) {
  // AN ARRAY IS NOT ENOUGH, ITS CONTENTS HAVE TO BE NAMES. `[{name: 'Enterprise'}]`
  // used to pass straight through, and `clash.targetingValues` keeps only
  // strings, so it was filtered to nothing and the row read as untargeted. That
  // is the same silent false negative the JSON string caused, arriving by the
  // other door.
  if (Array.isArray(value)) return namesOnly(logical, value)
  if (typeof value !== 'string') {
    throw new Error(
      `${logical} came back as a ${typeof value}. The measured shape is a JSON array in a string, ` +
      `such as '["Enterprise"]'. Save what the query returned rather than a reshaped copy of it.`
    )
  }
  let parsed
  try {
    parsed = JSON.parse(value)
  } catch (error) {
    throw new Error(
      `${logical} came back as ${JSON.stringify(value)}, which is not the JSON array this column is ` +
      `measured to return. Reading it as a single value would silently match nothing.`
    )
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`${logical} parsed to a ${typeof parsed} rather than an array. Save what the query returned.`)
  }
  // THE SAME CHECK THE DIRECT ARRAY GETS. It was only applied to the branch
  // nobody has ever seen: the measured shape is the JSON string, and
  // `'[{"name":"Enterprise"}]'` went straight through, then got dropped by the
  // comparator and the row read as targeting nobody.
  return namesOnly(logical, parsed)
}

function namesOnly (logical, entries) {
  // THE SAME RULE THE OTHER TWO PATHS USE, from `schema.listProblem`. This had
  // its own copy of "every entry is a string" while `clash.targetingValues`
  // filtered non-strings away and `row.properties` forwarded them, so one value
  // got three answers depending on which door it came through. The wording stays
  // here because a value that came back from a query and a value somebody typed
  // are different situations to be in; only the rule is shared.
  const wrong = schema.listProblem(entries)
  if (wrong && wrong.kind === 'not-a-name') {
    throw new Error(
      `${logical} came back as a list containing ${JSON.stringify(wrong.entry)}, which is not a value name. ` +
      'Every entry has to be a string: anything else is dropped later and the row reads as targeting nobody.'
    )
  }
  return entries
}

/**
 * WHETHER THE WHOLE RESULT ARRIVED, from the response rather than from hope.
 *
 * Measured against a live workspace on 2026-08-19: the SQL surface answers with
 * `{results: [...], has_more: false, data_source_ids: [...]}`.
 *
 * WHAT THAT RUN ACTUALLY ESTABLISHED, and what it did not. The field exists and
 * came back false on a table holding one row. `has_more: false` is the surface's
 * own statement that nothing was withheld, and taking it at its word is reading
 * a contract rather than guessing. **It has never been seen true**, no threshold
 * for when it goes true has been measured, and the SQL mode of this client
 * documents no cursor for fetching the next page. So a true reads as not proved
 * and stops there: this cannot fetch the rest, and does not pretend to.
 *
 * It matters because `duplicateQuery` selects the whole table: no measured SQL
 * filter is a superset of what the comparator normalises, so a truncated
 * response means a duplicate that was never compared.
 */
function duplicateCoverage (raw) {
  // THE SIGNAL IS ONLY TRUSTED ON THE ENVELOPE IT WAS MEASURED ON. `rowList`
  // also accepts `rows` and `data`, which nobody has seen, and `{rows: [],
  // has_more: false}` used to come back proved. A completeness flag read off a
  // shape this has never met is a guess wearing a measurement's clothes.
  const measuredEnvelope = raw && typeof raw === 'object' && !Array.isArray(raw) && Array.isArray(raw.results)
  if (measuredEnvelope && 'has_more' in raw) {
    if (raw.has_more === false) {
      return { proved: true, why: 'The response reported has_more false, so every row matching the query arrived and was compared.' }
    }
    return {
      proved: false,
      why: 'The response reported has_more true, so rows matching the query were left unsent. A duplicate could be among them, and this check cannot see it.'
    }
  }
  return {
    proved: false,
    why: 'The saved result carries no has_more, so nothing here can tell whether it was the whole result or the first page of one. Save the response as it came back rather than only its rows.'
  }
}

/**
 * THE OPTION MAP, READ BACKWARDS.
 *
 * `row.properties` resolves every option through `context.value(...)` on the way
 * out, and nothing did it on the way back. `normaliseRows` mapped property
 * NAMES and copied VALUES through raw, so everything downstream compared the
 * workspace's own option names against the ones this plugin shipped with.
 *
 * On a workspace that renamed `Confirmed` to `Locked`, every confirmed row read
 * as merely hoped-for and `soon` reported nothing as locked, from a calendar
 * that was fine. The map was write-only, which is the same class of fault as a
 * renamed property, one layer further in.
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

function normaliseRows (context, rows) {
  const map = columnMap(context)
  const back = logicalValues(context)
  const absent = value => value === null || value === undefined || value === '' || value === '[]'
  const toLogical = (logical, value) => {
    const options = back[logical]
    if (!options) return value
    if (Array.isArray(value)) return value.map(entry => (entry in options ? options[entry] : entry))
    return value in options ? options[value] : value
  }

  return rowList(rows).map(raw => {
    if (!raw || typeof raw !== 'object') {
      throw new Error(`A row came back as ${JSON.stringify(raw)} rather than as an object. Save what the query returned.`)
    }
    const out = { url: raw[map.url] !== undefined ? raw[map.url] : raw.url }
    out.identity = pageIdentity(out.url)
    for (const logical of SELECTED) {
      const value = raw[map[logical]]
      if (absent(value)) { out[logical] = null; continue }
      const parsed = JSON_ARRAY_COLUMNS.has(logical) ? parseArrayColumn(logical, value) : value
      out[logical] = toLogical(logical, parsed)
    }
    const start = absent(raw[map['Date:start']]) ? null : raw[map['Date:start']]
    const end = absent(raw[map['Date:end']]) ? null : raw[map['Date:end']]
    out.date = start ? (end ? { start, end } : { start }) : null
    return out
  })
}

/**
 * The rows a clash check has to look at.
 *
 * WIDENED BY THE WINDOW, not by the proposed dates. The window is seven days
 * either side, and a query that fetched only the proposed range would hand
 * `clash.js` a candidate list that could never contain the thing it is looking
 * for. The widening happens here so the two cannot disagree about how wide it is.
 *
 * Canceled rows are excluded. A canceled thing is not in market, so it cannot
 * clash with anything, and including it would report a conflict with something
 * that is not happening.
 */
function windowQuery (context, start, end, windowDays) {
  const days = Number.isInteger(windowDays) ? windowDays : clash.WINDOW_DAYS
  // Ordered before widening, so a range entered backwards widens outward rather
  // than producing a window whose start is after its end, which returns nothing
  // and reads as a clean calendar. `clash.span` orders the same way.
  const [first, last] = [start, end || start].sort()
  const from = shiftDay(first, -days)
  const to = shiftDay(last, days)
  const dates = dateColumns(context)

  return {
    windowDays: days,
    from,
    to,
    columns: columnMap(context),
    // Inclusive at both ends, matching `inWindow` in clash.js.
    //
    // A row qualifies when its START is inside the window OR its END is, which
    // catches a long event that began before the window and runs into it. A
    // start-only comparison misses exactly the conference somebody is most
    // likely to be clashing with.
    sql:
      `SELECT ${selectList(context)}\n` +
      `FROM <ds> AS c\n` +
      `WHERE (\n` +
      `       (c.${dates.start} >= ${literal(from)} AND c.${dates.start} <= ${literal(to)})\n` +
      `    OR (c.${dates.end}   >= ${literal(from)} AND c.${dates.end}   <= ${literal(to)})\n` +
      `    OR (c.${dates.start} <= ${literal(from)} AND c.${dates.end}   >= ${literal(to)})\n` +
      `  )\n` +
      `  AND ${notCanceled(context)}`,
    note:
      'Replace <ds> with the quoted data source url. PASS WHAT COMES BACK TO `judge` UNCHANGED. ' +
      '`judge` normalises both result sets itself, and this note used to say to run `normalise` first: doing ' +
      'both reads the workspace names against logical keys a second time, empties every row including its date, ' +
      'and turns a real same-day clash into zero while still reporting checked. Use `normalise` on its own only ' +
      'to look at what a query returned. Details: ' +
      'the columns carry the workspace\'s own names and the judge reads logical ones. ' +
      'Nothing is decided by this query.'
  }
}

/**
 * Every row that could be a duplicate, which is a different set from the clash
 * window.
 *
 * A DUPLICATE IS NOT BOUNDED BY THE WINDOW. The same link is the same thing
 * whenever it is, an undated row has no date to be inside a window, and a
 * duplicate somebody already canceled is still worth knowing about before
 * entering it again. Handing `duplicates` the clash window meant three of its
 * four rules could never fire on real rows, while the tests passed by feeding
 * the helper rows the query would never have returned.
 *
 * IT IS NOT BOUNDED BY NAME OR LINK EITHER, AND THAT IS A REVERSAL.
 * Until 2026-08-19 this fetched rows whose link matched exactly or whose
 * lowercased name matched, on the reasoning that a lookup beats a table scan.
 * The comparator in `clash.js` is looser than both: it drops the scheme, a
 * leading `www.`, and trailing slashes from a link, and it collapses runs of
 * space inside a name. So the query filtered out the rows the comparator exists
 * to catch. `https://example.com/thing` against `http://www.example.com/thing/`
 * matched when the pair was handed to the comparator directly, which is what
 * every test did, and was never fetched by the query that runs for real.
 *
 * A narrowing filter is only safe when it is a superset of the comparator, and
 * writing one here means `LIKE` patterns with escaped wildcards over a SQL
 * surface where nothing in this repository has measured whether `ESCAPE` is
 * supported. Sending unmeasured SQL to make a duplicate check cheaper is the
 * wrong trade, so the filter is gone and the comparator is the only judge. It
 * returns the table, and the table is a calendar.
 *
 * If this ever needs to be bounded again, the bound has to be measured first
 * and proved a superset by a test that runs a pair through the query predicate
 * and the comparator together, rather than through the comparator alone.
 */
function duplicateQuery (context, proposed) {
  const hasName = Boolean(proposed && proposed.Name && String(proposed.Name).trim())
  const hasLink = Boolean(proposed && proposed.Link && String(proposed.Link).trim())

  if (!hasName && !hasLink) {
    return {
      sql: null,
      columns: columnMap(context),
      why: 'This row has neither a name nor a link, so there is nothing to look for a duplicate of.'
    }
  }

  return {
    columns: columnMap(context),
    // Canceled rows are INCLUDED here and excluded from the clash window, and
    // the difference is deliberate: a canceled row cannot compete for an
    // audience, and it can absolutely be the row somebody is about to re-enter.
    sql:
      `SELECT ${selectList(context)}\n` +
      `FROM <ds> AS c`,
    note:
      'Replace <ds> with the quoted data source url. This deliberately has no WHERE clause: ' +
      'the duplicate comparison ignores a trailing slash, the scheme and a run of spaces, and no filter here ' +
      'reproduces that without SQL nothing in this repository has measured. Pass what comes back through ' +
      '`normalise`, then `judge`, which does the comparing.'
  }
}

/**
 * The rows `soon` reports on.
 *
 * Undated rows are fetched SEPARATELY and deliberately. `soon` must never
 * silently drop a row it cannot place, and a date-bounded query cannot return
 * one that has no date, so asking once and reporting "nothing else is happening"
 * would be the exact failure the design forbids.
 */
function soonQueries (context, from, to) {
  const dates = dateColumns(context)
  const live = notCanceled(context)

  return {
    columns: columnMap(context),
    dated: {
      what: 'Rows whose dates touch the window, including a range that spans it.',
      sql:
        `SELECT ${selectList(context)}\n` +
        `FROM <ds> AS c\n` +
        `WHERE (\n` +
        `       (c.${dates.start} >= ${literal(from)} AND c.${dates.start} <= ${literal(to)})\n` +
        `    OR (c.${dates.end}   >= ${literal(from)} AND c.${dates.end}   <= ${literal(to)})\n` +
        `    OR (c.${dates.start} <= ${literal(from)} AND c.${dates.end}   >= ${literal(to)})\n` +
        `  )\n` +
        `  AND ${live}`
    },
    undated: {
      what: 'Rows with no date at all. Counted and reported, never dropped.',
      // The empty-date test copies the form setup's rule queries use, which
      // treats null, the empty string and an empty list as the same absence.
      // THIS IS DEFENSIVE, NOT MEASURED. The live run on 2026-08-19 saw an unset
      // date column come back as null and an unset multi-select come back as
      // null; the empty string and '[]' spellings have not been seen. An earlier
      // version of this comment said all three had been observed.
      sql:
        `SELECT ${selectList(context)}\n` +
        `FROM <ds> AS c\n` +
        `WHERE (c.${dates.start} IS NULL OR c.${dates.start} = '' OR c.${dates.start} = '[]')\n` +
        `  AND ${live}`
    }
  }
}

/**
 * Locked, hoped-for, and neither, kept apart.
 *
 * `Idea` and `Planned` sitting next to `Confirmed` is how a plan looks fuller
 * than it is. The output leads with the locked half.
 *
 * THE THIRD BUCKET IS A ROW WITH NO STATUS AT ALL, and it exists because the
 * two-bucket version filed it under hoped-for, which is a claim rather than an
 * observation. A row with no status is not a row somebody hopes will happen, it
 * is a row nobody finished, and it is usually a row created by hand or left
 * behind by an import. The queries stopped dropping those on 2026-08-19 and
 * this is where they surface.
 */
function separateByCertainty (rows) {
  const locked = []
  const hopedFor = []
  const noStatus = []
  for (const r of rows || []) {
    const status = r.Status
    if (status === null || status === undefined || status === '') noStatus.push(r)
    else if (status === 'Confirmed' || status === 'Done') locked.push(r)
    else hopedFor.push(r)
  }
  return { locked, hopedFor, noStatus }
}

/**
 * Grouped by who it hits, which is the question a calendar grid cannot answer.
 *
 * The calendar view already says what is on Tuesday. What a person actually
 * needs is what one audience is going to receive this month, across every type.
 * Three touches on one segment is visible this way and invisible on a grid.
 *
 * A row appears under every segment it names, so the counts do not sum to the
 * number of rows. That is correct and is stated in the output, because a reader
 * who adds the groups up and gets more than the total will otherwise assume the
 * report is wrong.
 */
function groupByAudience (rows) {
  const groups = new Map()
  const unsaid = []

  for (const r of rows || []) {
    const segments = Array.isArray(r.Segment) ? r.Segment.filter(Boolean) : []
    const lifecycle = Array.isArray(r['L2C Lifecycle']) ? r['L2C Lifecycle'].filter(Boolean) : []
    if (!segments.length && !lifecycle.length) {
      unsaid.push(r)
      continue
    }
    for (const segment of (segments.length ? segments : ['(no segment)'])) {
      if (!groups.has(segment)) groups.set(segment, [])
      groups.get(segment).push(r)
    }
  }

  return {
    groups: [...groups.entries()]
      .map(([segment, members]) => ({ segment, count: members.length, rows: members }))
      .sort((a, b) => b.count - a.count || a.segment.localeCompare(b.segment)),
    unsaid,
    note: 'A row appears under every segment it names, so these counts do not add up to the number of rows.'
  }
}

/**
 * What a property is worth comparing on, per Notion property type.
 *
 * ONE PLACE, KEYED BY THE TYPE THE PAYLOAD DECLARES. `proveWrite` used to
 * compare `select` and `multi_select` and let every other type pass on merely
 * being present, so a title that landed truncated, a url that landed empty and a
 * date that landed on the wrong day all read as a match. It then printed that
 * the properties matched, which is the specific failure this repository keeps
 * finding: not a check that fails, a check that passes without checking and says
 * so out loud.
 *
 * Each entry returns a comparable value or `undefined` for "this type is not
 * understood here", which is reported as unchecked rather than as a match.
 */
/**
 * COMPARING TWO VALUES IN THE CLIENT'S DIALECT.
 *
 * This used to read Notion REST API property objects, `{select: {name: 'Event'}}`,
 * because that is what `row.properties` used to build. The live run on
 * 2026-08-19 established that the connected client neither takes nor returns
 * that shape, so both sides now speak flat values and this compares those.
 *
 * THE TWO SIDES ARE NOT SYMMETRICAL, and that is measured rather than assumed. A
 * multi-select is WRITTEN as a list of names and READ BACK as a JSON array
 * inside a string. Normalising both to the same sorted list is what makes a
 * comparison mean anything.
 */
const COMPARABLE = {
  title: value => (value === null || value === undefined ? '' : String(value)),
  rich_text: value => (value === null || value === undefined ? '' : String(value)),
  url: value => (value === null || value === undefined ? '' : String(value)),
  select: value => (value === null || value === undefined ? '' : String(value)),
  date: value => (value === null || value === undefined ? '' : String(value).slice(0, 10)),
  multi_select: value => renderList(listOfNames(value)),

  // A PERSON IS WRITTEN BARE AND READ BACK PREFIXED. Measured 2026-08-20:
  // `["00000000-..."]` goes in and `["user://00000000-..."]` comes back. The
  // first live proof of a create reported the owner as not having landed, on a
  // write that was perfect. Stripping the prefix on both sides is what makes the
  // comparison about the person rather than about the spelling.
  people: value => renderList(listOfNames(value).map(one => (typeof one === 'string' ? one.replace(/^user:\/\//, '') : one)))
}

/**
 * A list of names from either side of the comparison.
 *
 * Written as an array, read back as a JSON array in a string, and absent as
 * null. All three mean a list, and one of them is measured.
 */
function listOfNames (value) {
  if (value === null || value === undefined || value === '' || value === '[]') return []
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) return parsed
    } catch (error) {
      // Not a JSON array. Fall through and treat it as a single name, which is
      // what a select would be, rather than throwing inside a comparison.
    }
    return [value]
  }
  return [value]
}

/**
 * A list rendered so that two different lists cannot render the same.
 *
 * THIS USED TO COERCE WITH `String` AND JOIN ON A CHARACTER, and both halves
 * were wrong. Coercing made `["1"]` and `[1]` compare equal, so a number where a
 * name belonged proved clean. Joining on a delimiter made `["a\u241Fb"]` and
 * `["a","b"]` compare equal, because nothing stopped a value containing the
 * separator. A comparison that is not one-to-one is a false success waiting for
 * the right input, which is the thing this plugin exists to refuse.
 *
 * `JSON.stringify` of a sorted array is one-to-one: it escapes, it keeps the
 * type, and it cannot be spoofed by a value's contents.
 */
function renderList (entries) {
  // A NON-STRING IS NOT COMPARED, IT IS REPORTED. Rendering one at all means
  // choosing how it stringifies, and every choice collapses something: `-0` and
  // `0` render the same, and a mixed list of `1` and `"1"` sorts by a string key
  // that cannot tell them apart, so two different lists could tie either way.
  // The honest answer to a value this does not understand is to say so, which is
  // what `null` means here.
  if (entries.some(entry => typeof entry !== 'string')) return null
  return JSON.stringify(entries.slice().sort())
}

/**
 * Which type a written column holds, found through the workspace name map.
 *
 * The payload is keyed by the workspace's own property names, so this walks back
 * to the logical name to look the type up. A date is the exception: it is
 * written under `date:<name>:start`, never under the property's name.
 */
function typeOfColumn (context, columnName) {
  const dates = { start: `date:${context.property('Date')}:start`, end: `date:${context.property('Date')}:end` }
  if (columnName === dates.start || columnName === dates.end) return 'date'

  const properties = (context.names && context.names.properties) || {}
  for (const [logical, workspace] of Object.entries(properties)) {
    if (workspace === columnName) return row.FIELD_TYPES[logical] || null
  }
  return null
}

/**
 * Did the write land?
 *
 * A create call returning without an error proves nothing: Notion accepts some
 * things it cannot do and discards them silently. `CLAUDE.md` states the rule,
 * and this is where the rule gets applied to a row.
 *
 * IT RETURNS WHAT IT CHECKED AS WELL AS WHAT WAS WRONG. A list of problems on
 * its own cannot tell an empty result from a check that never ran, and the
 * caller printed "the properties matched" for both. So `checked` and `unchecked`
 * come back by name, every caller has to say which it got, and a property whose
 * type this does not understand lands in `unchecked` rather than passing.
 *
 * BODY TEXT IS NOT COMPARED, only the headings, and that is now stated rather
 * than implied. Reading the body back means fetching the page's blocks, which is
 * a second call this has never been given. A heading that exists with nothing
 * under it passes here, and `unchecked` says so.
 */
/**
 * THE ONE DEFINITION OF WHAT AN UPDATE SENDS, used by `update` to build the
 * payload and by `prove-update` to check it. They were separate before, and
 * `prove` rebuilt the payload from the merged row alone with `row.properties`,
 * which omits an empty value. Every clear the update emitted was therefore
 * invisible to the proof: a `Location` that failed to empty was never compared,
 * and the write was reported as landed. A proof that reconstructs the payload by
 * a different route is not proving the payload that was sent.
 */
function reportProof (result) {
  const notChecked = result.unchecked.length
    ? `\n\nNot checked:\n  ${result.unchecked.map(u => `${u.what}: ${u.why}`).join('\n  ')}`
    : ''

  if (!result.problems.length) {
    console.log(
      `${result.checked.length} of ${result.checked.length + result.unchecked.length} things came back matching what was sent.` +
      `${notChecked}`
    )
    return
  }
  console.error(
    `This write did not fully land:\n  ${result.problems.map(p => `${p.what}: ${p.why}`).join('\n  ')}${notChecked}`
  )
  process.exit(1)
}

function updatePayload (context, before, after) {
  const cleared = row.clearing(before, after)
  // NO PERSON DEFAULT ON AN UPDATE. `after` is the merged row, so a person
  // field that is absent from it lost its value and `clearing` is already
  // emptying it. Defaulting it to the configured person here put a set and a
  // clear for one property into one payload, and the guard below then refused
  // the whole call.
  const setting = row.properties(context, after, { defaultsPerson: false })
  const clearingPayload = row.clearedProperties(context, cleared)

  // A field cannot be set and cleared in one call. `clearing` only reports a
  // field that is empty afterwards, and `properties` only writes one that is
  // not, so an overlap means one of the two is wrong about the same row and
  // the call would carry two answers for one property.
  const both = Object.keys(clearingPayload).filter(name => name in setting)
  if (both.length) {
    throw new Error(`${both.join(', ')} would be both set and cleared by one call. This is a bug in this plugin, not in the row.`)
  }

  return { cleared, properties: Object.assign({}, setting, clearingPayload) }
}

function proveWrite (context, intended, readback) {
  const problems = []
  const checked = []
  const unchecked = []

  if (!readback || !readback.properties) {
    return {
      problems: [{ what: 'the read-back', why: 'There is no read-back to check, so nothing about this write has been proved.' }],
      checked: [],
      unchecked: []
    }
  }

  for (const [name, value] of Object.entries(intended.properties || {})) {
    const got = readback.properties[name]
    if (got === undefined) {
      problems.push({ what: name, why: 'The property is not on the row that came back. Notion discarded it without reporting an error.' })
      continue
    }

    const type = typeOfColumn(context, name)
    if (!type || !COMPARABLE[type]) {
      unchecked.push({ what: name, why: 'Nothing here knows which type this column holds, so its value was not compared. It is on the row.' })
      continue
    }

    const sent = COMPARABLE[type](value)
    // Compared through the same reader, so a difference in how Notion spells a
    // value back is not read as a difference in the value.
    const back = COMPARABLE[type](got)

    // `null` from a comparator means it could not render one of the two sides
    // one-to-one. Guessing at equality there is exactly the false success this
    // exists to refuse, so it is reported as not checked.
    if (sent === null || back === null) {
      unchecked.push({
        what: name,
        why: 'One side of this list holds a value that is not a name, so the two could not be compared without guessing. It is on the row, and what it holds has not been checked.'
      })
      continue
    }
    if (sent === back) {
      checked.push({ what: name, type })
      continue
    }
    problems.push({
      what: name,
      why: `Sent ${JSON.stringify(sent)} and the row came back with ${JSON.stringify(back)}.`
    })
  }

  const headings = (readback.headings || []).map(h => String(h).trim())
  for (const heading of intended.headings || []) {
    if (headings.includes(heading)) checked.push({ what: heading, type: 'heading' })
    else problems.push({ what: heading, why: 'The section heading is not on the page. Write it again rather than reporting success.' })
  }

  if ((intended.headings || []).length) {
    unchecked.push({
      what: 'the body text',
      why: 'Only the headings were compared. What is written under them was not read back, so a heading with nothing under it passes this check.'
    })
  }

  return { problems, checked, unchecked }
}

/** Which body sections this row should have, given its status. */
function sectionsFor (final, body) {
  return schema.BODY_SECTIONS
    .filter(section => {
      if (!section.conditional) return true
      if (section.heading === schema.DEBRIEF.section) return final.Status === schema.DEBRIEF.triggeredBy
      // What We Need To Do is mostly events, and is offered rather than required.
      //
      // Read from `body`, which is where the text lives and where `bodyProblems`
      // reads it. This used to read `final[heading]`, so a section somebody had
      // actually written was left out of the heading list and never created.
      return Boolean(body && String(body[section.heading] || "").trim())
    })
    .map(section => section.heading)
}

/** Words across the sections that count toward the ceiling. */
function requiredWordCount (body) {
  return schema.REQUIRED_SECTIONS
    .map(heading => String((body && body[heading]) || '').trim())
    .join(' ')
    .split(/\s+/)
    .filter(Boolean)
    .length
}

/**
 * Everything wrong with the body, as a list.
 *
 * `Why We Are Doing It` gets two checks rather than one. Not blank is the floor.
 * The rule is that it ends with how you would know it worked, and a section that
 * says what this is meant to achieve and stops has answered half the question.
 * The second check cannot be mechanical, so it is reported as something for the
 * skill to judge rather than asserted as a failure.
 */
function bodyProblems (final, body) {
  const problems = []
  const why = String((body && body['Why We Are Doing It']) || '').trim()

  if (!why) {
    problems.push({
      section: 'Why We Are Doing It',
      code: 'BLANK',
      message: 'Why We Are Doing It is never blank, on any type, including a routine social post. If it cannot be answered, that is the finding: say so rather than writing the row.'
    })
  }

  if (!String((body && body['What It Is']) || '').trim()) {
    problems.push({ section: 'What It Is', code: 'BLANK', message: 'What It Is is required, written for somebody outside the team.' })
  }

  if (final.Status === schema.DEBRIEF.triggeredBy) {
    const debrief = String((body && body[schema.DEBRIEF.section]) || '').trim()
    if (!debrief) {
      problems.push({
        section: schema.DEBRIEF.section,
        code: 'DEBRIEF_MISSING',
        message: 'This row is Done, so How It Went is written or it says why not. A blank section and a deliberately empty one look identical afterwards, and only one of them is information.'
      })
    }
  }

  const words = requiredWordCount(body)
  if (words > schema.WORD_CEILING) {
    problems.push({
      section: null,
      code: 'TOO_LONG',
      message: `The required sections run to ${words} words against a ceiling of ${schema.WORD_CEILING}. Length here means content that belongs on the related project or in an artifact. Conditional sections do not count toward this.`
    })
  }

  return problems
}

// ------------------------------------------------------------------- commands

const commands = {
  context () {
    const context = contextOrExit()
    console.log(JSON.stringify({
      databaseId: context.databaseId,
      dataSourceId: context.dataSourceId,
      displayName: context.displayName,
      personId: context.personId,
      writesPersonFields: Boolean(context.personId)
    }, null, 2))
  },

  window (start, end) {
    if (!start) throw new Error('window needs a date: node calendar.js window 2026-09-10 [2026-09-12]')
    console.log(JSON.stringify(windowQuery(contextOrExit(), start, end), null, 2))
  },

  duplicates (proposedFile) {
    if (!proposedFile) throw new Error('duplicates needs the proposed row')
    console.log(JSON.stringify(duplicateQuery(contextOrExit(), readJson(proposedFile)), null, 2))
  },

  normalise (rowsFile) {
    if (!rowsFile) throw new Error('normalise needs the rows that came back')
    console.log(JSON.stringify(normaliseRows(contextOrExit(), readJson(rowsFile)), null, 2))
  },

  /**
   * TWO ROW SETS, NOT ONE, because the two checks ask different questions of
   * different rows. The clash window is seven days either side and excludes
   * canceled rows. A duplicate is not bounded by a date at all: the same link is
   * the same thing whenever it is, an undated row is not inside any window, and
   * a canceled duplicate is still worth seeing before entering it again.
   *
   * Handing both checks the clash window meant three of the four duplicate rules
   * could never fire on a real row.
   */
  judge (proposedFile, rowsFile, duplicateRowsFile) {
    if (!proposedFile || !rowsFile) throw new Error('judge needs the proposed row and the rows from the window query')
    const context = contextOrExit()
    const proposed = readJson(proposedFile)

    // ALREADY-NORMALISED ROWS ARE REFUSED, the same way `report` refuses them.
    // `judge` normalises both result sets itself, so a caller who ran
    // `normalise` first got a second pass that reads the workspace's names
    // against logical keys and empties every row including its date. A real
    // same-day clash then came back as zero, with `checked: true`. The generated
    // query note used to tell people to do exactly that, so this was reachable
    // by following the instructions.
    const refuseNormalised = (raw, which) => {
      if (rowList(raw).some(r => r && typeof r === 'object' && 'identity' in r)) {
        throw new Error(
          `The ${which} rows have already been through \`normalise\`, and \`judge\` normalises them itself. ` +
          `Pass what the query returned. Running it twice empties every row, including its date, and a real ` +
          `clash then comes back as none.`
        )
      }
      return raw
    }

    const inWindow = normaliseRows(context, refuseNormalised(readJson(rowsFile), 'window'))
    const duplicateRaw = duplicateRowsFile ? refuseNormalised(readJson(duplicateRowsFile), 'duplicate') : null
    const candidates = duplicateRowsFile ? normaliseRows(context, duplicateRaw) : null
    const coverage = candidates ? duplicateCoverage(duplicateRaw) : null

    console.log(JSON.stringify({
      clashes: clash.clashes(proposed, inWindow),
      duplicates: candidates
        ? {
            // NO UNKNOWN GOES IN A FIELD SHAPED LIKE A BOOLEAN. This carried
            // `complete: 'unknown'`, and `if (result.complete)` reads that as
            // yes. `ran` and `completeProved` are both real booleans, and the
            // word that cannot be trusted is in `coverage`, which nothing would
            // mistake for a yes.
            ran: true,
            rowsCompared: candidates.length,
            completeProved: coverage.proved,
            coverage: coverage.why,
            found: clash.duplicates(proposed, candidates)
          }
        : {
            ran: false,
            rowsCompared: 0,
            completeProved: false,
            coverage: 'The duplicate check did not run.',
            why: 'No duplicate rows were passed, so the duplicate check did not run. Run `duplicates` to get its query, send it, and pass the result as the third argument. It is a different set of rows from the clash window and cannot be answered from it.',
            found: []
          }
    }, null, 2))
  },

  check (proposedFile) {
    if (!proposedFile) throw new Error('check needs the proposed row')
    const proposed = readJson(proposedFile)
    // The body goes to `sectionsFor` as well as to `bodyProblems`. Without it
    // `What We Need To Do` was missing from the sections this reported even when
    // the row supplied one, so a skill following `check` wrote a page without
    // the section somebody had written.
    console.log(JSON.stringify({
      properties: row.problems(proposed),
      body: bodyProblems(proposed, proposed.body || {}),
      sections: sectionsFor(proposed, proposed.body || {}),
      words: requiredWordCount(proposed.body || {}),
      ceiling: schema.WORD_CEILING
    }, null, 2))
  },

  create (rowFile) {
    if (!rowFile) throw new Error('create needs the row')
    const context = contextOrExit()
    const final = readJson(rowFile)

    const problems = [].concat(row.problems(final), bodyProblems(final, final.body || {}))
    if (problems.length) {
      console.error(`This row is not ready to write:\n  ${problems.map(p => p.message).join('\n  ')}`)
      process.exit(1)
    }

    console.log(JSON.stringify({
      parent: { data_source_id: context.dataSourceId },
      properties: row.properties(context, final),
      headings: sectionsFor(final, final.body || {}),
      note: 'Create the page with these properties, then write each heading and its content. Re-fetch afterwards and pass the result to `prove`: a create that returned without an error has proved nothing.'
    }, null, 2))
  },

  /**
   * The exact update call, including what it has to empty.
   *
   * WHY THIS IS A COMMAND OF ITS OWN AND NOT `create` SENT AS AN UPDATE. The
   * `update` skill used to say to run `create` on the merged row and send the
   * result as an update. Two things were wrong with that, and both of them
   * damage data rather than merely reading badly. `create` emits a `parent`, a
   * heading list and a note alongside the properties, which is not the shape of
   * an update call. And a payload built from the fields that HAVE values cannot
   * express a field that lost one, so every clear the skill promised to make was
   * simply missing from the call, and Notion leaves an absent property alone.
   *
   * `before` is the row as it was fetched. `after` is the row as it would be,
   * merged, not the fields being changed. The difference between them is where
   * the clears come from, which is why both are required: a single merged row
   * cannot say what used to be there.
   */
  update (beforeFile, afterFile) {
    if (!beforeFile || !afterFile) {
      throw new Error('update needs the row as it is now and the row as it would be: node calendar.js update before.json after.json')
    }
    const context = contextOrExit()
    const before = readJson(beforeFile)
    const after = readJson(afterFile)

    const problems = [].concat(row.problems(after), bodyProblems(after, after.body || {}))
    if (problems.length) {
      console.error(`This row is not ready to write:\n  ${problems.map(p => p.message).join('\n  ')}`)
      process.exit(1)
    }

    const { cleared, properties } = updatePayload(context, before, after)
    const invalidated = row.fieldsInvalidatedByTypeChange(before, after.Type)

    // THE PAGE THIS UPDATE IS FOR, carried in the output so the proof is bound to
    // it. Without it `prove-update` would happily check a read-back of a
    // different row and report a clean write.
    const target = pageIdentity(before.url)
    if (!target) {
      throw new Error(
        'The before row has no usable `url`, so this update cannot say which page it is for. ' +
        'Keep the url on the row you fetched: without it nothing can prove the write landed on the right row.'
      )
    }

    console.log(JSON.stringify({
      target,
      properties,
      clearing: cleared,
      typeChange: before.Type === after.Type
        ? null
        : { from: before.Type, to: after.Type, invalidates: invalidated },
      headings: sectionsFor(after, after.body || {}),
      note:
        'Send these properties as an update to the existing page. ' +
        (cleared.length
          ? `${cleared.length} propert${cleared.length === 1 ? 'y is' : 'ies are'} being emptied and ${cleared.length === 1 ? 'is' : 'are'} in the payload as an explicit empty value: show them and ask before sending. `
          : 'Nothing is being emptied by this change. ') +
        'Then re-fetch the page, keeping its url, and pass THIS OUTPUT and the re-fetched page to ' +
        '`prove-update`. Not the two files this command was given: ' +
        '`prove` rebuilds the payload from one merged row and cannot see an emptied property, so it would ' +
        'report a failed clear as a successful write.'
    }, null, 2))
  },

  /**
   * IT SAYS WHAT IT DID NOT CHECK, every time, including when it passes.
   * The old success line was "the row came back matching what was sent,
   * properties and headings", from a comparison that read two property types out
   * of nine and never opened the body. A report wider than the check it came
   * from is the thing this plugin exists to refuse in other people's data, so it
   * does not get to do it in its own output.
   */
  /**
   * THE PROOF FOR A CREATE, and it names the page it proved.
   *
   * It used to take the row and the read-back and nothing else, so a read-back
   * from any page whose properties happened to match passed as a landed create.
   * `prove-update` was bound to its page first and this was left behind, which is
   * the same gap in the half of the plugin nobody was looking at.
   *
   * The third argument is the page the create returned. It is required: at create
   * time there is no earlier identity to fall back on, so the caller is the only
   * thing that knows which page this is meant to be about.
   */
  prove (rowFile, readbackFile, createdUrl) {
    if (!rowFile || !readbackFile || !createdUrl) {
      throw new Error(
        'prove needs the row that was sent, the read-back, and the page the create returned: ' +
        'node calendar.js prove row.json readback.json <url>. ' +
        'Without the url this cannot tell a read-back of the new row from a read-back of any other row.'
      )
    }
    const context = contextOrExit()
    const created = pageIdentity(createdUrl)
    if (!created) {
      throw new Error(`"${createdUrl}" is not a page this can identify. Pass the url the create call returned.`)
    }

    const readback = readJson(readbackFile)
    const cameBack = pageIdentity(readback && readback.url)
    if (!cameBack) {
      throw new Error(
        'The read-back has no `url`, so nothing can tell which page it is. Re-fetch the page and keep its url.'
      )
    }
    if (cameBack !== created) {
      throw new Error(
        `The read-back is a different page from the one that was created. The create returned ${created} ` +
        `and the read-back is ${cameBack}. Nothing about the write has been proved.`
      )
    }

    const final = readJson(rowFile)
    const intended = { properties: row.properties(context, final), headings: sectionsFor(final, final.body || {}) }
    reportProof(proveWrite(context, intended, readback))
  },

  /**
   * THE PROOF FOR AN UPDATE, because an update can empty a property and `prove`
   * cannot see that.
   *
   * IT TAKES WHAT `update` PRINTED, not the files `update` was given. Rebuilding
   * the payload from `before` and `after` again looked equivalent and was not:
   * passing `after.json` as both arguments removed every clear from the
   * reconstructed payload, and a read-back still holding the old value then
   * proved clean. A proof recomputed from inputs proves what those inputs would
   * have produced. Only the emitted payload proves what was sent.
   *
   * It also checks the read-back is the page the update was for. Without that it
   * would check a different row and report a clean write.
   */
  'prove-update' (updateFile, readbackFile) {
    if (!updateFile || !readbackFile) {
      throw new Error(
        'prove-update needs what `update` printed and the re-fetched page: ' +
        'node calendar.js prove-update update.json readback.json. ' +
        'Save the output of `update` rather than passing its inputs again: the emitted payload is the only ' +
        'record of which properties were being emptied.'
      )
    }
    const context = contextOrExit()
    const emitted = readJson(updateFile)

    // `headings` is required, not defaulted. `update` always emits it, so a file
    // without one is not an update output, and falling back to `[]` would skip
    // every section check while still reporting a clean proof.
    if (!emitted || typeof emitted !== 'object' || !emitted.properties || !emitted.target ||
        !Array.isArray(emitted.headings)) {
      throw new Error(
        'That file is not the output of `update`. It needs the `target` and `properties` that `update` printed. ' +
        'Passing the before or after row here would rebuild a payload with no clears in it and prove nothing.'
      )
    }

    const readback = readJson(readbackFile)
    const cameBack = pageIdentity(readback && readback.url)
    if (!cameBack) {
      throw new Error(
        'The read-back has no `url`, so nothing can tell which page it is. Re-fetch the page and keep its url: ' +
        'a proof against an unidentified row is not a proof.'
      )
    }
    if (cameBack !== emitted.target) {
      throw new Error(
        `The read-back is a different page from the one this update was for. The update targeted ${emitted.target} ` +
        `and the read-back is ${cameBack}. Nothing about the write has been proved.`
      )
    }

    reportProof(proveWrite(context, { properties: emitted.properties, headings: emitted.headings }, readback))
  },

  soon (from, to) {
    if (!from || !to) throw new Error('soon needs a window: node calendar.js soon 2026-09-01 2026-09-30')
    console.log(JSON.stringify(soonQueries(contextOrExit(), from, to), null, 2))
  },

  /**
   * IT NORMALISES WHAT IT IS GIVEN rather than trusting that somebody ran
   * `normalise` first. This used to read both files straight off disk and group
   * them by `Status` and `Segment`, which are logical names. On a workspace that
   * renamed either one, every row read as having no status and no segment: a
   * report with nothing locked and nothing targeted, from a calendar that was
   * fine. Nothing failed, and the failure looked like an empty month.
   *
   * Rows that have already been through `normalise` are refused rather than
   * normalised twice, because the second pass would look up the workspace names
   * again against logical keys and quietly empty every row.
   */
  report (datedFile, undatedFile) {
    // BOTH RESULT SETS ARE REQUIRED. `soon` returns two queries and its SKILL.md
    // says both are always sent. The undated file used to be optional and an
    // absent one became an empty list, so a report that nobody ran the second
    // query was indistinguishable from one where nothing was undated.
    if (!datedFile || !undatedFile) {
      throw new Error(
        'report needs both result sets: node calendar.js report dated.json undated.json. ' +
        '`soon` returns two queries and both have to be sent. Without the undated rows this would say ' +
        'nothing could not be placed, which is a different claim from nobody having looked.'
      )
    }
    const context = contextOrExit()

    const alreadyNormalised = rows => rowList(rows).some(r => r && typeof r === 'object' && 'identity' in r)
    const take = (file, which) => {
      const raw = readJson(file)
      if (alreadyNormalised(raw)) {
        throw new Error(
          `The ${which} rows have already been through \`normalise\`, and \`report\` normalises them itself. ` +
          `Pass what the query returned. Running it twice reads the workspace's names against logical keys and empties every row.`
        )
      }
      return normaliseRows(context, raw)
    }

    const dated = take(datedFile, 'dated')
    const undated = take(undatedFile, 'undated')
    const { locked, hopedFor, noStatus } = separateByCertainty(dated)

    console.log(JSON.stringify({
      locked: groupByAudience(locked),
      hopedFor: groupByAudience(hopedFor),
      noStatus: {
        count: noStatus.length,
        why: 'These rows have a date and no status. They are not planned and not confirmed, they are unfinished, and they are reported separately rather than counted as either.',
        rows: noStatus
      },
      couldNotPlace: {
        count: undated.length,
        why: 'These rows have no date, so they cannot appear on a calendar. They are listed rather than dropped: a report that omits them reads as nothing else is happening.',
        rows: undated
      }
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
  windowQuery,
  duplicateQuery,
  normaliseRows,
  parseArrayColumn,
  logicalValues,
  JSON_ARRAY_COLUMNS,
  SELECTED,
  duplicateCoverage,
  rowList,
  notCanceled,
  columnMap,
  dateColumns,
  soonQueries,
  separateByCertainty,
  groupByAudience,
  proveWrite,
  updatePayload,
  sectionsFor,
  bodyProblems,
  requiredWordCount,
  shiftDay
}

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
 *   node process.js prove <artifact.json> <readback.json> <created-url>  did the create land, on that page
 *   node process.js find <question.json>                   the query find reads
 *   node process.js trust <rows.json> [YYYY-MM-DD]         which of these is still worth trusting
 *   node process.js scope <request.json>                  what backfill is allowed to read, or why this is not a scope
 *   node process.js repeats <askings.json>                which questions were asked three or more times
 *   node process.js candidates <found.json>               what was found, as lines a person can go through
 *   node process.js draft <candidate.json>                an approved candidate, as an artifact ready to check
 *   node process.js fill <existing.json> <candidate.json> the blanks on an artifact that already exists
 */

const fs = require('fs')
const path = require('path')

const config = require(path.join(__dirname, 'vendor', 'config-read'))
const schema = require(path.join(__dirname, 'vendor', 'process-schema'))
const artifact = require(path.join(__dirname, 'artifact'))
const backfill = require(path.join(__dirname, 'backfill'))
const { compareProperty, listOfNames, cameBackEmpty } = require(path.join(__dirname, 'vendor', 'notion-compare'))

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

/**
 * The two Memos property names `audit` needs, read straight from the recorded
 * map rather than through `contextFor`.
 *
 * WHY NOT `contextFor`. It validates the recorded map against a full identity
 * for that database, both ways: a name in the map that the identity does not
 * list is an error. This plugin does not carry the Memos schema and should not,
 * so any identity it could offer would be a subset, and every Memos property it
 * never looks at would be reported as a fault in the user's config. That is a
 * refusal invented here, over a workspace that is fine.
 *
 * WHAT IS GIVEN UP, SAID PLAINLY. The one-to-one check does not run over Memos,
 * so two Memos properties mapped to one Notion name would not be caught here.
 * That check exists to protect writes, and `audit` writes nothing: signal 2
 * reads Memos and this plugin never edits it. `SKILLS-process.md` is explicit
 * that Memos is append-only and a correction there is a new memo. `setup`'s
 * `check` is what validates the Memos map as a whole, and it owns that job.
 *
 * Both names are required rather than defaulted. Falling back to the names this
 * plugin shipped with would query a renamed workspace for properties that do not
 * exist, return nothing, and read as an artifact with no memos, which is exactly
 * what a healthy artifact looks like.
 */
const MEMOS_PROPERTIES = ['Artifacts', 'Published date', 'Status']

function memosContextOrExit () {
  const raw = config.readRaw()
  if (!raw.ok) {
    console.error(raw.message)
    process.exit(1)
  }
  const entry = (raw.config && raw.config.databases && raw.config.databases.memos) || null
  if (!entry) {
    console.error(
      'The config records no "memos" database, and `audit` reads it for the newer-related-memo signal, ' +
      'which is the strongest of the four. Run the `setup` plugin\'s `add` skill for Memos, ' +
      'or accept that signal 2 cannot run. Nothing here writes to Memos.'
    )
    process.exit(1)
  }
  const recorded = entry.properties || {}
  const missing = MEMOS_PROPERTIES.filter(name => !recorded[name])
  if (missing.length) {
    console.error(
      `The Memos map records no name for ${missing.map(m => `"${m}"`).join(' or ')}, so the newer-related-memo signal ` +
      'cannot be built. It is refusing rather than falling back to the names this plugin shipped with: on a renamed ' +
      'workspace that queries properties which do not exist, returns nothing, and reads as an artifact nobody has ' +
      'written about. Run the `setup` plugin\'s `check` skill, which records them.'
    )
    process.exit(1)
  }
  const recordedValues = (entry.values && entry.values.Status) || {}
  if (!recordedValues.Published) {
    console.error(
      'The Memos map records no name for the "Published" status, so a draft or a canceled memo could not be told ' +
      'apart from an announced one. A canceled memo driving the newer-related-memo signal sends somebody to re-read ' +
      'an artifact because of something that was retracted. Run the `setup` plugin\'s `check` skill, which records it.'
    )
    process.exit(1)
  }
  return {
    property: name => recorded[name],
    value: (property, logical) => ((entry.values && entry.values[property]) || {})[logical]
  }
}

/**
 * A Notion page reference reduced to the id inside it, so the same page written
 * three ways compares equal.
 *
 * A relation and a row's own `url` do not come back in one shape. Matching them
 * as raw strings meant a memo pointing at an artifact by a dashed id never lined
 * up with the artifact's own url, and signal 2 found nothing while looking
 * right.
 */
function pageKey (value) {
  if (typeof value !== 'string') return null
  // THE ID IS AT THE END OF THE PATH, AND NOTHING AFTER THE PATH COUNTS. Run
  // over the whole string, the last 32 hex characters of
  // `.../page-<id>?v=<another id>` are the view's id and not the page's, so the
  // same page opened from a view compared as a different page. A trailing slash
  // does the same in reverse by emptying the last segment.
  const withoutTail = String(value).split('#')[0].split('?')[0]
  const segments = withoutTail.split('/').filter(Boolean)
  const last = segments.length ? segments[segments.length - 1] : withoutTail

  // THE ID IS MATCHED, NOT ASSEMBLED. The first version stripped every non-hex
  // character out of the segment and took the last 32 of whatever was left, so
  // the letters of the title were being concatenated with the id. That happens
  // to give the right answer when an id is there, and invents one out of the
  // title when it is not: `.../decafbad-coffee-faced-a-facade-of-beef` has no
  // id in it at all and would still have produced a key, which then matched
  // nothing and read as a memo pointing at no artifact.
  //
  // Both forms are anchored to the end of the segment, which is where Notion
  // puts the id in `Some-Title-<id>` and in a bare page link.
  const bare = last.match(/([0-9a-fA-F]{32})$/)
  if (bare) return bare[1].toLowerCase()
  const dashed = last.match(/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/)
  if (dashed) return dashed[1].replace(/-/g, '').toLowerCase()
  return null
}

/**
 * Whether a person property actually names anybody.
 *
 * `[]` and the string `"[]"` are both truthy, and they are the two shapes an
 * empty person property arrives in. A bare `!value` test called both of them
 * filled.
 */
function anyPerson (value) {
  if (value === null || value === undefined || value === '' || value === '[]') return false
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'string') {
    const text = value.trim()
    if (text.startsWith('[')) {
      try { return Array.isArray(JSON.parse(text)) ? JSON.parse(text).length > 0 : true } catch (_) { return true }
    }
    return text.length > 0
  }
  return true
}

/**
 * One value, translated from the workspace's option names back to the logical
 * ones.
 *
 * A LIST ARRIVES AS A STRING HOLDING A JSON ARRAY, and that is the shape this
 * surface actually returns. The first version handled a real array and a bare
 * scalar and let a JSON string fall through untouched, so a renamed workspace
 * came back with its own option names still on every multi-select. That is the
 * fault the whole reverse map exists to fix, surviving in the shape it was most
 * likely to arrive in.
 *
 * A string that parses as an array comes back as a real array, because the
 * caller is reading a list either way and should not have to know which shape
 * it arrived in. A value the map does not carry is passed through as itself.
 */
function toLogicalValue (options, logical, value) {
  if (!options) return value
  const translate = entry => (typeof entry === 'string' && entry in options ? options[entry] : entry)
  if (Array.isArray(value)) return value.map(translate)
  if (typeof value === 'string') {
    const text = value.trim()
    if (text.startsWith('[')) {
      try {
        const parsed = JSON.parse(text)
        if (Array.isArray(parsed)) return parsed.map(translate)
      } catch (error) {
        // Not a JSON array after all. Fall through and treat it as one value.
      }
    }
  }
  return translate(value)
}

/** Whether the after artifact is asking for this field to be emptied. */
function asksToEmpty (value) {
  if (value === null) return true
  if (value === '' || value === '[]') return true
  if (Array.isArray(value) && value.length === 0) return true
  return false
}

/**
 * A day, or a refusal naming what would have gone wrong.
 *
 * BOTH COMMANDS TAKE A DATE AND ONLY ONE OF THEM CHECKED IT. `flags` refused a
 * date it could not read, and `update` carried the same argument straight into
 * the payload, so `node process.js update before.json after.json "last Tuesday"`
 * put the words "last Tuesday" into a Notion date property. The two failures
 * differ enough to be worth naming separately, which is what `doing` is for:
 * unreadable on the reading side makes every cadence comparison come back
 * `unknown`, which is also the honest answer for a cadence nobody recognises;
 * on the writing side it goes to Notion.
 */
function dayOrRefuse (value, doing) {
  const today = value || new Date().toISOString().slice(0, 10)
  // WRITTEN BACK OUT AND COMPARED, which is the pair of the fix `backfill.js`
  // `day` got in round 4 and did not get here until round 32. `Date.parse` takes
  // `2026-02-30` and hands back the 2nd of March, so the regex and a not-NaN
  // test together still let a rolled-over day through, into a Notion date
  // property on the writing side and into a staleness calculation on the reading
  // one. The only way to tell the two apart once the string has been parsed is
  // to render it again and see whether it changed.
  const parsed = Date.parse(`${today}T00:00:00Z`)
  if (/^\d{4}-\d{2}-\d{2}$/.test(today) && !Number.isNaN(parsed) &&
      new Date(parsed).toISOString().slice(0, 10) === today) return today
  throw new Error(
    `"${today}" is not a date. Use YYYY-MM-DD. ` +
    (doing === 'reading'
      ? 'It is refused rather than carried through, because every cadence comparison would come back "unknown", ' +
        'which is also what this says about a cadence it has never seen, and a mistyped argument would read as a ' +
        'library nobody has checked.'
      : 'It is refused rather than written, because it would go into a date property as the text it is.')
  )
}

/**
 * Whether a person field is asking for somebody rather than asking for nobody.
 *
 * `me` and a named id both want an owner. `null`, `[]` and `''` want the field
 * emptied, which is a different request and a legitimate one.
 */
function wantsAPerson (value) {
  // ASKED THROUGH THE ONE RULE. Written out here it was a correct copy sitting
  // next to an incorrect one: `peopleAsked` wrote the same test by hand and
  // missed `'[]'`. A copy that happens to agree today is the next one to drift,
  // which is the argument the seven `cameBackEmpty` consolidations were built on.
  return !cameBackEmpty(value)
}

/** The pages a relation column names, however the surface encoded them. */
function relatedUrls (value) {
  if (value === null || value === undefined || value === '') return []
  let entries = value
  if (typeof value === 'string') {
    const text = value.trim()
    if (!text || text === '[]') return []
    if (text.startsWith('[')) {
      try { entries = JSON.parse(text) } catch (_) { entries = [text] }
    } else {
      entries = [text]
    }
  }
  if (!Array.isArray(entries)) entries = [entries]
  return entries.map(entry => pageKey(typeof entry === 'string' ? entry : (entry && entry.url))).filter(Boolean)
}

/**
 * The empty value a property has to be sent to actually clear it.
 *
 * A multi-select clears with an empty list and everything else with null. Sent
 * the wrong one, Notion accepts the write and the old value stays, which reads
 * as a clean update that changed nothing.
 */
/**
 * Every property `update` can change.
 *
 * NOT `SELECTED`, WHICH IS A READING LIST. `SELECTED` is what queries fetch, and
 * it leaves out properties no judgment reads: `Tags`, `Segment`,
 * `L2C Lifecycle` and `Owner` are none of `find`'s business. Reusing it here
 * meant `update` silently could not change any of those four. It reported
 * "nothing changed" for an edit that changed something, which is the quietest
 * way to lose a person's work: they are told it was saved and it was not.
 *
 * `Created time` is not here because Notion writes it. The three verification
 * fields are not here because they move as a group under `reviewed`, and letting
 * them be edited one at a time is the rule this plugin exists to enforce.
 */
/**
 * What kind of property each logical field is, which is what decides how a value
 * read back compares to the value that was sent.
 *
 * A person comes back prefixed, a list comes back as a string holding a JSON
 * array, a date can come back carrying a time. Compared raw every one of those
 * reads as a failed write, so the type has to be known before the comparison
 * means anything. `shared/notion-compare.js` holds the readers and where each
 * difference was measured.
 */
const PROPERTY_TYPES = {
  Name: 'title',
  Description: 'rich_text',
  Type: 'select',
  Domain: 'select',
  Audience: 'multi_select',
  Segment: 'multi_select',
  'L2C Lifecycle': 'multi_select',
  Tags: 'multi_select',
  Status: 'select',
  Owner: 'people',
  'Review cadence': 'select',
  'Last checked for accuracy': 'date',
  'Verified by': 'people',
  'Verified date': 'date'
}

const UPDATABLE_FIELDS = [
  'Name',
  'Description',
  'Type',
  'Domain',
  'Audience',
  'Segment',
  'L2C Lifecycle',
  'Tags',
  'Status',
  'Owner',
  'Review cadence'
]

function emptyValueFor (logical) {
  // A person property clears with an empty list, the same as a multi-select:
  // both hold several values and Notion returns and takes them as arrays. Sent
  // a null, the write is accepted and the old owner stays.
  const listShaped = schema.MULTI_SELECT_FIELDS.includes(logical) || schema.PERSON_FIELDS.includes(logical)
  return listShaped ? [] : null
}

/**
 * Whether two logical values are the same, for deciding what changed.
 *
 * ORDER IN A MULTI-SELECT IS NOT A CHANGE. Comparing the lists as written made
 * reordering the same three tags look like an edit, which then went into the
 * payload and, on a `reviewed` update, dragged the verification stamp with it.
 * An absent value and an empty one are also the same thing here: a property that
 * was never set and one set to nothing are both nothing.
 */
function sameValue (logical, a, b) {
  // A LIST ARRIVES IN TWO SHAPES AND THEY ARE THE SAME LIST. A row fetched from
  // Notion carries a multi-select as a string holding a JSON array; a row
  // written by hand carries a real array. Compared as written, every
  // multi-select on a fetched before row read as changed, went into the payload
  // unasked, and on a reviewed update dragged the verification stamp with it.
  //
  // Which fields are lists comes from the schema rather than from the shape of
  // the value. Not because a scalar would currently be mangled by the list
  // reader, which it would not: a mutation making every field list-shaped
  // changed nothing any check could see. It is from the schema because that is
  // where the answer actually lives, and reading it from the value would make
  // the behaviour depend on what a row happened to contain that day.
  const listShaped = schema.MULTI_SELECT_FIELDS.includes(logical) || schema.PERSON_FIELDS.includes(logical)
  const norm = value => {
    if (value === null || value === undefined || value === '') return null
    if (listShaped) {
      // A PERSON IS WRITTEN BARE AND READ BACK PREFIXED, measured 2026-08-20.
      // Without stripping it, an owner fetched as `user://abc` and left alone in
      // the after row compared as a change, went into the payload, and on a
      // reviewed update moved the verification stamp for an edit nobody made.
      // The same fact is in `shared/notion-compare.js`, which is about proving a
      // write rather than deciding what changed.
      const entries = listOfNames(value).map(one => (typeof one === 'string' ? one.replace(/^user:\/\//, '') : one))
      return entries.length ? entries.map(one => String(one).trim()).slice().sort().join('\u0000') : null
    }
    if (Array.isArray(value)) return value.length ? value.map(String).slice().sort().join('\u0000') : null
    return String(value)
  }
  return norm(a) === norm(b)
}

/**
 * A file read, parsed, and checked for being the shape the caller reads it as.
 *
 * THE SHAPE IS THE THIRD THING WORTH CHECKING AND NOTHING WAS CHECKING IT.
 * Valid JSON of the wrong shape is the failure this plugin has been corrected
 * for five times: a list where a set of fields was expected has none of those
 * fields, so every one of them reads as absent, and "absent" means "leave it
 * alone" nearly everywhere here. The run then reports that there was nothing to
 * do and exits zero, having silently dropped what somebody approved.
 *
 * Refused at the door rather than in each command, because a rule every future
 * command has to remember is one a future command will forget. `expected` is
 * optional and a caller that does not say gets the old behaviour, so declaring
 * it is a decision per command rather than a sweep nobody reviewed.
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

/**
 * The two date properties, which cannot be selected the way the others are.
 *
 * A DATE PROPERTY IS NOT QUERYABLE UNDER ITS OWN NAME. Notion exposes it as
 * `date:<name>:start`, which is what the SQLite table definition shows. Measured
 * in this repository, applied by `plugins/setup/scripts/views.js` and by
 * `dateColumns` in `plugins/calendar/scripts/calendar.js`, and missed here:
 * asking for `c."Last checked for accuracy"` returns nothing, `staleness` then
 * sees no check date, and every artifact reads `unknown`.
 *
 * THAT IS THE SAME SYMPTOM THE VALUE MAP FIX ADDRESSED, from a second and
 * unrelated cause, which is why the end-to-end checks matter more than the
 * unit ones. Only `:start` is taken. These hold a day, not a range, and nothing
 * reads an end.
 *
 * The name inside the prefix is the workspace's name for the property, not the
 * one this plugin shipped with.
 */
const DATE_FIELDS = new Set(['Last checked for accuracy', 'Verified date'])

/** The column a logical field is actually selectable through. */
function columnFor (context, logical) {
  const name = context.property(logical)
  return DATE_FIELDS.has(logical) ? `date:${name}:start` : name
}

function selectList (context) {
  return ['c.url']
    .concat(SELECTED.map(logical => `c.${identifier(columnFor(context, logical))}`))
    .join(', ')
}

function columnMap (context) {
  const map = { url: 'url' }
  for (const logical of SELECTED) map[logical] = columnFor(context, logical)
  return map
}

/**
 * What `audit` selects, which is `SELECTED` plus `Verified by`.
 *
 * `Verified by` is signal 4 and nothing else reads it, so it is not in
 * `SELECTED`: `find` would carry a person column it never looks at. It is a
 * person property, which this surface returns as a name or an id rather than a
 * date, so it needs no `date:` prefix.
 */
const AUDIT_SELECTED = SELECTED.concat(['Verified by'])

function auditSelectList (context) {
  return ['c.url']
    .concat(AUDIT_SELECTED.map(logical => `c.${identifier(columnFor(context, logical))}`))
    .join(', ')
}

function auditColumnMap (context) {
  const map = { url: 'url' }
  for (const logical of AUDIT_SELECTED) map[logical] = columnFor(context, logical)
  return map
}

/** Rows for `audit`, which needs one column more than `normaliseRows` carries. */
function normaliseAuditRows (context, rows) {
  const map = auditColumnMap(context)
  const back = logicalValues(context)
  const toLogical = (logical, value) => toLogicalValue(back[logical], logical, value)
  return rowList(rows).map(row => {
    const out = {}
    for (const [logical, actual] of Object.entries(map)) out[logical] = toLogical(logical, row[actual])
    out._raw = row
    return out
  })
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
  const toLogical = (logical, value) => toLogicalValue(back[logical], logical, value)

  return rowList(rows).map(row => {
    const out = {}
    for (const [logical, actual] of Object.entries(map)) out[logical] = toLogical(logical, row[actual])
    out._raw = row
    return out
  })
}

// ---------------------------------------------------------------- similarity
//
// In `similar.js`, because `backfill.js` compares askings of a question with
// the same measure and cannot require this file back without a cycle.

const { tokens, similarity } = require(path.join(__dirname, 'similar'))

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

/**
 * Refuse a row that is keyed by the workspace's own property names.
 *
 * A page fetched from Notion comes back keyed by whatever the workspace calls
 * its properties, and `normaliseRows` is what turns those into logical ones.
 * Handed a raw fetch on a renamed workspace, every logical lookup returns
 * undefined, and what that means depends on the caller: `update` sees nothing
 * changed and reports a clean no-op, `fill` sees every field empty and offers to
 * fill fields that already hold something. Both are silent and both look like a
 * correct answer, which is why this is a refusal.
 *
 * ASKED PER FIELD, NOT ABOUT THE ROW AS A WHOLE. The first version asked whether
 * the row had ANY logical key and let it through if it did. A workspace that
 * renamed some properties and not others produces a row carrying both, so a raw
 * fetch with an unrenamed `Name` on it passed the guard while the renamed field
 * being edited stayed invisible: the exact fault the guard exists to stop,
 * surviving inside the guard.
 *
 * A field counts as raw when its workspace name is present under a key that is
 * not its logical one AND the logical key is absent. Both halves matter: without
 * the second, a workspace whose name for one property happens to equal another's
 * logical name would refuse a row that is perfectly fine.
 *
 * SHARED BY BOTH CALLERS RATHER THAN COPIED. `fill` reads the same fetched row
 * for a different reason, and a guard that lives in one of two callers is a
 * guard the other one does not have.
 *
 * `fields` IS THE CALLER'S OWN LIST, NOT A GLOBAL ONE. Sharing the guard is only
 * half of sharing it: built from `UPDATABLE_FIELDS` for everybody, it watched
 * `Owner` and none of the other three fields a backfill refuses, so a candidate
 * carrying the workspace's name for `Verified date` walked through the guard and
 * was then invisible to the thing the guard exists to protect. A guard has to
 * watch the fields its caller is about to read, and only the caller knows which
 * those are.
 */
function refuseRawKeys (context, rows, consequence, fields = UPDATABLE_FIELDS) {
  const rawKeys = row => fields.filter(logical => {
    const workspace = context.property(logical)
    return workspace !== logical && workspace in row && !(logical in row)
  })
  for (const [what, row] of rows) {
    const raw = rawKeys(row || {})
    if (!raw.length) continue
    throw new Error(
      `The ${what} artifact carries ${raw.map(one => `"${context.property(one)}"`).join(', ')}, ` +
      `which ${raw.length === 1 ? 'is this workspace\'s name' : 'are this workspace\'s names'} for ` +
      `${raw.map(one => `"${one}"`).join(', ')} rather than the logical ${raw.length === 1 ? 'one' : 'ones'}. ` +
      'Pass rows that have been through `normaliseRows`, or rename the keys yourself. Left as they are, those ' +
      `fields ${consequence}.`
    )
  }
}

// --------------------------------------------------------------------- commands

/**
 * What a thing is called, whichever of the two shapes it arrived in.
 *
 * THE DUPLICATE GATE COULD NOT READ THE CANDIDATE THE FLOW HANDS IT. `candidates`
 * emits `what` and `type`; `duplicates` and `judge` read `Name` and `Type`; and
 * the note printed beside the candidate list tells the caller to run both on
 * every candidate and calls that the thing which makes backfill safe to re-run.
 * Handed one verbatim, `duplicates` reported "this artifact has no name",
 * returned no query and exited zero, so the check that stops a second pass
 * rewriting a page did nothing and said nothing.
 *
 * Both shapes read here rather than a translation step in between, because the
 * skill documents this exact call and a step it does not mention is a step
 * somebody will skip. `Name` wins when both are present, since an artifact is
 * the more specific thing.
 */
function subjectName (row) {
  const one = row || {}
  // A FALLBACK IS FOR AN ABSENT FIELD. Read through `String()` a `Name` of `{}`
  // searched the library for a page called "[object Object]" and a `Name` of 42
  // searched for "42". Supplied and unreadable stops here rather than falling
  // past to `what`, so the command refuses and says it has no name, which is
  // true and is the answer that stops the write.
  if (one.Name !== undefined && one.Name !== null) {
    return typeof one.Name === 'string' ? one.Name.trim() : ''
  }
  return typeof one.what === 'string' ? one.what.trim() : ''
}

/**
 * What type a thing is, from either shape.
 *
 * THE PAIR OF `subjectName`, AND IT WAS MISSED THE ROUND `subjectName` WAS
 * ADDED. Teaching `judge` to read a candidate's `what` and leaving its type check
 * on `proposed.Type` meant a candidate that would supersede an existing Strategy
 * Decision matched it and was never offered as a replacement, so the side-by-side
 * prompt never appeared and a decision would have been duplicated rather than
 * superseded. Half a fix reads exactly like a whole one from the side that works.
 */
function subjectType (row) {
  const one = row || {}
  // Same as `subjectName`. A `Type` of 42 read as "42", which matches no type,
  // so the supersede check turned itself off without saying so.
  if (one.Type !== undefined && one.Type !== null) {
    return typeof one.Type === 'string' ? one.Type.trim() : ''
  }
  return typeof one.type === 'string' ? one.type.trim() : ''
}

/** The description to compare on, from either shape. A candidate has no description. */
function subjectText (row) {
  const one = row || {}
  return `${subjectName(one)} ${one.Description || one.why || ''}`.trim()
}

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
    const proposed = readJson(file, 'the proposed artifact', 'fields')

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

    // A REFUSAL EXITS NON-ZERO, LIKE EVERY OTHER GATE HERE. `scope`, `draft` and
    // `fill` all do. This one printed `writable: false` and exited zero, so a
    // caller reading the status rather than the body carried on toward the write
    // the check had just refused. Only `problems` move it: a concern is a
    // question for a person and answering it is not a precondition.
    if (problems.length) process.exitCode = 1
  },

  duplicates (file) {
    if (!file) throw new Error('Usage: node process.js duplicates <proposed.json>')
    const proposed = readJson(file, 'the proposed artifact', 'fields')
    const context = contextOrExit()

    const name = subjectName(proposed)
    if (!name) {
      console.log(JSON.stringify({
        sql: null,
        why: 'This has no name, under either `Name` or a candidate\'s `what`, so there is nothing to look for a near ' +
          'match of. A duplicate check that cannot run is not a duplicate check that passed.'
      }, null, 2))
      // AND IT EXITS NON-ZERO. It printed no query and exited zero, so a caller
      // reading the status carried on to the write with the check that stops a
      // re-run rewriting a page having done nothing.
      process.exitCode = 1
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
    const proposed = readJson(proposedFile, 'the proposed artifact', 'fields')
    const rows = readJson(rowsFile, 'the rows that came back', 'list')
    const context = contextOrExit()

    const threshold = thresholdArg === undefined ? DEFAULT_THRESHOLD : Number(thresholdArg)
    if (Number.isNaN(threshold) || threshold < 0 || threshold > 1) {
      throw new Error(`"${thresholdArg}" is not a threshold. It is a number between 0 and 1.`)
    }

    const subject = subjectText(proposed)
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
      row => row.type === schema.PARENT_TYPE && subjectType(proposed) === schema.PARENT_TYPE
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
    const final = readJson(file, 'the artifact', 'fields')
    const context = contextOrExit()

    const properties = artifact.properties(context, final, {
      parentType: final.parentType,
      today: final.today
    })

    // A NAMED PARENT IS CHECKED AND THEN NOT WRITTEN, AND THAT HAS TO BE SAID.
    // `problems` refuses a parent of the wrong type, because the rule cannot be
    // enforced anywhere else, so the plugin takes a parent seriously enough to
    // reject a bad one. It then builds no relation at all. Left unsaid, a user
    // who named a valid parent has every reason to believe it was set, and the
    // page reads as filed when it is loose. `Parent` and `Supersedes` both
    // arrive with `update`.
    //
    // `parent` below is the DATABASE the page is created in, which is a
    // different thing from the Parent relation and is named the same by Notion.
    const parentNamed = final.parent !== undefined && final.parent !== null && final.parent !== ''

    console.log(JSON.stringify({
      parent: { data_source_id: context.dataSourceId },
      properties,
      body: artifact.body(final),
      headings: artifact.expectedHeadings(final),
      relatedView: schema.RELATED_VIEW[final.Type],
      // SAID ON THE WRITE PATH, NOT ONLY IN THE DRAFT. `properties` above wrote
      // no owner and no verification stamp because the artifact carries
      // `backfill: true`. Left unsaid here, a page created from a backfill draft
      // reports exactly like one created by `new`, and the difference between
      // them is the whole of what `audit` signal 4 is for.
      backfill: final.backfill === true,
      backfillNote: final.backfill === true
        ? 'THIS IS A BACKFILL. No Owner, no Verified by, no Verified date and no Last checked for accuracy are being ' +
          'written, because a machine pulled this in and nobody has read it. `audit` will flag it as never-verified ' +
          'until somebody does. Say so when reporting the write: it is not the same page `new` would have made.'
        : null,
      parentRelation: parentNamed ? final.parent : null,
      parentRelationNote: parentNamed
        ? 'THE PARENT WAS CHECKED AND IS NOT BEING WRITTEN. This version builds no relation, so the page will be ' +
          'created unlinked however valid the parent is. Say so when reporting, and set it by hand or wait for `update`. ' +
          'Reporting the page as filed under it would be wrong.'
        : 'No parent was named. This version writes no Parent or Supersedes relation either way; both arrive with `update`.',
      note:
        'Create the page, then read it back and run `prove`. A Notion page can be created with an empty body ' +
        'on a silent partial failure, and a create call that returned without an error proves nothing.'
    }, null, 2))
  },

  prove (artifactFile, readbackFile, createdUrl) {
    if (!artifactFile || !readbackFile) {
      throw new Error('Usage: node process.js prove <artifact.json> <readback.json> <created-url>')
    }
    const final = readJson(artifactFile, 'the artifact', 'fields')
    const readback = readJson(readbackFile, 'the page as it came back', 'fields')
    const context = contextOrExit()

    const problems = []
    const checked = []
    const unchecked = []

    /*
     * THE PROOF IS BOUND TO THE PAGE THAT WAS CREATED.
     *
     * Without this, `prove` checked that SOME page had the right headings and
     * the right properties absent, and said the write landed. A different page
     * that happened to match passed, and so did the case this exists for: a
     * page created malformed while the skill read back something else. The
     * backfill absence check added in round 6 sat on top of that, so it proved
     * only that some page was unstamped.
     *
     * `prove-update` has bound its proof since it was written, because `update`
     * knows the page it is writing to. `create` does not: the page does not
     * exist when the payload is built. So the url the create call returned is
     * passed in here, and the read-back has to be that page.
     */
    const created = pageKey(createdUrl)
    if (!created) {
      throw new Error(
        `prove needs the url the create call returned, and got ${JSON.stringify(createdUrl)}. Without it this checks ` +
        'that some page has the right shape rather than that the page just written does, and a page created ' +
        'malformed passes as long as the one read back is fine.'
      )
    }
    const got = pageKey(readback && (readback.url || (readback.page && readback.page.url)))
    if (!got) {
      problems.push({
        what: 'the page that came back',
        why: 'It carries no usable url, so nothing can say it is the page that was just created. Save the whole page, keeping its url.'
      })
    } else if (got !== created) {
      problems.push({
        what: 'the page that came back',
        why: `It is not the page that was created. Created ${created}, read back ${got}. Nothing below was checked, because checking a different page reports a clean write on the wrong artifact.`
      })
    }

    if (problems.length) {
      console.log(JSON.stringify({ proved: false, problems, checked, unchecked }, null, 2))
      process.exitCode = 1
      return
    }

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

    // A BACKFILLED PAGE IS PROVED BY WHAT IS NOT ON IT, and the loop above cannot
    // do that. It walks the properties that were intended, and on a backfill the
    // four that matter are intended to be absent, so a page that came back
    // carrying a stamp passed this as a clean write. That is the one outcome the
    // whole mode exists to prevent: a stamped import is indistinguishable from an
    // artifact somebody read, and it drops silently out of the never-verified
    // audit signal.
    //
    // The write side has been guarded since the mode was built. This is the read
    // side, and a guard on one of those two is the fault this branch has now hit
    // four times.
    if (final.backfill === true) {
      for (const logical of backfill.REFUSED_ON_A_BACKFILL) {
        const name = context.property(logical)
        const got = readback.properties[name]
        // ASKED THROUGH THE FILE THAT RECORDS THE MEASURED SHAPES. Notion
        // returns an empty list three ways and the third, the JSON array inside
        // a string, is the one every hand-written copy of this test has missed.
        // A person property that came back as `'[]'` read as a value where the
        // plugin had deliberately left none.
        if (cameBackEmpty(got)) {
          checked.push({ what: name, type: 'absent, which is what a backfill requires' })
          continue
        }
        problems.push({
          what: name,
          why: `${logical} is on the page that came back and a backfill writes none of the four. Something put it there. ` +
            'Clear it before reporting this write: an artifact stamped by the import that created it is indistinguishable ' +
            'from one a person actually checked, and it drops out of the never-verified audit signal without saying so.'
        })
      }
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

  /**
   * THE QUERIES `audit` NEEDS, AND IT WRITES NOTHING. `SKILLS-process.md` is
   * explicit: audit reads only, produces a list, and hands it to `update`.
   *
   * Two queries, because signal 2 cannot be answered from the artifacts table.
   * The memo query goes through the REVERSE relation, from Memos, sorted by
   * `Published date` descending. Reading the artifact's own relation property
   * returns at most 25 references and a relation value caps at 100 pages, so on
   * any long-lived artifact the newest memo becomes invisible and the strongest
   * of the four signals silently degrades to nothing.
   *
   * Archived artifacts are excluded. An archived document going stale is not
   * something for a person to look at.
   */
  audit () {
    const context = contextOrExit()
    const memos = memosContextOrExit()

    console.log(JSON.stringify({
      artifactColumns: auditColumnMap(context),
      artifactSql:
        `SELECT ${auditSelectList(context)}\n` +
        'FROM <process-ds> AS c\n' +
        `WHERE (c.${identifier(context.property('Status'))} IS NULL ` +
        `OR c.${identifier(context.property('Status'))} != ${literal(context.value('Status', 'Archive'))})`,
      memoColumns: {
        url: 'url',
        Artifacts: memos.property('Artifacts'),
        'Published date': `date:${memos.property('Published date')}:start`,
        Status: memos.property('Status')
      },
      memoSql:
        `SELECT m.url, m.${identifier(memos.property('Artifacts'))}, ` +
        `m.${identifier(memos.property('Status'))}, ` +
        `m.${identifier(`date:${memos.property('Published date')}:start`)}\n` +
        'FROM <memos-ds> AS m\n' +
        `WHERE m.${identifier(memos.property('Artifacts'))} IS NOT NULL\n` +
        `  AND m.${identifier(memos.property('Status'))} = ${literal(memos.value('Status', 'Published'))}\n` +
        `ORDER BY m.${identifier(`date:${memos.property('Published date')}:start`)} DESC`,
      note:
        'Replace <process-ds> and <memos-ds> with the quoted data source urls. Run both, then pass what came back to ' +
        '`flags`. THE MEMO QUERY IS NOT OPTIONAL: run it and pass an empty list only if it genuinely returned nothing, ' +
        'because skipping it turns the strongest signal off without saying so. Only Published memos are read: a draft ' +
        'was never announced and a canceled one was retracted, and either driving the signal sends somebody to re-read ' +
        'an artifact over something that never stood. This command writes nothing and never will.'
    }, null, 2))
  },

  /**
   * The four signals, judged over what those two queries returned.
   *
   * IT REPORTS DOCUMENTS THAT NEED A PERSON, NEVER A DECISION. Signal 3 in
   * particular is a candidate and not a verdict: getting a supersede wrong
   * archives a live document.
   */
  flags (artifactsFile, memosFile, todayArg) {
    if (!artifactsFile) {
      throw new Error('Usage: node process.js flags <artifacts.json> <memos.json> [YYYY-MM-DD]')
    }
    if (!memosFile) {
      throw new Error(
        'The memo rows are missing. Pass them, or pass a file holding [] if the memo query genuinely returned nothing. ' +
        'Defaulting to none would turn signal 2 off silently, and it is the strongest of the four.'
      )
    }
    const context = contextOrExit()
    const memosCtx = memosContextOrExit()
    const today = dayOrRefuse(todayArg, 'reading')

    const artifacts = normaliseAuditRows(context, readJson(artifactsFile, 'the artifact rows'))
    const memoRows = rowList(readJson(memosFile, 'the memo rows'))

    // Newest published memo per artifact url. The rows arrive sorted, and this
    // does not trust that: a re-sorted export would otherwise take the first row
    // it saw as the newest.
    const memoProperty = memosCtx.property('Artifacts')
    const publishedColumn = `date:${memosCtx.property('Published date')}:start`
    // BOTH SIDES COMPARED AS DAYS. `Published date` can come back carrying a
    // time and `Last checked for accuracy` does not, so comparing the raw
    // strings made a memo published on the morning of the check read as newer
    // than the check itself. Everything checked that day would be flagged.
    const day = value => String(value).slice(0, 10)
    const newestMemo = new Map()
    const statusColumn = memosCtx.property('Status')
    const publishedValue = memosCtx.value('Status', 'Published')
    for (const memo of memoRows) {
      const published = memo[publishedColumn]
      if (!published) continue
      // The query already asks for Published only. This checks anyway, because
      // the rows can arrive from a hand-written query and a canceled memo
      // driving this signal sends somebody to re-read an artifact over something
      // that was retracted. A row with no Status column at all is accepted: that
      // is the shipped query, which does not select it back.
      if (statusColumn in memo && memo[statusColumn] !== publishedValue) continue
      for (const target of relatedUrls(memo[memoProperty])) {
        const held = newestMemo.get(target)
        if (!held || day(published) > day(held.published)) {
          newestMemo.set(target, { published: day(published), url: memo.url })
        }
      }
    }

    // WITH NO PERSON CONFIGURED, SIGNAL 4 CANNOT MEAN ANYTHING. Nothing this
    // plugin writes ever fills `Verified by` on such an install, so every
    // artifact is flagged as never verified, every run. That is not wrong, and
    // reported without the reason it is noise: a list where every row carries
    // the same flag teaches the reader to skip the whole report, including the
    // three signals that do mean something.
    const noPersonConfigured = !context.personId

    const flagged = []
    const flag = (row, signal, why) => flagged.push({
      url: row.url, name: row.Name, type: row.Type, signal, why
    })

    for (const row of artifacts) {
      // 1. Past its review cadence.
      const state = staleness(row, today)
      if (state.state === 'due') flag(row, 'past-cadence', state.why)

      // 2. A memo newer than the last check. THE STRONGEST OF THE FOUR.
      const memo = newestMemo.get(pageKey(row.url))
      const checked = row['Last checked for accuracy']
      if (memo && (!checked || day(memo.published) > day(checked))) {
        flag(
          row,
          'memo-newer',
          checked
            ? `A memo published ${memo.published} is newer than the last check on ${checked}. Something was announced about this and nobody folded it in.`
            : `A memo published ${memo.published} relates to this and it has never been checked.`
        )
      }

      // 4. Backfilled and never verified. Signal 1 cannot catch these: an empty
      // date does not match a "before" filter in Notion, so they escape it
      // entirely, which is why this signal exists.
      // AN EMPTY LIST IS EMPTY. `!value` is false for `[]` and for the string
      // `"[]"`, which are the two shapes a person property with nobody in it
      // actually arrives as, so the signal missed exactly the rows it exists to
      // catch and reported the library as fully verified.
      if (!anyPerson(row['Verified by'])) {
        flag(row, 'never-verified', 'Verified by is empty, so nobody is recorded as having read this. Signal 1 cannot catch it: an empty date matches no "before" filter.')
      }
    }

    // 3. Two Active Strategy Decisions that may answer the same question
    // differently. CANDIDATES, NEVER ACTED ON.
    const decisions = artifacts.filter(
      row => row.Type === schema.PARENT_TYPE && row.Status === 'Active'
    )
    const supersedeCandidates = []
    for (let i = 0; i < decisions.length; i++) {
      for (let j = i + 1; j < decisions.length; j++) {
        const a = decisions[i]
        const b = decisions[j]
        const score = Number(similarity(
          `${a.Name || ''} ${a.Description || ''}`,
          `${b.Name || ''} ${b.Description || ''}`
        ).toFixed(3))
        if (score >= DEFAULT_THRESHOLD) {
          supersedeCandidates.push({
            score,
            a: { url: a.url, name: a.Name },
            b: { url: b.url, name: b.Name }
          })
        }
      }
    }

    console.log(JSON.stringify({
      today,
      considered: artifacts.length,
      memosRead: memoRows.length,
      flagged,
      supersedeCandidates,
      thresholdIsMeasured: THRESHOLD_IS_MEASURED,
      supersedeNote: supersedeCandidates.length
        ? 'CANDIDATES, NOT A VERDICT. Two Active Strategy Decisions look alike. Whether one supersedes the other is a ' +
          'person\'s call: getting it wrong archives a live document. Show both and ask.'
        : null,
      neverVerifiedNote: noPersonConfigured && flagged.some(one => one.signal === 'never-verified')
        ? 'THIS INSTALL RECORDS NO PERSON, so nothing ever fills Verified by and every artifact carries the ' +
          'never-verified flag whatever its state. Say that when reporting rather than listing them as findings. ' +
          'The other three signals are unaffected.'
        : null,
      memoSignalNote: memoRows.length
        ? null
        : 'NO MEMOS WERE READ, so signal 2 found nothing because it had nothing to look at, not because nothing is stale. ' +
          'Say which of the two it was when reporting.',
      note:
        'This wrote nothing. Every line above is a document for a person to look at. `update` is what changes one, ' +
        'and it asks separately whether the edit counts as having re-read the artifact.'
    }, null, 2))
  },

  /**
   * Change an artifact that already exists.
   *
   * ONLY WHAT CHANGED GOES IN THE PAYLOAD. `SKILLS-process.md`: does not rewrite
   * a body wholesale when a section is what changed. Sending an unchanged
   * property back is not harmless either, because `Last checked for accuracy` is
   * in that set and rewriting it is the fault the whole verification rule exists
   * to prevent.
   *
   * THE THREE VERIFICATION FIELDS MOVE TOGETHER OR NONE OF THEM DO, and which
   * it is comes from an explicit `reviewed` on the after row. Not from whether
   * the edit looks substantial, and not from a default. `Last checked for
   * accuracy` drives the staleness check, so setting it on an edit that was not
   * a review makes a stale document look fresh, which is worse than leaving it
   * flagged. An absent `reviewed` is refused rather than read as false: a
   * missing answer and "no I did not re-read it" are different, and only one of
   * them is a decision somebody made.
   */
  update (beforeFile, afterFile, todayArg) {
    if (!beforeFile || !afterFile) {
      throw new Error('update needs the artifact as it is now and as it would be: node process.js update before.json after.json [YYYY-MM-DD]')
    }
    const context = contextOrExit()
    const before = readJson(beforeFile, 'the artifact as it is now', 'fields')
    const after = readJson(afterFile, 'the artifact as it would be', 'fields')

    // THE ROWS HAVE TO BE KEYED LOGICALLY, AND THAT IS CHECKED.
    //
    // A page fetched from Notion comes back keyed by the workspace's own
    // property names, and `normaliseRows` is what turns those into logical ones.
    // Handed a raw fetch on a renamed workspace, every logical lookup below
    // returns undefined: nothing looks changed, nothing is sent, and `update`
    // reports a clean no-op for an edit the person asked for. Silent, and it
    // looks like the edit was already applied.
    // ASKED PER FIELD, NOT ABOUT THE ROW AS A WHOLE. The first version asked
    // whether the row had ANY logical key and let it through if it did. A
    // workspace that renamed some properties and not others produces a row
    // carrying both, so a raw fetch with an unrenamed `Name` on it passed the
    // guard, and the renamed field it was actually editing stayed invisible: the
    // exact silent no-op the guard exists to stop, surviving inside the guard.
    //
    // A field counts as raw when its workspace name is present under a key that
    // is not its logical one AND the logical key is absent. Both halves matter:
    // without the second, a workspace whose name for one property happens to
    // equal another's logical name would refuse a row that is perfectly fine.
    // THE VERIFICATION FIELDS ARE IN THE LIST BECAUSE THIS COMMAND NOW READS
    // THEM. They are not updatable and never were, so the guard was built
    // without them, and then `verificationBefore` started reading them off the
    // same row. On a raw-keyed row all three come back absent, get recorded as
    // empty, and `prove-update` then reports a stamp that never moved as one
    // that appeared out of nowhere. Same shape as round 5: a reader added to a
    // row whose guard was not told about it.
    refuseRawKeys(
      context,
      [['before', before], ['after', after]],
      'read as unchanged and this reports a clean no-op for an edit that was asked for',
      [...UPDATABLE_FIELDS, ...schema.VERIFICATION_FIELDS]
    )

    const target = pageKey(before.url)
    if (!target) {
      throw new Error(
        'The before artifact has no usable `url`, so this update cannot say which page it is for. ' +
        'Keep the url on the row you fetched: without it nothing can prove the write landed on the right artifact.'
      )
    }

    if (after.reviewed !== true && after.reviewed !== false) {
      throw new Error(
        'The after artifact does not say whether this edit counts as having re-read the artifact for accuracy. ' +
        'Set `reviewed` to true or false and ask the person first. It is refused rather than assumed because ' +
        '`Last checked for accuracy` drives the staleness check: assuming true makes a stale document look fresh, ' +
        'and assuming false silently discards a real review somebody did.'
      )
    }

    // `partialBody` because `update` sends only the sections that changed.
    // Everything it does not send stays as it is on the page, so judging an
    // absent section as an empty one made this refuse any edit that did not
    // carry the whole body, which is most edits.
    // WHAT IS NOT BEING CHANGED IS TAKEN FROM THE BEFORE ARTIFACT.
    //
    // `problems` needs a `Name` and a `Type` to judge anything, and it is right
    // to: there is no template without a type. But an update that changes a
    // Status is not changing either, and under the rule that an absent key means
    // untouched, demanding them here contradicted the rule one screen above.
    // A property-only edit was refused for missing the two fields it was
    // deliberately not touching.
    //
    // The body is deliberately NOT merged. `after.body` is what is being
    // written, and pulling the before body in would validate and then send
    // sections nobody edited, which is the fault round 3 fixed.
    // ONLY WHAT IS BEING WRITTEN IS VALIDATED, plus the identity needed to read
    // it. Merging the whole before artifact in put every pre-existing value
    // through the gates again, so an edit was refused for the state of fields it
    // was not touching:
    //
    //   - A `Draft` artifact could not be edited at all. Draft is a status only
    //     a person can set, and skills may write only Active or Archive, so the
    //     rule that stops a skill drafting also stopped it correcting a draft.
    //   - A value retired from the schema since the page was written blocked
    //     every later edit to that page, and the message named a field the
    //     person had not touched.
    //
    // `Name` and `Type` are carried across because nothing can be judged without
    // them: the type decides which sections a body has. Everything else comes
    // from the after artifact alone, which is exactly what is going to be sent.
    const merged = { ...after }
    for (const field of ['Name', 'Type']) {
      if (!(field in merged) && field in before) merged[field] = before[field]
    }
    delete merged.body
    if (after.body !== undefined) merged.body = after.body

    const problems = artifact.problems(merged, { parentType: after.parentType, partialBody: true })
    if (problems.length) {
      throw new Error(`This artifact cannot be written yet:\n  ${problems.map(one => one.message).join('\n  ')}`)
    }

    // TWO PAYLOADS, AND THE PERSON DEFAULT IS WHY.
    //
    // `properties` fills an absent person field with the config person, which is
    // right on a create: somebody wrote this and there is a sensible owner. On
    // an edit it is wrong and silently so. Clearing an owner leaves `Owner`
    // absent from the after row, the default puts the config person back, the
    // changed-field loop finds the name present and never reaches the clear
    // branch, and the artifact is quietly reassigned to whoever installed the
    // plugin. Nothing in the output said so.
    //
    // Turning the default off outright is not the fix either: `Verified by` is a
    // person field too, and the review stamp depends on that default to record
    // who read the artifact. So the editable payload is built without it and the
    // verification stamp with it, and each is used only for what it is right for.
    const stamp = dayOrRefuse(todayArg, 'writing')

    const editable = artifact.properties(context, merged, {
      defaultsPerson: false, parentType: after.parentType, today: stamp, partialBody: true
    })
    const stamped = artifact.properties(context, merged, {
      defaultsPerson: true, parentType: after.parentType, today: stamp, partialBody: true
    })

    // Which logical fields actually differ. Compared logically, before the
    // workspace's names are put back on, so a rename cannot read as a change.
    //
    // AN ABSENT KEY IS NOT A CLEARED FIELD. Leaving `Description` out of the
    // after row used to read as emptying it: the comparison saw undefined
    // against the old text, called it a change, found no value to send and sent
    // an explicit empty instead. So a caller that built the after row by hand
    // and forgot a field deleted it, and the output called that a clear as if it
    // had been asked for. Clearing is now something you say, with an explicit
    // null or empty list, the same rule the body already follows.
    // `me` RESOLVED BEFORE ANYTHING IS COMPARED. `properties` understands it and
    // the comparison did not, so setting the owner to `me` when the config
    // person already owns it reported a change and rewrote the same value. The
    // resolution happens once, here, rather than in both places.
    const resolved = { ...after }
    if (context.personId) {
      for (const field of schema.PERSON_FIELDS) {
        if (resolved[field] === 'me') resolved[field] = [context.personId]
      }
    }

    const changedFields = []
    const unchangedFields = []
    const untouchedFields = []
    for (const logical of UPDATABLE_FIELDS) {
      if (schema.VERIFICATION_FIELDS.includes(logical)) continue
      if (!(logical in resolved)) { untouchedFields.push(logical); continue }
      if (sameValue(logical, before[logical], resolved[logical])) unchangedFields.push(logical)
      else changedFields.push(logical)
    }

    const properties = {}
    const cleared = []
    for (const logical of changedFields) {
      const name = context.property(logical)
      // AN EXPLICIT EMPTY IS A CLEAR, WHATEVER THE PAYLOAD BUILDER DID WITH IT.
      // `properties` fills some fields in when they are absent: a missing
      // `Review cadence` becomes the default. Asked to empty one, the value came
      // back present, the clear branch was never reached, and the field was
      // written with a default instead of emptied. Reading the request rather
      // than the payload is what makes clearing mean the same thing for every
      // field, instead of depending on whether that field happens to have a
      // default behind it.
      if (asksToEmpty(resolved[logical])) {
        properties[name] = emptyValueFor(logical)
        cleared.push(logical)
        continue
      }
      if (!(name in editable)) {
        // ASKING TO OWN IT AND EMPTYING IT ARE OPPOSITE INTENTIONS.
        //
        // `properties` drops a person field it cannot resolve, and `me` with no
        // configured person is exactly that. Falling into the clear branch then
        // read "make me the owner" as "remove the owner", which is the reverse
        // of what was asked, done silently, on the field that says who is
        // accountable for the document.
        if (schema.PERSON_FIELDS.includes(logical) && wantsAPerson(after[logical]) && !context.personId) {
          throw new Error(
            `${logical} was set to ${JSON.stringify(after[logical])} and the config records no person, so there is ` +
            'nobody to write. It is refused rather than emptied: asking to own something and asking to un-own it are ' +
            `opposite intentions, and the second one is not what was said. Either give ${logical} a Notion person id, ` +
            `or set it to null if emptying it is what you meant.`
          )
        }
        // The field was emptied. It has to go as an explicit empty value, or the
        // write is a no-op and the old value silently survives a change the
        // person asked for and was told had happened.
        properties[name] = emptyValueFor(logical)
        cleared.push(logical)
        continue
      }
      properties[name] = editable[name]
    }

    // The three, together or not at all.
    const verification = []
    if (after.reviewed === true) {
      for (const logical of schema.VERIFICATION_FIELDS) {
        const name = context.property(logical)
        if (name in stamped) {
          properties[name] = stamped[name]
          verification.push(logical)
        }
      }
    }

    const archiving = before.Status !== 'Archive' && after.Status === 'Archive'

    console.log(JSON.stringify({
      target,
      url: before.url,
      properties,
      changed: changedFields,
      unchanged: unchangedFields,
      untouched: untouchedFields,
      untouchedNote: untouchedFields.length
        ? 'These were not in the after artifact at all, so they are being left exactly as they are. To empty one, ' +
          'put it in the after artifact with an explicit null. Leaving it out never clears anything.'
        : null,
      clearing: cleared,
      reviewed: after.reviewed,
      verificationFields: verification,
      // CARRIED SO `prove-update` CAN CHECK THE OTHER DIRECTION. On a
      // `reviewed: false` edit these three are supposed to stay exactly where
      // they are, and nothing checked that they did: `prove-update` walks what
      // was sent, and on this path none of them is sent. `fill` depends on that
      // promise for every artifact it touches, so the promise needed something
      // watching it. The values are the workspace's own names, which is how they
      // come back.
      //
      // ALL THREE, WITH AN EXPLICIT null FOR THE ONES THE ROW DID NOT CARRY.
      // Keyed only on the fields present, an empty verification field dropped
      // out of this object entirely, `prove-update` marked it unknown, and a
      // stamp landing on a field that had been empty was proved as a clean
      // write. That is the backfill case exactly: a backfilled artifact has all
      // three empty, which is what makes the never-verified signal work, so the
      // one transition that matters is the one that went unwatched.
      verificationBefore: Object.fromEntries(
        schema.VERIFICATION_FIELDS.map(logical => [
          context.property(logical),
          logical in before ? before[logical] : null
        ])
      ),
      verificationBeforeNote:
        'These are the three as the fetched artifact held them, with null for any the row did not carry. ' +
        'A field this says was empty and that comes back holding something has either been stamped by something ' +
        'other than this edit, or was never in the row you fetched. Both need a person, and `prove-update` names both.',
      verificationNote: after.reviewed === true
        ? `Recorded as a review, so ${verification.join(', ')} all move together to today's stamp.`
        : 'NOT recorded as a review, so Last checked for accuracy, Verified by and Verified date are all left where they are. ' +
          'This edit does not make the artifact look freshly checked.',
      archiving,
      archiveNote: archiving
        ? 'THIS ARCHIVES THE ARTIFACT. Ask before sending it. Nothing here archives without a yes.'
        : null,
      // BUILT FROM THE MERGED ROW, NOT THE AFTER ROW. The sections a body has
      // are decided by the `Type`, and an edit that changes only the body is not
      // changing the type, so under the rule that an absent key means untouched
      // the after row has no reason to carry one. Built from `after` alone it
      // threw "No template for undefined" on exactly the edit this command is
      // most for. `merged.body` is `after.body`, so what gets written is still
      // only what was sent.
      body: after.body ? artifact.body(merged, { partialBody: true }) : null,
      headings: after.body ? artifact.expectedHeadings(merged, { partialBody: true }) : null,
      bodyNote: after.body
        ? 'The body is included because one was passed. Send only the sections that changed. Rewriting a body ' +
          'wholesale when one section changed loses the wording of everything else.'
        : 'No body was passed, so nothing about the body is being changed.',
      parentRelation: null,
      parentRelationNote: 'This version writes no Parent or Supersedes relation. Both are still unbuilt.',
      note:
        'Send these properties as an update to the page named by `target`. Then re-fetch it, keeping its url, and pass ' +
        'THIS OUTPUT and the re-fetched page to `prove-update`. Not the two files this command was given: rebuilding ' +
        'the payload from a merged row cannot see an emptied property, so it would report a failed clear as a clean write.'
    }, null, 2))
  },

  /**
   * Prove the update landed, INCLUDING WHAT IT EMPTIED.
   *
   * It takes this command's own output rather than the before and after files,
   * because a payload rebuilt from a merged row has no record of what was
   * cleared, and a clear that silently failed is indistinguishable from one that
   * worked.
   */
  'prove-update' (updateFile, readbackFile) {
    const context = contextOrExit()
    if (!updateFile || !readbackFile) {
      throw new Error("prove-update needs the update output and the page as it came back: node process.js prove-update update.json readback.json")
    }
    const intended = readJson(updateFile, 'the update that was sent', 'fields')
    const readback = readJson(readbackFile, 'the page as it came back', 'fields')

    // IT HAS TO BE `update`'s OUTPUT, AND THAT IS CHECKED. Given anything else,
    // the page-binding check found no target to compare and the property loop
    // found no properties to walk, so it printed a clean proof having looked at
    // nothing. A proof that passes on the wrong input is worse than no proof.
    /*
     * AND `properties` HAS TO BE A SET OF PROPERTIES, NOT MERELY TRUTHY.
     *
     * `[]` is truthy, so a payload carrying an empty list walked through this
     * guard, `Object.entries([])` walked nothing, and the command reported
     * `proved: true`, `checked: []` and "Every property sent came back matching"
     * having compared not one property. That is the exact failure the guard
     * above was written to stop, one type short: it asked whether the field was
     * there and not whether it was the thing it is read as.
     *
     * EMPTY IS NOT THE SAME AS THE WRONG SHAPE, and the first version of this
     * fix conflated them and broke two existing checks that were right. A
     * body-only edit changes no property, so `update` prints `properties: {}`
     * with headings beside it, and that is a real payload. What is not a real
     * payload is a list. The emptiness is handled where it belongs, at the
     * verdict below: a run that compared nothing is not a proof.
     */
    const carriesProperties = intended && intended.properties !== null &&
      typeof intended.properties === 'object' && !Array.isArray(intended.properties)

    if (!intended || typeof intended !== 'object' || !intended.target || !carriesProperties) {
      throw new Error(
        'That file is not the output of `update`. It needs the `target` and `properties` that `update` printed. ' +
        'Passing the before or after row here would rebuild a payload with no record of what was cleared, ' +
        'and a clear that silently failed would read as a clean write.'
      )
    }

    const problems = []
    const checked = []
    const unchecked = []

    if (readback && readback.properties !== undefined &&
        (readback.properties === null || typeof readback.properties !== 'object' || Array.isArray(readback.properties))) {
      throw new Error(
        `The page that came back carries ${describeShape(readback.properties)} where its properties should be. ` +
        'It is read one property at a time, so as it stands nothing on the page can be compared with what was sent, ' +
        'and a write that landed wrong would read as clean. Save the whole page, not a summary of it.'
      )
    }

    const gotUrl = readback.url || (readback.page && readback.page.url)
    const got = pageKey(gotUrl)
    if (!got) {
      problems.push('The page that came back carries no usable url, so nothing can say it is the page that was written.')
    } else if (intended.target && got !== intended.target) {
      problems.push(
        `The page that came back is not the one that was updated. Sent to ${intended.target}, read back ${got}. ` +
        'Nothing below was checked, because checking a different page would report a clean write on the wrong artifact.'
      )
    }

    if (!problems.length) {
      // A RECORD OR ABSENT, AND NOTHING ELSE REACHES HERE. The refusal at the
      // top of the command is the only place that decides what a read-back's
      // properties may be, so this asks whether there are any rather than asking
      // the shape question a second time. Two homes for one rule is how the
      // first seven copies of the emptiness test drifted.
      const back = (readback.properties && typeof readback.properties === 'object') ? readback.properties : null
      if (!back) {
        problems.push('The page came back with no properties, so nothing could be compared. Save the whole page, not a summary of it.')
      } else {
        // COMPARED THROUGH THE TYPE, NOT AS STRINGS. A property does not come
        // back in the shape it went out in: a person is read back prefixed, a
        // list arrives as a string holding a JSON array, a date can carry a
        // time. Compared raw every one of those reads as a failed write, so a
        // perfect update reported itself as not landed. The first version of
        // this did exactly that, and its test passed only because the fixture
        // fed the flat payload back instead of a page.
        //
        // The workspace's name is what comes back, so the type is looked up
        // through the logical name that name belongs to.
        const logicalOf = {}
        for (const logical of Object.keys(PROPERTY_TYPES)) logicalOf[context.property(logical)] = logical

        /*
         * THE THREE THAT WERE SUPPOSED NOT TO MOVE.
         *
         * On a `reviewed: false` edit none of them is sent, so the loop below
         * never looks at them and a page that came back freshly stamped read as
         * a clean write. That is the promise `update` prints in as many words,
         * and until now nothing checked it. `fill` leans on it for every
         * artifact it touches.
         *
         * Compared through the type like everything else, because a date comes
         * back carrying a time and a person comes back prefixed, and compared
         * raw both read as a change nobody made.
         */
        if (intended.reviewed !== true && intended.verificationBefore) {
          for (const [name, was] of Object.entries(intended.verificationBefore)) {
            const now = back[name]
            const logical = logicalOf[name]
            const verdict = compareProperty(PROPERTY_TYPES[logical], was, now)
            if (verdict.state === 'same') {
              checked.push(`${name} (unchanged, as a non-review edit requires)`)
              continue
            }
            const empty = cameBackEmpty

            if (empty(now) && empty(was)) {
              checked.push(`${name} (empty before and after, which a non-review edit requires)`)
              continue
            }

            // ABSENT IS NOT A CHANGE, BECAUSE ABSENT HAS TWO CAUSES. Notion
            // leaves an empty property off a page rather than returning it
            // holding nothing, and a read-back that was saved as a summary
            // rather than a whole page looks exactly the same. Calling either
            // one a cleared field reports a clean edit as a failure, which is
            // the false positive this file has been corrected for before.
            //
            // The direction that CAN be told apart is the dangerous one: a value
            // appearing where there was none. That is a stamp landing on an edit
            // that was not a review, and it is what this check is for.
            if (empty(now)) {
              unchecked.push(
                `${name} was not on the page that came back. Notion leaves an empty property off a page and a summary ` +
                'read-back leaves everything off, so this cannot tell an emptied field from an unsaved one. Save the ' +
                'whole page if it matters.'
              )
              continue
            }

            if (empty(was)) {
              // TWO CAUSES, AND THE MESSAGE NAMES BOTH. The field was empty on
              // the row that was fetched and holds something now, which is
              // either a stamp landing from somewhere this edit did not send,
              // or a before row that never carried the column. Blaming one of
              // those sends somebody looking in the wrong place, and on a
              // backfilled artifact the first one is the whole reason this
              // check exists: all three are empty by design, so this is the
              // transition that matters.
              problems.push(
                `"${name}" was empty on the artifact that was fetched and holds ${JSON.stringify(now)} on the page that came back. ` +
                'This edit was not recorded as a review and sent nothing for it, so either something else stamped it, or the row ' +
                'you fetched did not carry that property. Both need a person to look. On a backfilled artifact all three are empty ' +
                'by design, which is what makes the never-verified audit signal work, so this is the transition that matters most.'
              )
              continue
            }
            problems.push(
              `"${name}" changed on an edit that was not recorded as a review. It held ${JSON.stringify(was)} and now holds ${JSON.stringify(now)}. ` +
              'Nothing here sent it, so something else did. Last checked for accuracy drives the staleness check, and moving it on an ' +
              'edit that was not a review makes a stale document look freshly checked with nothing downstream able to tell.'
            )
          }
        }
        for (const [name, sent] of Object.entries(intended.properties)) {
          if (!(name in back)) {
            // AN EMPTIED PROPERTY IS ALLOWED TO BE ABSENT. Notion leaves an
            // empty property out of a page rather than returning it holding
            // nothing, so a clear that landed perfectly came back reported as a
            // write that never happened. Absent and empty are the same state,
            // and the only thing that was asked for here was empty.
            if (asksToEmpty(sent)) {
              checked.push(`${name} (emptied, and absent from the page, which is how Notion returns an empty property)`)
              continue
            }
            problems.push(`"${name}" was sent and is not in what came back, so the write did not land.`)
            continue
          }
          const logical = logicalOf[name]
          const verdict = compareProperty(PROPERTY_TYPES[logical], sent, back[name])
          if (verdict.state === 'same') {
            checked.push(name)
            continue
          }
          if (verdict.state === 'unchecked') {
            unchecked.push(`"${name}": ${verdict.why}`)
            continue
          }
          problems.push(`"${name}" came back as ${JSON.stringify(verdict.back)} and was sent as ${JSON.stringify(verdict.sent)}.`)
        }
      }
    }

    // ONLY ONCE THE PAGE IS KNOWN TO BE THE RIGHT ONE. This block used to run
    // whatever the binding check found, so a read-back of a different page had
    // its headings compared and reported as checked, under a result that had
    // already said nothing below was looked at.
    //
    // THE HEADINGS ARE CHECKED WHEN THEY CAME BACK. `update` says which headings
    // it is writing and this used to list the whole body as unchecked without
    // looking at any of it, including the part it could check. A Notion page can
    // come back with a heading missing on a silent partial failure, which is the
    // same failure `new` proves against after a create.
    if (!problems.length && (intended.headings || []).length) {
      const back = (readback.headings || []).map(one => String(one).trim())
      if (!back.length) {
        unchecked.push('the headings, because the page came back without a heading list. Save the whole page, not a summary of it.')
      } else {
        for (const heading of intended.headings) {
          if (back.includes(String(heading).trim())) checked.push(`heading "${heading}"`)
          else problems.push(`The "${heading}" heading was written and is not in the page that came back.`)
        }
      }
    }

    // WHAT WAS NOT CHECKED, EVERY TIME, INCLUDING ON A PASS. A report wider than
    // the check behind it is the thing this plugin refuses in other people's
    // data, so it does not do it in its own output.
    if (intended.body) unchecked.push('the TEXT under each section, which is not compared here. Only the headings are.')
    if ((intended.clearing || []).length) {
      unchecked.push(`whether ${intended.clearing.join(', ')} read as empty for the right reason rather than never having been set`)
    }

    /*
     * A RUN THAT COMPARED NOTHING IS NOT A PROOF.
     *
     * `proved` was `problems.length === 0`, so a payload carrying nothing to
     * compare came back proved, `checked: []`, and "Every property sent came
     * back matching" having looked at not one thing. Every real payload has
     * something: a property edit has properties, a body-only edit has headings,
     * a non-review edit has the three verification fields carried for exactly
     * this reason. Nothing at all means the payload was not one.
     */
    const comparedNothing = checked.length === 0

    console.log(JSON.stringify({
      proved: problems.length === 0 && !comparedNothing,
      target: intended.target || null,
      problems,
      checked,
      unchecked,
      note: problems.length
        ? 'The update did not land as sent. Do not report it as done.'
        : comparedNothing
          ? 'Nothing was compared, so nothing is proved. A real update carries properties, or headings, or the ' +
            'verification fields a non-review edit is checked by. A payload with none of those is not one, and ' +
            'reporting it as a clean write would be the failure this command exists to catch.'
          : 'Every property sent came back matching. The list above says what was not looked at.'
    }, null, 2))
    if (problems.length || comparedNothing) process.exitCode = 1
  },

  /**
   * What backfill is allowed to read, or every reason this is not a scope.
   *
   * THIS RUNS BEFORE ANYTHING IS READ AND IT IS THE ONLY GATE THERE IS. Every
   * other judgment in backfill sits behind an approval list, where being wrong
   * costs one "no". This one does not: by the time a candidate list exists, the
   * reading has already happened. So it refuses rather than narrowing, and it
   * says what it is not reading as well as what it is.
   */
  scope (file) {
    if (!file) throw new Error('Usage: node process.js scope <request.json>')
    const request = readJson(file, 'the scope', 'fields')
    const out = backfill.plan(request)

    console.log(JSON.stringify({
      ...out,
      note: out.ok
        ? 'Read only what is under `reading`. Show `notReading` to the person before starting: a source that was ' +
          'left out and a source that held nothing produce the same empty result, and only one of them is worth ' +
          'saying out loud.'
        : 'NOTHING IS READ. Every refusal above is a question for the person, not something to work around by ' +
          'narrowing the scope yourself. A scope quietly trimmed reads less than was asked for and reports that it ' +
          'read what was asked for.'
    }, null, 2))
    if (!out.ok) process.exitCode = 1
  },

  repeats (file) {
    if (!file) throw new Error('Usage: node process.js repeats <askings.json>')
    const askings = readJson(file, 'the questions and where they were asked', 'list')
    const out = backfill.repeats(askings)

    console.log(JSON.stringify({
      ...out,
      note: out.ok
        ? 'Every cluster is a candidate, not a verdict. Show the wordings and where each one was asked, and let the ' +
          'person say whether they are the same question. The threshold above has never been measured against a real ' +
          'workspace, so read a score as a hint.'
        : 'Nothing was clustered. Every refusal above is an asking that could not be traced back to where it was said.'
    }, null, 2))
    if (!out.ok) process.exitCode = 1
  },

  candidates (file) {
    if (!file) throw new Error('Usage: node process.js candidates <found.json>')
    const found = readJson(file, 'what was found', 'list')
    const out = backfill.candidates(found)

    console.log(JSON.stringify({
      ...out,
      note: out.ok
        ? 'RUN `duplicates` AND `judge` ON EACH CANDIDATE BEFORE OFFERING IT. That is the same check `new` uses, and ' +
          'it is what makes backfill safe to re-run: a second pass over the same folder finds the same documents and ' +
          'the check recognises them. `withinRunNearMatches` is a different thing, and catches the case the library ' +
          'check cannot: the same process described in two places, arriving twice in this run, neither in the library yet.'
        : 'No candidate list was built. Every refusal above is either a line nobody could judge or one that could not ' +
          'be traced back to where it came from.'
    }, null, 2))
    if (!out.ok) process.exitCode = 1
  },

  draft (file, todayArg) {
    if (!file) throw new Error('Usage: node process.js draft <candidate.json> [YYYY-MM-DD]')
    const candidate = readJson(file, 'the approved candidate', 'fields')
    const today = todayArg === undefined ? undefined : dayOrRefuse(todayArg, 'writing')
    const out = backfill.draft(candidate, { today })

    console.log(JSON.stringify({
      ...out,
      note: out.ok
        ? 'Preview this in full before writing it. Then `create` and `prove`, the same two steps `new` uses: the ' +
          '`backfill: true` on the artifact is what keeps the person fields and the verification stamp off the page, ' +
          'and both commands read it from this same file so they cannot disagree about which mode this is.'
        : 'This draft is not writable yet. Anything under `problems` is a refusal and anything under `refusals` is a ' +
          'question for the person. A section reported missing is content still to be written from what was read, ' +
          'not a reason to invent one.'
    }, null, 2))
    if (!out.ok) process.exitCode = 1
  },

  fill (existingFile, candidateFile) {
    if (!existingFile || !candidateFile) {
      throw new Error('fill needs the artifact as it is now and the candidate: node process.js fill existing.json candidate.json')
    }
    const context = contextOrExit()
    const existing = readJson(existingFile, 'the artifact as it is now', 'fields')
    const candidate = readJson(candidateFile, 'the candidate', 'fields')

    // THE SAME GUARD `update` USES, AND FOR A WORSE FAILURE. On a raw-keyed row
    // every logical lookup is undefined, and what that means depends on which
    // side it is on. Both sides are guarded, because `update` guards both and a
    // guard applied to one of two arguments is the shape of a fix whose pair
    // was missed:
    //
    //   - `existing` read raw makes a row whose every field is filled read as a
    //     row whose every field is blank, and the never-overwrite rule stops
    //     meaning anything.
    //   - `candidate` read raw makes a candidate carrying values read as a
    //     candidate offering nothing, so nothing is filled and the output says
    //     there was nothing to fill. That is reported as a finished answer and
    //     exits zero, which is the quieter of the two failures and the harder
    //     one to notice.
    // BUILT FROM WHAT `fill` READS, and from one list rather than assembled
    // here. Assembled here it was two of the three lists, and `fill` later
    // learned to read `Name` and `Type` as well, which were in neither.
    refuseRawKeys(context, [
      ['existing', existing],
      ['candidate', candidate]
    ], 'read as empty, so nothing is filled and this reports that there was nothing to fill',
    backfill.READ_BY_FILL)

    const out = backfill.fill(existing, candidate)
    console.log(JSON.stringify(out, null, 2))

    // `fill` puts a missing url under `refusals` and everything it declined to
    // touch under `refused`, and this checked only the first, so a fill refused
    // for carrying `Verified date` printed the refusal and exited zero.
    //
    // ONLY THE NEVER-FILLED HALF OF `refused` IS A FAULT. A field that is
    // already occupied is backfill working, and on a re-run over the same folder
    // most fields are, so exiting non-zero on that would cry wolf on every
    // normal run. `ok: false` on its own is not a failure either: having nothing
    // left to fill is a finished answer.
    const refused = (out.refusals && out.refusals.length) || (out.neverFilled && out.neverFilled.length)
    if (refused) process.exitCode = 1
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
  readJson,
  describeShape,
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

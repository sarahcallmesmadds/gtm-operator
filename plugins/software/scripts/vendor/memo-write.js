// GENERATED FILE. DO NOT EDIT.
// Copied from shared/memo-write.js by scripts/vendor.js.
// Edit the source and re-run that script. An edit here is reverted by the
// next run and reported as drift by tests/vendor-copies-current.test.js.
'use strict'

/**
 * Building and validating one memo.
 *
 * THIS FILE IS THE SOURCE. It is vendored into plugins by `scripts/vendor.js`,
 * beside the files it requires, and `tests/vendor-copies-current.test.js`
 * fails when a copy has drifted. It lived at `plugins/memos/scripts/memo.js`
 * until 2026-08-24, when `projects` gained three skills that write Memos rows
 * (`problem-statement`, `comms`, `ship`) and `plugins/memos/SKILLS.md` open item 2
 * came due: the memo shapes must be one definition in every plugin that
 * writes them, not a hand copy per plugin.
 *
 * Every rule Notion cannot enforce and every rule a model will drift on lives
 * here rather than in the skill prose, because prose is advice and this is a
 * gate. `plugins/memos/SCHEMA.md` defines the fields, the values and the templates;
 * this file does not restate a value list, it reads them from the shipped
 * schema.
 *
 * PURE. It builds a payload and judges a shape. It sends nothing.
 *
 * THERE IS NO PARTIAL-BODY MODE HERE, and its absence is the design. Process
 * needed one because `update` sends only the sections that changed. Memos has
 * no update: the body is written once, whole, at publication, and never again.
 * A correction is a new memo. So every required section is judged on every
 * write, with no second mode for a fault to hide in.
 *
 * TWO KINDS OF FINDING, same split as Process. `problems` are refusals: a
 * write carrying one is wrong and `properties` throws rather than sending it.
 * `concerns` are questions for a person, and the word ceiling is why the split
 * exists: at the ceiling the skill asks whether the detail belongs in a
 * Process artifact this memo should link to, rather than trimming to get past
 * a gate.
 */

const path = require('path')

// The schema is the one definition of the fields and their values. Reading it
// here rather than restating it is the same rule `CLAUDE.md` states for
// counts: a value written beside the thing it defines is a copy, and copies
// drift.
//
// SIBLING REQUIRES, NOT `vendor/` ONES. In `shared/` these three files sit
// beside this one, and in every plugin's `scripts/vendor/` they do too, so the
// same path works in both places. A plugin that vendors this file has to
// vendor its three siblings with it, and `vendor.js` fails on a name that
// does not exist.
const schema = require(path.join(__dirname, 'memos-schema'))
const { cameBackEmpty } = require(path.join(__dirname, 'notion-compare'))
const { pageIdentity } = require(path.join(__dirname, 'page-id'))

const {
  TYPES, WRITABLE_STATUSES, PERSON_FIELDS, TAGS_MAX, MULTI_SELECT_FIELDS,
  PERIOD_TYPE, WORD_CEILING, IDENTITY_VALUES,
  listProblem, listValues, sectionsFor, requiredSectionsFor, carriesPeriod
} = schema

/**
 * The tree that decides which of the seven types this is.
 *
 * Users get Type wrong more often than any other field, so it ships in code as
 * well as in the skill, and the skill shows it rather than deciding alone. The
 * order is the schema's option order; when two match, the skill asks rather
 * than taking the first.
 */
const TYPE_TREE = [
  { ask: 'Is it considered thinking or a recommendation, asking the reader for something?', then: 'Memo' },
  { ask: 'Is it status on one project, for the people it affects?', then: 'Project Update' },
  { ask: 'Does it summarise a stretch of time for the whole team?', then: 'Team Update' },
  { ask: 'Does it record what a meeting decided, on a date?', then: 'Meeting Notes' },
  { ask: 'Does it make the case that something is worth fixing, before anyone proposes a fix?', then: 'Problem Statement' },
  { ask: 'Did something ship and reach the people who will use it?', then: 'Release' },
  { ask: 'Did something break that someone outside the team noticed?', then: 'Incident Report' }
]

/**
 * The judgment that comes before the tree: whether this is a memo at all.
 *
 * The most common mistake will be writing process documentation as a memo,
 * because a memo is quicker. The test is what happens to the content later,
 * and it cuts both ways: a status update written as an SOP is just as wrong.
 */
const MEMO_OR_ARTIFACT = {
  ask: 'Will somebody return to this and maintain it, or does it record what was said on a date?',
  maintained: 'It is an artifact. Point at process:new rather than writing a memo.',
  dated: 'It is a memo. Carry on.'
}

const PERSON_ID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i

function personIdFrom (value) {
  // A PERSON IS WRITTEN BARE AND READ BACK PREFIXED, measured 2026-08-20. The
  // prefixed form is what a caller holds after fetching a row, so it is
  // accepted here and the bare id is what gets written.
  const id = String(value).trim().replace(/^user:\/\//, '')
  if (!PERSON_ID.test(id)) {
    throw new Error(`"${value}" is not a Notion person id. Ids are uuids; a name is not one.`)
  }
  return id
}

/**
 * The people a caller actually asked for, or null where they asked for
 * nothing. Null covers two situations the caller has to tell apart and this
 * cannot: nobody was mentioned, and "me" was. `properties` handles that
 * distinction, because only one of them is a request.
 */
function peopleAsked (value) {
  // ASKED THROUGH THE ONE RULE for the empty shapes. `'[]'` is what Notion
  // returns for an empty person field; `cameBackEmpty` records why, and every
  // hand-written copy of this test in this repository has missed one shape.
  if (value === undefined || value === 'me') return null
  if (cameBackEmpty(value)) return []
  if (Array.isArray(value)) return value.filter(v => v !== undefined && v !== null && String(v).trim())
  return [value]
}

/** The words in a string, counted the way a person would count them. */
function words (text) {
  if (typeof text !== 'string') return 0
  const trimmed = text.trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/).length
}

/** Words across the required sections only. Conditional ones sit outside. */
function wordCount (final) {
  const required = requiredSectionsFor(final && final.Type)
  if (!required) return 0
  const body = (final && final.body) || {}
  return required.reduce((total, heading) => total + words(body[heading]), 0)
}

/**
 * A day that exists, or a refusal naming what would have gone wrong.
 *
 * WRITTEN BACK OUT AND COMPARED, the same round trip `process.js` and
 * `calendar.js` both learned the hard way: `Date.parse` takes `2026-02-30` and
 * hands back the 2nd of March, so a regex and a not-NaN test together still
 * let a rolled-over day through into a Notion date property.
 */
function dayProblem (value, field) {
  const text = String(value)
  const parsed = Date.parse(`${text}T00:00:00Z`)
  if (/^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(parsed) &&
      new Date(parsed).toISOString().slice(0, 10) === text) return null
  return `${field} holds ${JSON.stringify(value)}, which is not a day. Use YYYY-MM-DD. It is refused rather than written, because it would go into a date property as the text it is.`
}

/**
 * Whether `body` is the shape everything downstream reads it as: a map of
 * heading to text. A string, a list or a number indexes to `undefined` for
 * every heading, so a malformed body would be judged clean and rendered to
 * nothing, and the memo would publish empty without a word.
 */
function bodyIsMap (value) {
  if (value === undefined || value === null) return true
  return typeof value === 'object' && !Array.isArray(value)
}

/**
 * Everything wrong with a `sources` list, as `{ field, kind, message }`.
 *
 * The rule it enforces is the one every skill carries: record every source you
 * actually opened, and never one you did not. A Sources section that cannot be
 * trusted is worse than none, because a reader has no way to tell which lines
 * are real.
 */
function sourceProblems (sources) {
  const found = []
  const add = (kind, message) => found.push({ field: 'Sources', kind, message })

  if (sources === undefined || sources === null) return found
  if (!Array.isArray(sources)) {
    add('not-a-list', 'Sources is a list of what was actually read.')
    return found
  }

  for (const source of sources) {
    if (source === null || typeof source !== 'object' || Array.isArray(source)) {
      add('source-not-a-record', `A source is ${JSON.stringify(source)}, which is not an entry. Each one is a set of fields: what was read, and what it contributed.`)
      continue
    }
    if (typeof source.what !== 'string' || !source.what.trim()) {
      add('source-unnamed', 'A source with no name cannot be checked by a reader, which is the only thing the section is for.')
      continue
    }
    if (typeof source.contributed !== 'string' || !source.contributed.trim()) {
      add(
        'source-uncontributed',
        `"${source.what}" is listed with no line saying what it contributed. A Sources section that cannot be trusted is worse than none.`
      )
    }
  }
  return found
}

/**
 * The Sources section, rendered from the sources that were actually read.
 *
 * ONE SOURCE OF TRUTH FOR A SECTION THAT COULD HAVE TWO. `sources` is the
 * structured record this file validates, and a free-text `body.Sources` would
 * be an unchecked claim beside it. So the section is generated from the
 * record, always: a supplied `body.Sources` that is not this text is refused
 * by `problems`, and there is no hand-written path. Process allows one on an
 * artifact somebody typed and cross-checks only on a backfill; a memo's rule
 * is harder, because "record every source you actually opened, and never one
 * you did not" is the whole of what the section is for.
 */
function sourcesSection (sources) {
  if (!Array.isArray(sources)) return ''
  return sources
    .filter(source => source && typeof source.what === 'string' && source.what.trim())
    .map(source => `- ${source.what.trim()}: ${String(source.contributed || '').trim()}`)
    .join('\n')
}

/**
 * The `Corrects` request on a proposed memo, judged before anything is built.
 *
 * ONE TARGET IS THE RULE, from `plugins/memos/SKILLS.md`: a memo corrects exactly one
 * memo. Correcting several means several memos, or a new memo that corrects
 * nothing and supersedes by being newer. More than one is refused here, which
 * is the write-time half of the rule; `follow` reports violations a person
 * clicking in Notion has built, which is the read-time half.
 *
 * Returns `{ target }` with the page identity, `null` where nothing was asked,
 * or a problem entry.
 */
function correctionAsked (value) {
  if (value === undefined || value === null || value === '' ||
      (Array.isArray(value) && value.length === 0)) return null

  const entries = Array.isArray(value) ? value : [value]
  if (entries.length > 1) {
    return {
      problem: {
        field: 'Corrects',
        kind: 'corrects-several',
        message: `Corrects names ${entries.length} memos and a memo corrects exactly one. Correcting several means several correcting memos, or a new memo that corrects nothing and supersedes by being newer.`
      }
    }
  }
  const target = pageIdentity(entries[0])
  if (!target) {
    return {
      problem: {
        field: 'Corrects',
        kind: 'corrects-unidentifiable',
        message: `Corrects holds ${JSON.stringify(entries[0])}, which is not a Notion page this can identify. Pass the memo's url, so the correction points at a page rather than at a description of one.`
      }
    }
  }
  return { target }
}

/**
 * Everything wrong with this memo that makes it unwritable.
 *
 * Returns a list of `{ field, kind, message }`. Empty means the row can be
 * written, which is what `properties` checks before building a payload.
 */
function problems (final) {
  const found = []
  const add = (field, kind, message) => found.push({ field, kind, message })

  const row = final || {}

  // ------------------------------------------------------------------ identity

  // MISSING AND MALFORMED ARE DIFFERENT ANSWERS. A `Name` that arrived as an
  // object would reach Notion as the literal "[object Object]" as a page
  // title, so it is refused by name rather than reported as absent.
  if (row.Name !== undefined && row.Name !== null && typeof row.Name !== 'string') {
    add(
      'Name',
      'not-text',
      `Name is ${JSON.stringify(row.Name)}, which is not text. It is the title property, written with \`String()\`, so as it stands it would become the page's title as whatever that makes of it.`
    )
  } else if (typeof row.Name !== 'string' || !row.Name.trim()) {
    add('Name', 'missing', 'Every memo needs a name. It is the title property and Notion will not create a page without one.')
  }

  if (!row.Type) {
    add('Type', 'missing', `No type, so there is no template to write. One of: ${TYPES.join(', ')}.`)
  } else if (!TYPES.includes(row.Type)) {
    add('Type', 'unknown-value', `"${row.Type}" is not a type this database has. One of: ${TYPES.join(', ')}.`)
  }

  if (row.Description !== undefined && row.Description !== null && typeof row.Description !== 'string') {
    add(
      'Description',
      'not-text',
      `Description is ${JSON.stringify(row.Description)}, which is not text. Written as it stands it reaches Notion as whatever \`String()\` makes of it, and nothing downstream would report that as wrong.`
    )
  }

  if (row.Status !== undefined && !WRITABLE_STATUSES.includes(row.Status)) {
    add(
      'Status',
      'not-writable',
      `A skill may write ${WRITABLE_STATUSES.join(' or ')}, and "${row.Status}" is not it. ` +
      'Draft is a person\'s to set in Notion, because a skill that writes a draft has written nothing useful. ' +
      'Canceled is a retraction: a person makes it, and it requires a correcting memo saying why.'
    )
  }

  // -------------------------------------------------------------- select values

  if (row.Domain !== undefined && row.Domain !== null && row.Domain !== '') {
    if (!IDENTITY_VALUES.Domain.includes(row.Domain)) {
      add('Domain', 'unknown-value', `"${row.Domain}" is not a Domain this database has. Notion refuses the whole write on an unknown select value, so the page would not be created at all.`)
    }
  }

  // --------------------------------------------------------- multi-select values

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

  const tags = listProblem(row.Tags) ? [] : listValues(row.Tags)
  if (tags.length > TAGS_MAX) {
    add(
      'Tags',
      'too-many',
      `${tags.length} tags, and the cap is ${TAGS_MAX}. Notion cannot enforce this and no view can watch it, so it is refused here rather than written and reported later by setup:check.`
    )
  }

  // -------------------------------------------------------------------- dates

  if (row['Published date'] !== undefined && row['Published date'] !== null && row['Published date'] !== '') {
    const wrong = dayProblem(row['Published date'], 'Published date')
    if (wrong) add('Published date', 'not-a-day', wrong)
  }

  // ------------------------------------------------------------ Period covered

  /*
   * THE FIELD THAT SEPARATES A TEAM UPDATE FROM A PROJECT UPDATE, enforced in
   * both directions. Required on a Team Update, because a summary of a period
   * that does not say which period is not one. Refused on every other type,
   * because `plugins/memos/SKILLS.md` says in as many words that nothing else sets it,
   * and dropping it silently would tell the caller it was saved.
   */
  const period = row['Period covered']
  const periodEmpty = period === undefined || period === null || period === ''
  if (carriesPeriod(row.Type)) {
    if (periodEmpty || typeof period !== 'object' || Array.isArray(period)) {
      add(
        'Period covered',
        'period-missing',
        `A ${PERIOD_TYPE} covers a stretch of time and says which: pass Period covered as { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" }. It is the field that separates this type from a Project Update.`
      )
    } else {
      for (const edge of ['start', 'end']) {
        if (period[edge] === undefined || period[edge] === null || period[edge] === '') {
          add('Period covered', 'period-open', `Period covered has no ${edge}. A period is a stretch of time, and a stretch of time has both ends.`)
          continue
        }
        const wrong = dayProblem(period[edge], `Period covered ${edge}`)
        if (wrong) add('Period covered', 'not-a-day', wrong)
      }
      if (period.start && period.end && !dayProblem(period.start, 'x') && !dayProblem(period.end, 'x') &&
          String(period.start) > String(period.end)) {
        add('Period covered', 'period-backwards', `Period covered runs from ${period.start} to ${period.end}, which is backwards.`)
      }
    }
  } else if (!periodEmpty && row.Type && TYPES.includes(row.Type)) {
    add(
      'Period covered',
      'period-wrong-type',
      `Period covered is set on a ${row.Type}, and only a ${PERIOD_TYPE} carries it. It is refused rather than dropped, because a value somebody supplied that silently does not arrive looks saved.`
    )
  }

  // ---------------------------------------------------------------- correction

  const correction = correctionAsked(row.Corrects)
  if (correction && correction.problem) found.push(correction.problem)

  // --------------------------------------------------------------------- the body

  const sections = sectionsFor(row.Type)
  if (sections && !bodyIsMap(row.body)) {
    add(
      'body',
      'not-a-section-map',
      `\`body\` is ${JSON.stringify(row.body)}, which is not a set of sections. It is read as heading to text, one key per heading, and anything else indexes to nothing for every heading, so the memo would publish empty without a word. It is refused rather than read as an empty body.`
    )
  } else if (sections) {
    const body = row.body || {}
    for (const section of sections) {
      const text = body[section.heading]
      const filled = typeof text === 'string' && text.trim()
      if (!filled) {
        if (section.conditional) continue
        add(
          section.heading,
          'section-missing',
          `The ${section.heading} section is empty. A section that does not apply says so in place: on a memo the empty case is usually information, and the skill knows the phrase for it.`
        )
      }
    }
  }

  // ------------------------------------------------------------------- sources

  found.push(...sourceProblems(row.sources))

  /*
   * THE SECTION AND THE RECORD ARE ONE THING, AND THE RECORD IS IT. `sources`
   * is validated above and the Sources section is generated from it in
   * `body()`, so a `body.Sources` supplied by hand is either a copy of the
   * generated text, which is accepted, or a claim nothing checked, which is
   * refused. Without this, the structured list was validated and then dropped
   * while the section a reader actually sees went out unchecked, and the
   * skill's promise that a source with no line of context is refused did not
   * hold. Found by review on the first round of this plugin.
   */
  const listed = Array.isArray(row.sources) && row.sources.length > 0
  const sectioned = sections && sections.some(section => section.heading === 'Sources')

  if (listed && sections && !sectioned) {
    add(
      'Sources',
      'sources-no-section',
      `Sources are recorded on a ${row.Type}, whose template has no Sources section, so there is nowhere for them to appear. ` +
      'They are refused rather than validated and dropped, because a record that silently goes nowhere looks kept.'
    )
  }

  if (sectioned && bodyIsMap(row.body)) {
    const written = (row.body || {}).Sources
    if (written !== undefined && written !== null && typeof written !== 'string') {
      add(
        'Sources',
        'not-text',
        `The Sources section is ${JSON.stringify(written)}, which is not text. It is generated from the sources that were actually read, and a value that is not text cannot be compared against that record.`
      )
    } else if (typeof written === 'string' && written.trim()) {
      const expected = sourcesSection(row.sources).trim()
      if (!listed) {
        add(
          'Sources',
          'sources-hand-written',
          'The Sources section is written by hand and no sources are recorded. The section is generated from the ' +
          'structured `sources` list, each entry saying what was read and what it contributed, so pass the list ' +
          'rather than the text: a hand-written Sources section is exactly the unchecked claim the rule exists to stop.'
        )
      } else if (written.trim() !== expected) {
        add(
          'Sources',
          'sources-disagree',
          'The Sources section does not match the sources this memo records, so the section says one thing and the ' +
          'record says another. The section is generated from the record; leave `body.Sources` out, or make it ' +
          'exactly:\n' + expected
        )
      }
    }
  }

  return found
}

/**
 * Things a person has to answer before this is written, which are not faults.
 *
 * Refusing an over-long memo would make the skill trim to get past the gate,
 * and for a memo the honest remedy is usually a Process artifact carrying the
 * detail, linked rather than inlined.
 */
function concerns (final) {
  const raised = []
  const row = final || {}

  const count = wordCount(row)
  if (count > WORD_CEILING) {
    raised.push({
      kind: 'over-ceiling',
      count,
      ceiling: WORD_CEILING,
      message:
        `${count} words across the required sections, against a ceiling of ${WORD_CEILING}. ` +
        'A memo is read once on the day it lands. Running long usually means the detail belongs in a Process ' +
        'artifact this memo should link to instead, so the question is where the detail lives, not how to trim it.'
    })
  }

  return raised
}

/**
 * The Notion property payload for this memo.
 *
 * Throws on any problem rather than sending a payload Notion will refuse as a
 * whole. `concerns` are not checked here: they are the skill's to raise, and a
 * skill that has raised one and been told to go ahead must still be able to
 * write.
 *
 * WHAT IS NOT IN THE PAYLOAD, SAID HERE BECAUSE A READER WILL LOOK HERE FIRST:
 * no relation is written. `Corrects`, `Artifacts` and `Projects` are all
 * relations, no plugin in this marketplace has measured a relation write on
 * this surface, and an unmeasured write that fails silently would report a
 * correction as filed when nothing points anywhere. `create` says so in its
 * output, per memo, so the caller can put the link in by hand.
 */
function properties (context, final, { today } = {}) {
  const found = problems(final)
  if (found.length) {
    throw new Error(
      `This memo cannot be written yet:\n  ${found.map(p => p.message).join('\n  ')}`
    )
  }

  const out = {}
  const put = (logical, value) => { out[context.property(logical)] = value }
  // A DATE IS NOT WRITTEN UNDER ITS OWN NAME. The client splits it into
  // `date:<name>:start` and `date:<name>:end`, the same columns a query
  // selects, measured by `calendar` and applied here unchanged. BOTH COLUMNS,
  // ALWAYS: omitting the end leaves a stale one behind, and the client's own
  // definition says the end must be null for a single day.
  const putDate = (logical, start, end) => {
    const name = context.property(logical)
    out[`date:${name}:start`] = start
    out[`date:${name}:end`] = end || null
  }

  put('Name', String(final.Name))
  put('Type', context.value('Type', final.Type))

  // Always Published on a create. Draft is a person's to set, and nothing else
  // is writable; `problems` has already refused anything but Published.
  put('Status', context.value('Status', 'Published'))

  if (final.Description) put('Description', String(final.Description))
  if (final.Domain) put('Domain', context.value('Domain', final.Domain))

  for (const field of MULTI_SELECT_FIELDS) {
    const values = listValues(final[field])
    if (values.length) put(field, values.map(v => context.value(field, v)))
  }

  // The timestamp that makes it a record. `today` is passed rather than read
  // from the clock so a caller can date the memo to the day it was said, and
  // so a test can pin it.
  const stamp = final['Published date'] || today || new Date().toISOString().slice(0, 10)
  const stampWrong = dayProblem(stamp, 'Published date')
  if (stampWrong) throw new Error(stampWrong)
  putDate('Published date', stamp)

  if (carriesPeriod(final.Type)) {
    putDate('Period covered', final['Period covered'].start, final['Period covered'].end)
  }

  /**
   * The nullable person rule, from `plugins/setup/SKILLS.md`. Where config records no
   * person, `Author` is OMITTED rather than written empty: a working install,
   * not a failed one. An explicit empty list is somebody asking for no author,
   * which is honoured by leaving the property off a create.
   */
  for (const field of PERSON_FIELDS) {
    const value = final[field]
    const asked = peopleAsked(value)

    if (asked === null) {
      if (context.personId) put(field, [context.personId])
      continue
    }
    if (!asked.length) continue

    put(field, asked.map(one => personIdFrom(one)))
  }

  return out
}

/**
 * The body, as headings and their text, in the order the type calls for.
 *
 * Returns `[{ heading, text }]` and omits a conditional section with nothing
 * in it. A required section with nothing in it never reaches here, because
 * `problems` refuses it.
 */
function body (final) {
  const sections = sectionsFor(final && final.Type)
  if (!sections) {
    throw new Error(`No template for "${final && final.Type}", so there is no body to build.`)
  }

  const content = (final && final.body) || {}
  const out = []

  for (const section of sections) {
    // The Sources section is generated from the record of what was read,
    // never taken from the content map. `problems` has already refused a
    // hand-written one that is not this text, so the two cannot disagree.
    const text = section.heading === 'Sources'
      ? sourcesSection(final && final.sources)
      : content[section.heading]
    const filled = typeof text === 'string' && text.trim()
    if (!filled && section.conditional) continue
    out.push({ heading: section.heading, text: filled ? text.trim() : '' })
  }

  return out
}

/**
 * The headings this memo will write, which is what `new` proves against after
 * the create. Derived from `body` so the two cannot disagree about which
 * sections are being written.
 */
function expectedHeadings (final) {
  return body(final).map(section => section.heading)
}

/**
 * Which Notion type each written Memos column holds, keyed by the column name
 * the payload actually uses, so a proof compares through the right reader.
 *
 * Moved here from the memos command layer on 2026-08-24, when `projects`
 * became the second plugin proving memo writes: the map has to agree with
 * `properties` above about which columns exist, and one file holding both is
 * how they cannot disagree.
 */
function propertyTypes (context) {
  const types = {}
  const simple = {
    Name: 'title',
    Description: 'rich_text',
    Type: 'select',
    Status: 'select',
    Domain: 'select',
    Audience: 'multi_select',
    Segment: 'multi_select',
    'L2C Lifecycle': 'multi_select',
    Tags: 'multi_select',
    Author: 'people'
  }
  for (const [logical, type] of Object.entries(simple)) types[context.property(logical)] = type
  for (const logical of ['Published date', 'Period covered']) {
    const name = context.property(logical)
    types[`date:${name}:start`] = 'date'
    types[`date:${name}:end`] = 'date'
  }
  return types
}

module.exports = {
  TYPE_TREE,
  MEMO_OR_ARTIFACT,
  PERSON_ID,
  words,
  wordCount,
  dayProblem,
  bodyIsMap,
  peopleAsked,
  personIdFrom,
  correctionAsked,
  sourceProblems,
  sourcesSection,
  problems,
  concerns,
  properties,
  body,
  expectedHeadings,
  propertyTypes
}

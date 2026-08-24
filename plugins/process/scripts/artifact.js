'use strict'

/**
 * Building and validating one Process artifact.
 *
 * Every rule Notion cannot enforce and every rule a model will drift on lives
 * here rather than in the skill prose, because prose is advice and this is a
 * gate. `SCHEMA-process.md` defines the fields, the values and the templates;
 * this file does not restate a value list, it reads them from the shipped
 * schema.
 *
 * PURE. It builds a payload and judges a shape. It sends nothing.
 *
 * TWO KINDS OF FINDING, AND THE SPLIT IS THE POINT. `problems` are refusals: a
 * write carrying one is wrong and `properties` throws rather than sending it.
 * `concerns` are questions for a person, and the word ceiling is the reason the
 * split exists. `SCHEMA-process.md` says the skill asks rather than trims at the
 * ceiling, because running long almost never means a wording problem, it means
 * the artifact is covering more than one thing. Refusing it outright would make
 * the skill trim to get past the gate, which is the exact behaviour the design
 * argues against.
 */

const path = require('path')

// The schema is the one definition of the fields and their values. Reading it
// here rather than restating it is the same rule `CLAUDE.md` states for counts:
// a value written beside the thing it defines is a copy, and copies drift.
const schema = require(path.join(__dirname, 'vendor', 'process-schema'))
const { cameBackEmpty } = require(path.join(__dirname, 'vendor', 'notion-compare'))

const {
  TYPES, WRITABLE_STATUSES, PARENT_TYPE, PERSON_FIELDS, VERIFICATION_FIELDS,
  TAGS_MAX, MULTI_SELECT_FIELDS, CADENCES, WORD_CEILING, IDENTITY_VALUES,
  listProblem, listValues, sectionsFor, requiredSectionsFor, neverEmptySectionsFor,
  canBeParent
} = schema

/**
 * The tree that decides which type an artifact is.
 *
 * Users get Type wrong more often than any other field, so it ships in code as
 * well as in the skill, and the skill shows it rather than deciding alone.
 * `SCHEMA-process.md`, "Which type is this".
 */
const TYPE_TREE = [
  { ask: 'Does it record a choice and its reasoning?', then: 'Strategy Decision' },
  { ask: 'Does it describe a repeating process someone could do wrong?', then: 'SOP/ROE' },
  { ask: 'Does it teach someone who does not know how yet?', then: 'Enablement' },
  { ask: 'Does it explain what numbers mean?', then: 'Reporting' },
  { ask: 'Does it explain how a system is wired, for whoever maintains it?', then: 'Technical Reference' }
]

/**
 * The tiebreaker, and the pairs people actually confuse.
 *
 * The same subject produces different types for different readers, so the
 * question that settles it is who the reader is and what they are trying to do.
 * Lead routing is a Strategy Decision for the person who set the rules, an SOP
 * for the person adding a rule, an Enablement doc for a new AE, and a Technical
 * Reference for whoever debugs the assignment engine.
 */
const TIEBREAKER = 'Who is the reader, and what are they trying to do?'

const CONFUSED_PAIRS = [
  {
    between: ['SOP/ROE', 'Enablement'],
    ask: 'Does the reader already know why they are doing this?',
    yes: 'SOP/ROE',
    no: 'Enablement',
    note: 'An SOP says "do X". Enablement says "here is what X is and why, then do it".'
  },
  {
    between: ['Reporting', 'Technical Reference'],
    ask: 'Is the reader interpreting a number, or fixing a thing?',
    yes: 'Reporting',
    no: 'Technical Reference',
    note: 'Audience is the test: if a non-technical reader is the audience, it is Enablement rather than either.'
  },
  {
    between: ['Strategy Decision', 'anything else'],
    ask: 'Does it contain a numbered procedure?',
    yes: 'anything else',
    no: 'Strategy Decision',
    note: 'A Strategy Decision has no steps. The moment you write a numbered procedure, it is a different type.'
  }
]

/** The phrase a never-empty section uses when there is genuinely nothing. */
const NONE_KNOWN = 'none known'

const PERSON_ID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i

/**
 * Whether a field was left alone rather than filled in.
 *
 * AN EMPTY LIST IS NOBODY, AND THAT IS THE WHOLE POINT HERE. `[]` is what
 * `update` writes to clear a person field and what `wantsAPerson` already reads
 * as asking for no one. The backfill refusals skipped `undefined`, `null` and
 * `''` and treated `[]` as a real value, so an artifact whose owner had been
 * deliberately cleared was refused with a message saying an owner was set on it.
 * Refusing somebody for asking for exactly the state backfill produces.
 */
function askedForNothing (value) {
  // ASKED THROUGH THE ONE RULE, NOT WRITTEN OUT AGAIN. This was the sixth copy
  // of the test and it missed `'[]'`, the same shape the five before it missed:
  // `wantsAPerson` and `anyPerson` in `process.js` both already read it as
  // asking for nobody, and `cameBackEmpty` records why. Written out here it
  // refused an owner that had already been emptied, which is the state a
  // backfill exists to produce.
  return cameBackEmpty(value)
}

function personIdFrom (value) {
  const id = String(value).trim()
  if (!PERSON_ID.test(id)) {
    throw new Error(`"${value}" is not a Notion person id. Ids are uuids; a name is not one.`)
  }
  return id
}

/**
 * The people a caller actually asked for, or null where they asked for nothing.
 *
 * Null covers two situations the caller has to tell apart and this cannot:
 * nobody was mentioned, and "me" was. `properties` handles that distinction,
 * because only one of them is a request.
 */
function peopleAsked (value) {
  // THE EIGHTH READER OF THE EMPTINESS RULE, AND THE ONE THAT NEVER GOT IT.
  //
  // `'[]'` is what Notion returns for an empty person field, which is why
  // `cameBackEmpty` exists and why `askedForNothing` and `wantsAPerson` both
  // read it as asking for nobody. This wrote the test out by hand and missed it,
  // so a row fetched with an empty `Owner` and handed straight back read as a
  // request for a person literally named "[]". `check` saw nothing wrong,
  // because it does not judge person values, and `properties` then threw on the
  // same file at `personIdFrom`. A gate that passes what the write refuses is
  // worse than no gate.
  if (value === undefined || value === null || value === '' || value === 'me') return null

  // `'[]'` JOINS THE EMPTY LIST, NOT THE ABSENT ONE. The caller reads three
  // answers here and only two of them are the same: null means nobody asked, so
  // the default person may be applied, and an empty list means somebody asked
  // for nobody, so the field is left alone. Folding `'[]'` into null would put
  // the config person onto an owner that had just been cleared, which is the
  // silent reassignment `properties` carries a separate warning about.
  if (value === '[]') return []

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

/**
 * Words across the required sections only.
 *
 * Conditional sections sit outside the count, which today means Sources. A
 * Sources section on a heavily researched artifact can be long and is not the
 * artifact being too big.
 */
function wordCount (final) {
  const required = requiredSectionsFor(final && final.Type)
  if (!required) return 0
  const body = (final && final.body) || {}
  return required.reduce((total, heading) => total + words(body[heading]), 0)
}

/** Whether a section's text is the explicit "none known" rather than content. */
function saysNoneKnown (text) {
  return typeof text === 'string' && text.trim().toLowerCase().startsWith(NONE_KNOWN)
}

/**
 * Everything wrong with a `sources` list, as `{ field, kind, message }`.
 *
 * SPLIT OUT SO `draft` CAN ASK BEFORE IT BUILDS. `sourcesSection` silently drops
 * an entry it cannot render, and `draft` was rendering the section before
 * anything had judged the list, so a malformed source was filtered out of the
 * section and then refused by `problems` afterwards. The refusal was right and
 * the artifact handed back alongside it had already been built from a narrowed
 * list, so its section and its record disagreed. That is the same narrowing
 * `notNames` was added to `plan` to stop: the list used before it is refused.
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
    if (!source || typeof source.what !== 'string' || !source.what.trim()) {
      add('source-unnamed', 'A source with no name cannot be checked by a reader, which is the only thing the section is for.')
      continue
    }
    if (typeof source.contributed !== 'string' || !source.contributed.trim()) {
      add(
        'source-uncontributed',
        `"${source.what}" is listed with no line saying what it contributed. A Sources section that cannot be trusted is worse than none, because a reader has no way to tell which lines are real.`
      )
    }
  }
  return found
}

/**
 * The Sources section, rendered from the sources that were actually read.
 *
 * ONE SOURCE OF TRUTH FOR A SECTION THAT HAS TWO. `sources` is a structured
 * list this file already validates, and `body.Sources` is free text a caller
 * writes. Nothing tied them together, so an artifact could list one thing in
 * its Sources section and carry a different set in `sources`, and both passed.
 * That is survivable on a create somebody wrote by hand. It is not survivable
 * on a backfill, where the whole claim being made is "this came from there",
 * so on a backfill `problems` refuses a Sources section that is not this.
 */
function sourcesSection (sources) {
  if (!Array.isArray(sources)) return ''
  return sources
    .filter(source => source && typeof source.what === 'string' && source.what.trim())
    .map(source => `- ${source.what.trim()}: ${String(source.contributed || '').trim()}`)
    .join('\n')
}

/**
 * Everything wrong with this artifact that makes it unwritable.
 *
 * Returns a list of `{ field, kind, message }`. Empty means the row can be
 * written, which is what `properties` checks before building a payload.
 *
 * `parentType` is passed rather than read off the parent, because this file
 * sends nothing and cannot look a parent up. A parent named without its type is
 * a refusal rather than an assumption: the whole rule exists because Notion
 * cannot check it, so guessing here would remove the only check there is.
 */
/**
 * Whether `body` is the shape everything downstream reads it as: a map of
 * heading to text.
 *
 * A string, a list, a number or a boolean indexes to `undefined` for every
 * heading, which under the partial-body rule reads as "not sent, leave it
 * alone". So a malformed body was judged clean, rendered to nothing, and the
 * edit was dropped without a word.
 */
function bodyIsMap (value) {
  if (value === undefined || value === null) return true
  return typeof value === 'object' && !Array.isArray(value)
}

function problems (final, { parentType, partialBody = false } = {}) {
  const found = []
  const add = (field, kind, message) => found.push({ field, kind, message })

  const row = final || {}

  // ------------------------------------------------------------------ identity

  if (typeof row.Name !== 'string' || !row.Name.trim()) {
    add('Name', 'missing', 'Every artifact needs a name. It is the title property and Notion will not create a page without one.')
  }

  if (!row.Type) {
    add('Type', 'missing', `No type, so there is no template to write. One of: ${TYPES.join(', ')}.`)
  } else if (!TYPES.includes(row.Type)) {
    add('Type', 'unknown-value', `"${row.Type}" is not a type this database has. One of: ${TYPES.join(', ')}.`)
  }

  // TEXT HAS TO BE TEXT. `properties` writes this with `String(...)`, so an
  // object arrived in Notion as the literal `[object Object]` and a number
  // arrived as a number-shaped string, both without a word of complaint. `fill`
  // is what made this reachable: it takes its values off a candidate a model
  // built rather than off a person typing into a prompt.
  if (row.Description !== undefined && row.Description !== null && typeof row.Description !== 'string') {
    add(
      'Description',
      'not-text',
      `Description is ${JSON.stringify(row.Description)}, which is not text. Written as it stands it reaches Notion as whatever ` +
      '`String()` makes of it, which for an object is the literal "[object Object]", and nothing downstream would report that as wrong.'
    )
  }

  if (row.Status !== undefined && !WRITABLE_STATUSES.includes(row.Status)) {
    add(
      'Status',
      'not-writable',
      `A skill may write ${WRITABLE_STATUSES.join(' or ')}, and "${row.Status}" is not one of them. ` +
      'Draft is reachable only by a person setting it in Notion, because a skill that writes a draft has written nothing useful.'
    )
  }

  // -------------------------------------------------------------- select values

  for (const field of ['Domain', 'Review cadence']) {
    const value = row[field]
    if (value === undefined || value === null || value === '') continue
    const allowed = field === 'Review cadence' ? CADENCES : IDENTITY_VALUES[field]
    if (!allowed.includes(value)) {
      add(field, 'unknown-value', `"${value}" is not a ${field} this database has. Notion refuses the whole write on an unknown select value, so the page would not be created at all.`)
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

  // THE SHAPE GUARD IS NOT OPTIONAL HERE. `Tags` is in MULTI_SELECT_FIELDS, so
  // the loop above has already recorded a refusal for a list holding something
  // that is not a value name. Counting it as well means `listValues` trims a
  // number, and `problems` throws instead of returning the refusal it just
  // wrote. A caller asking what is wrong with a row gets a stack trace rather
  // than the answer, for a row this function had already judged correctly.
  const tags = listProblem(row.Tags) ? [] : listValues(row.Tags)
  if (tags.length > TAGS_MAX) {
    add(
      'Tags',
      'too-many',
      `${tags.length} tags, and the cap is ${TAGS_MAX}. Notion cannot enforce this and no view can watch it, so it is refused here rather than written and reported later by setup:check.`
    )
  }

  // ------------------------------------------------------------------- the parent

  if (row.parent) {
    if (!parentType) {
      add(
        'parent',
        'parent-type-unknown',
        'A parent was named and its type was not passed, so the one rule Notion cannot check cannot be checked here either. ' +
        'Fetch the parent and pass its type. This refuses rather than assuming, because assuming removes the only check there is.'
      )
    } else if (!canBeParent(parentType)) {
      add(
        'parent',
        'parent-wrong-type',
        `A ${parentType} cannot be a parent. Only a ${PARENT_TYPE} can, because every other type describes how to do something and this one describes why, which is what makes the library navigable instead of a pile.`
      )
    }
  }

  // --------------------------------------------------------------------- the body

  /*
   * THE CONTAINER IS JUDGED BEFORE THE SECTIONS IN IT.
   *
   * `body` was read as a map of heading to text and nothing asked whether it was
   * one. Anything that is not indexes to `undefined` for every heading, and
   * under the partial-body rule below `undefined` means "not sent, leave it
   * alone", so every section read as untouched, nothing was refused, and
   * `update` rendered an empty body and empty headings from a body somebody had
   * asked to change. The edit went in silence and `prove-update`, having no
   * heading to check, could report the empty write as proved.
   *
   * SAME SHAPE AS THE MAILBOX FINDING ONE ROUND EARLIER: a guard whose cases are
   * all well-formed. Absent and malformed are different answers, and reading the
   * second as the first turns a value somebody set into one nobody did.
   */
  const sections = sectionsFor(row.Type)
  if (sections && !bodyIsMap(row.body)) {
    add(
      'body',
      'not-a-section-map',
      `\`body\` is ${JSON.stringify(row.body)}, which is not a set of sections. It is read as heading to text, one ` +
      'key per heading, and anything else indexes to nothing for every heading. Read as sections it is empty, so the ' +
      'edit would be dropped without a word and the write would come back looking clean. It is refused rather than ' +
      'read as an untouched body.'
    )
  } else if (sections) {
    const body = row.body || {}
    for (const section of sections) {
      const text = body[section.heading]
      const filled = typeof text === 'string' && text.trim()

      // PARTIAL BODY: AN ABSENT SECTION IS NOT A MISSING ONE.
      //
      // On a create the whole artifact is written at once, so a section left
      // out was left out and the refusal is right. `update` sends only the
      // sections that changed, and everything it does not send stays exactly as
      // it is on the page. Judging those as empty made `update` refuse any edit
      // that did not carry the entire body, including a change to one property,
      // which is most edits.
      //
      // A section that IS supplied still has to be filled. Sending a heading
      // with nothing under it is how a section gets emptied by accident, and
      // that is the case this check was written for.
      if (partialBody && text === undefined) continue

      if (!filled) {
        if (section.conditional) continue
        add(
          section.heading,
          'section-missing',
          `The ${section.heading} section is empty. A section that does not apply says so in place, because deleting it loses the information that it was considered.`
        )
        continue
      }

      if (section.neverEmpty && !filled) {
        add(section.heading, 'section-missing', `${section.heading} can never be blank.`)
      }
    }

    for (const heading of neverEmptySectionsFor(row.Type)) {
      const text = body[heading]
      if (typeof text === 'string' && text.trim()) continue
      // Already reported as missing above. This exists to carry the reason,
      // which is different from an ordinary empty section: blank here reads as
      // unconsidered rather than as clean.
      const already = found.find(p => p.field === heading && p.kind === 'section-missing')
      if (already) {
        already.message = `${heading} can never be blank on a ${row.Type}. Where there is genuinely nothing, it says "${NONE_KNOWN}" explicitly, because blank reads as unconsidered rather than as clean.`
      }
    }
  }

  // ------------------------------------------------------------------ backfill

  /**
   * A backfill is a machine pulling content in that no person has read.
   *
   * REFUSED RATHER THAN DROPPED. `properties` could quietly ignore an owner on
   * a backfill row and write the page anyway, and the caller would have every
   * reason to believe the field was set. The three verification fields are the
   * same case: nothing reads them off the row today, so setting one has never
   * done anything, and on a backfill that silence is the difference between an
   * artifact `audit` flags as never-verified and one it passes over.
   */
  if (row.backfill !== undefined) {
    if (typeof row.backfill !== 'boolean') {
      // NOT A TRUTHINESS TEST. `backfill: "false"` is a string, it is not
      // `true`, and read loosely it turns the mode off while reading as though
      // it were on. Everything below keys off `=== true`, so the one shape that
      // must never be guessed at is refused here instead.
      add(
        'backfill',
        'not-a-boolean',
        `\`backfill\` is ${JSON.stringify(row.backfill)}, which is neither true nor false. It decides whether a person ` +
        'field and the verification stamp are written, so it is refused rather than read as truthy: "false" is a ' +
        'string and would turn the mode off while looking like it was on.'
      )
    } else if (row.backfill === true) {
      for (const field of PERSON_FIELDS) {
        if (askedForNothing(row[field])) continue
        add(
          field,
          'backfill-person',
          `${field} is set on a backfilled artifact. Backfill never fills a person field: a machine pulled this in and ` +
          'guessing at who owns or verified it is worse than an empty field. Leave it empty, and set it with `update` ' +
          'once a real person has read the artifact.'
        )
      }
      for (const field of VERIFICATION_FIELDS) {
        if (PERSON_FIELDS.includes(field)) continue
        if (askedForNothing(row[field])) continue
        add(
          field,
          'backfill-verification',
          `${field} is set on a backfilled artifact. Nobody has read this, so all three verification fields stay empty. ` +
          'Empty is the honest value here and it is what makes the never-verified audit signal mean something: an ' +
          'artifact stamped by the import that created it is indistinguishable from one a person actually checked.'
        )
      }

      const suppliedSources = Array.isArray(row.sources) ? row.sources : []
      if (!suppliedSources.length) {
        add(
          'Sources',
          'backfill-unsourced',
          'A backfilled artifact records where it came from. There are no sources on this one, so the only claim ' +
          'backfill makes about it cannot be checked by the person reading it.'
        )
      } else {
        const written = ((row.body || {}).Sources || '').trim()
        const expected = sourcesSection(row.sources).trim()
        if (written !== expected) {
          add(
            'Sources',
            'backfill-sources-disagree',
            'The Sources section does not match the sources this artifact was built from, so the section says one ' +
            'thing and the record says another. On a backfill the section is generated from what was actually read ' +
            'rather than written alongside it. Expected:\n' + expected
          )
        }
      }
    }
  }

  // ------------------------------------------------------------------- the sources

  found.push(...sourceProblems(row.sources))

  return found
}

/**
 * Things a person has to answer before this is written, which are not faults.
 *
 * Separate from `problems` on purpose. See the header: refusing an over-long
 * artifact would make the skill trim to get past the gate, and trimming a
 * document that is genuinely too big just makes a bad document shorter.
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
        'Running long almost never means a wording problem. It usually means this is covering more than one thing, ' +
        'so the question is whether it should be two artifacts rather than a shorter one.' +
        (row.Type === PARENT_TYPE
          ? ' On a Strategy Decision this is the most reliable signal that both granularity tests need running again.'
          : '')
    })
  }

  for (const heading of neverEmptySectionsFor(row.Type) || []) {
    const text = (row.body || {})[heading]
    if (saysNoneKnown(text)) {
      raised.push({
        kind: 'none-known',
        section: heading,
        message: `${heading} says "${NONE_KNOWN}". That is the right way to write it when it is true, and worth one look before it goes in, because it is the section people skip rather than consider.`
      })
    }
  }

  return raised
}

/**
 * The Notion property payload for this artifact.
 *
 * Throws on any problem rather than sending a payload that Notion will refuse as
 * a whole. `concerns` are not checked here: they are the skill's to raise, and a
 * skill that has raised one and been told to go ahead must still be able to
 * write.
 */
function properties (context, final, { defaultsPerson = true, parentType, today, partialBody = false } = {}) {
  // `partialBody` is forwarded rather than left at its default. This runs
  // `problems` itself, so a caller that scoped its own check and then called
  // here got the unscoped refusal anyway, from a line it had already satisfied.
  const found = problems(final, { parentType, partialBody })
  if (found.length) {
    throw new Error(
      `This artifact cannot be written yet:\n  ${found.map(p => p.message).join('\n  ')}`
    )
  }

  const out = {}
  const put = (logical, value) => { out[context.property(logical)] = value }

  put('Name', String(final.Name))
  put('Type', context.value('Type', final.Type))

  // Always Active on a create. See the note on STATUSES in the schema.
  put('Status', context.value('Status', final.Status || 'Active'))

  if (final.Description) put('Description', String(final.Description))
  if (final.Domain) put('Domain', context.value('Domain', final.Domain))

  const cadence = final['Review cadence'] || schema.DEFAULT_CADENCE
  put('Review cadence', context.value('Review cadence', cadence))

  for (const field of MULTI_SELECT_FIELDS) {
    const values = listValues(final[field])
    if (values.length) put(field, values.map(v => context.value(field, v)))
  }

  /**
   * The three verification fields move together or not at all.
   *
   * On a create all three are set, because writing an artifact is having read
   * it. `Verified by` is skipped where config records no person and
   * `Verified date` is set either way, which is the asymmetry `SKILLS-process.md`
   * states and the one thing about this group that is not symmetric.
   *
   * `today` is passed rather than read from the clock so a caller can write a
   * row dated to when the work was done, and so a test can pin it.
   *
   * A BACKFILL SETS NONE OF THEM, AND NO PERSON EITHER. `problems` above refuses
   * a row that carries one; this is the other half of that pair, and the two are
   * deliberately next to each other. Split across files they drift, and the way
   * they drift is the dangerous direction: a refusal that stops nothing while
   * the payload still writes the stamp, so an unread import reads as verified.
   */
  const backfilled = final.backfill === true

  if (!backfilled) {
    const stamp = today || new Date().toISOString().slice(0, 10)
    put('Last checked for accuracy', stamp)
    put('Verified date', stamp)

    for (const field of PERSON_FIELDS) {
      const value = final[field]
      const asked = peopleAsked(value)

      if (asked === null) {
        if ((value === 'me' || defaultsPerson) && context.personId) put(field, [context.personId])
        continue
      }
      if (!asked.length) continue

      put(field, asked.map(one => personIdFrom(one)))
    }
  }

  return out
}

/**
 * The body, as headings and their text, in the order the type calls for.
 *
 * Returns `[{ heading, text }]` and omits a conditional section with nothing in
 * it. A required section with nothing in it never reaches here, because
 * `problems` refuses it.
 */
function body (final, { partialBody = false } = {}) {
  const sections = sectionsFor(final && final.Type)
  if (!sections) {
    throw new Error(`No template for "${final && final.Type}", so there is no body to build.`)
  }

  const content = (final && final.body) || {}
  const out = []

  for (const section of sections) {
    const text = content[section.heading]
    const filled = typeof text === 'string' && text.trim()

    // PARTIAL BODY: A SECTION NOT SUPPLIED IS NOT WRITTEN AT ALL.
    //
    // On a create every section is emitted, empty ones included, because a
    // section left out has to appear as considered-and-empty rather than
    // vanish. On an update only the changed sections are sent, and everything
    // else stays as it is on the page.
    //
    // Emitting the full set here would send an empty string for every section
    // the person did not touch, and writing that wipes them, `Exceptions`
    // included, which can never be blank. This is the second half of the
    // `partialBody` change in `problems`: making an absent section legal to
    // validate while still emitting it to write is a fix that creates a worse
    // bug than the one it cured, because this one destroys content.
    if (partialBody && text === undefined) continue

    if (!filled && section.conditional) continue
    out.push({ heading: section.heading, text: filled ? text.trim() : '' })
  }

  return out
}

/**
 * The headings this artifact will write, which is what `new` proves against
 * after the create.
 *
 * A Notion page can be created with an empty body on a silent partial failure,
 * so the skill re-fetches and confirms each heading is present. That check needs
 * the list in one place rather than derived twice.
 */
function expectedHeadings (final, options) {
  // Derived from `body` with the same options, so the two cannot disagree about
  // which sections are being written. Proving against a heading that was never
  // sent reports a clean write as a failure.
  return body(final, options).map(section => section.heading)
}

module.exports = {
  TYPE_TREE,
  TIEBREAKER,
  CONFUSED_PAIRS,
  NONE_KNOWN,
  words,
  wordCount,
  saysNoneKnown,
  peopleAsked,
  personIdFrom,
  askedForNothing,
  bodyIsMap,
  problems,
  concerns,
  sourceProblems,
  sourcesSection,
  properties,
  body,
  expectedHeadings
}

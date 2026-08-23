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
  if (value === undefined || value === null || value === '' || value === 'me') return null
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
function problems (final, { parentType } = {}) {
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

  const tags = listValues(row.Tags)
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

  const sections = sectionsFor(row.Type)
  if (sections) {
    const body = row.body || {}
    for (const section of sections) {
      const text = body[section.heading]
      const filled = typeof text === 'string' && text.trim()

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

  // ------------------------------------------------------------------- the sources

  if (row.sources !== undefined && row.sources !== null) {
    if (!Array.isArray(row.sources)) {
      add('Sources', 'not-a-list', 'Sources is a list of what was actually read.')
    } else {
      for (const source of row.sources) {
        if (!source || typeof source.what !== 'string' || !source.what.trim()) {
          add('Sources', 'source-unnamed', 'A source with no name cannot be checked by a reader, which is the only thing the section is for.')
          continue
        }
        if (typeof source.contributed !== 'string' || !source.contributed.trim()) {
          add(
            'Sources',
            'source-uncontributed',
            `"${source.what}" is listed with no line saying what it contributed. A Sources section that cannot be trusted is worse than none, because a reader has no way to tell which lines are real.`
          )
        }
      }
    }
  }

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
function properties (context, final, { defaultsPerson = true, parentType, today } = {}) {
  const found = problems(final, { parentType })
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
   */
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

  return out
}

/**
 * The body, as headings and their text, in the order the type calls for.
 *
 * Returns `[{ heading, text }]` and omits a conditional section with nothing in
 * it. A required section with nothing in it never reaches here, because
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
    const text = content[section.heading]
    const filled = typeof text === 'string' && text.trim()

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
function expectedHeadings (final) {
  return body(final).map(section => section.heading)
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
  problems,
  concerns,
  properties,
  body,
  expectedHeadings
}

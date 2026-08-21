'use strict'

/**
 * Building and validating one Calendar row.
 *
 * Every rule Notion cannot enforce and every rule a model will drift on lives
 * here rather than in the skill prose, because prose is advice and this is a
 * gate. `SCHEMA-calendar.md` defines the fields and the values; this file does
 * not restate a value list, it reads them from the shipped schema.
 *
 * PURE. It builds a payload and judges a shape. It sends nothing.
 */

const path = require('path')

// The schema is the one definition of the fields and their values. Reading it
// here rather than restating it is the same rule `CLAUDE.md` states for counts:
// a value written beside the thing it defines is a copy, and copies drift.
const schema = require(path.join(__dirname, 'vendor', 'calendar-schema'))

const { TYPES, STATUSES, EVENT_ONLY, NOT_FOR_EVENTS, DATE_REQUIRED_AT, PERSON_FIELDS,
  MULTI_SELECT_FIELDS, listProblem, listValues } = schema

/**
 * The tree that decides which type a row is.
 *
 * Users get this wrong more often than any other field, so it ships in code as
 * well as in the skill, and the skill shows it rather than deciding alone.
 * `SCHEMA-calendar.md`, "Which type is this".
 */
const TYPE_TREE = [
  { ask: 'Do people attend it?', then: 'Event' },
  { ask: 'Does it go to a list, by email?', then: 'Email send' },
  { ask: 'Is it a post on a social channel?', then: 'Social post' },
  { ask: 'Does something become available that day?', then: 'Launch' },
  { ask: 'Otherwise, is it published to be read or watched?', then: 'Content' }
]

/**
 * Which fields are meaningless on which type.
 *
 * `Our role`, `Format` and `Location` are Events only. `Channel` is everything
 * except an Event. Three fields applying to one type is deliberate rather than
 * sloppy: the alternative is two databases, which fails the one question this
 * database exists to answer.
 */
function fieldsNotAllowedOn (type) {
  if (type === 'Event') return NOT_FOR_EVENTS.slice()
  return EVENT_ONLY.slice()
}

/**
 * Does this status require a date?
 *
 * `Confirmed` and `Done`. NOT `Canceled`, which was corrected on 2026-08-19
 * after review found `SCHEMA-calendar.md` saying "from Confirmed onwards" while
 * `plugins/setup/scripts/manifest.js` had already excluded `Canceled` with the
 * reasoning written out. The rule catches a row that promises something will
 * happen and does not say when, and a canceled row promises nothing.
 */
function dateRequiredAt (status) {
  return DATE_REQUIRED_AT.includes(status)
}

/**
 * One person id, from the several shapes a caller might hold it in.
 *
 * A NAME IS NOT AN ID AND IS REFUSED HERE. Notion identifies a person by uuid
 * and nothing in this plugin can turn "Priya" into one, so accepting a name
 * would mean sending it and letting Notion answer. Notion's answer to a bad
 * person id is a 400 naming the property, which sends somebody looking at the
 * property rather than at the name they typed. The skill resolves a name to an
 * id by searching users, and this refuses whatever did not get resolved.
 */
const PERSON_ID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i

function personIdFrom (value) {
  const raw = (value && typeof value === 'object') ? value.id : value
  if (typeof raw !== 'string') return null

  // A PERSON IS WRITTEN BARE AND READ BACK PREFIXED, measured 2026-08-20:
  // `["00000000-..."]` goes in and `["user://00000000-..."]` comes back. That
  // prefixed form is what a caller holds after re-fetching a row, so an update
  // carrying the owner across faithfully used to be refused with a message
  // telling them to search the workspace for a name whose id they were already
  // holding. `COMPARABLE.people` had stripped the prefix on the reading side
  // since the day it was measured; this is the writing side catching up.
  // What gets written is always the bare id.
  const bare = raw.trim().replace(/^user:\/\//, '')
  if (!PERSON_ID.test(bare)) return null
  return bare
}

/** The person ids a person field was asked for, or null if it was not asked. */
function peopleAsked (value) {
  if (value === undefined || value === 'me') return null
  if (value === null || value === '' || (Array.isArray(value) && !value.length)) return []
  return (Array.isArray(value) ? value : [value])
}

/**
 * Everything wrong with a proposed row, as a list.
 *
 * ALL OF THEM, not the first. A validator that stops at the first problem makes
 * somebody fix one thing, run again, and find the next, which is how a skill
 * that was meant to be a gate becomes a queue.
 *
 * `final` is the row as it would be AFTER the change, not the fields being
 * changed. That matters for `update`: turning an Event into a Social post leaves
 * `Our role`, `Format` and `Location` behind, and validating only the submitted
 * fields would call that clean. The caller merges, this judges the result.
 */
function problems (final) {
  const found = []
  const type = final && final.Type
  const status = final && final.Status

  if (!final || typeof final !== 'object') {
    return [{ field: null, code: 'NO_ROW', message: 'There is no row to check.' }]
  }

  if (!final.Name || !String(final.Name).trim()) {
    found.push({ field: 'Name', code: 'MISSING', message: 'Every row needs a name.' })
  }

  if (!type) {
    found.push({ field: 'Type', code: 'MISSING', message: `Every row needs a type. One of: ${TYPES.join(', ')}.` })
  } else if (!TYPES.includes(type)) {
    found.push({ field: 'Type', code: 'NOT_A_VALUE', message: `"${type}" is not a type. One of: ${TYPES.join(', ')}.` })
  }

  if (!status) {
    found.push({ field: 'Status', code: 'MISSING', message: `Every row needs a status. One of: ${STATUSES.join(', ')}.` })
  } else if (!STATUSES.includes(status)) {
    found.push({ field: 'Status', code: 'NOT_A_VALUE', message: `"${status}" is not a status. One of: ${STATUSES.join(', ')}.` })
  }

  // The date rule Notion cannot enforce.
  if (status && dateRequiredAt(status) && !(final.date && final.date.start)) {
    found.push({
      field: 'Date',
      code: 'DATE_REQUIRED',
      message: `A row at ${status} needs a date. ${status === 'Confirmed'
        ? 'Confirmed means booked, paid or scheduled, and none of those happen without a date.'
        : 'Done means it happened, and it happened on a day.'}`
    })
  }

  // Fields that mean nothing on this type. REFUSED, not dropped: silently
  // discarding something somebody supplied is the failure this repository keeps
  // finding, and it is worse here than elsewhere because the value looks saved.
  if (type && TYPES.includes(type)) {
    for (const field of fieldsNotAllowedOn(type)) {
      const value = final[field]
      const empty = value === undefined || value === null || value === '' ||
        (Array.isArray(value) && value.length === 0)
      if (empty) continue
      found.push({
        field,
        code: 'WRONG_TYPE_FOR_FIELD',
        message: type === 'Event'
          ? `${field} is for things that go out on a channel, not for an Event. An Event has a Format and a Location instead.`
          : `${field} is for Events only, and this is a ${type}.`
      })
    }
  }

  // A MULTI-SELECT THAT IS NOT A LIST OF NAMES. Refused here, which is what
  // makes `properties` refuse it too, because `properties` will not build a
  // payload for a row with problems.
  //
  // Round 9 found this missing on the write side while the read side had it.
  // `properties` writes a multi-select only when it is a non-empty array, so
  // `Segment: "Enterprise"` was dropped from the payload without a word, and a
  // list holding `1` or `{name: "Enterprise"}` went to Notion as it was. A value
  // somebody supplied that silently does not arrive is the failure this file
  // exists to prevent, and it was happening in the file itself.
  for (const field of MULTI_SELECT_FIELDS) {
    const wrong = listProblem(final[field])
    if (!wrong) continue
    found.push({
      field,
      code: 'NOT_A_VALUE_LIST',
      message: wrong.kind === 'not-a-list'
        ? `${field} was given ${JSON.stringify(wrong.value)}, which is not a list. A multi-select takes a list of value names, such as ["Enterprise"], even when there is only one.`
        : `${field} was given a list containing ${JSON.stringify(wrong.entry)}, which is not a value name. Every entry has to be a non-empty string.`
    })
  }

  // A person field that was asked for by something other than an id. Refused
  // rather than sent, because Notion's answer names the property and not the
  // value, and because "me" and an id are the two things this can honour.
  for (const field of PERSON_FIELDS) {
    const asked = peopleAsked(final[field])
    if (!asked || !asked.length) continue
    for (const one of asked) {
      if (personIdFrom(one)) continue
      found.push({
        field,
        code: 'NOT_A_PERSON_ID',
        message: `${field} was given ${JSON.stringify(one)}, which is not a Notion person id. Search the workspace users for the name and pass the id, or pass "me" for the person this install is configured with.`
      })
    }
  }

  return found
}

/**
 * What a Type change would invalidate on an existing row.
 *
 * `update` must not change Type silently, because changing a Social post into
 * an Event changes which fields mean anything. This says exactly which values
 * would stop making sense, so the skill can show them and ask, rather than
 * either refusing a legitimate change or quietly leaving stale values behind.
 */
function fieldsInvalidatedByTypeChange (existing, nextType) {
  if (!existing || !nextType || existing.Type === nextType) return []
  return fieldsNotAllowedOn(nextType)
    .filter(field => {
      const value = existing[field]
      return !(value === undefined || value === null || value === '' ||
        (Array.isArray(value) && value.length === 0))
    })
    .map(field => ({ field, was: existing[field] }))
}

/**
 * The payload that empties a property, one entry per Notion property type.
 *
 * A CLEAR IS NOT AN OMISSION, and that difference is the whole reason this
 * exists. `properties` builds a payload by adding the fields that have values,
 * so a field that lost its value is simply absent from the payload, and Notion
 * leaves an absent property exactly as it was. Sent as an update, that turns a
 * Social post into an Event and leaves `Channel` behind, then `prove` reports a
 * clean write because it only compares what was sent. The row is wrong, the
 * report says it is right, and nothing anywhere failed.
 *
 * EVERY TYPE CLEARS WITH `null`, so there is no table here any more. This held
 * one payload shape per type, all of them written from the Notion REST API and
 * none of them ever sent. Measured against a live workspace on 2026-08-19: a
 * rich_text, a select and a multi-select were emptied in one call by sending
 * null for each, and all three read back null. `clearedProperties` is the one
 * place that knows it, and the date split is its only special case.
 */

/**
 * Which Notion type each field this plugin writes is stored as.
 *
 * Written here rather than derived from `properties`, because `properties` can
 * only tell you the type of a field that has a value, and this is needed for
 * exactly the fields that do not.
 *
 * `tests/calendar-row.test.js` asserts every field named here is built by
 * `properties` with the type named here, so the two cannot drift apart.
 */
const FIELD_TYPES = {
  Name: 'title',
  Description: 'rich_text',
  Type: 'select',
  Status: 'select',
  Date: 'date',
  Link: 'url',
  Location: 'rich_text',
  'Our role': 'select',
  Format: 'select',
  Domain: 'select',
  Channel: 'multi_select',
  Audience: 'multi_select',
  Segment: 'multi_select',
  'L2C Lifecycle': 'multi_select',
  Owner: 'people'
}

/**
 * The properties an update has to empty, given what the row was and what it is
 * becoming.
 *
 * TWO CAUSES, KEPT SEPARATE, because they read differently to a person. A field
 * invalidated by a Type change is being cleared by a rule, and the skill has to
 * say so and ask. A field the user themselves emptied is being cleared because
 * they emptied it, and asking about that would be asking somebody to confirm
 * what they just typed.
 *
 * `Name`, `Type` and `Status` are never cleared. They are required, and an
 * update that empties one of them is a bug in the caller rather than an intent
 * worth carrying out, so it is refused by `problems` on the merged row before
 * this is reached.
 */
function clearing (existing, next) {
  const out = []
  if (!existing || !next) return out

  const invalidated = new Set(fieldsInvalidatedByTypeChange(existing, next.Type).map(f => f.field))
  const required = ['Name', 'Type', 'Status']
  const isEmpty = value => value === undefined || value === null || value === '' ||
    (Array.isArray(value) && value.length === 0)

  for (const field of Object.keys(FIELD_TYPES)) {
    if (required.includes(field)) continue

    // `Date` lives under its own key on a row rather than under its name, which
    // is how every other part of this file reads it too.
    const before = field === 'Date' ? (existing.date && existing.date.start ? existing.date : undefined) : existing[field]
    const after = field === 'Date' ? (next.date && next.date.start ? next.date : undefined) : next[field]

    if (isEmpty(before)) continue
    if (!isEmpty(after)) continue

    out.push({
      field,
      was: before,
      because: invalidated.has(field) ? 'type-change' : 'emptied',
      why: invalidated.has(field)
        ? `${field} means nothing on a ${next.Type}, so it is cleared rather than left behind.`
        : `${field} was emptied on this change.`
    })
  }

  return out
}

/**
 * THE TWO COLUMN KEYS A DATE IS WRITTEN AND READ THROUGH.
 *
 * The same split `calendar.js` uses when it selects a date, kept here so a write
 * and a query cannot disagree about where a date lives.
 */
function dateKeys (context) {
  const name = context.property('Date')
  return { start: `date:${name}:start`, end: `date:${name}:end` }
}

/**
 * The clears, in the shape the connected client takes.
 *
 * EVERY TYPE CLEARS WITH `null`, and what that rests on is worth being exact
 * about. THREE TYPES WERE MEASURED on 2026-08-19: a rich_text, a select and a
 * multi-select were emptied in one call by sending null for each, and all three
 * came back null. Title, url, date and people are the client's own null
 * convention applied by extension, not by measurement.
 *
 * It still replaces something worse. The table this removes held one payload
 * shape per type, written from a REST API the client does not speak, and not one
 * of those nine shapes had ever been sent.
 *
 * A date clears through its start column, because that is the column it is
 * written through.
 */
function clearedProperties (context, cleared) {
  const out = {}
  for (const { field } of cleared || []) {
    if (!(field in FIELD_TYPES)) {
      throw new Error(`"${field}" is not a field this plugin knows how to clear.`)
    }
    if (FIELD_TYPES[field] === 'date') {
      const keys = dateKeys(context)
      out[keys.start] = null
      out[keys.end] = null
      continue
    }
    out[context.property(field)] = null
  }
  return out
}

/**
 * The Notion property payload for a row.
 *
 * `context` is what `shared/config-read.js` handed back, so every property and
 * every option name is resolved through the workspace's own name map rather
 * than through the names this plugin shipped with.
 *
 * IT REFUSES A ROW WITH PROBLEMS. Building a payload for a row that is already
 * known to be wrong just moves the failure to Notion, where the error names a
 * property rather than the rule that was broken.
 */
function properties (context, final, { defaultsPerson = true } = {}) {
  const found = problems(final)
  if (found.length) {
    throw new Error(
      `This row cannot be written yet:\n  ${found.map(p => p.message).join('\n  ')}`
    )
  }

  const out = {}
  const put = (logical, value) => { out[context.property(logical)] = value }

  put('Name', String(final.Name))
  put('Type', context.value('Type', final.Type))
  put('Status', context.value('Status', final.Status))

  if (final.Description) put('Description', String(final.Description))
  if (final.date && final.date.start) {
    // A DATE IS NOT WRITTEN UNDER ITS OWN NAME, on the way in any more than on
    // the way out. The client splits it into the same three columns a query
    // selects, which is why `dateKeys` and `dateColumns` agree by construction.
    // BOTH COLUMNS, ALWAYS. Omitting the end left a stale one behind when a
    // range was shortened to a single day: `{start, end}` to `{start}` is not a
    // clear as far as `clearing` is concerned, `properties` simply stopped
    // emitting the end, and `proveWrite` only compares what was emitted. So the
    // old end stayed on the row and the write proved clean. The client's own
    // definition says the end must be null for a single date, so writing null is
    // the shape it asks for rather than a workaround.
    const keys = dateKeys(context)
    out[keys.start] = final.date.start
    out[keys.end] = final.date.end || null
  }
  if (final.Link) put('Link', String(final.Link))
  if (final.Location) put('Location', String(final.Location))

  for (const field of ['Our role', 'Format', 'Domain']) {
    if (final[field]) put(field, context.value(field, final[field]))
  }

  // THE SAME CANONICAL FORM THE CLASH CHECK COMPARES, from `listValues`. This
  // wrote the value exactly as it arrived while `targetingValues` trimmed it, so
  // `" Enterprise "` matched an existing row in the clash check and then went to
  // Notion with its spaces on, where it maps to no option.
  //
  // The field list is `MULTI_SELECT_FIELDS` rather than a fourth copy of the
  // same four names. `problems` and the schema already read it from there.
  for (const field of MULTI_SELECT_FIELDS) {
    const values = listValues(final[field])
    if (values.length) put(field, values.map(v => context.value(field, v)))
  }

  /**
   * The nullable person rule, from `SKILLS-setup.md`, and the named owner.
   *
   *   not asked, on a create   the configured person, or nothing
   *   not asked, on an update  left alone here, and cleared by `clearing`
   *   "me"                     the configured person, on either
   *   one or more ids          those people
   *   emptied                  omitted here and cleared by `clearing`
   *
   * THE FIRST TWO WERE ONE CASE UNTIL 2026-08-21, and collapsing them broke
   * every update that did not carry `Owner` across the merge. `final` is the
   * merged row, so an absent owner is a field that lost its value: `clearing`
   * emptied it while this wrote the configured person, and `updatePayload`
   * refuses a payload holding a set and a clear for one property. The whole
   * call died with "this is a bug in this plugin", which it was. Defaulting an
   * absent field belongs to a create, where there is nothing to leave alone.
   *
   * The middle case is the one that was missing. Until this, an owner could only
   * ever be the person the install was configured with, so "change the owner"
   * silently rewrote the field back to that same person, which is worse than
   * refusing: the call succeeded and the owner did not change.
   *
   * Where config records no person AND none was named, the property is OMITTED
   * rather than written empty. Tier 3 of the identity choice is a working
   * install, not a failed one. Writing an empty people array instead would be
   * the plugin asserting the row has no owner, which is a different claim from
   * the plugin not knowing who the user is.
   *
   * An emptied person field is not written here at all. Clearing a property is
   * `clearing`'s job, and a payload that both omits and empties one property
   * would be two answers to one question.
   */
  for (const field of PERSON_FIELDS) {
    const value = final[field]
    const asked = peopleAsked(value)

    if (asked === null) {
      // `peopleAsked` returns null for both "not mentioned" and "me", and only
      // one of those is a request. "me" names the configured person and is
      // honoured on any call; an absent field is a default, and a default is
      // only right where nothing is being left alone.
      if ((value === 'me' || defaultsPerson) && context.personId) put(field, [context.personId])
      continue
    }
    if (!asked.length) continue

    put(field, asked.map(one => personIdFrom(one)))
  }

  return out
}

module.exports = {
  TYPE_TREE,
  PERSON_ID,
  personIdFrom,
  peopleAsked,
  FIELD_TYPES,
  dateKeys,
  problems,
  properties,
  clearing,
  clearedProperties,
  dateRequiredAt,
  fieldsNotAllowedOn,
  fieldsInvalidatedByTypeChange
}

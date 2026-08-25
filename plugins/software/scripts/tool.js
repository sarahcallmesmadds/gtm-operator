'use strict'

/**
 * Building and validating Software rows.
 *
 * Every rule Notion cannot enforce and every rule a model will drift on lives
 * here rather than in the skill prose, because prose is advice and this is a
 * gate. `SCHEMA-software.md` defines the fields, the values and the template;
 * this file does not restate a value list, it reads them from the shipped
 * schema.
 *
 * PURE. It builds payloads and judges shapes. It sends nothing.
 *
 * THE RULE THIS FILE HOLDS HARDEST: `Last reviewed` moves only when a review
 * happened. `newProperties` stamps it at creation and `reviewProperties`
 * stamps it on an explicit confirmation, per the fill-event table in
 * `SCHEMA-software.md`; `updateProperties` never writes it, whatever the
 * update changed. An edit that resets the freshness stamp suppresses the
 * staleness warning for a whole cadence period. (The SKILLS document reads
 * the creation stamp differently; both readings are in `DECISIONS.md`.)
 *
 * TWO KINDS OF FINDING, the same split as the other writing plugins.
 * `problems` are refusals: a write carrying one is wrong and the payload
 * builders throw rather than sending it. `concerns` are questions for a
 * person: a body over the ceiling, or an automatic renewal with no notice
 * deadline, are worth asking about and wrong to refuse.
 */

const path = require('path')

const schema = require(path.join(__dirname, 'vendor', 'software-schema'))
// The memo builder carries the measured shapes this file would otherwise
// copy: the day round-trip, the person-id rules, the body-map check, the
// word counter.
const memoWrite = require(path.join(__dirname, 'vendor', 'memo-write'))
const {
  STATUSES, IMPORTANCE, RENEWS,
  PERSON_FIELDS, SINGLE_PERSON_FIELDS, MULTI_SELECT_FIELDS, URL_FIELDS, CHECKBOX_FIELDS,
  SECTIONS, WORD_CEILING, REQUIRED_AT_CREATE, NEVER_CLEARED,
  AUDIENCES, IDENTITY_VALUES, listProblem, listValues
} = schema

const { dayProblem, bodyIsMap, personIdFrom, words } = memoWrite

/** The single-select fields, with the list each draws from. */
const SELECT_FIELDS = {
  Status: STATUSES,
  Importance: IMPORTANCE,
  Domain: IDENTITY_VALUES.Domain,
  Renews: RENEWS,
  'Stores PII': IDENTITY_VALUES['Stores PII'],
  'SOC 2': IDENTITY_VALUES['SOC 2'],
  SSO: IDENTITY_VALUES.SSO
}

/**
 * The dismissals the How To Get Access gate can see. "Ask IT" is not an
 * answer, for the same reason "Ask RevOps" is not a contact on a Technical
 * Reference: a department is not a person and 6pm does not know who to call.
 * "Ask Priya" is an answer, so only the literal department shapes are
 * refused; the judgment beyond that is the skill's.
 *
 * THE DEPARTMENT LIST IS THE SCHEMA'S OWN TEAM VOCABULARY — the Audience
 * values — plus the handful of names those values spell differently. Not a
 * tuned word list: tuning one is the approach slop-check spent six rounds
 * proving wrong, and the Audience list is already the one set of team names
 * this design maintains. A department it still cannot see costs a weak row,
 * not damage, and the skill's judgment covers the rest.
 */
const DEPARTMENT_NAMES = [...AUDIENCES, 'IT', 'Ops', 'Eng', 'Engineering', 'Support', 'HR']
const ACCESS_DISMISSALS = new RegExp(
  `^ask\\s+(?:the\\s+)?(?:${DEPARTMENT_NAMES.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}|[a-z][a-z ]*\\bteam)[.!]?$`,
  'i'
)

/**
 * A contract link pointing into Notion itself. Not refused, because a Notion
 * PAGE holding the terms is readable; raised, because an UPLOAD is the one
 * form nothing can read, measured 2026-08-18, and a link into Notion is where
 * uploads live.
 */
const NOTION_HOSTED = /https?:\/\/([a-z0-9-]+\.)*notion\.(so|site)\//i

/**
 * Which Notion type each field this plugin writes is stored as. Written here
 * rather than derived from a payload, because a payload can only tell you the
 * type of a field that has a value, and clears need exactly the fields that
 * do not. `tests/software-tool.test.js` holds this map to the schema's own
 * field groups.
 */
const FIELD_TYPES = {
  Name: 'title',
  Description: 'rich_text',
  Status: 'select',
  Importance: 'select',
  Domain: 'select',
  Audience: 'multi_select',
  Owner: 'people',
  'Technical owner': 'people',
  Admins: 'people',
  'Billing owner': 'people',
  'Contract dates': 'date',
  'Notice deadline': 'date',
  Renews: 'select',
  'Annual cost': 'number',
  'Contract link': 'url',
  'AI access': 'multi_select',
  'Stores PII': 'select',
  'SOC 2': 'select',
  SSO: 'select',
  'Customer facing': 'checkbox',
  'Given to new teammates': 'checkbox',
  Login: 'url',
  Documentation: 'url',
  'Status page': 'url',
  'Last reviewed': 'date'
}

const isEmpty = value => value === undefined || value === null || value === '' ||
  (Array.isArray(value) && value.length === 0)

/** Missing-versus-malformed for a text field, the split every gate here uses. */
function textProblems (row, field, { required, requiredWhy } = {}) {
  const found = []
  const value = row[field]
  if (value !== undefined && value !== null && typeof value !== 'string') {
    found.push({
      field,
      kind: 'not-text',
      message: `${field} is ${JSON.stringify(value)}, which is not text. Written as it stands it reaches Notion as whatever \`String()\` makes of it, and nothing downstream would report that as wrong.`
    })
  } else if (required && (typeof value !== 'string' || !value.trim())) {
    found.push({ field, kind: 'missing', message: requiredWhy })
  }
  return found
}

/**
 * The select, multi-select, url, checkbox, number and date checks every
 * Software write shares. `present` restricts the sweep to the fields the row
 * actually carries, which is what lets `update` reuse the gate over a partial
 * row without inventing requirements `new` owns.
 */
function valueProblems (row) {
  const found = []
  const add = (field, kind, message) => found.push({ field, kind, message })

  for (const [field, allowed] of Object.entries(SELECT_FIELDS)) {
    const value = row[field]
    if (isEmpty(value)) continue
    if (typeof value !== 'string') {
      add(field, 'not-text', `${field} is ${JSON.stringify(value)}, which is not a value name.`)
      continue
    }
    if (!allowed.includes(value)) {
      add(field, 'unknown-value', `"${value}" is not a ${field} this database has. One of: ${allowed.join(', ')}. Notion refuses the whole write on an unknown select value, so nothing would be saved.`)
    }
  }

  for (const field of MULTI_SELECT_FIELDS) {
    const value = row[field]
    if (value === undefined) continue
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

  for (const field of URL_FIELDS) {
    found.push(...textProblems(row, field))
  }

  for (const field of CHECKBOX_FIELDS) {
    const value = row[field]
    if (value === undefined || value === null) continue
    if (typeof value !== 'boolean') {
      add(field, 'not-a-checkbox', `${field} is ${JSON.stringify(value)}, and a checkbox takes true or false. "yes" written as text is not a tick, and Notion would refuse it.`)
    }
  }

  const cost = row['Annual cost']
  if (cost !== undefined && cost !== null && cost !== '') {
    if (typeof cost !== 'number' || !Number.isFinite(cost)) {
      add('Annual cost', 'not-a-number', `Annual cost is ${JSON.stringify(cost)}, and it is a number: what a year costs, annualised. A monthly price is multiplied by twelve on the way in, in conversation, and an estimate is fine and expected.`)
    } else if (cost < 0) {
      add('Annual cost', 'negative', `Annual cost is ${cost}. A negative spend is a credit note, which goes in Notes, not a cost.`)
    }
  }

  const deadline = row['Notice deadline']
  if (!isEmpty(deadline)) {
    const wrong = dayProblem(deadline, 'Notice deadline')
    if (wrong) add('Notice deadline', 'not-a-day', wrong)
  }

  const dates = row['Contract dates']
  if (!isEmpty(dates)) {
    if (typeof dates !== 'object' || Array.isArray(dates)) {
      add('Contract dates', 'not-a-range', 'Contract dates is a range: pass { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" }.')
    } else {
      if (!dates.start) {
        add('Contract dates', 'range-open', 'Contract dates has no start. A contract that ends without ever starting is a range Notion will store and nobody can read.')
      } else {
        const wrongStart = dayProblem(dates.start, 'Contract dates start')
        if (wrongStart) add('Contract dates', 'not-a-day', wrongStart)
      }
      if (!isEmpty(dates.end)) {
        const wrongEnd = dayProblem(dates.end, 'Contract dates end')
        if (wrongEnd) add('Contract dates', 'not-a-day', wrongEnd)
        if (dates.start && !dayProblem(dates.start, 'x') && !wrongEnd &&
            String(dates.start) > String(dates.end)) {
          add('Contract dates', 'range-backwards', `Contract dates run from ${dates.start} to ${dates.end}, which is backwards.`)
        }
      }
    }
  }

  for (const field of PERSON_FIELDS) {
    const value = row[field]
    if (isEmpty(value)) continue
    const entries = Array.isArray(value) ? value : [value]
    // Owner, Technical owner and Billing owner hold exactly one person.
    // Shared ownership reads as nobody's, and a list written here would make
    // the schema's promise of one accountable person quietly false.
    if (SINGLE_PERSON_FIELDS.includes(field) && entries.length > 1) {
      add(field, 'several-people', `${field} names ${entries.length} people and it holds exactly one: ${field === 'Billing owner' ? 'who approves the spend' : field === 'Technical owner' ? 'who can explain how it works' : 'whose call it is'}. Admins is the list field; everyone else goes in the body if they matter.`)
    }
    for (const one of entries) {
      if (one === 'me') continue
      try {
        personIdFrom(one)
      } catch (err) {
        add(field, 'not-a-person-id', `${field}: ${err.message} An agent guessing at a person is worse than an empty field, because an empty field asks a question and a wrong one answers it.`)
      }
    }
  }

  return found
}

/** Words across the required sections. Conditional sections sit outside the count. */
function wordCount (final) {
  const body = (final && final.body) || {}
  let total = 0
  for (const section of SECTIONS) {
    if (section.conditional) continue
    total += words(body[section.heading])
  }
  return total
}

/**
 * Everything wrong with a new row that makes it unwritable.
 */
function newProblems (final) {
  const found = []
  const add = (field, kind, message) => found.push({ field, kind, message })
  const row = final || {}

  found.push(...textProblems(row, 'Name', {
    required: true,
    requiredWhy: 'Every tool needs a name, the vendor\'s own spelling. It is the title property and Notion will not create a page without one.'
  }))
  found.push(...textProblems(row, 'Description', {
    required: true,
    requiredWhy: 'Description is one sentence ending with the team that depends on it. A row without it is unreadable in every table view.'
  }))

  for (const field of ['Status', 'Importance', 'Domain']) {
    if (isEmpty(row[field])) {
      add(field, 'missing',
        field === 'Importance'
          ? 'Importance is empty. It is never guessed: ask what stops working and how quickly, and pick the value from the answer. A row that skipped the question looks exactly like one that answered it Standard.'
          : `${field} is empty, and the fill-event table says it is filled when the row is created. A tool nobody can file under a status or a function is a row nobody finds.`)
    }
  }
  if (isEmpty(row.Audience)) {
    add('Audience', 'missing', 'Audience is empty: which teams actually use it, filled when the row is created. "What do we use, and who uses it" is the first question this database exists to answer.')
  }

  if (row['Last reviewed'] !== undefined) {
    add('Last reviewed', 'not-yours-to-set', 'Last reviewed is not passed as a field. `create` stamps it from `today` at creation, `review` moves it on a confirmed pass, and nothing else touches it.')
  }

  // A FIELD THIS GATE DOES NOT KNOW IS REFUSED, NOT DROPPED. Without this,
  // `Plan: "Enterprise"` passed validation, `newProperties` silently left it
  // out, and `prove` rebuilt the same lossy payload and reported success —
  // approved content disappearing with nothing anywhere saying so.
  const known = new Set([...Object.keys(FIELD_TYPES), 'today', 'body'])
  for (const field of Object.keys(row)) {
    if (known.has(field)) continue
    if (field === 'Artifacts' || field === 'Integrates with') {
      add(field, 'relation-not-written', `${field} is a relation, and no plugin in this marketplace has measured a relation write on this surface. It is refused rather than dropped; name what should be linked and a person makes the link in Notion.`)
    } else {
      add(field, 'unknown-field', `"${field}" is not a field this plugin writes. The fields are the schema's; anything else is a typo or belongs in the body's Notes.`)
    }
  }

  found.push(...valueProblems(row))

  const today = row.today
  if (isEmpty(today)) {
    add('today', 'missing', 'Pass `today` as YYYY-MM-DD. Creation stamps Last reviewed, and the script does not read the clock: the caller says what day it is, the same convention as memos.')
  } else {
    const wrong = dayProblem(today, 'today')
    if (wrong) add('today', 'not-a-day', wrong)
  }

  if (!bodyIsMap(row.body)) {
    add(
      'body',
      'not-a-section-map',
      `\`body\` is ${JSON.stringify(row.body)}, which is not a set of sections. It is read as heading to text, one key per heading, and anything else indexes to nothing for every heading, so the page would publish empty without a word. It is refused rather than read as an empty body.`
    )
  } else {
    const body = row.body || {}
    const knownHeadings = SECTIONS.map(s => s.heading)
    for (const heading of Object.keys(body)) {
      if (!knownHeadings.includes(heading)) {
        add(heading, 'unknown-section', `"${heading}" is not a section the Software template has. The sections are: ${knownHeadings.join(', ')}. Anything that does not fit goes in Notes.`)
        continue
      }
      // Every section that is present holds text, conditional ones included.
      // A Notes holding an object passed the old gate and was then silently
      // dropped by the renderer, which is approved content disappearing.
      if (body[heading] !== undefined && body[heading] !== null && typeof body[heading] !== 'string') {
        add(heading, 'not-text', `The ${heading} section is ${JSON.stringify(body[heading])}, which is not text. It would render to nothing without a word, so it is refused rather than dropped.`)
      }
    }
    for (const section of SECTIONS) {
      if (section.conditional) continue
      const text = body[section.heading]
      const filled = typeof text === 'string' && text.trim()
      if (!filled) {
        if (text !== undefined && text !== null && typeof text !== 'string') continue // already refused as not-text above
        add(
          section.heading,
          'section-missing',
          `The ${section.heading} section is empty. The three required sections are the index entry: what it does, how to get it, who to ask.` +
          (section.heading === 'Vendor Contacts' ? ' If there is no rep, write that, because knowing you are on your own is worth knowing before you need help.' : '')
        )
        continue
      }
      if (section.heading === 'How To Get Access' && ACCESS_DISMISSALS.test(text.trim())) {
        add(
          'How To Get Access',
          'access-dismissed',
          `How To Get Access says ${JSON.stringify(text.trim())}, and a bare department is not an answer, for the same reason "Ask RevOps" is not a contact on a Technical Reference. Name the person to ask, the approval needed, or write "single sign-on, just log in".`
        )
      }
    }
  }

  return found
}

/** Questions for a person about a new row. Not faults. */
function newConcerns (final) {
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
        'This row is an index entry with a Technical Reference behind it, so length here is a signal that content is in the wrong place. ' +
        'Ask rather than trim: the answer is usually to write the artifact in the Process library and relate it.'
    })
  }

  if (row.Renews === 'Automatically' && isEmpty(row['Notice deadline'])) {
    raised.push({
      kind: 'auto-renews-without-deadline',
      message:
        'Renews is Automatically and there is no Notice deadline, which is the exact pair this database exists to catch: missing that date commits you to another term. ' +
        'Nobody knows the deadline off the top of their head, so ask how much notice the contract requires and compute the date from the contract end.'
    })
  }

  if (!isEmpty(row['Contract dates']) && isEmpty(row.Renews)) {
    raised.push({
      kind: 'renews-unrecorded',
      message: 'Contract dates are recorded and Renews is not. Blank means nobody looked; if somebody looked and could not tell, Unknown is the honest value and a different row on a list of work to do.'
    })
  }

  const link = row['Contract link']
  if (typeof link === 'string' && NOTION_HOSTED.test(link)) {
    raised.push({
      kind: 'contract-inside-notion',
      message:
        'Contract link points into Notion. A PDF uploaded into Notion cannot be read, measured 2026-08-18: the row would look like it carries the agreement and could answer nothing about it. ' +
        'If that link is an upload, put the PDF in Google Drive and paste that link instead. A Notion page holding the terms as text is fine.'
    })
  }

  return raised
}

/**
 * A person value resolved to ids: 'me' becomes the configured person, an id
 * is checked as one, and a name is refused. Null means nothing was asked.
 */
function peopleFor (value, personId, field) {
  if (isEmpty(value)) return null
  const entries = Array.isArray(value) ? value : [value]
  const out = []
  for (const one of entries) {
    if (one === 'me') {
      if (!personId) {
        throw new Error(
          `${field} says "me" and the config records no person, so there is nobody to write. ` +
          'Search the workspace users for the person and pass their id.'
        )
      }
      out.push(personId)
      continue
    }
    out.push(personIdFrom(one))
  }
  return out
}

/** The date range written through its two columns, the measured convention. */
function putDate (out, context, logical, start, end) {
  const name = context.property(logical)
  out[`date:${name}:start`] = start
  out[`date:${name}:end`] = end === undefined ? null : end
}

/**
 * The Notion property payload for a new row. Throws on any problem rather
 * than sending a payload Notion will refuse as a whole.
 *
 * `Last reviewed` IS stamped here, from `today`: creation is a full pass by
 * definition, the person just answered every group. That is the fill-event
 * table's reading; see the schema header for the recorded disagreement.
 *
 * NO RELATION IS WRITTEN, the standing marketplace rule: no plugin has
 * measured a relation write on this surface. `Artifacts` belongs to
 * `process:new` and `Integrates with` to a person or a review, and the
 * command layer says so.
 */
function newProperties (context, final) {
  const found = newProblems(final)
  if (found.length) {
    throw new Error(`This tool cannot be written yet:\n  ${found.map(p => p.message).join('\n  ')}`)
  }

  const out = {}
  const put = (logical, value) => { out[context.property(logical)] = value }

  put('Name', String(final.Name).trim())
  put('Description', String(final.Description))
  for (const field of Object.keys(SELECT_FIELDS)) {
    if (!isEmpty(final[field])) put(field, context.value(field, final[field]))
  }
  for (const field of MULTI_SELECT_FIELDS) {
    const values = listValues(final[field])
    if (values.length) put(field, values.map(v => context.value(field, v)))
  }
  for (const field of URL_FIELDS) {
    if (!isEmpty(final[field])) put(field, String(final[field]))
  }
  for (const field of CHECKBOX_FIELDS) {
    if (typeof final[field] === 'boolean') put(field, final[field])
  }
  if (!isEmpty(final['Annual cost'])) put('Annual cost', final['Annual cost'])
  if (!isEmpty(final['Notice deadline'])) putDate(out, context, 'Notice deadline', String(final['Notice deadline']), null)
  const dates = final['Contract dates']
  if (!isEmpty(dates) && dates.start) putDate(out, context, 'Contract dates', String(dates.start), isEmpty(dates.end) ? null : String(dates.end))

  for (const field of PERSON_FIELDS) {
    const people = peopleFor(final[field], context.personId, field)
    if (people && people.length) put(field, people)
  }

  putDate(out, context, 'Last reviewed', String(final.today), null)

  return out
}

/** The page body, as headings and their text, in template order. */
function toolBody (final) {
  const content = (final && final.body) || {}
  return SECTIONS
    .filter(section => !section.conditional || (typeof content[section.heading] === 'string' && content[section.heading].trim()))
    .map(section => ({
      heading: section.heading,
      text: typeof content[section.heading] === 'string' ? content[section.heading].trim() : ''
    }))
}

/** The headings the proof expects, derived from the body so they agree. */
function toolHeadings (final) {
  return toolBody(final).map(section => section.heading)
}

/**
 * Everything wrong with an update to an existing row.
 *
 * `changes` carries only what changed. A field absent is untouched; a field
 * explicitly null (or '' / []) is a clear, and a clear of a required field is
 * refused. `Last reviewed` is refused by name whatever the update touches.
 */
function updateProblems (changes, { stamping = false } = {}) {
  const found = []
  const add = (field, kind, message) => found.push({ field, kind, message })
  const row = changes || {}

  if (typeof row !== 'object' || Array.isArray(row)) {
    return [{ field: 'changes', kind: 'not-a-record', message: `The changes are ${JSON.stringify(row)}, and this reads a set of fields, one key per changed field.` }]
  }

  const fields = Object.keys(row).filter(f => f !== 'body')
  if (!fields.length && !row.body) {
    add('changes', 'empty', 'No field is changed and no body section is named. Nothing to write, and writing nothing is not worth reporting as done.')
  }

  if (row['Last reviewed'] !== undefined && !stamping) {
    add('Last reviewed', 'never-here',
      'Last reviewed is not update\'s to move, whatever this update changed and however much of the row it touched. ' +
      '`review` is what moves it, on a confirmed pass. An edit that resets the freshness stamp suppresses the staleness warning for a whole cadence period.')
  }
  if (row['Last reviewed'] !== undefined && stamping) {
    add('Last reviewed', 'not-yours-to-set', 'Last reviewed is not passed as a field even here. `review` stamps it from `today` on a confirmed pass, so the date cannot be typo\'d backwards.')
  }

  const known = new Set([...Object.keys(FIELD_TYPES)].filter(f => f !== 'Last reviewed'))
  for (const field of fields) {
    if (field === 'Last reviewed') continue
    if (!known.has(field)) {
      add(field, 'unknown-field', `"${field}" is not a field this plugin writes. The fields are the schema's; anything else is a typo or belongs in the body.`)
    }
  }

  for (const field of NEVER_CLEARED) {
    if (field in row && isEmpty(row[field])) {
      add(field, 'never-cleared', `${field} is being emptied, and it is required: a row without it is unreadable or unfindable. Change it to a new value, or leave it alone.`)
    }
  }

  found.push(...valueProblems(row))
  found.push(...textProblems(row, 'Name'))
  found.push(...textProblems(row, 'Description'))

  if (row.body !== undefined) {
    if (!bodyIsMap(row.body)) {
      add('body', 'not-a-section-map', `\`body\` is ${JSON.stringify(row.body)}, which is not a set of sections. Pass only the sections that changed, heading to text.`)
    } else {
      const knownHeadings = SECTIONS.map(s => s.heading)
      for (const heading of Object.keys(row.body || {})) {
        if (!knownHeadings.includes(heading)) {
          add(heading, 'unknown-section', `"${heading}" is not a section the Software template has. The sections are: ${knownHeadings.join(', ')}.`)
          continue
        }
        const value = row.body[heading]
        if (typeof value !== 'string' || !value.trim()) {
          add(heading, 'not-text', `The ${heading} section is ${JSON.stringify(value)}, and a body edit carries the section's new text. Emptying a section is a person's edit in Notion, not an update here, so nothing that is not text is accepted.`)
        }
      }
      if (!Object.keys(row.body || {}).length && !fields.length) {
        add('body', 'empty', 'The body names no sections. Pass only the sections that changed.')
      }
    }
  }

  return found
}

/**
 * The update payload: the sets and the clears, in one object the way the
 * connected client takes them.
 *
 * TWO CLEAR SHAPES, BOTH FROM MEASUREMENT, AND MIXING THEM UP IS SILENT.
 * A person property clears with an EMPTY LIST, the same as a multi-select:
 * both hold several values and Notion returns and takes them as arrays.
 * Sent a null, the write is ACCEPTED and the old person stays — measured on
 * the process plugin and recorded in DECISIONS.md, which is exactly the
 * offboarding path failing with nothing anywhere saying so. Everything else
 * clears with null: a rich_text, a select and a multi-select were measured
 * clearing that way in calendar on 2026-08-19, and list-shaped fields use []
 * here because that is the shape the person measurement proved against this
 * client. A date clears through both its columns, because that is where it
 * is written.
 *
 * A person field explicitly emptied is a clear: an owner who left is cleared
 * or replaced by name, never guessed at. The read-back proof is what catches
 * a clear that did not land.
 */
function updateProperties (context, changes) {
  const found = updateProblems(changes)
  if (found.length) {
    throw new Error(`This update cannot be written yet:\n  ${found.map(p => p.message).join('\n  ')}`)
  }
  return buildUpdate(context, changes)
}

function buildUpdate (context, changes) {
  const out = {}
  const cleared = []
  const put = (logical, value) => { out[context.property(logical)] = value }
  const clear = (logical) => {
    cleared.push(logical)
    if (FIELD_TYPES[logical] === 'date') {
      putDate(out, context, logical, null, null)
      return
    }
    // People and multi-selects are list-shaped and clear with []. A person
    // sent null is accepted and NOT cleared, measured; see the header.
    const listShaped = FIELD_TYPES[logical] === 'people' || FIELD_TYPES[logical] === 'multi_select'
    out[context.property(logical)] = listShaped ? [] : null
  }
  const row = changes || {}

  for (const field of Object.keys(row)) {
    if (field === 'body' || field === 'Last reviewed') continue
    const value = row[field]

    if (isEmpty(value)) { clear(field); continue }

    if (field === 'Name' || field === 'Description') { put(field, String(value)); continue }
    if (field in SELECT_FIELDS) { put(field, context.value(field, value)); continue }
    if (MULTI_SELECT_FIELDS.includes(field)) {
      put(field, listValues(value).map(v => context.value(field, v)))
      continue
    }
    if (URL_FIELDS.includes(field)) { put(field, String(value)); continue }
    if (CHECKBOX_FIELDS.includes(field)) { put(field, value); continue }
    if (field === 'Annual cost') { put(field, value); continue }
    if (field === 'Notice deadline') { putDate(out, context, field, String(value), null); continue }
    if (field === 'Contract dates') {
      putDate(out, context, field, String(value.start), isEmpty(value.end) ? null : String(value.end))
      continue
    }
    if (PERSON_FIELDS.includes(field)) {
      const people = peopleFor(value, context.personId, field)
      if (people && people.length) put(field, people)
      continue
    }
  }

  return { properties: out, cleared }
}

/**
 * The review payload: an update, plus the stamp, and the stamp only on an
 * explicit confirmation. A review that finds nothing wrong is a real review
 * and stamps the date; a review that did not look is not, and the
 * confirmation is where that line is held.
 */
function reviewProperties (context, changes, { confirmed, today } = {}) {
  const found = updateProblems(changes, { stamping: true })
  const row = changes || {}
  const empty = !Object.keys(row).filter(f => f !== 'body' && f !== 'Last reviewed').length && !row.body
  // A review may legitimately change nothing; drop the empty-changes refusal.
  const real = found.filter(p => !(p.kind === 'empty'))

  if (confirmed) {
    if (isEmpty(today)) {
      real.push({ field: 'today', kind: 'missing', message: 'A confirmed review stamps Last reviewed, and the script does not read the clock: pass today as YYYY-MM-DD.' })
    } else {
      const wrong = dayProblem(today, 'today')
      if (wrong) real.push({ field: 'today', kind: 'not-a-day', message: wrong })
    }
  }

  if (real.length) {
    throw new Error(`This review cannot be written yet:\n  ${real.map(p => p.message).join('\n  ')}`)
  }

  const built = buildUpdate(context, row)
  if (confirmed) {
    putDate(built.properties, context, 'Last reviewed', String(today), null)
  } else if (empty) {
    // Nothing changed and nothing confirmed: there is nothing to send, and
    // sending nothing is not worth reporting as done.
    throw new Error(
      'Nothing changed and the review is not confirmed, so there is nothing to write. ' +
      'A review that did not look stamps nothing; if the row was actually walked group by group and holds, confirm it and the date moves.'
    )
  }
  return built
}

/**
 * Which Notion type each written Software column holds, keyed by the column
 * name the payload actually uses, so a proof compares through the right
 * reader. `Annual cost` is a number, and how a number reads back is
 * unmeasured on this surface, so the proof reports it unchecked rather than
 * guessing; `checkbox` likewise.
 */
function propertyTypes (context) {
  const types = {}
  for (const [logical, type] of Object.entries(FIELD_TYPES)) {
    if (type === 'date') {
      const name = context.property(logical)
      types[`date:${name}:start`] = 'date'
      types[`date:${name}:end`] = 'date'
      continue
    }
    if (type === 'number' || type === 'checkbox') continue
    types[context.property(logical)] = type
  }
  return types
}

module.exports = {
  SELECT_FIELDS,
  FIELD_TYPES,
  ACCESS_DISMISSALS,
  NOTION_HOSTED,
  isEmpty,
  wordCount,
  newProblems,
  newConcerns,
  newProperties,
  toolBody,
  toolHeadings,
  updateProblems,
  updateProperties,
  reviewProperties,
  peopleFor,
  propertyTypes
}

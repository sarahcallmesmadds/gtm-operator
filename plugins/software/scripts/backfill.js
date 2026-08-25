'use strict'

/**
 * Finding the tools you already pay for.
 *
 * PURE, like `tool.js`. It reads nothing and sends nothing. It decides what a
 * reader is allowed to be pointed at, judges what came back into candidates a
 * person can scan, and turns an approved candidate into a row. The skill does
 * the reading and the writing.
 *
 * THE APPROVAL GATE IS THE WHOLE DESIGN, the same argument as
 * `process:backfill`: a candidate that turns out to be junk costs one "no",
 * so the judgments here are allowed to be roughly right. Two things are not,
 * because they survive a "no": what the plugin was permitted to read, and
 * what it writes onto a page. Both are refusals in code.
 *
 * WHICH IS WHY SCOPE REFUSES RATHER THAN NARROWS. There is no approval gate
 * in front of a read: by the time a candidate list exists, the reading
 * already happened. A scope this file quietly trims reads less than the
 * person asked for and says it read what they asked for — or worse, more.
 *
 * WHAT A BACKFILLED ROW NEVER CARRIES, from `SKILLS-software.md`:
 * no person field (four fields here are people and all four stay empty), no
 * `Importance` (a judgment about consequence, and a receipt carries no
 * information about it), no `Last reviewed` (a machine pulled the row in and
 * nobody has confirmed any of it — empty is what makes the row show up for
 * review). Handing `draft` any of them is REFUSED, NOT IGNORED: approving a
 * candidate and having something smaller run is the one failure the approval
 * gate cannot see.
 */

const path = require('path')

const schema = require(path.join(__dirname, 'vendor', 'software-schema'))
const tool = require(path.join(__dirname, 'tool'))

/** The two sources a scope may name. Anything else is refused, not ignored. */
const SOURCES = ['contracts', 'email']

/**
 * What each source proves, and what it may fill. From `SKILLS-software.md`:
 * the two sources are not equally good, and the skill has to say which it is
 * looking at. A contract makes a strong candidate; an email makes a thin one,
 * and presenting a thin row as filled would be worse than not finding it,
 * because a thin row looks finished.
 */
const KINDS = {
  contract: { source: 'contracts', evidence: 'strong', proves: 'an agreement exists, on these terms' },
  invoice: { source: 'email', evidence: 'strong', proves: 'somebody is paying for it' },
  receipt: { source: 'email', evidence: 'strong', proves: 'somebody is paying for it' },
  'renewal-notice': { source: 'email', evidence: 'strong', proves: 'a term is live and coming round' },
  'support-thread': { source: 'email', evidence: 'strong', proves: 'somebody is working with the vendor' },
  announcement: { source: 'email', evidence: 'weak', proves: 'the vendor emails somebody here, which vendors do to people who never bought anything' }
}

/**
 * The fields a backfilled row may carry, from the fill-event table in
 * `SCHEMA-software.md`: the what-it-is group partly, and the contract group
 * from a contract. Everything else on the schema is somebody's judgment or
 * somebody's knowledge, and it arrives through `new`, `update`, `review` or a
 * person — never through an import.
 */
const FILLABLE = [
  'Name',
  'Description',
  'Status',
  'Domain',
  'Audience',
  'Contract dates',
  'Notice deadline',
  'Renews',
  'Annual cost',
  'Contract link'
]

/**
 * The fields whose presence on a candidate refuses the whole draft. Not
 * silently dropped: a field that vanished quietly would leave the person
 * believing it was set.
 */
const NEVER_FILLED = ['Owner', 'Technical owner', 'Admins', 'Billing owner', 'Importance', 'Last reviewed']

const isEmpty = tool.isEmpty

function refuse (field, kind, message) {
  return { field, kind, message }
}

function text (value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** A day that is one, or null. The refusal text is the caller's. */
function isDay (value) {
  if (typeof value !== 'string') return false
  const parsed = Date.parse(`${value}T00:00:00Z`)
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(parsed) &&
    new Date(parsed).toISOString().slice(0, 10) === value
}

/**
 * The reading plan for a request, or a refusal that carries NO PLAN AT ALL.
 * Not the half of the request that was fine: reading the good half of a
 * refused scope is still reading a scope nobody agreed to.
 */
function plan (request) {
  const problems = []
  const add = (field, kind, message) => problems.push(refuse(field, kind, message))

  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    return { ok: false, problems: [refuse('request', 'not-a-record', `The request is ${JSON.stringify(request)}, and this reads a set of fields: sources, and the settings for each.`)] }
  }

  const sources = request.sources
  if (!Array.isArray(sources) || !sources.length) {
    add('sources', 'missing', 'Name the sources: some of contracts, email. A run with no sources has nothing it is allowed to read.')
  } else {
    for (const one of sources) {
      if (typeof one !== 'string' || !SOURCES.includes(one)) {
        add('sources', 'unknown-source', `${JSON.stringify(one)} is not a source this skill reads. It reads: ${SOURCES.join(', ')}. It is refused rather than dropped, because a run that quietly drops a source reports on less than was asked about.`)
      }
    }
  }
  const named = Array.isArray(sources) ? sources.filter(s => SOURCES.includes(s)) : []

  // Settings for a source that is not on the list: the request disagrees with
  // itself, and the two repairs are opposites, so nobody here picks one.
  for (const source of SOURCES) {
    if (request[source] !== undefined && !named.includes(source)) {
      add(source, 'settings-without-source', `The request carries settings for "${source}" and does not list it under sources. Either the source was left off the list or its settings were left behind, and those want opposite repairs. Say which.`)
    }
  }

  if (named.includes('contracts')) {
    const settings = request.contracts
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      add('contracts', 'missing-settings', 'The contracts source needs its folder: { "folder": "the folder the user named" }. Not a whole Drive, and not a search across everything they can see.')
    } else if (!text(settings.folder)) {
      add('contracts', 'no-folder', `The contracts folder is ${JSON.stringify(settings.folder)}, and a named folder is the whole scope. Not a whole Drive, and not a search across everything the user can see.`)
    }
  }

  if (named.includes('email')) {
    const settings = request.email
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      add('email', 'missing-settings', 'The email source needs its range: { "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" }. There is no unbounded read; a year is the sensible default to OFFER, because it catches one full renewal cycle, and the person says yes to it out loud.')
    } else {
      for (const end of ['from', 'to']) {
        if (settings[end] === undefined || settings[end] === null || settings[end] === '') {
          add('email', 'half-a-range', `The email range has no "${end}". There is no unbounded read, and half a range is the absence of a scope, not a wide one.`)
        } else if (!isDay(settings[end])) {
          add('email', 'not-a-day', `email.${end} is ${JSON.stringify(settings[end])}, which is not a day. Use YYYY-MM-DD: parsed loosely, a date that is not one rolls forward and reads a window nobody set.`)
        }
      }
      if (isDay(settings.from) && isDay(settings.to) && settings.from > settings.to) {
        add('email', 'range-backwards', `The email range runs from ${settings.from} to ${settings.to}, which is backwards.`)
      }
      // THE USER'S OWN MAILBOX AND NOBODY ELSE'S. Absent means their own. A
      // mailbox supplied and unreadable is a scope somebody set, and replacing
      // it with the default reads a mailbox nobody agreed to. Whether a
      // supplied address IS the user's own is the skill's to hold, said out
      // loud in the conversation; what is enforceable here is the shape.
      if (settings.mailbox !== undefined && !text(settings.mailbox)) {
        add('email', 'unreadable-mailbox', `email.mailbox is ${JSON.stringify(settings.mailbox)}, which is not an address. Leave it out for the user's own mailbox, which is the only one this skill reads.`)
      }
    }
  }

  if (problems.length) return { ok: false, problems }

  return {
    ok: true,
    reading: named,
    notReading: SOURCES.filter(s => !named.includes(s)),
    emailRules: named.includes('email')
      ? 'Email is READ-ONLY: never send, reply, label, archive, move or mark anything. Read to find vendors and do nothing else. The user\'s own mailbox only.'
      : null,
    note: 'Show notReading to the person before starting: a source left out and a source that held nothing produce the same empty result, and only one of them is worth saying out loud.'
  }
}

/**
 * What was found, judged into candidates a person can scan, each carrying its
 * evidence strength so the strong ones can be trusted and the weak ones
 * looked at harder.
 */
function candidates (found) {
  if (!Array.isArray(found)) {
    return { ok: false, problems: [refuse('found', 'not-a-list', `The findings are ${JSON.stringify(found)}, and this reads a list, one entry per finding.`)] }
  }

  const problems = []
  const ready = []
  const needKind = []

  found.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      problems.push(refuse(`found[${index}]`, 'not-a-record', `found[${index}] is ${JSON.stringify(entry)}, and a finding is a set of fields: what, where, kind.`))
      return
    }
    const what = text(entry.what)
    if (!what) {
      problems.push(refuse(`found[${index}].what`, 'missing', `found[${index}] has no \`what\`: the tool's name, the vendor's own spelling as far as the source shows it.`))
      return
    }
    // WHERE IS REQUIRED ON EVERY ONE, down to the message or the file.
    // Nothing is absorbed anonymously: a candidate nobody can trace back is a
    // candidate nobody can check.
    const where = text(entry.where)
    if (!where) {
      problems.push(refuse(`found[${index}].where`, 'missing', `"${what}" says nothing about where it came from. Every candidate says, down to the message or the file. Nothing is absorbed anonymously.`))
      return
    }
    if (entry.kind === undefined || entry.kind === null || entry.kind === '') {
      // No kind is a question, not a refusal: offer the kinds, do not decide
      // alone.
      needKind.push({ what, where, kinds: Object.keys(KINDS) })
      return
    }
    const kind = KINDS[entry.kind]
    if (!kind) {
      problems.push(refuse(`found[${index}].kind`, 'unknown-kind', `"${entry.kind}" is not a kind of evidence this skill knows. One of: ${Object.keys(KINDS).join(', ')}. It is refused now rather than at write time with a drafted row already lost.`))
      return
    }
    ready.push({
      what,
      where,
      kind: entry.kind,
      evidence: kind.evidence,
      proves: kind.proves,
      strength: kind.source === 'contracts'
        ? 'strong: a contract can fill the whole contract group'
        : kind.evidence === 'strong'
          ? 'strong evidence of use, thin fill: the name and honestly little else'
          : 'weak: vendors email people who never bought anything. Look harder at this one'
    })
  })

  if (problems.length) return { ok: false, problems }

  return {
    ok: true,
    candidates: ready,
    needKind,
    note:
      'Run `duplicates` against the directory for EVERY candidate before offering it — the same check `new` uses, ' +
      'which is what makes backfill safe to re-run. Then go through the list one at a time, yes, no, or skip. ' +
      'Do not batch it into a single approve-all: the list is the product.'
  }
}

/**
 * An approved candidate turned into the row the preview shows.
 *
 * The row carries only FILLABLE fields. A forbidden field refuses the whole
 * draft; an unknown field does too, because it is either a typo or a field
 * that arrives through `new`, and both deserve the person's eyes rather than
 * a silent drop.
 */
function draft (candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return { ok: false, problems: [refuse('candidate', 'not-a-record', `The candidate is ${JSON.stringify(candidate)}, and this reads a set of fields.`)] }
  }

  const problems = []
  const row = candidate.row
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    return { ok: false, problems: [refuse('row', 'not-a-record', `The candidate carries ${JSON.stringify(row)} as its row, and this reads a set of fields, one key per property.`)] }
  }

  for (const field of NEVER_FILLED) {
    if (row[field] !== undefined) {
      problems.push(refuse(field, 'never-filled',
        field === 'Importance'
          ? 'Importance is a judgment about consequence and a receipt carries no information about it. It is refused rather than dropped, and it stays empty until a person answers the what-breaks question through `new` or `review`.'
          : field === 'Last reviewed'
            ? 'Last reviewed stays empty on a backfilled row: a machine pulled it in and nobody has confirmed any of it. Empty is the honest value, and it is what makes the row show up for review.'
            : `${field} is a person field and backfill never fills one. An agent guessing at a person is worse than an empty field. Notify the real person instead.`))
    }
  }

  for (const field of Object.keys(row)) {
    if (!FILLABLE.includes(field) && !NEVER_FILLED.includes(field)) {
      problems.push(refuse(field, 'not-backfills-field', `"${field}" is not a field backfill fills. It fills: ${FILLABLE.join(', ')}. Everything else arrives through \`new\`, \`update\`, \`review\` or a person.`))
    }
  }

  if (!text(row.Name)) {
    problems.push(refuse('Name', 'missing', 'Every row needs a name, the vendor\'s own spelling. It is the title property and Notion will not create a page without one.'))
  }
  if (isEmpty(row.Status)) {
    problems.push(refuse('Status', 'missing', 'Status is asked at the approval gate, not defaulted: a tool found in a live contract is usually Active, and the person says so, because a wrong status filed silently is how Retired tools keep renewing.'))
  }

  const where = text(candidate.where)
  if (!where) {
    problems.push(refuse('where', 'missing', 'The candidate says nothing about where it came from, and provenance is the only claim backfill makes that a reader can check.'))
  }

  // The same value gates every other write runs: an invented select value, a
  // rolled-over day or a backwards range is refused here, with the candidate
  // still on the table, rather than at write time with the row lost.
  for (const problem of valueGate(row)) problems.push(problem)

  if (problems.length) return { ok: false, problems }

  return {
    ok: true,
    row: Object.fromEntries(FILLABLE.filter(f => row[f] !== undefined && !isEmpty(row[f])).map(f => [f, row[f]])),
    where,
    backfill: true,
    leftEmpty: {
      people: 'Owner, Technical owner, Admins and Billing owner are empty. Notify the real people rather than guessing.',
      importance: 'Importance is empty until a person answers what breaks and how fast.',
      lastReviewed: 'Last reviewed is empty, which is what makes this row show up for review.'
    },
    note: 'Preview this row IN FULL at the approval gate, saying which kind of evidence it rests on and where it came from. Only a yes goes to `backfill-create`.'
  }
}

/** The subset of tool.js's value gates a backfill row can trip. */
function valueGate (row) {
  const out = []
  const gated = {}
  for (const field of FILLABLE) {
    if (row[field] !== undefined) gated[field] = row[field]
  }
  // Borrow the shared gate by shaping the row as an update-sized change set:
  // same selects, same lists, same dates, same money rules. `Last reviewed`
  // and person fields were already refused above, so nothing here masks them.
  const shaped = { ...gated }
  const found = tool.updateProblems(shaped)
  for (const problem of found) {
    if (problem.kind === 'empty') continue
    if (problem.kind === 'never-cleared') continue // emptiness is handled as absence here
    out.push(problem)
  }
  return out
}

/**
 * Filling blanks on a row that already exists, when the person wants it
 * enriched rather than duplicated.
 *
 * `existing` is `{ url, values }` with LOGICAL names and logical values — the
 * command layer maps the fetched page through the config before it gets here,
 * because a raw fetch from a renamed workspace reads as blank in every field,
 * which would turn "fill the blanks" into "fill everything".
 *
 * IT NEVER OVERWRITES. A field that already holds something is reported and
 * left alone: a machine replacing what a person wrote is the one kind of
 * damage the approval gate cannot undo.
 */
function fill (existing, candidate) {
  if (!existing || typeof existing !== 'object' || Array.isArray(existing) ||
      !existing.values || typeof existing.values !== 'object' || Array.isArray(existing.values)) {
    return { ok: false, problems: [refuse('existing', 'not-a-mapped-row', 'The existing row has to arrive as { url, values } with logical names, mapped by the command layer. A raw fetch reads as blank in every field, which would turn "fill the blanks" into "fill everything".')] }
  }

  const drafted = draft(candidate)
  if (!drafted.ok) return drafted

  const filled = {}
  const alreadyHeld = []
  for (const [field, value] of Object.entries(drafted.row)) {
    if (field === 'Name' || field === 'Status') continue // identity and state belong to the row that exists
    const current = existing.values[field]
    if (isEmpty(current)) {
      filled[field] = value
    } else {
      alreadyHeld.push({ field, holds: current })
    }
  }

  return {
    ok: true,
    url: existing.url,
    changes: filled,
    alreadyHeld,
    nothingToFill: Object.keys(filled).length === 0,
    note: Object.keys(filled).length
      ? 'Send `changes` through `update` after the person approves them. Fields under alreadyHeld were left alone: backfill never overwrites what a person wrote.'
      : 'Every field this candidate could fill already holds something. Filling nothing is a finished answer, not a failure.'
  }
}

/**
 * The Notion property payload for an approved backfill row.
 *
 * NOT `newProperties`, deliberately. That builder enforces the conversation
 * contract — Importance answered, the body written, `Last reviewed` stamped
 * from today — and every one of those is exactly what a backfilled row must
 * not carry. This builds the FILLABLE subset and nothing else, and the
 * absent stamp is the point: an unstamped, ownerless, unweighted row is what
 * makes it show up for review.
 */
function properties (context, drafted) {
  const checked = draft(drafted)
  if (!checked.ok) {
    throw new Error(`This backfill row cannot be written yet:\n  ${checked.problems.map(p => p.message).join('\n  ')}`)
  }
  const row = checked.row

  const out = {}
  const put = (logical, value) => { out[context.property(logical)] = value }
  const putDate = (logical, start, end) => {
    const name = context.property(logical)
    out[`date:${name}:start`] = start
    out[`date:${name}:end`] = end === undefined ? null : end
  }

  put('Name', String(row.Name).trim())
  put('Status', context.value('Status', row.Status))
  if (row.Description !== undefined) put('Description', String(row.Description))
  if (row.Domain !== undefined) put('Domain', context.value('Domain', row.Domain))
  if (row.Audience !== undefined) {
    put('Audience', schema.listValues(row.Audience).map(v => context.value('Audience', v)))
  }
  if (row.Renews !== undefined) put('Renews', context.value('Renews', row.Renews))
  if (row['Annual cost'] !== undefined) put('Annual cost', row['Annual cost'])
  if (row['Contract link'] !== undefined) put('Contract link', String(row['Contract link']))
  if (row['Notice deadline'] !== undefined) putDate('Notice deadline', String(row['Notice deadline']), null)
  const dates = row['Contract dates']
  if (dates !== undefined && dates && dates.start) {
    putDate('Contract dates', String(dates.start), isEmpty(dates.end) ? null : String(dates.end))
  }

  return out
}

/**
 * What must be ABSENT from a backfilled page for the write to count as
 * proved. A page that arrived stamped or owned drops out of the
 * never-reviewed signal without anything saying so, so a backfilled page is
 * proved by what is not on it as much as by what is.
 *
 * `readback` is the fetched page's properties, keyed by workspace names.
 * Returns the problems; empty means the absences held.
 */
function proveAbsent (context, readbackProperties, cameBackEmpty) {
  const problems = []
  const dateEmpty = (name) =>
    cameBackEmpty(readbackProperties[`date:${name}:start`]) && cameBackEmpty(readbackProperties[name])
  for (const logical of NEVER_FILLED) {
    const name = context.property(logical)
    const empty = logical === 'Last reviewed'
      ? dateEmpty(name)
      : cameBackEmpty(readbackProperties[name])
    if (!empty) {
      problems.push({
        field: logical,
        kind: 'arrived-filled',
        message: `${logical} came back holding ${JSON.stringify(readbackProperties[`date:${name}:start`] ?? readbackProperties[name])} on a backfilled page, and backfill never writes it. ` +
          (logical === 'Last reviewed'
            ? 'A page that arrives stamped is indistinguishable from one somebody checked, and it drops out of the review signal without anything saying so.'
            : 'Do not report this write as done.')
      })
    }
  }
  return problems
}

module.exports = {
  SOURCES,
  KINDS,
  FILLABLE,
  NEVER_FILLED,
  plan,
  candidates,
  draft,
  fill,
  properties,
  proveAbsent
}

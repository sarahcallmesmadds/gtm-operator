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
 * WHAT A BACKFILLED ROW NEVER CARRIES, from `plugins/software/SKILLS.md`:
 * no person field (four fields here are people and all four stay empty), and no
 * `Last reviewed` (a machine pulled the row in and nobody has confirmed the
 * whole row). `Importance` is allowed only when bounded Slack evidence names
 * what breaks, how fast, and exactly where the evidence came from. Handing
 * `draft` a forbidden or unsupported field is REFUSED, NOT IGNORED: approving
 * a candidate and having something smaller run is the one failure the approval
 * gate cannot see.
 */

const path = require('path')

const schema = require(path.join(__dirname, 'vendor', 'software-schema'))
const tool = require(path.join(__dirname, 'tool'))

/** The sources a scope may name. Anything else is refused, not ignored. */
const SOURCES = ['contracts', 'docusign', 'ramp', 'quickbooks', 'email', 'slack']
const RANGE_SOURCES = ['docusign', 'ramp', 'quickbooks', 'email', 'slack']

/**
 * What each source proves, and what it may fill. From `plugins/software/SKILLS.md`:
 * the sources are not equally good, and the skill has to say which it is
 * looking at. A contract makes a strong candidate; payments and email make
 * thinner ones, and presenting a thin row as filled would be worse than not
 * finding it, because a thin row looks finished.
 */
const KINDS = {
  contract: { source: 'contracts', evidence: 'strong', contractTerms: true, proves: 'an agreement exists, on these terms' },
  'signed-agreement': { source: 'docusign', evidence: 'strong', contractTerms: true, proves: 'a signed agreement exists, on these terms' },
  'ramp-transaction': { source: 'ramp', evidence: 'strong', proves: 'the company paid the vendor through Ramp' },
  'quickbooks-bill': { source: 'quickbooks', evidence: 'strong', proves: 'the vendor appears in an accounting bill' },
  'quickbooks-payment': { source: 'quickbooks', evidence: 'strong', proves: 'the company paid the vendor through QuickBooks' },
  invoice: { source: 'email', evidence: 'strong', proves: 'somebody is paying for it' },
  receipt: { source: 'email', evidence: 'strong', proves: 'somebody is paying for it' },
  'renewal-notice': { source: 'email', evidence: 'strong', proves: 'a term is live and coming round' },
  'support-thread': { source: 'email', evidence: 'strong', proves: 'somebody is working with the vendor' },
  announcement: { source: 'email', evidence: 'weak', proves: 'the vendor emails somebody here, which vendors do to people who never bought anything' },
  'slack-workflow': { source: 'slack', evidence: 'context', proves: 'a team describes relying on the tool for a named workflow' }
}

/**
 * The fields a backfilled row may carry, from the fill-event table in
 * `plugins/software/SCHEMA.md`: the what-it-is group partly, and the contract group
 * from a contract. Everything else on the schema is somebody's judgment or
 * somebody's knowledge, and it arrives through `new`, `update`, `review` or a
 * person — never through an import.
 */
const FILLABLE = [
  'Name',
  'Description',
  'Status',
  'Importance',
  'Domain',
  'Audience',
  'Contract dates',
  'Notice deadline',
  'Renews',
  'Annual cost',
  'Contract link'
]

/**
 * The subset of FILLABLE only a contract may carry. The fill-event table
 * names the contract group's backfill route as "from a contract", and the
 * source table says email fills the name and honestly little else.
 */
const CONTRACT_GROUP = ['Contract dates', 'Notice deadline', 'Renews', 'Annual cost', 'Contract link']

/**
 * The fields whose presence on a candidate refuses the whole draft. Not
 * silently dropped: a field that vanished quietly would leave the person
 * believing it was set.
 */
const NEVER_FILLED = ['Owner', 'Technical owner', 'Admins', 'Billing owner', 'Last reviewed']

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

function rangeProblems (source, settings) {
  const problems = []
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return [refuse(source, 'missing-settings', `The ${source} source needs a bounded range: { "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" } plus its named account or Slack locations where required.`)]
  }
  for (const end of ['from', 'to']) {
    if (settings[end] === undefined || settings[end] === null || settings[end] === '') {
      problems.push(refuse(source, 'half-a-range', `The ${source} range has no "${end}". There is no unbounded read, and half a range is the absence of a scope, not a wide one.`))
    } else if (!isDay(settings[end])) {
      problems.push(refuse(source, 'not-a-day', `${source}.${end} is ${JSON.stringify(settings[end])}, which is not a day. Use YYYY-MM-DD.`))
    }
  }
  if (isDay(settings.from) && isDay(settings.to) && settings.from > settings.to) {
    problems.push(refuse(source, 'range-backwards', `The ${source} range runs from ${settings.from} to ${settings.to}, which is backwards.`))
  }
  return problems
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
    add('sources', 'missing', `Name the sources: some of ${SOURCES.join(', ')}. A run with no sources has nothing it is allowed to read.`)
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

  for (const source of RANGE_SOURCES) {
    if (named.includes(source)) problems.push(...rangeProblems(source, request[source]))
  }

  if (named.includes('email')) {
    const settings = request.email
    if (settings && typeof settings === 'object' && !Array.isArray(settings)) {
      // THE USER'S OWN MAILBOX AND NOBODY ELSE'S, AND SO NO MAILBOX SETTING
      // EXISTS. An earlier draft accepted any non-empty string here and held
      // the ownership question in the skill's prose, which made this gate
      // advertise a guarantee it did not hold: a request naming
      // finance@example.com came back ok while claiming the read was
      // restricted. There is no approval gate in front of a read, so the
      // only honest shapes are the default (their own) and a refusal. A
      // request that names a mailbox is either naming their own, which is
      // the default and needs no saying, or somebody else's, which is
      // refused outright.
      if (settings.mailbox !== undefined) {
        add('email', 'mailbox-not-a-setting', `email.mailbox is set, and there is no mailbox setting: this skill reads the user's own mailbox and nothing else. Remove it. A request that needs to name a different mailbox is a request this skill refuses by design.`)
      }
    }
  }

  for (const source of ['docusign', 'ramp', 'quickbooks']) {
    if (!named.includes(source)) continue
    const settings = request[source]
    if (settings && typeof settings === 'object' && !Array.isArray(settings) && !text(settings.account)) {
      add(source, 'no-account', `${source}.account is missing. Name the connected company or account so a multi-account authorization cannot widen the read.`)
    }
  }

  if (named.includes('slack')) {
    const settings = request.slack
    if (settings && typeof settings === 'object' && !Array.isArray(settings)) {
      const channels = Array.isArray(settings.channels) ? settings.channels.map(text).filter(Boolean) : []
      const directMessages = Array.isArray(settings.directMessages) ? settings.directMessages.map(text).filter(Boolean) : []
      if (!channels.length && !directMessages.length) {
        add('slack', 'no-locations', 'Slack needs at least one named channel or direct-message conversation. This plugin never searches all Slack and never searches all direct messages.')
      }
      if (directMessages.some(name => /^all$/i.test(name))) {
        add('slack', 'all-direct-messages', 'Slack directMessages contains "all". Direct messages are never all; name each conversation.')
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
    connectorRules: named.filter(s => !['contracts', 'email'].includes(s)).map(source => ({
      source,
      rule: source === 'slack'
        ? 'Slack is READ-ONLY and bounded to the named channels or direct-message conversations and date range. Use it to identify named workflow dependence and evidence for Importance, never to post, react, edit or delete.'
        : `${source} is READ-ONLY and bounded to the named account and date range. Search and retrieve evidence only; never create, approve, send, sign, pay or modify anything.`
    })),
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
      ...(entry.importanceEvidence === undefined ? {} : { importanceEvidence: entry.importanceEvidence }),
      evidence: kind.evidence,
      proves: kind.proves,
      strength: kind.contractTerms
        ? 'strong: an agreement can fill the whole contract group'
        : kind.evidence === 'strong'
          ? 'strong evidence of use, thin fill: the name and honestly little else'
          : kind.evidence === 'weak'
            ? 'weak: vendors email people who never bought anything. Look harder at this one'
            : 'context evidence: a named workflow depends on the tool, but that alone does not prove a paid contract'
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

  // THE CANDIDATE'S TOP LEVEL HAS ITS OWN ALLOWLIST. Without one, a
  // candidate shaped { Owner: "...", row: validRow } passed and the Owner
  // was silently dropped, which is the refused-not-dropped invariant
  // breaking at the layer above the one that enforces it. The three
  // annotations are this module's own outputs from `candidates`, accepted
  // back rather than silently ignored.
  // `ok`, `backfill`, `leftEmpty` and `note` are draft's OWN outputs,
  // accepted back so the commands compose: `backfill-create` re-validates by
  // calling draft again, and a skill that saved the draft output and handed
  // it on was refused for fields this module itself had added.
  const knownTop = ['what', 'where', 'kind', 'row', 'importanceEvidence', 'evidence', 'proves', 'strength', 'ok', 'backfill', 'leftEmpty', 'note']
  for (const key of Object.keys(candidate)) {
    if (knownTop.includes(key)) continue
    if (NEVER_FILLED.includes(key)) {
      problems.push(refuse(key, 'never-filled', `${key} is on the candidate itself, outside the row, and backfill never fills it anywhere. It is refused rather than dropped.`))
    } else {
      problems.push(refuse(key, 'unknown-candidate-field', `"${key}" is not part of a candidate. A candidate is what, where, kind and row; a property belongs inside row, where the gates can see it.`))
    }
  }

  // THE KIND IS SETTLED BY DRAFT TIME, because it is what decides which
  // fields the evidence can honestly fill. `candidates` lets a missing kind
  // through as a question; an approved candidate has had it answered.
  if (!KINDS[candidate.kind]) {
    problems.push(refuse('kind', candidate.kind === undefined || candidate.kind === null || candidate.kind === '' ? 'missing' : 'unknown-kind',
      `The candidate's kind is ${JSON.stringify(candidate.kind)}, and by draft time it is settled: one of ${Object.keys(KINDS).join(', ')}. The kind is what decides which fields the evidence can honestly fill.`))
  }

  const row = candidate.row
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    return { ok: false, problems: [...problems, refuse('row', 'not-a-record', `The candidate carries ${JSON.stringify(row)} as its row, and this reads a set of fields, one key per property.`)] }
  }

  // THE CONTRACT GROUP COMES FROM A CONTRACT AND NOWHERE ELSE. The
  // fill-event table says so ("software:backfill from a contract"), and the
  // source table's other half is "Email: the name, and honestly little
  // else". A receipt carrying Contract dates is a guess wearing evidence's
  // clothes, and a thin row that looks finished is worse than not finding
  // it.
  if (KINDS[candidate.kind] && !KINDS[candidate.kind].contractTerms) {
    for (const field of CONTRACT_GROUP) {
      if (row[field] !== undefined) {
        problems.push(refuse(field, 'not-from-this-evidence', `${field} is filled from a ${candidate.kind}, and the contract group is filled from a contract or signed DocuSign agreement and nowhere else. Spend, accounting, Slack and email evidence can prove use without proving the terms.`))
      }
    }
  }

  for (const field of NEVER_FILLED) {
    if (row[field] !== undefined) {
      problems.push(refuse(field, 'never-filled',
        field === 'Last reviewed'
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

  const importanceEvidence = candidate.importanceEvidence
  if (row.Importance !== undefined || importanceEvidence !== undefined) {
    if (row.Importance === undefined) {
      problems.push(refuse('Importance', 'evidence-without-value', 'Slack importance evidence is present but Importance is absent. Either propose the value it supports for approval or remove the unused evidence.'))
    }
    if (!importanceEvidence || typeof importanceEvidence !== 'object' || Array.isArray(importanceEvidence)) {
      problems.push(refuse('Importance', 'unsupported', 'Importance may be proposed only with importanceEvidence from Slack naming where the evidence came from, what breaks, and how fast. A receipt, agreement or payment does not establish business consequence.'))
    } else {
      const knownEvidence = ['source', 'where', 'whatBreaks', 'howFast']
      for (const key of Object.keys(importanceEvidence)) {
        if (!knownEvidence.includes(key)) problems.push(refuse(`importanceEvidence.${key}`, 'unknown-field', `importanceEvidence.${key} is not part of the evidence contract. Use source, where, whatBreaks and howFast.`))
      }
      if (importanceEvidence.source !== 'slack') problems.push(refuse('importanceEvidence.source', 'wrong-source', 'Importance evidence must come from bounded Slack context. Contracts and payments establish terms or spend, not what breaks.'))
      for (const field of ['where', 'whatBreaks', 'howFast']) {
        if (!text(importanceEvidence[field])) problems.push(refuse(`importanceEvidence.${field}`, 'missing', `importanceEvidence.${field} is required before Slack context can support Importance.`))
      }
    }
  }

  // A whitespace-only text value is nothing wearing a value's shape: it
  // passes an emptiness test, writes as text, and the person believes
  // something was recorded. Refused rather than trimmed to nothing.
  for (const field of ['Description', 'Contract link']) {
    if (typeof row[field] === 'string' && !row[field].trim()) {
      problems.push(refuse(field, 'blank', `${field} is whitespace, which is nothing wearing a value's shape. Leave the field out, or put something in it.`))
    }
  }

  // The same value gates every other write runs: an invented select value, a
  // rolled-over day or a backwards range is refused here, with the candidate
  // still on the table, rather than at write time with the row lost.
  for (const problem of valueGate(row)) problems.push(problem)

  if (problems.length) return { ok: false, problems }

  return {
    ok: true,
    // The candidate's own identity travels on the output, so the output can
    // be handed straight back to `backfill-create` and `prove-backfill`:
    // both re-validate through this function, and an output missing its
    // kind was refused by the very gate that produced it.
    what: text(candidate.what),
    where,
    kind: candidate.kind,
    ...(importanceEvidence === undefined ? {} : { importanceEvidence }),
    row: Object.fromEntries(FILLABLE.filter(f => row[f] !== undefined && !isEmpty(row[f])).map(f => [f, row[f]])),
    backfill: true,
    leftEmpty: {
      people: 'Owner, Technical owner, Admins and Billing owner are empty. Notify the real people rather than guessing.',
      ...(row.Importance === undefined ? { importance: 'Importance is empty because bounded Slack evidence did not establish what breaks and how fast.' } : {}),
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
 * contract, writes the body, and stamps `Last reviewed` from today. Backfill
 * writes only the evidence-supported subset. The absent stamp is the point:
 * an unstamped, ownerless row is what makes it show up for review. Importance
 * travels only when bounded Slack evidence passed `draft` above.
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
  if (row.Importance !== undefined) put('Importance', context.value('Importance', row.Importance))
  // Trimmed the same way newProperties trims, or the two builders write two
  // shapes for one field and the read-back proof learns to disagree with
  // itself.
  if (row.Description !== undefined) put('Description', String(row.Description).trim())
  if (row.Domain !== undefined) put('Domain', context.value('Domain', row.Domain))
  if (row.Audience !== undefined) {
    put('Audience', schema.listValues(row.Audience).map(v => context.value('Audience', v)))
  }
  if (row.Renews !== undefined) put('Renews', context.value('Renews', row.Renews))
  if (row['Annual cost'] !== undefined) put('Annual cost', row['Annual cost'])
  if (row['Contract link'] !== undefined) put('Contract link', String(row['Contract link']).trim())
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
function proveAbsent (context, readbackProperties, cameBackEmpty, importanceExpected = false) {
  const problems = []
  const dateEmpty = (name) =>
    cameBackEmpty(readbackProperties[`date:${name}:start`]) && cameBackEmpty(readbackProperties[name])
  const mustBeEmpty = importanceExpected ? NEVER_FILLED : [...NEVER_FILLED, 'Importance']
  for (const logical of mustBeEmpty) {
    const name = context.property(logical)
    const empty = logical === 'Last reviewed'
      ? dateEmpty(name)
      : cameBackEmpty(readbackProperties[name])
    if (!empty) {
      problems.push({
        field: logical,
        kind: 'arrived-filled',
        message: `${logical} came back holding ${JSON.stringify(readbackProperties[`date:${name}:start`] ?? readbackProperties[name])} on a backfilled page, and this backfill did not write it. ` +
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
  CONTRACT_GROUP,
  NEVER_FILLED,
  plan,
  candidates,
  draft,
  fill,
  properties,
  proveAbsent
}

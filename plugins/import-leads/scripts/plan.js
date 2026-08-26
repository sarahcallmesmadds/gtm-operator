'use strict'

/**
 * The judgment half of the pipeline: gates, the multi-event check, the
 * dedupe verdicts and the plan the confirmation summary shows.
 *
 * Everything in this file plans. Nothing in it writes anywhere, and the plan
 * it builds is executed only after the person has seen the whole of it and
 * said yes. That split is the design's own: everything before the
 * confirmation plans, and the push executes exactly the approved plan.
 */

const ingest = require('./ingest')
const rules = require('./rules')
const configModule = require('./config')

// --------------------------------------------------------------------- gates

/**
 * The floor, this plugin's own, plus the org's required-fields rule.
 *
 * A row that cannot meet them is refused with the gap named, never padded.
 * The floor here is the half a row can fail on its own: first and last name.
 * The other half of the floor, no contact pushed without its company matched
 * or planned, is checked where the company decisions exist, in `assemble`.
 *
 * THE SOURCE RULE IS A GATE TOO. Every filled canonical field has to name
 * where it came from, and a value with no source is refused, not repaired:
 * repairing it here would be this code inventing the provenance the rule
 * exists to demand.
 */
function gate (rows, requiredFieldsRules) {
  const wrong = rules.requiredFieldsProblems(requiredFieldsRules)
  if (wrong.length) {
    throw new Error(`The required-fields rule cannot be used as it is:\n  ${wrong.join('\n  ')}`)
  }

  const refused = []
  const passed = []
  for (const row of rows) {
    const gaps = []
    for (const field of ['firstName', 'lastName']) {
      if (!row.fields[field]) gaps.push(`${field} is missing, and the floor refuses a row without a first and last name`)
    }
    for (const field of requiredFieldsRules.required) {
      if (!row.fields[field]) gaps.push(`${field} is missing, and the org's required-fields rule requires it`)
    }
    for (const [field, value] of Object.entries(row.fields)) {
      if (value !== '' && !(row.fieldSources && row.fieldSources[field])) {
        gaps.push(`${field} is filled and names no source. A value with no source is refused`)
      }
    }
    if (gaps.length) refused.push({ index: row.index, gaps })
    else passed.push(row)
  }
  return { passed, refused }
}

// --------------------------------------------------- the multi-event check

/**
 * Words that make a value read like an event. Signals, not verdicts: every
 * hit below is presented, and the person decides one campaign or several.
 */
const EVENT_WORDS = ['webinar', 'conference', 'summit', 'expo', 'event', 'roadshow', 'workshop', 'dinner', 'meetup', 'booth', 'session']

// The month names are spelled out as their real forms, longest first,
// rather than a prefix plus `[a-z]*`: the loose tail read "Janitor 15,
// 2026" as a date, which is a false multi-event signal handed to a person
// as evidence.
const DATE_LIKE = /^\s*(?:(\d{4})-(\d{1,2})-(\d{1,2})|(\d{1,2})[\/.](\d{1,2})[\/.]\d{2,4}|(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\.?\s+(\d{1,2})(?:,?\s+\d{4})?)\s*$/i

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const DAYS_IN = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

/**
 * Shape and plausibility together. The shape alone reported 2026-13-40 as a
 * date, which is a false signal handed to the person as evidence. An ISO
 * value has to be a day that exists; a slash form has to be readable as a
 * real day-and-month in at least one of its two orders, since which order a
 * list uses is unknowable from one value.
 */
function dateLike (value) {
  const match = DATE_LIKE.exec(String(value))
  if (!match) return false
  const [, isoY, isoM, isoD, slashA, slashB, monthName, monthDay] = match
  if (isoY !== undefined) {
    const at = new Date(Date.UTC(Number(isoY), Number(isoM) - 1, Number(isoD)))
    return at.getUTCFullYear() === Number(isoY) && at.getUTCMonth() === Number(isoM) - 1 && at.getUTCDate() === Number(isoD)
  }
  // Day checked against the month's own length, not a flat 31, in every
  // form: 31/02 and "Feb 31" are both shapes, not dates. February allows 29
  // because the year is not knowable from one value.
  const readable = (day, month) => month >= 1 && month <= 12 && day >= 1 && day <= DAYS_IN[month - 1]
  if (slashA !== undefined) {
    const a = Number(slashA)
    const b = Number(slashB)
    return readable(a, b) || readable(b, a)
  }
  return readable(Number(monthDay), MONTHS.indexOf(monthName.slice(0, 3).toLowerCase()) + 1)
}

/**
 * The signals a list is really several events or assets wearing one file.
 *
 * Mandatory before campaign setup, the reference's own rule, because the
 * expensive mistake is one campaign wrapped around three events, discovered
 * after the memberships are written. It reads EVERY source column, not just
 * one that looks like an event column, because the signal is routinely in a
 * column named something else.
 *
 * What comes back is evidence: grouping candidates (columns whose few
 * distinct values partition the rows), date-shaped columns with more than
 * one date in them, and event-word hits. Deciding is the person's.
 */
function eventSignals (rows) {
  if (!Array.isArray(rows) || !rows.length) {
    throw new Error('The multi-event check needs the ingested rows, and there are none.')
  }

  const columns = new Map()
  for (const row of rows) {
    for (const [column, raw] of Object.entries(row.source || {})) {
      const value = String(raw === null || raw === undefined ? '' : raw).trim()
      if (!value) continue
      if (!columns.has(column)) columns.set(column, new Map())
      const values = columns.get(column)
      values.set(value, (values.get(value) || 0) + 1)
    }
  }

  const groupingCandidates = []
  const dateColumns = []
  const eventWordHits = []

  for (const [column, values] of columns.entries()) {
    const distinct = [...values.entries()]
    const filled = distinct.reduce((sum, [, count]) => sum + count, 0)

    // A grouping column has few distinct values and at least one of them
    // repeated. A column that is unique per row (emails, names) partitions
    // nothing, and without the repeat test it was the loudest candidate.
    const repeats = distinct.some(([, count]) => count >= 2)
    if (distinct.length >= 2 && distinct.length <= 8 && repeats && filled >= Math.max(2, rows.length / 2)) {
      groupingCandidates.push({
        column,
        values: distinct.map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count)
      })
    }

    const dateValues = distinct.filter(([value]) => dateLike(value))
    if (dateValues.length && new Set(dateValues.map(([value]) => value)).size > 1) {
      dateColumns.push({ column, distinctDates: dateValues.map(([value]) => value) })
    }

    const hits = distinct.filter(([value]) => {
      const folded = value.toLowerCase()
      return EVENT_WORDS.some(word => folded.includes(word))
    })
    if (hits.length) {
      eventWordHits.push({ column, values: hits.map(([value, count]) => ({ value, count })) })
    }
  }

  return {
    checked: true,
    rowCount: rows.length,
    groupingCandidates,
    dateColumns,
    eventWordHits,
    note:
      'These are signals, not verdicts. More than one distinct date, location or event name usually means more than one ' +
      'campaign, and one campaign wrapped around several events is the expensive mistake. Decide one or several with the person.'
  }
}

// ------------------------------------------------------------------- dedupe

/**
 * Per-row verdicts against what the CRM search returned.
 *
 * `existing` is the normalised search result from `hubspot.searchResults`:
 * contacts keyed by lowercased email, each with its id and the mapped
 * properties. The verdicts:
 *
 *   create   no existing contact carries this email
 *   update   an existing contact does, and the row has values for fields the
 *            existing record leaves blank; only those fields are in the fill
 *   nothing  an existing contact does, and there is nothing blank to fill
 *
 * Never auto-resolved: rows sharing one email inside the list, and matches
 * whose company disagrees with the row's, come back in their own lists for
 * the person. A row with no email cannot be checked at all, and that is
 * reported as exactly that rather than as `create`: unchecked and new are
 * different answers.
 *
 * THE FILL IS BLANKS ONLY, BOTH HERE AND AT THE PORTAL. An update never
 * carries a field the existing record has a value in, so nothing a person
 * or another tool wrote is overwritten. That rule is the reference's most
 * protected refinement and it is enforced at build time, in this function,
 * rather than trusted to review.
 */
function dedupeVerdicts (rows, existing) {
  if (!existing || typeof existing !== 'object' || Array.isArray(existing) ||
      !existing.byEmail || typeof existing.byEmail !== 'object') {
    throw new Error(
      'dedupe needs the judged search results, with contacts under byEmail: the `dedupe` command builds them from ' +
      'the saved responses, and a direct caller uses hubspot.searchResults. ' +
      'Passing the raw responses here would compare against a shape nothing has normalised.'
    )
  }

  // Folded again here, not only at ingest, because enrichment fills emails
  // after ingest as the tool spelled them. Without this, " Ada@X.com " and
  // ada@x.com were two different people to both the in-list check and the
  // match lookup. And an email is text or the rows file is malformed: a
  // coerced one is an identity nothing can match, so it is refused here
  // the same way the search parsers refuse it on the CRM side.
  const foldEmail = value => {
    if (typeof value !== 'string') {
      throw new Error(`A row carries ${JSON.stringify(value)} for an email, not text. The rows file is malformed: save the rows as ingest and enrichment produced them.`)
    }
    return value.trim().toLowerCase()
  }

  // A replaced address is the same person's identity, so it joins the
  // in-list map too: a row still carrying the original, or two rows that
  // replaced the same one, are the same collision a shared current email
  // is. Without this, both rows plan as creates under different current
  // addresses and the portal accepts them both.
  const emails = new Map()
  const addIdentity = (identity, index) => {
    if (!emails.has(identity)) emails.set(identity, [])
    const list = emails.get(identity)
    if (!list.includes(index)) list.push(index)
  }
  for (const row of rows) {
    const email = row.fields.email && foldEmail(row.fields.email)
    if (email) addIdentity(email, row.index)
    const replaced = row.replacedEmail && foldEmail(row.replacedEmail)
    if (replaced) addIdentity(replaced, row.index)
  }
  const inListDuplicates = [...emails.entries()]
    .filter(([, indexes]) => indexes.length > 1)
    .map(([email, indexes]) => ({ email, rows: indexes }))

  const verdicts = []
  const conflicts = []
  const unchecked = []
  const replacedEmailMatches = []
  const crmAmbiguousMatches = []

  // The blanks-only fill a row would give an existing record: only fields
  // the record leaves blank, persona and owner on the same sourced terms,
  // and never the lead source, which is create-only. One place, because
  // the same computation answers a plain match and each candidate of an
  // ambiguous one.
  const fillAgainst = (row, properties) => {
    const blank = field => {
      const theirs = properties ? properties[field] : undefined
      return theirs === undefined || theirs === null || String(theirs).trim() === ''
    }
    const fill = {}
    for (const [field, value] of Object.entries(row.fields)) {
      if (field === 'email' || field === 'company' || field === 'companyDomain') continue
      if (blank(field)) fill[field] = value
    }
    // Persona and owner join the blanks-only fill on the same terms as every
    // other field: only into a blank, and only carrying a recorded source
    // (the artifact, routing, or an explicit confirmation). Without this, an
    // existing contact with a blank persona stayed blank while the write
    // contract promised the field. The lead source deliberately does not
    // join: it is create-only, because it records where a NEW contact came
    // from.
    if (row.persona && row.personaSource && blank('persona')) fill.persona = row.persona
    if (row.owner && (row.ownerSource === 'routing' || row.ownerSource === 'confirmed') && blank('owner')) fill.owner = row.owner
    return fill
  }

  // A store that holds two contacts under one email (possible on
  // Salesforce, where no uniqueness has been measured) answers a question
  // with a question: which record is this person. Neither record is kept
  // by the search results, and every row on the email is presented here,
  // never auto-resolved. Each candidate record travels with the verdict
  // the row would get against it, so the person's answer, one contactId in
  // `resolutions.chosen`, can be realised as that record's blanks-only
  // update or nothing, never as a create of a third record.
  const ambiguousByEmail = new Map((existing.ambiguousInCrm || []).map(a => [a.email, a]))
  const candidateVerdicts = (row, entry) => (entry.candidates || []).map(candidate => {
    const fill = fillAgainst(row, candidate.properties)
    return Object.keys(fill).length
      ? { contactId: candidate.id, verdict: 'update', fill }
      : { contactId: candidate.id, verdict: 'nothing' }
  })

  for (const row of rows) {
    // A row whose personal address was replaced by an approved enrichment
    // answer keeps the original on `replacedEmail`, and the original is an
    // identity too: a contact stored under it is otherwise an unseen
    // duplicate, because the portal accepts a second record when the
    // emails differ. Presented, never auto-resolved.
    const replaced = row.replacedEmail && foldEmail(row.replacedEmail)
    if (replaced && ambiguousByEmail.has(replaced)) {
      const entry = ambiguousByEmail.get(replaced)
      crmAmbiguousMatches.push({
        index: row.index,
        email: replaced,
        contactIds: entry.contactIds,
        candidates: candidateVerdicts(row, entry),
        why: 'The CRM holds more than one contact under the address this row replaced. Which record is this person is a judgment, presented and never auto-resolved: choose one by contactId, or exclude the row.'
      })
    }
    if (replaced && existing.byEmail[replaced]) {
      replacedEmailMatches.push({
        index: row.index,
        replacedEmail: replaced,
        contactId: existing.byEmail[replaced].id,
        why:
          'The CRM holds a contact under the address this row replaced. Pushing the row as it stands would create a ' +
          'second record for the same person under the new address. Presented, never auto-resolved.'
      })
    }

    const email = row.fields.email && foldEmail(row.fields.email)
    if (!email) {
      unchecked.push({
        index: row.index,
        why: 'The row has no email, and the dedupe check matches by email, so whether this person is already in the CRM is unknown. Unknown and new are different answers, and this row needs a decision.'
      })
      continue
    }
    if (ambiguousByEmail.has(email)) {
      const entry = ambiguousByEmail.get(email)
      crmAmbiguousMatches.push({
        index: row.index,
        email,
        contactIds: entry.contactIds,
        candidates: candidateVerdicts(row, entry),
        why: 'The CRM holds more than one contact under this email. A create would add a third and an update would pick one, so which record is this person is presented, never auto-resolved: choose one by contactId, or exclude the row.'
      })
      continue
    }
    const match = existing.byEmail[email]
    if (!match) {
      verdicts.push({ index: row.index, verdict: 'create' })
      continue
    }

    const theirCompany = (match.properties && match.properties.company) || ''
    const ourCompany = row.fields.company || ''
    if (theirCompany && ourCompany && rules.foldCompany(theirCompany) !== rules.foldCompany(ourCompany)) {
      conflicts.push({
        index: row.index,
        email,
        contactId: match.id,
        listSays: ourCompany,
        crmSays: theirCompany,
        why: 'The list and the CRM disagree about this person\'s company. Presented, never auto-resolved.'
      })
    }

    const fill = fillAgainst(row, match.properties)
    if (Object.keys(fill).length) {
      verdicts.push({ index: row.index, verdict: 'update', contactId: match.id, fill })
    } else {
      verdicts.push({
        index: row.index,
        verdict: 'nothing',
        contactId: match.id,
        why: 'Already in the CRM with every field this row carries already filled. Nothing to write.'
      })
    }
  }

  return { verdicts, inListDuplicates, conflicts, unchecked, replacedEmailMatches, crmAmbiguousMatches }
}

// ------------------------------------------------------------ the assembly

/**
 * The whole plan, assembled from decided inputs, or a refusal naming what is
 * not decided yet.
 *
 * Everything here has already been shown to the person once at its own step.
 * What this adds is the cross-checks only the assembly can make (every
 * approved row has a company decision and a campaign assignment; the
 * lead-source value and the mapped property exist together or not at all)
 * and the one document the confirmation gate shows in full.
 *
 * `companyDecisions` is the person's answers to the matching step:
 *   { "<canonical company name>": {"decision": "match", "companyId": "..."}
 *   | {"decision": "create", "website": "..."} }
 * A company the rows name that has no decision is a refusal, because the
 * floor says no contact is pushed without its company matched or planned.
 *
 * `listDecisions` is the judged list lookups, keyed by realised list name:
 *   { "<list name>": {"outcome": "exists", "listId": "..."}
 *   | {"outcome": "absent"} }
 * A name with no judged lookup is a refusal: matched or planned for
 * creation means the portal was asked, not assumed.
 *
 * `resolutions` carries the person's answers to what dedupe presented:
 *   { "excluded": [{"index": n, "why": "..."}], "decided": [n, ...],
 *     "chosen": [{"index": n, "contactId": "..."}] }
 * `excluded` removes a row from the plan with its reason kept. `decided`
 * marks a row the person looked at and kept as it is. Every in-list
 * duplicate has to end with all but one of its rows excluded, or every kept
 * row marked decided when keeping several is deliberate. Every no-email row
 * and every company conflict has to be excluded or decided by index, so
 * nothing dedupe surfaced can fall between the steps unseen.
 *
 * `chosen` answers a CRM ambiguity, a store holding more than one contact
 * under one of the row's addresses, by naming which of the presented
 * candidates the row is. The row then proceeds as that record's blanks-only
 * update, or as nothing when there is nothing blank to fill, and it wins
 * over any verdict the row's other address earned. A bare `decided` cannot
 * answer this question: the question is which record, `decided` names none,
 * and reading it as permission to create planned a third record under an
 * email the CRM already holds twice. An ambiguous row is chosen or
 * excluded, never created.
 */
function assemble (input) {
  if (input.config === undefined || input.config === null) {
    throw new Error('The plan cannot be assembled without config: the plugin config. Run that step first.')
  }
  const crm = configModule.crmOf(input.config)
  const required = [
    ['rows', 'the ingested rows after aliases and gates'],
    ['events', 'the multi-event check output; it is mandatory before campaign setup'],
    ['dedupe', 'the dedupe verdicts'],
    ['grid', 'the member-status grid artifact'],
    ['requiredFields', 'the required-fields rule'],
    ['campaigns', 'the campaigns the person decided after the multi-event check'],
    ['assignments', 'the per-row campaign and status assignments'],
    ['companyDecisions', 'the person\'s match-or-create decision per company']
  ]
  // The grid realises differently per backend, so what has to have been
  // asked of the store differs too: lists on HubSpot, campaigns and their
  // member-status rows on Salesforce, where the flag read rides along
  // because campaign creation is refused while it is off.
  if (crm === 'salesforce') {
    required.push(
      ['campaignDecisions', 'the judged campaign lookups: which campaigns already exist and which will be created'],
      ['campaignStatuses', 'the judged status reads for the campaigns that exist, keyed by campaign name'],
      ['marketingUser', 'the judged Marketing User flag read ({userId, on})']
    )
  } else {
    required.push(['listDecisions', 'the judged list lookups: which of the grid\'s lists already exist and which will be created'])
  }
  for (const [key, why] of required) {
    if (input[key] === undefined || input[key] === null) {
      throw new Error(`The plan cannot be assembled without ${key}: ${why}. Run that step first.`)
    }
  }
  if (input.events.checked !== true) {
    throw new Error('The multi-event check has not run, and campaign setup without it is the expensive mistake. Run `events` first.')
  }

  const problems = []

  // AN INCOMPLETE SEARCH BLOCKS THE PLAN. A paged dedupe response means
  // contacts were withheld, and a withheld contact is a duplicate the plan
  // would confirm as new. Reporting it and planning anyway would be the
  // report absolving the plan.
  for (const incomplete of (input.dedupe.searchIncomplete || [])) {
    problems.push(`Dedupe search response ${incomplete.response} was incomplete: ${incomplete.why} Re-run the search until it is whole before planning.`)
  }
  const grid = input.grid
  const wrongGrid = rules.gridProblems(grid)
  if (wrongGrid.length) problems.push(...wrongGrid)

  const wrongAssignments = wrongGrid.length ? [] : rules.assignmentProblems(grid, input.campaigns, input.assignments)
  problems.push(...wrongAssignments)

  // The lead source needs both halves: the artifact's value and a mapped
  // property. One without the other is a rule that silently cannot run.
  const leadSourceProperty = input.config.properties.contact.leadSource
  const leadSourceValue = input.requiredFields.leadSourceValue
  if (leadSourceValue && !leadSourceProperty) {
    problems.push('The required-fields artifact gives a lead-source value and config maps no leadSource property, so it cannot be written. Map the property or take the value out.')
  }
  if (leadSourceProperty && !leadSourceValue) {
    problems.push('Config maps a leadSource property and the required-fields artifact gives no value for it. Fill the artifact or unmap the property.')
  }

  const resolutions = input.resolutions || {}
  const excluded = new Map((resolutions.excluded || []).map(entry => [entry.index, entry.why || 'excluded by the person']))
  const decided = new Set(resolutions.decided || [])
  const chosen = new Map((resolutions.chosen || []).map(entry => [entry.index, entry]))

  // The candidates each ambiguous row was presented, by index: the union
  // across its entries, because a row can be ambiguous under its current
  // and its replaced address at once and one answer names the person.
  const ambiguousCandidates = new Map()
  for (const match of (input.dedupe.crmAmbiguousMatches || [])) {
    if (!ambiguousCandidates.has(match.index)) ambiguousCandidates.set(match.index, [])
    ambiguousCandidates.get(match.index).push(...(match.candidates || []))
  }
  // A chosen answer has to answer a question that was asked, with a
  // candidate that was presented: anything else is a smuggled verdict.
  for (const [index, pick] of chosen.entries()) {
    const candidates = ambiguousCandidates.get(index)
    if (!candidates) {
      problems.push(`Row ${index} has a chosen contactId and no CRM ambiguity to answer. \`chosen\` answers only the ambiguities dedupe presented.`)
    } else if (!candidates.length) {
      problems.push(
        `Row ${index} is chosen and its ambiguity carries no candidate records to realise the choice against. ` +
        'Re-run dedupe from the saved search responses so each candidate travels with its verdict.'
      )
    } else if (!pick || !candidates.some(c => c.contactId === String(pick.contactId))) {
      problems.push(
        `Row ${index} is chosen as contact ${JSON.stringify(pick && pick.contactId)} and the presented candidates are ` +
        `${candidates.map(c => c.contactId).join(', ')}. A choice names one of them.`
      )
    }
  }

  // THE GATE RUNS AGAIN HERE, ON WHAT IS ACTUALLY IN THE PLAN. It ran
  // earlier in the conversation, but the assembly cannot know that, and a
  // plan input built without it would push a row with no last name or an
  // enriched value that names no source. A refused row leaves the plan as an
  // exclusion or blocks it here by name.
  for (const refusal of gate(input.rows.filter(row => !excluded.has(row.index)), input.requiredFields).refused) {
    problems.push(`Row ${refusal.index} fails the gate: ${refusal.gaps.join('; ')}. Fix the source, or exclude the row with its reason.`)
  }

  for (const duplicate of input.dedupe.inListDuplicates || []) {
    const kept = duplicate.rows.filter(index => !excluded.has(index))
    // THE DECISION IS ASKED OF THE KEPT ROWS, NOT THE ORIGINAL GROUP. This
    // used to require every row of the group in `decided`, including the
    // excluded ones, so excluding one of three and deliberately keeping two
    // was blocked by the exclusion itself: the excluded row is decided BY
    // being excluded, and demanding it twice made the valid resolution
    // impossible.
    if (kept.length > 1 && !kept.every(index => decided.has(index))) {
      problems.push(
        `Rows ${duplicate.rows.join(', ')} share the email ${duplicate.email} and more than one is still in the plan. ` +
        'Exclude all but one, or mark every kept row decided if keeping several is deliberate.'
      )
    }
  }
  for (const entry of (input.dedupe.unchecked || [])) {
    if (!excluded.has(entry.index) && !decided.has(entry.index)) {
      problems.push(`Row ${entry.index} could not be dedupe-checked (${entry.why}) and nobody has decided it. Decide it or exclude it.`)
    }
  }
  for (const conflict of (input.dedupe.conflicts || [])) {
    if (!excluded.has(conflict.index) && !decided.has(conflict.index)) {
      problems.push(
        `Row ${conflict.index}: the list says "${conflict.listSays}" and the CRM says "${conflict.crmSays}", and nobody has ` +
        'decided it. Cross-company conflicts are always presented, never auto-resolved.'
      )
    }
  }
  for (const match of (input.dedupe.replacedEmailMatches || [])) {
    if (!excluded.has(match.index) && !decided.has(match.index)) {
      problems.push(
        `Row ${match.index}: the CRM already holds a contact (id ${match.contactId}) under the address this row replaced ` +
        `(${match.replacedEmail}), and nobody has decided it. A replaced address's own match is presented, never auto-resolved.`
      )
    }
  }
  // A CRM ambiguity is answered by choosing a record or excluding the row.
  // `decided` deliberately does not unblock it: the question is which
  // record this person is, `decided` names none, and reading it as
  // permission planned a create, a third record under an email the CRM
  // already holds twice, which is the exact thing the presentation exists
  // to prevent.
  for (const match of (input.dedupe.crmAmbiguousMatches || [])) {
    if (!excluded.has(match.index) && !chosen.has(match.index)) {
      problems.push(
        `Row ${match.index}: the CRM holds more than one contact under ${match.email} ` +
        `(ids ${(match.contactIds || []).join(', ')}), and nobody has chosen which record this person is. ` +
        'Choose one by contactId in resolutions.chosen, or exclude the row: a create would add a third record, ' +
        'so marking it decided is not an answer here.'
      )
    }
  }

  // THE FREE-MAIL RULE IS ENFORCED WHERE THE PLAN IS ASSEMBLED, the same
  // way the gate is: the detector presents in conversation, and a row
  // still flagged here has been neither removed nor enriched. Decided is
  // the person keeping the personal address, deliberately. Without this,
  // the rule lived only in the conversation, and an otherwise valid plan
  // pushed the address the rule exists to keep out.
  for (const flagged of rules.freeMailRows(input.rows.filter(row => !excluded.has(row.index)))) {
    if (!decided.has(flagged.index)) {
      problems.push(
        `Row ${flagged.index} carries the personal address ${flagged.email} (${flagged.domain}) and nobody has decided it. ` +
        'The rule is removed, or enriched to a work address; keeping the personal address is a decision, not a default.'
      )
    }
  }

  const verdictByIndex = new Map((input.dedupe.verdicts || []).map(v => [v.index, v]))
  const assignmentsByIndex = new Map()
  for (const assignment of input.assignments) {
    if (!assignmentsByIndex.has(assignment.index)) assignmentsByIndex.set(assignment.index, [])
    assignmentsByIndex.get(assignment.index).push(assignment)
  }

  const contacts = { creates: [], updates: [], nothing: [], excluded: [] }
  const companiesNeeded = new Map()
  const memberships = new Map()
  const nameToPair = new Map()

  // THE FILL IS PROVED AGAINST THE GATED ROW, ENTRY BY ENTRY. Verdicts and
  // candidates arrive as caller input, so a fill is a claim, not a fact:
  // without this check a hand-edited fill could smuggle a value the row
  // never carried, or a lead source onto an update, past a gate that only
  // ever saw the rows. Each entry has to be the row's own sourced value,
  // or its persona or owner with the source the design demands.
  const proveFill = (row, fill) => {
    for (const [field, value] of Object.entries(fill || {})) {
      const fromFields = row.fields[field] === value && Boolean(row.fieldSources && row.fieldSources[field])
      const fromPersona = field === 'persona' && row.persona === value && Boolean(row.personaSource)
      const fromOwner = field === 'owner' && row.owner === value &&
        (row.ownerSource === 'routing' || row.ownerSource === 'confirmed')
      if (!fromFields && !fromPersona && !fromOwner) {
        problems.push(
          `Row ${row.index}: the update fill carries ${field} = ${JSON.stringify(value)}, which is not the row's own ` +
          'sourced value. A fill is derived from the gated row, never supplied beside it, and the lead source never ' +
          'rides on an update.'
        )
      }
    }
  }

  for (const row of input.rows) {
    if (excluded.has(row.index)) {
      contacts.excluded.push({ index: row.index, why: excluded.get(row.index) })
      continue
    }

    const verdict = verdictByIndex.get(row.index)
    const candidates = ambiguousCandidates.get(row.index)
    let isCreate = false
    if (candidates) {
      // An ambiguous row proceeds only as its chosen candidate, winning
      // over any verdict the row's other address earned. The blocking and
      // the pick's validation live above, so a row without a valid choice
      // already has its problem named and is skipped here.
      const pick = chosen.get(row.index)
      const candidate = pick && candidates.find(c => c.contactId === String(pick.contactId))
      if (!candidate) continue
      if (candidate.verdict === 'update') {
        proveFill(row, candidate.fill)
        contacts.updates.push({ index: row.index, row, contactId: candidate.contactId, fill: candidate.fill })
      } else {
        contacts.nothing.push({
          index: row.index,
          contactId: candidate.contactId,
          why: 'Chosen as this record, with every field this row carries already filled. Nothing to write.'
        })
      }
    } else if (!verdict) {
      if (!decided.has(row.index)) {
        problems.push(`Row ${row.index} has no dedupe verdict and no decision. Every row in the plan has been through dedupe or past the person.`)
        continue
      }
      // A decided no-email row proceeds as a create the person chose, and the
      // plan says so rather than folding it in quietly.
      contacts.creates.push({ index: row.index, row, decidedWithoutDedupe: true })
      isCreate = true
    } else if (verdict.verdict === 'create') {
      contacts.creates.push({ index: row.index, row })
      isCreate = true
    } else if (verdict.verdict === 'update') {
      proveFill(row, verdict.fill)
      contacts.updates.push({ index: row.index, row, contactId: verdict.contactId, fill: verdict.fill })
    } else {
      contacts.nothing.push({ index: row.index, contactId: verdict.contactId, why: verdict.why })
    }

    // Only a create needs the company decision. An update fills blanks on a
    // contact the CRM already holds, whose associations are the CRM's own
    // and are left alone by the blanks-only rule, and a nothing row writes
    // nothing at all. The write contract states this scoping in as many
    // words.
    if (isCreate) {
      const company = row.fields.company
      if (!company) {
        problems.push(`Row ${row.index} has no company and is planned as a create. No contact is created without its company matched or planned.`)
      } else {
        if (!companiesNeeded.has(company)) companiesNeeded.set(company, { rows: [], domain: null })
        const entry = companiesNeeded.get(company)
        entry.rows.push(row.index)
        if (!entry.domain && row.fields.companyDomain) entry.domain = row.fields.companyDomain
      }
    }

    const rowAssignments = assignmentsByIndex.get(row.index) || []
    if (!rowAssignments.length) {
      problems.push(`Row ${row.index} has no campaign and status assignment. Every row in the plan lands on the memberships the grid names.`)
    }
    for (const assignment of rowAssignments) {
      const campaign = input.campaigns.find(c => c.name === assignment.campaign)
      if (!campaign) continue // already reported by assignmentProblems
      if (crm === 'salesforce') {
        // The campaign and status pair is the membership's native identity
        // on this backend, so there is no realised name to collide.
        const key = `${assignment.campaign}␟${assignment.status}`
        if (!memberships.has(key)) memberships.set(key, [])
        memberships.get(key).push(row.index)
        continue
      }
      const name = wrongGrid.length ? null : rules.listName(grid, assignment.campaign, assignment.status)
      if (name === null) continue
      // TWO PAIRS REALISING ONE NAME IS A COLLISION, NOT A MERGE. The grid's
      // template can make campaign "A" with status "B - C" and campaign
      // "A - B" with status "C" spell the same list, and merging them
      // silently mixes two campaigns' members.
      const pair = `${assignment.campaign}␟${assignment.status}`
      if (!nameToPair.has(name)) nameToPair.set(name, pair)
      else if (nameToPair.get(name) !== pair) {
        const [otherCampaign, otherStatus] = nameToPair.get(name).split('␟')
        problems.push(
          `The grid's naming convention gives one list name, "${name}", to two different assignments: ` +
          `"${otherCampaign}" with status "${otherStatus}" and "${assignment.campaign}" with status "${assignment.status}". ` +
          'Their members would silently merge. The campaign names or the convention have to change.'
        )
        continue
      }
      if (!memberships.has(name)) memberships.set(name, [])
      memberships.get(name).push(row.index)
    }
  }

  // Fields that carry judgment need a mapped property to land in, or they
  // are silently lost between the plan and the payload. The same
  // both-halves rule the lead source already follows.
  for (const row of input.rows) {
    if (excluded.has(row.index)) continue
    if (row.owner && (row.ownerSource === 'routing' || row.ownerSource === 'confirmed') && !input.config.properties.contact.owner) {
      problems.push(`Row ${row.index} carries a confirmed owner and config maps no owner property, so it would be silently lost. Map properties.contact.owner, or take the owner off the row.`)
    }
    if (row.persona && row.personaSource && !input.config.properties.contact.persona) {
      problems.push(`Row ${row.index} carries a persona from the artifact and config maps no persona property, so it would be silently lost. Map properties.contact.persona, or skip the persona step.`)
    }
  }

  const companies = { creates: [], matched: [], undecided: [] }

  /**
   * An adoption fill on a matched company: the person's decision, made
   * against the shown candidate (an empty name included), carried in the
   * plan so the push executes it and the proof compares it. The keys are
   * the write contract's own company fields and nothing else, and a
   * website fill follows the same mapped-or-refused rule the create's
   * website does. Blanks-only is grounded in the decision itself: the
   * candidate's evidence showed what was empty, and the read-back proof
   * shows what landed.
   */
  const fillProblems = (name, fill) => {
    for (const [key, value] of Object.entries(fill)) {
      if (key !== 'name' && key !== 'website') {
        problems.push(`"${name}" is adopted with a fill for ${key}, and a company fill carries only name and website, the write contract's own company fields.`)
      } else if (typeof value !== 'string' || !value.trim()) {
        // An empty value in a PATCH is a clear, not a fill: the portal was
        // measured (2026-08-25) reading a property back empty after an
        // empty-string write. A fill that would erase is refused.
        problems.push(`"${name}" is adopted with an empty ${key} fill, and the portal reads an empty PATCH value as a clear, not a fill. A fill carries a non-empty value or is left out.`)
      }
    }
    if (fill.website !== undefined && !input.config.properties.company.website) {
      problems.push(`"${name}" is adopted with a website fill and config maps no company website property, so it would be silently lost. Map properties.company.website, or take the website out of the fill.`)
    }
  }

  for (const [name, needed] of companiesNeeded.entries()) {
    const decision = input.companyDecisions[name]
    if (!decision || (decision.decision !== 'match' && decision.decision !== 'create')) {
      companies.undecided.push({ name, rows: needed.rows })
      problems.push(`"${name}" has no match-or-create decision, and rows ${needed.rows.join(', ')} need it before they can be pushed.`)
    } else if (decision.decision === 'match') {
      if (!decision.companyId) {
        problems.push(`"${name}" is decided as a match with no companyId. A match names the record it matched.`)
      } else {
        const entry = { name, companyId: String(decision.companyId), rows: needed.rows }
        if (decision.fill && Object.keys(decision.fill).length) {
          fillProblems(name, decision.fill)
          entry.fill = decision.fill
        }
        companies.matched.push(entry)
      }
    } else {
      // The write contract: a created company carries the website when the
      // list has a domain. The decision's explicit website wins; the rows'
      // own domain is the fallback, and it fires only when config maps a
      // website property, because an org without one imports its companies
      // bare and an automatic fallback is not a person's input to lose. An
      // EXPLICIT website with nowhere to land is a different case and is
      // refused below.
      const websiteMapped = Boolean(input.config.properties.company.website)
      companies.creates.push({
        name,
        website: decision.website || (websiteMapped ? needed.domain : null) || null,
        rows: needed.rows
      })
    }
  }

  // The same silently-lost rule the owner and persona follow, scoped to
  // what a person actually supplied: a website the DECISION names with
  // nowhere mapped to land is refused, while the automatic domain fallback
  // simply does not fire without a mapping and the company is created bare.
  for (const [name, decision] of Object.entries(input.companyDecisions)) {
    if (decision && decision.decision === 'create' && decision.website &&
        !input.config.properties.company.website && companiesNeeded.has(name)) {
      problems.push(
        `"${name}" is decided as a create with a website, and config maps no company website property, so it would be ` +
        'silently lost. Map properties.company.website, or take the website off the decision and create the company bare.'
      )
    }
  }

  // An adoption can belong to no create at all. The run that taught this
  // (2026-08-26) adopted the portal's nameless company while the only row
  // on it was an update, which needs no company decision, so the promised
  // name fill had no vehicle in the plan and ran as a write beside it. A
  // matched decision carrying a fill is part of the plan whether or not a
  // create needs the company.
  for (const [name, decision] of Object.entries(input.companyDecisions)) {
    if (companiesNeeded.has(name)) continue
    if (!decision || decision.decision !== 'match' || !decision.fill || !Object.keys(decision.fill).length) continue
    if (!decision.companyId) {
      problems.push(`"${name}" is decided as a match with no companyId. A match names the record it matched.`)
      continue
    }
    fillProblems(name, decision.fill)
    companies.matched.push({ name, companyId: String(decision.companyId), rows: [], fill: decision.fill })
  }

  // The memberships' store side: matched, or planned for creation, which
  // needs the store to have been asked. On HubSpot that is the status
  // lists; on Salesforce it is the campaigns, their existing member-status
  // rows, and the Marketing User flag, because campaign creation is
  // refused while the flag is off (measured 2026-08-25). Either way, a
  // name with no judged lookup blocks, because creating without looking is
  // how a second copy of an existing record appears beside the first.
  const lists = { creates: [], matched: [] }
  const campaignMemberships = { campaigns: { creates: [], matched: [] }, statuses: { creates: [] }, members: [], userFlagFix: null }
  if (crm === 'salesforce') {
    const statusesUsed = new Map()
    for (const key of memberships.keys()) {
      const [campaignName, status] = key.split('␟')
      if (!statusesUsed.has(campaignName)) statusesUsed.set(campaignName, [])
      if (!statusesUsed.get(campaignName).includes(status)) statusesUsed.get(campaignName).push(status)
    }
    for (const campaignName of [...statusesUsed.keys()].sort()) {
      const decision = input.campaignDecisions[campaignName]
      const campaign = input.campaigns.find(c => c.name === campaignName)
      if (!decision || (decision.outcome !== 'exists' && decision.outcome !== 'absent')) {
        problems.push(`The campaign "${campaignName}" has no judged lookup (outcome exists or absent). Run campaign-queries, send the lookups, judge each response, and pass the outcomes by name.`)
        continue
      }
      if (decision.outcome === 'exists') {
        if (!decision.campaignId) {
          problems.push(`The campaign "${campaignName}" is judged as existing with no campaignId. A match names the record it matched.`)
          continue
        }
        campaignMemberships.campaigns.matched.push({ name: campaignName, campaignId: String(decision.campaignId) })
        // The read is validated to its entries, not its shape alone: a
        // label that is not a non-empty string can never match a grid
        // status, so every status would plan as a blind create beside
        // rows that exist, the exact thing the read prevents.
        const read = input.campaignStatuses[campaignName]
        if (!read || !Array.isArray(read.labels) ||
            read.labels.some(label => typeof label !== 'string' || !label.trim()) ||
            typeof read.maxSortOrder !== 'number' || !Number.isFinite(read.maxSortOrder)) {
          problems.push(
            `The campaign "${campaignName}" exists and its member-status rows have not been read, or the read is malformed ` +
            '({labels: the status names as non-empty text, maxSortOrder: a number}). ' +
            'Run status-queries and status-judge: planning a status create without looking is how a second copy appears.'
          )
          continue
        }
        statusesUsed.get(campaignName)
          .filter(status => !read.labels.includes(status))
          .forEach((status, at) => {
            campaignMemberships.statuses.creates.push({ campaign: campaignName, label: status, sortOrder: read.maxSortOrder + at + 1 })
          })
      } else {
        campaignMemberships.campaigns.creates.push({ name: campaignName, type: campaign ? campaign.type : null })
        // A fresh campaign carries Sent, the default, and Responded
        // (measured 2026-08-25), so those two are never planned as creates.
        statusesUsed.get(campaignName)
          .filter(status => status !== 'Sent' && status !== 'Responded')
          .forEach((status, at) => {
            campaignMemberships.statuses.creates.push({ campaign: campaignName, label: status, sortOrder: 2 + at + 1 })
          })
      }
    }
    campaignMemberships.members = [...memberships.entries()].map(([key, rowIndexes]) => {
      const [campaignName, status] = key.split('␟')
      return { campaign: campaignName, status, rows: rowIndexes.sort((a, b) => a - b) }
    }).sort((a, b) => (a.campaign + a.status).localeCompare(b.campaign + b.status))

    // THE FIX IS SCOPED TO THE MEASURED REFUSAL. What is measured is
    // campaign CREATION refused while the flag is off; whether member and
    // status writes are refused too is unmeasured, so they do not justify
    // a privileged User write, and if the org refuses one of them the
    // push's own per-record report says so.
    if (campaignMemberships.campaigns.creates.length) {
      const flag = input.marketingUser
      if (!flag || typeof flag.on !== 'boolean' || !flag.userId) {
        problems.push(
          'The Marketing User flag has not been read ({userId, on}). Campaign creation is refused while it is off ' +
          '(measured 2026-08-25), so a plan that creates a campaign is not assembled without the flag read. ' +
          'Run flag-query and flag-judge.'
        )
      } else if (flag.on !== true) {
        // The measured one-call fix rides the plan as its own named line,
        // pushed before the campaign family and proved by reading the flag
        // back. Striking it strikes the campaign half with it, said in the
        // note rather than discovered mid-push.
        campaignMemberships.userFlagFix = { userId: String(flag.userId) }
      }
    }
  } else {
    for (const name of [...memberships.keys()].sort()) {
      const decision = input.listDecisions[name]
      if (!decision || (decision.outcome !== 'exists' && decision.outcome !== 'absent')) {
        problems.push(`The list "${name}" has no judged lookup (outcome exists or absent). Run list-queries, send the lookups, judge each response, and pass the outcomes by name.`)
      } else if (decision.outcome === 'exists') {
        if (!decision.listId) problems.push(`The list "${name}" is judged as existing with no listId. A match names the record it matched.`)
        else lists.matched.push({ name, listId: String(decision.listId) })
      } else {
        lists.creates.push(name)
      }
    }
  }

  // The owner rule, enforced at the door of the plan: an owner on a row is
  // there through routing or explicit confirmation, and says which.
  for (const row of input.rows) {
    if (excluded.has(row.index)) continue
    if (row.owner && row.ownerSource !== 'routing' && row.ownerSource !== 'confirmed') {
      problems.push(`Row ${row.index} carries an owner with no recorded source. An owner comes from a routing artifact or an explicit confirmation, never from a default.`)
    }
  }

  if (problems.length) {
    return { ok: false, problems }
  }

  const writeback = input.rows.some(row => row.notionPageId)
    ? {
        kind: 'notion',
        note: 'The source is Notion, so the run writes back: the created record linked on each source row, and email filled only where the source row is blank. A CSV source is never modified.'
      }
    : { kind: 'none', note: 'The source is a CSV, and a CSV source is never modified.' }

  const assembled = {
    companies: { creates: companies.creates, matched: companies.matched },
    contacts,
    leadSource: leadSourceValue ? { property: leadSourceProperty, value: leadSourceValue } : null,
    writeback,
    note:
      'This plan is the whole of what the push may do. Show it in full, with the exclusions and their reasons, and push ' +
      'only on an explicit yes. The push executes exactly this plan and nothing else.'
  }
  if (crm === 'salesforce') {
    assembled.campaignMemberships = campaignMemberships
    assembled.autoCompanyCreation =
      'No account auto-creation was observed on Salesforce and none is designed for; whether an org\'s own automation ' +
      'creates accounts is unmeasured rather than known absent, so surprises in the read-backs are facts to record, not ' +
      'errors to push past.'
  } else {
    assembled.lists = {
      names: [...memberships.keys()].sort(),
      creates: lists.creates,
      matched: lists.matched,
      memberships: [...memberships.entries()].map(([name, rowIndexes]) => ({ list: name, rows: rowIndexes.sort((a, b) => a - b) }))
    }
    assembled.autoCompanyCreation =
      'This portal may auto-create a company from an email domain and take the primary association (measured 2026-08-25). ' +
      'The plan names that collision rather than resolving it; the setting is not exposed by the documented API (measured 2026-08-26), so naming it is all that can be done.'
  }
  return { ok: true, plan: assembled }
}

module.exports = {
  gate,
  EVENT_WORDS,
  eventSignals,
  dedupeVerdicts,
  assemble
}

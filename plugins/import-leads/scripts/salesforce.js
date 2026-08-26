'use strict'

/**
 * The Salesforce half: every request this plugin sends to a Salesforce org
 * is built here, and every response it acts on is judged here. The skill
 * runs the `sf` CLI; the credential lives in the CLI's keychain under the
 * alias config names, so nothing key-shaped exists anywhere in this flow.
 *
 * THE TRANSPORT, measured 2026-08-26. Queries and deletes go through the
 * data commands (`sf data query --json`). Writes go through
 * `sf api request rest` with a JSON body file, because the data commands'
 * `--values` parser refuses a value carrying an apostrophe in either
 * spelling, and names like O'Brien are ordinary list data. A REST create
 * answers the bare `{id, success, errors}` envelope; a REST PATCH answers
 * HTTP 204 with an empty body, so the read-back is its only proof.
 *
 * WHAT IS MEASURED AND WHAT IS NOT. The surfaces below were measured
 * against a real Developer Edition org on 2026-08-25 and 2026-08-26:
 * creates for Account, Contact (with AccountId as a field on the create),
 * Campaign, CampaignMemberStatus and CampaignMember; SOQL with IN, LIKE
 * (case-insensitive, `_` a wildcard), the `\'` escape and dotted
 * relationship fields arriving nested; partial updates touching only the
 * named field; the campaign-by-name lookup answering an empty result set
 * for an absent name; the member-status read; the Marketing User flag
 * readable and settable; the duplicate member failing individually with
 * the existing row untouched. The dated summaries are in `DECISIONS.md`,
 * and the live acceptance run is what proves the assembled pipeline:
 * nothing here claims to work until it has.
 */

const API = '/services/data/v67.0'

/**
 * A request spec: what to send. The skill composes the CLI call:
 *
 *   query  sf data query --target-org <alias> --query <soql> --json
 *   rest   sf api request rest <path> --method <method> --body @<file>
 *            --target-org <alias>   (the body written to a file first;
 *            no --body flag at all when the spec carries none)
 *   cli    sf <args...> --target-org <alias> --json
 */
function spec (label, shape) {
  return Object.assign({ label }, shape)
}

const query = (label, targetOrg, soql) => spec(label, { transport: 'query', targetOrg, soql })
const rest = (label, targetOrg, method, path, body) => {
  const out = spec(label, { transport: 'rest', targetOrg, method, path })
  if (body !== undefined) out.body = body
  return out
}

/**
 * A SOQL string literal. The apostrophe escape is measured (2026-08-26);
 * the backslash escape is the same rule applied to the escape character
 * itself, or a value ending in a backslash would swallow the closing
 * quote.
 */
const soqlLiteral = value => "'" + String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"

/**
 * The org's field API name for a canonical contact field, from config.
 * Same contract as the HubSpot half: absent optional fields return null
 * and the caller decides whether that is fine or a problem.
 */
const contactField = (config, field) => (config.properties.contact[field] === undefined ? null : config.properties.contact[field])

/** The reverse map, field API name back to canonical, for reading rows. */
function reverseContactMap (config) {
  const back = {}
  for (const [field, name] of Object.entries(config.properties.contact)) {
    back[name] = field
  }
  return back
}

/** Every mapped contact field API name a contact read should ask for. */
function contactFieldNames (config) {
  return [...new Set(Object.values(config.properties.contact))]
}

/** The measured query envelope, or null. `--json` wraps records in result. */
function queryRecords (response) {
  if (response && typeof response === 'object' && response.status === 0 &&
      response.result && Array.isArray(response.result.records)) {
    return response.result
  }
  return null
}

// ------------------------------------------------------------------- search

/** The same reference batch size the HubSpot half carries. */
const SEARCH_BATCH = 100

/**
 * The dedupe searches: SOQL IN on the mapped email field, batched. Each
 * asks for every mapped field plus AccountId and Account.Name, because the
 * blanks-only fill cannot know what is blank without reading what is
 * there, and the cross-company conflict check needs the account's name.
 * The dotted field arrives nested, `Account: {Name}`, measured 2026-08-26.
 */
function searchRequests (config, emails) {
  if (!Array.isArray(emails)) throw new Error('searchRequests needs the list of emails to look for.')
  const unique = [...new Set(
    emails.filter(e => typeof e === 'string' && e.trim()).map(e => e.trim().toLowerCase())
  )]
  const fields = [...new Set(contactFieldNames(config).concat(['Id', 'AccountId', 'Account.Name']))]
  const requests = []
  for (let at = 0; at < unique.length; at += SEARCH_BATCH) {
    const batch = unique.slice(at, at + SEARCH_BATCH)
    requests.push(query(
      `dedupe search ${requests.length + 1}`,
      config.orgAlias,
      `SELECT ${fields.join(', ')} FROM Contact WHERE ${contactField(config, 'email')} IN (${batch.map(soqlLiteral).join(', ')})`
    ))
  }
  return requests
}

/**
 * The search responses, normalised to contacts by lowercased email, the
 * same shape the HubSpot half hands the dedupe. Anything but the measured
 * query envelope is refused: a guess that produces an empty map reads
 * exactly like a CRM with nobody in it, and every row would plan as a
 * create.
 *
 * COMPLETENESS IS REPORTED, NOT ASSUMED. `done` has only ever been seen
 * true; a response carrying `done: false` was cut short, and a contact
 * left unfetched is a duplicate the plan would not see.
 */
function searchResults (config, responses) {
  if (!Array.isArray(responses)) {
    throw new Error('searchResults needs the array of saved query responses, one per request, in order.')
  }
  const back = reverseContactMap(config)
  const byEmail = {}
  const ambiguous = new Map()
  const incomplete = []

  responses.forEach((response, at) => {
    const result = queryRecords(response)
    if (!result) {
      throw new Error(
        `Response ${at + 1} is not the measured query envelope ({status: 0, result: {records}}). ` +
        'Save what the CLI printed, whole. Guessing at another shape would read as a CRM with nobody in it.'
      )
    }
    if (result.done !== true) {
      incomplete.push({ response: at + 1, why: 'The response says done is not true, so records were withheld. A duplicate could be among them.' })
    }
    for (const record of result.records) {
      if (!record || typeof record.Id !== 'string') {
        throw new Error(`Response ${at + 1} holds a record with no Id. Save what the CLI printed.`)
      }
      const properties = {}
      for (const [name, value] of Object.entries(record)) {
        const field = back[name]
        if (field && value !== null && value !== undefined) properties[field] = value
      }
      // The company signal for the conflict check rides under the same
      // canonical name the HubSpot half uses. It is only ever read.
      if (record.Account && typeof record.Account === 'object' && record.Account.Name) {
        properties.company = record.Account.Name
      }
      if (record.AccountId) properties.accountId = String(record.AccountId)
      // An email is text or the record is malformed: String() coercion
      // indexed an object email under its coerced spelling, the row's real
      // address matched nothing, and the row planned as a create, a
      // duplicate on the backend where this search is the whole guard.
      if (properties.email !== undefined && typeof properties.email !== 'string') {
        throw new Error(`Response ${at + 1} holds a record whose email is ${JSON.stringify(properties.email)}, not text. Save what the CLI printed, whole: a coerced email is an identity nothing can match.`)
      }
      const email = properties.email ? properties.email.trim().toLowerCase() : null
      if (!email) continue
      // TWO CRM RECORDS UNDER ONE EMAIL ARE A QUESTION, NOT A PICK. This
      // org enforces no email uniqueness this design has measured, so the
      // ambiguity is real here where HubSpot's portal makes it impossible.
      // Keeping either record would silently decide which person the row
      // is, so neither is kept as the match and the collision is surfaced
      // by email, each candidate carried whole so the person's answer can
      // be realised as that record's blanks-only fill rather than falling
      // through to a create of a third record.
      if (ambiguous.has(email)) {
        const candidates = ambiguous.get(email)
        if (!candidates.some(c => c.id === String(record.Id))) {
          candidates.push({ id: String(record.Id), properties })
        }
        continue
      }
      if (byEmail[email] && byEmail[email].id !== String(record.Id)) {
        ambiguous.set(email, [byEmail[email], { id: String(record.Id), properties }])
        delete byEmail[email]
        continue
      }
      byEmail[email] = { id: String(record.Id), properties }
    }
  })

  return {
    byEmail,
    ambiguousInCrm: [...ambiguous.entries()].map(([email, candidates]) => ({
      email,
      contactIds: candidates.map(c => c.id),
      candidates
    })),
    incomplete,
    found: Object.keys(byEmail).length
  }
}

/**
 * Account lookups for the matching step, one request per company: by name
 * and, wherever a domain is known, by domain against the Website field.
 * LIKE is measured case-insensitive with `%` and `_` as wildcards, so the
 * fetch can only be wider than the question, never narrower; the judge of
 * the candidates is the person, shown the evidence, and a wildcard in a
 * name only adds candidates to decline.
 */
function companySearchRequests (config, companies) {
  if (!Array.isArray(companies)) throw new Error('companySearchRequests needs [{name, domain}] entries.')
  const nameField = config.properties.company.name
  const websiteField = config.properties.company.website
  const fields = ['Id', nameField, websiteField].filter(Boolean)
  const select = `SELECT ${[...new Set(fields)].join(', ')} FROM Account`
  const requests = []
  for (const company of companies) {
    requests.push(query(
      `company search: ${company.name}`,
      config.orgAlias,
      `${select} WHERE ${nameField} LIKE ${soqlLiteral('%' + company.name + '%')} LIMIT 20`
    ))
    // Its own request, never OR-ed into the name search, the same rule the
    // HubSpot half records: a broad name can fill the page and push the
    // domain hit off it. The Website match is deliberately broad (LIKE on
    // the bare domain finds the https://www form, measured 2026-08-26) and
    // the person sees the candidates.
    if (company.domain && websiteField) {
      requests.push(query(
        `company search by domain: ${company.name}`,
        config.orgAlias,
        `${select} WHERE ${websiteField} LIKE ${soqlLiteral('%' + company.domain + '%')} LIMIT 20`
      ))
    }
  }
  return requests
}

// -------------------------------------------------------------------- writes

/**
 * The REST body for a contact create. Only fields that name a source,
 * enforced here as well as at the gate; the lead source goes on creates
 * only; persona and owner only when config maps a field and the value
 * names its source. The AccountId is added by the push, because only the
 * push knows whether it is a matched id or a token, and the record-type
 * id rides along when config carries one.
 */
function contactCreateBody (config, row, leadSource) {
  const body = {}
  for (const [field, value] of Object.entries(row.fields)) {
    if (field === 'company' || field === 'companyDomain') continue
    if (!(row.fieldSources && row.fieldSources[field])) continue
    const name = contactField(config, field)
    if (!name) continue
    body[name] = value
  }
  if (row.persona && row.personaSource && contactField(config, 'persona')) {
    body[contactField(config, 'persona')] = row.persona
  }
  if (row.owner && (row.ownerSource === 'routing' || row.ownerSource === 'confirmed') && contactField(config, 'owner')) {
    body[contactField(config, 'owner')] = row.owner
  }
  if (leadSource) body[leadSource.property] = leadSource.value
  if (config.recordTypeIds && config.recordTypeIds.contact) body.RecordTypeId = config.recordTypeIds.contact
  return body
}

/** The blanks-only fill as a REST PATCH body. Same field set as HubSpot's. */
const UPDATE_FIELDS = new Set([
  'firstName', 'lastName', 'phone', 'title', 'city', 'state', 'country', 'linkedinUrl', 'persona', 'owner'
])

function contactUpdateBody (config, fill) {
  const body = {}
  for (const [field, value] of Object.entries(fill)) {
    if (!UPDATE_FIELDS.has(field)) continue
    const name = contactField(config, field)
    if (!name) continue
    body[name] = value
  }
  return body
}

// -------------------------------------------- campaigns, statuses, the flag

/**
 * The campaign lookups: matched, or planned for creation, which means
 * asking the org before planning a create. One exact-name query per
 * campaign; the by-name lookup and its empty answer for an absent name
 * are both measured (2026-08-26).
 */
function campaignLookupRequests (config, campaigns) {
  if (!Array.isArray(campaigns)) throw new Error('campaignLookupRequests needs the campaigns the person decided.')
  return campaigns.map(campaign => query(
    `campaign lookup: ${campaign.name}`,
    config.orgAlias,
    `SELECT Id, Name FROM Campaign WHERE Name = ${soqlLiteral(campaign.name)}`
  ))
}

/**
 * What a saved campaign lookup means. One row carrying the asked-for name
 * is a match with its id; an empty result set is the measured absent
 * answer and plans a create; two or more rows is a question, because
 * picking between two campaigns with one name is a judgment; anything
 * else is a question too, because reading an unrecognised answer as
 * absent is how a second copy of an existing campaign appears beside the
 * first.
 *
 * THE ANSWER IS BOUND TO ITS QUESTION BY THE NAME IT CARRIES, not by the
 * order the files were passed in. Responses judged by position alone let
 * two reversed saves file each campaign's id under the other one, and
 * every membership would then land on the wrong campaign.
 */
function judgeCampaignLookup (response, expectedName) {
  const result = queryRecords(response)
  if (!result) {
    return { outcome: 'unknown', why: 'The response is not the measured query envelope, so its meaning is not known here. Reading it as absent would create a duplicate campaign.' }
  }
  if (result.done !== true) {
    return { outcome: 'unknown', why: 'The response says done is not true, so records were withheld. Absence cannot be read from an incomplete answer.' }
  }
  if (result.records.length === 1) {
    const record = result.records[0]
    if (typeof record.Id !== 'string' || !record.Id) {
      return { outcome: 'unknown', why: 'The row carries no Id, so there is nothing to match against. Save the response whole and look at it.' }
    }
    // The Name is the binding, so a malformed one is refused before it is
    // compared: String() coercion here read a null or an object as a name
    // and judged the binding on the coerced spelling, the wrong-type fault
    // the status judge refuses.
    if (typeof record.Name !== 'string' || !record.Name.trim()) {
      return { outcome: 'unknown', why: `The row carries ${JSON.stringify(record.Name === undefined ? null : record.Name)} for its Name, which is not a campaign name. Save the response whole and look at it.` }
    }
    if (expectedName !== undefined && record.Name !== String(expectedName)) {
      return {
        outcome: 'unknown',
        why: `The row is named ${JSON.stringify(record.Name)} where ${JSON.stringify(String(expectedName))} was asked for, so this response answers a different campaign's lookup. The saved files are out of order.`
      }
    }
    return { outcome: 'exists', campaignId: String(record.Id) }
  }
  if (result.records.length === 0) {
    return { outcome: 'absent' }
  }
  return {
    outcome: 'unknown',
    why: `The org holds ${result.records.length} campaigns with this exact name. Which one the memberships belong on is the person's call, decided by id.`
  }
}

/**
 * The member-status reads for the campaigns that already exist. What a
 * fresh campaign carries (Sent, the default, and Responded) is measured;
 * these reads are what tell a matched campaign's actual rows.
 */
function statusReadRequests (config, campaignDecisions) {
  if (!campaignDecisions || typeof campaignDecisions !== 'object' || Array.isArray(campaignDecisions)) {
    throw new Error('statusReadRequests needs the judged campaign decisions, keyed by campaign name.')
  }
  const requests = []
  for (const [name, decision] of Object.entries(campaignDecisions)) {
    if (!decision || decision.outcome !== 'exists') continue
    // CampaignId is selected so the answer carries its own question: the
    // judge binds each row to the campaign it was asked about, the same
    // rule the campaign lookup holds by Name, or two reversed saved files
    // credit each campaign with the other's statuses.
    requests.push(query(
      `status read: ${name}`,
      config.orgAlias,
      `SELECT Id, Label, SortOrder, IsDefault, HasResponded, CampaignId FROM CampaignMemberStatus WHERE CampaignId = ${soqlLiteral(decision.campaignId)}`
    ))
  }
  return requests
}

/**
 * The labels a campaign's status read holds, with the highest SortOrder.
 *
 * THE ANSWER IS BOUND TO ITS QUESTION BY THE CampaignId ITS ROWS CARRY,
 * not by the order the files were passed in: responses judged by position
 * alone let two reversed saves credit each campaign with the other one's
 * statuses, planning a duplicate of a row that exists and omitting the one
 * that does not. An empty answer carries nothing to bind, and needs
 * nothing: swapping it with another empty answer changes no reading, and
 * swapping it with a non-empty one puts rows under the wrong campaign,
 * which is refused here, so the caller judging the whole batch stops
 * before any misfiled reading reaches a plan.
 */
function judgeStatusRead (response, expectedCampaignId) {
  const result = queryRecords(response)
  if (!result) {
    return { ok: false, why: 'The response is not the measured query envelope. A guessed status list would plan creates beside rows that already exist.' }
  }
  if (result.done !== true) {
    return { ok: false, why: 'The response says done is not true, so status rows were withheld, and a withheld row is a duplicate the plan would create beside.' }
  }
  // A malformed row is refused rather than read: a null Label becoming the
  // string "null" and a wordy SortOrder becoming 0 would plan creates
  // beside rows that exist, which is the exact thing this read prevents.
  for (const record of result.records) {
    if (typeof record.Label !== 'string' || !record.Label.trim()) {
      return { ok: false, why: `A status row carries ${JSON.stringify(record.Label)} for its Label, which is not a status name. Save the response whole and look at it.` }
    }
    if (typeof record.SortOrder !== 'number' || !Number.isFinite(record.SortOrder)) {
      return { ok: false, why: `The status row ${JSON.stringify(record.Label)} carries ${JSON.stringify(record.SortOrder)} for its SortOrder, which is not a number. Save the response whole and look at it.` }
    }
    if (expectedCampaignId !== undefined) {
      if (typeof record.CampaignId !== 'string' || !record.CampaignId) {
        return { ok: false, why: `The status row ${JSON.stringify(record.Label)} carries no CampaignId to bind it to its campaign. Save the response the status read printed, whole.` }
      }
      if (String(record.CampaignId) !== String(expectedCampaignId)) {
        return {
          ok: false,
          why: `The status row ${JSON.stringify(record.Label)} carries CampaignId ${JSON.stringify(record.CampaignId)} where ${JSON.stringify(String(expectedCampaignId))} was asked about, so this response answers a different campaign's status read. The saved files are out of order.`
        }
      }
    }
  }
  const labels = result.records.map(r => r.Label)
  const maxSortOrder = result.records.reduce((max, r) => Math.max(max, r.SortOrder), 0)
  return { ok: true, labels, maxSortOrder }
}

/**
 * The Marketing User flag flow. Without a user id the request is the
 * CLI's own whoami; with one it is the flag read. `judgeFlag` reads
 * either measured answer and says which it got, so one judge covers the
 * two-step lookup without a shape being guessed at.
 */
function flagRequest (config, userId) {
  if (!userId) {
    return spec('whoami', { transport: 'cli', targetOrg: config.orgAlias, args: ['org', 'display', 'user'] })
  }
  return query('marketing-user flag', config.orgAlias,
    `SELECT Id, UserPermissionsMarketingUser FROM User WHERE Id = ${soqlLiteral(userId)}`)
}

function judgeFlag (response) {
  if (response && typeof response === 'object' && response.status === 0 &&
      response.result && typeof response.result === 'object') {
    const result = response.result
    if (Array.isArray(result.records)) {
      if (result.done !== true) {
        return { ok: false, why: 'The response says done is not true, so records were withheld. The flag is not read from an incomplete answer.' }
      }
      if (result.records.length !== 1) {
        return { ok: false, why: `The flag query returned ${result.records.length} users where one id should return one. Look at the saved response.` }
      }
      const record = result.records[0]
      if (typeof record.Id !== 'string' || !record.Id) {
        return { ok: false, why: 'The row carries no Id. Save the response whole and look at it.' }
      }
      // Strictly the boolean, because "false" the string and an absent
      // field both read falsy, and a User update planned off a misread
      // flag is a privileged write nothing justified.
      if (record.UserPermissionsMarketingUser !== true && record.UserPermissionsMarketingUser !== false) {
        return { ok: false, why: `The row carries ${JSON.stringify(record.UserPermissionsMarketingUser)} for the flag, which is not the boolean the measured read returns. Save the response whole and look at it.` }
      }
      return { ok: true, userId: record.Id, on: record.UserPermissionsMarketingUser }
    }
    if (result.id) {
      return { ok: true, userId: String(result.id), next: 'Run flag-query again with this user id to read the flag itself.' }
    }
  }
  return { ok: false, why: 'The response is neither the whoami answer nor the flag query envelope, both measured 2026-08-26. Save it whole and look at it.' }
}

// --------------------------------- first-run and scope questions to the org

/**
 * The first-run mailing-fields probe: does this org carry the state and
 * country code fields? A picklist org refuses the plain MailingState and
 * MailingCountry values a list actually carries ("US" was refused with
 * FIELD_INTEGRITY_EXCEPTION, measured 2026-08-26 in the acceptance run),
 * and only a picklist org has the code fields at all, so neither pair of
 * defaults is right for every org. The org itself is asked, one read-only
 * query, before the config draft offers field names. The alias comes in
 * directly because this runs on a first run, before any config exists.
 */
function mailingFieldsProbeRequest (orgAlias) {
  if (typeof orgAlias !== 'string' || !orgAlias.trim()) {
    throw new Error('mailingFieldsProbeRequest needs the org alias the sf CLI holds the credential under.')
  }
  // A named aggregate over BOTH code fields, not a bare select: the
  // answer then carries its question as the two alias keys on its one
  // row, on an empty org as well as a full one, so an unrelated saved
  // success cannot pass as this probe's answer, and the pair the judge
  // offers is probed per org rather than assumed co-present (the round-2
  // finding: nothing measured says the two code fields always travel
  // together). Envelope measured 2026-08-26.
  return query('mailing-fields probe', orgAlias.trim(),
    'SELECT COUNT(MailingStateCode) stateProbe, COUNT(MailingCountryCode) countryProbe FROM Contact')
}

/**
 * What the probe's saved answer means, every branch measured 2026-08-26.
 * The aggregate envelope, one row carrying the `probe` count, means the
 * code fields exist (state and country picklists are on) and the draft
 * offers MailingStateCode and MailingCountryCode, which accept the ISO
 * codes a list carries and from which the org derives the label fields.
 * The data commands' error shape, `name` INVALID_FIELD with the message
 * naming the probed column (both measured spellings name it), means they
 * do not exist and the draft offers the plain fields.
 *
 * THE ANSWER IS BOUND TO ITS QUESTION, on both arms: a successful
 * envelope without the `probe` key, or an INVALID_FIELD about some other
 * column, answers a different question and is refused rather than read,
 * because the wrong pair here is either every contact create failing at
 * the push or a config naming fields the org does not have.
 */
function judgeMailingFieldsProbe (response) {
  const result = queryRecords(response)
  if (result) {
    if (result.done !== true) {
      return { ok: false, why: 'The response says done is not true, so the answer was cut short. The probe is not read from an incomplete answer.' }
    }
    if (result.records.length !== 1) {
      return { ok: false, why: `The response holds ${result.records.length} rows where the aggregate probe answers exactly one. Save the probe response whole and look at it.` }
    }
    const row = result.records[0]
    // The row is questioned before it is read, like every other judged
    // value: a malformed saved file with a non-object entry is a refusal,
    // never a crash.
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      return { ok: false, why: `The response's one row is ${JSON.stringify(row === undefined ? null : row)}, not a record. Save the probe response whole and look at it.` }
    }
    if (typeof row.stateProbe !== 'number' || !Number.isFinite(row.stateProbe) ||
        typeof row.countryProbe !== 'number' || !Number.isFinite(row.countryProbe)) {
      return { ok: false, why: 'The row does not carry both the `stateProbe` and `countryProbe` counts, so this successful answer belongs to a different query. Save the probe response whole and look at it: reading it as a picklist org would write a config against the wrong org.' }
    }
    return {
      ok: true,
      codeFields: true,
      use: { state: 'MailingStateCode', country: 'MailingCountryCode' },
      why: 'The org answered the aggregate over both code fields, so state and country picklists are on and the code fields take the ISO codes a list carries (measured 2026-08-26).'
    }
  }
  // The refusal's message echoes the refused query (both measured
  // spellings), so a refusal of THIS probe names the probed columns and a
  // refusal of some other query does not: the binding holds on this arm
  // the same way the alias keys hold it on the success arm.
  if (response && typeof response === 'object' && response.name === 'INVALID_FIELD' &&
      typeof response.message === 'string' &&
      (response.message.includes('MailingStateCode') || response.message.includes('MailingCountryCode'))) {
    return {
      ok: true,
      codeFields: false,
      use: { state: 'MailingState', country: 'MailingCountry' },
      why: 'The org refused the code-field aggregate with INVALID_FIELD naming a probed column, so at least one code field does not exist there and the plain fields are the pair to offer (error shape measured 2026-08-26).'
    }
  }
  if (response && typeof response === 'object' && response.name === 'INVALID_FIELD') {
    return { ok: false, why: 'The response is INVALID_FIELD about a column that is not a probed one, so it answers a different question. Save the probe response whole and look at it.' }
  }
  return { ok: false, why: 'The response is neither the measured aggregate envelope nor the measured INVALID_FIELD shape, so what this org carries is not known. Save it whole and look at it: a guessed pair fails every contact create or names fields the org does not have.' }
}

/**
 * The scope question's evidence: how many Contacts and how many Leads the
 * org holds, so "this import creates Contacts with their companies" is
 * confirmed against what the org actually works in rather than assumed.
 * Two named-aggregate reads; the envelope (one AggregateResult row whose
 * alias key carries the count) is measured 2026-08-26.
 */
function leadContactCountRequests (config) {
  // Named aggregates, not bare COUNT(): each answer then carries its
  // question as the alias key on its one row, so two saved files passed
  // in the wrong order surface as refusals instead of mislabelled
  // evidence, the same binding rule every other judge here holds.
  return [
    query('count contacts', config.orgAlias, 'SELECT COUNT(Id) contacts FROM Contact'),
    query('count leads', config.orgAlias, 'SELECT COUNT(Id) leads FROM Lead')
  ]
}

/**
 * The two saved counts, judged strictly against the measured aggregate
 * envelope (2026-08-26): one row whose alias key carries the count.
 *
 * EACH ANSWER IS BOUND TO ITS QUESTION BY THE ALIAS KEY ITS ROW CARRIES,
 * not by which argument it arrived as: reversed saved files, or an
 * unrelated query saved in a count's place, would otherwise put the wrong
 * numbers in front of the person at the record-kind gate. A malformed
 * count is refused rather than read as zero, which would tell a Leads org
 * it has no leads.
 */
function judgeLeadContactCounts (contactResponse, leadResponse) {
  const countOf = (response, key) => {
    const result = queryRecords(response)
    if (!result || result.done !== true) {
      return { why: `The ${key} response is not the measured aggregate envelope, or was cut short. Save it whole and look at it: a misread count is evidence shown to a person.` }
    }
    if (result.records.length !== 1) {
      return { why: `The ${key} response holds ${result.records.length} rows where the aggregate answers exactly one. Save it whole and look at it.` }
    }
    const row = result.records[0]
    // Questioned before it is read: a non-object row is a refusal, not a
    // crash, the same discipline every judged value here holds.
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      return { why: `The ${key} response's one row is ${JSON.stringify(row === undefined ? null : row)}, not a record. Save it whole and look at it.` }
    }
    const value = row[key]
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return { why: `The ${key} response's row carries no \`${key}\` count, so it answers a different question, or the saved files are out of order. Save both responses whole, in the order the requests were emitted.` }
    }
    return { count: value }
  }
  const contacts = countOf(contactResponse, 'contacts')
  if (contacts.why) return { ok: false, why: contacts.why }
  const leads = countOf(leadResponse, 'leads')
  if (leads.why) return { ok: false, why: leads.why }
  return { ok: true, contacts: contacts.count, leads: leads.count }
}

// ---------------------------------------------------------------- the push

/**
 * The salesforce plan shape, asserted rather than defaulted, the same
 * rule the HubSpot half applies to its lists: a plan built by an older
 * step or edited by hand is a plan to rebuild, not to guess at.
 */
function assertPlanShape (plan, who) {
  const m = plan && plan.campaignMemberships
  if (!plan || !m || !m.campaigns || !Array.isArray(m.campaigns.creates) || !Array.isArray(m.campaigns.matched) ||
      !m.statuses || !Array.isArray(m.statuses.creates) || !Array.isArray(m.members) ||
      m.userFlagFix === undefined) {
    throw new Error(
      `${who} needs a plan whose campaignMemberships carry \`campaigns\`, \`statuses\`, \`members\` and \`userFlagFix\`, ` +
      'which the plan command builds from the judged campaign lookups and status reads. This plan does not, so it was ' +
      'built by an older step or edited by hand: run `plan` again rather than pushing a guess.'
    )
  }
}

/**
 * The push, as request specs in dependency order: accounts first, then
 * the adoption fills, then the flag fix when the plan carries one, then
 * contacts (each create carrying its AccountId, because on this backend
 * the association is a field on the create), then campaigns, then member
 * statuses, then members.
 *
 * Tokens are the HubSpot half's opaque numbered ones, `{account:1}`,
 * `{contact:12}`, `{campaign:2}`, with the legend in `placeholders`.
 */
function pushRequests (config, plan) {
  assertPlanShape(plan, 'push')
  const requests = []
  const placeholders = {}
  const org = config.orgAlias
  const memberships = plan.campaignMemberships

  const accountToken = new Map()
  plan.companies.creates.forEach((company, at) => {
    const token = `{account:${at + 1}}`
    accountToken.set(company.name, token)
    placeholders[token] = { kind: 'account', key: company.name }
  })
  const campaignToken = new Map()
  memberships.campaigns.creates.forEach((campaign, at) => {
    const token = `{campaign:${at + 1}}`
    campaignToken.set(campaign.name, token)
    placeholders[token] = { kind: 'campaign', key: campaign.name }
  })
  for (const create of plan.contacts.creates) {
    placeholders[`{contact:${create.index}}`] = { kind: 'contact', key: String(create.index) }
  }

  const contactRef = index => {
    const create = plan.contacts.creates.find(c => c.index === index)
    if (create) return `{contact:${index}}`
    const known = plan.contacts.updates.find(u => u.index === index) ||
      plan.contacts.nothing.find(n => n.index === index)
    if (known && known.contactId) return String(known.contactId)
    throw new Error(`Row ${index} is on a membership and is neither a planned create nor a row with a known contact id. The plan is inconsistent, and this is a bug in this plugin, not in the list.`)
  }
  const accountIdFor = name => {
    const matched = plan.companies.matched.find(m => m.name === name)
    return matched ? matched.companyId : accountToken.get(name)
  }
  const campaignIdFor = name => {
    const matched = memberships.campaigns.matched.find(m => m.name === name)
    return matched ? matched.campaignId : campaignToken.get(name)
  }

  for (const company of plan.companies.creates) {
    const body = { [config.properties.company.name]: company.name }
    if (company.website && config.properties.company.website) {
      body[config.properties.company.website] = company.website
    }
    if (config.recordTypeIds && config.recordTypeIds.account) body.RecordTypeId = config.recordTypeIds.account
    requests.push(rest(`create account: ${company.name}`, org, 'POST', `${API}/sobjects/Account`, body))
  }

  // The adoption fill on a matched account, one PATCH by the id the match
  // names, empty values dropped even when the caller skipped the plan's
  // refusal, the same belt-and-braces as the HubSpot half.
  for (const matched of plan.companies.matched) {
    if (!matched.fill || !Object.keys(matched.fill).length) continue
    const filled = value => typeof value === 'string' && value.trim()
    const body = {}
    if (filled(matched.fill.name)) body[config.properties.company.name] = matched.fill.name
    if (filled(matched.fill.website) && config.properties.company.website) {
      body[config.properties.company.website] = matched.fill.website
    }
    if (!Object.keys(body).length) continue
    requests.push(rest(`fill account: ${matched.name}`, org, 'PATCH', `${API}/sobjects/Account/${matched.companyId}`, body))
  }

  // The flag fix, before anything in the campaign family, because campaign
  // creation is refused while the flag is off (measured 2026-08-25). It is
  // in the plan, shown in the confirmation summary, and proved by its
  // read-back like every write.
  if (memberships.userFlagFix) {
    requests.push(rest(
      'fix marketing-user flag',
      org, 'PATCH', `${API}/sobjects/User/${memberships.userFlagFix.userId}`,
      { UserPermissionsMarketingUser: true }
    ))
  }

  for (const create of plan.contacts.creates) {
    const body = contactCreateBody(config, create.row, plan.leadSource)
    const company = create.row.fields.company
    if (company) body.AccountId = accountIdFor(company)
    requests.push(rest(`create contact: row ${create.index}`, org, 'POST', `${API}/sobjects/Contact`, body))
  }
  for (const update of plan.contacts.updates) {
    requests.push(rest(`update contact: row ${update.index}`, org, 'PATCH', `${API}/sobjects/Contact/${update.contactId}`, contactUpdateBody(config, update.fill)))
  }

  for (const campaign of memberships.campaigns.creates) {
    requests.push(rest(`create campaign: ${campaign.name}`, org, 'POST', `${API}/sobjects/Campaign`, { Name: campaign.name }))
  }
  for (const status of memberships.statuses.creates) {
    requests.push(rest(
      `create member status: ${status.campaign} / ${status.label}`,
      org, 'POST', `${API}/sobjects/CampaignMemberStatus`,
      { CampaignId: campaignIdFor(status.campaign), Label: status.label, SortOrder: status.sortOrder }
    ))
  }
  for (const membership of memberships.members) {
    for (const index of membership.rows) {
      requests.push(rest(
        `add member: row ${index} to ${membership.campaign} / ${membership.status}`,
        org, 'POST', `${API}/sobjects/CampaignMember`,
        { CampaignId: campaignIdFor(membership.campaign), ContactId: contactRef(index), Status: membership.status }
      ))
    }
  }

  return {
    requests,
    placeholders,
    note:
      'Send in this order. Every `{kind:number}` token stands for an id that does not exist yet; `placeholders` says which ' +
      'record each one is, and as each create returns its id, substitute it for that exact token in the later requests. ' +
      'One record failing does not stop the rest: partial success is per record, and judge-push reads the saved responses. ' +
      'Nothing beyond these requests is approved.'
  }
}

/**
 * What a saved push response means, per the measured behaviours.
 *
 *   created           the bare REST create envelope, id with success true
 *   done-unproved     an empty answer to a PATCH: the measured 204 carries
 *                     no body, so the read-back is the only proof
 *   duplicate-member  the member create refused individually with the
 *                     existing row untouched, folded into the report
 *   failed            either measured error shape, reported as itself
 */
function judgeResponse (request, response) {
  const isPatch = request.method === 'PATCH'
  if (response === null || response === undefined || response === '' ||
      (typeof response === 'object' && !Array.isArray(response) && !Object.keys(response).length)) {
    if (isPatch) {
      return { outcome: 'done-unproved', why: 'A REST PATCH answers 204 with no body (measured 2026-08-26), so nothing about it is proved until its read-back is compared.' }
    }
    return { outcome: 'unknown', why: 'The response is empty and this request is not one whose empty response has a measured meaning. Nothing about it is proved.' }
  }
  if (typeof response === 'object' && !Array.isArray(response) && response.id && response.success === true) {
    return { outcome: 'created', id: String(response.id) }
  }
  // The data commands wrap their result; a caller that sent a write that
  // way still gets its id read, because both envelopes are measured.
  if (typeof response === 'object' && response.status === 0 && response.result &&
      response.result.id && response.result.success === true) {
    return { outcome: 'created', id: String(response.result.id) }
  }
  const errors = Array.isArray(response)
    ? response.filter(e => e && (e.message || e.errorCode))
    : (typeof response === 'object' && (response.name || response.exitCode !== undefined) && response.message ? [response] : [])
  if (errors.length) {
    const text = errors.map(e => e.message || e.errorCode || e.name).join('; ')
    const isMemberCreate = request.method === 'POST' && String(request.path || '').endsWith('/sobjects/CampaignMember')
    if (isMemberCreate && /Already a campaign member/i.test(text)) {
      return {
        outcome: 'duplicate-member',
        why:
          'The org refused this member add because the contact is already on the campaign, and the existing row was not ' +
          'changed by the failed insert (measured 2026-08-25). Folded into the report; the membership read-back is still the proof.'
      }
    }
    return { outcome: 'failed', why: text }
  }
  return { outcome: 'unknown', why: 'The response is not a shape whose meaning has been measured. Save it whole and judge it by hand rather than guessing.' }
}

// ----------------------------------------------------------------- read-backs

/**
 * The read-back queries for everything the push claims to have written:
 * contacts by id (creates by the pushed ids, updates by the ids the plan
 * carried), accounts by id (creates and adoption fills), the members per
 * campaign, and the flag when the plan fixed it.
 */
function readbackRequests (config, plan, pushedIds) {
  assertPlanShape(plan, 'readbacks')
  const requests = []
  const org = config.orgAlias
  const memberships = plan.campaignMemberships
  // A configured record type is a written field like any other, so the
  // read-backs select it, or a routed create would false-fail its proof
  // against a read-back that cannot carry what was sent.
  const contactTypeField = config.recordTypeIds && config.recordTypeIds.contact ? ['RecordTypeId'] : []
  const accountTypeField = config.recordTypeIds && config.recordTypeIds.account ? ['RecordTypeId'] : []
  const contactSelect = `SELECT ${[...new Set(contactFieldNames(config).concat(['Id', 'AccountId'], contactTypeField))].join(', ')} FROM Contact`
  const accountSelect = `SELECT ${['Id', config.properties.company.name, config.properties.company.website].filter(Boolean).concat(accountTypeField).join(', ')} FROM Account`

  for (const [key, id] of Object.entries(pushedIds.contacts || {})) {
    requests.push(query(`read back contact: row ${key}`, org, `${contactSelect} WHERE Id = ${soqlLiteral(id)}`))
  }
  for (const update of plan.contacts.updates) {
    requests.push(query(`read back contact: row ${update.index}`, org, `${contactSelect} WHERE Id = ${soqlLiteral(update.contactId)}`))
  }
  for (const [name, id] of Object.entries(pushedIds.accounts || {})) {
    requests.push(query(`read back account: ${name}`, org, `${accountSelect} WHERE Id = ${soqlLiteral(id)}`))
  }
  for (const matched of plan.companies.matched) {
    if (!matched.fill || !Object.keys(matched.fill).length) continue
    requests.push(query(`read back account: ${matched.name}`, org, `${accountSelect} WHERE Id = ${soqlLiteral(matched.companyId)}`))
  }
  // A created campaign and a created status row are writes like any
  // other, and an unread one is unproved: the campaign by its pushed id,
  // and the status rows of every campaign the plan created statuses on.
  for (const [name, id] of Object.entries(pushedIds.campaigns || {})) {
    requests.push(query(`read back campaign: ${name}`, org, `SELECT Id, Name FROM Campaign WHERE Id = ${soqlLiteral(id)}`))
  }
  const statusCampaigns = [...new Set(memberships.statuses.creates.map(s => s.campaign))]
  for (const name of statusCampaigns) {
    const matched = memberships.campaigns.matched.find(m => m.name === name)
    const id = matched ? matched.campaignId : (pushedIds.campaigns || {})[name]
    if (!id) continue // no id means the create never returned one; prove fails it as an absent read-back
    // CampaignId rides every campaign-scoped read-back so the proof can
    // bind the rows to the campaign they were fetched for: a saved
    // response filed under the wrong campaign must fail, not prove it.
    requests.push(query(`read back statuses: ${name}`, org,
      `SELECT Id, Label, SortOrder, CampaignId FROM CampaignMemberStatus WHERE CampaignId = ${soqlLiteral(id)}`))
  }
  // Member reads come from the plan, not from the pushed ids, the same
  // rule the HubSpot half records: a run whose campaigns all matched
  // existing ones still has to prove who landed on them.
  const campaigns = [...new Set(memberships.members.map(m => m.campaign))]
  for (const name of campaigns) {
    const matched = memberships.campaigns.matched.find(m => m.name === name)
    const id = matched ? matched.campaignId : (pushedIds.campaigns || {})[name]
    if (!id) continue // no id means the create never returned one; prove fails it as an absent read-back
    requests.push(query(`read back members: ${name}`, org,
      `SELECT Id, ContactId, Status, CampaignId FROM CampaignMember WHERE CampaignId = ${soqlLiteral(id)}`))
  }
  if (memberships.userFlagFix) {
    requests.push(query('read back marketing-user flag', org,
      `SELECT Id, UserPermissionsMarketingUser FROM User WHERE Id = ${soqlLiteral(memberships.userFlagFix.userId)}`))
  }
  return requests
}

/**
 * The proof: the read-backs compared field by field against the approved
 * plan. An id is a locator, not a proof; the comparison is the proof, and
 * it says what it did not check.
 *
 * `readbacks` is `{contacts: {"<row index>": response}, accounts:
 * {"<name>": response}, campaigns: {"<name>": response}, statusRows:
 * {"<campaign name>": response}, members: {"<campaign name>": response},
 * userFlag: response}`, each response saved as the CLI printed it.
 */
function prove (config, plan, pushedIds, readbacks) {
  assertPlanShape(plan, 'prove')
  const problems = []
  const checked = []
  const unchecked = []
  const back = reverseContactMap(config)
  const memberships = plan.campaignMemberships

  const recordFrom = response => {
    const result = queryRecords(response)
    if (!result || result.done !== true || result.records.length !== 1) return null
    return result.records[0]
  }

  // THE READ-BACK IS BOUND TO THE RECORD IT WAS FETCHED FOR, by the Id it
  // carries. Without this, a saved response filed under the wrong key, or
  // one response reused under two keys, proves a write nothing read: the
  // query asked for one id and the answer names which record it is, so a
  // different id is a different record's read-back, not this write's proof.
  const boundRecord = (label, response, expectedId, missingWhy) => {
    const record = recordFrom(response)
    if (!record) {
      problems.push({ what: label, why: missingWhy || 'No read-back to compare, so nothing about this write is proved.' })
      return null
    }
    if (typeof record.Id !== 'string' || String(record.Id) !== String(expectedId)) {
      problems.push({
        what: label,
        why: `The read-back carries Id ${JSON.stringify(record.Id === undefined ? null : record.Id)} where ${JSON.stringify(String(expectedId))} was fetched, so it answers a different record, and nothing about this write is proved by it.`
      })
      return null
    }
    return record
  }

  const compareRecord = (label, intended, record) => {
    if (!record) return // boundRecord already named why
    for (const [name, sent] of Object.entries(intended)) {
      const got = record[name]
      // Every value this proof compares was sent as text, and the measured
      // read-backs answer text, so a non-string is refused rather than
      // coerced equal: String() read a numeric 42 as a faithful echo of
      // the string "42", which is a malformed response passing the proof.
      if (typeof got !== 'string') {
        problems.push({ what: `${label}, ${name}`, why: `Sent ${JSON.stringify(sent)} and the record came back with ${JSON.stringify(got === undefined ? null : got)}, which is not text. A malformed value is refused rather than coerced equal.` })
      } else if (got !== String(sent)) {
        problems.push({ what: `${label}, ${name}`, why: `Sent ${JSON.stringify(sent)} and the record came back with ${JSON.stringify(got)}.` })
      } else {
        checked.push({ what: `${label}, ${back[name] || name}` })
      }
    }
  }

  for (const create of plan.contacts.creates) {
    const id = (pushedIds.contacts || {})[create.index]
    if (!id) {
      problems.push({ what: `row ${create.index}`, why: 'The push report has no id for this create, so there is nothing to read back. It is not proved.' })
      continue
    }
    const record = boundRecord(`row ${create.index}`, (readbacks.contacts || {})[create.index], id)
    compareRecord(`row ${create.index}`, contactCreateBody(config, create.row, plan.leadSource), record)

    const company = create.row.fields.company
    if (company) {
      const expected = (plan.companies.matched.find(m => m.name === company) || {}).companyId ||
        (pushedIds.accounts || {})[company]
      if (!record) {
        problems.push({ what: `row ${create.index} association`, why: 'No contact read-back, so the AccountId cannot be checked. Unproved fails the proof.' })
      } else if (!expected) {
        problems.push({ what: `row ${create.index} association`, why: `No account id is known for "${company}", so the association cannot be checked against the right record.` })
      } else if (String(record.AccountId) !== String(expected)) {
        problems.push({ what: `row ${create.index} association`, why: `The contact came back with AccountId ${JSON.stringify(record.AccountId || null)} where account ${expected} was planned.` })
      } else {
        checked.push({ what: `row ${create.index} association` })
      }
    }
  }

  for (const update of plan.contacts.updates) {
    compareRecord(`row ${update.index} (update)`, contactUpdateBody(config, update.fill),
      boundRecord(`row ${update.index} (update)`, (readbacks.contacts || {})[update.index], update.contactId))
  }

  for (const company of plan.companies.creates) {
    const id = (pushedIds.accounts || {})[company.name]
    if (!id) {
      problems.push({ what: `account ${company.name}`, why: 'The push report has no id for this account, so there is nothing to read back.' })
      continue
    }
    const intended = { [config.properties.company.name]: company.name }
    if (company.website && config.properties.company.website) {
      intended[config.properties.company.website] = company.website
    }
    // The record type the push wrote is proved like every other field, or
    // the routing is sent and never known to have landed.
    if (config.recordTypeIds && config.recordTypeIds.account) {
      intended.RecordTypeId = config.recordTypeIds.account
    }
    compareRecord(`account ${company.name}`, intended, boundRecord(`account ${company.name}`, (readbacks.accounts || {})[company.name], id))
  }

  for (const matched of plan.companies.matched) {
    if (!matched.fill || !Object.keys(matched.fill).length) continue
    const filled = value => typeof value === 'string' && value.trim()
    const intended = {}
    if (filled(matched.fill.name)) intended[config.properties.company.name] = matched.fill.name
    if (filled(matched.fill.website) && config.properties.company.website) {
      intended[config.properties.company.website] = matched.fill.website
    }
    if (!Object.keys(intended).length) continue
    compareRecord(`account ${matched.name} (fill)`, intended,
      boundRecord(`account ${matched.name} (fill)`, (readbacks.accounts || {})[matched.name], matched.companyId))
  }

  for (const campaign of memberships.campaigns.creates) {
    const id = (pushedIds.campaigns || {})[campaign.name]
    if (!id) {
      problems.push({ what: `campaign ${campaign.name}`, why: 'The push report has no id for this campaign, so there is nothing to read back. It is not proved.' })
      continue
    }
    compareRecord(`campaign ${campaign.name}`, { Name: campaign.name }, boundRecord(`campaign ${campaign.name}`, (readbacks.campaigns || {})[campaign.name], id))
  }

  // A campaign-scoped read-back is bound to its campaign the same way a
  // single-record one is bound to its Id: by the CampaignId its rows carry.
  const campaignIdOf = name => {
    const matched = memberships.campaigns.matched.find(m => m.name === name)
    return matched ? matched.campaignId : (pushedIds.campaigns || {})[name]
  }

  for (const status of memberships.statuses.creates) {
    const label = `status ${status.campaign} / ${status.label}`
    const result = queryRecords((readbacks.statusRows || {})[status.campaign])
    if (!result || result.done !== true) {
      problems.push({ what: label, why: 'No status read-back was saved, and the plan created this status row. It is unproved, and unproved fails the proof.' })
      continue
    }
    const campaignId = campaignIdOf(status.campaign)
    if (!campaignId) {
      problems.push({ what: label, why: `No campaign id is known for "${status.campaign}", so the read-back cannot be bound to the right campaign. Unproved fails the proof.` })
      continue
    }
    // THE PROOF HOLDS THE JUDGE'S OWN TYPE DISCIPLINE. A wordy SortOrder or
    // a null Label the status judge refuses cannot be re-accepted here by
    // String() and Number() coercion, and every row is bound to the
    // campaign it was fetched for: a malformed or misfiled read-back
    // proves nothing.
    const misread = result.records.find(r =>
      typeof r.Label !== 'string' || !r.Label.trim() ||
      typeof r.SortOrder !== 'number' || !Number.isFinite(r.SortOrder) ||
      typeof r.CampaignId !== 'string' || String(r.CampaignId) !== String(campaignId))
    if (misread) {
      problems.push({
        what: label,
        why: `The status read-back holds a row this proof refuses to read: Label ${JSON.stringify(misread.Label === undefined ? null : misread.Label)}, SortOrder ${JSON.stringify(misread.SortOrder === undefined ? null : misread.SortOrder)}, CampaignId ${JSON.stringify(misread.CampaignId === undefined ? null : misread.CampaignId)} where ${JSON.stringify(String(campaignId))} was fetched. Save the response the read-back printed, whole, and look at it.`
      })
      continue
    }
    const row = result.records.find(r => r.Label === status.label)
    if (!row) {
      problems.push({ what: label, why: 'The status row is not in the read-back. The create did not land.' })
    } else if (row.SortOrder !== status.sortOrder) {
      problems.push({ what: label, why: `Sent SortOrder ${status.sortOrder} and the row came back with ${JSON.stringify(row.SortOrder)}.` })
    } else {
      checked.push({ what: label })
    }
  }

  for (const membership of memberships.members) {
    const result = queryRecords((readbacks.members || {})[membership.campaign])
    if (!result) {
      problems.push({ what: `campaign ${membership.campaign}`, why: 'No member read-back was saved, and the plan put rows on this campaign. Who landed there is unproved, and unproved fails the proof.' })
      continue
    }
    const campaignId = campaignIdOf(membership.campaign)
    if (!campaignId) {
      problems.push({ what: `campaign ${membership.campaign}`, why: `No campaign id is known for "${membership.campaign}", so the member read-back cannot be bound to the right campaign. Unproved fails the proof.` })
      continue
    }
    // The same discipline as the status proof: rows are bound to the
    // campaign they were fetched for, and malformed values are refused
    // rather than coerced, because a numeric ContactId read through
    // String() could match a planned id the judge would have refused.
    //
    // A ROW WITH NO ContactId IS A DIFFERENT ANSWER FROM A MALFORMED ONE.
    // A matched campaign in a real org can hold members linked to a Lead,
    // and those rows carry ContactId null; the Lead object is out of this
    // plugin's scope by recorded decision, such a row can neither satisfy
    // nor contradict a planned contact membership, and refusing the whole
    // read-back over it reported a correctly landed push as failed. A
    // null ContactId row is skipped after its CampaignId binding is
    // checked; a ContactId that is present and not a string stays refused
    // as the wrong type it is.
    const misfiled = result.records.find(r =>
      typeof r.CampaignId !== 'string' || String(r.CampaignId) !== String(campaignId) ||
      (r.ContactId !== null && r.ContactId !== undefined && typeof r.ContactId !== 'string') ||
      (typeof r.ContactId === 'string' && (!r.ContactId || typeof r.Status !== 'string' || !r.Status.trim())))
    if (misfiled) {
      problems.push({
        what: `campaign ${membership.campaign}`,
        why: `The member read-back holds a row this proof refuses to read: ContactId ${JSON.stringify(misfiled.ContactId === undefined ? null : misfiled.ContactId)}, Status ${JSON.stringify(misfiled.Status === undefined ? null : misfiled.Status)}, CampaignId ${JSON.stringify(misfiled.CampaignId === undefined ? null : misfiled.CampaignId)} where ${JSON.stringify(String(campaignId))} was fetched. Save the response the read-back printed, whole, and look at it.`
      })
      continue
    }
    const onCampaign = new Map(result.records.filter(r => typeof r.ContactId === 'string').map(r => [r.ContactId, r.Status]))
    for (const index of membership.rows) {
      const id = (pushedIds.contacts || {})[index] ||
        ((plan.contacts.updates.find(u => u.index === index) || plan.contacts.nothing.find(n => n.index === index) || {}).contactId)
      if (!id) {
        unchecked.push({ what: `campaign ${membership.campaign}, row ${index}`, why: 'No contact id is known for this row, so its membership cannot be checked.' })
      } else if (!onCampaign.has(String(id))) {
        problems.push({ what: `campaign ${membership.campaign}, row ${index}`, why: 'The contact is not in the member read-back. The add did not land.' })
      } else if (onCampaign.get(String(id)) !== membership.status) {
        problems.push({ what: `campaign ${membership.campaign}, row ${index}`, why: `The member is on the campaign with status ${JSON.stringify(onCampaign.get(String(id)))} where ${JSON.stringify(membership.status)} was planned.` })
      } else {
        checked.push({ what: `campaign ${membership.campaign}, row ${index}` })
      }
    }
  }

  if (memberships.userFlagFix) {
    const record = boundRecord('marketing-user flag', readbacks.userFlag, memberships.userFlagFix.userId,
      'The plan fixed the flag and no read-back was saved. Unproved fails the proof.')
    if (!record) {
      // boundRecord already named why: absent, or a different User record.
    } else if (record.UserPermissionsMarketingUser !== true) {
      problems.push({ what: 'marketing-user flag', why: 'The read-back says the flag is still off, so the fix did not land.' })
    } else {
      checked.push({ what: 'marketing-user flag' })
    }
  }

  unchecked.push({
    what: 'everything not named above',
    why: 'Only planned writes were compared. Fields the plan did not send, and records it did not touch, were not read.'
  })

  return { problems, checked, unchecked }
}

// -------------------------------------------------------------------- check

/**
 * The aliveness probe for `check`: the cheapest read that exercises the
 * keychain credential. Nothing paid, nothing written.
 */
function probeRequest (config) {
  return query('connection probe', config.orgAlias, 'SELECT Id FROM Contact LIMIT 1')
}

function judgeProbe (response) {
  if (queryRecords(response)) {
    return { alive: true, why: 'The org answered a read with the measured envelope. The credential works for reads; writes are proved only by the live run.' }
  }
  if (response && typeof response === 'object' && (response.name || response.message)) {
    return { alive: false, why: `The CLI refused the probe: ${response.message || response.name}.` }
  }
  return { alive: false, why: 'The probe response is not a shape this recognises, so the connection is not proved alive. Save the response whole and look at it.' }
}

/** The alias-resolution check for check-standing: read-only, judged by shape. */
function orgDisplayRequest (config) {
  return spec('org display', { transport: 'cli', targetOrg: config.orgAlias, args: ['org', 'display'] })
}

function judgeOrgDisplay (response) {
  if (response && typeof response === 'object' && response.status === 0 &&
      response.result && response.result.connectedStatus === 'Connected') {
    return { ok: true, apiVersion: response.result.apiVersion || null }
  }
  if (response && typeof response === 'object' && response.result && response.result.connectedStatus) {
    return { ok: false, why: `The org answered with connectedStatus ${JSON.stringify(response.result.connectedStatus)}, not Connected.` }
  }
  return { ok: false, why: 'The response is not the measured org-display envelope, so the alias is not proved to resolve. Save it whole and look at it.' }
}

module.exports = {
  API,
  SEARCH_BATCH,
  UPDATE_FIELDS,
  spec,
  soqlLiteral,
  contactField,
  reverseContactMap,
  contactFieldNames,
  queryRecords,
  searchRequests,
  searchResults,
  companySearchRequests,
  contactCreateBody,
  contactUpdateBody,
  campaignLookupRequests,
  judgeCampaignLookup,
  statusReadRequests,
  judgeStatusRead,
  flagRequest,
  judgeFlag,
  mailingFieldsProbeRequest,
  judgeMailingFieldsProbe,
  leadContactCountRequests,
  judgeLeadContactCounts,
  assertPlanShape,
  pushRequests,
  judgeResponse,
  readbackRequests,
  prove,
  probeRequest,
  judgeProbe,
  orgDisplayRequest,
  judgeOrgDisplay
}

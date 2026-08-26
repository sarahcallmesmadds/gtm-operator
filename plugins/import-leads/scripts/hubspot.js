'use strict'

/**
 * The HubSpot half: every request this plugin sends is built here, and every
 * response it acts on is judged here. The skill sends the requests, with the
 * Service Key as a bearer header read from the file config names; the key
 * itself never passes through this code and never appears in a request spec.
 *
 * WHAT IS MEASURED AND WHAT IS NOT. The surfaces below were measured against
 * a real portal on 2026-08-25: contact and company creates with ids returned,
 * the v4 default contact-to-company association, manual list create
 * (objectTypeId 0-1), member add and read-back with a duplicate add as a
 * silent no-op, the search surface's IN filter on email, the duplicate
 * contact create refused with the existing id in the error, and archival
 * reading back as 404. The exact request shapes in this file are rebuilt
 * from those measurements' summaries, and the live acceptance run of one
 * real list end to end is what proves them: nothing here claims to work
 * until it has.
 */

const BASE = 'https://api.hubapi.com'

/** A request spec: what to send. The skill attaches the bearer and sends. */
function spec (label, method, path, body) {
  const out = { label, method, url: BASE + path }
  if (body !== undefined) out.body = body
  return out
}

/**
 * The portal property name for a canonical contact field, from config.
 * Absent optional properties return null, and the caller decides whether
 * that is fine (linkedinUrl on an org that has no such property) or a
 * problem (leadSource with a value and no home).
 */
const contactProperty = (config, field) => (config.properties.contact[field] === undefined ? null : config.properties.contact[field])

/**
 * The reverse map, portal property name back to canonical field, for
 * reading responses. The default `company` text property rides along under
 * the canonical name `company`: it is only ever read, as the signal for the
 * cross-company conflict check, and nothing in this plugin writes it.
 */
function reverseContactMap (config) {
  const back = { company: 'company' }
  for (const [field, name] of Object.entries(config.properties.contact)) {
    back[name] = field
  }
  return back
}

/** Every portal property name a contact read should ask for. */
function contactPropertyNames (config) {
  return [...new Set(Object.values(config.properties.contact).concat(['company']))]
}

// ------------------------------------------------------------------- search

/**
 * The reference batched its duplicate check in email lists of 100, and that
 * carries over: it is a batch size that ran in production, not one measured
 * against this portal's own limits, which are unmeasured.
 */
const SEARCH_BATCH = 100

/**
 * The dedupe searches: the IN filter on the email property, measured
 * 2026-08-25. One request per batch of emails, each asking for every mapped
 * property, because the blanks-only fill cannot know what is blank without
 * reading what is there.
 */
function searchRequests (config, emails) {
  if (!Array.isArray(emails)) throw new Error('searchRequests needs the list of emails to look for.')
  // Folded here as well as at ingest, because enrichment fills emails after
  // ingest and hands them over as the tool spelled them. An unfolded email
  // searched verbatim misses its folded match and the row plans as a create.
  const unique = [...new Set(
    emails.filter(e => typeof e === 'string' && e.trim()).map(e => e.trim().toLowerCase())
  )]
  const requests = []
  for (let at = 0; at < unique.length; at += SEARCH_BATCH) {
    const batch = unique.slice(at, at + SEARCH_BATCH)
    requests.push(spec(
      `dedupe search ${requests.length + 1}`,
      'POST',
      '/crm/v3/objects/contacts/search',
      {
        filterGroups: [{
          filters: [{ propertyName: contactProperty(config, 'email'), operator: 'IN', values: batch }]
        }],
        properties: contactPropertyNames(config),
        limit: SEARCH_BATCH
      }
    ))
  }
  return requests
}

/**
 * The search responses, normalised to contacts by lowercased email.
 *
 * The envelope this reads, `{total, results: [{id, properties}]}`, is what
 * the measured search returned. Anything else is refused by name rather than
 * guessed at, because a guess that produces an empty map reads exactly like
 * a CRM with nobody in it, and every row would then plan as a create.
 *
 * COMPLETENESS IS REPORTED, NOT ASSUMED. A response carrying `paging` was
 * cut short, and a contact left unfetched is a duplicate the plan would not
 * see. Each email in a batch can match at most one contact (the portal
 * enforces email uniqueness itself, measured), so a batch within the limit
 * should never page; if one does, that assumption broke and the honest
 * answer is to say so.
 */
function searchResults (config, responses) {
  if (!Array.isArray(responses)) {
    throw new Error('searchResults needs the array of saved search responses, one per request, in order.')
  }
  const back = reverseContactMap(config)
  const byEmail = {}
  const incomplete = []

  responses.forEach((response, at) => {
    if (!response || typeof response !== 'object' || !Array.isArray(response.results)) {
      throw new Error(
        `Response ${at + 1} is not the measured search envelope ({total, results}). ` +
        'Save what the portal returned, whole. Guessing at another shape would read as a CRM with nobody in it.'
      )
    }
    if (response.paging) {
      incomplete.push({ response: at + 1, why: 'The response carries paging, so results were withheld. A duplicate could be among them.' })
    }
    for (const result of response.results) {
      // A row that is not a record is a different answer from a result
      // with no id, and the refusal names which, the same split the
      // Salesforce parser holds (round 6).
      if (!result || typeof result !== 'object' || Array.isArray(result)) {
        throw new Error(`Response ${at + 1} holds ${JSON.stringify(result === undefined ? null : result)} where a result should be, not a record. Save what the portal returned, whole.`)
      }
      if ((typeof result.id !== 'string' && typeof result.id !== 'number') || result.id === '') {
        throw new Error(`Response ${at + 1} holds a result with no id. Save what the portal returned.`)
      }
      // The properties container is a record or the result is malformed:
      // Object.entries over a string spreads its characters, none of them
      // a mapped name, and the contact silently vanishes from the dedupe
      // this search is the whole guard for (round 7).
      if (result.properties !== undefined && result.properties !== null &&
          (typeof result.properties !== 'object' || Array.isArray(result.properties))) {
        throw new Error(`Response ${at + 1} holds a result whose properties is ${JSON.stringify(result.properties)}, not a record. Save what the portal returned, whole.`)
      }
      const properties = {}
      // Every mapped value is text on the measured surface, so a value
      // that is present and not text is refused rather than carried, the
      // same rule the Salesforce parser holds and the rule that started
      // at email: a coerced email is an identity nothing can match, and
      // the unmatched row plans as a duplicate create.
      for (const [name, value] of Object.entries(result.properties || {})) {
        const field = back[name]
        if (!field || value === null || value === undefined) continue
        if (typeof value !== 'string') {
          throw new Error(`Response ${at + 1} holds a result whose ${name} is ${JSON.stringify(value)}, not text. Save what the portal returned, whole.`)
        }
        properties[field] = value
      }
      const email = properties.email ? properties.email.trim().toLowerCase() : null
      if (!email) continue
      byEmail[email] = { id: String(result.id), properties }
    }
  })

  return { byEmail, incomplete, found: Object.keys(byEmail).length }
}

/**
 * Company lookups for the matching step, one request per company: by name
 * token, and by domain when the rows carry one. CONTAINS_TOKEN on the name
 * is this plugin's rebuild of the reference's name matching; the company
 * search surface is UNMEASURED and this is one of the things the live run
 * proves. What comes back is candidates with evidence, for the person: the
 * match itself is never decided by the query.
 */
function companySearchRequests (config, companies) {
  if (!Array.isArray(companies)) throw new Error('companySearchRequests needs [{name, domain}] entries.')
  const nameProperty = config.properties.company.name
  const websiteProperty = config.properties.company.website
  const properties = [nameProperty, websiteProperty, 'domain'].filter(Boolean)
  const requests = []
  for (const company of companies) {
    requests.push(spec(
      `company search: ${company.name}`,
      'POST',
      '/crm/v3/objects/companies/search',
      { filterGroups: [{ filters: [{ propertyName: nameProperty, operator: 'CONTAINS_TOKEN', value: company.name }] }], properties, limit: 20 }
    ))
    // The domain lookup is its own request, never OR-ed into the name
    // search: a broad name can match more than one page holds, the exact
    // domain hit can fall off that page, and an unpaged union then
    // recreates the nameless-company miss the domain half exists to
    // prevent.
    if (company.domain) {
      requests.push(spec(
        `company search by domain: ${company.name}`,
        'POST',
        '/crm/v3/objects/companies/search',
        { filterGroups: [{ filters: [{ propertyName: 'domain', operator: 'EQ', value: company.domain }] }], properties, limit: 20 }
      ))
    }
  }
  return requests
}

// -------------------------------------------------------------------- writes

/**
 * The properties payload for a contact create. Only fields that name a
 * source, enforced here as well as at the gate, because a payload builder
 * that trusts its caller to have gated is one refactor away from writing an
 * unsourced value. The lead-source value goes on creates only: it records
 * where a new contact came from, and stamping it onto contacts that already
 * existed would claim this import brought them in. Persona and owner go in
 * only when config maps a property for them and the value names its source.
 */
function contactCreateBody (config, row, leadSource) {
  const properties = {}
  for (const [field, value] of Object.entries(row.fields)) {
    if (field === 'company' || field === 'companyDomain') continue
    if (!(row.fieldSources && row.fieldSources[field])) continue
    const name = contactProperty(config, field)
    if (!name) continue
    properties[name] = value
  }
  if (row.persona && row.personaSource && contactProperty(config, 'persona')) {
    properties[contactProperty(config, 'persona')] = row.persona
  }
  if (row.owner && (row.ownerSource === 'routing' || row.ownerSource === 'confirmed') && contactProperty(config, 'owner')) {
    properties[contactProperty(config, 'owner')] = row.owner
  }
  if (leadSource) properties[leadSource.property] = leadSource.value
  return { properties }
}

/**
 * The blanks-only fill for an existing contact, as a PATCH body.
 *
 * Only the fields an update may carry: the list fields plus persona and
 * owner. The lead source is refused here as well as at the plan, because it
 * is create-only, and `leadSource` is in the property map, so without this
 * check a fill that smuggled it past the plan would map cleanly into the
 * payload.
 */
const UPDATE_FIELDS = new Set([
  'firstName', 'lastName', 'phone', 'title', 'city', 'state', 'country', 'linkedinUrl', 'persona', 'owner'
])

function contactUpdateBody (config, fill) {
  const properties = {}
  for (const [field, value] of Object.entries(fill)) {
    if (!UPDATE_FIELDS.has(field)) continue
    const name = contactProperty(config, field)
    if (!name) continue
    properties[name] = value
  }
  return { properties }
}

/**
 * The lookups for the status lists the grid names: matched, or planned for
 * creation, which means asking the portal before planning a create. One GET
 * by name per list. THE BY-NAME ENDPOINT IS UNMEASURED: the measured list
 * surface is create, add and read membership. The live run proves this one,
 * and `judgeListLookup` refuses shapes it does not recognise rather than
 * reading absence into them.
 */
function listLookupRequests (names) {
  if (!Array.isArray(names)) throw new Error('listLookupRequests needs the list names the grid realised.')
  return names.map(name => spec(
    `list lookup: ${name}`,
    'GET',
    `/crm/v3/lists/object-type-id/0-1/name/${encodeURIComponent(name)}`
  ))
}

/**
 * What a saved list lookup means: `exists` with the listId, `absent` for the
 * portal's not-found refusal, `unknown` for anything else. Absent plans a
 * create; unknown is a question, because reading an unrecognised answer as
 * absent is how a second `Summit - Invited` gets created beside the first.
 */
function judgeListLookup (response, expectedName) {
  // An id or a name is compared only after its type is checked, never
  // through String() coercion: a truthy object listId read as
  // "[object Object]" would send every membership add to a list that
  // does not exist, and a coerced name would judge the binding on a
  // spelling the response never carried. The measured shapes carry the
  // id as a string or a number and the name as a string; anything else
  // is a question.
  const idShaped = value => typeof value === 'string' || typeof value === 'number'
  if (response && typeof response === 'object') {
    if (response.list && (response.list.listId || response.list.listId === 0)) {
      if (!idShaped(response.list.listId)) {
        return { outcome: 'unknown', why: `The envelope carries ${JSON.stringify(response.list.listId)} for its listId, which is not an id. Save the response whole and look at it.` }
      }
      // The envelope carries the list's own name (measured 2026-08-26),
      // and where it does, the answer is bound to its question by it: two
      // saved files passed in the wrong order would otherwise file each
      // list's id under the other, and every membership would land on the
      // wrong list. The bare listId shape below carries no name to check.
      if (response.list.name !== undefined && typeof response.list.name !== 'string') {
        return { outcome: 'unknown', why: `The envelope carries ${JSON.stringify(response.list.name)} for its name, which is not a list name. Save the response whole and look at it.` }
      }
      if (expectedName !== undefined && response.list.name !== undefined &&
          response.list.name !== String(expectedName)) {
        return {
          outcome: 'unknown',
          why: `The response names the list ${JSON.stringify(response.list.name)} where ${JSON.stringify(String(expectedName))} was asked for, so it answers a different lookup. The saved files are out of order.`
        }
      }
      return { outcome: 'exists', listId: String(response.list.listId) }
    }
    if (response.listId || response.listId === 0) {
      if (!idShaped(response.listId)) {
        return { outcome: 'unknown', why: `The response carries ${JSON.stringify(response.listId)} for its listId, which is not an id. Save the response whole and look at it.` }
      }
      return { outcome: 'exists', listId: String(response.listId) }
    }
    if (response.status === 'error' || response.category || response.message) {
      const text = `${response.category || ''} ${response.message || ''}`
      if (/NOT_FOUND|does not exist|404/i.test(text)) return { outcome: 'absent' }
      return { outcome: 'unknown', why: `The portal answered with an error this does not recognise as not-found: ${response.message || response.category}.` }
    }
  }
  return { outcome: 'unknown', why: 'The response is not a shape whose meaning is known here. Reading it as absent would create a duplicate list, so it is a question instead.' }
}

/**
 * The push, as request specs in dependency order: companies first, then
 * contacts, then associations, then lists, then memberships.
 *
 * PLACEHOLDERS ARE OPAQUE TOKENS, `{company:1}`, `{contact:12}`, `{list:2}`,
 * numbered rather than named, with the legend in `placeholders`. An earlier
 * version embedded raw company and list names in the tokens, so a company
 * whose name contained a brace, a slash or another token's spelling could
 * corrupt a URL or another substitution. A digit can do none of that. The
 * contact number is the row index; company and list numbers count through
 * the plan's creates. Records that already have ids (matched companies,
 * update and nothing rows) are referenced by those ids directly.
 */
/**
 * The plan shape the list fixes introduced, asserted rather than defaulted.
 * A plan built by an older step carries only `lists.names`, and treating
 * the missing fields as empty sent a membership add to list `undefined`
 * with no create in front of it. An obsolete shape is a plan to rebuild,
 * not to guess at.
 */
function assertPlanLists (plan, who) {
  if (!plan || !plan.lists || !Array.isArray(plan.lists.creates) || !Array.isArray(plan.lists.matched) ||
      !Array.isArray(plan.lists.memberships)) {
    throw new Error(
      `${who} needs a plan whose lists carry \`creates\`, \`matched\` and \`memberships\`, which the plan command builds ` +
      'from the judged list lookups. This plan does not, so it was built by an older step or edited by hand: run `plan` ' +
      'again rather than pushing a guess.'
    )
  }
}

function pushRequests (config, plan) {
  assertPlanLists(plan, 'push')
  const requests = []
  const placeholders = {}

  const companyToken = new Map()
  plan.companies.creates.forEach((company, at) => {
    const token = `{company:${at + 1}}`
    companyToken.set(company.name, token)
    placeholders[token] = { kind: 'company', key: company.name }
  })
  const listToken = new Map()
  plan.lists.creates.forEach((name, at) => {
    const token = `{list:${at + 1}}`
    listToken.set(name, token)
    placeholders[token] = { kind: 'list', key: name }
  })
  for (const create of plan.contacts.creates) {
    placeholders[`{contact:${create.index}}`] = { kind: 'contact', key: String(create.index) }
  }

  /**
   * A contact reference for a membership add: creates do not have ids yet
   * and get their token; updates and nothing rows already carry the CRM's
   * own id, and using it directly is what lets an existing contact land on
   * a list at all.
   */
  const contactRef = index => {
    const create = plan.contacts.creates.find(c => c.index === index)
    if (create) return `{contact:${index}}`
    const known = plan.contacts.updates.find(u => u.index === index) ||
      plan.contacts.nothing.find(n => n.index === index)
    if (known && known.contactId) return String(known.contactId)
    throw new Error(`Row ${index} is on a membership and is neither a planned create nor a row with a known contact id. The plan is inconsistent, and this is a bug in this plugin, not in the list.`)
  }

  for (const company of plan.companies.creates) {
    const properties = { [config.properties.company.name]: company.name }
    if (company.website && config.properties.company.website) {
      properties[config.properties.company.website] = company.website
    }
    requests.push(spec(`create company: ${company.name}`, 'POST', '/crm/v3/objects/companies', { properties }))
  }

  // The adoption fill on a matched company, the person's decision carried
  // by the plan: one PATCH by the id the match already names. Only the
  // contract's own company fields map, and the read-back proves what
  // landed.
  for (const matched of plan.companies.matched) {
    if (!matched.fill || !Object.keys(matched.fill).length) continue
    // Empty values never enter the payload, even when the caller skipped
    // the plan's own refusal: an empty PATCH value is a measured clear
    // (2026-08-25), and a fill that erases is the opposite of a fill.
    const filled = value => typeof value === 'string' && value.trim()
    const properties = {}
    if (filled(matched.fill.name)) properties[config.properties.company.name] = matched.fill.name
    if (filled(matched.fill.website) && config.properties.company.website) {
      properties[config.properties.company.website] = matched.fill.website
    }
    if (!Object.keys(properties).length) continue
    requests.push(spec(`fill company: ${matched.name}`, 'PATCH', `/crm/v3/objects/companies/${matched.companyId}`, { properties }))
  }

  for (const create of plan.contacts.creates) {
    requests.push(spec(`create contact: row ${create.index}`, 'POST', '/crm/v3/objects/contacts', contactCreateBody(config, create.row, plan.leadSource)))
  }
  for (const update of plan.contacts.updates) {
    requests.push(spec(`update contact: row ${update.index}`, 'PATCH', `/crm/v3/objects/contacts/${update.contactId}`, contactUpdateBody(config, update.fill)))
  }

  const companyIdFor = name => {
    const matched = plan.companies.matched.find(m => m.name === name)
    return matched ? matched.companyId : companyToken.get(name)
  }
  for (const create of plan.contacts.creates) {
    const company = create.row.fields.company
    if (!company) continue
    requests.push(spec(
      `associate: row ${create.index} to ${company}`,
      'PUT',
      `/crm/v4/objects/contacts/{contact:${create.index}}/associations/default/companies/${companyIdFor(company)}`
    ))
  }

  for (const name of plan.lists.creates) {
    requests.push(spec(`create list: ${name}`, 'POST', '/crm/v3/lists', {
      name,
      objectTypeId: '0-1',
      processingType: 'MANUAL'
    }))
  }
  const listIdFor = name => {
    const matched = plan.lists.matched.find(m => m.name === name)
    return matched ? matched.listId : listToken.get(name)
  }
  for (const membership of plan.lists.memberships) {
    requests.push(spec(
      `add to list: ${membership.list}`,
      'PUT',
      `/crm/v3/lists/${listIdFor(membership.list)}/memberships/add`,
      membership.rows.map(contactRef)
    ))
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
 *   created    a body carrying an id
 *   conflict   the duplicate create refusal, with the existing id pulled from
 *              the error text (measured: the CONFLICT error carries
 *              `Existing ID: <id>`). Reported with that id. Never improvised
 *              into an update nobody approved.
 *   no-op      the duplicate list add, an empty response (measured)
 *   failed     anything else with an error shape, reported as itself
 */
function judgeResponse (request, response) {
  if (response === null || response === undefined || response === '') {
    if (request.method === 'PUT' && request.url.includes('/memberships/add')) {
      return { outcome: 'no-op-or-done', why: 'A duplicate list add returns an empty response and changes nothing, and a successful one is confirmed by the membership read-back, not by this. Read the membership back.' }
    }
    return { outcome: 'unknown', why: 'The response is empty and this request is not one whose empty response has a measured meaning. Nothing about it is proved.' }
  }
  // Every created id has to be id-shaped before it becomes a verdict, the
  // rule judgeListLookup already holds: String() would spell an object
  // "[object Object]" into every read-back fetch built on it (round 6).
  // A malformed id falls through to the unknown arm.
  const idShaped = value => typeof value === 'string' || typeof value === 'number'
  if (typeof response === 'object' && response.id && idShaped(response.id)) {
    return { outcome: 'created', id: String(response.id) }
  }
  // A list create answers with `listId`, not `id`: the measured surface
  // ("listId returned", 2026-08-25). Without this arm a successful list
  // create judged as unknown, which reads as a push that half worked.
  if (typeof response === 'object' && idShaped(response.listId) &&
      (response.listId || response.listId === 0)) {
    return { outcome: 'created', id: String(response.listId) }
  }
  // The live run of 2026-08-26 measured the create wrapping that same id in
  // a `list` envelope, the shape the by-name lookup already answers with.
  // Both arms stay: each is a measured shape, and either carries the id.
  if (typeof response === 'object' && response.list && idShaped(response.list.listId) &&
      (response.list.listId || response.list.listId === 0)) {
    return { outcome: 'created', id: String(response.list.listId) }
  }
  // An association PUT answering COMPLETE with the pair in `results`,
  // measured 2026-08-26: the portal reports both directions of the default
  // association. Scoped to the request it was measured on. The read-back is
  // still the proof.
  if (request.method === 'PUT' && request.url.includes('/associations/') &&
      typeof response === 'object' && response.status === 'COMPLETE' && Array.isArray(response.results)) {
    return {
      outcome: 'done',
      why: 'The association answered COMPLETE with both directions in results, the shape measured 2026-08-26. The association read-back is still the proof.'
    }
  }
  // A membership add that added someone answers `recordsIdsAdded`, the
  // portal's own spelling, measured 2026-08-26. A duplicate add still
  // answers empty, the no-op arm above. The membership read-back is still
  // the proof.
  // Ids that are not id-shaped are not the measured shape, so a malformed
  // entry drops the whole answer to the unknown arm rather than being
  // String()-spelled into the report (round 7).
  if (request.method === 'PUT' && request.url.includes('/memberships/add') &&
      typeof response === 'object' && Array.isArray(response.recordsIdsAdded) &&
      response.recordsIdsAdded.every(idShaped)) {
    return {
      outcome: 'done',
      added: response.recordsIdsAdded.map(String),
      why: 'The add answered with the record ids it added, the shape measured 2026-08-26. The membership read-back is still the proof.'
    }
  }
  if (typeof response === 'object' && (response.status === 'error' || response.category || response.message)) {
    const text = String(response.message || '')
    // The duplicate-contact reading is scoped to the request it was measured
    // on: a contact create refused as CONFLICT. Read off any other request,
    // an incidental "Existing ID" in an error would misreport a company or
    // an update failure as a duplicate person.
    const isContactCreate = request.method === 'POST' && request.url.endsWith('/crm/v3/objects/contacts')
    const existing = /Existing ID:\s*(\d+)/.exec(text)
    if (isContactCreate && response.category === 'CONFLICT' && existing) {
      return {
        outcome: 'conflict',
        existingId: existing[1],
        why:
          'The portal refused this create because the email already belongs to a record, and named it. ' +
          'This is reported, and nothing here turns it into an update: an update nobody approved is an auto-resolved duplicate.'
      }
    }
    return { outcome: 'failed', why: text || 'The portal returned an error with no message.', category: response.category || null }
  }
  return { outcome: 'unknown', why: 'The response is not a shape whose meaning has been measured. Save it whole and judge it by hand rather than guessing.' }
}

// ----------------------------------------------------------------- read-backs

/**
 * The read-back fetches for everything the push claims to have written:
 * created contacts by the ids the push returned, updated contacts by the
 * ids the plan already carried (an update is a write like any other, and an
 * unread one is unproved), companies and list memberships.
 */
function readbackRequests (config, plan, pushedIds) {
  assertPlanLists(plan, 'readbacks')
  const requests = []
  const properties = contactPropertyNames(config).join(',')
  for (const [key, id] of Object.entries(pushedIds.contacts || {})) {
    requests.push(spec(`read back contact: row ${key}`, 'GET', `/crm/v3/objects/contacts/${id}?properties=${properties}`))
    requests.push(spec(`read back associations: row ${key}`, 'GET', `/crm/v4/objects/contacts/${id}/associations/companies`))
  }
  for (const update of plan.contacts.updates) {
    requests.push(spec(`read back contact: row ${update.index}`, 'GET', `/crm/v3/objects/contacts/${update.contactId}?properties=${properties}`))
  }
  for (const [name, id] of Object.entries(pushedIds.companies || {})) {
    requests.push(spec(`read back company: ${name}`, 'GET',
      `/crm/v3/objects/companies/${id}?properties=${[config.properties.company.name, config.properties.company.website].filter(Boolean).join(',')}`))
  }
  // A matched company with an adoption fill is read back by the id the
  // plan already carries: the fill is a write like any other, and an
  // unread one is unproved.
  for (const matched of plan.companies.matched) {
    if (!matched.fill || !Object.keys(matched.fill).length) continue
    requests.push(spec(`read back company: ${matched.name}`, 'GET',
      `/crm/v3/objects/companies/${matched.companyId}?properties=${[config.properties.company.name, config.properties.company.website].filter(Boolean).join(',')}`))
  }
  // MEMBERSHIP READS COME FROM THE PLAN, NOT FROM THE PUSHED IDS. The
  // pushed ids only hold lists this run created, and a run whose lists all
  // matched existing ones generated no membership read at all, so the
  // matched half of a normal run could never satisfy the proof.
  for (const membership of plan.lists.memberships) {
    const matched = plan.lists.matched.find(m => m.name === membership.list)
    const id = matched ? matched.listId : (pushedIds.lists || {})[membership.list]
    if (!id) continue // no id means the create never returned one; prove fails it as an absent read-back
    requests.push(spec(`read back memberships: ${membership.list}`, 'GET', `/crm/v3/lists/${id}/memberships`))
  }
  return requests
}

/**
 * The proof: the read-backs compared field by field against the approved
 * plan. An id is a locator, not a proof; this comparison is the proof, and
 * it says what it did not check.
 *
 * `readbacks` is `{contacts: {"<row index>": response}, companies: {...},
 * associations: {"<row index>": response}, memberships: {"<list name>":
 * response}}`, each response saved as it came.
 */
function prove (config, plan, pushedIds, readbacks) {
  assertPlanLists(plan, 'prove')
  const problems = []
  const checked = []
  const unchecked = []
  const back = reverseContactMap(config)

  // THE READ-BACK IS BOUND TO THE RECORD IT WAS FETCHED FOR, by the id the
  // measured GET envelope carries. Without this, a saved response filed
  // under the wrong key, or one response reused under two keys, proves a
  // write nothing read; the Salesforce half holds the same rule.
  const compareContact = (label, intended, response, expectedId) => {
    if (!response || typeof response !== 'object' || !response.properties) {
      problems.push({ what: label, why: 'No read-back to compare, so nothing about this write is proved.' })
      return
    }
    // The id has to be id-shaped before it can bind: String() coercion
    // matched an object id against an object locator, both spelled
    // "[object Object]", and proved a write nothing read.
    if (typeof response.id !== 'string' && typeof response.id !== 'number') {
      problems.push({
        what: label,
        why: `The read-back carries ${JSON.stringify(response.id === undefined ? null : response.id)} for its id, which is not an id, so it cannot be bound to the record it was fetched for. Nothing about this write is proved by it.`
      })
      return
    }
    if (String(response.id) !== String(expectedId)) {
      problems.push({
        what: label,
        why: `The read-back carries id ${JSON.stringify(response.id)} where ${JSON.stringify(String(expectedId))} was fetched, so it answers a different record, and nothing about this write is proved by it.`
      })
      return
    }
    for (const [name, sent] of Object.entries(intended.properties)) {
      const got = response.properties[name]
      // The measured portal answers every property as text, so a
      // non-string is refused rather than coerced equal, the same rule
      // the Salesforce proof holds: String() read a numeric 42 as a
      // faithful echo of the string "42".
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
    compareContact(`row ${create.index}`, contactCreateBody(config, create.row, plan.leadSource), (readbacks.contacts || {})[create.index], id)

    const company = create.row.fields.company
    if (company) {
      const association = (readbacks.associations || {})[create.index]
      const expected = (plan.companies.matched.find(m => m.name === company) || {}).companyId ||
        (pushedIds.companies || {})[company]
      if (!association || !Array.isArray(association.results)) {
        // A PROBLEM, NOT AN UNCHECKED. The plan promised this association,
        // so a proof with no read-back for it must fail, or a run that
        // skipped every association fetch would exit clean.
        problems.push({ what: `row ${create.index} association`, why: 'No association read-back was saved, and the plan promised this association. It is unproved, and unproved fails the proof.' })
      } else if (!expected) {
        problems.push({ what: `row ${create.index} association`, why: `No company id is known for "${company}", so the association cannot be checked against the right record.` })
      // BOTH SIDES ARE ID-SHAPED BEFORE THEY CAN COMPARE: String() spelled
      // an object toObjectId and an object planned id both
      // "[object Object]" and marked the association checked (round 7).
      } else if (typeof expected !== 'string' && typeof expected !== 'number') {
        problems.push({ what: `row ${create.index} association`, why: `The plan or push report carries ${JSON.stringify(expected)} for company "${company}", which is not an id, so the association cannot be checked. Save the file and look at it.` })
      } else if (association.results.some(r => !r || typeof r !== 'object' || Array.isArray(r))) {
        // A null entry in a saved file is refused before toObjectId is
        // read on it, the same object question the sibling proofs ask.
        const odd = association.results.find(r => !r || typeof r !== 'object' || Array.isArray(r))
        problems.push({ what: `row ${create.index} association`, why: `The association read-back holds ${JSON.stringify(odd === undefined ? null : odd)}, not a record. Save the response the read-back printed, whole, and look at it.` })
      } else if (association.results.some(r => r.toObjectId !== null && r.toObjectId !== undefined && typeof r.toObjectId !== 'string' && typeof r.toObjectId !== 'number')) {
        const odd = association.results.find(r => r.toObjectId !== null && r.toObjectId !== undefined && typeof r.toObjectId !== 'string' && typeof r.toObjectId !== 'number')
        problems.push({ what: `row ${create.index} association`, why: `The association read-back carries ${JSON.stringify(odd.toObjectId)} for toObjectId, which is not an id. A malformed value is refused rather than coerced equal.` })
      } else if (!association.results.some(r => String(r.toObjectId) === String(expected))) {
        problems.push({ what: `row ${create.index} association`, why: `The association to company ${expected} is not on the record that came back.` })
      } else {
        checked.push({ what: `row ${create.index} association` })
      }
    }
  }

  for (const update of plan.contacts.updates) {
    compareContact(`row ${update.index} (update)`, contactUpdateBody(config, update.fill), (readbacks.contacts || {})[update.index], update.contactId)
  }

  for (const company of plan.companies.creates) {
    const id = (pushedIds.companies || {})[company.name]
    const response = (readbacks.companies || {})[company.name]
    if (!id) {
      problems.push({ what: `company ${company.name}`, why: 'The push report has no id for this company, so there is nothing to read back.' })
      continue
    }
    const intended = { properties: { [config.properties.company.name]: company.name } }
    if (company.website && config.properties.company.website) {
      intended.properties[config.properties.company.website] = company.website
    }
    compareContact(`company ${company.name}`, intended, response, id)
  }

  // The adoption fill is proved like every other write: the plan promised
  // it, so its read-back is compared field by field, and an absent one
  // fails through compareContact's own no-read-back arm.
  for (const matched of plan.companies.matched) {
    if (!matched.fill || !Object.keys(matched.fill).length) continue
    // The intended set mirrors the push's own refusal of empty values, or
    // the proof would demand a write the push correctly never sent.
    const filled = value => typeof value === 'string' && value.trim()
    const intended = { properties: {} }
    if (filled(matched.fill.name)) intended.properties[config.properties.company.name] = matched.fill.name
    if (filled(matched.fill.website) && config.properties.company.website) {
      intended.properties[config.properties.company.website] = matched.fill.website
    }
    if (!Object.keys(intended.properties).length) continue
    compareContact(`company ${matched.name} (fill)`, intended, (readbacks.companies || {})[matched.name], matched.companyId)
  }

  for (const membership of plan.lists.memberships) {
    const response = (readbacks.memberships || {})[membership.list]
    if (!response || !Array.isArray(response.results)) {
      // The same rule as the association: a planned write with no read-back
      // fails the proof rather than sliding into unchecked.
      problems.push({ what: `list ${membership.list}`, why: 'No membership read-back was saved, and the plan put rows on this list. Who landed there is unproved, and unproved fails the proof.' })
      continue
    }
    // Membership entries are record ids, string or number, bare or under
    // recordId; anything else is refused rather than coerced, the same
    // discipline the Salesforce member proof holds.
    const idShapedEntry = r => (typeof r === 'string' || typeof r === 'number') ||
      (r && typeof r === 'object' && !Array.isArray(r) && (typeof r.recordId === 'string' || typeof r.recordId === 'number'))
    const malformed = response.results.find(r => !idShapedEntry(r))
    if (malformed !== undefined) {
      problems.push({
        what: `list ${membership.list}`,
        why: `The membership read-back holds ${JSON.stringify(malformed)} where a record id belongs, so this proof refuses to read it. Save the response as it came and look at it.`
      })
      continue
    }
    const onList = new Set(response.results.map(r => String(typeof r === 'object' ? r.recordId : r)))
    for (const index of membership.rows) {
      const id = (pushedIds.contacts || {})[index] ||
        ((plan.contacts.updates.find(u => u.index === index) || plan.contacts.nothing.find(n => n.index === index) || {}).contactId)
      if (!id) {
        unchecked.push({ what: `list ${membership.list}, row ${index}`, why: 'No contact id is known for this row, so its membership cannot be checked.' })
      } else if (!onList.has(String(id))) {
        problems.push({ what: `list ${membership.list}, row ${index}`, why: 'The contact is not in the membership read-back. The add did not land.' })
      } else {
        checked.push({ what: `list ${membership.list}, row ${index}` })
      }
    }
  }

  // THE PROOF SAYS WHAT IT CANNOT BIND. The measured membership envelope
  // carries record ids and no list identity, so unlike every single-record
  // read-back (bound by the id it carries) and the Salesforce half's
  // campaign-scoped reads (bound by their rows' CampaignId), a membership
  // response is bound only by the URL it was fetched from and the key it
  // was saved under. A response saved under the wrong list cannot be
  // detected here, and claiming otherwise would be the proof vouching for
  // a binding nothing carries.
  if (plan.lists.memberships.length) {
    unchecked.push({
      what: 'which list each membership read-back came from',
      why:
        'The measured membership envelope carries record ids and no list identity, so a membership response is bound ' +
        'only by the URL it was fetched from and the key it was saved under, never by its own content. Fetch and save ' +
        'them one list at a time.'
    })
  }

  unchecked.push({
    what: 'everything not named above',
    why: 'Only planned writes were compared. Fields the plan did not send, and records it did not touch, were not read.'
  })

  return { problems, checked, unchecked }
}

// -------------------------------------------------------------------- check

/**
 * The aliveness probe for `check`: one read-only request, judged by shape.
 * A limit-1 list of contacts is the cheapest read that exercises the key,
 * and `check` never runs anything paid.
 */
function probeRequest (config) {
  return spec('connection probe', 'GET', `/crm/v3/objects/contacts?limit=1&properties=${contactProperty(config, 'email')}`)
}

function judgeProbe (response) {
  if (response && typeof response === 'object' && Array.isArray(response.results)) {
    return { alive: true, why: 'The portal answered a read with the measured envelope. The key works for reads; writes are proved only by the live run.' }
  }
  if (response && typeof response === 'object' && (response.status === 'error' || response.category || response.message)) {
    return { alive: false, why: `The portal refused the probe: ${response.message || response.category || 'an error with no message'}.` }
  }
  return { alive: false, why: 'The probe response is not a shape this recognises, so the connection is not proved alive. Save the response whole and look at it.' }
}

module.exports = {
  BASE,
  SEARCH_BATCH,
  spec,
  contactProperty,
  reverseContactMap,
  contactPropertyNames,
  searchRequests,
  searchResults,
  companySearchRequests,
  listLookupRequests,
  judgeListLookup,
  contactCreateBody,
  contactUpdateBody,
  pushRequests,
  judgeResponse,
  readbackRequests,
  prove,
  probeRequest,
  judgeProbe
}

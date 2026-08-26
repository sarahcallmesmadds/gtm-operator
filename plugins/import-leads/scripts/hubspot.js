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
  const unique = [...new Set(emails.filter(e => typeof e === 'string' && e.trim()))]
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
      if (!result || typeof result.id !== 'string' && typeof result.id !== 'number') {
        throw new Error(`Response ${at + 1} holds a result with no id. Save what the portal returned.`)
      }
      const properties = {}
      for (const [name, value] of Object.entries(result.properties || {})) {
        const field = back[name]
        if (field) properties[field] = value
      }
      const email = properties.email ? String(properties.email).trim().toLowerCase() : null
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
  return companies.map((company, at) => {
    const filters = [{ propertyName: nameProperty, operator: 'CONTAINS_TOKEN', value: company.name }]
    const groups = [{ filters }]
    if (company.domain) {
      groups.push({ filters: [{ propertyName: 'domain', operator: 'EQ', value: company.domain }] })
    }
    return spec(
      `company search: ${company.name}`,
      'POST',
      '/crm/v3/objects/companies/search',
      { filterGroups: groups, properties: [nameProperty, websiteProperty, 'domain'], limit: 20 }
    )
  })
}

// -------------------------------------------------------------------- writes

/**
 * The properties payload for a contact create. Only fields with sources, and
 * the lead-source value when the plan carries one. Persona goes in only when
 * config maps a property for it and the row's persona names its source.
 */
function contactCreateBody (config, row, leadSource) {
  const properties = {}
  for (const [field, value] of Object.entries(row.fields)) {
    if (field === 'company' || field === 'companyDomain') continue
    const name = contactProperty(config, field)
    if (!name) continue
    properties[name] = value
  }
  if (row.persona && row.personaSource && contactProperty(config, 'persona')) {
    properties[contactProperty(config, 'persona')] = row.persona
  }
  if (leadSource) properties[leadSource.property] = leadSource.value
  return { properties }
}

/** The blanks-only fill for an existing contact, as a PATCH body. */
function contactUpdateBody (config, fill) {
  const properties = {}
  for (const [field, value] of Object.entries(fill)) {
    const name = contactProperty(config, field)
    if (!name) continue
    properties[name] = value
  }
  return { properties }
}

/**
 * The push, as request specs in dependency order: companies first, then
 * contacts, then associations, then lists, then memberships. Associations
 * and memberships reference records by the placeholders `{company:<name>}`,
 * `{contact:<row index>}` and `{list:<name>}`, because the ids do not exist
 * until the earlier requests return; the skill substitutes each id as it
 * arrives, and `judge-push` folds the measured refusals and no-ops into the
 * report instead of treating them as errors.
 */
function pushRequests (config, plan) {
  const requests = []

  for (const company of plan.companies.creates) {
    const properties = { [config.properties.company.name]: company.name }
    if (company.website) properties[config.properties.company.website] = company.website
    requests.push(spec(`create company: ${company.name}`, 'POST', '/crm/v3/objects/companies', { properties }))
  }

  for (const create of plan.contacts.creates) {
    requests.push(spec(`create contact: row ${create.index}`, 'POST', '/crm/v3/objects/contacts', contactCreateBody(config, create.row, plan.leadSource)))
  }
  for (const update of plan.contacts.updates) {
    requests.push(spec(`update contact: row ${update.index}`, 'PATCH', `/crm/v3/objects/contacts/${update.contactId}`, contactUpdateBody(config, update.fill)))
  }

  const companyIdFor = name => {
    const matched = plan.companies.matched.find(m => m.name === name)
    return matched ? matched.companyId : `{company:${name}}`
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

  for (const name of plan.lists.names) {
    requests.push(spec(`create list: ${name}`, 'POST', '/crm/v3/lists', {
      name,
      objectTypeId: '0-1',
      processingType: 'MANUAL'
    }))
  }
  for (const membership of plan.lists.memberships) {
    requests.push(spec(
      `add to list: ${membership.list}`,
      'PUT',
      `/crm/v3/lists/{list:${membership.list}}/memberships/add`,
      membership.rows.map(index => `{contact:${index}}`)
    ))
  }

  return {
    requests,
    note:
      'Send in this order, substituting each returned id into the placeholders before sending the request that carries them. ' +
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
  if (typeof response === 'object' && response.id) {
    return { outcome: 'created', id: String(response.id) }
  }
  if (typeof response === 'object' && (response.status === 'error' || response.category || response.message)) {
    const text = String(response.message || '')
    const existing = /Existing ID:\s*(\d+)/.exec(text)
    if (existing) {
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

/** The read-back fetches for everything the push claims to have written. */
function readbackRequests (config, plan, pushedIds) {
  const requests = []
  const properties = contactPropertyNames(config).join(',')
  for (const [key, id] of Object.entries(pushedIds.contacts || {})) {
    requests.push(spec(`read back contact: row ${key}`, 'GET', `/crm/v3/objects/contacts/${id}?properties=${properties}`))
    requests.push(spec(`read back associations: row ${key}`, 'GET', `/crm/v4/objects/contacts/${id}/associations/companies`))
  }
  for (const [name, id] of Object.entries(pushedIds.companies || {})) {
    requests.push(spec(`read back company: ${name}`, 'GET',
      `/crm/v3/objects/companies/${id}?properties=${[config.properties.company.name, config.properties.company.website].join(',')}`))
  }
  for (const [name, id] of Object.entries(pushedIds.lists || {})) {
    requests.push(spec(`read back memberships: ${name}`, 'GET', `/crm/v3/lists/${id}/memberships`))
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
  const problems = []
  const checked = []
  const unchecked = []
  const back = reverseContactMap(config)

  const compareContact = (label, intended, response) => {
    if (!response || typeof response !== 'object' || !response.properties) {
      problems.push({ what: label, why: 'No read-back to compare, so nothing about this write is proved.' })
      return
    }
    for (const [name, sent] of Object.entries(intended.properties)) {
      const got = response.properties[name]
      if (got === undefined || got === null || String(got) !== String(sent)) {
        problems.push({ what: `${label}, ${name}`, why: `Sent ${JSON.stringify(sent)} and the record came back with ${JSON.stringify(got === undefined ? null : got)}.` })
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
    compareContact(`row ${create.index}`, contactCreateBody(config, create.row, plan.leadSource), (readbacks.contacts || {})[create.index])

    const company = create.row.fields.company
    if (company) {
      const association = (readbacks.associations || {})[create.index]
      const expected = (plan.companies.matched.find(m => m.name === company) || {}).companyId ||
        (pushedIds.companies || {})[company]
      if (!association || !Array.isArray(association.results)) {
        unchecked.push({ what: `row ${create.index} association`, why: 'No association read-back was saved, so whether the company association landed is not checked.' })
      } else if (!expected) {
        problems.push({ what: `row ${create.index} association`, why: `No company id is known for "${company}", so the association cannot be checked against the right record.` })
      } else if (!association.results.some(r => String(r.toObjectId) === String(expected))) {
        problems.push({ what: `row ${create.index} association`, why: `The association to company ${expected} is not on the record that came back.` })
      } else {
        checked.push({ what: `row ${create.index} association` })
      }
    }
  }

  for (const update of plan.contacts.updates) {
    compareContact(`row ${update.index} (update)`, contactUpdateBody(config, update.fill), (readbacks.contacts || {})[update.index])
  }

  for (const company of plan.companies.creates) {
    const id = (pushedIds.companies || {})[company.name]
    const response = (readbacks.companies || {})[company.name]
    if (!id) {
      problems.push({ what: `company ${company.name}`, why: 'The push report has no id for this company, so there is nothing to read back.' })
      continue
    }
    const intended = { properties: { [config.properties.company.name]: company.name } }
    if (company.website) intended.properties[config.properties.company.website] = company.website
    compareContact(`company ${company.name}`, intended, response)
  }

  for (const membership of plan.lists.memberships) {
    const response = (readbacks.memberships || {})[membership.list]
    if (!response || !Array.isArray(response.results)) {
      unchecked.push({ what: `list ${membership.list}`, why: 'No membership read-back was saved, so who landed on this list is not checked.' })
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
  contactCreateBody,
  contactUpdateBody,
  pushRequests,
  judgeResponse,
  readbackRequests,
  prove,
  probeRequest,
  judgeProbe
}

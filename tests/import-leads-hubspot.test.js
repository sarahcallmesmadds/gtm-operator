'use strict'

/**
 * Tests for the HubSpot half: request building and response judging.
 *
 * WHAT A GREEN RUN HERE MEANS, said plainly: these suites prove the requests
 * are built from the plan and the config as intended, and that the judges
 * read the measured response shapes as measured. They cannot prove the
 * portal accepts any of it. The live acceptance run is the release gate, and
 * until it is recorded in DECISIONS.md nothing about the live surface is
 * proved by this file.
 *
 * Run: node tests/import-leads-hubspot.test.js
 */

const assert = require('assert')

const hubspot = require('../plugins/import-leads/scripts/hubspot')

let failures = 0
const check = (name, fn) => {
  try {
    fn()
    console.log(`  ok    ${name}`)
  } catch (err) {
    failures++
    console.log(`  FAIL  ${name}`)
    console.log(`        ${err.message.split('\n').join('\n        ')}`)
  }
}

console.log('\nimport-leads hubspot requests and judges\n')

const config = () => ({
  portalId: '111222333',
  properties: {
    contact: {
      firstName: 'firstname',
      lastName: 'lastname',
      email: 'email',
      phone: 'phone',
      title: 'jobtitle',
      city: 'city',
      state: 'state',
      country: 'country',
      persona: 'org_persona',
      leadSource: 'lead_source'
    },
    company: { name: 'name', website: 'website' }
  }
})

const row = (index, fields, extra) => Object.assign({
  index,
  source: {},
  fields,
  fieldSources: Object.fromEntries(Object.keys(fields).map(k => [k, 'list']))
}, extra)

// ------------------------------------------------------------------- search

check('searches batch emails 100 per request, the batch size carried from the reference', () => {
  const emails = Array.from({ length: 250 }, (_, i) => `p${i}@x.com`)
  const requests = hubspot.searchRequests(config(), emails)
  assert.strictEqual(requests.length, 3)
  assert.strictEqual(requests[0].body.filterGroups[0].filters[0].values.length, 100)
  assert.strictEqual(requests[2].body.filterGroups[0].filters[0].values.length, 50)
  assert.strictEqual(requests[0].body.filterGroups[0].filters[0].operator, 'IN')
  assert.strictEqual(requests[0].body.filterGroups[0].filters[0].propertyName, 'email')
  assert.ok(requests[0].body.properties.includes('jobtitle'), 'every mapped property is asked for, or blanks cannot be seen')
  assert.ok(requests[0].body.properties.includes('company'), 'the default company property rides along for the conflict check')
})

check('duplicate emails collapse before batching', () => {
  const requests = hubspot.searchRequests(config(), ['a@x.com', 'a@x.com', 'b@x.com'])
  assert.strictEqual(requests[0].body.filterGroups[0].filters[0].values.length, 2)
})

check('emails fold before searching, so an enrichment spelling cannot miss its match', () => {
  const requests = hubspot.searchRequests(config(), [' Ada@X.com ', 'ada@x.com'])
  assert.deepStrictEqual(requests[0].body.filterGroups[0].filters[0].values, ['ada@x.com'])
})

check('search results normalise to contacts by lowercased email, keyed by canonical field', () => {
  const result = hubspot.searchResults(config(), [{
    total: 1,
    results: [{ id: 201, properties: { email: 'Grace@X.com', jobtitle: 'Admiral', company: 'Navy' } }]
  }])
  assert.strictEqual(result.found, 1)
  const match = result.byEmail['grace@x.com']
  assert.strictEqual(match.id, '201')
  assert.strictEqual(match.properties.title, 'Admiral')
  assert.strictEqual(match.properties.company, 'Navy')
})

check('an unrecognised envelope is refused: a guess would read as a CRM with nobody in it', () => {
  assert.throws(() => hubspot.searchResults(config(), [{ rows: [] }]), /measured search envelope/)
})

check('a paged response is reported incomplete, because an unfetched contact is an unseen duplicate', () => {
  const result = hubspot.searchResults(config(), [{ total: 300, results: [], paging: { next: { after: '100' } } }])
  assert.strictEqual(result.incomplete.length, 1)
})

// -------------------------------------------------------------------- bodies

check('a create body carries mapped fields, the persona only with its source, and the lead source', () => {
  const withPersona = row(1, { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@x.com', company: 'Acme' },
    { persona: 'Marketing Leader', personaSource: 'personas-artifact' })
  const body = hubspot.contactCreateBody(config(), withPersona, { property: 'lead_source', value: 'Content' })
  assert.deepStrictEqual(body.properties, {
    firstname: 'Ada',
    lastname: 'Lovelace',
    email: 'ada@x.com',
    org_persona: 'Marketing Leader',
    lead_source: 'Content'
  })
  assert.ok(!('company' in body.properties) && !('name' in body.properties), 'the company travels as an association, not as a contact property')
})

check('a sourceless field never enters a create payload, even when the caller skipped the gate', () => {
  const smuggled = row(1, { firstName: 'Ada', lastName: 'L', email: 'a@x.com' })
  smuggled.fields.title = 'Invented'
  delete smuggled.fieldSources.title
  const body = hubspot.contactCreateBody(config(), smuggled, null)
  assert.ok(!('jobtitle' in body.properties), 'a value with no source is refused at the payload as well as at the gate')
})

check('a confirmed owner is written when config maps a property, and a sourceless one never is', () => {
  const withOwner = config()
  withOwner.properties.contact.owner = 'hubspot_owner_id'
  const routed = row(1, { firstName: 'Ada', lastName: 'L', email: 'a@x.com' }, { owner: 'owner-9', ownerSource: 'routing' })
  assert.strictEqual(hubspot.contactCreateBody(withOwner, routed, null).properties.hubspot_owner_id, 'owner-9')
  const guessed = row(1, { firstName: 'Ada', lastName: 'L', email: 'a@x.com' }, { owner: 'owner-9' })
  assert.ok(!('hubspot_owner_id' in hubspot.contactCreateBody(withOwner, guessed, null).properties))
})

check('a persona with no source never enters a payload', () => {
  const sourceless = row(1, { firstName: 'Ada', lastName: 'L', email: 'a@x.com' }, { persona: 'Guessed' })
  const body = hubspot.contactCreateBody(config(), sourceless, null)
  assert.ok(!('org_persona' in body.properties))
})

check('a field config maps nowhere stays out of the payload rather than inventing a property name', () => {
  const partial = config()
  delete partial.properties.contact.persona
  const withPersona = row(1, { firstName: 'Ada', lastName: 'L', email: 'a@x.com' },
    { persona: 'Marketing Leader', personaSource: 'personas-artifact' })
  const body = hubspot.contactCreateBody(partial, withPersona, null)
  assert.ok(!Object.values(body.properties).includes('Marketing Leader'))
})

check('an update body is the fill and nothing else', () => {
  const body = hubspot.contactUpdateBody(config(), { title: 'Admiral', phone: '+15550102030' })
  assert.deepStrictEqual(body.properties, { jobtitle: 'Admiral', phone: '+15550102030' })
})

check('an update body refuses the lead source and unknown fields even when the plan was bypassed', () => {
  const body = hubspot.contactUpdateBody(config(), { title: 'Admiral', leadSource: 'Imported', email: 'new@x.com', invented: 'x' })
  assert.deepStrictEqual(body.properties, { jobtitle: 'Admiral' }, 'the lead source is create-only, and email and unknown fields never ride an update')
})

check('the domain lookup is its own request, never OR-ed into the name search', () => {
  // A broad name can fill the single page and push the exact domain hit
  // off it, recreating the nameless-company miss the domain half exists
  // to prevent.
  const requests = hubspot.companySearchRequests(config(), [
    { name: 'Acme', domain: 'acme.example' },
    { name: 'Bare Co', domain: null }
  ])
  assert.strictEqual(requests.length, 3)
  const byName = requests.find(r => r.label === 'company search: Acme')
  assert.strictEqual(byName.body.filterGroups.length, 1)
  assert.strictEqual(byName.body.filterGroups[0].filters[0].operator, 'CONTAINS_TOKEN')
  const byDomain = requests.find(r => r.label === 'company search by domain: Acme')
  assert.strictEqual(byDomain.body.filterGroups.length, 1)
  assert.deepStrictEqual(byDomain.body.filterGroups[0].filters[0], { propertyName: 'domain', operator: 'EQ', value: 'acme.example' })
  assert.ok(!requests.find(r => r.label === 'company search by domain: Bare Co'), 'no domain, no domain request')
})

// -------------------------------------------------------------------- push

const smallPlan = () => ({
  companies: {
    creates: [{ name: 'Acme', website: 'acme.example', rows: [1] }],
    matched: [{ name: 'Navy', companyId: '900', rows: [2] }]
  },
  contacts: {
    creates: [
      { index: 1, row: row(1, { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@x.com', company: 'Acme' }) },
      { index: 2, row: row(2, { firstName: 'Grace', lastName: 'Hopper', email: 'grace@x.com', company: 'Navy' }) }
    ],
    updates: [{ index: 3, contactId: '301', fill: { title: 'Countess' } }],
    nothing: [],
    excluded: []
  },
  lists: {
    names: ['Summit - Attended', 'Summit - Invited'],
    creates: ['Summit - Invited'],
    matched: [{ name: 'Summit - Attended', listId: '702' }],
    memberships: [
      { list: 'Summit - Invited', rows: [1, 2] },
      { list: 'Summit - Attended', rows: [3] }
    ]
  },
  leadSource: null,
  writeback: { kind: 'none' }
})

check('the push emits companies, contacts, associations, lists and memberships, in dependency order', () => {
  const { requests } = hubspot.pushRequests(config(), smallPlan())
  const labels = requests.map(r => r.label)
  assert.ok(labels.indexOf('create company: Acme') < labels.indexOf('create contact: row 1'))
  assert.ok(labels.indexOf('create contact: row 1') < labels.indexOf('associate: row 1 to Acme'))
  assert.ok(labels.indexOf('create list: Summit - Invited') < labels.indexOf('add to list: Summit - Invited'))
})

check('placeholders are opaque numbered tokens with a legend, never raw names', () => {
  const { requests, placeholders } = hubspot.pushRequests(config(), smallPlan())
  const toAcme = requests.find(r => r.label === 'associate: row 1 to Acme')
  const toNavy = requests.find(r => r.label === 'associate: row 2 to Navy')
  assert.ok(toAcme.url.endsWith('/companies/{company:1}'), toAcme.url)
  assert.ok(toAcme.url.includes('/contacts/{contact:1}/'))
  assert.ok(toNavy.url.endsWith('/companies/900'), 'a matched company already has its id')
  assert.deepStrictEqual(placeholders['{company:1}'], { kind: 'company', key: 'Acme' })
  assert.deepStrictEqual(placeholders['{contact:1}'], { kind: 'contact', key: '1' })
})

check('a company named like a token cannot corrupt a substitution, because names never enter tokens', () => {
  const plan = smallPlan()
  plan.companies.creates[0].name = '{contact:2}'
  plan.contacts.creates[0].row.fields.company = '{contact:2}'
  const { requests, placeholders } = hubspot.pushRequests(config(), plan)
  const associate = requests.find(r => r.label.startsWith('associate: row 1'))
  assert.ok(associate.url.endsWith('/companies/{company:1}'), associate.url)
  assert.deepStrictEqual(placeholders['{company:1}'], { kind: 'company', key: '{contact:2}' })
})

check('memberships reference creates by token and existing contacts by their known id', () => {
  const { requests } = hubspot.pushRequests(config(), smallPlan())
  const invited = requests.find(r => r.label === 'add to list: Summit - Invited')
  assert.deepStrictEqual(invited.body, ['{contact:1}', '{contact:2}'])
  const attended = requests.find(r => r.label === 'add to list: Summit - Attended')
  assert.deepStrictEqual(attended.body, ['301'], 'the update row already has its CRM id, and a placeholder for it would never resolve')
  assert.ok(attended.url.includes('/lists/702/'), 'a matched list is addressed by its id, not created again')
  assert.ok(invited.url.includes('/lists/{list:1}/'))
})

check('only lists judged absent are created; matched lists get no create request', () => {
  const { requests } = hubspot.pushRequests(config(), smallPlan())
  assert.ok(requests.find(r => r.label === 'create list: Summit - Invited'))
  assert.ok(!requests.find(r => r.label === 'create list: Summit - Attended'))
})

check('a membership row with no known id and no planned create is refused as the plan bug it is', () => {
  const plan = smallPlan()
  plan.lists.memberships[0].rows.push(99)
  assert.throws(() => hubspot.pushRequests(config(), plan), /Row 99/)
})

check('an update goes to the existing record and carries only the fill', () => {
  const { requests } = hubspot.pushRequests(config(), smallPlan())
  const update = requests.find(r => r.label === 'update contact: row 3')
  assert.ok(update.url.endsWith('/crm/v3/objects/contacts/301'))
  assert.deepStrictEqual(update.body.properties, { jobtitle: 'Countess' })
})

// ------------------------------------------------------------------- judging

check('a body with an id judges as created', () => {
  const judged = hubspot.judgeResponse({ method: 'POST', url: 'x', label: 'create' }, { id: 501, properties: {} })
  assert.deepStrictEqual(judged, { outcome: 'created', id: '501' })
})

check('a list create answers with listId, the measured shape, and judges as created', () => {
  const judged = hubspot.judgeResponse(
    { method: 'POST', url: hubspot.BASE + '/crm/v3/lists', label: 'create list' },
    { listId: 703, name: 'Summit - Invited' }
  )
  assert.deepStrictEqual(judged, { outcome: 'created', id: '703' })
})

check('a list create wrapping its listId in a list envelope, the shape measured live 2026-08-26, judges as created', () => {
  const judged = hubspot.judgeResponse(
    { method: 'POST', url: hubspot.BASE + '/crm/v3/lists', label: 'create list' },
    { list: { listId: '704', name: 'Summit - Attended', processingType: 'MANUAL' } }
  )
  assert.deepStrictEqual(judged, { outcome: 'created', id: '704' })
})

check('an association PUT answering COMPLETE with both directions judges done, scoped to association requests', () => {
  const body = {
    status: 'COMPLETE',
    results: [
      { from: { id: '501' }, to: { id: '601' }, associationSpec: { associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 279 } },
      { from: { id: '601' }, to: { id: '501' }, associationSpec: { associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 280 } }
    ]
  }
  const judged = hubspot.judgeResponse(
    { method: 'PUT', url: hubspot.BASE + '/crm/v4/objects/contacts/501/associations/default/companies/601', label: 'associate' },
    body
  )
  assert.strictEqual(judged.outcome, 'done')
  assert.ok(/read-back is still the proof/.test(judged.why))
  const elsewhere = hubspot.judgeResponse(
    { method: 'POST', url: hubspot.BASE + '/crm/v3/objects/contacts', label: 'create' },
    body
  )
  assert.strictEqual(elsewhere.outcome, 'unknown', 'the COMPLETE reading is scoped to the request it was measured on')
})

check('a membership add answering recordsIdsAdded, the portal\'s own spelling, judges done with the ids', () => {
  const judged = hubspot.judgeResponse(
    { method: 'PUT', url: hubspot.BASE + '/crm/v3/lists/15/memberships/add', label: 'add' },
    { recordsIdsAdded: ['501', 502] }
  )
  assert.strictEqual(judged.outcome, 'done')
  assert.deepStrictEqual(judged.added, ['501', '502'])
  const elsewhere = hubspot.judgeResponse(
    { method: 'POST', url: hubspot.BASE + '/crm/v3/objects/contacts', label: 'create' },
    { recordsIdsAdded: ['501'] }
  )
  assert.strictEqual(elsewhere.outcome, 'unknown', 'the recordsIdsAdded reading is scoped to the membership add')
})

check('the duplicate create refusal carries the existing id out of the error text, and is never an update', () => {
  const judged = hubspot.judgeResponse(
    { method: 'POST', url: hubspot.BASE + '/crm/v3/objects/contacts', label: 'create' },
    { status: 'error', category: 'CONFLICT', message: 'Contact already exists. Existing ID: 12345' }
  )
  assert.strictEqual(judged.outcome, 'conflict')
  assert.strictEqual(judged.existingId, '12345')
  assert.ok(/nothing here turns it into an update/.test(judged.why))
})

check('the duplicate reading is scoped to a contact create: the same words on any other request judge as failed', () => {
  const companyCreate = hubspot.judgeResponse(
    { method: 'POST', url: hubspot.BASE + '/crm/v3/objects/companies', label: 'create company' },
    { status: 'error', category: 'CONFLICT', message: 'Existing ID: 999' }
  )
  assert.strictEqual(companyCreate.outcome, 'failed', 'a company error is not a duplicate person')
  const patch = hubspot.judgeResponse(
    { method: 'PATCH', url: hubspot.BASE + '/crm/v3/objects/contacts/301', label: 'update' },
    { status: 'error', category: 'VALIDATION_ERROR', message: 'bad value near Existing ID: 55' }
  )
  assert.strictEqual(patch.outcome, 'failed')
})

check('an empty response to a membership add is the measured silent no-op, pointed at the read-back', () => {
  const judged = hubspot.judgeResponse(
    { method: 'PUT', url: hubspot.BASE + '/crm/v3/lists/9/memberships/add', label: 'add' },
    null
  )
  assert.strictEqual(judged.outcome, 'no-op-or-done')
})

check('an empty response anywhere else proves nothing and says so', () => {
  const judged = hubspot.judgeResponse({ method: 'POST', url: 'x', label: 'create' }, '')
  assert.strictEqual(judged.outcome, 'unknown')
})

check('an unmeasured shape is unknown, never guessed', () => {
  const judged = hubspot.judgeResponse({ method: 'POST', url: 'x', label: 'create' }, { odd: true })
  assert.strictEqual(judged.outcome, 'unknown')
})

// -------------------------------------------------------------------- prove

const pushedIds = () => ({
  contacts: { 1: '501', 2: '502' },
  companies: { Acme: '601' },
  lists: { 'Summit - Invited': '701' }
})

const cleanReadbacks = () => ({
  contacts: {
    1: { id: '501', properties: { firstname: 'Ada', lastname: 'Lovelace', email: 'ada@x.com' } },
    2: { id: '502', properties: { firstname: 'Grace', lastname: 'Hopper', email: 'grace@x.com' } },
    3: { id: '301', properties: { jobtitle: 'Countess' } }
  },
  associations: {
    1: { results: [{ toObjectId: 601 }] },
    2: { results: [{ toObjectId: 900 }] }
  },
  companies: { Acme: { id: '601', properties: { name: 'Acme', website: 'acme.example' } } },
  memberships: {
    'Summit - Invited': { results: [{ recordId: '501' }, { recordId: '502' }] },
    'Summit - Attended': { results: [{ recordId: '301' }] }
  }
})

check('a clean set of read-backs proves every planned write and still names what it did not check', () => {
  const proof = hubspot.prove(config(), smallPlan(), pushedIds(), cleanReadbacks())
  assert.deepStrictEqual(proof.problems, [], JSON.stringify(proof.problems))
  // Every planned write is asserted by name, not by count: a count passes
  // when a whole category of check silently stops running.
  const checked = proof.checked.map(c => c.what)
  for (const expected of [
    'row 1, firstName', 'row 2, firstName', 'row 1 association', 'row 2 association',
    'row 3 (update), title', 'company Acme, name',
    'list Summit - Invited, row 1', 'list Summit - Invited, row 2', 'list Summit - Attended, row 3'
  ]) {
    assert.ok(checked.includes(expected), `expected "${expected}" among the checked, got: ${checked.join(' | ')}`)
  }
  assert.ok(proof.unchecked.some(u => /not named above/.test(u.what)), 'the proof says its own limits, every time')
})

check('a property that came back different is a problem naming both values', () => {
  const readbacks = cleanReadbacks()
  readbacks.contacts[1].properties.firstname = 'Ad'
  const proof = hubspot.prove(config(), smallPlan(), pushedIds(), readbacks)
  assert.ok(proof.problems.some(p => /row 1, firstname/.test(p.what) && /"Ada"/.test(p.why) && /"Ad"/.test(p.why)))
})

check('a search result whose email is not text is refused, never coerced into an identity', () => {
  assert.throws(() => hubspot.searchResults(config(), [{ total: 1, results: [{ id: '1', properties: { email: { odd: true } } }] }]), /not text/)
})

check('a read-back or membership entry whose id is not an id fails the proof instead of coercing', () => {
  // The round-5 repro: an object read-back id bound to an object pushed
  // locator, both spelled "[object Object]" by String(), and the row was
  // marked checked.
  const objectId = cleanReadbacks()
  objectId.contacts[1] = { id: { odd: true }, properties: { firstname: 'Ada', lastname: 'Lovelace', email: 'ada@x.com' } }
  const ids = pushedIds()
  ids.contacts[1] = {}
  const first = hubspot.prove(config(), smallPlan(), ids, objectId)
  assert.ok(first.problems.some(p => /^row 1$/.test(p.what) && /not an id/.test(p.why)))

  const badEntry = cleanReadbacks()
  badEntry.memberships['Summit - Invited'] = { results: [{ recordId: { odd: true } }] }
  const second = hubspot.prove(config(), smallPlan(), pushedIds(), badEntry)
  assert.ok(second.problems.some(p => /list Summit - Invited/.test(p.what) && /refuses to read/.test(p.why)))
})

check('a create response whose id is not id-shaped is never judged created: "[object Object]" is not an id', () => {
  // THE ROUND-6 REPRO: an object id String()-coerced into a created
  // verdict on any of the three measured create envelopes.
  assert.strictEqual(hubspot.judgeResponse({ method: 'POST', url: 'x', label: 'create' }, { id: { odd: true } }).outcome, 'unknown')
  assert.strictEqual(hubspot.judgeResponse({ method: 'POST', url: 'x', label: 'list' }, { listId: { odd: true } }).outcome, 'unknown')
  assert.strictEqual(hubspot.judgeResponse({ method: 'POST', url: 'x', label: 'list' }, { list: { listId: { odd: true } } }).outcome, 'unknown')
})

check('a search result that is not a record is refused by name, apart from a result with no id', () => {
  assert.throws(() => hubspot.searchResults(config(), [{ total: 1, results: [null] }]), /not a record/)
  assert.throws(() => hubspot.searchResults(config(), [{ total: 1, results: [{ properties: {} }] }]), /no id/)
  assert.throws(() => hubspot.searchResults(config(), [{ total: 1, results: [{ id: '', properties: { email: 'x@y.com' } }] }]), /no id/)
})

check('a search result with a malformed properties container or value is refused, never read around', () => {
  // Round 7: Object.entries over a string spreads its characters, none
  // mapped, and the contact silently vanished from the dedupe; and the
  // round-1 email rule reaches its sibling values.
  assert.throws(() => hubspot.searchResults(config(), [{ total: 1, results: [{ id: '1', properties: 'not-a-record' }] }]), /not a record/)
  assert.throws(() => hubspot.searchResults(config(), [{ total: 1, results: [{ id: '1', properties: { phone: { odd: true } } }] }]), /not text/)
})

check('an association proof refuses a malformed id on either side, never coerced equal as "[object Object]"', () => {
  // THE ROUND-7 REPRO: an object toObjectId against an object pushed id,
  // both spelled "[object Object]" by String(), marked the association
  // checked with zero problems.
  // The sharpest form: an object planned id against the literal string
  // "[object Object]" on the read-back, which String() coerces equal.
  const ids = pushedIds()
  ids.companies.Acme = { odd: true }
  const bothSides = cleanReadbacks()
  bothSides.associations[1] = { results: [{ toObjectId: '[object Object]' }] }
  const first = hubspot.prove(config(), smallPlan(), ids, bothSides)
  assert.ok(first.problems.some(p => /row 1 association/.test(p.what) && /not an id/.test(p.why)))

  const recordSide = cleanReadbacks()
  recordSide.associations[1] = { results: [{ toObjectId: { odd: true } }] }
  const second = hubspot.prove(config(), smallPlan(), pushedIds(), recordSide)
  assert.ok(second.problems.some(p => /row 1 association/.test(p.what) && /not an id/.test(p.why)))
})

check('a membership add whose returned ids are not id-shaped is not the measured done shape', () => {
  const judged = hubspot.judgeResponse(
    { method: 'PUT', url: hubspot.BASE + '/crm/v3/lists/9/memberships/add', label: 'add' },
    { recordsIdsAdded: [{ odd: true }] }
  )
  assert.strictEqual(judged.outcome, 'unknown')
})

check('a null entry in an association read-back is refused by the proof, never dereferenced', () => {
  // THE ROUND-5 REPRO: [null] in the association results crashed on
  // toObjectId where the sibling proofs refuse a non-record row.
  const readbacks = cleanReadbacks()
  readbacks.associations[1] = { results: [null] }
  const proof = hubspot.prove(config(), smallPlan(), pushedIds(), readbacks)
  assert.ok(proof.problems.some(p => /row 1 association/.test(p.what) && /not a record/.test(p.why)))
})

check('a property that came back as a number is refused by the proof, not coerced equal', () => {
  const plan = smallPlan()
  plan.contacts.updates[0].fill = { title: '42' }
  const readbacks = cleanReadbacks()
  readbacks.contacts[3] = { id: '301', properties: { jobtitle: 42 } }
  const proof = hubspot.prove(config(), plan, pushedIds(), readbacks)
  assert.ok(proof.problems.some(p => /row 3 \(update\), jobtitle/.test(p.what) && /not text/.test(p.why)))
})

check('a list lookup with a malformed listId or name is a question, never coerced', () => {
  // A truthy object listId read through String() becomes "[object Object]"
  // and every membership add goes to a list that does not exist; a
  // non-string name judges the binding on a coerced spelling. Both are
  // refused, the same wrong-type rule the status judge holds.
  assert.strictEqual(hubspot.judgeListLookup({ list: { listId: { odd: true }, name: 'Summit - Invited' } }, 'Summit - Invited').outcome, 'unknown')
  assert.strictEqual(hubspot.judgeListLookup({ list: { listId: 7, name: 3 } }, '3').outcome, 'unknown')
  assert.strictEqual(hubspot.judgeListLookup({ listId: true }).outcome, 'unknown')
  assert.deepStrictEqual(hubspot.judgeListLookup({ listId: 0 }), { outcome: 'exists', listId: '0' }, 'the measured numeric id, zero included, still matches')
})

check('the proof names the membership binding limit: the envelope carries no list identity', () => {
  const proof = hubspot.prove(config(), smallPlan(), pushedIds(), cleanReadbacks())
  assert.ok(proof.unchecked.some(u => /which list each membership read-back came from/.test(u.what)),
    'a limit the proof cannot close is said, not silently carried')
})

check('a read-back answering a different record than was fetched fails the proof instead of proving it', () => {
  // The same binding rule the Salesforce half holds: a response filed
  // under the wrong key, or reused under two keys, proves nothing.
  const wrongContact = cleanReadbacks()
  wrongContact.contacts[1] = { id: '999', properties: { firstname: 'Ada', lastname: 'Lovelace', email: 'ada@x.com' } }
  const contacts = hubspot.prove(config(), smallPlan(), pushedIds(), wrongContact)
  assert.ok(contacts.problems.some(p => /^row 1$/.test(p.what) && /answers a different record/.test(p.why)))

  const wrongCompany = cleanReadbacks()
  wrongCompany.companies.Acme = { id: '999', properties: { name: 'Acme', website: 'acme.example' } }
  const companies = hubspot.prove(config(), smallPlan(), pushedIds(), wrongCompany)
  assert.ok(companies.problems.some(p => /company Acme/.test(p.what) && /answers a different record/.test(p.why)))
})

check('a missing association and a missing membership are problems, not passes', () => {
  const readbacks = cleanReadbacks()
  readbacks.associations[1] = { results: [] }
  readbacks.memberships['Summit - Invited'] = { results: [{ recordId: '501' }] }
  const proof = hubspot.prove(config(), smallPlan(), pushedIds(), readbacks)
  assert.ok(proof.problems.some(p => /row 1 association/.test(p.what)))
  assert.ok(proof.problems.some(p => /row 2/.test(p.what) && /not in the membership read-back/.test(p.why)))
})

check('a create with no pushed id is a problem: nothing to read back means nothing proved', () => {
  const ids = pushedIds()
  delete ids.contacts[1]
  const proof = hubspot.prove(config(), smallPlan(), ids, cleanReadbacks())
  assert.ok(proof.problems.some(p => /row 1/.test(p.what) && /no id/.test(p.why)))
})

check('a missing read-back is a problem for the record it belongs to', () => {
  const readbacks = cleanReadbacks()
  delete readbacks.contacts[2]
  const proof = hubspot.prove(config(), smallPlan(), pushedIds(), readbacks)
  assert.ok(proof.problems.some(p => /row 2/.test(p.what) && /No read-back/.test(p.why)))
})

check('an ABSENT association or membership read-back fails the proof: skipping the fetch cannot pass', () => {
  const noAssociation = cleanReadbacks()
  delete noAssociation.associations[1]
  const first = hubspot.prove(config(), smallPlan(), pushedIds(), noAssociation)
  assert.ok(first.problems.some(p => /row 1 association/.test(p.what) && /unproved fails the proof/.test(p.why)))

  const noMembership = cleanReadbacks()
  delete noMembership.memberships['Summit - Invited']
  const second = hubspot.prove(config(), smallPlan(), pushedIds(), noMembership)
  assert.ok(second.problems.some(p => /list Summit - Invited/.test(p.what) && /unproved fails the proof/.test(p.why)))
})

check('an adoption fill on a matched company is pushed as one PATCH by its id, read back, and proved', () => {
  const plan = smallPlan()
  plan.companies.matched[0].fill = { name: 'Navy Proper' }
  const { requests } = hubspot.pushRequests(config(), plan)
  const fill = requests.find(r => r.label === 'fill company: Navy')
  assert.ok(fill, 'the fill PATCH is emitted')
  assert.strictEqual(fill.method, 'PATCH')
  assert.ok(fill.url.endsWith('/crm/v3/objects/companies/900'), 'by the id the match already names')
  assert.deepStrictEqual(fill.body.properties, { name: 'Navy Proper' })

  const readbacks = hubspot.readbackRequests(config(), plan, pushedIds())
  const read = readbacks.find(r => r.label === 'read back company: Navy')
  assert.ok(read, 'the fill is a write like any other, and an unread one is unproved')
  assert.ok(read.url.includes('/crm/v3/objects/companies/900?'))

  const provedClean = (() => {
    const all = cleanReadbacks()
    all.companies.Navy = { id: '900', properties: { name: 'Navy Proper' } }
    return hubspot.prove(config(), plan, pushedIds(), all)
  })()
  assert.deepStrictEqual(provedClean.problems, [], JSON.stringify(provedClean.problems))
  assert.ok(provedClean.checked.some(c => /company Navy \(fill\)/.test(c.what)))

  const provedAbsent = hubspot.prove(config(), plan, pushedIds(), cleanReadbacks())
  assert.ok(provedAbsent.problems.some(p => /company Navy \(fill\)/.test(p.what)), 'a promised fill with no read-back fails the proof')

  const fillLess = smallPlan()
  const bare = hubspot.pushRequests(config(), fillLess)
  assert.ok(!bare.requests.find(r => r.label.startsWith('fill company')), 'a plain match emits no PATCH')
})

check('an empty fill value never enters the PATCH payload, even when the caller skipped the plan\'s refusal', () => {
  const plan = smallPlan()
  plan.companies.matched[0].fill = { name: '', website: '  ' }
  const { requests } = hubspot.pushRequests(config(), plan)
  assert.ok(!requests.find(r => r.label === 'fill company: Navy'), 'an all-empty fill emits nothing: an empty PATCH value is a measured clear')

  plan.companies.matched[0].fill = { name: 'Navy Proper', website: '' }
  const mixed = hubspot.pushRequests(config(), plan)
  const fill = mixed.requests.find(r => r.label === 'fill company: Navy')
  assert.deepStrictEqual(fill.body.properties, { name: 'Navy Proper' }, 'the empty half is dropped, the real half is sent')
})

check('readbackRequests fetches updates by the id the plan carried, not only the pushed creates', () => {
  const requests = hubspot.readbackRequests(config(), smallPlan(), pushedIds())
  const update = requests.find(r => r.label === 'read back contact: row 3')
  assert.ok(update, 'the update read-back is requested')
  assert.ok(update.url.includes('/crm/v3/objects/contacts/301?'))
})

check('membership read-backs come from the plan, so a matched list is read as well as a created one', () => {
  const requests = hubspot.readbackRequests(config(), smallPlan(), pushedIds())
  const matched = requests.find(r => r.label === 'read back memberships: Summit - Attended')
  assert.ok(matched, 'a run whose list already existed still has to prove who landed on it')
  assert.ok(matched.url.includes('/crm/v3/lists/702/'))
  const created = requests.find(r => r.label === 'read back memberships: Summit - Invited')
  assert.ok(created.url.includes('/crm/v3/lists/701/'))
})

check('a plan built by an older step, without lists.creates and lists.matched, is refused by name', () => {
  const stale = smallPlan()
  delete stale.lists.creates
  delete stale.lists.matched
  assert.throws(() => hubspot.pushRequests(config(), stale), /older step/)
  assert.throws(() => hubspot.readbackRequests(config(), stale, pushedIds()), /older step/)
})

check('a plan missing lists.memberships is refused the same way, not crashed through', () => {
  const edited = smallPlan()
  delete edited.lists.memberships
  assert.throws(() => hubspot.pushRequests(config(), edited), /older step or edited by hand/)
  assert.throws(() => hubspot.readbackRequests(config(), edited, pushedIds()), /older step or edited by hand/)
  assert.throws(() => hubspot.prove(config(), edited, pushedIds(), cleanReadbacks()), /older step or edited by hand/, 'prove is directly invokable and guards the shape like the other two')
})

// -------------------------------------------------------------- list lookups

check('list lookups are one GET per name, url-encoded', () => {
  const requests = hubspot.listLookupRequests(['Summit - Invited'])
  assert.strictEqual(requests[0].method, 'GET')
  assert.ok(requests[0].url.endsWith('/crm/v3/lists/object-type-id/0-1/name/Summit%20-%20Invited'))
})

check('a lookup answering a different name than it was asked is a question, so reversed files cannot mis-file ids', () => {
  const judged = hubspot.judgeListLookup({ list: { listId: 701, name: 'Summit - Attended' } }, 'Summit - Invited')
  assert.strictEqual(judged.outcome, 'unknown')
  assert.ok(/out of order/.test(judged.why))
  assert.strictEqual(hubspot.judgeListLookup({ list: { listId: 701, name: 'Summit - Invited' } }, 'Summit - Invited').outcome, 'exists')
  assert.strictEqual(hubspot.judgeListLookup({ list: { listId: 701 } }, 'Summit - Invited').outcome, 'exists', 'an envelope carrying no name has nothing to check against')
})

check('a lookup judges exists with its id, not-found as absent, and anything else as a question', () => {
  assert.deepStrictEqual(hubspot.judgeListLookup({ list: { listId: 701 } }), { outcome: 'exists', listId: '701' })
  assert.strictEqual(hubspot.judgeListLookup({ status: 'error', category: 'NOT_FOUND', message: 'no list by that name' }).outcome, 'absent')
  assert.strictEqual(hubspot.judgeListLookup('ok').outcome, 'unknown')
  assert.strictEqual(hubspot.judgeListLookup({ status: 'error', category: 'RATE_LIMIT', message: 'slow down' }).outcome, 'unknown', 'an unrecognised error read as absent would create a duplicate list')
})

// -------------------------------------------------------------------- probe

check('the probe is one read and its judge trusts only the measured envelope', () => {
  const request = hubspot.probeRequest(config())
  assert.strictEqual(request.method, 'GET')
  assert.ok(request.url.includes('limit=1'))
  assert.strictEqual(hubspot.judgeProbe({ results: [] }).alive, true)
  assert.strictEqual(hubspot.judgeProbe({ status: 'error', message: 'expired' }).alive, false)
  assert.strictEqual(hubspot.judgeProbe('ok').alive, false, 'an unrecognised answer is not proof of life')
})

console.log(failures ? `\n${failures} failed.\n` : '\nAll checks passed.\n')
process.exit(failures ? 1 : 0)

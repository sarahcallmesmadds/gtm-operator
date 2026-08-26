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
    names: ['Summit - Invited'],
    memberships: [{ list: 'Summit - Invited', rows: [1, 2] }]
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

check('associations use the matched id where one exists and a placeholder where it does not yet', () => {
  const { requests } = hubspot.pushRequests(config(), smallPlan())
  const toAcme = requests.find(r => r.label === 'associate: row 1 to Acme')
  const toNavy = requests.find(r => r.label === 'associate: row 2 to Navy')
  assert.ok(toAcme.url.endsWith('/companies/{company:Acme}'))
  assert.ok(toAcme.url.includes('/contacts/{contact:1}/'))
  assert.ok(toNavy.url.endsWith('/companies/900'), 'a matched company already has its id')
})

check('memberships carry contact placeholders for the skill to substitute', () => {
  const { requests } = hubspot.pushRequests(config(), smallPlan())
  const add = requests.find(r => r.label === 'add to list: Summit - Invited')
  assert.deepStrictEqual(add.body, ['{contact:1}', '{contact:2}'])
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

check('the duplicate create refusal carries the existing id out of the error text, and is never an update', () => {
  const judged = hubspot.judgeResponse(
    { method: 'POST', url: 'x', label: 'create' },
    { status: 'error', category: 'CONFLICT', message: 'Contact already exists. Existing ID: 12345' }
  )
  assert.strictEqual(judged.outcome, 'conflict')
  assert.strictEqual(judged.existingId, '12345')
  assert.ok(/nothing here turns it into an update/.test(judged.why))
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
  memberships: { 'Summit - Invited': { results: [{ recordId: '501' }, { recordId: '502' }] } }
})

check('a clean set of read-backs proves every planned write and still names what it did not check', () => {
  const proof = hubspot.prove(config(), smallPlan(), pushedIds(), cleanReadbacks())
  assert.deepStrictEqual(proof.problems, [], JSON.stringify(proof.problems))
  assert.ok(proof.checked.length >= 8)
  assert.ok(proof.unchecked.some(u => /not named above/.test(u.what)), 'the proof says its own limits, every time')
})

check('a property that came back different is a problem naming both values', () => {
  const readbacks = cleanReadbacks()
  readbacks.contacts[1].properties.firstname = 'Ad'
  const proof = hubspot.prove(config(), smallPlan(), pushedIds(), readbacks)
  assert.ok(proof.problems.some(p => /row 1, firstname/.test(p.what) && /"Ada"/.test(p.why) && /"Ad"/.test(p.why)))
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

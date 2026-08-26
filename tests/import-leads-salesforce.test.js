'use strict'

/**
 * Tests for the Salesforce half: request building and response judging.
 *
 * WHAT A GREEN RUN HERE MEANS, said plainly: these suites prove the
 * requests are built from the plan and the config as intended, and that
 * the judges read the measured response shapes as measured (2026-08-25 and
 * 2026-08-26). They cannot prove the org accepts any of it. The live
 * acceptance run against a Developer Edition org is the release gate, and
 * until it is recorded in DECISIONS.md nothing about the live surface is
 * proved by this file.
 *
 * Run: node tests/import-leads-salesforce.test.js
 */

const assert = require('assert')

const salesforce = require('../plugins/import-leads/scripts/salesforce')

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

console.log('\nimport-leads salesforce requests and judges\n')

const config = () => ({
  crm: 'salesforce',
  orgAlias: 'acceptance-org',
  properties: {
    contact: {
      firstName: 'FirstName',
      lastName: 'LastName',
      email: 'Email',
      phone: 'Phone',
      title: 'Title',
      city: 'MailingCity',
      state: 'MailingState',
      country: 'MailingCountry',
      persona: 'Persona__c',
      leadSource: 'LeadSource'
    },
    company: { name: 'Name', website: 'Website' }
  }
})

const row = (index, fields, extra) => Object.assign({
  index,
  source: {},
  fields,
  fieldSources: Object.fromEntries(Object.keys(fields).map(k => [k, 'list']))
}, extra)

const queryEnvelope = (records, done) => ({ status: 0, result: { records, totalSize: records.length, done: done === undefined ? true : done } })

// -------------------------------------------------------------------- SOQL

check('a SOQL literal escapes the apostrophe (measured) and the escape character itself', () => {
  assert.strictEqual(salesforce.soqlLiteral("O'Brien"), "'O\\'Brien'")
  assert.strictEqual(salesforce.soqlLiteral('a\\b'), "'a\\\\b'")
})

// ------------------------------------------------------------------- search

check('searches batch emails 100 per request with IN, asking for every mapped field plus the account', () => {
  const emails = Array.from({ length: 250 }, (_, i) => `p${i}@x.com`)
  const requests = salesforce.searchRequests(config(), emails)
  assert.strictEqual(requests.length, 3)
  assert.strictEqual(requests[0].transport, 'query')
  assert.strictEqual(requests[0].targetOrg, 'acceptance-org')
  assert.ok(requests[0].soql.includes('Email IN ('))
  assert.ok(requests[0].soql.includes('Title'), 'every mapped field is asked for, or blanks cannot be seen')
  assert.ok(requests[0].soql.includes('Account.Name'), 'the account name rides along for the conflict check')
  assert.ok(requests[0].soql.includes('AccountId'))
  assert.strictEqual((requests[2].soql.match(/@x\.com/g) || []).length, 50)
})

check('emails fold and dedupe before searching, and an apostrophe cannot break the query', () => {
  const requests = salesforce.searchRequests(config(), [" O'hara@X.com ", "o'hara@x.com"])
  assert.strictEqual((requests[0].soql.match(/hara@x\.com/g) || []).length, 1)
  assert.ok(requests[0].soql.includes("\\'"), 'the apostrophe travels escaped')
})

check('search results normalise to contacts by lowercased email, the account name under company', () => {
  const record = {
    attributes: { type: 'Contact' },
    Id: '003X',
    FirstName: 'Grace',
    Email: 'Grace@X.com',
    Title: 'Admiral',
    AccountId: '001N',
    Account: { attributes: { type: 'Account' }, Name: 'Navy' }
  }
  const result = salesforce.searchResults(config(), [queryEnvelope([record])])
  assert.strictEqual(result.found, 1)
  const match = result.byEmail['grace@x.com']
  assert.strictEqual(match.id, '003X')
  assert.strictEqual(match.properties.title, 'Admiral')
  assert.strictEqual(match.properties.company, 'Navy', 'the nested dotted shape, measured 2026-08-26, reads as the conflict signal')
  assert.strictEqual(match.properties.accountId, '001N')
})

check('a contact with no account reads without a company signal rather than crashing on the null', () => {
  const record = { Id: '003X', Email: 'solo@x.com', Account: null, AccountId: null }
  const result = salesforce.searchResults(config(), [queryEnvelope([record])])
  assert.strictEqual(result.byEmail['solo@x.com'].properties.company, undefined)
})

check('an unrecognised envelope is refused: a guess would read as a CRM with nobody in it', () => {
  assert.throws(() => salesforce.searchResults(config(), [{ records: [] }]), /measured query envelope/)
})

check('a search record whose email is not text is refused, never coerced into an identity', () => {
  // A coerced object email indexed under "[object object]" matched
  // nothing, and the row planned as a duplicate create on the backend
  // where this search is the whole guard.
  assert.throws(() => salesforce.searchResults(config(), [queryEnvelope([{ Id: '003X', Email: { odd: true } }])]), /not text/)
  assert.throws(() => salesforce.searchResults(config(), [queryEnvelope([{ Id: '003X', Email: 42 }])]), /not text/)
})

check('done not true is reported incomplete, because a withheld contact is an unseen duplicate', () => {
  const result = salesforce.searchResults(config(), [queryEnvelope([], false)])
  assert.strictEqual(result.incomplete.length, 1)
})

check('the domain lookup is its own request against Website, never OR-ed into the name search', () => {
  const requests = salesforce.companySearchRequests(config(), [
    { name: "O'Brien Co", domain: 'obrien.example' },
    { name: 'Bare Co', domain: null }
  ])
  assert.strictEqual(requests.length, 3)
  const byName = requests.find(r => r.label === "company search: O'Brien Co")
  assert.ok(byName.soql.includes("LIKE '%O\\'Brien Co%'"))
  const byDomain = requests.find(r => r.label === "company search by domain: O'Brien Co")
  assert.ok(byDomain.soql.includes("Website LIKE '%obrien.example%'"), 'the bare-domain LIKE finds the prefixed form, measured 2026-08-26')
  assert.ok(!requests.find(r => r.label === 'company search by domain: Bare Co'), 'no domain, no domain request')
})

// -------------------------------------------------------------------- bodies

check('a create body carries mapped fields, the persona only with its source, and the lead source', () => {
  const withPersona = row(1, { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@x.com', company: 'Acme' },
    { persona: 'Marketing Leader', personaSource: 'personas-artifact' })
  const body = salesforce.contactCreateBody(config(), withPersona, { property: 'LeadSource', value: 'Content' })
  assert.deepStrictEqual(body, {
    FirstName: 'Ada',
    LastName: 'Lovelace',
    Email: 'ada@x.com',
    Persona__c: 'Marketing Leader',
    LeadSource: 'Content'
  })
  assert.ok(!('AccountId' in body), 'the association is added by the push, which alone knows the id or token')
})

check('a sourceless field never enters a create body, even when the caller skipped the gate', () => {
  const smuggled = row(1, { firstName: 'Ada', lastName: 'L', email: 'a@x.com' })
  smuggled.fields.title = 'Invented'
  delete smuggled.fieldSources.title
  const body = salesforce.contactCreateBody(config(), smuggled, null)
  assert.ok(!('Title' in body), 'a value with no source is refused at the payload as well as at the gate')
})

check('a configured contact record-type id rides every create, and an unconfigured one never appears', () => {
  const typed = config()
  typed.recordTypeIds = { contact: '012RT' }
  const body = salesforce.contactCreateBody(typed, row(1, { firstName: 'Ada', lastName: 'L', email: 'a@x.com' }), null)
  assert.strictEqual(body.RecordTypeId, '012RT')
  const plain = salesforce.contactCreateBody(config(), row(1, { firstName: 'Ada', lastName: 'L', email: 'a@x.com' }), null)
  assert.ok(!('RecordTypeId' in plain))
})

check('an update body is the fill and nothing else, and refuses the lead source and unknown fields', () => {
  const body = salesforce.contactUpdateBody(config(), { title: 'Admiral', leadSource: 'Imported', email: 'new@x.com', invented: 'x' })
  assert.deepStrictEqual(body, { Title: 'Admiral' }, 'the lead source is create-only, and email and unknown fields never ride an update')
})

// ------------------------------------------- campaigns, statuses, the flag

check('campaign lookups are one exact-name query per campaign, escaped', () => {
  const requests = salesforce.campaignLookupRequests(config(), [{ name: "Autumn O'Summit", type: 'Event' }])
  assert.strictEqual(requests.length, 1)
  assert.ok(requests[0].soql.includes("WHERE Name = 'Autumn O\\'Summit'"))
})

check('a campaign lookup judges one row as a match, an empty set as absent, and two rows as a question', () => {
  assert.deepStrictEqual(
    salesforce.judgeCampaignLookup(queryEnvelope([{ Id: '701A', Name: 'Summit' }])),
    { outcome: 'exists', campaignId: '701A' }
  )
  assert.deepStrictEqual(salesforce.judgeCampaignLookup(queryEnvelope([])), { outcome: 'absent' }, 'the measured absent answer is an empty result set, not an error')
  assert.strictEqual(salesforce.judgeCampaignLookup(queryEnvelope([{ Id: 'A' }, { Id: 'B' }])).outcome, 'unknown', 'two campaigns with one name is a judgment, not a coin flip')
  assert.strictEqual(salesforce.judgeCampaignLookup({ odd: true }).outcome, 'unknown', 'an unrecognised answer read as absent would create a duplicate campaign')
})

check('status reads go only to campaigns judged as existing, and judge to labels with the highest sort order', () => {
  const requests = salesforce.statusReadRequests(config(), {
    Summit: { outcome: 'exists', campaignId: '701A' },
    Roadshow: { outcome: 'absent' }
  })
  assert.strictEqual(requests.length, 1)
  assert.ok(requests[0].soql.includes("CampaignId = '701A'"))
  const judged = salesforce.judgeStatusRead(queryEnvelope([
    { Id: 'S1', Label: 'Sent', SortOrder: 1, IsDefault: true, HasResponded: false },
    { Id: 'S2', Label: 'Responded', SortOrder: 2, IsDefault: false, HasResponded: true }
  ]))
  assert.deepStrictEqual(judged, { ok: true, labels: ['Sent', 'Responded'], maxSortOrder: 2 })
  assert.strictEqual(salesforce.judgeStatusRead({ odd: true }).ok, false)
})

check('the flag flow: whoami without an id, the flag read with one, and one judge reading both measured shapes', () => {
  const whoami = salesforce.flagRequest(config(), null)
  assert.strictEqual(whoami.transport, 'cli')
  assert.deepStrictEqual(whoami.args, ['org', 'display', 'user'])
  const flagRead = salesforce.flagRequest(config(), '005U')
  assert.ok(flagRead.soql.includes('UserPermissionsMarketingUser'))
  assert.ok(flagRead.soql.includes("'005U'"))

  const step1 = salesforce.judgeFlag({ status: 0, result: { id: '005U', username: 'x' } })
  assert.deepStrictEqual({ ok: step1.ok, userId: step1.userId }, { ok: true, userId: '005U' })
  assert.ok(step1.next, 'the whoami answer says to run the flag read next')
  const on = salesforce.judgeFlag(queryEnvelope([{ Id: '005U', UserPermissionsMarketingUser: true }]))
  assert.deepStrictEqual(on, { ok: true, userId: '005U', on: true })
  const off = salesforce.judgeFlag(queryEnvelope([{ Id: '005U', UserPermissionsMarketingUser: false }]))
  assert.strictEqual(off.on, false)
  assert.strictEqual(salesforce.judgeFlag({ odd: true }).ok, false)
})

// -------------------------------------------------------------------- push

const smallPlan = () => ({
  companies: {
    creates: [{ name: 'Acme', website: 'acme.example', rows: [1] }],
    matched: [{ name: 'Navy', companyId: '001N', rows: [2] }]
  },
  contacts: {
    creates: [
      { index: 1, row: row(1, { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@x.com', company: 'Acme' }) },
      { index: 2, row: row(2, { firstName: 'Grace', lastName: 'Hopper', email: 'grace@x.com', company: 'Navy' }) }
    ],
    updates: [{ index: 3, contactId: '003U', fill: { title: 'Countess' } }],
    nothing: [],
    excluded: []
  },
  campaignMemberships: {
    campaigns: {
      creates: [{ name: 'Autumn Summit', type: 'Event' }],
      matched: [{ name: 'Spring Roadshow', campaignId: '701M' }]
    },
    statuses: {
      creates: [{ campaign: 'Autumn Summit', label: 'Invited', sortOrder: 3 }]
    },
    members: [
      { campaign: 'Autumn Summit', status: 'Invited', rows: [1, 2] },
      { campaign: 'Spring Roadshow', status: 'Attended', rows: [3] }
    ],
    userFlagFix: null
  },
  leadSource: null,
  writeback: { kind: 'none' }
})

check('the push emits accounts, contacts, campaigns, statuses and members in dependency order, all REST', () => {
  const { requests } = salesforce.pushRequests(config(), smallPlan())
  const labels = requests.map(r => r.label)
  assert.ok(labels.indexOf('create account: Acme') < labels.indexOf('create contact: row 1'))
  assert.ok(labels.indexOf('create contact: row 1') < labels.indexOf('create campaign: Autumn Summit'))
  assert.ok(labels.indexOf('create campaign: Autumn Summit') < labels.indexOf('create member status: Autumn Summit / Invited'))
  assert.ok(labels.indexOf('create member status: Autumn Summit / Invited') < labels.indexOf('add member: row 1 to Autumn Summit / Invited'))
  assert.ok(requests.every(r => r.transport === 'rest'), 'every push write is a REST spec: the values route cannot carry an apostrophe, measured 2026-08-26')
})

check('the association is the AccountId field on the contact create, token for a create and id for a match', () => {
  const { requests, placeholders } = salesforce.pushRequests(config(), smallPlan())
  const toAcme = requests.find(r => r.label === 'create contact: row 1')
  assert.strictEqual(toAcme.body.AccountId, '{account:1}')
  const toNavy = requests.find(r => r.label === 'create contact: row 2')
  assert.strictEqual(toNavy.body.AccountId, '001N', 'a matched account already has its id')
  assert.deepStrictEqual(placeholders['{account:1}'], { kind: 'account', key: 'Acme' })
  assert.deepStrictEqual(placeholders['{contact:1}'], { kind: 'contact', key: '1' })
})

check('members reference creates by token and existing contacts by their known id, with the campaign resolved the same way', () => {
  const { requests } = salesforce.pushRequests(config(), smallPlan())
  const invited = requests.filter(r => r.label.startsWith('add member: row') && r.label.includes('Autumn Summit'))
  assert.deepStrictEqual(invited.map(r => r.body.ContactId), ['{contact:1}', '{contact:2}'])
  assert.ok(invited.every(r => r.body.CampaignId === '{campaign:1}'))
  assert.ok(invited.every(r => r.body.Status === 'Invited'))
  const attended = requests.find(r => r.label === 'add member: row 3 to Spring Roadshow / Attended')
  assert.deepStrictEqual({ c: attended.body.CampaignId, p: attended.body.ContactId }, { c: '701M', p: '003U' }, 'matched campaign and update row are addressed by their ids')
})

check('the flag fix, when the plan carries it, is one User PATCH before anything in the campaign family', () => {
  const plan = smallPlan()
  plan.campaignMemberships.userFlagFix = { userId: '005U' }
  const { requests } = salesforce.pushRequests(config(), plan)
  const labels = requests.map(r => r.label)
  const fix = requests.find(r => r.label === 'fix marketing-user flag')
  assert.ok(fix, 'the fix is in the push')
  assert.strictEqual(fix.method, 'PATCH')
  assert.ok(fix.path.endsWith('/sobjects/User/005U'))
  assert.deepStrictEqual(fix.body, { UserPermissionsMarketingUser: true })
  assert.ok(labels.indexOf('fix marketing-user flag') < labels.indexOf('create campaign: Autumn Summit'))
  const without = salesforce.pushRequests(config(), smallPlan())
  assert.ok(!without.requests.find(r => r.label === 'fix marketing-user flag'), 'no fix planned, no User write')
})

check('an adoption fill on a matched account is one PATCH by its id, empty halves dropped', () => {
  const plan = smallPlan()
  plan.companies.matched[0].fill = { name: 'Navy Proper', website: '  ' }
  const { requests } = salesforce.pushRequests(config(), plan)
  const fill = requests.find(r => r.label === 'fill account: Navy')
  assert.strictEqual(fill.method, 'PATCH')
  assert.ok(fill.path.endsWith('/sobjects/Account/001N'))
  assert.deepStrictEqual(fill.body, { Name: 'Navy Proper' }, 'the empty half is dropped, the real half is sent')
  plan.companies.matched[0].fill = { name: '', website: ' ' }
  assert.ok(!salesforce.pushRequests(config(), plan).requests.find(r => r.label === 'fill account: Navy'), 'an all-empty fill emits nothing')
})

check('a member row with no known id and no planned create is refused as the plan bug it is', () => {
  const plan = smallPlan()
  plan.campaignMemberships.members[0].rows.push(99)
  assert.throws(() => salesforce.pushRequests(config(), plan), /Row 99/)
})

check('a plan without the salesforce membership shape is refused by name, in push, readbacks and prove', () => {
  const stale = smallPlan()
  delete stale.campaignMemberships
  assert.throws(() => salesforce.pushRequests(config(), stale), /older step or edited by hand/)
  assert.throws(() => salesforce.readbackRequests(config(), stale, {}), /older step or edited by hand/)
  assert.throws(() => salesforce.prove(config(), stale, {}, {}), /older step or edited by hand/)
})

// ------------------------------------------------------------------- judging

check('the bare REST create envelope judges as created, and the wrapped data-command one does too', () => {
  const request = { label: 'create', method: 'POST', path: '/services/data/v67.0/sobjects/Account' }
  assert.deepStrictEqual(salesforce.judgeResponse(request, { id: '001A', success: true, errors: [] }), { outcome: 'created', id: '001A' })
  assert.deepStrictEqual(salesforce.judgeResponse(request, { status: 0, result: { id: '001A', success: true, errors: [] } }), { outcome: 'created', id: '001A' })
})

check('an empty answer to a PATCH is the measured 204 and points at the read-back; anywhere else it proves nothing', () => {
  const patch = { label: 'fill', method: 'PATCH', path: '/services/data/v67.0/sobjects/Account/001A' }
  assert.strictEqual(salesforce.judgeResponse(patch, '').outcome, 'done-unproved')
  assert.strictEqual(salesforce.judgeResponse(patch, {}).outcome, 'done-unproved')
  const post = { label: 'create', method: 'POST', path: '/services/data/v67.0/sobjects/Account' }
  assert.strictEqual(salesforce.judgeResponse(post, '').outcome, 'unknown')
})

check('the duplicate member is folded into the report, scoped to the member create it was measured on', () => {
  const member = { label: 'add member', method: 'POST', path: '/services/data/v67.0/sobjects/CampaignMember' }
  const judged = salesforce.judgeResponse(member, [{ message: 'Already a campaign member.', errorCode: 'DUPLICATE_VALUE' }])
  assert.strictEqual(judged.outcome, 'duplicate-member')
  assert.ok(/existing row was not/.test(judged.why))
  const elsewhere = salesforce.judgeResponse(
    { label: 'create contact', method: 'POST', path: '/services/data/v67.0/sobjects/Contact' },
    [{ message: 'Already a campaign member.', errorCode: 'DUPLICATE_VALUE' }]
  )
  assert.strictEqual(elsewhere.outcome, 'failed', 'the duplicate reading is scoped to the request it was measured on')
})

check('both measured error shapes judge as failed with the message carried', () => {
  const request = { label: 'create', method: 'POST', path: '/services/data/v67.0/sobjects/Contact' }
  const restError = salesforce.judgeResponse(request, [{ message: 'Required fields are missing: [LastName]', errorCode: 'REQUIRED_FIELD_MISSING' }])
  assert.strictEqual(restError.outcome, 'failed')
  assert.ok(/LastName/.test(restError.why))
  const cliError = salesforce.judgeResponse(request, { name: 'INVALID_FIELD', message: "No such column 'City__c' on sobject of type Contact", exitCode: 1 })
  assert.strictEqual(cliError.outcome, 'failed')
  assert.ok(/City__c/.test(cliError.why))
})

check('an unmeasured shape is unknown, never guessed', () => {
  assert.strictEqual(salesforce.judgeResponse({ label: 'x', method: 'POST', path: 'y' }, { odd: true }).outcome, 'unknown')
})

// -------------------------------------------------------------------- prove

const pushedIds = () => ({
  contacts: { 1: '003A', 2: '003B' },
  accounts: { Acme: '001A' },
  campaigns: { 'Autumn Summit': '701A' }
})

const contactRecord = (id, fields) => queryEnvelope([Object.assign({ Id: id }, fields)])

const cleanReadbacks = () => ({
  contacts: {
    1: contactRecord('003A', { FirstName: 'Ada', LastName: 'Lovelace', Email: 'ada@x.com', AccountId: '001A' }),
    2: contactRecord('003B', { FirstName: 'Grace', LastName: 'Hopper', Email: 'grace@x.com', AccountId: '001N' }),
    3: contactRecord('003U', { Title: 'Countess' })
  },
  accounts: {
    Acme: queryEnvelope([{ Id: '001A', Name: 'Acme', Website: 'acme.example' }])
  },
  campaigns: {
    'Autumn Summit': queryEnvelope([{ Id: '701A', Name: 'Autumn Summit' }])
  },
  statusRows: {
    'Autumn Summit': queryEnvelope([
      { Id: 'S1', Label: 'Sent', SortOrder: 1, CampaignId: '701A' },
      { Id: 'S2', Label: 'Responded', SortOrder: 2, CampaignId: '701A' },
      { Id: 'S3', Label: 'Invited', SortOrder: 3, CampaignId: '701A' }
    ])
  },
  members: {
    'Autumn Summit': queryEnvelope([
      { Id: 'M1', ContactId: '003A', Status: 'Invited', CampaignId: '701A' },
      { Id: 'M2', ContactId: '003B', Status: 'Invited', CampaignId: '701A' }
    ]),
    'Spring Roadshow': queryEnvelope([{ Id: 'M3', ContactId: '003U', Status: 'Attended', CampaignId: '701M' }])
  }
})

check('a clean set of read-backs proves every planned write by name and still says what it did not check', () => {
  const proof = salesforce.prove(config(), smallPlan(), pushedIds(), cleanReadbacks())
  assert.deepStrictEqual(proof.problems, [], JSON.stringify(proof.problems))
  const checked = proof.checked.map(c => c.what)
  for (const expected of [
    'row 1, firstName', 'row 2, firstName', 'row 1 association', 'row 2 association',
    'row 3 (update), title', 'account Acme, Name',
    'campaign Autumn Summit, Name', 'status Autumn Summit / Invited',
    'campaign Autumn Summit, row 1', 'campaign Autumn Summit, row 2', 'campaign Spring Roadshow, row 3'
  ]) {
    assert.ok(checked.includes(expected), `expected "${expected}" among the checked, got: ${checked.join(' | ')}`)
  }
  assert.ok(proof.unchecked.some(u => /not named above/.test(u.what)), 'the proof says its own limits, every time')
})

check('a wrong AccountId on the read-back is an association problem naming both records', () => {
  const readbacks = cleanReadbacks()
  readbacks.contacts[1] = contactRecord('003A', { FirstName: 'Ada', LastName: 'Lovelace', Email: 'ada@x.com', AccountId: '001WRONG' })
  const proof = salesforce.prove(config(), smallPlan(), pushedIds(), readbacks)
  assert.ok(proof.problems.some(p => /row 1 association/.test(p.what) && /001A/.test(p.why)))
})

check('a member missing, or on the campaign with the wrong status, is a problem, not a pass', () => {
  const missing = cleanReadbacks()
  missing.members['Autumn Summit'] = queryEnvelope([{ Id: 'M1', ContactId: '003A', Status: 'Invited', CampaignId: '701A' }])
  const first = salesforce.prove(config(), smallPlan(), pushedIds(), missing)
  assert.ok(first.problems.some(p => /campaign Autumn Summit, row 2/.test(p.what) && /not in the member read-back/.test(p.why)))

  const wrongStatus = cleanReadbacks()
  wrongStatus.members['Autumn Summit'].result.records[0].Status = 'Sent'
  const second = salesforce.prove(config(), smallPlan(), pushedIds(), wrongStatus)
  assert.ok(second.problems.some(p => /campaign Autumn Summit, row 1/.test(p.what) && /"Sent"/.test(p.why)))
})

check('an absent member read-back fails the proof: skipping the fetch cannot pass', () => {
  const readbacks = cleanReadbacks()
  delete readbacks.members['Spring Roadshow']
  const proof = salesforce.prove(config(), smallPlan(), pushedIds(), readbacks)
  assert.ok(proof.problems.some(p => /campaign Spring Roadshow/.test(p.what) && /unproved fails the proof/.test(p.why)))
})

check('a planned flag fix is proved by the flag reading true, and fails loudly otherwise', () => {
  const plan = smallPlan()
  plan.campaignMemberships.userFlagFix = { userId: '005U' }
  const readbacks = cleanReadbacks()
  readbacks.userFlag = queryEnvelope([{ Id: '005U', UserPermissionsMarketingUser: true }])
  const proof = salesforce.prove(config(), plan, pushedIds(), readbacks)
  assert.deepStrictEqual(proof.problems, [], JSON.stringify(proof.problems))
  assert.ok(proof.checked.some(c => c.what === 'marketing-user flag'))

  readbacks.userFlag = queryEnvelope([{ Id: '005U', UserPermissionsMarketingUser: false }])
  const stillOff = salesforce.prove(config(), plan, pushedIds(), readbacks)
  assert.ok(stillOff.problems.some(p => /marketing-user flag/.test(p.what) && /still off/.test(p.why)))

  delete readbacks.userFlag
  const absent = salesforce.prove(config(), plan, pushedIds(), readbacks)
  assert.ok(absent.problems.some(p => /marketing-user flag/.test(p.what) && /Unproved fails the proof/.test(p.why)))
})

check('an adoption fill is read back by the matched id and proved, and a promised fill with no read-back fails', () => {
  const plan = smallPlan()
  plan.companies.matched[0].fill = { name: 'Navy Proper' }
  const requests = salesforce.readbackRequests(config(), plan, pushedIds())
  const read = requests.find(r => r.label === 'read back account: Navy')
  assert.ok(read.soql.includes("'001N'"))

  const withFill = cleanReadbacks()
  withFill.accounts.Navy = queryEnvelope([{ Id: '001N', Name: 'Navy Proper' }])
  const clean = salesforce.prove(config(), plan, pushedIds(), withFill)
  assert.deepStrictEqual(clean.problems, [], JSON.stringify(clean.problems))
  assert.ok(clean.checked.some(c => /account Navy \(fill\)/.test(c.what)))

  const absent = salesforce.prove(config(), plan, pushedIds(), cleanReadbacks())
  assert.ok(absent.problems.some(p => /account Navy \(fill\)/.test(p.what)))
})

check('member read-backs come from the plan, so a matched campaign is read as well as a created one', () => {
  const requests = salesforce.readbackRequests(config(), smallPlan(), pushedIds())
  const matched = requests.find(r => r.label === 'read back members: Spring Roadshow')
  assert.ok(matched, 'a run whose campaign already existed still has to prove who landed on it')
  assert.ok(matched.soql.includes("'701M'"))
  const created = requests.find(r => r.label === 'read back members: Autumn Summit')
  assert.ok(created.soql.includes("'701A'"))
})

check('update read-backs come from the plan ids, and every read-back is a query spec on the org alias', () => {
  const requests = salesforce.readbackRequests(config(), smallPlan(), pushedIds())
  const update = requests.find(r => r.label === 'read back contact: row 3')
  assert.ok(update.soql.includes("'003U'"))
  assert.ok(requests.every(r => r.transport === 'query' && r.targetOrg === 'acceptance-org'))
})

// -------------------------------------------------------------------- check

check('the probe is one cheap query and its judge trusts only the measured envelope', () => {
  const request = salesforce.probeRequest(config())
  assert.strictEqual(request.transport, 'query')
  assert.ok(request.soql.includes('LIMIT 1'))
  assert.strictEqual(salesforce.judgeProbe(queryEnvelope([])).alive, true)
  assert.strictEqual(salesforce.judgeProbe({ name: 'NamedOrgNotFound', message: 'No authorization found' }).alive, false)
  assert.strictEqual(salesforce.judgeProbe('ok').alive, false, 'an unrecognised answer is not proof of life')
})

check('two CRM contacts under one email are surfaced as ambiguous, with neither kept as the match', () => {
  const result = salesforce.searchResults(config(), [queryEnvelope([
    { Id: '003A', Email: 'shared@x.com', FirstName: 'A' },
    { Id: '003B', Email: 'shared@x.com', FirstName: 'B' },
    { Id: '003C', Email: 'solo@x.com', FirstName: 'C' }
  ])])
  assert.ok(!('shared@x.com' in result.byEmail), 'keeping either record would silently decide which person the row is')
  assert.strictEqual(result.ambiguousInCrm.length, 1)
  assert.strictEqual(result.ambiguousInCrm[0].email, 'shared@x.com')
  assert.deepStrictEqual(result.ambiguousInCrm[0].contactIds, ['003A', '003B'])
  // Each candidate travels whole, so a chosen answer can be realised as
  // that record's blanks-only fill rather than falling through to a create.
  assert.deepStrictEqual(result.ambiguousInCrm[0].candidates.map(c => c.id), ['003A', '003B'])
  assert.strictEqual(result.ambiguousInCrm[0].candidates[0].properties.firstName, 'A')
  assert.strictEqual(result.ambiguousInCrm[0].candidates[1].properties.firstName, 'B')
  assert.strictEqual(result.byEmail['solo@x.com'].id, '003C', 'an unambiguous match still matches')
})

check('a campaign lookup answering a different name than it was asked is a question, so reversed files cannot mis-file ids', () => {
  const judged = salesforce.judgeCampaignLookup(queryEnvelope([{ Id: '701B', Name: 'Spring Roadshow' }]), 'Autumn Summit')
  assert.strictEqual(judged.outcome, 'unknown')
  assert.ok(/out of order/.test(judged.why))
  assert.strictEqual(salesforce.judgeCampaignLookup(queryEnvelope([{ Id: '701A', Name: 'Autumn Summit' }]), 'Autumn Summit').outcome, 'exists')
})

check('a campaign lookup with done not true, or a row with no Id, is a question, never an absence or a match', () => {
  assert.strictEqual(salesforce.judgeCampaignLookup(queryEnvelope([], false)).outcome, 'unknown', 'an incomplete answer cannot prove absence')
  assert.strictEqual(salesforce.judgeCampaignLookup(queryEnvelope([{ Name: 'Summit' }]), 'Summit').outcome, 'unknown', 'no Id, nothing to match against')
})

check('a campaign lookup row with a malformed Name is a question, never coerced into a binding', () => {
  // String() read a null as "null" and an object as its coerced spelling,
  // and judged the binding on a name the response never carried.
  assert.strictEqual(salesforce.judgeCampaignLookup(queryEnvelope([{ Id: '701A', Name: null }]), 'Summit').outcome, 'unknown')
  assert.strictEqual(salesforce.judgeCampaignLookup(queryEnvelope([{ Id: '701A', Name: { odd: true } }]), 'Summit').outcome, 'unknown')
  assert.strictEqual(salesforce.judgeCampaignLookup(queryEnvelope([{ Id: '701A', Name: null }])).outcome, 'unknown', 'the Name is the binding, so it is refused even when no expected name was passed')
})

check('the member proof refuses malformed rows instead of coercing them into matches', () => {
  const numericContact = cleanReadbacks()
  numericContact.members['Spring Roadshow'] = queryEnvelope([{ Id: 'M3', ContactId: 3, Status: 'Attended', CampaignId: '701M' }])
  const first = salesforce.prove(config(), smallPlan(), pushedIds(), numericContact)
  assert.ok(first.problems.some(p => /campaign Spring Roadshow/.test(p.what) && /refuses to read/.test(p.why)),
    'a numeric ContactId cannot be coerced into matching a planned id')

  const nullStatus = cleanReadbacks()
  nullStatus.members['Spring Roadshow'] = queryEnvelope([{ Id: 'M3', ContactId: '003U', Status: null, CampaignId: '701M' }])
  const second = salesforce.prove(config(), smallPlan(), pushedIds(), nullStatus)
  assert.ok(second.problems.some(p => /campaign Spring Roadshow/.test(p.what) && /refuses to read/.test(p.why)))
})

check('a status read refuses incomplete or malformed rows rather than planning creates beside them', () => {
  assert.strictEqual(salesforce.judgeStatusRead(queryEnvelope([], false)).ok, false, 'done not true withholds rows')
  assert.ok(/null/.test(salesforce.judgeStatusRead(queryEnvelope([{ Id: 'S1', Label: null, SortOrder: 1 }])).why))
  assert.ok(/"later"/.test(salesforce.judgeStatusRead(queryEnvelope([{ Id: 'S1', Label: 'Sent', SortOrder: 'later' }])).why))
})

check('a status read is bound to its campaign by CampaignId, so reversed files cannot credit the wrong campaign', () => {
  const requests = salesforce.statusReadRequests(config(), { Summit: { outcome: 'exists', campaignId: '701A' } })
  assert.ok(requests[0].soql.includes('CampaignId,') || /,\s*CampaignId\b/.test(requests[0].soql), 'the select carries CampaignId so the answer carries its own question')

  const alphaRows = queryEnvelope([{ Id: 'S1', Label: 'Invited', SortOrder: 3, CampaignId: '701A' }])
  assert.strictEqual(salesforce.judgeStatusRead(alphaRows, '701A').ok, true, 'the right campaign\'s rows judge clean')
  const reversed = salesforce.judgeStatusRead(alphaRows, '701B')
  assert.strictEqual(reversed.ok, false, 'another campaign\'s rows are a question, never that campaign\'s statuses')
  assert.ok(/out of order/.test(reversed.why))
  const unbindable = salesforce.judgeStatusRead(queryEnvelope([{ Id: 'S1', Label: 'Invited', SortOrder: 3 }]), '701A')
  assert.strictEqual(unbindable.ok, false, 'a row with no CampaignId cannot be bound and is refused')
  assert.strictEqual(salesforce.judgeStatusRead(queryEnvelope([]), '701B').ok, true, 'an empty answer carries nothing to bind and needs nothing')
})

check('the flag judge refuses a non-boolean flag and an incomplete answer: a misread flag is a privileged write', () => {
  assert.strictEqual(salesforce.judgeFlag(queryEnvelope([{ Id: '005U', UserPermissionsMarketingUser: 'false' }])).ok, false)
  assert.strictEqual(salesforce.judgeFlag(queryEnvelope([{ Id: '005U' }])).ok, false, 'an absent flag field is not the real false')
  assert.strictEqual(salesforce.judgeFlag(queryEnvelope([{ Id: '005U', UserPermissionsMarketingUser: false }], false)).ok, false, 'done not true withholds records')
})

check('a created campaign and a created status row are read back and proved, and an absent read-back fails', () => {
  const requests = salesforce.readbackRequests(config(), smallPlan(), pushedIds())
  assert.ok(requests.find(r => r.label === 'read back campaign: Autumn Summit'), 'the campaign create is a write like any other')
  const statuses = requests.find(r => r.label === 'read back statuses: Autumn Summit')
  assert.ok(statuses.soql.includes('CampaignMemberStatus'))

  const noCampaign = cleanReadbacks()
  delete noCampaign.campaigns['Autumn Summit']
  const first = salesforce.prove(config(), smallPlan(), pushedIds(), noCampaign)
  assert.ok(first.problems.some(p => /campaign Autumn Summit$/.test(p.what) || (/campaign Autumn Summit/.test(p.what) && /No read-back/.test(p.why))))

  const noStatuses = cleanReadbacks()
  delete noStatuses.statusRows['Autumn Summit']
  const second = salesforce.prove(config(), smallPlan(), pushedIds(), noStatuses)
  assert.ok(second.problems.some(p => /status Autumn Summit \/ Invited/.test(p.what) && /unproved fails the proof/.test(p.why)))

  const missingRow = cleanReadbacks()
  missingRow.statusRows['Autumn Summit'] = queryEnvelope([{ Id: 'S1', Label: 'Sent', SortOrder: 1, CampaignId: '701A' }])
  const third = salesforce.prove(config(), smallPlan(), pushedIds(), missingRow)
  assert.ok(third.problems.some(p => /status Autumn Summit \/ Invited/.test(p.what) && /did not land/.test(p.why)))

  const wrongSort = cleanReadbacks()
  wrongSort.statusRows['Autumn Summit'].result.records[2].SortOrder = 9
  const fourth = salesforce.prove(config(), smallPlan(), pushedIds(), wrongSort)
  assert.ok(fourth.problems.some(p => /status Autumn Summit \/ Invited/.test(p.what) && /SortOrder/.test(p.why)))
})

check('a configured record type is selected by the read-backs and proved on both objects', () => {
  const typed = config()
  typed.recordTypeIds = { contact: '012C', account: '012A' }
  const requests = salesforce.readbackRequests(typed, smallPlan(), pushedIds())
  const contactRead = requests.find(r => r.label === 'read back contact: row 1')
  assert.ok(contactRead.soql.includes('RecordTypeId'), 'a routed contact create is proved against what was sent')
  const accountRead = requests.find(r => r.label === 'read back account: Acme')
  assert.ok(accountRead.soql.includes('RecordTypeId'))

  const readbacks = cleanReadbacks()
  readbacks.contacts[1] = contactRecord('003A', { FirstName: 'Ada', LastName: 'Lovelace', Email: 'ada@x.com', AccountId: '001A', RecordTypeId: '012C' })
  readbacks.contacts[2] = contactRecord('003B', { FirstName: 'Grace', LastName: 'Hopper', Email: 'grace@x.com', AccountId: '001N', RecordTypeId: '012C' })
  readbacks.accounts.Acme = queryEnvelope([{ Id: '001A', Name: 'Acme', Website: 'acme.example', RecordTypeId: '012A' }])
  const proof = salesforce.prove(typed, smallPlan(), pushedIds(), readbacks)
  assert.deepStrictEqual(proof.problems, [], JSON.stringify(proof.problems))
  assert.ok(proof.checked.some(c => c.what === 'account Acme, RecordTypeId'))
  assert.ok(proof.checked.some(c => c.what === 'row 1, RecordTypeId'))

  const wrongType = salesforce.prove(typed, smallPlan(), pushedIds(), cleanReadbacks())
  assert.ok(wrongType.problems.some(p => /RecordTypeId/.test(p.what)), 'a read-back without the type fails rather than passing unproved')

  const untyped = salesforce.readbackRequests(config(), smallPlan(), pushedIds())
  assert.ok(!untyped.find(r => r.soql && r.soql.includes('RecordTypeId')), 'no configured type, nothing selected for it')
})

check('a read-back answering a different record than was fetched fails the proof instead of proving it', () => {
  // The reviewer's round-3 repro: the query asked for one campaign and a
  // response naming another produced zero problems. Every single-record
  // read-back is bound by the Id it carries now.
  const wrongCampaign = cleanReadbacks()
  wrongCampaign.campaigns['Autumn Summit'] = queryEnvelope([{ Id: '701OLD', Name: 'Autumn Summit' }])
  const campaignProof = salesforce.prove(config(), smallPlan(), pushedIds(), wrongCampaign)
  assert.ok(campaignProof.problems.some(p => /campaign Autumn Summit/.test(p.what) && /answers a different record/.test(p.why)))

  const wrongContact = cleanReadbacks()
  wrongContact.contacts[1] = contactRecord('003OTHER', { FirstName: 'Ada', LastName: 'Lovelace', Email: 'ada@x.com', AccountId: '001A' })
  const contactProof = salesforce.prove(config(), smallPlan(), pushedIds(), wrongContact)
  assert.ok(contactProof.problems.some(p => /row 1/.test(p.what) && /answers a different record/.test(p.why)))

  const wrongFlagUser = cleanReadbacks()
  const plan = smallPlan()
  plan.campaignMemberships.userFlagFix = { userId: '005U' }
  wrongFlagUser.userFlag = queryEnvelope([{ Id: '005OTHER', UserPermissionsMarketingUser: true }])
  const flagProof = salesforce.prove(config(), plan, pushedIds(), wrongFlagUser)
  assert.ok(flagProof.problems.some(p => /marketing-user flag/.test(p.what) && /answers a different record/.test(p.why)))
})

check('a status or member read-back filed under the wrong campaign fails the proof by its CampaignId', () => {
  // Reusing one campaign's saved response under another "proved" both
  // status writes in the round-3 repro. The rows' CampaignId binds them.
  const reusedStatuses = cleanReadbacks()
  reusedStatuses.statusRows['Autumn Summit'] = queryEnvelope([{ Id: 'S9', Label: 'Invited', SortOrder: 3, CampaignId: '701M' }])
  const statuses = salesforce.prove(config(), smallPlan(), pushedIds(), reusedStatuses)
  assert.ok(statuses.problems.some(p => /status Autumn Summit \/ Invited/.test(p.what) && /"701A" was fetched/.test(p.why)))

  const reusedMembers = cleanReadbacks()
  reusedMembers.members['Spring Roadshow'] = reusedMembers.members['Autumn Summit']
  const members = salesforce.prove(config(), smallPlan(), pushedIds(), reusedMembers)
  assert.ok(members.problems.some(p => /campaign Spring Roadshow/.test(p.what) && /refuses to read/.test(p.why) && /"701M" was fetched/.test(p.why)))
})

check('the status proof refuses the wrong types the status judge refuses, instead of coercing them past it', () => {
  // The round-3 repro for the proof-side pair: SortOrder "3" was refused
  // by judgeStatusRead and then re-accepted by Number() in prove.
  const wordySort = cleanReadbacks()
  wordySort.statusRows['Autumn Summit'].result.records[2].SortOrder = '3'
  const proof = salesforce.prove(config(), smallPlan(), pushedIds(), wordySort)
  assert.ok(proof.problems.some(p => /status Autumn Summit \/ Invited/.test(p.what) && /refuses to read/.test(p.why)),
    'a wordy SortOrder cannot pass the proof after failing the judge')
  assert.ok(!proof.checked.some(c => c.what === 'status Autumn Summit / Invited'), 'and it is not marked checked')
})

check('a field that came back as a number is refused by the proof, not coerced equal', () => {
  // The round-5 repro: the string "42" sent and numeric 42 back passed
  // through String() as a faithful echo. The measured read-backs answer
  // text, so a non-string is a malformed value, refused.
  const plan = smallPlan()
  plan.contacts.updates[0].fill = { title: '42' }
  const readbacks = cleanReadbacks()
  readbacks.contacts[3] = contactRecord('003U', { Title: 42 })
  const proof = salesforce.prove(config(), plan, pushedIds(), readbacks)
  assert.ok(proof.problems.some(p => /row 3 \(update\), Title/.test(p.what) && /not text/.test(p.why)))
  assert.ok(!proof.checked.some(c => /row 3 \(update\)/.test(c.what)), 'and it is not marked checked')
})

check('a lead-linked member row is skipped by the proof, not refused: it can prove nothing about contacts', () => {
  // A matched campaign in a real org can hold members linked to a Lead,
  // and those rows carry ContactId null. The Devin app's PR round caught
  // the type guard refusing the whole read-back over them, reporting a
  // correctly landed push as failed.
  const withLead = cleanReadbacks()
  withLead.members['Spring Roadshow'] = queryEnvelope([
    { Id: 'M3', ContactId: '003U', Status: 'Attended', CampaignId: '701M' },
    { Id: 'M9', ContactId: null, Status: 'Sent', CampaignId: '701M' }
  ])
  const proof = salesforce.prove(config(), smallPlan(), pushedIds(), withLead)
  assert.deepStrictEqual(proof.problems, [], JSON.stringify(proof.problems))
  assert.ok(proof.checked.some(c => c.what === 'campaign Spring Roadshow, row 3'))

  const wrongCampaignLead = cleanReadbacks()
  wrongCampaignLead.members['Spring Roadshow'] = queryEnvelope([
    { Id: 'M3', ContactId: '003U', Status: 'Attended', CampaignId: '701M' },
    { Id: 'M9', ContactId: null, Status: 'Sent', CampaignId: '701OTHER' }
  ])
  const misfiled = salesforce.prove(config(), smallPlan(), pushedIds(), wrongCampaignLead)
  assert.ok(misfiled.problems.some(p => /campaign Spring Roadshow/.test(p.what) && /refuses to read/.test(p.why)),
    'a lead row is still bound by its CampaignId before it is skipped')
})

check('member and status read-back queries select CampaignId so the proof can bind them', () => {
  const requests = salesforce.readbackRequests(config(), smallPlan(), pushedIds())
  const members = requests.find(r => r.label === 'read back members: Autumn Summit')
  assert.ok(/,\s*CampaignId\b/.test(members.soql))
  const statuses = requests.find(r => r.label === 'read back statuses: Autumn Summit')
  assert.ok(/,\s*CampaignId\b/.test(statuses.soql))
})

check('org display judges Connected as ok and anything else as not proved', () => {
  assert.deepStrictEqual(
    salesforce.judgeOrgDisplay({ status: 0, result: { connectedStatus: 'Connected', apiVersion: '67.0' } }),
    { ok: true, apiVersion: '67.0' }
  )
  assert.strictEqual(salesforce.judgeOrgDisplay({ status: 0, result: { connectedStatus: 'Unknown' } }).ok, false)
  assert.strictEqual(salesforce.judgeOrgDisplay({ odd: true }).ok, false)
})

check('the mailing-fields probe asks one named aggregate per code field, and refuses an empty alias', () => {
  const requests = salesforce.mailingFieldsProbeRequests('first-run-org')
  assert.strictEqual(requests.length, 2)
  assert.ok(requests.every(r => r.transport === 'query' && r.targetOrg === 'first-run-org'))
  // Exact equality, not a substring: round 3 found the regex pins staying
  // green for grouped variants the judge refuses at runtime.
  assert.strictEqual(requests[0].soql, 'SELECT COUNT(MailingStateCode) stateProbe FROM Contact')
  assert.strictEqual(requests[1].soql, 'SELECT COUNT(MailingCountryCode) countryProbe FROM Contact')
  assert.throws(() => salesforce.mailingFieldsProbeRequests('  '), /org alias/)
})

check('the probe judge answers per field, bound both arms, so a mixed org gets a measured mixed pair', () => {
  const aggregate = (key, n) => ({ status: 0, result: { records: [{ attributes: { type: 'AggregateResult' }, [key]: n }], totalSize: 1, done: true } })
  const refusal = column => ({ name: 'INVALID_FIELD', message: "Invalid field: '" + column + "'", exitCode: 1 })

  const codes = salesforce.judgeMailingFieldsProbe(aggregate('stateProbe', 3), aggregate('countryProbe', 4))
  assert.deepStrictEqual(codes, {
    ok: true,
    codeFields: { state: true, country: true },
    use: { state: 'MailingStateCode', country: 'MailingCountryCode' },
    why: codes.why
  })
  assert.strictEqual(salesforce.judgeMailingFieldsProbe(aggregate('stateProbe', 0), aggregate('countryProbe', 0)).ok, true, 'an empty org still answers the aggregates')

  const plain = salesforce.judgeMailingFieldsProbe(refusal('MailingStateCode'), refusal('MailingCountryCode'))
  assert.deepStrictEqual(plain.use, { state: 'MailingState', country: 'MailingCountry' })
  assert.deepStrictEqual(plain.codeFields, { state: false, country: false })
  assert.strictEqual(salesforce.judgeMailingFieldsProbe(
    { name: 'INVALID_FIELD', message: "No such column 'MailingStateCode' on entity 'Contact'.", exitCode: 1 },
    refusal('MailingCountryCode')
  ).use.state, 'MailingState', 'the bare-select refusal spelling is read too')

  // THE ROUND-3 REPRO: a refusal naming one column proves nothing about
  // the other. A mixed org now gets a measured mixed pair.
  const mixed = salesforce.judgeMailingFieldsProbe(aggregate('stateProbe', 2), refusal('MailingCountryCode'))
  assert.deepStrictEqual(mixed.use, { state: 'MailingStateCode', country: 'MailingCountry' })
  assert.deepStrictEqual(mixed.codeFields, { state: true, country: false })

  // Bound, both arms, both files: reversed saves, an unrelated success,
  // a refusal about another column, a non-object row, a cut-short answer.
  assert.strictEqual(salesforce.judgeMailingFieldsProbe(aggregate('countryProbe', 4), aggregate('stateProbe', 3)).ok, false, 'reversed files are refused')
  const unrelated = salesforce.judgeMailingFieldsProbe(
    { status: 0, result: { records: [{ Id: '003X' }], totalSize: 1, done: true } }, aggregate('countryProbe', 4))
  assert.strictEqual(unrelated.ok, false)
  assert.ok(/different question|out of order/.test(unrelated.why))
  assert.strictEqual(salesforce.judgeMailingFieldsProbe(refusal('Persona__c'), refusal('MailingCountryCode')).ok, false)
  const nonObject = salesforce.judgeMailingFieldsProbe({ status: 0, result: { records: ['odd'], totalSize: 1, done: true } }, aggregate('countryProbe', 4))
  assert.strictEqual(nonObject.ok, false)
  assert.ok(/not a record/.test(nonObject.why))
  assert.strictEqual(salesforce.judgeMailingFieldsProbe({ status: 0, result: { records: [{ stateProbe: 1 }], totalSize: 1, done: false } }, aggregate('countryProbe', 4)).ok, false)
  assert.strictEqual(salesforce.judgeMailingFieldsProbe({ odd: true }, aggregate('countryProbe', 4)).ok, false)
  assert.strictEqual(salesforce.judgeMailingFieldsProbe(null, null).ok, false)
})

check('the lead and contact counts are two named aggregates on the configured org', () => {
  const requests = salesforce.leadContactCountRequests(config())
  assert.strictEqual(requests.length, 2)
  assert.strictEqual(requests[0].label, 'count contacts')
  assert.strictEqual(requests[0].soql, 'SELECT COUNT(Id) contacts FROM Contact')
  assert.strictEqual(requests[1].label, 'count leads')
  assert.strictEqual(requests[1].soql, 'SELECT COUNT(Id) leads FROM Lead')
  assert.ok(requests.every(r => r.targetOrg === 'acceptance-org' && r.transport === 'query'))
})

check('the count judge binds each answer to its question by the alias key, so reversed files are refused', () => {
  const envelope = (key, n) => ({ status: 0, result: { records: [{ attributes: { type: 'AggregateResult' }, [key]: n }], totalSize: 1, done: true } })
  assert.deepStrictEqual(
    salesforce.judgeLeadContactCounts(envelope('contacts', 20), envelope('leads', 22)),
    { ok: true, contacts: 20, leads: 22 }
  )
  // THE ROUND-1 REPRO: reversed saved files used to answer mislabelled
  // counts. The alias key is the binding, so they are refused now.
  const reversed = salesforce.judgeLeadContactCounts(envelope('leads', 22), envelope('contacts', 20))
  assert.strictEqual(reversed.ok, false)
  assert.ok(/out of order|different question/.test(reversed.why))
  // An ordinary query envelope saved in a count's place carries no alias
  // key and is refused, not read as a count.
  assert.strictEqual(salesforce.judgeLeadContactCounts(
    { status: 0, result: { records: [{ Id: '003X', Email: 'x@y.com' }], totalSize: 1, done: true } },
    envelope('leads', 22)
  ).ok, false)
  // A misread count is evidence shown to a person: a Leads org told it has
  // no leads would confirm the wrong record kind.
  assert.strictEqual(salesforce.judgeLeadContactCounts(envelope('contacts', 20), envelope('leads', '22')).ok, false)
  assert.strictEqual(salesforce.judgeLeadContactCounts({ status: 0, result: { records: [{ contacts: 20 }], totalSize: 1, done: false } }, envelope('leads', 22)).ok, false)
  assert.strictEqual(salesforce.judgeLeadContactCounts(null, envelope('leads', 22)).ok, false)
  // A non-object row is a refusal, never a crash: round 2's wrong-type
  // finding, the same discipline the probe judge holds.
  const nonObject = salesforce.judgeLeadContactCounts({ status: 0, result: { records: [7], totalSize: 1, done: true } }, envelope('leads', 22))
  assert.strictEqual(nonObject.ok, false)
  assert.ok(/not a record/.test(nonObject.why))
})

console.log(failures ? `\n${failures} failed.\n` : '\nAll checks passed.\n')
process.exit(failures ? 1 : 0)

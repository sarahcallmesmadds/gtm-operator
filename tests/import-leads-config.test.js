'use strict'

/**
 * Tests for the import-leads private config: the file this plugin writes
 * once and nothing else writes at all.
 *
 * THE CONFIG PATH IS OVERRIDDEN BEFORE ANYTHING IS REQUIRED, the same rule
 * every config-touching suite here follows: a test that writes to the thing
 * it is testing the writing of is not a test, it is an incident.
 *
 * Run: node tests/import-leads-config.test.js
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const assert = require('assert')

const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'import-leads-config-'))
process.env.IMPORT_LEADS_CONFIG = path.join(TEMP, 'config.json')

const config = require('../plugins/import-leads/scripts/config')

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

console.log('\nthe import-leads private config\n')

/** A complete set of first-run answers, cloned per case. */
const answers = () => ({
  portalId: '111222333',
  serviceKeyPath: '~/keys/hubspot.txt',
  aliasMapPath: '~/gtm/company-aliases.json'
})

check('no file reads as a first run, not as an error', () => {
  const result = config.read()
  assert.strictEqual(result.ok, false)
  assert.strictEqual(result.missing, true)
  assert.ok(/first run/.test(result.message), 'the refusal has to say this is a first run, or the skill treats it as breakage')
})

check('an optional property mapping that is not a non-empty string is a problem, not a skipped key', () => {
  // The round-5 repro: an object mapping slid past the checks and the
  // payload builder emitted a property named "[object Object]", a
  // request targeting an invented CRM field.
  const draft = config.draft(answers())
  draft.properties.contact.owner = { odd: true }
  assert.ok(config.problems(draft).some(p => /properties\.contact\.owner/.test(p) && /non-empty string/.test(p)))
  draft.properties.contact.owner = '  '
  assert.ok(config.problems(draft).some(p => /properties\.contact\.owner/.test(p) && /non-empty string/.test(p)))
  draft.properties.contact.owner = 'hubspot_owner_id'
  assert.deepStrictEqual(config.problems(draft), [], 'a real name still validates clean')
})

check('a salesforce mapping that is not field-API-name shaped is refused: identifiers cannot be escaped into a query', () => {
  const sf = () => ({
    configVersion: config.CONFIG_VERSION,
    crm: 'salesforce',
    orgAlias: 'devorg',
    aliasMapPath: '~/gtm/company-aliases.json',
    properties: {
      contact: Object.assign({}, config.DEFAULT_SALESFORCE_FIELD_NAMES.contact),
      company: Object.assign({}, config.DEFAULT_SALESFORCE_FIELD_NAMES.company)
    }
  })
  assert.deepStrictEqual(config.problems(sf()), [], 'the standard field names validate clean')

  const custom = sf()
  custom.properties.contact.persona = 'Persona__c'
  assert.deepStrictEqual(config.problems(custom), [], 'a __c custom field is API-name shaped')

  const crafted = sf()
  crafted.properties.contact.firstName = 'FirstName FROM Contact WHERE Id != NULL'
  assert.ok(config.problems(crafted).some(p => /properties\.contact\.firstName/.test(p) && /field API name/.test(p)),
    'a name that could alter the query is refused at the gate')

  const hubspotUnderscore = config.draft(answers())
  hubspotUnderscore.properties.contact.owner = 'hubspot_owner_id'
  assert.deepStrictEqual(config.problems(hubspotUnderscore), [], 'the salesforce identifier rule does not reach the hubspot backend')
})

check('the draft fills the portal default property names and validates clean', () => {
  const draft = config.draft(answers())
  assert.strictEqual(draft.configVersion, config.CONFIG_VERSION)
  assert.strictEqual(draft.properties.contact.email, 'email')
  assert.strictEqual(draft.properties.contact.firstName, 'firstname')
  assert.strictEqual(draft.properties.company.name, 'name')
  assert.deepStrictEqual(config.problems(draft), [])
})

check('an optional property answered as empty is absent from the draft, not mapped to nothing', () => {
  const withEmpty = answers()
  withEmpty.properties = { contact: { linkedinUrl: '' } }
  const draft = config.draft(withEmpty)
  assert.ok(!('linkedinUrl' in draft.properties.contact), 'an empty answer means the org has no such property, and the record of that is absence')
})

check('a draft missing a required identifier is refused with the field named', () => {
  const missing = answers()
  delete missing.serviceKeyPath
  assert.throws(() => config.draft(missing), /serviceKeyPath/)
})

check('an unknown field in the property map is refused by name', () => {
  const draft = config.draft(answers())
  draft.properties.contact.favouriteColour = 'colour'
  const wrong = config.problems(draft)
  assert.ok(wrong.some(p => /favouriteColour/.test(p)), 'a field the write contract does not carry must be refused, not silently written')
})

check('two fields mapped to one property are refused', () => {
  const draft = config.draft(answers())
  draft.properties.contact.phone = 'email'
  const wrong = config.problems(draft)
  assert.ok(wrong.some(p => /email.*mapped from both|mapped from both/.test(p)), `expected the collision named, got: ${wrong.join(' | ')}`)
})

check('a wrong configVersion is refused rather than guessed at', () => {
  const draft = config.draft(answers())
  draft.configVersion = 99
  assert.ok(config.problems(draft).some(p => /configVersion/.test(p)))
})

check('write validates, writes once, and read round-trips', () => {
  const draft = config.draft(answers())
  const written = config.write(draft)
  assert.strictEqual(written.path, process.env.IMPORT_LEADS_CONFIG)
  const result = config.read()
  assert.strictEqual(result.ok, true)
  assert.strictEqual(result.config.portalId, '111222333')
  assert.strictEqual(result.serviceKeyPath, path.join(os.homedir(), 'keys/hubspot.txt'))
})

check('a second write is refused: the file may be another install\'s working config', () => {
  assert.throws(() => config.write(config.draft(answers())), /already exists/)
})

check('a damaged file is refused with the remedy, and never rewritten', () => {
  fs.writeFileSync(process.env.IMPORT_LEADS_CONFIG, 'not json')
  const result = config.read()
  assert.strictEqual(result.ok, false)
  assert.strictEqual(result.missing, false)
  assert.ok(/fix it or move it aside/i.test(result.message))
  assert.strictEqual(fs.readFileSync(process.env.IMPORT_LEADS_CONFIG, 'utf8'), 'not json', 'reading must not have touched the file')
})

check('a portalId that is not a string of digits is refused', () => {
  const draft = config.draft(answers())
  draft.portalId = 'my-portal'
  assert.ok(config.problems(draft).some(p => /portalId/.test(p)))
})

check('~ expands and a bare path passes through', () => {
  assert.strictEqual(config.resolvePath('~/x/y'), path.join(os.homedir(), 'x/y'))
  assert.strictEqual(config.resolvePath('/abs/path'), '/abs/path')
  assert.strictEqual(config.resolvePath(''), null)
  assert.strictEqual(config.resolvePath(undefined), null)
})

check('an absent crm reads as hubspot, because every config written before the field existed was written for HubSpot', () => {
  assert.strictEqual(config.crmOf({}), 'hubspot')
  assert.strictEqual(config.crmOf({ crm: 'salesforce' }), 'salesforce')
  const hubspotDraft = config.draft(answers())
  assert.ok(!('crm' in hubspotDraft), 'a hubspot draft leaves crm out, so the file existing installs already have stays the file a first run writes')
  assert.deepStrictEqual(config.problems(hubspotDraft), [])
})

check('an unknown crm is refused by name, and nothing else about the file is guessed at', () => {
  const draft = config.draft(answers())
  draft.crm = 'pipedrive'
  const wrong = config.problems(draft)
  assert.ok(wrong.some(p => /pipedrive/.test(p) && /hubspot, salesforce/.test(p)))
})

/** A complete set of salesforce first-run answers, cloned per case. */
const salesforceAnswers = () => ({
  crm: 'salesforce',
  orgAlias: 'acceptance-org',
  aliasMapPath: '~/gtm/company-aliases.json'
})

check('a salesforce draft records the crm, the alias and the standard field names, and validates clean', () => {
  const draft = config.draft(salesforceAnswers())
  assert.strictEqual(draft.crm, 'salesforce')
  assert.strictEqual(draft.orgAlias, 'acceptance-org')
  assert.strictEqual(draft.properties.contact.firstName, 'FirstName')
  assert.strictEqual(draft.properties.contact.city, 'MailingCity')
  assert.strictEqual(draft.properties.company.name, 'Name')
  assert.ok(!('portalId' in draft) && !('serviceKeyPath' in draft), 'nothing key-shaped or portal-shaped exists on this backend')
  assert.deepStrictEqual(config.problems(draft), [])
})

check('a salesforce config refuses HubSpot identifiers, and a hubspot one refuses the org alias', () => {
  const crossed = config.draft(salesforceAnswers())
  crossed.serviceKeyPath = '~/keys/hubspot.txt'
  assert.ok(config.problems(crossed).some(p => /serviceKeyPath is HubSpot's/.test(p)))
  const portal = config.draft(salesforceAnswers())
  portal.portalId = '111'
  assert.ok(config.problems(portal).some(p => /portalId is HubSpot's identifier/.test(p)))
  const aliased = config.draft(answers())
  aliased.orgAlias = 'acceptance-org'
  assert.ok(config.problems(aliased).some(p => /orgAlias is Salesforce's identifier/.test(p)))
})

check('a missing org alias is refused with the keychain named as where the credential actually lives', () => {
  const missing = salesforceAnswers()
  delete missing.orgAlias
  assert.throws(() => config.draft(missing), /orgAlias is missing/)
})

check('recordTypeIds validate as contact and account ids or are refused by name', () => {
  const typed = salesforceAnswers()
  typed.recordTypeIds = { contact: '012RT' }
  const draft = config.draft(typed)
  assert.deepStrictEqual(draft.recordTypeIds, { contact: '012RT' })
  assert.deepStrictEqual(config.problems(draft), [])

  const wrongKind = config.draft(salesforceAnswers())
  wrongKind.recordTypeIds = { lead: '012RT' }
  assert.ok(config.problems(wrongKind).some(p => /recordTypeIds\.lead/.test(p) && /contact, account/.test(p)))
  const emptyId = config.draft(salesforceAnswers())
  emptyId.recordTypeIds = { contact: ' ' }
  assert.ok(config.problems(emptyId).some(p => /recordTypeIds\.contact/.test(p)))
})

console.log(failures ? `\n${failures} failed.\n` : '\nAll checks passed.\n')
process.exit(failures ? 1 : 0)

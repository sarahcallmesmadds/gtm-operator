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

console.log(failures ? `\n${failures} failed.\n` : '\nAll checks passed.\n')
process.exit(failures ? 1 : 0)

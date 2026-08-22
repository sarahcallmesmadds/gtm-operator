'use strict'

/**
 * The reader and the writer agree about the config file.
 *
 * `plugins/setup/scripts/config.js` writes `~/.claude/gtm-operator.config.json`.
 * `shared/config-read.js` reads it, and is vendored into every other plugin.
 * They are two files by necessity: an installed plugin has no path to another
 * plugin's scripts, so the reader cannot require the writer.
 *
 * Two files describing one format drift. This is what stops it being silent.
 *
 * WHAT THIS TEST CANNOT DO, stated because a green tick here should not be read
 * as more than it is. It proves the two files in THIS CHECKOUT agree. It cannot
 * prove that an installed `setup` and an installed `calendar` agree, because
 * they are separate releases that a user updates separately. That gap is real
 * and `configVersion` is what covers it: the reader refuses a version it does
 * not know rather than guessing, which turns a silent misread into a message
 * naming the plugin that is behind. The refusal is checked below.
 *
 * Run: node tests/config-contract.test.js
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const assert = require('assert')

// A temporary config, so nothing here reads or writes the real one. Set before
// either module is loaded, because both resolve the path at require time.
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'gtm-config-contract-'))
process.env.GTM_OPERATOR_CONFIG = path.join(SANDBOX, 'gtm-operator.config.json')

const writer = require('../plugins/setup/scripts/config')
const reader = require('../shared/config-read')
const names = require('../plugins/setup/scripts/names')
const schema = require('../plugins/setup/scripts/schema')
const calendarSchema = require('../shared/calendar-schema')

/**
 * The contract the reader checks a recorded map against.
 *
 * The writer's side of the same fact is `schema.identityNames('calendar')`,
 * built from the database definition. The reader cannot reach that file once
 * installed, so it carries `IDENTITY`, and the first check below asserts the two
 * are the same set rather than merely both existing.
 */
const CONTRACT = calendarSchema.IDENTITY

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

const writeConfig = config => fs.writeFileSync(process.env.GTM_OPERATOR_CONFIG, `${JSON.stringify(config, null, 2)}\n`)
const removeConfig = () => { if (fs.existsSync(process.env.GTM_OPERATOR_CONFIG)) fs.unlinkSync(process.env.GTM_OPERATOR_CONFIG) }

/** A finished install, as the writer would leave one. */
function completeConfig () {
  const identity = schema.identityNames('calendar')
  return {
    configVersion: writer.CONFIG_VERSION,
    state: 'complete',
    notion: { parentPageId: 'page-1', personId: 'person-1' },
    databases: {
      calendar: {
        databaseId: 'db-1',
        dataSourceId: 'ds-1',
        displayName: 'Calendar',
        properties: identity.properties,
        values: identity.values
      }
    },
    verified: { at: '2026-08-19T00:00:00Z', definitions: 'x' },
    verifiedAt: '2026-08-19T00:00:00Z',
    defaults: { reviewCadence: 'Quarterly' },
    sources: { callRecorder: null },
    taxonomyPath: '/tmp/artifact-types.md'
  }
}

console.log('\nthe config reader and the config writer agree\n')

// -------------------------------------------------------------- the contract

check('the contract the reader carries is the one setup builds the database from', () => {
  // The reader cannot require setup's schema once it is installed, so `IDENTITY`
  // is a copy. This is what stops it being a silent one: a property added to the
  // database and not added there fails here rather than at a write.
  const identity = schema.identityNames('calendar')
  assert.deepStrictEqual(
    CONTRACT.properties.slice().sort(),
    Object.keys(identity.properties).sort(),
    'the property contract in shared/calendar-schema.js and setup\'s calendar definition are different sets'
  )
  assert.deepStrictEqual(
    Object.keys(CONTRACT.values).sort(),
    Object.keys(identity.values).sort(),
    'the two disagree about which properties have options'
  )
  for (const property of Object.keys(identity.values)) {
    assert.deepStrictEqual(
      CONTRACT.values[property].slice().sort(),
      Object.keys(identity.values[property]).sort(),
      `the option values for "${property}" differ between the contract and setup's definition`
    )
  }
})

// ---------------------------------------------------------------- the format

check('both files name the same config version', () => {
  assert.strictEqual(
    reader.CONFIG_VERSION,
    writer.CONFIG_VERSION,
    `the reader is at version ${reader.CONFIG_VERSION} and the writer is at ${writer.CONFIG_VERSION}. ` +
    `A bump reached one file and not the other, so every install would be refused by the plugins that read it.`
  )
})

check('both files resolve the same config path', () => {
  assert.strictEqual(reader.CONFIG_PATH, writer.CONFIG_PATH)
})

check('both files honour the same environment override', () => {
  // Not a detail: without it the two would diverge only under test, which is
  // the one condition where the divergence would never be noticed.
  assert.strictEqual(reader.CONFIG_PATH, process.env.GTM_OPERATOR_CONFIG)
})

// ------------------------------------------------------- the three map states

check('a recorded name map reads as usable', () => {
  const identity = schema.identityNames('calendar')
  const seen = reader.inspectNames({ properties: identity.properties, values: identity.values }, CONTRACT)
  assert.strictEqual(seen.state, 'ok')
})

check('no name map reads as absent, not as usable and not as broken', () => {
  // The distinction the whole reader exists to carry. `setup`'s names.recorded
  // is the writer's side of the same question, and the two are asserted to give
  // the same answer rather than each being checked alone.
  const seen = reader.inspectNames({ properties: {}, values: {} }, CONTRACT)
  assert.strictEqual(seen.state, 'absent')
  assert.strictEqual(names.recorded({ properties: {}, values: {} }), false)
})

check('the writer and the reader agree that an empty map is not a map', () => {
  const identity = schema.identityNames('calendar')
  assert.strictEqual(names.recorded({ properties: identity.properties, values: identity.values }), true)
  assert.strictEqual(reader.inspectNames({ properties: identity.properties, values: identity.values }, CONTRACT).state, 'ok')
})

check('two logical names pointing at one Notion name reads as broken', () => {
  const seen = reader.inspectNames({ properties: { Name: 'Title', Description: 'Title' }, values: {} }, CONTRACT)
  assert.strictEqual(seen.state, 'broken')
  assert.ok(seen.problems.join(' ').includes('both map to'))
})

check('the writer refuses the same collision', () => {
  // Both sides refuse it, rather than the reader carrying a rule the writer
  // does not enforce. A map the writer would accept and the reader would reject
  // is a workspace that installs and then cannot be written to.
  const identity = schema.identityNames('calendar')
  const collided = Object.assign({}, identity.properties, { Description: identity.properties.Name })
  const problems = names.problems({ properties: collided, values: identity.values }, identity)
  assert.ok(problems.length >= 1, 'the writer accepted a name map with two logical names on one Notion name')
})

check('a property mapped to something that is not a name reads as broken', () => {
  const seen = reader.inspectNames({ properties: { Name: '' }, values: {} }, CONTRACT)
  assert.strictEqual(seen.state, 'broken')
})

// ------------------------------------------------------------ the refusals

check('no config at all routes to setup rather than erroring', () => {
  removeConfig()
  const context = reader.contextFor('calendar', CONTRACT)
  assert.strictEqual(context.ok, false)
  assert.strictEqual(context.code, reader.REFUSAL.NO_CONFIG)
  assert.ok(context.message.includes('setup'), 'the message does not say to run setup, which is the whole remedy')
})

check('a config that will not parse is refused and not treated as absent', () => {
  fs.writeFileSync(process.env.GTM_OPERATOR_CONFIG, '{ not json')
  const context = reader.contextFor('calendar', CONTRACT)
  assert.strictEqual(context.code, reader.REFUSAL.NOT_JSON)
  // The distinction matters: NO_CONFIG sends somebody to install, and installing
  // over a workspace that exists is how a second Calendar appears.
  assert.notStrictEqual(context.code, reader.REFUSAL.NO_CONFIG)
})

check('a future config version is refused, naming both versions', () => {
  const config = completeConfig()
  config.configVersion = writer.CONFIG_VERSION + 1
  writeConfig(config)
  const context = reader.contextFor('calendar', CONTRACT)
  assert.strictEqual(context.code, reader.REFUSAL.WRONG_VERSION)
  assert.strictEqual(context.found, writer.CONFIG_VERSION + 1)
  assert.strictEqual(context.expected, reader.CONFIG_VERSION)
})

check('an unfinished install is refused', () => {
  const config = completeConfig()
  config.state = 'creating'
  writeConfig(config)
  const context = reader.contextFor('calendar', CONTRACT)
  assert.strictEqual(context.code, reader.REFUSAL.INSTALL_UNFINISHED)
})

// The refusal above used to end "it is safe to run again on an unfinished
// install", which is true of a run that stopped partway and false of one whose
// databases were deleted afterwards. On 2026-08-21 the shipped config was the
// second kind: six recorded, six in the trash, so resume created nothing and
// the advice sent the reader nowhere.
//
// THESE ASSERT THE WHOLE MESSAGE, ON PURPOSE, AND THE EXPECTED TEXT IS WRITTEN
// OUT BY HAND. The first attempt at pinning this matched three substrings, and
// review on 2026-08-21 produced a message that passes all three while saying the
// opposite of the truth:
//
//   "The recorded databases may have been deleted, but it is safe to resume.
//    Do not start a fresh one against a new parent page."
//
// `/deleted/` matches, the remedy phrase matches despite being negated, and the
// ban on "safe to run again" is dodged by "safe to resume". A substring is the
// wrong instrument for a claim about direction.
//
// The expected strings below are NOT built by calling the same helper the source
// uses. That would only prove the file agrees with itself. They are literals a
// person wrote, so changing the message means reconciling three of them by hand
// and deciding, each time, whether the new wording is still true.
const unfinishedMessage = (recorded, verified) => [
  `The gtm-operator install has not finished. The config at ${reader.CONFIG_PATH} says "creating", ` +
    `with ${recorded} recorded and ${verified}.`,
  '  Run the `setup` plugin\'s install to finish it. It resumes by creating only the databases that are ' +
    'not already recorded, so a run that stopped partway picks up where it left off.',
  '  If the recorded databases have since been deleted, resume creates nothing and the run then fails ' +
    'against databases that are no longer there. That is not a resumable install: move this config aside ' +
    'first, then install again, because `begin` refuses a different parent page while one is recorded.'
].join('\n')

check('the unfinished refusal reads exactly as written, when a verify has already passed', () => {
  // `completeConfig` carries a verify timestamp, so flipping only `state` builds
  // the state `install.js verify` leaves behind: verified, not yet complete.
  // The first version of this message called that "nothing verified yet".
  const config = completeConfig()
  config.state = 'creating'
  writeConfig(config)
  const context = reader.contextFor('calendar', CONTRACT)
  assert.strictEqual(context.code, reader.REFUSAL.INSTALL_UNFINISHED)
  assert.strictEqual(
    context.message,
    unfinishedMessage('1 database', 'a verify recorded at 2026-08-19T00:00:00Z')
  )
  assert.strictEqual(context.verifiedAt, '2026-08-19T00:00:00Z')
})

check('the unfinished refusal reads exactly as written, when nothing has been verified', () => {
  const config = completeConfig()
  config.state = 'creating'
  delete config.verified
  delete config.verifiedAt
  writeConfig(config)
  const context = reader.contextFor('calendar', CONTRACT)
  assert.strictEqual(
    context.message,
    unfinishedMessage('1 database', 'nothing verified yet')
  )
  assert.strictEqual(context.verifiedAt, null)
})

check('the count is derived from every recorded database, not from whether this one exists', () => {
  // Three entries, so a count that answered 1 whenever the asked-for database is
  // present would be caught. The single-entry fixture above cannot tell those
  // apart, which review found on 2026-08-21.
  const config = completeConfig()
  config.state = 'creating'
  config.databases.memos = { databaseId: 'db-2', dataSourceId: 'ds-2' }
  config.databases.process = { databaseId: 'db-3', dataSourceId: 'ds-3' }
  writeConfig(config)
  const context = reader.contextFor('calendar', CONTRACT)
  assert.strictEqual(context.recorded, 3)
  assert.strictEqual(
    context.message,
    unfinishedMessage('3 databases', 'a verify recorded at 2026-08-19T00:00:00Z')
  )
})

check('an entry recorded with a missing id still counts as recorded, and is named later', () => {
  // Deliberate, and the comment in `config-read.js` says why: resume creates the
  // databases whose KEY is absent, so the key count is what predicts a resume.
  // A half-recorded entry is a key resume skips, and `IDS_INCOMPLETE` names it
  // once the install is complete rather than burying it inside a total.
  const config = completeConfig()
  config.state = 'creating'
  config.databases.memos = {}
  writeConfig(config)
  assert.strictEqual(reader.contextFor('calendar', CONTRACT).recorded, 2)

  // And the shapes that are not keys at all count as zero rather than throwing.
  const empty = completeConfig()
  empty.state = 'creating'
  delete empty.databases
  writeConfig(empty)
  const context = reader.contextFor('calendar', CONTRACT)
  assert.strictEqual(context.recorded, 0)
  assert.ok(context.message.includes('0 databases recorded'), context.message)
})

check('a database the config does not record is refused', () => {
  const config = completeConfig()
  delete config.databases.calendar
  writeConfig(config)
  assert.strictEqual(reader.contextFor('calendar', CONTRACT).code, reader.REFUSAL.DATABASE_MISSING)
})

check('a database recorded with only one of the two ids is refused', () => {
  const config = completeConfig()
  delete config.databases.calendar.dataSourceId
  writeConfig(config)
  assert.strictEqual(reader.contextFor('calendar', CONTRACT).code, reader.REFUSAL.IDS_INCOMPLETE)
})

check('a database with no recorded names is refused rather than falling back', () => {
  // The failure this reader exists to prevent. `setup`'s names.propertyName
  // answers the logical name here, which is right for setup and wrong for a
  // writer: on a renamed workspace it writes to a property that is not there.
  const config = completeConfig()
  config.databases.calendar.properties = {}
  config.databases.calendar.values = {}
  writeConfig(config)
  assert.strictEqual(reader.contextFor('calendar', CONTRACT).code, reader.REFUSAL.NO_NAME_MAP)

  assert.strictEqual(
    names.propertyName({ properties: {}, values: {} }, 'Name'),
    'Name',
    'setup no longer falls back, so the reason this reader refuses has changed and this comment is stale'
  )
})

check('a broken name map is refused separately from an absent one', () => {
  const config = completeConfig()
  config.databases.calendar.properties = { Name: 'Title', Description: 'Title' }
  writeConfig(config)
  const context = reader.contextFor('calendar', CONTRACT)
  assert.strictEqual(context.code, reader.REFUSAL.BROKEN_NAME_MAP)
  assert.ok(Array.isArray(context.problems) && context.problems.length >= 1)
})

check('a context asked for without a contract is refused, and says whose bug it is', () => {
  // The check that makes every other check on this page reachable. A caller that
  // passes no contract cannot have its map checked for completeness, and the
  // answer is a refusal rather than a context that merely looks checked.
  writeConfig(completeConfig())
  const context = reader.contextFor('calendar')
  assert.strictEqual(context.ok, false)
  assert.strictEqual(context.code, reader.REFUSAL.NO_CONTRACT)
  assert.ok(context.message.includes('calling plugin'), 'the message does not say the bug is in the plugin rather than the config')
})

check('a map holding one property out of eighteen is refused, not reported usable', () => {
  // The state this whole completeness check was added for, on 2026-08-19. It
  // used to return ok, and the first read of any other property threw a message
  // blaming the caller for a bug the config had.
  const config = completeConfig()
  config.databases.calendar.properties = { Name: 'Name' }
  writeConfig(config)
  const context = reader.contextFor('calendar', CONTRACT)
  assert.strictEqual(context.ok, false)
  assert.strictEqual(context.code, reader.REFUSAL.BROKEN_NAME_MAP)
  assert.ok(
    context.problems.some(p => p.includes('"Type" is not in the map')),
    `the refusal does not name a missing property. It said: ${context.problems.join(' | ')}`
  )
})

check('a property in the map that this database does not have is refused', () => {
  const config = completeConfig()
  config.databases.calendar.properties.Invented = 'Invented'
  writeConfig(config)
  const context = reader.contextFor('calendar', CONTRACT)
  assert.strictEqual(context.code, reader.REFUSAL.BROKEN_NAME_MAP)
  assert.ok(context.problems.some(p => p.includes('"Invented" is in the map')))
})

check('an option map missing a value is refused, because the fallback would invent one', () => {
  // Not a cosmetic gap. `valueName` falls back to the shipped name for a value
  // the map does not carry, so a workspace that renamed one is sent the old
  // name. Notion refuses a value the property does not have, measured against a
  // live workspace on 2026-08-17 and recorded in `REVIEW-codex-2026-08-17.md`: a
  // hard 400 naming the value and listing the allowed ones. The failure is all or
  // nothing, so the whole write is lost rather than partly saved.
  const config = completeConfig()
  delete config.databases.calendar.values.Status.Confirmed
  writeConfig(config)
  const context = reader.contextFor('calendar', CONTRACT)
  assert.strictEqual(context.code, reader.REFUSAL.BROKEN_NAME_MAP)
  assert.ok(context.problems.some(p => p.includes('"Confirmed" is not in the map')))
})

check('a property with options and no option map at all is refused', () => {
  const config = completeConfig()
  delete config.databases.calendar.values.Type
  writeConfig(config)
  const context = reader.contextFor('calendar', CONTRACT)
  assert.strictEqual(context.code, reader.REFUSAL.BROKEN_NAME_MAP)
  assert.ok(context.problems.some(p => p.includes('"Type" has options')))
})

check('two option values pointing at one Notion option is refused', () => {
  const config = completeConfig()
  config.databases.calendar.values.Status.Confirmed = config.databases.calendar.values.Status.Planned
  writeConfig(config)
  const context = reader.contextFor('calendar', CONTRACT)
  assert.strictEqual(context.code, reader.REFUSAL.BROKEN_NAME_MAP)
  assert.ok(context.problems.some(p => p.includes('both map to')))
})

check('the reader and the writer report the same problems about the same map', () => {
  // The two halves of one rule. A map the writer accepts and the reader refuses
  // is a workspace that installs and then cannot be written to, and the reverse
  // is a workspace that writes through a map the writer would have rejected.
  const identity = schema.identityNames('calendar')
  const broken = [
    { properties: { Name: 'Name' }, values: identity.values },
    { properties: Object.assign({}, identity.properties, { Invented: 'Invented' }), values: identity.values },
    { properties: identity.properties, values: Object.assign({}, identity.values, { Type: {} }) }
  ]
  for (const entry of broken) {
    const readerSaid = reader.inspectNames(entry, CONTRACT)
    const writerSaid = names.problems(entry, identity)
    assert.strictEqual(readerSaid.state, 'broken', 'the reader accepted a map the writer rejects')
    assert.ok(writerSaid.length >= 1, 'the writer accepted a map the reader rejects')
  }
})

// -------------------------------------------------------- the working case

check('a finished install returns a usable context', () => {
  writeConfig(completeConfig())
  const context = reader.contextFor('calendar', CONTRACT)
  assert.strictEqual(context.ok, true)
  assert.strictEqual(context.databaseId, 'db-1')
  assert.strictEqual(context.dataSourceId, 'ds-1')
  assert.strictEqual(context.property('Name'), 'Name')
  assert.strictEqual(context.value('Status', 'Confirmed'), 'Confirmed')
})

check('a renamed property resolves to the workspace name', () => {
  const config = completeConfig()
  config.databases.calendar.properties.Name = 'Thing'
  writeConfig(config)
  const context = reader.contextFor('calendar', CONTRACT)
  assert.strictEqual(context.ok, true)
  assert.strictEqual(context.property('Name'), 'Thing')
})

check('a logical name that is not in the map throws rather than guessing', () => {
  writeConfig(completeConfig())
  const context = reader.contextFor('calendar', CONTRACT)
  assert.throws(() => context.property('Not A Property'), /not in the recorded name map/)
})

check('a null personId is a working install, not a refusal', () => {
  // SKILLS-setup.md tier 3. Null means every person property is omitted, and no
  // skill fails over it. A reader that refused here would turn a documented
  // fallback into a broken install.
  const config = completeConfig()
  config.notion.personId = null
  writeConfig(config)
  const context = reader.contextFor('calendar', CONTRACT)
  assert.strictEqual(context.ok, true)
  assert.strictEqual(context.personId, null)
})

// ------------------------------------------------------------------ cleanup

fs.rmSync(SANDBOX, { recursive: true, force: true })

console.log(failures ? `\n${failures} failed.\n` : `\nAll checks passed.\n`)
process.exit(failures ? 1 : 0)

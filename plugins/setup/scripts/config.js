'use strict'

/**
 * The one config file the whole marketplace reads.
 *
 * `~/.claude/gtm-operator.config.json`, named for the marketplace and not for a
 * plugin. Six plugins reading six config files is six chances for them to
 * disagree about which database is Process.
 *
 * `setup` is the only thing that writes it. Everything else reads it.
 *
 * WHY IT IS WRITTEN AS THE RUN GOES rather than at the end. A run that dies
 * halfway leaves a file that says `creating`, which is what lets the next run
 * tell a retry from a mess. A config written only on success would leave a
 * half-built workspace with no record that anything had started, and the next
 * run would create a second Process beside the first.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')

const { DATABASES } = require('./manifest')
const { fingerprint } = require('./fingerprint')
const schema = require('./schema')
const mapped = require('./names')

/**
 * Bumped when the shape below changes in a way that would make an older reader
 * wrong. It exists so `check` can refuse a file it cannot read instead of
 * quietly misreading one.
 */
const CONFIG_VERSION = 3

const CONFIG_PATH = process.env.GTM_OPERATOR_CONFIG || path.join(os.homedir(), '.claude', 'gtm-operator.config.json')

/** The empty file a run starts from. */
function blank (parentPageId) {
  return {
    configVersion: CONFIG_VERSION,
    state: 'creating',
    notion: {
      parentPageId: parentPageId || null,
      personId: null
    },
    databases: {},
    // Set only by a verify that passed, and cleared by anything that changes
    // what was verified. `complete` reads this and nothing else.
    verified: null,
    defaults: { reviewCadence: 'Quarterly' },
    sources: { callRecorder: null },
    taxonomyPath: path.join(os.homedir(), '.claude', 'gtm-operator', 'artifact-types.md')
  }
}

function exists () {
  return fs.existsSync(CONFIG_PATH)
}

function read () {
  if (!exists()) return null
  let raw
  try {
    raw = fs.readFileSync(CONFIG_PATH, 'utf8')
  } catch (error) {
    throw new Error(`Config is at ${CONFIG_PATH} and could not be read: ${error.message}`)
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    // Deliberately not repaired and deliberately not overwritten. A config that
    // will not parse may be holding the only record of six database ids.
    throw new Error(
      `Config at ${CONFIG_PATH} is not valid JSON: ${error.message}\n` +
      `It is not being rewritten, because it may hold the only record of what was created. Fix it or move it aside.`
    )
  }
  if (parsed.configVersion !== CONFIG_VERSION) {
    throw new Error(
      `Config at ${CONFIG_PATH} is version ${parsed.configVersion} and this is version ${CONFIG_VERSION}. ` +
      `Refusing to read it rather than guessing at what changed.`
    )
  }
  return parsed
}

/**
 * Written to a temporary file and moved into place, so an interrupted write
 * cannot leave a half-written config. A truncated config is worse than no
 * config: it reads as a workspace that does not exist and invites a second one.
 */
function write (config) {
  const directory = path.dirname(CONFIG_PATH)
  fs.mkdirSync(directory, { recursive: true })
  const temporary = path.join(directory, `.gtm-operator.config.${process.pid}.tmp`)
  fs.writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`)
  fs.renameSync(temporary, CONFIG_PATH)
  return CONFIG_PATH
}

/**
 * Forget that a verify passed.
 *
 * Called by everything that changes what the verify was run against. Without
 * this, `complete` would still be resting on a proof taken before the change:
 * verify, then point a database somewhere else, then complete, and the config
 * would say the workspace matches the manifest on the strength of a check that
 * ran against a different workspace.
 */
function invalidateVerification (config) {
  config.verified = null
  config.verifiedAt = null
  // The completion claim goes with it. `state: 'complete'` is a claim that the
  // workspace matches the manifest, and it is only ever reachable through a
  // proof. Clearing the proof and leaving the claim left a config reading
  // `complete` with `verifiedAt: null`, and every other plugin decides whether
  // to trust this workspace by reading `state`, not by reading the proof.
  if (config.state === 'complete') config.state = 'creating'
  return config
}

/** Start a run, or refuse to start on top of one that is already complete. */
function begin (parentPageId) {
  const current = read()
  if (current && current.state === 'complete') {
    throw new Error(
      `Config at ${CONFIG_PATH} says an install is already complete, so this refuses to start a second one over the top of it.\n` +
      `There is no settings path yet: nothing here can re-ask the five questions on a complete config. ` +
      `Change a setting by editing that file, and move it aside if you genuinely want to install again.`
    )
  }
  const config = current || blank(parentPageId)
  if (parentPageId) config.notion.parentPageId = parentPageId
  config.state = 'creating'
  invalidateVerification(config)
  write(config)
  return config
}

/**
 * Record what phase A returned for one database.
 *
 * Both ids, always. A database can hold more than one data source, and
 * querying, creating pages and naming a relation target all need the data
 * source id, while the view calls need the database id. Storing one and
 * deriving the other later is a lookup that can come back with a different
 * answer than the one this run used.
 */
function recordDatabase (key, { databaseId, dataSourceId, displayName }) {
  if (!DATABASES.some(d => d.key === key)) {
    throw new Error(`"${key}" is not a database in the manifest. Known: ${DATABASES.map(d => d.key).join(', ')}`)
  }
  if (!databaseId || !dataSourceId) {
    throw new Error(`${key}: both a database id and a data source id are needed, and only ${databaseId ? 'the database id' : 'the data source id'} was given`)
  }

  const config = read() || blank(null)
  const already = config.databases[key]
  // Both halves of the pair, not just one. This used to compare the data source
  // id alone, so a different database id arriving with a matching data source id
  // was written straight over the recorded one: the guard against overwriting
  // committed the fault it was written to stop, one field along.
  //
  // The two ids are separate identities and a data source belongs to exactly one
  // database, so a mismatch on either is not a legitimate move. It is a mangled
  // create response, a hand-edited config or a bug, and none of the three is
  // safe to resolve by overwriting.
  if (already && (already.dataSourceId !== dataSourceId || already.databaseId !== databaseId)) {
    throw new Error(
      `${key} is already recorded as database ${already.databaseId} / data source ${already.dataSourceId}, ` +
      `and this run is offering database ${databaseId} / data source ${dataSourceId}. ` +
      `Two databases now exist for one logical name, or something recorded the wrong pair. ` +
      `Nothing is being overwritten: a person has to say which one to keep.`
    )
  }

  // The name map is written HERE, at the moment the plugin created these
  // properties and therefore knows what they are called. Every logical name
  // points at itself, including the ones nobody will ever rename.
  //
  // It used to be initialised to `{}` and never written to by anything, so an
  // empty map meant both "no renames" and "never recorded" and no reader could
  // tell which. `check` has to tell a renamed property from a deleted one, and
  // that is impossible without knowing whether a map was ever taken.
  const identity = schema.identityNames(key)

  // An existing map is kept, because it may hold renames somebody adopted, and
  // it is CHECKED before it is kept. `recordNames` is meant to be the only way
  // a map changes, and it validates. It is not the only way one arrives: this
  // function used to write back whatever was already on disk, so a hand-edited
  // or half-written map went straight through the gate and into every later
  // read. Silently replacing it with the identity map would be worse, because
  // that quietly discards a real rename. So it is refused loudly.
  const existing = already && mapped.recorded({ properties: already.properties })
    ? { properties: already.properties, values: already.values || {} }
    : null
  if (existing) {
    const problems = mapped.problems(existing, identity)
    if (problems.length) {
      throw new Error(
        `${key} already carries a name map that cannot be used:\n  ${problems.join('\n  ')}\n` +
        `  Nothing has been written. Fix the map in ${CONFIG_PATH}, or remove the properties and values entries to start again from the shipped names.`
      )
    }
  }

  config.databases[key] = {
    databaseId,
    dataSourceId,
    displayName: displayName || DATABASES.find(d => d.key === key).title,
    properties: existing ? existing.properties : identity.properties,
    values: existing ? existing.values : identity.values
  }
  invalidateVerification(config)
  write(config)
  return config
}

/**
 * Point a database at a data source that replaced the recorded one.
 *
 * SEPARATE FROM `recordDatabase` ON PURPOSE. That function refuses a recorded
 * pair being offered a different data source id, and that guard stays: a
 * mismatch there is a mangled create response, a hand-edited config or a bug,
 * and none of the three is safe to resolve by overwriting. This is the one
 * legitimate case, and it is narrow enough to be written out rather than folded
 * into the general path.
 *
 * WHAT THIS FUNCTION CHECKS. That the database is recorded, that the database
 * id is unchanged, that the recorded data source is still the one the caller
 * looked at, and that the move is to a different id.
 *
 * WHAT IT CANNOT CHECK, and what the caller must have established first:
 *
 *   - that the recorded data source no longer resolves. Adopting while the
 *     recorded one is healthy is the thing `check` warns about and refuses to
 *     act on: a second data source appearing is a warning, never a repair.
 *   - that the new one belongs to this database.
 *   - that there is exactly one candidate, or that a person picked this one.
 *
 * All three are facts about a read-back, and this file has no way to reach
 * Notion. Saying so here rather than implying the guard is complete.
 */
function reresolveDataSource (key, { databaseId, from, to }) {
  const config = read()
  const entry = config && config.databases && config.databases[key]
  if (!entry) {
    throw new Error(`${key} is not recorded, so there is no data source to re-resolve. Record the database first.`)
  }
  if (!databaseId || !from || !to) {
    throw new Error(`${key}: re-resolving a data source needs the database id, the recorded data source id and the new one.`)
  }
  if (entry.databaseId !== databaseId) {
    throw new Error(
      `${key} is recorded against database ${entry.databaseId} and this is offering ${databaseId}. ` +
      `A data source moving between databases is not a re-resolve, and nothing has been written.`
    )
  }
  // The pair that was judged, not merely the pair being offered. Between the
  // read-back and the approval, anything else writing to config would make this
  // an adoption of a decision taken about a different workspace.
  if (entry.dataSourceId !== from) {
    throw new Error(
      `${key} was recorded as data source ${from} when this was judged and is now ${entry.dataSourceId}. ` +
      `Something changed the config in between, so nothing has been written. Run the check again.`
    )
  }
  if (from === to) {
    throw new Error(`${key} is already recorded as data source ${to}, so there is nothing to change.`)
  }

  entry.dataSourceId = to
  invalidateVerification(config)
  write(config)
  return config
}

function recordPerson (personId) {
  const config = read() || blank(null)
  config.notion.personId = personId || null
  invalidateVerification(config)
  write(config)
  return config
}

/**
 * Forget any recorded verify, on disk, before a new one is attempted.
 *
 * `install.js verify` calls this the moment it starts, ahead of reading or
 * parsing anything. Without it a run that passed left its record standing while
 * a later run failed, and `complete` accepted the old one: verify, change the
 * workspace, verify again and watch it fail, complete anyway. That is the fault
 * this whole file was just changed to remove, sitting one level up from where it
 * was removed.
 *
 * It is deliberately not inside `write`. `recordVerified` and `complete` both
 * write, and clearing from in there would erase the proof as it was being
 * recorded.
 */
function clearVerified () {
  const config = read()
  if (!config) return { existed: false, wasComplete: false }
  const wasComplete = config.state === 'complete'
  invalidateVerification(config)
  write(config)
  // What it was is handed back, because a verify that PASSES has to be able to
  // put it back. Demoting without that made a passing re-verify of a finished
  // install silently un-complete it: state 'creating' beside a fresh
  // verifiedAt, which is the same contradiction the demotion was added to
  // remove, pointing the other way.
  return { existed: true, wasComplete }
}

/**
 * Record that a verify passed, which is the only thing `complete` will accept.
 *
 * Written by `install.js verify` and by nothing else. It used to be that
 * `complete` took a timestamp as an argument and believed it, so any non-empty
 * string was accepted as evidence that a check had run.
 */
function recordVerified (at) {
  const config = read()
  if (!config) throw new Error('There is no config to record a verify against.')
  if (!at) throw new Error('recordVerified needs the time the verify passed.')
  // Which manifest it was checked against, not only when. A proof says a
  // workspace matches THIS manifest, and without recording which one it stayed
  // usable after the manifest changed underneath it.
  config.verified = { at, definitions: fingerprint() }
  config.verifiedAt = at
  write(config)
  return config
}

/** The ids phase B and the views need, in the shape those files expect. */
/**
 * The names this workspace uses for one database, or null if none were ever
 * recorded.
 *
 * Null and "nothing was renamed" are different answers and a caller that
 * cannot tell them apart must refuse rather than assume. `check` refuses.
 */
function namesFor (key) {
  const config = read()
  const entry = config && config.databases && config.databases[key]
  if (!entry) return null
  const names = { properties: entry.properties || {}, values: entry.values || {} }
  if (!mapped.recorded(names)) return null

  // A map that is present and wrong is not the same as no map, and answering
  // null for both would collapse them into one answer, which is the thing this
  // map exists to stop one level up. A caller can handle "nothing recorded". No
  // caller can handle being handed a map that misdirects its reads.
  const problems = mapped.problems(names, schema.identityNames(key))
  if (problems.length) {
    throw new Error(
      `The name map recorded for ${key} cannot be used:\n  ${problems.join('\n  ')}\n` +
      `  It is in ${CONFIG_PATH}. Nothing was read through it.`
    )
  }
  return names
}

/** Every recorded name map, keyed by database, for the callers that check all six. */
function allNames () {
  const out = {}
  for (const d of DATABASES) {
    const names = namesFor(d.key)
    if (names) out[d.key] = names
  }
  return out
}

/**
 * Adopt a rename somebody made in Notion.
 *
 * This is the only way a map changes after install, and `check` is the only
 * caller, on an explicit yes. It refuses a map that is not complete, in either
 * half, and refuses two logical names pointing at one Notion name, because both
 * leave every later read answering about the wrong thing while looking healthy.
 */
function recordNames (key, { properties, values }) {
  if (!DATABASES.some(d => d.key === key)) {
    throw new Error(`"${key}" is not a database in the manifest. Known: ${DATABASES.map(d => d.key).join(', ')}`)
  }
  const config = read()
  if (!config || !config.databases[key]) {
    throw new Error(`${key} is not recorded yet, so there is nothing to rename. Record the database first.`)
  }

  const problems = mapped.problems({ properties, values }, schema.identityNames(key))
  if (problems.length) {
    throw new Error(`${key}: this name map cannot be recorded.\n  ${problems.join('\n  ')}`)
  }

  config.databases[key].properties = properties
  config.databases[key].values = values || config.databases[key].values
  invalidateVerification(config)
  write(config)
  return config
}

function ids () {
  const config = read()
  if (!config) return {}
  const out = {}
  for (const [key, value] of Object.entries(config.databases)) {
    out[key] = { databaseId: value.databaseId, dataSourceId: value.dataSourceId }
  }
  return out
}

function missingDatabases () {
  const have = new Set(Object.keys((read() || { databases: {} }).databases))
  return DATABASES.filter(d => !have.has(d.key))
}

/**
 * Only ever set after a read-back has been compared. `state: complete` is a
 * claim that the workspace matches the manifest, and the create calls returning
 * without an error is a different and much weaker claim.
 */
function complete () {
  const config = read()
  if (!config) throw new Error('There is no config to complete.')
  if (missingDatabases().length) {
    throw new Error(`Not complete: ${missingDatabases().map(d => d.title).join(', ')} ${missingDatabases().length === 1 ? 'is' : 'are'} not recorded.`)
  }
  // The proof has to be in the file, put there by a verify that passed. This
  // used to take the timestamp as an argument and check only that it was not
  // empty, so the presence of a string stood in for the check having run.
  if (!config.verified || !config.verified.at) {
    throw new Error(
      'Not complete: no verify has passed against this config. ' +
      'Run `install.js verify <readback.json>` first. It records the result itself, and it records nothing when anything is unproved.'
    )
  }
  // A proof taken against a different manifest is not a proof of this one. It
  // is refused rather than ignored: an absent fingerprint is an older config or
  // a hand-edited one, and neither is evidence.
  if (config.verified.definitions !== fingerprint()) {
    throw new Error(
      `Not complete: the verify that passed was run against a different set of definitions ` +
      `(${config.verified.definitions || 'none recorded'}, and this is ${fingerprint()}). ` +
      `What was checked is not what would be built now. Run the verify again.`
    )
  }
  config.state = 'complete'
  config.verifiedAt = config.verified.at
  write(config)
  return config
}

module.exports = {
  recordVerified, clearVerified,
  CONFIG_PATH, CONFIG_VERSION, blank, exists, read, write, begin,
  recordDatabase, recordPerson, reresolveDataSource, ids, missingDatabases, complete,
  namesFor, allNames, recordNames
}

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

/**
 * Bumped when the shape below changes in a way that would make an older reader
 * wrong. It exists so `check` can refuse a file it cannot read instead of
 * quietly misreading one.
 */
const CONFIG_VERSION = 1

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

/** Start a run, or refuse to start on top of one that is already complete. */
function begin (parentPageId) {
  const current = read()
  if (current && current.state === 'complete') {
    throw new Error(
      `Config at ${CONFIG_PATH} says an install is already complete. ` +
      `Re-running install on a complete config is the settings path: it creates nothing and re-asks the five questions.`
    )
  }
  const config = current || blank(parentPageId)
  if (parentPageId) config.notion.parentPageId = parentPageId
  config.state = 'creating'
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
  if (already && already.dataSourceId !== dataSourceId) {
    throw new Error(
      `${key} is already recorded as ${already.dataSourceId} and this run created ${dataSourceId}. ` +
      `Two databases now exist for one logical name. Nothing is being overwritten: a person has to say which one to keep.`
    )
  }

  config.databases[key] = {
    databaseId,
    dataSourceId,
    displayName: displayName || DATABASES.find(d => d.key === key).title,
    properties: (already && already.properties) || {},
    values: (already && already.values) || {}
  }
  write(config)
  return config
}

function recordPerson (personId) {
  const config = read() || blank(null)
  config.notion.personId = personId || null
  write(config)
  return config
}

/** The ids phase B and the views need, in the shape those files expect. */
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
function complete (verifiedAt) {
  const config = read()
  if (!config) throw new Error('There is no config to complete.')
  if (!verifiedAt) throw new Error('An install is only complete once it has been verified against what Notion returned.')
  if (missingDatabases().length) {
    throw new Error(`Not complete: ${missingDatabases().map(d => d.title).join(', ')} ${missingDatabases().length === 1 ? 'is' : 'are'} not recorded.`)
  }
  config.state = 'complete'
  config.verifiedAt = verifiedAt
  write(config)
  return config
}

module.exports = {
  CONFIG_PATH, CONFIG_VERSION, blank, exists, read, write, begin,
  recordDatabase, recordPerson, ids, missingDatabases, complete
}

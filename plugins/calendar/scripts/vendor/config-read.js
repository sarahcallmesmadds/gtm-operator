// GENERATED FILE. DO NOT EDIT.
// Copied from shared/config-read.js by scripts/vendor.js.
// Edit the source and re-run that script. An edit here is reverted by the
// next run and reported as drift by tests/vendor-copies-current.test.js.
'use strict'

/**
 * Reading the foundation's shared config, for every foundation plugin that is
 * not `setup`. A job plugin keeps a private config of its own and carries no
 * copy of this file.
 *
 * THIS FILE IS THE SOURCE. It is copied into each plugin's `scripts/vendor/`
 * by `scripts/vendor.js`, and `tests/vendor-copies-current.test.js` fails when
 * a copy has drifted. Edit this file, run the vendor script, never edit a copy.
 *
 * WHY A COPY AND NOT A REQUIRE. Claude Code has no dependency resolution
 * between plugins, and skills resolve their scripts through
 * `${CLAUDE_PLUGIN_ROOT}`, which points inside the calling plugin. Once
 * installed, `calendar` has no path to `setup`'s files and must not have one:
 * the marketplace is plugins that never call each other. So the choice is
 * between copies that drift silently and copies a test holds together, and
 * `SKILLS-setup.md` build risk 3 already decided it is the second.
 *
 * WHAT THIS FILE DELIBERATELY CANNOT DO. It cannot write. There is no `begin`,
 * no `complete`, no `recordDatabase`, no `recordNames`. `setup` is the only
 * thing that writes the foundation's config, and the surest way to keep that
 * true is for the code every plugin that reads it carries to have no way of
 * doing it.
 *
 * THE ONE ENTRY POINT IS `contextFor`. Everything else is exported for tests.
 * An earlier draft of this handed out ids, state and the name map as separate
 * reads and left each skill to remember which combinations were unsafe. That is
 * how a writer eventually runs against a half-built install: not by deciding to,
 * but by a skill that checked two of the three things. `contextFor` returns a
 * context that is safe to write through, or it refuses and says why.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')

/**
 * The shape of the config file.
 *
 * MUST MATCH `plugins/setup/scripts/config.js`. That file is the writer and this
 * is a reader, they are separate files by necessity, and
 * `tests/config-contract.test.js` fails when the two numbers disagree.
 *
 * A reader that accepts a version it does not understand is worse than one that
 * refuses, because every id it hands back afterwards is a guess.
 */
const CONFIG_VERSION = 3

/**
 * MUST MATCH the writer, including the environment override, which the tests
 * use to run against a temporary file rather than the real one.
 */
const CONFIG_PATH = process.env.GTM_OPERATOR_CONFIG ||
  path.join(os.homedir(), '.claude', 'gtm-operator.config.json')

/**
 * Every reason a read can fail, as a code rather than as prose.
 *
 * Skills branch on these. `NO_CONFIG` routes to `setup` and is an ordinary
 * first-run state rather than an error; the rest are genuine problems and read
 * differently to a user. Prose gets reworded, and a skill keying off the
 * wording breaks silently when it is.
 */
const REFUSAL = {
  NO_CONFIG: 'NO_CONFIG',
  UNREADABLE: 'UNREADABLE',
  NOT_JSON: 'NOT_JSON',
  WRONG_VERSION: 'WRONG_VERSION',
  INSTALL_UNFINISHED: 'INSTALL_UNFINISHED',
  DATABASE_MISSING: 'DATABASE_MISSING',
  IDS_INCOMPLETE: 'IDS_INCOMPLETE',
  NO_NAME_MAP: 'NO_NAME_MAP',
  BROKEN_NAME_MAP: 'BROKEN_NAME_MAP',
  // The `databases` value is not a map at all. Separate from a database being
  // missing from that map, which is `DATABASE_MISSING` and an ordinary state.
  DATABASES_DAMAGED: 'DATABASES_DAMAGED',
  // A caller that asked for a context without saying what the map has to
  // contain. Not a state of the world: a bug in the plugin, reported as one.
  NO_CONTRACT: 'NO_CONTRACT'
}

/** What the damaged value actually is, so the message names it. */
function describeDatabases (value) {
  if (value === undefined) return 'missing'
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'an array'
  return `a ${typeof value}`
}

/** A refusal, in the one shape every caller handles. */
function refuse (code, message, extra) {
  return Object.assign({ ok: false, code, message }, extra || {})
}

/**
 * Read and parse, with each failure kept separate.
 *
 * A missing file, an unreadable one and one full of invalid JSON are three
 * different situations with three different remedies, and collapsing them into
 * "no config" would send somebody to reinstall over the top of a workspace that
 * exists. That is the same failure `setup`'s reader was built to avoid, and the
 * reasoning there is worth repeating here: a config that will not parse may hold
 * the only record of the database ids.
 *
 * NOTHING HERE REPAIRS OR REWRITES. This file cannot write at all, which is the
 * point, but it is worth saying next to the parse failure specifically, because
 * overwriting a corrupt config is the tempting wrong move.
 */
function readRaw () {
  if (!fs.existsSync(CONFIG_PATH)) {
    return refuse(
      REFUSAL.NO_CONFIG,
      `No gtm-operator config at ${CONFIG_PATH}. Run the \`setup\` plugin's install first: it creates the databases and writes this file.`
    )
  }

  let text
  try {
    text = fs.readFileSync(CONFIG_PATH, 'utf8')
  } catch (error) {
    return refuse(REFUSAL.UNREADABLE, `Config is at ${CONFIG_PATH} and could not be read: ${error.message}`)
  }

  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return refuse(
      REFUSAL.NOT_JSON,
      `Config at ${CONFIG_PATH} is not valid JSON: ${error.message}\n` +
      `Nothing here rewrites it, because it may hold the only record of what was created. Fix it or move it aside.`
    )
  }

  if (parsed.configVersion !== CONFIG_VERSION) {
    return refuse(
      REFUSAL.WRONG_VERSION,
      `Config at ${CONFIG_PATH} is version ${parsed.configVersion} and this plugin reads version ${CONFIG_VERSION}. ` +
      `Refusing to read it rather than guessing at what changed. Update the plugin that is behind.`,
      { found: parsed.configVersion, expected: CONFIG_VERSION }
    )
  }

  // THE SAME REFUSAL `setup`'s OWN READER MAKES, and it is here because the two
  // disagreeing is worse than either answer. `setup` refuses a `databases` value
  // that is not a map. This file was left counting one, so a config holding an
  // array or a string produced a refusal saying how many databases were recorded,
  // counting array indices or string characters, and told the reader to run the
  // install, which then refused the file outright. Two files, one damaged config,
  // two different stories.
  //
  // Found in review on 2026-08-23. The guard had been added to `setup` alone,
  // which is the fifth time in this branch that a rule was put where the problem
  // was noticed rather than everywhere it applies.
  const databases = parsed.databases
  if (!databases || typeof databases !== 'object' || Array.isArray(databases)) {
    return refuse(
      REFUSAL.DATABASES_DAMAGED,
      `Config at ${CONFIG_PATH} has a "databases" entry that is ${describeDatabases(databases)}, and it should be an object keyed by database name.\n` +
      `  Nothing is read through it and nothing counts it, because a damaged map read as "nothing was recorded" invites an install that builds databases which may already exist.\n` +
      `  Fix that entry, or move the file aside and run the \`setup\` plugin's install again.`,
      { databases: describeDatabases(databases) }
    )
  }

  return { ok: true, config: parsed }
}

/**
 * Is a name map usable for the thing this plugin is about to write?
 *
 * THREE ANSWERS, NOT TWO, and this is the distinction the whole file exists to
 * carry across the plugin boundary.
 *
 *   absent  nothing was ever recorded
 *   broken  something was recorded and cannot be trusted
 *   ok      usable
 *
 * `setup`'s `names.js` resolves an unmapped logical name to itself, which is
 * right for `setup`, because on a default install the shipped name IS the name
 * in Notion. It is dangerous for a writer: on a workspace where somebody renamed
 * a property, that fallback writes to a property that is not there. So a writer
 * must be able to tell "no map" from "a map that happens to be empty", and must
 * refuse rather than fall back.
 *
 * `expected` IS REQUIRED AND IS THE POINT. Well formed is not the same as
 * usable, and until 2026-08-19 this only checked well formed: a map holding
 * `{Name: "Name"}` and nothing else was reported `ok`, and the first read of any
 * other property threw a message blaming the caller for a bug the config had.
 * The quieter half was worse. An option value the map does not mention falls
 * back to the name this plugin shipped with, so a workspace that renamed a value
 * is sent the old one. Notion refuses a value the property does not have,
 * measured against a live workspace on 2026-08-17 and recorded in
 * `REVIEW-codex-2026-08-17.md`: a hard 400 `validation_error` naming the value
 * and listing the allowed ones. The failure is all or nothing, so nothing is
 * saved and the whole write is lost, which is why this is refused at read time
 * rather than left for Notion to reject.
 *
 * The three checks are `setup`'s three, applied to properties and to each set
 * of option values: nothing missing, nothing invented, and no two logical names
 * sharing one Notion name. `tests/config-contract.test.js` asserts this agrees
 * with `names.problems` in `setup` on the same inputs.
 */
function inspectNames (entry, expected) {
  const properties = (entry && entry.properties) || {}
  const values = (entry && entry.values) || {}
  const expectedProperties = (expected && expected.properties) || []
  const expectedValues = (expected && expected.values) || {}

  if (!Object.keys(properties).length) return { state: 'absent' }

  const problems = oneToOne(properties, expectedProperties, 'property', 'this database has')

  const withOptions = Object.keys(expectedValues)
  if (withOptions.length && !Object.keys(values).length) {
    problems.push('the map records no option values at all, and this database has properties with options')
  } else {
    for (const property of withOptions) {
      const got = values[property]
      if (!got || typeof got !== 'object') {
        problems.push(`"${property}" has options and the map records ${got === undefined ? 'none of them' : 'something that is not a map'}`)
        continue
      }
      problems.push(...oneToOne(got, expectedValues[property], `option of "${property}"`, `"${property}" has`))
    }
    for (const property of Object.keys(values)) {
      if (!withOptions.includes(property)) {
        problems.push(`the map records options for "${property}", which has no options`)
      }
    }
  }

  if (problems.length) return { state: 'broken', problems }
  return { state: 'ok', names: { properties, values } }
}

/**
 * One half of a map, checked three ways: nothing missing, nothing invented, and
 * no two logical names sharing one Notion name.
 *
 * DELIBERATELY THE SAME THREE AS `oneToOne` IN `setup`'s `names.js`, including
 * the order they are reported in, because the two run on the same recorded map
 * and a user who saw one message from `setup` and a different one from a writer
 * would reasonably conclude the two disagree about the config rather than about
 * the wording.
 *
 * A missing entry is a refusal rather than a warning, and that is the load
 * bearing choice here. A map records every logical name, including the ones
 * nobody renamed, which is what makes "not in the map" mean "nobody recorded
 * this" rather than "nobody changed this". Accept an incomplete map and those
 * two states collapse into one, and the fallback that follows writes a shipped
 * name into a workspace that renamed it.
 */
function oneToOne (map, expectedLogical, what, belongsTo) {
  const out = []
  const wanted = expectedLogical || []

  for (const logical of wanted) {
    if (!(logical in map)) {
      out.push(`"${logical}" is not in the map. A map records every logical name, including the ones nobody changed`)
    }
  }

  for (const logical of Object.keys(map)) {
    if (!wanted.includes(logical)) {
      out.push(`"${logical}" is in the map and is not a ${what} ${belongsTo}`)
    }
    const observed = map[logical]
    if (typeof observed !== 'string' || !observed.trim()) {
      out.push(`"${logical}" maps to ${JSON.stringify(observed)}, which is not a name. A map entry has to be the name this workspace uses`)
    }
  }

  const seen = new Map()
  for (const [logical, observed] of Object.entries(map)) {
    if (seen.has(observed)) {
      out.push(`"${logical}" and "${seen.get(observed)}" both map to "${observed}". Two logical names cannot be one Notion name`)
    }
    seen.set(observed, logical)
  }

  return out
}

/**
 * The Notion name for a logical property, through a map that has been checked.
 *
 * NO FALLBACK ON PURPOSE, and this is the one place this file knowingly behaves
 * differently from `setup`'s `names.propertyName`. That function returns the
 * logical name when there is no mapping, which is correct for a caller that is
 * creating the property. This throws, because a writer reaching for a property
 * the map does not describe is a writer about to send a name nothing verified.
 *
 * `contextFor` refuses before this can be reached with an unusable map, and
 * since 2026-08-19 "unusable" includes incomplete, checked against the contract
 * the plugin passes in. So a throw here means the caller asked for a logical
 * name that is not in its own contract, which is a bug in the caller rather
 * than a state of the world. That sentence was in this comment before the
 * completeness check existed, when it was not true: a map missing a property
 * reached here and the message blamed the caller for the config's problem.
 */
function propertyName (names, logical) {
  const actual = names && names.properties && names.properties[logical]
  if (typeof actual !== 'string' || !actual) {
    throw new Error(
      `"${logical}" is not in the recorded name map, so there is no property name to write to. ` +
      `The map was checked for completeness against this plugin's contract before it got here, so "${logical}" is not in that contract either. ` +
      `That is a bug in the calling plugin rather than a problem with the config.`
    )
  }
  return actual
}

/**
 * The Notion name for one option of one property.
 *
 * Unmapped falls back to the logical value, and unlike `propertyName` that is
 * correct, but only because of what `contextFor` now guarantees. Every value in
 * this plugin's contract is present in the map or the context was refused, so a
 * value that reaches here unmapped is one the workspace added and this plugin
 * never shipped. Before the completeness check existed the fallback also fired
 * for a value nobody had recorded, which sent a shipped name to a workspace that
 * had renamed it. That produces a hard 400 from Notion, naming the value and
 * listing the allowed ones, measured 2026-08-17 and recorded in
 * `REVIEW-codex-2026-08-17.md`.
 *
 * IT IS STILL NOT PROOF THE OPTION EXISTS. Nothing in a config file can be. The
 * shared rule is that live options are fetched before any value is chosen, and
 * this resolves a name for that fetch to check, rather than standing in for it.
 */
function valueName (names, logicalProperty, logicalValue) {
  const forProperty = names && names.values && names.values[logicalProperty]
  const actual = forProperty && forProperty[logicalValue]
  return (typeof actual === 'string' && actual) ? actual : logicalValue
}

/**
 * Everything a skill needs to write to one database, or a refusal saying why it
 * cannot.
 *
 * THE CHECKS ARE ORDERED CHEAPEST AND MOST FUNDAMENTAL FIRST, so the message a
 * user gets names the thing that is actually wrong. Told about a missing name
 * map when the real problem is that no install ever finished, somebody goes
 * looking in the wrong place.
 */
function contextFor (key, expected) {
  // A contract is not optional, and the check for it comes before the file is
  // even read. A plugin that asks for a write-ready context without saying what
  // the map has to contain is asking for a check that cannot be performed, and
  // the honest answer is a refusal rather than a context that looks checked.
  if (!expected || !Array.isArray(expected.properties) || !expected.properties.length) {
    return refuse(
      REFUSAL.NO_CONTRACT,
      `contextFor("${key}") was called without the expected name contract, so the recorded map cannot be checked for completeness. ` +
      `Pass the plugin's schema identity, for example \`schema.IDENTITY\`. This is a bug in the calling plugin rather than a problem with the config.`
    )
  }

  const raw = readRaw()
  if (!raw.ok) return raw
  const config = raw.config

  // An install still in flight has databases recorded that a later step may
  // still move. `setup` records as it goes precisely so a broken run is
  // recoverable, and the cost of that is a window where the file is honest and
  // not yet finished. Reading ids out of that window is how a row lands in a
  // database that gets replaced ten seconds later.
  if (config.state !== 'complete') {
    // WHY THIS DOES NOT SIMPLY SAY "RUN IT AGAIN, IT IS SAFE". It used to, and
    // that sentence is true of one situation and false of another this cannot
    // tell apart from here. Resume creates only databases that are not already
    // recorded, which is what makes a run that died partway recoverable. It is
    // also what makes a run whose databases were later DELETED a dead end:
    // everything is recorded, so resume creates nothing, and the run then fails
    // against pages in the trash. Met on 2026-08-21 with the 2026-08-19 install:
    // six recorded, and the parent page plus one database fetched and both
    // `deleted`. The other five were not fetched, so their being gone is an
    // inference from the parent rather than a measurement, and this comment used
    // to claim all six had been checked. Telling the two situations apart needs
    // a Notion call, which a config reader does not make, so it names both
    // rather than guessing at one.
    //
    // THE REMEDY NAMES MOVING THE CONFIG ASIDE, and that is not padding.
    // `config.begin` throws when a parent page is already recorded and a
    // different one is passed, so "install against a new parent page" on its own
    // is advice this repository's own code refuses. Found by review on
    // 2026-08-21, and the earlier wording omitted the step.
    //
    // IT DOES NOT NAME THE STEP THAT FAILS. An earlier wording said `verify`,
    // which is narrower than what was measured: phase B and the view calls also
    // read the recorded ids, so a deleted database can fail before `verify` is
    // reached. Saying "fails" is the size of the evidence.
    const recorded = Object.keys(config.databases || {}).length

    // COUNTS KEYS, AND WHAT THAT DOES AND DOES NOT TELL YOU. `install.js phaseA`
    // creates the manifest databases whose KEY is absent here, so for a config
    // holding only keys this version recognises, the count is what predicts how
    // much a resume would create. An entry recorded with one id missing is still
    // a key that resume skips, which is what the reader needs to know.
    //
    // IT IS NOT AN EXACT PREDICTION, and this comment claimed it was until
    // review on 2026-08-22. `missingDatabases` filters the MANIFEST, so a key
    // this version does not recognise is counted here and ignored there: a
    // config holding only `marketing_ops` reports one database recorded while a
    // resume goes on to create all six. The repository supports carrying such
    // keys, so this is reachable rather than theoretical. The count is honest
    // about what is written down, and a reader should not read it as a promise
    // about what install will do.
    //
    // AN EARLIER VERSION OF THIS COMMENT SAID the half-recorded entry is "caught
    // immediately below by `IDS_INCOMPLETE`". That is wrong twice over and review
    // found it: this branch returns before `IDS_INCOMPLETE` is ever reached, and
    // that check only ever looks at the one key being asked for, never the rest.
    // Nothing here names which entry is short an id. That is a real gap in what
    // this message can tell you, and it is stated rather than papered over.
    const verified = config.verifiedAt
      ? `a verify recorded at ${config.verifiedAt}`
      : 'nothing verified yet'
    return refuse(
      REFUSAL.INSTALL_UNFINISHED,
      `The gtm-operator install has not finished. The config at ${CONFIG_PATH} says "${config.state}", ` +
      `with ${recorded} database${recorded === 1 ? '' : 's'} recorded and ${verified}.\n` +
      `  Run the \`setup\` plugin's install to finish it. It resumes by creating only the databases that are ` +
      `not already recorded, so a run that stopped partway picks up where it left off.\n` +
      `  If the recorded databases have since been deleted, resume creates only whatever is still unrecorded ` +
      `and the run then fails against the databases that are no longer there. If everything is recorded it ` +
      `creates nothing at all. That is not a resumable install: move this config aside first, then install ` +
      `again, because \`begin\` refuses a different parent page while one is recorded.`,
      { state: config.state, recorded, verifiedAt: config.verifiedAt ?? null }
    )
  }

  const entry = config.databases && config.databases[key]
  if (!entry) {
    return refuse(
      REFUSAL.DATABASE_MISSING,
      `The config records no "${key}" database, so there is nowhere to write. ` +
      `Run the \`setup\` plugin's \`add\` skill, which creates a missing database and wires it to the others.`
    )
  }

  if (!entry.databaseId || !entry.dataSourceId) {
    return refuse(
      REFUSAL.IDS_INCOMPLETE,
      `"${key}" is recorded with only ${entry.databaseId ? 'a database id' : 'a data source id'}. ` +
      `Both are needed: queries and page creates take the data source id, view calls take the database id. ` +
      `Run the \`setup\` plugin's \`check\` skill.`
    )
  }

  const map = inspectNames(entry, expected)
  if (map.state === 'absent') {
    return refuse(
      REFUSAL.NO_NAME_MAP,
      `"${key}" has no recorded property names, so this cannot tell a renamed property from one that was never there. ` +
      `It is refusing rather than falling back to the names it shipped with, because on a renamed workspace that writes to a property that does not exist. ` +
      `Run the \`setup\` plugin's \`check\` skill, which records them.`
    )
  }
  if (map.state === 'broken') {
    return refuse(
      REFUSAL.BROKEN_NAME_MAP,
      `The names recorded for "${key}" cannot be used:\n  ${map.problems.join('\n  ')}\n` +
      `  They are in ${CONFIG_PATH}. Nothing was read through them, and nothing was written.\n` +
      `  Run the \`setup\` plugin's \`check\` skill, which records them against the live database.`,
      { problems: map.problems }
    )
  }

  const names = map.names

  return {
    ok: true,
    key,
    databaseId: entry.databaseId,
    dataSourceId: entry.dataSourceId,
    displayName: entry.displayName || key,

    /**
     * Null is a legitimate answer and a working install, not a failure.
     * `SKILLS-setup.md` tier 3: where no person could be resolved, every person
     * property is OMITTED rather than written empty, and no skill fails over it.
     */
    personId: (config.notion && config.notion.personId) || null,

    property: logical => propertyName(names, logical),
    value: (logicalProperty, logicalValue) => valueName(names, logicalProperty, logicalValue),
    names
  }
}

module.exports = {
  CONFIG_VERSION,
  CONFIG_PATH,
  REFUSAL,
  contextFor,
  // Exported for the contract test and for callers that genuinely need the
  // pieces. Skills use `contextFor`.
  readRaw,
  inspectNames,
  propertyName,
  valueName
}

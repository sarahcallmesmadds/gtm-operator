'use strict'

/**
 * Whether the plugin can still see what it created, and what it can repair.
 *
 * THE SCRIPT DECIDES, THE MODEL SENDS. Notion calls go through the connected
 * client, which a script cannot reach, so this emits the calls to make and then
 * judges the answers. Same shape as `install.js`.
 *
 *   node check.js plan                        what to fetch and query, in order
 *   node check.js judge <readback.json>       the findings
 *   node check.js repairs <readback.json>     what a yes would do, each with an id
 *   node check.js send <readback.json> <id>…  workspace statements, proof cleared
 *   node check.js adopt <readback.json> <id>… config repairs, on an explicit yes
 *   node check.js prove-sent <before.json> <after.json> <id>…
 *
 * WHAT IT DOES NOT LOOK AT. Views. The nine checks in the specification do not
 * include one, and closing that gap means carrying the name map into the view
 * compiler, which changes what gets SENT to Notion rather than what gets read
 * back. So somebody can break a saved view and this will still pass, and it
 * says so in its own output every time rather than leaving it to be found out.
 *
 * IT NEVER REFUSES TO RUN. A half-finished install, a demoted one and a healthy
 * one all get looked at and reported. Telling the first two apart would need
 * this to record why a proof was cleared, and it does not need to: the way back
 * is the same either way, `install.js verify` then `install.js complete`, and
 * `verify` is what says which situation it is by naming what is missing.
 */

const fs = require('fs')

const config = require('./config')
const manifest = require('./manifest')
const { DATABASES, byKey } = manifest
const schema = require('./schema')
const relations = require('./relations')
const rules = require('./rules')
const { fingerprint } = require('./fingerprint')
const views = require('./views')

/**
 * What to fetch, and what to run, before anything can be judged.
 *
 * Every id here comes from config. Nothing is discovered by searching, because
 * a search finds a database with the right name rather than the database this
 * plugin created, and those are different things the moment somebody makes a
 * second one.
 */
function plan () {
  const current = config.read()
  if (!current) return { problem: `There is no config at ${config.CONFIG_PATH}, so there is nothing to check. Run install.` }

  const steps = []
  for (const d of DATABASES) {
    const entry = current.databases[d.key]
    if (!entry) {
      steps.push({ kind: 'skip', database: d.key, why: `${d.title} is not in config. There is nothing recorded to look for.` })
      continue
    }
    steps.push({
      kind: 'fetch-database',
      database: d.key,
      call: 'notion-fetch',
      arguments: { id: entry.databaseId },
      record: `databases.${d.key}: found, title, dataSources (every data source id on it), schema (the properties of data source ${entry.dataSourceId})`
    })
  }

  if (current.notion.personId) {
    steps.push({
      kind: 'fetch-person',
      call: 'notion-get-users',
      arguments: {},
      record: `person.found: whether ${current.notion.personId} is in the list`
    })
  }

  // Per database, catching the map error for each. `config.allNames` asks
  // `namesFor` for every database and lets it throw, so one hand-edited map
  // made this whole command die before it emitted a single step, which
  // contradicts the promise at the top of this file that it never refuses to
  // run. A database whose map cannot be read gets no rule query rather than a
  // query built from the shipped names, because the shipped names are exactly
  // what a recorded map means it does not use, and `judge` reports both the
  // broken map and the query nobody ran.
  const namesByKey = {}
  const unreadable = []
  for (const d of DATABASES) {
    if (!current.databases[d.key]) continue
    const { names, problem } = namesFor(d.key)
    if (problem) unreadable.push(d.key)
    else if (names) namesByKey[d.key] = names
  }
  for (const key of unreadable) {
    steps.push({ kind: 'skip', database: key, why: `${byKey(key).title}: the name map recorded for it cannot be read, so its rule query is not being built. Judging will say what is wrong with the map.` })
  }

  for (const q of rules.queries(namesByKey)) {
    const entry = current.databases[q.database]
    if (!entry || unreadable.includes(q.database)) continue
    steps.push({
      kind: 'rule',
      rule: q.rule,
      database: q.database,
      call: 'notion-query-data-sources',
      // `<ds>` is replaced with the quoted data source url by the caller, the
      // same convention the view proofs use. It is left here rather than
      // substituted because nothing in this repository has measured what that
      // substitution looks like.
      // The id, not a url. `<ds>` in the query is replaced with the quoted
      // data source url by whoever sends it, which is the convention the view
      // proofs use, and nothing here has measured what that url looks like.
      arguments: { dataSourceId: entry.dataSourceId, query: q.query },
      record: `rules["${q.rule}::${q.database}"]: the rows, as page urls`
    })
  }

  return { steps }
}

/** Every logical database name this workspace uses, or the reason it cannot say. */
function namesFor (key) {
  try {
    return { names: config.namesFor(key), problem: null }
  } catch (error) {
    // A map that is present and wrong. Three answers, not two: a map, no map,
    // and a map that cannot be read. `config.allNames` collapses the third into
    // the second by throwing on the way past, and the first into the second by
    // omitting the entry, which is right for `install.verify` and wrong here.
    return { names: null, problem: error.message }
  }
}

/**
 * The whole judgment.
 *
 * Three lists, not two. `broken` is what is wrong, `warnings` are things worth
 * knowing that are not failures, and `unchecked` is what could not be judged
 * from what came back. An unchecked thing reported as a pass is the failure
 * `install.verify` already exists to prevent, and it is the same here.
 */
function judge (readback) {
  const broken = []
  const warnings = []
  const unchecked = []

  const add = (list, id, sentence, extra = {}) => list.push({ id, say: sentence, ...extra })

  let current
  try {
    current = config.read()
  } catch (error) {
    add(broken, 'config', error.message)
    return done(broken, warnings, unchecked)
  }
  if (!current) {
    add(broken, 'config', `There is no config at ${config.CONFIG_PATH}. Nothing has been installed, or the file has been moved.`)
    return done(broken, warnings, unchecked)
  }

  const given = (readback && readback.databases) || {}
  const schemas = {}
  const namesByKey = {}

  for (const d of DATABASES) {
    const entry = current.databases[d.key]
    if (!entry) {
      add(broken, `database:${d.key}`, `${d.title} is not recorded in config, so this install never finished or it was edited. Nothing was checked for it.`, { repairable: false })
      continue
    }

    const back = given[d.key]
    if (!back) {
      add(unchecked, `database:${d.key}`, `${d.title}: nothing came back for it, so nothing about it was checked.`)
      continue
    }

    if (typeof back.found !== 'boolean') {
      add(unchecked, `database:${d.key}`, `${d.title}: nothing recorded whether ${entry.databaseId} resolved, so everything below about it rests on a fetch that may not have happened.`)
    }

    if (!back.title) {
      add(unchecked, `title:${d.key}`, `${d.title}: its title in Notion was not recorded, so whether it has been renamed is unknown.`)
    }

    if (back.found === false) {
      // The judgment this whole command carries. Deleted and renamed-and-
      // unshared look identical from outside and the remedies are opposite, so
      // it stops here rather than choosing.
      add(broken, `database:${d.key}`, `${d.title} (${entry.databaseId}) did not resolve. It was deleted, or it was moved somewhere this integration cannot see. Those need opposite fixes and this cannot tell them apart, so it is not offering to repair either.`, { repairable: false })
      continue
    }

    const sources = Array.isArray(back.dataSources) ? back.dataSources : null
    if (!sources) {
      add(unchecked, `datasource:${d.key}`, `${d.title}: the data sources on it were not recorded, so whether ${entry.dataSourceId} is still one of them was not checked.`)
    } else if (!sources.includes(entry.dataSourceId)) {
      add(broken, `datasource:${d.key}`, `${d.title}: the recorded data source ${entry.dataSourceId} is not on it any more. It has ${sources.join(', ') || 'none'}.`, { database: d.key, candidates: sources })
    } else if (sources.length > 1) {
      // A warning and never a failure. Queries keep using the recorded one,
      // correctly, and the user is told so they know why the new one is not
      // being read.
      add(warnings, `datasource-extra:${d.key}`, `${d.title} now has more than one data source: ${sources.join(', ')}. This keeps reading ${entry.dataSourceId}, which is the right answer and is why the new one is invisible to every skill here.`)
    }

    if (back.title && back.title !== entry.displayName) {
      add(warnings, `title:${d.key}`, `${d.title} is called "${back.title}" in Notion and "${entry.displayName}" in config. A title is a label, so nothing is broken, and adopting it keeps the two agreeing.`, { database: d.key, to: back.title })
    }

    const { names, problem } = namesFor(d.key)
    if (problem) {
      add(broken, `names:${d.key}`, problem, { repairable: false })
      add(unchecked, `schema:${d.key}`, `${d.title}: its properties were not checked, because the name map recorded for it cannot be read and every lookup would have gone through it.`)
      continue
    }
    namesByKey[d.key] = names

    if (!back.schema || typeof back.schema !== 'object') {
      add(unchecked, `schema:${d.key}`, `${d.title}: no properties came back, so nothing about them was checked.`)
      continue
    }
    schemas[d.key] = back.schema
  }

  // Properties, types, options. The relation properties are passed in so they
  // are not reported as somebody else's additions.
  const findings = []
  for (const d of DATABASES) {
    if (!schemas[d.key]) continue
    const result = schema.inspect(d.key, schemas[d.key], relations.observedPropertyNamesFor(d.key, namesByKey[d.key]), namesByKey[d.key])
    findings.push(...result.findings)
    for (const f of result.findings) {
      // The sentence is the one `schema.js` wrote. Rewording it here would be a
      // second wording of the same finding, and two wordings drift.
      if (!f.say) continue
      add(broken, idFor(f), f.say, { finding: f, database: d.key })
    }
  }

  // Relations, both ends, and one at a time.
  //
  // NOT `verifyAll`, which reports a database nobody read back as a problem
  // with the relation. That is right for `install.verify`, where every database
  // was just created and a gap is a real failure, and wrong here: a database
  // that was not fetched is a thing this command does not know about, and
  // calling it broken would report a healthy workspace as broken whenever a
  // fetch was skipped.
  for (const relation of manifest.RELATIONS) {
    const ends = relation.kind === 'two-way' ? [relation.from, relation.to] : [relation.from]
    const unseen = ends.filter(key => !schemas[key])
    if (unseen.length) {
      add(unchecked, `relation:${relation.n}`, `${byKey(relation.from).title}."${relation.property}" was not checked, because ${unseen.map(k => byKey(k).title).join(' and ')} ${unseen.length === 1 ? 'was' : 'were'} not read back.`)
      continue
    }
    for (const problem of relations.verifyRelation(relation, schemas, config.ids(), namesByKey)) {
      add(broken, `relation:${relation.n}`, problem)
    }
  }
  for (const withheld of relations.unrepairable(schemas, config.ids(), namesByKey)) {
    add(warnings, `relation-unrepairable:${withheld.n}`, `${byKey(withheld.from).title}."${withheld.property}" cannot be rebuilt automatically: ${withheld.reason}`)
  }

  // The person id. Absent is healthy and is tier 3 of the identity choice.
  if (current.notion.personId) {
    const person = readback && readback.person
    if (!person || typeof person.found !== 'boolean') {
      add(unchecked, 'person', `The recorded person id ${current.notion.personId} was not looked up, so whether it still resolves is unknown.`)
    } else if (!person.found) {
      add(broken, 'person', `The recorded person id ${current.notion.personId} does not resolve any more. Every Owner, Author and Verified by write names it.`, { repairable: false })
    }
  }

  // The two rules no view can watch. Two rules, three queries.
  for (const q of rules.queries(namesByKey)) {
    if (!current.databases[q.database]) continue
    const rows = readback && readback.rules && readback.rules[`${q.rule}::${q.database}`]
    if (!Array.isArray(rows)) {
      add(unchecked, `rule:${q.rule}:${q.database}`, `${q.title}: the query for "${q.what}" was not run, so nothing is known about it. This is not the same as it finding nothing.`)
      continue
    }
    if (rows.length) {
      add(broken, `rule:${q.rule}:${q.database}`, `${q.title}: ${rows.length} ${rows.length === 1 ? 'row breaks' : 'rows break'} the rule "${q.what}". Reported and never fixed: which of them to change is a judgment about content somebody wrote.`, { repairable: false, rows })
    }
  }

  // Said every time, not only when something is wrong.
  unchecked.push({
    id: 'views',
    say: `The saved views were not looked at. This command checks databases, properties, option values, relations, the person id and the two rules, and nothing else. A broken view looks exactly like a healthy one from here.`
  })

  // The proof, and WHICH definitions it was taken against. `config.complete`
  // already refuses a proof whose fingerprint has moved, and this asked only
  // whether a proof existed, so a workspace could pass here on a proof taken
  // against an earlier manifest. What was checked is not what would be built
  // now, and that is the same claim `complete` refuses to rest on.
  if (!current.verified || !current.verified.at) {
    unchecked.push({
      id: 'proof',
      say: `No verify is standing against this config, so this workspace has never been proved to match the manifest, or something changed since it was. Run \`install.js verify <readback.json>\` and then \`install.js complete\`.`
    })
  } else if (current.verified.definitions !== fingerprint()) {
    unchecked.push({
      id: 'proof',
      say: `The verify standing against this config was taken against a different set of definitions (${current.verified.definitions || 'none recorded'}, and this is ${fingerprint()}). What was checked is not what would be built now. Run \`install.js verify <readback.json>\` again.`
    })
  }

  return done(broken, warnings, unchecked, findings)
}

function done (broken, warnings, unchecked, findings = []) {
  return { broken, warnings, unchecked, findings, passed: broken.length === 0 }
}

/** A stable name for a finding, so a repair can be approved by naming it. */
function idFor (f) {
  switch (f.kind) {
    case 'property-missing': return `property:${f.database}:${f.logical}`
    case 'property-type': return `type:${f.database}:${f.logical}`
    case 'description': return `description:${f.database}:${f.logical}`
    case 'option-missing': return `option:${f.database}:${f.logical}:${f.value}`
    case 'option-colour': return `colour:${f.database}:${f.logical}:${f.value}`
    case 'option-order': return `order:${f.database}:${f.logical}`
    case 'option-extra': return `option-extra:${f.database}:${f.logical}:${f.observedValue}`
    case 'property-extra': return `extra:${f.database}:${f.observed}`
    case 'schema-absent': return `schema:${f.database}`
    default: return `${f.kind}:${f.database}`
  }
}

/**
 * What a yes would do, each with an id, split by whether anything is sent.
 *
 * TWO KINDS, AND THEY ARE PROVED DIFFERENTLY.
 *
 * `config` repairs send nothing. The workspace is right and this plugin's
 * record of it is wrong, so the fix is a write to the config file and the proof
 * is the same read-back judged again through the new config.
 *
 * `workspace` repairs send a statement, and the proof needs a fresh fetch,
 * because a statement returning without an error proves nothing here.
 *
 * BOTH DEMOTE THE INSTALL. Everything that changes what the verify was run
 * against clears the proof, and adding an option or a relation changes the
 * workspace as surely as adopting a rename changes the record.
 */
function repairs (readback) {
  const result = judge(readback)
  const config_ = []
  const workspace = []
  const withheld = []

  const findings = result.findings
  const current = config.read() || { databases: {} }

  // A property the schema cannot find, beside a property the schema does not
  // know, of the type the missing one should be. That pairing is a rename. One
  // candidate is a proposal; more than one is a question for a person.
  for (const missing of findings.filter(f => f.kind === 'property-missing')) {
    const strangers = findings.filter(f => f.kind === 'property-extra' && f.database === missing.database)
    const fits = strangers.filter(f => typeOf(readback, f.database, f.observed) === missing.type)
    const id = `property:${missing.database}:${missing.logical}`
    if (fits.length === 1) {
      config_.push({
        id, clears: id, kind: 'names', database: missing.database,
        say: `Record that ${byKey(missing.database).title}."${missing.logical}" is called "${fits[0].observed}" in this workspace. Nothing in Notion is renamed.`,
        change: { property: missing.logical, to: fits[0].observed }
      })
    } else if (fits.length > 1) {
      withheld.push({ id, say: `${byKey(missing.database).title}."${missing.observed}" is missing and ${fits.length} properties could be it: ${fits.map(f => `"${f.observed}"`).join(', ')}. Say which one and it will be recorded.` })
    } else {
      withheld.push({ id, say: `${byKey(missing.database).title}."${missing.observed}" is missing and nothing on that database looks like it renamed. This plugin does not create a property outside install, so a person has to decide.` })
    }
  }

  // The same pairing one level down, for a renamed option value.
  for (const missing of findings.filter(f => f.kind === 'option-missing')) {
    const strangers = findings.filter(f => f.kind === 'option-extra' && f.database === missing.database && f.logical === missing.logical)
    const clears = `option:${missing.database}:${missing.logical}:${missing.value}`
    const where = `${byKey(missing.database).title}."${missing.observed}"`

    // A missing value has TWO possible repairs and they are opposite: it was
    // renamed, which is a write to config, or it was lost, which is a write to
    // Notion. Both are offered with different ids, and a person picks. Offering
    // one and calling it the answer is the guess this plugin does not make.
    if (strangers.length === 1) {
      config_.push({
        id: `${clears}:renamed`, clears, kind: 'names', database: missing.database,
        say: `Record that ${where} calls "${missing.value}" by the name "${strangers[0].observedValue}" here, because that value is on the property and the manifest does not know it. Nothing in Notion is renamed.`,
        change: { value: { property: missing.logical, from: missing.value, to: strangers[0].observedValue } }
      })
    } else if (strangers.length > 1) {
      withheld.push({ id: `${clears}:renamed`, say: `${where} is missing "${missing.observedValue}" and carries ${strangers.length} values the manifest does not know: ${strangers.map(f => `"${f.observedValue}"`).join(', ')}. Say which one it became.` })
    }

    workspace.push({
      id: `${clears}:lost`, clears, kind: 'option', database: missing.database,
      say: `Add "${missing.observedValue}" back to ${where}, on the reading that it was deleted rather than renamed.`
    })
  }

  // A data source that was replaced. Adopted only when the recorded one is
  // gone, which is what puts the finding in the broken list at all, and only
  // when exactly one candidate is on the database.
  for (const gone of result.broken.filter(b => b.id.startsWith('datasource:'))) {
    const key = gone.id.slice('datasource:'.length)
    const candidates = gone.candidates || []
    if (candidates.length === 1) {
      config_.push({
        id: gone.id, clears: gone.id, kind: 'datasource', database: key,
        say: `Point ${byKey(key).title} at data source ${candidates[0]}, which is the only one on it now.`,
        change: { from: current.databases[key].dataSourceId, to: candidates[0], databaseId: current.databases[key].databaseId }
      })
    } else {
      withheld.push({ id: gone.id, say: `${byKey(key).title} has ${candidates.length} data sources and the recorded one is not among them. Say which to use.` })
    }
  }

  // A title somebody changed. A label, so it is a warning rather than a break,
  // and adopting it keeps config readable.
  for (const w of result.warnings.filter(w => w.id.startsWith('title:'))) {
    const key = w.id.slice('title:'.length)
    config_.push({
      id: w.id, clears: w.id, kind: 'title', database: key,
      say: `Record that ${byKey(key).title} is called "${w.to}" in this workspace.`,
      change: { displayName: w.to }
    })
  }

  // Relations, from the generator, and only the ones it will rebuild.
  const schemas = schemasFrom(readback)
  const namesByKey = namesByKeyFrom()
  const statements = relations.repairStatements(schemas, config.ids(), namesByKey)
  for (const key of Object.keys(statements)) {
    workspace.push({
      id: `relation:${key}`, clears: null, kind: 'relation', database: key,
      say: `Rebuild the relations missing from ${byKey(key).title}. Each of these is one this plugin will rebuild: the property on ${byKey(key).title} is gone, and where the relation is two-way the synced half is gone too, which is the only state a two-way one can be rebuilt from.`
    })
  }
  for (const u of relations.unrepairable(schemas, config.ids(), namesByKey)) {
    withheld.push({ id: `relation:${u.n}`, say: `${byKey(u.from).title}."${u.property}" is not rebuilt: ${u.reason}` })
  }

  return { config: config_, workspace, withheld, broken: result.broken, warnings: result.warnings, unchecked: result.unchecked }
}

/** The type Notion reports for a property, out of the read-back. */
function typeOf (readback, key, name) {
  const back = readback && readback.databases && readback.databases[key]
  const property = back && back.schema && back.schema[name]
  return property && property.type
}

function schemasFrom (readback) {
  const out = {}
  for (const d of DATABASES) {
    const back = readback && readback.databases && readback.databases[d.key]
    if (back && back.schema && typeof back.schema === 'object') out[d.key] = back.schema
  }
  return out
}

/** The names per database, skipping any this cannot read rather than guessing. */
function namesByKeyFrom () {
  const out = {}
  for (const d of DATABASES) {
    const { names } = namesFor(d.key)
    if (names) out[d.key] = names
  }
  return out
}

/**
 * The statement that puts a lost option value back.
 *
 * NOT MEASURED against a live workspace, unlike everything else this plugin
 * sends. It is the one statement here with no dated proof behind it, and that
 * is said out loud rather than left for somebody to assume. The form follows
 * the `ALTER` shape the DDL generator uses for a select, and the first person to
 * run it should record what came back in DECISIONS.md.
 */
function optionStatement (finding) {
  const db = byKey(finding.database)
  return {
    unproved: true,
    id: `option:${finding.database}:${finding.logical}:${finding.value}:lost`,
    database: finding.database,
    statement: `ALTER TABLE ${JSON.stringify(db.title)} ALTER COLUMN ${rules.identifier(finding.observed)} ADD OPTION ${rules.literal(finding.observedValue)}`
  }
}

/**
 * Apply the config repairs a person named, and nothing else.
 *
 * Every id has to be one this run produced. An id that is not in the list is
 * refused rather than skipped, because a typo silently doing nothing looks
 * exactly like a repair that worked.
 */
function adopt (readback, ids) {
  const offered = repairs(readback)
  const chosen = []
  for (const id of ids) {
    const found = offered.config.find(r => r.id === id)
    if (!found) {
      const workspace = offered.workspace.find(r => r.id === id)
      if (workspace) throw new Error(`${id} is a workspace repair. Send its statement and then prove it with prove-sent. Nothing has been written.`)
      throw new Error(`${id} is not one of the config repairs this read-back offers. Run \`repairs\` again. Nothing has been written.`)
    }
    chosen.push(found)
  }
  if (!chosen.length) throw new Error('No repair was named, so nothing was adopted. Pass the ids from `repairs`.')

  const applied = []
  for (const repair of chosen) {
    if (repair.kind === 'names') applied.push(applyNames(repair))
    else if (repair.kind === 'datasource') {
      config.reresolveDataSource(repair.database, repair.change)
      applied.push(repair.say)
    } else if (repair.kind === 'title') {
      const entry = config.read().databases[repair.database]
      config.recordDatabase(repair.database, { databaseId: entry.databaseId, dataSourceId: entry.dataSourceId, displayName: repair.change.displayName })
      applied.push(repair.say)
    }
  }

  // Proved here, in the same call, and not by a command somebody runs after.
  //
  // The proof for a config repair is the same read-back judged again through
  // the new record, and only half of it can be asked afterwards: whether the
  // finding is gone. Whether it was ever there needs the config as it was, and
  // the config as it was is what this function just changed. A separate
  // `prove-adopted` command therefore could not tell a real repair from an id
  // somebody invented, and it answered `proved` to both.
  //
  // Here both halves are in hand. `chosen` came from the offered repairs, which
  // were derived before anything was written, so the finding was there; judging
  // now says whether it still is.
  const after = judge(readback)
  const results = chosen.map(repair => {
    const clears = repair.clears
    const still = clears && reported(after, clears)
    return {
      id: repair.id,
      proved: !still,
      say: still
        ? `${clears} is still reported after the change was recorded, so the record does not describe this workspace yet.`
        : `${clears || repair.id} is gone, judged against the same read-back through the new record.`
    }
  })

  return { applied, results, proved: results.every(r => r.proved), next: recoveryLines() }
}

/**
 * Adopt one rename into the map.
 *
 * The whole map goes back, not the one entry. `config.recordNames` refuses a
 * map that is not complete in either half, because a partial map answers about
 * the wrong thing while looking healthy.
 */
function applyNames (repair) {
  const names = config.namesFor(repair.database) || schema.identityNames(repair.database)
  const properties = { ...names.properties }
  const values = {}
  for (const [property, map] of Object.entries(names.values || {})) values[property] = { ...map }

  if (repair.change.property) properties[repair.change.property] = repair.change.to
  if (repair.change.value) {
    const { property, from, to } = repair.change.value
    values[property] = { ...(values[property] || {}) }
    values[property][from] = to
  }
  config.recordNames(repair.database, { properties, values })
  return repair.say
}

/** The two commands that put a proof back, printed after anything is repaired. */
const recoveryLines = () => ([
  'This install is no longer proved against the manifest, because what the proof was taken against has changed. Two commands put it back:',
  '  node scripts/install.js verify <readback.json>',
  '  node scripts/install.js complete',
  'Both are needed. `verify` restores completion by itself only when the install was still complete when it started, and it is not now.'
])

/**
 * Hand over the statements for a workspace repair, and clear the proof first.
 *
 * WHY THE STATEMENT IS NOT IN `repairs`. Adding an option or rebuilding a
 * relation changes the workspace, so it changes what the verify was taken
 * against, so the proof has to go. A config repair does that by itself, because
 * every config write invalidates the verification on the way past. A statement
 * sent by hand touches no config at all, so nothing would have cleared it and
 * an install would keep claiming it matches the manifest while its workspace
 * moved underneath.
 *
 * The proof is therefore cleared HERE, before the statement is handed over, and
 * the statement is not available any other way. A step that can be skipped is a
 * step that gets skipped.
 */
function send (readback, ids) {
  const offered = repairs(readback)
  const chosen = []
  for (const id of ids) {
    const found = offered.workspace.find(r => r.id === id)
    if (!found) {
      if (offered.config.find(r => r.id === id)) throw new Error(`${id} is a config repair. Use adopt. Nothing has been cleared.`)
      throw new Error(`${id} is not one of the workspace repairs this read-back offers. Run \`repairs\` again. Nothing has been cleared.`)
    }
    chosen.push(found)
  }
  if (!chosen.length) throw new Error('No repair was named, so no statement was produced. Pass the ids from `repairs`.')

  const schemas = schemasFrom(readback)
  const namesByKey = namesByKeyFrom()
  const relationStatements = relations.repairStatements(schemas, config.ids(), namesByKey)
  const findings = judge(readback).findings

  const statements = []
  for (const repair of chosen) {
    if (repair.kind === 'relation') {
      statements.push({ id: repair.id, database: repair.database, statement: relationStatements[repair.database], unproved: false })
      continue
    }
    const finding = findings.find(f => f.kind === 'option-missing' && `option:${f.database}:${f.logical}:${f.value}:lost` === repair.id)
    statements.push(optionStatement(finding))
  }

  // Before the statements are returned, not after. A caller that reads the
  // statements and never gets to the end of this function must still have lost
  // the proof.
  config.clearVerified()
  return { statements, next: recoveryLines() }
}

/**
 * The finding a repair id clears.
 *
 * Worked out from the id rather than by asking `repairs` again, because a
 * config repair changes the config, and asking again would ask a workspace that
 * has already moved. That is not a shortcut: it is the only way the question
 * can be answered after the thing being proved has happened.
 */
function clearsOf (id, judged) {
  for (const suffix of [':renamed', ':lost']) {
    if (id.endsWith(suffix)) return [id.slice(0, -suffix.length)]
  }

  // One relation repair is one statement covering every relation missing from a
  // database, so its id names the database and the findings it clears name the
  // relations. Asking for `relation:process` among the findings answers no
  // every time, and a repair that worked would have been reported as one that
  // never had anything to fix.
  if (id.startsWith('relation:')) {
    const key = id.slice('relation:'.length)
    const numbers = manifest.RELATIONS.filter(r => r.from === key).map(r => `relation:${r.n}`)
    if (numbers.length) {
      const wanted = numbers.filter(n => reported(judged, n))
      return wanted.length ? wanted : numbers
    }
  }

  return [id]
}

const reported = (judged, id) => judged.broken.some(b => b.id === id) || judged.warnings.some(w => w.id === id)

/**
 * Whether a repair that was SENT actually worked.
 *
 * THE EVIDENCE IS THE FINDING BEING GONE, and nothing weaker. Not a statement
 * that returned, not a file that differs: reordered JSON differs without the
 * workspace having changed, and Notion accepts some things it cannot do and
 * discards them silently.
 *
 * Both halves are asked, because config did not change here and both read-backs
 * can be judged against the same record. Handing the same file twice therefore
 * fails, since the finding was derived from that file and is still in it.
 */
function proved (before, after, ids) {
  const was = judge(before)
  const now = judge(after)

  const results = []
  for (const id of ids) {
    const clears = clearsOf(id, was)
    const absentBefore = clears.filter(c => !reported(was, c))
    if (absentBefore.length === clears.length) {
      results.push({ id, proved: false, say: `${clears.join(', ')} was not reported before this, so there was nothing for ${id} to fix. Check the id against \`repairs\`.` })
      continue
    }
    const stillThere = clears.filter(c => reported(now, c))
    if (stillThere.length) {
      results.push({ id, proved: false, say: `${stillThere.join(', ')} is still reported. The repair did not take, and a call that returned without an error is exactly what that looks like from here.` })
      continue
    }
    results.push({ id, proved: true, say: `${clears.join(', ')} is gone.` })
  }
  return { results, proved: results.length > 0 && results.every(r => r.proved), remaining: now.broken.length }
}

module.exports = { plan, judge, repairs, adopt, send, proved, idFor, clearsOf }

if (require.main === module) {
  const [command, ...rest] = process.argv.slice(2)
  const read = file => JSON.parse(fs.readFileSync(file, 'utf8'))
  const show = value => console.log(JSON.stringify(value, null, 2))
  const lines = (heading, list) => {
    if (!list.length) return
    console.log(`\n${heading}\n`)
    for (const item of list) console.log(`  ${item.say.split('\n').join('\n  ')}\n      ${item.id ? `id: ${item.id}` : ''}`)
  }

  try {
    // The definitions are checked before anything reads a workspace against
    // them. A manifest that contradicts itself makes every answer below
    // meaningless, and `install.js` refuses on the same three validators.
    const contradictions = [...manifest.validate(), ...views.validate(), ...rules.validate()]
    if (contradictions.length) {
      console.error('The definitions contradict themselves, and nothing below can be trusted:')
      for (const p of contradictions) console.error(`  ${p}`)
      process.exit(1)
    }

    switch (command) {
      case 'plan': show(plan()); break

      case 'judge': {
        if (!rest[0]) throw new Error('Usage: check.js judge <readback.json>')
        const result = judge(read(rest[0]))
        lines('Broken', result.broken)
        lines('Worth knowing, not broken', result.warnings)
        lines('Not checked', result.unchecked)
        console.log(
          `\n${result.broken.length} broken, ${result.warnings.length} worth knowing, ${result.unchecked.length} not checked.\n` +
          (result.passed
            ? 'Nothing is broken among the things this looks at. Read the not-checked list before calling it healthy.\n'
            : 'Run `repairs` on the same file to see what a yes would do.\n')
        )
        process.exit(result.passed ? 0 : 1)
      }

      case 'repairs': {
        if (!rest[0]) throw new Error('Usage: check.js repairs <readback.json>')
        const offered = repairs(read(rest[0]))
        lines('Config repairs. Nothing is sent to Notion', offered.config)
        lines('Workspace repairs. These send a statement', offered.workspace)
        lines('Not repaired, and why', offered.withheld)
        console.log(
          `\nAdopt config repairs with:  check.js adopt <readback.json> <id>...\n` +
          `Get a workspace statement with: check.js send <readback.json> <id>...\n` +
          `That clears the proof before it hands the statement over, then:\n` +
          `  check.js prove-sent <before.json> <after.json> <id>...\n` +
          `Either kind clears the proof this install was verified against.\n`
        )
        break
      }

      case 'send': {
        if (!rest[1]) throw new Error('Usage: check.js send <readback.json> <id>...')
        const { statements, next } = send(read(rest[0]), rest.slice(1))
        for (const s of statements) {
          console.log(`  ${s.database}\n      ${s.statement}`)
          if (s.unproved) console.log('      NOT MEASURED. No statement of this shape has been run against a live workspace here. Record what comes back in DECISIONS.md.')
        }
        console.log(`\n${next.join('\n')}\n`)
        console.log('Send these, fetch again, then: check.js prove-sent <before.json> <after.json> <id>...\n')
        break
      }

      case 'adopt': {
        if (!rest[1]) throw new Error('Usage: check.js adopt <readback.json> <id>...')
        const result = adopt(read(rest[0]), rest.slice(1))
        for (const say of result.applied) console.log(`  done    ${say}`)
        for (const r of result.results) console.log(`  ${r.proved ? 'proved  ' : 'NOT     '}${r.say}`)
        console.log(`\n${result.next.join('\n')}\n`)
        process.exit(result.proved ? 0 : 1)
      }

      case 'prove-sent': {
        if (!rest[2]) throw new Error('Usage: check.js prove-sent <before.json> <after.json> <id>...')
        const result = proved(read(rest[0]), read(rest[1]), rest.slice(2))
        for (const r of result.results) console.log(`  ${r.proved ? 'proved ' : 'NOT    '} ${r.say}`)
        process.exit(result.proved ? 0 : 1)
      }

      default:
        console.error('Usage: check.js plan | judge | repairs | adopt | send | prove-sent')
        process.exit(2)
    }
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}

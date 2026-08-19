'use strict'

/**
 * The two rules no Notion view can watch, compiled into the query that finds
 * each one.
 *
 * Notion cannot filter for either: a multi-select filter tests contains and
 * does not contain and cannot count values, and the Type being tested in the
 * second one lives on the related page, which a filter cannot read across. So
 * they are queried and counted by `check` rather than shown by a view. The
 * reasoning is beside each rule in `manifest.js`.
 *
 * WHY A COMPILER RATHER THAN THE QUERY. A workspace renames properties and
 * option values, and this plugin adapts to their names rather than the other
 * way round. A query carrying the shipped names asks about names nobody uses
 * and comes back with no rows, which is indistinguishable from a workspace with
 * no violations in it. That is the worst answer available here: a silent pass.
 *
 * WHAT IT DOES NOT DO. `<ds>` is left exactly where it is, for the caller to
 * replace with the quoted data source url. That is the convention `views.js`
 * already uses for the queries that prove a view, and following it here means
 * one convention rather than two. Nothing in this repository has measured what
 * that substitution looks like, so nothing here invents it.
 */

const { RULES, byKey, relationsFrom, RELATIONS } = require('./manifest')
const schema = require('./schema')
const mapped = require('./names')

/** `"` inside an identifier is doubled, which is how SQL escapes it. */
const identifier = name => `"${String(name).split('"').join('""')}"`

/** `'` inside a literal is doubled, the same way. */
const literal = value => `'${String(value).split("'").join("''")}'`

/**
 * Every property name a database can legitimately be asked about.
 *
 * Both halves. `schema.js` holds the properties a database is created with, and
 * the relation properties are added by phase B and live in `manifest.js`,
 * because they cannot be created with the database. `Parent` is a relation
 * property and one of the two rule queries is about it, so leaving relations
 * out here would reject a rule that is correct.
 */
function propertyNames (key) {
  const names = new Set(schema.DATABASES[key].properties.map(p => p.name))
  for (const r of relationsFrom(key)) names.add(r.property)
  for (const r of RELATIONS) if (r.to === key && r.reverse) names.add(r.reverse)
  return names
}

/** The option values a property is allowed to be compared against. */
function optionValues (key, property) {
  const want = schema.DATABASES[key].properties.find(p => p.name === property)
  if (!want || !want.options) return null
  return new Set(want.options.map(([name]) => name))
}

const PLACEHOLDER = /\{(prop|value):([^:}]+)(?::([^}]+))?\}/g

/** Every placeholder in a template, in the order it appears. */
function placeholders (query) {
  const found = []
  for (const match of String(query).matchAll(PLACEHOLDER)) {
    const [text, kind, first, second] = match
    if (kind === 'prop') found.push({ text, kind: 'property', property: first })
    else found.push({ text, kind: 'value', property: first, value: second })
  }
  return found
}

/**
 * One rule's query for one database, with every name resolved.
 *
 * `names` is the entry for THIS database out of the config map, or null when
 * none was recorded, in which case every lookup answers with the shipped name,
 * which is what a default install uses.
 */
function compile (rule, key, names = null) {
  if (!rule.checkQuery) {
    throw new Error(`rule ${rule.key} has no query, so there is nothing to compile.`)
  }
  return String(rule.checkQuery).replace(PLACEHOLDER, (text, kind, first, second) => {
    if (kind === 'prop') return identifier(mapped.propertyName(names, first))
    if (second === undefined) {
      throw new Error(`rule ${rule.key}: {value:...} needs a property and a value, and ${text} has one part.`)
    }
    return literal(mapped.valueName(names, first, second))
  })
}

/** Which databases a rule is queried against. One rule covers two. */
const databasesFor = rule => rule.databases || (rule.database ? [rule.database] : [])

/**
 * Every query `check` has to run, one per rule per database.
 *
 * TWO RULES ARE THREE QUERIES. `tags-max-3` covers Process and Memos, and
 * `process-parent-type` covers Process. Counting the rules and expecting the
 * answers to match is how Memos goes unqueried while everything reports fine.
 */
function queries (namesByKey = {}) {
  const out = []
  for (const rule of RULES.filter(r => r.caughtBy === 'check')) {
    for (const key of databasesFor(rule)) {
      out.push({
        rule: rule.key,
        database: key,
        title: byKey(key).title,
        what: rule.rule,
        query: compile(rule, key, namesByKey[key] || null)
      })
    }
  }
  return out
}

/**
 * Fails loudly if a rule cannot be asked.
 *
 * Run beside `manifest.validate` rather than inside it, because that file is
 * the definitions and this one reads three others to check them. `install.js`
 * already composes validators this way.
 */
function validate () {
  const problems = []
  for (const rule of RULES.filter(r => r.caughtBy === 'check')) {
    const keys = databasesFor(rule)
    if (!keys.length) {
      problems.push(`rule ${rule.key}: caught by check and names no database to query`)
      continue
    }
    if (!rule.checkQuery) {
      problems.push(`rule ${rule.key}: caught by check with no query, so nothing would ever look for it`)
      continue
    }
    for (const key of keys) {
      if (!schema.DATABASES[key]) {
        problems.push(`rule ${rule.key}: names database ${key}, which has no schema`)
        continue
      }
      const known = propertyNames(key)
      for (const p of placeholders(rule.checkQuery)) {
        if (!known.has(p.property)) {
          problems.push(`rule ${rule.key}: asks about ${byKey(key).title}."${p.property}", which that database does not have`)
          continue
        }
        if (p.kind !== 'value') continue
        const values = optionValues(key, p.property)
        if (!values) {
          problems.push(`rule ${rule.key}: compares ${byKey(key).title}."${p.property}" against "${p.value}", and that property has no options`)
        } else if (!values.has(p.value)) {
          problems.push(`rule ${rule.key}: compares ${byKey(key).title}."${p.property}" against "${p.value}", which is not one of its values`)
        }
      }
    }
  }
  return problems
}

module.exports = { compile, queries, validate, placeholders, propertyNames, identifier, literal }

if (require.main === module) {
  const problems = validate()
  if (problems.length) {
    for (const p of problems) console.error(`  ${p}`)
    process.exit(1)
  }
  for (const q of queries()) console.log(`${q.title} / ${q.rule}\n  ${q.query}\n`)
}

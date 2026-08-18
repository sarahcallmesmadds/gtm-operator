'use strict'

/**
 * The database-level views, compiled into Notion's view DSL and checked
 * afterwards against what Notion actually did with them.
 *
 * `manifest.js` holds the view definitions in structured form. This turns them
 * into the `configure` string the create-view call takes, and nothing anywhere
 * writes that string by hand. A filter written as text is a filter nothing can
 * check against the schema, and the schema is where the property names and the
 * option values live.
 *
 * WHY THIS FILE IS CAREFUL. Three separate times now, a Notion filter this
 * design needed has been accepted by the API and then not worked, and each time
 * it looked fine from the response:
 *
 *   1. A rollup filter, 2026-08-17. Created, reported as created, and the
 *      filter came back as `filters: []`. Caught by reading the view back.
 *   2. A multi-select count filter, 2026-08-17. Rejected with a 400, which is
 *      the honest failure and the easy case.
 *   3. A relative date, 2026-08-18. `FILTER "Date" > "today"` was accepted,
 *      stored as `date_is_after` with the exact string "today", read back
 *      looking perfectly correct, and matched NOTHING. A row dated four months
 *      in the future did not appear. The identical view with an ISO date
 *      returned it.
 *
 * The third one is why this file has both `verifyView` and `expectedRows`.
 * **Reading a filter back is not enough.** The broken relative-date view and a
 * working one are indistinguishable on read-back: both come back as
 * `date_is_after` with `{type: 'exact'}`. The only thing that told them apart
 * was querying the view and seeing which rows came out.
 *
 * So a view this plugin creates is proved in two steps: the filter reads back
 * as the one that was asked for, AND the rows it returns are the rows the same
 * rule returns in SQL.
 */

const { VIEWS, byKey, relationsFrom, RELATIONS } = require('./manifest')
const { DATABASES: SCHEMAS } = require('./schema')

/**
 * The operators this plugin will emit, and nothing else.
 *
 * Every one of these has been run against a live workspace and proved by the
 * rows it returned, not by the call returning success. The list is short on
 * purpose: an operator that has not been measured is an operator that might be
 * the next `"today"`.
 *
 * `readsBackAs` is what Notion calls the operator in the view it hands back.
 */
const OPS = {
  '=':            { arity: 'one',  readsBackAs: 'enum_is',     measured: '2026-08-18, on select. Returned exactly the matching row' },
  'IN':           { arity: 'many', readsBackAs: 'enum_is',     measured: '2026-08-18, on select. Compiles to an OR group, one enum_is per value' },
  'IS EMPTY':     { arity: 'none', readsBackAs: 'is_empty',    measured: '2026-08-18, on date and on relation. Returned exactly the empty rows' },
  'IS NOT EMPTY': { arity: 'none', readsBackAs: 'is_not_empty', measured: 'not measured. Present because it is the exact inverse of one that was, and it is unused by any view below' }
}

/**
 * A date value that is not an ISO date is refused here rather than sent.
 *
 * This is the guard for finding 3 above. Notion's DSL takes a quoted string,
 * and it takes ANY quoted string: `"today"` parses, stores and matches nothing.
 * There is no relative date in this DSL. If Notion adds one, this guard is
 * where it gets allowed, after it has been measured by the rows it returns.
 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function checkValue (view, condition, value) {
  const where = `${byKey(view.database).title} view "${view.name}", filter on ${condition.property}`
  if (typeof value !== 'string') throw new Error(`${where}: a filter value has to be a string, got ${typeof value}`)
  if (value.includes('"')) throw new Error(`${where}: value ${JSON.stringify(value)} contains a double quote, which the DSL quoting cannot carry`)

  const property = propertyDefinition(view.database, condition.property)
  if (property && property.type === 'date' && !ISO_DATE.test(value)) {
    throw new Error(
      `${where}: ${JSON.stringify(value)} is not an ISO date. Notion's view DSL has no relative date. ` +
      `Measured 2026-08-18: "today" is accepted, stored, reads back looking correct, and matches no row at all.`
    )
  }
  return value
}

/**
 * Every property a database has once both phases have run.
 *
 * Phase A properties come from `schema.js`. The relation properties do not
 * exist there on purpose, because they are added in phase B, so they are taken
 * from the manifest: the ones this database owns, and the reverse ones Notion
 * creates on it when another database points here.
 *
 * This is also the reason views are created last. Two of them filter on a
 * relation property, which does not exist until phase B has run.
 */
function propertiesFor (key) {
  const schema = SCHEMAS[key]
  if (!schema) throw new Error(`No schema defined for "${key}"`)

  const names = new Map()
  for (const p of schema.properties) names.set(p.name, p)
  for (const r of relationsFrom(key)) names.set(r.property, { name: r.property, type: 'relation' })
  for (const r of RELATIONS) {
    if (r.to === key && r.reverse) names.set(r.reverse, { name: r.reverse, type: 'relation' })
  }
  return names
}

function propertyDefinition (key, name) {
  return propertiesFor(key).get(name)
}

/** The `configure` string for one view. */
function configureFor (view) {
  const directives = []
  const known = propertiesFor(view.database)

  const requireProperty = (name, why) => {
    if (!known.has(name)) {
      throw new Error(`${byKey(view.database).title} view "${view.name}": ${why} names "${name}", which that database does not have`)
    }
  }

  if (view.filter && view.filter.length) {
    const clauses = view.filter.map(condition => {
      requireProperty(condition.property, 'a filter')
      const op = OPS[condition.op]
      if (!op) {
        throw new Error(
          `${byKey(view.database).title} view "${view.name}": operator ${JSON.stringify(condition.op)} is not one this plugin emits. ` +
          `Supported: ${Object.keys(OPS).join(', ')}. Anything else has to be measured by the rows it returns before it is added.`
        )
      }
      const property = `"${condition.property}"`

      if (op.arity === 'none') {
        if ('value' in condition || 'values' in condition) throw new Error(`${view.name}: ${condition.op} takes no value`)
        return `${property} ${condition.op}`
      }
      if (op.arity === 'one') {
        if (!('value' in condition)) throw new Error(`${view.name}: ${condition.op} on ${condition.property} needs a value`)
        return `${property} ${condition.op} "${checkValue(view, condition, condition.value)}"`
      }
      if (!Array.isArray(condition.values) || !condition.values.length) {
        throw new Error(`${view.name}: ${condition.op} on ${condition.property} needs a non-empty list of values`)
      }
      const list = condition.values.map(v => `"${checkValue(view, condition, v)}"`).join(', ')
      return `${property} ${condition.op} (${list})`
    })
    directives.push(`FILTER ${clauses.join(' AND ')}`)
  }

  if (view.groupBy) {
    requireProperty(view.groupBy, 'GROUP BY')
    directives.push(`GROUP BY "${view.groupBy}"`)
  }

  if (view.calendarBy) {
    requireProperty(view.calendarBy, 'CALENDAR BY')
    directives.push(`CALENDAR BY "${view.calendarBy}"`)
  }

  if (view.sort && view.sort.length) {
    const parts = view.sort.map(s => {
      requireProperty(s.property, 'a sort')
      if (s.direction !== 'ASC' && s.direction !== 'DESC') throw new Error(`${view.name}: sort direction has to be ASC or DESC, got ${s.direction}`)
      return `"${s.property}" ${s.direction}`
    })
    directives.push(`SORT BY ${parts.join(', ')}`)
  }

  return directives.join('; ')
}

/**
 * What Notion should hand back for this view's filter, flattened.
 *
 * Deliberately not a deep comparison of the nested groups. Notion's grouping
 * varies with the number of clauses: one clause comes back as a property filter
 * sitting directly in the top group, and two come back as one sub-group each.
 * Both were measured on 2026-08-18. A verifier that insisted on the nesting
 * would report a correct view as broken, which is how a verifier gets switched
 * off. What matters is which property, which operator and which value.
 */
function expectedSignature (view) {
  const out = []
  for (const condition of view.filter || []) {
    const op = OPS[condition.op]
    if (op.arity === 'none') out.push(`${condition.property}|${op.readsBackAs}|`)
    else if (op.arity === 'one') out.push(`${condition.property}|${op.readsBackAs}|${condition.value}`)
    else for (const v of condition.values) out.push(`${condition.property}|${op.readsBackAs}|${v}`)
  }
  return out.sort()
}

/** The same signature, read out of what Notion returned. */
function actualSignature (advancedFilter) {
  const out = []
  const walk = node => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'group') { for (const f of node.filters || []) walk(f); return }
    if (node.type === 'property') {
      const value = node.value && 'value' in node.value ? node.value.value : ''
      out.push(`${node.property}|${node.operator}|${value}`)
    }
  }
  walk(advancedFilter)
  return out.sort()
}

/**
 * Compare one view as Notion returned it against the definition.
 *
 * `actual` is the view object out of the `<views>` block of a database fetch.
 *
 * This catches a discarded filter, a filter that came back different from the
 * one asked for, a missing sort and the wrong layout. **It cannot catch a
 * filter that persisted and matches nothing**, which is a real failure mode
 * measured on 2026-08-18, and `expectedRows` is the answer to that one.
 */
function verifyView (view, actual) {
  const title = `${byKey(view.database).title} view "${view.name}"`
  if (!actual) return [`${title}: not found on the database`]

  const problems = []
  if (actual.name !== view.name) problems.push(`${title}: came back named "${actual.name}"`)
  if (actual.type !== view.layout) problems.push(`${title}: expected a ${view.layout} view, got ${actual.type}`)

  if (view.calendarBy && actual.calendarBy !== view.calendarBy) {
    problems.push(`${title}: expected the calendar to run on "${view.calendarBy}", got ${actual.calendarBy || 'nothing'}`)
  }

  const wantFilter = expectedSignature(view)
  const gotFilter = actualSignature(actual.advancedFilter)
  if (wantFilter.join(' ') !== gotFilter.join(' ')) {
    problems.push(
      `${title}: the filter is not the one that was asked for.\n` +
      `    wanted: ${wantFilter.join(', ') || 'no filter'}\n` +
      `    got:    ${gotFilter.join(', ') || 'no filter, which is what a silently discarded one looks like'}`
    )
  }

  const wantSorts = (view.sort || []).map(s => `${s.property} ${s.direction === 'DESC' ? 'descending' : 'ascending'}`)
  const gotSorts = (actual.sorts || []).map(s => `${s.property} ${s.direction}`)
  if (wantSorts.join(', ') !== gotSorts.join(', ')) {
    problems.push(`${title}: sorts differ.\n    wanted: ${wantSorts.join(', ') || 'none'}\n    got:    ${gotSorts.join(', ') || 'none'}`)
  }

  return problems
}

/**
 * The SQL that returns the rows this view should be showing.
 *
 * This is the second half of proving a view, and the half that would have
 * caught the relative-date filter. Run it against the data source, query the
 * view itself, and compare the two sets of rows. A view whose filter reads back
 * correctly and returns a different set of rows is the failure this exists for.
 *
 * `<ds>` is replaced with the quoted data source url by the caller, the same
 * convention the check queries in `manifest.js` use.
 */
function expectedRows (view) {
  if (!view.filter || !view.filter.length) return null

  const where = view.filter.map(condition => {
    const property = propertyDefinition(view.database, condition.property)
    const isDate = property && property.type === 'date'
    // A date property is not queryable under its own name. Notion exposes it as
    // date:<name>:start, which is what the SQLite table definition shows.
    const column = isDate ? `"date:${condition.property}:start"` : `"${condition.property}"`

    switch (condition.op) {
      case 'IS EMPTY':     return `(${column} IS NULL OR ${column} = '' OR ${column} = '[]')`
      case 'IS NOT EMPTY': return `(${column} IS NOT NULL AND ${column} != '' AND ${column} != '[]')`
      case '=':            return `${column} = ${quote(condition.value)}`
      case 'IN':           return `${column} IN (${condition.values.map(quote).join(', ')})`
      default:             throw new Error(`no SQL form for operator ${condition.op}`)
    }
  })

  return `SELECT "${titleProperty(view.database)}" FROM <ds> WHERE ${where.join(' AND ')}`
}

function titleProperty (key) {
  const schema = SCHEMAS[key]
  const title = schema.properties.find(p => p.type === 'title')
  return title.name
}

function quote (value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

/** Every view compiles, and every property it names exists. */
function validate () {
  const problems = []
  for (const view of VIEWS) {
    try {
      configureFor(view)
      expectedRows(view)
    } catch (error) {
      problems.push(error.message)
    }
  }
  return problems
}

module.exports = { OPS, configureFor, propertiesFor, verifyView, expectedSignature, actualSignature, expectedRows, validate }

if (require.main === module) {
  const problems = validate()
  if (problems.length) {
    console.error('The view definitions do not compile:')
    for (const p of problems) console.error(`  ${p}`)
    process.exit(1)
  }

  console.log('\nThe views setup creates, and the configure string each one is sent as\n')
  for (const view of VIEWS) {
    console.log(`  ${byKey(view.database).title} / ${view.name}  (${view.layout})`)
    console.log(`      ${configureFor(view) || 'no configuration, the default view'}`)
    if (view.reduced) console.log(`      reduced: ${view.reduced}`)
    const rows = expectedRows(view)
    if (rows) console.log(`      proved by: ${rows}`)
    console.log('')
  }
}

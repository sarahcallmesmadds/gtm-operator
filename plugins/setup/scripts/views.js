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
  'IS EMPTY':     { arity: 'none', readsBackAs: 'is_empty',    measured: '2026-08-18, on date and on relation. Returned exactly the empty rows' }
}

/**
 * Notion's own name for the type of a property, for the types a filter here can
 * name.
 *
 * Read out of a live install on 2026-08-18, the one recorded in
 * `tests/fixtures/full-install-as-notion-returned-it.json`. A returned filter
 * carries `propertyType` beside the property name, and until 2026-08-18 nothing
 * compared it, so a filter that moved to a different property of the same name
 * and a different type read back as correct.
 *
 * A type that is not on this list has never been seen in a returned filter, so
 * a view that filters on one is refused when it compiles rather than checked
 * against a guess. Same rule as `OPS`, for the same reason.
 */
const NOTION_PROPERTY_TYPE = {
  select:   'select',
  date:     'date',
  relation: 'relation'
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
      notionTypeOf(view.database, condition.property)
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
 * Notion's name for the type of one property, or a refusal.
 *
 * Refusing here rather than returning nothing is deliberate. A type this file
 * has not seen come back from Notion is a type it cannot compare, and comparing
 * it against a guess is how a verifier reports a broken view as fine.
 */
function notionTypeOf (key, name) {
  const property = propertyDefinition(key, name)
  if (!property) throw new Error(`${byKey(key).title}: no property named "${name}"`)
  const type = NOTION_PROPERTY_TYPE[property.type]
  if (!type) {
    throw new Error(
      `${byKey(key).title}: a filter names "${name}", which is a ${property.type}. ` +
      `Notion's own name for that type in a returned filter has never been measured here, so the filter could not be checked after it was sent. ` +
      `Measure it and add it to NOTION_PROPERTY_TYPE. Measured so far: ${Object.keys(NOTION_PROPERTY_TYPE).join(', ')}.`
    )
  }
  return type
}

function leaf (property, propertyType, operator, value) {
  return { kind: 'leaf', property, propertyType: propertyType || null, operator, value: value === undefined ? '' : value }
}

/**
 * A group of one IS its only child.
 *
 * This is the whole of the normalisation, and it is what lets the structure be
 * compared at all. See the note on `expectedFilter`.
 */
function group (operator, children) {
  return children.length === 1 ? children[0] : { kind: 'group', operator, children }
}

/**
 * What Notion should hand back for this view's filter, as a shape.
 *
 * This used to be a flat sorted list of `property|operator|value`, which threw
 * away two things worth keeping. An `or` group sitting where an `and` was asked
 * for read back as correct, so a view showing rows matching ANY clause passed as
 * one showing rows matching ALL of them. And the property type was never looked
 * at, so a filter that moved to a different property of the same name and a
 * different type also passed.
 *
 * The nesting really does vary, which is why it was flattened in the first
 * place, and a verifier that insists on the literal nesting reports correct
 * views as broken. Measured 2026-08-18 across the five filters in
 * `tests/fixtures/full-install-as-notion-returned-it.json`:
 *
 *   one clause      group(and, [property])
 *   one IN clause   group(or,  [property, property])   <- the top group is `or`
 *   two clauses     group(and, [group(or, [..]), group(and, [property])])
 *
 * One rule covers all three: **a group with exactly one child is that child**.
 * Collapse those and the three shapes become a bare leaf, an `or` of two leaves,
 * and an `and` of an `or` and a leaf, which is what the manifest asked for in
 * each case. Nothing else is normalised, so an `or` where an `and` belongs now
 * fails, which is the point.
 *
 * Siblings are sorted rather than compared in order. `and` and `or` commute, so
 * order carries no meaning, and comparing it would fail a view that is right.
 */
function expectedFilter (view) {
  const conditions = view.filter || []
  if (!conditions.length) return null

  const clauses = conditions.map(condition => {
    const op = OPS[condition.op]
    const type = notionTypeOf(view.database, condition.property)
    if (op.arity === 'none') return leaf(condition.property, type, op.readsBackAs, '')
    if (op.arity === 'one') return leaf(condition.property, type, op.readsBackAs, condition.value)
    return group('or', condition.values.map(v => leaf(condition.property, type, op.readsBackAs, v)))
  })

  return group('and', clauses)
}

/** The same shape, read out of what Notion returned. */
function actualFilter (advancedFilter) {
  const walk = node => {
    if (!node || typeof node !== 'object') return null
    if (node.type === 'property') {
      const value = node.value && 'value' in node.value ? node.value.value : ''
      return leaf(node.property, node.propertyType, node.operator, value)
    }
    if (node.type === 'group') {
      const children = (node.filters || []).map(walk).filter(Boolean)
      if (!children.length) return null
      return group(node.operator, children)
    }
    return null
  }
  return walk(advancedFilter)
}

/** One filter shape as a line, used both to compare and to say what differs. */
function renderFilter (node) {
  if (!node) return 'no filter'
  if (node.kind === 'leaf') {
    const type = node.propertyType || 'no type recorded'
    const value = node.value === '' ? '' : ` "${node.value}"`
    return `${node.property} (${type}) ${node.operator}${value}`
  }
  const parts = node.children.map(renderFilter).sort()
  return `(${parts.join(` ${String(node.operator).toUpperCase()} `)})`
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

  const wantFilter = renderFilter(expectedFilter(view))
  const gotFilter = renderFilter(actualFilter(actual.advancedFilter))
  if (wantFilter !== gotFilter) {
    problems.push(
      `${title}: the filter is not the one that was asked for.\n` +
      `    wanted: ${wantFilter}\n` +
      `    got:    ${gotFilter === 'no filter' ? 'no filter, which is what a silently discarded one looks like' : gotFilter}`
    )
  }

  // Grouping was emitted and never read back. A view can lose its GROUP BY
  // silently, the same way a filter can, and until 2026-08-18 nothing here
  // would have said so.
  const gotGroup = actual.groupBy && actual.groupBy.property
  if (view.groupBy && gotGroup !== view.groupBy) {
    problems.push(`${title}: expected it to be grouped by "${view.groupBy}", got ${gotGroup ? `"${gotGroup}"` : 'no grouping'}`)
  }
  if (!view.groupBy && gotGroup) {
    problems.push(`${title}: it is grouped by "${gotGroup}" and no grouping was asked for`)
  }
  if (view.groupBy && gotGroup === view.groupBy) {
    const wantType = notionTypeOf(view.database, view.groupBy)
    const gotType = actual.groupBy.propertyType
    if (gotType !== wantType) {
      problems.push(`${title}: it is grouped by "${view.groupBy}", but on a ${gotType || 'property with no type recorded'} where the schema says ${wantType}`)
    }
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
 *
 * **It selects `url`, not the title.** Titles are not unique, two rows can carry
 * the same one, and a title containing the separator the caller joins on would
 * collide with a pair of other rows. Proving a filter on display text is the
 * same class of mistake as trusting a create call: it usually looks right.
 * `url` is the page identity, and it is already the column the relation check
 * queries in `manifest.js` join on.
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
      case '=':            return `${column} = ${quote(condition.value)}`
      case 'IN':           return `${column} IN (${condition.values.map(quote).join(', ')})`
      default:             throw new Error(`no SQL form for operator ${condition.op}`)
    }
  })

  return `SELECT url FROM <ds> WHERE ${where.join(' AND ')}`
}

/**
 * A page url or id reduced to the bare id, so the two halves of the row proof
 * can be compared.
 *
 * The SQL half returns `url`. The view half is a query through the API, which
 * hands back page ids. They name the same page in two notations: a url ends
 * with the id, dashless, sometimes behind a slug and sometimes with a query
 * string. Anything that is not a 32-character hex id after that is returned
 * unchanged, so a caller that recorded something else fails the comparison
 * rather than passing through a silent no-op.
 */
function pageIdentity (value) {
  const text = String(value == null ? '' : value).trim()
  const withoutQuery = text.split(/[?#]/)[0]
  const last = withoutQuery.split('/').pop() || ''
  const hex = last.replace(/-/g, '')
  const match = hex.match(/([0-9a-fA-F]{32})$/)
  return match ? match[1].toLowerCase() : text
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

module.exports = { OPS, NOTION_PROPERTY_TYPE, configureFor, propertiesFor, verifyView, expectedFilter, actualFilter, renderFilter, expectedRows, pageIdentity, validate }

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

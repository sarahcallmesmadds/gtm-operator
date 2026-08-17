'use strict'

/**
 * The manifest. One machine-readable copy of what setup creates.
 *
 * Every count in this plugin is derived from this file. Nothing counts anything
 * by hand and nothing writes a number in a sentence.
 *
 * That rule is not style. Three independent reviews of the design found six
 * stale counts across two rounds, every one of them a number written in prose
 * next to the thing it counted. [was] A creation plan said nine where the map
 * held thirteen, a file said three Calendar views where its own table listed
 * four, and a closing line said four build risks over a list of five. Each was
 * correct when written. A count written beside the thing it counts is a copy,
 * and copies drift.
 *
 * So: to add a database, a property or a relation, edit this file only. If you
 * find yourself typing a number anywhere else in this plugin, that is the bug.
 *
 * Field names and value lists are defined by the SCHEMA-*.md files at the repo
 * root. This file is the machine-readable form of them and must agree with
 * them. Where it does not, the schema file wins and this file is wrong.
 */

/**
 * Phase A. The six databases, created with non-relation properties only.
 *
 * Order is dependency order for a human reading it. It does not matter to the
 * code: nothing in phase A refers to anything else in phase A, which is the
 * whole reason the phases are split.
 */
const DATABASES = [
  { key: 'process',  title: 'Process Library', plugin: 'process'  },
  { key: 'memos',    title: 'Memos',           plugin: 'memos'    },
  { key: 'projects', title: 'Projects',        plugin: 'projects' },
  { key: 'tasks',    title: 'Tasks',           plugin: 'projects' },
  { key: 'software', title: 'Software',        plugin: 'software' },
  { key: 'calendar', title: 'Calendar',        plugin: 'calendar' }
]

/**
 * Phase B. Every relation, added once all six ids exist.
 *
 * kind is 'two-way' or 'one-way'. A two-way relation is ONE relation with a
 * synced property, not two relations. Building it twice produces duplicates,
 * which is the failure `add` exists to avoid.
 *
 * `self` is true where source and target are the same database. It changes
 * nothing in the call and is recorded because it changed the design: a
 * self-relation cannot be created in the same pass as its database, which is
 * what forced two phases in the first place.
 *
 * reverse is the property name Notion creates on the target. It is null for
 * one-way relations, and that null is load-bearing: a one-way relation cannot
 * be shown as a view on the target page, so a template promising one is a bug.
 */
const RELATIONS = [
  { n: 1,  from: 'process',  to: 'process',  property: 'Parent',           reverse: 'Child Docs',        kind: 'two-way', self: true,
    what: 'A doc to its parent decision' },
  { n: 2,  from: 'process',  to: 'process',  property: 'Supersedes',       reverse: 'Superseded By',     kind: 'two-way', self: true,
    what: 'A decision to the one it replaced' },
  { n: 3,  from: 'memos',    to: 'memos',    property: 'Corrects',         reverse: 'Corrected by',      kind: 'two-way', self: true,
    what: 'A memo to the one it corrects' },
  { n: 4,  from: 'memos',    to: 'process',  property: 'Artifacts',        reverse: 'Memos',             kind: 'two-way', self: false,
    what: 'A memo to what it is about' },
  { n: 5,  from: 'projects', to: 'memos',    property: 'Problem Statement', reverse: 'Resulting Projects', kind: 'two-way', self: false,
    what: 'A project to its problem statement' },
  { n: 6,  from: 'projects', to: 'memos',    property: 'Memos',            reverse: 'Projects',          kind: 'two-way', self: false,
    what: 'A project to its updates' },
  { n: 7,  from: 'projects', to: 'process',  property: 'Artifacts',        reverse: 'Projects',          kind: 'two-way', self: false,
    what: 'A project to what it produced' },
  { n: 8,  from: 'projects', to: 'tasks',    property: 'Tasks',            reverse: 'Project',           kind: 'two-way', self: false,
    what: 'A project to its tasks' },
  { n: 9,  from: 'tasks',    to: 'tasks',    property: 'Parent task',      reverse: 'Sub-tasks',         kind: 'two-way', self: true,
    what: 'A task to its parent task' },
  { n: 10, from: 'software', to: 'process',  property: 'Artifacts',        reverse: 'Software',          kind: 'two-way', self: false,
    what: 'A tool to its documentation' },
  { n: 11, from: 'software', to: 'software', property: 'Integrates with',  reverse: null,                kind: 'one-way', self: true,
    what: 'A tool to a tool it connects to' },
  { n: 12, from: 'calendar', to: 'projects', property: 'Project',          reverse: 'Calendar',          kind: 'two-way', self: false,
    what: 'A calendar row to its project' },
  { n: 13, from: 'calendar', to: 'process',  property: 'Artifacts',        reverse: 'Calendar',          kind: 'two-way', self: false,
    what: 'A calendar row to its playbook' }
]

/**
 * Database-level views setup creates. These reference no page, so unlike the
 * related views inside page bodies they can be built once, at creation.
 *
 * Calendar carries most of them because it is the one database whose default
 * table view is useless. A calendar that opens as a table has failed at the
 * thing it is named after.
 */
const VIEWS = [
  { database: 'calendar', name: 'Calendar',   layout: 'calendar',
    describe: 'Calendar layout on Date, coloured by Type. The default view' },
  { database: 'calendar', name: 'In market',  layout: 'table',
    describe: 'Confirmed and Done in the current month, grouped by Type' },
  { database: 'calendar', name: 'Upcoming',   layout: 'table',
    describe: 'Confirmed with a Date in the future, soonest first' },
  { database: 'calendar', name: 'Undated',    layout: 'table',
    describe: 'Idea and Planned with no date. The pile a calendar view cannot show' },
  { database: 'calendar', name: 'Needs attention', layout: 'table', rule: 'calendar-date',
    describe: 'Confirmed or later with no date' },
  { database: 'projects', name: 'Needs attention', layout: 'table', rule: 'projects-problem-statement',
    describe: 'Projects with no Problem Statement' },
  { database: 'tasks',    name: 'Needs attention', layout: 'table', rule: 'tasks-project',
    describe: 'Tasks with no Project' }
]

/**
 * The rules Notion will not enforce.
 *
 * The skills obey all of them. A person clicking New in Notion obeys none of
 * them, and that is the common case rather than the edge case.
 *
 * `caughtBy` is 'view' or 'check', and which one is not a preference. A view
 * needs a filter Notion can actually express. Two of these have no such filter:
 * a multi-select filter tests whether a value is present, not how many there
 * are, and a filter cannot reach across a relation to read a property on the
 * related page. Those two are reported by `check` instead.
 *
 * MEASURED 2026-08-17 against a live workspace, and both limits are real:
 *
 *   FILTER "Tags" > 3
 *     400 validation_error, `Operator ">" is not supported for multi_select
 *     properties`.
 *   FILTER "Parent.Type" != "Strategy Decision"
 *     400 validation_error, `Could not find property with name or id
 *     "Parent.Type"`. There is no path syntax across a relation.
 *
 * The workarounds were measured too, and neither survives:
 *
 *   A formula counting tags came back typed as text, so `> 3` was rejected with
 *   `Operator ">" is not supported for text properties`. Two attempts.
 *
 *   A rollup of the parent's Type is worse than a failure. The view was created,
 *   the call reported success, and the filter was SILENTLY DISCARDED: the
 *   returned view had `filters: []`. A `Needs attention` view built that way
 *   would exist, look correct, and match every row forever.
 *
 * Formula and rollup columns also come back under `notAvailableInQuerySql`, so
 * `check` could not read them even if they worked.
 *
 * WHAT THIS MEANS FOR ANYONE EDITING THIS FILE: an unsupported filter fails in
 * two different ways depending on the property type, and only one of them is
 * loud. Never conclude a view filter works because the create call returned
 * success. Read the view back and confirm the filter is in it. Both the
 * ordinary select filter and the relation IS EMPTY filter were confirmed this
 * way and both persist correctly, which is why the three view-backed rules
 * below are sound.
 */
const RULES = [
  { key: 'projects-problem-statement', database: 'projects', caughtBy: 'view',
    rule: 'Problem Statement is required',
    filter: 'Problem Statement relation is empty',
    why: 'A project that cannot name its problem statement has not been scoped' },

  { key: 'tasks-project', database: 'tasks', caughtBy: 'view',
    rule: 'Project is required',
    filter: 'Project relation is empty',
    why: 'An orphan task is invisible from every project' },

  { key: 'calendar-date', database: 'calendar', caughtBy: 'view',
    rule: 'Date is required from Confirmed onwards',
    filter: 'Status is Confirmed or later and Date is empty',
    why: 'A confirmed row with no date is invisible on the calendar and absent from Undated' },

  { key: 'tags-max-3', databases: ['process', 'memos'], caughtBy: 'check',
    rule: 'Tags capped at 3',
    noFilter: 'A multi-select filter tests contains and does not contain. It cannot count values',
    why: 'Tags stop being a filter once a row carries six of them',
    // Proved on real rows 2026-08-17: returned exactly the 4-tag and 5-tag rows
    // and correctly excluded the 2-tag one.
    checkQuery: 'SELECT "Name" FROM <ds> WHERE json_array_length("Tags") > 3' },

  { key: 'process-parent-type', database: 'process', caughtBy: 'check',
    rule: 'Only a Strategy Decision may be a parent',
    noFilter: 'The Type being tested is on the related page, and a filter cannot read across a relation',
    why: 'The hierarchy is the whole navigation model, and any row can parent any row',
    // Proved on real rows 2026-08-17: a self-join through the relation returned
    // the child of an SOP and not the child of a Strategy Decision.
    checkQuery: 'SELECT c."Name" FROM <ds> c JOIN <ds> p ON p.url = json_extract(c."Parent", \'$[0]\') WHERE c."Parent" IS NOT NULL AND p."Type" != \'Strategy Decision\'' }
]

/** Derived. Never write these numbers down anywhere else. */
const counts = {
  databases: DATABASES.length,
  relations: RELATIONS.length,
  oneWayRelations: RELATIONS.filter(r => r.kind === 'one-way').length,
  twoWayRelations: RELATIONS.filter(r => r.kind === 'two-way').length,
  selfRelations: RELATIONS.filter(r => r.self).length,
  views: VIEWS.length,
  rules: RULES.length,
  rulesCaughtByView: RULES.filter(r => r.caughtBy === 'view').length,
  rulesCaughtByCheck: RULES.filter(r => r.caughtBy === 'check').length
}

const byKey = key => DATABASES.find(d => d.key === key)
const relationsFrom = key => RELATIONS.filter(r => r.from === key)
const viewsFor = key => VIEWS.filter(v => v.database === key)
const rulesFor = key => RULES.filter(r => r.database === key || (r.databases || []).includes(key))

/**
 * Fails loudly if the manifest contradicts itself. Run by `check` and by the
 * test suite, because a manifest nothing validates is just a longer way of
 * writing the numbers down twice.
 */
function validate () {
  const problems = []
  const keys = new Set(DATABASES.map(d => d.key))

  for (const r of RELATIONS) {
    if (!keys.has(r.from)) problems.push(`relation ${r.n}: unknown source ${r.from}`)
    if (!keys.has(r.to)) problems.push(`relation ${r.n}: unknown target ${r.to}`)
    if (r.self !== (r.from === r.to)) problems.push(`relation ${r.n}: self flag disagrees with from and to`)
    if (r.kind === 'one-way' && r.reverse !== null) problems.push(`relation ${r.n}: one-way relation names a reverse property`)
    if (r.kind === 'two-way' && !r.reverse) problems.push(`relation ${r.n}: two-way relation has no reverse property`)
  }

  RELATIONS.forEach((r, i) => {
    if (r.n !== i + 1) problems.push(`relation at index ${i} is numbered ${r.n}`)
  })

  // Two relations may run between the same pair, and relations 5 and 6 do.
  // What they may not do is share a reverse property name on the target, which
  // is what made a problem statement file as a project update.
  const seen = new Map()
  for (const r of RELATIONS) {
    if (!r.reverse) continue
    const at = `${r.to}.${r.reverse}`
    if (seen.has(at)) problems.push(`${at} is the reverse of relation ${seen.get(at)} and relation ${r.n}`)
    seen.set(at, r.n)
  }

  for (const r of RULES) {
    if (r.caughtBy === 'view' && !r.filter) problems.push(`rule ${r.key}: caught by a view with no filter`)
    if (r.caughtBy === 'check' && !r.noFilter) problems.push(`rule ${r.key}: sent to check without saying why no filter works`)
  }

  // Every rule caught by a view must actually have one, and vice versa.
  const ruleViews = new Set(VIEWS.filter(v => v.rule).map(v => v.rule))
  for (const r of RULES.filter(r => r.caughtBy === 'view')) {
    if (!ruleViews.has(r.key)) problems.push(`rule ${r.key}: caught by a view, and no view names it`)
  }
  for (const key of ruleViews) {
    if (!RULES.some(r => r.key === key)) problems.push(`a view names rule ${key}, which does not exist`)
  }

  for (const v of VIEWS) {
    if (!keys.has(v.database)) problems.push(`view ${v.name}: unknown database ${v.database}`)
  }

  return problems
}

module.exports = { DATABASES, RELATIONS, VIEWS, RULES, counts, byKey, relationsFrom, viewsFor, rulesFor, validate }

/**
 * CLI. `node manifest.js --summary` prints what setup creates, derived.
 *
 * The install skill points at this command, so it has to exist and it has to
 * run. A skill documenting a command form that never runs is a live bug in this
 * setup already, and writing a second one while fixing the first would be the
 * pattern these reviews keep finding.
 */
if (require.main === module) {
  const arg = process.argv[2]

  if (arg === '--validate') {
    const problems = validate()
    if (problems.length) {
      console.error('The manifest contradicts itself:')
      for (const p of problems) console.error(`  ${p}`)
      process.exit(1)
    }
    console.log('The manifest is internally consistent.')
    process.exit(0)
  }

  if (arg === '--json') {
    console.log(JSON.stringify({ DATABASES, RELATIONS, VIEWS, RULES, counts }, null, 2))
    process.exit(0)
  }

  if (arg && arg !== '--summary') {
    console.error(`Unknown argument: ${arg}`)
    console.error('Usage: node manifest.js [--summary | --validate | --json]')
    process.exit(2)
  }

  const problems = validate()
  if (problems.length) {
    console.error('The manifest contradicts itself and nothing below can be trusted:')
    for (const p of problems) console.error(`  ${p}`)
    process.exit(1)
  }

  console.log('\nWhat setup creates\n')

  console.log(`Databases (${counts.databases}), created in phase A with non-relation properties only:`)
  for (const d of DATABASES) console.log(`  ${d.title.padEnd(16)} owned by ${d.plugin}`)

  console.log(`\nRelations (${counts.relations}), added in phase B once every id exists.`)
  console.log(`  ${counts.twoWayRelations} two-way, ${counts.oneWayRelations} one-way, ${counts.selfRelations} pointing at their own database.`)
  for (const r of RELATIONS) {
    const target = r.reverse ? `${byKey(r.to).title}.${r.reverse}` : 'nothing on the target'
    console.log(`  ${String(r.n).padStart(2)}. ${byKey(r.from).title}.${r.property}`.padEnd(42) + `-> ${target}`)
  }

  console.log(`\nDatabase-level views (${counts.views}):`)
  for (const v of VIEWS) console.log(`  ${byKey(v.database).title.padEnd(16)} ${v.name.padEnd(16)} ${v.describe}`)

  console.log(`\nRules Notion will not enforce (${counts.rules}), ${counts.rulesCaughtByView} caught by a view and ${counts.rulesCaughtByCheck} by check:`)
  for (const r of RULES) {
    const where = r.database ? byKey(r.database).title : r.databases.map(k => byKey(k).title).join(' and ')
    console.log(`  ${r.rule}`)
    console.log(`      on ${where}, caught by ${r.caughtBy}`)
    if (r.noFilter) console.log(`      no view is possible: ${r.noFilter}`)
  }

  console.log('\nEvery number above is derived from this file. Do not copy one into a document.\n')
}

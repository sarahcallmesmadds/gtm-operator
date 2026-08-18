'use strict'

/**
 * The install flow, as something that can be run rather than something written
 * down.
 *
 * The Notion calls themselves are made by the skill, because they go through
 * the connected client and not through this file. What this file does is decide
 * WHAT to send, in what order, and then say whether what came back is right.
 * That division is deliberate: the part that can be tested without a workspace
 * is all here, and the part that needs one is three tool calls in a skill.
 *
 *   node install.js plan                    the whole run, in order
 *   node install.js phase-a                 what to create, per database
 *   node install.js phase-b                 the relation statements, per database
 *   node install.js views                   the view calls
 *   node install.js record <key> <db> <ds>  store what phase A returned
 *   node install.js verify <readback.json>  compare Notion against the manifest
 *   node install.js status                  where this install has got to
 *
 * NOTHING HERE TRUSTS A CREATE CALL. `verify` is the only thing that reports
 * success, it reads its evidence out of a file the skill fills from Notion, and
 * `complete` refuses to run until it has passed.
 */

const fs = require('fs')

const manifest = require('./manifest')
const schema = require('./schema')
const relations = require('./relations')
const views = require('./views')
const config = require('./config')

const { DATABASES, VIEWS, byKey } = manifest

/** Phase A: one create call per database, and none of them refer to each other. */
function phaseA () {
  return DATABASES.map(d => ({
    key: d.key,
    title: d.title,
    call: 'notion-create-database',
    arguments: {
      parent: { type: 'page_id', page_id: '<parent page id>' },
      title: d.title,
      schema: schema.createStatement(d.key)
    }
  }))
}

/** Phase B: one update call per database that owns relations. */
function phaseB (ids) {
  const out = []
  for (const d of DATABASES) {
    const statements = relations.statementsFor(d.key, ids)
    if (!statements) continue
    out.push({
      key: d.key,
      title: d.title,
      call: 'notion-update-data-source',
      arguments: { data_source_id: ids[d.key] ? ids[d.key].dataSourceId : `<${d.key} data source id>`, statements }
    })
  }
  return out
}

/** The views, last, because two of them filter on a property phase B creates. */
function viewCalls (ids) {
  return VIEWS.map(view => ({
    database: view.database,
    name: view.name,
    call: 'notion-create-view',
    arguments: {
      database_id: ids[view.database] ? ids[view.database].databaseId : `<${view.database} database id>`,
      data_source_id: ids[view.database] ? ids[view.database].dataSourceId : `<${view.database} data source id>`,
      name: view.name,
      type: view.layout,
      configure: views.configureFor(view)
    }
  }))
}

/**
 * Compare everything Notion returned against everything the manifest asked for.
 *
 * `readback` is a file the skill writes, holding what came back from fetching
 * each data source and each database. Its shape:
 *
 *   {
 *     "databases": {
 *       "process": { "schema": { ...data source state schema... },
 *                    "views":  [ ...the <views> entries... ] }
 *     },
 *     "viewRows": { "calendar::Needs attention": ["a title", "another"] },
 *     "sqlRows":  { "calendar::Needs attention": ["a title", "another"] }
 *   }
 *
 * `viewRows` and `sqlRows` are the behavioural half, and they are what make a
 * filter proved rather than merely present. See the note on rows below.
 */
function verify (readback) {
  const problems = []
  const notes = []
  const given = (readback && readback.databases) || {}
  const schemas = {}

  for (const d of DATABASES) {
    const entry = given[d.key]
    if (!entry || !entry.schema) {
      problems.push(`${d.title}: nothing was read back for it, so nothing about it was verified`)
      continue
    }
    schemas[d.key] = entry.schema
  }

  // Properties, types, option lists and option order. The relation properties
  // are passed in so they are not reported as somebody else's additions.
  for (const d of DATABASES) {
    if (!schemas[d.key]) continue
    problems.push(...schema.verify(d.key, schemas[d.key], relations.propertyNamesFor(d.key)))
  }

  // Every relation, both ends.
  problems.push(...relations.verifyAll(schemas, config.ids()))

  // Every view, and then the rows it actually returns.
  for (const view of VIEWS) {
    const entry = given[view.database]
    const found = ((entry && entry.views) || []).find(v => v && v.name === view.name)
    problems.push(...views.verifyView(view, found))

    const key = `${view.database}::${view.name}`
    const fromView = readback && readback.viewRows && readback.viewRows[key]
    const fromSql = readback && readback.sqlRows && readback.sqlRows[key]

    if (!views.expectedRows(view)) continue

    if (!fromView || !fromSql) {
      // Said out loud rather than passed over. A view whose filter reads back
      // correctly can still match nothing at all: measured 2026-08-18, when a
      // relative date read back looking perfect and returned no rows.
      notes.push(`${byKey(view.database).title} / ${view.name}: the filter is the one that was asked for, and which rows it returns was not checked`)
      continue
    }

    const a = [...fromView].sort().join(' | ')
    const b = [...fromSql].sort().join(' | ')
    if (a !== b) {
      problems.push(
        `${byKey(view.database).title} / ${view.name}: the view returns different rows from the rule it is supposed to show.\n` +
        `    the view:  ${a || 'nothing'}\n` +
        `    the rule:  ${b || 'nothing'}\n` +
        `    A filter can persist, read back correctly and match nothing. This is that check.`
      )
    }
  }

  return { problems, notes }
}

/**
 * The ids to build a plan with, real where they exist and placeholders where
 * they do not.
 *
 * The plan is shown at the confirmation gate, which is BEFORE anything is
 * created, so on a first run there are no ids at all. Without this the one
 * screen a person has to say yes to could not be printed.
 *
 * Nothing is ever sent from here. A placeholder is obvious on sight and would
 * be rejected by Notion, and the phase B and view calls that do get sent read
 * their ids from config.
 */
function planningIds () {
  const real = config.ids()
  const out = {}
  for (const d of DATABASES) {
    out[d.key] = real[d.key] || {
      databaseId: `<${d.key} database id, from phase A>`,
      dataSourceId: `<${d.key} data source id, from phase A>`
    }
  }
  return out
}

function status () {
  const current = config.read()
  if (!current) return { state: 'nothing started', missing: DATABASES.map(d => d.title) }
  return {
    state: current.state,
    parentPageId: current.notion.parentPageId,
    personId: current.notion.personId,
    recorded: Object.keys(current.databases).map(k => byKey(k).title),
    missing: config.missingDatabases().map(d => d.title),
    verifiedAt: current.verifiedAt || null
  }
}

module.exports = { phaseA, phaseB, viewCalls, planningIds, verify, status }

if (require.main === module) {
  const [command, ...rest] = process.argv.slice(2)
  const show = value => console.log(JSON.stringify(value, null, 2))

  const problems = [...manifest.validate(), ...views.validate()]
  if (problems.length) {
    console.error('The definitions contradict themselves, and nothing below can be trusted:')
    for (const p of problems) console.error(`  ${p}`)
    process.exit(1)
  }

  try {
    switch (command) {
      case 'plan': {
        const ids = planningIds()
        console.log('\nPhase A. Create every database, with no relations in it.\n')
        for (const step of phaseA()) console.log(`  ${step.title}\n      ${step.arguments.schema.slice(0, 96)}...\n`)
        console.log('Phase B. Add every relation, once every id from phase A exists.\n')
        for (const step of phaseB(ids)) console.log(`  ${step.title}\n      ${step.arguments.statements.split('; ').join('\n      ')}\n`)
        console.log('Then the views, last, because two of them filter on a property phase B creates.\n')
        for (const step of viewCalls(ids)) console.log(`  ${byKey(step.database).title} / ${step.name}\n      ${step.arguments.configure || 'no configuration'}\n`)
        console.log('Then read all of it back and compare it. A create call returning is not evidence.\n')
        break
      }
      case 'phase-a': show(phaseA()); break
      case 'phase-b': show(phaseB(config.ids())); break
      case 'views': show(viewCalls(config.ids())); break
      case 'begin': {
        if (!rest[0]) throw new Error('Usage: install.js begin <parent page id>')
        config.begin(rest[0])
        console.log(`Started. Config is at ${config.CONFIG_PATH}, state creating.`)
        break
      }
      case 'record': {
        const [key, databaseId, dataSourceId] = rest
        if (!key || !databaseId || !dataSourceId) throw new Error('Usage: install.js record <key> <database id> <data source id>')
        config.recordDatabase(key, { databaseId, dataSourceId })
        console.log(`Recorded ${byKey(key).title}.`)
        break
      }
      case 'person': {
        config.recordPerson(rest[0] || null)
        console.log(rest[0] ? `Recorded person ${rest[0]}.` : 'Recorded that there is no person id. Every person property will be left unset.')
        break
      }
      case 'verify': {
        if (!rest[0]) throw new Error('Usage: install.js verify <readback.json>')
        const readback = JSON.parse(fs.readFileSync(rest[0], 'utf8'))
        const { problems: found, notes } = verify(readback)
        for (const note of notes) console.log(`  unchecked  ${note}`)
        if (found.length) {
          console.error(`\nWhat Notion returned does not match the manifest, in ${found.length} ${found.length === 1 ? 'place' : 'places'}:\n`)
          for (const p of found) console.error(`  ${p}`)
          process.exit(1)
        }
        console.log('\nEverything Notion returned matches the manifest.')
        break
      }
      case 'complete': {
        if (!rest[0]) throw new Error('Usage: install.js complete <iso timestamp of the verify that passed>')
        config.complete(rest[0])
        console.log('Config says complete.')
        break
      }
      case 'status': show(status()); break
      default:
        console.error('Usage: install.js plan | phase-a | phase-b | views | begin | record | person | verify | complete | status')
        process.exit(2)
    }
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}

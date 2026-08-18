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

/**
 * Phase A: one create call per database, and none of them refer to each other.
 *
 * The parent page id is a parameter because these calls get SENT. It used to be
 * the literal string `<parent page id>` baked into the payload, which `begin`
 * had already recorded properly and this function never read, so the first
 * create call of any install but the author's went to Notion with a placeholder
 * where the page id belonged.
 *
 * `plan` passes its own placeholder on purpose, because the plan is printed
 * before anything exists and is never sent. Sending is the caller's job, and so
 * is having a real id to send.
 */
function phaseA (parentPageId) {
  if (!parentPageId) {
    throw new Error(
      'Phase A needs the parent page id, and none was given. `begin` records it, and `install.js phase-a` reads it back from the config. ' +
      'If this install has not begun, run `install.js begin <parent page id>` first.'
    )
  }
  return DATABASES.map(d => ({
    key: d.key,
    title: d.title,
    call: 'notion-create-database',
    arguments: {
      parent: { type: 'page_id', page_id: parentPageId },
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
 *     "viewRows": { "calendar::Needs attention": ["https://app.notion.com/p/<id>", "..."] },
 *     "sqlRows":  { "calendar::Needs attention": ["https://app.notion.com/<id>", "..."] }
 *   }
 *
 * **Page urls or page ids, never titles.** The two halves come back in different
 * url shapes and both are accepted, but a title is refused: titles are not
 * unique, and two rows sharing one used to compare as the same row. This example
 * said `["a title", "another"]` until 2026-08-18, which is the shape the
 * verifier now rejects.
 *
 * `viewRows` and `sqlRows` are the behavioural half, and they are what make a
 * filter proved rather than merely present. See the note on rows below.
 */
function verify (readback) {
  const problems = []
  const unchecked = []
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
    const where = `${byKey(view.database).title} / ${view.name}`
    const fromView = readback && readback.viewRows && readback.viewRows[key]
    const fromSql = readback && readback.sqlRows && readback.sqlRows[key]

    if (!views.expectedRows(view)) continue

    if (!Array.isArray(fromView) || !Array.isArray(fromSql)) {
      // Said out loud rather than passed over. A view whose filter reads back
      // correctly can still match nothing at all: measured 2026-08-18, when a
      // relative date read back looking perfect and returned no rows.
      unchecked.push(`${where}: the filter is the one that was asked for, and which rows it returns was not checked`)
      continue
    }

    // Both empty proves nothing. It used to pass, because two empty lists
    // joined to the same empty string, so on a fresh workspace every filtered
    // view was reported proved. That is the exact failure this check exists to
    // catch, arriving through the check itself.
    if (!fromView.length && !fromSql.length) {
      unchecked.push(`${where}: the view and the rule both returned nothing, so neither one proved the other. A filter that matches nothing looks exactly like this`)
      continue
    }

    // Every row has to reduce to a page id. Anything that does not is evidence
    // that cannot prove anything, and saying so is the whole point: an earlier
    // version of this handed unrecognised values straight back, so two lists of
    // page TITLES matched each other and the view was reported proved without a
    // single identity being compared.
    const identify = (rows, half) => {
      const ids = []
      const unusable = []
      for (const row of rows) {
        const id = views.pageIdentity(row)
        if (id) ids.push(id)
        else unusable.push(String(row))
      }
      if (unusable.length) {
        problems.push(
          `${where}: ${unusable.length} of the ${rows.length} rows from ${half} ${unusable.length === 1 ? 'is not a page reference' : 'are not page references'}, ` +
          `so they cannot prove which rows came back: ${unusable.slice(0, 3).map(v => JSON.stringify(v)).join(', ')}${unusable.length > 3 ? ', ...' : ''}.\n` +
          `    Record page urls or page ids on both sides. Titles are not unique, and two rows sharing one used to compare as the same row.`
        )
        return null
      }
      return ids.sort()
    }

    const a = identify(fromView, 'the view')
    const b = identify(fromSql, 'the rule')
    if (!a || !b) continue

    // Compared element by element rather than by joining on a separator.
    //
    // The join is how a single row called "alpha | beta" compared equal to two
    // rows called "alpha" and "beta". That specific collision is already closed
    // one step above, by `pageIdentity` refusing anything that is not a page
    // reference: every value reaching here is 32 hex characters and none of them
    // can contain a separator.
    //
    // **So no test can tell this line from the join it replaced**, and that is
    // stated rather than left to be assumed. It is kept because the guarantee it
    // rests on lives in another function: loosen `pageIdentity` and the join
    // becomes exploitable again with nothing to catch it. Checked by reverting
    // it on 2026-08-18, and the suite stayed green.
    const same = a.length === b.length && a.every((id, index) => id === b[index])
    if (!same) {
      problems.push(
        `${where}: the view returns different rows from the rule it is supposed to show.\n` +
        `    the view:  ${a.join(', ') || 'nothing'}\n` +
        `    the rule:  ${b.join(', ') || 'nothing'}\n` +
        `    A filter can persist, read back correctly and match nothing. This is that check.`
      )
    }
  }

  return { problems, unchecked, verified: problems.length === 0 && unchecked.length === 0 }
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
    recorded: Object.keys(current.databases).map(k => {
      const known = byKey(k)
      // A key the manifest no longer has is stale state, and worth seeing. This
      // used to throw, which told you something was wrong by refusing to say
      // anything at all.
      return known ? known.title : `${k} (not in this version's manifest)`
    }),
    missing: config.missingDatabases().map(d => d.title),
    verifiedAt: current.verifiedAt || null
  }
}

module.exports = { phaseA, phaseB, viewCalls, planningIds, verify, status }

if (require.main === module) {
  const [command, ...rest] = process.argv.slice(2)
  const show = value => console.log(JSON.stringify(value, null, 2))

  try {
    // Before the definition preflight below, not after it. That preflight exits
    // first when the manifest contradicts itself, and clearing further down
    // meant a verify that died there left an earlier passing record standing:
    // fix the definitions, and the old proof is usable again without anything
    // having been checked. Same fault as the one this call was added for, one
    // exit earlier.
    // The argument is checked BEFORE the proof is cleared. `install.js verify`
    // with nothing after it used to demote a complete install and erase its
    // record without a single check having been attempted, which is the fault
    // clearing exists to prevent, caused by the clearing itself.
    if (command === 'verify' && !rest[0]) throw new Error('Usage: install.js verify <readback.json>')
    const cleared = command === 'verify' ? config.clearVerified() : null

    const problems = [...manifest.validate(), ...views.validate()]
    if (problems.length) {
      console.error('The definitions contradict themselves, and nothing below can be trusted:')
      for (const p of problems) console.error(`  ${p}`)
      process.exit(1)
    }

    switch (command) {
      case 'plan': {
        const ids = planningIds()
        console.log('\nPhase A. Create every database, with no relations in it.\n')
        for (const step of phaseA('<parent page id, from the question above>')) console.log(`  ${step.title}\n      ${step.arguments.schema.slice(0, 96)}...\n`)
        console.log('Phase B. Add every relation, once every id from phase A exists.\n')
        for (const step of phaseB(ids)) console.log(`  ${step.title}\n      ${step.arguments.statements.split('; ').join('\n      ')}\n`)
        console.log('Then the views, last, because two of them filter on a property phase B creates.\n')
        for (const step of viewCalls(ids)) console.log(`  ${byKey(step.database).title} / ${step.name}\n      ${step.arguments.configure || 'no configuration'}\n`)
        console.log('Then read all of it back and compare it. A create call returning is not evidence.\n')
        break
      }
      case 'phase-a': {
        const current = config.read()
        const parentPageId = current && current.notion && current.notion.parentPageId
        show(phaseA(parentPageId))
        break
      }
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
        const { problems: found, unchecked, verified } = verify(readback)

        for (const note of unchecked) console.error(`  not proved  ${note}`)
        if (found.length) {
          console.error(`\nWhat Notion returned does not match the manifest, in ${found.length} ${found.length === 1 ? 'place' : 'places'}:\n`)
          for (const p of found) console.error(`  ${p}`)
        }

        // An unproved view is not a pass. This used to print the unproved ones
        // and then exit 0, so an install whose views were never proved could go
        // straight on to `complete`, which is what the whole file exists to
        // stop.
        if (!verified) {
          console.error(
            `\nThis install is not verified: ${found.length} ${found.length === 1 ? 'thing does' : 'things do'} not match ` +
            `and ${unchecked.length} ${unchecked.length === 1 ? 'was' : 'were'} not proved. Nothing has been recorded as verified.`
          )
          process.exit(1)
        }

        const at = new Date().toISOString()
        config.recordVerified(at)
        // Put back what clearing took, and only that. An install that was
        // complete before this verify and has just passed it again is still
        // complete; one that was not is not suddenly finished because a check
        // passed.
        if (cleared && cleared.wasComplete) config.complete()
        console.log(`\nEverything Notion returned matches the manifest, and every view was proved by its rows. Recorded as verified at ${at}.`)
        break
      }
      case 'complete': {
        // No timestamp argument. It used to take one and believe it, so any
        // non-empty string stood in for a verify that may never have run.
        const done = config.complete()
        console.log(`Config says complete, on the verify that passed at ${done.verifiedAt}.`)
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

'use strict'

/**
 * Phase B. The twelve relations, as statements to send and as something to
 * check afterwards.
 *
 * `manifest.js` says which relations exist and which way they point. This turns
 * one into the `ADD COLUMN` statement that creates it, and reads a data source
 * back to say whether it is really there.
 *
 * WHAT WAS MEASURED, 2026-08-18, against a live workspace. All of it, because
 * the tool documentation describes something different from what happens:
 *
 *   A two-way relation is ONE statement, and that holds for a self-relation
 *   too. `ADD COLUMN "Parent" RELATION('<same ds>', DUAL 'Child Docs')` created
 *   both `Parent` and `Child Docs`. The tool's own example for self-relations
 *   adds two columns, one for each side. **Following it would have created four
 *   properties where the design wants two**, which is exactly the duplicate the
 *   manifest warns about, arrived at by doing what the documentation said.
 *
 *   A one-way relation is the same statement without `DUAL`, and it creates
 *   nothing on the target.
 *
 *   Two self-relations coexist on one database with distinct reverse names.
 *
 * HOW TO TELL THEM APART AFTERWARDS, which is the part that makes verification
 * possible: a two-way relation comes back carrying `propertyUrl`, pointing at
 * its synced counterpart. A one-way relation has no `propertyUrl` at all. That
 * is the only thing in the returned schema that distinguishes them, and without
 * it a one-way relation built by mistake as a two-way would read as correct.
 */

const { RELATIONS, byKey, relationsFrom } = require('./manifest')

/**
 * The statement that creates one relation.
 *
 * `ids` maps a database key to what phase A returned for it. Only the target's
 * data source id is needed: the statement is sent to the source's data source,
 * so the source names itself by where it is sent.
 */
function statementFor (relation, ids) {
  const target = ids[relation.to]
  if (!target || !target.dataSourceId) {
    throw new Error(
      `relation ${relation.n} points at ${byKey(relation.to).title}, which has no data source id yet. ` +
      `Phase B cannot start until phase A has finished for every database, which is why they are two phases.`
    )
  }

  const column = `"${relation.property}"`
  const dataSource = `'${bare(target.dataSourceId)}'`

  if (relation.kind === 'one-way') return `ADD COLUMN ${column} RELATION(${dataSource})`
  return `ADD COLUMN ${column} RELATION(${dataSource}, DUAL '${relation.reverse}')`
}

/**
 * The statements for one database, in one call.
 *
 * Batched per source database rather than sent one at a time, because a burst
 * of schema writes is where a rate limit shows up. It is safe to batch because
 * nothing downstream trusts that these succeeded: what exists is worked out by
 * reading the data sources back, in `missing` below, not by remembering which
 * calls returned.
 */
function statementsFor (key, ids) {
  const relations = relationsFrom(key)
  if (!relations.length) return null
  return relations.map(r => statementFor(r, ids)).join('; ')
}

/** Notion accepts a bare uuid or a collection:// url. The DDL wants the bare id. */
function bare (id) {
  return String(id).replace(/^collection:\/\//, '')
}

/**
 * Two data source references naming the same data source.
 *
 * A missing id on either side is NOT a match. It used to be: both sides absent
 * compared equal and the relation passed, which is a check answering "I do not
 * know" with "yes".
 */
function sameDataSource (a, b) {
  if (!a || !b) return false
  return bare(a) === bare(b)
}

/**
 * The data source a `collectionProperty://` url names.
 *
 * Measured 2026-08-18 across every relation in
 * `tests/fixtures/full-install-as-notion-returned-it.json`: the counterpart url
 * is `collectionProperty://<data source id>/<property id>`, and its data source
 * half is the TARGET of the relation, the same one `dataSourceUrl` names. So it
 * can be compared, and until 2026-08-18 nothing compared it: the check asked
 * only whether the url existed, which is one bit for the thing that separates a
 * two-way relation from a one-way one.
 */
function counterpartDataSource (propertyUrl) {
  if (!propertyUrl) return null
  const match = String(propertyUrl).match(/^collectionProperty:\/\/([^/]+)\//)
  return match ? match[1] : null
}

/**
 * Check one relation against what came back.
 *
 * `schemas` maps a database key to the `schema` object from that data source's
 * read-back, and `ids` is what phase A returned.
 *
 * Both ends are checked, and that is the point. The source end alone cannot
 * tell you a two-way relation worked, because the property Notion creates on
 * the target is the whole difference between a two-way relation and a one-way
 * one, and it is on the other database.
 */
function verifyRelation (relation, schemas, ids) {
  const from = byKey(relation.from).title
  const to = byKey(relation.to).title
  const label = `relation ${relation.n} (${from}.${relation.property})`
  const problems = []

  const source = schemas[relation.from]
  if (!source) return [`${label}: ${from} was not read back, so nothing was verified`]

  const property = source[relation.property]
  if (!property) return [`${label}: missing from ${from}`]
  if (property.type !== 'relation') {
    problems.push(`${label}: expected a relation, got ${property.type}`)
    return problems
  }

  // Not skipped when the id is absent. It used to be gated on `target` being
  // present, so a workspace whose databases were read back but never recorded in
  // config had every relation destination go unchecked and pass.
  const target = ids[relation.to]
  if (!target || !target.dataSourceId) {
    problems.push(`${label}: ${to} is not recorded in the config, so where this relation points could not be checked`)
  } else if (!sameDataSource(property.dataSourceUrl, target.dataSourceId)) {
    problems.push(`${label}: points at ${property.dataSourceUrl || 'nothing'}, and ${to} is ${target.dataSourceId}`)
  }

  if (relation.kind === 'two-way') {
    // Measured 2026-08-18: a two-way relation carries propertyUrl and a one-way
    // one does not. This is what catches a relation built the wrong way round.
    if (!property.propertyUrl) {
      problems.push(`${label}: has no synced counterpart, so it was created one-way where the design says two-way`)
    } else if (target && target.dataSourceId) {
      // Where the counterpart lives, not merely that there is one.
      const counterpart = counterpartDataSource(property.propertyUrl)
      if (!counterpart) {
        problems.push(`${label}: its counterpart is recorded as ${property.propertyUrl}, which is not a collectionProperty:// url and cannot be checked`)
      } else if (!sameDataSource(counterpart, target.dataSourceId)) {
        problems.push(`${label}: its synced counterpart sits on ${counterpart}, and ${to} is ${target.dataSourceId}`)
      }
    }

    const targetSchema = schemas[relation.to]
    if (!targetSchema) {
      problems.push(`${label}: ${to} was not read back, so the far side could not be checked`)
    } else {
      const reverse = targetSchema[relation.reverse]
      if (!reverse) {
        problems.push(`${label}: ${to} has no "${relation.reverse}", which is the property Notion should have created on it`)
      } else if (reverse.type !== 'relation') {
        problems.push(`${label}: ${to}."${relation.reverse}" is a ${reverse.type} and not a relation`)
      } else {
        const sourceId = ids[relation.from]
        if (!sourceId || !sourceId.dataSourceId) {
          problems.push(`${label}: ${from} is not recorded in the config, so the far side of this relation could not be checked`)
        } else {
          if (!sameDataSource(reverse.dataSourceUrl, sourceId.dataSourceId)) {
            problems.push(`${label}: ${to}."${relation.reverse}" points at ${reverse.dataSourceUrl || 'nothing'} rather than back at ${from}`)
          }
          // The same three branches as the near side, rather than one
          // condition that passes whenever a piece is missing. The first
          // version of this read `if (propertyUrl && back && !same)`, so a
          // reverse property with no counterpart url at all, or one in a shape
          // this cannot parse, reported nothing. That is the skip-when-absent
          // fault removed from the near side, rebuilt on the far side.
          if (!reverse.propertyUrl) {
            problems.push(`${label}: ${to}."${relation.reverse}" has no synced counterpart, so the far side is not the two-way property Notion should have created`)
          } else {
            const back = counterpartDataSource(reverse.propertyUrl)
            if (!back) {
              problems.push(`${label}: ${to}."${relation.reverse}" records its counterpart as ${reverse.propertyUrl}, which is not a collectionProperty:// url and cannot be checked`)
            } else if (!sameDataSource(back, sourceId.dataSourceId)) {
              problems.push(`${label}: ${to}."${relation.reverse}" has its counterpart on ${back} rather than back at ${from}`)
            }
          }
        }
      }
    }
  }

  if (relation.kind === 'one-way' && property.propertyUrl) {
    problems.push(
      `${label}: carries a synced counterpart, so it was created two-way where the design says one-way. ` +
      `That puts a property on ${to} that nothing owns.`
    )
  }

  return problems
}

/** Every relation, checked. */
function verifyAll (schemas, ids) {
  return RELATIONS.flatMap(r => verifyRelation(r, schemas, ids))
}

/**
 * Which relations are not there yet, worked out by looking rather than by
 * remembering.
 *
 * This is what makes phase B safe to re-run. A run that died halfway, or a
 * batch that failed on its third statement, leaves a workspace whose state is
 * knowable by reading it, and re-running creates only what is genuinely absent.
 * Nothing here consults a log of which calls returned, because a call
 * returning is not evidence that anything was created.
 */
function missing (schemas, ids) {
  return RELATIONS.filter(r => verifyRelation(r, schemas, ids).length > 0)
}

/** The statements for whatever is still missing, grouped by database. */
function repairStatements (schemas, ids) {
  const out = {}
  for (const relation of missing(schemas, ids)) {
    const source = schemas[relation.from] || {}
    // A property that is there but wrong is not something to add again. Adding
    // it a second time is how duplicates appear, which is the one failure this
    // whole file is arranged around.
    if (source[relation.property]) continue
    out[relation.from] = out[relation.from] ? `${out[relation.from]}; ${statementFor(relation, ids)}` : statementFor(relation, ids)
  }
  return out
}

/** The relation property names a database ends up with, both directions. */
function propertyNamesFor (key) {
  const names = relationsFrom(key).map(r => r.property)
  for (const r of RELATIONS) if (r.to === key && r.reverse) names.push(r.reverse)
  return names
}

module.exports = { statementFor, statementsFor, verifyRelation, verifyAll, missing, repairStatements, propertyNamesFor, bare }

if (require.main === module) {
  // Placeholder ids, so the shape of every statement can be read without a
  // workspace. The ids in a real run come from phase A.
  //
  // Built from every database rather than from the relation targets. Calendar
  // is the source of two relations and the target of none, so keying this by
  // target dropped it out of the listing entirely.
  const { DATABASES } = require('./manifest')
  const ids = {}
  for (const d of DATABASES) ids[d.key] = { dataSourceId: `<${d.key}-data-source-id>` }

  console.log('\nPhase B, one call per database\n')
  for (const d of DATABASES) {
    const key = d.key
    const statements = statementsFor(key, ids)
    if (!statements) continue
    console.log(`  ${byKey(key).title}`)
    for (const statement of statements.split('; ')) console.log(`      ${statement}`)
    console.log('')
  }
}

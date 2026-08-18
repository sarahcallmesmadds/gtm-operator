'use strict'

/**
 * A fingerprint of what an install would send to Notion.
 *
 * A recorded verify is a claim that a workspace matches what this code builds.
 * `complete` refuses a proof whose fingerprint has moved, so the whole value of
 * that refusal is in what the fingerprint covers.
 *
 * IT HASHES THE GENERATED CALLS, NOT THE DEFINITIONS BEHIND THEM. That
 * distinction is the entire point and it was learned twice:
 *
 *   1. The first version hashed the manifest: databases, relations and views.
 *      It missed `schema.js` completely, so changing a property, its type or an
 *      option colour left an old proof valid.
 *   2. The second version added the schema data. It still missed the code that
 *      turns data into calls. Changing `DDL_TYPE.date` from `DATE` to
 *      `DATETIME` altered every create statement that an install sends and left
 *      the hash byte for byte identical. Measured 2026-08-18.
 *
 * Both versions were a fix for "a proof outlived a change" that itself let a
 * proof outlive a change. Hashing the output ends that: if the bytes going to
 * Notion are the same, the proof still holds, and if they are not, it does not.
 *
 * It also settles what to leave out, which the earlier versions had to argue
 * about one field at a time. A `note` in `schema.js` is not in the hash because
 * it is not in any call. Neither is a relation's `n`, which numbers the design
 * table and reaches no statement. Nothing has to be listed as excluded: if it is
 * not sent, it is not here.
 *
 * The ids are placeholders on purpose. Real data source ids differ between
 * installs and would make every fingerprint unique to one workspace, which is
 * the opposite of what this is for.
 */

const { DATABASES, RELATIONS, VIEWS, byKey } = require('./manifest')
const schema = require('./schema')
const relations = require('./relations')
const views = require('./views')

const PLACEHOLDER = Object.fromEntries(
  DATABASES.map(d => [d.key, { databaseId: `db-${d.key}`, dataSourceId: `ds-${d.key}` }])
)

/** Every call an install would make, in a stable order, as text. */
function calls () {
  const out = []

  for (const d of DATABASES) {
    out.push(`create ${d.key} ${JSON.stringify(d.title)} ${schema.createStatement(d.key)}`)
  }

  for (const r of RELATIONS) {
    out.push(`relate ${r.from}->${r.to} ${relations.statementFor(r, PLACEHOLDER)}`)
  }

  for (const v of VIEWS) {
    out.push(`view ${v.database} ${JSON.stringify(v.name)} ${v.layout} ${views.configureFor(v) || ''}`)
  }

  return out
}

function fingerprint () {
  return require('crypto').createHash('sha256').update(calls().join('\n')).digest('hex').slice(0, 16)
}

module.exports = { fingerprint, calls, PLACEHOLDER, byKey }

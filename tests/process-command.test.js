'use strict'

/**
 * The Process command layer: the queries it builds and the judgments it makes.
 *
 * TWO CONFIGS, AND THAT IS THE POINT. One records the shipped property names and
 * one records a workspace that renamed every property and every value. A query
 * built against the second that still carries the shipped names would come back
 * with no rows, and no rows is exactly what an empty library looks like. So the
 * renamed config is what proves the map is being used, and the plain one keeps
 * the other assertions readable.
 *
 * WHAT THIS DOES NOT PROVE. No SQL here has been sent. The queries are asserted
 * as strings, and whether Notion's SQL surface accepts them is a live-run
 * question that this cannot answer.
 *
 * Run: node tests/process-command.test.js
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const assert = require('assert')

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'gtm-process-command-'))
process.env.GTM_OPERATOR_CONFIG = path.join(SANDBOX, 'gtm-operator.config.json')

const setupSchema = require('../plugins/setup/scripts/schema')
const identity = setupSchema.identityNames('process')

/** A map that renames everything, so a raw name in a query is visible. */
const renamed = {
  properties: Object.fromEntries(Object.keys(identity.properties).map(k => [k, `R ${k}`])),
  values: Object.fromEntries(
    Object.entries(identity.values).map(([property, values]) => [
      property,
      Object.fromEntries(Object.keys(values).map(v => [v, `R ${v}`]))
    ])
  )
}

const writeConfig = map => fs.writeFileSync(process.env.GTM_OPERATOR_CONFIG, JSON.stringify({
  configVersion: 3,
  state: 'complete',
  notion: { parentPageId: 'p', personId: 'person-1' },
  databases: {
    process: {
      databaseId: 'db', dataSourceId: 'ds', displayName: 'Process',
      properties: map.properties, values: map.values
    }
  },
  verified: { at: 'x', definitions: 'y' },
  defaults: {}, sources: {}, taxonomyPath: '/tmp/x'
}, null, 2))

writeConfig(identity)

const command = require('../plugins/process/scripts/process')
const config = require('../shared/config-read')
const schema = require('../shared/process-schema')

let failures = 0
const check = (name, fn) => {
  try {
    fn()
    console.log(`  ok    ${name}`)
  } catch (err) {
    failures++
    console.log(`  FAIL  ${name}`)
    console.log(`        ${err.message.split('\n').join('\n        ')}`)
  }
}

const contextFor = map => {
  writeConfig(map)
  delete require.cache[require.resolve('../shared/config-read')]
  const fresh = require('../shared/config-read')
  return fresh.contextFor('process', schema.IDENTITY)
}

const context = config.contextFor('process', schema.IDENTITY)

console.log('\nthe Process command layer\n')

check('the context these tests rest on is usable', () => {
  assert.strictEqual(context.ok, true, context.message)
  assert.strictEqual(context.dataSourceId, 'ds')
})

// ------------------------------------------------------------------- row lists

check('a missing result is refused rather than read as an empty library', () => {
  for (const nothing of [null, undefined]) {
    assert.throws(
      () => command.rowList(nothing),
      /not being reported as one/,
      'a null result was treated as a library with nothing in it'
    )
  }
})

check('the shapes a result can arrive in are all accepted', () => {
  assert.deepStrictEqual(command.rowList([{ a: 1 }]), [{ a: 1 }])
  assert.deepStrictEqual(command.rowList({ results: [{ a: 1 }] }), [{ a: 1 }])
  assert.deepStrictEqual(command.rowList({ rows: [{ a: 1 }] }), [{ a: 1 }])
  assert.deepStrictEqual(command.rowList({ data: [{ a: 1 }] }), [{ a: 1 }])
  assert.deepStrictEqual(command.rowList([]), [], 'an empty array is a real answer and must pass')
})

check('an unrecognised shape is refused by name', () => {
  assert.throws(() => command.rowList({ items: [] }), /items/)
})

check('rows come back keyed logically, whatever the workspace calls them', () => {
  const renamedContext = contextFor(renamed)
  assert.strictEqual(renamedContext.ok, true, renamedContext.message)

  const raw = [{ url: 'u', 'R Name': 'Routing', 'R Type': 'R SOP/ROE', 'R Status': 'R Active' }]
  const [row] = command.normaliseRows(renamedContext, raw)

  assert.strictEqual(row.Name, 'Routing', 'the renamed column did not come back under its logical name')
  assert.strictEqual(row.Type, 'R SOP/ROE')
  assert.strictEqual(row.url, 'u')
})

// ------------------------------------------------------------------ similarity

check('similarity is 1 for the same words and 0 for none in common', () => {
  assert.strictEqual(command.similarity('lead routing rules', 'lead routing rules'), 1)
  assert.strictEqual(command.similarity('lead routing', 'invoice reconciliation'), 0)
})

check('word order does not change the score', () => {
  assert.strictEqual(
    command.similarity('routing lead rules', 'lead rules routing'),
    1
  )
})

check('stop words and punctuation do not carry weight', () => {
  assert.strictEqual(
    command.similarity('How the lead routing works', 'Lead routing!'),
    command.similarity('lead routing works', 'lead routing')
  )
})

check('an empty side scores 0 rather than dividing by nothing', () => {
  assert.strictEqual(command.similarity('', 'lead routing'), 0)
  assert.strictEqual(command.similarity('lead routing', ''), 0)
  assert.strictEqual(command.similarity('the and of', 'lead routing'), 0)
})

check('the threshold is carried as unmeasured, not as calibrated', () => {
  assert.strictEqual(command.THRESHOLD_IS_MEASURED, false)
  assert.ok(command.DEFAULT_THRESHOLD > 0 && command.DEFAULT_THRESHOLD < 1)
})

// ------------------------------------------------------------------- staleness

const row = (cadence, checked) => ({ 'Review cadence': cadence, 'Last checked for accuracy': checked })

check('an artifact inside its cadence is fresh and one past it is due', () => {
  assert.strictEqual(command.staleness(row('Quarterly', '2026-08-01'), '2026-08-23').state, 'fresh')
  assert.strictEqual(command.staleness(row('Quarterly', '2026-01-01'), '2026-08-23').state, 'due')
})

check('the boundary is exact: at the cadence is fresh, a day past is due', () => {
  // Quarterly is 90 days. 2026-05-25 to 2026-08-23 is exactly 90.
  const at = command.staleness(row('Quarterly', '2026-05-25'), '2026-08-23')
  assert.strictEqual(at.state, 'fresh', `expected fresh at exactly 90 days, got ${at.state} (${at.elapsed})`)
  assert.strictEqual(at.elapsed, 90)

  const past = command.staleness(row('Quarterly', '2026-05-24'), '2026-08-23')
  assert.strictEqual(past.state, 'due')
  assert.strictEqual(past.elapsed, 91)
})

check('a cadence that opts out is exempt, which is not fresh', () => {
  for (const cadence of ['None', 'On change only']) {
    const answer = command.staleness(row(cadence, '2020-01-01'), '2026-08-23')
    assert.strictEqual(answer.state, 'exempt', `${cadence} should be exempt`)
    assert.ok(answer.why.includes('every other audit signal') || answer.why.includes('Every other audit signal'))
  }
})

check('the four ways this cannot answer are all "unknown", never "fresh"', () => {
  const cases = [
    [row(undefined, '2026-08-01'), 'no cadence'],
    [row('Every other Thursday', '2026-08-01'), 'a cadence this version does not know'],
    [row('Quarterly', undefined), 'never checked'],
    [row('Quarterly', 'last Tuesday'), 'a date that will not parse']
  ]
  for (const [subject, what] of cases) {
    const answer = command.staleness(subject, '2026-08-23')
    assert.strictEqual(answer.state, 'unknown', `${what} came back as "${answer.state}" rather than unknown`)
    assert.ok(answer.why, `${what} came back with no reason`)
  }
})

check('an unrecognised cadence is not quietly read as exempt', () => {
  // The two collapse into one `null` in the day table, and telling them apart is
  // the whole reason `cadenceDays` returns undefined for one of them.
  assert.strictEqual(command.staleness(row('Every other Thursday', '2020-01-01'), '2026-08-23').state, 'unknown')
  assert.strictEqual(command.staleness(row('None', '2020-01-01'), '2026-08-23').state, 'exempt')
})

console.log(failures ? `\n${failures} failed.\n` : '\nAll passed.\n')
process.exit(failures ? 1 : 0)

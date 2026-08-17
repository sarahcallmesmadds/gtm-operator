'use strict'

/**
 * Tests for `verify`, the function behind install step 7.
 *
 * Step 7 exists because of what was measured on 2026-08-17: a Notion write can
 * return success and not do what it said. A view was created, the call reported
 * success, and the filter had been silently discarded. So this plugin treats a
 * create call returning without an error as no evidence at all, and reads back
 * what it made.
 *
 * That makes `verify` load-bearing, and a load-bearing check that has never
 * failed is a check nobody has tested. Every case below breaks the fixture on
 * purpose and asserts the right complaint comes out.
 *
 * The fixture is not invented. It is the schema Notion actually returned when
 * this plugin created the Process Library in a live workspace.
 *
 * Run: node tests/schema-verify.test.js
 */

const path = require('path')
const assert = require('assert')

const ROOT = path.join(__dirname, '..')
const schema = require(path.join(ROOT, 'plugins/setup/scripts/schema.js'))

const clean = () => {
  const f = JSON.parse(JSON.stringify(require('./fixtures/process-library-as-notion-returned-it.json')))
  delete f._comment
  return f
}

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

const complains = (broken, mustMention) => {
  const problems = schema.verify('process', broken)
  assert.ok(problems.length > 0, `verify passed something it should have caught (expected a complaint about ${mustMention})`)
  const joined = problems.join('\n')
  assert.ok(joined.includes(mustMention),
    `verify complained, but not about the right thing.\n  wanted mention of: ${mustMention}\n  got:\n${joined}`)
}

console.log('\nverify catches what it claims to catch\n')

check('a correct database passes', () => {
  const problems = schema.verify('process', clean())
  assert.strictEqual(problems.length, 0, `verify complained about the real thing Notion returned:\n${problems.join('\n')}`)
})

check('a missing property is caught', () => {
  const broken = clean()
  delete broken['Review cadence']
  complains(broken, 'Review cadence: missing')
})

check('a wrong type is caught', () => {
  const broken = clean()
  broken.Status.type = 'multi_select'
  complains(broken, 'expected type select, got multi_select')
})

check('a missing select option is caught', () => {
  const broken = clean()
  broken.Type.options = broken.Type.options.filter(o => o.name !== 'Reporting')
  complains(broken, 'option "Reporting" is missing')
})

/**
 * The one most likely to be dismissed as pedantry, and the reason it is not:
 * Notion sorts a select by the order the options are arranged in, so a correct
 * set in the wrong order is a real defect. It is invisible until somebody groups
 * a view by that property, which is long after setup has reported success.
 */
check('options in the wrong order are caught', () => {
  const broken = clean()
  broken['L2C Lifecycle'].options.reverse()
  complains(broken, 'options are in the wrong order')
})

check('an unexpected extra property is reported, not silently allowed', () => {
  const broken = clean()
  broken['Someone else added this'] = { name: 'Someone else added this', type: 'text' }
  complains(broken, 'Reported, not removed')
})

/**
 * The failure this whole file exists to prevent. If Notion returns nothing
 * useful, `verify` must say it verified nothing rather than returning an empty
 * problem list, which reads identically to success.
 */
check('an empty response is a failure, not a pass', () => {
  const problems = schema.verify('process', null)
  assert.ok(problems.length > 0, 'verify(null) returned no problems, which is indistinguishable from a clean pass')
  assert.ok(problems.join(' ').includes('nothing was verified'),
    `verify(null) complained, but not clearly enough to stop somebody reading it as success:\n${problems.join('\n')}`)
})

check('the generated statement has one title and no relations', () => {
  const ddl = schema.createStatement('process')
  assert.ok(ddl.startsWith('CREATE TABLE ('), 'statement does not start as a CREATE TABLE')
  assert.strictEqual((ddl.match(/TITLE/g) || []).length, 1, 'expected exactly one TITLE column')
  assert.ok(!/RELATION/.test(ddl), 'relations belong to phase B and must never appear in the create statement')
})

check('an unknown property type stops the run rather than being guessed', () => {
  const original = schema.DATABASES.process.properties
  schema.DATABASES.process.properties = original.concat([{ name: 'Nonsense', type: 'wormhole' }])
  try {
    assert.throws(() => schema.createStatement('process'), /unknown property type "wormhole"/)
  } finally {
    schema.DATABASES.process.properties = original
  }
})

/**
 * Every database in the manifest must have a schema, and vice versa.
 *
 * This is the join between the two files, and it is exactly the shape of drift
 * three review rounds kept finding: a thing added in one place and not the
 * other. Adding a seventh database to the manifest and forgetting its properties
 * would otherwise fail at install time, against a real workspace, halfway
 * through creating things it does not delete.
 */
const manifest = require(path.join(ROOT, 'plugins/setup/scripts/manifest.js'))

check('every database in the manifest has a schema, and every schema is in the manifest', () => {
  const inManifest = manifest.DATABASES.map(d => d.key).sort()
  const inSchema = schema.defined().sort()
  assert.deepStrictEqual(inSchema, inManifest,
    `manifest has [${inManifest.join(', ')}]\n  schema.js has [${inSchema.join(', ')}]`)
})

check('the titles agree between the manifest and the schema', () => {
  const problems = []
  for (const d of manifest.DATABASES) {
    const mine = schema.DATABASES[d.key]
    if (mine && mine.title !== d.title) {
      problems.push(`${d.key}: manifest says "${d.title}", schema.js says "${mine.title}"`)
    }
  }
  assert.strictEqual(problems.length, 0, problems.join('\n'))
})

check('every database generates a valid statement with exactly one title', () => {
  const problems = []
  for (const key of schema.defined()) {
    let ddl
    try {
      ddl = schema.createStatement(key)
    } catch (err) {
      problems.push(`${key}: ${err.message}`)
      continue
    }
    const titles = (ddl.match(/\bTITLE\b/g) || []).length
    if (titles !== 1) problems.push(`${key}: expected one TITLE column, statement has ${titles}`)
    if (/RELATION/.test(ddl)) problems.push(`${key}: statement contains a relation, which belongs to phase B`)
  }
  assert.strictEqual(problems.length, 0, problems.join('\n'))
})

/**
 * A relation named in the manifest must not also be a property in schema.js.
 *
 * Phase A creates properties and phase B adds relations. A relation appearing in
 * both would be created twice, and a two-way relation created twice produces
 * duplicate properties, which is the failure `add` exists to avoid.
 */
check('no relation is also declared as a phase A property', () => {
  const problems = []
  for (const r of manifest.RELATIONS) {
    const source = schema.DATABASES[r.from]
    if (source && source.properties.some(p => p.name === r.property)) {
      problems.push(`relation ${r.n}: ${source.title}.${r.property} is in schema.js and would be created twice`)
    }
    if (r.reverse) {
      const target = schema.DATABASES[r.to]
      if (target && target.properties.some(p => p.name === r.reverse)) {
        problems.push(`relation ${r.n}: ${target.title}.${r.reverse} is the synced side and must not be created by hand`)
      }
    }
  }
  assert.strictEqual(problems.length, 0, problems.join('\n'))
})

console.log(failures === 0
  ? `\nAll checks passed. ${schema.defined().length} databases, ${schema.defined().reduce((n, k) => n + schema.DATABASES[k].properties.length, 0)} properties.\n`
  : `\n${failures} check(s) failed.\n`)

process.exit(failures === 0 ? 0 : 1)

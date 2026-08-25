'use strict'

/**
 * The readback extractor: verbatim fetch saves in, verify's evidence out,
 * with the failure modes of a model-transcribed save refused loudly.
 *
 * THE FIXTURES ARE A MEASUREMENT. tests/fixtures/readback-data-source-fetch.txt
 * and readback-database-fetch.txt are what the Notion client returned on
 * 2026-08-25 for a data-source fetch and a database fetch of a probe database
 * created under the testing page and deleted afterwards. Identifiers are
 * remapped because this repository is public, and the sqlite-table comments in
 * the database fixture are shortened; the extractor reads neither. The
 * <data-source-state> and <view> blobs are unaltered.
 *
 * MUTATION-PROVED, each mutation asserted landed before the suite ran:
 *   1. the parse refusal swallowed (clipped saves accepted) — the clipped-save
 *      check went red.
 *   2. the distinct-data-source refusal removed — the mixed-saves check went
 *      red.
 *   3. the envelope merge replaced with a fresh envelope each run — the
 *      merge-preserves check went red.
 * And after the Codex round's fixes: 4. the wrapper check disabled — the
 * truncation-after-state and page-fetch checks went red. 5. the view
 * provenance check disabled — the foreign-view check went red. 6. the
 * envelope databases-shape guard disabled — the damaged-envelope check went
 * red.
 *
 * Run: node tests/install-readback.test.js
 */

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const readback = require('../plugins/setup/scripts/readback')

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'gtm-readback-'))
process.env.GTM_OPERATOR_CONFIG = path.join(SANDBOX, 'gtm-operator.config.json')

const DS_FIXTURE = fs.readFileSync(path.join(__dirname, 'fixtures', 'readback-data-source-fetch.txt'), 'utf8')
const DB_FIXTURE = fs.readFileSync(path.join(__dirname, 'fixtures', 'readback-database-fetch.txt'), 'utf8')

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

console.log('\nthe install readback extractor\n')

// ------------------------------------------------------------------ extraction

check('a data-source save extracts the whole schema, mechanically', () => {
  const { schema, views, summary } = readback.extract(DS_FIXTURE)
  assert.strictEqual(summary.properties, 11)
  assert.strictEqual(summary.optionValues, 6, 'Status has three options and Audience has three')
  assert.strictEqual(summary.withDescriptions, 1, 'only Contract link carries a description in the probe')
  assert.deepStrictEqual(views, [])
  // The shapes inspect compares, exactly as Notion returned them.
  assert.strictEqual(schema.Description.type, 'text', 'RICH_TEXT reads back as text, the READ_BACK_AS pair')
  assert.strictEqual(schema.Owner.type, 'person')
  assert.strictEqual(schema['Contract link'].description, 'Put the contract PDF in Google Drive and paste the link here.')
  assert.deepStrictEqual(schema.Status.options.map(o => [o.name, o.color]),
    [['Evaluating', 'yellow'], ['Active', 'green'], ['Retired', 'gray']],
    'option names, colours and order all travel')
})

check('a database save carries the same state plus the views', () => {
  const { schema, views } = readback.extract(DB_FIXTURE)
  assert.strictEqual(Object.keys(schema).length, 11)
  assert.strictEqual(views.length, 1)
  assert.strictEqual(views[0].name, 'Default view')
  assert.strictEqual(views[0].type, 'table', 'the view blob is the dialect verifyView reads')
})

check('both saves together merge to one schema and the views, nothing doubled', () => {
  const { schema, views, summary } = readback.extract([DS_FIXTURE, DB_FIXTURE])
  assert.strictEqual(Object.keys(schema).length, 11)
  assert.strictEqual(views.length, 1)
  assert.ok(summary.dataSource.includes('facadefa-cade-4000-8000-facadefacade'))
})

// -------------------------------------------------------------------- refusals

const wrapState = state => `<data-source url="{{collection://x}}">\n<data-source-state>\n${state}\n</data-source-state>\n</data-source>`

check('a clipped save is refused loudly, not read as a database missing things', () => {
  // Clipping inside the JSON blob: the braces never balance again.
  const insideJson = DS_FIXTURE.replace(/"Status":\{[\s\S]*?"type":"select"\}\}/, '"Status":{')
  assert.throws(() => readback.extract(insideJson), /lost its tail|not valid JSON/i, 'a clip inside the blob got through')
  // Clipping the tail entirely: the fetch wrapper loses its closing tag.
  const tail = DS_FIXTURE.slice(0, DS_FIXTURE.indexOf('"Owner"'))
  assert.throws(() => readback.extract(tail), /missing its closing/, 'a lost tail got through')
})

check('a save clipped just after a complete schema is refused, not read as a database with no views', () => {
  // The Codex probe that disproved the first draft's claim: everything up to
  // and including the state parses cleanly, and the views and the closing
  // wrapper are gone. Eleven properties and zero views used to be accepted.
  const afterState = DB_FIXTURE.slice(0, DB_FIXTURE.indexOf('</data-source-state>') + '</data-source-state>'.length)
  assert.throws(() => readback.extract(afterState), /missing its closing <\/database>/, 'truncation after a complete state got through')
})

check('a page fetch is refused outright, even when its content carries a state blob', () => {
  // A state blob written into page content is a document, not evidence, and
  // treating it as evidence would verify a workspace against a page.
  const page = `<page url="https://app.notion.com/p/${'a'.repeat(32)}">\n<properties>{"title":"Notes"}</properties>\nSomebody pasted this into a doc:\n\`\`\`\n${DS_FIXTURE}\n\`\`\`\n</page>`
  assert.throws(() => readback.extract(page), /page fetch/, 'page content was accepted as schema evidence')
})

check('a literal closing tag inside a JSON string is legal content, not a clip', () => {
  // The tag-search this scanner replaced stopped at it and refused a real
  // blob as clipped: the safe direction, and still a false refusal.
  const state = '{"name":"x","schema":{"Name":{"description":"mentions </data-source-state> literally","name":"Name","type":"title"}},"url":"collection://x"}'
  const { schema } = readback.extract(wrapState(state))
  assert.strictEqual(schema.Name.description, 'mentions </data-source-state> literally')
})

check('a save with no fetch in it, and an empty schema, are both refused', () => {
  assert.throws(() => readback.extract('Here is a shell transcript with nothing in it.'), /no <data-source> or <database> fetch/i)
  assert.throws(
    () => readback.extract(wrapState('{"name":"x","schema":{},"url":"collection://x"}')),
    /empty schema/
  )
})

check('a state with no data source url is refused, not counted around', () => {
  // A url-less state used to be filtered OUT of the one-database check, which
  // is the check it most needed to face.
  assert.throws(
    () => readback.extract(wrapState('{"name":"x","schema":{"Name":{"name":"Name","type":"title"}}}')),
    /no data source url/
  )
})

check('two databases\' saves mixed together are refused, not merged into either', () => {
  const other = DS_FIXTURE.split('facadefa-cade-4000-8000-facadefacade').join('0therdb0-0000-4000-8000-000000000000')
  assert.throws(() => readback.extract([DS_FIXTURE, other]), /different data sources/)
})

check('foreign view evidence is refused: a view proves only the database whose schema is in hand', () => {
  // A state from database A plus a pasted view from database B used to merge
  // cleanly, proving view configuration from the wrong database — worst for
  // the unfiltered Calendar view, which has no row comparison to catch it.
  const foreignView = DB_FIXTURE.split('{{collection://facadefa-cade-4000-8000-facadefacade}}","displayProperties')
    .join('{{collection://0therdb0-0000-4000-8000-000000000000}}","displayProperties')
  assert.throws(() => readback.extract(foreignView), /another database's view|names data source/)
  const orphanView = DB_FIXTURE.replace('"dataSourceUrl":"{{collection://facadefa-cade-4000-8000-facadefacade}}",', '')
  assert.throws(() => readback.extract(orphanView), /no dataSourceUrl/)
})

check('the same view twice is one view when identical and a refusal when it is not', () => {
  const twice = readback.extract([DB_FIXTURE, DB_FIXTURE])
  assert.strictEqual(twice.views.length, 1)
  const conflicting = DB_FIXTURE.replace('"type":"table"}', '"type":"board"}')
  assert.throws(() => readback.extract([DB_FIXTURE, conflicting]), /twice with different content/)
})

// ------------------------------------------------------------- the CLI command

const SCRIPT = path.join(__dirname, '..', 'plugins', 'setup', 'scripts', 'install.js')
const run = args => {
  try {
    return { status: 0, out: execFileSync('node', [SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env } }) }
  } catch (err) {
    return { status: err.status, out: `${err.stdout || ''}${err.stderr || ''}` }
  }
}
const save = (name, value) => {
  const file = path.join(SANDBOX, name)
  fs.writeFileSync(file, value)
  return file
}

const dsFile = save('ds.txt', DS_FIXTURE)
const dbFile = save('db.txt', DB_FIXTURE)

check('readback builds the envelope, prints the counts, and names what is still unread', () => {
  const envelope = path.join(SANDBOX, 'envelope.json')
  const result = run(['readback', envelope, 'software', dsFile, dbFile])
  assert.strictEqual(result.status, 0, result.out)
  assert.ok(/11 properties carrying 6 option values/.test(result.out), 'the counts a person reads against the plan are missing')
  assert.ok(/Still unread: process, memos, projects, tasks, calendar/.test(result.out))
  const written = JSON.parse(fs.readFileSync(envelope, 'utf8'))
  assert.strictEqual(Object.keys(written.databases.software.schema).length, 11)
  assert.strictEqual(written.databases.software.views.length, 1)
})

check('a second database merges into the envelope without losing the first', () => {
  const envelope = path.join(SANDBOX, 'envelope.json')
  const result = run(['readback', envelope, 'calendar', dsFile])
  assert.strictEqual(result.status, 0, result.out)
  const written = JSON.parse(fs.readFileSync(envelope, 'utf8'))
  assert.ok(written.databases.software, 'the first database was lost in the merge')
  assert.ok(written.databases.calendar)
})

check('an unreadable existing envelope is refused and not overwritten', () => {
  const broken = save('broken.json', '{ not json')
  const result = run(['readback', broken, 'software', dsFile])
  assert.notStrictEqual(result.status, 0)
  assert.ok(/not being overwritten/.test(result.out))
  assert.strictEqual(fs.readFileSync(broken, 'utf8'), '{ not json', 'the envelope was clobbered')
})

check('a parseable envelope whose databases entry is the wrong shape is refused, not replaced', () => {
  // Valid JSON with databases as an array used to be silently reset to {},
  // which is exactly the evidence loss the read-before-write guard exists
  // to prevent.
  const damaged = save('damaged.json', '{"databases": ["evidence", "in", "a", "damaged", "form"]}')
  const result = run(['readback', damaged, 'software', dsFile])
  assert.notStrictEqual(result.status, 0)
  assert.ok(/not being overwritten/.test(result.out))
  assert.ok(fs.readFileSync(damaged, 'utf8').includes('"evidence"'), 'the damaged evidence was clobbered')
})

check('an unknown key and missing arguments are refused before anything is read', () => {
  const unknown = run(['readback', path.join(SANDBOX, 'e2.json'), 'crm', dsFile])
  assert.notStrictEqual(unknown.status, 0)
  assert.ok(/not a database this install creates/.test(unknown.out))
  const bare = run(['readback', path.join(SANDBOX, 'e2.json'), 'software'])
  assert.notStrictEqual(bare.status, 0)
  assert.ok(/Usage/.test(bare.out))
})

check('the extracted evidence flows into verify and is compared for real', () => {
  // The probe schema is not the software schema, so a verify over an envelope
  // built purely by extraction must FAIL with real mismatches. This is the
  // end-to-end proof that readback's output is what inspect compares, and
  // that nothing between them quietly passes.
  const envelope = path.join(SANDBOX, 'verify-envelope.json')
  run(['readback', envelope, 'software', dsFile, dbFile])
  const result = run(['verify', envelope])
  assert.notStrictEqual(result.status, 0)
  assert.ok(/Importance/.test(result.out), 'verify never compared the extracted schema: the probe lacks Importance and nothing said so')
  // The probe's own description VALUE quoted back in the mismatch report is
  // something only the comparator reading the extracted schema can produce:
  // it proves the values flow through, where a missing-property line would
  // pass for an empty or fabricated schema too.
  assert.ok(result.out.includes('Put the contract PDF in Google Drive and paste the link here.'),
    'the extracted description value never reached the comparator')
  assert.ok(/option "AE" is missing/.test(result.out),
    'the extracted option lists never reached the comparator')
  assert.ok(/nothing was read back/.test(result.out), 'the five unread databases must be named, not passed')
})

console.log(failures ? `\n${failures} failed.\n` : '\nAll passed.\n')
process.exit(failures ? 1 : 0)

'use strict'

/**
 * Every property in the design documents must exist in schema.js, and nothing
 * may exist in schema.js that the documents do not define.
 *
 * Each plugin's own SCHEMA.md is the definition. schema.js is their machine-readable
 * form, transcribed by hand, and transcription is where things go missing
 * quietly. A field left out does not fail loudly at install: it produces a
 * database that looks right, and the skill that needed that field fails later
 * against a real workspace, on somebody else's install.
 *
 * So this parses the field table out of each document and compares it name by
 * name. It is the same device as the relation map test, applied to the other
 * half of the schema.
 *
 * Relations are excluded on purpose. They are phase B, they live in
 * manifest.js, and the relation map test already covers them.
 *
 * Run: node tests/schema-agrees-with-design.test.js
 */

const fs = require('fs')
const path = require('path')
const assert = require('assert')

const ROOT = path.join(__dirname, '..')
const schema = require(path.join(ROOT, 'plugins/setup/scripts/schema.js'))

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

/**
 * Which document defines which database, and where its field table starts.
 *
 * Projects and Tasks share one document, so each needs the heading its table
 * sits under. Getting this wrong would make the parser read the wrong table and
 * report confident nonsense, which is why the parser asserts it found a
 * plausible number of rows rather than trusting itself.
 */
const SOURCES = {
  process: { file: 'plugins/process/SCHEMA.md' },
  memos: { file: 'plugins/memos/SCHEMA.md' },
  projects: { file: 'plugins/projects/SCHEMA.md', after: '## Part 1: Projects schema' },
  tasks: { file: 'plugins/projects/SCHEMA.md', after: '## Part 2: Tasks schema' },
  software: { file: 'plugins/software/SCHEMA.md' },
  calendar: { file: 'plugins/calendar/SCHEMA.md' }
}

/**
 * Pull the field names out of a document's field table.
 *
 * Returns every row of the first `### Fields` table after the optional anchor,
 * minus the header, the separator, and Software's bold group headings, which are
 * layout rather than fields.
 */
function parseFields (key) {
  const source = SOURCES[key]
  let text = fs.readFileSync(path.join(ROOT, source.file), 'utf8')

  if (source.after) {
    const at = text.indexOf(source.after)
    if (at === -1) throw new Error(`could not find "${source.after}" in ${source.file}`)
    text = text.slice(at)
  }

  const start = text.indexOf('### Fields')
  if (start === -1) throw new Error(`no "### Fields" heading in ${source.file}`)

  const names = []
  for (const line of text.slice(start).split('\n')) {
    if (!line.startsWith('|')) {
      // Stop at the first blank line after rows have started, so the next
      // table in the document is never absorbed into this one.
      if (names.length && line.trim() === '') break
      continue
    }
    const first = line.split('|')[1]
    if (first === undefined) continue
    const name = first.trim()

    if (!name || name === 'Field' || /^-+$/.test(name)) continue
    // Software groups its fields under bold headings that occupy a row.
    if (/^\*\*.*\*\*$/.test(name)) continue

    names.push(name.replace(/`/g, ''))
  }
  return names
}

/**
 * Names that are relations, taken from the manifest rather than guessed.
 *
 * Both sides count: the property on the source and the synced property Notion
 * creates on the target. Neither belongs in schema.js.
 */
const manifest = require(path.join(ROOT, 'plugins/setup/scripts/manifest.js'))
function relationNames (key) {
  const names = new Set()
  for (const r of manifest.RELATIONS) {
    if (r.from === key) names.add(r.property)
    if (r.to === key && r.reverse) names.add(r.reverse)
  }
  return names
}

console.log('\nschema.js agrees with the SCHEMA documents\n')

for (const key of Object.keys(SOURCES)) {
  check(`${schema.DATABASES[key].title}: every non-relation field matches`, () => {
    const documented = parseFields(key)

    assert.ok(documented.length > 3,
      `parsed only ${documented.length} fields out of ${SOURCES[key].file}. The table shape probably changed, and this parser must be fixed rather than left matching almost nothing`)

    const relations = relationNames(key)
    const wanted = documented.filter(n => !relations.has(n))
    const have = schema.DATABASES[key].properties.map(p => p.name)

    const missing = wanted.filter(n => !have.includes(n))
    const extra = have.filter(n => !wanted.includes(n))

    const problems = []
    if (missing.length) problems.push(`in the document and not in schema.js: ${missing.join(', ')}`)
    if (extra.length) problems.push(`in schema.js and not in the document: ${extra.join(', ')}`)

    assert.strictEqual(problems.length, 0, problems.join('\n'))
  })
}

/**
 * Order is checked separately, and only reported, because the document's reading
 * order is for a person and the creation order is for Notion. They usually match
 * and there is no reason they must.
 */
check('property order follows the documents, or the difference is understood', () => {
  const notes = []
  for (const key of Object.keys(SOURCES)) {
    const relations = relationNames(key)
    const wanted = parseFields(key).filter(n => !relations.has(n))
    const have = schema.DATABASES[key].properties.map(p => p.name)
    if (wanted.join('|') !== have.join('|')) {
      notes.push(`${schema.DATABASES[key].title}: order differs from the document`)
    }
  }
  if (notes.length) console.log(`        note: ${notes.join('; ')}`)
})

console.log(failures === 0
  ? `\nAll checks passed. ${Object.keys(SOURCES).length} databases checked against their documents.\n`
  : `\n${failures} check(s) failed.\n`)

process.exit(failures === 0 ? 0 : 1)

'use strict'

/**
 * Tests for ingest: the CSV parser, the header mapping, the normalisers, and
 * the Notion entry shape.
 *
 * The refusal cases each assert the message names the problem, because the
 * message is the remedy: removing any of these guards turns its case red,
 * which is how each one was proved while this file was written.
 *
 * Run: node tests/import-leads-ingest.test.js
 */

const assert = require('assert')

const ingest = require('../plugins/import-leads/scripts/ingest')

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

console.log('\nimport-leads ingest\n')

// ------------------------------------------------------------ the CSV parser

check('a BOM is stripped, so the first header is not a stranger', () => {
  const records = ingest.parseCsv('﻿Email,First Name\na@b.com,Ada\n')
  assert.strictEqual(records[0][0], 'Email')
})

check('quoted fields carry commas, newlines and doubled quotes', () => {
  const records = ingest.parseCsv('Name,Notes\n"Lovelace, Ada","She said ""hello""\non two lines"\n')
  assert.strictEqual(records[1][0], 'Lovelace, Ada')
  assert.strictEqual(records[1][1], 'She said "hello"\non two lines')
})

check('CRLF endings parse the same as LF', () => {
  const records = ingest.parseCsv('A,B\r\n1,2\r\n')
  assert.deepStrictEqual(records, [['A', 'B'], ['1', '2']])
})

check('a file ending inside a quote is refused: half a list must not import as a whole one', () => {
  assert.throws(() => ingest.parseCsv('A,B\n"unterminated,2\n'), /ends inside a quoted field/)
})

check('blank lines are skipped rather than becoming all-blank rows', () => {
  const records = ingest.parseCsv('A,B\n1,2\n\n3,4\n')
  assert.strictEqual(records.length, 3)
})

// -------------------------------------------------------------- the headers

check('a duplicate header is refused: two columns with one name collapse into one field', () => {
  assert.throws(() => ingest.ingestCsv('Email,Email\na@b.com,c@d.com\n', null), /header of two columns/)
})

check('an empty header is refused', () => {
  assert.throws(() => ingest.ingestCsv('Email,\na@b.com,x\n', null), /empty header/)
})

check('a ragged row is refused by row number, never padded or truncated', () => {
  assert.throws(() => ingest.ingestCsv('A,B\n1,2,3\n', null), /row 1: 3 cells against 2 headers/)
})

// -------------------------------------------------------------- the mapping

check('the proposal maps common spellings and reports the unmapped by name', () => {
  const result = ingest.ingestCsv('First Name,LAST_NAME,Work Email,Job Title,Company Name,Shoe Size\nAda,Lovelace,a@b.com,Countess,Analytical Engines,7\n', null)
  assert.strictEqual(result.decided, false)
  assert.deepStrictEqual(result.proposal.mapping, {
    'First Name': 'firstName',
    LAST_NAME: 'lastName',
    'Work Email': 'email',
    'Job Title': 'title',
    'Company Name': 'company'
  })
  assert.deepStrictEqual(result.proposal.unmapped, ['Shoe Size'])
})

check('two headers proposing one field come back as an ambiguity, not a silent winner', () => {
  const result = ingest.ingestCsv('Email,Work Email\na@b.com,c@d.com\n', null)
  assert.ok(result.proposal.ambiguous.email, 'the ambiguity has to be presented')
  assert.deepStrictEqual(result.proposal.ambiguous.email.sort(), ['Email', 'Work Email'])
})

check('a confirmed mapping naming a missing column, an unknown field, or one field twice is refused', () => {
  const csv = 'Email,Other\na@b.com,x\n'
  assert.throws(() => ingest.ingestCsv(csv, { Ghost: 'email' }), /no such column/)
  assert.throws(() => ingest.ingestCsv(csv, { Email: 'shoeSize' }), /not a field this plugin carries/)
  assert.throws(() => ingest.ingestCsv(csv, { Email: 'email', Other: 'email' }), /cannot come from two columns/)
})

// ------------------------------------------------------------------ the rows

check('rows keep the source untouched, fill only what the mapping found, and stamp every fill as list', () => {
  const result = ingest.ingestCsv('First Name,Email,Extra\nAda,ADA@Example.COM,keep me\n', { 'First Name': 'firstName', Email: 'email' })
  assert.strictEqual(result.decided, true)
  const row = result.rows[0]
  assert.strictEqual(row.index, 1)
  assert.strictEqual(row.source.Extra, 'keep me')
  assert.strictEqual(row.source.Email, 'ADA@Example.COM', 'the source keeps the original spelling for the writeback')
  assert.strictEqual(row.fields.email, 'ada@example.com', 'the canonical email is lowercased, because the dedupe key is case-insensitive')
  assert.strictEqual(row.fieldSources.email, 'list')
  assert.ok(!('phone' in row.fields), 'a blank stays blank rather than becoming an empty value')
  assert.deepStrictEqual(result.unmapped, ['Extra'])
})

check('phones normalise to digits with a kept leading plus, and the original stays on source', () => {
  assert.strictEqual(ingest.normalisePhone('+1 (555) 010-2030'), '+15550102030')
  assert.strictEqual(ingest.normalisePhone('555.010.2030'), '5550102030')
  assert.strictEqual(ingest.normalisePhone('ext'), '')
})

// ---------------------------------------------------------------- Notion rows

check('Notion entries need pageId and columns, refused by entry number otherwise', () => {
  assert.throws(() => ingest.ingestNotionRows([{ columns: { Email: 'a@b.com' } }], null), /Entries 1 are not/)
  assert.throws(() => ingest.ingestNotionRows({ not: 'an array' }, null), /needs an array/)
})

check('Notion rows map like CSV rows and carry their pageId for the writeback', () => {
  const entries = [
    { pageId: 'page-1', columns: { Email: 'a@b.com', 'First Name': 'Ada' } },
    { pageId: 'page-2', columns: { Email: 'c@d.com' } }
  ]
  const result = ingest.ingestNotionRows(entries, { Email: 'email', 'First Name': 'firstName' })
  assert.strictEqual(result.rows[0].notionPageId, 'page-1')
  assert.strictEqual(result.rows[0].fields.firstName, 'Ada')
  assert.strictEqual(result.rows[1].notionPageId, 'page-2')
  assert.ok(!('firstName' in result.rows[1].fields), 'a column absent from one entry is blank on that row, not an error')
})

console.log(failures ? `\n${failures} failed.\n` : '\nAll checks passed.\n')
process.exit(failures ? 1 : 0)

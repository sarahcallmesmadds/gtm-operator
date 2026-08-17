'use strict'

/**
 * The manifest and the design documents must say the same thing.
 *
 * This test exists because of what three review rounds found. Round 1 found
 * twelve problems, round 2 found fourteen, and round 3 found seventeen, of
 * which eleven were the same shape: a fix landed in one place and an older
 * sentence somewhere else still described what it replaced. Not one fix was
 * wrong. The sweep after the fix is what kept failing.
 *
 * The design documents are prose and will keep being edited by hand. The
 * manifest is code and will be edited by hand too. Nothing but a test can hold
 * them together, and a review round is an expensive way to find a number that
 * grep would have caught.
 *
 * So this parses the relation map out of SKILLS-setup.md and compares it to
 * manifest.js, row by row. If somebody adds a relation to one and not the
 * other, this fails and names which.
 *
 * Run: node tests/manifest-agrees-with-design.test.js
 */

const fs = require('fs')
const path = require('path')
const assert = require('assert')

const ROOT = path.join(__dirname, '..')
const manifest = require(path.join(ROOT, 'plugins/setup/scripts/manifest.js'))

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

const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8')

/**
 * Pull the relation map table out of SKILLS-setup.md.
 *
 * The table is the design's manifest and it is the row this parser trusts. If
 * the table's shape changes, this parser should fail loudly rather than
 * quietly matching nothing, so it asserts it found rows at all. A parser that
 * silently finds zero rows and reports success is the exact failure mode the
 * reviews kept naming: a check that passes without checking.
 */
function parseRelationMap () {
  const text = read('SKILLS-setup.md')
  const rows = []
  for (const line of text.split('\n')) {
    // | 4 | A memo to what it is about | Memos | `Artifacts` | `Memos` | Two-way |
    const m = line.match(/^\|\s*(\d+)\s*\|([^|]+)\|([^|]+)\|([^|]+)\|([^|]+)\|([^|]+)\|/)
    if (!m) continue
    const cell = s => s.trim().replace(/`/g, '')
    rows.push({
      n: Number(m[1]),
      what: cell(m[2]),
      source: cell(m[3]),
      property: cell(m[4]),
      reverse: cell(m[5]),
      kind: cell(m[6])
    })
  }
  return rows
}

const TITLE_TO_KEY = new Map(manifest.DATABASES.map(d => [d.title, d.key]))

console.log('\nmanifest.js agrees with the design documents\n')

const designRelations = parseRelationMap()

check('the relation map was found and parsed', () => {
  assert.ok(designRelations.length > 0,
    'parsed no rows out of the relation map in SKILLS-setup.md. The table shape probably changed, and this parser must be fixed rather than left matching nothing')
})

check('the design and the manifest hold the same number of relations', () => {
  assert.strictEqual(designRelations.length, manifest.counts.relations,
    `SKILLS-setup.md has ${designRelations.length} relations, manifest.js has ${manifest.counts.relations}`)
})

check('every relation matches row for row', () => {
  const problems = []
  for (const row of designRelations) {
    const mine = manifest.RELATIONS.find(r => r.n === row.n)
    if (!mine) { problems.push(`relation ${row.n} is in the design and not in the manifest`); continue }

    const sourceKey = TITLE_TO_KEY.get(row.source)
    if (!sourceKey) problems.push(`relation ${row.n}: design names source "${row.source}", which is not a database title in the manifest`)
    else if (sourceKey !== mine.from) problems.push(`relation ${row.n}: design says source ${row.source}, manifest says ${mine.from}`)

    if (row.property !== mine.property) problems.push(`relation ${row.n}: design says property ${row.property}, manifest says ${mine.property}`)

    const designReverse = /^none$/i.test(row.reverse) ? null : row.reverse
    if (designReverse !== mine.reverse) problems.push(`relation ${row.n}: design says reverse ${designReverse}, manifest says ${mine.reverse}`)

    const designOneWay = /one-way/i.test(row.kind)
    if (designOneWay !== (mine.kind === 'one-way')) problems.push(`relation ${row.n}: design says "${row.kind}", manifest says ${mine.kind}`)

    const designSelf = /self/i.test(row.kind)
    if (designSelf !== mine.self) problems.push(`relation ${row.n}: design says "${row.kind}", manifest self is ${mine.self}`)
  }
  assert.strictEqual(problems.length, 0, problems.join('\n'))
})

check('the manifest is internally consistent', () => {
  const problems = manifest.validate()
  assert.strictEqual(problems.length, 0, problems.join('\n'))
})

/**
 * A count written in prose must agree with the manifest.
 *
 * Six counts went stale across review rounds 2 and 3, every one a number
 * written in a sentence beside the thing it counted. The tempting check is to
 * ban the habit outright, and the first version of this test did exactly that.
 * It failed on seven lines, five of which were fine: "a two-way relation is ONE
 * relation with a synced property" is explaining a concept, not counting
 * anything.
 *
 * A check that cries wolf five times out of seven is a check people learn to
 * skip, which makes it worse than no check. So this one reads the number and
 * fails only when it disagrees with what the manifest derives.
 *
 * That was still not enough. "A two-way relation is one relation with a synced
 * property" counts nothing, and neither does "the one database whose default
 * table view is useless", but both match a pattern looking for a number beside
 * a noun. English uses the same word for a quantity and for an indefinite
 * article, and no regex is going to separate them reliably.
 *
 * Two limits, both stated rather than hidden, because a check whose gaps are
 * undocumented reads as covering more than it does:
 *
 * 1. IT SKIPS THE WORD "ONE". English uses "one" as both a quantity and an
 *    indefinite article, and the article is the common case here: "a two-way
 *    relation is one relation with a synced property" counts nothing. No
 *    remaining number word has that problem. The cost is that a genuine count
 *    of one goes unchecked, which is a small loss: the counts that actually
 *    went stale were nine, three, four and eleven, and a total dropping to one
 *    is not the failure this guards against.
 *
 * 2. IT CHECKS DOCUMENTATION AND DESCRIPTIONS ONLY, not JavaScript comments.
 *    A stale count inside a .js comment will not be caught. Every count that
 *    went stale across three review rounds was in a document or a description,
 *    where a number means how many there are.
 */
const NUMBER_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14
}

check('every count written in prose agrees with the manifest', () => {
  const NOUNS = {
    database: 'databases', databases: 'databases',
    relation: 'relations', relations: 'relations',
    view: 'views', views: 'views'
  }
  // "one" is excluded: it is an indefinite article far more often than a count.
  // See the note above. Digits are kept, including 1, because "1 relation"
  // written as a digit is a count and never an article.
  const words = Object.keys(NUMBER_WORDS).filter(w => w !== 'one')
  const pattern = new RegExp(
    `\\b(${words.join('|')}|\\d+)[- ](databases?|relations?|views?)\\b`, 'gi')

  const problems = []
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => {
    const p = path.join(d, e.name)
    return e.isDirectory() ? walk(p) : [p]
  })

  for (const file of walk(path.join(ROOT, 'plugins'))) {
    // Documentation and descriptions only. See the note above: JavaScript
    // comments explain concepts, and "one relation with a synced property" is
    // not a count of anything.
    if (!/\.(md|json)$/.test(file)) continue
    const rel = path.relative(ROOT, file)
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      // An explicit note that a number is historical, e.g. a count that used to
      // be wrong. Without this, describing the bug becomes the bug.
      if (/\[was\]/.test(line)) continue
      for (const hit of line.matchAll(pattern)) {
        const word = hit[1].toLowerCase()
        const said = NUMBER_WORDS[word] !== undefined ? NUMBER_WORDS[word] : Number(word)
        const actual = manifest.counts[NOUNS[hit[2].toLowerCase()]]
        if (said !== actual) {
          problems.push(`${rel}: says "${hit[0]}", the manifest derives ${actual}\n    ${line.trim().slice(0, 90)}`)
        }
      }
    }
  }
  assert.strictEqual(problems.length, 0,
    `a count in prose disagrees with the manifest, which is how six counts went stale across two review rounds:\n${problems.join('\n')}`)
})

/**
 * The summary output must agree with the manifest it summarises.
 *
 * This closes the gap the check above documents. That check skips .js, so a
 * hardcoded number inside the summary printer is invisible to it, and that is
 * not hypothetical: while proving the drift checks worked, a stray edit
 * replaced a derived count in the printer with a literal 5. Every documented
 * check passed and the plugin printed "Databases (5)" for six databases.
 *
 * The lesson is not that the earlier gap was unacceptable. It is that the fix
 * for a gap in a text-scanning check is a check on behaviour, not a wider
 * regex. So this runs the command a user actually sees and reads the numbers
 * back out of its output.
 */
check('the --summary output agrees with the manifest', () => {
  const { execFileSync } = require('child_process')
  const out = execFileSync('node',
    [path.join(ROOT, 'plugins/setup/scripts/manifest.js'), '--summary'],
    { encoding: 'utf8' })

  const grab = (label) => {
    const m = out.match(new RegExp(`${label} \\((\\d+)\\)`))
    assert.ok(m, `--summary printed no "${label} (n)" line, so this test is checking nothing. Fix the test or the output.`)
    return Number(m[1])
  }

  assert.strictEqual(grab('Databases'), manifest.counts.databases, 'the summary disagrees with the manifest on databases')
  assert.strictEqual(grab('Relations'), manifest.counts.relations, 'the summary disagrees with the manifest on relations')
  assert.strictEqual(grab('Database-level views'), manifest.counts.views, 'the summary disagrees with the manifest on views')
  assert.strictEqual(grab('Rules Notion will not enforce'), manifest.counts.rules, 'the summary disagrees with the manifest on rules')

  // Every relation in the manifest must appear as a numbered line.
  for (const r of manifest.RELATIONS) {
    const line = new RegExp(`^\\s*${r.n}\\. `, 'm')
    assert.ok(line.test(out), `--summary printed no line for relation ${r.n}`)
  }
})

console.log(failures === 0
  ? `\nAll checks passed. ${manifest.counts.relations} relations, ${manifest.counts.databases} databases, ${manifest.counts.views} views, ${manifest.counts.rules} rules.\n`
  : `\n${failures} check(s) failed.\n`)

process.exit(failures === 0 ? 0 : 1)

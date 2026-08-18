'use strict'

/**
 * Every source file in this repository can be searched.
 *
 * A single NUL byte anywhere in a file makes `grep` treat it as binary, and a
 * binary file is skipped SILENTLY: no match, no warning, exit 0. `rg` does the
 * same. So a search that should have found something reports nothing and looks
 * exactly like a search that found nothing.
 *
 * That happened here. `plugins/setup/scripts/schema.js` compared option order
 * by joining two lists on a literal NUL, which was chosen because no option
 * name can contain one. The reasoning was sound and the cost was that 658 lines
 * were invisible to every repository-wide search for months, including the
 * searches used to review changes to that very file.
 *
 * This is the guard. It reads bytes, not text, because a reader that decodes
 * first can normalise away the thing being looked for.
 *
 * Run: node tests/sources-are-searchable.test.js
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const SKIP = new Set(['.git', '.bak', '.devin-review', 'node_modules'])
const READ = new Set(['.js', '.json', '.md', '.sh', '.yml', '.yaml'])

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

function sourceFiles (directory = ROOT, found = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) sourceFiles(full, found)
    else if (READ.has(path.extname(entry.name))) found.push(full)
  }
  return found
}

console.log('\nevery source file can be searched\n')

check('the walk finds the files it is supposed to be checking', () => {
  // Asserted before the NUL check below, because that check passes over an
  // empty list just as well as over a clean repository, and the two mean
  // opposite things. This is the shape that has been found twelve times here.
  const files = sourceFiles()
  const names = files.map(f => path.relative(ROOT, f))
  if (!names.includes('plugins/setup/scripts/schema.js')) {
    throw new Error(`the walk missed schema.js, which is the file this test exists for. It found ${names.length}:\n  ${names.slice(0, 10).join('\n  ')}`)
  }
  if (names.length < 20) {
    throw new Error(`only ${names.length} files were walked, which is fewer than this repository has. The walk is skipping something.`)
  }
})

check('no source file contains a NUL byte', () => {
  const guilty = []
  for (const file of sourceFiles()) {
    const bytes = fs.readFileSync(file)
    const at = bytes.indexOf(0)
    if (at !== -1) {
      const line = bytes.subarray(0, at).toString('utf8').split('\n').length
      guilty.push(`${path.relative(ROOT, file)}, line ${line}`)
    }
  }
  if (guilty.length) {
    throw new Error(
      `these files hold a NUL byte, so grep and rg skip them without saying so:\n  ${guilty.join('\n  ')}\n` +
      `  Anything comparing strings by joining them on a NUL should compare element by element instead.`
    )
  }
})

if (failures) {
  console.log(`\n${failures} failed.\n`)
  process.exit(1)
}
console.log('\nAll checks passed.\n')

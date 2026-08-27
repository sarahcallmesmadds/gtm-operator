'use strict'

/**
 * Every vendored copy matches the shared source it came from.
 *
 * `plugins/setup/SKILLS.md` build risk 3 decided that the shared code cannot be shared
 * by requiring it, because Claude Code has no dependency resolution between
 * plugins, and that the workable version is one source in this repository
 * copied into each plugin with a test that fails when a copy has drifted.
 * `scripts/vendor.js` does the copying. This is the test.
 *
 * WHAT IT PROTECTS AGAINST. Somebody fixes a bug in a plugin's copy, the source
 * keeps the bug, the next vendor run reverts the fix. Or the source is fixed and
 * the copies are not, so the installed plugins keep the bug that was fixed. Both
 * are silent, which is why this is a test and not a convention.
 *
 * PROVED BY BREAKING IT, 2026-08-19: appending a line to
 * `plugins/calendar/scripts/vendor/config-read.js` turns this red, and running
 * `node scripts/vendor.js` turns it green again.
 *
 * Run: node tests/vendor-copies-current.test.js
 */

const fs = require('fs')
const assert = require('assert')

const path = require('path')
const { wanted, undeclared, expected } = require('../scripts/vendor')

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

console.log('\nvendored copies are current\n')

const items = wanted()

// Counted as well as looped. A version of this that only walked the list would
// pass on a repository where nothing is declared for vendoring at all, which is
// exactly what a broken manifest read looks like.
check('at least one plugin declares something to vendor', () => {
  assert.ok(items.length >= 1, 'no plugin declares gtmOperator.vendor, so this test proves nothing')
})

for (const item of items) {
  check(`${item.plugin}: scripts/vendor/${item.name} exists`, () => {
    assert.ok(
      fs.existsSync(item.target),
      `${item.plugin} asks for ${item.name} and has no copy of it. Run: node scripts/vendor.js`
    )
  })

  if (!fs.existsSync(item.target)) continue

  check(`${item.plugin}: scripts/vendor/${item.name} matches shared/${item.name}`, () => {
    assert.strictEqual(
      fs.readFileSync(item.target, 'utf8'),
      expected(item.source, item.name),
      `the copy has drifted from the source. Run: node scripts/vendor.js\n` +
      `  If the copy holds a fix the source does not, move the fix to shared/${item.name} first: the vendor run overwrites the copy.`
    )
  })

  check(`${item.plugin}: scripts/vendor/${item.name} says it is generated`, () => {
    const text = fs.readFileSync(item.target, 'utf8')
    assert.ok(
      text.startsWith('// GENERATED FILE. DO NOT EDIT.'),
      'the copy does not open with the generated-file warning, so somebody opening it has no way to know an edit will be reverted'
    )
  })
}

// -------------------------------------------------- the reverse direction

check('no vendored file sits in a plugin that stopped declaring it', () => {
  // Every check above stays green when a name is REMOVED from a manifest: the
  // old copy stays on disk, still imported at runtime, and covered by nothing.
  // Silently unmanaged is the state this mechanism exists to prevent, reached
  // from the other side.
  assert.deepStrictEqual(
    undeclared().map(o => `${o.plugin}/scripts/vendor/${o.name}`),
    [],
    'these files are vendored and no plugin declares them. Either put the name back in that plugin\'s gtmOperator.vendor, or delete the file.'
  )
})

check('every vendored file a plugin imports is one it declares', () => {
  // A plugin can require a vendored file it never declared. That works on this
  // machine, where the file happens to be there, and breaks on a clean checkout
  // where the vendor run never creates it.
  const declared = new Set(wanted().map(i => `${i.plugin}/${i.name}`))
  const problems = []
  const pluginsDir = path.join(__dirname, '..', 'plugins')

  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== 'vendor') walk(full)
        continue
      }
      if (!entry.name.endsWith('.js')) continue
      const after = full.split(`${path.sep}plugins${path.sep}`)[1]
      if (!after) continue
      const plugin = after.split(path.sep)[0]
      const text = fs.readFileSync(full, 'utf8')
      const pattern = /['"]vendor['"],\s*['"]([\w.-]+)['"]/g
      let match
      while ((match = pattern.exec(text)) !== null) {
        const name = match[1].endsWith('.js') ? match[1] : `${match[1]}.js`
        if (!declared.has(`${plugin}/${name}`)) {
          problems.push(`${plugin} imports vendor/${name} and does not declare it`)
        }
      }
    }
  }

  if (fs.existsSync(pluginsDir)) walk(pluginsDir)
  assert.deepStrictEqual(problems, [])
})

/**
 * PROVED BY BREAKING, 2026-08-19:
 *
 *   appending a line to plugins/calendar/scripts/vendor/config-read.js
 *     red: the copy matches its source
 *   removing "page-id.js" from calendar's gtmOperator.vendor
 *     red: no vendored file sits in a plugin that stopped declaring it,
 *          and every vendored file a plugin imports is one it declares
 */

console.log(failures ? `\n${failures} failed.\n` : `\nAll checks passed.\n`)
process.exit(failures ? 1 : 0)

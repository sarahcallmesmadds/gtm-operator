'use strict'

/**
 * The two files that name a plugin's version have to agree.
 *
 * `plugins/<name>/.claude-plugin/plugin.json` is what the plugin says it is, and
 * the entry for it in `.claude-plugin/marketplace.json` is what the marketplace
 * says it is. Both are hand-edited and nothing held them together, so a bump
 * applied to one and not the other would ship a marketplace advertising a
 * version that the plugin does not claim.
 *
 * This is the same rule `CLAUDE.md` already states for counts: a value written
 * beside the thing it names is a copy, and copies drift. There is no single
 * source to derive from here, because both files are read by something outside
 * this repository and neither can import the other, so a test is the only thing
 * that can hold them together.
 *
 * It walks the marketplace entries rather than naming `setup`, so a second
 * plugin is covered on the day it is added rather than on the day somebody
 * remembers this file.
 *
 * Run: node tests/manifests-agree.test.js
 */

const fs = require('fs')
const path = require('path')
const assert = require('assert')

const ROOT = path.join(__dirname, '..')
const marketplace = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin/marketplace.json'), 'utf8'))

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

console.log('\nthe marketplace and each plugin agree\n')

// Counted, not only looped. A version of this that walked the list and asserted
// nothing else would pass on an empty or truncated marketplace file, which is
// the failure it is most likely to be asked about.
check('the marketplace lists at least one plugin', () => {
  assert.ok(Array.isArray(marketplace.plugins), 'marketplace.json has no plugins array')
  assert.ok(marketplace.plugins.length >= 1, 'marketplace.json lists no plugins')
})

for (const entry of marketplace.plugins) {
  const manifestPath = path.join(ROOT, entry.source, '.claude-plugin/plugin.json')

  check(`${entry.name}: the marketplace source points at a plugin manifest`, () => {
    assert.ok(fs.existsSync(manifestPath), `${entry.source} has no .claude-plugin/plugin.json`)
  })

  if (!fs.existsSync(manifestPath)) continue
  const plugin = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))

  check(`${entry.name}: both files name the same version`, () => {
    assert.ok(entry.version, `the marketplace entry for ${entry.name} has no version`)
    assert.ok(plugin.version, `${manifestPath} has no version`)
    assert.strictEqual(
      entry.version,
      plugin.version,
      `the marketplace advertises ${entry.version} and the plugin claims ${plugin.version}. A bump reached one file and not the other.`
    )
  })

  check(`${entry.name}: both files name the same plugin`, () => {
    assert.strictEqual(entry.name, plugin.name, 'the marketplace entry and the plugin manifest disagree about the name')
  })
}

console.log(failures ? `\n${failures} failed.\n` : `\nAll checks passed. ${marketplace.plugins.length} plugin.\n`)
process.exit(failures ? 1 : 0)

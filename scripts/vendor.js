'use strict'

/**
 * Copy the shared sources into every plugin that declares it needs them.
 *
 * WHY THIS EXISTS. `SKILLS-setup.md` build risk 3: the Notion and config code
 * cannot literally be shared across plugins, because Claude Code has no
 * dependency resolution between them and a skill's scripts resolve inside its
 * own plugin. The decision recorded there is one source in this repository,
 * copied into each plugin, with a test that fails when a copy has drifted.
 * This is the copying half. `tests/vendor-copies-current.test.js` is the other.
 *
 * WHICH PLUGINS GET WHAT is declared by the plugin, in `.claude-plugin/
 * plugin.json` under `gtmOperator.vendor`, rather than listed here. A list here
 * is a second place to remember, and the plugin that forgets to be added is the
 * one that ships without the file it needs.
 *
 *   "gtmOperator": { "vendor": ["config-read.js"] }
 *
 * Usage:
 *   node scripts/vendor.js          copy, and report what changed
 *   node scripts/vendor.js --check  change nothing, exit non-zero if stale
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const SHARED = path.join(ROOT, 'shared')
const PLUGINS = path.join(ROOT, 'plugins')

/**
 * The header stamped onto every copy.
 *
 * It names the source and the script, because the person who finds one of these
 * is usually the person about to edit it, and the edit is the mistake. The test
 * would catch it, which is a slower and more confusing way to be told.
 */
function header (name) {
  return [
    '// GENERATED FILE. DO NOT EDIT.',
    `// Copied from shared/${name} by scripts/vendor.js.`,
    '// Edit the source and re-run that script. An edit here is reverted by the',
    '// next run and reported as drift by tests/vendor-copies-current.test.js.',
    ''
  ].join('\n')
}

/** What each plugin asked for, read from its own manifest. */
function wanted () {
  if (!fs.existsSync(PLUGINS)) return []
  const out = []
  for (const plugin of fs.readdirSync(PLUGINS).sort()) {
    const manifestPath = path.join(PLUGINS, plugin, '.claude-plugin', 'plugin.json')
    if (!fs.existsSync(manifestPath)) continue

    let manifest
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    } catch (error) {
      throw new Error(`${plugin}: its plugin.json will not parse, so what it wants vendored cannot be read: ${error.message}`)
    }

    const names = (manifest.gtmOperator && manifest.gtmOperator.vendor) || []
    if (!Array.isArray(names)) {
      throw new Error(`${plugin}: gtmOperator.vendor has to be a list of file names, and it is ${JSON.stringify(names)}`)
    }

    for (const name of names) {
      // A NAME, NEVER A PATH. `../` in a manifest entry would otherwise escape
      // both `shared/` and the plugin's `scripts/vendor/`, and this script
      // writes files, so the normal command could overwrite something
      // unintended. Checked before anything is resolved, and the resolved paths
      // are checked again below in case a future name form gets past this.
      if (typeof name !== 'string' || !/^[A-Za-z0-9._-]+\.js$/.test(name) || name.startsWith('.')) {
        throw new Error(
          `${plugin}: "${name}" is not a usable name for a vendored file. ` +
          `Use a plain file name ending in .js, with no directory part.`
        )
      }

      const source = path.join(SHARED, name)
      const target = path.join(PLUGINS, plugin, 'scripts', 'vendor', name)
      const vendorRoot = path.join(PLUGINS, plugin, 'scripts', 'vendor')

      if (path.dirname(source) !== SHARED || path.dirname(target) !== vendorRoot) {
        throw new Error(`${plugin}: "${name}" resolves outside the directories this script may touch.`)
      }

      // A plugin asking for a file that does not exist is a typo, and it fails
      // here rather than shipping a plugin missing the thing it declared.
      if (!fs.existsSync(source)) {
        throw new Error(`${plugin} asks for shared/${name} and there is no such file. Known: ${fs.readdirSync(SHARED).join(', ')}`)
      }
      out.push({ plugin, name, source, target })
    }
  }
  return out
}

/** What the copy should contain, given what the source contains now. */
function expected (source, name) {
  return header(name) + fs.readFileSync(source, 'utf8')
}

function run ({ check }) {
  const items = wanted()
  if (!items.length) {
    console.log('Nothing to vendor: no plugin declares gtmOperator.vendor.')
    return 0
  }

  const stale = []
  for (const item of items) {
    const want = expected(item.source, item.name)
    const have = fs.existsSync(item.target) ? fs.readFileSync(item.target, 'utf8') : null

    if (have === want) {
      if (!check) console.log(`  same    ${item.plugin}/scripts/vendor/${item.name}`)
      continue
    }

    stale.push(item)
    if (check) {
      console.log(`  STALE   ${item.plugin}/scripts/vendor/${item.name}${have === null ? ' (missing)' : ''}`)
      continue
    }

    fs.mkdirSync(path.dirname(item.target), { recursive: true })
    fs.writeFileSync(item.target, want)
    console.log(`  ${have === null ? 'created' : 'updated'} ${item.plugin}/scripts/vendor/${item.name}`)
  }

  if (check && stale.length) {
    console.log(`\n${stale.length} vendored ${stale.length === 1 ? 'copy is' : 'copies are'} not current. Run: node scripts/vendor.js`)
    return 1
  }
  if (check) console.log('Every vendored copy is current.')
  return 0
}

if (require.main === module) {
  try {
    process.exit(run({ check: process.argv.includes('--check') }))
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}

/**
 * Vendored files sitting in a plugin that no longer declares them.
 *
 * THE REVERSE OF `wanted`, and it exists because removing a name from a
 * manifest leaves the old copy on disk, still imported at runtime and no longer
 * covered by anything. The forward check stays green because the remaining
 * declarations are all current, so the file quietly becomes unmanaged: exactly
 * the drift this mechanism was built to stop, arriving from the other side.
 */
function undeclared () {
  const declared = new Set(wanted().map(item => item.target))
  const out = []
  if (!fs.existsSync(PLUGINS)) return out
  for (const plugin of fs.readdirSync(PLUGINS).sort()) {
    const dir = path.join(PLUGINS, plugin, "scripts", "vendor")
    if (!fs.existsSync(dir)) continue
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name)
      if (!declared.has(full)) out.push({ plugin, name, target: full })
    }
  }
  return out
}

module.exports = { wanted, undeclared, expected, header }

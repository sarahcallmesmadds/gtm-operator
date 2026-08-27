'use strict'

/**
 * The component tabs in Claude are derived from files in each plugin package.
 * A marketplace description cannot make a missing agent or connector visible,
 * so this test checks the files that actually populate those tabs.
 *
 * The connector sets are intentionally exact. A missing connector hides a tool
 * the plugin expects; an extra connector asks the user to authorize a service
 * the plugin never uses. Both are product defects, not cosmetic differences.
 *
 * Run: node tests/plugin-components.test.js
 */

const fs = require('fs')
const path = require('path')
const assert = require('assert')

const ROOT = path.join(__dirname, '..')
const marketplace = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin/marketplace.json'), 'utf8'))

const ENDPOINTS = {
  notion: 'https://mcp.notion.com/mcp',
  atlassian: 'https://mcp.atlassian.com/v1/mcp/authv2',
  box: 'https://mcp.box.com',
  granola: 'https://mcp.granola.ai/mcp'
}

const EXPECTED = {
  setup: ['notion'],
  calendar: ['notion'],
  process: ['notion', 'atlassian', 'box', 'granola'],
  memos: ['notion', 'granola'],
  projects: ['notion', 'granola'],
  software: ['notion', 'box'],
  'import-leads': ['notion']
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

console.log('\nplugin component files match the product surface\n')

check('the expected connector map covers every marketplace plugin and nothing else', () => {
  const listed = marketplace.plugins.map(p => p.name).sort()
  const expected = Object.keys(EXPECTED).sort()
  assert.deepStrictEqual(expected, listed,
    'EXPECTED must change with marketplace.json so a new plugin cannot ship without a connector decision')
})

for (const entry of marketplace.plugins) {
  const pluginRoot = path.join(ROOT, entry.source)
  const mcpPath = path.join(pluginRoot, '.mcp.json')
  const docsPath = path.join(pluginRoot, 'CONNECTORS.md')

  check(`${entry.name}: a connector manifest and user-facing inventory both ship`, () => {
    assert.ok(fs.existsSync(mcpPath), `${path.relative(ROOT, mcpPath)} is missing`)
    assert.ok(fs.existsSync(docsPath), `${path.relative(ROOT, docsPath)} is missing`)
  })

  if (!fs.existsSync(mcpPath)) continue
  const config = JSON.parse(fs.readFileSync(mcpPath, 'utf8'))

  check(`${entry.name}: connector names and endpoints are exact`, () => {
    assert.ok(config.mcpServers && typeof config.mcpServers === 'object', '.mcp.json has no mcpServers object')
    const actual = Object.keys(config.mcpServers).sort()
    const expected = EXPECTED[entry.name].slice().sort()
    assert.deepStrictEqual(actual, expected,
      `expected ${expected.join(', ')}, found ${actual.join(', ')}`)

    for (const connector of expected) {
      assert.strictEqual(config.mcpServers[connector].type, 'http', `${connector} is not an HTTP server`)
      assert.strictEqual(config.mcpServers[connector].url, ENDPOINTS[connector], `${connector} has the wrong endpoint`)
    }
  })
}

const agentPath = path.join(ROOT, 'plugins/process/agents/process-maintainer.md')

check('process ships the maintainer agent that the product promises', () => {
  assert.ok(fs.existsSync(agentPath), 'plugins/process/agents/process-maintainer.md is missing')
  const text = fs.readFileSync(agentPath, 'utf8')
  const frontmatter = text.match(/^---\n([\s\S]*?)\n---\n/)
  assert.ok(frontmatter, 'the agent has no YAML frontmatter')
  assert.match(frontmatter[1], /^name:\s*process-maintainer$/m)
  assert.match(frontmatter[1], /^description:\s*>$/m)
  assert.match(frontmatter[1], /^model:\s*sonnet$/m)
  assert.match(frontmatter[1], /^maxTurns:\s*25$/m)

  for (const skill of ['find', 'audit', 'backfill', 'update', 'new']) {
    assert.match(text, new RegExp(`process:${skill}\\b`), `the agent never routes to process:${skill}`)
  }
  assert.match(text, /never creates or\s+changes an artifact without the confirmation/i,
    'the agent description does not expose the write boundary')
  assert.match(text, /Never run unattended/,
    'the agent does not carry the Process library\'s unattended-run boundary')
})

console.log(failures ? `\n${failures} failed.\n` : `\nAll checks passed. ${marketplace.plugins.length} plugin.\n`)
process.exit(failures ? 1 : 0)

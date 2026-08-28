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
  granola: 'https://mcp.granola.ai/mcp',
  gong: 'https://mcp.gong.io/mcp',
  slack: 'https://mcp.slack.com/mcp',
  gmail: 'https://gmailmcp.googleapis.com/mcp/v1',
  'google-drive': 'https://drivemcp.googleapis.com/mcp/v1',
  'google-calendar': 'https://calendarmcp.googleapis.com/mcp/v1',
  hubspot: 'https://mcp.hubspot.com/anthropic',
  salesforce: 'https://api.salesforce.com/platform/mcp/v1/platform/sobject-reads',
  outreach: 'https://api.outreach.io/mcp',
  intercom: 'https://mcp.intercom.com/mcp',
  pylon: 'https://mcp.usepylon.com/',
  stripe: 'https://mcp.stripe.com',
  ramp: 'https://ramp-mcp-remote.ramp.com/mcp',
  quickbooks: 'https://mcp.quickbooks.intuit.com/mcp',
  docusign: 'https://mcp.docusign.com/mcp'
}

const EXPECTED = {
  setup: ['notion'],
  calendar: ['notion'],
  process: [
    'notion', 'atlassian', 'granola', 'gong', 'slack', 'gmail',
    'google-drive', 'google-calendar', 'hubspot', 'salesforce', 'stripe', 'ramp'
  ],
  memos: ['notion', 'granola', 'gong', 'slack', 'gmail'],
  projects: [
    'notion', 'granola', 'gong', 'slack', 'gmail', 'hubspot', 'salesforce',
    'outreach', 'intercom', 'pylon'
  ],
  software: [
    'notion', 'box', 'google-drive', 'gmail', 'slack', 'ramp', 'quickbooks',
    'docusign', 'google-calendar', 'granola', 'gong'
  ],
  'import-leads': ['notion']
}

// A connector also needs a concrete consuming surface. These references keep
// the inventory from becoming self-fulfilling: changing EXPECTED and the MCP
// manifest is insufficient unless a skill or executable contract names how
// the plugin uses the service.
const SUPPORT = {
  setup: {
    notion: ['plugins/setup/skills/install/SKILL.md', /mcp__\*__notion-create-database/]
  },
  calendar: {
    notion: ['plugins/calendar/skills/new/SKILL.md', /mcp__\*__notion-create-pages/]
  },
  process: {
    notion: ['plugins/process/skills/new/SKILL.md', /mcp__\*__notion-create-pages/],
    atlassian: ['plugins/process/scripts/backfill.js', /Confluence space/],
    granola: ['plugins/process/skills/backfill/SKILL.md', /`granola`/],
    gong: ['plugins/process/skills/backfill/SKILL.md', /"recorder": "gong"/],
    slack: ['plugins/process/skills/backfill/SKILL.md', /`slack`/],
    gmail: ['plugins/process/skills/backfill/SKILL.md', /`gmail`/],
    'google-drive': ['plugins/process/skills/backfill/SKILL.md', /`google-drive`/],
    'google-calendar': ['plugins/process/skills/backfill/SKILL.md', /"provider": "google-calendar"/],
    hubspot: ['plugins/process/skills/backfill/SKILL.md', /"hubspot"/],
    salesforce: ['plugins/process/skills/backfill/SKILL.md', /"salesforce"/],
    stripe: ['plugins/process/skills/backfill/SKILL.md', /"stripe"/],
    ramp: ['plugins/process/skills/backfill/SKILL.md', /"ramp"/]
  },
  memos: {
    notion: ['plugins/memos/skills/meeting-notes/SKILL.md', /mcp__\*__notion-create-pages/],
    granola: ['plugins/memos/skills/meeting-notes/SKILL.md', /connected recorder is Granola/],
    gong: ['plugins/memos/skills/meeting-notes/SKILL.md', /Gong's hosted MCP returns answers derived from calls/],
    slack: ['plugins/memos/skills/new/SKILL.md', /For Slack, use one explicitly named thread/],
    gmail: ['plugins/memos/skills/new/SKILL.md', /For Gmail, use one named thread/]
  },
  projects: {
    notion: ['plugins/projects/skills/problem-statement/SKILL.md', /mcp__\*__notion-create-pages/],
    granola: ['plugins/projects/skills/problem-scan/SKILL.md', /Granola, Gong/],
    gong: ['plugins/projects/skills/problem-scan/SKILL.md', /Gong's hosted MCP/],
    slack: ['plugins/projects/skills/problem-scan/SKILL.md', /Internal conversations \| Slack/],
    gmail: ['plugins/projects/skills/problem-scan/SKILL.md', /Email \| Gmail/],
    hubspot: ['plugins/projects/skills/problem-scan/SKILL.md', /HubSpot, Salesforce/],
    salesforce: ['plugins/projects/skills/problem-scan/SKILL.md', /HubSpot, Salesforce/],
    outreach: ['plugins/projects/skills/problem-scan/SKILL.md', /Sales engagement \| Outreach/],
    intercom: ['plugins/projects/skills/problem-scan/SKILL.md', /Customer support \| Intercom, Pylon/],
    pylon: ['plugins/projects/skills/problem-scan/SKILL.md', /Customer support \| Intercom, Pylon/]
  },
  software: {
    notion: ['plugins/software/skills/backfill/SKILL.md', /^allowed-tools:.*mcp__\*__notion-create-pages/m],
    box: ['plugins/software/skills/backfill/SKILL.md', /packaged Box connector/],
    'google-drive': ['plugins/software/skills/backfill/SKILL.md', /packaged Google Drive connector/],
    gmail: ['plugins/software/skills/backfill/SKILL.md', /packaged Gmail connector/],
    slack: ['plugins/software/skills/backfill/SKILL.md', /bounded Slack evidence/],
    ramp: ['plugins/software/skills/backfill/SKILL.md', /Ramp and QuickBooks/],
    quickbooks: ['plugins/software/skills/backfill/SKILL.md', /QuickBooks' hosted MCP/],
    docusign: ['plugins/software/skills/backfill/SKILL.md', /DocuSign's\s+official MCP/],
    'google-calendar': ['plugins/software/skills/evaluate/references/decision-model.md', /Google Calendar \| Vendor and internal meeting metadata/],
    granola: ['plugins/software/skills/evaluate/references/decision-model.md', /Granola \| Notes or transcripts from approved meetings/],
    gong: ['plugins/software/skills/evaluate/SKILL.md', /Gong's hosted MCP returns transcript-derived answers/]
  },
  'import-leads': {
    notion: ['plugins/import-leads/skills/run/SKILL.md', /mcp__\*__notion-update-page/]
  }
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

check('every declared connector has capability evidence outside its manifest and inventory', () => {
  assert.deepStrictEqual(Object.keys(SUPPORT).sort(), Object.keys(EXPECTED).sort(),
    'SUPPORT must cover the same plugins as EXPECTED')

  for (const [plugin, connectors] of Object.entries(SUPPORT)) {
    assert.deepStrictEqual(Object.keys(connectors).sort(), EXPECTED[plugin].slice().sort(),
      `${plugin}: SUPPORT must cover every expected connector and nothing else`)

    for (const [connector, [relativePath, pattern]] of Object.entries(connectors)) {
      const supportPath = path.join(ROOT, relativePath)
      assert.ok(fs.existsSync(supportPath), `${plugin}/${connector}: support file ${relativePath} is missing`)
      const supportText = fs.readFileSync(supportPath, 'utf8')
      assert.match(supportText, pattern,
        `${plugin}/${connector}: ${relativePath} does not contain the promised capability evidence`)
    }
  }
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

const softwareBackfillPath = path.join(ROOT, 'plugins/software/skills/backfill/SKILL.md')
const memosMeetingNotesPath = path.join(ROOT, 'plugins/memos/skills/meeting-notes/SKILL.md')

check('memos meeting notes can call the packaged Gong server', () => {
  const text = fs.readFileSync(memosMeetingNotesPath, 'utf8')
  const frontmatter = text.match(/^---\n([\s\S]*?)\n---\n/)
  assert.ok(frontmatter, 'the Memos meeting-notes skill has no YAML frontmatter')
  const declarations = frontmatter[1].match(/^allowed-tools:.*$/gm) || []
  assert.strictEqual(declarations.length, 1, 'the Memos meeting-notes skill must declare one allowed-tools line')
  assert.ok(declarations[0].includes('mcp__plugin_memos_gong__*'),
    'Memos meeting-notes cannot call tools exposed by its packaged Gong server')
})

check('software backfill keeps a least-privilege connector allowlist', () => {
  const text = fs.readFileSync(softwareBackfillPath, 'utf8')
  const frontmatter = text.match(/^---\n([\s\S]*?)\n---\n/)
  assert.ok(frontmatter, 'the Software backfill skill has no YAML frontmatter')
  const declarations = frontmatter[1].match(/^allowed-tools:.*$/gm) || []
  assert.strictEqual(declarations.length, 1, 'the Software backfill skill must declare one allowed-tools line')
  const allowed = declarations[0]

  const required = [
    'mcp__*__notion-create-pages',
    'mcp__*__search_files',
    'mcp__*__search_threads',
    'mcp__*__slack_search_public_and_private',
    'mcp__plugin_software_ramp__*get*',
    'mcp__*__qbo_accounting_get_ap_aging_detail',
    'mcp__plugin_software_docusign__*search*'
  ]
  for (const tool of required) {
    assert.ok(allowed.includes(tool), `Software backfill allowed-tools is missing ${tool}`)
  }

  assert.doesNotMatch(allowed,
    /mcp__(?:plugin_software_(?:ramp|docusign)|[^,]*QuickBooks)__[^,]*(?:create|update|delete|send|sign|pay|transfer|approve|void)/i,
    'Software backfill allows a mutation through an external evidence connector')
})

const softwareEvaluatePath = path.join(ROOT, 'plugins/software/skills/evaluate/SKILL.md')
const softwareAgentPath = path.join(ROOT, 'plugins/software/agents/software-evaluator.md')
const softwareCommandPath = path.join(ROOT, 'plugins/software/scripts/software.js')
const softwareSkillsInventoryPath = path.join(ROOT, 'plugins/software/SKILLS.md')

check('software ships the evaluator agent with the skill\'s audited read-only tools', () => {
  assert.ok(fs.existsSync(softwareAgentPath), 'plugins/software/agents/software-evaluator.md is missing')
  const agent = fs.readFileSync(softwareAgentPath, 'utf8')
  const skill = fs.readFileSync(softwareEvaluatePath, 'utf8')
  const command = fs.readFileSync(softwareCommandPath, 'utf8')
  const frontmatter = agent.match(/^---\n([\s\S]*?)\n---\n/)
  assert.ok(frontmatter, 'the Software evaluator agent has no YAML frontmatter')
  assert.match(frontmatter[1], /^name:\s*software-evaluator$/m)
  assert.match(frontmatter[1], /^description:\s*>$/m)
  assert.match(frontmatter[1], /^model:\s*sonnet$/m)
  assert.match(frontmatter[1], /^effort:\s*medium$/m)
  assert.match(frontmatter[1], /^maxTurns:\s*60$/m)
  assert.match(frontmatter[1], /^color:\s*purple$/m)
  assert.match(frontmatter[1], /^tools:\s*$/m, 'the agent must declare tools explicitly rather than inherit them')
  assert.match(agent, /software:evaluate/, 'the agent does not route through software:evaluate')
  assert.match(frontmatter[1], /makes no Software directory change without a separate Software skill/i,
    'the agent description does not expose the separate-skill write boundary')
  assert.match(agent, /Never run unattended/, 'the evaluator does not carry the unattended-run boundary')

  const unquote = value => value.trim().replace(/^['"]|['"]$/g, '')
  const agentToolsBlock = frontmatter[1].match(/^tools:\s*\n((?:\s+-\s+.*\n?)+)/m)
  assert.ok(agentToolsBlock, 'the Software evaluator agent has no explicit tools list')
  const agentTools = [...agentToolsBlock[1].matchAll(/^\s+-\s+(.+)$/gm)].map(match => unquote(match[1]))
  for (const tool of ['Skill', 'Write']) assert.ok(agentTools.includes(tool), `agent tools omit ${tool}`)
  const skillFrontmatter = skill.match(/^---\n([\s\S]*?)\n---\n/)
  assert.ok(skillFrontmatter, 'software:evaluate has no YAML frontmatter')
  const skillHooks = skillFrontmatter[1].match(/^hooks:\n[\s\S]*$/m)
  assert.ok(skillHooks, 'software:evaluate has no safety hooks')
  assert.match(skillHooks[0], /^  PreToolUse:$/m, 'software:evaluate has no scoped PreToolUse guard')
  assert.match(skillHooks[0], /^  PostToolUse:$/m, 'software:evaluate has no state-capture PostToolUse guard')
  const postToolUse = skillHooks[0].slice(skillHooks[0].indexOf('  PostToolUse:'))
  for (const guardedResponse of ['WebSearch', 'WebFetch', 'box', 'google-drive', 'gmail', 'slack', 'ramp', 'quickbooks', 'docusign', 'google-calendar', 'granola', 'gong', 'notion']) {
    assert.ok(postToolUse.includes(guardedResponse), `software:evaluate PostToolUse credential scan omits ${guardedResponse}`)
  }
  const guardSource = fs.readFileSync(path.join(ROOT, 'plugins/software/scripts/guard-evidence-safety.js'), 'utf8')
  assert.match(guardSource, /function recordConnectorSearch[\s\S]*?return withFileLock\(file, \(\) => \{/, 'connector search authorization updates are not serialized')
  assert.doesNotMatch(frontmatter[1], /^hooks:/m, 'the evaluator agent must not duplicate the skill\'s stateful hooks')
  assert.match(agent, /skill also owns the one stateful safety-hook set/i,
    'the evaluator agent does not explain that software:evaluate owns the single hook registration')
  const allowedBlock = skillFrontmatter[1].match(/^allowed-tools:\s*\n((?:\s+-\s+.*\n?)+)/m)
  assert.ok(allowedBlock, 'software:evaluate has no explicit allowed-tools list')
  const skillTools = [...allowedBlock[1].matchAll(/^\s+-\s+(.+)$/gm)].map(match => unquote(match[1]))
  const expectedBash = [
    'evaluate-reference', 'evaluate-run-start', 'evaluate-run-cleanup', 'evaluate-scope', 'evaluate-survey', 'evaluate-attest-related',
    'evaluate-directory-proof', 'evaluate-dependencies', 'scan-evidence-file',
    'read-scanned-evidence-file', 'evaluate-evidence', 'evaluate-assess', 'evaluate-check'
  ].map(command => `Bash(node "\${CLAUDE_PLUGIN_ROOT}/scripts/software.js" ${command}:*)`).sort()
  assert.deepStrictEqual(skillTools.filter(one => one.startsWith('Bash(')).sort(), expectedBash,
    'software:evaluate Bash must be restricted to its shipped command prefixes')
  assert.deepStrictEqual(agentTools.filter(one => one.startsWith('Bash(')).sort(), expectedBash,
    'direct evaluator Bash must exactly match software:evaluate, including the fixed reference loader')
  assert.match(skill, /run `evaluate-reference` and load its complete\s+output/i,
    'software:evaluate does not require loading the complete operative reference')
  assert.match(agent, /run (?:its|the) fixed\s+`evaluate-reference` command/i,
    'the directly invoked evaluator does not require loading the operative reference')
  assert.ok(!skillTools.includes('Bash(node:*)'), 'software:evaluate must not grant arbitrary Node execution')
  const skillExternal = skillTools.filter(one => one.startsWith('mcp__')).sort()
  const agentExternal = agentTools.filter(one => one.startsWith('mcp__')).sort()
  assert.deepStrictEqual(agentExternal, skillExternal,
    'the evaluator agent MCP list must exactly match software:evaluate\'s audited external read methods')
  const mutationMethod = /(?:^|[_-])(?:create|update|delete|send|post|approve|pay|transfer|sign|void|cancel|edit|write)(?:[_*-]|$)/i
  assert.ok(!agentExternal.some(tool => mutationMethod.test(tool.split('__').pop())),
    'the evaluator agent includes an external mutation method')
  for (const method of ['create_page', 'update-record', 'send*', 'approve_bill']) {
    assert.ok(mutationMethod.test(method), `the evaluator mutation-method assertion cannot recognize ${method}`)
  }
  assert.ok(!agentTools.some(one => one === 'mcp__*__*' || one === 'mcp__*'), 'the evaluator agent inherits a broad MCP wildcard')
  assert.deepStrictEqual(skillExternal.filter(tool => tool.startsWith('mcp__*__') && !/notion-(?:fetch|query-data-sources)$/.test(tool)), [],
    'software:evaluate must not admit globally configured evidence connectors that bypass its plugin-scoped guard')
  const skillBuiltins = skillTools.filter(one => !one.startsWith('mcp__')).sort()
  const agentBuiltins = agentTools.filter(one => !one.startsWith('mcp__') && one !== 'Skill').sort()
  assert.deepStrictEqual(agentBuiltins, skillBuiltins,
    'the evaluator agent built-in tools must exactly match software:evaluate, plus Skill for routing')
  assert.match(command, /evaluationGuard\.attestRelatedReadSequence\(/,
    'the fixed related-read command bypasses the hook-owned survey sequence')
  assert.match(command, /evaluationGuard\.trustedSurveySequenceAttestation\(/,
    'the fixed directory-proof command bypasses the hook-owned five-phase survey sequence')
})

check('software skill inventory does not duplicate a stale fixed skill count', () => {
  const inventory = fs.readFileSync(softwareSkillsInventoryPath, 'utf8')
  assert.doesNotMatch(inventory, /\b(?:six|6)\s+skills\b/i)
})

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
  assert.match(text, /Use connector tools only to search and read/,
    'the agent does not limit write-capable connectors to read-only Process work')
  for (const service of ['Google Drive', 'Slack', 'Gmail', 'Google Calendar', 'Granola', 'Gong', 'HubSpot', 'Salesforce', 'Stripe', 'Ramp']) {
    assert.match(text, new RegExp(service), `the agent never names ${service} as an evidence source`)
  }
})

const problemAgentPath = path.join(ROOT, 'plugins/projects/agents/problem-statement-agent.md')

check('projects ships the problem-statement agent that the product promises', () => {
  assert.ok(fs.existsSync(problemAgentPath), 'plugins/projects/agents/problem-statement-agent.md is missing')
  const text = fs.readFileSync(problemAgentPath, 'utf8')
  const frontmatter = text.match(/^---\n([\s\S]*?)\n---\n/)
  assert.ok(frontmatter, 'the Projects agent has no YAML frontmatter')
  assert.match(frontmatter[1], /^name:\s*problem-statement-agent$/m)
  assert.match(frontmatter[1], /^description:\s*>$/m)
  assert.match(frontmatter[1], /^model:\s*sonnet$/m)
  assert.match(frontmatter[1], /^maxTurns:\s*20$/m)
  for (const skill of ['problem-scan', 'problem-statement']) {
    assert.match(text, new RegExp(`projects:${skill}\\b`), `the agent never routes to projects:${skill}`)
  }
  assert.match(text, /only after the user explicitly approves the\s+complete preview/i,
    'the agent description does not expose the write boundary')
  assert.match(text, /Do not invoke `projects:scope`/,
    'the agent does not keep project creation outside the problem-statement job')
  assert.match(text, /Never run unattended/,
    'the agent does not carry the unattended-run boundary')
  assert.match(text, /External connectors are search-and-read sources only/,
    'the agent does not limit write-capable connectors to read-only discovery')
})

console.log(failures ? `\n${failures} failed.\n` : `\nAll checks passed. ${marketplace.plugins.length} plugin.\n`)
process.exit(failures ? 1 : 0)

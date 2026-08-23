'use strict'

/**
 * The gates on one Process artifact.
 *
 * These are the rules Notion cannot enforce. A view filter cannot read a
 * parent's Type across a relation, no filter can count multi-select values, and
 * nothing in Notion knows what a body template is. So every one of them is
 * enforced here, and a test that goes green without exercising the refusal is
 * worth nothing at all.
 *
 * WHAT EACH GROUP PROVES. The refusals are asserted on the message as well as
 * the kind, because a refusal that fires for the wrong reason passes a test that
 * only checks that something failed. The `properties` group asserts the payload
 * that would be sent, since that is the thing Notion sees.
 *
 * Run: node tests/process-artifact.test.js
 */

const assert = require('assert')

const artifact = require('../plugins/process/scripts/artifact')
const schema = require('../shared/process-schema')

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

console.log('\nthe gates on one Process artifact\n')

const PERSON = '11111111-2222-3333-4444-555555555555'

/** A context that renames nothing, so a test failure is about the rule. */
const plainContext = (personId = PERSON) => ({
  property: logical => logical,
  value: (property, value) => value,
  personId
})

/**
 * A context that renames everything, so a payload built through it proves the
 * name map is actually being used rather than the shipped names being written.
 */
const renamingContext = (personId = PERSON) => ({
  property: logical => `renamed:${logical}`,
  value: (property, value) => `renamed:${value}`,
  personId
})

const SOP = () => ({
  Name: 'How inbound leads get routed',
  Type: 'SOP/ROE',
  Domain: 'Deal Execution',
  Audience: ['SDR'],
  Tags: ['Data'],
  body: {
    Scope: 'Covers inbound only.',
    'Trigger Condition': 'A form submission lands in Marketo.',
    Steps: '1. An SDR opens the lead in Salesforce and checks the account owner.',
    'System Behavior': 'Marketo assigns a score automatically.',
    Exceptions: 'none known'
  }
})

const DECISION = () => ({
  Name: 'Why we route by account owner',
  Type: 'Strategy Decision',
  Domain: 'GTM Strategy & ICP',
  body: {
    Problem: 'Leads were landing with whoever answered first.',
    Decision: 'Inbound routes to the existing account owner.',
    'Why This Approach': 'Round robin split accounts across two reps.',
    'Used For': 'Any inbound lead matching a known account.',
    'Not Used For': 'Net-new logos, which stay on round robin.'
  }
})

const kinds = found => found.map(p => p.kind).sort()
const about = (found, field) => found.filter(p => p.field === field)

// ------------------------------------------------------------------- identity

check('a nameless, typeless artifact is refused for both reasons', () => {
  const found = artifact.problems({})
  assert.deepStrictEqual(kinds(found), ['missing', 'missing'])
  assert.strictEqual(about(found, 'Name').length, 1)
  assert.strictEqual(about(found, 'Type').length, 1)
})

check('a whitespace name is as absent as no name', () => {
  const found = artifact.problems({ ...SOP(), Name: '   ' })
  assert.strictEqual(about(found, 'Name')[0].kind, 'missing')
})

check('a type this database does not have is refused, and the message lists the real ones', () => {
  const found = artifact.problems({ ...SOP(), Type: 'Runbook' })
  const problem = about(found, 'Type')[0]
  assert.strictEqual(problem.kind, 'unknown-value')
  for (const type of schema.TYPES) {
    assert.ok(problem.message.includes(type), `the message does not offer "${type}" as an alternative`)
  }
})

check('a skill cannot write Draft, and the refusal says why', () => {
  const found = artifact.problems({ ...SOP(), Status: 'Draft' })
  const problem = about(found, 'Status')[0]
  assert.strictEqual(problem.kind, 'not-writable')
  assert.ok(problem.message.includes('written nothing useful'))
})

check('Active and Archive are both writable', () => {
  for (const status of ['Active', 'Archive']) {
    assert.deepStrictEqual(artifact.problems({ ...SOP(), Status: status }), [])
  }
})

// -------------------------------------------------------------------- values

check('a domain the database does not have is refused', () => {
  const found = artifact.problems({ ...SOP(), Domain: 'Vibes' })
  assert.strictEqual(about(found, 'Domain')[0].kind, 'unknown-value')
})

check('a cadence the database does not have is refused', () => {
  const found = artifact.problems({ ...SOP(), 'Review cadence': 'Every other Thursday' })
  assert.strictEqual(about(found, 'Review cadence')[0].kind, 'unknown-value')
})

check('a bare string sent to a multi-select is refused before it reaches Notion', () => {
  const found = artifact.problems({ ...SOP(), Audience: 'SDR' })
  const problem = about(found, 'Audience')[0]
  assert.strictEqual(problem.kind, 'not-a-list')
  assert.ok(problem.message.includes('400'), 'the message does not say what Notion would do')
})

check('an invented tag is refused, and the message says the whole write is lost', () => {
  const found = artifact.problems({ ...SOP(), Tags: ['Completely Invented Tag'] })
  const problem = about(found, 'Tags')[0]
  assert.strictEqual(problem.kind, 'unknown-value')
  assert.ok(/nothing is saved|whole/.test(problem.message))
})

check('three tags pass and four are refused', () => {
  const three = { ...SOP(), Tags: ['AI', 'Data', 'Tools'] }
  assert.deepStrictEqual(artifact.problems(three), [])

  const four = { ...SOP(), Tags: ['AI', 'Data', 'Tools', 'Meetings'] }
  const problem = about(artifact.problems(four), 'Tags')[0]
  assert.strictEqual(problem.kind, 'too-many')
  assert.ok(problem.message.includes(String(schema.TAGS_MAX)))
})

check('a tag with spaces round it is the same tag', () => {
  assert.deepStrictEqual(artifact.problems({ ...SOP(), Tags: ['  AI  '] }), [])
})

check('A BADLY SHAPED TAG IS REFUSED, NOT THROWN OVER', () => {
  // The cap check used to count the list without asking whether it was a list of
  // value names first, so a number in it made `problems` throw while trying to
  // report the problem it had already found. Asking what is wrong with a row
  // returned a stack trace instead of the answer.
  const row = { ...SOP(), Tags: [42] }
  let found
  assert.doesNotThrow(() => { found = artifact.problems(row) }, 'problems threw rather than reporting')
  const problem = about(found, 'Tags')[0]
  assert.ok(problem, 'the badly shaped tag was not reported at all')
  assert.ok(/42/.test(problem.message), problem.message)
})

check('and the write path refuses it too, rather than crashing on the way', () => {
  // `properties` runs `problems` itself, so the same fault reached it one level
  // down. The refusal has to name the tag rather than arriving as a type error.
  assert.throws(
    () => artifact.properties(plainContext(), { ...SOP(), Tags: [42] }),
    err => /not a value name/.test(err.message) && !/is not a function/.test(err.message),
    'the write path crashed instead of refusing'
  )
})

// -------------------------------------------------------------------- parents

check('a parent named without its type is refused rather than assumed', () => {
  const found = artifact.problems({ ...SOP(), parent: 'page-id' })
  const problem = about(found, 'parent')[0]
  assert.strictEqual(problem.kind, 'parent-type-unknown')
  assert.ok(problem.message.includes('assuming'), 'the message does not say why it refuses instead of guessing')
})

check('only a Strategy Decision may be a parent', () => {
  const ok = artifact.problems({ ...SOP(), parent: 'page-id' }, { parentType: 'Strategy Decision' })
  assert.deepStrictEqual(ok, [])

  for (const type of schema.TYPES.filter(t => t !== 'Strategy Decision')) {
    const found = artifact.problems({ ...SOP(), parent: 'page-id' }, { parentType: type })
    const problem = about(found, 'parent')[0]
    assert.ok(problem, `a ${type} was accepted as a parent`)
    assert.strictEqual(problem.kind, 'parent-wrong-type')
  }
})

check('no parent means no parent check', () => {
  assert.deepStrictEqual(artifact.problems(SOP(), { parentType: 'SOP/ROE' }), [])
})

// ----------------------------------------------------------------- the body

check('a missing required section is refused, one problem per section', () => {
  const row = SOP()
  delete row.Steps
  delete row.body.Steps
  delete row.body['System Behavior']

  const found = artifact.problems(row)
  assert.strictEqual(found.length, 2, `expected two missing sections, got ${JSON.stringify(kinds(found))}`)
  assert.deepStrictEqual(found.map(p => p.field).sort(), ['Steps', 'System Behavior'])
  assert.ok(found[0].message.includes('considered'), 'the message does not say why an empty section stays in place')
})

check('Sources is conditional, so leaving it out is fine on every type', () => {
  for (const build of [SOP, DECISION]) {
    assert.deepStrictEqual(artifact.problems(build()), [])
  }
})

check('a never-empty section left blank is refused with its own reason', () => {
  const row = SOP()
  row.body.Exceptions = '   '

  const problem = about(artifact.problems(row), 'Exceptions')[0]
  assert.strictEqual(problem.kind, 'section-missing')
  assert.ok(
    problem.message.includes('none known'),
    'the refusal does not tell the writer what to put there, which is the whole remedy'
  )
  assert.ok(problem.message.includes('unconsidered'), 'the refusal does not carry the reason blank is different from clean')
})

check('"none known" satisfies the section and raises it for one look', () => {
  const row = SOP()
  assert.deepStrictEqual(artifact.problems(row), [])

  const raised = artifact.concerns(row)
  assert.strictEqual(raised.length, 1)
  assert.strictEqual(raised[0].kind, 'none-known')
  assert.strictEqual(raised[0].section, 'Exceptions')
})

check('Technical Reference carries the same rule on Known Limitations', () => {
  const row = {
    Name: 'How the assignment engine is wired',
    Type: 'Technical Reference',
    body: {
      'What It Does': 'Assigns leads.',
      Configuration: 'A cron in Heroku.',
      'Integration Details': 'Reads Marketo, writes Salesforce.',
      Authentication: 'The token lives in 1Password, in the RevOps vault.',
      'Known Limitations': '',
      Contacts: 'Sarah Madden'
    }
  }
  const problem = about(artifact.problems(row), 'Known Limitations')[0]
  assert.ok(problem, 'a blank Known Limitations was accepted')
  assert.ok(problem.message.includes('none known'))
})

// ------------------------------------------------------------------- sources

check('a source with no line of context is refused', () => {
  const row = { ...SOP(), sources: [{ what: 'The 2026 routing doc' }] }
  const problem = about(artifact.problems(row), 'Sources')[0]
  assert.strictEqual(problem.kind, 'source-uncontributed')
  assert.ok(problem.message.includes('worse than none'))
})

check('a source with both parts passes', () => {
  const row = { ...SOP(), sources: [{ what: 'The 2026 routing doc', contributed: 'The trigger condition.' }] }
  assert.deepStrictEqual(artifact.problems(row), [])
})

// ----------------------------------------------------------------- the ceiling

check('running long is a question, never a refusal', () => {
  const row = DECISION()
  row.body.Problem = 'word '.repeat(schema.WORD_CEILING + 50)

  assert.deepStrictEqual(artifact.problems(row), [], 'an over-long artifact must still be writable')

  const raised = artifact.concerns(row)
  const ceiling = raised.find(c => c.kind === 'over-ceiling')
  assert.ok(ceiling, 'nothing was raised about the length')
  assert.ok(ceiling.count > schema.WORD_CEILING)
  assert.ok(ceiling.message.includes('two artifacts'), 'the question asked is not the one the design specifies')
  assert.ok(ceiling.message.includes('granularity'), 'on a Strategy Decision it should route into the granularity framework')
})

check('Sources does not count toward the ceiling', () => {
  const row = DECISION()
  row.body.Sources = 'word '.repeat(schema.WORD_CEILING + 50)

  assert.deepStrictEqual(artifact.concerns(row), [], 'a long Sources section was counted against the ceiling')
})

check('an artifact at exactly the ceiling is not raised', () => {
  const row = DECISION()
  const filled = artifact.wordCount(row)
  row.body.Problem = row.body.Problem + ' ' + 'word '.repeat(schema.WORD_CEILING - filled)

  assert.strictEqual(artifact.wordCount(row), schema.WORD_CEILING)
  assert.deepStrictEqual(artifact.concerns(row).filter(c => c.kind === 'over-ceiling'), [])
})

// ---------------------------------------------------------------- the payload

check('properties throws rather than sending a payload Notion would refuse', () => {
  assert.throws(
    () => artifact.properties(plainContext(), { ...SOP(), Tags: ['a', 'b', 'c', 'd'] }),
    /cannot be written yet/
  )
})

check('every name and value goes through the map, none shipped raw', () => {
  const out = artifact.properties(renamingContext(), SOP(), { today: '2026-08-23' })

  for (const key of Object.keys(out)) {
    assert.ok(key.startsWith('renamed:'), `"${key}" was written without going through the property map`)
  }
  assert.strictEqual(out['renamed:Type'], 'renamed:SOP/ROE')
  assert.deepStrictEqual(out['renamed:Audience'], ['renamed:SDR'])
})

check('all three verification fields are set on a create', () => {
  const out = artifact.properties(plainContext(), SOP(), { today: '2026-08-23' })

  assert.strictEqual(out['Last checked for accuracy'], '2026-08-23')
  assert.strictEqual(out['Verified date'], '2026-08-23')
  assert.deepStrictEqual(out['Verified by'], [PERSON])
})

check('with no person id, Verified by is omitted and Verified date is still set', () => {
  const out = artifact.properties(plainContext(null), SOP(), { today: '2026-08-23' })

  assert.ok(!('Verified by' in out), 'Verified by was written with no person to write')
  assert.ok(!('Owner' in out), 'Owner was written with no person to write')
  assert.strictEqual(out['Verified date'], '2026-08-23', 'Verified date is set either way, and was not')
  assert.strictEqual(out['Last checked for accuracy'], '2026-08-23')
})

check('Status defaults to Active and the cadence to the configured default', () => {
  const out = artifact.properties(plainContext(), SOP(), { today: '2026-08-23' })
  assert.strictEqual(out.Status, 'Active')
  assert.strictEqual(out['Review cadence'], schema.DEFAULT_CADENCE)
})

check('a named owner beats the configured person', () => {
  const other = '99999999-8888-7777-6666-555555555555'
  const out = artifact.properties(plainContext(), { ...SOP(), Owner: other }, { today: '2026-08-23' })
  assert.deepStrictEqual(out.Owner, [other])
})

check('a name where a person id belongs is refused loudly', () => {
  assert.throws(
    () => artifact.properties(plainContext(), { ...SOP(), Owner: 'Sarah' }, { today: '2026-08-23' }),
    /not a Notion person id/
  )
})

// ------------------------------------------------------------------- the body

check('the body comes back in template order', () => {
  const built = artifact.body(SOP())
  assert.deepStrictEqual(
    built.map(s => s.heading),
    ['Scope', 'Trigger Condition', 'Steps', 'System Behavior', 'Exceptions']
  )
})

check('an omitted Sources section is absent rather than empty', () => {
  assert.ok(!artifact.expectedHeadings(SOP()).includes('Sources'))

  const withSources = { ...SOP(), body: { ...SOP().body, Sources: 'The routing doc.' } }
  const headings = artifact.expectedHeadings(withSources)
  assert.strictEqual(headings[headings.length - 1], 'Sources', 'Sources is not last')
})

check('a type with no template throws rather than borrowing another one', () => {
  assert.throws(() => artifact.body({ Type: 'Runbook' }), /No template/)
})

check('every type can build a body from its own template', () => {
  for (const type of schema.TYPES) {
    const body = {}
    for (const section of schema.sectionsFor(type)) body[section.heading] = 'content'
    const built = artifact.body({ Name: 'x', Type: type, body })
    assert.deepStrictEqual(
      built.map(s => s.heading),
      schema.sectionsFor(type).map(s => s.heading),
      `${type} did not build its full template`
    )
  }
})

console.log(failures ? `\n${failures} failed.\n` : '\nAll passed.\n')
process.exit(failures ? 1 : 0)

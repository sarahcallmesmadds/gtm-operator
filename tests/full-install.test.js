'use strict'

/**
 * The whole install, checked against what Notion actually returned.
 *
 * The other test files work from definitions and from hand-built objects. This
 * one works from a recording: six databases were created in a live workspace on
 * 2026-08-18, thirteen relations were added, seven views were built, and then
 * every one of them was fetched back. The fixture is that fetch.
 *
 * It is the test that would have caught the things nothing else could: a type
 * that does not round-trip, a reverse property Notion names differently from
 * the request, a filter that is quietly dropped. Every one of those is a
 * difference between what the code asked for and what the product did, and no
 * amount of testing the code against itself finds one.
 *
 * Run: node tests/full-install.test.js
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const assert = require('assert')

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'gtm-operator-install-'))
process.env.GTM_OPERATOR_CONFIG = path.join(SANDBOX, 'gtm-operator.config.json')

const ROOT = path.join(__dirname, '..')
const config = require(path.join(ROOT, 'plugins/setup/scripts/config.js'))
const install = require(path.join(ROOT, 'plugins/setup/scripts/install.js'))
const { VIEWS, counts } = require(path.join(ROOT, 'plugins/setup/scripts/manifest.js'))

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

const recorded = () => {
  const f = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/full-install-as-notion-returned-it.json'), 'utf8'))
  delete f._comment
  return f
}

/** Config holding the ids that real install produced. */
const withConfig = fixture => {
  if (fs.existsSync(config.CONFIG_PATH)) fs.unlinkSync(config.CONFIG_PATH)
  config.begin('00000000-0000-4000-8000-00000parent')
  for (const [key, ids] of Object.entries(fixture.ids)) config.recordDatabase(key, ids)
}

console.log('\na real install, read back from Notion\n')

check('the install that was run passes verification, apart from one dated gap', () => {
  // Not asserted as zero any more, and the difference is worth reading.
  //
  // This fixture records an install run before `Contract link` gained its
  // description in schema.js, so the current manifest asks for a description
  // that install could not have created. Asserting the exact remaining problem
  // rather than loosening the check keeps the fixture honest and still goes red
  // the moment anything ELSE stops matching. Re-record the fixture and this
  // goes back to zero.
  const fixture = recorded()
  withConfig(fixture)
  const { problems } = install.verify(fixture)

  // Each expected difference is named, so a fifth one fails this rather than
  // hiding inside a loosened count.
  const expected = [
    // Relation 5, projects.Problem Statement / memos.Resulting Projects, dropped
    // 2026-08-18. The fixture install still carries both sides of it.
    'Memos.Resulting Projects: present in Notion and not in the schema',
    'Projects.Problem Statement: present in Notion and not in the schema',
    // And the view that filtered on it.
    'Projects view "Needs attention": the filter is not the one that was asked for',
    // Added to schema.js after this install ran.
    'Software.Contract link: the description does not match'
  ]
  // Plus one pair per filtered view, because the recorded rows are titles and
  // titles stopped being evidence on 2026-08-18. Counted rather than listed,
  // and the count is derived so a view appearing or disappearing moves it.
  const filtered = VIEWS.filter(v => v.filter).length
  expected.push(...Array.from({ length: filtered * 2 }, () => 'ROWS'))
  assert.strictEqual(problems.length, expected.length, problems.join('\n'))
  for (const want of expected.filter(w => w !== 'ROWS')) {
    assert.ok(problems.some(p => p.startsWith(want)), `nothing reported: ${want}\n${problems.join('\n')}`)
  }
  assert.strictEqual(
    problems.filter(p => p.includes('cannot prove which rows came back')).length,
    filtered * 2,
    problems.join('\n')
  )
})

check('row evidence was recorded for every filtered view, and it is no longer usable', () => {
  // Two claims, and the second one is the uncomfortable half.
  //
  // Every filtered view does have both halves recorded, which is what this
  // originally checked. But they were recorded as page TITLES, and titles were
  // ruled out on 2026-08-18: two rows can share one, and a title containing the
  // separator the rows used to be joined on collided with a pair of other rows.
  // So this fixture no longer proves any view, and pretending otherwise is the
  // exact false confidence the change removed. It has to be re-recorded from a
  // live install with page urls or ids on both sides.
  const fixture = recorded()
  withConfig(fixture)

  for (const view of VIEWS.filter(v => v.filter)) {
    const key = `${view.database}::${view.name}`
    assert.ok(fixture.viewRows[key], `no view rows recorded for ${key}`)
    assert.ok(fixture.sqlRows[key], `no rule rows recorded for ${key}`)
  }

  const { problems, unchecked, verified } = install.verify(fixture)
  assert.strictEqual(unchecked.length, 0, `nothing should be merely unchecked:\n${unchecked.join('\n')}`)
  assert.ok(
    problems.filter(p => p.includes('cannot prove which rows came back')).length > 0,
    'the recorded titles should be refused as evidence'
  )
  assert.strictEqual(verified, false)
})

check('the one-way relation came back with no synced counterpart', () => {
  // The only thing in a read-back that separates a one-way relation from a
  // two-way one. If Notion ever starts returning a propertyUrl here, the design
  // has changed under us and this goes red.
  const fixture = recorded()
  assert.ok(!fixture.databases.software.schema['Integrates with'].propertyUrl)
})

check('every two-way relation came back with one', () => {
  const fixture = recorded()
  const twoWay = ['Parent', 'Supersedes', 'Child Docs', 'Superseded By']
  for (const name of twoWay) {
    assert.ok(fixture.databases.process.schema[name].propertyUrl, `${name} has no synced counterpart`)
  }
})

check('the reverse properties Notion created are on the databases they belong to', () => {
  const fixture = recorded()
  // Two relations put a property called Calendar on two different databases,
  // which the manifest allows and which is worth seeing proved.
  assert.ok(fixture.databases.process.schema.Calendar, 'Process has no Calendar')
  assert.ok(fixture.databases.projects.schema.Calendar, 'Projects has no Calendar')
})

check('a type that does not round-trip is recorded as Notion returns it', () => {
  const fixture = recorded()
  assert.strictEqual(fixture.databases.process.schema.Description.type, 'text', 'written as RICH_TEXT')
  assert.strictEqual(fixture.databases.process.schema.Owner.type, 'person', 'written as PEOPLE')
})

console.log('\nand it still fails when the recording is broken\n')

check('a dropped property is caught', () => {
  const fixture = recorded()
  withConfig(fixture)
  delete fixture.databases.software.schema['SOC 2']
  const { problems } = install.verify(fixture)
  assert.ok(problems.join('\n').includes('SOC 2: missing'))
})

check('a reordered option list is caught', () => {
  const fixture = recorded()
  withConfig(fixture)
  fixture.databases.process.schema.Type.options.reverse()
  const { problems } = install.verify(fixture)
  assert.ok(problems.join('\n').includes('wrong order'))
})

check('a relation that lost its far side is caught', () => {
  const fixture = recorded()
  withConfig(fixture)
  delete fixture.databases.process.schema['Child Docs']
  const { problems } = install.verify(fixture)
  assert.ok(problems.join('\n').includes('Child Docs'))
})

check('a view returning rows its rule does not is caught', () => {
  // Written with page ids rather than the fixture's titles, because titles are
  // no longer evidence. Two rows on one side, one on the other.
  const fixture = recorded()
  withConfig(fixture)
  const one = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1'
  const two = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2'
  fixture.viewRows['calendar::Needs attention'] = [one]
  fixture.sqlRows['calendar::Needs attention'] = [one, two]
  const { problems } = install.verify(fixture)
  assert.ok(problems.join('\n').includes('different rows from the rule'), problems.join('\n'))
})

fs.rmSync(SANDBOX, { recursive: true, force: true })

console.log(failures
  ? `\n${failures} failed.\n`
  : `\nAll checks passed. ${counts.databases} databases, ${counts.relations} relations, ${VIEWS.length} views, all read back from a live workspace.\n`)
process.exit(failures ? 1 : 0)

'use strict'

/**
 * The two copies of the multi-select helpers answer identically.
 *
 * `shared/calendar-schema.js` and `shared/process-schema.js` each carry
 * `listProblem` and `listValues`. They are a copy, on purpose: the two plugins
 * are separate releases, neither can require the other, and a fourth vendored
 * file for eleven lines buys less than it costs.
 *
 * A copy nothing checks is the thing this repository distrusts most, so this
 * runs both implementations over the same inputs and asserts the same answer.
 * The trim inside `listValues` is the part that matters: a value compared
 * trimmed on one path and written untrimmed on another is a 400 at write time,
 * and that has happened here before.
 *
 * Run: node tests/list-values-agree.test.js
 */

const assert = require('assert')

const calendar = require('../shared/calendar-schema')
const process_ = require('../shared/process-schema')

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

console.log('\nthe two copies of the multi-select helpers agree\n')

const CASES = [
  undefined,
  null,
  '',
  [],
  ['AI'],
  ['AI', 'Data'],
  [' Enterprise '],
  ['  '],
  [''],
  ['AI', ''],
  ['AI', '  Data  ', 'Tools'],
  'AI',
  ['AI', 42],
  [null],
  [undefined],
  ['\tTools\n'],
  [{ name: 'AI' }],
  0,
  false,
  { name: 'AI' }
]

const show = value => {
  try {
    return JSON.stringify(value)
  } catch (err) {
    return String(value)
  }
}

check('listProblem answers the same on every case', () => {
  for (const value of CASES) {
    assert.deepStrictEqual(
      process_.listProblem(value),
      calendar.listProblem(value),
      `the two copies disagree about ${show(value)}`
    )
  }
})

check('listValues answers the same on every case the contract allows', () => {
  // Both copies say "call listProblem first. This assumes what that function
  // checks." So the cases listValues is defined over are the ones listProblem
  // passes, and running it over the rest would be testing outside the contract
  // rather than testing the copies.
  const allowed = CASES.filter(v => process_.listProblem(v) === null)
  assert.ok(allowed.length >= 6, 'too few allowed cases for this to prove anything')

  for (const value of allowed) {
    assert.deepStrictEqual(
      process_.listValues(value),
      calendar.listValues(value),
      `the two copies disagree about ${show(value)}`
    )
  }
})

check('outside the contract, both copies fail the same way', () => {
  // Not a contract this pins, but a real property worth knowing: neither copy
  // quietly returns something usable when handed what listProblem would have
  // rejected. If one ever starts coping, the two have diverged in the direction
  // that is hardest to notice.
  const refused = CASES.filter(v => process_.listProblem(v) !== null)
  assert.ok(refused.length >= 3, 'too few refused cases for this to prove anything')

  for (const value of refused) {
    const one = (() => { try { return { value: process_.listValues(value) } } catch (err) { return { threw: err.constructor.name } } })()
    const two = (() => { try { return { value: calendar.listValues(value) } } catch (err) { return { threw: err.constructor.name } } })()
    assert.deepStrictEqual(one, two, `the two copies behave differently on ${show(value)}`)
  }
})

check('the cases actually exercise both outcomes, so agreement means something', () => {
  // Two functions that both return null on everything also "agree". This asserts
  // the case list reaches a problem, a clean answer, and a trim, so the check
  // above is comparing behaviour rather than comparing two constants.
  const problems = CASES.map(v => process_.listProblem(v)).filter(Boolean)
  assert.ok(problems.some(p => p.kind === 'not-a-list'), 'no case reaches not-a-list')
  assert.ok(problems.some(p => p.kind === 'not-a-name'), 'no case reaches not-a-name')
  assert.ok(CASES.some(v => process_.listProblem(v) === null && Array.isArray(v) && v.length), 'no case is a clean non-empty list')
  assert.deepStrictEqual(process_.listValues([' Enterprise ']), ['Enterprise'], 'the trim is not being exercised')
})

console.log(failures ? `\n${failures} failed.\n` : '\nAll passed.\n')
process.exit(failures ? 1 : 0)

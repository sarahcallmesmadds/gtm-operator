'use strict'

/**
 * `scope`, `repeats`, `candidates`, `draft` and `fill`, and the backfill mode
 * they all write through.
 *
 * WHAT THIS DOES NOT PROVE. Nothing here has been sent. Backfill reads Slack,
 * email, a document store and a call recorder, and this suite has read none of
 * them: what it proves is what the plugin is allowed to ask for and what it
 * would write, not that any of those surfaces answers the way it expects.
 *
 * THE PAIR THIS SUITE EXISTS FOR. Backfill mode is a refusal in `problems` and
 * a skipped block in `properties`, and the dangerous way for those to drift is
 * one direction only: a refusal that stops nothing while the payload still
 * writes the verification stamp, so an unread import reads as verified. Both
 * halves are asserted here, and so is the control that shows a create without
 * the flag still stamps.
 *
 * Run: node tests/process-backfill.test.js
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const assert = require('assert')

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'gtm-backfill-'))
process.env.GTM_OPERATOR_CONFIG = path.join(SANDBOX, 'gtm-operator.config.json')

const setupSchema = require('../plugins/setup/scripts/schema')
const artifact = require('../plugins/process/scripts/artifact')
const backfill = require('../plugins/process/scripts/backfill')
const schema = require('../shared/process-schema')
const processNames = setupSchema.identityNames('process')

const writeConfig = ({ names = processNames, personId = 'person-1' } = {}) => {
  fs.writeFileSync(process.env.GTM_OPERATOR_CONFIG, JSON.stringify({
    configVersion: 3,
    state: 'complete',
    notion: { parentPageId: 'p', personId },
    databases: {
      process: {
        databaseId: 'db1', dataSourceId: 'ds1', displayName: 'Process',
        properties: names.properties, values: names.values
      }
    },
    verified: { at: 'x', definitions: 'y' },
    defaults: {}, sources: {}, taxonomyPath: '/tmp/x'
  }, null, 2))
  for (const mod of ['../shared/config-read', '../plugins/process/scripts/process']) {
    delete require.cache[require.resolve(mod)]
  }
  return require('../plugins/process/scripts/process')
}

let command = writeConfig()

const contextNow = () => {
  delete require.cache[require.resolve('../shared/config-read')]
  const fresh = require('../shared/config-read')
  return fresh.contextFor('process', schema.IDENTITY)
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

const capture = (fn) => {
  const printed = []
  const real = console.log
  console.log = (...args) => printed.push(args.join(' '))
  try { fn() } finally { console.log = real }
  return JSON.parse(printed.join('\n'))
}

const write = (name, value) => {
  const file = path.join(SANDBOX, name)
  fs.writeFileSync(file, JSON.stringify(value))
  return file
}

/**
 * Every refusal as `field:kind`.
 *
 * NOT THE KIND ALONE. Three refusals in `plan` share the kind `missing` and
 * three more in `draft` do, so a check matching on the kind passes for a fault
 * in a field it does not name. Reasoning case by case about which kinds happen
 * to be unique today is the wrong fix: a kind that is unique today becomes
 * shared the next time one is added, and nothing goes red when it does.
 */
const faults = out => (out.refusals || []).map(one => `${one.field}:${one.kind}`)

const URL_A = 'https://notion.so/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1'

/** A window that is valid, so a test about something else is not about dates. */
const WINDOW = { from: '2026-01-01', to: '2026-06-01' }

console.log('\nscope, repeats, candidates, draft and fill\n')

// --------------------------------------------------------------------- scope

check('a scope naming no source is refused, because there is nothing to point it at', () => {
  const out = backfill.plan({})
  assert.deepStrictEqual(out.refusals.map(one => `${one.field}:${one.kind}`), ['sources:missing'])
  assert.strictEqual(out.ok, false)
})

check('an unknown source is refused rather than skipped', () => {
  const out = backfill.plan({ sources: ['confluence'] })
  assert.ok(faults(out).includes('sources:unknown-source'), JSON.stringify(faults(out)))
  // Skipping it would report on less material than was asked about without saying so.
  assert.strictEqual(out.ok, false)
})

check('DIRECT MESSAGES CANNOT BE READ AS A GROUP', () => {
  for (const dms of ['all', true]) {
    const out = backfill.plan({ sources: ['slack'], slack: { channels: 'all', dms, ...WINDOW }, ways: ['sweep'] })
    assert.ok(faults(out).includes('slack:dms-all'), `dms: ${JSON.stringify(dms)} was allowed`)
    // ASSERTING THE REFUSAL IS NOT ASSERTING THE OUTCOME. The refusal was
    // recorded and `reading.slack` stood there anyway with an empty `dms`, so
    // the same output said ok: false, said nothing is read, and handed back a
    // narrowed plan that runs. A check that stops at the refusal passes on that.
    assert.deepStrictEqual(out.reading, {}, 'a refused scope handed back a runnable plan')
  }
})

check('A REFUSED PLAN CARRIES NO PLAN, whichever source was refused', () => {
  const out = backfill.plan({
    sources: ['documents', 'email'],
    documents: { where: 'Drive/GTM' },
    email: { mailbox: 'ceo@example.com', ...WINDOW },
    ways: ['sweep']
  })
  assert.strictEqual(out.ok, false)
  // The documents source is perfectly valid and still does not survive. Reading
  // the good half of a refused scope is reading a scope nobody agreed to.
  assert.deepStrictEqual(out.reading, {})
  assert.deepStrictEqual(out.ways, [])
})

check('A LIST ENTRY THAT IS NOT A NAME IS REFUSED, NOT DROPPED', () => {
  // Dropping one is narrowing, and it arrives through the helper rather than
  // through the scope, so every list that goes through it is checked here.
  const cases = [
    ['sources', { sources: ['slack', 42], slack: { channels: 'all', ...WINDOW }, ways: ['sweep'] }, 'not-a-name'],
    ['slack', { sources: ['slack'], slack: { channels: ['#gtm', 42], ...WINDOW }, ways: ['sweep'] }, 'channel-not-a-name'],
    ['slack', { sources: ['slack'], slack: { channels: 'all', dms: ['with Tom', 42], ...WINDOW }, ways: ['sweep'] }, 'dm-not-a-name'],
    ['ways', { sources: ['slack'], slack: { channels: 'all', ...WINDOW }, ways: ['sweep', 42] }, 'not-a-name'],
    ['topics', { sources: ['slack'], slack: { channels: 'all', ...WINDOW }, ways: ['topics'], topics: ['refunds', 42] }, 'not-a-name']
  ]
  for (const [field, request, kind] of cases) {
    const out = backfill.plan(request)
    assert.ok(
      out.refusals.some(one => one.field === field && one.kind === kind),
      `${field}/${kind} was dropped rather than refused: ${JSON.stringify(out.refusals.map(one => `${one.field}:${one.kind}`))}`
    )
    assert.deepStrictEqual(out.reading, {}, `${field}/${kind} was refused and a plan came back anyway`)
  }
})

check('A DATE THAT IS WRITTEN AS ONE AND IS NOT ONE IS REFUSED, and says which fault it is', () => {
  // `Date.parse` takes 2026-02-30 and hands back the 2nd of March, so a range
  // set to end in February would have read two days into March. Nothing
  // downstream could catch that: there is no approval gate in front of a read.
  const rolled = backfill.plan({ sources: ['email'], email: { from: '2026-02-01', to: '2026-02-30' }, ways: ['sweep'] })
  assert.deepStrictEqual(
    rolled.refusals.map(one => `${one.field}:${one.kind}`),
    ['email:range-not-a-day']
  )
  // A missing date is a different fault and gets a different wording. One
  // message blaming two causes sends somebody looking in the wrong place.
  const absent = backfill.plan({ sources: ['email'], email: { to: '2026-06-01' }, ways: ['sweep'] })
  assert.deepStrictEqual(
    absent.refusals.map(one => `${one.field}:${one.kind}`),
    ['email:range-open']
  )
})

check('named direct messages are read, and only the named ones', () => {
  const out = backfill.plan({
    sources: ['slack'],
    slack: { channels: ['#gtm'], dms: ['with Priya', 'with Tom'], ...WINDOW },
    ways: ['sweep']
  })
  assert.strictEqual(out.ok, true, JSON.stringify(out.refusals))
  assert.deepStrictEqual(out.reading.slack.dms, ['with Priya', 'with Tom'])
})

check('THERE IS NO UNBOUNDED READ: each end of the range is refused separately', () => {
  const neither = backfill.plan({ sources: ['email'], email: {}, ways: ['sweep'] })
  assert.deepStrictEqual(faults(neither), ['email:range-open', 'email:range-open'], JSON.stringify(faults(neither)))

  const halfOpen = backfill.plan({ sources: ['email'], email: { from: '2026-01-01' }, ways: ['sweep'] })
  assert.ok(faults(halfOpen).includes('email:range-open'), 'an open-ended range was accepted')
})

check('a backwards range is refused, because reading nothing looks like a workspace with nothing in it', () => {
  const out = backfill.plan({
    sources: ['email'], email: { from: '2026-06-01', to: '2026-01-01' }, ways: ['sweep']
  })
  assert.ok(faults(out).includes('email:range-backwards'), JSON.stringify(faults(out)))
})

check('a mailbox that is not the user\'s own is refused', () => {
  const out = backfill.plan({
    sources: ['email'], email: { mailbox: 'ceo@example.com', ...WINDOW }, ways: ['sweep']
  })
  assert.ok(faults(out).includes('email:mailbox-not-own'), JSON.stringify(faults(out)))
  assert.strictEqual(out.reading.email, undefined, 'a refused mailbox still ended up in the read plan')
})

check('call recordings need the recorder named, because setup does not assume one', () => {
  const without = backfill.plan({ sources: ['recordings'], recordings: WINDOW, ways: ['sweep'] })
  assert.ok(faults(without).includes('recordings:recorder-unnamed'), JSON.stringify(faults(without)))

  const with_ = backfill.plan({ sources: ['recordings'], recordings: { recorder: 'granola', ...WINDOW }, ways: ['sweep'] })
  assert.strictEqual(with_.ok, true, JSON.stringify(with_.refusals))
  assert.strictEqual(with_.reading.recordings.recorder, 'granola')
})

check('slack needs channels said out loud, and "all" is one of the two answers', () => {
  const silent = backfill.plan({ sources: ['slack'], slack: { ...WINDOW }, ways: ['sweep'] })
  assert.ok(faults(silent).includes('slack:channels-unset'), JSON.stringify(faults(silent)))

  const all = backfill.plan({ sources: ['slack'], slack: { channels: 'all', ...WINDOW }, ways: ['sweep'] })
  assert.strictEqual(all.ok, true, JSON.stringify(all.refusals))
  assert.strictEqual(all.reading.slack.channels, 'all')
})

check('a document store is sorted rather than searched, so it needs no way of looking', () => {
  const out = backfill.plan({ sources: ['documents'], documents: { where: 'Drive/GTM handbook' } })
  assert.strictEqual(out.ok, true, JSON.stringify(out.refusals))
  assert.deepStrictEqual(out.ways, [])
})

check('a document store still has to say where it is', () => {
  const out = backfill.plan({ sources: ['documents'], documents: {} })
  assert.ok(faults(out).includes('documents:unlocated'), JSON.stringify(faults(out)))
})

check('a conversation source with no way of looking through it is refused', () => {
  const out = backfill.plan({ sources: ['slack'], slack: { channels: 'all', ...WINDOW } })
  // Scoped to the field as well as the kind. Three different refusals use the
  // kind "missing", so asserting the kind alone passes on any of them and this
  // check would go green for a fault in a field it does not name.
  assert.ok(
    out.refusals.some(one => one.field === 'ways' && one.kind === 'missing'),
    JSON.stringify(out.refusals.map(one => `${one.field}:${one.kind}`))
  )
})

check('a way of looking with nothing to look through is refused', () => {
  // The three ways read conversations. A document store is sorted rather than
  // searched, so naming a way alongside one and nothing else asks for something
  // that cannot happen, and running it as a no-op would report a sweep that
  // never swept.
  const out = backfill.plan({ sources: ['documents'], documents: { where: 'Drive/GTM' }, ways: ['sweep'] })
  assert.ok(
    out.refusals.some(one => one.field === 'ways' && one.kind === 'nothing-to-look-through'),
    JSON.stringify(out.refusals.map(one => `${one.field}:${one.kind}`))
  )
})

check('topics handed over without choosing that way are refused, not quietly used', () => {
  const out = backfill.plan({
    sources: ['slack'], slack: { channels: 'all', ...WINDOW }, ways: ['sweep'], topics: ['refunds']
  })
  assert.ok(faults(out).includes('ways:topics-unused'), JSON.stringify(faults(out)))
})

check('choosing the topics way without naming topics is refused', () => {
  const out = backfill.plan({ sources: ['slack'], slack: { channels: 'all', ...WINDOW }, ways: ['topics'] })
  assert.deepStrictEqual(faults(out), ['topics:missing'])
})

check('TOPICS GETS THE SHAPE GUARD EVERY OTHER LIST HAS', () => {
  // `sources`, `channels`, `dms` and `ways` each refuse a value that is not a
  // list. `topics` did not, so a bare string fell through to "no topics were
  // named" and reported a missing list to somebody looking straight at one.
  // The check above would have gone green for that, because both come back
  // under `topics`, which is why it asserts the whole refusal list now.
  const out = backfill.plan({
    sources: ['slack'], slack: { channels: 'all', ...WINDOW }, ways: ['topics'], topics: 'refunds'
  })
  assert.deepStrictEqual(faults(out), ['topics:not-a-list'])
})

check('WHAT IS NOT BEING READ IS SAID, source by source and way by way', () => {
  const out = backfill.plan({ sources: ['documents'], documents: { where: 'Drive/GTM' } })
  const said = out.notReading.join(' ')
  for (const absent of ['Slack', 'Email', 'Call recordings']) {
    assert.ok(said.includes(absent), `${absent} was left out silently:\n${said}`)
  }
  for (const way of backfill.WAYS) {
    assert.ok(said.includes(`"${way}"`), `the ${way} way was left out silently`)
  }
})

check('a refused scope exits non-zero, so nothing downstream treats it as a plan', () => {
  process.exitCode = 0
  capture(() => command.commands.scope(write('scope-bad.json', { sources: [] })))
  assert.strictEqual(process.exitCode, 1)
  process.exitCode = 0
})

// ------------------------------------------------------------------- repeats

const ASKINGS = [
  { question: 'how do we handle refunds', where: '#support thread 1', when: '2026-03-01' },
  { question: 'how do we handle refunds for annual plans', where: '#support thread 2', when: '2026-04-01' },
  { question: 'how do we handle refunds again', where: '#cs thread 3', when: '2026-05-01' },
  { question: 'who owns inbound lead routing', where: '#gtm thread 4', when: '2026-05-02' }
]

check('a question asked three times clusters and one asked once does not', () => {
  const out = backfill.repeats(ASKINGS)
  assert.strictEqual(out.ok, true, JSON.stringify(out.refusals))
  assert.strictEqual(out.clusters.length, 1, JSON.stringify(out.clusters.map(c => c.question)))
  assert.strictEqual(out.clusters[0].asked, 3)
  assert.strictEqual(out.below.length, 1)
  assert.strictEqual(out.below[0].asked, 1)
})

check('twice is not repeated, and the minimum is the reason', () => {
  const twice = ASKINGS.slice(0, 2)
  assert.strictEqual(backfill.repeats(twice).clusters.length, 0)
  // The same two clear it when the minimum is lowered, so the count is what
  // decided this and not the clustering.
  assert.strictEqual(backfill.repeats(twice, { min: 2 }).clusters.length, 1)
})

check('EVERY ASKING KEEPS WHERE IT WAS SAID', () => {
  const out = backfill.repeats(ASKINGS)
  const where = out.clusters[0].where.map(one => one.where)
  assert.deepStrictEqual(where, ['#support thread 1', '#support thread 2', '#cs thread 3'])
  assert.ok(out.clusters[0].where.every(one => one.when), 'a cluster lost the date an asking carried')
})

check('an asking that cannot be traced back is refused, and nothing is clustered', () => {
  const out = backfill.repeats([...ASKINGS, { question: 'how do we handle refunds too' }])
  assert.strictEqual(out.ok, false)
  assert.deepStrictEqual(faults(out), ['askings[4]:provenance-missing'])
  assert.strictEqual(out.clusters.length, 0, 'a run with an untraceable asking still produced clusters')
})

check('the clustering threshold is reported as unmeasured', () => {
  const out = backfill.repeats(ASKINGS)
  assert.strictEqual(out.thresholdIsMeasured, false)
  assert.strictEqual(out.threshold, backfill.REPEAT_SIMILARITY)
})

// ---------------------------------------------------------------- candidates

const FOUND = [
  { what: 'Refund handling', where: '#support thread 1', kind: 'conversation', type: 'SOP/ROE' },
  { what: 'Refund handling steps', where: '#cs thread 3', kind: 'conversation' },
  { what: 'Inbound lead routing', where: '#gtm thread 4', kind: 'conversation', type: 'SOP/ROE' }
]

check('a candidate that cannot be traced back is refused', () => {
  const out = backfill.candidates([{ what: 'Refund handling' }])
  assert.deepStrictEqual(faults(out), ['found[0]:provenance-missing'])
  assert.strictEqual(out.candidates.length, 0)
})

check('an unknown type is refused here rather than at write time', () => {
  const out = backfill.candidates([{ what: 'x', where: '#a', type: 'Runbook' }])
  assert.deepStrictEqual(faults(out), ['found[0]:unknown-type'])
})

check('an absent type is a question, not a refusal', () => {
  const out = backfill.candidates(FOUND)
  assert.strictEqual(out.ok, true, JSON.stringify(out.refusals))
  assert.deepStrictEqual(out.needType, ['c2'])
  assert.deepStrictEqual(out.candidates[1].needs, ['type'])
})

check('two descriptions of the same thing in one run are reported to each other', () => {
  const out = backfill.candidates(FOUND)
  assert.strictEqual(out.withinRunNearMatches.length, 1, JSON.stringify(out.withinRunNearMatches))
  assert.deepStrictEqual(
    [out.withinRunNearMatches[0].a, out.withinRunNearMatches[0].b],
    ['c1', 'c2']
  )
})

check('THE LIBRARY DUPLICATE CHECK IS THE ONE `new` USES, and the note says to run it', () => {
  const out = capture(() => command.commands.candidates(write('found.json', FOUND)))
  assert.ok(/`duplicates`/.test(out.note) && /`judge`/.test(out.note), out.note)
  // One mechanism rather than two: no separate import-tracking anything.
  assert.ok(!/import/i.test(JSON.stringify(out.candidates)), 'a candidate carries import-tracking state')
})

// --------------------------------------------------------------------- draft

const SOURCES = [
  { what: '#support thread 2026-03-01', contributed: 'the approval threshold' },
  { what: 'Weekly CS sync, 2026-04-02', contributed: 'who signs off above it' }
]

const SOP_BODY = {
  Scope: 'Refunds on self-serve plans.',
  'Trigger Condition': 'A customer asks for a refund within 30 days.',
  Steps: 'Check the plan, check the date, refund in Stripe.',
  'System Behavior': 'Stripe emails the customer.',
  Exceptions: 'none known'
}

const draftOf = extra => backfill.draft({
  what: 'Refund handling',
  type: 'SOP/ROE',
  Description: 'How refunds get approved and issued.',
  sources: SOURCES,
  body: SOP_BODY,
  ...extra
})

check('a draft is marked as a backfill and carries no person or verification field', () => {
  const out = draftOf()
  assert.strictEqual(out.ok, true, JSON.stringify(out.problems))
  assert.strictEqual(out.artifact.backfill, true)
  for (const field of [...schema.PERSON_FIELDS, ...schema.VERIFICATION_FIELDS]) {
    assert.ok(!(field in out.artifact), `${field} reached a backfill draft`)
  }
})

check('THE SOURCES SECTION IS GENERATED FROM THE SOURCES, not written beside them', () => {
  const out = draftOf({ body: { ...SOP_BODY, Sources: 'Some reading I did' } })
  assert.strictEqual(out.artifact.body.Sources, artifact.sourcesSection(SOURCES))
  for (const source of SOURCES) {
    assert.ok(out.artifact.body.Sources.includes(source.what), `${source.what} is not in the section`)
    assert.ok(out.artifact.body.Sources.includes(source.contributed), `what ${source.what} contributed is not in the section`)
  }
  assert.ok(!out.artifact.body.Sources.includes('Some reading I did'), 'a hand-written Sources section survived')
})

check('A MALFORMED SOURCE IS REFUSED BEFORE THE SECTION IS BUILT', () => {
  // `sourcesSection` drops an entry it cannot render. Building first and
  // validating after handed back a refusal that correctly said the list was
  // wrong, alongside an artifact whose Sources section had already been built
  // from the narrowed list, so the section and the record disagreed.
  for (const bad of [42, null, { what: 'a thread' }, { contributed: 'the threshold' }]) {
    const out = backfill.draft({
      what: 'Refund handling',
      type: 'SOP/ROE',
      sources: [...SOURCES, bad],
      body: SOP_BODY
    })
    assert.strictEqual(out.ok, false, `${JSON.stringify(bad)} was accepted as a source`)
    assert.strictEqual(out.artifact, null, `a draft built from a narrowed source list came back for ${JSON.stringify(bad)}`)
    assert.ok(
      faults(out).some(one => one.startsWith('Sources:source-')),
      `${JSON.stringify(bad)} was dropped rather than refused: ${JSON.stringify(faults(out))}`
    )
  }
})

check('a draft with nothing to substantiate it is refused', () => {
  assert.deepStrictEqual(faults(backfill.draft({ what: 'x', type: 'SOP/ROE', body: SOP_BODY })), ['sources:missing'])
})

check('EVERY FIELD A BACKFILL WILL NOT TAKE IS REFUSED BY `draft`, not just the person half', () => {
  // Iterated rather than named, because naming one is how this was missed:
  // `draft` refused the two person fields and then dropped `Verified date` and
  // `Last checked for accuracy` through a whitelist that did not include them.
  // The refusal in `artifact.js` was correct and unreachable from here.
  assert.ok(backfill.REFUSED_ON_A_BACKFILL.length >= 4, 'the refused list shrank')
  for (const field of backfill.REFUSED_ON_A_BACKFILL) {
    const out = draftOf({ [field]: field === 'Owner' || field === 'Verified by' ? ['11111111-1111-1111-1111-111111111111'] : '2026-08-23' })
    assert.strictEqual(out.ok, false, `${field} was accepted by draft`)
    assert.strictEqual(out.artifact, null, `a draft carrying ${field} was still handed back`)
    assert.ok(
      faults(out).some(one => one.startsWith(`${field}:backfill-`)),
      `${field} was dropped rather than refused: ${JSON.stringify(faults(out))}`
    )
  }
})

check('A HAND-WRITTEN BACKFILL ROW IS REFUSED TOO, not only one `draft` built', () => {
  // `draft` refuses a sourceless backfill before `problems` ever sees one, so
  // without this the refusal in `artifact.js` is never reached by anything and
  // could be deleted with the suite still green. It is the gate for the other
  // caller: a person writing the JSON by hand and running `create` directly.
  const { sources: _dropped, ...unsourced } = draftOf().artifact
  const found = artifact.problems(unsourced)
  assert.deepStrictEqual(found.map(one => one.kind), ['backfill-unsourced'])
})

check('a person field cannot ride through the draft as an empty string', () => {
  // The refusal above reads '' as nobody asking for anything, which is the
  // convention everywhere else. What must not then happen is the copy-through
  // putting the key on the artifact anyway: the field list `draft` copies is a
  // whitelist, and a person field is not on it.
  const out = draftOf({ Owner: '' })
  assert.strictEqual(out.ok, true, JSON.stringify(out.problems || out.refusals))
  assert.ok(!('Owner' in out.artifact), 'an empty Owner rode through onto a backfilled artifact')
})

check('the sections still to be written are reported, not invented', () => {
  const out = draftOf({ body: { Scope: 'Refunds on self-serve plans.' } })
  assert.strictEqual(out.ok, false)
  const missing = out.problems.map(one => one.field)
  assert.ok(missing.includes('Steps'), JSON.stringify(missing))
  assert.ok(!missing.includes('Scope'), 'a section that was written was reported missing')
})

check('what is deliberately left empty is named, and why', () => {
  const out = draftOf()
  for (const field of [...schema.VERIFICATION_FIELDS, 'Owner']) {
    assert.ok(out.leftEmpty.includes(field), `${field} is left empty and nothing says so`)
  }
  assert.ok(/never-verified/.test(out.leftEmptyNote), out.leftEmptyNote)
})

// ------------------------------------------------- backfill mode, both halves

check('A BACKFILL WRITES NO STAMP AND NO PERSON', () => {
  const context = contextNow()
  const built = artifact.properties(context, draftOf().artifact, { today: '2026-08-23' })
  for (const field of [...schema.VERIFICATION_FIELDS, 'Owner']) {
    assert.ok(!(context.property(field) in built), `${field} was written onto a backfilled page`)
  }
})

check('THE CONTROL: the same artifact without the flag does stamp and does own', () => {
  const context = contextNow()
  const { backfill: _flag, ...notBackfilled } = draftOf().artifact
  const built = artifact.properties(context, notBackfilled, { today: '2026-08-23' })
  for (const field of ['Last checked for accuracy', 'Verified date', 'Owner', 'Verified by']) {
    assert.ok(context.property(field) in built, `${field} is missing from an ordinary create, so the test above proves nothing`)
  }
})

check('an owner on a backfill row is refused by problems, which is the other half of that pair', () => {
  const found = artifact.problems({ ...draftOf().artifact, Owner: ['11111111-1111-1111-1111-111111111111'] })
  assert.deepStrictEqual(found.map(one => one.kind), ['backfill-person'])
})

check('a verification field on a backfill row is refused', () => {
  const found = artifact.problems({ ...draftOf().artifact, 'Verified date': '2026-08-23' })
  assert.deepStrictEqual(found.map(one => one.kind), ['backfill-verification'])
})

check('`backfill: "false"` IS REFUSED RATHER THAN READ AS TRUTHY', () => {
  // A truthiness test would turn the mode off here while everything printed
  // still said backfill, which is the one shape that must never be guessed at.
  const found = artifact.problems({ ...draftOf().artifact, backfill: 'false' })
  assert.deepStrictEqual(found.map(one => one.kind), ['not-a-boolean'])
})

check('a Sources section that disagrees with the sources is refused', () => {
  const row = draftOf().artifact
  const found = artifact.problems({ ...row, body: { ...row.body, Sources: '- something else: made up' } })
  assert.deepStrictEqual(found.map(one => one.kind), ['backfill-sources-disagree'])
})

check('create says it is a backfill, and prove reads the mode from the same file', () => {
  const final = draftOf().artifact
  const file = write('backfilled.json', final)
  const sent = capture(() => command.commands.create(file))
  assert.strictEqual(sent.backfill, true)
  assert.ok(/never-verified/.test(sent.backfillNote), sent.backfillNote)

  const out = capture(() => command.commands.prove(
    file,
    write('back.json', { url: URL_A, properties: sent.properties, headings: sent.headings })
  ))
  assert.strictEqual(out.proved, true, JSON.stringify(out.problems))
})

check('THE READ PATH CANNOT DIVERGE FROM THE WRITE PATH: prove expects no stamp either', () => {
  // Rebuilt from the same artifact file, so a `prove` that derived its expected
  // properties in create mode would look for a stamp the page correctly lacks.
  const final = draftOf().artifact
  const context = contextNow()
  const sent = capture(() => command.commands.create(write('backfilled2.json', final)))
  assert.ok(!(context.property('Verified date') in sent.properties), 'the create payload carried a stamp')
  const out = capture(() => command.commands.prove(
    write('backfilled2.json', final),
    write('back2.json', { url: URL_A, properties: sent.properties, headings: sent.headings })
  ))
  assert.strictEqual(out.proved, true, JSON.stringify(out.problems))
})

check('A BACKFILLED PAGE THAT CAME BACK STAMPED IS NOT PROVED', () => {
  // The check above feeds back exactly what was sent, which has no stamp on it,
  // so it can only ever pass. Its name claimed `prove` guards the read side and
  // its fixture made that assertion unreachable: the page it hands back is
  // incapable of carrying the thing the check is named for.
  //
  // `prove` walks the properties that were INTENDED, and on a backfill the four
  // that matter are intended to be absent. Nothing was looking at what came back
  // carrying them.
  const final = draftOf().artifact
  const context = contextNow()
  const sent = capture(() => command.commands.create(write('backfilled3.json', final)))

  for (const logical of backfill.REFUSED_ON_A_BACKFILL) {
    const out = capture(() => command.commands.prove(
      write('backfilled3.json', final),
      write('back3.json', {
        url: URL_A,
        properties: { ...sent.properties, [context.property(logical)]: '2026-08-23' },
        headings: sent.headings
      })
    ))
    assert.strictEqual(out.proved, false, `a backfilled page came back carrying ${logical} and was proved`)
    assert.ok(
      out.problems.some(one => one.what === context.property(logical)),
      `${logical} was on the page and no problem named it: ${JSON.stringify(out.problems)}`
    )
  }
  process.exitCode = 0
})

// ---------------------------------------------------------------------- fill

const EXISTING = {
  url: URL_A,
  Name: 'Refund handling',
  Type: 'SOP/ROE',
  Description: 'The version a person wrote.',
  Domain: null,
  Tags: []
}

check('fill fills what is blank', () => {
  const out = backfill.fill(EXISTING, { Domain: 'Customer Success', Tags: ['refunds'] })
  assert.strictEqual(out.ok, true, JSON.stringify(out))
  assert.deepStrictEqual(out.filling.sort(), ['Domain', 'Tags'])
  assert.strictEqual(out.after.Domain, 'Customer Success')
})

check('IT NEVER OVERWRITES, and says what it declined to touch', () => {
  const out = backfill.fill(EXISTING, { Description: 'What a machine would have said' })
  assert.strictEqual(out.after.Description, undefined, 'a filled field was overwritten')
  assert.deepStrictEqual(out.refused.map(one => one.field), ['Description'])
  assert.strictEqual(out.refused[0].holding, 'The version a person wrote.')
})

check('an empty list counts as blank, and a filled one does not', () => {
  assert.ok(backfill.fill(EXISTING, { Tags: ['refunds'] }).filling.includes('Tags'))
  const full = backfill.fill({ ...EXISTING, Tags: ['billing'] }, { Tags: ['refunds'] })
  assert.deepStrictEqual(full.refused.map(one => one.field), ['Tags'])
})

check('`fill` REFUSES THE SAME LIST `draft` DOES, on a blank row as much as on a full one', () => {
  // The same missed pair, on the other path. `fill` looked at the person fields
  // and ignored the other two, so offering `Verified date` came back as a
  // finished no-op with an empty `refused` list.
  for (const field of backfill.REFUSED_ON_A_BACKFILL) {
    const out = backfill.fill(EXISTING, { [field]: '2026-08-23' })
    assert.deepStrictEqual(out.refused.map(one => one.field), [field], `${field} was ignored rather than refused`)
    assert.strictEqual(out.after[field], undefined, `backfill filled ${field}`)
  }
})

check('`reviewed` is false, because nobody re-read anything', () => {
  assert.strictEqual(backfill.fill(EXISTING, { Domain: 'Customer Success' }).after.reviewed, false)
})

check('a row with no url is refused, because nothing could say which page it is', () => {
  const out = backfill.fill({ ...EXISTING, url: undefined }, { Domain: 'Customer Success' })
  assert.strictEqual(out.ok, false)
  assert.deepStrictEqual(faults(out), ['url:missing'])
})

check('A REFUSED FILL EXITS NON-ZERO, and a finished one does not', () => {
  // `fill` puts a missing url under `refusals` and everything it declined to
  // touch under `refused`, and the exit code read only the first. So a fill
  // refused for carrying `Verified date` printed the refusal and exited zero,
  // which is the same quiet exit-zero shape the raw-candidate case had.
  for (const field of backfill.REFUSED_ON_A_BACKFILL) {
    process.exitCode = 0
    capture(() => command.commands.fill(
      write('exit-row.json', EXISTING),
      write('exit-cand.json', { [field]: '2026-08-23' })
    ))
    assert.strictEqual(process.exitCode, 1, `a fill refused for ${field} exited zero`)
  }

  // A FIELD THAT IS ALREADY OCCUPIED IS BACKFILL WORKING, not a fault. On a
  // re-run over the same folder most fields are occupied, so exiting non-zero on
  // that would cry wolf on every normal run and the case above would disappear
  // into the noise. Both land in `refused` and only one is a fault.
  process.exitCode = 0
  const declined = capture(() => command.commands.fill(
    write('exit-row.json', EXISTING),
    write('exit-cand2.json', { Description: 'already occupied' })
  ))
  assert.strictEqual(process.exitCode, 0, 'declining to overwrite an occupied field was reported as a failure')
  assert.deepStrictEqual(declined.refused.map(one => one.kind), ['occupied'])
  assert.deepStrictEqual(declined.neverFilled, [])
})

check('filling nothing is a finished answer rather than a failure', () => {
  const out = backfill.fill(EXISTING, { Description: 'x' })
  assert.strictEqual(out.ok, false)
  assert.strictEqual(out.refusals, undefined, 'nothing to fill was reported as a refusal')
  assert.ok(/finished answer/.test(out.emptyNote), out.emptyNote)
})

check('A RAW-KEYED ROW IS REFUSED ON BOTH SIDES, not just the one that was fetched', () => {
  // Asserting only the `existing` side is a check that passes without checking
  // the half it does not name. A raw-keyed CANDIDATE is the quieter failure:
  // every value on it is invisible, nothing is filled, and the output says
  // there was nothing to fill and exits zero.
  const renamed = {
    properties: Object.fromEntries(Object.keys(processNames.properties).map(k => [k, `R ${k}`])),
    values: processNames.values
  }
  const renamedCommand = writeConfig({ names: renamed })
  const rawRow = { url: URL_A, 'R Description': 'The version a person wrote.' }
  const logicalRow = { url: URL_A, Description: 'The version a person wrote.' }

  assert.throws(
    () => renamedCommand.commands.fill(write('raw-existing.json', rawRow), write('cand-ok.json', { Domain: 'Customer Success' })),
    /normaliseRows/,
    'a raw-keyed existing row was read as blank and offered for filling'
  )
  // EVERY FIELD `fill` READS, not one of them. The guard was built from
  // `UPDATABLE_FIELDS`, which holds `Owner` and none of the other three fields a
  // backfill refuses, so a candidate carrying the workspace's name for
  // `Verified date` walked through the guard and was then invisible to the thing
  // the guard exists to protect. Checking one field kept the suite green over it.
  for (const field of [...backfill.FILLABLE, ...backfill.REFUSED_ON_A_BACKFILL]) {
    assert.throws(
      () => renamedCommand.commands.fill(
        write('row-ok.json', logicalRow),
        write('raw-cand.json', { [`R ${field}`]: 'anything' })
      ),
      /normaliseRows/,
      `a raw-keyed candidate carrying ${field} offered nothing and that was reported as nothing to fill`
    )
    assert.throws(
      () => renamedCommand.commands.fill(
        write('raw-row2.json', { url: URL_A, [`R ${field}`]: 'anything' }),
        write('cand-ok2.json', { Domain: 'Customer Success' })
      ),
      /normaliseRows/,
      `a raw-keyed existing row carrying ${field} read as blank`
    )
  }
  command = writeConfig()
})

check('WHAT FILL PRODUCES DRIVES `update`, AND MOVES NO VERIFICATION FIELD', () => {
  const out = backfill.fill(EXISTING, { Domain: 'Customer Success' })
  const sent = capture(() => command.commands.update(
    write('before.json', EXISTING),
    write('after.json', out.after),
    '2026-08-23'
  ))
  assert.deepStrictEqual(sent.changed, ['Domain'])
  assert.deepStrictEqual(sent.verificationFields, [], 'a backfilled edit stamped the artifact as checked')
  assert.strictEqual(sent.reviewed, false)
  const context = contextNow()
  for (const field of schema.VERIFICATION_FIELDS) {
    assert.ok(!(context.property(field) in sent.properties), `${field} was written by a fill`)
  }
})

check('A NON-REVIEW EDIT IS PROVED BY THE THREE THAT DID NOT MOVE', () => {
  // `update` sends none of the three on a `reviewed: false` edit, so the loop
  // that walks what was sent never looks at them, and a page that came back
  // freshly stamped read as a clean write. `fill` leans on that promise for
  // every artifact it touches.
  const context = contextNow()
  const before = { ...EXISTING, 'Last checked for accuracy': '2026-01-01' }
  const after = backfill.fill(before, { Domain: 'Customer Success' }).after
  const sent = capture(() => command.commands.update(
    write('before-v.json', before),
    write('after-v.json', after),
    '2026-08-23'
  ))
  assert.deepStrictEqual(sent.verificationFields, [])

  const clean = capture(() => command.commands['prove-update'](
    write('sent-v.json', sent),
    write('back-v.json', {
      url: URL_A,
      properties: { ...sent.properties, [context.property('Last checked for accuracy')]: '2026-01-01' }
    })
  ))
  assert.strictEqual(clean.proved, true, JSON.stringify(clean.problems))

  const stamped = capture(() => command.commands['prove-update'](
    write('sent-v.json', sent),
    write('back-v2.json', {
      url: URL_A,
      properties: { ...sent.properties, [context.property('Last checked for accuracy')]: '2026-08-23' }
    })
  ))
  assert.strictEqual(stamped.proved, false, 'a stamp moved on a non-review edit and that was proved as clean')
  process.exitCode = 0
})

check('A STAMP LANDING ON A FIELD THAT WAS EMPTY IS CAUGHT, which is the backfill case', () => {
  // The round-6 check watched a populated field changing. A backfilled artifact
  // has all three EMPTY by design, which is what makes the never-verified signal
  // work, so empty becoming populated is the transition that matters and it was
  // the one going unwatched: an empty field dropped out of `verificationBefore`
  // entirely and was reported as unknown rather than compared.
  const context = contextNow()
  const before = { ...EXISTING }
  for (const field of schema.VERIFICATION_FIELDS) delete before[field]
  const after = backfill.fill(before, { Domain: 'Customer Success' }).after
  const sent = capture(() => command.commands.update(
    write('before-e.json', before),
    write('after-e.json', after),
    '2026-08-23'
  ))

  for (const field of schema.VERIFICATION_FIELDS) {
    const out = capture(() => command.commands['prove-update'](
      write('sent-e.json', sent),
      write('back-e.json', {
        url: URL_A,
        properties: { ...sent.properties, [context.property(field)]: '2026-08-23' }
      })
    ))
    assert.strictEqual(out.proved, false, `${field} appeared on a page that had none and that was proved as clean`)
    assert.ok(
      out.problems.some(one => one.includes(context.property(field))),
      `${field} appeared and no problem named it: ${JSON.stringify(out.problems)}`
    )
  }

  // And the clean case still passes, so the check above is not just always red.
  const clean = capture(() => command.commands['prove-update'](
    write('sent-e.json', sent),
    write('back-e2.json', { url: URL_A, properties: sent.properties })
  ))
  assert.strictEqual(clean.proved, true, JSON.stringify(clean.problems))
  process.exitCode = 0
})

check('AN ABSENT PROPERTY IS NOT REPORTED AS A CLEARED ONE', () => {
  // Notion leaves an empty property off a page and a summary read-back leaves
  // everything off, so the two are indistinguishable. Calling either a cleared
  // field reports a clean edit as a failure, which is the false positive this
  // file has been corrected for before.
  const before = { ...EXISTING, 'Last checked for accuracy': '2026-01-01' }
  const after = backfill.fill(before, { Domain: 'Customer Success' }).after
  const sent = capture(() => command.commands.update(
    write('before-v3.json', before),
    write('after-v3.json', after),
    '2026-08-23'
  ))
  const out = capture(() => command.commands['prove-update'](
    write('sent-v3.json', sent),
    write('back-v3.json', { url: URL_A, properties: sent.properties })
  ))
  assert.strictEqual(out.proved, true, JSON.stringify(out.problems))
  assert.ok(
    out.unchecked.some(one => /Last checked for accuracy/.test(one)),
    `it passed without saying it could not check the stamp: ${JSON.stringify(out.unchecked)}`
  )
})

console.log(failures ? `\n${failures} failed.\n` : '\nAll passed.\n')
process.exit(failures ? 1 : 0)

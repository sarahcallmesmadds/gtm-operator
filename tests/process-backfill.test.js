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
const named = list => (list || []).map(one => `${one.field}:${one.kind}`)

/**
 * Every refusal as `field:kind`.
 *
 * NOT THE KIND ALONE. Three refusals in `plan` share the kind `missing` and
 * three more in `draft` do, so a check matching on the kind passes for a fault
 * in a field it does not name. Reasoning case by case about which kinds happen
 * to be unique today is the wrong fix: a kind that is unique today becomes
 * shared the next time one is added, and nothing goes red when it does.
 *
 * `named` takes any of the three containers. Round 3 fixed this for `refusals`
 * and left `problems` and `refused` matching bare kinds, which is the same fault
 * in a different container: exactly the pair shape the rest of this branch keeps
 * hitting.
 */
const faults = out => named(out.refusals)

const URL_A = 'https://notion.so/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1'
const URL_B = 'https://notion.so/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2'

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
  // AND `topics`. Naming two of the three left the third half of a broad change
  // unwatched, which is the same shape as every guard on this branch that
  // covered some of what it was for.
  assert.deepStrictEqual(out.topics, [])
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
  assert.deepStrictEqual(named(found), ['Sources:backfill-unsourced'])
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
  assert.deepStrictEqual(named(found), ['Owner:backfill-person'])
})

check('a verification field on a backfill row is refused', () => {
  const found = artifact.problems({ ...draftOf().artifact, 'Verified date': '2026-08-23' })
  assert.deepStrictEqual(named(found), ['Verified date:backfill-verification'])
})

check('AN EMPTIED PERSON FIELD IS ASKING FOR NOBODY, which is what a backfill is', () => {
  // `[]` is what `update` writes to clear a person field and what `wantsAPerson`
  // already reads as asking for no one. The backfill refusals skipped only
  // undefined, null and '', so an artifact whose owner had been deliberately
  // cleared was refused with a message saying an owner was set on it.
  const row = draftOf().artifact
  for (const field of backfill.REFUSED_ON_A_BACKFILL) {
    // `'[]'` IS IN THIS LIST BECAUSE IT WAS THE ONE MISSING. Notion returns an
    // empty list as a JSON array inside a string, `wantsAPerson` and `anyPerson`
    // both already read it as asking for nobody, and the copy of this test in
    // `artifact.js` did not, so an owner that had already been emptied was
    // refused for being set.
    for (const emptied of [[], null, '', '[]']) {
      assert.deepStrictEqual(
        artifact.problems({ ...row, [field]: emptied }),
        [],
        `${field} set to ${JSON.stringify(emptied)} was refused as though somebody had filled it in`
      )
    }
    // And a real value is still refused, so the line above is not just off.
    assert.ok(
      artifact.problems({ ...row, [field]: ['11111111-1111-1111-1111-111111111111'] }).length,
      `${field} carrying a value was accepted`
    )
  }
})

check('A NAMED PARENT IS CARRIED INTO THE DRAFT, so the rule Notion cannot check still runs', () => {
  // Dropped, `problems` saw no parent, the only-a-Strategy-Decision rule never
  // ran, and the person who named one had every reason to think it was taken.
  const wrong = backfill.draft({
    what: 'Refund handling', type: 'SOP/ROE', sources: SOURCES, body: SOP_BODY,
    parent: 'https://notion.so/parent', parentType: 'Enablement'
  })
  assert.strictEqual(wrong.ok, false, 'an Enablement was accepted as a parent')
  assert.ok(named(wrong.problems).includes('parent:parent-wrong-type'), JSON.stringify(named(wrong.problems)))

  const unTyped = backfill.draft({
    what: 'Refund handling', type: 'SOP/ROE', sources: SOURCES, body: SOP_BODY,
    parent: 'https://notion.so/parent'
  })
  assert.ok(named(unTyped.problems).includes('parent:parent-type-unknown'), JSON.stringify(named(unTyped.problems)))

  const right = backfill.draft({
    what: 'Refund handling', type: 'SOP/ROE', sources: SOURCES, body: SOP_BODY,
    parent: 'https://notion.so/parent', parentType: 'Strategy Decision'
  })
  assert.strictEqual(right.ok, true, JSON.stringify(right.problems))
  assert.strictEqual(right.artifact.parent, 'https://notion.so/parent')

  // AND IT HAS TO SURVIVE THE NEXT GATE, which is where checking that the key
  // is present stops being enough. `draft` validates with the `parentType` it
  // was handed and `create` re-validates with the artifact's own, so copying
  // the parent and not its type let a valid parent pass here and be refused one
  // step later for a type that had been supplied and checked.
  const sent = capture(() => command.commands.create(write('parented.json', right.artifact)))
  assert.strictEqual(sent.parentRelation, 'https://notion.so/parent')
})

check('`backfill: "false"` IS REFUSED RATHER THAN READ AS TRUTHY', () => {
  // A truthiness test would turn the mode off here while everything printed
  // still said backfill, which is the one shape that must never be guessed at.
  const found = artifact.problems({ ...draftOf().artifact, backfill: 'false' })
  assert.deepStrictEqual(named(found), ['backfill:not-a-boolean'])
})

check('a Sources section that disagrees with the sources is refused', () => {
  const row = draftOf().artifact
  const found = artifact.problems({ ...row, body: { ...row.body, Sources: '- something else: made up' } })
  assert.deepStrictEqual(named(found), ['Sources:backfill-sources-disagree'])
})

check('create says it is a backfill, and prove reads the mode from the same file', () => {
  const final = draftOf().artifact
  const file = write('backfilled.json', final)
  const sent = capture(() => command.commands.create(file))
  assert.strictEqual(sent.backfill, true)
  assert.ok(/never-verified/.test(sent.backfillNote), sent.backfillNote)

  const out = capture(() => command.commands.prove(
    file,
    write('back.json', { url: URL_A, properties: sent.properties, headings: sent.headings }),
    URL_A
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
  , URL_A))
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
      }),
      URL_A
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
  const out = backfill.fill(EXISTING, { Domain: 'Customer Success', Tags: ['AI'] })
  assert.strictEqual(out.ok, true, JSON.stringify(out))
  assert.deepStrictEqual(out.filling.sort(), ['Domain', 'Tags'])
  assert.strictEqual(out.after.Domain, 'Customer Success')
})

check('IT NEVER OVERWRITES, and says what it declined to touch', () => {
  const out = backfill.fill(EXISTING, { Description: 'What a machine would have said' })
  assert.strictEqual(out.after.Description, undefined, 'a filled field was overwritten')
  assert.deepStrictEqual(named(out.refused), ['Description:occupied'])
  assert.strictEqual(out.refused[0].holding, 'The version a person wrote.')
})

check('an empty list counts as blank, and a filled one does not', () => {
  assert.ok(backfill.fill(EXISTING, { Tags: ['AI'] }).filling.includes('Tags'))
  const full = backfill.fill({ ...EXISTING, Tags: ['Data'] }, { Tags: ['AI'] })
  assert.deepStrictEqual(named(full.refused), ['Tags:occupied'])
})

check('`fill` REFUSES THE SAME LIST `draft` DOES, on a blank row as much as on a full one', () => {
  // The same missed pair, on the other path. `fill` looked at the person fields
  // and ignored the other two, so offering `Verified date` came back as a
  // finished no-op with an empty `refused` list.
  for (const field of backfill.REFUSED_ON_A_BACKFILL) {
    const out = backfill.fill(EXISTING, { [field]: '2026-08-23' })
    assert.deepStrictEqual(named(out.refused), [`${field}:never-filled`], `${field} was ignored rather than refused`)
    assert.strictEqual(out.after, null, `a fill refused for ${field} still handed back a runnable row`)
  }
})

check('A NEVER-FILLED REFUSAL EMPTIES THE WHOLE UPDATE, rather than narrowing it to the rest', () => {
  // Offering each refused field ALONE is what the check above does, and alone it
  // proves only that the refusal was recorded: `filling` is empty either way, so
  // an answer that narrows and an answer that refuses are the same shape. The
  // case that tells them apart is a refused field beside a fillable one, and
  // nothing asked for it. `neverFilled` moved the exit code and moved nothing
  // else, so this came back `ok: true` with a runnable `after` holding the
  // Domain change and the refusal sitting next to it.
  for (const field of backfill.REFUSED_ON_A_BACKFILL) {
    const out = backfill.fill(EXISTING, { Domain: 'Customer Success', [field]: '2026-08-23' })
    assert.strictEqual(out.ok, false, `a fill refused for ${field} was runnable because Domain was fillable`)
    assert.strictEqual(out.after, null, `${field} was narrowed out and the Domain change was still handed over`)
    assert.deepStrictEqual(out.filling, [], `${field} was refused and Domain was still listed as being filled`)
    assert.deepStrictEqual(out.neverFilled, [field])
  }

  // AND THE FILLABLE HALF ON ITS OWN STILL GOES THROUGH, or the check above
  // passes against a `fill` that refuses everything.
  const fine = backfill.fill(EXISTING, { Domain: 'Customer Success' })
  assert.strictEqual(fine.ok, true)
  assert.strictEqual(fine.after.Domain, 'Customer Success')
})

check('a refused fill claims no finished answer, because the exit code calls it a failure', () => {
  // `emptyNote` was written when a refused fill exited zero. Round 11 moved the
  // exit code to non-zero and left the wording alone, so the command failed
  // while the note beside it said the run was a finished answer rather than a
  // failure, and gave a reason (empty, or already holding something) that was
  // not the one that applied.
  for (const field of backfill.REFUSED_ON_A_BACKFILL) {
    const out = backfill.fill(EXISTING, { [field]: '2026-08-23' })
    assert.ok(!out.emptyNote, `a fill refused for ${field} called itself a finished answer: ${out.emptyNote}`)
    assert.ok(out.note.includes(field), `the refusal did not say which field stopped it: ${out.note}`)
  }

  // DECLINING TO OVERWRITE IS STILL A FINISHED ANSWER, which is the case the
  // note exists for and the one that exits zero.
  assert.ok(/finished answer/.test(backfill.fill(EXISTING, { Description: 'x' }).emptyNote))
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
  assert.deepStrictEqual(named(declined.refused), ['Description:occupied'])
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
  // EVERY FIELD `fill` READS, from the one list it reads them from. Assembled
  // here out of two of the three lists, it passed without checking `Name` and
  // `Type`, which `fill` reads to judge the values it hands over.
  //
  // THE LIST ITSELF IS PINNED FIRST. A loop over the list under test cannot
  // catch that list shrinking: delete a name from it and the loop simply checks
  // one field fewer, still green. That is a check defeated by deleting the thing
  // it watches, which this repository has been caught by before.
  for (const required of ['Name', 'Type', ...backfill.FILLABLE, ...backfill.REFUSED_ON_A_BACKFILL]) {
    assert.ok(
      backfill.READ_BY_FILL.includes(required),
      `${required} is read by fill and is not in READ_BY_FILL, so the guard does not watch it`
    )
  }

  for (const field of backfill.READ_BY_FILL) {
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

check('draft and fill agree with it, rather than each carrying their own copy', () => {
  for (const field of backfill.REFUSED_ON_A_BACKFILL) {
    assert.strictEqual(draftOf({ [field]: [] }).ok, true, `draft refused an emptied ${field}`)
    assert.deepStrictEqual(backfill.fill(EXISTING, { [field]: [] }).refused, [], `fill refused an emptied ${field}`)
  }
})

check('`update` REFUSES A RAW-KEYED ROW FOR THE FIELDS IT ONLY READS', () => {
  // The three verification fields are not updatable and never were, so the
  // guard was built without them, and then `verificationBefore` started reading
  // them off the same row. On a raw-keyed row all three come back absent, get
  // recorded as empty, and `prove-update` reports a stamp that never moved as
  // one that appeared out of nowhere.
  const renamed = {
    properties: Object.fromEntries(Object.keys(processNames.properties).map(k => [k, `R ${k}`])),
    values: processNames.values
  }
  const renamedCommand = writeConfig({ names: renamed })
  for (const field of schema.VERIFICATION_FIELDS) {
    assert.throws(
      () => renamedCommand.commands.update(
        write('raw-before-v.json', { url: URL_A, [`R ${field}`]: '2026-01-01' }),
        write('after-raw-v.json', { reviewed: false, Domain: 'Customer Success' }),
        '2026-08-23'
      ),
      /normaliseRows/,
      `a raw-keyed ${field} was read as empty and recorded as the before value`
    )
  }
  command = writeConfig()
})


check('AN EMPTY LIST THAT CAME BACK AS `[]` IN A STRING IS STILL EMPTY', () => {
  // Notion returns an empty list three ways and `listOfNames` records all
  // three. Every hand-written copy of this test covered absent and the empty
  // string and missed the JSON array inside a string, which is the one that was
  // measured, so a person property that came back as `'[]'` read as a value
  // where the plugin had deliberately left none.
  const final = draftOf().artifact
  const context = contextNow()
  const sent = capture(() => command.commands.create(write('empty-shapes.json', final)))

  for (const shape of [undefined, null, '', '[]', []]) {
    const properties = { ...sent.properties }
    for (const logical of backfill.REFUSED_ON_A_BACKFILL) {
      if (shape !== undefined) properties[context.property(logical)] = shape
    }
    const out = capture(() => command.commands.prove(
      write('empty-shapes.json', final),
      write('empty-back.json', { url: URL_A, properties, headings: sent.headings })
    , URL_A))
    assert.strictEqual(out.proved, true, `a backfilled page whose fields came back as ${JSON.stringify(shape)} was not proved: ${JSON.stringify(out.problems)}`)
  }
  process.exitCode = 0
})

check('`check` EXITS NON-ZERO WHEN IT REFUSES, like every other gate here', () => {
  // It printed `writable: false` and exited zero, so a caller reading the status
  // rather than the body carried on toward the write it had just refused.
  process.exitCode = 0
  const refused = capture(() => command.commands.check(
    write('unwritable.json', { ...draftOf().artifact, Owner: ['11111111-1111-1111-1111-111111111111'] })
  ))
  assert.strictEqual(refused.writable, false)
  assert.strictEqual(process.exitCode, 1, 'check refused an artifact and exited zero')

  // A concern is a question for a person, not a precondition, so it must not
  // move the exit code. Without this the fix turns every long artifact into an
  // error.
  process.exitCode = 0
  const clean = capture(() => command.commands.check(write('writable.json', draftOf().artifact)))
  assert.strictEqual(clean.writable, true)
  assert.strictEqual(process.exitCode, 0, 'a writable artifact exited non-zero')
})


check('`prove-update` READS `[]`-IN-A-STRING AS EMPTY TOO, not as a changed value', () => {
  // Masked on the equal path, because `compareProperty` turns both sides into
  // lists and calls them the same. It is reached when the before value held
  // somebody and the page came back empty: read naively, `'[]'` is not empty,
  // so a verification field that Notion returned as an empty list was reported
  // as one that changed on an edit that never touched it.
  const context = contextNow()
  const before = { ...EXISTING, 'Verified by': ['user://11111111-1111-1111-1111-111111111111'] }
  const after = backfill.fill(before, { Domain: 'Customer Success' }).after
  const sent = capture(() => command.commands.update(
    write('before-sq.json', before),
    write('after-sq.json', after),
    '2026-08-23'
  ))

  const out = capture(() => command.commands['prove-update'](
    write('sent-sq.json', sent),
    write('back-sq.json', {
      url: URL_A,
      properties: { ...sent.properties, [context.property('Verified by')]: '[]' }
    })
  ))
  assert.strictEqual(out.proved, true, `an empty list returned as a string was read as a change: ${JSON.stringify(out.problems)}`)
  assert.ok(
    out.unchecked.some(one => /Verified by/.test(one)),
    `it passed without saying it could not tell emptied from unsaved: ${JSON.stringify(out.unchecked)}`
  )
  process.exitCode = 0
})


check('WHAT `fill` HANDS BACK IS SOMETHING `update` WILL TAKE', () => {
  // The values come off a candidate a model built and were copied into `after`
  // unread, so `{ Tags: "refunds" }` came back ok, listed under `filling`, and
  // died in `update` with Tags:not-a-list. The end-to-end check only ever filled
  // `Domain`, so it never touched a multi-select at all.
  const bad = [
    [{ Tags: 'AI' }, 'Tags:not-a-list'],
    [{ Tags: ['not a tag'] }, 'Tags:unknown-value'],
    [{ Domain: 'Nowhere' }, 'Domain:unknown-value'],
    [{ 'Review cadence': 'Hourly' }, 'Review cadence:unknown-value'],
    [{ Audience: 'AE' }, 'Audience:not-a-list']
  ]
  for (const [candidate, expected] of bad) {
    const out = backfill.fill(EXISTING, candidate)
    assert.strictEqual(out.ok, false, `${expected} was accepted`)
    assert.strictEqual(out.after, null, `${expected} came back with a runnable after row`)
    assert.ok(faults(out).includes(expected), `${expected} not reported: ${JSON.stringify(faults(out))}`)
  }

  // And every fillable field still works when the value is real, so the check
  // above is not just refusing everything.
  // `Description` IS CHECKED AGAINST A ROW THAT HAS NONE. It is the only
  // fillable field that is plain text, and on `EXISTING` it is already occupied,
  // so it never reaches the value check there. `properties` writes it with
  // `String(...)`, so an object reached Notion as the literal "[object Object]"
  // with nothing downstream reporting it.
  const blankDescription = { ...EXISTING, Description: null }
  for (const value of [{ text: 'a description' }, 42, true, ['a']]) {
    const out = backfill.fill(blankDescription, { Description: value })
    assert.strictEqual(out.ok, false, `Description ${JSON.stringify(value)} was accepted`)
    assert.strictEqual(out.after, null, `Description ${JSON.stringify(value)} came back with a runnable after row`)
    assert.deepStrictEqual(faults(out), ['Description:not-text'])
  }
  assert.ok(
    backfill.fill(blankDescription, { Description: 'real text' }).filling.includes('Description'),
    'a real description was refused'
  )

  const good = { Domain: 'Customer Success', Tags: ['AI'], Audience: ['AE'], 'Review cadence': 'Monthly' }
  const out = backfill.fill(EXISTING, good)
  assert.strictEqual(out.ok, true, JSON.stringify(out.refusals))
  const sent = capture(() => command.commands.update(
    write('before-fv.json', EXISTING),
    write('after-fv.json', out.after),
    '2026-08-23'
  ))
  assert.deepStrictEqual(sent.changed.sort(), ['Audience', 'Domain', 'Review cadence', 'Tags'])
})


check('AN EMPTY MULTI-SELECT RETURNED AS `[]` IN A STRING IS STILL A BLANK', () => {
  // The seventh copy of the emptiness rule, and it missed the same shape as the
  // six before it. Notion returns an empty multi-select as a JSON array inside a
  // string, so the field read as occupied and was never filled: the one thing
  // this command is for, refused for the value Notion actually returns.
  for (const empty of [[], null, '', '[]']) {
    const out = backfill.fill({ ...EXISTING, Tags: empty }, { Tags: ['AI'] })
    assert.ok(out.filling.includes('Tags'), `Tags holding ${JSON.stringify(empty)} was read as occupied`)
  }
  // A real value is still occupied, so the line above is not just always true.
  const held = backfill.fill({ ...EXISTING, Tags: ['Data'] }, { Tags: ['AI'] })
  assert.deepStrictEqual(named(held.refused), ['Tags:occupied'])
})

check('A ROW WITH NO IDENTITY IS REFUSED, not filtered down to nothing', () => {
  // `problems` reported the missing Name or Type and the bad-values filter
  // dropped it, because neither is a field being filled. So a before row missing
  // its identity came back ok with a runnable after, and `update` restored the
  // identity from that same incomplete row and refused it.
  for (const field of ['Name', 'Type']) {
    const before = { ...EXISTING }
    delete before[field]
    const out = backfill.fill(before, { Domain: 'Customer Success' })
    assert.strictEqual(out.ok, false, `a row with no ${field} was accepted`)
    assert.strictEqual(out.after, null, `a row with no ${field} came back with a runnable after row`)
    assert.deepStrictEqual(faults(out), [`${field}:missing`])
  }
})


check('A `sources` THAT IS NOT A LIST IS REFUSED FOR THAT, not reported as no sources', () => {
  // `sourceProblems` already refuses a sources that is not a list, and `draft`
  // normalised every such value to [] before it could ever see one. So
  // sources: "Drive/GTM" came back as sources:missing, telling somebody they
  // recorded nothing when they had recorded one in the wrong shape, and the
  // refusal written for that case was unreachable from this caller.
  for (const sources of ['not a list', 42, true, { where: 'Drive/GTM' }]) {
    const out = backfill.draft({ Name: 'Refund policy', Type: 'SOP/ROE', sources })
    assert.deepStrictEqual(faults(out), ['sources:not-a-list'], `sources of ${JSON.stringify(sources)}`)
  }

  // ABSENT AND EMPTY ARE STILL MISSING, which is the case the original refusal
  // was written for, and a real list still drafts.
  for (const sources of [undefined, null, []]) {
    const out = backfill.draft({ Name: 'Refund policy', Type: 'SOP/ROE', sources })
    assert.deepStrictEqual(faults(out), ['sources:missing'], `sources of ${JSON.stringify(sources)}`)
  }
  const fine = backfill.draft({
    Name: 'Refund policy',
    Type: 'SOP/ROE',
    sources: [{ what: 'refunds.doc', contributed: 'the steps' }],
    body: { Scope: 'a', 'Trigger Condition': 'b', Steps: 'c', 'System Behavior': 'd', Exceptions: 'e' }
  })
  assert.deepStrictEqual(faults(fine), [])
  assert.strictEqual(fine.ok, true, JSON.stringify(fine.problems))
})

check('A NAME THAT IS NOT TEXT IS REFUSED FOR THAT, not reported as no name at all', () => {
  // The same function already told not-text from missing for Description and did
  // not for the title, so a Name that arrived as an object was reported as no
  // name, sending somebody to supply one they can see is already there. The
  // title is written with String(), so an object would have become the literal
  // "[object Object]" as the page's title.
  for (const name of [{ a: 1 }, ['R'], 42, true]) {
    assert.deepStrictEqual(
      artifact.problems({ Name: name, Type: 'SOP/ROE' }).filter(one => one.field === 'Name').map(one => one.kind),
      ['not-text'],
      `a Name of ${JSON.stringify(name)} was reported as missing`
    )
  }

  // ABSENT AND BLANK ARE STILL MISSING, which is the case the original refusal
  // was written for, and a real name is still fine.
  for (const name of [undefined, null, '', '   ']) {
    assert.deepStrictEqual(
      artifact.problems({ Name: name, Type: 'SOP/ROE' }).filter(one => one.field === 'Name').map(one => one.kind),
      ['missing'],
      `a Name of ${JSON.stringify(name)} was not reported as missing`
    )
  }
  assert.deepStrictEqual(artifact.problems({ Name: 'Refund policy', Type: 'SOP/ROE' }).filter(one => one.field === 'Name'), [])

  // AND IT NEVER REACHES THE WRITE, where String() would have made a title of it.
  const context = { property: field => field, value: (field, value) => value, personId: null }
  assert.throws(
    () => artifact.properties(context, { Name: { a: 1 }, Type: 'SOP/ROE' }, { defaultsPerson: false }),
    /is not text/
  )
})

check('EVERY BACKFILL COMMAND REFUSES A FILE OF THE WRONG SHAPE', () => {
  // Declared per command rather than swept across all twenty-one reads, so each
  // one is a decision with a check behind it. These five are the ones this
  // branch added. The rest of the plugin still reads without declaring, which is
  // recorded rather than assumed.
  const wrongForFields = write('wrong-fields.json', ['not', 'a', 'set', 'of', 'fields'])
  const wrongForList = write('wrong-list.json', { not: 'a list' })
  const row = write('shape-row.json', EXISTING)

  const takesFields = [
    ['scope', file => command.commands.scope(file)],
    ['draft', file => command.commands.draft(file)],
    ['fill candidate', file => command.commands.fill(row, file)],
    ['fill existing', file => command.commands.fill(file, write('shape-cand.json', { Domain: 'CS' }))]
  ]
  for (const [name, run] of takesFields) {
    assert.throws(() => run(wrongForFields), /read as a set of fields/, `${name} accepted a list`)
  }

  const takesList = [
    ['repeats', file => command.commands.repeats(file)],
    ['candidates', file => command.commands.candidates(file)]
  ]
  for (const [name, run] of takesList) {
    assert.throws(() => run(wrongForList), /read as a list/, `${name} accepted a set of fields`)
  }

  // AND EVERY ONE OF THEM STILL RUNS ON THE RIGHT SHAPE, or the loops above pass
  // against commands that refuse everything.
  assert.doesNotThrow(() => capture(() => command.commands.scope(write('shape-scope.json', { sources: [] }))))
  assert.doesNotThrow(() => capture(() => command.commands.repeats(write('shape-askings.json', []))))
  assert.doesNotThrow(() => capture(() => command.commands.candidates(write('shape-found.json', []))))
  process.exitCode = 0
})

check('`readJson` REFUSES A FILE OF THE WRONG SHAPE, and refuses nothing unless asked', () => {
  // Valid JSON of the wrong shape is the failure this plugin has been corrected
  // for five times. A list where a set of fields was expected has none of those
  // fields, every one reads as absent, and absent means leave it alone nearly
  // everywhere here, so the run reports there was nothing to do and exits zero.
  const asFields = write('shape-fields.json', { Domain: 'Customer Success' })
  const asList = write('shape-list.json', ['Customer Success'])
  const asText = write('shape-text.json', 'Customer Success')
  const asNull = write('shape-null.json', null)

  // ASKED NOTHING, REFUSES NOTHING. A caller that does not declare a shape gets
  // exactly what it got before, which is what makes declaring it safe to do one
  // command at a time rather than as a sweep nobody reviewed.
  for (const file of [asFields, asList, asText, asNull]) {
    assert.doesNotThrow(() => command.readJson(file, 'the thing'))
  }

  assert.doesNotThrow(() => command.readJson(asFields, 'the candidate', 'fields'))
  assert.doesNotThrow(() => command.readJson(asList, 'the rows', 'list'))

  for (const [file, what] of [[asList, 'a list'], [asText, 'a piece of text'], [asNull, 'null']]) {
    assert.throws(
      () => command.readJson(file, 'the candidate', 'fields'),
      one => one.message.includes(what) && one.message.includes('set of fields'),
      `${what} was accepted where a set of fields was expected`
    )
  }

  for (const [file, what] of [[asFields, 'a set of fields'], [asText, 'a piece of text'], [asNull, 'null']]) {
    assert.throws(
      () => command.readJson(file, 'the rows', 'list'),
      one => one.message.includes(what) && one.message.includes('read as a list'),
      `${what} was accepted where a list was expected`
    )
  }

  // AND IT STILL SAYS WHICH OF THE THREE THINGS WENT WRONG, rather than folding
  // a missing file and unparseable text into the new answer.
  assert.throws(() => command.readJson('nowhere.json', 'the candidate', 'fields'), /Could not read/)
  const broken = path.join(SANDBOX, 'shape-broken.json')
  fs.writeFileSync(broken, '{ not json')
  assert.throws(() => command.readJson(broken, 'the candidate', 'fields'), /not valid JSON/)
})

check('NEITHER SIDE OF `fill` IS READ AS A ROW UNLESS IT IS ONE', () => {
  // Third of this shape on the branch, after the mailbox and the body. It went
  // two ways at once: a candidate of [] has none of the fillable fields, so
  // nothing was refused, nothing was filled, and the run called itself a
  // finished answer and exited zero, dropping an approved fill in silence. A
  // candidate that was a string, a number or a boolean threw a raw TypeError out
  // of the `in` operator instead.
  for (const bad of [[], 'a string', 42, true, null, undefined]) {
    const out = backfill.fill(EXISTING, bad)
    assert.strictEqual(out.ok, false, `a candidate of ${JSON.stringify(bad)} was runnable`)
    assert.deepStrictEqual(faults(out), ['candidate:not-a-candidate'], JSON.stringify(bad))
    assert.ok(!out.emptyNote, `a candidate of ${JSON.stringify(bad)} called itself a finished answer`)
  }

  // THE ROW SIDE REFUSED ALL FOUR ALREADY, as url:missing, which is true and
  // sends somebody to fix the wrong thing: a row that is not a row has not
  // mislaid its url.
  for (const bad of [[], 'a string', 42, true, null]) {
    const out = backfill.fill(bad, { Domain: 'Customer Success' })
    assert.deepStrictEqual(faults(out), ['existing:not-a-row'], JSON.stringify(bad))
  }

  // AND A ROW THAT IS A ROW AND HAS NO URL KEEPS ITS OWN REFUSAL, or the check
  // above passes against a fill that answers not-a-row for everything.
  assert.deepStrictEqual(faults(backfill.fill({ Name: 'R', Type: 'SOP/ROE' }, { Domain: 'CS' })), ['url:missing'])

  // OFFERING NOTHING IS STILL A FINISHED ANSWER. `{}` is a real candidate that
  // happens to carry no fields, and it is the case the empty note exists for.
  const nothing = backfill.fill(EXISTING, {})
  assert.deepStrictEqual(faults(nothing), [])
  assert.ok(/finished answer/.test(nothing.emptyNote))

  // THROUGH THE COMMAND IT NEVER GETS THIS FAR NOW, and that is the better
  // answer rather than a competing one. `readJson` refuses the file at the door
  // and says what it actually holds, which is a more useful thing to be told
  // than that the candidate is not a candidate. Both nets are kept: this one
  // catches a file, and the refusals above catch any caller handing `fill` a
  // value directly, which the test above and `draft` both do.
  assert.throws(
    () => command.commands.fill(write('cont-row.json', EXISTING), write('cont-cand.json', [])),
    /read as a set of fields/,
    'a list handed to the fill command was not refused at the door'
  )

  // AND A REAL FILL STILL RUNS THROUGH THE COMMAND, or the throw above is a
  // command that refuses every candidate it is given.
  process.exitCode = 0
  const ran = capture(() => command.commands.fill(
    write('cont-row2.json', EXISTING),
    write('cont-cand2.json', { Domain: 'Customer Success' })
  ))
  assert.strictEqual(process.exitCode, 0, JSON.stringify(ran.refusals))
  assert.deepStrictEqual(ran.filling, ['Domain'])
})

check('`[]`-IN-A-STRING IS ASKING FOR NOBODY HERE TOO, and `check` and the write agree about it', () => {
  // The eighth reader of the emptiness rule and the one that never got it.
  // `'[]'` is what Notion returns for an empty person field, so a row fetched
  // with an empty Owner and handed straight back read as a request for a person
  // literally named "[]". `check` saw nothing wrong, because it does not judge
  // person values, and `properties` then threw on the same file.
  assert.deepStrictEqual(artifact.peopleAsked('[]'), [], "'[]' was read as a person named []")

  // THREE ANSWERS, NOT TWO, AND THIS IS WHY IT IS `[]` AND NOT null. null means
  // nobody asked, so the default person may be applied. An empty list means
  // somebody asked for nobody, so the field is left alone. Folding the two
  // together puts the config person back onto an owner that was just cleared.
  assert.strictEqual(artifact.peopleAsked(undefined), null)
  assert.strictEqual(artifact.peopleAsked('me'), null)
  assert.deepStrictEqual(artifact.peopleAsked([]), [])

  const context = { property: name => name, value: (field, value) => value, personId: 'user://DEFAULT' }
  const full = {
    Name: 'Refund policy',
    Type: 'SOP/ROE',
    body: { Scope: 'a', 'Trigger Condition': 'b', Steps: 'c', 'System Behavior': 'd', Exceptions: 'e' }
  }

  for (const cleared of ['[]', []]) {
    const out = artifact.properties(context, { ...full, Owner: cleared }, { defaultsPerson: true })
    assert.strictEqual(out.Owner, undefined, `an Owner cleared with ${JSON.stringify(cleared)} was reassigned`)
  }

  // AND THE DEFAULT STILL APPLIES WHEN NOBODY ASKED, or the check above passes
  // against a properties that never writes an owner at all.
  const defaulted = artifact.properties(context, { ...full }, { defaultsPerson: true })
  assert.deepStrictEqual(defaulted.Owner, ['user://DEFAULT'])

  // The gate and the write agree now: check passed this row before, and the
  // write threw on it.
  assert.deepStrictEqual(artifact.problems({ ...full, Owner: '[]' }), [])
})

check('A BODY THAT IS NOT A SET OF SECTIONS IS REFUSED, not read as an untouched one', () => {
  // The partial-body rule reads an absent section as "not sent, leave it alone".
  // A body that is not a map indexes to undefined for EVERY heading, so the
  // whole edit read as untouched: no problems, an empty rendered body, empty
  // headings, and nothing for prove-update to check, which means the dropped
  // edit could come back proved. Same shape as the mailbox finding one round
  // earlier, a guard whose cases are all well-formed.
  for (const body of ['not an object', [], 42, true]) {
    const row = { Name: 'Refund policy', Type: 'SOP/ROE', body }
    assert.deepStrictEqual(
      artifact.problems(row, { partialBody: true }).map(one => `${one.field}:${one.kind}`),
      ['body:not-a-section-map'],
      `a body of ${JSON.stringify(body)} was read as an untouched one`
    )
    // AND ON THE CREATE PATH TOO, where it read as every section missing and so
    // was refused for the wrong reason.
    assert.ok(
      artifact.problems(row).some(one => one.kind === 'not-a-section-map'),
      `a body of ${JSON.stringify(body)} was not refused on a create`
    )
  }

  // AND THROUGH EVERY CALLER THAT REACHES IT, not just the function that holds
  // it. `draft` spread the body into the artifact before handing it over, and
  // `{ ...'a string' }` is a map of index to character, so the refusal could
  // never fire through that path and what came back was five section-missing
  // problems naming the wrong fault. Calling `problems` directly is half a pair.
  const sources = [{ what: 'refunds.doc', contributed: 'the steps and the exceptions' }]
  for (const body of ['not an object', [], 42, true]) {
    const drafted = backfill.draft({ Name: 'Refund policy', Type: 'SOP/ROE', body, sources })
    assert.strictEqual(drafted.ok, false, `draft accepted a body of ${JSON.stringify(body)}`)
    assert.strictEqual(drafted.artifact, null, `draft built an artifact from a body of ${JSON.stringify(body)}`)
    assert.deepStrictEqual(
      drafted.refusals.map(one => `${one.field}:${one.kind}`),
      ['body:not-a-section-map'],
      `draft named the wrong fault for a body of ${JSON.stringify(body)}`
    )
  }

  // A DRAFT WITH A REAL BODY STILL DRAFTS, and one with no body at all is still
  // the every-section-missing case, or the loop above passes against a draft
  // that refuses every body it is given.
  const wholeBody = { Scope: 'a', 'Trigger Condition': 'b', Steps: 'c', 'System Behavior': 'd', Exceptions: 'e' }
  const fine = backfill.draft({ Name: 'Refund policy', Type: 'SOP/ROE', body: wholeBody, sources })
  assert.strictEqual(fine.ok, true, JSON.stringify(fine.problems))
  const bodyless = backfill.draft({ Name: 'Refund policy', Type: 'SOP/ROE', sources })
  assert.deepStrictEqual(bodyless.refusals, [], 'a draft with no body was refused as malformed')
  assert.ok(bodyless.problems.some(one => one.kind === 'section-missing'))

  // A REAL PARTIAL EDIT STILL GOES THROUGH, and still renders the section it
  // carries, or the refusal above is just a body check that refuses everything.
  const good = { Name: 'Refund policy', Type: 'SOP/ROE', body: { Steps: '1. Check the order date.' } }
  assert.deepStrictEqual(artifact.problems(good, { partialBody: true }), [])
  assert.deepStrictEqual(artifact.expectedHeadings(good, { partialBody: true }), ['Steps'])
  assert.strictEqual(artifact.body(good, { partialBody: true }).length, 1)

  // An absent body is still untouched, and a section supplied blank is still the
  // case the original check was written for.
  assert.deepStrictEqual(artifact.problems({ Name: 'Refund policy', Type: 'SOP/ROE' }, { partialBody: true }), [])
  assert.ok(artifact.problems({ Name: 'Refund policy', Type: 'SOP/ROE', body: { Steps: '   ' } }, { partialBody: true })
    .some(one => one.field === 'Steps' && one.kind === 'section-missing'))
})

check('A SUPPLIED MAILBOX IS NEVER READ AS THE DEFAULT ONE', () => {
  // `mailbox` is the only scope value whose absence means read anyway. Every
  // other unreadable value refuses and nothing is read, so conflating absent
  // with malformed costs a refusal there and bought one here: text() returns
  // null for a list, so mailbox: ["boss@corp.com"] fell through to the default
  // and came back ok:true reading the user's own mailbox. There is no approval
  // gate in front of a read.
  const base = { sources: ['email'], ways: ['topics'], topics: ['refunds'] }
  for (const supplied of [42, {}, ['boss@corp.com'], true, '']) {
    const out = backfill.plan({ ...base, email: { mailbox: supplied, ...WINDOW } })
    assert.strictEqual(out.ok, false, `mailbox ${JSON.stringify(supplied)} produced a runnable plan`)
    assert.strictEqual(out.reading.email, undefined, `mailbox ${JSON.stringify(supplied)} was read as "own"`)
    assert.deepStrictEqual(faults(out), ['email:mailbox-not-a-name'], JSON.stringify(supplied))
  }

  // ABSENT STILL MEANS OWN, or the check above passes against a plan that
  // refuses email outright, and a named mailbox that is not "own" keeps its own
  // refusal rather than being folded into this one.
  const absent = backfill.plan({ ...base, email: { ...WINDOW } })
  assert.strictEqual(absent.ok, true, JSON.stringify(absent.refusals))
  assert.strictEqual(absent.reading.email.mailbox, 'own')

  const own = backfill.plan({ ...base, email: { mailbox: 'own', ...WINDOW } })
  assert.strictEqual(own.ok, true, JSON.stringify(own.refusals))

  const other = backfill.plan({ ...base, email: { mailbox: 'boss@corp.com', ...WINDOW } })
  assert.deepStrictEqual(faults(other), ['email:mailbox-not-own'])
})

check('A MONTH PAST 12 IS REFUSED FOR THE RIGHT REASON, not for the rollover one', () => {
  // Round 4 taught this refusal to name the rollover, and a month past 12 does
  // not roll: it does not resolve at all. One wording for two faults is what the
  // comment above the helper calls its own bug, and the fix for the first fault
  // introduced a third case it lumped in with them.
  for (const value of ['2026-02-30', '2026-13-01']) {
    const out = backfill.plan({ sources: ['slack'], slack: { channels: ['general'], from: value, to: '2026-06-01' } })
    const said = out.refusals.find(one => one.kind === 'range-not-a-day')
    assert.ok(said, `${value} was not refused as a day`)
    assert.ok(!/^[^;]*rolls forward[^;]*$/.test(said.message), `${value} was told it rolls forward and nothing else`)
    assert.ok(/does not resolve/.test(said.message), `${value} was not told the other cause`)
  }
})

check('A REFUSED SCOPE EMPTIES ALL FOUR, topics and what it is not reading included', () => {
  // Reached with topics actually set, so the emptying is exercised rather than
  // asserted against a value that was never there.
  const out = backfill.plan({
    sources: ['slack'],
    slack: { channels: 'all', dms: 'all', ...WINDOW },
    ways: ['topics'],
    topics: ['how refunds get handled']
  })
  assert.strictEqual(out.ok, false)
  assert.deepStrictEqual(out.reading, {})
  assert.deepStrictEqual(out.ways, [])
  assert.deepStrictEqual(out.topics, [])

  // AND THE FOURTH FIELD, which the emptying left standing for four rounds. A
  // refused plan reading nothing while still listing the sources it leaves out
  // reads as a run that is taking the rest, and this is the field the skill
  // tells a person to read before starting.
  assert.strictEqual(out.notReading.length, 1, `a refused plan still listed what it was leaving out:\n${out.notReading.join('\n')}`)
  for (const source of ['Documents', 'Email', 'Call recordings']) {
    assert.ok(!out.notReading.join(' ').includes(source), `${source} was named as an exclusion by a plan that reads nothing`)
  }

  // The same request without the refusal keeps all four, so the check above is
  // not passing on a plan that never had them.
  const fine = backfill.plan({
    sources: ['slack'],
    slack: { channels: 'all', ...WINDOW },
    ways: ['topics'],
    topics: ['how refunds get handled']
  })
  assert.strictEqual(fine.ok, true, JSON.stringify(fine.refusals))
  assert.deepStrictEqual(fine.topics, ['how refunds get handled'])
  assert.deepStrictEqual(fine.ways, ['topics'])
  assert.ok(fine.notReading.length > 1, 'a plan that was not refused stopped saying what it leaves out')
  assert.ok(fine.notReading.join(' ').includes('Email'), 'a plan that was not refused stopped naming the sources it leaves out')
})

check('THE PROOF IS BOUND TO THE PAGE THAT WAS CREATED', () => {
  // Without this, `prove` checked that SOME page had the right headings and the
  // right properties absent. A different page that happened to match passed, and
  // so did the case this exists for: a page created malformed while the skill
  // read back something else. The backfill absence check sat on top of that, so
  // it proved only that some page was unstamped.
  const final = draftOf().artifact
  const file = write('bound.json', final)
  const sent = capture(() => command.commands.create(file))
  const back = { url: URL_A, properties: sent.properties, headings: sent.headings }

  const right = capture(() => command.commands.prove(file, write('bound-back.json', back), URL_A))
  assert.strictEqual(right.proved, true, JSON.stringify(right.problems))

  process.exitCode = 0
  const wrong = capture(() => command.commands.prove(file, write('bound-back.json', back), URL_B))
  assert.strictEqual(wrong.proved, false, 'a read-back of a different page was proved as the write that just happened')
  assert.strictEqual(process.exitCode, 1)

  process.exitCode = 0
  const noUrl = capture(() => command.commands.prove(
    file,
    write('bound-back2.json', { properties: sent.properties, headings: sent.headings }),
    URL_A
  ))
  assert.strictEqual(noUrl.proved, false, 'a read-back with no url was proved')

  // And the created url is required, not optional, or the binding is advisory.
  assert.throws(
    () => command.commands.prove(file, write('bound-back.json', back)),
    /url the create call returned/,
    'prove ran without being told which page it was proving'
  )
  process.exitCode = 0
})


console.log(failures ? `\n${failures} failed.\n` : '\nAll passed.\n')
process.exit(failures ? 1 : 0)

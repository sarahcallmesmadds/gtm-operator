'use strict'

/**
 * The Software write gates: what is refused, what is asked about, and what
 * the payloads carry.
 *
 * MUTATION-PROVED WHERE IT SAYS SO. Following the 2026-08-23 lesson: a
 * mutation that silently fails to apply reports a test as proved when
 * nothing was tested, so each mutation run asserts the edit landed before
 * running the suite. The three run for this file, each confirmed red then
 * restored:
 *   1. `updateProblems` with the Last-reviewed refusal removed —
 *      "update refuses Last reviewed by name" went red.
 *   2. `reviewProperties` with the stamp line removed — "a confirmed review
 *      stamps Last reviewed from today" went red.
 *   3. `WORD_CEILING` moved to 900 in the vendored copy — the over-ceiling
 *      concern check went red (and tests/software-schema-agrees.test.js
 *      catches the same move in the source against the design document).
 *
 * Run: node tests/software-tool.test.js
 */

const assert = require('assert')

const tool = require('../plugins/software/scripts/tool')
const schema = require('../shared/software-schema')

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

console.log('\nthe software write gates\n')

const PERSON = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

/** A context whose mapping is visible in the output, so a raw name shows. */
const context = {
  personId: PERSON,
  property: logical => `W ${logical}`,
  value: (property, value) => `V ${value}`
}
const contextNobody = { ...context, personId: null }

/** A row that passes every gate. Tests copy and break it. */
const clean = () => ({
  Name: 'Gong',
  Description: 'Records and transcribes customer calls; Sales depends on it.',
  Status: 'Active',
  Importance: 'Important',
  Domain: 'Sales Enablement',
  Audience: ['Sales', 'RevOps'],
  today: '2026-08-25',
  body: {
    'What It Does For Us': 'Records every customer call and makes it searchable. If it stops, deal reviews and coaching stop the same week.',
    'How To Get Access': 'Ask Priya Shah for a seat; manager approval needed.',
    'Vendor Contacts': 'Our rep is Sam Field, sam@vendor.example. No escalation path beyond support tickets.'
  }
})

const problemsOf = row => tool.newProblems(row).map(p => `${p.field}:${p.kind}`)

// ------------------------------------------------------------------- new: gate

check('a clean row has no problems', () => {
  assert.deepStrictEqual(tool.newProblems(clean()), [])
})

check('every required field is required, and the refusal names it', () => {
  for (const field of schema.REQUIRED_AT_CREATE) {
    const row = clean()
    delete row[field]
    assert.ok(problemsOf(row).some(p => p.startsWith(`${field}:`)), `${field} missing was not refused`)
  }
})

check('an invented select value is refused, before it can lose the whole write', () => {
  for (const [field, value] of [['Status', 'Live'], ['Importance', 'Very'], ['Domain', 'Sales'], ['Renews', 'Auto'], ['Stores PII', 'Both'], ['SOC 2', 'Pending'], ['SSO', 'On']]) {
    const row = clean()
    row[field] = value
    assert.ok(problemsOf(row).includes(`${field}:unknown-value`), `${field}="${value}" was not refused`)
  }
})

check('a multi-select takes a list of known names and nothing else', () => {
  const bare = clean(); bare.Audience = 'Sales'
  assert.ok(problemsOf(bare).includes('Audience:not-a-list'))
  const unknown = clean(); unknown['AI access'] = ['Webhook']
  assert.ok(problemsOf(unknown).includes('AI access:unknown-value'))
})

check('Annual cost is one non-negative number', () => {
  const text = clean(); text['Annual cost'] = '12k'
  assert.ok(problemsOf(text).includes('Annual cost:not-a-number'))
  const negative = clean(); negative['Annual cost'] = -300
  assert.ok(problemsOf(negative).includes('Annual cost:negative'))
  const fine = clean(); fine['Annual cost'] = 60000
  assert.deepStrictEqual(tool.newProblems(fine), [])
})

check('the dates are real days and the range runs forwards', () => {
  const rolled = clean(); rolled['Notice deadline'] = '2026-02-30'
  assert.ok(problemsOf(rolled).includes('Notice deadline:not-a-day'), 'a rolled-over day got through')
  const backwards = clean(); backwards['Contract dates'] = { start: '2026-12-01', end: '2026-01-01' }
  assert.ok(problemsOf(backwards).includes('Contract dates:range-backwards'))
  const open = clean(); open['Contract dates'] = { end: '2026-12-01' }
  assert.ok(problemsOf(open).includes('Contract dates:range-open'))
})

check('a person is an id or me, never a name', () => {
  const named = clean(); named.Owner = 'Priya'
  assert.ok(problemsOf(named).includes('Owner:not-a-person-id'))
  const fine = clean(); fine.Owner = 'me'; fine.Admins = [PERSON, `user://${PERSON}`]
  assert.deepStrictEqual(tool.newProblems(fine), [])
})

check('the single-accountability person fields hold exactly one person; Admins is the list', () => {
  for (const field of schema.SINGLE_PERSON_FIELDS) {
    const row = clean(); row[field] = [PERSON, PERSON]
    assert.ok(problemsOf(row).includes(`${field}:several-people`), `${field} accepted several people`)
  }
  const admins = clean(); admins.Admins = [PERSON, PERSON]
  assert.ok(!problemsOf(admins).includes('Admins:several-people'), 'Admins is designed as the multi field')
})

check('a field the gate does not know is refused, not silently dropped', () => {
  // The failure this closes: `Plan: "Enterprise"` passed, `newProperties`
  // left it out, and `prove` rebuilt the same lossy payload and reported
  // success. Approved content disappearing with nothing saying so.
  const plan = clean(); plan.Plan = 'Enterprise'
  assert.ok(problemsOf(plan).includes('Plan:unknown-field'))
  for (const relation of ['Artifacts', 'Integrates with']) {
    const row = clean(); row[relation] = ['https://www.notion.so/x-' + 'a'.repeat(32)]
    assert.ok(problemsOf(row).includes(`${relation}:relation-not-written`), `${relation} was not refused as a relation`)
  }
})

check('Last reviewed cannot be passed as a field, and today must be a real day', () => {
  const passed = clean(); passed['Last reviewed'] = '2026-01-01'
  assert.ok(problemsOf(passed).includes('Last reviewed:not-yours-to-set'))
  const noToday = clean(); delete noToday.today
  assert.ok(problemsOf(noToday).includes('today:missing'))
  const badToday = clean(); badToday.today = 'today'
  assert.ok(problemsOf(badToday).includes('today:not-a-day'))
})

check('the body is gated: shape, required sections, known headings, no bare-department access line', () => {
  const notMap = clean(); notMap.body = 'all good'
  assert.ok(problemsOf(notMap).includes('body:not-a-section-map'))
  const missing = clean(); delete missing.body['Vendor Contacts']
  assert.ok(problemsOf(missing).includes('Vendor Contacts:section-missing'))
  const stranger = clean(); stranger.body.Pricing = 'cheap'
  assert.ok(problemsOf(stranger).includes('Pricing:unknown-section'))
  const dismissed = clean(); dismissed.body['How To Get Access'] = 'Ask IT.'
  assert.ok(problemsOf(dismissed).includes('How To Get Access:access-dismissed'))
  const team = clean(); team.body['How To Get Access'] = 'ask the data team'
  assert.ok(problemsOf(team).includes('How To Get Access:access-dismissed'))
  // The department list is the schema's own team vocabulary, so every
  // Audience value is a dismissal when asked bare.
  for (const dept of ['Ask Finance.', 'Ask Sales', 'ask people ops', 'Ask the RevOps team!']) {
    const row = clean(); row.body['How To Get Access'] = dept
    assert.ok(problemsOf(row).includes('How To Get Access:access-dismissed'), `${JSON.stringify(dept)} got through`)
  }
  const person = clean(); person.body['How To Get Access'] = 'Ask Priya.'
  assert.deepStrictEqual(tool.newProblems(person), [], '"Ask Priya" names a person and is an answer')
})

check('a body section that is not text is refused, conditional ones included', () => {
  // A Notes holding an object passed the old gate and was silently dropped
  // by the renderer: approved content disappearing.
  const notes = clean(); notes.body.Notes = { tier: 'Enterprise' }
  assert.ok(problemsOf(notes).includes('Notes:not-text'))
  const section = clean(); section.body['Vendor Contacts'] = 42
  const kinds = problemsOf(section)
  assert.ok(kinds.includes('Vendor Contacts:not-text'))
  assert.ok(!kinds.includes('Vendor Contacts:section-missing'), 'one fault, one refusal')
})

// --------------------------------------------------------------- new: concerns

check('running over the ceiling is a question, not a refusal', () => {
  const row = clean()
  row.body['What It Does For Us'] = Array(schema.WORD_CEILING + 1).fill('word').join(' ')
  assert.deepStrictEqual(tool.newProblems(row), [], 'the ceiling must not refuse')
  const raised = tool.newConcerns(row)
  assert.ok(raised.some(c => c.kind === 'over-ceiling'), 'over the ceiling raised nothing')
  assert.ok(tool.wordCount(row) > schema.WORD_CEILING)
})

check('Notes sits outside the count and outside the requirements', () => {
  const row = clean()
  row.body.Notes = Array(schema.WORD_CEILING + 1).fill('word').join(' ')
  assert.deepStrictEqual(tool.newProblems(row), [])
  assert.ok(!tool.newConcerns(row).some(c => c.kind === 'over-ceiling'), 'a long Notes is not over the ceiling')
})

check('an automatic renewal with no notice deadline is the concern the database exists for', () => {
  const row = clean(); row.Renews = 'Automatically'
  assert.ok(tool.newConcerns(row).some(c => c.kind === 'auto-renews-without-deadline'))
  row['Notice deadline'] = '2026-11-14'
  assert.ok(!tool.newConcerns(row).some(c => c.kind === 'auto-renews-without-deadline'))
})

check('a contract link into Notion is raised, because an upload is the one form nothing can read', () => {
  const row = clean(); row['Contract link'] = 'https://www.notion.so/x/f'.concat('a'.repeat(31))
  assert.ok(tool.newConcerns(row).some(c => c.kind === 'contract-inside-notion'))
  const drive = clean(); drive['Contract link'] = 'https://drive.google.com/file/d/abc/view'
  assert.ok(!tool.newConcerns(drive).some(c => c.kind === 'contract-inside-notion'))
})

// ------------------------------------------------------------- new: the payload

check('the payload writes through the map, and a raw name would show', () => {
  const row = clean(); row.Renews = 'Manually'; row['Annual cost'] = 42000
  const out = tool.newProperties(context, row)
  assert.strictEqual(out['W Name'], 'Gong')
  assert.strictEqual(out['W Status'], 'V Active')
  assert.deepStrictEqual(out['W Audience'], ['V Sales', 'V RevOps'])
  assert.strictEqual(out['W Annual cost'], 42000)
  assert.ok(!('Name' in out), 'a payload keyed by the logical name bypassed the map')
})

check('creation stamps Last reviewed from today, through its date columns', () => {
  const out = tool.newProperties(context, clean())
  assert.strictEqual(out['date:W Last reviewed:start'], '2026-08-25')
  assert.strictEqual(out['date:W Last reviewed:end'], null)
})

check('me resolves to the configured person, and no person means the field is omitted', () => {
  const mine = clean(); mine.Owner = 'me'
  assert.deepStrictEqual(tool.newProperties(context, mine)['W Owner'], [PERSON])
  const nobody = tool.newProperties(contextNobody, clean())
  for (const field of schema.PERSON_FIELDS) {
    assert.ok(!(`W ${field}` in nobody), `${field} was written with nobody to write`)
  }
  const askedMe = clean(); askedMe.Owner = 'me'
  assert.throws(() => tool.newProperties(contextNobody, askedMe), /records no person/)
})

check('the body renders in template order and Notes appears only when filled', () => {
  const bare = tool.toolBody(clean())
  assert.deepStrictEqual(bare.map(s => s.heading), ['What It Does For Us', 'How To Get Access', 'Vendor Contacts'])
  const noted = clean(); noted.body.Notes = 'Enterprise tier, 50-seat cap.'
  assert.deepStrictEqual(tool.toolHeadings(noted), ['What It Does For Us', 'How To Get Access', 'Vendor Contacts', 'Notes'])
})

// ----------------------------------------------------------------------- update

const updateKinds = changes => tool.updateProblems(changes).map(p => `${p.field}:${p.kind}`)

check('update refuses Last reviewed by name, whatever else it touches', () => {
  assert.ok(updateKinds({ 'Annual cost': 500, 'Last reviewed': '2026-08-25' }).includes('Last reviewed:never-here'))
})

check('update refuses an unknown field, an empty change set, and clearing a required field', () => {
  assert.ok(updateKinds({ Plan: 'Enterprise' }).includes('Plan:unknown-field'))
  assert.ok(updateKinds({}).includes('changes:empty'))
  for (const field of schema.NEVER_CLEARED) {
    assert.ok(updateKinds({ [field]: null }).includes(`${field}:never-cleared`), `clearing ${field} was not refused`)
  }
})

check('update carries the same value gates as new', () => {
  assert.ok(updateKinds({ Status: 'Live' }).includes('Status:unknown-value'))
  assert.ok(updateKinds({ 'Notice deadline': '2026-02-30' }).includes('Notice deadline:not-a-day'))
  assert.ok(updateKinds({ Owner: 'Priya' }).includes('Owner:not-a-person-id'))
})

check('a body edit names known sections only, carries text only, and only the named ones travel', () => {
  assert.ok(updateKinds({ body: { Pricing: 'x' } }).includes('Pricing:unknown-section'))
  assert.ok(updateKinds({ body: { Notes: { tier: 'Enterprise' } } }).includes('Notes:not-text'))
  assert.ok(updateKinds({ body: { Notes: '' } }).includes('Notes:not-text'), 'emptying a section is a person\'s edit, not an update')
  assert.deepStrictEqual(tool.updateProblems({ body: { Notes: 'New tier.' } }), [])
})

check('an emptied field is a clear in the measured shape for its type', () => {
  // A person clears with an EMPTY LIST: sent null, the write is accepted and
  // the old person stays, measured on the process plugin and recorded in
  // DECISIONS.md. Everything else clears with null, dates through both
  // columns.
  const built = tool.updateProperties(context, { Owner: null, 'AI access': [], 'Notice deadline': '', 'Annual cost': 9000, Login: null })
  assert.deepStrictEqual(built.cleared.sort(), ['AI access', 'Login', 'Notice deadline', 'Owner'])
  assert.deepStrictEqual(built.properties['W Owner'], [], 'a person cleared with null keeps its old person')
  assert.deepStrictEqual(built.properties['W AI access'], [])
  assert.strictEqual(built.properties['W Login'], null)
  assert.strictEqual(built.properties['date:W Notice deadline:start'], null)
  assert.strictEqual(built.properties['date:W Notice deadline:end'], null)
  assert.strictEqual(built.properties['W Annual cost'], 9000)
})

check('a retirement is an ordinary status change, and the row is never deleted here', () => {
  const built = tool.updateProperties(context, { Status: 'Retired' })
  assert.strictEqual(built.properties['W Status'], 'V Retired')
  assert.deepStrictEqual(built.cleared, [])
})

// ----------------------------------------------------------------------- review

check('a confirmed review stamps Last reviewed from today', () => {
  const built = tool.reviewProperties(context, {}, { confirmed: true, today: '2026-08-25' })
  assert.strictEqual(built.properties['date:W Last reviewed:start'], '2026-08-25')
})

check('a confirmed review with changes writes both, and an unconfirmed one stamps nothing', () => {
  const both = tool.reviewProperties(context, { 'Annual cost': 61000 }, { confirmed: true, today: '2026-08-25' })
  assert.strictEqual(both.properties['W Annual cost'], 61000)
  assert.strictEqual(both.properties['date:W Last reviewed:start'], '2026-08-25')
  const unconfirmed = tool.reviewProperties(context, { 'Annual cost': 61000 }, { confirmed: false })
  assert.ok(!('date:W Last reviewed:start' in unconfirmed.properties), 'an unconfirmed pass moved the stamp')
})

check('an unconfirmed review that changed nothing has nothing to send, and says so', () => {
  assert.throws(() => tool.reviewProperties(context, {}, { confirmed: false }), /stamps nothing/)
})

check('a confirmed review still cannot take Last reviewed as a field, or a bad today', () => {
  assert.throws(() => tool.reviewProperties(context, { 'Last reviewed': '2020-01-01' }, { confirmed: true, today: '2026-08-25' }), /not passed as a field/)
  assert.throws(() => tool.reviewProperties(context, {}, { confirmed: true, today: 'yesterday' }), /not a day/)
  assert.throws(() => tool.reviewProperties(context, {}, { confirmed: true }), /pass today/)
})

// ------------------------------------------------------------------- the proof

check('propertyTypes speaks workspace names, splits dates, and stays honest about number and checkbox', () => {
  const types = tool.propertyTypes(context)
  assert.strictEqual(types['W Status'], 'select')
  assert.strictEqual(types['W Owner'], 'people')
  assert.strictEqual(types['date:W Contract dates:start'], 'date')
  assert.strictEqual(types['date:W Last reviewed:end'], 'date')
  // How a number or a checkbox reads back is unmeasured on this surface, so
  // they are left out and the proof reports them unchecked rather than
  // guessing at equality.
  assert.ok(!('W Annual cost' in types))
  assert.ok(!('W Customer facing' in types))
})

console.log(failures ? `\n${failures} failed.\n` : '\nAll passed.\n')
process.exit(failures ? 1 : 0)

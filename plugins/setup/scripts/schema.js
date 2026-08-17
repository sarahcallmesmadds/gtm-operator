'use strict'

/**
 * The properties of each database, in machine-readable form.
 *
 * `manifest.js` holds what gets created and how it links up. This holds what is
 * inside each database. They are separate because relations can only be added
 * once every database exists, and keeping the phase B data apart from the phase
 * A data stops anyone adding a relation here where it would be created too
 * early.
 *
 * THE SCHEMA-*.md FILES AT THE REPO ROOT ARE THE DEFINITION. This is their
 * machine-readable form and must agree with them. Where the two disagree, the
 * document wins and this file is wrong. A test checks the agreement.
 *
 * Option order matters and is not decoration. Notion sorts a select by the order
 * the options are arranged in, so the order here is the order they are created
 * in. `Type` reads broadest to narrowest and `L2C Lifecycle` runs 0 to 8.
 * Getting it wrong is invisible until somebody opens a grouped view.
 */

/**
 * Colours are chosen once here rather than per database, so a value that appears
 * in two databases looks the same in both. Shared value lists are shared
 * deliberately: two vocabularies for one concept is how filtering across
 * databases stops working.
 */
const DOMAIN = [
  ['Customer Success', 'green'],
  ['Data & Systems', 'gray'],
  ['Deal Execution', 'orange'],
  ['GTM Strategy & ICP', 'purple'],
  ['Marketing & Campaigns', 'pink'],
  ['Partnerships & Agency', 'brown'],
  ['Pipeline & Demand Gen', 'yellow'],
  ['Sales Enablement', 'blue']
]

const AUDIENCE = [
  ['AE', 'blue'], ['Eng', 'gray'], ['Everyone', 'default'], ['FDE', 'gray'],
  ['Finance', 'green'], ['GM', 'purple'], ['Leadership', 'purple'],
  ['Marketing', 'pink'], ['Partner', 'brown'], ['People Ops', 'orange'],
  ['RevOps', 'blue'], ['SDR', 'blue'], ['Sales', 'blue'], ['Solutions', 'gray']
]

// Editable on purpose. Plenty of organisations segment by vertical rather than
// by size, which is why setup asks rather than assuming.
const SEGMENT = [
  ['Enterprise', 'purple'], ['Mid-Market', 'blue'], ['SMB', 'green']
]

// 0 to 8, and the numbers stay. Here the prefix IS doing the sorting job,
// unlike Type, where it was dropped.
const L2C = [
  ['0 - Everywhere all the time', 'default'],
  ['1 - ToFu & Engagement', 'pink'],
  ['2 - Eval & Demo', 'orange'],
  ['3 - Contracting', 'yellow'],
  ['4 - Customer Activation', 'green'],
  ['5 - Onboarding', 'blue'],
  ['6 - Steady State & Expansion', 'purple'],
  ['7 - Contraction', 'red'],
  ['8 - Renewal', 'brown']
]

const TAGS = [
  ['AI', 'blue'], ['Data', 'gray'], ['Meetings', 'orange'], ['Products', 'purple'],
  ['Sales Messaging', 'pink'], ['Tools', 'green'], ['Teammate Onboarding', 'yellow'],
  ['Teammate Offboarding', 'brown']
]

const DATABASES = {
  /**
   * The Process Library. Living reference that is maintained and kept true, as
   * against Memos, which is time-stamped communication and append-only. Every
   * other decision in this database follows from that line.
   */
  process: {
    title: 'Process Library',
    properties: [
      { name: 'Name', type: 'title' },
      { name: 'Description', type: 'text', note: 'one sentence' },

      // Broadest to narrowest. The numbering these used to carry was dropped:
      // Notion sorts by option order, so the prefix was not doing that job and
      // cost a visible prefix in every view.
      { name: 'Type', type: 'select', options: [
        ['Strategy Decision', 'purple'],
        ['SOP/ROE', 'blue'],
        ['Enablement', 'green'],
        ['Reporting', 'yellow'],
        ['Technical Reference', 'gray']
      ] },

      { name: 'Domain', type: 'select', options: DOMAIN },
      { name: 'Audience', type: 'multi_select', options: AUDIENCE },
      { name: 'Segment', type: 'multi_select', options: SEGMENT },
      { name: 'L2C Lifecycle', type: 'multi_select', options: L2C },

      // Max 3, which Notion cannot enforce and no view can watch. Measured
      // 2026-08-17. setup:check reports it. See manifest.js.
      { name: 'Tags', type: 'multi_select', options: TAGS },

      // Skills only ever write Active or Archive. Draft is a person's to set,
      // because a skill that writes a draft has written nothing useful.
      { name: 'Status', type: 'select', options: [
        ['Active', 'green'], ['Draft', 'yellow'], ['Archive', 'gray']
      ] },

      { name: 'Owner', type: 'person', note: 'skipped when there is no personId' },
      { name: 'Last checked for accuracy', type: 'date' },

      // Each value means a number of days that audit adds to Last checked to
      // decide whether an artifact is due. On change only and None are not the
      // same: the first still gets flagged by the other audit signals, the
      // second opts out of time-based checking entirely.
      { name: 'Review cadence', type: 'select', options: [
        ['Monthly', 'red'],
        ['Quarterly', 'orange'],
        ['Twice a year', 'yellow'],
        ['Yearly', 'green'],
        ['On change only', 'blue'],
        ['None', 'gray']
      ] },

      { name: 'Verified by', type: 'person', note: 'skipped when there is no personId' },
      { name: 'Verified date', type: 'date' },
      { name: 'Created time', type: 'created_time' }
    ]
  }
}

/** Days each cadence means. Read by audit, not by setup. */
const CADENCE_DAYS = {
  Monthly: 30,
  Quarterly: 90,
  'Twice a year': 180,
  Yearly: 365,
  'On change only': null,
  None: null
}

const DEFAULT_CADENCE = 'Quarterly'

/**
 * How each type is written in a CREATE TABLE statement.
 *
 * Deliberately not a passthrough. An unknown type must stop the run rather than
 * be guessed at, because a property created with the wrong type is not something
 * setup can repair: it has to be dropped and remade, and by then it may hold
 * data somebody typed.
 */
const DDL_TYPE = {
  title: () => 'TITLE',
  text: () => 'RICH_TEXT',
  date: () => 'DATE',
  person: () => 'PEOPLE',
  checkbox: () => 'CHECKBOX',
  url: () => 'URL',
  number: () => 'NUMBER',
  created_time: () => 'CREATED_TIME',
  select: p => `SELECT(${optionList(p)})`,
  multi_select: p => `MULTI_SELECT(${optionList(p)})`
}

function optionList (property) {
  if (!property.options || !property.options.length) {
    throw new Error(`${property.name}: a ${property.type} needs its options, and the order they are given in is the order Notion sorts them`)
  }
  return property.options.map(([name, colour]) => {
    if (name.includes("'")) {
      throw new Error(`${property.name}: option "${name}" contains an apostrophe, which the DDL quoting cannot carry`)
    }
    return `'${name}':${colour}`
  }).join(', ')
}

/**
 * Build the CREATE TABLE statement for one database.
 *
 * Relations are deliberately absent. They belong to phase B and cannot be
 * written here, because the database they point at may not exist yet. Passing a
 * relation into this function is a bug in the caller, so it throws.
 */
function createStatement (key) {
  const db = DATABASES[key]
  if (!db) throw new Error(`No schema defined for "${key}". Defined: ${Object.keys(DATABASES).join(', ') || 'none yet'}`)

  const columns = db.properties.map(p => {
    if (p.type === 'relation') {
      throw new Error(`${db.title}.${p.name}: relations are added in phase B, never in the create statement`)
    }
    const render = DDL_TYPE[p.type]
    if (!render) throw new Error(`${db.title}.${p.name}: unknown property type "${p.type}"`)
    if (p.name.includes('"')) throw new Error(`${db.title}.${p.name}: a property name cannot contain a double quote`)
    return `"${p.name}" ${render(p)}`
  })

  const titles = db.properties.filter(p => p.type === 'title')
  if (titles.length !== 1) {
    throw new Error(`${db.title}: a database needs exactly one title property, found ${titles.length}`)
  }

  return `CREATE TABLE (${columns.join(', ')})`
}

/**
 * What Notion calls each type when reading a data source back.
 *
 * Only the types that differ from what the DDL calls them are listed. Measured
 * against a live workspace rather than assumed, because the first version of
 * `verify` assumed they matched and would have failed on a correct database.
 */
const READ_BACK_AS = {
  text: 'text',        // written as RICH_TEXT
  person: 'person'     // written as PEOPLE
}

/**
 * Compare what Notion actually returned against what was asked for.
 *
 * This is the function behind install step 7, and it exists because of what was
 * measured on 2026-08-17: a Notion write can return success and not do what it
 * said. A view was created, reported as created, and silently had its filter
 * discarded. Nothing in the response distinguished it from one that worked.
 *
 * So the rule for this plugin is that a create call returning without an error
 * is not evidence of anything. Reading the result back and comparing it is.
 *
 * `actual` is the `schema` object from the data source state Notion returns.
 */
function verify (key, actual) {
  const db = DATABASES[key]
  if (!db) throw new Error(`No schema defined for "${key}"`)

  const problems = []
  if (!actual || typeof actual !== 'object') {
    return [`${db.title}: no schema came back to check, so nothing was verified`]
  }

  for (const want of db.properties) {
    const got = actual[want.name]
    if (!got) { problems.push(`${db.title}.${want.name}: missing`); continue }

    // The name a type is WRITTEN as in DDL is not the name it is READ back as.
    // Measured 2026-08-17: RICH_TEXT comes back as "text", PEOPLE comes back as
    // "person". Assuming they round-trip makes this function report a failure on
    // a database that is perfectly correct, which is how a verifier gets
    // switched off.
    const expected = READ_BACK_AS[want.type] || want.type
    if (got.type !== expected) {
      problems.push(`${db.title}.${want.name}: expected type ${expected}, got ${got.type}`)
    }

    if (want.options) {
      const gotNames = (got.options || []).map(o => o.name)
      const wantNames = want.options.map(([n]) => n)

      for (const name of wantNames) {
        if (!gotNames.includes(name)) problems.push(`${db.title}.${want.name}: option "${name}" is missing`)
      }
      // Order is checked, not just membership. Notion sorts a select by option
      // order, so a correct set in the wrong order is a real defect that is
      // invisible until somebody groups a view by it.
      const shared = gotNames.filter(n => wantNames.includes(n))
      const wanted = wantNames.filter(n => gotNames.includes(n))
      if (shared.join(' ') !== wanted.join(' ')) {
        problems.push(`${db.title}.${want.name}: options are in the wrong order.\n    wanted: ${wanted.join(', ')}\n    got:    ${shared.join(', ')}`)
      }
    }
  }

  // Extra properties are reported and never removed. They may be the user's,
  // and this plugin repairs what it owns and never touches what the user wrote.
  const wantedNames = new Set(db.properties.map(p => p.name))
  for (const name of Object.keys(actual)) {
    if (!wantedNames.has(name)) problems.push(`${db.title}.${name}: present in Notion and not in the schema. Reported, not removed`)
  }

  return problems
}

const defined = () => Object.keys(DATABASES)

module.exports = { DATABASES, CADENCE_DAYS, DEFAULT_CADENCE, createStatement, verify, defined }

if (require.main === module) {
  const key = process.argv[3]
  const arg = process.argv[2]

  if (arg === '--ddl') {
    if (!key) {
      for (const k of defined()) console.log(`-- ${DATABASES[k].title}\n${createStatement(k)}\n`)
    } else {
      console.log(createStatement(key))
    }
    process.exit(0)
  }

  console.log(`Schemas defined: ${defined().join(', ') || 'none'}`)
  console.log('Usage: node schema.js --ddl [database-key]')
}

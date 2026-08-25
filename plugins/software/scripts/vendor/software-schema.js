// GENERATED FILE. DO NOT EDIT.
// Copied from shared/software-schema.js by scripts/vendor.js.
// Edit the source and re-run that script. An edit here is reverted by the
// next run and reported as drift by tests/vendor-copies-current.test.js.
'use strict'

/**
 * The Software facts a writer needs, in machine-readable form.
 *
 * THIS FILE IS THE SOURCE. It is vendored into plugins by `scripts/vendor.js`.
 * See the header on `shared/config-read.js` for why a copy rather than a
 * require.
 *
 * `SCHEMA-software.md` is the human definition and wins over this file where
 * they disagree. `SKILLS-software.md` is the human definition of the skills.
 * `tests/software-schema-agrees.test.js` asserts every list and every field
 * name here against `setup`'s schema.
 *
 * THE RULE EVERYTHING HERE FOLLOWS FROM: every field has one named fill event,
 * and `Last reviewed` is the freshness stamp for the whole row. It moves at
 * creation and on a confirmed review, and nothing else moves it: not `update`,
 * whatever it changed, not `contracts` reading the row, and not `backfill`
 * creating one. An edit that resets the freshness stamp suppresses the
 * staleness warning for a whole cadence period, which is the correction
 * `process:update` needed on 2026-08-17.
 *
 * WHO STAMPS AT CREATION WAS RULED BY SARAH ON 2026-08-25: creation stamps
 * it, because creation is a full pass. That is `SCHEMA-software.md`'s
 * fill-event table, which this file follows, and `SKILLS-software.md` now
 * says the same. The ruling and the history of the disagreement are in
 * `DECISIONS.md`. Changing the answer is one edit to `LAST_REVIEWED_WRITERS`.
 */

/** The tool lifecycle, in the option order Notion sorts by. */
const STATUSES = ['Evaluating', 'Active', 'Sunsetting', 'Retired', 'Rejected']

/**
 * Defined by consequence, not by feeling: what breaks, and how fast. The
 * strongest thing in the reference's whole spec, carried almost unchanged.
 */
const IMPORTANCE = ['Business critical', 'Important', 'Standard']

/**
 * `Automatically` is the value that makes `Notice deadline` urgent, and
 * `Unknown` is a real value: blank means nobody looked, Unknown means somebody
 * looked and could not tell.
 */
const RENEWS = ['Automatically', 'Manually', 'No renewal', 'Unknown']

const AI_ACCESS = ['MCP (connected)', 'MCP (available)', 'API', 'CLI', 'None', 'Unknown']
const STORES_PII = ['Customer PII', 'Employee PII', 'None', 'Unknown']
const SOC_2 = ['Yes', 'No', 'Unknown']
const SSO = ['Enforced', 'Enabled', 'Available', 'Not supported', 'Unknown']

const DOMAINS = [
  'Customer Success',
  'Data & Systems',
  'Deal Execution',
  'GTM Strategy & ICP',
  'Marketing & Campaigns',
  'Partnerships & Agency',
  'Pipeline & Demand Gen',
  'Sales Enablement'
]

const AUDIENCES = [
  'AE', 'Eng', 'Everyone', 'FDE', 'Finance', 'GM', 'Leadership',
  'Marketing', 'Partner', 'People Ops', 'RevOps', 'SDR', 'Sales', 'Solutions'
]

/**
 * Four person fields, one more than the reference had, and the reference
 * documented its person group as the worst filled it owned. Kept because each
 * answers a different question at a different moment; `Admins` is the one to
 * drop first if real use proves the point. NEVER GUESSED: an empty person
 * field asks a question and a wrong one answers it.
 */
const PERSON_FIELDS = ['Owner', 'Technical owner', 'Admins', 'Billing owner']

/**
 * The person fields that hold exactly one person. `Admins` is the one
 * designed as Person (multi) — "who holds an admin seat" is a list — and the
 * other three are single accountability fields: whose call it is, who can
 * explain it, who approves the money. Shared ownership reads as nobody's,
 * the same reasoning as Projects' one-accountable-Owner.
 */
const SINGLE_PERSON_FIELDS = ['Owner', 'Technical owner', 'Billing owner']

const MULTI_SELECT_FIELDS = ['Audience', 'AI access']

/**
 * `Contract link` stays a URL rather than Files & media on a measurement: a
 * PDF in Google Drive can be read through the link, and a PDF uploaded into
 * Notion cannot. The property description setup writes is where a person
 * finds that out.
 */
const URL_FIELDS = ['Contract link', 'Login', 'Documentation', 'Status page']

const CHECKBOX_FIELDS = ['Customer facing', 'Given to new teammates']

/** The two date properties the writer touches. Contract dates is a range. */
const DATE_RANGE_FIELDS = ['Contract dates']
const DAY_FIELDS = ['Notice deadline']

/**
 * The page body: four light sections, because this row is an index entry and
 * the depth belongs in a related Technical Reference. A body running long
 * means that artifact is owed.
 */
const SECTIONS = [
  { heading: 'What It Does For Us', conditional: false },
  { heading: 'How To Get Access', conditional: false },
  { heading: 'Vendor Contacts', conditional: false },
  { heading: 'Notes', conditional: true }
]

/**
 * 400 rather than 600 or 800, from `SCHEMA-software.md`: length here is a
 * signal that content is in the wrong place, and hitting the ceiling routes
 * to writing the Technical Reference. Conditional sections sit outside the
 * count. The agreement test holds this number to the design document, the fix
 * the 2026-08-23 mutation run forced on `process`.
 */
const WORD_CEILING = 400

/**
 * The skills allowed to write `Last reviewed`, per the fill-event table in
 * `SCHEMA-software.md`. See the file header: Sarah ruled for this reading on
 * 2026-08-25, the design documents agree, and this constant is still the one
 * edit that would change the answer.
 */
const LAST_REVIEWED_WRITERS = ['new', 'review']

/**
 * The required fields on a row `new` creates, per the fill-event table: what
 * it is, in five answers. `Importance` is here because `new` asks the
 * consequence question rather than guessing, and a row that skipped the
 * question looks exactly like one that answered it Standard.
 */
const REQUIRED_AT_CREATE = ['Name', 'Description', 'Status', 'Importance', 'Domain', 'Audience']

/**
 * The fields `update` refuses to clear. Required at creation, so an update
 * that empties one is a bug in the caller rather than an intent worth
 * carrying out. Person fields are deliberately not here: an owner who left is
 * cleared by name, and that clear is the whole point.
 */
const NEVER_CLEARED = ['Name', 'Description', 'Status', 'Importance', 'Domain', 'Audience']

/**
 * Every logical name the recorded Software map has to carry, and every option
 * value the writer can resolve through it. The contract
 * `shared/config-read.js` checks the config against;
 * `tests/software-schema-agrees.test.js` asserts it equals
 * `identityNames('software')` exactly, in both directions. The two relation
 * properties are in it because they are properties like any other and can be
 * renamed like any other.
 */
const IDENTITY_PROPERTIES = [
  'Name',
  'Description',
  'Status',
  'Importance',
  'Domain',
  'Audience',
  'Owner',
  'Technical owner',
  'Admins',
  'Billing owner',
  'Contract dates',
  'Notice deadline',
  'Renews',
  'Annual cost',
  'Contract link',
  'AI access',
  'Stores PII',
  'SOC 2',
  'SSO',
  'Customer facing',
  'Given to new teammates',
  'Login',
  'Documentation',
  'Status page',
  'Last reviewed',
  'Created time',
  'Artifacts',
  'Integrates with'
]

const IDENTITY_VALUES = {
  Status: STATUSES,
  Importance: IMPORTANCE,
  Domain: DOMAINS,
  Audience: AUDIENCES,
  Renews: RENEWS,
  'AI access': AI_ACCESS,
  'Stores PII': STORES_PII,
  'SOC 2': SOC_2,
  SSO
}

const IDENTITY = {
  properties: IDENTITY_PROPERTIES,
  values: IDENTITY_VALUES
}

/**
 * What is wrong with a multi-select value, or null when nothing is.
 *
 * THE FIFTH COPY of this pair, deliberately and visibly, the same standing
 * decision as the fourth: the plugins are separate releases and none can
 * require another. `tests/list-values-agree.test.js` runs every copy over the
 * same inputs and asserts they answer identically, which makes the copy a
 * checked one rather than a hidden one.
 */
function listProblem (value) {
  if (value === undefined || value === null || value === '') return null
  if (!Array.isArray(value)) return { kind: 'not-a-list', value }
  for (const entry of value) {
    if (typeof entry !== 'string' || !entry.trim()) return { kind: 'not-a-name', entry }
  }
  return null
}

/**
 * The names in a multi-select, in the one form every path uses. TRIMMED,
 * ONCE, HERE, for the reason written on the calendar copy. Call `listProblem`
 * first; this assumes what that function checks.
 */
function listValues (value) {
  if (!Array.isArray(value)) return []
  return value.map(entry => entry.trim())
}

module.exports = {
  STATUSES,
  IMPORTANCE,
  RENEWS,
  AI_ACCESS,
  STORES_PII,
  SOC_2,
  SSO,
  DOMAINS,
  AUDIENCES,
  PERSON_FIELDS,
  SINGLE_PERSON_FIELDS,
  MULTI_SELECT_FIELDS,
  URL_FIELDS,
  CHECKBOX_FIELDS,
  DATE_RANGE_FIELDS,
  DAY_FIELDS,
  SECTIONS,
  WORD_CEILING,
  LAST_REVIEWED_WRITERS,
  REQUIRED_AT_CREATE,
  NEVER_CLEARED,
  IDENTITY,
  IDENTITY_PROPERTIES,
  IDENTITY_VALUES,
  listProblem,
  listValues
}

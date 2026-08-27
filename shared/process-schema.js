'use strict'

/**
 * The Process facts a writer needs, in machine-readable form.
 *
 * THIS FILE IS THE SOURCE. It is vendored into plugins by `scripts/vendor.js`.
 * See the header on `shared/config-read.js` for why a copy rather than a
 * require.
 *
 * WHY IT EXISTS SEPARATELY FROM `plugins/setup/scripts/schema.js`. That file is
 * the definition `setup` builds the database from, and an installed `process`
 * cannot reach it. So these are two files describing one database, which is the
 * shape this repository distrusts, and `tests/process-schema-agrees.test.js`
 * holds them together: every type, every value list and every field name here is
 * asserted against `setup`'s schema.
 *
 * IT IS DELIBERATELY NARROWER THAN `setup`'s SCHEMA, for the reason written on
 * `shared/calendar-schema.js`: a writer needs value lists and the rules about
 * which field applies when, and carrying the option colours would be carrying a
 * copy nothing reads.
 *
 * `plugins/process/SCHEMA.md` is the human definition and wins over this file where they
 * disagree. `plugins/process/SKILLS.md` is the human definition of the skills. The test
 * is what makes that a check rather than a hope.
 */

/** Broadest to narrowest, which is the option order in Notion. */
const TYPES = [
  'Strategy Decision',
  'SOP/ROE',
  'Enablement',
  'Reporting',
  'Technical Reference'
]

/**
 * `Draft` is deliberately here and deliberately never written by a skill.
 *
 * A skill that writes a draft has written nothing useful, so `new` sets `Active`
 * and only a person setting it in Notion can reach `Draft`. The value is in this
 * list because the property has it and a writer has to be able to read a row
 * that carries it, not because anything here may write it.
 */
const STATUSES = ['Active', 'Draft', 'Archive']

/** The statuses a skill is allowed to write. See the note on STATUSES. */
const WRITABLE_STATUSES = ['Active', 'Archive']

/**
 * Only a Strategy Decision may be the parent of anything.
 *
 * Every other type describes HOW to do something and a Strategy Decision
 * describes WHY, so the others hang off it. That is what makes the library
 * navigable instead of a pile.
 *
 * THIS IS ENFORCED HERE BECAUSE NOTION CANNOT ENFORCE IT. A view filter cannot
 * reach across a relation to read the parent's `Type`, measured 2026-08-17, and
 * a rollup is not the way round it: the view is created, reported as created,
 * and silently loses its filter. So the plugin refuses on every row it writes
 * and `setup:check` reports the rows it did not write that break it.
 */
const PARENT_TYPE = 'Strategy Decision'

/**
 * Person properties on this database. Written only when config records a person.
 *
 * `Verified by` is one of the three verification fields below, and it is the one
 * that is skipped when there is no person id. `Verified date` is set either way,
 * which is the asymmetry `plugins/process/SKILLS.md` states for `new`.
 */
const PERSON_FIELDS = ['Owner', 'Verified by']

/**
 * The three fields that move together or not at all.
 *
 * `Last checked for accuracy` is what drives the staleness check in `audit`, so
 * setting it on an edit that was not a review is the whole of the fault this
 * grouping exists to prevent. `update` asks separately whether an edit counts as
 * having re-read the artifact, and on a no it moves none of them.
 *
 * `new` sets all three, because writing an artifact is having read it.
 */
const VERIFICATION_FIELDS = [
  'Last checked for accuracy',
  'Verified by',
  'Verified date'
]

/**
 * Tags has a maximum of three, which Notion cannot enforce and no view can
 * watch. Measured 2026-08-17. `setup:check` reports rows that break it, and a
 * writer refuses to write a fourth rather than writing it and being reported.
 */
const TAGS_MAX = 3

/** The multi-select properties, which take a list and reject a bare string. */
const MULTI_SELECT_FIELDS = ['Audience', 'Segment', 'L2C Lifecycle', 'Tags']

/**
 * Days added to `Last checked for accuracy` to decide whether an artifact is
 * due. `null` means no time-based check.
 *
 * `On change only` and `None` are not the same and the difference is the reason
 * both exist: the first still gets flagged by the other audit signals, the
 * second opts out of time-based checking entirely. They share a `null` here
 * because neither has a number of days, not because they mean the same thing.
 *
 * A COPY OF `setup`'s `CADENCE_DAYS`, asserted equal by
 * `tests/process-schema-agrees.test.js`. It is here because `audit` and `find`
 * both need it and neither can reach `setup`.
 */
const CADENCE_DAYS = {
  Monthly: 30,
  Quarterly: 90,
  'Twice a year': 180,
  Yearly: 365,
  'On change only': null,
  None: null
}

/** The cadence `new` offers when config records no default. */
const DEFAULT_CADENCE = 'Quarterly'

/**
 * The body sections for each type, in order.
 *
 * `Sources` is conditional on every type: required where the content came from
 * somewhere else, which is every backfilled artifact and most Strategy
 * Decisions, and omitted where the work was internal with no external source. A
 * section that is empty on a third of documents stops being read.
 *
 * `neverEmpty` marks the sections that must say "none known" explicitly rather
 * than being left blank. Blank reads as unconsidered rather than as clean, and
 * on both of these the empty case is the one worth recording.
 */
const BODY_SECTIONS = {
  'Strategy Decision': [
    { heading: 'Problem', conditional: false },
    { heading: 'Decision', conditional: false },
    { heading: 'Why This Approach', conditional: false },
    { heading: 'Used For', conditional: false },
    { heading: 'Not Used For', conditional: false },
    { heading: 'Sources', conditional: true }
  ],
  'SOP/ROE': [
    { heading: 'Scope', conditional: false },
    { heading: 'Trigger Condition', conditional: false },
    { heading: 'Steps', conditional: false },
    { heading: 'System Behavior', conditional: false },
    { heading: 'Exceptions', conditional: false, neverEmpty: true },
    { heading: 'Sources', conditional: true }
  ],
  Enablement: [
    { heading: 'Purpose', conditional: false },
    { heading: 'Prerequisites', conditional: false },
    { heading: 'Steps', conditional: false },
    { heading: 'Tools & Resources', conditional: false },
    { heading: 'Common Questions', conditional: false },
    { heading: 'Sources', conditional: true }
  ],
  Reporting: [
    { heading: 'Purpose', conditional: false },
    { heading: 'Key Metrics', conditional: false },
    { heading: 'Dashboards', conditional: false },
    { heading: 'How to Read', conditional: false },
    { heading: 'Data Sources', conditional: false },
    { heading: 'Update Frequency', conditional: false },
    { heading: 'Sources', conditional: true }
  ],
  'Technical Reference': [
    { heading: 'What It Does', conditional: false },
    { heading: 'Configuration', conditional: false },
    { heading: 'Integration Details', conditional: false },
    { heading: 'Authentication', conditional: false },
    { heading: 'Known Limitations', conditional: false, neverEmpty: true },
    { heading: 'Contacts', conditional: false },
    { heading: 'Sources', conditional: true }
  ]
}

/**
 * The one embedded related-database view each type carries, chosen by what the
 * reader needs next rather than by what is available.
 *
 * The three Software views went and came back inside one day: dropped when
 * Software was cut from v1, restored 2026-08-17 when it was put back and
 * `plugins/software/SCHEMA.md` defined the database. Recorded because the round trip is
 * the useful part. A template cannot name a view of a database nobody has
 * described, so the cut was right at the time and so is the restoration.
 */
const RELATED_VIEW = {
  'Strategy Decision': {
    relation: 'Child Docs',
    what: 'everything that implements this decision'
  },
  'SOP/ROE': {
    relation: 'Software',
    what: 'the systems this process touches'
  },
  Enablement: {
    relation: 'Parent',
    what: 'sibling docs under the same parent',
    siblings: true
  },
  Reporting: {
    relation: 'Software',
    what: 'the systems the numbers come out of'
  },
  'Technical Reference': {
    relation: 'Software',
    what: 'the tool this document describes'
  }
}

/**
 * Words across the required sections. A maximum, never a minimum.
 *
 * The reference set a range of 400 to 800 and then needed a second rule telling
 * itself not to pad to reach 400. A floor manufactures filler, because a writer
 * always has the option of adding words and never the option of having said
 * enough. Only the ceiling was ever doing useful work.
 *
 * Conditional sections sit outside the count.
 *
 * AT THE CEILING THE SKILL ASKS RATHER THAN TRIMS. Running long almost never
 * means a wording problem. It usually means the artifact covers more than one
 * thing, so the skill asks whether this is two artifacts. Trimming a document
 * that is genuinely too big just makes a bad document shorter.
 *
 * 800 is a starting point rather than a derived number: roughly 160 words per
 * section at the five-section ceiling. Adjust it once there are real artifacts.
 */
const WORD_CEILING = 800

/**
 * Every logical name the recorded map has to carry, and every option value the
 * writer can resolve through it.
 *
 * THIS IS THE CONTRACT `shared/config-read.js` CHECKS THE CONFIG AGAINST. The
 * full reasoning is on `shared/calendar-schema.js` and is not restated here. The
 * short version: a map that is merely well formed passes every structural check
 * and then sends a renamed workspace a value it does not have, and Notion
 * refuses a select value the property does not have with a hard 400, all or
 * nothing, so the page is not created and a drafted artifact is lost at write
 * time. Refusing at read time is what stops that.
 *
 * `tests/process-schema-agrees.test.js` asserts this equals
 * `identityNames('process')` exactly, in both directions, so a property added to
 * the database and not added here fails a test rather than a write.
 */
const IDENTITY_PROPERTIES = [
  'Name',
  'Description',
  'Type',
  'Domain',
  'Audience',
  'Segment',
  'L2C Lifecycle',
  'Tags',
  'Status',
  'Owner',
  'Last checked for accuracy',
  'Review cadence',
  'Verified by',
  'Verified date',
  'Created time',
  'Parent',
  'Supersedes',
  'Child Docs',
  'Superseded By',
  'Memos',
  'Projects',
  'Software',
  'Calendar'
]

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
  'AE',
  'Eng',
  'Everyone',
  'FDE',
  'Finance',
  'GM',
  'Leadership',
  'Marketing',
  'Partner',
  'People Ops',
  'RevOps',
  'SDR',
  'Sales',
  'Solutions'
]

const SEGMENTS = ['Enterprise', 'Mid-Market', 'SMB']

const L2C = [
  '0 - Everywhere all the time',
  '1 - ToFu & Engagement',
  '2 - Eval & Demo',
  '3 - Contracting',
  '4 - Customer Activation',
  '5 - Onboarding',
  '6 - Steady State & Expansion',
  '7 - Contraction',
  '8 - Renewal'
]

const TAGS = [
  'AI',
  'Data',
  'Meetings',
  'Products',
  'Sales Messaging',
  'Tools',
  'Teammate Onboarding',
  'Teammate Offboarding'
]

const CADENCES = Object.keys(CADENCE_DAYS)

const IDENTITY_VALUES = {
  Type: TYPES,
  Domain: DOMAINS,
  Audience: AUDIENCES,
  Segment: SEGMENTS,
  'L2C Lifecycle': L2C,
  Tags: TAGS,
  Status: STATUSES,
  'Review cadence': CADENCES
}

const IDENTITY = {
  properties: IDENTITY_PROPERTIES,
  values: IDENTITY_VALUES
}

/**
 * What is wrong with a multi-select value, or null when nothing is.
 *
 * An absent value is legal and means the row said nothing, which is a real
 * answer and not a fault. Everything else has to be a list of non-empty strings.
 *
 * A SECOND COPY OF `shared/calendar-schema.js`, deliberately and visibly. The
 * two plugins are separate releases and neither can require the other, so the
 * choice is a copy or a fourth vendored file for eleven lines.
 * `tests/list-values-agree.test.js` runs both implementations over the same
 * inputs and asserts they answer identically, which makes the copy a checked one
 * rather than a hidden one.
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
 * The names in a multi-select, in the one form every path uses.
 *
 * TRIMMED, ONCE, HERE. The reason is written on the calendar copy and is worth
 * repeating: a value compared trimmed on one path and written untrimmed on
 * another matched an existing row and then went to Notion with its spaces on,
 * where it maps to no option and comes back a 400.
 *
 * Call `listProblem` first. This assumes what that function checks.
 */
function listValues (value) {
  if (!Array.isArray(value)) return []
  return value.map(entry => entry.trim())
}

/** The sections for a type, or undefined for a type this file does not know. */
function sectionsFor (type) {
  return BODY_SECTIONS[type]
}

/** The section headings that count toward the ceiling, for one type. */
function requiredSectionsFor (type) {
  const sections = BODY_SECTIONS[type]
  if (!sections) return undefined
  return sections.filter(s => !s.conditional).map(s => s.heading)
}

/** The headings on one type that must say "none known" rather than be blank. */
function neverEmptySectionsFor (type) {
  const sections = BODY_SECTIONS[type]
  if (!sections) return undefined
  return sections.filter(s => s.neverEmpty).map(s => s.heading)
}

/**
 * Whether a row of this type may be the parent of another row.
 *
 * Takes the type rather than the row so the caller cannot pass a half-built row
 * and get a confident answer about a field it never set.
 */
function canBeParent (type) {
  return type === PARENT_TYPE
}

/**
 * Days after which an artifact of this cadence is due, or `null` where the
 * cadence carries no time-based check.
 *
 * Returns `undefined` for a cadence this file does not know, which is a
 * different answer from `null` and has to stay different: `null` means "no
 * time-based check by design" and `undefined` means "nobody here knows what this
 * value is". A caller that collapses them reports an unrecognised cadence as
 * deliberately exempt.
 */
function cadenceDays (cadence) {
  if (!Object.prototype.hasOwnProperty.call(CADENCE_DAYS, cadence)) return undefined
  return CADENCE_DAYS[cadence]
}

module.exports = {
  TYPES,
  STATUSES,
  WRITABLE_STATUSES,
  PARENT_TYPE,
  PERSON_FIELDS,
  VERIFICATION_FIELDS,
  TAGS_MAX,
  MULTI_SELECT_FIELDS,
  CADENCE_DAYS,
  CADENCES,
  DEFAULT_CADENCE,
  BODY_SECTIONS,
  RELATED_VIEW,
  WORD_CEILING,
  DOMAINS,
  AUDIENCES,
  SEGMENTS,
  L2C,
  TAGS,
  IDENTITY,
  IDENTITY_PROPERTIES,
  IDENTITY_VALUES,
  listProblem,
  listValues,
  sectionsFor,
  requiredSectionsFor,
  neverEmptySectionsFor,
  canBeParent,
  cadenceDays
}

// GENERATED FILE. DO NOT EDIT.
// Copied from shared/memos-schema.js by scripts/vendor.js.
// Edit the source and re-run that script. An edit here is reverted by the
// next run and reported as drift by tests/vendor-copies-current.test.js.
'use strict'

/**
 * The Memos facts a writer needs, in machine-readable form.
 *
 * THIS FILE IS THE SOURCE. It is vendored into plugins by `scripts/vendor.js`.
 * See the header on `shared/config-read.js` for why a copy rather than a
 * require.
 *
 * WHY IT EXISTS SEPARATELY FROM `plugins/setup/scripts/schema.js`. That file is
 * the definition `setup` builds the database from, and an installed `memos`
 * cannot reach it. Two files describing one database is the shape this
 * repository distrusts, and `tests/memos-schema-agrees.test.js` holds them
 * together: every type, every value list and every field name here is asserted
 * against `setup`'s schema.
 *
 * `SCHEMA-memos.md` is the human definition and wins over this file where they
 * disagree. `SKILLS-memos.md` is the human definition of the skills. The test
 * is what makes that a check rather than a hope.
 *
 * THE RULE EVERYTHING HERE FOLLOWS FROM: Memos is time-stamped communication
 * and append-only. A memo records what was said on a date. Its body and content
 * properties are never updated, a correction is a new memo, and the one
 * permitted status move after publication is a person retracting one in Notion.
 * That is why this file carries no verification fields, no cadence table and no
 * updatable-field list: the plugin has no update to feed.
 */

/** The seven kinds of communication, in the option order Notion sorts by. */
const TYPES = [
  'Memo',
  'Project Update',
  'Team Update',
  'Meeting Notes',
  'Problem Statement',
  'Release',
  'Incident Report'
]

/**
 * All three statuses, because a reader has to be able to read a row carrying
 * any of them. What a skill may WRITE is far narrower, see below.
 */
const STATUSES = ['Draft', 'Published', 'Canceled']

/**
 * The one status a skill may write.
 *
 * `Draft` is a person's to set in Notion, because a skill that writes a draft
 * has written nothing useful: same rule as `Active` on Process. `Canceled` is a
 * retraction, it is made by a person, and it requires a correcting memo saying
 * why, so a skill writing it would be retracting something on nobody's word.
 */
const WRITABLE_STATUSES = ['Published']

/**
 * Person properties on this database. Written only when config records a
 * person, per the nullable `personId` rule in `SKILLS-setup.md`.
 *
 * `Author`, not `Owner`. Nobody maintains a memo, so nothing is owned. The
 * word is the append-only rule reaching the person filling the field.
 */
const PERSON_FIELDS = ['Author']

/**
 * Tags has a maximum of three, which Notion cannot enforce and no view can
 * watch. Measured 2026-08-17. `setup:check` reports rows that break it, and a
 * writer refuses to write a fourth rather than writing it and being reported.
 */
const TAGS_MAX = 3

/** The multi-select properties, which take a list and reject a bare string. */
const MULTI_SELECT_FIELDS = ['Audience', 'Segment', 'L2C Lifecycle', 'Tags']

/**
 * The one type that carries `Period covered`, and the only type allowed to.
 *
 * The field is what separates a Team Update from a Project Update, so a writer
 * requires it on one and refuses it on everything else. Left optional
 * everywhere, the distinction the field exists to carry would erode one row at
 * a time.
 */
const PERIOD_TYPE = 'Team Update'

/**
 * The body sections for each type, in order.
 *
 * At most one conditional section per type, always last, which is the rule
 * `SCHEMA-memos.md` states and `tests/memos-schema-agrees.test.js` pins.
 * `Sources` is conditional where content usually comes from somewhere else;
 * `Discussion Notes` is conditional because meeting notes fail by becoming
 * transcripts; `Links` is conditional because a release does not always have
 * them. Team Update and Incident Report have no conditional section at all.
 *
 * THERE IS NO `neverEmpty` FLAG HERE, DELIBERATELY, and the difference from
 * `shared/process-schema.js` is worth stating. Process marks two sections that
 * must say "none known" in place. The memos design has four sections whose
 * empty case is information ("nothing this week" in Needs A Decision From You,
 * "nothing was settled" in Decisions, "none" in Known Gaps, "nothing changed
 * and here is why" in What Changed), and each has its own phrase. Every one of
 * them is a required section, so a blank one is already refused; the phrase to
 * write instead is the skill's to teach, not a constant to enforce.
 */
const BODY_SECTIONS = {
  Memo: [
    { heading: 'Recommendation', conditional: false },
    { heading: 'What It Changes', conditional: false },
    { heading: 'Why This And Not The Alternative', conditional: false },
    { heading: 'What I Need From You', conditional: false },
    { heading: 'Sources', conditional: true }
  ],
  'Project Update': [
    { heading: 'What Changed', conditional: false },
    { heading: 'Why', conditional: false },
    { heading: 'Who Is Affected And When', conditional: false },
    { heading: 'What You Need To Do', conditional: false },
    { heading: 'Sources', conditional: true }
  ],
  'Team Update': [
    { heading: 'TLDR', conditional: false },
    { heading: 'What Shipped', conditional: false },
    { heading: 'What Is Still Open', conditional: false },
    { heading: 'Needs A Decision From You', conditional: false }
  ],
  'Meeting Notes': [
    { heading: 'Decisions', conditional: false },
    { heading: 'Actions', conditional: false },
    { heading: 'Open Questions', conditional: false },
    { heading: 'Discussion Notes', conditional: true }
  ],
  'Problem Statement': [
    { heading: 'What This Blocks', conditional: false },
    { heading: "What's Happening", conditional: false },
    { heading: 'Who Feels It', conditional: false },
    { heading: 'Evidence', conditional: false },
    { heading: 'Cost Of Doing Nothing', conditional: false },
    { heading: 'Sources', conditional: true }
  ],
  Release: [
    { heading: 'What This Lets You Do', conditional: false },
    { heading: 'What Shipped', conditional: false },
    { heading: 'How To Get It', conditional: false },
    { heading: 'Known Gaps', conditional: false },
    { heading: 'Links', conditional: true }
  ],
  'Incident Report': [
    { heading: 'Impact', conditional: false },
    { heading: 'What Happened', conditional: false },
    { heading: 'Timeline', conditional: false },
    { heading: 'Why It Happened', conditional: false },
    { heading: 'What Changed', conditional: false }
  ]
}

/**
 * Words across the required sections. A maximum, never a minimum, for the
 * reason `SCHEMA-process.md` argues in full: a floor manufactures filler.
 *
 * 600 rather than Process's 800, because a memo is read once on the day it
 * lands while an artifact is returned to for years. Conditional sections sit
 * outside the count, which is what lets Meeting Notes carry a long discussion
 * record without breaking the rule.
 *
 * AT THE CEILING THE SKILL ASKS RATHER THAN TRIMS. For a memo, running long
 * usually means the detail belongs in a Process artifact this memo should link
 * to instead.
 */
const WORD_CEILING = 600

/**
 * Every logical name the recorded map has to carry, and every option value the
 * writer can resolve through it.
 *
 * THIS IS THE CONTRACT `shared/config-read.js` CHECKS THE CONFIG AGAINST. The
 * full reasoning is on `shared/calendar-schema.js`: a map that is merely well
 * formed passes every structural check and then sends a renamed workspace a
 * value it does not have, which is a hard 400 that loses the whole page.
 *
 * `tests/memos-schema-agrees.test.js` asserts this equals
 * `identityNames('memos')` exactly, in both directions, so a property added to
 * the database and not added here fails a test rather than a write.
 */
const IDENTITY_PROPERTIES = [
  'Name',
  'Description',
  'Type',
  'Published date',
  'Author',
  'Status',
  'Domain',
  'Audience',
  'Segment',
  'L2C Lifecycle',
  'Tags',
  'Period covered',
  'Created time',
  'Corrects',
  'Artifacts',
  'Corrected by',
  'Projects'
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

const IDENTITY_VALUES = {
  Type: TYPES,
  Status: STATUSES,
  Domain: DOMAINS,
  Audience: AUDIENCES,
  Segment: SEGMENTS,
  'L2C Lifecycle': L2C,
  Tags: TAGS
}

const IDENTITY = {
  properties: IDENTITY_PROPERTIES,
  values: IDENTITY_VALUES
}

/**
 * What is wrong with a multi-select value, or null when nothing is.
 *
 * An absent value is legal and means the row said nothing, which is a real
 * answer and not a fault. Everything else has to be a list of non-empty
 * strings.
 *
 * A THIRD COPY OF `shared/calendar-schema.js`, deliberately and visibly. The
 * plugins are separate releases and none can require another, so the choice is
 * a copy or a vendored file for eleven lines. `tests/list-values-agree.test.js`
 * runs every implementation over the same inputs and asserts they answer
 * identically, which makes the copy a checked one rather than a hidden one.
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
 * TRIMMED, ONCE, HERE. The reason is written on the calendar copy: a value
 * compared trimmed on one path and written untrimmed on another matched an
 * existing row and then went to Notion with its spaces on, where it maps to no
 * option and comes back a 400.
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

/**
 * Whether this type carries `Period covered`.
 *
 * Takes the type rather than the row, so a caller cannot pass a half-built row
 * and get a confident answer about a field it never set.
 */
function carriesPeriod (type) {
  return type === PERIOD_TYPE
}

module.exports = {
  TYPES,
  STATUSES,
  WRITABLE_STATUSES,
  PERSON_FIELDS,
  TAGS_MAX,
  MULTI_SELECT_FIELDS,
  PERIOD_TYPE,
  BODY_SECTIONS,
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
  carriesPeriod
}

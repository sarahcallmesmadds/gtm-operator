// GENERATED FILE. DO NOT EDIT.
// Copied from shared/calendar-schema.js by scripts/vendor.js.
// Edit the source and re-run that script. An edit here is reverted by the
// next run and reported as drift by tests/vendor-copies-current.test.js.
'use strict'

/**
 * The Calendar facts a writer needs, in machine-readable form.
 *
 * THIS FILE IS THE SOURCE. It is vendored into plugins by `scripts/vendor.js`.
 * See the header on `shared/config-read.js` for why a copy rather than a
 * require.
 *
 * WHY IT EXISTS SEPARATELY FROM `plugins/setup/scripts/schema.js`. That file is
 * the definition `setup` builds the database from, and an installed `calendar`
 * cannot reach it. So these are two files describing one database, which is the
 * shape this repository distrusts, and `tests/calendar-schema-agrees.test.js`
 * holds them together: every type, every status and every field name here is
 * asserted against `setup`'s schema and against `manifest.js`.
 *
 * IT IS DELIBERATELY NARROWER THAN `setup`'s SCHEMA. `setup` needs property
 * types and option colours because it creates the database. A writer needs the
 * value lists and the rules about which field applies when. Carrying the colours
 * here would be carrying something nothing reads, and a copy nothing reads is a
 * copy nobody notices going stale.
 *
 * The value lists under `IDENTITY` are the exception to that narrowing, added on
 * 2026-08-19. They are read, by the completeness check on the recorded name map,
 * and the reasoning is written beside them.
 *
 * `SCHEMA-calendar.md` is the human definition and wins over this file where
 * they disagree. The test is what makes that a check rather than a hope.
 */

/** Heaviest first, which is the option order in Notion. */
const TYPES = ['Event', 'Content', 'Social post', 'Email send', 'Launch']

const STATUSES = ['Idea', 'Planned', 'Confirmed', 'Done', 'Canceled']

/**
 * Meaningless on anything but an Event.
 *
 * `Our role` replaces four of the reference's separate types. `Format` and
 * `Location` describe a thing people turn up to.
 */
const EVENT_ONLY = ['Our role', 'Format', 'Location']

/**
 * Meaningless on an Event, which has a Format and a Location instead.
 *
 * One list across Content, Social post and Email send, because a YouTube video
 * and a LinkedIn post are the same kind of fact about where something goes out.
 */
const NOT_FOR_EVENTS = ['Channel']

/**
 * The statuses that require a date.
 *
 * `Canceled` is deliberately absent. Corrected 2026-08-19, after review found
 * `SCHEMA-calendar.md` reading "from Confirmed onwards" while `manifest.js` had
 * already excluded it. The rule catches a row promising something will happen
 * without saying when, and a canceled row promises nothing.
 *
 * `tests/calendar-schema-agrees.test.js` asserts this matches the filter on the
 * `Needs attention` view, which is where the same rule is enforced in Notion.
 */
const DATE_REQUIRED_AT = ['Confirmed', 'Done']

/** Statuses a row may sit at with no date. The complement, derived not written. */
const DATE_OPTIONAL_AT = STATUSES.filter(s => !DATE_REQUIRED_AT.includes(s))

/** Person properties on this database. Written only when config records a person. */
const PERSON_FIELDS = ['Owner']

/**
 * The body sections, in order.
 *
 * `What We Need To Do` and `How It Went` are conditional. `How It Went` is
 * written after the fact and is the only place in the whole design where a
 * result is recorded, deliberately in prose rather than as a metric.
 */
const BODY_SECTIONS = [
  { heading: 'What It Is', conditional: false },
  { heading: 'Why We Are Doing It', conditional: false },
  { heading: 'What We Need To Do', conditional: true },
  { heading: 'How It Went', conditional: true }
]

/** The sections that count toward the ceiling. Conditional ones sit outside it. */
const REQUIRED_SECTIONS = BODY_SECTIONS.filter(s => !s.conditional).map(s => s.heading)

/**
 * Words across the required sections. No minimum.
 *
 * The row is a calendar entry, not the plan. Length here means content that
 * belongs on the related project or in a Process artifact.
 */
const WORD_CEILING = 400

/** The section a debrief goes in, and the status that asks for it. */
const DEBRIEF = { section: 'How It Went', triggeredBy: 'Done' }

/**
 * Every logical name the recorded map has to carry, and every option value the
 * writer can resolve through it.
 *
 * THIS IS THE CONTRACT `shared/config-read.js` CHECKS THE CONFIG AGAINST, and
 * it exists because the reader used to accept a map that was merely well formed.
 * A map holding nothing but `{Name: "Name"}` passed every check, was reported as
 * `ok`, and then threw on the first property nobody had recorded, with a message
 * blaming the caller for a bug the config had. Worse than the throw: an option
 * this map does not mention falls back to the name this plugin shipped with, so
 * a workspace that renamed a value gets sent the old one. NOTION REFUSES A
 * SELECT VALUE THE PROPERTY DOES NOT HAVE. Measured against a live workspace on
 * 2026-08-17, recorded in `REVIEW-codex-2026-08-17.md`: a hard 400
 * `validation_error` naming the offending value and listing the allowed ones,
 * for `select` and `multi_select` alike. THE FAILURE IS ALL OR NOTHING, so the
 * page is not created and a drafted artifact is lost at write time. That is the
 * reason to refuse here, at read time, rather than at the moment of writing.
 *
 * IT IS THE SAME RULE `setup` ALREADY APPLIES TO ITSELF.
 * `plugins/setup/scripts/schema.js` builds the same contract from the database
 * definition as `identityNames('calendar')`, and `config.js` checks a recorded
 * map against it before saving. This is that check moved to the reading side,
 * where the writer that would act on a bad map actually lives.
 *
 * SO IT IS A COPY, and it is the one copy in this file that carries values
 * rather than rules. `tests/calendar-schema-agrees.test.js` asserts it equals
 * `identityNames('calendar')` exactly, in both directions, so a property added
 * to the database and not added here fails a test rather than a write.
 *
 * A NOTE ON WHAT COMPLETENESS MEANS HERE. A map records every logical name,
 * including the ones nobody renamed, because that is what makes "not in the map"
 * mean "nobody recorded this" rather than "nobody changed this". Both halves of
 * that sentence are load-bearing, and they are why the missing-entry check is a
 * refusal rather than a warning.
 */
const IDENTITY_PROPERTIES = [
  'Name',
  'Description',
  'Type',
  'Status',
  'Date',
  'Our role',
  'Format',
  'Location',
  'Channel',
  'Domain',
  'Audience',
  'Segment',
  'L2C Lifecycle',
  'Owner',
  'Link',
  'Created time',
  'Project',
  'Artifacts'
]

/**
 * The option values, per property.
 *
 * `Type` and `Status` are the lists already defined above rather than second
 * copies of them. The rest are defined here because nothing else in this file
 * needed them until the map had to be checked for completeness.
 */
const IDENTITY_VALUES = {
  Type: TYPES,
  Status: STATUSES,
  'Our role': ['Hosting', 'Sponsoring', 'Speaking', 'Attending'],
  Format: ['Conference', 'Webinar', 'Dinner', 'Roundtable', 'Workshop', 'Meetup'],
  Channel: ['LinkedIn', 'X', 'Instagram', 'TikTok', 'YouTube', 'Blog', 'Newsletter', 'Podcast', 'Email'],
  Domain: [
    'Customer Success',
    'Data & Systems',
    'Deal Execution',
    'GTM Strategy & ICP',
    'Marketing & Campaigns',
    'Partnerships & Agency',
    'Pipeline & Demand Gen',
    'Sales Enablement'
  ],
  Audience: [
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
  ],
  Segment: ['Enterprise', 'Mid-Market', 'SMB'],
  'L2C Lifecycle': [
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
}

/** The contract in the shape `contextFor` takes. */
const IDENTITY = { properties: IDENTITY_PROPERTIES, values: IDENTITY_VALUES }

/**
 * THE FOUR MULTI-SELECT FIELDS, and the one rule for what may be in one.
 *
 * WHY THIS IS HERE RATHER THAN IN EACH CALLER. Round 9 found the read path and
 * the write path disagreeing about the same value. `parseArrayColumn` and
 * `namesOnly` refused a list holding anything but strings, `clash.targetingValues`
 * filtered those entries away and read the row as targeting nobody, and
 * `properties` forwarded them to Notion untouched while omitting a bare string
 * entirely and reporting no problem. Three paths, three answers, one value.
 *
 * Verified 2026-08-21 against fixtures: `Segment: [{name: "Enterprise"}]` and
 * `Segment: [1]` each made a real same-day, same-segment clash report
 * `overlapping: 0`, and `Segment: "Enterprise"` vanished from the payload with
 * `problems` reporting nothing wrong.
 *
 * The rule lives here once. The wording does not: a value that came back from a
 * query and a value somebody handed in are different situations to be in, and
 * each caller says which. What they may not do is disagree about what is legal.
 */
const MULTI_SELECT_FIELDS = ['Channel', 'Audience', 'Segment', 'L2C Lifecycle']

/**
 * What is wrong with a multi-select value, or null when nothing is.
 *
 * An absent value is legal and means the row said nothing, which is a real
 * answer and not a fault. Everything else has to be a list of non-empty strings.
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
 * TRIMMED, ONCE, HERE. `clash.targetingValues` trimmed each value before
 * comparing and `row.properties` wrote it untrimmed, so `" Enterprise "` matched
 * an existing row in the clash check and then went to Notion with its spaces on,
 * where it maps to no option and comes back a 400. Loud rather than silent, but
 * it is the same fault as the rest: one value, two paths, two answers.
 *
 * Call `listProblem` first. This assumes what that function checks.
 */
function listValues (value) {
  if (!Array.isArray(value)) return []
  return value.map(entry => entry.trim())
}

module.exports = {
  MULTI_SELECT_FIELDS,
  listProblem,
  listValues,
  TYPES,
  IDENTITY,
  IDENTITY_PROPERTIES,
  IDENTITY_VALUES,
  STATUSES,
  EVENT_ONLY,
  NOT_FOR_EVENTS,
  DATE_REQUIRED_AT,
  DATE_OPTIONAL_AT,
  PERSON_FIELDS,
  BODY_SECTIONS,
  REQUIRED_SECTIONS,
  WORD_CEILING,
  DEBRIEF
}

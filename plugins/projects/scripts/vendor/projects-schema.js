// GENERATED FILE. DO NOT EDIT.
// Copied from shared/projects-schema.js by scripts/vendor.js.
// Edit the source and re-run that script. An edit here is reverted by the
// next run and reported as drift by tests/vendor-copies-current.test.js.
'use strict'

/**
 * The Projects and Tasks facts a writer needs, in machine-readable form.
 *
 * THIS FILE IS THE SOURCE. It is vendored into plugins by `scripts/vendor.js`.
 * See the header on `shared/config-read.js` for why a copy rather than a
 * require.
 *
 * ONE FILE FOR TWO DATABASES, the same split as `SCHEMA-projects.md`: Tasks
 * cannot exist without Projects, so they are one job and one definition.
 * `tests/projects-schema-agrees.test.js` asserts every list and every field
 * name here against `setup`'s schema, for both databases.
 *
 * `SCHEMA-projects.md` is the human definition and wins over this file where
 * they disagree. `SKILLS-projects.md` is the human definition of the skills.
 *
 * THE RULE EVERYTHING HERE FOLLOWS FROM: a skill never advances a status it
 * did not earn. Exactly three skills touch a project's status, no skill moves
 * it more than one step, and task statuses are managed by people. The
 * transition tables below are that rule in a form a gate can hold.
 */

/** The project lifecycle, in the option order Notion sorts by. */
const PROJECT_STATUSES = ['Intake', 'Scoped', 'In progress', 'Done', 'Canceled']

/**
 * The task lifecycle. Deliberately different from Projects: `Scoped` has no
 * meaning on a task, and `Blocked` has real meaning on one.
 */
const TASK_STATUSES = ['Not started', 'In progress', 'Blocked', 'Done', 'Canceled']

/**
 * What each skill may leave a project at, from `SKILLS-projects.md`:
 *
 *   scope   Scoped, or Canceled
 *   new     In progress, and only from Scoped
 *   ship    Done, and only from In progress
 *
 * Cancelling work already in progress is a manual change in Notion, and no
 * skill does it: stopping something mid-flight is a decision a person makes in
 * the record, not a side effect of running a command. `Intake` is a person's
 * too, the state a hand-made row starts in.
 */
const SCOPE_WRITABLE_STATUSES = ['Scoped', 'Canceled']
const ADVANCE = { from: 'Scoped', to: 'In progress' }
const CLOSE = { from: 'In progress', to: 'Done' }

/** The one status a task is created at. Nothing in v1 moves it. */
const TASK_CREATE_STATUS = 'Not started'

const PRIORITIES = ['Prio 1', 'Prio 2', 'Prio 3', 'TBD']
const EFFORTS = ['Low', 'Med', 'High', 'TBD']

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

/**
 * Person properties, written only when asked or configured, per the nullable
 * `personId` rule in `SKILLS-setup.md`. `Owner` is one accountable person and
 * `Stakeholders` is the list; the reference blurred these, and shared
 * ownership reads as nobody's.
 */
const PERSON_FIELDS = ['Owner', 'Stakeholders']
const TASK_PERSON_FIELDS = ['Assignee']

/** The multi-select properties on Projects. Tasks has none. */
const MULTI_SELECT_FIELDS = ['Segment', 'L2C Lifecycle']

/**
 * The project page body: the scope document. Four sections, all required,
 * none conditional, against the reference's ten, because a ten-section
 * template is filled in fully once and then abandoned.
 *
 * `Risks And Dependencies` takes "none known" as an honest answer, so the
 * question was visibly asked. `Out Of Scope` does not: everything has an out
 * of scope, and a blank or a "nothing" there is the single best predictor
 * that the project will grow. The gate refuses the literal dismissals it can
 * see; the judgment beyond that is the skill's.
 */
const PROJECT_SECTIONS = [
  { heading: 'What We Are Building', conditional: false },
  { heading: 'Out Of Scope', conditional: false },
  { heading: 'Success Criteria', conditional: false },
  { heading: 'Risks And Dependencies', conditional: false }
]

/**
 * The task page body, recorded for completeness and written by NO skill in
 * v1. Requirements live in the task body, written when the task is picked up,
 * by a person: `new` creates tasks with properties only, because a PRD
 * written at creation time is a document about work nobody has started.
 */
const TASK_SECTIONS = [
  { heading: 'What Needs Doing', conditional: false },
  { heading: 'Done When', conditional: false },
  { heading: 'Notes', conditional: true }
]

/**
 * The band the task breakdown should land in. A concern, never a refusal: a
 * three-task or eight-task breakdown is a question for the person, not a
 * corrupt row.
 */
const TASK_COUNT = { min: 4, max: 7 }

/**
 * The properties `new` never writes, because they are `scope`'s output and
 * overwriting them silently discards a scoping conversation. The page body is
 * preserved too; it is not a property, so it is not in this list, and the
 * gate refuses a body on the advance path separately.
 */
const SCOPE_OWNED = ['Memos', 'Priority', 'Level of Effort', 'Business outcome']

/** The properties `new` sets only if `scope` left them empty. */
const NEW_ONLY_IF_EMPTY = ['Domain', 'Segment', 'L2C Lifecycle']

/**
 * The three memo types this plugin writes, and the only three. `memos:new` is
 * the general path for somebody not standing in a project; these are the
 * project-context entry points, and every other type is refused with a
 * pointer rather than accepted.
 */
const MEMO_TYPES = {
  'problem-statement': 'Problem Statement',
  comms: 'Project Update',
  ship: 'Release'
}

/**
 * Every logical name the recorded Projects map has to carry, and every option
 * value the writer can resolve through it. The contract `shared/config-read.js`
 * checks the config against; `tests/projects-schema-agrees.test.js` asserts it
 * equals `identityNames('projects')` exactly, in both directions.
 */
const IDENTITY_PROPERTIES = [
  'Name',
  'Description',
  'Status',
  'Priority',
  'Level of Effort',
  'Owner',
  'Stakeholders',
  'Domain',
  'Segment',
  'L2C Lifecycle',
  'Timeline',
  'Business outcome',
  'Created time',
  'Memos',
  'Artifacts',
  'Tasks',
  'Calendar'
]

const IDENTITY_VALUES = {
  Status: PROJECT_STATUSES,
  Priority: PRIORITIES,
  'Level of Effort': EFFORTS,
  Domain: DOMAINS,
  Segment: SEGMENTS,
  'L2C Lifecycle': L2C
}

const IDENTITY = {
  properties: IDENTITY_PROPERTIES,
  values: IDENTITY_VALUES
}

/**
 * The same contract for Tasks, which this plugin owns too. The title is
 * `Task name`, not `Name`; that is deliberate in the design and it is the
 * kind of detail a generator gets wrong.
 */
const TASK_IDENTITY_PROPERTIES = [
  'Task name',
  'Description',
  'Status',
  'Assignee',
  'Due date',
  'Order',
  'Created time',
  'Parent task',
  'Project',
  'Sub-tasks'
]

const TASK_IDENTITY_VALUES = {
  Status: TASK_STATUSES
}

const TASKS_IDENTITY = {
  properties: TASK_IDENTITY_PROPERTIES,
  values: TASK_IDENTITY_VALUES
}

/**
 * What is wrong with a multi-select value, or null when nothing is.
 *
 * An absent value is legal and means the row said nothing, which is a real
 * answer and not a fault. Everything else has to be a list of non-empty
 * strings.
 *
 * A FOURTH COPY OF `shared/calendar-schema.js`, deliberately and visibly. The
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

module.exports = {
  PROJECT_STATUSES,
  TASK_STATUSES,
  SCOPE_WRITABLE_STATUSES,
  ADVANCE,
  CLOSE,
  TASK_CREATE_STATUS,
  PRIORITIES,
  EFFORTS,
  DOMAINS,
  SEGMENTS,
  L2C,
  PERSON_FIELDS,
  TASK_PERSON_FIELDS,
  MULTI_SELECT_FIELDS,
  PROJECT_SECTIONS,
  TASK_SECTIONS,
  TASK_COUNT,
  SCOPE_OWNED,
  NEW_ONLY_IF_EMPTY,
  MEMO_TYPES,
  IDENTITY,
  IDENTITY_PROPERTIES,
  IDENTITY_VALUES,
  TASKS_IDENTITY,
  TASK_IDENTITY_PROPERTIES,
  TASK_IDENTITY_VALUES,
  listProblem,
  listValues
}

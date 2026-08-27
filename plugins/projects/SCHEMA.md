# Projects and Tasks: schema and templates

**This file defines the Projects and Tasks databases.** Field names, property
types, allowed values and option order live here and nowhere else. Anything in
another document that restates them is a copy, and copies drift.

`DECISIONS.md` at the repository root holds the reasoning, the reversals, and the rules
about what not to re-propose. It points here rather than repeating any of it.

Both databases belong to `projects`, and `setup` creates them together.
Tasks cannot exist without Projects, so they are one job.

Companions: `plugins/process/SCHEMA.md` and `plugins/memos/SCHEMA.md`. Shared fields
(Domain, Segment, L2C Lifecycle) use identical value lists across all four
databases. A change to one is a change to all.

---

## Part 1: Projects schema

### Fields

| Field | Type | Values / notes |
|---|---|---|
| Name | Title | |
| Description | Text | one sentence |
| Status | Select | Intake, Scoped, In progress, Done, Canceled. **Select, not Notion's Status type**, see below |
| Priority | Select | Prio 1, Prio 2, Prio 3, TBD |
| Level of Effort | Select | Low, Med, High, TBD |
| Owner | Person | one accountable person, not a list |
| Stakeholders | Person (multi) | who is consulted or affected |
| Domain | Select | the same 8 values as `plugins/process/SCHEMA.md` |
| Segment | Multi-select | the same list, see "LOB impact" below |
| L2C Lifecycle | Multi-select | the same 0 to 8, see "Impact to Funnel" below |
| Timeline | Date range | start and target end |
| Business outcome | Text | what success looks like in a sentence |
| Artifacts | Relation to Process | what this project produced or changed |
| Memos | Relation | updates and releases about this project |
| Calendar | Relation | inverse of `Project` on Calendar. What this project is putting in market, and when. Added 2026-08-17, see `plugins/calendar/SCHEMA.md` |
| Tasks | Relation | |
| Created time | Created time | |

### Status

`Intake` to `Scoped` to `In progress` to `Done` or `Canceled`. Settled earlier
and unchanged, see DECISIONS.md for why `Backlog` was renamed and why `Scoped`
exists.

#### It is a Select, and that was measured rather than chosen

**Proved by running, 2026-08-17.** Both databases were specified as Notion's
`status` property type, which is the one that groups values into to-do, in
progress and complete and gives you a board you drag cards across.

**The API cannot create one with your own values.** A throwaway database was
created with a `STATUS` column and it came back carrying Notion's three defaults,
Not started, In progress and Done, and nothing else. Supplying options was then
rejected two ways, on creation and on alter:

> Invalid statements at position 25: Expected ADD, DROP, RENAME, or ALTER
> keyword, got "("

A `SELECT` column created in the same call took its five custom options without
complaint, in the order given.

**So both databases use `Select`.** What is lost is Notion's built-in status
grouping. A board view grouped by a Select still works, so the drag-across-columns
experience survives.

**This also makes the design more consistent than it was.** All four databases now
use `Select` for status, where previously two used one property type and two used
another, which was a difference nobody had chosen and that would have broken any
shared helper.

**The wider lesson, and it is the second time today.** This was carried as the
highest-risk unverified assumption in the design, on the reasoning that it would
change a schema rather than a line of code. It did. Ten minutes against a real
workspace settled it, the same way the select-value question was settled after two
written sources had it wrong.

**The reference had ten values.** `Backlog`, `Planning`, `Blocked`, `Paused`,
`Always-on`, `UAT Completed` and `Exclude` are all cut. `Blocked` and `Paused`
describe why something is not moving rather than where it has got to, which is a
note or a view filter, not a status. `Always-on` and `Exclude` are ways of
hiding rows from a view, which a filter does better. `UAT Completed` is one
team's release process.

### Two fields that already exist under other names

| Reference field | What it actually is |
|---|---|
| `LOB impact` (Agency, Enterprise, Mid-Market, SMB) | **Segment.** Already defined, already editable, already used by two other databases |
| `Impact to Funnel` (Top of funnel, Middle of funnel, Customer, n/a) | **L2C Lifecycle**, at a coarser grain. Reuse the 0 to 8 rather than carrying a second, blunter version of the same idea |

Reusing them means one vocabulary across all four databases, which is what makes
a cross-database view possible at all.

### Projects have no hierarchy, and that is deliberate

The reference's `Initiative` field held over a hundred distinct values. **This
was first read as evidence that projects need a parent relation, and that was
wrong.** Recorded here with the reasoning, because the argument is persuasive
and will otherwise be made again.

Why a parent project does not work:

- **A parent project is usually not a project.** "AI Enablement" has no owner,
  no scope, no success criterion and no end. As a row it never moves through
  Intake, Scoped, In progress, Done, so it sits in every filtered view forever
  and nothing computes its progress, because the rollup fields are dropped in
  v1 as derived.
- **The Process parallel does not hold.** There, `Parent` carries a rule
  the plugin enforces: only a Strategy Decision can be a parent, so the
  hierarchy means something specific. Projects has no type distinction to hang a
  rule on, so nothing prevents a five-level tree, which is how project
  hierarchies become unusable.
- **A hundred values is a governance failure, not a field-type failure.** It is
  equally good evidence that nobody ever pruned a list.

**What groups projects instead**, both already in the schema and costing no new
field:

1. **Domain**, eight controlled values. Grouping by function.
2. **The Strategy Decision.** This is the better answer. A large effort's "why"
   belongs in Process as a Strategy Decision, and several projects
   relating to it is exactly the grouping a parent was reaching for. It also
   puts the reasoning where it is maintained rather than in a project row nobody
   updates.

**Do not re-propose an Initiative select, and do not re-propose a parent project
relation.** If grouping is needed beyond Domain and the Strategy Decision, the
answer is a view.

**This does not apply to Tasks**, which keep `Parent task` and `Sub-tasks`.
Subtasks are bounded, one level deep in practice, and a different thing from a
project hierarchy.

### Dropped from the reference

| Dropped | Reason |
|---|---|
| Initiative | Over a hundred uncontrolled values. Domain and the Strategy Decision relation cover what it was reaching for. See "Projects have no hierarchy" above |
| Company Goal | Four values specific to one company's year. A user's goals are theirs, and a shipped list of someone else's is worse than no field |
| RevOps Sprints, Sprint Update, Sprint Status | Sprints are dropped and not being rebuilt |
| Software | v1 has no Software directory. A later plugin pack |
| % Completed, Earliest start date, Latest end date | Derived from Tasks. A rollup, not a stored field, and not worth shipping in v1 |
| Date - do not use | Named by whoever could not delete it |
| Customer Tasks, MKT Projects | Pointed at databases that existed in one organisation only |

### Page body: Projects

**What it is.** The scope document. `projects:scope` writes it, and scope lives
here rather than in Memos or Process because it is a working
document rather than a broadcast.

**Body sections, in order:** What We Are Building, Out Of Scope, Success
Criteria, Risks And Dependencies.

**Why it is built this way.** The reference's Project Overview had ten sections,
including Change Management, Communication, and Supporting Resources. A
ten-section template is filled in fully once and then abandoned. Four survives.
Out Of Scope earns its place for the same reason `Not Used For` does on a
Strategy Decision: it is what stops a well-scoped project quietly growing.

**What goes in each part.**
- What We Are Building: the thing itself, in one paragraph, ending with a
  required sentence naming **the smallest version that would prove this works**.
  Anything that assumes the approach works without proving it belongs in Out Of
  Scope with the reason "later, once this is proven". Added 2026-08-17, carried
  from the reference scope skill, where it was the strongest anti-bloat device in
  the whole set.
- Out Of Scope: what this deliberately does not cover. **"Nothing" is not an
  acceptable answer.** Everything has an out of scope, and a blank here is the
  single best predictor that the project will grow.
- Success Criteria: how you will know it worked, in terms someone else could
  check.
- Risks And Dependencies: what could stop this, and what it is waiting on. If
  genuinely none, write "none known" so it is clear the question was asked.

**Why the problem is not a section.** It lives in the related Problem Statement
memo, which already has the stakes written into it. Restating it here would make
two copies that disagree within a month.

**And it is reached through `Memos`, not through a relation of its own.** Until
2026-08-18 Projects carried a second relation to Memos called `Problem
Statement`, with `Resulting Projects` as its far side. Two relations between the
same two databases meant two places to look and two places to get it wrong. There
is now one: a project's problem statement is the memo of that `Type` attached
through `Memos`.

**The rule is still required and still not enforceable by Notion.** The `Needs
attention` view in `plugins/setup/SKILLS.md` now catches a project with no memos at all,
which is the widest check a view can make. Narrowing it to the memo `Type` needs
a filter that reads through the relation, and a rollup filter was measured on
2026-08-17 to be accepted, reported as created, and read back as `filters: []`.

**Where a property and a section overlap, the body wins.** `Description` overlaps
What We Are Building, and `Business outcome` overlaps Success Criteria. In both
cases **the body is the content and the property is a short summary of it,
derived from the body and never the reverse.** The properties exist so a table
view is readable without opening every row. A skill that changes the body offers
to refresh the property. A skill never edits the property and leaves the body
alone, because that is how the two start disagreeing.

**Related view:** the Tasks relation, filtered to open tasks.

---

## Part 2: Tasks schema

### Fields

| Field | Type | Values / notes |
|---|---|---|
| Task name | Title | |
| Description | Text | one line |
| Status | Select | Not started, In progress, Blocked, Done, Canceled. **Select**, same reason as Projects |
| Project | Relation | **required by the skills, and surfaced when it is not.** A task with no project is invisible from every project, which is why setup builds a Needs attention view filtered to exactly those rows. Notion cannot make a relation required |
| Assignee | Person | |
| Due date | Date | |
| Parent task | Relation (self) | |
| Sub-tasks | Relation (self) | inverse of Parent task |
| Order | Number | manual ordering within a project |
| Created time | Created time | |

Ten fields against the reference's nineteen. Tasks are the most numerous rows in
the system and the most abandoned, so every field has to earn itself twice.

### Status differs from Projects, deliberately

Tasks use Not started, In progress, Blocked, Done, Canceled. Projects use Intake,
Scoped, In progress, Done, Canceled.

They differ because a project is scoped and a task is not. `Scoped` has no
meaning on a task, and `Blocked` has real meaning on one: a blocked task is the
thing a standup needs to surface, whereas a blocked project is a note on a
project that is still in progress.

`Archived` from the reference is dropped. `Canceled` covers it.

### Dropped from the reference

| Dropped | Reason |
|---|---|
| Phase | Over forty values, invented per project. It is free text in a dropdown, and what it was reaching for is Parent task |
| Proj Prio, Project Status | Copies of fields on the related project. A relation already reaches them, and a copy is a thing that can disagree |
| Completion Score | Derived from Status |
| Sprint | Sprints are dropped |
| Task ID | Notion has its own unique id property if a team wants one. Not worth shipping |
| Next steps | Belongs in the body, not a property |

### Order is a number, not a string

The reference's ordering column held values like `1.1`, `3.2` and `3a1`, which
is a workaround for Notion having no stored manual order. Shipping a plain
Number keeps the capability and drops the invented syntax. **Do not reproduce
the fractional string form.**

### Page body: Tasks

**What it is.** The working detail for one task, including its requirements when
it needs them.

**Body sections, in order:** What Needs Doing, Done When, Notes (conditional).

**Why it is built this way.** Three sections, the lightest template in the whole
system, because there are more tasks than anything else and a heavy template on
a numerous row type guarantees blank rows. Requirements live here rather than in
their own document, so a task carries its own detail and nothing has to be kept
in sync.

**What goes in each part.**
- What Needs Doing: the work. A paragraph, or the full requirements when the
  task warrants them. **This is the content. The `Description` property is a
  one-line summary of it**, derived from the body, same rule as on Projects.
- Done When: the check that settles it. **It has to be something another person
  could verify**, because a task whose completion is a matter of opinion never
  closes cleanly.
- Notes: conditional. Links, context, decisions made while working.

**Artifact pointers are sometimes, not never and not always.** A task links to
an artifact when it produced or changed one. Most do not.

**Related view:** the Sub-tasks relation when the task has any, otherwise none.

---

## What the three review passes changed

Same three lenses used on the Memos templates.

**Enablement pass** (can a new person fill this in without asking):
- `Out Of Scope` gained the explicit rule that "nothing" is not an acceptable
  answer, because a new person reads an optional-looking section as skippable.
- `Done When` gained the rule that it must be verifiable by someone else. Left
  open, it gets filled with a restatement of the task name.
- Projects `Owner` is one person, not a list, and `Stakeholders` is the list.
  The reference blurred these, and shared ownership reads as nobody's.

**User pass** (will this get finished or abandoned):
- Tasks capped at three body sections and ten fields. It is the most numerous
  row type, so it is the one where a heavy template does the most damage.
- `Risks And Dependencies` gained a "none known" fallback, because it was
  otherwise the section people leave blank, and a blank does not distinguish
  between no risks and no thought.
- Projects held to four body sections against the reference's ten.

**Executive feedback pass**, using the evaluation order in
`~/Projects/executive-feedback-coach/agent/INSTRUCTIONS.md`:
- **The decisive finding: a project page never said why the project was worth
  doing.** It described the work in detail and the stakes nowhere. The fix is
  not another section, because that would duplicate the Problem Statement memo
  and the two would disagree. **An attached problem statement memo is required
  instead**, reached through the `Memos` relation, so the stakes are always one
  click away and exist in one place. A project that cannot name its problem
  statement has not been scoped.
- Success Criteria was originally written as "Objectives", which states an
  intention rather than a test. Renamed so it has to be checkable.
- The reference carried both `Impact to Funnel` and `LOB impact` while the
  Process already defined richer versions of both. Carrying a blunter
  second copy of a field you have already designed is how cross-database views
  stop working.

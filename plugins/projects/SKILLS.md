# projects: what each skill does

Part 3 for `projects`. Six skills in the same five slots as
`plugins/process/SKILLS.md`: what it does, when it runs, what it reads and
writes, what it does not do, and the judgment it carries.

Databases are defined in `plugins/projects/SCHEMA.md` and `plugins/memos/SCHEMA.md`.
This file does not restate a field name or a value list.

`problem-statement-agent` is the agent surface over the first two skills below.
It may run the bounded read and synthesis loop, but `problem-scan` still owns the
read boundary and `problem-statement` still owns the complete preview, explicit
approval and read-back proof. The agent does not scope or create a project.

**Two of these were names with nothing behind them.** `problem-scan` and `ship`
are marked below with what they became and where that came from.

---

## Rules that apply to all six

**Every cross-cutting rule in `plugins/process/SKILLS.md` applies here unchanged**, all
eight of them: never invent a select value (Notion rejects the whole write with a
400, tested), verify the write landed, a hard confirmation gate, preview in full
inline, route to `setup:install` on first run, pin the Notion API version and
client floor to the two values `plugins/setup/SKILLS.md` defines, treat a related view as a view rather than a block, and record only
sources actually opened. Two more are specific to this plugin.

- **Iterate in chat, write once on approval.** These skills produce projects and
  tasks, which are expensive to undo. Refinement happens in conversation and one
  write happens at the end.
- **Every memo this plugin writes sets the same properties.** Three skills write
  to Memos (`problem-statement`, `comms`, `ship`) and they fill it identically
  apart from Type. "Writes one row in Memos" is not a specification, so here is
  the specification:

  | Field | Value |
  |---|---|
  | `Name` | Written by the skill, five to eight words |
  | `Description` | One sentence, under 200 characters |
  | `Type` | `Problem Statement`, `Project Update`, `Release` respectively |
  | `Status` | **`Published`.** Skills never write `Draft` |
  | `Published date` | Today. This is what `process:audit` reads, so it is not optional |
  | `Author` | The user, from their Notion person id in config. **Skipped when there is none**, see the nullable `personId` rule in `plugins/setup/SKILLS.md` |
  | `Projects` | The related project, when there is one. `problem-statement` may have none |
  | `Artifacts` | Any Process artifact this announced or changed. **`ship` in particular sets this**, since a release usually changes an SOP, and it is what makes the audit signal work |
  | `Domain` | Inherited from the project when there is one, otherwise asked |
  | `Audience`, `Segment`, `L2C Lifecycle`, `Tags` | Offered in the preview, never invented, left empty rather than guessed |
  | `Period covered` | Not used by this plugin. It belongs to Team Update |
  | `Corrects` | Only when the user says this memo corrects an earlier one |

  **`Draft` and `Canceled` are for a person to set in Notion.** No skill writes
  or advances them, because iteration happens in chat and one write happens on
  approval, so a memo that reaches Notion has already been approved.
  **Published to Canceled is the only status change permitted after publication**,
  it is a retraction, and it requires a correcting memo saying why. See "What
  append-only actually means" in `plugins/memos/SKILLS.md`.
- **A skill never advances a status it did not earn.** Exactly three skills
  touch a project's status, and no skill moves it more than one step:

  | Skill | May leave the project at |
  |---|---|
  | `scope` | `Scoped`, or `Canceled` |
  | `new` | `In progress` |
  | `ship` | `Done` |

  **Cancelling work already in progress is a manual change in Notion**, and no
  skill does it. That is deliberate: stopping something mid-flight is a decision
  with consequences for whoever is doing it, and it should be made in the record
  by a person rather than as a side effect of running a command. The path exists
  in the schema, it just is not automated.

- **Task status is managed by people, not by skills.** `new` creates tasks at
  `Not started` and nothing else in v1 moves them. There is no start, block,
  complete, reassign or reschedule skill, because that is a project-management
  tool and this is not one. `Blocked` and `Canceled` on a task are there for a
  person to set.

---

## setup is no longer part of this plugin

**Moved out 2026-08-17.** See `plugins/process/SKILLS.md` and DECISIONS.md. One `setup`
plugin creates every database in the foundation.

This removes the largest source of complexity in the old design: two setups both
creating Memos, the shared registry file invented to let them find each other,
and the relation-wiring negotiation between them. One setup creates the databases
in order and wires every relation itself.

---

## problem-scan

This has no ancestor in the reference skills, so unlike the others it is not
reconstructed from anything that ran.

**What it does.** Finds problems that keep coming up and that nobody has written
down, and hands them to `problem-statement`.

**Why it exists.** `problem-statement` writes up a problem you already know
about. That leaves the more common case unserved: the friction everybody works
around and nobody has ever named. This is the same shape as
`process:backfill`, which finds undocumented process, applied to
undocumented problems.

**When it runs.** On demand, and it suits a regular rhythm such as before
planning.

**What it reads and writes. Reads only.** It produces a candidate list, one line
each: the problem, who described it, how often it came up, and where. You pick
the ones worth writing up and it hands each to `problem-statement` pre-filled.

Scope is the same as `backfill` and the same rules apply. Slack public channels
are all or a chosen set; direct messages are only the conversations specifically
named; Gmail is the user's own mailbox; one of Granola or Gong is selected per
recording pass; HubSpot and Salesforce reads name object families and account or
deal filters; Outreach reads name the accounts, prospects, sequences, tasks or
meetings; and Intercom or Pylon reads name the customer accounts, contacts,
conversations or issues. Every source carries a date range. **Never all DMs and
never an unbounded external read.**

All external connectors are context-only here. The skill uses read and search
tools even when a server exposes writes. It never sends, drafts, updates,
assigns, enrols, labels, archives or changes anything outside Notion, and this
skill itself writes nothing to Notion. Gong answers are labelled
transcript-derived because its hosted MCP does not return raw transcript text.

**What it does not do.**
- Writes nothing to Notion. Not a row, not a draft.
- Does not decide something is a problem. It offers candidates.
- Does not rank or prioritise them. Priority is set at the end of `scope`, once
  effort is known, and guessing earlier is guessing.
- Does not read outside the scope you set.
- Does not write to any external connector.

**The judgment it carries.** Telling a recurring problem from a one-off
complaint. Two signals, and it should say which fired:
1. **Different people describing the same friction.** The strongest signal, and
   the one a single person cannot produce.
2. **The same person raising it repeatedly over time.** Weaker on its own,
   because it can be one person's hobby horse, but strong when the gap between
   mentions is long.

A single complaint from one person on one day is not a candidate.

---

## problem-statement

**What it does.** Writes the case that something is worth fixing, before anyone
proposes a fix.

**When it runs.** Before scoping. Either from `problem-scan` handing one over, or
directly when you already know the problem. **No project needs to exist.**

**What it reads and writes.** Writes one row in Memos with Type = Problem
Statement, using that type's template: What's Happening, Who Feels It, Evidence,
Cost Of Doing Nothing.

**What it does not do.**
- **Never edits an existing problem statement.** Memos is append-only. A changed
  situation is a new row, which is what makes the original a record of what was
  believed at the time.
- Does not propose a solution. A problem statement with a fix inside it has
  already skipped the argument it exists to make.
- Does not create a project.

**The judgment it carries.** Whether there is enough here to be worth writing.
The Evidence section is where this bites: numbers where they exist, and where
they do not, **what was observed and how often**. It is never left blank, because
a problem with no evidence cannot be weighed against any other problem, and the
whole point of writing it down is to make that comparison possible.

---

## scope

**What it does.** Works out what a project actually is, what it deliberately is
not, and whether it should be built at all.

**When it runs.** After a problem statement exists. Expects either no project row
or one at `Intake`.

**What it reads and writes. `scope` creates the project row.** It has to,
because it writes the page body, the status, the effort and the priority, and
there is nowhere to put those without a row. If a row already exists at `Intake`
it fills that one in rather than creating a second.

Reads the problem statement and the surrounding context. Writes the project's
page body: What We Are Building, Out Of Scope, Success Criteria, Risks And
Dependencies. Sets `Level of Effort`, then `Priority`. Leaves the project at
`Scoped`, or at `Canceled`.

**Corrected 2026-08-17.** `scope` and `new` were both described as creating the
project row, which is a contradiction: whichever ran second would either
duplicate it or find its own branch unreachable. `scope` owns the row. `new`
owns the tasks.

**A problem statement is required by the skills, and surfaced when it is not.** A
project that cannot name its problem statement has not been scoped, and the stakes
then live nowhere, so `scope` refuses to finish without one.

**It is attached through `Memos`**, as a memo whose `Type` is `Problem Statement`.
There is no separate relation for it: the second relation to Memos was dropped on
2026-08-18, and one relation now carries the problem statement, the updates and
the releases alike.

Notion enforces nothing, so a project made by hand can have none, and `setup`
builds a `Needs attention` view showing projects with no memos at all. **That view
is wider than the rule.** A project carrying updates but no problem statement is
not caught by it, because narrowing the filter to the memo `Type` needs a filter
that reads through the relation, and a rollup filter was measured on 2026-08-17 to
be accepted and then silently discarded. `scope` is the check that holds the rule
exactly. See `plugins/setup/SKILLS.md`.

**What it does not do.**
- **Does not create tasks.** That is `new`.
- **Does not auto-run `new`.** It offers, pre-filled, and stops. Scoping can end
  in "do not build this", and that outcome must never flow onward by itself.
- Does not set Priority before Level of Effort. Priority needs severity from the
  problem statement and effort from the scope, and effort is only known now.
- Does not raise a section's cap when the content runs long.

**The judgment it carries.** Not over-scoping, which is the entire job. Three
things, in this order:

1. **What already exists, checked before scoping rather than after.** Search the
   Projects database, and Process, which is always there. Every hit
   becomes an Out Of Scope line reading "already exists". This is the single
   largest source of trimming, and it is why context comes first: a competent
   scoper over-scopes *because* they lack context, not despite expertise.
   **No longer conditional as of 2026-08-17.** This previously hedged, because
   two plugins each created their own databases and Process might be
   absent. One `setup` creates every database in the foundation, so it is always
   there and `scope` can rely on it.
2. **The smallest version that proves it.** A required sentence inside What We
   Are Building, naming the smallest thing that would show this works. Anything
   that assumes the approach works without proving it moves to Out Of Scope with
   the reason "later, once this is proven".
3. **The format does the trimming, never judgment and never a review round.**
   Sections have caps. When one runs long, cut it.

**Before writing Priority**, show what is already at that priority. A priority
set without seeing the others is not relative to anything, and a board where
everything is Prio 1 carries no information.

---

## new

**What it does.** Creates the tasks for a project that `scope` has already
created, and moves that project to `In progress`. **It does not create the project
row.** See the split above: `scope` owns the row, `new` owns the tasks.

**When it runs.** After `scope`. Expects a project at `Scoped`. Leaves it at
`In progress`.

**What it reads and writes.** Reads the scoped project. **Creates its tasks.**
It does not create the project row, which `scope` owns.

Exactly what it may touch on the project:

| Field | `new` |
|---|---|
| `Owner` | Sets, defaulting to whoever runs it |
| `Stakeholders`, `Timeline` | Sets if it can determine them, offers in the preview either way |
| `Status` | Moves to `In progress`, and only from `Scoped` |
| `Tasks` | Populated as tasks are created |
| `Domain`, `Segment`, `L2C Lifecycle` | Sets only if `scope` left them empty |
| `Memos`, `Priority`, `Level of Effort`, `Business outcome`, the page body | **Preserves. Never writes.** These are `scope`'s output and overwriting them silently discards a scoping conversation |

**It does two jobs and keeps the name:** creates the tasks for a scoped project,
and fills in or edits a project someone created by hand. The description carries
the clarity rather than two separate skills.

**On task creation:**
- Four to seven tasks, five is typical.
- Verb first. "Wire the enrichment webhook", not "enrichment webhook work".
- One task per integration or connector, rather than one covering several.
- **Anything unverified becomes a "review and confirm" task** instead of being
  written as fact.
- **The last task is always live verification.** Not "test", but confirming the
  thing works in the real system.
- Created one at a time rather than in a burst, and checked afterwards.

**What it does not do.**
- Does not scope. If it is handed something unscoped it says so and points at
  `scope`.
- Does not invent generic ceremony tasks. No "kick off", no "align with
  stakeholders".
- Does not write a PRD. Requirements live in the task body, written when that
  task is picked up.

**The judgment it carries.** The task breakdown, which is the whole value. Tasks
are the decision list that eats the sprint, so the test for each one is whether a
person could pick it up and know when they are done. One project does one job.

---

## comms

**What it does.** Writes the update that tells the people affected what changed.

**When it runs.** Whenever a project changes something other people depend on.
Not on a schedule.

**What it reads and writes.** Reads the project. Writes one row in Memos with
Type = Project Update, using that template: What Changed, Why, Who Is Affected
And When, What You Need To Do. Relates it to the project.

**What it does not do.**
- Does not send anything anywhere. Slack and Gmail are read-only context for
  `problem-scan`; `comms` writes the memo and gives you the link.
- Does not edit a previous update. Append-only, so a correction is a new memo
  relating to the old one through `Corrects`.
- Does not change the project's status.

**The judgment it carries.** Naming the reader. The failure mode of every project
update ever written is that someone finishes it without knowing whether it
touches them, so **Who Is Affected And When** must name teams and a date, and
**What You Need To Do** must give an action per group. "Nothing" is a real and
useful answer there, and it gets written rather than left out.

---

## ship

**This was a name with nothing behind it.** It is reconstructed from the
reference set's release skill, which owned exactly this job.

**What it does.** Records that a project shipped, and closes it.

**When it runs.** When the work reaches the people who will use it. Not when it
merges.

**What it reads and writes.** Reads the project's page body and its related
artifacts. Writes one row in Memos with Type = Release, using that template: What
This Lets You Do, What Shipped, How To Get It, Known Gaps. Relates it to the
project. **Then moves the project to `Done`**, which is the one status change any
skill other than `scope` and `new` is allowed to make.

**On the bullets in What Shipped**, carried from the reference version because they
are what stopped release notes reading like marketing: start with an action verb,
name the concrete system, field or threshold, and keep each to about fifteen to
twenty words.

**What it does not do.**
- **Does not post to Slack.** Slack is read-only context for `problem-scan`.
  `ship` writes the memo and stops. Outbound posting remains a separate feature.
- Does not mark a project Done without writing the release. The two are one
  action, because a project that closes with no record of what shipped leaves the
  library with a gap exactly where someone will look.
- **Does not close over open tasks silently.** Nothing in v1 moves a task's
  status, so a project's tasks are very often still open when it ships. `ship`
  lists them and asks before closing the project, rather than either refusing or
  pretending they are not there.
- Does not invent a Known Gaps entry, and does not omit the section. If there are
  genuinely none, it says so.

**The judgment it carries.** Whether this actually shipped, and what the reader
can now do that they could not before. The template leads with the outcome rather
than the work for a reason: the person reading a release was usually not
following the project, so the list of what was built means nothing to them until
they know what it gives them.

---

## What was taken from the reference skills, and what was not

References: the scope, project-creation, release, project-management and product
requirements skills in the reference set. Structure and reasoning only.

**Carried across:**

| Lesson | Where |
|---|---|
| Context before scoping. What already exists is the biggest source of trimming | `scope` |
| "The smallest version that proves it", with anything unproven moving out of scope | `scope` |
| The format does the trimming, never a review round. Cut, never raise the cap | `scope` |
| `scope` offers to run `new` pre-filled and never auto-chains | `scope` |
| Priority is inferred with reasoning, and shown against the existing board | `scope` |
| Four to seven tasks, verb first, one per integration, no generic ceremonies | `new` |
| The last task is always live verification | `new` |
| Unverified facts become "review and confirm" tasks rather than assertions | `new` |
| A problem statement is point in time, and its content is never updated | `problem-statement` |
| Release bullets: action verb, concrete system, fifteen to twenty words | `ship` |

**Deliberately not carried:**

| Not carried | Why |
|---|---|
| Posting to Slack from `ship` | The connector is read-only context. `ship` produces a memo and a link instead |
| The Problem Gate's "opportunity play" bypass phrase | A magic phrase that skips the one hard check is how the check stops meaning anything |
| Six project types each with their own task pattern | Untestable variety. One task-breakdown standard, applied with judgment |
| A separate `prd` skill | Requirements live in the task body. A separate document about a task, kept beside the task, is two things that disagree |
| The `pm` catch-all verb router | It routed eleven different actions through one command. Each of those belongs to the skill that owns the thing being changed |
| Trail files at `~/.planning/<slug>/SCOPE.md` | Scope lives on the project in Notion. A local file is invisible to everyone else |

**The structural finding.** The reference set had no equivalent of `problem-scan`.
Problems got written up only when someone already knew about them, which means
the ones nobody had named stayed unnamed. That is the same gap `backfill` closes
for process knowledge, and it is the one skill here with no ancestor to draw on.

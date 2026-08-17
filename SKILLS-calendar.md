# calendar: what each skill does

Part 3 for `calendar`. Three skills, in the same five slots as the other skill
files: what it does, when it runs, what it reads and writes, what it does not do,
and the judgment it carries.

The database is defined in `SCHEMA-calendar.md`, including the boundary test for
what belongs in it and the database-level views `setup` creates, which is the
manifest for them and the only place their number is stated. This file does not
restate a field name or a value list.

Written 2026-08-17.

---

## Rules that apply to all three

The shared rules in `SKILLS-memos.md` apply here unchanged: never invent a select
value, verify the write landed, a hard confirmation gate, preview in full inline,
route to `setup` on first run, pin the Notion API version and the client floor to
the two values `SKILLS-setup.md` defines, and record only sources you actually
opened.

Two belong to this plugin.

- **Every row has to pass the boundary test before it is written.** Does it happen
  on a date, and does somebody outside the team see it. A skill that quietly
  accepts a task is how this database becomes the thing the reference became.
  **The test asks whether the thing happens on a date, not whether the row knows
  which one yet.** An `Idea` with no date passes. A task with a due date does not.
- **`Why We Are Doing It` is never left blank**, on any type, including a routine
  social post. If it cannot be answered, that is the finding and the skill says so
  rather than writing the row anyway.

---

## new

**What it does.** Adds one thing to the calendar, and checks what else is already
aimed at the same people at the same time.

**When it runs.** As soon as something is real enough to write down. `Status`
exists so an idea can sit on the calendar honestly, and a date is not required
until `Confirmed`.

**What it reads and writes.** Reads the live select options before choosing any
value. Reads the calendar around the proposed date. Writes one row and its body.

**The clash check runs before drafting, not after.** Before it writes anything, it
shows what else is already going out to a similar audience in the same window.
Three emails to the same enterprise list in one week is the failure this database
exists to prevent, and the only moment it can be prevented is while somebody is
still choosing the date.

**This is the same rule as the duplicate check in `process:new`**, and for the
same reason: a conflict discovered after the work is planned is a conflict
somebody argues with rather than fixes.

### What the clash check can and cannot know

**Specified 2026-08-17**, after review found "aimed at the same people" resting on
two fields that cannot establish it.

**It compares `Segment` and `L2C Lifecycle`**, both multi-select, plus the date
window. That is all the schema has. **It does not know who is on a list**, so two
enterprise emails to entirely different lists look identical to it, and two rows
with nothing filled in look identical to everything.

The semantics, since a multi-select comparison has three plausible meanings:

| Case | What it means |
|---|---|
| Any shared value | An overlap. One shared segment is enough to surface |
| Either side blank | **Unknown, not universal.** Surfaced separately as "might overlap, nobody said" |
| Both blank | Not surfaced. Two rows saying nothing is not evidence of anything |
| Date ranges | Overlap, not equality. A three-day conference clashes with anything inside it |

**This is a coarse signal for a person, and the skill says so.** It surfaces
candidates and the user judges. It was never a collision detector and describing
it as one would be worse than the fields being coarse, because somebody would
trust it.

**The fix a real collision detector needs is a field naming the actual list or
audience**, and that is deliberately not in v1. It is a marketing-ops concern, it
needs somewhere for list names to come from, and adding a field nothing can fill
is the failure this design has caught twice already.

**What it does not do.**
- **Does not accept a task.** If it fails the boundary test, it says so and points
  at Projects.
- **Does not require a project.** Events, launches and campaigns almost always
  have one. A Tuesday social post does not, and forcing one manufactures empty
  project rows.
- Does not set `Our role`, `Format` or `Location` on anything except an Event, or
  `Channel` on an Event.
- Does not write a run-up list into the body when the items have owners and dates.
  Those are Tasks on the related project.

**The judgment it carries.** Three things.

1. **Which of the five types this is**, using the tree in the schema. The case
   that catches people is a webinar: it is an Event, and the recording published
   afterwards is Content on a different date, which means **two rows**. One thing
   that happens twice is two rows, because the calendar's job is to say what is
   happening when, and those are two whens.
2. **Whether the clash matters.** Two things aimed at the same segment in one week
   is sometimes fine and sometimes the whole problem. The skill shows it and the
   user decides. It never blocks and it never silently allows.
3. **Whether this belongs here at all.** The boundary test, applied honestly. The
   pull will always be toward putting internal work on the calendar because it has
   a date.

---

## update

**What it does.** Changes a row that already exists, and captures how it went when
the row is finished.

**When it runs.** Constantly. Dates move, statuses advance, owners change. On this
database edits vastly outnumber creates, in the same way they do in the Process
Library.

**What it reads and writes.** Reads the row. Writes the changed properties and
body sections. Shows a before and after before writing.

### Setting `Status` to `Done` triggers the debrief

**This is the design decision worth keeping.** Rather than a separate debrief
skill nobody would run, the moment a row is marked `Done` is the moment `update`
asks how it went, and writes the answer into the conditional `How It Went`
section.

Two sentences is a good length. What happened, and what you would change.

**It asks, and it accepts no as an answer**, writing that the debrief was skipped
rather than leaving the section absent. A blank section and a deliberately empty
one look identical afterwards, and only one of them is information.

**Why not a separate skill.** A debrief skill is run once, enthusiastically, after
the first event, and never again. Attaching it to a status change means it happens
at the one moment somebody is already touching the row, which is the only reliable
way to get a habit into a workflow that people are busy inside.

**What it does not do.**
- Does not create. That is `new`.
- **Does not move a date without saying what else that date now clashes with.** A
  moved date is a new clash check, and this is the most common way a conflict gets
  introduced after everything looked fine.
- Does not change `Type` silently. Changing a Social post into an Event changes
  which fields mean anything, so it says so.
- Does not delete a row for something that did not happen. `Canceled` keeps the
  record, and a calendar with no cancellations in it is a calendar nobody trusts.

**The judgment it carries.** Whether a change is an edit or a new row. Most are
edits. The exception is a thing that moved so far it is now a different thing: a
webinar postponed by four months to a different audience with a different topic is
a new row, and the old one is `Canceled`. Editing it destroys the record that the
first one was planned and dropped.

---

## upcoming

**What it does.** Answers what is in market and when.

**When it runs.** Before planning anything, in whatever meeting reviews the
quarter, and any time somebody is about to pick a date.

**What it reads and writes.** Reads only. **Writes nothing.**

**What it does not do.**
- Never changes a row.
- Never returns the whole database. It answers for a window.
- **Never silently drops rows it cannot place.** A row with no date cannot appear
  on a calendar, and a report that omits it reads as "nothing else is happening".
  The output ends with a count of rows it could not place and why, the same rule
  `software:renewals` follows for rows with no contract data.

**The judgment it carries.** Two things, and they are why this is a skill rather
than the calendar view `setup` already creates.

1. **Grouping by who it hits, not by when it happens.** The calendar view answers
   what is on Tuesday. The question people actually have is what a given audience
   is going to receive from us this month, which needs `Segment` and
   `L2C Lifecycle` read together across every type. Three touches on one segment
   is visible that way and invisible on a calendar grid.
2. **Saying what is not real.** `Idea` and `Planned` rows sitting next to
   `Confirmed` ones is how a plan looks fuller than it is. The output separates
   what is locked from what is hoped for, and leads with the locked half.

---

## Why there are three skills and not five

Recorded so the gaps read as decisions.

| Not built | Why |
|---|---|
| `debrief` | Folded into `update` and fired by the status change, because a standalone debrief skill is run once and then never |
| `backfill` | See below |
| `find` | Same reasoning as `software`. These are view questions, and a single search across all six databases is the obvious tier-two plugin |

### Why calendar has no backfill, when software and process both do

Worth writing down, because the pattern now has an exception and the exception has
a rule behind it.

**Backfill is right when the record exists in evidence but not in a list.** Nobody
has a list of every tool they pay for, but the receipts are in their email. Nobody
has written down how refunds get handled, but the answer is in a Slack thread. In
both cases the knowledge exists and the list does not, so building the list from
the evidence is pure gain.

**A calendar is not like that.** A team that does marketing is already keeping a
calendar somewhere, in a spreadsheet or a scheduling tool or somebody's head.
Importing half of it produces two live calendars that disagree, which is worse
than one bad calendar, because now nobody knows which is current.

**So the answer for an existing calendar is to move it, once, deliberately, and
stop using the old one.** That is a migration a person does, not something a skill
should offer to do halfway.

---

## Open

1. **The clash check has no threshold.** Two things aimed at one segment in a week
   is sometimes a problem and sometimes a Tuesday. The skill shows and does not
   judge, which is right for v1, but a real threshold wants tuning against a real
   calendar rather than being invented now. Same position `process:new` took on
   the duplicate check.
2. **`upcoming` overlaps `memos:team-update`**, which also reads this database for
   what went out. That is fine and probably correct, but if the two produce
   different pictures of the same period, one of them is wrong and nothing would
   catch it.
3. **Nothing reminds anybody of a date.** v1 has no unattended runs, so a
   confirmed event with a run-up is only visible to somebody who looks. That is
   consistent with the rest of the marketplace and it is the most obvious thing a
   user will expect and not get.

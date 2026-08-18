# Memos: schema and templates

**This file defines the Memos database.** Field names, property types, allowed
values and option order live here and nowhere else. Anything in another document
that restates them is a copy, and copies drift.

`DECISIONS.md` in this folder holds the reasoning, the reversals, and the rules
about what not to re-propose. It points here rather than repeating any of it.

When `sarahcallmesmadds/gtm-operator` exists, the plugin's own machine-readable
schema is generated from this file, and this file stays the thing a person edits.

Companion: `SCHEMA-process.md`. Shared fields (Domain, Audience, Segment,
L2C Lifecycle, Tags) use identical value lists in both. A change to one is a
change to both.

---

## Memos schema, Part 1 (decided 2026-08-17)

### The rule that decides everything else

**Memos is time-stamped communication and append-only. The Process is
living reference.** A memo records what was said on a date. An artifact is
maintained and kept true. Every field decision below follows from that one line.

**Append-only, stated as narrowly as it actually holds.** After publication:

- **The body and every content property are immutable.** A correction is a new
  memo, related to the old one through `Corrects`.
- **`Status` may move from `Published` to `Canceled` and nowhere else.** That is a
  retraction, it requires a correcting memo saying why, and the memo itself stays.
- **`Corrected by` and `Projects` update themselves**, being the far sides of
  two-way relations. Nothing a person wrote changes when they do.

**Narrowed 2026-08-17.** This said "never updated", full stop, while `Status` held
three values and moving between two of them is an edit after publication. **A rule
stated more broadly than it can hold is worse than a narrow one**, because the
exception nobody wrote down is how people learn to ignore the rule. `SKILLS-memos.md`
carries the same three lines as a table of what may change and by what.

### Fields

| Field | Type | Values / notes |
|---|---|---|
| Name | Title | |
| Description | Text | one sentence |
| Type | Select | 7 values, see below |
| Published date | Date | the timestamp that makes it a record |
| Author | Person | defaults to whoever runs the skill |
| Status | Select | Draft, Published, Canceled |
| Domain | Select | the same 8 values as `SCHEMA-process.md` |
| Audience | Multi-select | the same list as `SCHEMA-process.md` |
| Segment | Multi-select | optional |
| L2C Lifecycle | Multi-select | optional, the same 0 to 8 |
| Tags | Multi-select | optional, max 3, the same list and the same rule. Skills enforce it, `setup:check` reports it, Notion does neither |
| Period covered | Date range | optional, for anything summarising a stretch of time |
| Corrects | Relation (self) | the memo this one corrects. Empty on almost everything |
| Corrected by | Relation (self) | inverse of Corrects |
| Artifacts | Relation to Process | what this memo announced, changed, or drew on. **Two-way, decided 2026-08-17.** The artifact carries `Memos` on the other side, so a reader on an artifact page can see what has been said about it |
| Projects | Relation | inverse of `Memos` on Projects. Updates and releases about a project. **No longer conditional, 2026-08-17.** `setup` creates all six databases before it adds any relation, so the target always exists |
| Created time | Created time | |

**Every shared field reuses Process's exact value list.** Two
vocabularies for one concept is how filtering across the two databases stops
working. If a value list changes, it changes in both.

**`Author`, not `Owner`.** Nobody maintains a memo, so nothing is owned. The
word reinforces the append-only rule at the moment someone fills the field.

**`Corrects` and `Corrected by`, added 2026-08-17.** The append-only rule says a
correction is a new memo relating to the old one, and review found there was no
relation capable of expressing that. `Artifacts` points at Process
and `Projects` points at Projects, so neither could. A rule with no mechanism is
not a rule.

Like every self-relation, these cannot be created in the same call that creates
the database. See "Self-relations have the same problem" in
`SCHEMA-process.md`. Pair them as two sides of one relation.

### Type

Seven values. Each is a genuinely different kind of communication with a
different page body, which is the test used to cut the list.

1. **Memo**, considered thinking or a recommendation
2. **Project Update**, status on one project. `projects:comms` writes this
3. **Team Update**, the recurring summary covering a period. Uses `Period
   covered`
4. **Meeting Notes**, the record of a meeting that happened on a date
5. **Problem Statement**, the case that something is worth fixing.
   `projects:problem-statement` writes this
6. **Release**, something shipped
7. **Incident Report**, something broke

**`Meeting Notes`, not `All Hands`.** All-hands is one company's meeting name.
Every team has recurring meetings worth recording, and the generic name also
gives one-off sessions such as a workshop an obvious home.

**Team Update and Meeting Notes were briefly merged and then split apart again**
on 2026-08-17. The argument for merging was that they differ only by channel,
written versus presented. That was wrong. They differ by shape, and the shape is
visible in the fields: a Team Update covers a stretch of time and goes to the
whole team, while Meeting Notes happen on a single date and go to whoever was in
the room. Their page bodies will not resemble each other. Do not re-merge them.

### Dropped from the reference

| Dropped | Reason |
|---|---|
| Last checked for accuracy | A memo cannot go stale. It records what was said on a date, so freshness is meaningless, and keeping the field would invite `audit` to nag about documents that are correct by definition. This is the clearest line between the two databases |
| Team Informed | The same job as Audience. Folded in, exactly as it was for Process |
| Software, Sprints, Eval Log, Brain Log | Pointed at databases that existed in one organisation only. The same treatment as Customer Tasks and MKT Projects |
| Cx Funnel | Renamed to L2C Lifecycle, for one vocabulary across both databases |
| Project Overview (a Type) | Its sections are Purpose, Objectives, Scope, Stakeholders, Success Criteria and Risks. That is a living project record, not a broadcast, and scope was already decided to live on the project rather than in Memos |
| Publish to Slack | See below |

### Three calls made on 2026-08-17

- **No Slack field in v1.** The plugin would either have to actually post to
  Slack, which is a large scope addition and a second integration to test, or
  carry a checkbox that does nothing, which is worse. Nothing else in v1 sends
  anything anywhere.
- **Status drops `In review`.** v1 has no approval workflow, and a status nobody
  advances becomes noise. Draft, Published, Canceled.
- **The `Artifacts` relation is kept, and it is the most important new field.**
  It is the bridge between the two databases. A memo announcing a process change
  points at the SOP it changed. Without it the two databases sit side by side and
  never talk. With it `audit` gains a real signal: an artifact whose newest
  related memo is much later than its own last-checked date is probably out of
  date.

---

## Memos schema, Part 2: page body templates (2026-08-17)

Seven templates, one per type. Same format as the templates in
`SCHEMA-process.md`. Drafted and then revised through three review passes, recorded at the end
of this section.

### Rules that apply to every Memos type

- **Every template ends on the reader, not the writer.** The last required
  section says what the reader must do, decide, or accept. A memo that only
  reports is a filing cabinet entry, and filing cabinet entries belong in the
  Process.
- **The outcome leads.** The first section is what happened or what is being
  asked, never the work that produced it.
- **Five sections is the ceiling**, and four is better. The counts below are
  limits rather than targets.
- **A section that does not apply says so in place.** Same rule as Process
  Library: deleting it loses the fact that it was considered.
- **Conditional sections are marked as such** and always come last.
- **Nothing in the body is edited after publishing.** A correction is a new memo that
  relates to the old one. This is the append-only rule made visible in the
  template rather than only stated in a field description.
- **Ceiling of 600 words across the required sections. No minimum.** Conditional
  sections (Sources, Discussion Notes, Links) sit outside the count, which is
  what lets a set of Meeting Notes carry a long discussion record without
  breaking the rule.

### The length rule

Same reasoning as `SCHEMA-process.md`, which holds the full argument. In
short: a maximum only, because a floor manufactures filler and a ceiling stops
bloat, and the reference skill's 400 word floor had to be followed by a second
rule telling itself not to pad.

**600 rather than 800**, because a memo is read once on the day it lands. An
artifact is returned to for years and can afford more. The three types most
likely to run long are Team Update, Meeting Notes and Incident Report, and in all
three the length belongs in a conditional section or in a linked artifact rather
than in the memo body.

**At the ceiling the skill asks rather than trims.** For a memo, running long
usually means the detail belongs in a Process artifact that this memo
should link to instead.

### Memo

**What it is.** Considered thinking that asks the reader for something.

**Body sections, in order:** Recommendation, What It Changes, Why This And Not
The Alternative, What I Need From You, Sources (conditional).

**Why it is built this way.** A memo that opens with background loses the reader
before the ask. Leading with the Recommendation means someone who reads one
sentence still knows what is being proposed. Naming the alternative is what
stops a memo being a case for something nobody was arguing against.

**What goes in each part.**
- Recommendation: what you are proposing, one or two sentences, stated flatly.
- What It Changes: what will be different if this is accepted.
- Why This And Not The Alternative: the other option that was real, and why this
  one wins. If there was no real alternative, say so, because that is itself
  worth knowing.
- What I Need From You: a decision, a review, or nothing beyond awareness. Say
  which, and by when.
- Sources: where this came from, each with a line of context.

**When someone runs it.** When you want a decision or a considered position on
the record before a conversation, not after it.

**Why it helps.** It separates the recommendation from the reasoning, so the
reasoning can be long without the ask getting buried.

**Related view:** the Artifacts relation. What this memo draws on or would
change.

### Project Update

**What it is.** Status on one project, written for the people it affects rather
than the people building it.

**Body sections, in order:** What Changed, Why, Who Is Affected And When, What
You Need To Do, Sources (conditional).

**Why it is built this way.** The most common failure of a project update is
that a reader finishes it without knowing whether it touches them. Who Is
Affected And When, followed by What You Need To Do, makes that impossible to
skip. This shape is inherited from the reference, which had it right.

**What goes in each part.**
- What Changed: the change itself, in the reader's terms, not the ticket's.
- Why: the reason for the change. Two or three sentences.
- Who Is Affected And When: name the teams and the date. "Everyone, soon" is not
  an answer.
- What You Need To Do: the action, per affected group. "Nothing" is a valid and
  useful answer, so write it rather than omitting the section.
- Sources: conditional.

**When someone runs it.** `projects:comms` writes this. Also written by hand
whenever a project changes something other people depend on.

**Why it helps.** It is the only type that routinely reaches people outside the
team doing the work, so it carries the heaviest audience burden of the seven.

**Related view:** the Projects relation.

### Team Update

**What it is.** The recurring summary of a period, sent to the whole team.

**Body sections, in order:** TLDR, What Shipped, What Is Still Open, Needs A
Decision From You.

**Why it is built this way.** A recurring send that never asks for anything
becomes wallpaper within a month, and once it is wallpaper the whole habit dies.
Needs A Decision From You is the section that keeps it read. TLDR exists because
most readers will read only that.

**What goes in each part.**
- TLDR: three to five lines, the whole period. Written last.
- What Shipped: one line per item, linking out. The detail lives in the related
  view, so resist restating it here.
- What Is Still Open: what is in progress and what is stuck, with the stuck
  items named as stuck.
- Needs A Decision From You: the open questions with a name against each. If
  there are none, write "nothing this week" rather than deleting the section,
  because an empty week is information.

**When someone runs it.** On the cadence the team already has. Uses the `Period
covered` field, which is what separates this type from Project Update.

**Why it helps.** It is the one type that gives a whole team the same picture on
the same day, which is what makes the rest of the library worth maintaining.

**Related view:** a Memos view filtered to Project Update and Release inside the
period covered. That is the detail behind the summary.

### Meeting Notes

**What it is.** The record of what a meeting decided, not what it discussed.

**Body sections, in order:** Decisions, Actions, Open Questions, Discussion
Notes (conditional).

**Why it is built this way.** Meeting notes fail by becoming transcripts. Nobody
reads a transcript, and the decisions inside one are unfindable a month later.
Putting Decisions first and Discussion Notes last, marked optional, is what
stops the transcript eating the document.

**What goes in each part.**
- Decisions: what was settled. If nothing was settled, write that, because a
  meeting that decided nothing is worth knowing about.
- Actions: each one names a person and a date. An action without both is not an
  action, it is a wish, and the skill should say so when the field is filled.
- Open Questions: what was raised and not resolved, so it is not lost between
  meetings.
- Discussion Notes: conditional, and genuinely optional. Only when the reasoning
  will matter later.

**When someone runs it.** After any meeting whose decisions someone outside the
room needs.

**Why it helps.** It generalises past the all-hands. Any recurring meeting,
workshop, or working session files here, which is why the type is not named
after one company's meeting.

**Related view:** a Memos view filtered to Type = Meeting Notes, so the previous
session is one click away.

### Problem Statement

**What it is.** The case that something is worth fixing, made before anyone
proposes a fix.

**Body sections, in order:** What This Blocks, What's Happening, Who Feels It,
Evidence, Cost Of Doing Nothing, Sources (conditional).

**What This Blocks leads, added 2026-08-18, Sarah's call.** A problem statement
drives work, so the first thing the reader needs is the business goal that is at
risk, not the situation. It carries four things: the goal, where it stands now,
who owns it, and the dated decision it holds up. Without the dated decision the
problem has no urgency and sits unread.

**Evidence has to be citable.** Every line names its source: the channel and date
for a quote, the report or file for a number, and the person's role. A section
also names what is missing and why that absence matters, because a gap in the
evidence is often the finding.

**Why it is built this way.** Kept from the reference almost unchanged, because
it is the strongest of the original shapes. Cost Of Doing Nothing is the section
that makes the difference: it forces the writer to state the stakes rather than
leaving a reader to infer them, and it is the section that gets a problem
prioritised or correctly ignored.

**What goes in each part.**
- What's Happening: the problem, without a solution smuggled into it.
- Who Feels It: the specific people or teams, not "the business".
- Evidence: numbers where they exist. **Where they do not, write what was
  observed and how often.** Never leave this blank, because a problem statement
  with no evidence cannot be prioritised against anything.
- Cost Of Doing Nothing: what continues to happen if this is not fixed.
- Sources: conditional.

**When someone runs it.** `projects:problem-statement` writes this, before
scoping. A change of situation means a new row, never an edit.

**Why it helps.** It is the input to `scope`, and scoping something whose stakes
were never written down is how teams build the wrong thing carefully.

**Related view:** the `Projects` relation. What was built in response.

**Corrected 2026-08-17, then reversed 2026-08-18.**

On 08-17 this said "the Projects relation", and that was called wrong on the
grounds that `Projects.Problem Statement` was one-way, so nothing on the memo
pointed back and **the design's defining trace was invisible from the problem's
side**. The fix was a second relation, `Problem Statement` / `Resulting
Projects`, on the reasoning that two relations to the same database are fine when
they mean different things.

**On 08-18 that second relation was dropped in review, and the reasoning above no
longer holds.** It rested on the remaining relation being one-way. It is not:
`Projects.Memos` is two-way and its far side is `Projects` on the memo. So a
problem statement attached to a project does show that project, from the
problem's side, through the one relation. The trace the 08-17 correction was
protecting is intact without a second relation to carry it.

**What the memo's `Type` now carries is which memo it is.** One relation says a
memo and a project are connected. `Type` says whether the memo is the problem
statement, an update or a release. That was always true, and it is now the only
thing distinguishing them.

### Release

**What it is.** The record that something shipped, written for the person who
has to care rather than the person who built it.

**Body sections, in order:** What This Lets You Do, What Shipped, How To Get It,
Known Gaps, Links (conditional).

**Why it is built this way.** Opening with the work is why release notes go
unread. Opening with what the reader can now do is what makes them read the
rest. Known Gaps exists because a release that oversells is the fastest way to
lose trust in every release after it.

**What goes in each part.**
- What This Lets You Do: the outcome, in the reader's terms. One or two lines.
- What Shipped: the work itself, one line per item.
- How To Get It: install, enable, or "nothing, it is already live".
- Known Gaps: what does not work yet, and what to do instead meanwhile. If there
  are genuinely none, say so.
- Links: conditional. Code, docs, demo.

**When someone runs it.** When something reaches the people who will use it, not
when it merges.

**Why it helps.** It is the type most likely to be read by someone who was not
following the work, so it carries the introduction the rest of the library
assumes has already happened.

**Related view:** the Projects relation.

### Incident Report

**What it is.** The record of something breaking, and what changed so it does
not recur.

**Body sections, in order:** Impact, What Happened, Timeline, Why It Happened,
What Changed.

**Why it is built this way.** Impact leads, because the reader's first question
is whether this touched them and the answer decides whether they read on. Why It
Happened is deliberately not called Cause: a cause invites one word, and one
word is never the reason. What Changed is required, because an incident report
with no change recorded is a story rather than a fix.

**What goes in each part.**
- Impact: who was affected, how badly, and for how long. Numbers if you have
  them.
- What Happened: the failure itself, plainly.
- Timeline: **at minimum three points, when it started, when it was noticed, and
  when it was fixed.** More if useful. The gap between started and noticed is
  usually the most interesting number in the document.
- Why It Happened: the chain, not the label. Keep asking why until the answer is
  something that can be changed.
- What Changed: what is different now. If nothing changed, write that and say
  why, because a decision to accept a risk is worth recording.

**When someone runs it.** After anything that broke and that someone outside the
team noticed.

**Why it helps.** The Timeline and What Changed sections together are what turn
a set of incidents into a pattern, which no single report can show.

**Related view:** the Artifacts relation. The SOPs or technical references that
changed as a result.

### What the three review passes changed

Recorded so the reasoning is not lost and the same ground is not re-covered.

**Enablement pass** (can a new person fill this in correctly without asking):
- `Memo`: the heading "Why" was ambiguous about whether it meant why the
  recommendation is right or why the memo exists. Became "Why This And Not The
  Alternative".
- `Team Update`: "In Flight" was jargon. Became "What Is Still Open".
- `Incident Report`: "Cause" invited a one-word answer. Became "Why It
  Happened", with the chain asked for explicitly.
- `Meeting Notes`: the owner-and-date rule for Actions moved into the section
  spec rather than being assumed.
- `Release`: "How To Use It" was serving two different readers. Split into "What
  This Lets You Do" for the person deciding whether to care, and "How To Get It"
  for the person installing.

**User pass** (5pm on a Friday, will this get finished or abandoned):
- Five sections set as a hard ceiling, four preferred.
- `Meeting Notes`: Discussion Notes moved last and marked conditional, because
  people paste a transcript into it and never fill the top.
- `Incident Report`: Timeline given a stated minimum of three points, because an
  open-ended timeline is the section people abandon.
- `Problem Statement`: Evidence given an explicit fallback for when there is no
  number, because it was otherwise the section a hunch-driven writer leaves
  blank, which makes the whole statement unusable.
- `Team Update`: What Shipped told to stay one line per item and let the related
  view carry detail, so the writer does not type it twice.

**Executive feedback pass**, applied using the evaluation order in
`~/Projects/executive-feedback-coach/agent/INSTRUCTIONS.md`, which is audience
fit, then core purpose, then user constraints, then logic and evidence, then
execution:
- **The decisive finding: only two of the seven drafts told the reader what they
  were expected to do.** The other five were structured for a writer to unload
  what they knew. That is a structural failure rather than a wording one, and it
  produced the first cross-type rule above, that every template ends on the
  reader.
- **Five of seven buried the outcome.** `Release` opened with a list of work
  rather than a result, and `Incident Report` opened with the failure rather
  than its impact. Both were reordered, and the rule that the outcome leads was
  added.
- `Problem Statement`'s "Cost Of Doing Nothing" was the strongest section in any
  draft, and nothing else had an equivalent stakes line. `Release` gained Known
  Gaps and `Incident Report` gained What Changed as their equivalents.

---

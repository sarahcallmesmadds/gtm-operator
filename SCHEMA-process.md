# Process Library: schema and templates

**This file defines the Process Library.** Field names, property types, allowed
values and option order live here and nowhere else. Anything in another document
that restates them is a copy, and copies drift.

`DECISIONS.md` in this folder holds the reasoning, the reversals, and the rules
about what not to re-propose. It points here rather than repeating any of it.

When `sarahcallmesmadds/gtm-operator` exists, the plugin's own machine-readable
schema is generated from this file, and this file stays the thing a person edits.

Companion: `SCHEMA-memos.md`, which defines the Memos database. Shared fields
(Domain, Audience, Segment, L2C Lifecycle, Tags) use identical value lists in
both. A change to one is a change to both.

---

## Part 1: Process Library schema

### Fields

| Field | Type | Values / notes |
|---|---|---|
| Name | Title | |
| Description | Text | one sentence |
| Type | Select | 5 values, see below |
| Domain | Select | 8 values, see below |
| Audience | Multi-select | which teams need to know |
| Segment | Multi-select | optional |
| L2C Lifecycle | Multi-select | 0 to 8, see below |
| Tags | Multi-select | optional, max 3, subject only. Skills enforce it, `check` reports it, Notion does neither |
| Status | Select | Active, Draft, Archive. Skills only ever write `Active` or `Archive`. `Draft` is a person's to set |
| Owner | Person | defaults to whoever runs the skill |
| Last checked for accuracy | Date | |
| Review cadence | Select | 6 values, see below. Drives the staleness check |
| Verified by | Person | who confirmed it. Set by `new` and by `update` on request, never by `backfill` |
| Verified date | Date | |
| Created time | Created time | keep it; you do not see it unless the property is exposed |
| Parent | Relation (self) | |
| Child Docs | Relation (self) | inverse of Parent |
| Supersedes | Relation (self) | the decision this one replaces. Renamed from `Superseded Strategy` 2026-08-17, see mechanism below |
| Superseded By | Relation (self) | inverse of Supersedes |
| Memos | Relation | inverse of `Artifacts` on Memos. What has been announced about this artifact. Added 2026-08-17 when that relation was made two-way |
| Projects | Relation | inverse of `Artifacts` on Projects. `setup` creates every database, so this is never conditional |
| Software | Relation | inverse of `Artifacts` on Software. The tools this document concerns. Defined in `SCHEMA-software.md` |
| Calendar | Relation | inverse of `Artifacts` on Calendar. What this document was the playbook for. Defined in `SCHEMA-calendar.md` |

**Dropped from the reference:** Customer Tasks, MKT Projects (pointed at
databases that existed in one org only), Teams relation (folded into Audience),
Context SoT (deferred, see below).

### A relation cannot be created before its target exists

Found in review on 2026-08-17. **A Notion relation property requires a target
database id at the moment the property is created.** There is no way to create a
relation pointing at nothing and fill it in later. Two fields are affected, and
the rule generalises to every cross-database relation in this design.

**Superseded again on 2026-08-17, later the same day.** Neither field is
conditional any more. `setup` creates all six foundation databases in one pass
before it adds a single relation, so every target exists by the time any relation
is created. `Software` and `Projects` are both ordinary fields.

This previously said `Software` was not created at all in v1 and that `Projects`
was created only if the Projects database already existed. Both of those were
written when setup was expected to build a partial foundation. See
`SKILLS-setup.md` for the two-phase order and the full relation map.

**The rule itself still holds and still has teeth**, because a relation property
requires a target database id at the moment it is created. What changed is that
one setup satisfies it for every relation by ordering, instead of each relation
carrying a condition. **Do not ship a relation property pointing at a database the
plugin did not create and cannot find.** It fails at property-creation time, which
is during setup, which is the worst possible moment.

### Self-relations have the same problem

`Parent`, `Child Docs`, `Supersedes` and `Superseded By` all point at the Process
Library itself, and its id does not exist until it has been created. **Setup is
therefore two stage**, and this was missed when the rule above was first written:

1. Create the database and its data source with every non-relation property.
2. Add the self-relations in a second call, using the id returned by step 1.

**Generalised 2026-08-17**: `setup` now runs the same two stages across the whole
foundation rather than per database, creating all six databases first and every
relation second. See `SKILLS-setup.md`.

Pair them explicitly. `Parent` and `Child Docs` are the two sides of one
relation. `Supersedes` and `Superseded By` are the two sides of a second, separate
relation that must not be wired as the inverse of the first.

### Store the data source id, not only the database id

Since Notion's 2025-09-03 change a database can hold more than one data source,
and querying, creating pages and defining relation targets all need a
`data_source_id`. A database id will not do. `setup` resolves and stores both,
and records which data source it chose, so adding a second one later does not
silently break `new`, `find` and `audit`.

This is corroborated by the reference skill spec, which already noted resolving
`data_source_id` at runtime on first use.

**Body section, not a field:** Sources. There is always more than one source per
page, they are different kinds (a Slack thread, a call, a doc, a person), and
each needs a line of context saying what it contributed. None of that fits a
Notion property.

### Type

Strategy Decision, SOP/ROE, Enablement, Reporting, Technical Reference.

**Numbering dropped 2026-08-17.** These were `1 - Strategy Decision` through
`5 - Technical Reference`, numbered so the field would sort. Notion sorts a
Select by the option order you arrange, so the prefix was not doing that job,
and it cost a visible prefix in every view plus a strip step in every skill that
displays a type name. Set the option order in this sequence when setup creates
the property, because the order above is still the intended reading order:
broadest (why we decided) to narrowest (how the system works).

This does not apply to `L2C Lifecycle`, which keeps 0 to 8 because there the
number is the customer journey order and carries meaning.

### Review cadence

Six values, each meaning a number of days that `audit` adds to
`Last checked for accuracy` to decide whether an artifact is due.

| Value | Days |
|---|---|
| Monthly | 30 |
| Quarterly | 90 |
| Twice a year | 180 |
| Yearly | 365 |
| On change only | never due on time alone |
| None | excluded from the staleness check entirely |

`Quarterly` is the default that `setup` stores and `new` applies.

**`On change only` and `None` are not the same.** `On change only` still gets
flagged by the other three audit signals, in particular a related memo that is
newer than the last check. `None` opts the artifact out of time-based checking
and is for things that are true until someone rewrites them.

**Added 2026-08-17** after review found this field had a writer and a reader but
no defined values, so `audit` could not compute a date and `new` could not obey
the rule against inventing a select value.

### Domain

Unchanged from the reference. Eight functional areas, mutually exclusive, the
right size to hold in your head.

Customer Success, Data & Systems, Deal Execution, GTM Strategy & ICP,
Marketing & Campaigns, Partnerships & Agency, Pipeline & Demand Gen,
Sales Enablement.

### Audience

Replaces both `Team Informed` (multi-select) and the `Teams` relation, which
were two properties doing one job. Multi-select was chosen because it needs no
other database, so it works for someone with nothing else set up.

AE, Eng, Everyone, FDE, Finance, GM, Leadership, Marketing, Partner, People Ops,
RevOps, SDR, Sales, Solutions.

### Segment

New, optional. Blank means it applies everywhere, which is most docs.

Enterprise, Mid-Market, SMB, and free to extend. Plenty of orgs segment by
vertical rather than by size, so the value list must be editable.

### L2C Lifecycle

Was "Cx Funnel". Renamed to Lead to Cash. This is the **customer's** journey and
nothing else belongs in it.

```
0 - Everywhere all the time
1 - ToFu & Engagement
2 - Eval & Demo
3 - Contracting
4 - Customer Activation
5 - Onboarding
6 - Steady State & Expansion
7 - Contraction
8 - Renewal
```

**Change from the reference:** the old `6 - Contraction & Expansion` and
`8 - Steady State` were re-cut. Steady state and expansion are both healthy
account states and their docs sit next to each other. Contraction is the at-risk
state and needs completely different plays. Revisit only if expansion plays grow
into their own body of work.

`New Hire Onboarding` was removed from this field. It is the employee journey,
not the customer's, and it now lives in Tags.

### Tags

**The rule:** a tag is what the doc is *about*. Never who it is for, never when
in the lifecycle, never what kind of doc it is. **Max 3, enforced by the skills and
reported by `setup:check`.** Notion has no maximum on a multi-select and no filter
that can count one, measured 2026-08-17 and rejected with a 400, so this is one of
the two rules no `Needs attention` view can watch. See `SKILLS-setup.md`.

AI, Data, Meetings, Products, Sales Messaging, Tools, Teammate Onboarding,
Teammate Offboarding.

**Why this list is so much shorter than the reference's 24.** Once Type, Domain,
Audience, Segment and L2C exist, eighteen of the original tags were compensating
for a missing field:

- `Enablement`, `Reporting`, `Playbooks`, `Process`, `Strategy` are doc kinds. Type.
- `Enterprise`, `SMB` are Segment. `Enteprise POCs` dropped entirely.
- `Onboarding`, `Off-boarding` became Teammate Onboarding / Offboarding, named
  that way so they cannot be confused with L2C 5, which is customer onboarding.
- `Renewals` is L2C 8.
- `Acquisition`, `Inbound/Outbound`, `Pipeline Strategies`, `ABM` are Domain
  "Pipeline & Demand Gen". `Referrals` is Domain "Partnerships & Agency".
- `AI Enablement` is `AI` plus a Type. Duplicate.
- `Activity` never meant anything specific enough to filter on.

A dedicated **Team Lifecycle** field was proposed and rejected as overkill for
what is realistically two values.

### Rolldown from Parent

Pre-filled defaults the skill offers, never read-only inherited values. A Notion
rollup would be wrong here because the child genuinely needs to differ.

| Field | Rolls down? |
|---|---|
| Domain | Yes, pre-filled. A doc set under one strategy almost always sits in one function |
| Segment | Yes, pre-filled |
| Audience | **No.** The strategy is for everyone, the SOP is for the two teams who touch the record |
| L2C Lifecycle | **No.** Narrower on a child by nature |
| Tags | **No** |
| Owner | **No.** Defaults to whoever runs the skill. The strategy owner is usually a leader, the SOP owner runs the process, the enablement owner trains people. Inheriting would be wrong more often than right |

### Supersedes and Superseded By

**Both sides are labelled, decided 2026-08-17.** The new decision carries
`Supersedes`, pointing at the one it replaced. The replaced decision carries
`Superseded By`, pointing forward at what replaced it. Notion maintains the second
one, so nothing writes it.

Both sides, rather than one, because the reader who most needs the link is the one
who lands on the old decision. Archived tells them it is dead and nothing tells
them what to read instead.

**Renamed from `Superseded Strategy`** at the same time. Labelling both sides
means naming both sides, and one name cannot cover a field that means "the one I
replaced" on one page and "the one that replaced me" on the other.

**When it is set:** only at the moment someone writes a new Strategy Decision.

`new` already runs a duplicate check before structuring. One extra branch: if the
near match is a Strategy Decision and the new doc reaches a **different** Decision
on the **same** Problem, that is not a duplicate, it is a replacement.

1. Dup check finds a close Strategy Decision.
2. Show both Decision sections side by side.
3. Ask: is this replacing that one, or are these about different things?
4. On "replacing": set the relation, set the old doc's Status to Archive.

**`new` sets it, at write time, with a human confirming. Never automatic**,
because "different answer to the same question" versus "adjacent decision" is a
judgment call and getting it wrong archives a live doc.

`audit` can flag candidates it finds later (two Active Strategy Decisions on the
same question with different answers) but only flags, never writes.

**Why this is a second page rather than an edit.** Everywhere else in the Process
Library, a change is an edit, because the library is living reference. This one
case is not, for three reasons. The Why This Approach section is the whole point
of the type, and overwriting it destroys the record of what was decided before and
why. Children hang off a Strategy Decision, and editing one in place leaves every
child implementing a rule its parent no longer states. And an edited page looks
identical whether somebody fixed a typo or reversed the policy, where two pages
and a link are a visible event.

### Context SoT, deferred

The reference had a checkbox meaning "this doc is referenced as a source of truth
by a skill, so it is a priority to keep current." Right idea. Ideally tracked via
an agents/builds database that records which skill reads which artifact. Left out
of v1.

---

## The Strategy Decision granularity framework

**This must ship inside the skill.** Every user hits it on day one.

Two tests. Something needs to pass **both** to be its own Strategy Decision.

**Test 1: could it have gone the other way?** Is there a real alternative a
reasonable person would have argued for, and can you write a "why not that"
paragraph? If it just follows from a bigger decision, it is a section inside
that one.

**Test 2: does anything hang off it?** A Strategy Decision earns a page when it
has children. If no SOP, technical reference or enablement doc points at it, it
is a rule inside another doc.

**Third signal when stuck: when it changes, what else has to change?** If
changing rule A leaves B untouched, they are separate decisions. If they always
move together, one doc. Things that change together belong together.

### Worked example

"Salesforce is the system of record" is **one** decision. Accounts,
opportunities, contacts and contracts are that decision applied four times, not
four decisions. Nobody argued them separately.

> **Salesforce is the system of record for customer data**
> **Decision:** Salesforce is authoritative for accounts, opportunities, contacts
> and contracts. HubSpot is marketing automation only and is never authoritative
> for any of them.

SOPs, technical references and enablement docs hang directly off that.

**A child decision that does earn its own page:** "Contacts sync both ways with
HubSpot, and Salesforce wins on conflict." Genuinely argued, real alternative,
and it has its own technical reference and SOP underneath. Passes both tests.

**One that does not:** "Account names use the legal entity name, not the DBA."
Passes test 1, fails test 2, because nothing hangs off it. It is a rule inside
the account creation SOP.

### Failure modes on each side

Too granular: sixty decision docs, nobody finds the right one, the hierarchy
stops meaning anything.

Too broad: one enormous page where the decision is buried in paragraph nine, and
when one part changes you cannot tell what else is now stale.

**Practical middle:** a Strategy Decision should be readable in about two minutes
and have between two and eight children. More than eight and an intermediate
decision is hiding in there. Zero and it is a section in something else.

---

## Part 2: page body templates (DONE 2026-08-07)

All five artifact types below: body sections, why each is shaped that way, what
goes in each part, hard rules, when someone runs it, and the embedded
related-database view.

### Strategy Decision

**What it is.** The record of a choice and its reasoning, so nobody relitigates it.

**Body sections, in order:** Problem, Decision, Why This Approach, Used For,
Not Used For, Sources (conditional).

**Why it is built this way.** A decision recorded without its reasoning gets
reversed within a year by someone who was not in the room, so Why This Approach
is what makes it survivable. Not Used For stops a good decision being stretched
onto things it was never meant for, which is the most common way a sound rule
turns into a bad one.

**What goes in each part.**
- Problem: what was wrong that forced a choice.
- Decision: what was chosen, one or two sentences, stated flatly.
- Why This Approach: what else was considered and why this won.
- Used For: the situations this applies to.
- Not Used For: the situations it does not, and what to reach for instead.
- Sources: where this came from, each with a line of context. Omitted when the
  decision was made internally with no external source.

**When someone runs it.** After any choice someone will ask about again. The
practical trigger is hearing "why do we do it this way" a second time.

**Why it helps.** Every other type describes **how** to do something. This one
describes **why**, so the others hang off it as their parent. That is what makes
the library navigable instead of a pile, and it is why the plugin refuses to let
an SOP be the parent of anything.

**Related view:** a Child Docs view. Everything that implements this decision,
which is the thing a reader wants next from a strategy page.

### Which type is this? (ships in the skill)

Users will get Type wrong more often than any other field. The tree:

1. Records a **choice and its reasoning** → 1 Strategy Decision
2. Describes a **repeating process someone could do wrong** → 2 SOP/ROE
3. **Teaches someone who does not know how yet** → 3 Enablement
4. Explains **what numbers mean** → 4 Reporting
5. Explains **how a system is wired**, for whoever maintains it → 5 Technical Reference

**Tiebreaker when two match: who is the reader and what are they trying to do?**
The same subject produces different types for different readers. Lead routing is
a Strategy Decision for the person who set the rules, an SOP for the person who
adds a new rule, an Enablement doc for a new AE learning why leads arrive, and a
Technical Reference for whoever debugs the assignment engine.

**The pairs people confuse:**
- SOP vs Enablement: does the reader already know **why** they are doing this? Yes
  is an SOP. No is Enablement. An SOP says "do X". Enablement says "here is what X
  is and why, then do it".
- Reporting vs Technical Reference: is the reader **interpreting a number** or
  **fixing a thing**?
- Strategy Decision vs everything: a Strategy Decision has no steps. The moment
  you write a numbered procedure, it is a different type.

### SOP/ROE

**What it is.** How a recurring process runs, step by step, so it happens the same
way regardless of who does it. ROE is the variant that settles who owns what when
two people or teams both think it is theirs.

**Body sections:** Scope, Trigger Condition, Steps, System Behavior,
Exceptions, Sources (conditional).

**Why it is built this way.** Trigger Condition is first among the substance
because an SOP nobody knows to start is worthless, and "when does this fire" is
the question people actually arrive with. System Behavior separates what the
tools do automatically from what a person does, which is the single most common
source of duplicated work. Exceptions exists because every real process has them,
and an SOP that pretends otherwise gets abandoned the first time reality does not
match.

**What goes in each part.**
- Scope: what this covers and what it does not.
- Trigger Condition: the exact event that starts it.
- Steps: numbered, imperative, **every step names an actor and a system**.
- System Behavior: what happens automatically, with no human involved.
- Exceptions: the cases that break the happy path and what to do instead.
- Sources (conditional).

**Hard rules.**
- "The team reviews it" is not a step. No actor, no system, not a step.
- **Exceptions can never be empty.** If none are known, it must say "none known"
  explicitly, because blank reads as unconsidered rather than as clean.
- One SOP per trigger. Two processes starting from different events are two SOPs
  even when the steps overlap.

**When someone runs it.** A process happened twice and went differently both times.

**Related view:** the `Software` relation, filtered to this document's tools. A
reader following a process needs to know which systems it touches, and on an SOP
that beats a sibling list. **Restored 2026-08-17** once Software was put back into
v1 and `SCHEMA-software.md` defined the database.

### Enablement

**What it is.** Teaches a person to do something they have not done before.

**Body sections:** Purpose, Prerequisites, Steps, Tools & Resources,
Common Questions, Sources (conditional).

**Why it is built this way.** Prerequisites is the section that prevents the most
common failure in the whole library, which is a new person getting stuck on step
two because nobody told them they needed an account first. Common Questions is
what turns a doc from a script into something that survives contact with a real
learner.

**What goes in each part.**
- Purpose: what the reader will be able to do afterwards.
- Prerequisites: access, tools and knowledge needed **before starting**. Name the
  specific logins.
- Steps: numbered, written for someone who has never done it.
- Tools & Resources: what to open, with links.
- Common Questions: **real questions people asked**, never invented ones.
- Sources (conditional).

**Hard rules.**
- Prerequisites must name specific access, not "the right permissions".
- Common Questions must come from questions actually asked. An invented FAQ is
  the clearest sign nobody used the doc.
- If the reader already knows why, it is an SOP, not this.

**When someone runs it.** Someone new needs to do something, or the same question
came from two different people.

**Related view:** sibling docs under the same parent. This replaces the manual
Related Docs section, which duplicated it and would go stale.

### Reporting

**What it is.** What a report or dashboard means, and how to read it without
drawing the wrong conclusion.

**Body sections:** Purpose, Key Metrics, Dashboards, How to Read, Data Sources,
Update Frequency, Sources (conditional).

**Why it is built this way.** How to Read is the entire reason this type exists.
A dashboard link with no interpretation guide produces confident wrong decisions,
which is worse than no dashboard. Update Frequency is here because the second most
common reporting error is reading a stale number as current.

**What goes in each part.**
- Purpose: the decision this report is meant to support.
- Key Metrics: each one defined in **plain language, not as a formula**.
- Dashboards: where to look, with links.
- How to Read: how to interpret it, and **at least one common misreading**.
- Data Sources: which system each number comes from.
- Update Frequency: how often it refreshes, and what "as of" means here.
- Sources.

**Hard rules.**
- Every metric gets a sentence a non-analyst can repeat. A formula is not a
  definition.
- **How to Read must contain at least one way people get this wrong.** If nobody
  has ever misread it, this probably does not need a doc.
- If the reader is fixing the pipeline rather than reading the number, it is a
  Technical Reference.

**When someone runs it.** A number got quoted wrong in a meeting, or a new report
went live.

**Related view:** the `Software` relation. Which systems the numbers come out of,
which is the first thing somebody asks when a figure looks wrong. **Restored
2026-08-17**, see the SOP note above.

### Technical Reference

**What it is.** How a system is wired, for whoever has to change or debug it.

**Body sections:** What It Does, Configuration, Integration Details,
Authentication, Known Limitations, Contacts, Sources (conditional).

**Why it is built this way.** Known Limitations is what stops the next person
spending a day rediscovering a constraint. Contacts exists because the real
failure mode at 6pm is not missing documentation, it is not knowing who to call.

**What goes in each part.**
- What It Does: what it does, and what breaks if it stops.
- Configuration: settings, schedules, environment, where they live.
- Integration Details: what it talks to and in which direction.
- Authentication: **where credentials live. Never the credentials themselves.**
- Known Limitations: what it cannot do, and the constraints already discovered.
- Contacts: **a named person**, not a team.
- Sources.

**Hard rules.**
- **No credentials, tokens or keys, ever.** Name the vault or variable.
- Known Limitations can never be empty. "None known" must be explicit.
- "Ask RevOps" is not a contact. Name a person.
- Audience is the test for this type: if a non-technical reader is the audience,
  it is Enablement.

**When someone runs it.** Something was built or changed, or the person who
understood it is leaving.

**Related view:** the `Software` relation. The tool this document describes, which
on a technical reference is the whole subject. **Restored 2026-08-17**, see the
SOP note above.

**All three of these went and came back inside one day.** They were Software views
originally, dropped when Software was cut from v1, and restored when Software was
put back and `SCHEMA-software.md` was written. Recorded because the round trip is
the useful part: a template cannot name a view of a database nobody has described,
so the cut was correct at the time and so is the restoration.

### Rules that apply to every type

- **Sources is last when present**, with a line of context per source. It is
  **conditional**, required only where the content came from somewhere else,
  which is every backfilled artifact and most Strategy Decisions. A section that
  is empty on a third of docs stops being read.
- **Every type gets one embedded related-database view**, chosen by what the
  reader needs next rather than by what is available.
- **A section that does not apply says so in place.** Deleting it loses the
  information that it was considered.
- **No type may have an SOP, Enablement, Reporting or Technical Reference as its
  Parent.** Only a Strategy Decision can be a parent. **The plugin enforces this
  on every row it writes, and `setup:check` reports the rows it did not write that
  break it.** A filter cannot reach across the relation to read the parent's
  `Type`, measured 2026-08-17, so there is no view for this one. A rollup looks
  like the way round it and is not: the view is created, reported as successful,
  and silently loses its filter. See `SKILLS-setup.md`.
- **Ceiling of 800 words across the required sections. No minimum.** Conditional
  sections (Sources) sit outside the count. See below for why there is no floor
  and what happens at the ceiling.

### The length rule

**A maximum, never a minimum.** The reference skill set a range of 400 to 800 words
and then had to add a second rule telling itself not to pad to reach 400. A floor
manufactures filler, because the writer always has the option of adding words and
never the option of having said enough. A ceiling does the opposite, and only the
ceiling was ever doing useful work.

**At the ceiling, the skill asks rather than trims.** Running long is almost
never a wording problem. It usually means the artifact is covering more than one
thing, so the skill asks whether this is two artifacts and offers to split it.
Trimming a document that is genuinely too big just makes a bad document shorter.

**For a Strategy Decision this routes into the granularity framework**, which
already exists to answer exactly this question. Hitting the ceiling is the most
reliable signal that both of its tests need running again.

**800 is a starting point, not a derived number.** It is roughly 160 words per
section at the five-section ceiling, which reads as a substantial paragraph
without becoming an essay. Adjust it once there are real artifacts to look at.

---

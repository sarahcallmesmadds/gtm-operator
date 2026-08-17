# process: what each skill does

Part 3 for `process`. Six skills, each described in the same five slots
so a gap in one is visible as a gap rather than as something that did not apply.

The five slots: what it does, when it runs, what it reads and writes, what it
does not do, and the judgment it carries.

Databases are defined in `SCHEMA-process.md` and `SCHEMA-memos.md`. This
file does not restate a field name or a value list.

---

## Rules that apply to all six

- **Never invent a select value.** Before choosing any value, fetch that
  property's current options from Notion and choose only from them.
  **Tested against a live workspace on 2026-08-17. Notion rejects the whole
  write with a 400 validation error**, naming the offending value and listing
  the valid ones. Confirmed for both `select` and `multi_select`.
  **The failure is all or nothing.** Writing `["AI", "Completely Invented Tag"]`
  does not save `AI` and drop the rest. The page is not created at all. So a
  skill that drafts a full artifact and only discovers a bad value at write time
  loses the entire draft, which is why the check happens before drafting rather
  than at the point of writing.
  **The error is recoverable and worth catching.** It names the bad value and
  lists the allowed ones, so a skill that hits it can drop or remap the value and
  retry rather than failing at the user. Do not just surface the raw error.

- **Verify the write actually landed.** A Notion page can be created with an
  empty body on a silent partial failure. After writing, re-fetch, confirm each
  section heading is present, retry any that are missing, and say so loudly if a
  section still will not write. **Never report success with a section missing.**
- **The confirmation gate is hard.** Create or change only on an explicit yes.
  Treat anything ambiguous as not yet confirmed.
- **Preview in full, inline.** Show the complete body in the conversation before
  writing, not a pointer to a file.
- **Route to `setup` on first run** when config is absent. Never rely on the
  README.
- **Pin the Notion API version.** The design relies on data sources and on the
  Views API, which need `Notion-Version: 2025-09-03` or later, and `2026-03-11`
  carries its own breaking changes. Pin the version and the SDK floor in the
  plugin rather than taking whatever the client defaults to, because an
  unpinned version means the plugin breaks on a date nobody chose.
- **A related view is not a block.** Every page template requires one embedded
  related-database view, and most are described by intent ("sibling docs under
  the same parent") rather than by definition. Each one needs its data source,
  filter, sort and placement written out before it can be built, and several
  filter against the current page, so they cannot be prebuilt globally at setup.
  Use the Views and Data Sources APIs rather than treating a view as an ordinary
  page block.
- **Record every source you actually opened, and never one you did not.** Each
  gets a line saying what it contributed. A skill must not list a source it did
  not read, and must not claim to have searched, read, or verified anything the
  tool result does not confirm. A Sources section that cannot be trusted is worse
  than no Sources section, because a reader has no way to tell which lines are
  real.

### Who writes the verification fields

Three fields track whether an artifact can be trusted, and they only work if the
skills fill them differently. Getting this wrong makes `audit` fire on every row
forever, which is the same as `audit` not existing.

| Skill | `Last checked for accuracy` | `Verified by` and `Verified date` |
|---|---|---|
| `new` | today | the author, today. A person wrote it and approved the preview, so it is verified |
| `backfill` | **left empty** | **left empty** |
| `update` | **only on an accuracy review**, see below | the same yes that moves `Last checked` |
| `audit`, `find`, `setup` | never written | never written |

**`backfill` leaves both empty on purpose.** A machine pulled the content in and
no human has read it. Empty is the honest value, and it is what makes `audit`
signal 4 fire on exactly the rows that need a person.

**`update` asks before moving either date.** Fixing a typo is not confirming that
a whole document is still true, so `update` asks whether this edit counts as
having re-read the artifact for accuracy. On a yes it sets `Last checked for
accuracy`, `Verified by` and `Verified date`. On a no it changes the content and
moves nothing.

**Corrected 2026-08-17.** `update` previously set `Last checked` on every edit.
Since that field drives the staleness check, correcting a single word suppressed
the warning for a whole cadence period on a document nobody had re-read. The
review clock must only move when a review actually happened.

---

## setup is no longer part of this plugin

**Moved out 2026-08-17.** Setup is its own plugin and creates every database in
the foundation, not just this one's. See "The marketplace: two tiers" in
DECISIONS.md.

What that removes from here: the in-plugin `setup` skill, the shared registry
file that let two setups find each other's databases, and the detect-whether-
Memos-exists logic. One setup knows what it created.

What survives: every skill in this plugin still routes to `setup` on first run
when config is absent, and never relies on a README. Config lives at
`~/.claude/gtm-operator.config.json` and is written by `setup`, holding database
ids, data source ids, the property name map, the user's Notion person id, and
the default review cadence.

**Still to write:** the `setup` plugin itself, in its own file. It carries the
type explanation, the two-stage relation creation, and the option order for every
select.

---

## new

**What it does.** Writes one new artifact from free-form notes.

**When it runs.** When you have something worth writing down. The practical
trigger for a Strategy Decision is hearing "why do we do it this way" a second
time.

**What it reads and writes.** Reads the live select options before choosing any
value. Reads whatever context you point it at. Writes one page: properties, then
the body from that type's template. Writes the Sources section from what it
actually read. Verifies the body wrote.

Fields it always sets without asking:

| Field | Value |
|---|---|
| `Status` | `Active`. **`Draft` is only reachable by a person setting it in Notion**, because a skill that writes a draft has written nothing useful |
| `Owner` | the user, from their Notion person id in config |
| `Last checked for accuracy` | today |
| `Verified by`, `Verified date` | the user, today |
| `Review cadence` | the default from config, offered for change in the preview |

**What it does not do.**
- Does not edit an existing artifact. That is `update`.
- Does not silently create a parent. It offers an existing Strategy Decision, or
  proposes creating one first, and says which it is doing.
- Does not let an SOP, Enablement, Reporting or Technical Reference be a parent.
  The plugin refuses.
- Does not write a section it could not fill. It says the section is empty rather
  than inventing content to fill a length target.

**The judgment it carries.** Three frameworks, all shipping inside the SKILL.md:
1. **The type-selection tree.** Which of the five this is. When two types match,
   it asks rather than taking the first.
2. **The granularity framework.** How big a Strategy Decision should be. Both
   tests have to pass.
3. **The duplicate and supersede branch.** The duplicate check runs **before**
   structuring, because a near-match found afterwards means a document that gets
   merged away. **What counts as a near match is deliberately unspecified here.**
   the reference set used a 70% title and topic match. Pick the threshold against real
   artifacts rather than inheriting a number, and make it configurable, because a
   similarity threshold set blind is the classic way this kind of check ends up
   either silent or unusable. If the near match is a Strategy Decision reaching a *different*
   decision on the *same* problem, that is a replacement rather than a duplicate:
   show both decisions side by side, ask, and only on a yes set the relation and
   archive the old one.

---

## update

**What it does.** Changes an artifact that already exists.

**When it runs.** Mostly from `audit` handing over a list. Also whenever someone
spots that a document is wrong.

**What it reads and writes.** Reads the artifact. Writes the changed properties
and body sections, and sets `Last checked for accuracy`. Asks separately whether
this counts as verifying the artifact, and sets `Verified by` and `Verified date`
only on a yes. Shows a before and after before writing.

**What it does not do.**
- Does not create. That is `new`.
- Does not archive without asking.
- Does not touch Memos. Memos is append-only, and a correction there is a new
  memo rather than an edit.
- Does not rewrite a body wholesale when a section is what changed.

**The judgment it carries.** Whether this is an edit or a new artifact. Most
changes are edits. The exception is the one `new` also handles: a Strategy
Decision that now reaches a different conclusion on the same problem is not an
edit, it is a replacement, and editing it destroys the record of what was
previously decided and why.

**Why it is a separate skill from `new`.** Over a library's life edits vastly
outnumber creates, and the natural path runs `audit` to `update`. Naming that
path "new" would be wrong.

---

## backfill

**What it does.** Fills the library from material you already have, by proposing
candidates you approve one at a time.

**When it runs.** After `setup`, and again whenever a new source appears. It is
designed to be run repeatedly, not once.

**The shape: candidates, then approval.** Backfill never decides what belongs in
your library. It gathers candidates, shows you a list, and you go through it
saying yes or no. Only the yeses get drafted, and each draft is previewed before
anything is written.

**This is what makes all three discovery modes shippable.** A candidate that
turns out to be junk costs you one "no". A weak detector produces noise, not
damage. It would only be dangerous if backfill wrote without asking, which it
never does.

### The flow

1. **Pick the sources.** Existing documents, conversations, call recordings, or
   any combination.
2. **Set the scope.** Which channels, which mailbox, which date range. See "What
   it is allowed to read" below.
3. **For conversations, pick how to look.** Any combination of the three below,
   not one chosen at install time.
4. **It gathers candidates**, each one a line: what it found, where, and what
   type it would be.
5. **You go through the list.** Yes, no, or skip for now.
6. **It drafts the yeses**, previews each in full, and writes on approval.

### The three ways it looks through conversations

All three ship. They answer different questions and a user should be able to use
whichever fits, or run more than one.

| Way | What you give it | What it finds |
|---|---|---|
| **You name the topics** | "Anything about how refunds get handled, and how inbound leads get routed" | Exactly what you asked for. Precise, and limited to what you already know is missing |
| **Repeated questions** | Nothing | Questions asked and answered three or more times, on the reasoning that anything asked that often should have been written down. Finds the gaps you did not know about |
| **A sweep** | A scope and a date range, see below | Whatever looks like durable process knowledge in that window |

### What it is allowed to read

Scope is the user's to set, and the defaults lean closed.

| Source | Rule |
|---|---|
| **Public channels** | Either all of them, or a set the user picks. Both are offered, because a small workspace may want everything and a large one certainly does not |
| **Direct messages** | **Never, unless the user names specific ones.** Not "all DMs" as an option, not a checkbox to include them. The user hands over particular conversations or the plugin does not look |
| **Email** | The user's own mailbox, with a date range |
| **Call recordings** | Whatever call recorder the user has connected. Optional, and off unless they connect one |
| **Date range** | Applies to every conversation source. There is no unbounded read |

**A call recorder is a first-class source.** Meetings are where process decisions
actually get made, and most of them are never written down anywhere else, so a
workspace with a recorder connected has better raw material than one without.
The plugin reads transcripts from whatever recorder the environment exposes
rather than integrating with one by name. Granola is the one testable today.
Others work if they expose a way to read transcripts. **Setup asks whether a
recorder is connected and does not assume one.**

**Every candidate says where it came from**, down to the channel, the thread, or
the meeting and date. Nothing is absorbed anonymously. This matters more here
than anywhere else in the plugin, because backfill is the one skill that reads
things people said rather than things people wrote down for the record.

**Repeated-question detection will be imprecise at first.** Whether "how do we do
refunds" and "what is the refund process" count as the same question needs tuning
against real workspaces, which do not exist yet. That is acceptable here and only
here, because the output is a candidate list rather than a document.

### What it reads and writes

| Source | The problem it is solving |
|---|---|
| An existing knowledge base (a Drive folder, an old Notion database, a Confluence space) | **Sorting.** Read each page, work out its type, map it into the schema, flag anything with no owner or no clear type |
| Conversations (Slack, email) | **Finding.** Surface process knowledge nobody ever wrote down |
| Call recordings, if a recorder is connected | **Finding.** The same job, on the material where decisions are most often made and least often written down |

Writes approved artifacts one at a time, each previewed in full.

**Every candidate goes through the same duplicate check `new` uses**, before
being offered. That is what makes backfill safe to re-run, and it is why no
separate import-tracking field exists. A second run over the same Drive folder
finds the same documents, the duplicate check recognises them, and they do not
appear as candidates again. One mechanism rather than two.

The gap worth knowing: if a source document is renamed after import, the check
may not match it and it can come back as a candidate. You would see it in the
list and say no. That is a noticeable, one-click cost rather than a silent
duplicate, which is the whole reason for the approval gate.

**What it does not do.**
- **Never overwrites.** It fills blanks only.
- **Never fills a person field.** An agent guessing at an owner or a verifier is
  worse than an empty field, so it notifies real people instead.
- Does not run unattended. No scheduled runs, no unsupervised generation.
- **Does not mark anything verified, and does not set `Last checked for
  accuracy` either.** Both are left empty, because a machine pulled the content
  in and no human has read it. Empty is the honest value and it is what makes
  `audit` signal 4 mean something.
- Does not write a Sources section it cannot substantiate. Every backfilled
  artifact records where it came from, and only what was actually read.
- Does not read outside what the user pointed it at.

**The judgment it carries.** For existing documents, which type each one is,
using the same tree `new` uses. For conversations, what counts as durable process
knowledge rather than ordinary chat. **That judgment is offered, never applied.**
Backfill's job is to be usefully wrong in a list you can scan, rather than
confidently wrong in your library.

---

## audit

**What it does.** Tells you which artifacts have gone stale, contradict each
other, or were never verified.

**When it runs.** When a person runs it. **Nothing schedules it**, because v1
has no unattended runs. `Review cadence` is a field `audit` *reads* to decide
what to flag, not a trigger that fires it.

**What it reads and writes.** Reads only. **Writes nothing at all.** It produces
a list and hands it to `update`.

**What it does not do.**
- Never fixes anything.
- Never rewrites a body.
- Never archives.
- Never reports drift as a decision to make. It reports documents that need a
  person to look at them.

**The judgment it carries.** What counts as needing attention. Four signals:
1. `Last checked for accuracy` is older than the artifact's `Review cadence`.
   **An empty date does not match a "before" filter in Notion**, so backfilled
   rows escape this signal entirely. That is intended, and signal 4 is what
   catches them. Whoever builds this must not assume signal 1 covers everything.
2. **A related memo is newer than the last check.** If an artifact's newest
   related memo postdates its last-checked date, something was announced about it
   that nobody folded in. This is the signal the `Artifacts` relation on Memos
   exists to make possible, and it is the strongest of the four.
   **Query Memos by the reverse relation, sorted by `Published date` descending.
   Do not read the artifact's own relation property.** Reading a page's relation
   returns at most 25 references, and a relation value caps at 100 pages, so on
   any long-lived artifact the newest memo becomes invisible and this signal
   silently degrades to nothing. "Newer" means `Published date`, never
   `Created time`.
3. Two Active Strategy Decisions answer the same question differently. Flagged as
   supersede candidates, never acted on, because getting that wrong archives a
   live document.
4. Backfilled and never verified: `Verified by` is empty.

---

## find

**What it does.** Finds the artifact you need and tells you whether to trust it.

**When it runs.** Any time. This is the skill people use most, so it has to be
the least ceremonious.

**What it reads and writes.** Reads only.

**What it does not do.**
- Does not edit or create.
- Does not return a wall of results. It answers the question and names the
  artifact it answered from.

**The judgment it carries.** Two things:
1. Which artifact actually answers the question, using Type, Domain and Audience
   rather than text matching alone.
2. **Whether to trust it.** If the best match is past its review cadence or has a
   newer related memo, `find` says so in the same breath as answering. A library
   that serves a stale document silently is worse than one that has no answer,
   because the reader has no way to know.

---

## What was taken from the reference skills, and what was not

The reference is `reference-kit/skills/new-doc.md`, the direct ancestor of
`new`. Taken as structure and reasoning only, per the standing rule.

**Carried across, because they are hard-won and not obvious:**

| Lesson | Where it lives now |
|---|---|
| Never invent a select value, because Notion drops unknown ones silently | A rule for all six |
| Verify the body actually wrote, because pages can ship empty on a partial failure | A rule for all six |
| The duplicate check runs before structuring, not after | `new` |
| Hierarchy is type-driven, not order-driven. The parent is always a Strategy Decision | `new`, and the plugin enforces it |
| When two type patterns match, ask rather than take the first | `new` |
| A hard confirmation gate, where anything ambiguous counts as not yet confirmed | A rule for all six |
| Preview the full body inline rather than pointing at a file | A rule for all six |

**Deliberately not carried:**

| Not carried | Why |
|---|---|
| `Type` as a multi-select with numbered labels | An artifact has one type. Already fixed: single select, numbering dropped |
| Dual-writing `Team Informed` and a `Teams` relation, with a mapping table and a special case for Eng | A half-finished migration frozen into a skill. The single `Audience` field removes the need entirely |
| Reading a Slack channel list at runtime from a named file in a specific code repository | Ties a skill to one company's repo layout. A portable plugin cannot assume it |
| The 400 word **floor** in its 400 to 800 range | A floor manufactures filler, which is why it needed a second rule telling itself not to pad. The 800 ceiling was kept, because a ceiling was the half doing useful work. See "The length rule" in each schema file |
| `Owner` as a body section | It is a property. A body section that duplicates a field is two things that disagree later |
| Auto-suggesting two or three companion child documents after every create | Plausible, but it manufactures work. Left out of v1 |

**The structural finding.** The reference set had `new-doc` and nothing else for the
documentation library. No update, no audit, no find, no backfill. It could create
documents and never maintain them, which is exactly how a library becomes
something nobody trusts. Four of our six skills exist to close that gap, and this
is the clearest evidence that they are the right four.

---

## The three review passes over these skills (2026-08-17)

Three lenses chosen for this material, since it is a build spec rather than
writing for a reader. Eleven findings. Nine were fixed above. Two, numbered 4 and
8, were checked and deliberately left alone, and are recorded so nobody has to
check them again.

### Pass 1: schema coverage

Every field in every schema, checked against who actually writes it. Done by
extracting the field tables mechanically rather than by eye.

1. **`Review cadence` was read by `audit` and set by nothing.** Every artifact
   would ship with it blank, so signal 1 had nothing to compare against. `setup`
   now stores a default and `new` applies it.
2. **`Status` had no writer and one unreachable value.** Nothing said what a new
   artifact's status is. `new` now sets `Active`, the supersede branch sets
   `Archive`, and `Draft` is documented as a person's to set, because a skill
   that writes a draft has written nothing useful.
3. **Nothing established who the user is in Notion**, yet `Owner` and
   `Verified by` are both person fields that `new` fills. `setup` now stores the
   user's Notion person id.
4. `Child Docs` needs no writer. Notion maintains the inverse of `Parent`
   automatically. Checked and cleared rather than assumed.

### Pass 2: contradictions across the five files

5. **The significant one. A Notion relation property cannot be created without a
   target database id**, and two fields pointed at databases v1 may not have
   created. `Software` has no target at all in v1, and `Projects` only exists if
   `projects` is installed. Setup would have failed at property-creation time,
   during setup, which is the worst moment for it. Both are now conditional, with
   the rule written into `SCHEMA-process.md` and each setup responsible
   for adding the relations it enables.
6. **An empty date does not match a "before" filter in Notion.** Since `backfill`
   now leaves `Last checked for accuracy` empty, backfilled rows escape `audit`
   signal 1 entirely. That is fine, because signal 4 catches them, but a builder
   would reasonably assume signal 1 covers everything. Now stated explicitly.
7. **`Verified by` was described as mattering most for backfilled docs**, while
   `backfill` is the one skill forbidden from setting it. The field note now says
   who writes it.
8. Two fields are called `Status` across the two databases with different value
   lists, Active/Draft/Archive against Draft/Published/Canceled. Left as is,
   because each is right for its database, but worth knowing before someone
   writes a shared helper that assumes one set.

### Pass 3: can this be built from the spec

9. **"Fetch the live options in the context step"** referred to a step that is
   not defined anywhere. Rewritten as a plain instruction tied to the moment it
   happens.
10. **`audit` said it runs "on the review cadence"**, which nothing schedules and
    which v1 forbids, since there are no unattended runs. It runs when a person
    runs it, and reads the cadence to decide what to flag. Those are different
    things and the spec now says which.
11. **The duplicate check had no threshold.** the reference set used 70% on title and topic.
    Rather than inherit a number blind, the spec now says to set it against real
    artifacts and make it configurable, and says why: a similarity threshold set
    blind ends up either silent or unusable.

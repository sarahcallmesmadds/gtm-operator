# gtm-operator: decisions

Running record for `process`, `projects` and a marketing-ops plugin.
Append as decisions are made. Do not re-litigate anything here without new
information.

Started 2026-08-07. Renamed from "RevOps plugins" on 2026-08-17, when the
destination was settled (see "Where this ships" below).

---

## Measured against a live workspace, 2026-08-17

Run in a throwaway database under a testing page, deleted afterwards. Recorded
here because these are the facts the design rests on, and because two of them
were assumptions until this ran.

| Question | Answer |
|---|---|
| Can a view filter count multi-select values | **No.** 400, `Operator ">" is not supported for multi_select properties` |
| Can a view filter read a property across a relation | **No.** 400, no path syntax exists |
| Can a formula carry the tag count instead | **No.** It comes back typed as text and `>` is rejected on text |
| Can a rollup carry the parent's type instead | **No, and it lies.** The view is created, success is reported, and the filter is silently discarded |
| Can `check` find both violations in SQL | **Yes.** Both queries found exactly the offending rows. They selected the title that day and select `url` now, see 2026-08-19 below |
| Can a two-way self-relation be added in a second pass | **Yes** |
| Do ordinary select and relation `IS EMPTY` filters persist | **Yes**, confirmed by reading the views back |

**The rollup result is the one to remember.** A filter Notion cannot express is
sometimes rejected with a 400 and sometimes accepted and quietly emptied, and
which one you get depends on the property type. Nothing in the response
distinguishes them. **This is why `install` step 7 reads back everything it
created rather than trusting that the create calls returned success.**

It also settles the open choice about the two unenforceable rules: routing them
to `check` was not merely the tidier option, it is the only one that works.

---

## Measured against a live workspace, 2026-08-18

The whole `install` flow was run: six databases created, thirteen relations
added, seven views built, everything fetched back and compared, and each view
queried for the rows it actually returns. Run under the `Plugins testing` page.

| Question | Answer |
|---|---|
| Is a two-way relation one statement or two | **One.** `ADD COLUMN "X" RELATION('<ds>', DUAL 'Reverse')` creates both sides |
| Does that hold for a self-relation | **Yes**, and the tool's own documentation says otherwise |
| How does a one-way relation differ in the read-back | It comes back with **no `propertyUrl`**. A two-way one carries it |
| Can a view filter use a relative date | **No, and it lies.** `> "today"` is accepted, stored, reads back correctly and matches nothing |
| Does an ISO date filter work | **Yes**, proved by the rows. The identical view with a real date returned the row |
| Does a relation `IS EMPTY` filter work on rows | **Yes**, proved by the rows, not only by reading the filter back |
| Can a view be queried for the rows it shows | **Yes**, in view mode. This is what makes a filter provable |

**The relative date is the finding to carry.** It is the third time a Notion
filter this design needed has been accepted and then not worked, and it is the
first one that **survives being read back**. The rollup failure on 2026-08-17 was
caught by re-fetching the view and seeing `filters: []`. This one re-fetches
identically to a working filter: same operator, same shape, same everything. Only
querying the view and looking at the rows told them apart.

**So step 7 of `install` grew a second half.** Reading a filter back proves it was
stored. Running the same rule as SQL and comparing the rows proves it works.
`verify` does both and says `unchecked` for any view where the second half is
missing, because silence there would be the plugin repeating the mistake it was
built to catch.

**What this cost the design.** `In market` and `Upcoming` were both specified
with a date window, the current month and dated in the future. Neither can be
built. Both now exist without the date clause, both carry a `reduced` note in the
manifest recording why, and whether that is good enough is **open and hers to
decide**. Nothing else in the design changed.

---

## Two fixes where the code disagreed with its own documents, 2026-08-19

Both were found by review and neither had bitten a user, because both need a
second run to show themselves.

**`recordPerson` no longer clears the proof.** It called
`invalidateVerification`, which exists to drop a verify when the thing verified
has changed, and which also demotes `state: complete` back to `creating`.
`begin` reads that state and nothing else to refuse installing over a workspace
that is already built, so saving a person was a way past the refusal. The proof
is a statement about the schema and `personId` is not part of the schema:
`Owner`, `Verified by` and `Author` are created on every install whatever the
value is, and it decides only whether a later row write fills them. So the
clearing was throwing away something still true. The two functions that do
invalidate, `recordDatabase` and `reresolveDataSource`, both change which Notion
object the config points at, which is what a proof is about.

**The two rule queries select `url` rather than the title.** `check.js` tells
the caller to record what comes back as page urls, `judge` puts those rows
straight into what it reports, and `check/SKILL.md` says urls too. Only the
query templates disagreed, and a caller following the instruction beside them
recorded titles and called them urls. Titles are also not unique, so two rows
breaking the same rule could arrive indistinguishable, and a report you cannot
click through to is most of the value gone.

**This is the same fault as "the row proof was resting on titles", fixed for the
view proofs on 2026-08-18, one day earlier and one file away.** Worth naming as
a repeat rather than as two incidents: both places had a measured query written
before there was any consumer contract, and neither was revisited when the
contract arrived. The fix in both is `SELECT url FROM <ds>`, and `url` is a
system column that no rename touches, so it takes no placeholder.

**What the old measurement still covers.** Both queries were run against real
rows on 2026-08-17, and what that proved is which rows come back: the `WHERE`
half and the join, both unchanged character for character since. Which column
comes back was not part of it, so **these exact strings have not been sent to
Notion**. The test file's constant is named `SENT` rather than `MEASURED` for
that reason, because the older name would have been the one thing in this
repository claiming a measurement of a string nobody ran. Re-running them needs a
workspace, and the test containers were deleted on 2026-08-19.

---

## Skill names and shapes, decided 2026-08-18

Sarah's calls, in conversation, after reading the marketplace layout.

### `software` gets `update`, the general path for a row whose facts changed

**Software was the only foundation plugin with no `update`.** That is the hole,
and retirement was only the case that made it visible.

**It is not a status skill.** The things that change about a tool are ordinary and
various: the vendor is acquired and the product renamed, a contract is extended or
shortened, the cost changes at renewal, the owner leaves, the security answers get
re-checked, access is widened. Any of those is a reason to open the row, and none
of them is a status change.

Retirement is one case among them: `Status` moves to `Retired` here rather than
requiring a full `review` sweep, which was friction at the exact moment somebody
was willing to record something. **Nothing is deleted or archived, unchanged from
before:** the row stays, and `Retired` and `Rejected` keep the history of what was
dropped and what was turned down.

**Spec owed**, and it has to answer a question retirement does not raise: **what a
rename does to the history.** A tool acquired and renamed is the same contract and
the same spend under a different word, and `Name` is defined as the vendor's own
spelling. Nothing currently records what it used to be called, so the row stops
being findable by the name everyone still uses for it.

### `renewals` is now `contracts`

The old name pointed at the wrong event. **The notice deadline is what bites, not
the renewal date**, and a skill named for renewals reads as if the renewal is the
thing to watch.

**It also grew a job.** It may read the contract document itself when asked, not
only the row, so a question the properties cannot answer can be answered from the
source. It stays read-only and still writes nothing.

**Where the detail comes from is the schema, not a search.** `Contract link` is
the property that says where the agreement is, and that is the only place this
skill looks. Two forms have to work: a link to a Google Drive file or folder, and
a file uploaded onto the row itself.

**That breaks the property as defined.** `Contract link` is a URL, and an upload
cannot go in a URL property. See the schema consequence below.

### `Contract link` has to change type, and probably name

An upload and a link cannot share a URL property. Notion's Files & media type
holds both an uploaded file and an external link, so **one property still covers
both cases, but it has to be Files & media rather than URL.**

**The name then stops being true.** "Contract link" describes one of the two
things it would hold.

**Open, and hers:** whether the property becomes `Contract` or `Contract file` or
stays as it is with uploads refused. Nothing has been changed in the schema yet.

**Measured 2026-08-18, and the answer decides the property.**

| Attempted | Result |
|---|---|
| Read a PDF stored in Google Drive | **Yes.** Full text came back. Word, Excel, PowerPoint and images are supported the same way |
| Read a PDF uploaded into Notion | **No.** The download refuses binary files outright, and the page read-back gives a `file://` reference rather than a URL anything can fetch |
| Read a text file uploaded into Notion | **Yes**, but only plain text formats, only files this same connection uploaded, and only up to 200 KiB |
| Store a PDF in a Files property at all | **Yes**, but the file has to be uploaded, placed in a page body, and then referenced by the id that appears when the page is read back. Not one call |

**So a contract this skill can read is a Drive link, not a Notion upload.** A
contract is a PDF, and a PDF sitting in Notion is a file the plugin can see the
name of and nothing more. Storing one there would produce a row that looks like it
carries the agreement and cannot answer a single question about it.

**What follows for the property.** Files & media buys the ability to hold an
upload, and an upload is the one form that cannot be read. Keeping `Contract link`
as a URL costs nothing that can be used and keeps the name true.

**Decided: `Contract link` stays a URL, pointing at Drive.** Sarah's call,
2026-08-18.

**And the rule now travels with the field.** The property carries a description,
which Notion shows when somebody clicks it:

> Put the contract PDF in Google Drive and paste the link here. Claude can read
> the contract through this link. A file uploaded straight into Notion cannot be
> read.

**This is the first property description in the design, and the pattern is worth
naming.** Every other rule in this system lives in a document, which means it
reaches a person only if they go looking. A description reaches them at the
moment they are filling the field in, which is the moment the rule matters. It
says what to do and why, because "why not just upload it" is the obvious next
thought and the answer is not guessable.

`schema.js` emits it as a `COMMENT` clause, `verify` checks it came back, and it
was proved on a live workspace rather than only generated: the statement was
sent and the description came back word for word.

**`note` in `schema.js` is a different thing and is never sent.** Notes are for
whoever is reading that file. A description is for whoever is filling in the row,
and shipping a remark like "skipped when there is no personId" to a user would be
the same mistake as a stale count.

**A separate note if Files & media is ever adopted anyway:** `FILES` in the DDL
reads back as `file`, another type that does not round-trip under the name it is
written with, alongside `RICH_TEXT` reading back as `text` and `PEOPLE` as
`person`.

### `software:review` checks what it can before it asks anything

**As designed it confirmed nothing.** It walked four groups of questions, took
the answers, and stamped `Last reviewed`. The only thing it verified was that
somebody answered, which is a date stamp for talking to yourself.

**So it reads first, then asks about the remainder.**

| Group | Confirmed from |
|---|---|
| Contract dates, cost, notice deadline, renewal terms | The contract in Drive, via `Contract link` |
| Still being paid for | A card or banking source, and invoices in the mailbox |
| AI access | Whether the tool is actually connected |
| Owner, SSO, PII, still in use | Nothing. These stay questions, because there is no source |

It shows what disagrees with the row rather than correcting it, the same way
`backfill` offers candidates rather than writing them.

**Spend sources: Ramp or Brex**, Sarah's call 2026-08-18.

**Neither is connected on this machine today.** QuickBooks and Mercury are, and
both answer the same question, so the spec should name the source as a
configurable thing rather than hard-coding one vendor. Which sources are actually
available is a `setup` question, alongside the call recorder.

### The five `software` skills, and the line between `review` and `update`

**Confirmed 2026-08-18**, read out one at a time and taken as a set: `new`,
`update`, `review`, `contracts`, `backfill`. Four of them existed and `update` is
the addition.

**The boundary, also hers:**

- **`update` changes facts you already know changed**, one row at a time, and
  **never writes `Last reviewed`.**
- **`review` confirms a whole row is still true**, and is **the only skill in the
  plugin that writes `Last reviewed`.**

**Why it needed settling.** `review` was written when it was the only way to
change anything on a row, so it was doing `update`'s job as well and the two
overlapped with nothing dividing them. The split keeps the existing rule intact,
the one saying the review clock moves only when a review actually happened, and
it gives somebody correcting a cost a path that is not a four group sweep.

**It diverges from `process:update` deliberately.** There an edit can count as
having re-read the artifact, and on an explicit yes it moves all three
verification fields. Here it never can, because a software review reads the
contract in Drive, a spend source and whether the tool is connected, and no edit
does any of that in passing.

**Spec written** in `SKILLS-software.md`, including what a rename does to the
history, which is the question retirement never raised.

### A rename is a rename, and nothing records the old name

**Decided 2026-08-18, hers.** A tool acquired and renamed gets its page renamed
and its `Login`, `Documentation` and `Status page` URLs updated, because an
acquired product moves domain. That is the whole operation. **No former name is
kept and no property is added to hold one.**

**The alternative was a text property**, `Also known as`, so the old name stayed
somewhere a query could reach. It was turned down as overbuilt, and the schema
stays at twenty-eight fields.

**The cost, accepted.** The duplicate check matches on the name, so a `backfill`
re-run meeting an invoice still issued under the old name offers the tool as a
candidate again. That is one "no" at the approval gate, the same as any other
junk candidate, because backfill never writes without approval. It only becomes a
second row for the same contract if somebody approves it.

### Status ships as a select, and the user converts it by hand

**Measured 2026-08-18.** Both DDL forms are rejected at the parser, before
anything about the options is reached:

- `ALTER COLUMN "Status" SET STATUS('Draft':yellow, ...)` -> 400
- `ADD COLUMN "X" STATUS('Draft':yellow, ...)` -> 400

Converting without options succeeds and silently replaces the option list with
Notion's defaults, Not started / In progress / Done. That is wrong for four of
the six databases and it discards values the design chose.

**So install ships every Status as a select carrying the right values**, and
`POST-INSTALL.md` tells the user to convert each one and where each option goes
in the three status groups.

**All six ship as selects. There is no exception.** This section said until
2026-08-18 that Tasks was the exception and shipped as a status property, and
`POST-INSTALL.md` repeated it. It was wrong on both counts. No route to a status
property exists through this API, so no install could have produced one, and
`schema.js` has always created the Tasks `Status` as a select like the other
five. The wording above it, "the API creates a status property but cannot create
or rename its options", was the premise that made the exception look possible,
and the two measured 400s directly beneath it already contradicted that premise.

**What it cost.** `Percent complete` on Projects rolls up task status by group
and group rollups exist only on status properties, so the rollup does not work
until Tasks is converted by hand like the rest. A user following the old
`POST-INSTALL.md` would have skipped that conversion and never learned why the
number stayed blank. Tasks is now the sixth row of the conversion table.

**Still open: whether Tasks should carry a `Paused` option.** The old text told
the user to add one, which never existed in `schema.js` and so was never in any
install. Adding it is a schema change and a naming decision, and it has not been
made.

**The same limit applies to page layout.** Property grouping, tabs and the
sidebar are UI only. The API reaches the schema and the view configuration and
nothing else. This is the other half of `POST-INSTALL.md`, and it is owed
screenshots that do not exist yet.

### Projects reaches Memos through one relation, and the memo's Type says which memo it is

**Decided 2026-08-18, in review.** Projects carried two relations to Memos:
`Memos` / `Projects` for updates and releases, and `Problem Statement` /
`Resulting Projects` for the one memo making the case that the work was worth
doing. The second one is dropped. Twelve relations now, not thirteen.

**Why.** Two relations between the same two databases mean two places to look and
two places to file something wrongly. A project's problem statement is a memo. It
is attached through `Memos` like every other memo, and the memo's `Type` says
which one it is. That property already existed and already carried the
distinction.

**This reverses a decision taken the day before.** On 2026-08-17 the second
relation was made two-way precisely so a problem statement could show what was
built in response, on the reasoning that the only other `Projects` property would
file a problem statement as a project update. **That reasoning does not survive
the removal**, because the relation left standing is two-way: a memo attached
through `Memos` shows its project under `Projects`. The trace the 08-17 fix was
protecting is intact with one relation carrying it.

**The cost, accepted.** The `Projects / Needs attention` view is now wider than
the rule it enforces. It shows projects with no memos at all, where the rule is a
project with no problem statement memo. Narrowing it to the memo `Type` needs a
filter that reads through the relation, and a rollup filter was measured on
2026-08-17 to be accepted, reported as created, and read back as `filters: []`.
So the view is the widest check that actually works, and `scope` is what holds
the rule exactly by refusing to finish without a problem statement.

**How it was found.** The decision was taken in review, applied to the test
workspace by hand, and written into no file. It surfaced on 2026-08-18 when the
rule query for that view was run against the live workspace and failed with "no
such column: Problem Statement". The code and every document had agreed with each
other and disagreed with the workspace for a day.

### `calendar:new` checks for duplicates as well as clashes

It already showed what else was aimed at a similar audience in the same window.
**That is not the same question as whether this thing is already on the
calendar.** A clash is two different things colliding; a duplicate is the same
thing entered twice. Both get checked before anything is written, and for the
same reason: the only moment to prevent either is while somebody is still
choosing.

This makes it the same shape as `process:new`, which already checks for
duplicates.

### `calendar:upcoming` is now `calendar:soon`

`upcoming` reads as a date-sorted list, which is the one thing this skill
deliberately is not. It groups by who a thing hits rather than by when it
happens, and separates what is locked from what is only hoped for.

---

## What we are doing

Building new, shareable plugins for people who do not have Sarah's setup.

**The reference set is reference only.** It is an export of the internal skills
and schemas from a prior engagement, and it is deliberately not named anywhere in
this repository. Do not reintroduce the name, the repository names or the file
paths: this is a public-facing design and naming somebody else's internal tooling
in it is not ours to do. "The reference" is the term throughout.

What we take from it is:

- the schema, including page body structure
- why it was built that way
- what is expected in each part
- how someone is meant to use it
- why it helps

**What we are not doing.** Not fixing, auditing, migrating or cleaning anything
in the organisation the reference came from. Sarah does not work there. Row
counts, fill rates, staleness, adherence and drift between existing docs are
irrelevant and must not appear in this work. Where two old docs disagree, pick the
better one and move on rather than raising it as a decision. The reference is used
only to identify the most recent and best-developed version of a structure.

**Frameworks and judgment calls belong inside the skills.** Anything worked out
here that helps a user decide something (how granular a Strategy Decision should
be, when a tag is really a tag) gets written into the skill itself, not left in
a planning doc. Users hit these questions on day one.

---

## The process we are following

Sarah's order, set 2026-08-07. Do not skip ahead.

1. **Database infrastructure.** Properties, property values, property rules, and
   the interaction rules between artifact types. IN PROGRESS, nearly done.
2. **Page body template per artifact type.** What is included, hard rules, and a
   related-database view inside each page body.
3. **What each skill does.** Only after 1 and 2, because by then we know which
   properties get filled and by whom.

After Process schema is settled, do the **Memos** schema the same
way. The Projects and Tasks schema belongs to `projects`.

**Scope discipline:** finish the full detailed plan for `process` before
touching the other plugins, then hand it to an agent to build.

---

## Plugins and their skills

| Plugin | Skills |
|---|---|
| `process` | `setup`, `new`, `update`, `backfill`, `audit`, `find` |
| `projects` | `problem-scan`, `problem-statement`, `scope`, `new`, `comms`, `ship` |
| marketing ops (name open) | see its section below |

Sprint skills are dropped, not being rebuilt.

Build order: `process`, then `projects`, then marketing ops.

**`projects` needs its own setup skill**, which creates the Projects and Tasks
databases.

**Superseded 2026-08-17: one `setup` plugin creates every database.** This
previously said Memos was created by whichever of two setups ran first, with each
detecting whether it already existed. There is now one setup and nothing to
negotiate.

---

## Naming

- The thing is the **Process**. Not Documentation Library, not Docs Library.
- Its rows are **artifacts**. The Type field holds **artifact types**.
- The communications log is **Memos**. Never "the Updates DB". This supersedes
  the 2026-07-17 note in the reference database inventory proposal, which had
  said the name stays "Updates".

---

## The marketplace: two tiers (decided 2026-08-17)

**This supersedes the three-plugin shape.** Everything written before this date
assumed `process`, `projects` and a marketing plugin, each carrying its
own setup. That is replaced by the structure below.

### Tier 1: the foundation. Plugins named for the object they manage.

| Plugin | Owns | Status of the design |
|---|---|---|
| `setup` | Creates every database | Designed, `SKILLS-setup.md` |
| `process` | Process | Schema done, 5 skills done |
| `memos` | Memos | Schema done, skills not started |
| `projects` | Projects and Tasks | Schema done, 6 skills done |
| `software` | Software | Schema done, skills not started |
| `calendar` | Everything that happens on a date and reaches somebody outside the team | Schema done, skills not started |

### Tier 2: jobs. Plugins named for the work they do.

These own no database. They read and write the foundation's. Not started, and
not in scope until the foundation ships.

`list-building`, `outbound-email`, and others as they come up.

**`teammates` is v2, decided 2026-08-17, and that resolves the contradiction it
carried.** A teams and people directory owns an object, so by the rule below it
would be a foundation plugin and would own a seventh database. It sat in tier 2
anyway, which broke the rule for the one case nobody had decided.

**Deferring it to v2 is what makes the rule hold rather than an exception to it.**
The foundation is six databases and `setup` creates all six every time, so a
seventh added later is a schema change to `setup` and a migration for everybody
already installed. That is a real cost and it buys a directory nothing in v1 reads.
**When it is built it is a foundation plugin with its own database, not a job
plugin.** It is out of v1 because of when, not because of what it is.

### The rule this gives you

**A foundation plugin is named for its object. A job plugin is named for its
job.** If a proposed plugin does not own a database, it belongs in tier 2.

### Why setup is its own plugin

This reverses the 2026-08-08 decision that setup lives inside each plugin, whose
reasoning was that a user should not need a second plugin to configure the first.
That holds for one standalone plugin. It does not hold for an operating system
where several pieces get installed anyway.

Every hard problem the design hit came from setup being duplicated:

- Two setups both creating Memos, unable to find each other's
- A shared registry file invented to solve that
- `scope` having to check whether Process was even installed
- Four Memos types belonging to no plugin

One setup that creates every database removes all four. Everything downstream
assumes the databases exist.

### What this invalidates

Not a rename. These need actual rework:

1. **`SKILLS-process.md`** describes a `setup` skill inside the plugin,
   and routes to it on first run. That skill moves out.
2. **`SKILLS-projects.md`** does the same, and its `setup` also carries the
   two-plugin relation-wiring and the shared registry. All of that is now one
   setup's job and much simpler.
3. **The shared registry file** is no longer needed. One setup knows what it
   created.
4. **Plugin names in both skill files** are stale: `process` is `process`
   and `projects` is `projects`.
5. **`SCHEMA-process.md`'s** two-stage relation rule still holds, but now
   applies to one setup building six databases in order rather than two setups
   negotiating.

### Setup creates all six, every time (decided 2026-08-17, later the same day)

**Setup does not ask which databases you want and does not read which plugins are
installed. It builds the whole foundation in one pass.**

This is what makes the two-tier architecture pay. Every database exists before any
relation is added, so no relation is conditional, nothing is added back later by a
second install, and no plugin checks whether another plugin is present. The old
design spent four separate mechanisms on that problem. This spends one ordering
rule.

The cost is real: somebody who only wants a documentation library gets six
databases. That is cheaper than six plugins negotiating.

**What this invalidates.** Every "conditional relation" note in
`SCHEMA-process.md` and `SCHEMA-memos.md`. Both are corrected.

**What this creates.** A hard dependency. Setup cannot be built until all six
schema files exist, and `SCHEMA-software.md` and `SCHEMA-calendar.md` do not.

### Software is in v1 (decided 2026-08-17, reversing the same day)

`software` is a foundation plugin that owns the Software directory, and setup
creates it. This reverses "v1 has no Software directory" and the `Software`
relation being listed as planned rather than shipped.

Three places had disagreed: the two-tier table listed `software` as tier one, the
Process schema said the relation was not created in v1, and the cut list
said there was no Software directory. The two-tier architecture wins.

**Follow-on:** SOP, Reporting and Technical Reference revert to Software related
views, which is what they wanted before Software was cut. Blocked on
`SCHEMA-software.md`, and recorded in `SCHEMA-process.md` rather than changed,
because a template cannot name a view of a database nobody has described.

### Supersession labels both sides (decided 2026-08-17)

Closes an open question that had been carried since the field was designed. The
new decision carries `Supersedes` and the replaced one carries `Superseded By`.
The reader who most needs the link is the one who lands on the old page, where
Archive says it is dead and nothing says what to read instead.

**Renamed from `Superseded Strategy`**, because labelling both sides means naming
both sides, and one name cannot mean "the one I replaced" on one page and "the one
that replaced me" on the other.

The reasoning for why this is a second page rather than an edit was written down
at the same time, in `SCHEMA-process.md`. It had been assumed everywhere and
stated nowhere.

### Naming note

`calendar` was chosen on 2026-08-17 after `campaigns`, `in-market`, `programs`,
`moments`, `events` and `gtm-calendar` were considered. `campaigns` reads as paid
and email. `events` does not cover social posts. Plain `calendar` won because
nobody has to be told what it means.

---

## The schemas live in their own files

Split out on 2026-08-17 so they are findable and so nothing has to retype them.

| File | Holds |
|---|---|
| `SCHEMA-process.md` | Process fields, every value list, the rolldown and superseded rules, the granularity framework, the type-selection tree, and the five page body templates |
| `SCHEMA-memos.md` | Memos fields, every value list, the seven page body templates, and what the three review passes changed |
| `SCHEMA-projects.md` | Projects and Tasks fields, every value list, both page body templates, and what the three review passes changed. Both belong to `projects`, which creates them together |
| `SCHEMA-software.md` | Software fields, every value list, the one page template, how rows get created including `software:backfill`, and what was taken from the reference spec and what was not. Belongs to `software` |
| `SCHEMA-calendar.md` | Calendar fields, every value list, the one page template, the boundary test for what belongs in it, and the manifest of database-level views setup has to create. Belongs to `calendar` |
| `SKILLS-setup.md` | The `setup` plugin's three skills, the two-phase creation order, the full relation map, the config shape, and the build risks worth measuring first |
| `SKILLS-memos.md` | The `memos` plugin's four skills, why there is no `update`, `backfill` or `audit`, and the rule that any plugin may write any database but no plugin may call another plugin's skill |
| `SKILLS-software.md` | The `software` plugin's four skills, the one-row-per-thing-you-can-cancel test, and why there is no `find` |
| `SKILLS-calendar.md` | The `calendar` plugin's three skills, the clash check, why the debrief is folded into `update`, and why this is the one foundation plugin with no `backfill` |
| `SKILLS-process.md` | The `process` plugin's five skills in five slots each, plus the rules that apply to all of them and what was taken from the reference skills |
| `SKILLS-projects.md` | The `projects` plugin's six skills in the same five slots. `problem-scan` and `ship` were names with nothing behind them and are marked as such |
| `REVIEW-codex-2026-08-17.md` | The independent Codex review of the above. Twelve findings, my verdict on each, and the three still open |

**Those files define. This file explains.** Value lists and full field
definitions appear in exactly one place, which is the schema file for that
database. Do not restate a field list here, in a handoff, or in a skill. Point at
the schema file instead.

**A `SKILLS-` file may name the properties its skills write, and two of them
must.** `SKILLS-setup.md` cannot state a relation map or a config shape without
naming properties, and `SKILLS-projects.md` writes to a database it does not own,
so its write contract has to say which properties it fills. **Narrowed 2026-08-17**,
when review found the rule already broken by both files on the day it was written.
A rule broken by its own page teaches people to ignore it, and the tables it
forbade are load-bearing. What stays forbidden is copying a value list, which is
the thing that actually drifts.

Shared fields (Domain, Audience, Segment, L2C Lifecycle, Tags) carry identical
value lists across all four databases. Changing one means changing all.

**The scope rule was set aside deliberately on 2026-08-17.** "Finish the full
plan for `process` before touching the other plugins" is still the rule,
and Projects and Tasks are `projects`. Sarah chose to do them now anyway. Nothing
was lost, because the two are independent: `process` part 3 does not need
the Projects schema and the Projects schema does not need part 3. Recorded so
this reads as a decision rather than an oversight. Part 3 for `process`
is still the next thing owed.

---

## Backend choice (Notion only, decided 2026-08-17)

**v1 supports Notion and nothing else.** Setup does not ask which knowledge base
to use. It sets up Notion.

Notion holds the full schema natively, with properties, relations and selects,
so no translation is needed between what was designed and what gets stored.

**There is no adapter.** The five-operation abstraction (create the store, read
a row, write a row, query by property, write a page body) existed to let one set
of skills serve two different stores. With one store there is nothing to
abstract, and building the layer anyway would be guessing at a second
implementation that may never arrive.

**What replaces it:** the Notion calls live in one shared file, not repeated
across the six skills. That is code hygiene rather than an abstraction, and it
happens to leave a clean seam if a second store is ever genuinely wanted.

**Do not leave the field mapping to whoever runs setup.** If each install
invents its own structure, `audit` and `find` can rely on nothing. The plugin
owns the logical field names; config only maps them to display names. This
survives the change and is unrelated to how many stores are supported.

**Confluence and Guru are out**, not deferred behind an interface. Sarah has no
account for either and an untested store is worse than a missing one: it
half-works and the plugin gets blamed. They remain valid as *sources* for
`backfill` to read from, which is a different job from writing to them.

### Why this reversed, so it stops moving

This decision has now moved twice. Notion-only was the original v1 cut, then
2026-08-08 added Google Sheets plus Docs on the reasoning that designing against
two genuinely different stores (a property database and a spreadsheet) is what
forces a shared layer to be real rather than "Notion with extra steps". Sarah
does not want a second store, so that reasoning has nothing left to support. It
was an argument for how to build two backends well, never an argument for having
two.

**Do not re-propose a second backend without a user asking for one.** The
trigger to revisit is a real request, not a design preference.

### Follow-ons from this reversal

1. Setup no longer asks which store to use. Simplify it.
2. Tags, Rolldown from Parent and Superseded Strategy no longer need a
   flat-column form. Use Notion's native shape.

### Schema read-through against this change (done 2026-08-17)

Checked every field and the cross-type rules in `SCHEMA-process.md` for anything
shaped by the spreadsheet requirement. Nothing was built against the old
decision, so this cost nothing to reverse.

**The schema is almost entirely unaffected**, because Parts 1 and 2 were written
on 2026-08-07, a day *before* multi-backend was decided. The spreadsheet was
fitted around the schema rather than the other way round.

- **`Sources` as a body section, not a field.** Reason given was that it does not
  fit a Notion property. Still true, unchanged.
- **`Audience` as multi-select rather than a relation.** Reason was that it needs
  no second database, so it works for someone starting empty. Unrelated to
  stores, unchanged.
- **Rolldown from Parent as pre-filled defaults, not a Notion rollup.** Already
  reasoned in Notion terms, unchanged.
- **`Superseded Strategy` as a Notion self-relation.** Already Notion-native. The
  open question of whether to label both directions is now purely a Notion
  question with no second store to satisfy.
- **`Tags` capped at 3.** A discipline rule, never a storage one. Unchanged.

**One item was reconsidered and changed: the numbered `Type` values.** They were
`1 - Strategy Decision` through `5 - Technical Reference`, numbered "so it
sorts". Notion sorts a Select by the option order you set, so the prefix was not
needed. It was written on 2026-08-07 and so was not caused by the spreadsheet,
but the 08-08 entry cited it as a benefit and that support is now gone.
**Numbering dropped 2026-08-17**, see the Type section in `SCHEMA-process.md` for the values
and the option order setup must apply. **`L2C Lifecycle` keeps its 0 to 8
numbering**, because there the number is the customer journey order and carries
real meaning.

**A conflict that this reversal removes.** `SCHEMA-process.md` requires that *every* artifact
type carries one embedded related-database view in its page body. That is a
Notion feature and a Google Doc cannot do it. Under the two-store plan all five
templates would have had to drop or fake that rule on the Sheets side, and
DECISIONS.md never said which. Notion-only makes the question moot rather than
leaving it to be discovered mid-build.

## Backfill has two input kinds (decided 2026-08-08)

Different problems, both in scope:

1. **An existing knowledge base.** A Confluence space, a Drive folder, a Guru
   collection, an old Notion database. Read it, classify each page into a type,
   map it into the schema, flag anything with no owner or no clear type. This is
   a **classification** problem.
2. **Conversation sources.** Slack, email, calls. Find process knowledge that was
   never written down. This is a **discovery** problem.

## process:update (added 2026-08-08)

The library had no way to change an existing artifact. `setup`, `new`,
`backfill`, `audit` and `find` all either create or read. `audit` made the hole
obvious: it produces a list of stale or wrong docs and there was nowhere to send
them.

**Kept separate from `new`**, unlike `projects:new` which creates, backfills and
edits in one skill. Two reasons: in a doc library edits massively outnumber
creates over the library's life, and the natural flow is `audit` handing findings
straight to `update`. Naming that path "new" would be wrong.

This also closes most of what was previously listed as the first v2 gap, a path
for a reader who spots that a doc is wrong.

## Setup explains the types (decided 2026-08-08)

Setup does not just list the five types. It explains **what each type is, why it
exists, when to reach for it, and why this taxonomy is the right shape for
enablement.** It is the plugin's one chance to teach the model rather than
impose it.

**Amended 2026-08-17: the five types are fixed in v1.** This previously said
setup was the moment someone decides whether to keep the five "or map to a set
they already have". That offer is withdrawn, because nothing else in the plugin
could honour it. The five names are load-bearing in four places: the
type-selection tree, the rule that only a Strategy Decision can be a parent, the
supersession branch, and template selection. A user with their own seven types
would break all four, and supporting that means building a translation layer with
no way to test it.

**What setup does offer is renaming.** Config maps a logical field or value name
to a display name, so a user can call a Strategy Decision a "Decision Record". The
meaning stays fixed.

**Renaming is not a config edit, and this is where that was got wrong.** Changing
a name writes to Notion first and to config second. Config may never name a
property or an option that verification did not find in the workspace, because the
next write would look for something that is not there. **The full three operations,
adopt, rename and add an option, are in `SKILLS-setup.md`.** Corrected 2026-08-17,
when review found this paragraph still carrying the collapsed version that the
fix had already replaced elsewhere.

Using a genuinely different set of types is a later version or a separate
option. It is not v1.

## What the process plugin does not do in v1

The cut line. A first version is defined by what it leaves out.

1. **Nothing writes without approval.** No scheduled generation, no unattended
   runs. Every artifact is previewed and confirmed.
2. **`audit` flags, it never fixes.** It hands findings to `update`, which is
   where a human approves the change.
3. ~~**No Software directory.**~~ **Reversed 2026-08-17.** `software` is a
   foundation plugin, `setup` creates the database, and the `Software` relation is
   an ordinary field. See `SCHEMA-software.md`.
4. **No agents or builds tracking**, which is why `Context SoT` is out. Marking a
   doc as one a skill depends on is only useful once something records which
   skill reads what.
5. **No approval workflow.** No review chain, no two-person sign-off. Status is a
   field a person sets.
6. **No taxonomy design at setup, and no remapping either.** The five types
   ship, fixed. Setup explains them and offers renaming, which writes to Notion
   and then to config. It does not
   interview anyone into inventing their own five, and it does not accept a
   different set. See "Setup explains the types" above.

**Reversed on 2026-08-08**, previously cut and now in scope: no migration from an
existing knowledge base, which is now part of `backfill`.

**Multi-backend was added on 2026-08-08 and removed again on 2026-08-17.** v1 is
Notion only. See "Backend choice" above for why, and for the rule against
re-proposing it.

**v1 is done when** someone with an empty Notion workspace can run `setup`, get
the database created with this schema, run `backfill` against either an existing
knowledge base or their conversation sources, and end up with real artifacts they
did not write by hand.

## How these plugins ship

### Where this ships (decided 2026-08-17)

**These plugins do not go in `infra-plugins`.** They ship from a new repo,
`sarahcallmesmadds/gtm-operator`, which is its own marketplace. `gtm-operator`
is the name of the repo and the marketplace, not of a plugin. The plugins inside
keep their own names and stay separately installable, except that every one of
them needs `setup` to have run first:

```
sarahcallmesmadds/gtm-operator
├── .claude-plugin/marketplace.json
├── plugins/
│   ├── setup/
│   ├── process/
│   ├── memos/
│   ├── projects/
│   ├── software/
│   └── calendar/
├── CONTRIBUTING.md
└── tests/
```

Two reasons, one about audience and one about risk.

- **Audience.** `infra-plugins` holds six plugins that are personal working
  infrastructure (`build-loop`, `git-hygiene`, `guardrails`, `session`,
  `slop-check`, `spend-guardrails`). These are for people who do not have
  Sarah's setup at all. Different readers, different repo.
- **Risk.** `infra-plugins` is public and takes roughly 425 clones a fortnight,
  almost all marketplace fetches. When `ip-inventory` turned out to be personal
  and was withdrawn on 2026-08-11, history could not be rewritten, because a
  force push would have broken every installed client. Keeping a separate repo
  means a mistake in one does not have to be undone in the other.

Still open, to settle when the repo is actually created: whether it starts
public or private, and whether `CONTRIBUTING.md` and the authoring contract test
are copied in or referenced from `infra-plugins`.

### The rest

- Ship the plugin pristine. **Never write into the plugin cache**, it is
  overwritten on update.
- Config at `~/.claude/<plugin>.config.json`: database ids, property-name map,
  status-name map, toggles, token source.
- The artifact-type taxonomy lives at a **user-owned, configurable path**,
  default `~/.claude/gtm-operator/artifact-types.md`. Because the path is
  config, it can point at a file in a team's git repo, which is how a team shares
  one vocabulary and changes it by pull request.
- **Setup is its own plugin**, `setup`, and it creates every database in the
  foundation. **Reversed on 2026-08-17**; this previously said setup lives inside
  each plugin with no separate setup plugin. See "The marketplace: two tiers"
  above for why that stopped working.
- **Setup is discovered at the moment of need, never at install time.** Every
  skill routes to the `setup` plugin on first run when config is absent. Never
  rely on the user reading the README. (Defect logged against `ip-inventory` for
  exactly this: queue entry `2026-08-07T16-08-16-ip-inventory`.) This survives
  the reversal, and matters more now that setup is a separate install.
- **If the user has no Notion databases, setup creates them**, with this schema.
  That is what makes `backfill` possible afterwards.
- **Property and status names live in config, never hardcoded.** Another org's
  board says Inbox or Triage.
- **Skills that call each other must ship in the same plugin.** Claude Code has
  no dependency resolution between plugins.
- The authoring contract is `CONTRIBUTING.md` plus
  `tests/plugin-authoring-contract.test.js`, PR #74 (`a7d12c3`) in
  `sarahcallmesmadds/infra-plugins` (named `sarahcallmesmadds/plugins` when this
  line was first written). **On `main`, not on `feat/plain-answer`.** It is the
  contract these plugins are written against even though they ship from a
  different repo.
- The working example of runtime config and a property map was
  `plugins/ip-inventory/scripts/config.js` in that repo. That plugin was
  withdrawn on 2026-08-11 and its source now sits at
  `~/.planning/private/ip-inventory-plugin/`. Read it there. Do not rebuild it,
  and do not copy it into the public repo.

## The central idea

**Config holds identifiers. The Process holds judgment.**

Database ids and property names go in `config.json`. The rules the organisation
decided (a campaign record type by member status grid, an operating-context
artifact) live in Process as artifacts, in a form both a person and a
skill can read. Other plugins read those artifacts at runtime.

---

## projects (settled 2026-08-07, superseded in part by the two-tier architecture above)

### Data model
- **Memos is time-stamped communication and append-only. Artifacts are living
  reference. Do not merge them.** Append-only is narrower than it reads and
  `SCHEMA-memos.md` states it exactly: the body and content properties are
  immutable, `Published` to `Canceled` is the one permitted transition, and the far
  sides of two-way relations update themselves.
- **Problem statements stay in Memos.** A change means a new row, never an edit.
- **`comms` writes to Memos with Type = Project Update.**
- **PRDs live in the task body.** Artifact pointers per task: sometimes, not
  never and not always.
- **Scope lives in Notion, on the project.** Not Memos, not Artifacts. It is a
  project working document, not a broadcast.
- **Backfill fills blanks and never overwrites.**
- **Agents never fill Notion person-type fields on backfill**, it notifies real people.
- **Freshness checking only flags and dates. It never rewrites bodies.**
- **Iteration happens in chat, one write on approval.**

### Status flow
`Intake` → `Scoped` → `In progress` → `Done` / `Canceled`

- `Backlog` renamed to `Intake`. Those rows are unexamined, not queued. It is the
  placeholder pile.
- `Scoped` added: sized and waiting to be built. A Notion view cannot filter on
  "the scope section is filled", so it needs to be a status.
- No scoping-in-progress status. That state lasts one conversation.

| Skill | Expects | Leaves it at |
|---|---|---|
| `problem-statement` | no project needed | writes the Memos row |
| `scope` | no row, or `Intake` | `Scoped`, or `Canceled` |
| `new` | `Scoped` | `In progress` |

- **`scope` and `new` stay separate.** Scoping can end in "do not build this",
  and that never reaches `new`. `scope` finishes by *offering* to run `new`
  pre-filled, never auto-chaining.
- **`new` keeps its name** despite doing three jobs (create, backfill a
  placeholder, edit). The description carries the clarity.

### Prioritisation
Priority is set at the end of `scope`, written to the Projects DB Priority
property. It needs severity (from the problem statement) and effort (from the
scope), and effort is only known after scoping.

Before writing Priority, `scope` shows what is already at that priority so the
number stays relative. A separate `prio` skill was designed and **rejected**: the
property has to be set at scope time for visibility, and a comparison ritual
assumes a planning cadence most installers do not have.

---

## Marketing ops scope (not started)

1. Ingest a lead list from PDF, CSV, Notion, anywhere that is not a CRM.
2. Clean, enrich, dedupe and match into the CRM as contacts or leads, and accounts.
3. Set the CRM fields the org requires. Captured at setup, confirmed at run time.
4. Create or match a campaign and set member statuses **by following a process doc
   from Process** rather than hardcoding the grid.
5. Import, and confirm account and contact owners where no routing exists.

---

## Open

**The design is not finished.** Recorded plainly because it was repeatedly and
wrongly called done. The 2026-08-07 decisions were a starting point, not a
settled design, and its own handoff said every decision in it was assumed and
unverified.

### Not designed at all

**Nothing. All six schemas and all six skill sets are written as of 2026-08-17.**

| Plugin | Schema | Skills |
|---|---|---|
| `setup` | n/a | 3, `SKILLS-setup.md` |
| `process` | `SCHEMA-process.md` | 5, `SKILLS-process.md` |
| `memos` | `SCHEMA-memos.md` | 4, `SKILLS-memos.md` |
| `projects` | `SCHEMA-projects.md` | 6, `SKILLS-projects.md` |
| `software` | `SCHEMA-software.md` | 4, `SKILLS-software.md` |
| `calendar` | `SCHEMA-calendar.md` | 3, `SKILLS-calendar.md` |

**The design is drafted, which is not the same as finished.** Nothing has been
built, no repo exists, no skill has been written or run, and nothing has been
tested against a real user. What has changed is that there are no longer any
undesigned pieces, so the next failure will be found by building rather than by
reading.

**Done: the independent review.** Round 2 found fourteen problems, four of them
build blockers, all fixed. See `REVIEW-codex-2026-08-17-round-2.md`.

**Done: both open measurements**, run against a live workspace on 2026-08-17.

1. **The API cannot create a Status property with custom options.** It returns
   Notion's three defaults and rejects any options supplied, on creation and on
   alter. **Projects and Tasks now use `Select`**, which the other two databases
   already used, so all four now agree. This was carried as the highest-risk
   assumption in the design on the grounds that it would change a schema rather
   than code, and it did.
2. **Resolving who the user is works on this connection, and the review was wrong
   about it.** Asking for the current user returned a person with a name and an
   email rather than a bot, and listing workspace users worked. The finding was
   correct about an internal integration token and wrong about a user-authorised
   connector. **The three-tier fallback in `SKILLS-setup.md` stays**, because the
   measurement proves tier 1 is reachable and not that it is universal.

**Also learned, and it closes an old note:** this connection **can** trash a data
source, using `in_trash` on the data source update call. `MEMORY` and the
2026-08-17 handoff both recorded that it had no delete tool. The test database
created today was cleaned up with it.

**The rule that keeps paying: when two sources disagree about observable
behaviour, measure it.** Three times now. The select-value question, the status
property, and the current user. Two of the three had a confident written source
on each side and both sides were wrong at least once.

**Done 2026-08-17: `setup`.** Three skills, the two-phase creation order, the
relation map, the config shape and the build risks, in `SKILLS-setup.md`. **The
counts live there and are not repeated here**, having been wrong here twice: the
map went from eleven to thirteen and the risk list from four to five while this
sentence stayed still.

**Done 2026-08-17: the Software schema.** Twenty-eight fields, one page template,
in `SCHEMA-software.md`. Contracts and security both ship, and `software:backfill`
reads a folder of contracts and the user's own mailbox to find tools they already
pay for.

**The lesson from its review, worth keeping.** The first draft cut both the
contract group and the security group using the same argument, that answers rot
and v1 has nothing to sweep them. The contract group was overruled, and that
should have taken the security group with it. **One argument cannot produce two
answers in one schema**, and a cut applied unevenly reads as a considered
distinction when it is an inconsistency. `Last reviewed` is what makes both groups
honest, and it was already there.

### Designed but now needing rework against the two-tier architecture

5. **`SKILLS-process.md`** and **`SKILLS-projects.md`** had their setup sections
   removed but have not been re-read end to end against one-setup-creates-
   everything.

### Smaller, still open

6. Nothing. The two open measurements were run on 2026-08-17, see below.

**Closed 2026-08-17.** Two things, both because changing them after people have
installed would be a migration rather than an edit:

- Supersession labels both sides, and the field is renamed `Supersedes` /
  `Superseded By`.
- The memo-to-artifact relation is two-way. The artifact gains a `Memos` property,
  so a reader on an SOP can see what has been announced about it.

**Also closed 2026-08-17: social lives in `calendar`.** The question had been
whether it belongs, since it is the only row type that is not an event. It belongs,
and the question was the wrong shape: this is not an events database. A row is
anything that happens on a date and reaches somebody outside the team, which a
LinkedIn post does. Two calendars would mean neither could answer what is in
market that week, which is the one question the database exists for.

**Corrected at the same time:** this file recorded that every Calendar row relates
to a project. **The relation is optional.** Events, launches and campaigns almost
always have a project. A Tuesday social post does not, and forcing one manufactures
empty project rows.

### Tier 2, not started and not in scope yet

`list-building`, `outbound-email`.

**`teammates` is not in this list.** It is a foundation plugin deferred to v2, see
the tier 2 section above. Filing it here is what created the contradiction.

---

## calendar, plugin two, 2026-08-19

Built after a Codex review of the plan, before any code. That review found the
plan contradicting decisions already recorded in this repository, in three
places, and found one hole in the approved design itself. All four are settled
below.

### The shared code is vendored, not deferred

**The plan proposed that `calendar` carry its own narrow config reader and that
a real shared source wait until plugin three**, on the reasoning that building
shared machinery for one consumer is a guess about what the other four want.

**That contradicted a decision already made.** `SKILLS-setup.md` build risk 3
says the workable version is one source in this repository, copied into each
plugin at release by a script, with a test that fails when a copy has drifted,
and says why: hand-maintained copies diverge and the divergence is silent.

So: `shared/` holds the source, `scripts/vendor.js` copies it, and each plugin
declares what it wants in its own manifest under `gtmOperator.vendor` rather than
being listed in the script. `tests/vendor-copies-current.test.js` fails on drift
and was proved by appending a line to a copy.

**Which plugins get what is declared by the plugin, not by the script.** A list
in the script is a second place to remember, and the plugin that gets forgotten
is the one that ships without the file it needs.

### The reader is read-only and has one entry point

`shared/config-read.js` cannot write. There is no `begin`, no `complete`, no
`recordDatabase`. `setup` is the only thing that writes config, and the surest
way to keep that true is for the code every other plugin carries to have no way
of doing it.

**`contextFor` is the only production entry point.** `readRaw`, `inspectNames`,
`propertyName` and `valueName` are still exported, for the contract test and for
a caller that genuinely needs the pieces. All four are read-only, so they add no
way to write, but "the only entry point" was wider than the file and review said
so on 2026-08-19. An earlier draft handed out ids, state
and the name map separately and left each skill to remember which combinations
were unsafe. That is how a writer eventually runs against a half-built install:
not by deciding to, but by a skill that checked two of the three things.

**It keeps three answers about the name map apart**, which is the distinction the
whole file exists to carry across the plugin boundary: nothing recorded, recorded
and broken, and usable. `setup`'s `names.propertyName` resolves an unmapped name
to itself, which is right for `setup` because on a default install the shipped
name is the name in Notion, and wrong for a writer, because on a renamed
workspace it writes to a property that is not there.

`tests/config-contract.test.js` pins the reader to the writer on the version, the
path, the environment override and the three map states. **It proves the two
files in this checkout agree and cannot prove that an installed `setup` and an
installed `calendar` agree**, because those are separate releases updated
separately. `configVersion` is what covers that gap: the reader refuses a version
it does not know rather than guessing. Said in the test rather than left implied.

### A date is not required at `Canceled`

**Two approved files described different rules.** `SCHEMA-calendar.md` said a
date was required "from `Confirmed` onwards", which reads as including
`Canceled`. `plugins/setup/scripts/manifest.js` had already excluded `Canceled`
from the `Needs attention` filter, with the reasoning written beside it. A skill
built from either would have been correct and wrong at the same time.

**The manifest's reading wins**, on Sarah's call. The rule catches a row that
promises something will happen and does not say when. A canceled row promises
nothing, so demanding a date on one reports a row that is not broken. Five
statements of the old wording were corrected across two files.

`tests/calendar-schema-agrees.test.js` now asserts the statuses the writer
requires a date at against the filter on the view that catches them, so the two
cannot drift again silently.

### The clash check needed a window, and had none

**The specified mechanism could not catch its own motivating example.**
`SKILLS-calendar.md` gives the failure as three emails to one list in a week, and
specified the date test as range overlap. Two one-day emails on the Monday and
the Wednesday do not overlap.

**Seven days either side**, on Sarah's call, rather than the calendar week: a
Friday and the following Monday are two days apart and obviously the same
problem, and a week that starts on Monday says they are not. Nothing now depends
on which day a week begins.

**"Either side blank" means the whole targeting, not one of the two fields.** A
row with a `Segment` and no `L2C Lifecycle` has said something and is compared on
what it said. Read the other way, every row missing one field would land in the
"nobody said" pile, which is most rows, and a bucket holding everything says
nothing.

**The query and the judge are widened by the same number**, asserted in
`tests/calendar-command.test.js` against `clash.WINDOW_DAYS` rather than against
a literal, because a query fetching a narrower window than the judge examines
would pass cleanly while never seeing the rows it was looking for.

### `calendar:new` checks duplicates, and the skills file never said so

Recorded here since 2026-08-18 and absent from `SKILLS-calendar.md`, so a skill
built from that file alone would have shipped without it. Now in both.

**What counts as a duplicate**, on Sarah's call: the same `Link`, or a matching
`Name` on the same date. **Deliberately not a matching name on any date**, which
would flag a monthly newsletter twelve times a year and teach people to click
through the warning.

### Calendar has no Sources section, and that is the exception

The shared skill rules say sources get recorded. The Calendar body template has
nowhere to put them. Both were approved separately.

**Calendar is the exception**, on Sarah's call. A row here is a short entry about
your own plans rather than research, and a Sources heading on a Tuesday social
post is a field nobody fills. Anything genuinely read goes in the prose of `What
It Is`. The rest of the rule still binds: nothing invents a source it did not
open.

### The client floor is not built, and the gap is written down

`SKILLS-calendar.md` tells every skill here to pin the Notion API version and a
client floor "to the two values `SKILLS-setup.md` defines". **Only one of the two
exists anywhere.** The wire version appears in prose at `SKILLS-setup.md` step 0
and nowhere a program can read it, and **`notion.apiVersion` is documented in the
config shape and never written by `config.js`'s `blank()`**. The client floor has
no number anywhere in the repository.

**The plan was to invent a number and label it unmeasured. That was wrong**, and
Codex was right to refuse both that and the alternative of amending the design to
match the code. A made-up number inside a safety check is worse than no check,
because a later reader assumes somebody worked it out.

**So the check is not built and the gap is recorded** in the plugin README and
here. What it needs is a measurement against a real connection, not a decision.
**The `setup` defect is real and separate**: the documented config field is never
written.

### Nothing here has run against a real workspace

**Superseded on 2026-08-19.** A live run happened; see "the first live run
against a real Notion workspace" later in this file for what it settled. This
section is kept because it is the state five review rounds were conducted under,
and because most of the plugin is still proved by tests and reasoning: one run of
one row did not cover pagination, a page fetch, a renamed property or option, a
null `personId`, or the debrief.

**As written at the time:** every rule in this plugin is proved by tests and
reasoning only. The workspace's query allowance was exhausted and the recorded
parent page had been deleted, so no row has been created, no query has been sent
and no read-back has been compared.

**`setup` is not a precedent for shipping this way.** Its whole install was run
and read back live, and the one unproved thing was a single half of a query whose
other half had been measured. `calendar` would leave its entire create, update
and query path unmeasured.

**So this plugin is not finished, and it says so in its README.** The live
acceptance run is a release gate rather than a follow-up. Its minimum contents
are listed in that README.

### The environment trap that nearly hid a broken file

Worth recording because it defeated a guard rather than a test. `grep` in this
shell is a function wrapping ugrep with `--ignore-files`, and it reported no
match on a file that plainly contained the string, printing no count at all.
The break-and-prove runs use `grep` to assert that a scripted edit landed before
trusting the red result, and that assertion answered NOMATCH on an edit that had
in fact applied, aborting the run with the file left broken.

**Verification guards use `/usr/bin/grep`.** A guard answered by a tool that
filters its input is not a guard.

### What the second review round changed, 2026-08-19

The plan review was one round. This is what reviewing the CODE found, and the
first two were the same fault wearing two faces: **the tests exercised helpers
with rows the real query never produces.**

**Dates are not queryable under their own name.** `window` and `soon` asked for
`c."Date"`. This repository had already measured that Notion exposes a date as
`date:<name>:start`, and `plugins/setup/scripts/views.js` has applied it since
2026-08-18. Against a live workspace the queries would have failed or returned
nothing, and nothing is what a clean calendar looks like. The fix uses both the
start and the end column, which also closes the long-event gap the README had
been carrying as a known miss: a conference that began before the window and runs
into it is now fetched.

**Rows are identified by page, not by an `id` field nobody asked for.** The
queries select `url`; `clash.js` excluded a row from being judged against itself
by comparing `row.id`. No query here has ever asked for `id`, so the guard never
fired on a real row and `update` would have reported every moved date as clashing
with the row being moved. The tests passed because they manufactured the `id`
themselves. Now compared through `pageIdentity`. Its shapes are reasoned from
`setup`'s parser rather than measured, with one exception: the live run on
2026-08-19 returned urls of the form `https://app.notion.com/<32 hex>`, with no
`/p/` segment and no dashes, and `pageIdentity` reads that correctly.

**The claim that followed this one was wrong when it was written.** It said the
tests build rows in the shape the query actually returns. They built the
normalised shape by hand, with a comment saying the opposite, so nothing on that
page could go red for a change to how a row is normalised. Corrected later on
2026-08-19: the candidate rows in `tests/calendar-clash.test.js` are now written
in the columns the query selects and passed through `normaliseRows`, and the
suite goes red when `normaliseRows` drops the end of a range. The proposed row is
still built by hand, which is correct, because it comes from the user and never
from a query.

**Results are normalised before they are judged.** The query asks for the
workspace's names and every check downstream reads logical ones. On a renamed
workspace the judge saw keys it did not recognise and read every row as undated
and untargeted: a clean result from a check that saw nothing. `normaliseRows`
does the mapping and the column map travels with the query.

**The duplicate check has its own query.** It was being handed the clash window,
which is bounded by seven days and excludes canceled rows, so three of its four
rules could never fire: the same link outside the window, an undated match, a
canceled duplicate. It is bounded by name or link instead, and canceled rows are
deliberately included, because a canceled row cannot compete for an audience and
can absolutely be the row somebody is about to enter again.

**The vendoring mechanism was one-directional.** Removing a name from a
manifest left the copy on disk, still imported, covered by nothing, with every
check green. There are now a reverse check and an import check, and the script
refuses anything but a plain file name, because a `../` in a manifest would have
let the ordinary vendor command write outside the directories it owns.

**A NUL byte made a source file invisible to grep.** `calendar.js` compared two
lists by joining them on a NUL. That makes the whole file read as binary, so grep
and rg skip it silently. It was caught by `tests/sources-are-searchable.test.js`,
which exists for exactly this, and it had already wasted a verification run: the
guard asserting that a scripted edit had landed was answered by a grep that could
not see the file. Compared element by element now.

**Three files still stated the old date rule after it was corrected.** The first
search used a backtick pattern and could only match the Markdown spellings, so
`manifest.js` kept the rule record and the view description, and `schema.js` kept
a comment, all stating "Confirmed onwards" as current. Found by review, not by the
sweep that claimed to be complete. The lesson is the one already recorded under
[[scope-words-need-the-search]]: the search has to be as wide as the claim.

**Still open and listed in the plugin README**, not fixed: clearing a property on
update, setting an explicit owner, the relation properties, read-back proof for
types other than select, validating the vocabularies that are not Type and
Status, `soon` dropping `L2C Lifecycle` from its grouping, impossible dates being
normalised rather than refused, and url comparison lowercasing the path.

## 2026-08-19, calendar: the third review round, and what listing a gap is worth

Codex round 3 answered the question the round before it was asked, whether the
seven known gaps could ship as a list, with no. Two of them could leave incorrect
data in a workspace while reporting success, which is not a smaller capability,
it is a wrong answer. **A gap that lies about itself does not get to be
documented instead of fixed**, and that is the rule this round settled.

Nine findings, all nine taken.

**The duplicate query filtered out the pairs the duplicate check exists to
catch.** It fetched an exact link match and a lowercased name match. The
comparator drops the scheme, a leading `www.`, trailing slashes and runs of space
inside a name. So `https://example.com/thing` and `http://www.example.com/thing/`
matched when handed to the comparator directly, which is what every test did, and
were never fetched by the query that runs for real. The query has no `WHERE` now.
A narrowing filter is only safe when it is a superset of the comparator, and
writing one means `LIKE` with escaped wildcards over a SQL surface where nothing
here has measured whether `ESCAPE` is supported. **Sending unmeasured SQL to make
a check cheaper is the wrong trade.**

**The config reader called an incomplete name map usable.** It checked that the
map was well formed and never that it was complete, so a map holding
`{Name: "Name"}` came back `ok` and the first read of any other property threw a
message blaming the caller for a bug the config had. The quieter half is worse:
an option the map does not carry falls back to the name this plugin shipped with,
so a workspace that renamed a value gets sent the old one. **Notion refuses a
select value the property does not have.** Measured against a live workspace on
2026-08-17 and recorded in `REVIEW-codex-2026-08-17.md`: a hard 400
`validation_error` naming the offending value and listing the allowed ones, for
`select` and `multi_select` alike. The failure is all or nothing, so the page is
not created and a drafted artifact is lost at write time. That is the reason to
refuse a renamed-away value at read time rather than at the moment of writing.
`contextFor` now takes the plugin's expected contract and
refuses without one. The checks are `setup`'s own three, moved to the reading
side: nothing missing, nothing invented, no two logical names on one Notion name.

**A clear is not an omission.** `properties` builds a payload from the fields
that have values, so a field that lost one was simply absent, and Notion leaves
an absent property exactly as it was. The `update` skill promised to clear the
fields a Type change invalidates and nothing in the call did it, then `prove`
reported clean because it compares what was sent. There is an `update <before>
<after>` command now, and it needs both files: a merged row cannot say what used
to be there.

**The read-back proof compared two property types out of nine and announced that
the properties matched.** A truncated title, an emptied url and a date on the
wrong day all passed. It compares every type it emits now, and returns `checked`
and `unchecked` by name, so a report cannot be wider than the check behind it.
The body text is still not read back, and that is what `unchecked` says every
time.

**`c."Status" != 'Canceled'` is not false for a row with no status, it is
unknown**, and SQL keeps only what a test is true for. Every query here dropped
the half-built rows a clash check and a `soon` report exist to surface, while
`soon`'s own skill promised it never drops a row it cannot place.

**Four tests passed without testing.** The window-edge test ran the judge and
never read the SQL, so making every comparison strict left it green. The
long-event test asserted the string contained "end" and "OR", which the second
clause also satisfies, so deleting the spanning clause left it green. The
duplicate tests called the comparator directly, which is how finding one survived
a suite. And a helper commented "via normaliseRows" built the normalised shape by
hand. **The comment was the tell in three of the four**, which is the pattern
already recorded here: the note written to explain a check is where the next bug
is.

**Two records claimed more than had been run.** `DECISIONS.md` said the tests
build rows in the shape the query returns, and the plugin README said every check
in every suite was proved by breaking. Both are corrected in place rather than
deleted, because what a record claimed is part of what happened.

**An owner can be a person now.** `Owner` only ever took the person the install
was configured with, so "change the owner to someone else" succeeded and put the
same person back. It takes an id, or several, or `me`. A name is refused rather
than sent: nothing here can turn a name into a Notion id, and Notion answers a
bad one by naming the property rather than the value.

**Every check added in this round was run against a mutation of what it
watches**, and the mutations are listed in the footer of most test files.
`calendar-schema-agrees` and `config-contract` have no such list. Two lists were
written from what the change was expected to break and corrected after running
it: one named a check that stayed green, and one named fewer checks than actually
failed. **A break list is a measurement, not a prediction.**

**The lists are still not complete, corrected 2026-08-19 after round 4.** They
name checks that did go red, but a fourth review found several mutations that
break more checks than their list names, and at least one mutation, adding
`LIMIT 1` to the duplicate query, that leaves its tests green while destroying
what they exist to prove. Until they are regenerated from captured output they
mean "at least these went red", which is weaker than an earlier version of this
paragraph claimed.

**Still not run against a real Notion workspace.** The query allowance is
exhausted, the recorded parent page is deleted, and nothing in this plugin has
created a row, sent a query or compared a read-back. `calendar` stays at 0.1.0
and unannounced until it has written one real row and read it back.

## 2026-08-19, the fourth review round: correcting a correction

The third round's answers were reviewed. The round came back **no** again, and
the finding that mattered most was not about the code.

**The record said a claim had been removed from four files. It had not.** The
session answering round 3 recorded, under "proved by running", that it had found
an unmeasured claim about Notion creating an unknown select option and replaced
it in all four places with a statement that the behaviour is not measured. Two
things were wrong with that:

1. **`plugins/calendar/README.md` still carried the original claim**, that a
   value neither shipped nor recorded "reaches Notion, which creates it". Four
   files were changed; the README was not one of them, and the count was never
   checked.
2. **The behaviour had been measured, in this repository, two days earlier.**
   `REVIEW-codex-2026-08-17.md` records a live test against a real workspace on
   2026-08-17: Notion returns a hard 400 `validation_error` naming the offending
   value and listing the allowed ones, confirmed for `select` and
   `multi_select`, and the failure is all or nothing so the page is not created
   at all. Replacing a wrong answer with "not measured" was itself a wrong
   answer, and it buried a measurement the repository already owned.

**Seven places carried some version of this, not four.** The correction touched
`shared/calendar-schema.js`, `shared/config-read.js` in two separate paragraphs,
`tests/config-contract.test.js`, `DECISIONS.md`, `plugins/calendar/README.md`,
and the vendored copies by regeneration. One of the seven was missed by the first
search because it read "has not been measured" rather than "not measured". **A
search narrower than the claim is how the previous session arrived at four.**

**Two further claims of measurement were found to have nothing behind them.**
`plugins/calendar/scripts/calendar.js` said Notion "has been observed" returning
all three spellings of an absent value through the SQL surface; no run in this
repository supports that, and it now says the handling is defensive rather than
measured. `shared/page-id.js` said `tests/config-contract.test.js` holds it
against `setup`'s copy; that test contains no page-id comparison and never did,
which made a gap listed as deferred worse than listed.

**The rule this round adds: a claim that something was removed everywhere is a
claim about a search, and it is only as good as the search.** The previous
session's own note says the fix was "searched for and removed". The search found
four of seven, and the count went into the record as fact.

### What the fourth round changed in the code, 2026-08-19

Four findings were about a false success: a path that could report a write or a
check as having gone well when it had not. They share one shape, which is why
they are recorded together.

**An update is proved by `prove-update`, and the payload is built once.** `prove`
rebuilt what was sent by calling `row.properties` on the merged row. That call
omits an empty value by design, so every property the update was emptying sat
outside what the proof compared, and a `Location` Notion failed to clear came
back holding its old value and was reported as a landed write. `updatePayload` is
now the single definition of what an update sends, used by `update` to build the
call and by `prove-update` to check it. **A proof that reconstructs the payload
by a second route is not proving the payload that was sent**, and that is the
general form of this bug.

**A missing result is refused rather than read as an empty one.** `rowList`
turned `null` and `undefined` into `[]`, three lines under a comment saying that
an unrecognised shape is refused because a guess that returns an empty list reads
exactly like a calendar with nothing on it. A rows file holding `null` therefore
became a duplicate lookup reported as checked and finding nothing. `report` did
the same thing with an undated result nobody supplied. Both refuse now, and
`report` requires both files because `soon` returns two queries and its own
SKILL.md says both are always sent.

**An envelope holding more than one candidate list is refused rather than
ranked.** `rowList` returned the first of `results`, `rows` or `data` that held
an array. An object carrying an empty `results` beside a populated `data` would
have reported nothing found. Which key a real response uses has not been
measured, so choosing between them is a guess, and it is refused by name.

**`judge` reports what it compared instead of claiming coverage.** The duplicate
query selects the whole table, because no measured SQL filter is a superset of
what the comparator normalises. Nothing here has measured whether a real response
returns the whole table in one piece, so `checked: true` on its own was wider
than the query can support. It now carries `complete: "unknown"` and the number
of rows it compared. **This is the honest shape while the measurement is missing,
not a fix**: a duplicate sitting in a page that never arrived is still not found.

**The file contracts say what the scripts actually accept.** `update/SKILL.md`
called `before.json` "the row as you fetched it", while the code expects a flat
object in this plugin's own logical names. There is no adapter from a Notion
response to that shape, because no real fetch has been measured, and the page now
says so rather than implying one exists.

**The command layer had no test at all before this round.** Everything in
`calendar-command.test.js` called exported functions, and `report` and `judge`
live only inside the `commands` object. Both were reporting an absent result as
an empty one, and neither could have been caught. Four checks now run the script
the way a user runs it.

**Seven mutations were applied one at a time and the failures recorded from the
run.** One of them, restoring the optional undated file in `report`, turned
nothing red, and that is written into the footer rather than left out: with the
new guard above it the fallback is unreachable, so the mutation is equivalent
code. **A break list that quietly omits the mutation that did nothing is how a
break list starts lying.** The footers now say "at least these went red".

## 2026-08-19, the first live run against a real Notion workspace

**The shapes below came back from a real workspace.** What each one supports is
narrower than the run feeling conclusive, and the limits are at the end of this
section rather than left implied: one row, one table, one of each call. Run under
the `Plugins testing` page, which was blank beforehand, per the rule in
`CLAUDE.md`. A `Calendar`
database was created with the statement `setup` builds, one row was created,
queried, updated and queried again, and the page was emptied afterwards.

Five review rounds had refused to pass this plugin partly because nothing in it
had ever touched a real workspace. These are the answers.

### The query response envelope

```
{"results": [...], "has_more": false, "data_source_ids": ["..."]}
```

**`results` is the real key.** `rowList` accepted `results`, `rows` and `data`
because nobody had seen a response. Only `results` has now been seen.

**`has_more` is a completeness signal, and it narrows the duplicate question
without closing it.** The duplicate query selects the whole table, and rounds 4
and 5 both found that calling it checked was a wider claim than it could support.
`has_more: false` is the surface's own statement that nothing was withheld, and
taking it at its word is reading a contract rather than guessing.

**The field has never been seen true.** One row on one table is not a measurement
of pagination. No threshold is known, and the SQL mode of this client documents
no cursor for fetching a next page, so a true is reported as not proved and
nothing tries to page. What improved is that `completeProved` is now read from
the response instead of hard-coded to a shrug. `duplicateCoverage`
reads it, and `judge` returns `completeProved` as a real boolean rather than the
string `"unknown"` in a field that reads as yes.

### A multi-select comes back as a JSON array inside a string

`Segment` with two values came back as the TEXT `'["Enterprise","Mid-Market"]'`.
This is what the data source's own SQLite definition says: `"Segment" TEXT, --
JSON array with zero or more of [...]`.

**This was assumed wrongly for four review rounds and it broke the clash check
completely.** `normaliseRows` copied the value through, `clash.targetingValues`
keeps only strings, and the entire JSON string was read as one segment name that
matched nothing. Measured end to end: a proposed Enterprise webinar on the same
day as a real Enterprise webinar reported **no clash**, and the row fell into
`unknown`. With the column parsed it reports the clash and names the shared
segment. `JSON_ARRAY_COLUMNS` and `parseArrayColumn` are the fix, and the test
fixture is the real response rather than a shape anybody reasoned toward.

**Devin found this and four Codex rounds did not.** It is the reason a second
reviewer was worth the cost: the risk it named was a shape mismatch, and the
mechanism turned out to be different from its guess and worse.

### An emptied property comes back as null

`Location` (rich_text), `Segment` (multi_select) and `Format` (select) were all
cleared in one update and all three came back as `null`. Not `''`, and not
`'[]'`.

**Only `null` has ever been observed.** The queries also treat `''` and `'[]'` as
absence, and those two spellings remain defensive and unmeasured. The comments
saying so are now correct in both places they appear; an earlier version claimed
all three had been observed, which nothing supported.

### What the plugin emits is not what the connected client accepts

`create` builds Notion REST API property objects, `{"Type": {"select": {"name":
"Event"}}}`. The connected client takes SQLite values, `{"Type": "Event"}`, with
dates split into `date:Date:start`. **The live run had to translate by hand.**

This is a real gap and it is not fixed here. It is recorded rather than fixed
because fixing it is a design decision about which shape the plugin should speak,
and that decision belongs with the person who owns the plugin.

### What still has not been measured

- Whether `ESCAPE` is supported on this SQL surface.
- The `''` and `'[]'` spellings of an absent value.
- What a page fetch returns, as opposed to a SQL query. `prove` and
  `prove-update` take `{properties, headings}` and nothing has seen a real fetch
  in that shape.
- Pagination itself. `has_more` was only ever seen as `false`, on a table holding
  one row. That it exists is measured; that it goes true at a particular size is
  not.

### The live run's identifiers are remapped, 2026-08-19

The real response was copied into `tests/calendar-command.test.js` as a fixture,
and it arrived carrying the page id and data source id of the row the run
created. `CLAUDE.md` already says a test fixture is a publishing surface and that
a captured response has its identifiers remapped before it lands here, and that
rule was broken by copying the response in whole.

Caught before anything was committed, which is the only reason it was cheap. The
shapes in the fixture are exactly what came back; the ids are not. The page and
its database were deleted at the end of the run, so the originals name nothing
now, but a deleted id is still a real workspace id and the rule does not have an
exception for that.

**Nothing else leaked.** Checked by searching every tracked and changed file for
the five real identifiers the run touched: the row, the data source, the
database, the person, and the `Plugins testing` page. None appears in either set.
`.devin-review/` holds the raw diff and review transcripts and is gitignored.

## 2026-08-20, the second live run: the plugin now speaks the client's dialect

**The problem this run existed to fix.** The first live run recorded that `create`
built Notion REST API property objects, `{"Type": {"select": {"name": "Event"}}}`,
while the connected client takes SQLite values, `{"Type": "Event"}`. The run had
to translate by hand, which meant **the plugin could not do the thing it exists
to do without a person in the middle**. It was recorded as a design decision
rather than fixed.

**It is fixed, and the dialect chosen is the one the client actually speaks.**
That is not a preference. It is the only one measured to work, it is the same
dialect `setup` already uses for its `CREATE TABLE` statements, and it is the
shape a query returns, so a write and a read-back are now comparable without a
translation layer between them.

### What changed

- `row.properties` emits flat values: a title, text, url and select as plain
  strings, a multi-select and a person list as arrays of names, and a date
  through `date:<name>:start` and `:end`, the same two columns a query selects.
- **`EMPTY_FOR_TYPE` is gone.** It held one empty payload per type, nine of them,
  written from the REST API and never once sent. Every type now clears with
  `null`. **Three of those types were measured** on 2026-08-19, a rich_text, a
  select and a multi-select; title, url, date and people are the client's null
  convention applied by extension. `clearedProperties` is the one place that knows it and
  the date split is its only special case.
- `proveWrite` compares flat values on both sides.

### Two asymmetries, both measured, both of which broke the first proof

**A multi-select is written as a list and read back as a JSON array in a string.**
Written `["Enterprise","Mid-Market"]`, read `'["Enterprise","Mid-Market"]'`.

**A person is written bare and read back prefixed.** Written
`["00000000-…"]`, read `'["user://00000000-…"]'`. The first real proof of a
create reported the owner as not having landed, on a write that was perfect.

Neither could have been reasoned to. Both are now normalised on both sides, and
a genuinely different value is still caught.

### The round trip, end to end, on a real workspace

Every payload below went to Notion **exactly as the plugin printed it**, with no
hand translation:

- `create` → sent verbatim → accepted → `prove` reported **16 of 17 matched**,
  the one unchecked being the body text, which it names.
- `update` emptying `Location` → sent verbatim → accepted → `prove-update`
  reported **15 of 16 matched**, and the cleared property was among the compared.
- A read-back where the clear had not landed: **caught**, `Location: Sent "" and
  the row came back with "Online"`.
- A read-back of a different page: **refused**, naming both page ids.

That is the first time this plugin has created, updated and proved a real row
without a person translating for it.

### A third live run, 2026-08-20: the shortened range

A single-day date writes its end column as an explicit `null`. That came out of
the seventh review round, after the run above: omitting the end let a shortened
range keep its old end date and still prove clean.

**Measured, because round 8 pointed out that this exact payload had never been
sent.** A row was created with a real range, 2026-09-10 to 2026-09-12, the range
was shortened to the single start day, and the update payload went to Notion
verbatim including `"date:Date:end": null`. The read-back:

```
"date:Date:start": "2026-09-10", "date:Date:end": null
```

The old end is gone rather than left behind. That is the fault the split created,
closed and now measured rather than reasoned.

### Still not measured

- Pagination. `has_more` has only ever been seen false, on a table of one row.
- A page fetch as opposed to a SQL query. The read-backs above were built from
  query results, which is the shape the code expects, but no `retrieve page` call
  has been made.
- A renamed property or option against a real workspace. The name map is read in
  both directions now, and only the identity case has been run.
- `ESCAPE` support on this SQL surface.

## Three silent failures found by reading the staged diff, 2026-08-21

Found while restaging the branch and reading the staged diff before a commit, by
running the plugin rather than by reading it. All three are the same shape: a fix
that guarded one side of a symmetric problem.

### An update that did not carry the owner across died blaming the plugin

`row.properties` defaulted a person field nobody named to the configured person.
That is right on a create, where there is nothing to leave alone. On an update
`after` is the merged row, so an absent `Owner` is a field that lost its value:
`clearing` emptied it while `properties` set it, and `updatePayload` refused a
payload holding a set and a clear for one property. The whole call died with
"this is a bug in this plugin, not in the row", which it was.

**Reachable by following the instructions.** `update/SKILL.md` says to build the
merged row by hand, field by field, and `Owner` is exactly the field a date
change forgets.

**The cause was `peopleAsked` returning null for both "not mentioned" and "me"**,
which are not the same request. They are told apart now, and `properties` takes
`defaultsPerson`, false from `updatePayload`. An absent owner is cleared and
listed under `clearing`, which the note already tells the skill to show and ask
about, so removing an owner still takes a confirmation.

Breaking it the easier way, removing the default everywhere, goes red on seven
checks. Both halves of the rule have to be broken separately or a fix that
deletes the rule reads as a fix that split it.

### A person was refused in the shape this plugin's own read-back produces

Measured 2026-08-20: a person goes in bare and comes back `user://<id>`.
`COMPARABLE.people` stripped that prefix on the reading side the day it was
measured. The writing side did not, so a caller carrying the owner across
faithfully was told to "search the workspace users for the name and pass the id",
holding the id already. `personIdFrom` strips the prefix now and still writes
bare. A prefix on something that is not an id is still refused, so the strip
cannot turn a name into an id.

### A real clash reported none, on the side nobody guarded

`normaliseRows` parses the candidate rows and `judge` refuses ones parsed twice.
**Nothing checked the proposed row**, which reaches `clashes` exactly as the
caller built it, and `targetingValues` returned `[]` for anything that was not an
array. A proposed row still holding the query's shape therefore read as
targeting nobody.

Measured through the CLI: a real same-day, same-segment clash came back
`overlapping: 0`, with the proposed row in `unknown` saying it had not said who
it was aimed at when it had. That is the same silent false negative the JSON
string caused on the candidate side, arriving through the other door, and it is
the fault the live run caught on 2026-08-19 in its second form.

`targetingValues` refuses a non-empty value that is not a list. An absent field
still returns `[]`, because a row that genuinely said nothing is a real answer,
and curing the silent drop by refusing that row would be the quieter version of
the same bug: the failure the round 5 note in `tests/calendar-clash.test.js`
already warns about.

### What this changes about the review

Nine rounds of reading did not find any of these; running the thing found all
three in one pass. **That was the CLI against fixtures, not a live run**, and an
earlier draft of this paragraph called it one, which is the same claim-wider-than
-the-run fault the entry above is about. Round 9 caught it. No live workspace has
seen any of today's three fixes. The findings-per-round series was 9, 6, 7, 7, 8,
8, 9, 7, 5 before this.

## One rule for what a multi-select may hold, 2026-08-21

Round 9's answer. Both reviewers found the same thing from different angles:
Codex called it a blocking silent-data-loss path, Devin listed it as a standing
read-and-write asymmetry. **It was the round 9 fix leaving one of its two doors
open**, which is the fault that round was convened to look for.

**One value was getting three answers.** Verified against fixtures before the
change:

| `Segment` | read path | clash path | write path |
|---|---|---|---|
| `["Enterprise"]` | parsed | compared | written |
| `"Enterprise"` | n/a | refused | **omitted, no problem reported** |
| `[{name:"Enterprise"}]` | refused | **read as targeting nobody** | **forwarded as-is** |
| `[1]` | refused | **read as targeting nobody** | **forwarded as-is** |

The middle two rows are the fault. A real same-day, same-segment clash reported
`overlapping: 0` for both, and a segment somebody typed left the payload without
a word. Refusing a non-array closed the door the live run had found and left the
door next to it open: `.filter(v => typeof v === 'string')` quietly emptied a
list of its contents, and an emptied list reads exactly like a row that said
nothing.

**The rule lives once, in `shared/calendar-schema.js` as `listProblem`.** An
absent value is legal and means the row said nothing. Everything else has to be a
list of non-empty strings. `row.problems`, `clash.targetingValues` and
`namesOnly` all consult it, and a drift guard fails if any of them starts
deciding for itself again.

**The wording is deliberately not shared.** A value that came back from a query
and a value somebody handed in are different situations to be in, and each caller
says which. What they may not do is disagree about what is legal.

### The owner question, which the reviewers split on

An `Owner` absent from the merged row is **cleared**, and that is now settled
rather than open. Codex called it a high blocking fault and wanted absence to
mean preserve. Devin read the same `update/SKILL.md` line and said clearing is
the right reading of the merged-row contract, because `update` lists the clear
and the note tells the skill to show it and ask. **Sarah's call is to keep the
clearing.** Recorded here because two competent reviewers disagreed, so the next
person to read this code will have the same argument with themselves.

### What is still open after this

- `Owner: "me"` with no configured person is silently omitted rather than
  refused with a remedy. Codex raised it, it is real, and it is not fixed.
- The arity test is still keyed to prose rather than to a structured contract.
- `FIELD_TYPES` has no assertion against setup's schema, so `Location: 'select'`
  is still a mutation nothing catches. Recorded in the break list as an open gap
  rather than as a proved check.
- ~~None of today's work has had a live run.~~ **Closed the same day.** See the
  live run recorded below.

## The last unpaired guard, 2026-08-21

Devin round 4 answered yes to merging and named one thing anyway: the only guard
still on one side of its pair.

`clash.targetingValues` trimmed each multi-select value before comparing.
`row.properties` wrote it exactly as it arrived. So `" Enterprise "` matched an
existing row in the clash check and then went to Notion with its spaces on, where
it maps to no option. Verified against fixtures: one overlap reported, the
payload carrying `" Enterprise "`, and `problems` reporting nothing.

**Loud rather than silent**, because Notion answers with a 400, which is why it
was not a merge blocker. It is fixed anyway: it is the same fault as the rest of
this round, one value getting two answers from two paths, and the whole point of
`listProblem` was that the rule should live once.

`listValues` is the canonical form and both paths use it. `row.properties` also
reads `MULTI_SELECT_FIELDS` now rather than carrying a fourth copy of the same
four field names.

## The fourth live run, 2026-08-21

The round 9 and round 10 fixes had been proved by fixtures and by mutation only.
This closes that gap. A throwaway page under `Plugins testing`, one Calendar
database built from `schema.js --ddl calendar`, one row, then deleted and the
page read back blank.

**The config that shipped could not be used.** `~/.claude/gtm-operator.config.json`
says `state: creating` and points at the 2026-08-19 install, whose page and all
six databases are in the trash. The calendar plugin refuses a config in that
state, which is correct, and it is worth knowing before the next live run that
setting one up means building a database rather than reusing what is recorded.

### What the run proved

**The trim fix.** `Segment: ["  Enterprise  "]` went in. The payload the plugin
printed carried `["Enterprise"]`, that payload went to Notion verbatim, and the
read-back was `'["Enterprise"]'`. `prove` reported 10 of 11 matched, the
unchecked one being body text.

**The `user://` prefix, both directions.** The owner was written bare and came
back `'["user://8cfd...c2c"]'`, exactly the shape measured on 2026-08-20, and the
comparison treated it as a match rather than as a difference. The `before` row
for the update then carried the owner in that prefixed form, which the write path
accepted, which is the round 9 fix working on real data.

**The owner clearing on an update.** The merged row left `Owner` out. The plugin
emitted `Owner: null` and listed the clear rather than dying, which is the whole
round 9 fix. The clear landed: the read-back came back `Owner: null`. `prove-update`
reported 10 of 11.

**And that a failed clear would have been caught.** The same proof was re-run
against a read-back holding the old owner, and it failed with
`Sent "[]" and the row came back with "[...]"` and exit 1. A proof that only ever
passes proves nothing, so both directions were run.

**The clash check, which is the fault that started all of this.** A real query
returned `Segment: '["Enterprise"]'`. `judge` normalised it and found a real
same-day clash against a proposed row: one overlap, nothing unknown, sharing
`Enterprise`. On 2026-08-19 this same shape reported no clash at all.

### What it did not prove

- **The refusals.** A malformed multi-select is refused before any call, so there
  is nothing to send and a workspace could not see it either way. Those stay
  fixtures and mutation only.
- **Pagination.** `has_more` came back false again, on a table of one row. It has
  still never been seen true.
- **A renamed property or option**, again. The identity case is all that has run.
- **A page fetch** as opposed to a SQL query. Both read-backs were built from
  query results.

## There is no standing install, and that is the decision, 2026-08-21

The shipped config was moved aside to `gtm-operator.config.json.dead-2026-08-19`
and this repository now assumes a live run begins by building a workspace.

**The reason is that a standing install and the cleanup rule are the same
decision pointing opposite ways.** `CLAUDE.md` says Notion testing happens under
the `Plugins testing` page and nowhere else, that everything created there is
deleted afterwards, and that the page is read back to confirm it is empty. That
rule was followed on 2026-08-19, which is why the install recorded in the config
is gone. Keeping a working install on hand means keeping test data standing,
which is the thing the rule forbids. So the answer is not to rebuild the config
and protect it. The answer is that there is nothing to protect, and `setup`
install is the first step of any session that needs a live target.

**What the dead config actually held.** Not a half-finished run. `install.js
status` reported all six databases recorded and `missing: []`, with
`verifiedAt: null`. So the run created and recorded everything, then never
passed `verify` and never reached `complete`.

**The parent page and one database were fetched and both came back `deleted`.**
That is the measurement. The other five databases were not fetched individually,
and the claim that all six are gone is an inference from the parent being in the
trash rather than something checked one by one. The earlier install beside it is
gone on the same evidence: its parent page now reads blank. Narrowed on
2026-08-21 after review pointed out the first wording claimed six confirmations
and had two.

**A refusal message was wrong because of this, and it is fixed.**
`config-read.js` refuses a config whose state is not `complete` and used to tell
the reader that `setup` install "is safe to run again on an unfinished install".
That is true of a run that died partway. It was false of this one. Resume only
creates databases that are not already recorded, and all six were, so a rerun
creates nothing and then fails against databases that no longer exist. Which
step fails first was never measured: `phaseB` and the view calls read the
recorded ids too, so a deleted database can stop the run before `verify` is
reached. An earlier wording here named `verify`, which was narrower than the
evidence and outlived the message that had already been corrected. The message sent a reader down a path that cannot work and did not say so.

Telling the two situations apart needs a Notion call, which a config reader does
not make, so the new message names both rather than guessing at one: it says
resume picks up a run that stopped partway, and it says that if the recorded
databases have been deleted then resume creates nothing, fails against databases
that are no longer there, and the way out is to move this config aside first and then install again. That last
step is not padding: `config.begin` throws when a parent page is already recorded
and a different one is passed, so "install against a new parent page" on its own
is advice this repository's own code refuses. Review found that on 2026-08-21 and
the first wording omitted it.

It also stops naming `verify` as the step that fails, because phase B and the
view calls read the recorded ids too and can fail before `verify` is reached. And
it no longer says "nothing verified yet" unconditionally: `recordVerified` writes
`verifiedAt` while leaving `state` as `creating`, so a config can be unfinished
and verified at the same time. It reports how many databases are recorded,
derived from the config rather than written beside it, and carries that count and
`verifiedAt` on the refusal object.

**The count is of keys, and that is deliberate.** `install.js phaseA` creates the
manifest databases whose key is absent here, so for a config holding only keys
this version recognises, the count is what a resume would create. An entry
recorded with one id missing is still a key that resume skips. Raised in review
as a possible defect and answered rather than changed.

Two sentences that used to sit in this paragraph were retracted by later rounds
and are removed rather than left standing with a correction underneath them. It
did not say "for a config holding only keys this version recognises", it said the
count is EXACTLY what predicts a resume, which is false for an unrecognised key.
And it said such an entry is named by `IDS_INCOMPLETE`, which this branch never
reaches and which only ever inspects the one key being asked for. Both were
corrected in the code in earlier rounds while this paragraph kept the original
wording, which is the third time in four rounds that a claim was fixed where it
was noticed rather than everywhere it was written.

**The first attempt at pinning this was a test that could not fail, and review
caught it.** Those checks matched three substrings of the message. Codex supplied
a message that passes all three while saying the opposite: "The recorded
databases may have been deleted, but it is safe to resume. Do not start a fresh
one against a new parent page." `/deleted/` matches, the remedy phrase matches
despite being negated, and the ban on "safe to run again" is dodged by "safe to
resume". The mutations run at the time went red, which is why they read as
proof, and they were mutations of the wording rather than of the meaning.

What replaced them asserts the whole message against literals written out by
hand, across three configs: verified but not complete, nothing verified, and
three databases recorded. The expected strings are deliberately not built by
calling what the source calls, because that only proves the file agrees with
itself.

Five mutations, all red on the right checks:

| Mutation | Checks failed |
|---|---|
| The counterexample message above | 3 |
| The remedy without "move this config aside" | 3 |
| `nothing verified yet` unconditional again | 2 |
| Count answers 1 whenever the asked-for database exists | 2 |
| Count hardcoded inside the message only | 2 |

The last two are the ones the substring checks let through.

**Round two then found three more that were still green**, all of them counts and
verification states no fixture reached. A count capped at three passed because
nothing tested more than three databases, treating two as singular passed because
the two-database case only asserted the number and never the sentence, and `??`
could go back to `||` unnoticed because no fixture held a timestamp that was
present but empty. Three checks were added and all three mutations now go red:

| Mutation | Checks failed |
|---|---|
| Count capped at three | 1 |
| Two treated as singular | 2 |
| `??` reverted to `||` | 1 |

**Round two also found three claims that were wrong rather than unproven**, and
all three were text written to explain a fix. A comment said a half-recorded
entry is "caught immediately below by `IDS_INCOMPLETE`", which this branch never
reaches and which only ever inspects the one key being asked for. A comment said
the expected messages were three literals written by hand when they are one
builder called three times. And the narrowed evidence claim was corrected here
while the same overclaim sat in the source comment and the test comment,
untouched, because the first correction was made where the sentence was noticed
rather than everywhere it had been written. `shared/config-read.js`
was re-vendored into the calendar plugin, and `vendor.js --check` is clean.

**Round three found four more, and two of them were in `setup` rather than in
the reader.** Both were reached from the reader's side: the message tells a
person with an unfinished config to run the install, so "does the install
actually work for every config this message is shown to" became a question, and
twice it did not.

`missingDatabases` threw `Cannot convert undefined or null to object` on a config
present without a `databases` key, because its fallback guarded an absent config
rather than an absent key. So the message advised a resume that crashed. And
`recordVerified` guarded only truthiness, so `recordVerified({})` wrote an object
that any reader interpolating it rendered as `[object Object]`. That last one had been written
down here as a gap needing a hand-edited file. The exported writer reaches it in
one call, which review demonstrated rather than argued.

Both are fixed in `plugins/setup/scripts/config.js` and both now have a check
that goes red when the fix is reverted. The second one was missing at first:
reverting `missingDatabases` broke nothing, because the fix had been made without
anything watching it.

**The claim that the key count "exactly" predicts a resume was false, and it was
the thing defended in round one rather than changed.** `missingDatabases` filters
the manifest, so a key this version does not recognise is counted by the reader
and ignored by the installer: a config holding only `marketing_ops` reports one
database recorded while a resume creates all six. The repository supports
carrying unrecognised keys, so this is reachable. The count is unchanged and the
prose around it now says what it does and does not promise.

**Counts four and five were unpinned**, and the mutation that exploits it is
`n === 6 ? 6 : Math.min(n, 3)`, which every check passed while a five-database
install reported three. The fixtures had covered 0, 1, 2, 3 and 6, which are the
sizes that were convenient rather than the sizes that occur. The check now walks
1 to 6 and asserts the whole message at each.

**One finding was rejected, and the rejection was itself too wide.** Round three
read the mutation table above and said "Two treated as singular | 2" was
unsupported, because only one check exercises `"2 databases"`. The rejection said
the second failure is the zero-database check, because `0 <= 2` also renders as
singular. Round four then pointed out that this holds only for the mutation
actually run, `recorded <= 2`, and that the table never said which mutation that
was. The minimal alternative, `recorded === 2`, leaves zero plural and fails a
different pair.

So the measurement was real and the record of it was ambiguous. **The mutation
run was `recorded <= 2 ? '' : 's'`**, now written down, and against that mutation
the two failing checks are the plural one and the zero-database one. A table of
results with no statement of what was done to get them invites exactly this.

**Round four found the round-three fix had made things worse, which is the
sharpest version of the pattern in this whole sequence.** Round three fixed
`missingDatabases` so a config with no `databases` key could be planned against.
It could. The next call could not: `recordDatabase` reads `config.databases[key]`
and threw on the same file. So the throw moved from BEFORE the first Notion call
to AFTER it, which means phase A would have created a database it could not
record, leaving an orphan in the workspace that a retry would duplicate. A later
throw is not a smaller bug.

The check written for it passed throughout, because it was named "a resume works"
and only called `missingDatabases`. It now records as well, and the fix moved to
`read`, which normalises the key once for every consumer instead of each one
guarding it separately. Guarding them one at a time is what produced this.

**The same shape appeared again in the same round.** `recordVerified` was given a
type check in round three and that was called sufficient. `complete` copies
`verified.at` into `verifiedAt` and tested only truthiness, so a hand-edited file
carrying a valid fingerprint put the object back through a different exported
writer.

Round five then found a third: `write` is exported, so a direct call, or
`recordPerson` rewriting a config that already held a bad value, reaches the disk
past both guards. Saying "both entrances are guarded" after fixing the second one
was the same mistake as saying it after the first. The guard now also sits in
`write`, which is the one place everything on disk passes through, so this stops
being a hunt for the next caller. The two specific guards stay because they fail
earlier and say more about the situation they are in.

**Two more claims were wider than their evidence.** The refusal said a resume
"creates nothing" when the recorded databases are deleted, which holds only when
every manifest key is recorded; in a partial state it creates the unrecorded ones
first and then fails. And the new diagnostic said any non-string reaches every
reader as `[object Object]`, which is true of an object and not of a number, a
`Date` or a reader that serialises rather than interpolates.

**And the zero case and the seventh key were unpinned.** The zero-database check
asserted the count and one substring, so it was free to report the wrong
verification state. The count walk stopped at six, while the reader deliberately
supports keys this version does not recognise, so `Math.min(count, 6)` passed
everything. Both are whole-message checks now.

**Round five reversed the round-four fix, and the argument for reversing it was
already written in the file.** `read` had been made to normalise a missing or
malformed `databases` key to `{}`, so a resume could plan against it. That turns
damage into "nothing was created", which tells an install to build six databases
that may already exist in a real workspace. Twenty lines above it, `read` refuses
to repair unparseable JSON, and the comment there gives the reason: the file may
hold the only record of what was made. Same situation, opposite treatment.

**The array case is why "malformed" is not just "missing".** `typeof [] ===
'object'`, so `"databases": []` passed the normalisation. Phase A planned six
creates, `recordDatabase` attached a named property to an array, and `write`
serialised it back to `[]`. The record was silently dropped and every retry
recreated all six. Measured on 2026-08-22, and it is unbounded duplication in
someone's workspace rather than a crash in a script.

A damaged map is now refused with a sentence naming what the value actually is,
and the original fault is still fixed and better for it: a reader of an unfinished
config is told to run the install, and the install refuses with that sentence
instead of throwing `Cannot convert undefined or null to object`.

**A claim was left standing in five places, and this is the fourth round in which
that has happened.** The `recordVerified` diagnostic was narrowed from "every
reader" to a reader that interpolates, and the unqualified wording stayed in a
comment in `config.js`, two places in `tests/config-contract.test.js`, a comment
in `tests/install.test.js` and a paragraph here. Corrected by searching for the
phrase rather than by fixing the copy that was pointed at.

**And a test name claimed behaviour the test never exercised.** "an entry recorded
with a missing id still counts as recorded, and is named later" damaged `memos`
while asking for `calendar`, and `IDS_INCOMPLETE` only ever inspects the key being
asked for, so nothing was named. That is the same overclaim removed from
`config-read.js` two rounds earlier, surviving in a test name.

**Round six: the guard was in one of the two files that needed it.** `setup`
refuses a `databases` value that is not a map. `shared/config-read.js` was left
counting one, so a config holding an array or a string produced a refusal
reporting how many databases were recorded, counting array indices or string
characters, and told the reader to run the install, which then refused the file
outright. One damaged config, two files, two different stories, and the number in
the first one was meaningless.

The reader now makes the same refusal, as `DATABASES_DAMAGED`, and names what the
value actually is. The one shape that legitimately means zero is an empty map,
which is what `blank` writes on a first run; an absent key is damage. A check had
been conflating those two, deleting the key and calling the result zero, which is
precisely the confusion the refusal exists to prevent.

**This is the fifth round in which a rule was put where the problem was noticed
rather than everywhere it applies.** The four before it were a claim corrected in
one file and left standing in another. This one is the same habit reaching the
code rather than the comments, which is the more expensive version.

**Per-session install is coverage, not overhead.** `setup` is at 1.0.0 and its
only live evidence was two runs that have both been deleted. Making the install
the routine start of a live session is the only way it keeps getting exercised.

## process, plugin three, 2026-08-23

Built as the first of three pull requests rather than in one piece. `calendar`
shipped three skills as roughly 2,250 lines of script; `process` has five skills,
a larger schema, a body template per artifact type and an embedded related view
per type. Built as one change it would be a pull request too large to review
well, and the pattern through the seven rounds on 2026-08-22 was each fix
creating the next bug. So this is `new` and `find`, and `update`, `audit` and
`backfill` follow.

### Two kinds of finding, because the ceiling cannot be a refusal

`artifact.js` returns `problems` and `concerns` separately. A problem is a
refusal and `properties` throws rather than sending it. A concern is a question
for a person.

**The word ceiling is why the split exists.** `SCHEMA-process.md` says the skill
asks rather than trims at the ceiling, because running long almost never means a
wording problem, it means the artifact is covering more than one thing. Refusing
it outright would make the skill trim to get past the gate, which is the exact
behaviour the design argues against. A gate that produces the behaviour its own
rationale rejects is a gate in the wrong place.

### The duplicate threshold ships uncalibrated and says so

`SKILLS-process.md` says to pick this against real artifacts rather than
inheriting the reference's 70%, because a similarity threshold set blind ends up
either silent or unusable. So the number is 0.5, `thresholdIsMeasured` is false,
every result carries both, and the skill shows candidates rather than deciding.

**That is survivable where a wrong schema value is not.** A bad candidate costs
one "no". Nothing is written on the strength of the score.

### Staleness has five answers and three of them are not "fine"

`fresh`, `due`, `exempt`, `unknown`, and no cadence at all. The one that matters
is `unknown`, which covers an artifact never checked, a cadence this version does
not recognise, and a date that will not parse.

**Collapsing any of those into `fresh` is how a library serves a stale document
silently**, which `SKILLS-process.md` calls worse than having no answer. It is
also why `cadenceDays` returns `undefined` for an unrecognised cadence and `null`
for one that opts out: `None` and `On change only` share a null in the day table
and mean something different from a cadence nobody here knows, and a caller that
reads both as "no check needed" reports an unrecognised value as deliberately
exempt.

### A parent named without its type is refused rather than assumed

`problems` cannot fetch the parent, so the caller passes its type. Where it does
not, the check refuses.

**Assuming would remove the only check there is.** Notion cannot enforce the
parent rule: a view filter cannot read the parent's `Type` across a relation,
measured 2026-08-17, and a rollup filter is created, reported as created and
silently discarded. So the refusal in this file is the whole enforcement, and a
default here would be a rule that exists in three documents and nowhere in the
running code.

### The list helpers are a second copy, and the copy is tested

`listProblem` and `listValues` are in both `shared/calendar-schema.js` and
`shared/process-schema.js`. The two plugins are separate releases and neither can
require the other, so the choice was a copy or a fourth vendored file for eleven
lines.

`tests/list-values-agree.test.js` runs both over the same inputs and asserts they
answer identically, including outside the documented contract, where both throw.
The trim inside `listValues` is the part worth pinning: a value compared trimmed
on one path and written untrimmed on another has already caused a 400 here once.

### The word ceiling now has a check, and it did not before

`shared/calendar-schema.js` carries `WORD_CEILING = 400` and nothing anywhere
compares it to the design document. The same gap existed here and was found by
mutation: moving the number to 900 left every test green.

`tests/process-schema-agrees.test.js` now reads the number out of
`SCHEMA-process.md`. A rewording of that sentence fails the test rather than
passing silently, which is the right direction to fail in. **The calendar copy
still has no such check**, and that is a gap this pull request did not close.

### What was proved by breaking it

Eight of the schema checks and seven of the artifact gates were mutated and
confirmed red. Two mutations did not apply on the first attempt, which is worth
recording because a mutation that silently fails to apply reports the test as
proved when nothing was tested: the first targeted a line that does not exist,
because the cadence list is derived rather than written out, and the second used
a grep pattern that did not match. Both were caught by asserting the mutation
landed before running the suite.

### What is not built, and is said in the plugin rather than discovered

The embedded related view, which needs the Views API. The newer-related-memo
staleness signal, which needs the Memos database queried. A calibrated duplicate
threshold. Each is stated in the README, in the skill that would otherwise be
assumed to cover it, and in the output where a user would form the wrong
impression.

---

## process, review round 1 on pull request 14

### Audience is a filter the reader applies, not one the query applies

Devin found that `find` iterated `['Type', 'Domain']` while the comment above
that loop, the note printed with every result, and `find/SKILL.md` all said
Audience was a filter. An Audience in the question changed nothing and said
nothing, so a narrowed question came back wide and read as a clean answer.

Three ways out were considered and the third was taken:

1. Build the filter. Rejected. Audience is multi-select, and no multi-value
   predicate has been proved against this workspace. `plugins/setup/scripts/views.js`
   records three Notion filters that were accepted and then did not work, one of
   them a multi-select count filter rejected with a 400. No SQL this plugin
   builds has ever been sent to Notion. Adding an unproved multi-value predicate
   to unproved SQL is the failure that file exists to warn against.
2. Delete Audience from the three places that claim it. Rejected: `SKILLS-process.md`
   does give this skill Type, Domain and Audience as its judgment, and deleting
   the word would make the code right and the design wrong.
3. **Taken: keep Audience, and make `find` say plainly that it did not filter.**
   The output now carries `audience`, reading back what was asked for, and
   `audienceNote`, which says in as many words that the rows are wider than the
   question and that narrowing them is the reader's job. This is what the rest of
   the plugin already does. Archived rows are excluded and the output says so. A
   parent named without its type is refused rather than assumed. Nothing here
   drops something in silence, which was the whole of the finding.

`audience` is an explicit `null` when none was asked for, rather than an absent
key, because a missing key and a key meaning "none" are the same read at the far
end.

### `find` had no tests at all, because it was not reachable from one

The command lives on the `commands` object and `commands` is exported, but no
test had ever called through it, so the query builder shipped unexercised. Six
checks now cover it, and the defect Devin found sat in the part with no coverage.

The load-bearing one asserts the query is byte-identical with and without an
Audience. It is scoped to the WHERE clause rather than the whole statement, since
Audience is legitimately in the SELECT list as a column the judgment is made on.
The first version of that check was not scoped, and failed correctly for a reason
that was not the one it was written for.

### What was proved by breaking it

All seven checks were mutated and confirmed red: the note reverted to its old
claim, `audienceNote` pinned to each of its two branches in turn, Audience added
to the WHERE loop, the read-back forced to null, Domain dropped from the loop,
and the archived exclusion removed. Each mutation was confirmed to have changed
the file before the suite was run, per the lesson from the previous round.

### Not done, and deliberately

An Audience value is not validated against `IDENTITY_VALUES.Audience`, so a typo
is read back and offered to the judgment as though it were real. Type and Domain
are validated, because a wrong value there returns no rows and reads as no
answer. The same argument does not carry: a wrong Audience misleads a person
rather than emptying a result. Left alone rather than decided quietly.

## process, review round 2 on pull request 14

### Rows came back half translated, and the half that was missing was the one every judgment used

`normaliseRows` mapped column names from the workspace's back to the logical
ones and copied option values straight through. Queries go out carrying the
workspace's own value names, through `context.value`, so what came back was
renamed on both axes and only one axis was undone.

Everything downstream compares against logical constants. `staleness` looks the
cadence up in `CADENCES`; `judge` compares the type against `PARENT_TYPE`. On a
workspace that renamed its options, every artifact's cadence read as
unrecognised, so every trust judgment came back `unknown`, and no Strategy
Decision was ever recognised as one, so the supersede prompt could not fire.

Proved by running before it was changed, not by reading: a row with a renamed
`Quarterly` cadence and a January check date came back `unknown`. After the fix
the same row reads `due`, 234 days against a 90 day cadence.

**Both failures are silent, and worse than silent.** `unknown` is also the honest
answer for a cadence this version has genuinely never seen, so the broken state
and the working one are the same output. That is the same shape as the
relative-date view in `views.js`, which read back correctly and matched nothing.

`logicalValues` is ported from `plugins/calendar/scripts/calendar.js`, which had
solved this already, including its rule that a value the map does not carry is
passed through as itself rather than dropped. `_raw` still carries the row
exactly as it arrived.

### A test was pinning the bug in place

`rows come back keyed logically` asserted `row.Type === 'R SOP/ROE'`, the renamed
value, so the suite would have gone red if anyone fixed this. It is split in two
now: one check that column names come back logical, and one that option values do.

**Asserting the map is not asserting the behaviour.** Two checks run the whole
path instead: staleness on a renamed cadence, and `judge` end to end on a renamed
workspace confirming a supersede is actually detected. The second was written
because a supersede that never fires looks exactly like two artifacts that were
not similar enough.

### What was proved by breaking it

Six mutations, each confirmed to have changed the file first: the reverse map
removed, built the wrong way round, the unmapped-value pass-through turned into a
drop, `_raw` emptied, the map skipped for `Type` alone, and the map disabled
entirely against the end-to-end supersede check.

### Checked and not a defect

`judge` reads `row.type` in lower case at the replacement filter. That is not the
normalised row: `scored` rebuilds each row with lower-case keys just above it, so
the reference is correct. Checked because Devin's note quoted the line and the
casing looked wrong out of context.

## process, review round 3 on pull request 14

### Asking what is wrong with a row returned a stack trace instead of the answer

The tags cap counted `row.Tags` without first asking whether it was a list of
value names. `Tags` is in `MULTI_SELECT_FIELDS`, so the loop above had already
recorded the right refusal for a list holding a number, and then the cap check
crashed trying to trim it. `problems({ Tags: [42] })` threw
`entry.trim is not a function`, which is a function failing at the one job it
exists to do: say what is wrong rather than fall over on it.

Reproduced before it was changed, not read.

**One fix covered both paths.** `properties` runs `problems` itself, so the write
path crashed the same way, one level down. It now refuses with the tag named. The
other two `listValues` calls in the pair, at `artifact.js` and `calendar/row.js`,
sit behind that same validation and need no guard of their own. Checked rather
than assumed, because faults in this repository have been arriving as symmetric
pairs and fixing one side has twice been the whole of the bug.

Both new checks were mutated and confirmed red: the guard removed, which is the
original defect, and the guard inverted, which would let a well formed list skip
the cap entirely.

## process, review round 4 on pull request 14

### The check date never arrived, because dates are not selectable by name

`selectList` asked for `c."Last checked for accuracy"` and `c."Verified date"`.
A date property is not queryable under its own name on this surface. Notion
exposes it as `date:<name>:start`, which is measured in this repository, written
into `plugins/setup/scripts/views.js`, and applied by `dateColumns` in
`plugins/calendar/scripts/calendar.js`. Process was the one place that did not.

So the column came back empty, `staleness` saw no check date, and every artifact
read `unknown`.

**That is the same symptom round 2 fixed, from a second and unrelated cause.**
Two independent faults, one output. Round 2's end-to-end check passed throughout,
because it fed the date under its plain name, which is the shape that never
arrives. The check has been corrected to use the real column, and it is the
reason to prefer checks that run the whole path over checks that assert on a map:
this one was end to end and still wrong, because it invented its input.

Only `:start` is taken. Both properties hold a day rather than a range and
nothing reads an end. The name inside the prefix is the workspace's, not the one
this plugin shipped with, which is its own check.

`columnMap` and `selectList` now derive the column from one function, so they
cannot drift. A mutation that prefixes one and not the other is caught.

### What was proved by breaking it

Five mutations, each confirmed to have landed: the prefix removed, applied to
every column, wrapping the shipped name instead of the workspace's, applied in
`selectList` but not `columnMap`, and applied to one of the two dates only.

### The writing side is unaffected and was checked

`properties` builds Notion API properties rather than SQL, so it uses the plain
property name and is right as it stands. The prefix belongs to the query surface
alone.

## process, review round 5 on pull request 14

### The parent was checked and then thrown away, and the skill banned its own remedy

Devin asked whether the missing `Parent` and `Supersedes` relations were deferred
to `update` on purpose. They were not. Three things disagreed:

- `problems` refuses a parent of the wrong type. The rule cannot be enforced
  anywhere else, so the plugin takes a parent seriously enough to reject a bad
  one.
- `properties` then drops a good one. Run with a valid parent it returns
  `Name, Type, Status, Review cadence, Last checked for accuracy, Verified date`
  and no relation at all.
- `new/SKILL.md` forbids building a property payload by hand, and then told the
  model to set `Supersedes` on the new artifact and archive the old one. It
  instructed something and banned the only route to it. Archiving an existing
  page is an edit, which the same file says is `update`'s job.

**The third instance of one shape in this pull request.** Audience was checked
against the documentation and dropped from the query; a parent is checked against
the rules and dropped from the payload. Something is validated, and its absence
afterwards is silent.

### Taken: say it, rather than build it

Building the relation here would pull `update`'s work forward, because
`Supersedes` is half a feature without archiving the old page.

So `new/SKILL.md` no longer instructs either, and says both arrive with `update`.
`create` now returns `parentRelation` and `parentRelationNote`, which state that
a named parent was checked and is not being written and that the page will be
created unlinked. **This is how the same file already handles the embedded
related view**: name what is missing rather than leave the user to notice.

`problems` still refuses a wrong parent type. That check is the only enforcement
of the rule anywhere and stays useful for `update`.

### One thing kept deliberately apart

Notion calls two different things "parent": the data source a page is created in,
and the `Parent` relation. `create` sends the first and not the second, and a
test asserts them separately, because losing the first stops the page being
created at all.

### What was proved by breaking it

Four mutations, each confirmed to have landed: the warning removed, which is a
return to the original silence, the warning fired when no parent was named, the
named parent not read back, and the data source dropped from the payload.

## process, plugin three: `update` and `audit`

The second of the three pull requests. `new` and `find` shipped in #14;
`backfill` is still the third.

### `audit` writes nothing, and the memo query is the whole reason it is careful

`SKILLS-process.md` is explicit that audit reads only and hands a list to
`update`. Two queries, because signal 2 cannot be answered from the artifacts
table. The memo query goes through the reverse relation from Memos, sorted by
`Published date` descending, and never reads the artifact's own relation
property: a page's relation returns at most 25 references and a relation value
caps at 100 pages, so on any long-lived artifact the newest memo is invisible and
the strongest signal degrades to nothing while looking healthy.

`flags` refuses to run without the memo rows rather than defaulting them to none,
and says out loud when it read no memos. Both exist so "nothing was announced"
and "nobody looked" cannot be confused, which is the same distinction `staleness`
already makes between exempt and unknown.

**Signal 4 is not redundant with signal 1.** An empty date matches no "before"
filter in Notion, so a backfilled artifact escapes the staleness signal
completely. That is why `Verified by` is checked separately, and it is why
`audit` selects one column more than `find` does.

**Supersede candidates are candidates.** Getting one wrong archives a live
document, so signal 3 is reported apart from the flags, carries the uncalibrated
threshold note, and is never acted on.

### Reading Memos without carrying the Memos schema

`contextFor` validates a recorded name map against a full identity in both
directions, so a name in the map the identity does not list is an error. This
plugin does not carry the Memos schema and should not, so any identity it offered
would be a subset and every Memos property it never looks at would be reported as
a fault in a healthy config.

So the two names `audit` needs are read from the recorded map directly, and both
are required rather than defaulted. **What is given up is written into the
code**: the one-to-one check does not run over Memos here. That check protects
writes, and nothing in this plugin writes to Memos. `setup`'s `check` owns
validating that map.

### `update` and the one question that cannot be inferred

The three verification fields move together or none of them do, and which it is
comes from an explicit `reviewed` on the after row. A missing `reviewed` is
refused rather than read as false, because a missing answer and "no I did not
re-read it" are different and only one is a decision somebody made.

`Last checked for accuracy` drives the staleness check. Stamping it on an edit
that was not a review makes a stale document look freshly checked and nothing
downstream can tell. Leaving it alone on a real review only leaves the artifact
flagged, which a person can see.

### The field list that is not `SELECTED`

`update` iterates `UPDATABLE_FIELDS`, not `SELECTED`. `SELECTED` is a reading
list and deliberately omits `Tags`, `Segment`, `L2C Lifecycle` and `Owner`,
which no judgment reads. The first version of `update` reused it and therefore
could not change any of those four, reporting "nothing changed" for a real edit.
**Caught by a test that was passing for the wrong reason**: the reordering check
asserted no change on a Tags edit, and Tags was simply invisible.

Reordering a multi-select is not a change, and an absent value and an empty one
are the same thing. Without that, reordering three tags looked like an edit and,
on a review, dragged the verification stamp with it.

An emptied field goes as an explicit empty value, a list for a multi-select and
null for everything else. Left out of the payload the write is a no-op, the old
value survives, and the person is told the change was saved.

### `prove-update` takes the update's own output

Not the two files it was given. A payload rebuilt from a merged row has no record
of what was emptied, so a clear that silently failed would read as a clean write.
It binds to the page it was sent to, and it says what it did not check every
time, including on a pass.

### What was proved by breaking it

Fourteen mutations, each confirmed to have changed the file before the suite ran:
the verification stamp moving on a non-review, one of the three moving alone, a
cleared field left out of the payload, a multi-select cleared with null, the
field loop driven from `SELECTED` again, multi-select order read as a change,
`prove-update` unbound from its page, archiving no longer called out, memo
matching by raw string, the newest memo becoming the first-seen memo, archived
decisions offered as supersede candidates, signal 4 silenced, the memo query
pointed at the artifacts table, and `flags` defaulting the memo rows to none.

### Not run against Notion

No SQL here has been sent. The queries are asserted as strings. Whether this
surface accepts them is a live-run question the suite cannot answer, and the same
caveat that stood for `new` and `find` stands here.

### Review round 1 on pull request 15

Both findings arrived only through the hidden-findings line. The GitHub review
body said "No Issues Found", the check was green, and there were no inline
comments at all. **Both were real.**

**`update` refused any edit that did not carry the whole body.** It validated the
after row through `problems`, which records a missing section for every required
one absent from the body. Changing a Status or a tag meant reconstructing every
section first, which is most edits. `problems` and `properties` both take
`partialBody` now: an absent section is one that stays as it is on the page, and
a section that IS sent still has to be filled, which is the case that check was
written for.

The fix needed two edits, not one. `properties` runs `problems` itself, so
scoping the check in `update` alone left the unscoped refusal coming from a line
that had already been satisfied.

**Clearing an owner reassigned it to the config person.** `properties` fills an
absent person field with the config person, which is right on a create and silent
reassignment on an edit: the changed-field loop found the name present and never
reached the clear branch, so an artifact was quietly handed to whoever installed
the plugin, with nothing in the output saying so.

Turning the person default off outright was not the fix, and the finding said so
before the code did: `Verified by` is a person field too and the review stamp
depends on that default. So `update` builds two payloads, one without the default
for the fields being edited and one with it for the verification stamp, and each
is used only for what it is right for. A test covers clearing the owner and
reviewing in the same update, since that is where the two meet.

A person property also clears with an empty list rather than a null, the same as
a multi-select. Sent a null the write is accepted and the old owner stays.

Six mutations, each confirmed to have landed.

### Review round 2 on pull request 15

Two more, again both real.

**`prove-update` would have failed on every real read-back.** It compared the
sent payload against the re-fetched page with raw string equality. A property
does not come back in the shape it went out in: a person is written bare and
read back prefixed, a list arrives as a string holding a JSON array, a date can
carry a time. Every one of those reads as a failed write, so a perfect update
would have reported itself as not landed, and the next person would learn to
ignore the proof.

**Its test passed only because the fixture handed the flat payload back instead
of a page.** That is a fixture that cannot fail, and it is the fourth time in
this repository. The replacement fixtures use the measured shapes.

Presence-only, which the create `prove` in the same file does, was the other
option offered and was rejected: catching a clear that did not land is the whole
reason `prove-update` exists, and presence-only passes a clear that silently
failed, because the key is there either way.

So the readers moved to `shared/notion-compare.js`, vendored into `process`. It
returns one of three answers, `same`, `different` or `unchecked`, rather than a
boolean, because "could not compare" is a third answer and folding it into either
of the others is how a proof reports something it never looked at.

**`plugins/calendar/scripts/calendar.js` still carries its own inline copy**,
written first and measured there. Retiring it into the shared file is written at
the top of that file as the thing to do the next time calendar is opened. Two
copies of a measured fact is how the measurement gets lost, and doing it in this
pull request would have meant rewriting a plugin this one does not touch.

**And `prove-update` accepted any file at all.** Given a before row, the binding
check found no target and the property loop found no properties, so it printed a
clean proof having looked at nothing. It now refuses anything that is not
`update`'s own output.

Five mutations, each confirmed to have landed: raw comparison restored, the
person prefix left on, an unknown type passed instead of reported unchecked, the
comparison forgiving values as well as shapes, and the input guard removed.

### Review round 3 on pull request 15

**A partial body would have wiped every section nobody touched.** Round 1 made an
absent section legal to validate. It did not make it absent from what gets
written, so `body()` still emitted every required section with empty text, and
sending that blanks them on the page, `Exceptions` included, which can never be
blank.

**This is the fix that creates a worse bug than it cured, and it destroys
content.** The refusal it replaced was merely annoying. `body()` and
`expectedHeadings()` both take `partialBody` now, derived from one call so the
two cannot disagree about which sections are being written.

**And a second fixture that could not fail, caught by mutation rather than by
reading.** The check that a create still writes every section used a complete
body, so it passed whichever way the default went. Flipping the default to true
turned nothing red. It uses a body with a section missing now, and asserts that
section comes back present and empty. Two of these in two rounds, both found the
same way, which is the argument for mutating every new assertion rather than the
ones that look risky.

Four mutations, each confirmed to have landed: the section filter removed, the
flag dropped on the way to `body`, the flag dropped on the way to
`expectedHeadings` so the headings drift from the body, and the default flipped
so partial leaks into the create path.

### Review round 4 on pull request 15, read from the Devin page directly

**The findings behind the hidden-findings line are readable without her.** The
review page can be opened and read in the browser, which is how these seven were
got. That closes the gap that had been sending every round back to her: the
GitHub API carries the headline and the inline comments, and the page carries the
rest.

Seven taken, one left alone.

**A canceled memo could send somebody to re-read an artifact.** Memos has a
`Status` of Draft, Published or Canceled and the memo query ignored it. A draft
was never announced and a canceled one was retracted, so neither is work anybody
failed to fold in. The query filters on Published now, and `flags` checks again
on the rows it is handed, because those can arrive from a query somebody wrote by
hand. A row with no `Status` column at all is accepted: that is the shipped
query, which does not select it back.

**Signal 4 missed exactly the rows it exists to catch.** `!row['Verified by']` is
false for `[]` and for the string `"[]"`, which are the two shapes an empty
person property actually arrives in, so a backfilled artifact read as verified
and the library reported itself fully checked.

**A memo published the morning of the check read as newer than the check.**
`Published date` comes back carrying a time and `Last checked for accuracy` does
not, so the raw string comparison flagged everything checked that day. Both sides
are compared as days now.

**Omitting a field from the after artifact deleted it.** The comparison saw
undefined against the old value, called it a change, found nothing to send and
sent an explicit empty. A caller that built the after row by hand and forgot a
field wiped it, and the output called that a clear as though it had been asked
for. An absent key now means untouched, and clearing is something you say with an
explicit null. The output lists what it left alone. This is the same rule the
body already followed, arrived at twice.

**A page fetched from Notion is keyed the workspace's way.** Handed a raw fetch
on a renamed workspace, every logical lookup returned undefined, nothing looked
changed, and `update` would have reported a clean no-op for an edit somebody
asked for. Refused now, with the reason.

**`["AI Data"]` and `["AI", "Data"]` compared equal**, because the render joined
on a space. A multi-select split into two options proved clean against the one it
came from. Joined on a character no value can hold now.

**`prove-update` filed the headings under "not checked" without looking at
them**, while `update` had just said which ones it was writing. A Notion page can
come back with a heading missing on a silent partial failure, which is the exact
thing `new` proves against after a create. Checked now; the section text is still
not, and it says so.

**Left alone, deliberately:** reading the Memos names outside `contextFor`. That
is the documented decision above and the flag says as much.

**Two more fixtures that could not fail, both mine, both found by mutation.** The
before row had no `Description`, so the omit and clear checks passed whatever the
code did. And the split-option check used a pair that sorts into a different
order, which cannot collide however it is joined, so it passed on the very join
it was written to condemn. That is four of these across two pull requests, and
every one was found by breaking the code rather than by reading the test.

Nine mutations, each confirmed to have landed.

### Review round 5 on pull request 15

Every round 4 finding is marked resolved. Three more taken.

**A multi-select on a fetched row read as changed every time.** A row that came
from Notion carries a list as a string holding a JSON array; a row written by
hand carries a real array. `sameValue` compared them as written, so every
multi-select on a fetched before row looked edited, went into the payload unasked
and, on a reviewed update, dragged the verification stamp with it. Which fields
are lists comes from the schema rather than from the shape of the value.

**A property-only edit was refused for missing the fields it was not touching.**
`problems` needs a `Name` and a `Type`, rightly, and an edit to a Status changes
neither. Under the rule that an absent key means untouched, demanding them
contradicted the rule one screen above. Identity now comes from the before
artifact where the after artifact is silent.

**The body is deliberately not part of that merge.** Pulling the before body in
would validate sections nobody edited, which is the round 3 fault arriving by
another door. It shows up on a page written before these rules existed, whose
`Exceptions` is blank: merged in, a Status edit on that page is refused for the
state of a body it never touched.

**And the memo query promised a Status column it did not return.** It selects it
now, which also makes the defensive check in `flags` something other than dead
code.

### Three mutations that found nothing, and what each one was worth

Not every miss is a weak test, and telling those apart is the point of running
them.

- **The Status check passed with the column gone**, because the WHERE clause
  filters on Status too and the assertion looked at the whole statement. Scoped
  to the SELECT list now. A real weak check.
- **The body-leak check passed with the merge broken**, because a valid before
  body makes the merge invisible. It uses a legacy body with a blank required
  section now, which is the only state where the leak has an effect. A real weak
  check, and one reading would not have found.
- **Treating every field as list-shaped changed nothing any check could see**,
  and that one is not a weak test. The list reader returns a scalar unchanged, so
  there is no defect to catch. The comment claiming otherwise was wrong and is
  corrected: the schema is consulted because that is where the answer lives, not
  because a scalar would be mangled.

That makes six weak fixtures found across this pull request and the last, every
one of them by mutation and none by reading.

### Review round 6 on pull request 15

Every round 5 finding is resolved. Four more taken.

**Asking to own a document emptied it.** `properties` drops a person field it
cannot resolve, and `me` with no configured person is exactly that, so the value
fell into the clear branch. "Make me the owner" was carried out as "remove the
owner": the reverse of what was asked, silently, on the field that records who is
accountable. Refused now, and an explicit null still clears, because emptying it
on purpose is a different and legitimate request.

**`prove-update` checked the headings of a page it had already rejected.** The
property loop was guarded by the binding check and the headings block was not, so
a read-back of another page had its headings compared and reported as checked,
underneath a result that had just said nothing below was looked at.

**The same page opened from a view keyed as a different page.** `pageKey` took
the last 32 hex characters of the whole string, and in
`.../page-<id>?v=<view id>` those belong to the view. The binding check would
have refused a correct read-back. It reads the last path segment now, with the
query and the fragment cut off first.

**And a person read as changed for the shape it came back in.** An owner fetched
as `user://abc`, left untouched in the after row, compared as an edit, went into
the payload, and on a review moved the verification stamp for a change nobody
made. The same measured fact already lives in `shared/notion-compare.js`, which
answers a different question: that one is about proving a write landed, this one
about deciding what changed. Both need it and they are not the same call.

Five mutations, each confirmed to have landed. 693 checks.

### Review round 7 on pull request 15

**A body-only edit crashed.** The sections a body has are decided by the `Type`,
and an edit that changes only the body is not changing the type, so under the
rule that an absent key means untouched the after row had no reason to carry one.
Built from the after row alone it threw "No template for undefined" on exactly
the edit this command is most for. The body is built from the merged row now, and
`merged.body` is still `after.body`, so what gets written is only what was sent.

**The page id was being assembled rather than matched.** `pageKey` stripped every
non-hex character out of the last segment and took the last 32 of what was left,
so the letters of the title were concatenated with the id. That gives the right
answer when an id is there and invents one when it is not, and an invented key
matches nothing, which reads as a memo pointing at no artifact. Both forms are
matched at the end of the segment now, the bare 32 and the dashed uuid, and a url
with no id in it returns nothing.

**A seventh weak fixture, same shape as the other six.** The no-id url in that
check held 30 hex characters, so the assembling version returned nothing too and
the check passed whichever way the code went. It carries exactly 32 now, and
asserts that it does, so a later edit to the fixture cannot quietly disarm it.

### Two informational flags left alone, and why

**"Memo status re-check compares unnormalised values."** The re-check compares the
raw returned value against `memosCtx.value('Status', 'Published')`, which is the
workspace's own name for it, so both sides are in the workspace's vocabulary and
the comparison is right. The asymmetry Devin is pointing at is real, though: the
artifact rows go through `normaliseAuditRows` and the memo rows do not. That is
because only three memo columns are read and none of the judgments compare them
to a logical constant. Recorded rather than changed.

**"Two-payload person-default split holds up."** Not a defect. A reviewer
confirming the round 1 fix survived everything since.

### Review round 8 on pull request 15

**The guard against raw rows had the fault it was written to prevent, inside
it.** It asked whether the row carried ANY logical key and let it through if it
did. A workspace that renamed some properties and not others produces a row
carrying both, so a raw fetch with an unrenamed `Name` on it passed, and the
renamed field it was actually editing stayed invisible. Reproduced: a Status edit
on a workspace calling that property "Workflow State" came back reporting nothing
changed.

It asks per field now. A field counts as raw when its workspace name is present
under a key that is not its logical one AND the logical key is absent. Both
halves earn their place, and the second one is not theoretical: a workspace whose
name for `Domain` is "Segment", which is a real logical name for a different
field, produces normalised rows that a one-sided guard would refuse. Refusing a
row that is fine is the mirror of letting a raw one through, and there is now a
check for each.

**Two of my own checks were wrong rather than weak, which is a different
failure.** Both asserted against the old refusal wording, so tightening the guard
turned them red while the code was right. Worth separating: a weak check passes
when it should fail, and these failed when they should have passed. The first
kind hides a defect, the second wastes a round. Matching on a sentence fragment
is what made them brittle, and the narrower of the two was matching on singular
wording that goes plural as soon as more than one field is raw.

### Review round 9 on pull request 15

**Zero bugs open at the start of this round**, for the first time. Four flags,
all real, all taken.

**The reverse value map missed the shape the surface actually returns.** It
handled a real array and a bare scalar and let a string holding a JSON array fall
through untouched, so a renamed workspace came back with its own option names on
every multi-select. That is the fault the whole reverse map exists to fix,
surviving in the shape it was most likely to arrive in. One translator now, used
by both row readers, and a string that parses as an array comes back as an array:
the caller is reading a list either way and should not have to know which shape
it arrived in.

**Signal 4 flags every artifact on an install that records no person**, because
nothing ever fills `Verified by` there. That is not wrong and it is useless
without the reason, so the report says it once. A list where every row carries
the same flag teaches the reader to skip the whole report, including the three
signals that do mean something.

**Setting the owner to `me` when the config person already owned it reported a
change**, and rewrote the same value. `properties` understands `me` and the
comparison did not. It is resolved once, before anything is compared, rather than
in both places.

**`flags` accepted "last Tuesday" as a date.** Every cadence comparison would come
back `unknown`, which is also what `staleness` says about a cadence it has never
seen, so a mistyped argument read as a library nobody had checked. Refused now.

Six mutations, each confirmed to have landed. One needed rewriting because the
first attempt matched nothing: there are two date guards in this file and the
pattern hit neither. A mutation that fails to apply reports the check as proved,
which is the lesson from the round before this work started, and the reason each
one is diffed against the original before the suite runs.

706 checks.

### Review round 10 on pull request 15

Both findings are one root cause, and it is the round 5 fix reaching too far.
Merging the whole before artifact in so that `Name` and `Type` could be inherited
also put every pre-existing value back through the gates, so an edit was refused
for the state of fields it was not touching.

**A `Draft` artifact could not be edited at all.** Draft is a status only a
person can set in Notion, and a skill may write only Active or Archive. The rule
that stops a skill drafting was therefore also stopping it correcting a draft,
which is the one state most likely to need correcting.

**A value retired from the schema since the page was written blocked every later
edit to that page**, and named a field the person had not touched.

Only what is being written is validated now, plus `Name` and `Type`, which are
carried across because nothing can be judged without them: the type decides which
sections a body has. Both halves of each rule have a check, because the danger in
narrowing a gate is narrowing it past the thing it was for. A skill still cannot
write a Draft, and a retired value sent in the edit is still refused.

Three mutations, each confirmed to have landed: the whole row merged again, the
identity not carried at all, and `Type` dropped from the identity while `Name`
stayed. The last one is the interesting one, because it fails a check written two
rounds earlier for a different reason.

710 checks.

### Review round 11 on pull request 15

Zero bugs again. Two flags, both real.

**A field with a default behind it could not be emptied.** `properties` fills
some fields in when they are absent, and a missing `Review cadence` becomes the
default. Asked to empty one, the value came back present, the clear branch was
never reached, and the field was written with a default instead of emptied.

The clear branch reads the request now rather than the payload, which makes
clearing mean the same thing for every field instead of depending on whether that
field happens to have a default behind it. The Owner fix from round 1 was the
same fault seen through one field; this is the general form of it, and the two
would have kept arriving one field at a time.

**`update` wrote a date it never checked.** `flags` refused an unreadable one and
`update` carried the same argument into the payload, so
`update before.json after.json "last Tuesday"` put those words into a Notion date
property. One validator now, used by both, and it names the two failures
separately because they differ: unreadable on the reading side makes every
cadence comparison come back `unknown`, which is also the honest answer for a
cadence nobody recognises, and on the writing side it goes to Notion.

Four mutations, each confirmed to have landed. One had to be repointed: it
targeted the editable payload's date and the stamp comes from the other one, so
the check passed while the thing it watches was untouched. Two payloads means two
places to aim.

714 checks.

### Review round 12 on pull request 15

Zero bugs. One flag taken, three recorded and not changed.

**A clear that landed perfectly reported itself as a write that never
happened.** Notion leaves an empty property out of a page rather than returning
it holding nothing, so the read-back had no key for the field that had just been
emptied, and the absence read as a failure. Absent and empty are the same state,
and empty is the only thing that was asked for. Both halves have a check: a
property that was SET and came back absent still fails, because absence only
means success when success meant absence.

That is three rounds in a row where the fault was `prove-update` reporting a
correct write as a failure. A proof that cries wolf is worse than no proof: it
gets ignored, and then the one real failure is ignored too.

### Three informational flags recorded rather than changed

**"Reverse-relation memo SQL asserted as a string, never run."** True, and stated
in the pull request, in the test file's header and in the section above. No SQL
this plugin builds has been sent to Notion. It is the honest caveat on the whole
of `process`, not a defect in this round.

**"Memo rows compared in workspace vocabulary, artifact rows in logical."** Also
true and already recorded in round 7. The memo rows are read for three columns
and no judgment compares them against a logical constant, so translating them
would be work with nothing behind it. The asymmetry is deliberate and written
down where somebody would hit it.

**"Multi-select in JSON-string shape on the after row would mis-clear."** It does
not mis-clear: `problems` refuses it, because a bare string sent to a multi-select
is a 400 at Notion. The split is deliberate and worth stating plainly, since the
code does look inconsistent: the BEFORE row may arrive in either shape, because
it was fetched, and `sameValue` reads both. The AFTER row is authored rather than
fetched, so it carries real lists and the refusal keeps it that way.

716 checks.

## process, plugin three: `backfill`

The last of the five skills `SKILLS-process.md` designs, and the only one that
reads things people said rather than things they wrote down for the record.

### The approval gate decides where being wrong is affordable, and where it is not

`SKILLS-process.md` argues that all three discovery modes are shippable
precisely because a candidate that turns out to be junk costs one "no": a weak
detector produces noise rather than damage. That is the right argument and it
has a limit, and the limit is what shaped this build.

The gate sits between the reading and the writing. Everything downstream of it
is allowed to be roughly right, and two things upstream of it are not:

- **What the plugin was permitted to read.** There is no approval gate in front
  of a read. By the time a candidate list exists, the reading already happened.
- **What goes onto a page.** A person saying yes to a candidate line has not
  reviewed the artifact that line becomes.

So `scope` refuses rather than narrowing, and backfill mode writes no person
field and no verification stamp. Both are refusals in code. The skill document
says so too, but prose is advice and this had to be a gate.

### `scope` refuses rather than narrows, and says what it is not reading

A scope quietly trimmed reads less than the person asked for and then reports
that it read what they asked for. Every refusal is listed in the skill document,
and the three that are not obvious:

- **A conversation source carries its own date range**, rather than one range at
  the top of the request. A single range would read as covering whichever
  sources happened to be named, and the window that is right for a mailbox is
  rarely the one that is right for a year of meeting recordings.
- **Half a range is refused as hard as none.** An open-ended `to` is still an
  unbounded read.
- **A backwards range is refused rather than swapped.** Read as written it
  covers nothing, and a run that reads nothing looks exactly like a workspace
  with nothing in it.

`notReading` exists because a source that was left out and a source that held
nothing produce the same empty candidate list, and only one of them is worth
saying out loud.

### Direct messages are named one by one, and that is not a setting

There is no "all DMs" option, not as a flag and not as a checkbox. A public
channel is somewhere people chose to speak in front of the workspace and a
direct message is not, and no approval gate on the output changes that, because
the reading has already happened by the time the output exists.

The same reasoning refuses any mailbox but the user's own.

### Backfill mode lives on the artifact, not in the command's arguments

`create` and `prove` both need to know whether an artifact is a backfill:
`create` to leave the stamp off, `prove` to not go looking for one. Passing it
as a flag to each would be the symmetric-pair fault this repository has now hit
three times, where the write path is defended and the read path is not, or the
other way round.

`backfill: true` sits on the artifact JSON instead. `prove` is handed the same
file `create` was, so the two cannot disagree about which mode this is.

`backfill: "false"` is refused rather than read as truthy. Everything keys off
`=== true`, so a loose read would turn the mode off while every line printed
still said backfill.

### Nothing is written into a person field, and nothing is stamped

`Owner`, `Verified by`, `Verified date` and `Last checked for accuracy` are all
left empty. Empty is the honest value: a machine pulled the content in and
nobody has read it.

This is what makes `audit`'s fourth signal mean something. An artifact stamped
by the import that created it is indistinguishable from one a person actually
checked, and signal 4 keys on `Verified by` being empty precisely because signal
1 cannot catch these: an empty date matches no "before" filter.

A person field passed to a backfill row is **refused rather than dropped**.
`properties` could ignore it and write the page anyway, and the caller would
have every reason to believe the field was set.

### The Sources section is generated, not written alongside the sources

`sources` is a structured list `artifact.js` already validated, and
`body.Sources` was free text a caller wrote. Nothing tied them together, so an
artifact could list one set in its section and carry a different set in the
record, and both passed.

That is survivable on a create somebody wrote by hand. It is not survivable on a
backfill, where "this came from there" is the only claim being made and the only
one a reader can check. On a backfill the section has to be exactly what
`sourcesSection` renders from the list, and anything else is refused.

### `fill` never overwrites, and it writes through `update` rather than itself

Filling blanks on an artifact that already exists is a write, and a second write
path would be a second place for the clearing rules, the verification grouping
and the person defaults to be got wrong. Those are the three things `update` was
corrected on most across pull request 15.

So `fill` produces an `after` row and `update` sends it. `reviewed` is forced to
false, which is the mechanism `update` already has for "nobody re-read this".

**The raw-key guard is shared rather than copied.** `update` refused a row keyed
by the workspace's own property names because every logical lookup comes back
undefined and nothing looks changed. `fill` reads the same fetched row and the
same undefined means something worse: every field reads as empty, so a row that
is entirely filled in reads as entirely blank and the never-overwrite rule stops
meaning anything. One guard, two callers, and the consequence sentence is passed
in because it differs.

### The repeated-question threshold is uncalibrated and says so

Whether "how do we do refunds" and "what is the refund process" are the same
question needs tuning against real workspaces, which do not exist yet.
`SKILLS-process.md` accepts that imprecision here and only here, because the
output is a candidate list rather than a document.

Measured while building: those two example wordings score **0.000** against each
other on the token overlap this uses. That is not a reason to raise or lower the
number, it is a reason the number is reported with every result and the person
sees the wordings.

Clustering is greedy and compares against the **first** asking in a cluster
rather than the best match in it. Comparing against every member chains: A is
near B, B is near C, and C joins a cluster it has nothing to do with A about.
The first asking is what gets shown to the person, so the thing they judge is
the thing that decided membership.

### One duplicate check, not two

Every candidate goes through `duplicates` and `judge`, the same pair `new` uses.
That is what makes backfill safe to re-run and it is why no import-tracking
field exists anywhere in the schema: a second pass over the same folder finds
the same documents and the check recognises them.

`withinRunNearMatches` is a different question and does not overlap. It catches
the same process described in two channels, arriving as two candidates in one
run, neither of them in the library yet, which the library check cannot see.

### `similarity` moved out of `process.js`

`backfill.js` compares one asking of a question against another, which is the
same job `process.js` does against the library. It cannot require `process.js`
back without a cycle, and a second copy would drift the way `CLAUDE.md` says
every copy drifts: two callers calling the same number "similarity" and meaning
different things by it. It is in `similar.js`, and `process.js` still re-exports
both functions because its own commands and tests name them there.

### What was proved by breaking it

Forty-eight mutations across `backfill.js`, `artifact.js` and `process.js`, all
forty-eight asserted onto disk before the suite ran, because three mutations in
the previous session applied to the wrong place or matched nothing and each
would have reported a check as proved while touching nothing it watches. One of
these did not land on its first attempt for exactly that reason.

Coverage was measured rather than claimed: all fifty-two checks in
`tests/process-backfill.test.js` are reached by at least one mutation, and no
mutation survives. Getting there took three rounds, and each round found
something the round before it had not:

- **Round one left a third of the checks unexercised**, because the mutations
  were written against the guards rather than against the checks. The list a
  green suite produces is not the list of what it watches.
- **Round two surfaced two real gaps**, below.
- **Round three found a check nothing could reach**, because three separate
  refusals share the kind `missing` and three assertions matched on the kind
  alone. Each would have gone green for a fault in a field it does not name.
  They are scoped to the field now.

The two gaps round two found:

- **The sourceless-backfill refusal in `artifact.js` was never reached**,
  because `draft` refuses first. It could have been deleted with the suite still
  green. It is the gate for the other caller, a person writing the JSON by hand
  and running `create`, and there is a test for that caller now.
- **The field list `draft` copies through is a whitelist**, and nothing asserted
  that a person field could not ride it. `Owner: ''` reads as nobody asking for
  anything, which is the convention everywhere else, and the copy-through would
  then have put the key on the artifact anyway.

The suite is 776 checks, up from 716.

### Not run against Notion

Nothing in `backfill` has been sent. It reads a document store, Slack, a mailbox
and a call recorder, and this build has read none of them: what is proved is
what the plugin is allowed to ask for and what it would write, not that any of
those surfaces answers the way it expects. The install remains torn down.

### Review round 1 on pull request 16, from the Devin CLI

One finding, and it was real.

**The raw-key guard was applied to one of two arguments.** `update` guards both
its `before` and its `after` row. `fill` takes two rows as well and guarded only
`existing`, so a raw-keyed **candidate** walked straight past it. Every value on
it is invisible to the logical lookups, nothing gets filled, and the output says
there was nothing to fill and exits zero. That is the quieter of the two
failures and the harder one to notice, because "nothing to fill" is a legitimate
answer this command gives all the time.

**The test that was supposed to cover this passed without checking the half it
did not name.** It handed `fill` a raw `existing` and a clean candidate, so it
proved the guard on one side and said nothing about the other. That is the same
fault as the four fixtures in the previous session: a check written so it could
not fail on the case it was named for.

Both halves are guarded now, the consequence sentence differs per side because
the failure differs, and a mutation that removes only the candidate half turns
the suite red.

**Worth noticing about the review itself.** Four of the five design claims put to
the reviewer came back confirmed and the fifth came back with this. The claim
that failed was the one about a shared guard, which is the shape this repository
gets wrong most: a fix landed in one place and its pair missed in another. The
question that found it was not "is this correct" but "is the guard reachable on
every path into `fill`".

### Review round 2 on pull request 16, from Codex

Two findings, both real, and both the same fault arriving twice: `plan` narrowed
where it says it refuses.

**A refused scope handed back a runnable plan.** Refusing `dms: "all"` recorded
the refusal and left `reading.slack` standing with an empty `dms` list. The same
output said `ok: false`, said "NOTHING IS READ", and carried a plan that runs. A
caller reading `reading` without checking `ok` first would have read the channels
and skipped the direct messages, which is exactly the narrowing this function
exists to refuse, arriving as the shape of the answer rather than as a decision
inside it.

**The fix is at the return rather than at each refusal**, and that is the whole
of the choice. Removing the source at the point of each refusal is a rule every
future source has to remember, and the one that forgets is the one that ships.
A refused plan now carries no plan at all: no `reading`, no `ways`, no `topics`.
The good half of a refused scope does not survive either, because reading the
half that was fine is still reading a scope nobody agreed to.

**A list entry that was not a name was dropped rather than refused.**
`sources: ["slack", 42]` came back `ok: true` covering one source.
`channels: ["#gtm", 42]` came back covering one channel. Five lists went through
`.filter(Boolean)` and every one of them quietly shortened. A run then reads
less material than was asked about and reports that it read what was asked
about, which is the failure `plan` was written to prevent, arriving through the
helper instead of through the scope.

**The check that should have caught the first one stopped at the refusal.** It
asserted that `dms-all` was recorded and said nothing about what came back
alongside it. Asserting the refusal is not asserting the outcome, and that is a
third variety of check-that-passes-without-checking to add to the list: not
unreachable, not scoped too wide, but stopping one step short of the thing the
refusal was for.

### A third fault, found in the reviewer's working notes rather than its findings

Codex tried `from: "2026-02-30"` while exploring, printed the plan it produced,
and did not carry it into its report. It was real. `Date.parse` accepts
`2026-02-30` and hands back the 2nd of March, so a range set to end in February
read two days into March. Nothing downstream could have caught it: there is no
approval gate in front of a read.

`day` now writes the parsed date back out and compares, which is the only way to
tell `2026-02-30` from `2026-03-02` once the string has been parsed.

**It gets its own refusal wording rather than the missing-date one.** A date
sitting right there, reported as absent, sends somebody looking in the wrong
place. That is the same fault as the round-2 message in the previous session
that blamed two different causes with one sentence.

**`dayOrRefuse` in `process.js` has the same gap and is deliberately not changed
here.** It validates a date being written into a Notion date property, where
`2026-02-30` would land as the 2nd of March. That is worth fixing and it changes
behaviour in `new`, `update` and `trust`, none of which this branch touches.
Recorded here rather than folded in, so that the two validators disagreeing is a
known thing rather than a discovered one.

**Worth carrying about the review itself.** Reading only the findings would have
missed this. The reviewer's own reasoning found something its report did not
mention, which is the same lesson as the green Devin check whose body said it had
found something, arriving from the other direction: the summary is not the review.

### Review round 3 on pull request 16, from the Devin CLI

One finding, no code defect: a check still matching on a refusal kind without
naming the field. `draft` emits `missing` for `Name`, `Type` and `sources`, so
the check that a sourceless draft is refused would have passed for a refusal
about either of the other two.

**Fixed at the helper rather than at the line.** Round 2 had already found three
of these and scoped those three by hand, which left the reasoning "this kind
happens to be unique today" standing behind every other assertion in the file. A
kind that is unique today becomes shared the next time one is added, and nothing
goes red when it does. Every assertion in the suite now matches on `field:kind`,
and the helper that produced bare kinds is gone, so a new check cannot be written
the old way by accident.

Proved by changing the field on that refusal from `sources` to `Name` and
confirming the check goes red.

**This is the fourth variety of check-that-passes-without-checking found in one
branch**, and the four are worth keeping together because none of them is caught
by rereading the test:

1. Unreachable: nothing in the suite exercised it.
2. Scoped wider than the thing it names: matching on a kind three fields share.
3. Stopping one step short: asserting the refusal was recorded while saying
   nothing about what came back alongside it.
4. Proving one half of a pair: a raw `existing` row and a clean candidate.

Only the first is found by measuring mutation coverage. The other three need
somebody asking what the check would still pass on.

### Review round 4 on pull request 16, from Codex

One finding, and it is the missed-pair fault for the second time in four rounds.

**`draft` and `fill` each refused the person half of what a backfill will not
take, and dropped the other two silently.** `artifact.js` refuses all four,
person fields and verification fields alike, and it was right. It was also
unreachable from either of the paths anyone uses: `draft` copies a whitelist that
does not include `Verified date` or `Last checked for accuracy`, so supplying one
came back `ok: true` with the field quietly gone, and `fill` never looked at them
at all, so offering one came back as a finished no-op with an empty `refused`
list.

**The check that should have caught it asserted the wrong direction.** "A draft
carries no verification field" checked that the output lacked those fields, which
is exactly what a silently discarded field produces. Asserting the absence of
something proves nothing about whether it was refused or dropped, and those are
different answers to the person who supplied it.

**Fixed with one list rather than two loops.** `REFUSED_ON_A_BACKFILL` is
`PERSON_FIELDS` plus the verification fields that are not already in it, and both
callers iterate it. The reason given depends on which group the field belongs to
rather than on which loop reached it, so a field cannot get the wrong explanation
by being reached from the wrong place.

**The tests iterate the list rather than naming a field**, because naming one is
how this was missed. A check that names `Owner` goes green forever while the
other three rot.

**Two of the six findings across four rounds were the same fault**, one from each
reviewer: a rule enforced in one place and missed in its pair. That is the fault
this repository is worst at and it is worth saying plainly that writing it down
in `DECISIONS.md` twelve times last session did not stop it happening twice more.
What caught it both times was a reviewer asked specifically whether the guard was
reachable on every path, rather than whether the code was correct.

### Review round 5 on pull request 16, from the Devin CLI

One finding, and it is the same fault a third time, sitting in the seam that
round 4's fix created.

**The shared raw-key guard was built from the wrong field list.**
`refuseRawKeys` watched `UPDATABLE_FIELDS` for every caller. `fill` reads the
fields it can put into a blank and the four it refuses outright, and only one of
those four, `Owner`, is in `UPDATABLE_FIELDS`. So a candidate carrying the
workspace's own name for `Verified date` walked through the guard, became
invisible to `fill`, and was ignored rather than refused: precisely the thing
round 4 had just made impossible through the other door.

**Sharing a guard is only half of sharing it.** Round 1 put the guard on both
rows and stopped there. What it also needed was the guard watching the fields
its caller is about to read, and only the caller knows which those are. `fields`
is a parameter now, defaulting to `UPDATABLE_FIELDS` for `update`, and `fill`
passes `FILLABLE` plus `REFUSED_ON_A_BACKFILL`. `FILLABLE` moved out of the
function body and is exported for exactly that reason, so the guard is built
from the same list the reading is done with rather than from a second one that
looks similar.

**The check proved one field.** It used `R Domain`, so the suite stayed green
over every field the guard was not watching. It iterates the whole list now, on
both the existing row and the candidate.

**Three of the seven findings across five rounds are this one fault**, and the
third arrived inside the fix for the second. That is worth stating without
softening: writing "a fix in one place whose pair in another place was missed" at
the top of every review prompt did not stop it, and neither did fixing it twice.
What found it each time was a reviewer given the specific question of whether a
guard is reachable, and given the previous rounds' findings to work from.

### Review round 6 on pull request 16, from the Devin CLI

One finding, the same fault a fourth time, and this one had been sitting there
since the mode was built rather than arriving in a fix.

**`prove` guarded the write side of backfill mode and not the read side.** It
walks the properties that were *intended*, and on a backfill the four that
matter are intended to be absent, so a page that came back carrying a stamp was
reported as a clean write. That is the one outcome the whole mode exists to
prevent: a stamped import is indistinguishable from an artifact somebody read,
and it drops out of the never-verified audit signal without saying so.

**The check that claimed to cover it had a fixture that made its own assertion
unreachable.** It was called "the read path cannot diverge from the write path"
and it handed `prove` a read-back built from the payload that had just been sent,
which by construction has no stamp on it. The page it feeds back is incapable of
carrying the thing the check is named for. That is the fifth variety of
check-that-passes-without-checking in this branch and it is the one the previous
session hit four times.

**The same gap on the `update` side was fixed at the same time.** `fill` promises
that a non-review edit moves none of the three verification fields, and
`prove-update` walks what was sent, and on that path none of them is sent. So
nothing was watching the promise `fill` leans on for every artifact it touches.
`update` now carries the before values of the three in its output and
`prove-update` compares them.

**Absent is reported as unchecked rather than as a cleared field**, and getting
that wrong first is what six existing checks caught. Notion leaves an empty
property off a page, and a read-back saved as a summary leaves everything off, so
the two are indistinguishable and calling either one a clear reports a clean edit
as a failure. The direction that *can* be told apart is the dangerous one, a
value appearing where there was none, and that is what the check is for. Six
suites went red on the first version of this, which is the check-a-fix-against-
the-existing-tests step working.

**Four of the eight findings across six rounds are one fault.** A rule enforced
in one place and missed in its pair, found once by each reviewer twice over. The
four were: a guard on one of two arguments, a refusal in `artifact.js` unreachable
from both callers, a shared guard built from the wrong field list, and now a
write side guarded with the read side open. Nothing in the prompts prevented any
of them. What found all four was asking a reviewer whether a specific guard is
reachable from every path, and handing it the previous rounds' findings so it
knew what shape to look for.

### Review round 7 on pull request 16, both reviewers, two different findings

The first round where the two reviewers found different things, and both were
real.

**Devin: `topics` never got the shape guard every other list has.** `sources`,
`channels`, `dms` and `ways` each refuse a value that is not a list. `topics` did
not, so a bare string fell through to the "no topics were named" refusal and
reported a missing list to somebody looking straight at one. The `notNames` fix
in round 2 reached five lists and this guard reached four, which is the same
fault twice inside the same function.

Devin also found the check that would have covered it going green either way,
because both refusals come back under `topics`. It asserts the whole refusal list
now rather than that one is present.

**Codex: the empty-to-populated transition was the one going unwatched, and it is
the backfill case.** Round 6 added the before values of the three verification
fields so `prove-update` could check they had not moved. It keyed the object on
the fields present on the fetched row, so an *empty* verification field dropped
out entirely, was reported as unknown, and a stamp landing on it was proved as a
clean write.

A backfilled artifact has all three empty by design. That is the whole mechanism
behind the never-verified signal. So round 6 guarded the transition that happens
to artifacts somebody has already read, and left open the one that happens to
every artifact backfill creates. All three are carried now with an explicit null
for the ones the row did not hold.

**The message names both causes.** A field that was empty and comes back holding
something is either a stamp from somewhere this edit did not send, or a before
row that never carried the column. Blaming one of those sends somebody looking in
the wrong place, which is a fault this repository has been corrected for before.

**Five of the ten findings across seven rounds are one fault**, and round 7's
half of it lived inside round 6's fix. Two of those five were introduced by the
fix for the previous one. The pattern is not that the pair is hard to see, it is
that fixing one half creates a new pair nobody looks at, so the fix and its own
review have to be treated as a new surface rather than as a closed item.

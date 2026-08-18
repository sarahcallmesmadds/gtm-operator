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
| Can `check` find both violations in SQL | **Yes.** Both queries proved on real rows |
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

After the Process Library schema is settled, do the **Memos** schema the same
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

- The thing is the **Process Library**. Not Documentation Library, not Docs Library.
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
| `process` | Process Library | Schema done, 5 skills done |
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
- `scope` having to check whether the Process Library was even installed
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
Process Library schema said the relation was not created in v1, and the cut list
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
| `SCHEMA-process.md` | Process Library fields, every value list, the rolldown and superseded rules, the granularity framework, the type-selection tree, and the five page body templates |
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

**Config holds identifiers. The Process Library holds judgment.**

Database ids and property names go in `config.json`. The rules the organisation
decided (a campaign record type by member status grid, an operating-context
artifact) live in the Process Library as artifacts, in a form both a person and a
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
   from the Process Library** rather than hardcoding the grid.
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

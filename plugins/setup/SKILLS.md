# setup: what the plugin does

**This file defines the `setup` plugin.** Three skills, each described in the
same five slots as `plugins/process/SKILLS.md` and `plugins/projects/SKILLS.md`, so a gap in one
is visible as a gap rather than as something that did not apply.

The five slots: what it does, when it runs, what it reads and writes, what it
does not do, and the judgment it carries.

Databases are defined in the `SCHEMA-*.md` files. This file defines the order
things are created in, the shape of the relations between them, and the shape of
the config file every other foundation plugin reads.

**It does not restate a value list or a full field definition, and it does name
properties.** The relation map and the config shape below cannot be written
without naming them. A rule forbidding that would be broken by its own page.

`DECISIONS.md` holds the reasoning and the reversals. Written 2026-08-17.

---

## What this plugin is

`setup` creates every database in the foundation and writes the one config file
the other foundation plugins read. Nothing else in the marketplace creates a
database, and nothing else writes the foundation's config.

**It creates all six, every time.** Decided 2026-08-17. Setup does not ask which
databases you want and does not read which plugins you have installed. It builds
the whole foundation in one pass.

This is the decision that pays for the two-tier architecture. Because every
database exists before any relation is added, no relation is ever conditional,
nothing has to be added back later by a second install, and no plugin has to
check whether another plugin is present. The previous design spent four separate
mechanisms on that problem. This spends one ordering rule.

The cost is real and worth stating: someone who only wants a documentation
library gets six databases. That is the price of the relations working on day
one, and it is cheaper than the alternative, which is six plugins negotiating.

### Its three skills

| Skill | What it is for |
|---|---|
| `install` | The first run. Explains the model, asks five questions, creates the six databases, writes config |
| `check` | Tells you whether the plugin can still see what it created, and repairs what it owns |
| `add` | Creates a database that is missing, and wires it into the ones that are already there |

**Three, not four.** A separate settings skill would be a fourth thing to find
for a job people do roughly once.

**There is no settings path yet, and this said there was.** Until 2026-08-18
these documents described re-running `install` on a complete config as the way to
change an answer. `config.begin()` refuses to start on a complete config and
always has, there is no `settings` command, and nothing can reset the state from
the CLI, so the described route has never existed. Change an answer by editing
the config file directly. A real settings path is worth building and has not been
built.

---

## install

**What it does.** Builds the foundation. Explains what the six databases are and
what the five artifact types mean, asks the five things that are genuinely the
user's to decide, creates every database and every relation, and writes config.

**When it runs.** Once, at the start, and never on a schedule. Every skill in
every other foundation plugin routes here when the foundation's config is
absent; a job plugin initialises its own private config instead. **Setup is discovered at the
moment of need, never at install time**, because nobody reads the README.

**Re-running it on a complete config is refused**, and it does not fall through
to a settings path, because there is no settings path. See the note above. When
one is built, changing an answer will have to write to Notion, see "Renaming is
three operations" below, because config holding a name the workspace does not
have breaks every skill downstream.

**What it reads and writes.** Reads the Notion workspace to resolve the parent
page, the user's person id, and whether anything it is about to create already
exists. Writes six databases, every relation, one config file, and the artifact
types file. Writes no content rows.

### The order it runs in

**Step 0. Refuse to start without what it needs.** Three checks here and two more
once there is a parent to check, and **authenticating is only the first of
them.**

1. **The connection authenticates.**
2. **The client can actually do views.** Pinning `Notion-Version: 2025-09-03` or
   later pins the wire version, which is necessary and proves nothing about the
   installed client. **Check that the client exposes the view calls**, and pin a
   client floor in the plugin as well as a wire version. Calendar needs
   several views and every page template needs an embedded one, so discovering
   this halfway means an install that got most of the way and cannot finish.
3. **The capabilities setup actually uses are granted**, not just some of them.
   Creating databases needs insert. Filling properties needs update. Resolving the
   user needs user information. A connection with read alone authenticates
   perfectly and then fails on the first create.
If any of them fails, say exactly what to do about it and stop.

**Step 2a. The two parent checks, once question 1 has chosen one.**

4. **The chosen parent page is reachable by this connection.** An unshared parent
   returns not-found rather than forbidden, which reads as a typo and is not one.
5. **Nothing this install would create is already there**, which is the check that
   stops a second Process appearing.

**These two are not in step 0, and the reason is the order.** They used to be,
where they ran before question 1 had chosen a page, and on the default answer
they ran against a page that did not exist yet. Question 1 has two answers and
they take different routes: a page the user names is checked here, and a page
this skill creates is checked in step 5 by reading it back, where only check 4
means anything because a page one call old is empty by construction.

**Check 5 has one exception, and both halves of it are required.** A database
under the parent belongs to this install, rather than to somebody else, only when
`status.parentPageId` is the same page as the parent being checked and the
database and data source ids match `status.recordedIds`. Without that exception a
half-finished run's own databases read as a collision and every resume stops at
the door; without both halves of it, a stale config from an install into a
different workspace excuses a real one, because a title identifies nothing and
two workspaces can both hold a Process. Where nothing is recorded, which is the
ordinary first run, there is no exception and the check reads as written.

**Corrected 2026-08-18.** The order above, the exception, and the split between
the two routes. What made it necessary: question 1 could offer to create the
parent page, and nothing in the skill created one.

**Corrected 2026-08-17.** This previously checked authentication and a wire
version, and claimed to prevent partial installs. It could pass and then fail
halfway through phase A, which is the exact failure it existed to prevent.

**Step 1. Explain, before asking anything.** This is the plugin's one chance to
teach the model rather than impose it, and it is the only moment a user is
guaranteed to be paying attention. It covers:

- The six databases and what each holds.
- **The line between Memos and Process.** Memos is time-stamped
  communication and append-only. The Process is living reference that is
  maintained and kept true. Everything else follows from that, and someone who
  misses it will put status updates in the library and process documentation in
  memos.
- **The five artifact types**, each with what it is, when to reach for it, and the
  reader it is written for. Not a list of five names.
- Why the taxonomy is this shape, which is that four types describe how to do
  something and one describes why, so the others hang off it.

**The five types are fixed and setup says so plainly.** It does not offer to map
them onto a set the user already has. That offer was withdrawn on 2026-08-17
because the names are load-bearing in four places and nothing else in the plugin
could honour a different set.

**Step 2. Ask five questions and no more.**

| # | Question | Default |
|---|---|---|
| 1 | Which Notion page should everything be created under | Offers to create one called GTM Operator |
| 2 | Does anything need renaming for display | The shipped names |
| 3 | What are your segments | Enterprise, Mid-Market, SMB |
| 4 | How often should artifacts be reviewed by default | Quarterly |
| 5 | Do you have a call recorder connected | No |

Question 2 covers property names and value names, not just database names,
because the thing people most want to rename is `Strategy Decision`. **The meaning
is what stays fixed.** The label moves in Notion first and in config second, which
is a rename and not a config edit, see "Renaming is three operations" below. Question 3 is asked rather than assumed
because plenty of organisations segment by vertical rather than by size, which is
why the value list was made editable in the first place. Question 5 is only for
`backfill`, which is a later run, and setup asks now because it is the one moment
someone is thinking about their sources.

**Everything else is decided and setup does not ask.** Not which knowledge base,
because v1 is Notion only. Not which artifact types, because the five are fixed.
Not which databases, because it creates all six. Not the logical field names,
because the plugin owns those and an install that invents its own structure is an
install where `audit` and `find` can rely on nothing.

A setup that asks twenty questions gets abandoned partway, and the installs that
survive it all differ.

**Step 3. Work out who the user is, which is harder than it sounds.**

**There is no "current user" to look up.** A Notion internal connection is not
tied to the person running Claude Code. The API's self endpoint returns the
connection's own bot identity, and listing workspace users needs a capability that
may not have been granted and cannot be filtered by name or email.

**So identity is an explicit choice, in three tiers, in this order:**

1. **If the connection can list users**, show them and have the user pick
   themselves. Confirm the name.
2. **If it cannot**, ask them to paste their Notion profile link or id, and say
   where to find it.
3. **If neither works**, record that there is no person id, say so plainly, and
   **every person field stays empty from then on.** Empty is the honest value and
   it is already what `backfill` does everywhere in the marketplace.

**Tier 3 is a working install, not a failed one.** Six databases with correct
schemas and no owner recorded is far better than an install that stops, and far
better than one that guesses.

**So `personId` is nullable, and this is the rule every other plugin follows.**
Stated once here because it governs four skills in three plugins, and stating it
four times is how it drifts:

> **Every write to a person property is conditional on `personId`.** If it
> resolves, set the property. If config records that there is none, **omit the
> property entirely** rather than writing an empty value. No skill asks the user
> for it at write time, and no skill fails because of it.

This covers `Owner` and `Verified by` on Process, `Author` on Memos,
and every person field on Software and Tasks. **Where a skills file lists a person
field in its "always sets without asking" table, "always" means whenever there is
a person id**, and each of those tables now says so.

**Added 2026-08-17**, after review found tier 3 contradicted by three skills files
that wrote person fields unconditionally, and by `check` treating a deliberately
absent id as a failure. The fallback existed and nothing downstream knew about it.

**Corrected 2026-08-17.** This previously said to look the person up rather than
asking them to paste it, which assumed an identity the API does not provide.
`Owner`, `Author`, `Verified by` and every person field on Software and Tasks
depend on this, so it was most of the person-shaped design resting on something
that does not exist.

**A measurement is owed here**, alongside the Status property test: whether the
connection this design uses can list workspace users at all.

### Renaming is three operations, not one

Question 2 offers renaming, and the first draft of this file treated that as a
config edit. **It is not, and treating it as one breaks every writer**, because
config maps a logical name to the name in the workspace, and a config name that
does not exist in Notion produces a 400 or an unresolved property on the next
write.

Three separate operations, and each one belongs to a different skill:

| Operation | What it does | Who does it |
|---|---|---|
| **Adopt** | Point config at a property that already exists, resolved by its property id. Writes nothing to Notion | `check`, when somebody renamed something in the workspace |
| **Rename** | Change the name in Notion, then in config, in that order | `install` on a re-run, when the user asks for a different name |
| **Add an option** | Add a select or multi-select option to every data source carrying that field | `install` on a re-run, when the user changes their Segments |

**Changing Segments is the case that shows why this matters.** New values are not
a config edit at all. They are options that have to exist on four databases before
anything can write them, and removed values are options that still exist on rows.
**Setup never deletes an option that is in use**, it says which rows use it and
leaves it alone.

**One rule that would have caught the whole class:** config may never name a
property or an option that verification did not find in the workspace.

**Step 4. Show the whole plan and wait for one yes.** Every database, every
property, and where it is all going. The confirmation gate is hard, and anything
ambiguous counts as not yet confirmed. This is the same rule every other skill in
the marketplace follows.

**Step 5. Create, in two phases.** See "The creation order" below. This is the
part with the sharp edges.

**Step 6. Write config as it goes, not at the end.** Config carries a `state`
field. It reads `creating` from the first write until everything is verified, and
`complete` after. Each database id and data source id is written the moment it is
returned.

**This is what makes a failed install recoverable.** If setup dies after creating
four databases, the ids of those four are already on disk, and re-running resumes
rather than creating four more. An install that only writes config at the end
turns any interruption into a workspace with two Process Libraries in it.

**Step 7. Verify what it created, by reading it back.** Re-fetch every database.
Confirm every property exists with the right type, every select carries the right
options in the right order, and every relation points where it should. **Never
report success on something that was not read back.** A property that failed to
create is invisible until the first write fails, and the first write is somebody's
real artifact.

**Step 8. Say what to do next, not that it is done.** Point at
`process:backfill` to fill the library from material that already exists, or
`process:new` to write the first artifact by hand. "Setup complete" tells someone
nothing about what to do with an empty workspace.

**What it does not do.**

- **Does not write a single content row.** No samples, no examples, no welcome
  page. A sample row in a real workspace is never deleted, and it turns up in
  `find` results and `audit` reports forever. The library gets filled by
  `backfill`, which is the skill built for it.
- **Does not adopt a database the user already has.** v1 creates new ones.
  Mapping the logical fields onto somebody's existing library means guessing at a
  structure that cannot be tested, and a half-mapped install fails later and
  blames the plugin. Recorded as the largest thing v1 leaves out.
- **Does not create the embedded related views.** Most of them filter against the
  current page, so they cannot be built once and shared. The skill that writes a
  page builds its view. **Database-level views are the opposite case and setup
  does create them**, because they reference no page. Calendar carries most of
  them and it is the one database whose default table view is useless. **Its view
  manifest is the table in `plugins/calendar/SCHEMA.md`, which is the only place their
  number is stated**, so build from that rather than from a count written here.
  Setup also creates the **Needs attention** views below.

### The rules Notion cannot enforce, and where each one is caught

**Five rules in this design cannot be enforced by Notion**, and until 2026-08-17
the design stated them as if they could:

| Rule | Where | What Notion actually does | Caught by |
|---|---|---|---|
| A problem statement is required, attached as a memo | Projects | Nothing. A project can be saved with no memos at all | A `Needs attention` view, filtered on `Memos` being empty |
| `Project` is required | Tasks | Nothing. An orphan task is invisible from every project | A `Needs attention` view |
| `Date` is required at `Confirmed` and `Done` | Calendar | Nothing. A confirmed row can have no date | A `Needs attention` view |
| `Tags` capped at 3 | Process, Memos | Nothing. Multi-select has no maximum | `check`, step 8 |
| Only a Strategy Decision may be a parent | Process | Nothing. Any row can be any row's parent | `check`, step 8 |

The skills comply. A person clicking New in Notion does not, and that is the
common case, not the edge case.

**Setup creates a saved `Needs attention` view on the first three**, filtered to
the rows that break the rule. It costs nothing, it is visible to a person
without running anything, and it turns a rule nobody can enforce into one somebody
can see.

**Two of the three show exactly those rows. The Projects one is wider.** It shows
projects with no memos at all, where the rule is a project with no problem
statement memo, because narrowing it to the memo `Type` needs a filter that reads
through the relation and a rollup filter was measured on 2026-08-17 to be
accepted and then silently discarded. `scope` is what holds that rule exactly.

**The last two get no view, because Notion cannot filter for either of them.**
This was found on 2026-08-17, after the views had already been designed for all
five:

- **Counting tags.** A multi-select filter tests whether a value is present or
  absent. It has no count, so "more than three" cannot be expressed.
- **Reading the parent's type.** The `Type` being tested lives on the related
  page, and a filter cannot reach across a relation to read a property there.

**Both are reported by `check` instead**, which already queries every database and
already reports what it finds without fixing it. The cost is honest and worth
naming: a violation of those two is invisible until somebody runs `check`, where
the other three are sitting in Notion where a person will see them. **The
alternative was three new properties existing only to make a rule filterable**, a
counting formula on two databases and a copy of the parent's type on Process
Library, and adding fields to carry a rule is what rounds 2 and 3 both declined to
do elsewhere.

**Measured 2026-08-17 against a live workspace, and both limits are real.** A
throwaway database was created, both filters were attempted, both were rejected,
and it was deleted afterwards.

| Attempted | Result |
|---|---|
| `FILTER "Tags" > 3` | `400 validation_error`, `Operator ">" is not supported for multi_select properties` |
| `FILTER "Parent.Type" != "Strategy Decision"` | `400 validation_error`, `Could not find property with name or id "Parent.Type"`. There is no path syntax across a relation |

**The workarounds were measured too, and neither survives.** This matters because
the alternative to routing these two rules to `check` was adding properties to
carry them:

- **A formula counting tags came back typed as text**, so `> 3` was rejected with
  `Operator ">" is not supported for text properties`. Two attempts, including an
  explicitly numeric one.
- **A rollup of the parent's `Type` is worse than a failure.** The view was
  created, the call returned success, and **the filter was silently discarded**:
  the view came back with `filters: []`. A `Needs attention` view built that way
  would exist, look right in every listing, and match every row forever.

Formula and rollup columns are also returned under `notAvailableInQuerySql`, so
`check` could not read them even if they had worked.

**Both `check` queries then had the half that finds the rows proved on real
rows.** Counting tags with `json_array_length` returned exactly the four-tag and
five-tag rows and excluded the two-tag one. A self-join through the relation
returned the child of an SOP and not the child of a Strategy Decision. The
queries are recorded in `scripts/manifest.js`.

**What that measurement does not cover.** Both selected the title on the day
they were run and both select `url` now, so which column comes back was never
part of it, and the current strings have not been sent to Notion. The `WHERE`
half and the join are unchanged, which is the half the rows above prove. See
`DECISIONS.md`, 2026-08-19.

### An unsupported filter fails in two different ways, and only one is loud

**This is the finding worth carrying past this decision.** Two filters Notion
cannot express behaved completely differently:

- The multi-select and dotted-path filters were **rejected with a 400**.
- The rollup filter was **accepted, reported as created, and quietly emptied**.

Which one you get depends on the property type, and nothing in the response
distinguishes a view that kept its filter from one that threw it away.

**So step 7 is not a formality.** Reading back what was created is the only way to
tell those two apart, and a plugin that trusted the success of a create call would
ship a workspace full of views watching nothing. The ordinary select filter and
the relation `IS EMPTY` filter were both confirmed by reading them back, both
persist correctly, and that is why the three view-backed rules above are sound
rather than assumed.

**Everywhere else in the design, the wording changed from "required" to "required
by the skills, and surfaced when it is not"**, because that is what is true. The
one place still to carry the old wording, `plugins/projects/SKILLS.md`, was corrected on
2026-08-17.
- **Does not create Notion page templates.** See the build risks below; this is an
  assumption that needs measuring before anyone builds against it.
- **Does not delete or archive anything, ever**, including on a failed run. A half
  built workspace is cleaned up by a person who can see it.
- Does not write into the plugin cache, which is overwritten on update.
- Does not run unattended.

**The judgment it carries.** Three things.

1. **The teaching.** Whether someone finishes step 1 able to pick the right type
   for their first artifact. This is the only place in the marketplace where the
   model is explained rather than enforced, and every skill downstream assumes it
   landed.
2. **What to ask and what to decide.** Five questions is the design. Every
   addition to that list has to argue against the install that gets abandoned at
   question twelve.
3. **Telling a retry from a mess.** A failed create that can simply be run again
   is different from one that left a database with half its properties, and
   setup has to know which it is looking at before it offers to continue.

---

## check

**What it does.** Tells you whether the plugin can still see what it created, and
offers to repair the things it owns.

**Except the views.** The nine checks below do not include one, so a broken view
looks exactly like a healthy one from here. That is deliberate: the view name and
every property name inside a view's filters, grouping, sorts and rule SQL are
still the shipped ones, and resolving them through the config map changes what
gets SENT to Notion rather than what gets read back. `check` says this in its own
output every time it runs, rather than leaving somebody to find out. Views are
proved by `install`'s verify, which compares each one against the rows its rule
query returns.

**When it runs.** When something has stopped working. Also the first thing any
other skill should point at when a Notion call fails in a way that looks like
drift rather than like a bad request.

**What it reads and writes.** Reads config and all six databases. Writes only on
an explicit yes, and only to repair. Never touches a content row.

### What it checks

1. Config exists, parses, and is a version this plugin understands.
2. Every database id and every data source id still resolves.
3. The recorded data source still exists and still belongs to the recorded
   database. **A second data source appearing is a warning, never a failure.**
   Queries keep using the recorded one, correctly, and the user is told a new one
   appeared so they know why it is not being read.
4. Every logical field maps to a property that exists and has the right type.
5. **Every select and multi-select still carries the values the schema defines.**
   This one matters more than it looks. A missing option does not degrade the next
   write, it fails it outright with a 400, and takes the whole page with it.
6. **The user's person id still resolves, when there is one.** Config may record
   that there is none, which is tier 3 of the identity choice above and is a
   working install. **An absent person id is healthy and must not be reported as a
   failure.** A recorded id that no longer resolves is a real finding.
7. Every relation still points at the database it should.
8. **The two rules no view can watch.** Rows carrying more than three `Tags`, in
   Process and in Memos. Rows in Process whose `Parent` is
   not a Strategy Decision. Both are queried and counted here because Notion
   cannot filter for either, see the rules table above. **`check` reports them and
   never fixes them**, because both are content a person wrote and the line this
   skill holds is that it repairs what the plugin owns and never touches what the
   user wrote. A fourth tag is a judgment about which one to drop.

### What it repairs, on approval

- Points config at a property or database that was renamed in Notion.
- Re-adds a select option the schema defines and the workspace has lost.
- Re-adds a missing relation.
- Re-resolves a stale data source id.

**What it does not do.**

- **Never removes a select option somebody added.** Extra values are theirs.
- **Never renames anything in Notion.** It is the user's workspace, and the config
  map exists precisely so the plugin can adapt to their names rather than the
  other way round.
- Never touches content, and never fixes an artifact. That is `update`.
- Never deletes.

**The judgment it carries.** Whether a thing is missing or moved. A renamed
database and a deleted one look similar from the outside and the remedies are
opposite, so on anything ambiguous it stops and asks.

**Why `check` repairs when `audit` refuses to.** These look inconsistent and are
not. `audit` refuses to fix because fixing a document means deciding what it
should say, which is a judgment that belongs to a person. Re-adding a select
option the schema already defines is not a judgment, it is restoring something the
plugin owns. **The line is: repair what the plugin owns, never touch what the user
wrote.**

---

## add

**What it does.** Creates a foundation database that is not there, and wires it
into the ones that are.

**When it runs.** Three cases, and they are the reason this skill exists rather
than being folded into `install`:

1. A foundation plugin ships after somebody has already installed.
2. `install` died partway and left part of the foundation built.
3. Somebody deleted a database.

**What it reads and writes.** Reads config and the workspace. Creates the missing
database with its non-relation properties, then adds every relation that touches
it **exactly as the relation manifest defines it**, one-way or two-way, then
updates config.

**Not "in both directions", which was the wording here until 2026-08-17 and was
wrong twice over.** One relation in the design is deliberately one-way, so
building both sides would add a property the schemas do not have. And a two-way
relation in Notion is **one relation with a synced property**, not two relations,
so building it twice produces duplicates. `add` must produce a schema identical to
what `install` would have produced, and the manifest is the only thing that
guarantees that.

**What it does not do.**

- Does not re-create a database that exists.
- Does not migrate or move content.
- Does not create anything for a tier-two plugin, which own no databases.
- Does not repair a database that is present but wrong. That is `check`.

**The judgment it carries.** Whether the database is genuinely gone. Recreating
one that was only renamed or moved leaves the user with two, and their content in
the one the plugin has stopped looking at. Anything short of certain stops and
asks.

---

## The creation order

**Two phases, not six.** Every database is created first with its non-relation
properties only. Every relation is added afterwards, once all six ids exist.

```
Phase A   create six databases, non-relation properties, option order set
          1. Process
          2. Memos
          3. Projects
          4. Tasks
          5. Software
          6. Calendar

Phase B   add every relation, using the ids returned by phase A     
```

**The count lives in one place and this is not it.** The relation map below is the
manifest, and both the creation loop and the phase 7 verification derive their
count from it. Phase B said nine while the map held thirteen until 2026-08-17,
which is exactly the drift a manifest prevents.

**This generalises the two-stage rule in `plugins/process/SCHEMA.md` and replaces it.**
That rule said a self-relation needs a second call because the database id does
not exist until the database does. True, and the same is true of every
cross-database relation. Splitting by phase rather than by database means the rule
is applied once instead of being remembered six times, and there is no ordering
puzzle inside phase A because nothing in it refers to anything else.

**The order within phase A does not matter.** It is listed above in dependency
order only because that is how someone reading it expects to see it.

**Set the option order when the property is created.** Notion sorts a select by
the option order you arrange, and the schema files define that order. `Type` reads
broadest to narrowest and `L2C Lifecycle` runs 0 to 8. Getting it wrong is not
visible until somebody opens a grouped view.

---

## The relation map

Twelve relations across all six databases. This is the part most likely to be
built wrong, so it is written out rather than described.

**It was thirteen until 2026-08-18.** Projects carried a second relation to
Memos, `Problem Statement` / `Resulting Projects`, alongside the `Memos` one. It
was dropped in review because one relation between two databases is enough: a
project's problem statement is a memo reached through `Memos`, and the memo's
`Type` says which memo it is. The decision was applied to the test workspace by
hand at the time and reached no file here until now.

A Notion relation is either **two-way**, where Notion maintains a matching
property on the target database, or **one-way**, where only the source database
carries it. Which one is not a detail. A one-way relation cannot be shown as a
view on the target page.

| # | What it links | Source | Property there | Property on the target | Kind |
|---|---|---|---|---|---|
| 1 | A doc to its parent decision | Process | `Parent` | `Child Docs` | Two-way, self |
| 2 | A decision to the one it replaced | Process | `Supersedes` | `Superseded By` | Two-way, self |
| 3 | A memo to the one it corrects | Memos | `Corrects` | `Corrected by` | Two-way, self |
| 4 | A memo to what it is about | Memos | `Artifacts` | `Memos` | Two-way |
| 5 | A project to its updates | Projects | `Memos` | `Projects` | Two-way |
| 6 | A project to what it produced | Projects | `Artifacts` | `Projects` | Two-way |
| 7 | A project to its tasks | Projects | `Tasks` | `Project` | Two-way |
| 8 | A task to its parent task | Tasks | `Parent task` | `Sub-tasks` | Two-way, self |
| 9 | A tool to its documentation | Software | `Artifacts` | `Software` | Two-way |
| 10 | A tool to a tool it connects to | Software | `Integrates with` | none | One-way, self |
| 11 | A calendar row to its project | Calendar | `Project` | `Calendar` | Two-way |
| 12 | A calendar row to its playbook | Calendar | `Artifacts` | `Calendar` | Two-way |

**One relation runs from Projects to Memos, and it carries everything.**
`Memos` holds every memo about the project: the problem statement making the case
it was worth doing, the updates, and the releases. **The memo's `Type` says which
one it is**, and the related view on the project groups by it.

**Corrected 2026-08-17, then reversed 2026-08-18.**

On 08-17 there were two relations here. `Problem Statement` was one-way, on the
reasoning that Memos should not carry two properties pointing back at Projects,
and that was called wrong: the Problem Statement template promises a related view
of what was built in response, and a one-way relation populates nothing on the
memo. The fix made it two-way with `Resulting Projects` as its far side.

**On 08-18 the second relation was dropped entirely in review.** Two relations
between the same two databases meant two places to look and two places to get it
wrong. The concern that produced the 08-17 fix does not survive the removal,
because the relation that remains is two-way: a problem statement attached
through `Memos` shows its project under `Projects` on the memo. The trace is
intact and one relation carries it.

**Two properties pointing at the same database is fine when they mean different
things.** Refusing the second one cost the trace that a project cannot be scoped
without.

**Relation 2 is why `Superseded Strategy` got renamed.** Labelling both sides
means naming both sides, and one name cannot do it. The document doing the
replacing carries `Supersedes` and the one being replaced carries `Superseded By`.
Decided 2026-08-17. `plugins/process/SCHEMA.md` has been updated.

**Four databases point at Process and all four call it `Artifacts`.**
Memos, Projects, Software and Calendar each carry a property of that name, and the
library carries one back named after the database: `Memos`, `Projects`,
`Software`, `Calendar`. The
rule is worth holding on to, because it means somebody reading any schema can
guess the other side correctly.

**Relation 10 is the only one-way relation in the design, and it is on purpose.**
A two-way self-relation needs a different name on each side and connecting two
tools is symmetric, so there is no honest pair of names. The full blast radius
takes two reads instead of one. See `plugins/software/SCHEMA.md`.

**Relation 4 is two-way, decided 2026-08-17.** The memo carries `Artifacts` and
the artifact carries `Memos`. One-way would have worked for everything currently
specified, because `audit` and `find` both reach memos by querying Memos rather
than by reading the artifact. What one-way cost was the artifact page: somebody
reading an SOP could not see what had been announced about it. Changing this after
installs exist is a migration rather than an edit, which is why it was settled
before the build rather than after.

**Nothing writes `Child Docs`, `Corrected by`, `Superseded By`, `Memos`,
`Projects`, `Project` or `Sub-tasks`.** Notion maintains the far side of a two-way
relation itself. They are listed here so nobody goes looking for the skill that
fills them.

---

## The config file

One file at `~/.claude/gtm-operator.config.json`, for the whole foundation.

**Named for the marketplace, not for a plugin.** Separate per-plugin config
files would be that many chances for the foundation plugins to disagree about
which database is Process Library.

```
configVersion      the shape of this file, so check can refuse one it cannot read
state              creating | complete
notion
  apiVersion       PLANNED, NOT WRITTEN. `blank()` in `config.js` does not
                   emit this key and no client floor has a number anywhere in
                   this repository. It is in this table as the intended shape,
                   not as something a config will contain.
  parentPageId     where the six databases live
  personId         who the user is, for Owner, Author and Verified by.
                   Nullable. Null means tier 3 of the identity choice, and
                   every person write is skipped rather than emptied
databases
  <logical name>
    databaseId
    dataSourceId   both are stored, see below
    displayName
    properties     logical name -> the name in their workspace
    values         logical value -> the name in their workspace
defaults
  reviewCadence    Quarterly unless they said otherwise
sources
  callRecorder     what backfill may read, or nothing
taxonomyPath       where the artifact types file lives
```

**Store the data source id, not only the database id.** Since Notion's
2025-09-03 change a database can hold more than one data source, and querying,
creating pages and defining relation targets all need a `data_source_id`. Setup
resolves and stores both, and records which data source it chose, so a second one
appearing later does not silently break `new`, `find` and `audit`.

**Config holds identifiers. The Process holds judgment.** Database ids
and names go here. The rules an organisation decided live in the library as
artifacts, in a form both a person and a skill can read.

---

## The artifact types file

Setup writes `~/.claude/gtm-operator/artifact-types.md`, holding the explanation
of the five types that step 1 taught. Skills read it when helping somebody choose
a type.

**The path is config, which is the whole point.** It can be pointed at a file in a
team's git repository, and that is how a team shares one vocabulary and changes it
by pull request rather than by everybody editing their own copy.

**Setup never overwrites it.** If the file is already there, a team's version wins
and setup says it found one and left it alone.

---

## Build risks, in the order they should be measured

These are unverified. Every one of them can be settled by ten minutes against a
real workspace, which is what settled the select-value question on 2026-08-17
after two written sources had it wrong.

**1. RESOLVED BY MEASUREMENT, 2026-08-17. The API cannot create a Status property
with custom options.** A throwaway database created with a `STATUS` column came
back with Notion's three defaults and nothing else, and supplying options was
rejected both on creation and on alter. **Projects and Tasks now use `Select`**,
which all four databases already used, so the design got more consistent rather
than less. See `plugins/projects/SCHEMA.md` for the evidence.

**2. Can a database template be created through the API.** Not applied, created.
The schemas define a page body template per type, and if templates cannot be
created programmatically then setup does not create them and every skill writes
the body itself, which is what the skill specs already assume. The likely outcome
is that nothing changes.

**Reworded 2026-08-17** after review pointed at documentation for applying
data-source templates. Applying one is a different question from creating one, and
only the second matters here. Still unverified.

**3. The shared Notion code cannot actually be shared.** `DECISIONS.md` says the
Notion calls live in one file rather than being repeated across the skills, and it
also says skills that call each other must ship in the same plugin, because Claude
Code has no dependency resolution between plugins. Those two cannot both hold
across six plugins. The workable version is one source in the repository, copied
into each plugin at release by a script, with a test that fails when a copy has
drifted. Hand-maintained copies will diverge and the divergence will be silent.

**4. RESOLVED BY MEASUREMENT, 2026-08-17, and the answer depends on the
connection.** On the connection this design was tested against, asking for the
current user returned **a person with a name and an email, not a bot**, and
listing workspace users worked and returned both people and bots.

**So tier 1 of step 3 works, on at least one real connection path.** That
contradicts the review finding, which was correct about an internal integration
token and wrong about a user-authorised connector. Both kinds exist and a plugin
cannot tell which it has been given without asking.

**The three tiers stay exactly as written**, because the measurement proves tier 1
is reachable rather than proving it is universal. Assuming it always works would
be making the same mistake in the other direction.

**5. Creating six databases in one run may hit a rate limit.** Notion limits
request rate, and phase A plus phase B is a burst of schema writes. Setup should
handle a 429 by backing off and continuing rather than failing the install, and
step 6 writing config as it goes is what makes that survivable.

---

## Open

**Nothing about the relation map. It was closed on 2026-08-17**, when relation 4
was made two-way and supersession was given both its labels.

### The dependency this design creates

**All six schema files exist as of 2026-08-17.** Nothing in the foundation is
undefined, and this design is buildable once the three unresolved build risks
above have been measured. Five are listed and two were resolved by measurement on
2026-08-17.

Nothing in this file is blocked by that. The order, the phases, the relation map,
the config shape and the three skills are all defined. What is missing is the
field list for two of the six databases, which is the schema work, not the setup
work.

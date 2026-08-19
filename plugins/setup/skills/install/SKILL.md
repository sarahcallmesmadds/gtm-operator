---
name: install
description: Build the gtm-operator foundation in Notion. Creates every database the marketplace needs, wires the relations between them, builds the views, and writes the one config file every other plugin reads. Use on a first run, when another gtm-operator skill says config is missing, or when the user says "set up gtm-operator", "create the Notion databases", "install gtm-operator". Re-running it on a complete config is refused, because there is no settings path yet: change an answer by editing the config file.
allowed-tools: Write, Bash(node:*), mcp__*__notion-fetch, mcp__*__notion-create-pages, mcp__*__notion-create-database, mcp__*__notion-update-data-source, mcp__*__notion-create-view, mcp__*__notion-query-data-sources, mcp__*__notion-get-users
---

# install

Build the foundation. Explain what it is, ask the five things that are genuinely
the user's to decide, create everything, and write config.

**Nothing else in this marketplace creates a database and nothing else writes
config.** If you are reading this from another plugin, you are in the right place.

## How this skill works

**`scripts/install.js` decides what to send. You send it.** The Notion calls go
through the connected client, which a script cannot reach, so the script builds
every payload and checks every answer, and you make the calls in between.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/install.js" plan      # the whole run, in order
node "${CLAUDE_PLUGIN_ROOT}/scripts/install.js" phase-a   # what to create
node "${CLAUDE_PLUGIN_ROOT}/scripts/install.js" phase-b   # the relation statements
node "${CLAUDE_PLUGIN_ROOT}/scripts/install.js" views     # the view calls
node "${CLAUDE_PLUGIN_ROOT}/scripts/install.js" status    # where this run has got to
```

**Do not compose a statement, a filter or a count by hand.** Not the DDL, not the
`ADD COLUMN`, not the view `configure` string, not the number of anything. Every
one of them is generated, and every one of them has been checked against a live
workspace in a form the generator produces. A hand-written filter is how the
2026-08-18 measurement happened: `"today"` looks reasonable, parses, saves, reads
back correctly and matches nothing.

## Before anything: what this skill is allowed to do

**It writes to a real Notion workspace.** Creating databases is not reversible
from here: this plugin never deletes and never archives, on purpose, including
after a failed run. A half-built workspace is cleaned up by a person who can see
it. **On the default answer to question 1 it also creates one page**, the parent
everything else goes under, and that page is no more reversible than the rest.

So there is exactly one confirmation gate, at step 4, and it covers everything.
Do not create anything before it. Do not ask for a second yes after it.

---

## Step 0. Refuse to start without what it needs

Three checks here and two more in step 2a, once there is a parent to check.
**Authenticating is only the first of them**, and this step exists because an
earlier version checked authentication alone, passed, and then failed halfway
through creating databases, which is the exact failure it was meant to prevent.

**Nothing in this step depends on which page the user picks**, which is why the
two parent checks are not in it. They used to be, and that order could not work:
they ran before step 2 asked which page to use, and on the default answer they
ran against a page that did not exist yet.

1. **The connection authenticates.** Fetch `self`.
2. **The client can actually do views.** The pinned wire version proves nothing
   about the installed client. Check that the view calls are exposed. Calendar's
   views are most of what gets built, so discovering this halfway means an
   install that got most of the way and cannot finish.
3. **The capabilities this skill uses are granted**, not just some of them.
   Creating databases needs insert. Filling properties needs update. Resolving
   the user needs user information. **A connection with read alone authenticates
   perfectly and then fails on the first create.**
If any fails, **say exactly what to do about it and stop.** Do not offer to
continue with a subset.

## Step 1. Explain, before asking anything

This is the one chance to teach the model rather than impose it, and the only
moment a user is guaranteed to be paying attention. Every skill downstream
assumes it landed.

Cover, in this order:

- **Each database and what it holds.**
- **The line between Memos and Process.** Memos is time-stamped
  communication and append-only. The Process is living reference that is
  maintained and kept true. **Everything else follows from this**, and somebody
  who misses it will put status updates in the library and process documentation
  in memos.
- **The artifact types**, each with what it is, when to reach for it, and the
  reader it is written for. Not a list of names.
- **Why the taxonomy is this shape:** all but one type describe how to do
  something and one describes why, so the others hang off it.

**The types are fixed and say so plainly.** Do not offer to map them onto a set
the user already has. That offer was withdrawn because the names are load-bearing
in four places and nothing else in the marketplace could honour a different set.

## Step 2. Ask five questions and no more

| # | Question | Default |
|---|---|---|
| 1 | Which Notion page should everything be created under | Offer to create one called GTM Operator |
| 2 | Does anything need renaming for display | The shipped names |
| 3 | What are your segments | Enterprise, Mid-Market, SMB |
| 4 | How often should artifacts be reviewed by default | Quarterly |
| 5 | Do you have a call recorder connected | No |

Question 2 covers property and value names, not just database names, because the
thing people most want to rename is `Strategy Decision`. Question 3 is asked
rather than assumed because plenty of organisations segment by vertical rather
than by size. Question 5 is only for `backfill`, a later run, and it is asked now
because this is the one moment somebody is thinking about their sources.

**Everything else is already decided.** Not which knowledge base, because v1 is
Notion only. Not which artifact types. Not which databases, because it creates
all of them. Not the logical field names, because the plugin owns those.

**Every addition to this list has to argue against the install that gets
abandoned at question twelve.**

## Step 2a. Check the parent, now that there is one

**Question 1 has two answers and they take different routes**, so say which one
you are on before running anything here.

**If they named a page that already exists**, the two remaining preflight checks
run now:

4. **The parent page is reachable by this connection.** Fetch it. An unshared
   parent returns not-found rather than forbidden, which reads as a typo and is
   not one. Say which it is.
5. **Nothing this install would create is already there.** Fetch the parent and
   look. This is the check that stops a second Process appearing.

**What config already records for this parent is not a collision.** Run
`install.js status` alongside this. A half-finished run leaves databases under the
parent and a config naming them, and reading those back as things that are
"already there" stops every resume at the door.

**The exception is narrow and both halves are load-bearing.** A database under
the parent is this install's, rather than somebody else's, only when:

- **`status.parentPageId` is the same page as the parent being checked.** A
  config from an install into a different workspace records databases too, and
  without this it would excuse them here.
- **the id matches.** `status.recordedIds` carries the database and data source
  id for each one. A title does not identify anything: two workspaces can both
  hold a Process, and so can one page, and the name is what a collision looks
  like rather than what rules it out.

Anything failing either half is somebody else's and check 5 reads as written. If
`status` records nothing, all of it is.

If either fails, **say exactly what to do about it and stop**, the same as step
0. Do not offer to continue with a subset.

**Carry the id that fetch returned, not the text the user gave you.** People
paste a page as a url, and Notion has more url shapes than anything downstream
should have to know about, including public ones with a custom slug and no id in
them at all. The fetch turns any of them into the page's own id once, here. Every
later step, `begin` included, takes that.

**If they took the default and want the page created**, there is nothing to check
yet and nothing to create yet either, because creating it before the gate would
break the one rule this skill has about writing. Say that the page will be
created as the first act after the yes, and carry on to step 3.

**Only one of the two checks survives that route, and pretending otherwise is
worse than losing it.** Check 4 is proved in step 5 by reading the new page back.
**Check 5 is vacuous on a page you just created**: it is empty because it is new,
so it can never fail, and it is not what stops a second Process appearing here.
What stops that is the page being new, plus `begin` refusing to move an install
that has already recorded a parent. A retry after a half-finished run must reuse
the recorded parent rather than create a second page, and `install.js status`
says which page that is.

## Step 3. Work out who the user is

Harder than it sounds. **There is no "current user" to look up.** A Notion
internal connection is not tied to the person running Claude Code, so the self
endpoint may return the connection's own bot identity rather than the operator.

Three tiers, in order:

1. **If the connection can list users**, show them and have the user pick
   themselves. Confirm the name.
2. **If it cannot**, ask them to paste their Notion profile link or id, and say
   where to find it.
3. **If neither works**, record that there is no person id and say so plainly.

**Tier 3 is a working install, not a failed one.** Databases with correct schemas
and no owner recorded is far better than an install that stops, and far better
than one that guesses.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/install.js" person <id or nothing>
```

> **Every write to a person property, in every plugin, is conditional on
> `personId`.** If it resolves, set the property. If config records that there is
> none, **omit the property entirely** rather than writing an empty value.

Say that out loud to the user at tier 3, because it explains what they will see
later: owner fields that stay empty, and nothing broken.

## Step 4. Show the whole plan and wait for one yes

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/install.js" plan
```

That prints every database, every relation and every view, derived. Show it.
**It runs before anything exists**, which is the point: the ids in it are
placeholders until phase A fills them in.

**Say where it is all going, and whether that page exists yet.** `plan` does not
know which answer question 1 got, so name the parent page alongside it, and on
the default answer say plainly that the page itself gets created first, **by that
exact name, and ask here whether one by that name is already at the top level of
the workspace.** That is part of the gate rather than a sixth question, and it is
the only moment it can be asked: a page an earlier run created and never recorded
is invisible from this side, and identical to the one about to be made.

**Settle the answer before asking for the yes, not after it.** If there is
already a page by that name, find out whose it is here: an earlier run's, which
this one should use, or somebody else's, which means a different name agreed now.
The gate then names whichever it ended up with. A yes given to one page and acted
on against another is not the gate this skill claims to have. The yes
has to cover the page as well as what goes under it, because there is no second
gate to catch it.

**This is the only gate.** After the yes, run to completion or fail with a clear
account of what exists.

## Step 5. Create, in two phases and then the views

**First, if question 1 said to create the parent page, there is something to
check before creating it.**

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/install.js" status
```

**A recorded parent means resume, not create.** If `status` names a
`parentPageId`, an earlier run got as far as recording one. That is a returned id
that was written down, and not by itself evidence that a page is there, which is
why the fetch below still happens. Use that id,
and **skip only the create call and `begin`**. Creating another page here is how a
retry ends with two, the second recorded and the first abandoned, and `begin`
refusing afterwards does not undo the page it refused.

**A resume skips the create, never the proof.** Config records the id an earlier
run was handed; it does not record that anything was ever read back, and `status`
cannot tell you otherwise because it does not track it. A run that died between
`begin` and the fetch leaves exactly that: an id and no evidence. So a resume
still fetches the page and still reads it, below, before phase A. Skipping that
because a previous run got further is proceeding on the returned id alone, which
is the one thing this step exists to refuse.

**If the gate said a page of that name already exists**, do not create a second
one. Ask which it is. If it is the one an earlier run left behind, take its id
and treat it as a page they named: run step 2a's two checks against it and carry
on from `begin`. If it is somebody else's page that happens to share the name,
the answer is a different name, agreed with them now, and then the create below.

**Otherwise create it, at the top level of the workspace**, with the name they
agreed.
Not inside another page: the user who wanted it somewhere in particular answered
question 1 with that page, and this branch is the one where they did not.

Then, **before anything else, hand the id the create call returned to `begin`**:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/install.js" begin <parent page id>
```

That writes config with `state: creating`, before anything is created. A run that
dies from here on leaves a file that says so.

**Record first, prove second, and the order matters.** A returned id is not
evidence the page is right, but it is the only way back to a page that may now
exist and that this plugin cannot delete. Recorded, a run that dies before the
next line leaves a config naming it. Unrecorded, it leaves something nobody can
find, and the literal retry creates a second one.

**Then fetch the page back**, and only then go on to phase A. That fetch is what
proves check 4 on this route. If it fails, **stop, and say what is true and no
more**: a create call was sent, config records the id it returned, and whether a
page is there is exactly what could not be established. Do not report the page as
created. A create call returning is not evidence here either, and this is the
paragraph where it is most tempting to forget that.

**Read the fetch, do not just note that it returned.** Reachable is a weaker
claim than right: any id naming a page you can see comes back fine, including one
copied out of the wrong field. Two things have to hold:

- **The title is the name agreed at question 1.**
- **It has nothing in it.** Measured 2026-08-18: a page fetch lists its children,
  so an empty `content` is the evidence, and this is the same reading step 2a
  makes on an existing parent.

**Say what that pair proves, because it is less than it looks.** It rules out an
id that names something else entirely, which is the failure it was put there for.
It cannot tell the page you just made from an empty page of the same name left by
an earlier run, because those two are identical from here. That case is the one
the question above hands to the user, and it is the reason the question is asked
before the create rather than after it.

If either is wrong, **stop before phase A**. Nothing has been created under it
yet, which is the whole reason this check sits here. Say that config is naming a
page that is not the one this run meant to use and has to be moved aside before
another run, and say that a create call was sent for a page of the agreed name,
so there may now be one at the top level of the workspace to look for.

If they named an existing page in step 2, skip all of this: they have an id, it
was checked in step 2a, and `begin` takes it directly.

**One gap here does not close, and it is better named than papered over.** The
create call happens before anything can record it, so a run that dies between
sending it and `begin` leaves a page nothing here knows about. No ordering fixes
that, because the two systems cannot be written to at once. What makes it
survivable is the name: agreed at question 1, said out loud before the call, and
at the top level of the workspace. That is what `status` and the question above
are for, and they are the reason a second run does not quietly add a second page.

**Phase A. Every database, with no relations in it.**

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/install.js" phase-a
```

It reads the parent page id out of the config that `begin` just wrote, and puts
it in every create call. It refuses if `begin` has not run, rather than sending a
payload with a placeholder where the page id belongs, which is what it did until
2026-08-18.

Send each one as a create-database call, and after each, record what came back:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/install.js" record <key> <database id> <data source id>
```

**Both ids, every time.** The create response carries the data source id in its
`<data-source>` tag and the database id in its url. Views need the database id
and everything else needs the data source id, and a lookup later can return a
different answer than the one this run used.

**Phase B. Every relation, once every id exists.**

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/install.js" phase-b
```

One update-data-source call per database. **Why the split:** a relation needs the
id of the database it points at, and a self-relation needs the id of the database
being created. Neither exists until the database does.

**A two-way relation is one statement, and that includes a self-relation.**
Measured 2026-08-18: `ADD COLUMN "Parent" RELATION('<same ds>', DUAL 'Child
Docs')` creates both sides. The Notion tool's own documentation shows a
two-statement form for self-relations, and following it would build four
properties where the design wants two.

**Then the views, last.**

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/install.js" views
```

**Views come after phase B, not with phase A.** Two of them filter on a relation
property, which does not exist until phase B has run.

## Step 6. Verify by reading it back, and by the rows

**Fetch every data source and every database.** A database fetch also returns its
views, which is what the view half of this needs.

Write what came back into a file:

```json
{
  "databases": { "<key>": { "schema": { ... }, "views": [ ... ] } },
  "viewRows":  { "<key>::<view name>": ["https://app.notion.com/p/<32 hex page id>"] },
  "sqlRows":   { "<key>::<view name>": ["https://app.notion.com/<32 hex page id>"] }
}
```

**Page urls or page ids on both sides, never titles.** Record the `url` each
half returns. The view query and the SQL query hand back the same page in two
different url shapes and both are accepted. A title is refused outright, and the
verify will say so: titles are not unique, so two different rows sharing one used
to compare as the same row. Note this is the page's own `url`, not `public_url`,
which for a published page can carry a custom slug with no id in it at all.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/install.js" verify <that file>
```

**Reading the filter back is not enough, and this is the hardest-won thing in
this plugin.** Measured 2026-08-18: a view filtered on a relative date was
created, reported as created, read back with its filter intact and looking
perfectly correct, and returned no rows at all. A row four months in the future
did not appear. Nothing in the read-back distinguished it from the working
version.

**So each view is also proved by its rows.** Query the view itself, run the same
rule as SQL against the data source, and compare. `views.js` prints the SQL:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/views.js"
```

**Rows are compared by page identity, not by title.** The rule query selects
`url`, so supply page urls or page ids on both sides. Titles are not unique, and
two rows sharing one used to compare as the same row.

`verify` compares the two sets for you and reports `not proved` for any view
where you did not supply both, and for any view where the two sides both came
back empty. **Two empty sets prove nothing**: on a fresh workspace that is what
every filtered view looks like, and until 2026-08-18 it passed.

**`unchecked` is not a pass, and now it does not read as one.** `verify` exits
non-zero unless everything matched and everything was proved, and it records the
result itself. Nothing is recorded when anything is unproved, so `complete` has
nothing to accept.

## Step 7. Only then, say it is complete

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/install.js" complete
```

**It takes no timestamp.** It used to take the time of the verify that passed and
believe it, so any non-empty string stood in for a check that may never have run.
`verify` now records its own result, and only when it proved everything, and
`complete` reads that and nothing else.

`complete` refuses if a database is unrecorded, refuses if no verify has passed,
and `state: complete` is a claim that the workspace matches the manifest. **The
create calls returning without an error is a different and much weaker claim.**
Recording a database again after a verify throws the verify away, because the
proof was taken against what the config said at the time.

## Step 8. Say what to do next, not that it is done

Point at the first useful thing: writing a first artifact, or running `backfill`
if they said they have a call recorder. **"Setup complete" tells somebody nothing
about what to do with it.**

---

## What this skill does not do

- **Does not write a single content row.** No samples, no examples, no welcome
  page. An empty database is honest.
- **Does not adopt a database the user already has.** v1 creates new ones. This
  is the largest thing v1 leaves out, and it is deliberate: mapping onto somebody
  else's structure means guessing at something that cannot be tested.
- **Does not create the embedded related views**, the ones inside page bodies.
  Most filter against the page they sit on, so they cannot be built once and
  shared. The skill that writes a page builds its view.
- **Does not create Notion page templates.** Whether the API can create one, as
  opposed to apply one, is an open question. Treat it as unmeasured.
- **Does not delete or archive anything, ever**, including on a failed run.
- **Does not run unattended**, and does not write into the plugin cache, which is
  overwritten on update.

## The rules Notion will not enforce

The manifest lists them and records where each is caught: a saved `Needs
attention` view where Notion can express the filter, and `check` where it cannot.

**Two of them have no possible view, and both limits were measured on
2026-08-17.** A multi-select filter tests whether a value is present, not how
many there are, and a filter cannot reach across a relation to read a property on
the related page. Both were rejected with a 400. The workarounds were measured
too and neither survives: a counting formula comes back typed as text, and a
rollup filter is accepted, reported as created, and silently emptied.

## `In market` and `Upcoming` are narrower than the design asked for

`In market` and `Upcoming` were specified with a date window: the current month,
and dated in the future. **Neither can be built.** Notion's view DSL has no
relative date, and a literal one is accepted and matches nothing. Both were built
without the date clause, both are recorded in the manifest with a `reduced` note
saying why, and `Upcoming` now sorts a past-dated confirmed row to the top, which
is a row worth seeing rather than a row in the wrong place.

**This is a decision, not a workaround, and it is open.** If a relative date is
wanted, it has to come from somewhere other than a saved view.

## The judgment this skill carries

1. **The teaching.** Whether somebody finishes step 1 able to pick the right type
   for their first artifact. This is the only place the model is explained rather
   than enforced.
2. **What to ask and what to decide.** Five questions is the design.
3. **Telling a retry from a mess.** A failed create that can simply be run again
   is different from one that left a database with half its properties. Phase B
   works this out by reading rather than remembering: re-run it and only what is
   genuinely absent gets created. A relation that is present but wrong is
   reported and never added a second time, because adding it again makes a
   duplicate, and this plugin cannot delete one.

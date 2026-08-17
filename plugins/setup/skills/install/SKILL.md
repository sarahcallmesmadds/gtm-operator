---
name: install
description: Build the gtm-operator foundation in Notion. Creates every database the marketplace needs, wires the relations between them, and writes the one config file every other plugin reads. Use on a first run, when another gtm-operator skill says config is missing, or when the user says "set up gtm-operator", "create the Notion databases", "install gtm-operator". Re-running it on a complete config is the settings path: it creates nothing and offers to change the five answers.
allowed-tools: Read, Bash(node:*)
---

# install

Build the foundation. Explain what it is, ask the five things that are genuinely
the user's to decide, create everything, and write config.

**Nothing else in this marketplace creates a database and nothing else writes
config.** If you are reading this from another plugin, you are in the right place.

## Before anything: what this skill is allowed to do

**It writes to a real Notion workspace.** Creating databases is not reversible
from here: this plugin never deletes and never archives, on purpose, including
after a failed run. A half-built workspace is cleaned up by a person who can see
it.

So there is exactly one confirmation gate, at step 4, and it covers everything.
Do not create anything before it. Do not ask for a second yes after it.

## The manifest is the source of truth

Everything this skill creates is defined in `scripts/manifest.js`. Read it, and
derive from it. **Do not write a count, a database name, a property name or a
relation into your output by hand**, and do not carry one over from an earlier
run in the conversation.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/manifest.js" --summary
```

This is not a style preference. Three review rounds of the design found six
counts that had gone stale, every one of them a number somebody wrote in a
sentence beside the thing it counted, correct on the day and wrong a week later.
The manifest exists so there is one copy. Adding a second copy in the transcript
is the same bug in a shorter-lived medium.

---

## Step 0. Refuse to start without what it needs

Five checks. **Authenticating is only the first of them**, and this step exists
because an earlier version checked authentication alone, passed, and then failed
halfway through creating databases, which is the exact failure it was meant to
prevent.

1. **The connection authenticates.**
2. **The client can actually do views.** The pinned wire version proves nothing
   about the installed client. Check that the client exposes the view calls.
   Calendar's views are most of what gets built, so discovering this halfway
   means an install that got most of the way and cannot finish.
3. **The capabilities this skill uses are granted**, not just some of them.
   Creating databases needs insert. Filling properties needs update. Resolving
   the user needs user information. **A connection with read alone authenticates
   perfectly and then fails on the first create.**
4. **The chosen parent page is reachable by this connection.** An unshared parent
   returns not-found rather than forbidden, which reads as a typo and is not one.
   Say which it is.
5. **Nothing this install would create is already there.** This is the check that
   stops a second Process Library appearing.

If any fails, **say exactly what to do about it and stop.** Do not offer to
continue with a subset.

## Step 1. Explain, before asking anything

This is the one chance to teach the model rather than impose it, and the only
moment a user is guaranteed to be paying attention. Every skill downstream
assumes it landed.

Cover, in this order:

- **Each database and what it holds.**
- **The line between Memos and the Process Library.** Memos is time-stamped
  communication and append-only. The Process Library is living reference that is
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
than one that guesses. Write `personId: null` and move on.

> **Every write to a person property, in every plugin, is conditional on
> `personId`.** If it resolves, set the property. If config records that there is
> none, **omit the property entirely** rather than writing an empty value.

Say that out loud to the user at tier 3, because it explains what they will see
later: owner fields that stay empty, and nothing broken.

## Step 4. Show the whole plan and wait for one yes

Every database, every property, every relation, every view, and where they will
be created. Derived from the manifest, not typed out.

**This is the only gate.** After the yes, run to completion or fail with a clear
account of what exists.

## Step 5. Create, in two phases

**Two phases, not one per database.**

```
Phase A   create every database with its non-relation properties only
Phase B   add every relation, using the ids phase A returned
```

**Why the split.** A relation needs the id of the database it points at, and a
self-relation needs the id of the database being created. Neither exists until
the database does. Splitting by phase applies that rule once instead of
remembering it per database, and nothing in phase A refers to anything else in
phase A, so its order does not matter.

**A two-way relation is one relation with a synced property, not two.** Building
both sides produces duplicates. The manifest records which are two-way and names
the property Notion creates on the target.

**Set the option order when the property is created.** Notion sorts a select by
the order given. The schema files define it, `Type` reads broadest to narrowest
and `L2C Lifecycle` runs 0 to 8. **Getting it wrong is invisible until somebody
opens a grouped view.**

Then create the database-level views in the manifest. These reference no page, so
unlike the related views inside page bodies they can be built once, now.

## Step 6. Write config as it goes, not at the end

Config carries `state: creating` while work is in progress and `state: complete`
when it is done. **A run that dies halfway leaves a file that says so**, which is
what lets a retry tell itself apart from a mess.

Store **both** the database id and the data source id. A database can hold more
than one data source, and querying, creating pages and defining relation targets
all need the data source id. Record which one was chosen, so a second appearing
later does not silently break the plugins that read it.

## Step 7. Verify by reading it back

**Re-fetch every database and compare it to the manifest.** Property names, types,
option lists and option order, every relation and its direction, every view.

Do not report success from the fact that the create calls returned without error.
**A write that returned 200 and a workspace that matches the manifest are
different claims**, and only the second one is worth making.

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

Some rules in this design cannot be enforced by Notion, and until they were
written down the design stated them as if they could. The manifest lists them and
records where each one is caught: a saved `Needs attention` view where Notion can
express the filter, and `check` where it cannot.

**Two of them have no possible view.** A multi-select filter tests whether a value
is present, not how many there are, and a filter cannot reach across a relation to
read a property on the related page.

**Both limits are unmeasured.** They are read off how Notion filters behave and
have not been tested against a live workspace. If either turns out to be wrong,
the rule moves back to a view and only the manifest changes.

## The judgment this skill carries

1. **The teaching.** Whether somebody finishes step 1 able to pick the right type
   for their first artifact. This is the only place the model is explained rather
   than enforced.
2. **What to ask and what to decide.** Five questions is the design.
3. **Telling a retry from a mess.** A failed create that can simply be run again
   is different from one that left a database with half its properties, and this
   skill has to know which it is looking at before offering to continue.

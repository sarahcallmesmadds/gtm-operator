---
name: check
description: Tell the user whether gtm-operator can still see what it created in Notion, and repair the things it owns. Use when something that worked has stopped working, when another gtm-operator skill fails a Notion call in a way that looks like drift rather than a bad request, or when the user says "check gtm-operator", "is my setup still working", "something is broken in Notion". Reads config and all six databases. Writes only on an explicit yes, and only to repair.
allowed-tools: Read, Bash(node:*), mcp__*__notion-fetch, mcp__*__notion-query-data-sources, mcp__*__notion-update-data-source, mcp__*__notion-get-users
---

# check

Find out what has drifted, say it plainly, and repair only what this plugin
owns.

**The line this skill holds: repair what the plugin owns, never touch what the
user wrote.** Re-adding a select value the schema already defines is restoring
something the plugin made. Deciding which of somebody's four tags to drop is
not, and this skill will not do it.

## How this skill works

**`scripts/check.js` decides what to send. You send it.** The Notion calls go
through the connected client, which a script cannot reach, so the script builds
every call and judges every answer, and you make the calls in between.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/check.js" plan                       # what to fetch and query
node "${CLAUDE_PLUGIN_ROOT}/scripts/check.js" judge <readback.json>      # the findings
node "${CLAUDE_PLUGIN_ROOT}/scripts/check.js" repairs <readback.json>    # what a yes would do
node "${CLAUDE_PLUGIN_ROOT}/scripts/check.js" adopt <readback.json> <id>...
node "${CLAUDE_PLUGIN_ROOT}/scripts/check.js" send <readback.json> <id>...
node "${CLAUDE_PLUGIN_ROOT}/scripts/check.js" prove-adopted <readback.json> <id>...
node "${CLAUDE_PLUGIN_ROOT}/scripts/check.js" prove-sent <before.json> <after.json> <id>...
```

**Do not compose a query or a statement by hand.** Every one of them is
generated, including the two rule queries, which resolve the workspace's own
property and option names through the config map. A hand-written query asking
about the shipped names comes back with no rows on a renamed workspace, and no
rows is exactly what a healthy workspace looks like.

---

## Step 1. Run the plan and make the calls

`plan` lists what to fetch, in order, and what to record for each. Follow it
exactly, and record **all** of it:

- `found`: whether the database id resolved at all.
- `title`: what the database is called in Notion now.
- `dataSources`: every data source id on it, not only the recorded one.
- `schema`: the properties of the recorded data source.
- `person.found`: whether the recorded person id is still in the user list.
- `rules`: the rows each rule query returned, as page urls.

Write them into one file in the shape `plan` describes and pass it to `judge`.

**A key you leave out is not a pass.** Anything missing comes back as "not
checked", which is a different answer from "fine", and this skill keeps them
apart on purpose.

## Step 2. Report what came back, in three parts

`judge` gives three lists and they are not the same thing:

- **Broken.** Something this plugin created is not as it was.
- **Worth knowing.** Real, not a failure. A second data source appearing is the
  common one: queries keep using the recorded one, correctly, and the user needs
  to know that is why the new one is invisible.
- **Not checked.** Nothing came back to judge it with, so nothing is claimed.

Read all three to the user. **Never summarise the third as everything being
fine**, and never present a clean result as "everything is working": this skill
does not look at the saved views, and it says so in its own output every time.

## Step 3. Show what could be repaired, and get one yes per repair

`repairs` splits them, because the two kinds behave differently:

- **Config repairs send nothing to Notion.** The workspace is right and this
  plugin's record of it is wrong. Adopting a rename is the common one.
- **Workspace repairs send a statement.** Re-adding a lost select value, or
  rebuilding a relation whose two halves are both gone.

Each carries an id. Pass the ids the user approved and nothing else. **A missing
option value gets two repairs, `:renamed` and `:lost`**, because it was either
renamed or deleted, those need opposite answers, and choosing is the user's job.

**`repairs` does not print the statement for a workspace repair.** Get it with
`send`, which clears the proof before it hands the statement over, because from
that moment the workspace is about to stop matching what was verified. There is
no other way to obtain it, on purpose: a step that can be skipped is a step that
gets skipped.

**One statement here has never been measured.** The one that adds a lost select
value back is the only thing this plugin sends with no dated proof behind it,
and `send` labels it. Record what Notion actually does with it in `DECISIONS.md`
the first time it runs.

Anything ambiguous is in `withheld` with the reason. Read those out too. They
are not repaired and they are not nothing.

## Step 4. Prove the repair, do not assume it

**A call that returned without an error proves nothing here.** Notion accepts
some things it cannot do and discards them silently.

- After `adopt`, run `prove-adopted` on **the same read-back**. Nothing was
  sent, so there is nothing new to fetch, and fetching again would let a
  workspace that changed in between look like a record being corrected.
- After sending a statement yourself, fetch again and run `prove-sent` with both
  files. It passes only when the finding it was meant to clear is gone.

## Step 5. Say the install is no longer proved, and how to fix that

**Any repair, of either kind, clears the proof that this workspace matches the
manifest.** That is correct: what the proof was taken against has changed.

Two commands put it back, and both are needed:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/install.js" verify <readback.json>
node "${CLAUDE_PLUGIN_ROOT}/scripts/install.js" complete
```

`verify` restores completion by itself only when the install was still complete
when it started, and after a repair it is not.

---

## What this skill does not do

- **It does not rename anything in Notion.** It is the user's workspace. The
  config map exists precisely so this plugin adapts to their names rather than
  the other way round.
- **It does not remove a select value somebody added.** Extra values are theirs.
- **It does not touch a content row, and never deletes.**
- **It does not fix either rule violation.** Rows carrying more than three tags,
  and rows in Process whose parent is not a Strategy Decision, are counted and
  reported. Which of four tags to drop is a judgment about content somebody
  wrote.
- **It does not fix an artifact.** That is `update`.
- **It does not create a database.** A database missing from config is reported
  and pointed at `add`, which is not built yet.
- **It does not look at the saved views.** See below.

## Views are outside this skill, deliberately

The nine checks in `SKILLS-setup.md` do not include a view, and closing that gap
means carrying the name map into the view compiler, which changes what gets
**sent** to Notion rather than what gets read back.

So somebody can break a saved view and this skill will still pass. It says so
every time it runs. Do not soften that when reporting: a person who has just
been told everything is fine will not go and look at their views.

## The judgment this skill carries

**Whether a thing is missing or moved.** A deleted database and one renamed and
unshared look identical from outside and the remedies are opposite. Anything
ambiguous stops and asks rather than choosing, and the output gives both
readings rather than picking the likelier one.

The same judgment one level down decides a rename. A property the schema cannot
find, beside a property the schema does not know, of the right type, is a
candidate. One candidate is a proposal. Two is a question.

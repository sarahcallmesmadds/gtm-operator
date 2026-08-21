---
name: update
description: Change a row that is already on the GTM calendar, and capture how it went when it is finished. Use when the user says "move the webinar to the 20th", "that's confirmed now", "the launch is done", "cancel the dinner", "change the owner", or reports that something on the calendar happened. Re-runs the clash check whenever a date moves. Shows a before and after and writes nothing without an explicit yes.
allowed-tools: Write, Bash(node:*), mcp__*__notion-fetch, mcp__*__notion-query-data-sources, mcp__*__notion-update-page
---

# update

Change a row that already exists, and ask how it went when it is finished.

**On this database, edits vastly outnumber creates.** Dates move, statuses
advance, owners change. This skill runs constantly.

## How this skill works

`scripts/calendar.js` builds the queries and judges the answers; you make the
Notion calls. Same commands as `new`, and the same rule: **do not compose a query
or a property payload by hand**, because both resolve the workspace's own names
through the config map.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/calendar.js" context
node "${CLAUDE_PLUGIN_ROOT}/scripts/calendar.js" window <date> [<end date>]
node "${CLAUDE_PLUGIN_ROOT}/scripts/calendar.js" judge <merged.json> <window-rows.json>
node "${CLAUDE_PLUGIN_ROOT}/scripts/calendar.js" check <merged.json>
node "${CLAUDE_PLUGIN_ROOT}/scripts/calendar.js" update <before.json> <merged.json>
node "${CLAUDE_PLUGIN_ROOT}/scripts/calendar.js" prove-update <update-output.json> <readback.json>
```

**Use `prove-update` for an edit, never `prove`.** `prove` rebuilds what was sent
from the merged row alone, and a merged row has no record of a property that was
emptied. A clear that Notion failed to apply is invisible to it, so it reports a
successful write over a field that still holds its old value.

**Save what `update` printed.** `prove-update` takes that file, not the files
`update` was given. Rebuilding the payload from `before` and `after` a second
time looks equivalent and is not: passing the merged row as both removes every
clear from the rebuilt payload, and a read-back still holding the old value then
proves clean. The emitted payload is the only record of what was sent.

**Keep the row's url on the re-fetched page.** `prove-update` refuses a read-back
it cannot identify, and refuses one belonging to a different page.

**`update` takes two files, and both are required.** `merged.json` is the row as
it would be afterwards. A single merged row cannot say what used to be there, and
what used to be there is where the clears come from.

**`before.json` is a row in this plugin's own shape, not a Notion response.** It
is a flat object with the logical field names this skill uses: `Name`, `Type`,
`Status`, `Location`, `Owner`, `Segment`, and `date` in lower case holding
`{start}` or `{start, end}`. **NOBODY HAS MEASURED WHAT A REAL FETCH RETURNS**,
so there is no adapter here that turns a Notion page into this shape, and none of
the wording above should be read as one existing. Build `before.json` from the
row you read, field by field, and keep its `url`.

**Keep the row's `url` on both objects.** On the merged row it is how the clash
check knows not to report the row against itself, and without it every moved date
comes back clashing with the thing being moved. On `before.json` it is how
`update` names the page it is for, which is what binds `prove-update` to the
right row. **`update` refuses a before row with no url**, because a proof that
cannot say which page it checked is not a proof.

**Everything here judges the merged row, not the fields being changed.** Fetch
the row, apply the change on top of it, and pass the result. This is not a
detail: turning an Event into a Social post leaves `Our role`, `Format` and
`Location` behind, and checking only the submitted fields calls that clean.

**Do not use `create` for an edit.** It emits a `parent` and a note alongside the
properties, which is not the shape of an update call, and a payload built from
the fields that have values cannot express a field that lost one. Sent as an
update it leaves every emptied field exactly as it was, and `prove` then reports
a clean write because it compares only what a merged row can express. Corrected
2026-08-19: this page used to say to do exactly that, and `prove-update` now
exists because correcting the payload was not enough on its own.

---

## Step 1. Fetch the row and merge the change

Run `context`, then fetch the row. Build the merged version: the row as it would
be after the change, not the change on its own.

## Step 2. Is this an edit or a new row?

**Most are edits.** The exception is a thing that moved so far it is now a
different thing.

> A webinar postponed by four months, to a different audience, with a different
> topic, is a new row. The old one is `Canceled`.

Editing that row destroys the record that the first one was planned and dropped.
When it is genuinely borderline, show both readings and ask.

## Step 3. If the date moved, run the clash check again

**A moved date is a new clash check.** This is the most common way a conflict
gets introduced after everything looked fine: the row was clean when it was
created, and nothing re-examined it when it moved into a crowded week.

Run `window` on the new date and pass the rows to `judge`. **Show what the new
date now collides with, before writing.** The row will not surface against
itself.

**Never move a date without saying what that date now clashes with.**

## Step 4. If the type changed, say what that invalidates

**Do not change `Type` silently.** Changing a Social post into an Event changes
which fields mean anything.

`check` on the merged row reports any field that no longer fits. `update` reports
the rest: its `typeChange` says what the change invalidates with the current
values, and its `clearing` list says exactly what the call will empty and why,
separating a field a rule is clearing from one the user emptied themselves.

**Show what will be cleared, say so plainly, and ask.** The clears are in the
payload as explicit empty values, so they will happen. Do not leave stale values
behind and do not clear them without saying so.

## Step 5. Setting Status to Done triggers the debrief

**This is the design decision worth keeping.** Rather than a separate debrief
skill nobody would run, the moment a row is marked `Done` is the moment to ask
how it went, and to write the answer into the `How It Went` section.

**Two sentences is a good length.** What happened, and what you would change.

**Ask, and accept no as an answer.** If they decline, **write that the debrief
was skipped** rather than leaving the section absent. A blank section and a
deliberately empty one look identical afterwards, and only one of them is
information.

**Why it is attached to the status change.** A standalone debrief skill is run
once, enthusiastically, after the first event, and never again. Attaching it to
the status change means it happens at the one moment somebody is already touching
the row, which is the only reliable way to get a habit into a workflow people are
busy inside.

## Step 6. Watch the date rule

A date is required at `Confirmed` and at `Done`. `check` enforces it.

**`Canceled` does not require a date.** A canceled row promises nothing, so
asking when it happens reports a row that is not broken. If the row already had a
date, cancelling does not clear it.

## Step 7. Show a before and after, then ask

**Show the current values and the proposed values side by side**, including any
body section being rewritten, in full and inline. Show anything a type change
would clear.

**The confirmation gate is hard.** Write only on an explicit yes.

## Step 8. Write, then prove it landed

Send the update, re-fetch the page, and run `prove-update` with the file holding
what `update` printed. A call that returned without an error has proved nothing.

**`prove-update` reports what it did not check as well as what it did, and both
halves get shown.** It compares every property the update sent, including the
ones being emptied, by the type it sent them as, and it compares the section
headings. It does not read the body text back, so a heading with nothing under it
passes. Never round its answer up to "it worked".

**The read-back is `{url, properties, headings}`, in the shape the payload used,
and the `url` is required.** `prove-update` refuses a read-back it cannot
identify and one belonging to a different page.
That shape has not been measured against a real re-fetch either. If what comes
back does not look like it, say so rather than reshaping it until it fits.

**If a section did not write, write it again and say so loudly. Never report
success with a section missing.**

---

## What this skill does not do

- **Does not create.** That is `new`.
- **Does not move a date without saying what else that date now clashes with.**
- **Does not change `Type` silently.**
- **Does not delete a row for something that did not happen.** `Canceled` keeps
  the record, and a calendar with no cancellations in it is a calendar nobody
  trusts.
- **Does not invent a select value.** Fetch the live options first, the same as
  `new`.
- **Does not write `Owner` when config records no person and none was named.**
  The property is omitted, not emptied.
- **Does not turn a person's name into an owner.** `Owner` takes a Notion person
  id, or `me`. Search the workspace users for the name and pass the id back;
  passing the name is refused rather than sent. The `user://<id>` form a re-fetch
  returns is accepted as well, and written back bare.
- **Does not keep an owner nobody carried across.** `after.json` is the whole
  merged row, so an `Owner` missing from it is an owner being removed, and it is
  emptied and listed under `clearing` like any other cleared field. **Carry the
  existing owner across on every edit that is not about the owner**, or the date
  change that prompted it takes the owner off the row. Sending `me` sets it to
  the configured person on an update the same as on a create.
- **Does not write the `Project` or `Artifacts` relations.** Nothing in this
  plugin writes a relation yet.

## The judgment this skill carries

**Whether a change is an edit or a new row.** Most are edits. The one that is not
is the thing that moved so far it became something else, and getting that wrong
destroys a record rather than updating one.

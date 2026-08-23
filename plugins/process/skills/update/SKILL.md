---
name: update
description: Change an artifact that already exists in the Process library. Use when a document is wrong, out of date, or has been flagged by `audit`. Asks separately whether the edit counts as having re-read the artifact, and only then moves the verification fields. Triggers on "update this SOP", "fix that artifact", "this document is wrong", "mark this as reviewed".
---

# update

Changes an artifact that already exists. Most changes to a library are edits
rather than creates, and the natural path runs `audit` to here.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/process.js" context
node "${CLAUDE_PLUGIN_ROOT}/scripts/process.js" update <before.json> <after.json> [YYYY-MM-DD]
node "${CLAUDE_PLUGIN_ROOT}/scripts/process.js" prove-update <update.json> <readback.json>
```

**Do not build a property payload by hand.** It resolves the workspace's own
property and option names through the config map. A hand-written payload
carrying the names this plugin shipped with writes to properties that do not
exist on a renamed workspace.

---

## Step 0. Refuse to start without config

Run `context`. If it refuses, print what it said and stop.

---

## Step 1. Fetch the artifact and keep its url

Fetch the page and save it as `before.json` **with its `url` on it**. Without the
url nothing can say which page the update is for, and `update` refuses rather
than writing to a page it cannot name.

---

## Step 2. Ask the one question that cannot be inferred

**Does this edit count as having re-read the artifact for accuracy?**

Ask the person. Do not decide it from how large the edit looks.

- **Yes.** `Last checked for accuracy`, `Verified by` and `Verified date` all
  move to today.
- **No.** None of them move.

Put the answer on `after.json` as `"reviewed": true` or `"reviewed": false`.
**`update` refuses if it is missing**, and that refusal is deliberate: a missing
answer and "no I did not re-read it" are different, and only one of them is a
decision somebody made.

**Why this matters more than it looks.** `Last checked for accuracy` is what
drives the staleness check. Stamping it on an edit that was not a review makes a
stale document look freshly checked, and nothing downstream can tell. Leaving it
alone on a real review only means the artifact stays flagged, which a person can
see and fix.

---

## Step 3. Write the after artifact and run `update`

`after.json` is the artifact as it would be, plus `reviewed`. Only fields that
actually differ are sent.

**A property-only edit needs no body.** Leave `body` out entirely when changing a
status, a tag or an owner. Anything you do not send stays as it is on the page.
A section you DO send has to be filled, because a heading sent with nothing under
it is how a section gets emptied by accident.

**Clearing a person clears it.** Set `Owner` to null to empty it. It will not
quietly become whoever installed the plugin.

Then show the person, before anything is written:

- **`changed`** and the values either side.
- **`clearing`**, if anything is being emptied. An emptied property goes as an
  explicit empty value, because leaving it out means the write does nothing and
  the old value survives while the person is told it was saved.
- **`archiving`**, if `Status` is becoming `Archive`. **Never archive without a
  yes.**

---

## Step 4. Send it, then prove it

Send the properties to the page named by `target`. Then re-fetch the page,
keeping its url, and pass **the output of `update`** and the re-fetched page to
`prove-update`.

**Not the two files you started with.** A payload rebuilt from a merged row has
no record of what was emptied, so a clear that silently failed would read as a
clean write.

`prove-update` says what it did not check, every time, including when it passes.
Report that alongside the result rather than reporting a clean write.

---

## What this skill does not do

- **Does not create.** That is `new`.
- **Does not archive without asking.** It flags the archive and waits.
- **Does not touch Memos.** Memos is append-only, and a correction there is a new
  memo rather than an edit.
- **Does not rewrite a body wholesale when a section is what changed.** Send the
  sections that changed. Rewriting the whole body loses the wording of
  everything else.
- **Does not write the `Parent` or `Supersedes` relation.** Neither is built in
  this version. Say so rather than letting a link read as set.
- **Does not decide whether this is an edit or a replacement.** A Strategy
  Decision that now reaches a *different* conclusion on the *same* problem is
  not an edit: editing it destroys the record of what was previously decided and
  why. That is a person's call, and `new` is where a replacement starts.

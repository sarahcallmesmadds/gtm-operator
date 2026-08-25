---
name: update
description: Change the facts on a tool that is already in the Software directory, one row at a time. Use when the user says a vendor was acquired or renamed, a contract was extended, the cost moved, the owner left, a tool was dropped, or "update the row for". Never moves Last reviewed; shows a before and after and writes nothing without an explicit yes.
allowed-tools: Write, Bash(node:*), mcp__*__notion-fetch, mcp__*__notion-query-data-sources, mcp__*__notion-update-page
---

# update

The facts that changed, written down at the moment somebody is willing to
write them down, with no four-group sweep in the way.

## How this skill works

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/software.js" update <changes.json> <existing.json>
node "${CLAUDE_PLUGIN_ROOT}/scripts/software.js" prove-update <output.json> <readback.json>
```

Fetch the row and save the whole page. `changes.json` carries only what
changed: a field absent is untouched, a field explicitly empty is a clear.
Preview the before and after inline and write only on an explicit yes.

---

## The judgment: is this still the same thing

Three cases arrive looking identical and only one of them is an edit.

1. **A rename is an edit.** Same contract, same spend, same seat, new word.
   One row. The whole rename is two things: the page name, and the URLs.
   An acquired product moves domain, so ask about `Login`, `Documentation`
   and `Status page` in the same pass. Nothing else moves; an acquisition
   does not change terms already signed, and the new terms arrive at the
   next renewal. **No former name is kept** — Sarah's call, 2026-08-18 — and
   the accepted cost is that a backfill re-run meeting an invoice under the
   old name offers it again, which is one "no" at the approval gate.
2. **A replacement is two operations.** The old row goes to `Retired` here,
   and the new tool goes through `new`, because it has its own contract, its
   own owner and its own answers to the security group. Editing the old row
   into the new tool destroys the record that you ever paid for the first
   one.
3. **A merge is a retirement plus an edit.** The absorbed row goes to
   `Retired`, the surviving row picks up whatever it now covers, and **the
   spend lands on one of them and not both**, or `contracts` reports a
   renewal that nobody owes.

## The rules the script holds

- **`Last reviewed` never moves here.** Not on a rename, not on a cost
  change, not on a retirement. It moves at creation and on a confirmed
  `review`, and an edit that resets it suppresses the staleness warning for
  a whole cadence period. This deliberately diverges from `process:update`,
  where an edit can count as a re-read on an explicit yes: a software review
  goes to the contract in Drive and to whether the tool is actually
  connected, and no edit does that by accident. `review` is the sweep.
- **An owner who left is cleared or replaced by name, never guessed.** Pass
  the field as empty to clear it. The script sends the measured clear shape
  for each type — a person clears with an empty list, and a null there is
  accepted while the old person stays — and `prove-update` is what catches a
  clear that did not land.
- **A tool that is gone goes to `Retired` and the row stays**, which keeps
  the record of what was dropped. Nothing here deletes or archives.
- **It changes what it was asked to change and leaves the rest alone**,
  including the parts that are visibly stale. Fixing a cost is not a licence
  to tidy the security group; offer `review` instead.
- **One section at a time.** A body edit replaces the named sections, never
  the whole body.

## Then prove it

Send the update, re-fetch the page, and run `prove-update` with the
command's own output. A call that returned without an error proves nothing,
and a clear in particular is proved by the property coming back empty.

---

## What this skill does not do

- **Does not create a row.** That is `new`.
- **Does not stamp `Last reviewed`, ever.** It moves at creation and on a
  confirmed `review`, and nowhere else.
- **Does not delete anything.**
- **Does not fill a person field the user did not name.**
- **Does not re-confirm the rest of the row.** That is `review`, and the
  friction of confusing the two is exactly what this skill exists to remove.

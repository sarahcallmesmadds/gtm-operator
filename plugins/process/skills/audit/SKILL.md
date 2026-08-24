---
name: audit
description: Tells you which artifacts in the Process library have gone stale, contradict each other, or were never verified. Reads only and writes nothing; it produces a list and hands it to `update`. Triggers on "audit the library", "what needs reviewing", "what has gone stale", "which docs are out of date", "what has nobody checked".
---

# audit

Tells you which artifacts need a person to look at them. **It reads only and
writes nothing at all**, in this version and by design.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/process.js" context
node "${CLAUDE_PLUGIN_ROOT}/scripts/process.js" audit
node "${CLAUDE_PLUGIN_ROOT}/scripts/process.js" flags <artifacts.json> <memos.json> [YYYY-MM-DD]
```

**Nothing schedules this.** There are no unattended runs in this version.
`Review cadence` is a field this reads to decide what to flag, not a trigger that
fires it.

---

## Step 0. Refuse to start without config

Run `context`. If it refuses, print what it said and stop.

---

## Step 1. Run both queries

`audit` returns two. Run both.

**The memo query is not optional.** It is the only source for the strongest of
the four signals. If you skip it, three signals run, the fourth silently finds
nothing, and the report looks complete. Pass an empty list only if the query
genuinely returned nothing, and `flags` will say in its output that no memos were
read so the difference is visible.

**Only Published memos count.** A draft was never announced and a canceled one
was retracted, so neither should send anybody to re-read an artifact. The query
filters on it and `flags` checks again on the rows it is given.

**The memo query reads Memos, not the artifact's own relation.** Reading a
page's relation returns at most 25 references and a relation value caps at 100
pages, so on any long-lived artifact the newest memo becomes invisible and this
signal degrades to nothing without a word.

---

## Step 2. Run `flags` and report what it found

Four signals, and every one of them names a document for a person to look at.

| Signal | What it means |
|---|---|
| `past-cadence` | Last checked is older than the artifact's review cadence |
| `memo-newer` | A memo was published about this after the last check, so something was announced that nobody folded in |
| `never-verified` | `Verified by` is empty, so nobody is recorded as having read it |
| supersede candidates | Two Active Strategy Decisions look alike |

**`never-verified` exists because `past-cadence` cannot catch it.** An empty date
matches no "before" filter in Notion, so a backfilled artifact escapes the
staleness signal entirely. Do not assume the first signal covers everything.

**Supersede candidates are candidates.** Never act on one. Two Active Strategy
Decisions looking alike is a question for a person, because archiving the wrong
one destroys a live document. Show both and ask.

The similarity threshold is **not calibrated**, and the output says so every
time. Treat the candidate list as something to read, not as a verdict.

---

## Step 3. Hand it to `update`

Each flagged artifact goes to `update`, which asks separately whether the edit
counts as having re-read it.

---

## What this skill does not do

- **Never fixes anything.** It writes nothing at all.
- **Never rewrites a body.**
- **Never archives.**
- **Never reports drift as a decision to make.** It reports documents that need a
  person to look at them.
- **Does not run itself.** A person runs it.

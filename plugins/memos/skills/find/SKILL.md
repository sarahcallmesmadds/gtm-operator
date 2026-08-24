---
name: find
description: Find what was said about something and when, in the Memos log, following corrections to the end of the chain. Use when the user asks "what did we announce about", "when did we decide", "was there a memo on", "what was said about", "did anyone send an update on", or asks a question the log might already answer. Reads only. Never edits, never creates.
allowed-tools: Write, Bash(node:*), mcp__*__notion-fetch, mcp__*__notion-query-data-sources
---

# find

Answer the question, name the memos you answered from with their dates, and
serve the correction rather than the corrected.

**The line this skill holds: a log that serves a superseded record silently is
worse than one with no answer**, because the reader has no way to know. The
`Corrects` relation earns its place at read time, here.

**This is the skill people use most, so it has to be the least ceremonious.**
No confirmation gates, no previews, no forms. Ask, answer, caveat.

## How this skill works

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/memos.js" context
node "${CLAUDE_PLUGIN_ROOT}/scripts/memos.js" find <question.json>
node "${CLAUDE_PLUGIN_ROOT}/scripts/memos.js" chain
node "${CLAUDE_PLUGIN_ROOT}/scripts/memos.js" follow <rows.json> <memo-url>
```

**Do not compose the query by hand.** It resolves the workspace's own property
and option names through the config map, and a query carrying shipped names
comes back with no rows on a renamed workspace, which reads exactly like
nothing having been said.

---

## Step 0. Refuse to start without config

Run `context`. If it refuses, print what it said and stop.

---

## Step 1. Narrow by what the memo is, not by its words

Write what you know to a file. All optional:

```json
{ "Type": "Release", "Domain": "Deal Execution" }
```

**Type, Domain and Published date are the judgment, not text matching.** The
rows come back newest first. Text matching alone finds the memo that uses the
same words, which is not the same as the one that answers the question. When
you are not sure of the Type, do not filter on it: a filter that excludes the
right answer is worse than a longer list, because nothing tells you it
happened.

**Drafts and canceled memos are excluded by default, and the result says so.**
Say it when reporting: a draft was never announced and a canceled memo was
retracted. Pass `includeCanceled: true` when the question is about what was
retracted, which is a real question.

---

## Step 2. Follow the corrections

**Before answering from any row whose `Corrected by` column is not empty**, get
the whole table and walk the chain:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/memos.js" chain
node "${CLAUDE_PLUGIN_ROOT}/scripts/memos.js" follow rows.json <the memo's url>
```

`chain` is deliberately unfiltered: a correction chain crosses types, domains
and statuses, and a chain followed through filtered rows ends wherever the
filter ran out.

`follow` walks to the most recent correction and says how many versions it
passed. **What it reports, it never resolves:**

- **A branch** — one memo corrected twice independently — is a real
  disagreement between two people. Show both corrections. Picking the newer
  silently is how a log starts lying.
- **A cycle** is shown with the memos in it, and no place to break it is
  chosen.
- **A memo correcting several** is shown with all its targets, and no path is
  picked.

**A chain ending in a canceled memo means the most recent word was retracted.**
The output flags it; say it.

---

## Step 3. Answer

1. The answer, in your own words, from the memo.
2. The memo it came from, by name, with its link and its published date.
3. The correction caveat in the same breath: "corrected on `<date>`, this is
   the current version, an earlier one exists", or the violation `follow`
   reported, shown rather than resolved.

**When nothing answers it**, say what was searched: which Type and Domain
filters were applied and that drafts and canceled memos were excluded.
"Nothing found" and "nothing found in the half of the log I looked at" are
different answers.

**When several memos could answer it**, name the best one by Type, Domain and
date, and say the others exist. Do not return a wall of results.

---

## What this skill does not do

- **Does not edit and does not create.** Reads only. A wrong memo is corrected
  by a new memo, through `new`.
- **Does not pick between branched corrections.** It shows both and says why.
- **Does not judge staleness.** A memo cannot go stale: it records what was
  said on a date, which is why there is no audit in this plugin. The only
  freshness question is whether something later corrects it, and that is
  Step 2.

---
name: find
description: Find the artifact in the Process library that answers a question, and say whether it is still worth trusting. Use when the user asks "do we have a doc on this", "what's our process for", "where's the SOP for", "how do we handle", "what did we decide about", or asks a question the library might already answer. Reads only. Never edits, never creates.
allowed-tools: Bash(node:*), mcp__*__notion-fetch, mcp__*__notion-query-data-sources
---

# find

Answer the question, name the artifact you answered from, and say whether it can
be trusted.

**The line this skill holds: a library that serves a stale document silently is
worse than one with no answer**, because the reader has no way to know. So the
trust judgment goes in the same breath as the answer, never as a footnote and
never on request.

**This is the skill people use most, so it has to be the least ceremonious.** No
confirmation gates, no previews, no forms. Ask, answer, caveat.

## How this skill works

**`scripts/process.js` decides what to send. You send it.**

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/process.js" context
node "${CLAUDE_PLUGIN_ROOT}/scripts/process.js" find <question.json>
node "${CLAUDE_PLUGIN_ROOT}/scripts/process.js" trust <rows.json> [YYYY-MM-DD]
```

**Do not compose the query by hand.** It resolves the workspace's own property
and option names through the config map, and a query carrying the names this
plugin shipped with comes back with no rows on a renamed workspace. No rows is
exactly what an empty library looks like, so the failure is silent and reads as a
clean answer.

---

## Step 0. Refuse to start without config

Run `context`. If it refuses, print what it said and stop.

---

## Step 1. Narrow by what the artifact is, not by its words

Write what you know about the question to a file. Any of these, all optional:

```json
{ "Type": "SOP/ROE", "Domain": "Deal Execution", "includeArchived": false }
```

Then:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/process.js" find question.json
```

**Type and Domain are the filters, not text matching.** Which artifact actually
answers the question is your judgment, made over the rows that come back. Text
matching alone finds the document that uses the same words, which is not the same
as the one that answers the question.

**Audience is a filter you apply, not one the query applies.** You may put it in
the question file and it is read straight back to you under `audience`, but it
does not narrow the SQL, because no multi-value filter has been proved against
this workspace. When you send one, the rows that come back are wider than you
asked for. Narrow them yourself, and say in your answer that you did.

**Working out the Type from the question is half the job:**

| The question sounds like | The type |
|---|---|
| "why do we do it this way" | Strategy Decision |
| "what's the process for" | SOP/ROE |
| "how do I" | Enablement |
| "what does this number mean" | Reporting |
| "how is this wired" | Technical Reference |

**When you are not sure, do not filter on Type.** A filter that excludes the
right answer is worse than a longer list, because nothing tells you it happened.

**Archived artifacts are excluded by default, and the result says so.** Say it
when reporting. Their absence must not read as nothing existing.

---

## Step 2. Judge whether it can be trusted

Pass the rows back:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/process.js" trust rows.json 2026-08-23
```

**Five states, and three of them are not "fine":**

| State | What it means | What to say |
|---|---|---|
| `fresh` | Checked inside its cadence | Nothing extra needed |
| `due` | Past its review cadence | "This is N days past its review cadence" |
| `exempt` | Cadence is `None` or `On change only` | Nothing time-based applies. It is not "fresh", it has opted out |
| `unknown` | Never checked, or the cadence or date cannot be read | **Say the answer may be stale and nothing can tell you.** This is the state that matters most |

**`unknown` is not `fresh`.** An artifact that has never been checked is the one
most likely to be wrong, and reporting it as fine is the exact failure this skill
exists to prevent.

**A newer related memo is the other staleness signal**, from `SKILLS-process.md`.
Memos is a separate database and this version does not query it, so **say that
gap out loud** rather than implying the trust judgment is complete: the cadence
was checked and related memos were not.

---

## Step 3. Answer

**Answer the question. Do not return a wall of results.**

The shape:

1. The answer, in your own words, from the artifact.
2. The artifact it came from, by name, with its link.
3. The trust caveat, if there is one, in the same breath.

**When nothing answers it**, say so plainly and say what was searched: which
Type and Domain filters were applied, and that archived artifacts were excluded
if they were. "Nothing found" and "nothing found in the half of the library I
looked at" are different answers.

**When several artifacts could answer it**, name the best one and say the others
exist. Do not list all of them and leave the choice to the reader, which is what
this skill exists to save them.

---

## What this skill does not do

- **Does not edit and does not create.** Reads only. If the answer is wrong or
  missing, `new` writes one and `update` fixes one, and `update` is not built
  yet.
- **Does not query Memos**, so the newer-related-memo signal is unavailable. Say
  so rather than reporting a complete trust judgment.
- **Does not rank by text similarity.** The rows come back and the judgment is
  yours, made on Type, Domain and Audience and on reading them.

---
name: problem-statement
description: Write the case that something is worth fixing, before anyone proposes a fix, as one Problem Statement memo in the Memos log. Use when the user says "write the problem statement", "write up this problem", "make the case for fixing this", when problem-scan hands one over, or before scoping anything. No project needs to exist. Writes one page and its body, nothing without an explicit yes, and never edits anything.
allowed-tools: Write, Bash(node:*), mcp__*__notion-fetch, mcp__*__notion-query-data-sources, mcp__*__notion-create-pages, mcp__*__notion-update-page
---

# problem-statement

The case that something is worth fixing, made before anyone proposes a fix.

**The line this skill holds: a problem with no evidence cannot be weighed
against any other problem.** The Evidence section is never left blank, and the
whole point of writing the statement down is to make that comparison possible.
It is the input to `scope`, and scoping something whose stakes were never
written down is how teams build the wrong thing carefully.

## How this skill works

**`scripts/projects.js` decides what to send. You send it.** The memo shapes
are the same vendored builder the `memos` plugin runs, so the two plugins
cannot disagree about what a Problem Statement looks like.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/projects.js" memo-check <proposed.json>
node "${CLAUDE_PLUGIN_ROOT}/scripts/projects.js" memo-create <memo.json>
node "${CLAUDE_PLUGIN_ROOT}/scripts/projects.js" memo-prove <memo.json> <readback.json> <created-url>
```

**Do not build a property payload by hand**, and **never invent a select
value**: fetch the property's current options from Notion before choosing any
value. Notion refuses an unknown value with a 400 that loses the whole page.
If config is absent, the script refuses and names `setup`; print what it said
and stop.

---

## Step 1. Is there enough here to be worth writing

The judgment this skill carries. Evidence means numbers where they exist, and
where they do not, **what was observed and how often**. Every line names its
source: the channel and date for a quote, the report or file for a number,
the person's role. A section also names what is missing and why that absence
matters, because a gap in the evidence is often the finding.

---

## Step 2. Draft, in the Problem Statement template

Type is `Problem Statement`, and this skill writes no other. The sections, in
order: **What This Blocks, What's Happening, Who Feels It, Evidence, Cost Of
Doing Nothing**, Sources conditional and last.

- **What This Blocks leads** and carries four things: the goal at risk, where
  it stands, who owns it, and the dated decision it holds up. Without the
  dated decision the problem has no urgency and sits unread.
- **What's Happening carries no solution.** A problem statement with a fix
  inside it has already skipped the argument it exists to make.
- **Who Feels It** names the specific people or teams, not "the business".
- **Cost Of Doing Nothing** states what continues to happen, so the reader
  weighs stakes rather than inferring them.
- **Sources** is generated from the structured `sources` list, each entry
  saying what was read and what it contributed. The script refuses a
  hand-written section and one that disagrees with the record.

**No project needs to exist, and none is created.** If `problem-scan` handed
this over, carry its evidence lines and their sources in.

---

## Step 3. Check, preview, write on a yes, prove

Run `memo-check`, fix any problems, and show the whole body inline in the
conversation, properties first. The confirmation gate is hard: create only on
an explicit yes. Then `memo-create`, create the page, read it back, and run
`memo-prove` with the url the create returned. **A create call that returned
without an error proves nothing**, and success is never reported with a
section missing.

`Status` is `Published`, `Published date` today or the day the user names,
`Author` the configured person and omitted when there is none. The Projects
relation is not written; the output says so, and a problem statement with no
project yet is the ordinary case.

---

## What this skill does not do

- **Never edits an existing problem statement.** Memos is append-only. A
  changed situation is a new row, which is what makes the original a record of
  what was believed at the time. A correction goes through `memos:new`.
- **Does not propose a solution**, and refuses one smuggled into What's
  Happening.
- **Does not create a project.** That is `scope`, which will need this memo's
  url.
- **Does not write a section it could not fill.** Evidence in particular: what
  was observed and how often is the floor, and below it the honest answer is
  that there is not enough here yet.

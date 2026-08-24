---
name: team-update
description: Write the recurring team update covering a period, assembled from what actually happened in Projects, Calendar, Memos and optionally Tasks rather than from what somebody remembers. Use when the user says "write the weekly update", "write the team update", "what shipped this week", "monthly recap for the team", or names a period to summarise. Reads Projects, Calendar, Memos and optionally Tasks, writes one Team Update memo with Period covered set, and sends nothing anywhere.
allowed-tools: Write, Bash(node:*), mcp__*__notion-fetch, mcp__*__notion-query-data-sources, mcp__*__notion-create-pages, mcp__*__notion-update-page
---

# team-update

The summary of a period, assembled from the databases rather than from memory.

**The line this skill holds: a recurring send that never asks for anything
becomes wallpaper within a month**, and once it is wallpaper the habit dies.
Needs A Decision From You is the section that keeps the update read, it cannot
be assembled from status fields, and it is proposed to the user rather than
guessed or deleted.

## How this skill works

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/memos.js" context
node "${CLAUDE_PLUGIN_ROOT}/scripts/memos.js" team-update <period.json>
node "${CLAUDE_PLUGIN_ROOT}/scripts/memos.js" window <period.json> <projects.json> <calendar.json> <memos.json> [tasks.json]
node "${CLAUDE_PLUGIN_ROOT}/scripts/memos.js" check <proposed.json>
node "${CLAUDE_PLUGIN_ROOT}/scripts/memos.js" create <memo.json>
node "${CLAUDE_PLUGIN_ROOT}/scripts/memos.js" prove <memo.json> <readback.json> <created-url>
```

The general write rules are `new`'s and are not restated: refuse without
config, fetch live select options before choosing any value, preview in full
inline, create only on an explicit yes, prove the write, and never edit a
published memo.

---

## Step 1. The period

Write it to a file: `{ "from": "2026-08-17", "to": "2026-08-23" }`. The cadence
is whatever the team already has; nothing here schedules anything, because v1
has no unattended runs.

---

## Step 2. Read the databases

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/memos.js" team-update period.json
```

That returns one query per database. Send the memos, projects and calendar
queries, each against its own data source url, and save each result whole.
**Tasks is optional**: read it only when a project's own status is not enough
to tell the story, and say whether it was read.

**Do not compose these queries by hand and do not narrow them with date SQL.**
The window filtering happens in the script, where the comparison is measured,
and the output says why.

Then partition:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/memos.js" window period.json projects.json calendar.json memos.json
```

---

## Step 3. Judge what is worth a line

`window` partitions and counts. What goes in is your judgment, and the filter
is: **would somebody outside the team doing the work change anything on
hearing it?** A period produces more movement than a reader wants.

- **What Shipped** is one line per item, linking out. The related view carries
  the depth; typing it twice is how the writer stops doing this every week.
- **Done projects carry a caveat the output states**: Done is the status now,
  and when it went Done is not recorded. Cross-check against the releases and
  updates in the period before claiming one shipped this week, and drop the
  ones that did not.
- **What Is Still Open** names the stuck items as stuck.
- **Do not invent progress.** If nothing moved, say nothing moved, which is
  information.

---

## Step 4. Needs A Decision From You

**This section cannot be assembled, and the whole skill exists for it.**
Knowing what is actually stuck and on whom requires reading between the status
fields. Propose candidates from the stuck items, ask the user, and **if the
honest answer is nothing this week, write "nothing this week"** rather than
deleting the section. An empty week is information too.

---

## Step 5. Draft, preview, write, prove

TLDR is written last: three to five lines, the whole period, because most
readers will read only that. `Period covered` is set to the period, which is
the field that separates this type from a Project Update, and the script
requires it. Then the same gates as every write: `check`, full inline preview,
an explicit yes, `create`, read back, `prove` with the created url.

---

## What this skill does not do

- **Does not send the update anywhere.** There is no Slack field and no Slack
  integration in v1. It writes the row.
- **Does not invent progress**, and does not restate detail the related view
  carries.
- **Does not fill Needs A Decision From You by guessing.** It proposes and the
  user confirms.
- **Does not run unattended.** Somebody invokes it, on the team's own cadence.
- **Does not edit a published update.** A correction is a new memo, through
  `new`.

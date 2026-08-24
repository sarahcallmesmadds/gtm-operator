---
name: comms
description: Write the update that tells the people affected by a project what changed, as one Project Update memo. Use when the user says "write the project update", "announce this change", "tell people about this", "who needs to know", or whenever a project changes something other people depend on. Not on a schedule. Writes one page and its body, sends nothing anywhere, and never edits anything.
allowed-tools: Write, Bash(node:*), mcp__*__notion-fetch, mcp__*__notion-query-data-sources, mcp__*__notion-create-pages, mcp__*__notion-update-page
---

# comms

The update that tells the people affected what changed.

**The line this skill holds: name the reader.** The failure mode of every
project update ever written is that someone finishes it without knowing
whether it touches them, so Who Is Affected And When must name teams and a
date, and What You Need To Do must give an action per group. **"Nothing" is a
real and useful answer there, and it gets written rather than left out.**

## How this skill works

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/projects.js" memo-check <proposed.json>
node "${CLAUDE_PLUGIN_ROOT}/scripts/projects.js" memo-create <memo.json>
node "${CLAUDE_PLUGIN_ROOT}/scripts/projects.js" memo-prove <memo.json> <readback.json> <created-url>
```

The memo shapes are the same vendored builder the `memos` plugin runs. If
config is absent the script refuses and names `setup`. Never invent a select
value; fetch the live options first.

---

## Step 1. Read the project, and write for its readers

Fetch the project and read its scope document. The memo's `project` field
carries the project's url, and the script requires it: a Project Update about
no project in particular is a plain Memo, which `memos:new` writes.

Type is `Project Update`. The sections, in order: **What Changed, Why, Who Is
Affected And When, What You Need To Do**, Sources conditional and last.

- **What Changed**: the change itself, in the reader's terms, not the
  ticket's.
- **Why**: two or three sentences.
- **Who Is Affected And When**: teams and a date. "Everyone, soon" is not an
  answer.
- **What You Need To Do**: the action, per affected group, and "Nothing" is
  written when it is the answer.

`Domain` is inherited from the project when there is one, otherwise asked.
`Audience`, `Segment`, `L2C Lifecycle` and `Tags` are offered in the preview,
never invented, and left empty rather than guessed.

---

## Step 2. Check, preview, write on a yes, prove

`memo-check`, fix the refusals, preview the whole body inline, create only on
an explicit yes, then `memo-create`, create the page, read it back, and
`memo-prove` with the created url. Never report success with a section
missing.

**The Projects relation is not written**, and the output says so: name the
memo and the project so a person can link them in Notion, and report the memo
as unlinked rather than filed.

---

## What this skill does not do

- **Does not send anything anywhere.** v1 has no Slack and no email. It
  writes the memo and gives you the link.
- **Does not edit a previous update.** Append-only: a correction is a new
  memo relating to the old one through `Corrects`, via `memos:new`.
- **Does not change the project's status.** `new` and `ship` own the two
  moves a skill may make.
- **Does not run on a schedule.** It runs when a project changes something
  other people depend on.

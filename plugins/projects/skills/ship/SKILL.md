---
name: ship
description: Record that a project shipped and close it, as one Release memo and the move from In progress to Done. Use when the user says "we shipped it", "write the release", "close the project", "mark it done", or when work reaches the people who will use it, not when it merges. Lists open tasks and asks before closing. Writes nothing without an explicit yes and posts nothing anywhere.
allowed-tools: Write, Bash(node:*), mcp__*__notion-fetch, mcp__*__notion-query-data-sources, mcp__*__notion-create-pages, mcp__*__notion-update-page
---

# ship

The record that a project shipped, and the close it earns.

**The line this skill holds: writing the release and marking the project Done
are one action.** A project that closes with no record of what shipped leaves
the library with a gap exactly where someone will look, so the script refuses
the close until the release memo's url is in hand.

**When it runs: when the work reaches the people who will use it. Not when it
merges.**

## How this skill works

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/projects.js" open-tasks
node "${CLAUDE_PLUGIN_ROOT}/scripts/projects.js" unfinished <tasks.json> <project-url>
node "${CLAUDE_PLUGIN_ROOT}/scripts/projects.js" memo-check <proposed.json>
node "${CLAUDE_PLUGIN_ROOT}/scripts/projects.js" memo-create <memo.json>
node "${CLAUDE_PLUGIN_ROOT}/scripts/projects.js" memo-prove <memo.json> <readback.json> <created-url>
node "${CLAUDE_PLUGIN_ROOT}/scripts/projects.js" close <existing.json> <release-url>
node "${CLAUDE_PLUGIN_ROOT}/scripts/projects.js" prove-update <output.json> <readback.json>
```

If config is absent the script refuses and names `setup`. Never invent a
select value. Preview inline, write on an explicit yes, prove every write.

---

## Step 1. The open tasks, listed and asked about

Run `open-tasks`, send its query, and pass the result to `unfinished` with
the project's url. Nothing in v1 moves a task's status, so **a project's tasks
are very often still open when it ships, and that is ordinary**. List them and
ask before closing, rather than either refusing or pretending they are not
there. Leaving them open past the close is the user's call.

---

## Step 2. Write the release

Fetch the project and read its page body and related artifacts. Type is
`Release`, the memo's `project` field carries the project's url, and the
script requires it. The sections, in order: **What This Lets You Do, What
Shipped, How To Get It, Known Gaps**, Links conditional and last.

- **What This Lets You Do leads**: the person reading a release was usually
  not following the project, so the work means nothing until they know what it
  gives them.
- **What Shipped bullets**: start with an action verb, name the concrete
  system, field or threshold, fifteen to twenty words each. This is what stops
  release notes reading like marketing.
- **How To Get It**: install, enable, or "nothing, it is already live".
- **Known Gaps**: what does not work yet and what to do meanwhile. Never
  invented, never omitted: if there are genuinely none, say so, because a
  release that oversells is the fastest way to lose trust in every release
  after it.

Check, preview inline, create on a yes, prove with `memo-prove`.

---

## Step 3. Close, on the release's evidence

Run `close` with the fetched project and the release memo's url. It moves the
project from **In progress to Done and nothing else**, and refuses without
the release, because the two are one action.

Send the update, re-fetch the page, and run `prove-update`.

**No relation is written.** Name the release memo, the project, and any
artifact the release changed, so a person can link them in Notion: the
`Artifacts` link in particular is what makes `process:audit`'s strongest
signal work, and a release usually changes an SOP.

---

## What this skill does not do

- **Does not post to Slack.** Slack is read-only context for `problem-scan`;
  `ship` writes the memo and stops.
- **Does not mark a project Done without writing the release**, and the
  script holds that mechanically.
- **Does not close over open tasks silently.** It lists them and asks.
- **Does not move any task's status.** People close tasks.
- **Does not invent a Known Gaps entry, and does not omit the section.**
- **Does not edit a published release.** A correction is a new memo, through
  `memos:new`.

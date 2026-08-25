---
name: new
description: Create the tasks for a project that scope has already created, and move that project from Scoped to In progress. Also fills in a project someone created by hand. Use when the user says "start the project", "break this into tasks", "create the tasks", "let's build it", or after scope offers this pre-filled. Does not create the project row and does not scope; writes nothing without an explicit yes.
allowed-tools: Write, Bash(node:*), mcp__*__notion-fetch, mcp__*__notion-query-data-sources, mcp__*__notion-create-pages, mcp__*__notion-update-page
---

# new

The tasks for a scoped project, and the one status move that starting earns.

**The line this skill holds: the task breakdown is the whole value.** Tasks
are the decision list that eats the sprint, so the test for each one is
whether a person could pick it up and know when they are done. One project
does one job.

## How this skill works

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/projects.js" start <changes.json> <existing.json>
node "${CLAUDE_PLUGIN_ROOT}/scripts/projects.js" tasks <tasks.json>
node "${CLAUDE_PLUGIN_ROOT}/scripts/projects.js" prove-update <output.json> <readback.json>
node "${CLAUDE_PLUGIN_ROOT}/scripts/projects.js" prove-task <task.json> <readback.json> <created-url>
```

If config is absent the script refuses and names `setup`. Never invent a
select value; fetch the live options before choosing any. Preview everything
inline and write only on an explicit yes.

---

## Step 1. Fetch the project and hold the line on its state

Fetch the scoped project and save the whole page. `start` moves a project
from **Scoped to In progress and nothing else**: handed something unscoped,
the script says so and points at `scope`. Do the same in conversation rather
than working around it.

**What `new` may touch, and what it preserves:**

| Field | `new` |
|---|---|
| `Owner` | Sets, defaulting to whoever runs it |
| `Stakeholders`, `Timeline` | Sets if determinable, offers in the preview either way |
| `Status` | Moves to `In progress`, and only from `Scoped` |
| `Domain`, `Segment`, `L2C Lifecycle` | Sets only if `scope` left them empty; the script refuses otherwise |
| `Memos`, `Priority`, `Level of Effort`, `Business outcome`, the page body | **Preserves. Never writes.** Overwriting them silently discards a scoping conversation |

---

## Step 2. Break the work into tasks

Four to seven tasks, five typical; the script raises a count outside that
band as a question, not a refusal.

- **Verb first.** "Wire the enrichment webhook", not "enrichment webhook work".
- **One task per integration or connector**, rather than one covering several.
- **Anything unverified becomes a "review and confirm" task** instead of
  being written as fact.
- **The last task is always live verification.** Not "test": confirming the
  thing works in the real system.
- No generic ceremony tasks. No "kick off", no "align with stakeholders".

Write the list to a file, one entry per task, in order:

```json
[{ "what": "Wire the enrichment webhook", "description": "one line", "who": "me", "due": "2026-09-01" }]
```

`who` and `due` are optional; a `who` is a Notion person id or `me`, and the
script refuses a name. `Order` is written from the list order.

---

## Step 3. Preview, then write, one task at a time

Show the full breakdown and the project changes inline and wait for the yes.
Then send `start`'s update to the project, and create the tasks **one at a
time rather than in a burst**, re-fetching each and running `prove-task`, and
`prove-update` for the project. A create call that returned without an error
proves nothing.

**The Project relation is not written**, and the output says so: every created
task is an orphan in the Tasks "Needs attention" view until a person links it.
Name the project so the links can be made, and report that plainly rather than
reporting the tasks as filed.

**No task body is written.** Requirements live in the task body, written when
that task is picked up, by a person.

---

## What this skill does not do

- **Does not scope.** Handed something unscoped, it says so and points at
  `scope`.
- **Does not create the project row.** `scope` owns the row; this owns the
  tasks.
- **Does not invent generic ceremony tasks.**
- **Does not write a PRD.** Requirements live in the task body, written when
  the task is picked up.
- **Does not move any task's status, ever.** Tasks are created at
  `Not started` and people move them. There is no start, block, complete,
  reassign or reschedule here, because that is a project-management tool and
  this is not one.

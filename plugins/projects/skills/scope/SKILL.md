---
name: scope
description: Work out what a project actually is, what it deliberately is not, and whether it should be built at all, then create the project row at Scoped or Canceled. Use when the user says "scope this", "should we build this", "turn this problem into a project", "what would this take", or after a problem statement exists. Requires a problem statement and refuses to finish without one. Iterates in chat and writes once on approval; never creates tasks and never auto-runs new.
allowed-tools: Write, Bash(node:*), mcp__*__notion-fetch, mcp__*__notion-query-data-sources, mcp__*__notion-create-pages, mcp__*__notion-update-page
---

# scope

What this is, what it deliberately is not, and whether to build it at all.

**The line this skill holds: not over-scoping, which is the entire job.** A
competent scoper over-scopes *because* they lack context, not despite
expertise, which is why what already exists is checked before scoping rather
than after. Scoping can end in "do not build this", and that outcome must
never flow onward by itself.

## How this skill works

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/projects.js" survey
node "${CLAUDE_PLUGIN_ROOT}/scripts/projects.js" board <projects.json>
node "${CLAUDE_PLUGIN_ROOT}/scripts/projects.js" check <proposed.json>
node "${CLAUDE_PLUGIN_ROOT}/scripts/projects.js" create <project.json>
node "${CLAUDE_PLUGIN_ROOT}/scripts/projects.js" fill <project.json> <existing.json>
node "${CLAUDE_PLUGIN_ROOT}/scripts/projects.js" prove <project.json> <readback.json> <created-url>
node "${CLAUDE_PLUGIN_ROOT}/scripts/projects.js" prove-update <output.json> <readback.json>
```

**Do not compose queries or payloads by hand**: every name resolves through
the config map, and shipped names on a renamed workspace read as a workspace
with nothing in it. Never invent a select value; fetch the live options before
choosing any. If config is absent the script refuses and names `setup`.

**Iterate in chat, write once on approval.** A project is expensive to undo,
so refinement happens in conversation and one write happens at the end.

---

## Step 1. Context first: what already exists

Run `survey` and send its three queries: every project, every Process
artifact, every problem statement. **Every hit that overlaps the new scope
becomes an Out Of Scope line reading "already exists".** This is the single
largest source of trimming, and it is why context comes before drafting.

The problem statement is required. Find it in the survey's third result; if
none fits, stop and point at `problem-statement`, because the stakes live
there and nowhere else. A Draft was never published and a Canceled one was
retracted; say the status when offering them.

---

## Step 2. Draft the scope document

Expect either no project row or one at `Intake`; `scope` owns the row and
`new` owns the tasks. The body, in order: **What We Are Building, Out Of
Scope, Success Criteria, Risks And Dependencies.** All four required.

- **What We Are Building** is one paragraph ending with a required sentence
  naming **the smallest version that would prove this works**. Anything that
  assumes the approach works without proving it moves to Out Of Scope with the
  reason "later, once this is proven".
- **Out Of Scope**: "nothing" is not an acceptable answer, and the script
  refuses the literal spellings of it. A blank here is the single best
  predictor that the project will grow.
- **Success Criteria**: checkable by someone else, which is why it is not
  called Objectives.
- **Risks And Dependencies**: "none known" is a real answer and gets written,
  so it is clear the question was asked.

**The format does the trimming, never judgment and never a review round.**
When a section runs long, cut it. Do not raise a section's cap.

`Description` and `Business outcome` are one-sentence summaries derived from
the body, never the reverse. The problem is not a section: it lives in the
related Problem Statement memo, and restating it makes two copies that
disagree within a month.

---

## Step 3. Effort, then priority, against the board

Set `Level of Effort` first. **Before writing Priority, run `board`** on the
survey's projects result and show what is already at each priority: a priority
set without seeing the others is not relative to anything, and a board where
everything is Prio 1 carries no information. The script refuses a priority
with no effort behind it.

---

## Step 4. Check, preview, write on a yes, prove

`check` the draft, fix the refusals, ask about the concerns. Preview the whole
body and every property inline. **Create only on an explicit yes.**

Then `create` for a new row, or `fill` when a hand-made row sits at `Intake`,
which is the only state fill accepts. Create the page or send the update, read
the page back, and prove it with `prove` or `prove-update`. Never report
success with a section missing.

**The problem statement relation is not written.** The output names both pages;
ask the user to link the memo through `Memos` in Notion, and say that until
then the project sits in the Needs attention view, which is that view working.

The row leaves at **Scoped**, or at **Canceled** when the honest answer is "do
not build this", and Canceled is a result worth writing down, not a failure.

---

## Step 5. Offer new, pre-filled, and stop

Offer to run `new` with the scoped project pre-filled. **Never auto-run it.**
Scoping can end in "do not build this", and that outcome must not flow onward
by itself.

---

## What this skill does not do

- **Does not create tasks.** That is `new`.
- **Does not set Owner, Stakeholders or Timeline.** Those are `new`'s, when
  the work starts, and the script refuses them here.
- **Does not set Priority before Level of Effort**, and the script refuses it.
- **Does not raise a section's cap when the content runs long.** Cut.
- **Does not finish without a problem statement.** A project that cannot name
  its problem statement has not been scoped.

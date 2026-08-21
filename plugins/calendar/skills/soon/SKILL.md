---
name: soon
description: Answer what is in market and when, grouped by who it reaches rather than by what day it lands on. Use when the user asks "what's coming up", "what's in market this month", "what are we putting out this quarter", "what is this audience getting from us", or is about to pick a date for something. Reads the Calendar database and writes nothing at all.
allowed-tools: Bash(node:*), mcp__*__notion-query-data-sources
---

# soon

Answer what is in market and when.

**This skill writes nothing.** It reads, it groups, it reports. There is no
confirmation gate here because there is nothing to confirm.

## Why this is a skill and not the calendar view setup already built

Two reasons, and they are the whole justification.

1. **It groups by who it hits, not by when it happens.** The calendar view
   answers what is on Tuesday. The question people actually have is what a given
   audience is going to receive from us this month. Three touches on one segment
   is visible that way and invisible on a calendar grid.

   **It groups by `Segment` only.** `L2C Lifecycle` is read, but only to decide
   whether a row counts as saying nothing about who it targets; it is not a
   grouping dimension. An earlier version of this paragraph said the two were
   read together, which the code has never done. A row targeted by lifecycle
   alone appears under a `"(no segment)"` group rather than under a lifecycle
   heading.

2. **It says what is not real.** `Idea` and `Planned` rows sitting next to
   `Confirmed` ones is how a plan looks fuller than it is.

## How this skill works

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/calendar.js" context
node "${CLAUDE_PLUGIN_ROOT}/scripts/calendar.js" soon <from> <to>
node "${CLAUDE_PLUGIN_ROOT}/scripts/calendar.js" report <dated.json> <undated.json>
```

**Pass `report` what the queries returned, not the output of `normalise`.** It
normalises the rows itself, and it refuses rows that have already been through
`normalise` rather than doing it twice. It used to read both files as they were
and group them by `Status` and `Segment`, which are the names this plugin ships
with: on a workspace that had renamed either one, every row read as having no
status and no segment, and the report came back with nothing locked and nothing
targeted, from a calendar that was fine.

---

## Step 1. Settle the window

**It answers for a window and never returns the whole database.** If the user did
not give one, take the obvious reading of what they asked ("this month", "the
quarter") and **say which window you used** in the answer. A report whose window
is invisible is one somebody misreads.

## Step 2. Run both queries

`soon` gives you **two** queries and both get sent. `report` requires both
result files and refuses to run with one: an absent undated result used to become
an empty list, so "nothing could not be placed" and "nobody ran the second query"
produced the same report.

- **`dated`**: rows with a date inside the window.
- **`undated`**: rows with no date at all.

**Both, always.** A date-bounded query cannot return a row that has no date, so
sending only the first and reporting the result would say "nothing else is
happening" when there is a pile of things somebody meant to schedule.

## Step 3. Report, locked first

Pass both sets to `report`. It gives you three things.

**Lead with the locked half.** `Confirmed` and `Done` are what is actually
happening. `Idea` and `Planned` are what somebody hopes for. Keep them visibly
apart and lead with the first, or a plan reads as fuller than it is.

**Group by segment.** The groups come back ordered by size, which puts the
crowded audience at the top, which is where the problem usually is.

**A row appears under every segment it names**, so the counts do not add up to
the number of rows. `report` says so and so should you: a reader who adds the
groups up and gets more than the total will otherwise assume the report is wrong.

**Rows that said nothing about who they are aimed at come back separately**, in
`unsaid`. They are not "everybody". Say that they did not say.

## Step 4. End with what could not be placed

**Never silently drop a row you cannot place.**

The output ends with a count of the rows with no date, and why they are not in
the timeline. A report that omits them reads as "nothing else is happening",
which is the opposite of true. This is the same rule `software:contracts` follows
for rows with no contract data.

**Say the number even when it is zero.** "Nothing undated" and a report that
never mentioned undated rows look identical, and only one of them is a statement.

**Report `noStatus` the same way.** A row with a date and no status is not an
idea and not a plan, it is a row nobody finished, usually created by hand or left
behind by an import. It comes back in its own group rather than counted as
hoped-for. Until 2026-08-19 the queries dropped these rows before anything could
report them, because "status is not Canceled" is not true for a row with no
status, and SQL keeps only what a test is true for.

---

## What this skill does not do

- **Never changes a row.** Not a status, not a date, not a property.
- **Never returns the whole database.** It answers for a window.
- **Never silently drops rows it cannot place.**
- **Never presents `Idea` and `Planned` as though they were happening.**

## The judgment this skill carries

**What the window should be**, when the user did not say, and saying which one
you used.

**Whether a cluster is a problem.** Three touches on one segment in a month is
sometimes the plan and sometimes the thing nobody noticed. Show the cluster and
say it is a cluster. Do not tell somebody their quarter is wrong.

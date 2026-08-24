# memos

Time-stamped communication, append-only.

Plugin four of the `gtm-operator` marketplace. It writes to the `Memos`
database that the `setup` plugin created, and to `Tasks` when meeting actions
are confirmed. **It creates no database, adds no property and writes no
config.** `setup` owns all of that, and this plugin never calls it.

## What it is for

Memos is the counterpart to Process. Process is the living reference,
maintained and kept true; a memo records what was said on a date, and its body
and content properties are never updated. A thing meant to stay correct
belongs there. A thing that was true on the day it was sent belongs here.

**Append-only, stated as narrowly as it actually holds.** After publication
the body and every content property are immutable; `Status` may move from
Published to Canceled and nowhere else, by a person, with a correcting memo
saying why; and the far sides of two-way relations update themselves, which is
the rule working rather than an exception to it. A correction is a new memo
with `Corrects` set.

Every row's `Type` says which of seven communications it is: Memo, Project
Update, Team Update, Meeting Notes, Problem Statement, Release, Incident
Report. Each has its own page body, defined in `SCHEMA-memos.md`.

## The skills

| Skill | What it is for |
|---|---|
| `new` | Writes one memo of any of the seven types from free-form notes, and carries the correction branch: "fix the memo from Tuesday" becomes a new memo with `Corrects` set |
| `meeting-notes` | Turns a meeting into a record of what it decided, and offers to write the confirmed actions into Tasks |
| `team-update` | Assembles the recurring update covering a period from Projects, Calendar, Memos and optionally Tasks, rather than from what somebody remembers |
| `find` | Finds what was said about something and when, following corrections to the end of the chain. Reads only |

All four are built. `SKILLS-memos.md` in the repository root defines them.

## Why there is no update, backfill or audit

Recorded so the gaps read as decisions, with the full argument in
`SKILLS-memos.md`:

- **No `update`, ever.** Memos is append-only; this is the plugin's entire
  identity, and the clearest evidence is the missing skill.
- **No `backfill`.** A memo is a record that something was communicated on a
  date. Manufacturing one afterwards creates a record of a communication that
  never happened, which is not a gap, it is the plugin refusing to forge a
  document.
- **No `audit`.** A memo cannot go stale, which is also why there is no
  `Last checked for accuracy` in the schema.

## What is not built in this version

Said here so it is not discovered by a user hitting it:

- **No relation is written.** `Corrects`, `Artifacts` and `Projects` are all
  relations, and no plugin in this marketplace has measured a relation write
  on the connected client's surface. `new` checks a named correction and then
  says, in `create`'s own output, that the link is made by hand in Notion.
  Tasks created from meeting actions likewise carry no Project link, land in
  the Tasks "Needs attention" view until a person links them, and the output
  says so.
- **No date filtering in SQL outside what was measured.** `team-update`
  fetches whole tables and the script partitions by period, because the only
  date SQL measured on this surface is calendar's own window query.
- **No Slack.** `team-update` writes the row and sends nothing anywhere.

## Installing

Install `setup` first and run its `install` skill. Every skill here refuses
with a message pointing at `setup` when config is absent or the install is
unfinished, so nothing here depends on reading this file.

## How it is built

`scripts/memos.js` decides what to send and the skill sends it: every query
and payload is built in the script, every value is checked there, and the
model makes the calls in between. The same shape as `setup`, `calendar` and
`process`.

`scripts/memo.js` holds every rule Notion cannot enforce: the templates and
their required sections, the one-target rule on `Corrects`, `Period covered`
required on a Team Update and refused everywhere else, the tags cap, and the
one writable status.

`scripts/vendor/` is copied from `shared/` by `scripts/vendor.js` at the
repository root. Do not edit it there.

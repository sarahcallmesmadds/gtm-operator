# process

The Process library: the living reference of how and why things are done.

Plugin three of the `gtm-operator` marketplace. It writes to the `Process`
database that the `setup` plugin created. **It creates no database, adds no
property and writes no config.** `setup` owns all of that, and this plugin never
calls it.

## What it is for

Process is the living reference, maintained and kept true. That is the line
everything else follows from, and the counterpart is Memos, which is time-stamped
communication and append-only. A thing that is meant to stay correct belongs
here. A thing that was true on the day it was sent belongs there.

Every row is an **artifact**, and its `Type` says which of five it is:

| Type | What it records |
|---|---|
| Strategy Decision | A choice and its reasoning, so nobody relitigates it |
| SOP/ROE | How a recurring process runs, step by step |
| Enablement | Teaches someone who has not done it before |
| Reporting | What a report means, and how to read it without drawing the wrong conclusion |
| Technical Reference | How a system is wired, for whoever maintains it |

**Only a Strategy Decision may be the parent of anything.** Every other type
describes *how* to do something and this one describes *why*, so the others hang
off it. That is what makes the library navigable instead of a pile.

## The skills

| Skill | What it is for |
|---|---|
| `new` | Writes one artifact from free-form notes, in the template its type calls for, after checking for a near match |
| `find` | Finds the artifact that answers a question and says whether it is still worth trusting. Reads only |
| `update` | Changes an artifact that already exists. Moves the three verification fields together or not at all, and only on an explicit yes |
| `audit` | Says what has gone stale, contradicts something else, or was never verified. Reads only and writes nothing |
| `backfill` | Fills the library from material you already have, proposing candidates you approve one at a time. Writes no owner and marks nothing verified |

All five are built. `plugins/process/SKILLS.md` defines them.

**`backfill` is the one skill that reads things people said** rather than things
they wrote down for the record, so two rules in it are refusals in code rather
than advice in the skill document. The scope it is given is refused rather than
narrowed, because there is no approval gate in front of a read: by the time
there is a candidate list, the reading has already happened. And nothing it
writes carries an owner or a verification stamp, because a machine pulled it in
and nobody has read it. `audit` flags every backfilled artifact as
never-verified until somebody does, which is that signal working rather than
failing.

## What is not built in this version

Said here so it is not discovered by a user hitting it:

- **The embedded related view.** Every type calls for one, `new` names which one
  belongs on the page it wrote, and building it needs the Views API. The skill
  says the view is missing rather than leaving it to be noticed.
- **The newer-related-memo signal inside `find`.** `audit` has it, querying
  Memos through the reverse relation. `find` checks the review cadence
  and does not query Memos, and it says so rather than reporting a complete trust
  judgment.
- **A calibrated repeated-question threshold.** `backfill` decides whether two
  wordings are the same question by the same blunt token overlap the duplicate
  check uses, and `plugins/process/SKILLS.md` says that needs tuning against real
  workspaces, which do not exist yet. It is acceptable there and only there,
  because the output is a candidate list rather than a document.
- **A calibrated duplicate threshold.** `plugins/process/SKILLS.md` says in as many words
  to pick this against real artifacts rather than inheriting the reference's 70%.
  The number in the code is uncalibrated, every result says so, and the skill
  shows candidates for a person to judge rather than deciding alone.

## Installing

Install `setup` first and run its `install` skill. Both skills here refuse with a
message pointing at `setup` when config is absent or the install is unfinished,
so nothing here depends on reading this file.

## How it is built

`scripts/process.js` decides what to send and the skill sends it. The Notion
calls go through the connected client, which a script cannot reach, so every
query is built in the script, every value is checked there, and the model makes
the calls in between. That is the same shape `setup` and `calendar` use.

`scripts/artifact.js` holds every rule Notion cannot enforce: the tags cap, the
parent-type rule, the body templates and the two sections that can never be
blank. None of them can be a view filter, which is measured rather than assumed
and recorded in `DECISIONS.md`.

`scripts/vendor/` is copied from `shared/` by `scripts/vendor.js` at the
repository root. Do not edit it there.

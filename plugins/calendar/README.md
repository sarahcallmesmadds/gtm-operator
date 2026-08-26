# calendar

The GTM calendar: what is happening in market, and when.

Plugin two of the `gtm-operator` marketplace. It writes to the `Calendar`
database that the `setup` plugin created. **It creates no database, adds no
property and writes no config.** `setup` owns all of that, and this plugin never
calls it.

## What it is for

One question: **what is happening in market, and when.** A row is something that
happens on a date and that somebody outside the team experiences. A conference
you are sponsoring. A webinar. A blog post going live. An email to twelve
thousand people. A launch.

That is the whole boundary:

> Does it happen on a date, and does someone outside the team see it?

A bug fix happens on a date and nobody outside sees it, so it is a Task. A brand
guideline is seen by outsiders and does not happen on a date, so it is an
artifact.

## The skills

| Skill | What it is for |
|---|---|
| `new` | Adds one thing, after showing what else is already aimed at the same people that week |
| `update` | Changes a row, re-checks clashes when a date moves, and asks how it went when it is marked `Done` |
| `soon` | Answers what is in market for a window, grouped by who it reaches. Reads only |

There is deliberately no `debrief` skill, because it is folded into `update` and
fired by the status change: a standalone debrief skill is run once and then
never. There is deliberately no `backfill`, because a team already keeps a
calendar somewhere and importing half of it produces two live calendars that
disagree, which is worse than one bad calendar. Moving one is a migration a
person does.

## Installing

Install `setup` first and run its `install` skill. Every skill here refuses with
a message pointing at `setup` when config is absent or the install is unfinished,
so nothing here depends on reading this file.

## How it reads config

`~/.claude/gtm-operator.config.json`, written by `setup` and read by every
other foundation plugin. This plugin carries its own read-only copy of the
reader, at `scripts/vendor/config-read.js`.

**That copy is generated.** The source is `shared/config-read.js` in the
repository, `scripts/vendor.js` copies it, and
`tests/vendor-copies-current.test.js` fails when a copy has drifted. Editing the
copy is reverted by the next vendor run.

**Why a copy rather than importing `setup`'s.** Claude Code has no dependency
resolution between plugins, and a skill's scripts resolve inside its own plugin,
so an installed `calendar` has no path to `setup`'s files and must not have one.
The decision is recorded in `SKILLS-setup.md` build risk 3.

**The reader cannot write.** There is no way, from this plugin, to change config.

## What is not proved

Read this before trusting any of it.

**Part of this has now run against a real Notion workspace, on 2026-08-19.** One
database was created with the statement `setup` builds, one row was created,
queried, updated and queried again, and everything was deleted afterwards. What
that settled is recorded in `DECISIONS.md` under "the first live run against a
real Notion workspace": the response envelope, that a multi-select comes back as
a JSON array inside a string, that `has_more` is a real completeness signal, and
that an emptied property comes back as `null`.

**One run of one row is not an acceptance run**, and the difference matters. It
proved the query and clash path against real data, and it found a bug that four
review rounds had missed: the whole JSON string was being read as one segment
name, so a real clash reported as no clash. It did not prove pagination, a page
fetch as opposed to a SQL query, a renamed property or option, a null `personId`,
or the debrief.

**This plugin is still not finished until a full acceptance run has happened.**
At minimum that run has to re-fetch a row including its body, prove a renamed
property and a renamed option, prove a null `personId` omits `Owner`, mark a row
`Done` and confirm the debrief section wrote, move a date and confirm the clash
check re-runs, and exercise a range, an undated row and `soon`.

**Fixed 2026-08-20: the plugin emits what the connected client accepts.** It
used to build Notion REST API property objects while the client took flat SQLite
values, so the first live run had to translate every field by hand and the plugin
could not do its job without a person in the middle. It now emits the client's
dialect, and a second live run on 2026-08-20 sent every `create` and `update`
payload to a real workspace **exactly as the plugin printed it**. Recorded in
`DECISIONS.md` under "the second live run".

**A third run on 2026-08-20 covered the one payload the second did not.** A
single-day date writes its end column as an explicit `null`. A real range was
shortened to one day, the payload went verbatim, and the read-back shows the old
end gone rather than left behind.

**The client floor is not implemented.** `SKILLS-calendar.md` says every skill
here pins the Notion API version and a client floor to the two values
`SKILLS-setup.md` defines. Only one of those two exists anywhere: the wire
version appears in prose at `SKILLS-setup.md` step 0, and the config field
documented to carry it is never written by `setup`. **The client floor has no
number anywhere in the repository.** Rather than invent one, this plugin does not
check it. A made-up number inside a safety check is worse than no check, because
a later reader assumes somebody worked it out. What it needs is a measurement
against a real connection, not a decision.

**Four of these were fixed later on 2026-08-19**, answering a review round that
refused to let them ship as a list. Two of them could leave incorrect data behind
while reporting success, which is not a reduced capability, and a gap that lies
about itself does not get to be documented instead of fixed.

- **Fixed: `update` can clear a property.** There is an `update <before> <after>`
  command, and it emits a type-correct empty value for every field the change
  empties, whether a Type change invalidated it or the user removed it.
- **Fixed: an explicit owner can be set.** `Owner` takes a person id, or several,
  or `me` for the configured person. A name is refused rather than sent, because
  nothing here can turn a name into a Notion id and Notion answers a bad one by
  naming the property rather than the value. The `user://<id>` form a re-fetch
  returns is accepted too, and written back bare.
- **Fixed on 2026-08-21: an update that did not carry the owner across died.**
  An absent person field was defaulted to the configured person, which is right
  on a create and wrong on an update, where the merged row's absent `Owner` is
  already being emptied by `clearing`. The payload then held a set and a clear
  for one property and the call refused itself, blaming the plugin. It was the
  plugin. An absent owner is now cleared and listed, and `me` still resolves.
- **Live-proved on 2026-08-21, a fourth run.** The trim fix, the `user://`
  prefix in both directions, the owner clearing on an update, a failed clear
  being caught, and the clash check finding a real same-day clash from a real
  query. Recorded in `DECISIONS.md` under "the fourth live run", including the
  four things it did not prove.
- **Fixed on 2026-08-21: a proposed row in the query's shape reported no clash.**
  A multi-select comes back as a JSON array inside a string. The candidate rows
  are parsed and guarded; the proposed row was not, and read as targeting nobody,
  so a real same-day same-segment clash came back with nothing overlapping. It is
  refused now rather than read as silence.
- **Fixed: the read-back proof compares every property type it emits**, and
  returns what it checked as well as what was wrong. It says every time what it
  did not check, which is the body text under each heading.
- **Fixed after rounds 4 and 5: an update is proved by `prove-update`, not
  `prove`.** `prove` rebuilds the payload from the merged row, which cannot
  express an emptied property, so every clear was outside what it compared and a
  clear that failed was reported as a successful write. `prove-update` takes
  **what `update` printed**, not the files `update` was given: recomputing from
  the inputs looked equivalent, and passing the merged row as both removed every
  clear from the rebuilt payload while a stale read-back still proved clean.
- **Fixed after round 6: both proofs name the page they proved.** `update` emits
  the page it targets, and `prove` takes the url the create returned. Each
  refuses a read-back it cannot identify or one belonging to another page. Before
  this, a read-back of any row whose properties happened to match passed.
- **Fixed after round 4: a missing result is no longer an empty one.** A rows
  file holding `null` became `[]` and the duplicate lookup was then reported as
  checked and finding nothing. `report` likewise substituted an empty list for an
  undated result nobody supplied. Both refuse now.
- **Fixed after rounds 4 and 5: the duplicate result says what it compared.**
  The query selects the whole table, so it reports `ran`, `rowsCompared`,
  `completeProved` and a `coverage` sentence rather than a bare `checked: true`.
  `completeProved` is read from the response's own `has_more`, measured on
  2026-08-19. It carried the word `"unknown"` in a field called `complete` for
  one round, which `if (result.complete)` reads as yes; an unknown does not go in
  a field shaped like a boolean.
- **Fixed: the duplicate query no longer filters.** It used to fetch an exact
  link match and a lowercased name match while the comparator ignored the scheme,
  a leading `www.`, trailing slashes and runs of space, so the pairs the
  comparator exists to catch were removed before it saw them.

**These are open, found by review on 2026-08-19 and not fixed.** They are listed
rather than left to be discovered:

- **The `Project` and `Artifacts` relations are never written**, even though
  `new` asks about the project. The skills no longer promise otherwise.
- **Only `Type` and `Status` are validated against the schema.** Any string
  passes for `Our role`, `Format`, `Domain`, `Channel`, `Audience`, `Segment` and
  `L2C Lifecycle`. The skills say to fetch the live options first, which is
  guidance rather than a gate. Which vocabularies are fixed and which are
  editable is not yet in the machine-readable schema. The recorded name map is
  now checked against the full option list, so a renamed value that was never
  recorded is refused. A value that is neither shipped nor recorded still reaches
  Notion, which refuses it: a hard 400 naming the value and listing the allowed
  ones, and the page is not created at all. That was measured elsewhere in this
  repository on 2026-08-17, not by this plugin, and is recorded in
  `REVIEW-codex-2026-08-17.md`.
- **Most of this is still proved by tests and reasoning rather than by a live
  run.** The 2026-08-19 run covered one create, one query, one update and one
  query, on one row. `normaliseRows` now parses the measured shape and its
  fixture is a real response, but the envelope keys it also accepts beyond
  `results` remain ones nobody has seen.
- **`soon` groups by `Segment` only.** `L2C Lifecycle` decides whether a row
  counts as having said anything and is then dropped, so a row aimed only at a
  lifecycle stage is grouped under "(no segment)" and that stage never appears.
- ~~**The date parsers accept impossible dates.**~~ **Fixed 2026-08-19.**
  `dayNumber` round-trips the day and refuses one that does not exist, and a row
  whose date cannot be read is reported as unplaceable rather than dropped. The
  original text follows, because the first fix caused a second bug worth
  remembering: refusing the date alone made the row vanish from both lists while
  the check still called itself complete. `2026-02-31` was normalised to
  `2026-03-03` rather than refused.
- **URL comparison lowercases the whole address**, so two paths differing only in
  case can be reported as the same link.

**`soon` overlaps `memos:team-update`**, which also reads this database for what
went out. That is probably correct, but if the two produce different pictures of
the same period, one of them is wrong and nothing would catch it.

**Nothing reminds anybody of a date.** There are no unattended runs, so a
confirmed event with a run-up is only visible to somebody who looks. It is the
most obvious thing a user will expect and not get.

## The clash check, and what it cannot know

It compares `Segment` and `L2C Lifecycle`, both multi-select, plus a window of
**seven days either side** of the proposed date. That is all the schema has.

**It is a coarse signal for a person and the skills say so.** It surfaces
candidates and the user judges. It never blocks and it never silently allows.

**It does not know who is on a list**, so two emails to entirely different
enterprise lists look identical to it. A real collision detector needs a field
naming the actual audience, and that is deliberately not in v1: it is a
marketing-ops concern, it needs somewhere for list names to come from, and adding
a field nothing can fill is a failure this design has already caught twice.

**It has no threshold.** Two things aimed at one segment in a week is sometimes a
problem and sometimes a Tuesday. Tuning a threshold wants a real calendar rather
than an invention.

## Verifying a change

```sh
sh tests/run.sh
```

from the repository root. The tests that cover this plugin:

| Test | What it holds |
|---|---|
| `calendar-clash.test.js` | The window, the three targeting cases, the duplicate rules |
| `calendar-row.test.js` | The date rule, type-conditional fields, the nullable person rule, the name map |
| `calendar-schema-agrees.test.js` | That the facts this plugin carries match what `setup` builds |
| `calendar-command.test.js` | Query building, grouping, and the read-back proof |
| `config-contract.test.js` | That the reader and `setup`'s writer agree about the config |
| `vendor-copies-current.test.js` | That no vendored copy has drifted from its source |

Most test files end with a list of what was broken to prove its checks, naming
the mutation and some of the checks that went red. `calendar-schema-agrees` and
`config-contract` have no such list. The lists that exist name checks that did go
red, but they are not exhaustive: a review on 2026-08-19 found several mutations
that break more checks than their list names, and at least one that leaves its
tests green. Read them as "at least these went red", not as a complete account. Read that list rather than this
sentence: an earlier version of this line said every check in them had been
proved that way, which was wider than what had been run, and review caught it.
Where a check has not been proved by breaking, the test file says so.

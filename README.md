# gtm-operator

A go-to-market operating system in Notion, built by plugins rather than by a
consultant. One plugin creates the databases. The others write to them, and by
design none of them calls another.

By [Sarah Madden](https://github.com/sarahcallmesmadds).

A Notion template hands you a finished workspace and leaves you to keep it true.
The intent here is to build the same workspace and then keep working inside it:
skills that write a project, a memo or a tool record, that know the schema, know
the rules Notion cannot enforce, and check what the workspace returned rather
than trusting that a write succeeded. The skill that builds the workspace exists
and has been run. The ones that write into it are built; how much of each has
run against a live workspace is recorded in `DECISIONS.md`.

## Read this before anything else

**All six foundation plugins are built.** `setup` builds the foundation, and
that flow has been run end to end against a live Notion workspace. The
writing plugins are built and reviewed, and what each one has and has not run
against a live workspace is recorded in `DECISIONS.md`. The first job plugin,
`import-leads`, is design only.

**It has been run by its author and by nobody else**, and never against a
workspace that already had something in it. Every failure it has survived was
arranged.

So the substance of this repository today is the written design, which is worth
reading whether or not you install anything. `DECISIONS.md` in particular is a
running record of what was decided, what was reversed, and what Notion turned out
to do when it was measured instead of assumed.

## Install

```
/plugin marketplace add sarahcallmesmadds/gtm-operator
/plugin install setup@gtm-operator
```

Add the marketplace **by repository**, as above. Pasting a direct URL to
`marketplace.json` fetches that one file and none of the plugin folders, so the
install fails.

Then ask Claude to set up gtm-operator. `install` explains the model before it
asks anything, asks five questions, creates everything, reads all of it back out
of Notion, and writes the config file every other plugin will read.

You need a Notion connection that can insert, update, and read user information.
**A read-only connection authenticates perfectly and then fails on the first
create**, so `install` checks every capability it uses before it writes anything.

Read [`POST-INSTALL.md`](POST-INSTALL.md) when it finishes. Two jobs are left to
you because the API cannot reach them, and one of them is load-bearing: nothing
rolls up task progress until the Tasks status property is converted by hand.

## What gets created

| Database | What it holds | Plugin that owns it |
|---|---|---|
| Process | Living reference, kept true. Strategy decisions, SOPs, enablement, reporting and technical reference | `process` |
| Memos | Time-stamped communication. Append-only: a change is a new row, never an edit | `memos` |
| Projects | Work with a beginning and an end | `projects` |
| Tasks | The steps inside a project | `projects` |
| Software | The tool directory, with contracts, renewal dates, risk and owners | `software` |
| Calendar | Anything that happens on a date and reaches somebody outside the team | `calendar` |

**The line between Memos and Process is the one to understand**, because
everything else follows from it. Memos is what was said, on the day it was said.
Process is what is currently true. Somebody who misses this puts status updates
in the library and process documentation in memos.

`setup` creates all of them on every run, whichever plugins you have. That is
what buys the architecture: every database exists before any relation is added,
so no relation is conditional and no plugin has to check whether another is
installed. The cost is real, and somebody who only wants a documentation library
gets the whole foundation.

For the relations, the views, and the rules Notion will not enforce, ask the
manifest rather than a sentence in a document:

```
node plugins/setup/scripts/manifest.js --summary
```

Every number it prints is derived from the definitions it prints them about. A
count written beside the thing it counts is a copy, and copies drift: reviews
of this design found six counts that had gone stale that way.

## The plugins

Two tiers. A foundation plugin is named for the object it owns. A job plugin is
named for the work it does, and owns no database.

| Plugin | Owns | State |
|---|---|---|
| [`setup`](plugins/setup) | Creates every database, wires the relations, writes the config | `install` built and run. `check` built, not yet run against a live workspace. `add` designed |
| [`process`](plugins/process) | Process | Built |
| [`memos`](plugins/memos) | Memos | Built |
| [`projects`](plugins/projects) | Projects and Tasks | Built |
| [`software`](plugins/software) | Software | Built |
| [`calendar`](plugins/calendar) | Calendar | Built |

Job plugins come after the foundation ships, not alongside it. The first,
[`import-leads`](SKILLS-import-leads.md), is designed and not yet built;
outbound email follows.

## What is in this repository

| File | What it is |
|---|---|
| [`DECISIONS.md`](DECISIONS.md) | The running record. Decisions, reversals, and what Notion does when measured |
| [`POST-INSTALL.md`](POST-INSTALL.md) | The two jobs the API cannot do for you |
| `SCHEMA-*.md` | One per database, except that `SCHEMA-projects.md` covers Projects and Tasks, which are one job. Field names, types, values and option order live here and nowhere else |
| `SKILLS-*.md` | One per plugin. What each skill does, what it refuses to do, and why |
| `TESTLOG-*.md` | What was run against a live workspace, and what came back |
| [`plugins/`](plugins) | The plugins themselves |
| `tests/` | The suite |

## Tests

```
sh tests/run.sh
```

Plain Node, no framework, each file runnable on its own. They hold the design,
the code and Notion together: the manifest is checked against the relation map in
the design document row by row, every property in the schema documents is checked
against the code, and one test compares a whole install against what a live
workspace actually returned.

**A check is proved by breaking the thing it watches and confirming it goes red.**
Where that has not been done for a check, the test file says so rather than
letting a green tick imply it.

## Licence

MIT. See [`LICENSE`](LICENSE).

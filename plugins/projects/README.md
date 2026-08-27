# projects

A project, from named problem to shipped release.

Plugin five of the `gtm-operator` marketplace. It writes to the `Projects` and
`Tasks` databases that the `setup` plugin created, and to `Memos` for the
three communications a project produces. **It creates no database, adds no
property and writes no config.** `setup` owns all of that, and this plugin
never calls it.

## What it is for

Work should not start until somebody has written down why it is worth doing,
and should not end without a record of what shipped. The six skills are that
lifecycle:

| Skill | What it is for |
|---|---|
| `problem-scan` | Finds problems that keep coming up and that nobody has written down, and hands them to `problem-statement`. Reads only |
| `problem-statement` | Writes the case that something is worth fixing, before anyone proposes a fix. One Problem Statement memo |
| `scope` | Works out what a project is, what it deliberately is not, and whether to build it at all. Creates the project row, at Scoped or Canceled |
| `new` | Creates the tasks for a scoped project and moves it to In progress. Does not create the row |
| `comms` | Writes the update that tells the people affected what changed. One Project Update memo |
| `ship` | Records that a project shipped and closes it. One Release memo, then In progress to Done |

All six are built. `plugins/projects/SKILLS.md` defines them.

`problem-scan` can ground candidates in bounded Slack and Gmail conversations,
Granola or Gong meetings, HubSpot or Salesforce CRM records, Outreach activity,
and Intercom or Pylon support context. Every external connector is optional and
read-only; Notion is the plugin's only write destination.

## The rules the scripts hold

- **A skill never advances a status it did not earn.** `scope` leaves a row
  at Scoped or Canceled, `new` moves Scoped to In progress, `ship` moves In
  progress to Done, and no skill moves a project more than one step.
  Cancelling work already in progress is a person's move in Notion,
  deliberately unautomated, and task statuses are managed by people.
- **A problem statement is required.** `scope` refuses to finish without one,
  which is the exact form of the rule the Needs attention view can only
  approximate.
- **Effort before priority**, and priority against the board: the script
  refuses a priority with no effort behind it, and `board` shows what already
  sits at each priority before a new one is written.
- **"Nothing" is not an Out Of Scope**, and the script refuses the literal
  spellings of it.
- **The release and the close are one action.** `close` refuses without the
  release memo's url.
- **The memo shapes are the memos plugin's own.** Three skills write Memos
  rows through the same vendored builder (`shared/memo-write.js`), so the two
  plugins cannot disagree about what a Problem Statement, Project Update or
  Release looks like.

## What is not built in this version

Said here so it is not discovered by a user hitting it:

- **No relation is written.** The problem statement, the tasks' projects, the
  memos' projects and the release's artifacts are all named in each command's
  output and linked by a person in Notion. Orphan tasks are exactly what the
  Tasks "Needs attention" view surfaces until then.
- **No task body is written.** Requirements live in the task body, written
  when the task is picked up, by a person.
- **Projects have no hierarchy, on purpose.** Grouping is Domain and the
  Strategy Decision relation, and the reasoning is in `plugins/projects/SCHEMA.md`
  under "Projects have no hierarchy". Do not re-propose a parent project.
- **Nothing is sent anywhere.** External connectors provide read-only context.
  No skill posts, sends, drafts, updates, assigns or changes anything in Slack,
  Gmail, Gong, HubSpot, Salesforce, Outreach, Intercom or Pylon.

## Installing

Install `setup` first and run its `install` skill. Every skill here refuses
with a message pointing at `setup` when config is absent or the install is
unfinished, so nothing here depends on reading this file.

## How it is built

`scripts/projects.js` decides what to send and the skill sends it: every
query and payload is built in the script, every value checked there, and the
model makes the calls in between. The same shape as the other four plugins.

`scripts/project.js` holds every rule Notion cannot enforce: the status
transitions, the required problem statement, effort-before-priority, the four
required scope sections, the Out Of Scope dismissals, and the task shapes.

`scripts/vendor/` is copied from `shared/` by `scripts/vendor.js` at the
repository root. Do not edit it there.

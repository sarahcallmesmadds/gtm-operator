# setup

Creates the Notion databases every other `gtm-operator` plugin reads and writes,
wires the relations between them, and writes the one config file they all share.

**Nothing else in this marketplace creates a database, and nothing else writes
config.** That is the decision the whole architecture rests on.

## Status

**Part-built. Do not run it against a workspace you care about.**

What exists: the manifest, the six database schemas, the statement generator, the
verifier, and the checks that hold all of it to the design documents. The whole
chain has been proved once end to end, by creating the Process Library in a live
workspace, adding its relations, reading it back, comparing it, and deleting it.

What does not exist: the `install` flow that runs the chain for all six, the
config file, the views, and the `check` and `add` skills.

## Its skills

| Skill | What it is for |
|---|---|
| `install` | The first run. Explains the model, asks five questions, creates everything, writes config |
| `check` | Tells you whether the plugin can still see what it created, and repairs what it owns |
| `add` | Creates a database that is missing, and wires it into the ones already there |

Three rather than four: changing a display name or the default cadence after
install is handled by re-running `install`, which on a complete config creates
nothing and only re-asks the five questions. A separate settings skill would be a
fourth thing to find for a job people do roughly once.

## Why it creates everything, every time

`setup` does not ask which databases you want and does not read which plugins you
have installed. It builds the whole foundation in one pass.

This is what pays for the architecture. Because every database exists before any
relation is added, no relation is ever conditional, nothing has to be added back
later by a second install, and no plugin has to check whether another plugin is
present. An earlier design spent four separate mechanisms on that problem. This
spends one ordering rule.

**The cost is real:** somebody who only wants a documentation library gets the
whole foundation. That is the price of the relations working on day one, and it
is cheaper than the alternative, which is six plugins negotiating.

## The manifest

`scripts/manifest.js` is the single machine-readable definition of what gets
created: the databases, the relations and their directions, the database-level
views, and the rules Notion will not enforce.

```bash
node scripts/manifest.js --summary     # what setup creates, derived
node scripts/manifest.js --validate    # does the manifest contradict itself
node scripts/manifest.js --json        # the whole thing, for another tool
```

**Every count in this plugin is derived from that file.** To add a database, a
property or a relation, edit it and nothing else.

That rule earned itself. Three independent reviews of the design found six counts
that had gone stale, every one a number somebody wrote in a sentence beside the
thing it counted. A creation plan claimed nine where the relation map held
thirteen. A file put the Calendar views at three where its own table listed four.
Each was correct on the day it was written.
**A count written beside the thing it counts is a copy, and copies drift.**

## Tests

```bash
sh ../../tests/run.sh
```

Three files, and they hold the design and the code together in both directions:

- The manifest agrees with the relation map in the design document, row by row,
  and does not contradict itself. No count written in a document disagrees with
  it, and the `--summary` output agrees with the data it summarises.
- Every property in the schema documents exists in `schema.js`, and nothing
  exists in `schema.js` that the documents do not define. Six databases, checked
  field by field against their own documents.
- `verify` catches what it claims to: a missing property, a wrong type, a missing
  option, options in the wrong order, an extra property somebody else added, and
  an empty response, which must read as a failure rather than a clean pass.

**Each one has been proved to fail on the fault it names**, by breaking the
manifest on purpose and confirming the right check went red. A check that has
never failed is a check nobody has tested.

Two limits are documented in the test file rather than hidden. The prose check
skips the word "one", because English uses it as an article more often than as a
count, and it skips `.js` files for the same reason. The `--summary` check exists
because of that second gap: a stray edit replaced a derived count with a literal
`5`, every text check passed, and the plugin printed the wrong number. The fix
for a gap in a text-scanning check is a check on behaviour, not a wider pattern.

## What it does not do

- **Does not write a single content row.** No samples, no welcome page.
- **Does not adopt a database you already have.** It creates new ones. This is
  the largest thing v1 leaves out and it is deliberate.
- **Does not create the related views inside page bodies.** Those filter against
  the page they sit on, so the skill that writes a page builds its view.
- **Does not delete or archive anything, ever**, including after a failed run. A
  half-built workspace is cleaned up by a person who can see it.
- **Does not run unattended.**

## Open, and honest about it

- **Nothing here has touched a real Notion workspace.** Every design claim is
  unverified against real use.
- ~~Two Notion filter limits are unmeasured.~~ **Measured 2026-08-17 and both are
  real.** A multi-select filter cannot count values and a filter cannot read
  across a relation, both rejected with a 400. The workarounds were measured too:
  a counting formula comes back typed as text, and a rollup filter is accepted,
  reported as created, and silently emptied. The two rules stay with `check`, and
  both `check` queries were proved on real rows.
- **Whether the API can create a page template**, as opposed to apply one, is
  unknown.

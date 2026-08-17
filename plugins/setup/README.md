# setup

Creates the Notion databases every other `gtm-operator` plugin reads and writes,
wires the relations between them, and writes the one config file they all share.

**Nothing else in this marketplace creates a database, and nothing else writes
config.** That is the decision the whole architecture rests on.

## Status

**Designed and part-built. Do not run it.** The manifest and its checks exist.
The Notion calls do not. Running anything here against a real workspace is not
possible yet, and when it is, it creates databases in an account you care about.

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
node ../../tests/manifest-agrees-with-design.test.js
```

Six checks. They confirm the manifest agrees with the relation map in the design
document row by row, that it does not contradict itself, that no count written in
a document disagrees with it, and that the `--summary` output agrees with the
data it summarises.

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
- **Two Notion filter limits are unmeasured.** Whether a multi-select filter can
  count values, and whether a filter can read a property across a relation. Two
  rules are routed to `check` instead of a view on the strength of those two
  claims. If either is wrong, the rule moves back to a view and only the manifest
  changes.
- **Whether the API can create a page template**, as opposed to apply one, is
  unknown.

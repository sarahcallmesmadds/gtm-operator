# setup

Creates the Notion databases every other foundation plugin reads and writes,
wires the relations between them, and writes the foundation's config.

**Nothing else in this marketplace creates a database, and nothing else writes
the foundation's config.** That is the decision the whole architecture rests on.

## Status

**`install` runs, and it has been run.** On 2026-08-18 the whole flow went
against a live Notion workspace: every database created, every relation added,
every view built, all of it read back and compared to the manifest, and each view
proved a second time by the rows it actually returns. The recording of that run
is in `tests/fixtures/full-install-as-notion-returned-it.json` and the test suite
checks against it.

What does not exist: the `add` skill.

**It has not been run by anyone but its author, and never against a workspace
with anything in it.** Every failure it has survived is one that was arranged.

## Its skills

| Skill | What it is for |
|---|---|
| `install` | The first run. Explains the model, asks five questions, creates everything, writes config |
| `check` | Tells you whether the plugin can still see what it created, and repairs what it owns |
| `add` | Creates a database that is missing, and wires it into the ones already there |

Three rather than four: a separate settings skill would be a fourth thing to find
for a job people do roughly once.

**There is no settings path yet, and this said there was.** Until 2026-08-18
these documents described re-running `install` on a complete config as the way to
change an answer. `config.begin()` refuses to start on a complete config and
always has, there is no `settings` command, and nothing can reset the state from
the CLI, so the described route has never existed. Change an answer by editing
the config file directly. A real settings path is worth building and has not been
built.

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
node scripts/views.js                  # each view's filter, and the SQL that proves it
node scripts/relations.js              # the statements phase B sends
node scripts/install.js plan           # the whole run, in order
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

They hold the design, the code and Notion together. A count of them is not written here, for the same reason no other count is:

- The manifest agrees with the relation map in the design document, row by row,
  and does not contradict itself. No count written in a document disagrees with
  it, and the `--summary` output agrees with the data it summarises.
- Every property in the schema documents exists in `schema.js`, and nothing
  exists in `schema.js` that the documents do not define. Six databases, checked
  field by field against their own documents.
- `verify` catches what it claims to: a missing property, a wrong type, a missing
  option, options in the wrong order, an extra property somebody else added, and
  an empty response, which must read as a failure rather than a clean pass.
- The view compiler refuses what cannot work, and `verifyView` catches a filter
  that came back different, a filter that was silently discarded, a wrong layout
  and a dropped sort.
- Phase B builds one statement per relation, both ends of every two-way relation
  are checked, and a relation built the wrong way round is caught. A half-run
  phase B lists only what is absent, and a relation that is present but wrong is
  never added a second time.
- The config file cannot be pointed at a second database for a name it already
  holds, cannot be completed before it has been verified, and is never
  overwritten when it will not parse.
- **A whole install, as Notion returned it.** Every database, relation and view
  fetched back from a live workspace and compared field by field. This is the
  only test that can catch Notion behaving differently from what the code
  assumed, which it has done three times so far.

  **It records an older install than the manifest now describes**, so it carries
  a relation that was dropped on 2026-08-18, a property added after it was taken,
  and row evidence recorded as titles rather than page ids. Every one of those
  differences is asserted by name in `tests/full-install.test.js`, so a new
  difference fails rather than hiding among the known ones. The fix is to
  re-record it, not to loosen the test.

**A check is proved by breaking the thing it watches and confirming it goes
red**, because a check that has never failed is a check nobody has tested. That
was done for the original three files when they were written, and on 2026-08-18
for four of the new ones: the ISO date guard, the one-way versus two-way
relation check, the refusal to point config at a second database, and the
comparison of a view's rows against its rule. **The rest of the new checks have
not been broken on purpose**, and saying otherwise would be the shape of claim
this plugin exists to avoid.

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

- ~~Nothing here has touched a real Notion workspace.~~ **The whole install has,
  on 2026-08-18.** What remains unverified is anything a second person does with
  it: a workspace that is not empty, a connection with narrower capabilities, a
  parent page that is not reachable.
- **`In market` and `Upcoming` are narrower than the design asked for.** Both
  were specified with a date window and neither can have one: Notion's view DSL
  has no relative date, and a literal one is accepted and matches nothing. Both
  are built without the date clause and both carry a `reduced` note in the
  manifest saying so. Whether that is good enough is open.
- ~~Two Notion filter limits are unmeasured.~~ **Measured 2026-08-17 and both are
  real.** A multi-select filter cannot count values and a filter cannot read
  across a relation, both rejected with a 400. The workarounds were measured too:
  a counting formula comes back typed as text, and a rollup filter is accepted,
  reported as created, and silently emptied. The two rules stay with `check`, and
  both `check` queries had the half that finds the rows proved on real rows. Both
  selected the title that day and select `url` now, so which column comes back is
  not covered by that and the current strings have not been sent to Notion.
- **Whether the API can create a page template**, as opposed to apply one, is
  unknown.

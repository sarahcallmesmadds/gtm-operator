# Independent Codex review, 2026-08-17

Run because a self-review found only eleven findings and that was not credible.
Codex was given the five design files, told which eleven were already fixed, and
asked to find what was missed. It found twelve more.

**Two of them are bugs the earlier fixes created.** Findings 3 and 6 are both
downstream of the "a relation needs its target to exist" fix, which was applied
to external relations and not carried through to the rest of the design.

Command used: `codex exec --skip-git-repo-check -s read-only`, codex-cli 0.147.0,
read-only, working from this directory.

| # | Finding | Verdict | Status |
|---|---|---|---|
| 1 | `Review cadence` has no values and no time semantics | Correct | Fixed |
| 2 | A typo fix resets the whole review clock | Correct | Fixed |
| 3 | Three templates require a Software view that v1 does not create | Correct, and self-inflicted | Fixed |
| 4 | Memos correction path needs a relation that does not exist | Correct | Fixed |
| 5 | Notion now needs `data_source_id`, not just a database id | Correct, independently corroborated | Fixed |
| 6 | Self-relations also cannot be created in one pass | Correct, and self-inflicted | Fixed |
| 7 | "Map the types onto a set you already use" is incompatible with the rest | Correct | Resolved 2026-08-17: offer withdrawn, renaming only |
| 8 | Relation reads cap at 25, so `audit` can miss the newest memo | Correct | Fixed |
| 9 | A relation value caps at 100 pages, so `audit` degrades on old artifacts | Correct | Fixed with 8 |
| 10 | The claim "Notion silently drops an unknown select value" may be false | **Both accounts were wrong.** Tested | Resolved by measurement 2026-08-17 |
| 11 | `backfill` cannot honour "fills blanks, never overwrites" with no source identity | Correct problem, wrong fix proposed | Resolved 2026-08-17 with no new field |
| 12 | The required related views are described conceptually, not executably | Correct | Fixed as a build note |

---

## The two that were open, now resolved

### 7. Type remapping was promised and cannot be delivered

`setup` offers to let a user "keep the five or map them onto a set they already
use". But the five type names are load-bearing in four other places: the
type-selection tree, the rule that only a Strategy Decision can be a parent,
the supersession branch, and template selection. No mapping format exists in
config, and a display-name map is not enough, because the plugin would also need
to know which custom type means Strategy Decision, which template each one uses,
which may be parents, and which participate in supersession.

**Resolved 2026-08-17. The offer is withdrawn.** The five types are fixed in v1.
Setup explains them and offers renaming for display only. Using a genuinely
different set is a later version or a separate option.

### 11. `backfill` has no way to recognise what it already imported

"Never overwrites. It fills blanks only" cannot be implemented, because nothing
identifies which source item produced which artifact. The Sources body section is
prose and cannot be matched against. On a second run `backfill` cannot tell an
already-imported item from a new one, so it either duplicates everything or
overwrites, and both are ruled out by the current rules.

**Resolved 2026-08-17, and the recommended fix was wrong.** A `Source key` field
was proposed. Sarah pointed out that `new` and `update` already run a duplicate
check before writing anything, so backfill should use it rather than carry a
second, parallel mechanism for the same job.

**That is the better answer.** Every backfill candidate now goes through the same
duplicate check `new` uses before being offered. A second run over the same
folder finds the same documents, the check recognises them, and they never reach
the candidate list. One mechanism instead of two, and no new field.

The residual gap: a source document renamed after import may not match, and can
reappear as a candidate. The user sees it in the list and says no. A visible
one-click cost rather than a silent duplicate.

**The lesson:** the first instinct was to add a field. The right question was
which existing mechanism already answers this.

---

## The one that was measured rather than argued

### 10. Both accounts of unknown select values were wrong

**Tested against a live Notion workspace on 2026-08-17**, by creating a
throwaway database with exactly three `Domain` options and one with three `Tags`
options, then trying to write a value that was not on either list.

The two competing claims were:

- The reference skill: Notion silently drops the unknown value, so the write
  succeeds with the field empty.
- Codex: Notion creates the option, so the risk is a polluted taxonomy.

**Neither happens.** Notion returns a hard `400 validation_error`:

> Invalid multi_select value for property "Tags": "Completely Invented Tag".
> Value must be one of the following: "AI", "Data", "Tools". If a new
> multi_select option is needed, the data source must be updated to add it.

Confirmed identically for `select` and `multi_select`.

**Three things follow, and two of them change the design.**

1. **The failure is all or nothing.** Writing `["AI", "Completely Invented Tag"]`
   does not save `AI`. The page is not created at all. A skill that drafts a
   complete artifact and only discovers the bad value at write time loses the
   whole draft. This is why the option check belongs before drafting rather than
   at the moment of writing, and the rule now says so.
2. **The error is recoverable.** It names the offending value and lists the
   allowed ones, so a skill can catch it, drop or remap the value, and retry.
   Neither of the original theories allowed for that, because a silent drop
   cannot be caught and a created option does not error. Skills should handle it
   rather than surfacing the raw error at the user.
3. The prohibition itself was right the whole time, for a reason nobody had.

**Evidence quality.** Proved by running it, not by reading. The error carries a
Notion `request_id` and a server-side status, so it is the API's behaviour rather
than the client's. Tested through the Notion MCP connection, which is one client
path; a different library is very unlikely to differ, since the rejection is
server-side, but that is inference rather than measurement.

**The wider lesson.** An operational note carried forward from one company, and a
confident correction from a review, were both wrong about the same thing. Ten
minutes against a real workspace beat both. When two authorities disagree about
observable behaviour, measure it rather than picking one.

## Fixed, with what changed

**1. `Review cadence` had a writer but no schema.** The earlier fix added a
default in config and made `new` apply it, without ever defining the values. Now
enumerated in `SCHEMA-process.md`, with the interval each one means, so
`audit` can compute a date and `new` can obey the never-invent-a-value rule.

**2. A typo fix reset the review clock.** `update` set `Last checked for
accuracy` on every edit, and that field is what `audit` uses for staleness. So
correcting one word suppressed the staleness warning for a whole cadence period
on a document nobody had actually re-read. `Last checked` now moves only when the
user confirms an accuracy review, which is the same yes that sets `Verified`.

**3. Three templates required a view of a database v1 does not create.** SOP,
Reporting and Technical Reference each specified a Software related view, while
the relation fix had just made Software not exist in v1. Those three now use
views that exist.

**4. The memo correction path had no relation.** Memos is append-only and a
correction is "a new memo that relates to the old one", but no Memos-to-Memos
relation existed. Added.

**5. Database ids are not enough.** Notion's 2025-09-03 change means a database
can hold multiple data sources, and queries, page creation and relation targets
need a `data_source_id`. Corroborated independently by the reference skill spec,
which already noted resolving `data_source_id` at runtime on first use. `setup`
now stores both.

**6. Self-relations have the same bootstrap problem as external ones.** `Parent`,
`Child Docs` and `Superseded Strategy` all point at the Process Library itself,
whose id does not exist until it has been created. Setup is now explicitly two
stage: create the database, then add the self-relations using the returned id.

**8 and 9. `audit` could not see the newest related memo reliably.** Reading an
artifact's relation property returns at most 25 references, and a relation value
caps at 100 pages, so on any long-lived artifact the newest memo becomes
invisible and signal 2 quietly degrades. `audit` now queries Memos by the reverse
relation sorted by `Published date` rather than reading the artifact's own
relation list, which also settles that "newer" means `Published date` and not
`Created time`.

**12. The related views were not executable as written.** Descriptions like
"sibling docs under the same parent" need a filter tied to the current page.
Recorded as a build requirement: each view needs its filter, sort and placement
defined, using the Views and Data Sources APIs rather than treating an embedded
view as an ordinary block.

---

## What this says about the earlier review

The self-review found real problems but stopped too early, and it was not
independent. Two of its fixes introduced the bugs at 3 and 6, which is the
ordinary failure of changing one thing and not walking the consequences.

**Run an independent review before calling a spec done.** A self-review that
produces a tidy count is evidence of a tired reviewer, not a clean document.

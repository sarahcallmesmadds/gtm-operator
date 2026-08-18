# Independent Codex review, round 2, 2026-08-17

Run after six new files were written the same day: `SKILLS-setup.md`,
`SCHEMA-software.md`, `SKILLS-software.md`, `SCHEMA-calendar.md`,
`SKILLS-memos.md` and `SKILLS-calendar.md`, plus edits to the four older files.

Codex was given the twelve findings from round 1, told which were already fixed
and which were known-open, and asked to find what was missed.

**It found fourteen. Four are build blockers. None duplicate round 1.**

Command: `codex exec --skip-git-repo-check -s read-only`, codex-cli 0.147.0,
read-only, working from this directory. Session at
`~/.codex/sessions/2026/08/17/rollout-2026-08-17T15-56-14-00000000-0000-0000-0000-000000000000.jsonl`.
Full output at
`scratchpad/codex-review-full.md` in the session scratchpad.

| # | Finding | Verdict | Status |
|---|---|---|---|
| 1 | Renaming after install writes config values that do not exist in Notion | Correct | Fixed |
| 2 | The Notion API does not supply a "current user" for an internal connection | **Wrong for the connection this design uses.** Measured 2026-08-17 | Fix kept anyway, see below |
| 3 | The Problem Statement relation cannot power the reverse view its template promises | Correct | Fixed |
| 4 | Pinning the API version does not pin a client that exposes the Views API | Correct in structure, versions unverified | Fixed |
| 5 | The creation plan says nine relations, the map holds thirteen | Correct, mechanical | Fixed |
| 6 | `check` requires exactly one data source and permits a second in consecutive sentences | Correct, mine | Fixed |
| 7 | `add` says "in both directions", which is wrong for one-way relations and misdescribes dual ones | Correct | Fixed |
| 8 | Calendar requires a date and is designed around rows without one | Correct | Fixed |
| 9 | The clash check cannot tell whether two rows reach the same people | Correct problem, and the proposed fix adds a field | Fixed without a new field |
| 10 | Append-only conflicts with a Status field whose values require edits | Correct, and it holes the plugin's defining rule | Fixed |
| 11 | Corrections have no cardinality, ordering or cycle rules | Correct | Fixed |
| 12 | "Required" relations and "max 3" tags cannot be enforced by Notion | Correct, and it applies to four fields across three databases | Fixed |
| 13 | Preflight tests authentication, not the capabilities setup needs | Correct | Fixed |
| 14 | Skill counts in two files are stale since setup moved out | Correct, mechanical | Fixed |

---

## The four blockers

### 1. Renaming after install breaks every writer

`install` offers renaming for display, and re-running it is the settings path.
`check` says it "never renames anything in Notion". Put together, changing a name
on a re-run edits config and not the workspace, so the next write looks for a
property or an option that is not there. Changed Segment values are worse, because
they need options added to and removed from live data sources.

**Fixed by splitting one operation into three**, which is what the original text
had collapsed:

- **Adopt.** Point config at a property that already exists, resolved by property
  id. This is what `check` does when somebody renamed something in Notion, and it
  never writes to Notion.
- **Rename.** Change the name in Notion and then in config, in that order. This is
  what the settings path does, and it does write to Notion.
- **Add an option.** A new Segment value is an option added to every data source
  that carries the field.

**And one rule that would have caught it:** config may never name an option that
verification did not find in the workspace.

### 2. There is no "current user" to look up

`install` step 3 said to look up the user's Notion person id rather than asking
them to paste it. An internal connection is not tied to the person running Claude
Code, so the API's self endpoint returns the bot rather than the operator, and
listing workspace users needs a capability that may not be granted and cannot be
filtered by name or email.

**This breaks `Owner`, `Author`, `Verified by` and every person field on Software
and Tasks**, which is most of the person-shaped design.

**Fixed by making identity an explicit choice**, in three tiers, in order:

1. If the connection can list users, show them and have the user pick themselves.
2. If it cannot, ask them to paste their Notion profile link or id, with
   instructions on where to find it.
3. If neither works, record that there is no person id and **leave every person
   field empty**, which is the honest value and is already what `backfill` does.

**Measured 2026-08-17, and the finding was wrong for this connection.** Asking for
the current user returned a person with a name and an email, not a bot, and
listing workspace users worked and returned both people and bots.

**The finding is right about an internal integration token and wrong about a
user-authorised connector.** Both kinds exist, and a plugin cannot tell which it
has been handed without asking.

**The fix stays in.** The measurement proves tier 1 is reachable, not that it is
universal, and assuming it always works would be the same mistake pointing the
other way. This is the round's one incorrect finding, and it still improved the
design, because the original text assumed something it had never checked.

### 3. The problem-to-project trace is invisible on the problem

`SCHEMA-memos.md` gives the Problem Statement template a related view of "the
Projects relation. What was built in response." But `Projects.Problem Statement`
was specified one-way, so setting it populates nothing on the memo, and the only
`Projects` property on Memos is the inverse of the separate updates-and-releases
relation. Using that one would file a problem statement as a project update.

**This is the defining trace of the whole projects design**, since a project that
cannot name its problem statement has not been scoped, and it was invisible from
the problem's side.

**Fixed by making relation 5 two-way**, with the reverse named `Resulting
Projects` on Memos. A distinct name, because the two relations mean different
things and sharing a name is what caused the confusion.

### 4. The API version does not pin the client

The design needs the Views API and pins `Notion-Version: 2025-09-03` or later.
That is the wire version and it says nothing about whether the installed client
exposes view operations, so step 0 can pass and the build can fail at the point of
creating Calendar's views.

**Fixed by pinning both**, the exact wire version and a client floor, and by
requiring step 0 to check that the client actually exposes the view calls rather
than inferring it from a header.

Codex also flagged the database-template build risk as stale, citing current
documentation for applying data-source templates. **Verdict: unverified either
way.** It stays a build risk, reworded so it asks the right question, which is
whether templates can be created rather than applied.

---

## The two that changed a rule rather than a line

### 10. Append-only was never actually true

`SKILLS-memos.md` said "Nothing is edited after publishing. Not a typo, not a
name, not a date." The Memos `Status` field holds Draft, Published and Canceled.
Moving a memo to Canceled is an edit after publication, and so is Draft to
Published, and nothing supported either.

**The invariant was stated more broadly than it could hold**, which is worse than
stating it narrowly, because a rule with a known exception nobody wrote down is a
rule people learn to ignore.

**Fixed by narrowing it honestly.** After publication the body and every content
property are immutable. **Exactly one transition is permitted, Published to
Canceled**, which is a retraction, and it requires a correcting memo saying why.
Everything else is a new memo.

### 12. Four "required" things Notion cannot require

`Projects.Problem Statement` is required. `Tasks.Project` is required. `Tags` is
capped at three in two databases. Notion enforces none of it. The skills comply
and a person clicking New in Notion does not, and nothing in the design would ever
notice.

**Orphan tasks are the dangerous one**, because a task with no project is
invisible from every project, which is exactly why the field was made required.

**Fixed by adding detection rather than by pretending.** `setup:install` creates a
saved **Needs attention** view on each affected database, filtered to the rows that
break the rule. It costs nothing, it is visible to a person, and it turns an
unenforceable rule into a visible one.

Everywhere else the wording changes from "required" to "required by the skills,
and surfaced when it is not", because that is what is true.

---

## What this round says about the last one

Round 1 found twelve problems in five files. Round 2 found fourteen in ten,
**six of them in the file written to fix round 1's findings**, which is the same
pattern round 1 recorded about the self-review before it: fixing one thing and not
walking the consequences.

Three of this round's findings (5, 6, 14) are counts and wordings that drifted
while other things were being corrected, and all three would have been caught by
reading the file end to end rather than editing it in place.

**The rule that keeps earning itself: run an independent review before calling a
spec done, and run it again after fixing what it found.**

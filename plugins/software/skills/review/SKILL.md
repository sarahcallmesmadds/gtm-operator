---
name: review
description: A full pass over one tool in the Software directory, confirming everything on the row is still true, and the only thing that moves Last reviewed. Use before a renewal, when somebody who owned a tool leaves, when a row's freshness stamp is old, or when the user says "review this tool", "is this row still right", "sweep the directory". Stamps the date only on a confirmed pass; writes nothing without an explicit yes.
allowed-tools: Write, Bash(node:*), mcp__*__notion-fetch, mcp__*__notion-query-data-sources, mcp__*__notion-update-page
---

# review

What "reviewed" means, and holding the line on it.

**The failure mode this skill exists to prevent:** a sweep that opens forty
rows, changes nothing, stamps forty dates, and leaves a directory that looks
maintained and is not. **A review that finds nothing wrong is a real review
and stamps the date. A review that did not look is not.** The difference is
whether each group was actually asked about.

## How this skill works

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/software.js" review <changes.json> <existing.json> [--confirmed] --today YYYY-MM-DD
node "${CLAUDE_PLUGIN_ROOT}/scripts/software.js" prove-update <output.json> <readback.json>
```

Fetch the row and save the whole page. Walk the groups **in order**, asking
about each:

1. **Who owns it.** Owner, technical owner, admins, billing owner — still
   the right people? Somebody who left is cleared or replaced by name.
2. **What we pay and until when.** The contract dates, the notice deadline,
   the cost, how it renews. Before a renewal this group is the reason the
   review is happening.
3. **What it holds.** The security group — and **do not change those answers
   without asking**, because they came from somewhere, and replacing them
   silently loses the fact that they were checked.
4. **Whether it is still in use.** Status, audience, what is wired to it. A
   tool being wound down moves to `Sunsetting`, the one state somebody
   outside the owning team needs to see. A tool that is gone goes to
   `Retired`; the row stays.

## The stamp

After the walk, ask plainly: **did this count as actually confirming the
row?** Only a yes earns `--confirmed`, and only `--confirmed` moves
`Last reviewed`. The same gate `process:update` uses for `Verified by`.
Changes found along the way are written either way; the date is what the
confirmation governs.

## Batch mode

Reviewing forty rows in a sitting is real use and its shape is deliberately
undesigned (open question 1 in `SKILLS-software.md`). Until it is designed:
one row at a time, each with its own walk and its own confirmation. Refuse
the shortcut of one confirmation covering forty rows — that is the forty
stamped dates with nothing confirmed.

## Then prove it

Send the update, re-fetch the page, and run `prove-update` with the
command's own output. The stamp is proved by the date coming back, not by
the call returning.

---

## What this skill does not do

- **Does not stamp on a glance.** No confirmation, no date.
- **Does not archive or delete a row.** `Retired` keeps the history.
- **Does not change the security group silently.**
- **Does not create rows or fill person fields nobody named.**

---
name: backfill
description: Find the tools you already pay for, by reading a folder of contracts and your own mailbox, and offer them as candidates approved one at a time. Use after setup, when the user says "backfill the directory", "find what we subscribe to", "import our tools", "what are we paying for", or whenever enough time has passed for new subscriptions to appear. Email is read-only and the user's own; never fills a person, an importance, or the review stamp; writes nothing without a yes per row.
allowed-tools: Write, Bash(node:*), mcp__*__notion-fetch, mcp__*__notion-query-data-sources, mcp__*__notion-create-pages, mcp__*__notion-update-page, mcp__*__search_files, mcp__*__read_file_content, mcp__*__download_file_content, mcp__*__search_threads, mcp__*__get_message, mcp__*__get_thread, mcp__*__list_threads
---

# backfill

The skill that makes the directory possible: a tool directory is worth having
and nobody will sit down and type a hundred rows, so one that can only be
filled by hand does not get filled. Designed to be re-run, not run once.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/software.js" context
node "${CLAUDE_PLUGIN_ROOT}/scripts/software.js" backfill-scope <request.json>
node "${CLAUDE_PLUGIN_ROOT}/scripts/software.js" directory
node "${CLAUDE_PLUGIN_ROOT}/scripts/software.js" duplicates <rows.json> <name>
node "${CLAUDE_PLUGIN_ROOT}/scripts/software.js" backfill-candidates <found.json>
node "${CLAUDE_PLUGIN_ROOT}/scripts/software.js" backfill-draft <candidate.json>
node "${CLAUDE_PLUGIN_ROOT}/scripts/software.js" backfill-create <candidate.json>
node "${CLAUDE_PLUGIN_ROOT}/scripts/software.js" prove-backfill <candidate.json> <readback.json> <created-url>
node "${CLAUDE_PLUGIN_ROOT}/scripts/software.js" backfill-fill <existing.json> <candidate.json>
```

**The approval gate is the whole design.** A junk candidate costs one "no",
so the judgments are allowed to be roughly right. Two things are not, because
they survive a "no": what was read, and what lands on a page. Both are
refusals in code.

---

## Step 0. Refuse to start without config

Run `context`. If it refuses, print what it said and stop.

## Step 1. Agree the scope before reading anything

Ask which sources and, for email, how far back. Put the answer in
`request.json` and run `backfill-scope`.

```json
{
  "sources": ["contracts", "email"],
  "contracts": { "folder": "Always Allow › Contracts" },
  "email": { "from": "2025-08-25", "to": "2026-08-25" }
}
```

**This is the only gate there is** — by the time a candidate list exists, the
reading already happened — so `backfill-scope` refuses rather than narrows: an
unknown source, settings for a source not listed, half a date range, a day
that does not exist, an unreadable mailbox value. A refused scope carries no
plan at all, and reading the good half of a refused scope is still reading a
scope nobody agreed to.

The rules it holds:

- **A folder the user names.** Not a whole Drive, not a search across
  everything they can see.
- **The user's own mailbox, with a date range.** There is no unbounded read.
  Offer a year as the default, because it catches one full renewal cycle, and
  let them say yes out loud. **There is no mailbox setting at all**: the
  scope command refuses a request that names one, because the only honest
  shapes are the default (their own) and a refusal.
- **Email is read-only.** Never send, reply, label, archive, move or mark
  anything. Read to find vendors and do nothing else.
- Show `notReading` before starting: a source left out and a source that held
  nothing produce the same empty result.

## Step 2. Read, and collect findings

From the folder: agreements, order forms, renewals. From email: invoices,
receipts, renewal notices, support threads, product announcements. Collect
each as `{ what, where, kind }` — `where` down to the file or the message,
because nothing is absorbed anonymously — and run `backfill-candidates`.

When the named contract folder is in Box, use the packaged Box connector to
find files inside that folder and read their content. Do not widen the search
to the rest of Box. A Google Drive folder uses the user's existing Drive
connection instead.

**The two sources are not equally good, and every candidate says which it
rests on.** A contract proves an agreement on these terms and can fill the
whole contract group. An email proves the tool is in use and fills the name
and honestly little else. An announcement is the weak one: vendors email
people who never bought anything. The output carries the strength per
candidate; a finding with no kind comes back under `needKind` — offer the
kinds, do not decide alone.

## Step 3. The duplicate check, per candidate

Run `directory` once, then `duplicates` for **every** candidate before it is
offered — the same check `new` uses, which is what makes backfill safe to
re-run. A renamed product may still arrive as a candidate, because renames
keep no former name; that costs one "no" at the gate, by design.

## Step 4. The list, one at a time

Yes, no, or skip for now — say where each came from and how strong it is. Do
not batch it into a single approve-all: the list is the product. Ask `Status`
here (a tool in a live contract is usually Active, and the person says so).

## Step 5. Draft, preview in full, write, prove

For each yes, put the fields the evidence supports on `candidate.row` and run
`backfill-draft`. What the gate holds:

- **Never a person field.** Four fields here are people and all four stay
  empty. Notify the real people instead of guessing.
- **Never `Importance`.** A receipt carries no information about consequence.
  It stays empty until a person answers the what-breaks question.
- **Never `Last reviewed`.** A machine pulled the row in; empty is honest,
  and it is what makes the row show up for review.
- Handing the gate any of those is **refused, not ignored** — approving a
  candidate and having something smaller run is the one failure the approval
  gate cannot see. So is any field outside the fillable set, and any invented
  select value, now rather than at write time.
- From a contract, put the PDF's Drive link in `Contract link` — that link is
  how the row can ever answer an exact question about the terms.

Preview the full row, then `backfill-create`, create the page, re-fetch it,
and run `prove-backfill` with the url the create returned. **The proof checks
absence as well as presence**: a backfilled page that came back stamped,
owned or weighted is reported as a failed write, because it silently drops
out of the review signal.

**Say it is a backfill when you report it.** The row has no owner and nothing
has verified it; that is the design, not a gap.

## Filling blanks on a row that already exists

When a candidate matches an existing row and the person wants it enriched
rather than duplicated, fetch the row and run `backfill-fill`. It fills only
fields that are genuinely empty, **never overwrites** — a machine replacing
what a person wrote is the one damage the approval gate cannot undo — and
returns the changes for `update` to send after the person approves them.
Filling nothing is a finished answer, not a failure.

---

## What this never does

- **Never runs unattended.** No scheduled runs, no unsupervised generation.
- **Never reads outside what it was pointed at.**
- **Never sends, labels or moves an email.**
- **Never decides what belongs in the directory.** It offers judgment; a
  person applies it.

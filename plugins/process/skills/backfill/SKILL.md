---
name: backfill
description: Fill the Process library from material that already exists, by proposing candidates you approve one at a time. Reads scoped documents, Slack, email, call transcripts, calendars, CRM activity, billing, or spend evidence, offers what it found as a list, and writes only the yeses. Never fills an owner and never marks anything verified. Triggers on "backfill the library", "import our old SOPs", "what should be written down that isn't", "pull our process docs into Notion".
---

# backfill

Fills the library from material you already have. It gathers candidates, you go
through them saying yes or no, and only the yeses get drafted.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/process.js" context
node "${CLAUDE_PLUGIN_ROOT}/scripts/process.js" scope <request.json>
node "${CLAUDE_PLUGIN_ROOT}/scripts/process.js" repeats <askings.json>
node "${CLAUDE_PLUGIN_ROOT}/scripts/process.js" candidates <found.json>
node "${CLAUDE_PLUGIN_ROOT}/scripts/process.js" draft <candidate.json>
node "${CLAUDE_PLUGIN_ROOT}/scripts/process.js" fill <existing.json> <candidate.json>
```

**The approval gate is the whole design.** A candidate that turns out to be junk
costs one "no", so the judgments here are allowed to be roughly right. Two
things are not: what you were allowed to read, and what gets written onto a
page. Both are refusals in code rather than advice in this document.

---

## Step 0. Refuse to start without config

Run `context`. If it refuses, print what it said and stop.

---

## Step 1. Agree the scope before reading anything

Ask which sources, and for each one, how far back. Put the answer in
`request.json` and run `scope`.

```json
{
  "sources": ["documents", "slack", "email", "recordings", "calendar", "crm", "finance"],
  "documents": { "where": "Drive › GTM handbook" },
  "slack": { "channels": ["#gtm", "#support"], "dms": [], "from": "2026-01-01", "to": "2026-08-27" },
  "email": { "mailbox": "own", "from": "2026-01-01", "to": "2026-08-27" },
  "recordings": { "recorder": "gong", "from": "2026-01-01", "to": "2026-08-27" },
  "calendar": { "provider": "google-calendar", "calendars": ["primary"], "from": "2026-01-01", "to": "2026-08-27" },
  "crm": { "providers": ["hubspot", "salesforce"], "objects": ["accounts", "deals", "activities"], "from": "2026-01-01", "to": "2026-08-27" },
  "finance": { "providers": ["stripe", "ramp"], "records": ["subscriptions", "invoices", "transactions", "vendors", "expenses"], "from": "2026-01-01", "to": "2026-08-27" },
  "ways": ["repeats", "topics", "sweep"],
  "topics": ["how refunds get handled", "how inbound leads get routed"]
}
```

The packaged connectors map onto those sources like this:

| Source | Packaged connectors |
|---|---|
| `documents` | `notion`, `atlassian`, `google-drive` |
| `slack` | `slack` |
| `email` | `gmail` |
| `recordings` | `granola`, `gong` |
| `calendar` | `google-calendar` |
| `crm` | `hubspot`, `salesforce` |
| `finance` | `stripe`, `ramp` |

One recording source is named per scope. Run a separate scoped pass when both
Granola and Gong should be searched, then combine the candidate list before the
approval step.

**This is the only gate there is.** Everywhere else in this skill, being wrong
costs a "no" from the person. Not here: by the time there is a candidate list,
the reading has already happened. So `scope` refuses rather than narrowing, and
a refusal is a question for the person rather than something to work around.

What it will refuse:

| | Why |
|---|---|
| No source, or one it does not know | A run that quietly drops a source reports on less than was asked about |
| Settings for a source that is not in `sources` | The request disagrees with itself. Either the source was left off the list or its settings were left behind, and those want opposite repairs |
| A conversation or activity source with no date range, or half a range | There is no unbounded read. "All history" is the absence of a scope, not a wide one |
| `"dms": "all"` | Direct messages are named one by one or not read. A public channel is somewhere people chose to speak in front of the workspace; a direct message is not |
| Anyone's mailbox but the user's own | An approval gate on the output does not make reading somebody else's mail acceptable, because the reading already happened |
| A `mailbox` that is set to something unreadable, such as a list | Absent means the user's own. Something supplied and unreadable is a scope somebody set, and replacing it with the default reads a mailbox nobody agreed to |
| Call recordings with no recorder named | Setup asks whether one is connected and does not assume |
| Slack with no channels said out loud | "All" and a named list are both offered. Neither is assumed |
| Calendar with no provider or calendar list | A connected account and a defined set of calendars are both part of the read boundary |
| CRM with no provider list or object families | "The CRM" is not a scope; use `hubspot` or `salesforce` and name what to search |
| Finance with no provider list or record families | Financial data is sensitive and large; use `stripe` or `ramp` and name what to search |
| Topics without choosing that way of looking, or the other way round | Turning a mode on quietly is how a run reads more than was agreed |
| A list entry that is not a name, anywhere | Dropping it is narrowing. `sources: ["slack", 42]` covering one source and reporting success is the failure this whole step exists to prevent |
| A date written as one that is not one, such as `2026-02-30` | Parsed loosely it rolls forward into March and reads a window nobody set |

**A refused scope carries no plan at all.** Not `reading`, not `ways`, not
`topics`, and not the half of it that was fine. Reading the good half of a
refused scope is still reading a scope nobody agreed to.

**Show `notReading` to the person before you start.** A source that was left out
and a source that held nothing produce the same empty result, and only one of
them is worth saying out loud.

**Every connector is read-only in this skill.** Some packaged servers also
offer write tools, but this skill never sends messages or email, changes a
calendar or CRM record, creates a Stripe object, approves Ramp work, initiates a
payment or transfer, or changes a card or credential.

**Gong is a transcript source, with a capability distinction.** Its hosted MCP
currently returns answers derived from calls and emails, not raw transcript
text. Use those answers as transcript-derived evidence and label them that way.
If raw transcript text is required and no Gong API or export surface is
connected, list that source as unavailable rather than claiming it was read.

In Claude Code, an already installed Salesforce CLI or Ramp CLI can be a
read-only fallback when the hosted connector is unavailable. The plugin does
not install either CLI. Confirm the org or account first and never use a CLI to
create, update, delete, deploy, approve, pay, transfer, or change credentials.

---

## Step 2. Look, in whichever ways were chosen

All three ship. They answer different questions and more than one can run.

| Way | What you give it | What it finds |
|---|---|---|
| **topics** | The topics, named | Exactly what was asked for. Precise, and limited to what somebody already knows is missing |
| **repeats** | Nothing | Questions asked three or more times, on the reasoning that anything asked that often should have been written down. Finds the gaps nobody knew about |
| **sweep** | The scope and the range | Whatever looks like durable process knowledge in that window |

For **repeats**, collect every asking as `{ question, where, when }` and run
`repeats`. It clusters them and reports the ones that reached three.

**An asking with no `where` is refused and nothing is clustered.** This is the
one mode that reads things people said rather than things they wrote down for
the record, so a candidate nobody can trace back is a candidate nobody can
check.

**The clustering is imprecise and that is accepted here and only here.** Whether
"how do we do refunds" and "what is the refund process" count as the same
question needs tuning against real workspaces, which do not exist yet. The
output is a list somebody scans, so a wrong cluster costs one "no". Show the
different wordings and let the person decide.

---

## Step 3. Turn what you found into candidates

Put everything found into `found.json` as `{ what, where, kind, type, why }` and
run `candidates`.

- **`where` is required on every one.** Down to the channel, the thread, or the
  meeting and date. Nothing is absorbed anonymously.
- **A type it does not recognise is refused now**, rather than at write time
  with a drafted artifact already lost.
- **No type at all is a question, not a refusal.** It comes back under
  `needType`. Offer the type tree, do not decide alone.

Then, **for every candidate, run `duplicates` and `judge`** before offering it.
That is the same check `new` uses, and it is what makes backfill safe to re-run:
a second pass over the same folder finds the same documents and the check
recognises them. There is no separate import-tracking field, on purpose. One
mechanism rather than two.

`withinRunNearMatches` is a different thing and catches what the library check
cannot: the same process described in two channels, arriving as two candidates
in one run, neither of them in the library yet.

**The gap worth knowing:** a source document renamed since it was imported may
not match, and can come back as a candidate. You would see it in the list and
say no. That is a one-click cost rather than a silent duplicate, and it is the
whole reason for the approval gate.

---

## Step 4. Go through the list with the person

One at a time. Yes, no, or skip for now. Say where each one came from.

Do not batch this into a single "approve all". The list is the product.

---

## Step 5. Draft the yeses

For each yes, draft the content from what was actually read, and run `draft`.

It gives back an artifact carrying `"backfill": true`, and that flag is what
keeps four fields off the page:

- **`Owner` and `Verified by` stay empty.** Backfill never fills a person field.
  An agent guessing at an owner is worse than an empty field. Notify the real
  person instead.
- **`Verified date` and `Last checked for accuracy` stay empty.** A machine
  pulled this in and nobody has read it. Empty is the honest value, and it is
  what makes `audit`'s never-verified signal mean something: an artifact stamped
  by the import that created it is indistinguishable from one somebody checked.

**Handing `draft` any of those four is refused, not ignored.** A field it dropped
quietly would leave you believing it was set.

**And `prove` checks the page came back without them.** A backfilled page is
proved by what is not on it as much as by what is, because a page that arrived
stamped drops out of the never-verified signal without anything saying so.

**The Sources section is generated from the sources, not written beside them.**
Hand `draft` the sources as `{ what, contributed }` and it renders the section
itself. A section that says one thing while the record says another is refused,
because "this came from there" is the only claim backfill makes that a reader
can check.

Anything under `problems` is content still to be written from what was read. It
is not licence to invent a section.

---

## Step 6. Preview, then write

Preview each draft **in full** before writing. Then `create` and `prove`, the
same two steps `new` uses.

**Keep the url the create returned and pass it to `prove`.** It refuses without
it: otherwise it checks that some page has the right shape rather than that the
page just written does, and the backfill absence check below sits on top of
that, so it would prove only that some page was unstamped.

**Say it is a backfill when you report the write.** The page is not what `new`
would have made: it has no owner and nothing has verified it, and `audit` will
flag it until somebody does.

---

## Filling blanks on something that already exists

When a candidate matches an artifact that is already in the library, and the
person wants it enriched rather than duplicated, run `fill` with the fetched row
and the candidate.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/process.js" fill <existing.json> <candidate.json>
```

It gives back an `after` row for `update`, holding only the fields that are
genuinely empty on the row as it stands.

- **It never overwrites.** A field that already holds something is reported and
  left alone. A machine replacing what a person wrote is the one kind of damage
  the approval gate cannot undo.
- **It fills no person field**, on a blank row as much as on a full one, and
  it never marks anything verified. Offering it one of those four refuses the
  whole update rather than quietly dropping the field and filling the rest:
  approving a candidate and having something smaller run is the one failure
  the approval gate cannot see. Take the refused fields off the candidate and
  run it again.
- **`reviewed` is false and stays false.** Nobody re-read the artifact, so
  `update` leaves all three verification fields where they are.
- **Pass both the row and the candidate through logical names.** A raw fetch from
  a renamed workspace reads as blank in every field, which would turn "fill the
  blanks" into "fill everything"; a raw-keyed candidate reads as offering
  nothing, so you would be told there was nothing to fill. Both are refused
  rather than guessed at.
- **Then `prove-update`.** On a `reviewed: false` edit none of the three
  verification fields is sent, so nothing in the payload would notice one moving.
  `prove-update` compares them against what the fetched row held, and a field
  that was empty and comes back holding something is reported rather than
  passed.

Filling nothing is a finished answer, not a failure, and it exits zero. Being
refused is neither: it exits non-zero and says which field stopped it.

---

## What this never does

- **Never runs unattended.** No scheduled runs, no unsupervised generation.
- **Never reads outside what it was pointed at.**
- **Never decides what belongs in the library.** It offers judgment; a person
  applies it. Being usefully wrong in a list somebody can scan is the job.
  Being confidently wrong in the library is not.

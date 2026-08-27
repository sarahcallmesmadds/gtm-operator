---
name: problem-scan
description: Find problems that keep coming up and that nobody has written down, from bounded conversation, meeting, CRM, sales-engagement and support context the user selects, and hand the ones worth writing up to problem-statement pre-filled. Use when the user says "what problems keep coming up", "scan for problems", "what's causing friction", "what should we be fixing", or before a planning cycle. Reads external sources only and writes nothing to Notion, not a row, not a draft.
---

# problem-scan

Find the friction everybody works around and nobody has ever named.

**The line this skill holds: it offers candidates and decides nothing.** A
weak signal produces a line in a list that costs one "no", never a document.
`problem-statement` writes up a problem you already know about; this finds the
more common case, the one nobody has named, the same shape as
`process:backfill` applied to problems instead of process.

---

## Step 1. Set the scope, and never widen it

Scope is the user's to set, and the defaults lean closed, the same rules as
`process:backfill`:

| Source | Packaged connectors | Rule |
|---|---|---|
| Internal conversations | Slack | Public channels are all or a named set. Direct messages are never all; the user names each conversation |
| Email | Gmail | The authenticated user's own mailbox, with a date range |
| Call recordings | Granola, Gong | One recorder per pass, named by the user |
| CRM | HubSpot, Salesforce | Name the providers, object families and account, deal, opportunity, case or project filters |
| Sales engagement | Outreach | Name the accounts, prospects, sequences, tasks or meetings to search |
| Customer support | Intercom, Pylon | Name the accounts, contacts, conversations or issues to search |
| Date range | Every source | Required for every source. There is no unbounded read |

When that recorder is Granola, use its meeting search and read tools inside the
approved date range. `get_meeting_transcript` is available only on paid Granola
plans, so fall back to the meeting notes or report the transcript as unread
when the tool is unavailable.

Gong's hosted MCP returns answers derived from calls and emails rather than raw
transcript text. Use those answers as transcript-derived evidence and label them
that way. If raw transcript text is required and no separate Gong API or export
surface is connected, report it as unavailable rather than claiming it was read.

HubSpot, Salesforce, Outreach, Intercom and Pylon are used only to read context.
The same is true for Slack and Gmail. Some of these connectors also offer write
tools, but this skill never sends or drafts a message, changes a CRM record,
enrols a prospect, changes a sequence or task, updates or assigns a support
issue, adds a note, or changes an account or contact. Notion is not written by
this skill either; `problem-statement` holds the later approval and write gate.

An unavailable optional connector is listed under `notReading`, with the reason.
It never causes the scan to substitute a different source or silently widen the
sources that remain. Intercom currently supports US-hosted workspaces. Outreach
requires the organization's MCP server and an eligible licensed user. Pylon
requires OAuth and a Member or Admin seat.

**Do not read outside what the user pointed at.** Every candidate must say
where it came from, down to the channel, the thread, or the meeting and date,
and to the CRM, Outreach or support record when one contributed. This skill
reads things people said and systems recorded rather than things written for
the project record.

---

## Step 2. Look for the two signals, and say which fired

Telling a recurring problem from a one-off complaint is the whole judgment:

1. **Different people describing the same friction.** The strongest signal,
   and the one a single person cannot produce.
2. **The same person raising it repeatedly over time.** Weaker on its own,
   because it can be one person's hobby horse, but strong when the gap between
   mentions is long.

**A single complaint from one person on one day is not a candidate.**

---

## Step 3. Offer the list

One line per candidate: the problem, who described it, how often it came up,
and where. Say which signal fired for each. The user picks the ones worth
writing up.

**Do not rank or prioritise them.** Priority is set at the end of `scope`,
once effort is known, and guessing earlier is guessing.

---

## Step 4. Hand the yeses to problem-statement

For each one the user picks, open `problem-statement` pre-filled: what is
happening, who described it, and the evidence lines with their sources. That
skill previews and writes; this one never does.

---

## What this skill does not do

- **Writes nothing to Notion.** Not a row, not a draft. The handoff to
  `problem-statement` is the only output.
- **Does not decide something is a problem.** It offers candidates.
- **Does not rank or prioritise.** That is `scope`'s job, once effort is known.
- **Does not read outside the scope the user set**, and never all DMs.
- **Does not write to an external connector**, even when that connector exposes
  write-capable tools.

---
name: problem-scan
description: Find problems that keep coming up and that nobody has written down, from conversations inside a scope the user sets, and hand the ones worth writing up to problem-statement pre-filled. Use when the user says "what problems keep coming up", "scan for problems", "what's causing friction", "what should we be fixing", or before a planning cycle. Reads only. Writes nothing to Notion, not a row, not a draft.
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

| Source | Rule |
|---|---|
| Public channels | Either all of them, or a set the user picks. Offer both |
| Direct messages | **Never, unless the user names specific ones.** Not "all DMs" as an option, not a checkbox. The user hands over particular conversations or this does not look |
| Email | The user's own mailbox, with a date range |
| Call recordings | Whatever recorder is connected, which `setup` asked about. Off unless one is |
| Date range | Applies to every source. There is no unbounded read |

**Do not read outside what the user pointed at.** Every candidate must say
where it came from, down to the channel, the thread, or the meeting and date,
because this skill reads things people said rather than things they wrote for
the record.

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

---
name: contracts
description: What renewals and notice deadlines are coming up in the Software directory, and what happens if you do nothing. Use when the user asks "what's renewing", "any contracts coming up", "what do we need to cancel", "what's due this quarter", or before budget planning. Read-only; changes nothing, cancels nothing, contacts nobody, and never moves Last reviewed.
allowed-tools: Write, Bash(node:*), mcp__*__notion-fetch, mcp__*__notion-query-data-sources
---

# contracts

What is coming up, and the consequence of doing nothing about each one.

Run by a person, never by a clock: v1 has no unattended runs anywhere in the
marketplace. The same shape as `process:audit`, which is the precedent that
makes this shippable without an integration.

## How this skill works

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/software.js" contracts-survey
node "${CLAUDE_PLUGIN_ROOT}/scripts/software.js" contracts <rows.json> --today YYYY-MM-DD [--window days]
```

Send the survey query, save the result whole, and pass it to `contracts`
with today's date. The window defaults to ninety days.

## How to read the output, and how to report it

- **`deadlines` is the list that matters**, ordered by consequence rather
  than by date: a sixty thousand dollar contract with a notice deadline in
  three weeks outranks a three hundred dollar one auto-renewing next week.
  `Renews: Automatically` is what turns a date into a deadline. Every row
  carries its `why`; report it, not just the date.
- **`diary` is the same dates without the automatic renewal**: doing nothing
  means those lapse rather than renew. Worth a line, not an alarm.
- **`couldNotAssess` is half the answer, and it is never dropped from the
  report.** An empty date does not match a date filter in Notion, so the
  rows with no contract data are exactly the ones any filtered view silently
  omits, and a report without this count reads as "nothing is due". Each row
  says why it could not be assessed: no notice deadline, no contract dates,
  or Renews unknown. Offer them to `review` — they are the work list.
- An overdue automatic deadline is reported as already committed, unless the
  vendor says otherwise. Do not soften it.

## The hard lines

- **Reads only. Writes nothing at all**, including `Last reviewed`, because
  reading a list is not reviewing a row.
- **Never cancels anything, contacts a vendor, or drafts an email.**
- **Never reports a renewal as handled.** It reports dates and consequences,
  and hands the list to `review`.

---
name: meeting-notes
description: Turn a meeting into a record of what it decided, using a Granola or Gong meeting source plus explicitly scoped Slack or Gmail context when requested, as one Meeting Notes memo, and offer to write the confirmed actions into Tasks. Use when the user says "write up the meeting", "notes from the call", "what did we decide", hands over a transcript, or asks after any meeting whose decisions somebody outside the room needs. Proposes decisions for confirmation, never invents one, and writes nothing without an explicit yes.
allowed-tools: Write, Bash(node:*), mcp__*__notion-fetch, mcp__*__notion-query-data-sources, mcp__*__notion-create-pages, mcp__*__notion-update-page, mcp__*__search_meetings, mcp__*__get_meeting_transcript, mcp__plugin_memos_gong__*, mcp__*__search_messages_and_files, mcp__*__read_channel, mcp__*__read_thread, mcp__*__search_threads, mcp__*__get_message, mcp__*__get_thread
---

# meeting-notes

The record of what a meeting decided, not what it discussed.

**The line this skill holds: meeting notes fail by becoming transcripts.**
Nobody reads a transcript, and the decisions inside one are unfindable a month
later. Decisions first, Discussion Notes last and optional, and the transcript
itself never pasted in.

## How this skill works

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/memos.js" context
node "${CLAUDE_PLUGIN_ROOT}/scripts/memos.js" check <proposed.json>
node "${CLAUDE_PLUGIN_ROOT}/scripts/memos.js" create <memo.json>
node "${CLAUDE_PLUGIN_ROOT}/scripts/memos.js" prove <memo.json> <readback.json> <created-url>
node "${CLAUDE_PLUGIN_ROOT}/scripts/memos.js" tasks <actions.json>
node "${CLAUDE_PLUGIN_ROOT}/scripts/memos.js" prove-task <task.json> <readback.json> <created-url>
```

The general write rules are `new`'s and are not restated: refuse without
config, fetch live select options before choosing any value, preview in full
inline, create only on an explicit yes, prove every write, and never edit a
published memo.

---

## Step 1. Get the meeting

Read the transcript from whatever call recorder is connected, which `setup`
asked about, or notes the user pastes, or both. **Do not read a recording the
user did not point you at.**

When the connected recorder is Granola, use its meeting search and read tools.
Raw transcripts come from `get_meeting_transcript` and require a paid Granola
plan; when that tool is unavailable, work from the meeting notes or ask the
user to provide the transcript rather than claiming it was read.

When the connected recorder is Gong, use it as the transcript source for this
workflow. Gong's hosted MCP returns answers derived from calls and emails rather
than raw transcript text. Label that evidence `transcript-derived`. If exact raw
transcript text is required and no separate Gong API or export surface returns
it, report raw transcript coverage as unavailable instead of claiming the text
was read.

If the user names related Slack or Gmail context, read only the exact thread or
the bounded channel or own-mailbox search they approve. Those messages can
clarify what led into the meeting or what was settled afterwards, but they do
not replace the meeting source. Never post, send, draft, react, label, archive,
move or mark anything in either service. Say which context was actually opened
in the preview and final report, and keep an unavailable or unapproved connector
under `notReading`. Meeting Notes has no Sources section, so do not invent one.

If reading the transcript in full is the work, do that before writing
anything. A decision on page nine reads exactly like no decision if page nine
was never read.

---

## Step 2. Separate the decisions from the discussion

People talk in circles and settle things by implication. "I guess we could
just do the second one" is a decision and does not look like one. **Propose
what you think was decided and let the user confirm**, because getting this
wrong in either direction is expensive: a missed decision gets relitigated,
and an invented one gets acted on.

**If nothing was settled, write that.** A meeting that decided nothing is
worth knowing about.

---

## Step 3. Sort what remains into Actions and Open Questions

**An action names a person and a date. An action missing either is a wish.**
Ask for what is missing, and if the answer is not available, record the item
under Open Questions instead, where it belongs. **Never guess an owner.**
Guessed owners are the fastest way to make a team stop trusting the notes.

Anything raised and unresolved goes to Open Questions, so it is not lost
between meetings. The temptation is to convert it into an action with a
guessed owner so the notes look complete; resist it.

---

## Step 4. Draft, preview, write, prove

The body is Decisions, Actions, Open Questions, and Discussion Notes only when
reasoning will matter later. Draft it, run `check`, preview the whole body
inline, create on an explicit yes, then read the page back and run `prove`
with the created url. Never report success with a section missing.

---

## Step 5. Offer the actions as tasks

**Ask first. Never create tasks silently.** On a yes, write the confirmed
actions to a file, one entry per action:

```json
[{ "what": "Send the revised deck", "who": "<notion person id or me>", "due": "2026-09-01" }]
```

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/memos.js" tasks actions.json
```

The `who` is a Notion person id: search the workspace users for the name and
pass the id, or pass `me` for the configured person. The script refuses a name,
because Notion identifies people by uuid and its error would point at the
property rather than the name.

This writes rows into the Tasks database directly. That is the design: any
plugin may write to any database, no plugin may call another plugin's skill.

**The Project relation is not written**, and the output says so. Each created
task is an orphan until a person links it in Notion, which is exactly what the
Tasks "Needs attention" view surfaces. Name the project each task belongs to
so the links can be made, and say this plainly rather than reporting the tasks
as filed.

Create each task, re-fetch it, and run `prove-task` per task.

---

## What this skill does not do

- **Does not paste the transcript into the body.** Discussion Notes is for
  reasoning that will matter later, not for a record of everything said.
- **Does not invent decisions**, and does not miss them silently: it proposes
  and the user confirms.
- **Does not accept an action without a person and a date.**
- **Does not create tasks without asking**, and never silently.
- **Does not read a recording the user did not point it at.**
- **Does not call transcript-derived Gong evidence a raw transcript.**
- **Does not edit a published memo.** A correction to the notes is a new memo
  with `Corrects` set, through `new`.

---
name: new
description: Write one memo into the Memos log, of any of the seven types, from free-form notes. Use when the user says "send a memo", "put this on the record", "write up this recommendation", "announce this", "write the problem statement", "write the release note", "write the incident report", or asks to fix or correct an existing memo, which becomes a new correcting memo. Writes one page and its body. Writes nothing without an explicit yes, and never edits anything.
allowed-tools: Write, Bash(node:*), mcp__*__notion-fetch, mcp__*__notion-query-data-sources, mcp__*__notion-create-pages, mcp__*__notion-update-page
---

# new

Turn free-form notes into one memo, in the shape its type calls for, with the
date that makes it a record.

**The line this skill holds: a memo is frozen the moment it publishes.** Not a
typo, not a name, not a date is ever edited afterwards. When somebody asks to
fix a memo, the answer is a new memo with `Corrects` set, and this skill is
where that happens.

## How this skill works

**`scripts/memos.js` decides what to send. You send it.** The Notion calls go
through the connected client, which a script cannot reach, so the script builds
every payload, checks every value and judges every answer, and you make the
calls in between.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/memos.js" context
node "${CLAUDE_PLUGIN_ROOT}/scripts/memos.js" check <proposed.json>
node "${CLAUDE_PLUGIN_ROOT}/scripts/memos.js" create <memo.json>
node "${CLAUDE_PLUGIN_ROOT}/scripts/memos.js" prove <memo.json> <readback.json> <created-url>
```

**Do not build a property payload by hand.** It resolves the workspace's own
property and option names through the config map, and a payload carrying the
names this plugin shipped with writes to properties that do not exist on a
renamed workspace.

**Never invent a select value.** Fetch the property's current options from
Notion before choosing any value. Notion refuses a value the property does not
have with a 400, and the refusal is all or nothing: the page is not created and
the drafted memo is lost. That is why `check` runs before drafting rather than
at the point of writing. The error is worth catching rather than surfacing raw:
it names the offending value and lists the allowed ones, so drop or remap and
try again.

---

## Step 0. Refuse to start without config

Run `context`. If it refuses, print what it said and stop. It names the plugin
to run, which is `setup`, and this skill never creates a database and never
writes config. Do not rely on the README for this: a user arriving here has not
read it.

---

## Step 1. Is this a memo at all

The most common mistake will be writing process documentation as a memo,
because a memo is quicker. The test: **will somebody return to this and
maintain it, or does it record what was said on a date?** Reference that gets
maintained is an artifact; point at `process:new` and say why. The judgment
goes the other way too: a status update written as an SOP is just as wrong.

---

## Step 2. Which of the seven types

Ask the tree rather than deciding alone. When two match, ask the user; do not
take the first.

1. **Considered thinking or a recommendation**, asking the reader for something → **Memo**
2. **Status on one project**, for the people it affects → **Project Update**
3. **Summarises a stretch of time** for the whole team → **Team Update** (use `team-update`, which assembles it from the databases rather than from memory)
4. **Records what a meeting decided**, on a date → **Meeting Notes** (use `meeting-notes`, which starts from the transcript)
5. **The case that something is worth fixing**, before anyone proposes a fix → **Problem Statement**
6. **Something shipped** and reached the people who will use it → **Release**
7. **Something broke** that someone outside the team noticed → **Incident Report**

This skill writes all seven, including Project Update and Problem Statement:
those two also have project-context entry points in the `projects` plugin, and
this is the general path for somebody who is not standing in a project.

---

## Step 3. The correction branch

**If this memo corrects an earlier one**, find that memo, set `Corrects` to its
url, and open the body by saying what it corrects and what changed.

This branch is also what catches somebody asking for an edit. When the request
is "fix the memo from Tuesday", explain that memos are not edited, and offer
this instead. Explaining beats refusing: the person has a real need and there
is a correct way to meet it.

**A memo corrects exactly one memo.** The script refuses several. Correcting
several means several correcting memos, or a new memo that corrects nothing and
supersedes by being newer.

**The relation is not written by this version.** `create` checks the target and
says, in its output, that the link has to be made by hand in Notion. Report
that plainly and name both memos. `find` follows chains through that relation,
so an unmade link is an unfollowable correction.

---

## Step 4. Draft the body, in the template for its type

Every type has its own sections, in order. `create` returns them and the script
refuses a required one left empty.

| Type | Sections |
|---|---|
| Memo | Recommendation, What It Changes, Why This And Not The Alternative, What I Need From You, Sources* |
| Project Update | What Changed, Why, Who Is Affected And When, What You Need To Do, Sources* |
| Team Update | TLDR, What Shipped, What Is Still Open, Needs A Decision From You |
| Meeting Notes | Decisions, Actions, Open Questions, Discussion Notes* |
| Problem Statement | What This Blocks, What's Happening, Who Feels It, Evidence, Cost Of Doing Nothing, Sources* |
| Release | What This Lets You Do, What Shipped, How To Get It, Known Gaps, Links* |
| Incident Report | Impact, What Happened, Timeline, Why It Happened, What Changed |

*Conditional, always last: include it when there is content for it, omit it
when there is not.

**The outcome leads and every template ends on the reader.** The first section
is what happened or what is being asked, never the work that produced it, and
the last required section says what the reader must do, decide or accept.

**A section where the honest content is "nothing" says so in place, in that
type's phrase.** "Nothing this week" in Needs A Decision From You, "nothing was
settled" in Decisions, "none, and here is what to do meanwhile" in Known Gaps,
"nothing changed, and here is why" in What Changed. An empty week is
information; a deleted section loses it.

**Do not write a section you could not fill.** Say it is empty rather than
inventing content.

### The hard rules per type

- **Problem Statement.** What This Blocks carries four things: the goal at
  risk, where it stands, who owns it, and the dated decision it holds up.
  Evidence is citable line by line: channel and date for a quote, report or
  file for a number, the person's role. Where a number does not exist, write
  what was observed and how often, and name what is missing, because a gap in
  the evidence is often the finding. Never a solution smuggled into What's
  Happening.
- **Release.** Written for the person who has to care, not the person who
  built it. Known Gaps is what keeps the next release believed.
- **Incident Report.** Timeline carries at least three points: started,
  noticed, fixed. Why It Happened is the chain, not a label; keep asking why
  until the answer is something that can be changed.
- **Memo.** Name the alternative that was real. If there was none, say so,
  because that is itself worth knowing.

### Sources

**Record every source you actually opened, and never one you did not.** Each
gets a line saying what it contributed. The script refuses a source with no
line of context. A Sources section that cannot be trusted is worse than none.

---

## Step 5. Check, and show the preview in full

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/memos.js" check draft.json
```

**Problems are refusals.** Fix them and check again. **Concerns are questions
for the user**, and the one that matters is the ceiling: 600 words across the
required sections. **Ask rather than trim.** For a memo, running long usually
means the detail belongs in a Process artifact this memo should link to.

**Then preview the whole body inline**, in the conversation, not as a pointer
to a file. Properties first, then every section in full.

**The confirmation gate is hard. Create only on an explicit yes.** Treat
anything ambiguous as not yet confirmed.

---

## Step 6. Write it, then prove it landed

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/memos.js" create memo.json
```

Create the page, then read it back and prove it:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/memos.js" prove memo.json readback.json <the url the create returned>
```

**Keep the url the create call returned and pass it as the third argument.**
Without it the proof checks that some page has the right shape rather than that
the page just written does.

**A create call that returned without an error proves nothing.** If a heading
is missing, write it again and prove again — completing a failed publication is
the one write to an existing page this plugin ever makes, and it happens before
success is reported, never after. **Never report success with a section
missing.** Say what was not checked: `prove` compares headings and says the
text under them was not read back.

### Fields set without asking

| Field | Value |
|---|---|
| `Status` | `Published`. `Draft` is only reachable by a person setting it in Notion, and `Canceled` is a person's retraction |
| `Published date` | today, or the day the thing was said if the user names one |
| `Author` | the user, from the person id in config. Skipped where there is none, which is a working install |

---

## What this skill does not do

- **Does not edit an existing memo.** There is no path to it, from here or
  anywhere in this plugin. A correction is a new memo.
- **Does not write the `Corrects`, `Artifacts` or `Projects` relations.** The
  script checks a named correction and `create` says the link is made by hand.
  Report it as unlinked rather than letting the user assume it was set.
- **Does not set `Period covered` on anything except a Team Update.** The
  script refuses it: the field is what separates that type from a Project
  Update.
- **Does not relate a memo to a project without saying so** — and in this
  version cannot relate it at all. Say which project it belongs to so the link
  can be made by hand.
- **Does not write a draft.** A skill that writes a draft has written nothing
  useful.

# memos: what each skill does

Part 3 for `memos`. Four skills, each described in the same five slots as
`SKILLS-process.md` and `SKILLS-projects.md`, so a gap in one is visible as a gap
rather than as something that did not apply.

The five slots: what it does, when it runs, what it reads and writes, what it
does not do, and the judgment it carries.

The database is defined in `SCHEMA-memos.md`. This file does not restate a field
name or a value list.

Written 2026-08-17.

---

## The rule this plugin exists to enforce

**Memos is time-stamped communication and append-only.** A memo records what was
said on a date, and its body and content properties are never updated. Everything
below follows from that, and the clearest evidence is what is missing: **there is
no `update` skill and there never will be.**

**"Append-only" is narrower than it sounds and the narrow version is below**, under
"What append-only actually means". Two things do change after publication: a
retraction, which moves `Status` to `Canceled` and nothing else, and the far side
of a two-way relation, which Notion maintains.

Three consequences worth stating before the skills, because each one is a place
somebody will try to do the natural thing and be wrong.

**A correction is a new memo.** When somebody asks to fix a memo, the answer is a
new one with `Corrects` set, not an edit. `new` carries that branch and explains
it rather than refusing.

**There is no `backfill`, and this is the only foundation plugin without one.**
`process:backfill` reconstructs artifacts from material you already have, which
works because an artifact is reference and it does not matter when it was written.
A memo is a record that something was communicated on a date. Manufacturing one
afterwards creates a record of a communication that never happened, which is not
a gap in the plugin, it is the plugin refusing to forge a document.

**A memo cannot go stale**, which is why `Last checked for accuracy` is not in the
schema and why nothing here audits.

---

## Rules that apply to all four

- **Never invent a select value.** Before choosing any value, fetch that
  property's current options from Notion and choose only from them. **Tested
  against a live workspace on 2026-08-17: Notion rejects the whole write with a
  400 validation error**, naming the offending value and listing the valid ones,
  for both `select` and `multi_select`. **The failure is all or nothing.** A
  skill that drafts a full memo and only discovers a bad value at write time
  loses the entire draft, which is why the check happens before drafting.
  **The error is recoverable and worth catching**, because it names the bad value
  and lists the allowed ones, so drop or remap and retry rather than failing at
  the user.
- **Verify the write actually landed.** After writing, re-fetch, confirm each
  section heading is present, retry any that are missing, and say so loudly if a
  section still will not write. **Never report success with a section missing.**
- **The confirmation gate is hard.** Write only on an explicit yes. Treat anything
  ambiguous as not yet confirmed.
- **Preview in full, inline.** Show the complete body in the conversation before
  writing, not a pointer to a file.
- **Route to `setup` on first run** when config is absent. Never rely on the
  README.
- **Pin the Notion API version and the client floor.** Both are defined once, in
  `SKILLS-setup.md` step 0. Pin the same two values here rather than restating
  them.
- **Record every source you actually opened, and never one you did not.** A
  Sources section that cannot be trusted is worse than no Sources section.
- **Nothing in a published memo's content is edited, ever.** Not a typo, not a
  name, not a date. The body and every content property are frozen at publication.

### What append-only actually means, stated narrowly

**Corrected 2026-08-17.** This rule used to read "nothing is edited after
publishing", full stop, and that was never true. `Status` holds Draft, Published
and Canceled, so moving a memo to Canceled is an edit after publication, and
nothing supported it. **A rule stated more broadly than it can hold is worse than
a narrow one**, because the exception nobody wrote down is how people learn to
ignore the rule.

| Change | Allowed | By what |
|---|---|---|
| The body, or any content property | **Never** | Nothing. A correction is a new memo |
| `Status`, Draft to Published | Yes, once | A person, in Notion. No skill writes Draft |
| `Status`, Published to Canceled | **Yes, and this is the only permitted transition after publication** | A person, and it requires a correcting memo saying why |
| `Corrected by` | Yes, automatically | Notion, as the far side of a two-way relation |
| `Projects` | Yes, automatically | Notion. The far side of `Memos` on Projects |
| `Resulting Projects` | Yes, automatically | Notion. The far side of `Problem Statement` on Projects |
| Anything else, after publication | No | |

**The three automatic ones are not exceptions to the rule, they are the rule
working.** A published problem statement gaining a `Resulting Projects` link a year
later is the single most expected thing that can happen to it, and it is the trace
the projects design exists for. Nothing a person wrote changes. **A relation's far
side is not content**, which is why it sits outside the immutability rule rather
than beside it.

**Added 2026-08-17.** The table listed only `Corrected by`, having been written in
the same session that made `Problem Statement` two-way and added `Resulting
Projects` to this database. Two corrections landed the same day and neither knew
about the other.

**A retraction is not an edit and not a deletion.** The memo stays, marked
Canceled, with a correcting memo explaining it. That is the append-only rule
working rather than an exception to it: the record of what was said is intact, and
so is the record that it was withdrawn.

### What every skill sets without asking

| Field | Value |
|---|---|
| `Status` | `Published`. **`Draft` is only reachable by a person setting it in Notion**, because a skill that writes a draft has written nothing useful. Same rule as `Active` on Process |
| `Published date` | today |
| `Author` | the user, from their Notion person id in config. **Skipped when there is none**, see the nullable `personId` rule in `SKILLS-setup.md` |

### Any plugin may write to any database. No plugin may call another plugin's skill

This comes up first here, so it is settled here.

Claude Code has no dependency resolution between plugins, so a skill in one
plugin cannot invoke a skill in another. What it can do is write to any database
in the foundation, because one `setup` created all of them and config holds every
id.

**So `memos:meeting-notes` writes rows into Tasks directly**, rather than calling
`projects:new`. It is the same Notion database either way.

**The risk this creates, and it is real.** Three plugins now write Memos rows:
this one, plus `projects:comms` for Project Update and
`projects:problem-statement` for Problem Statement. Nothing stops them producing
different shapes for the same type. **The page templates must be generated from
`SCHEMA-memos.md` into every plugin that writes them**, not hand-copied, and a
test must fail when a copy has drifted. The same problem as the shared Notion
client, and it wants the same answer.

---

## new

**What it does.** Writes one memo, of any of the seven types, from free-form
notes.

**When it runs.** When something needs to be on the record with a date on it. The
practical trigger is realising that a conversation reached a conclusion nobody
outside it will hear about.

**What it reads and writes.** Reads the live select options before choosing any
value. Reads whatever context you point it at. Writes one page: properties, then
the body from that type's template. Writes the Sources section from what it
actually read. Verifies the body wrote.

**It writes all seven types**, including Project Update and Problem Statement.
Those two also have project-context entry points in the `projects` plugin, and
this is the general path for somebody who is not standing in a project.

**What it does not do.**
- **Does not edit an existing memo.** There is no path to it, from here or
  anywhere.
- Does not write a section it could not fill. It says the section is empty rather
  than inventing content.
- Does not set `Period covered` on anything except a Team Update, which is what
  separates that type from a Project Update.
- Does not relate a memo to a project without saying so.

**The judgment it carries.** Three things, all shipping inside the SKILL.md:

1. **Which of the seven types this is.** The tree, which the schema defines by
   what each type is for. When two match, ask rather than taking the first.
2. **The correction branch.** If this memo corrects an earlier one, set `Corrects`
   and open the body by saying what it corrects and what changed. **This branch is
   also what catches somebody asking for an edit.** When the request is "fix the
   memo from Tuesday", explain that memos are not edited, and offer this instead.
   Explaining beats refusing, because the person has a real need and there is a
   correct way to meet it.
3. **Whether this is a memo at all.** The most common mistake will be writing
   process documentation as a memo, because a memo is quicker. If the content is
   reference that somebody will return to and maintain, it is an artifact, and the
   skill says so and points at `process:new`. **This judgment goes the other way
   too**: a status update written as an SOP is just as wrong.

---

## meeting-notes

**What it does.** Turns a meeting into a record of what it decided.

**When it runs.** After any meeting whose decisions somebody outside the room
needs. Recurring meetings, workshops, working sessions, one-off calls.

**What it reads and writes.** Reads a transcript from whatever call recorder is
connected, which `setup` asked about, or notes you paste, or both. Writes one
Memos row of type Meeting Notes. Offers to write the actions into Tasks.

**What it does not do.**
- **Does not paste the transcript into the body.** Discussion Notes is conditional
  and it is for reasoning that will matter later, not for a record of everything
  said. Meeting notes fail by becoming transcripts, and a transcript is unfindable
  a month later.
- **Does not invent decisions.** If nothing was settled, it writes that, because a
  meeting that decided nothing is worth knowing about.
- **Does not accept an action without a person and a date.** An action missing
  either is a wish. It asks for what is missing, and if the answer is not
  available it records the item under Open Questions instead, where it belongs.
- Does not create tasks without asking, and never silently.
- Does not read a recording the user did not point it at.

**The judgment it carries.** Two hard ones.

1. **Separating a decision from a discussion.** People talk in circles and settle
   things by implication. "I guess we could just do the second one" is a decision
   and does not look like one. The skill proposes what it thinks was decided and
   the user confirms, because getting this wrong in either direction is expensive:
   a missed decision gets relitigated, and an invented one gets acted on.
2. **What belongs in Open Questions rather than Actions.** Anything raised and
   unresolved goes there, and the temptation is to convert it into an action with
   a guessed owner so the notes look complete. Guessed owners are the fastest way
   to make a team stop trusting the notes.

---

## team-update

**What it does.** Writes the recurring update covering a period, assembled from
what actually happened rather than from what somebody remembers.

**When it runs.** On whatever cadence the team already has. Nothing schedules it,
because v1 has no unattended runs.

**What it reads and writes.** Reads four databases across the period:

| Read | For |
|---|---|
| Projects | What moved, and what is stuck |
| Calendar | What went out, and what is coming |
| Memos | Releases and Project Updates inside the window |
| Tasks | Only when a project's own status is not enough to tell the story |

Writes one Memos row of type Team Update, with `Period covered` set, which is the
field that separates this type from a Project Update.

**This is the highest-leverage skill in the plugin**, because it reads four
databases and produces the document nobody has time to write. It is also the
clearest argument for one setup creating everything: a plugin that could only see
its own database could not write this at all.

**What it does not do.**
- **Does not send it anywhere.** There is no Slack field and no Slack integration
  in v1. It writes the row.
- **Does not invent progress.** If nothing moved, it says nothing moved, which is
  information.
- **Does not restate the detail.** What Shipped is one line per item, and the
  related view carries the depth. Typing it twice is how the writer stops doing
  this every week.
- Does not fill Needs A Decision From You by guessing.

**The judgment it carries.** Two things, and the second is the whole point.

1. **What is worth a line.** A period produces more movement than a reader wants.
   The filter is whether somebody outside the team doing the work would change
   anything on hearing it.
2. **Needs A Decision From You, which cannot be assembled.** Knowing what is
   actually stuck and on whom requires reading between the status fields, and it
   is the section that keeps the update being read at all. A recurring send that
   never asks for anything becomes wallpaper inside a month, and once it is
   wallpaper the habit dies. **The skill proposes and the user confirms**, and if
   the honest answer is nothing this week, it writes that rather than deleting the
   section, because an empty week is information too.

---

## find

**What it does.** Finds what was said about something, and when.

**When it runs.** Any time. Like `process:find`, this is the skill people use
most, so it has to be the least ceremonious.

**What it reads and writes.** Reads only.

**What it does not do.**
- Does not edit or create.
- Does not return a wall of results. It answers the question and names the memos
  it answered from, with their dates.

**The judgment it carries.** Two things.

1. **Which memo actually answers the question**, using Type, Domain and Published
   date rather than text matching alone.
2. **Whether a later memo corrects it.** If the best match has been corrected, the
   correction is what gets shown, with a note that an earlier version exists. A
   log that serves a superseded record silently is worse than one with no answer,
   because the reader has no way to know. This is the `Corrects` relation earning
   its place at read time rather than only at write time.

### How to follow a correction, since a relation permits nonsense

**Added 2026-08-17.** `Corrects` is a Notion relation, so nothing stops one memo
correcting six others, six memos correcting one, a correction of a correction, or
a cycle. `find` said "the correction" as though there were always exactly one.

The rules, and `new` enforces the first two at write time:

1. **One target.** A memo corrects exactly one memo. Correcting several means
   several memos, or a new memo that corrects nothing and supersedes by being
   newer.
2. **No cycles.** Refuse a correction that points anywhere in the chain leading
   back to itself.
3. **Follow to the end.** `find` walks the chain to the most recent correction and
   shows that, naming how many versions it passed.
4. **Branches are reported, never resolved.** If one memo has been corrected twice
   independently, that is a real disagreement between two people and the skill
   shows both rather than picking the newer. **Picking silently is how a log
   starts lying.**

**Rules 1 and 2 bind `new`, and a person clicking in Notion is bound by nothing.**
So `find` cannot assume its input obeys them, and reading is where the nonsense
actually shows up:

- **`find` keeps the set of memos it has already visited and stops when it meets
  one twice.** A cycle built by hand would otherwise loop forever. It reports the
  cycle and shows the memos in it, rather than choosing a place to break it.
- **`find` checks that each `Corrects` it follows holds exactly one memo.** More
  than one is reported as a violation, with all of them shown, and no path is
  chosen.

**Neither is repaired, and neither can be.** Which correction to drop and where to
break a cycle are both judgments about what somebody meant. **Reported and shown
is the whole remedy**, and it is the same line `check` holds on the two rules no
view can watch, in `SKILLS-setup.md`.

**Added 2026-08-17.** The write-time rules were specified and the read-time
behaviour assumed they had held, which is only true of memos this plugin wrote.

---

## Why there are four skills and not six

Recorded so the gaps read as decisions.

| Not built | Why |
|---|---|
| `update` | Memos is append-only. This is the plugin's entire identity |
| `backfill` | A memo is a record that something was communicated on a date. Manufacturing one afterwards forges a document. See the top of this file |
| `audit` | A memo cannot go stale, so there is nothing to flag. The Process needs `audit` because an artifact is maintained and can quietly stop being true |
| A separate skill per type | `new` carries the type tree, the same way `process:new` carries one for five types. Seven skills that differ only by template is seven places to fix one bug |

**`meeting-notes` and `team-update` are separate from `new` for the same reason
`process:update` is separate from `process:new`: the input is different.** `new`
starts from free-form notes. `meeting-notes` starts from a transcript.
`team-update` starts from a date range and four databases. Folding all three into
one skill would produce a skill whose first question is which of three completely
different things you are doing.

---

## Open

1. **Two `find` skills, and probably more coming.** This plugin has one, `process`
   has one, and `software` and `calendar` will both want something similar.
   **A single search across all six databases is the obvious tier-two plugin**,
   and it would supersede all of them. Not v1, and worth not designing four
   near-identical skills without noticing.
2. **Three plugins write Memos rows.** The template definitions have to be
   generated from `SCHEMA-memos.md` rather than hand-copied, with a test that
   fails on drift. Same shape as the shared Notion client problem in
   `SKILLS-setup.md`, and it wants one answer covering both.
3. **`team-update` reads Tasks, which no other memos skill touches.** If that turns
   out to be rare, the read can be dropped and the skill loses nothing.

---
name: new
description: Add one thing to the GTM calendar, after checking what else is already aimed at the same people at the same time. Use when the user says "add this to the calendar", "we're doing a webinar on the 10th", "put the launch on the calendar", "schedule a post", or describes something going out to people outside the team on a date. Reads the Calendar database around the proposed date, writes one row and its page body. Writes nothing without an explicit yes.
allowed-tools: Write, Bash(node:*), mcp__*__notion-fetch, mcp__*__notion-query-data-sources, mcp__*__notion-create-pages, mcp__*__notion-update-page
---

# new

Add one thing to the calendar, and show what it collides with before anybody has
committed to the date.

**The line this skill holds: nothing is written until the person has seen what
else is already aimed at these people that week.** A conflict found after the
work is planned is a conflict somebody argues with. A conflict found while they
are still choosing the date is a conflict they fix.

## How this skill works

**`scripts/calendar.js` decides what to send. You send it.** The Notion calls go
through the connected client, which a script cannot reach, so the script builds
every query and judges every answer, and you make the calls in between.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/calendar.js" context
node "${CLAUDE_PLUGIN_ROOT}/scripts/calendar.js" window <date> [<end date>]
node "${CLAUDE_PLUGIN_ROOT}/scripts/calendar.js" duplicates <proposed.json>
node "${CLAUDE_PLUGIN_ROOT}/scripts/calendar.js" judge <proposed.json> <window-rows.json> <duplicate-rows.json>
node "${CLAUDE_PLUGIN_ROOT}/scripts/calendar.js" check <proposed.json>
node "${CLAUDE_PLUGIN_ROOT}/scripts/calendar.js" create <proposed.json>
node "${CLAUDE_PLUGIN_ROOT}/scripts/calendar.js" prove <proposed.json> <readback.json> <url>
```

**Do not compose a query by hand and do not build a property payload by hand.**
Both resolve the workspace's own property and option names through the config
map. A hand-written query asking about the names this plugin shipped with comes
back with no rows on a renamed workspace, and no rows is exactly what a clean
calendar looks like.

**A date is not queryable under its own name either.** Notion exposes it as
`date:<name>:start`, measured against a live workspace on 2026-08-19 and recorded
in `DECISIONS.md`, and another reason
the query is generated rather than written.

**`judge` takes two sets of rows, from two different queries.** The clash window
is seven days either side and leaves canceled rows out. A duplicate is not
bounded by a date at all, so it gets its own query. Pass only the window and
`judge` says the duplicate check did not run, rather than reporting no
duplicates.

---

## Step 0. Does this belong on the calendar at all

**The boundary test, and it is the whole boundary:**

> Does it happen on a date, and does someone outside the team see it?

A bug fix happens on a date and nobody outside sees it, so it is a Task. A brand
guideline is seen by outsiders and does not happen on a date, so it is an
artifact. A dinner for fifteen customers passes both.

**The test asks whether the thing happens on a date, not whether the row knows
which one yet.** An idea with no date passes. A task with a due date does not.

**If it fails, say so and point at Projects.** Do not write the row. The pull
will always be toward putting internal work here because it has a date, and a
skill that quietly accepts a task is how this database becomes the thing the
reference became.

## Step 1. Read config

Run `context`. If it refuses, show the message and stop: every refusal names
what to do, and most of them mean running the `setup` plugin.

**It also tells you whether `Owner` will be set.** `writesPersonFields: false`
means config records no person, so `Owner` is omitted rather than written empty.
That is a working install, not a broken one. Do not ask the user for their
Notion id, and do not fail over it.

## Step 2. Work out the type

Users get this wrong more often than any other field, so walk the tree rather
than guessing:

1. Do people **attend** it? → Event
2. Does it go to **a list, by email**? → Email send
3. Is it a **post on a social channel**? → Social post
4. Does something **become available** that day? → Launch
5. Otherwise, is it **published to be read or watched**? → Content

**The case that catches people is a webinar.** It is an Event. The recording
published afterwards for people who did not attend is Content, on a different
date, which means **two rows**. One thing that happens twice is two rows, because
the calendar's job is to say what is happening when, and those are two whens.
Offer the second row; do not create it silently.

**A launch is not the project that built it.** The project is in Projects, the
announcement is a Release memo, and the Calendar row is the date.

## Step 3. Fetch the live options before choosing any value

**Never invent a select value.** Fetch the current options for `Type`, `Status`,
`Our role`, `Format`, `Channel`, `Domain`, `Audience`, `Segment` and
`L2C Lifecycle` before choosing anything, and choose only from what came back.

**This happens before drafting, not at write time.** Notion rejects the whole
write with a 400 when a value is not in the list, and the failure is all or
nothing, so a skill that drafts a full row and discovers a bad value at the end
loses the draft. The error is worth catching when it does happen: it names the
offending value and lists the valid ones, so remap and retry rather than failing
at the user.

**A workspace may have added its own options to `Format` and `Channel`**, which
are editable by design. An option that came back is a valid option whether or not
this plugin shipped it. Never create an option during a row write.

## Step 4. The clash check and the duplicate check, before drafting

**Two queries, then one judgment.** Run `window` with the proposed date and
`duplicates` with the proposed row, send both, and pass both sets of rows to
`judge` in that order.

**Send the rows back exactly as they came.** `judge` normalises them itself: the
columns carry the workspace's own names and the checks read logical ones, and
handing over rows you have relabelled by hand is how a renamed workspace ends up
reporting a clean calendar.

**`judge` answers two different questions.**

**Clashes** are two different things colliding. It compares `Segment` and
`L2C Lifecycle` plus a window of seven days either side, and it returns two
lists that mean different things:

- `overlapping`: something is shared. One shared segment is enough.
- `unknown`: one side said nothing about who it is aimed at. **That is unknown,
  not universal.** Show it separately and label it as "might overlap, nobody
  said".

**Duplicates** are the same thing entered twice: the same link, or a matching
name on the same date.

**Show all of it and let the person judge.** This is a coarse signal and you say
so. It does not know who is on a list, so two emails to entirely different
enterprise lists look identical to it. It never blocks and it never silently
allows. Describing it as a collision detector would be worse than the fields
being coarse, because somebody would trust it.

**An undated row reports that it did not check.** `checked: false` means there
was no date to measure from, which is different from finding nothing. Say which.

## Step 5. Draft the body, in full, inline

Four sections, two of them conditional:

- **What It Is.** The thing itself, in a sentence or two, written for somebody
  outside the team.
- **Why We Are Doing It.** What this is meant to achieve and for whom, **ending
  with how you would know it worked.** Not a number necessarily. "Five
  conversations with people who have never heard of us" is a fine answer.
- **What We Need To Do.** Conditional, mostly events. Who is going, what is
  booked, what is outstanding. **Anything with an owner and a date belongs in
  Tasks on the related project**, not in a list here that nobody looks at. A list
  growing past a handful of lines means those tasks belong on a project.
- **How It Went.** Not written now. `update` asks for it when the row is marked
  `Done`.

**`Why We Are Doing It` is never blank, on any type, including a routine social
post.** If it cannot be answered, **that is the finding**. Say so and do not
write the row. A calendar full of things nobody can justify is how a team ends up
busy and flat.

**Ceiling of 400 words across the required sections, no minimum.** Conditional
sections sit outside the count, which is what lets a conference carry a real
run-up list. Length here means content that belongs on the project or in an
artifact.

**Calendar rows have no Sources section**, unlike the rest of the marketplace.
Anything you genuinely read goes in the prose of `What It Is`. That is a recorded
exception, not an oversight. It does not license inventing a source you did not
open.

Run `check` on the draft. It returns everything wrong at once rather than the
first thing.

## Step 6. Preview in full, then ask

**Show the complete row and the complete body in the conversation**, not a
pointer to a file. Alongside it, show what the clash and duplicate checks found.

**The confirmation gate is hard.** Write only on an explicit yes, and treat
anything ambiguous as not yet confirmed.

**Ask about the project relation, do not assume it.** An event, a launch and a
campaign almost always have one. A Tuesday LinkedIn post does not, and forcing
one manufactures empty project rows.

## Step 7. Write, then prove it landed

Run `create`, send the page create, then write each heading and its content.

**Then re-fetch the page and run `prove`, passing the url the create returned.**
A create call that returned without an error has proved nothing: Notion accepts
some things it cannot do and discards them silently. `prove` compares every
property it sent, by the type it sent it as, and checks that every section
heading is on the page.

**The url is required and the re-fetched page has to carry its own.** `prove`
refuses a read-back it cannot identify, and refuses one belonging to a different
page. Without that, a read-back of any row whose properties happened to match
would pass as a landed create.

**The read-back is `{url, properties, headings}`, and you have to build it.**
`properties` is keyed the way a query returns them, with the date split into
`date:<name>:start` and `:end`. **NO REAL PAGE FETCH HAS BEEN MEASURED**, only a
real query, so there is no adapter here that turns a fetched page into this
shape and nothing above should be read as promising one. If what comes back does
not look like this, say so rather than reshaping it until it fits.

**It also reports what it did not check, and that half gets shown too.** It does
not read the body text back, so a heading with nothing under it passes. Say what
was proved and what was not, rather than rounding the answer up to "it worked".

**If a section did not write, write it again and say so loudly. Never report
success with a section missing.**

---

## What this skill does not do

- **Does not accept a task.** Boundary test, applied honestly.
- **Does not write the `Project` or `Artifacts` relations.** It asks about the
  project, and the answer informs the conversation rather than the row. Nothing
  in this plugin writes a relation yet.
- **Does not require a project.**
- **Does not set `Our role`, `Format` or `Location` on anything except an
  Event**, or `Channel` on an Event. `check` refuses these rather than dropping
  them, because a value silently discarded looks saved.
- **Does not write a run-up list into the body when the items have owners and
  dates.** Those are Tasks on the related project.
- **Does not create a database, a property or an option.** `setup` owns all of
  that.

## The judgment this skill carries

1. **Which type this is.** The tree above, and the webinar case.
2. **Whether the clash matters.** Two things aimed at one segment in a week is
   sometimes fine and sometimes the whole problem. Show it and let the user
   decide. Never block, never silently allow.
3. **Whether this belongs here at all.** The boundary test.

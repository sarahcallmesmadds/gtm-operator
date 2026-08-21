# Calendar: schema and template

**This file defines the Calendar database.** Field names, property types, allowed
values and option order live here and nowhere else. Anything in another document
that restates them is a copy, and copies drift.

`DECISIONS.md` holds the reasoning and the reversals. `SKILLS-setup.md` holds the
creation order and the relation map.

Companions: `SCHEMA-process.md`, `SCHEMA-memos.md`, `SCHEMA-projects.md` and
`SCHEMA-software.md`. Shared fields (Domain, Audience, Segment, L2C Lifecycle) use
identical value lists across all of them. A change to one is a change to all.

The database is called `Calendar`. The plugin that owns it is `calendar`.

Written 2026-08-17.

---

## What this database is for

**One question: what is happening in market, and when.**

A row is something that happens on a date and that somebody outside the team
experiences. A conference you are sponsoring. A webinar. A blog post going live. A
LinkedIn post. An email going to twelve thousand people. A launch.

That is the test, and it is the whole boundary:

> **Does it happen on a date, and does someone outside the team see it?**

A bug fix happens on a date and nobody outside sees it, so it is a Task. A brand
guideline is seen by outsiders and does not happen on a date, so it is an
artifact. A dinner for fifteen customers passes both, so it is a Calendar row.

### This settles the social question

`DECISIONS.md` carried an open question: does the social calendar live here, given
it is the only row type that is not an event.

**It lives here, and the question was the wrong shape.** It reads as odd only if
you think of this as an events database. It is not. Events are the heaviest thing
in it, not the defining thing. A LinkedIn post and a conference have almost
nothing in common operationally and they answer the same question for the same
reader: what are we putting in front of people, and when.

**The alternative is worse.** A separate social database means two calendars,
neither of which can answer "what is in market that week", which is the one
question a calendar exists to answer. Splitting by how much work a row takes is
not a data model.

---

## What the reference taught, which is what not to do

The reference is the marketing calendar in the reference set. **It is not a model
and it is not treated as one.** Sarah's call, 2026-08-17: it was built by people without an ops
background and it shows. It is used here the way a worked wrong answer is useful,
and the general shape of what they were reaching for is right even where the
execution is not.

Its name admits the central problem: Events **and Tasks**. Three lessons, all of
them negative, and nothing else came across.

**1. It is three databases in one.** Its `Type` field holds thirty-seven values,
and they fall into four groups. Events. Things published. Things sent. And then
`Bug Fix`,
`Contract`, `Deliverable`, `Design`, `Meeting`, `Travel`, `Rev Ops`, `Sales
Asset`, `Merch`, which are work items rather than calendar entries. The fourth
group belongs in Projects and Tasks, and the boundary test above is what keeps it
out.

**2. Per-person and per-campaign values are governance failures.** `Social -
Brand` and `Social - Rishabh` are one type with an owner. `BFCM` in the topic
field is one quarter's campaign. The same finding the `Initiative` field produced
on Projects, where a hundred uncontrolled values were read as evidence that a
field was needed and were actually evidence that nobody ever pruned a list.

**3. Thirteen statuses is nobody's workflow.** `Idea`, `Not Started`, `In
Development`, `In Progress`, `Ready for Review`, `Approved`, `Ready to Post`,
`Scheduled`, `Published`, `Complete`, `Blocked`, `Paused`, `Cancelled`. Three of
those are approval stages for a review process that v1 does not have, two describe
why something is not moving rather than where it has got to, and three are all the
same end state.

---

## Part 1: Calendar schema

### Fields

Eighteen fields. This is one of the most numerous row types in the system, so it
gets the Tasks discipline: every field earns itself twice, because a heavy
template on a numerous row guarantees blank rows.

| Field | Type | Values / notes |
|---|---|---|
| Name | Title | |
| Description | Text | one sentence |
| Type | Select | 5 values, see below |
| Status | Select | 5 values, see below |
| Date | Date (range) | when it happens or goes out. Time optional, range for anything lasting more than a day. **Optional at `Idea`, `Planned` and `Canceled`, required by the skills at `Confirmed` and `Done`, and surfaced when it is not**, see below |
| Our role | Select | 4 values. **Events only**, see below |
| Format | Select | 6 values. **Events only** |
| Location | Text | city, venue, or Online. **Events only** |
| Channel | Multi-select | where it goes out. **Not for events** |
| Domain | Select | the same 8 values as `SCHEMA-process.md` |
| Audience | Multi-select | the same list. **Which internal teams need to know** |
| Segment | Multi-select | the same list. Who it is aimed at |
| L2C Lifecycle | Multi-select | the same 0 to 8. Where in the customer journey this lands |
| Owner | Person | one accountable person |
| Link | URL | the registration page, the published post, the event site |
| Project | Relation to Projects | optional, see below |
| Artifacts | Relation to Process | inverse of `Calendar` there. The playbook, the run of show |
| Created time | Created time | |

**Three fields apply to one type only**, and that is deliberate rather than
sloppy. `Our role`, `Format` and `Location` are meaningless on a blog post, and
`Channel` is meaningless on a conference. The precedent is `Period covered` on
Memos, which only Team Update uses. The alternative is two databases, which fails
the one question this one exists to answer.

### Type

Event, Content, Social post, Email send, Launch. Set the option order in that
sequence, heaviest first.

| Value | What it is |
|---|---|
| Event | Something people attend, in a place or online |
| Content | Something published to be read or watched. A blog post, a guide, a case study, a video, a podcast episode |
| Social post | A post on a social channel |
| Email send | A campaign to a list |
| Launch | Something becomes available on a date |

**Five, against the reference's thirty-seven.** Each one has a genuinely different
shape, which is the test used to cut the list, and it is the same test that
produced seven Memos types and five artifact types.

#### Which type is this

Users will get this wrong more often than any other field, so the tree ships
inside the skill.

1. Do people **attend** it? → Event
2. Does it go to **a list, by email**? → Email send
3. Is it a **post on a social channel**? → Social post
4. Does something **become available** that day? → Launch
5. Otherwise, is it **published to be read or watched**? → Content

**The worked example that catches most people.** A webinar is an Event, even
though it is online and produces a recording. The recording, published afterwards
for people who did not attend, is Content, and it is **a second row on a different
date**. One thing that happens twice is two rows, because the calendar's job is to
say what is happening when, and those are two whens.

**A launch is not the project that built it.** The project is in Projects, the
announcement is a Release memo, and the Calendar row is the date. Three records
because three different people need three different things, and each is
maintained by whoever owns it.

### Status

Idea, Planned, Confirmed, Done, Canceled. In that option order.

| Value | What it means |
|---|---|
| Idea | Somebody suggested it. Nothing is committed |
| Planned | We intend to do it. The date may still move |
| Confirmed | The date is locked. Booked, paid, or scheduled |
| Done | It happened, or it went out |
| Canceled | It is not happening |

**`Confirmed` is the value that makes the calendar trustworthy.** It is the line
between a date you can plan around and a date somebody hopes for, and without it
every view mixes the two. On an event it means booked or paid. On a post it means
scheduled in whatever tool sends it.

**`Done` covers both happened and published.** A blog post lives on after its
calendar row is finished, and that is fine. The row records the date it went out,
not the lifespan of the thing.

**No `Blocked` or `Paused`**, which describe why something is not moving rather
than where it has got to. That is a note or a view filter. Same cut Projects made.

#### When a date becomes required

**Added 2026-08-17**, after review found the design both demanding a date and
planning for rows without one.

**A row may have no date at `Idea` or `Planned`.** "We should do a customer dinner
in Q4" is a real row and pinning it to a made-up Tuesday makes the calendar lie.

**A date is required at `Confirmed` and `Done`**, and at `Confirmed` that is what
the status means. Nothing is booked, paid or scheduled without a date, and
nothing has happened without a day it happened on.

**`Canceled` is deliberately outside the rule. Corrected 2026-08-19.** This said
"from `Confirmed` onwards" until review found it disagreeing with
`plugins/setup/scripts/manifest.js`, which had already excluded `Canceled` from
the `Needs attention` filter with the reasoning written out. Both files were
approved and they described different rules, so a skill built from either one
would have been correct and wrong at the same time.

**The manifest's reading is the one that survived**, on Sarah's call: the rule
exists to catch a row that promises something will happen and does not say when.
A canceled row promises nothing, so demanding a date on one reports a row that is
not broken. A cancelation that did have a date keeps it, because nothing clears
the field. This only says the skills stop requiring one.

**Undated rows are invisible on a calendar, so setup builds a fourth view for
them.** An `Undated` view, filtered to `Idea` and `Planned` with no date, so the
pile of things somebody meant to schedule is visible rather than lost. Without it,
"happens on a date" would be a rule the database quietly breaks.

This does not weaken the boundary test. **The test is whether the thing happens on
a date, not whether the row knows which one yet.**

**No approval statuses.** `Ready for Review` and `Approved` describe a review
chain, and v1 has no approval workflow anywhere in the marketplace.

### Our role

Hosting, Sponsoring, Speaking, Attending. Events only.

**This is the field that replaces four of the reference's types.** It carried
`Event: IRL`, `Event: IRL Hosted`, `Event: Sponsored` and `Event: Internal` as
separate types, which is one type and one field wearing four hats. Splitting them
means the type list grows every time a new relationship with an event appears,
and it means you cannot ask "everything at this conference" across roles.

**Hosting and Attending are the two that change the work completely.** Hosting
means invitations, a run of show and staffing. Attending means travel and meetings
booked around it. Sponsoring and Speaking sit between and often combine, so this
is a select rather than a multi-select only because the primary relationship is
what a reader needs at a glance. Note the secondary in the body.

### Format

Conference, Webinar, Dinner, Roundtable, Workshop, Meetup. Events only, and
editable.

The reference had Conference, Dinner, Roundtable, Sponsored Session and VIP
Experience. **`Sponsored Session` is a role, not a format**, and it now lives on
`Our role`. `VIP Experience` is one company's word for a dinner.

### Channel

LinkedIn, X, Instagram, TikTok, YouTube, Blog, Newsletter, Podcast, Email.
Multi-select, and editable.

**Not for events**, which have a Format and a Location instead.

**One list across Content, Social post and Email send**, rather than a separate
social-channel field. A YouTube video and a LinkedIn post are the same kind of
fact about where something goes out, and one thing frequently goes to more than
one place.

### Audience, Segment and L2C Lifecycle

Three fields that sound similar and are not, so the distinction is written down
here rather than left to be inferred.

| Field | Who it describes |
|---|---|
| Audience | **Internal.** Which teams need to know this is happening. Sales needs to know their prospects were invited to a webinar |
| Segment | **External.** Who it is aimed at, by size or vertical |
| L2C Lifecycle | **External.** Where in the customer journey it lands |

`Audience` keeps the meaning it has in Process and Memos, which is
which internal teams need to know. Redefining a shared field for one database is
how a cross-database view stops working.

### Project

**Optional, and `DECISIONS.md` said otherwise.** That file records that each
Calendar row relates to a project. That was written when this database was
conceived as events and launches, and it does not survive contact with routine
social posting or a weekly newsletter, neither of which is a project and both of
which belong on the calendar.

**So the relation is optional and the skill asks.** An event, a launch and a
campaign almost always have a project. A Tuesday LinkedIn post does not, and
forcing one manufactures empty project rows, which is worse than an empty
relation.

### What is not here, and why

| Not shipped | Reason |
|---|---|
| Registrations, attendance, leads, any result number | A calendar records what is happening, not how it did. Results need a reporting design, a definition per metric and somewhere for the number to come from, and none of that exists in v1. **How It Went** in the body carries the useful part in prose |
| A cost or budget field | Same reason, plus it invites the calendar to become a spend tracker, which is a different job with a different owner |
| Separate creative, design and file link fields | The reference had three. One `Link` plus the body |
| A relation to Memos | A launch produces a Release memo, but the path already exists through the project, and a relation that is empty on almost every row is a column everybody scrolls past. Two hops beats a dead column |
| An approval or review chain | v1 has no approval workflow anywhere |
| `Add to Calendar` as a checkbox | A field that means "is this row real", which is what `Status` is for |

---

## The views this database needs at setup

**This is the one database whose default table view is useless.** A calendar that
opens as a table has failed at the thing it is named after.

Five views, and all five can be built when the database is created, because none
of them filters against a page. **This table is the manifest and the only place
their number is stated**, because a count written next to the thing it counts is a
copy, and three copies of this one went stale between 2026-08-17 and the review
that afternoon:

| View | What it is |
|---|---|
| **Calendar** | Notion's calendar layout on `Date`, coloured by `Type`. The default view |
| **In market** | Table, filtered to `Confirmed` and `Done` in the current month, grouped by `Type` |
| **Upcoming** | Table, filtered to `Confirmed` with a `Date` in the future, sorted soonest first |
| **Undated** | Table, filtered to `Idea` and `Planned` with no date. The pile a calendar view cannot show |
| **Needs attention** | Table, filtered to `Confirmed` and `Done` with no date. The rule below, made visible |

**`Needs attention` exists because Notion cannot require a date.** `Date` is
optional at `Idea`, `Planned` and `Canceled`, and required at `Confirmed` and
`Done`, and Notion enforces none of that. A confirmed row with no date is invisible on the calendar
view and absent from `Undated`, which filters to the two early statuses, so it
would sit in exactly the blind spot the `Undated` view was added to remove.
**Added 2026-08-17**, when review found this rule written the same day as the fix
for the blind spot and falling into it. Its two siblings live in the rules table in
`SKILLS-setup.md`, which lists every rule Notion cannot enforce and where each is
caught.

**This is a new job for `setup` and it is worth naming.** The 2026-08-17 review
found that the related views inside page bodies cannot be prebuilt, because they
filter against the page they sit on. **These are the opposite case.** They are
database-level, they reference no page, and they are exactly the kind of view that
should exist before anybody adds a row. Recorded in `SKILLS-setup.md`.

---

## Part 2: page body template

**One template for all five types**, with two conditional sections. Five templates
would be five ways to say the same four things, and this row type is numerous
enough that a heavy template guarantees blanks.

### Calendar

**What it is.** The working page for one thing that is going out. Light by design,
because the depth belongs in the related project or in a Process artifact.

**Body sections, in order:** What It Is, Why We Are Doing It, What We Need To Do
(conditional), How It Went (conditional).

**Why it is built this way.** Why We Are Doing It is required on every row
including a Tuesday social post, because a calendar full of things nobody can
justify is how a team ends up busy and flat. How It Went is conditional and
written afterwards, and it is the only place in the whole design where a result
gets recorded, deliberately in prose rather than as a metric.

**What goes in each part.**

- What It Is: the thing itself, in a sentence or two, written for somebody outside
  the team.
- Why We Are Doing It: what this is meant to achieve and for whom, **ending with
  how you would know it worked.** Not a number necessarily. "Five conversations
  with people who have never heard of us" is a fine answer.
- What We Need To Do: conditional, and mostly events. Who is going, what is
  booked, what is outstanding. **Anything with an owner and a date belongs in
  Tasks on the related project**, not in a list here that nobody looks at.
- How It Went: conditional, written after. What happened, and what you would
  change. **Two sentences is a good length.**

**No Sources section, and that is a decision rather than an omission. Recorded
2026-08-19.** The shared skill rules say sources get recorded, and this template
has nowhere to put them. Sarah's call is that Calendar is the exception: a row
here is a short entry about your own plans, not research, and a Sources heading on
a Tuesday social post is a field nobody fills. Anything genuinely read goes in the
prose of `What It Is`. `SKILLS-calendar.md` carries the same exception.

**Hard rules.**
- **Why We Are Doing It is never blank**, on any type. If it cannot be answered,
  that is the finding.
- **Why We Are Doing It ends with how you would know it worked.** Not blank is the
  floor, not the rule. A section that says what this is meant to achieve and stops
  has not answered the second half.
- **How It Went is written or the section says why not.** An event with no note is
  an event whose lessons are gone in a fortnight.
- A `What We Need To Do` list growing past a handful of lines means the tasks
  belong on a project.

**Ceiling of 400 words across the required sections. No minimum.** Conditional
sections sit outside the count, which is what lets a conference carry a real
run-up list without breaking the rule.

**400, the same as Software and for a related reason.** The row is a calendar
entry, not the plan. Length here means content that belongs on the project or in
an artifact.

**Related view:** the `Artifacts` relation. The playbook or run of show for this
kind of thing, which is what somebody preparing wants next.

**The more valuable view is database-level, not per-page.** What else is in market
that week is the question this database exists for, and it filters on a date window
rather than on the current page, so it is one of the database-level views above
rather than something embedded in every row.

---

## Open

1. **`Our role` as a select rather than a multi-select.** Sponsoring and speaking
   at the same conference is common. The primary relationship is what a reader
   needs at a glance, so the secondary goes in the body. Revisit if that turns out
   to be annoying rather than clarifying.
2. **`DECISIONS.md` needs correcting**, since it records that every Calendar row
   relates to a project. It is optional. Corrected there as well.
3. **No skills are designed.** At minimum `calendar:new`, and probably a
   `calendar:week` that answers what is in market and when, which is the question
   the whole database exists for.

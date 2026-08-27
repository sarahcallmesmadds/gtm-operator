# Software: schema and template

**This file defines the Software database.** Field names, property types, allowed
values and option order live here and nowhere else. Anything in another document
that restates them is a copy, and copies drift.

`DECISIONS.md` holds the reasoning and the reversals. `plugins/setup/SKILLS.md` holds the
creation order and the relation map.

Companions: `plugins/process/SCHEMA.md`, `plugins/memos/SCHEMA.md` and `plugins/projects/SCHEMA.md`.
Shared fields (Domain, Audience) use identical value lists across all of them. A
change to one is a change to all.

The database is called `Software`. The plugin that owns it is `software`, the same
way `memos` owns Memos. "Directory" is what it is, not what it is called.

Written 2026-08-17. Reviewed and amended the same day, see "What review changed"
at the end.

---

## What this database is for

It answers five questions, and every field earns itself against one of them:

1. **What do we use, and who uses it.** Somebody new, or somebody deciding
   whether they should have access to a thing they just heard mentioned.
2. **Who do I ask.** The 6pm question. The same reason `Contacts` is a required
   section on a Technical Reference.
3. **What would break if this went away.** Which is both an outage question and a
   renewal question, and the reason importance is defined by consequence rather
   than by feeling.
4. **What are we committed to, and when does that come round again.** The
   contract. What we pay, until when, and the date by which we have to say
   something if we want out.
5. **Can we let this near our data.** Where it sits on security and what it holds,
   which is a question people are now asked before they are allowed to buy
   anything.

**It is an index, not a manual.** Depth about how a tool is wired lives in the
Process as a Technical Reference, related through `Artifacts`. A Software
row that is growing long is a Technical Reference waiting to be written.

---

## Part 1: Software schema

### Fields

Twenty-eight fields in five groups. The grouping is how someone reads the row and
how the table view should be arranged, not a property of Notion.

| Field | Type | Values / notes |
|---|---|---|
| **What it is** | | |
| Name | Title | The vendor's own spelling. Internal nicknames go in the body |
| Description | Text | one sentence, ending with the team that depends on it |
| Status | Select | 5 values, see below |
| Importance | Select | 3 values, see below |
| Domain | Select | the same 8 values as `plugins/process/SCHEMA.md`. The function that owns it |
| Audience | Multi-select | the same list. Which teams actually use it |
| **Who** | | |
| Owner | Person | accountable for the tool. Whose call it is |
| Technical owner | Person | configures it and can answer how it works |
| Admins | Person (multi) | who holds an admin seat. What access removal needs |
| Billing owner | Person | who approves the spend |
| **The contract** | | |
| Contract dates | Date (range) | start and end |
| Notice deadline | Date | the date by which you have to cancel to get out |
| Renews | Select | 4 values, see below |
| Annual cost | Number | currency format. What a year costs, see below |
| Contract link | URL | where the agreement itself lives. Carries a property description, see below |
| **Risk and surface** | | |
| AI access | Multi-select | 6 values, see below |
| Stores PII | Select | 4 values, see below |
| SOC 2 | Select | 3 values, see below |
| SSO | Select | 5 values, see below |
| Customer facing | Checkbox | customers see or touch it |
| Given to new teammates | Checkbox | part of the default kit for at least one team |
| **Pointers and freshness** | | |
| Login | URL | |
| Documentation | URL | the vendor's technical docs |
| Status page | URL | where the vendor announces outages and changes |
| Last reviewed | Date | the freshness stamp for the whole row |
| Integrates with | Relation (self) | tool-to-tool connections actually wired. One-way, see below |
| Artifacts | Relation to Process | inverse of `Software` there. The docs about this tool |
| Created time | Created time | |

### The four person fields, and which one to drop first

Four is more than any other database here carries, and it is one more than the
reference had. **The reference's own spec recorded its three person fields as the
worst-filled group it owned**, so this is a known risk taken deliberately rather
than an oversight.

They survive because each answers a different question at a different moment:

| Field | The question it answers | When it is needed |
|---|---|---|
| Owner | Whose call is it | Renewal, and any argument about whether to keep it |
| Technical owner | How does this work | Something is broken or being changed |
| Admins | Who can revoke access | Somebody leaves |
| Billing owner | Who approves the money | Renewal, and any change in price |

**Owner and Technical owner are separated on purpose**, and the separation was
asked for. They are frequently different people, and collapsing them means the
person who decides whether to renew a tool is assumed to be the person who can
explain what it does. On anything bought by a function and configured by another,
that assumption is wrong.

**If one of these proves unfillable in practice, drop `Admins` first.** It is the
only one whose job (offboarding) is also answerable, more slowly, by asking the
technical owner.

### Status

Evaluating, Active, Sunsetting, Retired, Rejected. Set the option order in that
sequence.

| Value | What it means |
|---|---|
| Evaluating | Being looked at. Nobody depends on it yet |
| Active | In use |
| Sunsetting | Being wound down, still switched on. The state where people need warning |
| Retired | No longer used |
| Rejected | Evaluated and not adopted |

**`Rejected`, not "Evaluated - Passed".** The reference used the second and then
listed it in its own open questions, because "passed" reads equally as passed the
evaluation and passed on it. A status value that can be read two opposite ways is
worse than no status value.

**No `Onboarding` status.** The reference had one, for the stretch between a
signed contract and the tool being in use. It lasts days, nothing filters on it
usefully, and it is a note rather than a place the row has got to. Same reasoning
that kept a scoping-in-progress status off Projects.

**`Sunsetting` earns its place where `Onboarding` does not**, because it is the
one state somebody outside the owning team needs to see. A tool being wound down
is a tool you should stop building against.

### Importance

Business critical, Important, Standard. In that option order.

| Value | The test |
|---|---|
| Business critical | An outage blocks revenue work the same day |
| Important | An outage degrades work that week |
| Standard | Everything else |

**Defined by consequence, not by feeling.** Taken from the reference almost
unchanged, because it is the strongest thing in the whole spec. Every tool feels
important to whoever bought it, and a scale that asks how important something is
returns the answer "very" on every row. A scale that asks what breaks and how fast
returns something you can sort by.

**`Standard` exists so the honest answer has a home.** Most tools are neither
critical nor urgent, and without a third option people either inflate everything
or leave the field empty.

**It is also the renewal filter.** Business critical plus a notice deadline inside
ninety days is the shortlist somebody has to actually deal with.

### The contract group

Five fields, and they exist because "what are we committed to" is one of the five
questions this database is for.

**`Notice deadline` is the field this group is really for.** It is the date by
which you have to cancel, and missing it on an auto-renewing contract commits you
to another term. In the reference it was the most operationally valuable date in
the database and it was filled on one row out of ninety-one, because nothing owned
filling it.

**How the skill should ask for it.** Not "what is the notice deadline", which
nobody knows off the top of their head. Ask how much notice the contract requires,
then compute the date from the contract end. A person can answer thirty days. They
cannot answer 14 November without opening the agreement.

#### Renews

Automatically, Manually, No renewal, Unknown. In that option order.

**`Automatically` is the value that makes `Notice deadline` urgent**, and the pair
is why both fields exist rather than one. A contract that renews manually and one
that renews itself carry completely different consequences for the same missed
date.

**`Unknown` is a real value.** Blank means nobody looked.

#### One cost field, annualised

**`Annual cost` and nothing else.** A monthly price is multiplied by twelve on the
way in, and an estimate is fine and expected.

**Why one field rather than a price plus a billing period.** The whole reason to
store a number is to sort by it and add it up, and a column holding a mix of
monthly and annual figures can do neither. Two fields would keep the raw figure
and push the arithmetic onto every reader and every view.

**Where the detail goes.** If the billing shape matters, and sometimes it does,
it goes in Notes in the body along with anything else that was negotiated.

#### `Plan` was cut

The reference had a Plan or Edition field holding the tier and the one limit that
matters, such as an API call cap. **Cut on review**, because it is free text that
no view can filter and the useful part is a sentence rather than a value. The tier
and its limits go in Notes.

#### On storing a cost rather than pointing at one

The reference's rule was that the record never owns data another system owns, so
spend was a link to the finance system and never a number in Notion. That rule is
right where a finance system exists. Here it usually does not, and a link to
nothing is not more honest than a number, it is just emptier.

### `Contract link` carries a property description, and it is the only one that does

Notion shows a property's description when somebody clicks the property, which
makes it the one place in this design where a rule reaches a person at the moment
they are filling the field in. Every other rule lives in a document.

The text is:

> Put the contract PDF in Google Drive and paste the link here. Claude can read
> the contract through this link. A file uploaded straight into Notion cannot be
> read.

**It says what to do and why, because the why is not guessable.** Measured
2026-08-18: a PDF stored in Google Drive can be read in full, and a PDF uploaded
into Notion cannot. The download refuses binary files, and reading the page back
gives a reference nothing can fetch. A person putting the contract in the
"obvious" place would produce a row that looks like it carries the agreement and
can answer nothing about it.

**This is why the property stays a URL** rather than becoming Files & media. The
only thing that type adds is the ability to hold an upload, and an upload is the
one form nothing can read.

**Proved on a live workspace**, not just generated: the statement was sent, and
the description came back on the property word for word.

**So `Annual cost` is a number and `Contract link` is where the agreement lives.**
The number answers what we spend, which is the question people ask. The link is
where you go when the number has to be exact. `Last reviewed` says when either was
last confirmed, which is what stops a stale figure being quoted as current.

#### Who reads this group

`software:contracts`, a skill somebody runs, which lists what is coming up inside a
window and what the consequence is of doing nothing. **Nothing schedules it**,
because v1 has no unattended runs anywhere in the marketplace.

**This is the same shape as `audit` in the process plugin**, which reads `Review
cadence` to decide what to flag and is fired by a person rather than by a clock.
That precedent is why the contract group is shippable in v1 and why it does not
need an integration to be worth having.

### AI access

MCP (connected), MCP (available), API, CLI, None, Unknown. Multi-select.

**Multi-select rather than free text.** The reference carried this as a text field
called MCP/API/AI Access, which cannot answer "show me every tool with a connected
MCP", and that question is the reason the field exists.

**`Unknown` is a real value and not a blank.** Blank means nobody looked. Unknown
means somebody looked and could not tell, which is a different row on a list of
work to do.

### The security group

Three fields: `Stores PII`, `SOC 2` and `SSO`.

**Restored on review.** They were cut in the first draft on the grounds that
compliance answers rot silently and v1 has nothing that sweeps them. That was the
same argument used to cut the contract group, and once contracts went back in on
the reasoning that a stale answer beside a `Last reviewed` date beats no answer,
leaving these out was the same decision answered two ways in one schema.

**`Last reviewed` is what makes the whole group honest.** It is a row-level date,
so it covers these fields as well as the contract ones, and a reader can see when
somebody last looked. That is the difference between a stale answer and a
misleading one.

#### Stores PII

Customer PII, Employee PII, None, Unknown. Select rather than multi-select,
because a tool holding both is rare enough to note in the body.

**A checkbox cannot do this job.** Customer data and employee data carry different
risk and different owners, and a single yes/no collapses them.

**Its strongest use is next to `AI access`.** Which tools have an AI surface and
hold customer data is a question people are being asked right now, and those two
fields together answer it in one view.

#### SOC 2

Yes, No, Unknown. From the vendor's trust page or security documentation.

#### SSO

Enforced, Enabled, Available, Not supported, Unknown. In that option order.

**One field, not two.** The reference carried SSO Enabled and SSO Enforced
separately, on the correct reasoning that "the tool supports it" and "we actually
turned it on" are different facts. They are, and they are also points on one
scale, so values carry the distinction at the cost of one column instead of two.

| Value | What it means |
|---|---|
| Enforced | Single sign-on is on and password login is off |
| Enabled | Single sign-on is on, and somebody could still log in another way |
| Available | The tool supports it and we have not turned it on |
| Not supported | The tool cannot do it |
| Unknown | Nobody has looked |

**`Available` is the value that earns the field.** A list of tools that support
single sign-on and do not have it switched on is a piece of work somebody can pick
up on a Friday afternoon.

### Integrates with

Tool-to-tool connections that have actually been wired, not ones the vendor
advertises. This is the blast-radius map: when a tool goes down, it is what tells
you which other tools degrade. It is also what makes "we are sunsetting this, what
breaks" answerable.

**One-way, deliberately.** A Notion two-way relation needs a different name on
each side, and the relationship here is symmetric, so there is no honest pair of
names. "Integrated with by" is not a phrase anyone should have to read on a page.

**What one-way costs, and how to pay it.** The full picture needs both directions,
so reading the blast radius means combining the row's own `Integrates with` with a
query for rows whose `Integrates with` contains this one. That is one extra query
in a skill, paid once, rather than an awkward column on every row forever.

### Last reviewed

The freshness stamp for the whole row, and the parallel to `Last checked for
accuracy` in Process.

**Its fill events, named now so the skills have to honour them:** set by
`software:new` when a row is created, and by `software:review` when a row gets a
full pass. Nothing else moves it, and in particular `software:contracts` does not,
because reading a list is not reviewing a row. That is the same correction
`update` needed on 2026-08-17, where fixing a typo was resetting the review clock.

**`software:backfill` leaves it empty**, for the same reason `process:backfill`
does. A machine pulled the row in and nobody has confirmed any of it.

### No Tags on this database

Every other database shares one Tags list, under the rule that a tag is what the
row is *about*. That rule does not survive the trip to a tool directory. A tool is
not about anything; it is used for something, and `Description`, `Domain` and
`Audience` already say that.

The reference had reached the same place from the other end, cutting its tag list
to exactly three, of which two were opposites of each other and one was a fact
about onboarding. Those became `Customer facing` and `Given to new teammates`,
which are checkboxes because they are yes-or-no facts and checkboxes filter
cleanly.

**Do not add a Tags field here** to match the other three databases. Matching for
its own sake is how a field with no meaning gets shipped.

---

## How rows get created

Three ways in, and the third is the one that makes this database possible to
start rather than merely possible to maintain.

| Way | Skill | What it produces |
|---|---|---|
| Somebody adds a tool they know about | `software:new` | A full row, filled in conversation |
| A full pass over an existing row | `software:review` | The same row, re-confirmed, `Last reviewed` stamped |
| Finding tools you already pay for | `software:backfill` | Candidates, approved one at a time |

### software:backfill

**The problem it solves.** Nobody knows what their company subscribes to. The
directory is worth having and nobody will sit down and type a hundred rows, so a
directory that can only be filled by hand does not get filled.

**The sources are not equally good.**

| Source | What it proves | What it can fill |
|---|---|---|
| **A folder of contracts.** A Drive folder, or wherever agreements are kept | That a contract exists, on these terms | Name and the whole contract group. A signature may identify the billing owner, but the field is never filled by backfill: name the person in the report instead |
| **DocuSign.** Signed agreements in the named account and date range | That a signed agreement exists, on these terms | Name and the whole contract group |
| **Ramp and QuickBooks.** Card transactions, vendor payments and bills | That the company is paying or has booked an obligation to the vendor | Name, and little else unless an agreement separately proves the terms |
| **Email.** Vendor invoices, receipts, renewal notices, product announcements, support threads | That the tool is in use and somebody is paying for it or working with them | Name, and little else honestly |
| **Slack.** Bounded channels or named direct-message conversations | That a named team depends on the tool for a named workflow | Name and, only with exact what-breaks/how-fast evidence, a proposed Importance value |

**An agreement produces a strong contract candidate; spend, accounting, email
and Slack produce narrower evidence**, and the skill has to say which it is
looking at. A row created from a receipt knows the tool exists and nothing about
who owns it or how important it is. Presenting that as a filled row would be
worse than not finding it, because a thin row looks finished.

**The shape is candidates then approval**, identical to `process:backfill`. It
gathers, shows a list saying what it found and where, and the user goes through
saying yes or no. Only the yeses become rows, and each one is previewed before
anything is written. A weak detector then produces noise rather than damage.

**What it is allowed to read**, with the defaults leaning closed:

- **Email is read-only.** It never sends, replies, labels, archives or moves
  anything. It reads to find vendors and does nothing else.
- **The user's own mailbox, with a date range.** There is no unbounded read. A
  year is the sensible default because it catches one full renewal cycle.
- **A folder the user names.** Not a whole Drive, and not a search across
  everything they can see.
- **DocuSign, Ramp and QuickBooks name the account and date range.** Slack names
  the channels or direct-message conversations plus a date range, never all
  direct messages.
- **Every candidate says where it came from**, down to the agreement,
  transaction, bill, message, channel or thread. Nothing is absorbed
  anonymously.

**What it never does.**

- **Never fills a person field.** Same rule as `process:backfill`. An agent
  guessing at an owner is worse than an empty field, and this is a database where
  four fields are people.
- **Never sets `Last reviewed`.** Empty is the honest value and it is what makes a
  backfilled row show up for review.
- **Never sets `Importance` from a receipt, payment or agreement.** It may
  propose Importance only when bounded Slack evidence names the exact source,
  what breaks and how fast. That value remains inside the full row-level
  approval gate.
- Never writes without approval, and never runs unattended.
- Never writes through an external connector. Notion is the only write
  destination.

**The duplicate check runs before a candidate is offered**, using the same
mechanism `software:new` uses. That is what makes backfill safe to run repeatedly,
which matters more here than in Process, because new receipts arrive
every month.

**This skill is why the directory is worth building.** Recorded plainly because it
was asked for after the schema was drafted, and a schema whose rows have no
plausible way of being created is a schema nobody uses.

### Every field's fill event

The reference's own principle, applied. A property with no named fill event sits
empty, which is how a schema ends up with a field filled on one row out of
ninety-one.

| Field | Filled when | By |
|---|---|---|
| Name, Description, Domain, Audience, Status | The row is created | `software:new`, partly `software:backfill` |
| Importance | The row is created, re-confirmed at review, or supported by exact Slack consequence evidence during backfill | `software:new`, `software:review`, narrowly `software:backfill` |
| Customer facing | The row is created, re-confirmed at review | `software:new`, `software:review` |
| Owner, Technical owner, Admins, Billing owner | The row is created | `software:new`. Never backfill |
| The contract group | The row is created, re-confirmed at review | `software:new`, `software:review`, and `software:backfill` from a contract or signed DocuSign agreement |
| Stores PII, SOC 2, SSO | The row is created, re-confirmed at review | `software:new`, `software:review` |
| AI access | The row is created, re-checked when integrations change | `software:new`, `software:review` |
| Login, Documentation, Status page | The row is created | `software:new` |
| Given to new teammates | Whenever it becomes true | a person |
| Integrates with | An integration is built or torn down | a person, or `software:review` |
| Artifacts | A doc about this tool is written | `process:new` |
| Last reviewed | Creation and every full pass. Never by backfill or contracts | `software:new`, `software:review` |

`software:new`, `software:review`, `software:contracts` and
`software:backfill` implement these fill events. `software:update` handles a
named fact change without moving the review stamp.

### Dropped from the reference

| Dropped | Reason |
|---|---|
| Plan / Edition | Free text that no view can filter. The tier and its limits are a sentence, and sentences go in Notes |
| The finance system as the source of truth for contracts | One company's stack. The general version is a number, a link, and a date it was last confirmed |
| Department and End-Users as relations to a Teams database | There is no Teams database in the foundation. `Domain` is the function that owns it and `Audience` is who uses it, both already defined and already shared. Same move that folded a Teams relation into Audience in Process |
| Support/Help as a property | Became a body section, with the vendor contact. Names and email addresses of people at the vendor are not workspace users and do not belong in a person field |
| Help centre URL | The fourth URL column, and the least reached for. It goes in the body under Links |
| Domain Usage, Field Mappings, GTM Fields, Customer Tasks | Pointed at databases that existed in one organisation only. The same treatment these got in the other three schemas |
| A separate Tool Changelog database | A good idea and out of scope. It is fed by scheduled watchers and email triage, and v1 has no unattended runs. When it ships it is a foundation plugin, because a plugin that owns a database belongs in tier one, the same resolution `teammates` got; scheduled watchers stay out of v1 either way |

---

## Part 2: page body template

One template, because there is one kind of row.

### Software

**What it is.** The index entry for one tool. What we use it for, how to get it,
and who to ask.

**Body sections, in order:** What It Does For Us, How To Get Access, Vendor
Contacts, Notes (conditional).

**Why it is built this way.** Four light sections, because the depth belongs in a
related Technical Reference and duplicating it here creates two documents that
disagree within a month. What It Does For Us is written for somebody who has never
heard of the tool, which is the reader this row exists for. Vendor Contacts is
here because the failure at 6pm is not missing documentation, it is not knowing
who to call, and on a bought tool that person is often outside the company.

**Why there is no contract section.** Every contract fact is a property, and a body
section restating them is two copies that disagree. What does not fit a property,
such as what was negotiated, which tier you are on, or what happens if you exceed
a limit, goes in Notes.

**What goes in each part.**

- What It Does For Us: what it does, in plain language, **ending with what breaks
  if it stops.** That last clause is what makes `Importance` checkable rather than
  a matter of opinion.
- How To Get Access: who to ask, what approval is needed, or "single sign-on, just
  log in". **"Ask IT" is not an answer** for the same reason "Ask RevOps" is not a
  contact on a Technical Reference.
- Vendor Contacts: our rep at the vendor with an email, the escalation path if it
  is different, and one line on what support we actually get. Names and addresses
  as text. If there is no rep, write that, because knowing you are on your own is
  worth knowing before you need help.
- Notes: conditional. The tier and its limits, what was negotiated, gotchas,
  anything that does not fit above.

**Hard rules.**
- **No credentials, tokens or keys, ever.** Name the vault or the variable. Same
  rule as a Technical Reference, and this row is more likely to tempt somebody
  because it already holds the login URL.
- **A body running long means a Technical Reference is owed.** Write it in the
  Process and relate it, rather than growing this page.
- If there is no vendor because it is something you built, say so in place rather
  than deleting the section.

**Ceiling of 400 words across the required sections. No minimum.** Conditional
sections sit outside the count.

**400 rather than 800 or 600**, and the reasoning is not that tools deserve fewer
words. It is that this row is an index entry with a Technical Reference behind it,
so length here is a signal that content is in the wrong place. Hitting the ceiling
routes to writing the artifact, in the same way hitting Process's
ceiling routes to the granularity framework.

**Related view:** the `Artifacts` relation. What documentation exists about this
tool, which is what a reader wants next from an index entry.

---

## What was taken from the reference, and what was not

The reference is the software library schema spec in the reference set, and the
exported schema beside it. Taken as structure and reasoning only, per the
standing rule. Nothing about fill rates, row counts or migration order came
across, because none of it is about the design.

**Carried, because it is hard-won and not obvious:**

| Lesson | Where it lives now |
|---|---|
| Importance defined by what breaks and how fast, not by how important it feels | `Importance`, almost unchanged |
| A third importance option, so the honest answer has somewhere to go | `Standard` |
| The notice deadline is the most valuable date in the database and the one nothing fills | `Notice deadline`, with a named fill event and a skill that reads it |
| Ask for the notice period, not the notice date | The fill rule on `Notice deadline` |
| An AI-access multi-select rather than free text, because free text cannot power a view | `AI access` |
| PII as a select rather than a checkbox, because customer and employee data are different risks | `Stores PII` |
| Supporting single sign-on and having turned it on are different facts | `SSO`, as values on one field rather than two fields |
| A tool-to-tool relation as the blast-radius map for outages | `Integrates with` |
| Every property needs one named fill event and one maintainer, or it sits empty | The fill-event table, and the four skills it forces into existence |
| The status value that can be read two opposite ways | `Rejected` |
| A backfill skill, because nobody types a hundred rows by hand | `software:backfill`, widened to email as well as documents |

**Deliberately not carried:**

| Not carried | Why |
|---|---|
| The finance integration, and pointer-only spend | Right rule, wrong situation. It holds where a finance system owns the data. Here it usually does not, and a link to nothing is not more honest than a number |
| Plan / Edition as a property | Free text no view can filter |
| Department and End-Users as relations to a Teams database | No Teams database exists in the foundation, and Domain plus Audience already carry it |
| A tag list, in any form | A tag is what a row is about, and a tool is not about anything |
| The Tool Changelog database | Right idea, wrong version. Its unattended watchers keep it out of v1; when it ships it is a foundation plugin, because it owns a database |
| Named individuals, internal database ids, and one company's Slack domain | Not portable, and not ours to ship |

---

## What review changed, 2026-08-17

The first draft was read field by field and four things changed. Recorded so the
reasoning is not lost and the same ground is not re-covered.

1. **The security group came back.** Cut on the grounds that compliance rots, then
   restored when the same argument was rejected for the contract group. One
   argument cannot produce two answers in one schema. `Last reviewed` is what makes
   both groups honest.
2. **Owner was split into `Owner` and `Technical owner`.** Whose call it is and
   who can explain how it works are different people more often than not, and the
   single field assumed they were the same.
3. **`Plan` was cut and `Annual cost` stands alone**, annualised, with the billing
   shape and the tier limits moved into Notes.
4. **`software:backfill` was added**, reading a folder of contracts and the user's
   own mailbox. This is the largest change of the four, because a directory that
   can only be filled by hand does not get filled.

---

## Open

1. ~~**`teammates` is listed in tier two, and a teams and people directory owns a
   database.**~~ **Resolved 2026-08-17: `teammates` is a foundation plugin
   deferred to v2**, so it is not tier two and the rule holds unchanged. This
   schema was already safe either way, because it uses `Domain` and `Audience`
   rather than a Teams relation. See `DECISIONS.md`.
2. **`Integrates with` as one-way.** The reasoning is above and the cost is one
   extra query. Worth revisiting only if a reader on a tool page turns out to
   genuinely need both directions visible without a skill.
3. **Four person fields is one more than the reference had**, and the reference
   documented that group as its worst filled. `Admins` is the one to drop first if
   real use proves the point.
4. **Four skills are named and none are designed.** `software:new`,
   `software:review`, `software:contracts`, `software:backfill`. The last one needs
   the most care, because it reads somebody's mailbox.

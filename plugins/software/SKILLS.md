# software: what each skill does

Part 3 for `software`. Each skill is described in the same five slots as
the other skill files: what it does, when it runs, what it reads and writes,
what it does not do, and the judgment it carries.

The database is defined in `plugins/software/SCHEMA.md`, which also names every field's
fill event. This file does not restate a field name or a value list.

Written 2026-08-17. `update` added and the names confirmed 2026-08-18.
`evaluate` added 2026-08-27.

---

## Rules that apply to every skill in this plugin

The shared rules in `plugins/memos/SKILLS.md` apply here unchanged: never invent a select
value, verify the write landed, a hard confirmation gate, preview in full inline,
route to `setup` on first run, pin the Notion API version and the client floor to
the two values `plugins/setup/SKILLS.md` defines, and record only sources you actually
opened.

Three more belong to this plugin.

- **No credentials, tokens or keys, ever.** Not in a property, not in a body, not
  in a preview. Name the vault or the variable. This database already holds a
  login URL, which makes it the most tempting place in the whole design to put a
  password.
- **Never guess a person.** Four fields here are people. An agent guessing at an
  owner is worse than an empty field, because an empty field asks a question and a
  wrong one answers it.
- **`Last reviewed` moves only when a real pass happened.** Not on a rename, not
  on anything else `update` does, not when `contracts` reads the row, and never on
  a `backfill` creation, which deliberately leaves it empty. **Two writers exist:
  `new` stamps it at creation, because creation is a full pass (the person just
  answered every group), and `review` stamps it on a confirmed pass.** Ruled by
  Sarah on 2026-08-25, settling this document's earlier review-only wording in
  favour of the fill-event table in `plugins/software/SCHEMA.md`. This is the same
  correction `process:update` needed on 2026-08-17, where fixing a typo was
  resetting the review clock and suppressing the staleness warning for a whole
  cadence period.

---

## evaluate

**What it does.** Produces a source-backed decision for a new candidate,
replacement, vendor demo, proof of concept, or build-versus-buy question.

**When it runs.** Before a purchase or build decision, while a POC needs a next
gate, or when somebody suspects the proposed tool overlaps the current stack.
Recording a chosen tool is `new`; changing directory facts is `update`;
confirming an active row is `review`; contract deadlines are `contracts`.

**What it reads and writes.** It reads the complete Software directory through
a count-checked, bookended survey; fetches linked Process artifacts; and may
read only the accounts, folders, conversations, meetings, calls, mailbox,
domains, exact export artifacts, and dates the user approved. It writes temporary normalized JSON needed
for deterministic checks and returns the evaluation inline. **It writes no
Notion row and changes no external system.**

**What it does not do.** It never buys, pays, approves, signs, cancels, contacts
a vendor, accepts credentials, creates or updates a Software row, or silently
calls another plugin's write path. `software:renew` is not part of this release.

**The judgment it carries.** Evidence stage is a ceiling. A demo cannot become
a Buy; an incomplete POC becomes `Complete POC`; current price and material
terms must be verified before any Buy; Build needs a tested technical path,
known operating behavior, comparable cost, maintainability, and an accountable
technical owner. A one-way `Integrates with` relation requires both outbound
and reverse dependency discovery. Competing terminal options resolve only by
strict dominance on a priority accepted in the initial read scope or a dated accountable choice;
otherwise the answer is `Insufficient evidence`.

---

## new

**What it does.** Adds one tool to the directory.

**When it runs.** Somebody buys something, inherits something, or notices that a
tool everybody uses was never written down.

**What it reads and writes.** Reads the live select options before choosing any
value. Writes one row and its body. Verifies the body wrote.

**What it does not do.**
- **Does not guess `Importance`.** It asks the consequence question instead: what
  breaks, and how fast.
- Does not fill a contract field it cannot verify. An empty `Notice deadline` is a
  question. A guessed one is a missed renewal.
- Does not fill a person field the user did not name.
- Does not create a second row for something already in the directory. The
  duplicate check runs before drafting.

**The judgment it carries.** Two things.

1. **Is this one tool or several.** The most common structural mistake in a tool
   directory. Google Workspace, Salesforce with three paid add-ons, an AWS account
   with nine services: one row or many.

   **The test: one row per thing you could cancel separately.** If dropping it
   means a separate conversation with a vendor and a separate line on a bill, it
   is its own row. If it goes away when the parent goes away, it is a sentence in
   the parent's Notes.

   That test is deliberately about the contract rather than about the technology,
   because the contract is what this database exists to track and because
   everybody can answer it.
2. **`Importance`, asked properly.** People inflate this, so the skill never asks
   how important a tool is. It asks what stops working and how quickly, and picks
   the value from the answer.

---

## update

**What it does.** Changes the facts on a row that already exists, one row at a
time.

**When it runs.** Whenever something about a tool changes and somebody is willing
to write it down. The vendor is acquired and the product renamed, a contract is
extended or shortened, the cost moves at renewal, the owner leaves, the access
list widens, the tool is dropped.

**What it reads and writes.** Reads the row. Writes the properties and the body
sections that changed, and shows a before and after first. **It never writes
`Last reviewed`**, whatever it changed and however much of the row it touched.

**What it does not do.**
- **Never moves `Last reviewed`.** Not on a rename, not on a cost change, not on
  a retirement. After creation, `review` is the only skill in this plugin that
  moves it. An edit
  that resets the freshness stamp suppresses the staleness warning for a whole
  cadence period, which is the same fault `process:update` was corrected for on
  2026-08-17.
- Does not create a row. That is `new`.
- Does not delete or archive a tool that is gone. `Status` moves to `Retired` and
  the row stays, which is what keeps the record of what was dropped.
- Does not rewrite a body wholesale when one section is what changed.
- Does not fill a person field the user did not name. An owner who left is
  cleared or replaced by name, never guessed at, the same rule `new` carries.
- Does not re-confirm anything it was not told about. It changes what it was
  asked to change and leaves the rest of the row alone, including the parts that
  are visibly stale. Fixing a cost is not a licence to tidy the security group.

**The judgment it carries.** **Whether the thing in front of you is still the
same thing.** Three cases arrive looking identical and only one of them is an
edit.

1. **A rename is an edit.** Same contract, same spend, same seat, new word. One
   row, and see below for what has to survive it.
2. **A replacement is two operations.** You stopped using one tool and started
   using another. The old row goes to `Retired` here and the new one goes through
   `new`, because it has its own contract, its own owner and its own answers to
   the security group. Editing the old row into the new tool destroys the record
   that you ever paid for the first one.
3. **A merge is a retirement plus an edit.** Your vendor was folded into a
   product you already have a row for. The absorbed row goes to `Retired`, the
   surviving row picks up whatever it now covers, and **the spend lands on one of
   them and not both**, or `contracts` reports a renewal that nobody owes.

**Why it is a separate skill from `review`.** `update` changes facts you already
know changed. `review` confirms a whole row is still true, and is the only thing
after creation that moves `Last reviewed`. Somebody correcting one cost should
not have to sit
through a four group sweep, and that friction at the exact moment somebody was
willing to record something is what this skill removes.

**This diverges from `process:update` on purpose.** There, an edit can count as
having re-read the artifact, and on an explicit yes it moves all three
verification fields. Here it never can, because a software review is not a
re-read. It goes to the contract in Drive, to a spend source, and to whether the
tool is actually connected, and no edit does any of that by accident.

### What a rename does to the history

**Nothing, and that is the decision.** Sarah's call, 2026-08-18. `Name` is the
vendor's own spelling, so an acquired and renamed product gets the page renamed
and that is the whole operation. No former name is kept, and no property is added
to keep one in.

**The cost, accepted.** The duplicate check matches on the name, so a `backfill`
re-run that meets an invoice still issued under the old name will offer the tool
as a candidate again. **That is one "no" at the approval gate**, the same cost as
any other junk candidate, because backfill never writes without approval. It
becomes a second row for the same contract only if somebody approves it.

**So the whole rename is two things: the page name, and the URLs.** An acquired
product moves domain, so `Login`, `Documentation` and `Status page` are updated
in the same pass and the skill asks about all three. Nothing else moves. The
contract group in particular does not: an acquisition does not change terms
already signed, and the new terms arrive at the next renewal, which is
`contracts` and then `review`.

---

## review

**What it does.** A full pass over one tool, or a batch of them, confirming
everything on the row is still true.

**When it runs.** Three moments: before a renewal, when somebody who owned a tool
leaves, and whenever the directory has drifted far enough that somebody wants a
sweep.

**What it reads and writes.** Reads the row. Writes whatever changed, and
**`Last reviewed` only if a real pass happened.**

**What it does not do.**
- **Does not stamp `Last reviewed` on a glance.** It asks whether this counted as
  actually confirming the row, and moves the date only on a yes. The same gate
  `process:update` uses for `Verified by`.
- Does not change the security group without asking, because those answers came
  from somewhere and replacing them silently loses the fact that they were
  checked.
- Does not archive or delete a row for a tool that is gone. It sets `Status` to
  `Retired`, which keeps the history.

**The judgment it carries.** What "reviewed" means, and holding the line on it.
The failure mode is a sweep that opens forty rows, changes nothing, stamps forty
dates, and leaves a directory that looks maintained and is not. **A review that
finds nothing wrong is a real review and should stamp the date. A review that did
not look is not.** The difference is whether the skill actually asked about each
group, so it walks them in order: who owns it, what we pay and until when, what it
holds, and whether it is still in use.

---

## contracts

**What it does.** Tells you what is coming up and what happens if you do nothing.

**When it runs.** When a person runs it. **Nothing schedules it**, because v1 has
no unattended runs anywhere in the marketplace. This is the same shape as
`process:audit`, which reads a cadence field to decide what to flag and is fired
by a person rather than by a clock.

**What it reads and writes.** Reads only. **Writes nothing at all**, including
`Last reviewed`. It produces a list and hands it to `review`.

**What it does not do.**
- Never changes a row.
- Never cancels anything, contacts a vendor, or drafts an email.
- Never reports a renewal as handled. It reports dates and consequences.

**The judgment it carries.** Two things, and both are the reason this is a skill
rather than a saved view.

1. **Ordering by consequence, not by date.** A three hundred dollar tool
   auto-renewing next week matters less than a sixty thousand dollar one with a
   notice deadline in three weeks. The order comes from `Notice deadline` and
   `Renews` together with `Annual cost` and `Importance`, and the output says why
   each row is where it is.

   `Renews = Automatically` is what turns a date into a deadline. The same date on
   a manually renewing contract is a diary note.

2. **Reporting what it cannot see.** **An empty date does not match a "before"
   filter in Notion**, so every row with no contract data is invisible to this
   check. That is the exact trap `process:audit` hit on signal 1, and it is worse
   here, because a contracts report that silently omits half the directory reads as
   "nothing is due".

   **So the output always ends with a count of rows it could not assess**, and
   why: no notice deadline, no contract dates, or `Renews` unknown. That line is
   not a footnote, it is half the answer.

---

## backfill

**What it does.** Finds the tools you already pay for by reading signed
agreements, spend and accounting records, a named contract folder, the user's
own mailbox and bounded Slack context, then offers them as candidates approved
one at a time.

**When it runs.** After `setup`, and again whenever enough time has passed for new
subscriptions to have appeared. It is designed to be re-run, not run once.

**This is the skill that makes the directory possible.** A tool directory is worth
having and nobody will sit down and type a hundred rows, so one that can only be
filled by hand does not get filled.

### The sources are not equally good

| Source | What it proves | What it can fill |
|---|---|---|
| **A folder of contracts** | That an agreement exists, on these terms | Name and the whole contract group. A signature may identify the billing owner, but the field is never filled: name the person in the report instead |
| **DocuSign** | That a signed agreement exists, on these terms | Name and the whole contract group |
| **Ramp and QuickBooks** | That the company paid or booked a bill for the vendor | Name, and honestly little else unless an agreement separately proves the terms |
| **Email**: invoices, receipts, renewal notices, product announcements, support threads | That the tool is in use and somebody is paying for it | Name, and honestly little else |
| **Slack** | That a named team depends on the tool for a named workflow | Name and, only when the evidence names what breaks and how fast, a proposed Importance value |

**An agreement makes a strong contract candidate; spend, accounting, email and
Slack evidence establish narrower facts, and the skill says which it is looking
at.** A row built from a receipt knows a tool exists and nothing about who owns
it or what it matters to. Presenting that as a filled row would be worse than
not finding it, because a thin row looks finished.

### The shape: candidates, then approval

Identical to `process:backfill`. It gathers, shows a list saying what it found and
where, and the user goes through it saying yes or no. Only the yeses become rows,
and each one is previewed before anything is written.

**This is what makes a weak detector safe.** A candidate that turns out to be junk
costs one "no". It would only be dangerous if backfill wrote without asking, which
it never does.

### What it is allowed to read

The defaults lean closed, and the user sets the scope.

| Rule | |
|---|---|
| **Email is read-only** | It never sends, replies, labels, archives, moves or marks anything. It reads to find vendors and does nothing else |
| **The user's own mailbox, with a date range** | There is no unbounded read. A year is the sensible default, because it catches one full renewal cycle |
| **A folder the user names** | Not a whole Drive, and not a search across everything they can see |
| **A named account and date range for DocuSign, Ramp and QuickBooks** | A multi-account authorization is never treated as permission to read every company |
| **Named Slack locations and a date range** | Channels or named direct-message conversations; never all Slack and never all DMs |
| **Every candidate says where it came from** | Down to the agreement, transaction, bill, message, channel or thread. Nothing is absorbed anonymously |

**What it does not do.**
- **Never fills a person field.** Four fields here are people and all four stay
  empty.
- **Never sets `Last reviewed`.** Empty is the honest value, because a machine
  pulled the row in and nobody has confirmed any of it.
- **Never sets `Importance` from a receipt, payment or agreement.** It may
  propose Importance only when bounded Slack evidence names the exact message
  or thread, what breaks and how fast. The row-level approval still decides.
- Never writes without approval, and never runs unattended.
- Never reads outside what the user pointed it at.
- Never writes through an external connector. Notion is the only write
  destination.

**The duplicate check runs before a candidate is offered**, using the same
mechanism `new` uses. That is what makes backfill safe to re-run, and it matters
more here than in Process, because new receipts arrive every month.

**The judgment it carries.** What counts as evidence that you use a tool. A
receipt is strong. A product announcement is weaker, because vendors email people
who never bought anything. A support thread is strong. The skill should say which
kind of signal it found for each candidate, so a user scanning the list can trust
the strong ones and look harder at the weak ones.

---

## Why there is no find

`process` and `memos` each have one, and this plugin does not.

The questions people ask a tool directory (what do we use for this, who owns that,
which tools have an AI surface and hold customer data) are **view questions**. A
well-built database with the right fields answers them by filtering, and every
field needed to do so is in the schema. The one question that needs computation
rather than filtering is the contract deadlines, and they have their own skill.

**This is also a deliberate stop.** Four near-identical find skills across four
plugins is four places to fix one bug, and a single search across all six
databases is the obvious tier-two plugin. Building a fourth one first would make
that harder rather than easier.

---

## Open

1. **`review` in batch mode is undesigned.** Reviewing one tool is clear.
   Reviewing forty in a sitting is the actual use, and it needs a shape that does
   not turn into forty conversations or into forty stamped dates with nothing
   confirmed.
2. **Nothing writes `Integrates with`.** The schema names a person or `review` as
   its fill event, which is the weakest fill event in the design. If the
   blast-radius map turns out to matter, it needs a real moment when it gets
   filled.

# software: what each skill does

Part 3 for `software`. Four skills, in the same five slots as the other skill
files: what it does, when it runs, what it reads and writes, what it does not do,
and the judgment it carries.

The database is defined in `SCHEMA-software.md`, which also names every field's
fill event. This file does not restate a field name or a value list.

Written 2026-08-17.

---

## Rules that apply to all four

The shared rules in `SKILLS-memos.md` apply here unchanged: never invent a select
value, verify the write landed, a hard confirmation gate, preview in full inline,
route to `setup` on first run, pin the Notion API version and the client floor to
the two values `SKILLS-setup.md` defines, and record only sources you actually
opened.

Three more belong to this plugin.

- **No credentials, tokens or keys, ever.** Not in a property, not in a body, not
  in a preview. Name the vault or the variable. This database already holds a
  login URL, which makes it the most tempting place in the whole design to put a
  password.
- **Never guess a person.** Four fields here are people. An agent guessing at an
  owner is worse than an empty field, because an empty field asks a question and a
  wrong one answers it.
- **`Last reviewed` moves only when a review happened.** Not on a rename, not when
  `renewals` reads the row, not when `backfill` creates it. This is the same
  correction `process:update` needed on 2026-08-17, where fixing a typo was
  resetting the review clock and suppressing the staleness warning for a whole
  cadence period.

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

## renewals

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
   here, because a renewals report that silently omits half the directory reads as
   "nothing is due".

   **So the output always ends with a count of rows it could not assess**, and
   why: no notice deadline, no contract dates, or `Renews` unknown. That line is
   not a footnote, it is half the answer.

---

## backfill

**What it does.** Finds the tools you already pay for, by reading a folder of
contracts and your own mailbox, and offers them as candidates you approve one at a
time.

**When it runs.** After `setup`, and again whenever enough time has passed for new
subscriptions to have appeared. It is designed to be re-run, not run once.

**This is the skill that makes the directory possible.** A tool directory is worth
having and nobody will sit down and type a hundred rows, so one that can only be
filled by hand does not get filled.

### The two sources are not equally good

| Source | What it proves | What it can fill |
|---|---|---|
| **A folder of contracts** | That an agreement exists, on these terms | Name, the whole contract group, sometimes the billing owner from a signature |
| **Email**: invoices, receipts, renewal notices, product announcements, support threads | That the tool is in use and somebody is paying for it | Name, and honestly little else |

**A contract makes a strong candidate and an email makes a thin one, and the skill
says which it is looking at.** A row built from a receipt knows a tool exists and
nothing about who owns it or what it matters to. Presenting that as a filled row
would be worse than not finding it, because a thin row looks finished.

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
| **Every candidate says where it came from** | Down to the message or the file. Nothing is absorbed anonymously |

**What it does not do.**
- **Never fills a person field.** Four fields here are people and all four stay
  empty.
- **Never sets `Last reviewed`.** Empty is the honest value, because a machine
  pulled the row in and nobody has confirmed any of it.
- **Never sets `Importance`.** It is a judgment about consequence and a receipt
  carries no information about it.
- Never writes without approval, and never runs unattended.
- Never reads outside what the user pointed it at.

**The duplicate check runs before a candidate is offered**, using the same
mechanism `new` uses. That is what makes backfill safe to re-run, and it matters
more here than in the Process Library, because new receipts arrive every month.

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
rather than filtering is renewals, and it has its own skill.

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
2. **Email access is not specified.** The skill reads a mailbox, and which
   connection it uses, what happens when there is none, and how the date range is
   enforced are all build questions rather than design ones. They are also the
   part most likely to go wrong quietly.
3. **Nothing writes `Integrates with`.** The schema names a person or `review` as
   its fill event, which is the weakest fill event in the design. If the
   blast-radius map turns out to matter, it needs a real moment when it gets
   filled.

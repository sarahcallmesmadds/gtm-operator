---
name: new
description: Write one new artifact into the Process library, in the body template its type calls for, after checking whether it already exists. Use when the user says "write this up", "document this", "add this to the process library", "we should write an SOP for this", "record this decision", or hands over notes worth keeping. Reads the library for near matches, writes one page and its body. Writes nothing without an explicit yes.
allowed-tools: Write, Bash(node:*), mcp__*__notion-fetch, mcp__*__notion-query-data-sources, mcp__*__notion-create-pages, mcp__*__notion-update-page
---

# new

Turn free-form notes into one artifact, in the shape its type calls for.

**The line this skill holds: the duplicate check runs before anything is
structured.** A near match found afterwards means a document that gets merged
away, and the work of structuring it was wasted. A near match found first costs
one question.

## How this skill works

**`scripts/process.js` decides what to send. You send it.** The Notion calls go
through the connected client, which a script cannot reach, so the script builds
every query, checks every value and judges every answer, and you make the calls
in between.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/process.js" context
node "${CLAUDE_PLUGIN_ROOT}/scripts/process.js" duplicates <proposed.json>
node "${CLAUDE_PLUGIN_ROOT}/scripts/process.js" judge <proposed.json> <rows.json> [threshold]
node "${CLAUDE_PLUGIN_ROOT}/scripts/process.js" check <proposed.json>
node "${CLAUDE_PLUGIN_ROOT}/scripts/process.js" create <artifact.json>
node "${CLAUDE_PLUGIN_ROOT}/scripts/process.js" prove <artifact.json> <readback.json>
```

**Do not compose a query by hand and do not build a property payload by hand.**
Both resolve the workspace's own property and option names through the config
map. A hand-written query asking about the names this plugin shipped with comes
back with no rows on a renamed workspace, and no rows is exactly what an empty
library looks like.

**Never invent a select value.** Notion refuses a value the property does not
have with a 400, and the refusal is all or nothing: writing `["AI", "Invented"]`
does not save `AI` and drop the rest, the page is not created at all. Measured
against a live workspace on 2026-08-17. That is why `check` runs before drafting
rather than at the point of writing, and why a drafted artifact is never lost to
a bad value.

**The error is worth catching rather than surfacing raw.** It names the offending
value and lists the allowed ones, so drop or remap the value and try again.

---

## Step 0. Refuse to start without config

Run `context`. If it refuses, print what it said and stop. It names the plugin to
run, which is `setup`, and this skill never creates a database and never writes
config.

**Do not rely on the README for this.** A user arriving here has not read it.

---

## Step 1. Which type is this

Users get Type wrong more often than any other field, so ask the tree rather than
deciding alone. It is in the script as `TYPE_TREE` and it is here so you can show
it:

1. Records a **choice and its reasoning** → **Strategy Decision**
2. Describes a **repeating process someone could do wrong** → **SOP/ROE**
3. **Teaches someone who does not know how yet** → **Enablement**
4. Explains **what numbers mean** → **Reporting**
5. Explains **how a system is wired**, for whoever maintains it → **Technical Reference**

**When two match, ask. Do not take the first.** The tiebreaker is: *who is the
reader, and what are they trying to do?* The same subject produces different
types for different readers. Lead routing is a Strategy Decision for whoever set
the rules, an SOP for whoever adds a rule, an Enablement doc for a new AE, and a
Technical Reference for whoever debugs the assignment engine.

**The pairs people confuse:**

| Pair | The question that settles it |
|---|---|
| SOP vs Enablement | Does the reader already know **why**? Yes is an SOP. No is Enablement. An SOP says "do X"; Enablement says "here is what X is and why, then do it" |
| Reporting vs Technical Reference | Is the reader **interpreting a number** or **fixing a thing**? |
| Strategy Decision vs everything | A Strategy Decision has **no steps**. The moment you write a numbered procedure, it is a different type |

---

## Step 2. If it is a Strategy Decision, is it one decision

**Both tests have to pass.** Show them rather than judging silently.

**Test 1: could it have gone the other way?** Is there a real alternative a
reasonable person would have argued for, and can you write the "why not that"
paragraph? If it just follows from a bigger decision, it is a section inside that
one.

**Test 2: does anything hang off it?** A Strategy Decision earns a page when it
has children. If no SOP, technical reference or enablement doc will point at it,
it is a rule inside another document.

**Third signal when stuck: when it changes, what else has to change?** If
changing rule A leaves B untouched, they are separate. If they always move
together, one document.

**The practical middle:** readable in about two minutes, with between two and
eight children. More than eight and an intermediate decision is hiding in there.
Zero and it is a section in something else.

**Worked example.** "Salesforce is the system of record" is one decision.
Accounts, opportunities, contacts and contracts are that decision applied four
times, not four decisions, because nobody argued them separately. "Account names
use the legal entity name, not the DBA" passes test 1 and fails test 2, so it is
a rule inside the account creation SOP.

---

## Step 3. Check for a near match, before structuring anything

Write the name and a one-line description to a file, then:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/process.js" duplicates proposed.json
```

Send the SQL it returns, with `<ds>` replaced by the quoted data source url, then
pass the rows back:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/process.js" judge proposed.json rows.json
```

**The threshold is not calibrated and the output says so.** It exists so the
check runs. Show the candidates and let the person decide, which is exactly why a
wrong threshold is survivable here: a bad candidate costs one "no".

**Three outcomes:**

- **No match.** Carry on to step 4.
- **A duplicate.** Say which artifact it is, link it, and ask whether to update
  that one instead. `update` is the skill for that, and it is not built yet, so
  say so plainly rather than offering it.
- **A replacement.** Both this and the match are Strategy Decisions, and the
  existing one reaches a *different* decision on the *same* problem. **Show both
  decisions side by side and say so.** **Do not set `Supersedes` and do not
  archive the old one.** Neither is built in this version: `create` writes no
  relation, and archiving the old artifact is an edit, which is `update`'s job.
  Say plainly that the link has to be made by hand for now, and name both
  artifacts so it can be. Writing the relation yourself is the one thing this
  skill forbids, so an instruction to do it would ban its own remedy.

---

## Step 4. Draft the body, in the template for its type

**Every type has its own sections, in order.** `create` returns them and refuses
a required one left empty.

| Type | Sections |
|---|---|
| Strategy Decision | Problem, Decision, Why This Approach, Used For, Not Used For, Sources |
| SOP/ROE | Scope, Trigger Condition, Steps, System Behavior, Exceptions, Sources |
| Enablement | Purpose, Prerequisites, Steps, Tools & Resources, Common Questions, Sources |
| Reporting | Purpose, Key Metrics, Dashboards, How to Read, Data Sources, Update Frequency, Sources |
| Technical Reference | What It Does, Configuration, Integration Details, Authentication, Known Limitations, Contacts, Sources |

**Sources is conditional on every type.** Required where the content came from
somewhere else, omitted where the work was internal with no external source. A
section that is empty on a third of documents stops being read.

**A section that does not apply says so in place.** Deleting it loses the
information that it was considered.

**Two sections can never be blank**, and the script refuses them: `Exceptions` on
an SOP/ROE and `Known Limitations` on a Technical Reference. Where there is
genuinely nothing, write "none known" explicitly. Blank reads as unconsidered
rather than as clean.

**Do not write a section you could not fill.** Say it is empty rather than
inventing content to reach a length.

### The hard rules per type

- **SOP/ROE.** Every step names an actor and a system. "The team reviews it" is
  not a step. One SOP per trigger: two processes starting from different events
  are two SOPs even where the steps overlap.
- **Enablement.** Prerequisites names specific access, not "the right
  permissions". Common Questions comes from questions people actually asked. An
  invented FAQ is the clearest sign nobody used the document.
- **Reporting.** Every metric gets a sentence a non-analyst can repeat, because a
  formula is not a definition. How to Read contains at least one way people get
  this wrong.
- **Technical Reference.** **No credentials, tokens or keys, ever.** Name the
  vault or the variable. Contacts names a person, never a team: "Ask RevOps" is
  not a contact.

### Sources

**Record every source you actually opened, and never one you did not.** Each gets
a line saying what it contributed. Do not claim to have searched, read or
verified anything the tool result does not confirm. A Sources section that cannot
be trusted is worse than none, because a reader cannot tell which lines are real.

The script refuses a source with no line of context.

---

## Step 5. Check, and show the preview in full

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/process.js" check draft.json
```

**Problems are refusals.** Fix them and check again.

**Concerns are questions for the user**, and there is one that matters:

**Over the ceiling.** 800 words across the required sections, with Sources
outside the count. **Ask rather than trim.** Running long almost never means a
wording problem, it means the artifact is covering more than one thing, so the
question is whether this should be two artifacts. Trimming a document that is
genuinely too big just makes a bad document shorter. On a Strategy Decision, run
both granularity tests again.

**Then preview the whole body inline**, in the conversation, not as a pointer to
a file. Properties first, then every section in full.

**The confirmation gate is hard. Create only on an explicit yes.** Treat anything
ambiguous as not yet confirmed.

---

## Step 6. Write it, then prove it landed

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/process.js" create artifact.json
```

That returns the properties payload, the body sections and the headings to expect.
Create the page, **then read it back and prove it**:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/process.js" prove artifact.json readback.json
```

**A create call that returned without an error proves nothing.** A Notion page
can be created with an empty body on a silent partial failure. If a heading is
missing, write it again and prove it again. **Never report success with a section
missing.**

**Say what was not checked.** `prove` compares the headings and reports that the
text under them was not read back. Repeat that rather than letting "proved" read
as more than it is.

### Fields set without asking

| Field | Value |
|---|---|
| `Status` | `Active`. `Draft` is reachable only by a person setting it in Notion, because a skill that writes a draft has written nothing useful |
| `Owner` | the user, from the person id in config. Skipped where there is none |
| `Last checked for accuracy` | today |
| `Verified by`, `Verified date` | the user, today. `Verified by` is skipped where there is no person id, and `Verified date` is set either way |
| `Review cadence` | the configured default, offered for change in the preview |

**No person id is a working install, not a failed one.** The property is omitted
rather than written empty, and nothing fails over it.

---

## What this skill does not do

- **Does not edit an existing artifact.** That is `update`, which is not built
  yet. Say so rather than offering it.
- **Does not silently create a parent.** It offers an existing Strategy Decision,
  or proposes creating one first, and says which it is doing.
- **Does not write the `Parent` or `Supersedes` relation.** `check` still refuses
  a parent of the wrong type, because that is the only place the rule can be
  enforced, but `create` builds no relation and the named parent does not reach
  Notion. `create` says so in its output. Both relations arrive with `update`.
  Report it as unlinked rather than letting the user assume it was set.
- **Does not let an SOP, Enablement, Reporting or Technical Reference be a
  parent.** The script refuses it. Only a Strategy Decision can be a parent,
  because every other type describes how and this one describes why, which is
  what makes the library navigable instead of a pile. **Notion cannot check
  this**: a view filter cannot read the parent's Type across a relation, measured
  2026-08-17, and a rollup filter is created, reported as created, and silently
  discarded. So the refusal here is the only check there is.
- **Does not build the embedded related view.** Every type calls for one and
  `create` names which. Building it needs the Views API and is not in this
  version. Say it is missing rather than leaving the user to notice.

---
name: run
description: Import one named lead list into HubSpot, planned end to end and pushed only after an explicit yes. Use when a lead list arrives, the user says "import this list", "get these leads into HubSpot", "load this conference CSV", or hands over a CSV file or a Notion page of contacts. Reads the one named source, the CRM, the Process artifacts, its own config and the alias map; writes exactly what the approved plan names, verifies by reading every write back, and writes back to a Notion source. Writes nothing without an explicit yes.
allowed-tools: Read, Write, Bash(node:*), Bash(curl:*), mcp__*__notion-fetch, mcp__*__notion-query-data-sources, mcp__*__notion-update-page
---

# run

Take one named list and land the approved rows in HubSpot: cleaned, deduped,
matched to companies, on the status lists the grid names, verified by reading
the writes back.

**The line this skill holds: everything before the confirmation plans, and the
push executes exactly the approved plan.** Nothing is invented to complete a
row, nobody is guessed, and a value with no source is refused.

## How this skill works

**`scripts/import-leads.js` decides what to send and what an answer means. You
send it.** Every HubSpot request is built by the script as a spec with a
method, a url and a body; you send each with the Service Key as a bearer
header, read from the file config names, and save the response whole for the
script to judge.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/import-leads.js" <command> <args>
```

Send a request spec like this, with the key coming straight from its file into
the header and never into the conversation:

```bash
curl -sS -X <method> "<url>" \
  -H "Authorization: Bearer $(cat <serviceKeyPath>)" \
  -H "Content-Type: application/json" \
  -d @<body.json> > response.json
```

**Never print, echo or paste the key, and never put it in a file this plugin
writes.** The path is config's; the contents are curl's alone. Save every
response to a file as it came back: the judging commands refuse reshaped
copies, because a reshaped response reads as whatever the reshaping assumed.

**The live surface is proved by the live run, not by this file.** The request
shapes are rebuilt from the 2026-08-25 measurements; until the release gate
has run one real list end to end, treat any surprising response as a fact to
record, not an error to push past.

## Step 0. Config, once

Run `config-show`. If it refuses because there is no config, this is the first
run: gather the portal id, where the Service Key lives, the alias-map path and
any property corrections, searching for what can be found rather than asking
anyone to type what could be looked up. Then `config-draft`, show the whole
draft, and `config-write` only on an explicit yes. The file is written once;
any other refusal is fixed by hand, not rewritten.

## Step 1. Scope: one named source

One CSV file or one Notion page or database, named by the user, never found by
a search. **The scope gate refuses rather than narrows**: half a scope is
refused as hard as none, and a source nobody named is never read.

- CSV: `ingest <file.csv>`. It proposes a column mapping and stops.
- Notion: fetch the named source through the connected client, save the rows
  as `[{pageId, columns}]` exactly as fetched, then `ingest-notion`.

Show the proposed mapping with the unmapped columns and any ambiguities, get
it confirmed or corrected, and run ingest again with the confirmed mapping.
Unmapped columns ride along untouched for the writeback; they are shown, not
dropped silently.

## Step 2. The Process artifacts

Read from the Process library, at run time:

1. **The required-fields rule**, required. Hand it to the script as
   `{"required": [...], "leadSourceValue": "..."}`.
2. **The member-status grid**, required. Hand it over as
   `{"naming": "...", "types": {...}}`, using the grid's own naming
   convention and statuses, never a rebuilt one.
3. **Personas**, optional. When the artifact exists the persona step runs;
   when it does not, skip the step without complaint.
4. **Routing**, optional. Absent, every owner is confirmed by hand.

Run `validate-rules` on what was read. **A missing required artifact is
named, not worked around**: say which artifact is missing and that
`process:new` is where it gets written, and refuse the step that needs it. A
grid this plugin invents is exactly the thing the design says lives in
Process. No plugin calls another plugin's skill.

## Step 3. Enrich, blanks only, with a gate

Name the gaps. Offer them to whatever enrichment the session actually has
connected; this plugin carries no vendor code, and no enrichment tool at all
means a working import with its gaps named honestly.

- **Fill blanks only.** An enrichment result never overwrites a value the
  source list provided.
- **Every filled value names its tool** in the row's `fieldSources`, as
  `enrichment:<tool>`. A value with no source is refused at the gate.
- **Person fields stay empty whatever a tool claims**: no owner, no persona
  from enrichment.
- **Anything metered or paid is named and confirmed before it runs.** Paid
  verification runs only on a named yes.

## Step 4. Personas, only if the artifact exists

`personas <rows.json> <personas.json>`. Unclear titles come back flagged;
show them and ask. **Never guess a persona.**

## Step 5. Aliases, then the gate

`aliases <rows.json>` normalises company names through the user-owned map and
shows what fired. Then `gate <rows.json> <required.json>`: rows that fail the
floor or the org's rule come back refused with the gap named per row. **A row
that cannot meet the rule is refused, never padded.** Show the refusals; the
person may fix the source and start again, or proceed without those rows.

## Step 6. Companies

`company-queries <rows.json>` builds one search per company. Send them, show
the candidates with their evidence, and let the person decide match or create
per company. **Whether two records are the same company is the person's
call**; the alias map holds the answers already settled so they are not
re-asked, and a new settled answer is worth offering to add to the map.

The portal may auto-create a company from an email domain and take the
primary association. The plan names that collision; do not resolve it
silently.

## Step 7. Dedupe

`dedupe-queries`, send the searches, then `dedupe`. Per row: create, update
filling blanks only, or nothing to write. **Show, and never auto-resolve:**
rows sharing an email inside the list, cross-company conflicts, and rows with
no email (unknown is not new). Every one of them needs the person's decision,
recorded in the plan inputs as exclusions or decided rows.

## Step 8. The multi-event check, mandatory

`events <rows.json>`, before any campaign setup. Show the grouping
candidates, the date columns and the event-word hits, and decide with the
person whether this is one campaign or several. **The expensive mistake is
one campaign wrapped around three events, discovered after the memberships
are written.** The plan refuses to assemble without this step's output.

## Step 9. Statuses and lists

With the campaigns decided, assign each row its status from the grid, by
campaign type and what is known about the person's engagement. **A row the
grid does not cover is a question, not a default.** The script validates
every assignment against the grid and names the lists by the grid's own
convention, one list per status per campaign.

Then the lists are **matched, or planned for creation**, never assumed
absent: `list-queries` realises the names and builds one lookup per list,
you send them, and `list-judge` turns the saved responses into the
decisions the plan needs. A list that exists gets its id and new members; a
list judged absent is created; an answer the judge does not recognise is a
question, because reading it as absent is how a second copy of an existing
list appears.

## Step 10. The plan, and the one confirmation

Write the inputs file (rows, events output, dedupe output, grid, required
fields, campaigns, assignments, company decisions, list decisions,
resolutions) and run `plan`. It refuses, by name, anything undecided, and it
re-runs the gate on what is actually in it, so nothing between the steps can
have slipped past the floor.

**Show the whole plan inline**: company creates, contact creates and updates,
the exclusions with their reasons, list creates and memberships, the lead
source, and the writeback the run will make. Then ask, and **write only on an
explicit yes**. Anything ambiguous is not yet confirmed.

## Step 11. Push, exactly the plan

`push <plan.json>` emits the requests in dependency order, with opaque
`{kind:number}` tokens standing for ids that do not exist yet and a
`placeholders` legend saying which record each token is. Send them in
order, substituting each returned id for its exact token, saving every
response. Partial success is per record: one refusal does not stop the
rest.

Then `judge-push`. The measured cases fold into the report rather than
becoming errors: a duplicate list add is a silent no-op, and a duplicate
contact create is refused carrying the existing record's id. **Report that
refusal with its id. Never improvise an update nobody approved.**

## Step 12. Verify, by reading back

`readbacks`, fetch every one, then `prove`. **An id is a locator, not a
proof**: the comparison is the proof, and it says what it did not check.
Report both halves, what is proved and what is not, and never round up to
"it worked". If a write did not land, say so loudly and show exactly which.

## Step 13. Writeback, Notion sources only

`writeback` emits the entries in batches. Link each created record on its
source row; fill email only where the source row is blank at write time. **A
writeback failure is reported and never fails the run**: the CRM is the
system of record. A CSV source is never modified.

Close with the run's own report: what was pushed, what was proved, what was
refused, and what needs a person. The report is the record; nothing is posted
anywhere.

---

## What this skill does not do

- Never writes without the confirmation summary and an explicit yes.
- Never guesses a person, an owner, or a persona. An owner comes from a
  routing artifact or an explicit confirmation, and the plan refuses one with
  no recorded source.
- Never overwrites a source-provided value, in the CRM or in the source.
- Never auto-resolves a duplicate or a cross-company conflict.
- Never pads a row to pass the floor or the required-fields rule.
- Never reads rows from anywhere but the one named source: no second list, no
  mailbox, no search. Beyond it, only the CRM it writes, the Process
  artifacts, its own config, the alias map, and, on a yes, the connected
  enrichment tool.
- Never sends email, never posts anywhere, never runs unattended.
- Never creates or renames a skill, a database or a property.

## The judgment this skill carries

1. **Whether two records are the same person or the same company.** Shown
   with evidence, decided by the person, settled answers kept in the alias
   map.
2. **Whether this is one campaign or several.** The multi-event check is
   mandatory, and its signals are shown rather than concluded from.
3. **Which status list each row lands on**, read from the grid and never from
   a built-in table. An uncovered row is a question.

---
name: run
description: Import one named lead list into the CRM config names, HubSpot or Salesforce, planned end to end and pushed only after an explicit yes. Use when a lead list arrives, the user says "import this list", "get these leads into HubSpot", "get these leads into Salesforce", "load this conference CSV", or hands over a CSV file or a Notion page of contacts. Reads the one named source, the CRM, the Process artifacts, its own config and the alias map; writes exactly what the approved plan names, verifies by reading every write back, and writes back to a Notion source. Writes nothing without an explicit yes.
allowed-tools: Read, Write, Bash(node:*), Bash(curl:*), Bash(sf:*), mcp__*__notion-fetch, mcp__*__notion-query-data-sources, mcp__*__notion-update-page
---

# run

Take one named list and land the approved rows in the CRM config names:
cleaned, deduped, matched to companies, on the memberships the grid names,
verified by reading the writes back. One CRM per install: config's `crm`
says which, and everything backend-specific below says which half it
belongs to.

**The line this skill holds: everything before the confirmation plans, and the
push executes exactly the approved plan.** Nothing is invented to complete a
row, nobody is guessed, and a value with no source is refused.

## How this skill works

**`scripts/import-leads.js` decides what to send and what an answer means. You
send it.** Every CRM request is built by the script as a spec; you send each
the way its backend sends things, and save the response whole for the script
to judge.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/import-leads.js" <command> <args>
```

**On HubSpot** a spec carries a method, a url and a body. Send it with the
Service Key as a bearer header, the key coming straight from its file into
the header and never into the conversation:

```bash
curl -sS -X <method> "<url>" \
  -H "Authorization: Bearer $(cat <serviceKeyPath>)" \
  -H "Content-Type: application/json" \
  -d @<body.json> > response.json
```

**Never print, echo or paste the key, and never put it in a file this plugin
writes.** The path is config's; the contents are curl's alone.

**On Salesforce** the credential lives in the `sf` CLI keychain under the
alias every spec carries as `targetOrg`, so there is nothing key-shaped to
handle at all. A spec's `transport` says how it goes:

```bash
# transport: query
sf data query --target-org <targetOrg> --query <soql> --json > response.json
# transport: rest  (write the spec's body to a file first; no --body when the spec carries none)
sf api request rest <path> --method <method> --body @<body.json> --target-org <targetOrg> > response.json
# transport: cli
sf <args...> --target-org <targetOrg> --json > response.json
```

Save every response to a file exactly as it came back: the judging commands
refuse reshaped copies, because a reshaped response reads as whatever the
reshaping assumed. A successful REST PATCH answers 204 with an empty body
(measured 2026-08-26), so an empty file there is the expected shape, judged
as unproved-until-read-back rather than as an error.

**The live surface is proved by the live run, not by this file.** The request
shapes are rebuilt from the 2026-08-25 and 2026-08-26 measurements; until
each backend's release gate has run one real list end to end, treat any
surprising response as a fact to record, not an error to push past.

## Step 0. Config, once

Run `config-show`. If it refuses because there is no config, this is the first
run: gather what the backend needs (the `crm`; on HubSpot the portal id and
where the Service Key lives; on Salesforce the org alias and any record-type
ids; the alias-map path and any name corrections either way), searching for
what can be found rather than asking
anyone to type what could be looked up. Then `config-draft`, show the whole
draft, and `config-write` only on an explicit yes. The file is written once;
any other refusal is fixed by hand, not rewritten.

**On a salesforce first run, ask the org which mailing fields it carries
before the draft is shown.** `mailing-fields-probe <orgAlias>` emits two
read-only queries, one per code field, and `mailing-fields-judge` turns the
two saved responses (state first) into one measured verdict per field:
`MailingStateCode` where the org answered it, the plain name where the org
refused it by name, so even a mixed org gets a measured pair (every branch
measured 2026-08-26). Neither pair is right for every org, which is why the
org is asked rather than defaulted at, and the draft enforces it: a
salesforce `config-draft` refuses answers that carry no judged
`mailingFields` pair. Pass the judge's `use` object as
`mailingFields` in the draft answers, and show which names the org chose
and why.

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

**Then, before anything maps into the CRM, confirm what this import
creates: Contacts, each with its company matched or planned.** On
Salesforce, ask the org first rather than asking the person cold:
`lead-contact-queries` emits two `COUNT()` reads and `lead-contact-judge`
turns the saved pair into the evidence; show both counts and ask whether
Contacts is how this org works. An org that works in Leads deserves the
mismatch named before any write is planned: this plugin lands Contacts and
Accounts, a lead-based import is deliberately out of scope
(`SKILLS-import-leads.md` records it as Open work waiting for a user who
asks), and the person chooses between stopping there and proceeding
deliberately, with the choice recorded in the run's report. On HubSpot
there is no measured Lead surface to count, so the same confirmation is
asked plainly, without counts. Silence is not a confirmation.

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

**Personal addresses are part of the same conversation.** Run
`free-mail <rows.json>`: it names the rows whose email is a consumer
provider (gmail, yahoo and kin). The rule those rows follow: removed, or
enriched to find the work email. Offer the connected enrichment tool the
lookup before anything is removed, and show what it found or that it found
nothing. **A found work email is shown, never silently swapped**: the
fill-blanks rule protects the source's own email, so replacement is the
person's decision every time. A no-email row gets the same offer when the
dedupe step surfaces it.

**An approved replacement keeps the original address on the row**, as
`replacedEmail`, with the new address sourced `enrichment:<tool>` in
`fieldSources`. The original is an identity too: dedupe searches both
addresses, the in-list duplicate check collides both (a row still carrying
the original, or two rows that replaced the same one, are the same
person), and a contact the CRM holds under the original comes back
presented, because pushing the row as it stands would create a second
record for the same person under the new address.

**The rule has teeth at the plan**: the assembly re-runs the detector on
the rows actually in it, and a row still carrying its personal address
blocks the plan until it is excluded or deliberately decided. Keeping the
address is a decision the person makes, never a default the plan slides
past.

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

`company-queries <rows.json>` builds one search per company: by name, and by
domain wherever one is known. A list with no domain column still gets the
domain half where the company's rows' own work emails agree on one; the
output says where each search domain came from, so the evidence shows its
work. **Name search alone is not a duplicate check**: the live run of
2026-08-26 proved a company can exist with no name at all, visible only to
a domain search.

Send them, show the candidates with their evidence, and let the person
decide match or create per company. **Whether two records are the same
company is the person's call**; the alias map holds the answers already
settled so they are not re-asked, and a new settled answer is worth
offering to add to the map.

**Companies get the same care as the people on them.** A domain hit with no
name, or with a name that disagrees with the list, is presented like any
duplicate: it may be the portal's own auto-created record, and the person
chooses between adopting it (match it, filling only fields the candidate's
own evidence showed empty, an empty name included) and creating a named
company beside it. Nothing about a company record is resolved silently.

**An adoption rides the plan, never beside it.** The decision is recorded
as `{"decision": "match", "companyId": "...", "fill": {"name": "..."}}`;
the plan carries the fill whether or not any create needs that company,
the push executes it as one PATCH, and the read-back proves it, the same
as every other write.

On a create decision, a website the person names wins; otherwise the list's
domain fills in automatically where config maps a website property, and an
org that maps none gets the company created bare.

On HubSpot the portal may auto-create a company from an email domain and
take the primary association. The plan names that collision; do not resolve
it silently. Measured 2026-08-26: it did not fire when a company already
carrying the domain existed, and the portal derived that company's `domain`
from the website the push set. On Salesforce nothing like it was observed
and none is designed for; whether an org's own automation creates accounts
is unmeasured rather than known absent, so a surprise in the read-backs is
a fact to record.

## Step 7. Dedupe

`dedupe-queries`, send the searches, then `dedupe`. Per row: create, update
filling blanks only, or nothing to write. **Show, and never auto-resolve:**
rows sharing an email inside the list, cross-company conflicts, and rows with
no email (unknown is not new). Every one of them needs the person's decision,
recorded in the plan inputs as exclusions or decided rows.

**A CRM holding more than one contact under one of a row's addresses is a
different question, with a different answer.** The question is which record
this person is, so the answer names one: the candidates come back each with
the verdict the row would get against it, and the person's choice goes in
the plan inputs as `resolutions.chosen`, `{"index": n, "contactId": "..."}`,
realised as that record's blanks-only update or as nothing to write.
Marking such a row decided is not an answer, because a create would add a
third record; the row is chosen or excluded, never created.

## Step 8. The multi-event check, mandatory

`events <rows.json>`, before any campaign setup. Show the grouping
candidates, the date columns and the event-word hits, and decide with the
person whether this is one campaign or several. **The expensive mistake is
one campaign wrapped around three events, discovered after the memberships
are written.** The plan refuses to assemble without this step's output.

## Step 9. Statuses and memberships

With the campaigns decided, assign each row its status from the grid, by
campaign type and what is known about the person's engagement. **A row the
grid does not cover is a question, not a default.** The script validates
every assignment against the grid.

**On HubSpot** the grid realises as lists, one per status per campaign,
named by the grid's own convention, and the lists are **matched, or planned
for creation**, never assumed absent: `list-queries` realises the names and
builds one lookup per list, you send them, and `list-judge` turns the saved
responses into the decisions the plan needs. A list that exists gets its id
and new members; a list judged absent is created; an answer the judge does
not recognise is a question, because reading it as absent is how a second
copy of an existing list appears.

**On Salesforce** the grid maps onto native member statuses, and the same
asked-not-assumed rule runs three lookups. `campaign-queries` builds one
exact-name lookup per campaign and `campaign-judge` turns the responses
into decisions; a campaign that exists gets its id, an empty answer plans a
create, and two campaigns with one name is a question. `status-queries`
reads the existing member-status rows of every matched campaign and
`status-judge` hands the plan their labels, binding each answer to its
campaign by the CampaignId the rows carry, so a status create is planned
only where the row genuinely is not there (a fresh campaign carries Sent
and Responded, measured 2026-08-25) and reversed saved files surface as
questions instead of crediting the wrong campaign. And `flag-query` with `flag-judge`
read the user record's Marketing User flag, whoami first and the flag read
second, because campaign creation is refused while it is off (measured
2026-08-25): a plan that needs a campaign while the flag is off carries the
measured one-call fix to the operator's own User record as its own named
line, pushed before the campaign family and proved by reading the flag
back. Striking that line strikes the campaign half of the plan with it,
and the run says so rather than pushing a plan that dies.

## Step 10. The checkpoint, the plan, and the one confirmation

**Before assembling the plan, stop and ask the person, in as many words:
"Are there any other fields that we should be stamping for new or updated
accounts and contacts?"** Show the lead-source value the artifact gives, or
that none exists, as part of that question, never as a settled fact: an
empty lead source is an answer someone gave, not a default to report past.
An answer naming a field the plugin can carry becomes a config mapping or
an artifact edit, each on its own explicit yes, before the plan is built.
**The fields the plugin can carry are its own list fields plus persona,
owner and the lead source, through config's property map, and name and
website on a company. An answer naming anything else is refused by name at
the checkpoint**, because the payload builders ignore unknown fields, and
a stamp that silently cannot be written reads as written. Say the refusal
in the run's own report, with the field named, so the request is on the
record; the report is the record, and this plugin writes no file for it.

**Ask a second question in the same breath: "Should these contacts carry a
marketing status or an email opt-out?"** This import writes neither, on
either backend: HubSpot's marketing-contact status and its subscription
statuses, and Salesforce's org-dependent opt-out field, are all unmeasured
surfaces, deliberately outside the write contract. The question exists so
nobody walks away assuming the import set one. An answer wanting them
stamped is refused by name, like any other field the plugin cannot carry,
and the ask goes in the run's report: that recorded demand is exactly what
un-parks the opt-out measurement (`SKILLS-import-leads.md`, Open).

The checkpoint is deliberately a step of the conversation, not a command:
there is no request to send and no response to judge, and its refusal is
grounded in the same field lists the gate, the payload builders and
config's own validation already enforce, so a field waved through here
still cannot reach a payload.

Then write the inputs file (rows, events output, dedupe output, grid,
required fields, campaigns, assignments, company decisions, the membership
decisions the backend's lookups produced, resolutions; on Salesforce also
the judged flag read) and run `plan`. It refuses, by name, anything
undecided, and it re-runs the gate on what is actually in it, so nothing
between the steps can have slipped past the floor.

**Show the whole plan inline**: company creates, adoption fills and
associations, contact creates and updates, the exclusions with their
reasons, the membership writes (list creates and memberships on HubSpot;
campaign, member-status and campaign-member creates on Salesforce, with the
Marketing User flag fix when the plan carries it), the lead source, and the
writeback the run will make. Then ask, and **write only on an explicit
yes**. Anything ambiguous is not yet confirmed.

## Step 11. Push, exactly the plan

`push <plan.json>` emits the requests in dependency order, with opaque
`{kind:number}` tokens standing for ids that do not exist yet and a
`placeholders` legend saying which record each token is. Send them in
order, substituting each returned id for its exact token, saving every
response. Partial success is per record: one refusal does not stop the
rest.

Then `judge-push`. The measured cases fold into the report rather than
becoming errors. On HubSpot: a duplicate list add is a silent no-op, and a
duplicate contact create is refused carrying the existing record's id.
**Report that refusal with its id. Never improvise an update nobody
approved.** On Salesforce: a duplicate campaign member fails individually
with the existing row untouched, folded into the report, and a REST PATCH
answering nothing is the measured 204, judged as unproved until its
read-back rather than as a success or a failure.

## Step 12. Verify, by reading back

`readbacks`, fetch every one, then `prove`. **An id is a locator, not a
proof**: the comparison is the proof, and it says what it did not check.
Every read-back is bound to the record it was fetched for by the id it
carries, and a campaign-scoped read by its rows' CampaignId, so a saved
response filed under the wrong key, or reused under two, fails the proof
instead of proving a write nothing read. The one read that carries
nothing to bind by is HubSpot's list membership envelope, record ids
with no list identity, so the proof names that limit in its unchecked
rather than vouching for it: fetch and save membership read-backs one
list at a time.
Report both halves, what is proved and what is not, and never round up to
"it worked". If a write did not land, say so loudly and show exactly which.

## Step 13. Writeback, Notion sources only

`writeback` emits the entries in batches; on Salesforce it takes the
instance url as its third argument, read from the org display answer,
because config holds no url to build a record link from. Link each created
record on its
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
3. **Which membership each row lands on**, the status list on HubSpot and
   the member status on Salesforce, read from the grid and never from
   a built-in table. An uncovered row is a question.

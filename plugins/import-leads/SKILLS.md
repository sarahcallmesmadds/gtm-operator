# import-leads: what each skill does

Part 3 for `import-leads`, the first job plugin: what each skill does, in the
same slots as the other skill files. What it does, when it runs, what it
reads and writes, what it does not do, and the judgment it carries.

This plugin owns no database and no schema file. A job plugin is named for its
job, and this one's job is taking a lead list from wherever it lives and landing
it in the CRM correctly. It reads the source list, its own config and the alias
map that config names, reads its judgment from Process artifacts, and reads and
writes the one CRM its config names: HubSpot, or Salesforce once the port's
build lands.

Written 2026-08-25. The plugin and skill names are Sarah's, confirmed the same
day: the tier-2 placeholder name `list-building` is retired, because this
imports lists rather than builds them, and the old name stays free for a plugin
that actually builds lists. Amended 2026-08-26 with the Salesforce port's
design, un-parked by her ask the same day; the dated record is in
`DECISIONS.md`.

---

## What this is a rebuild of

The reference set contains a lead-list import skill that ran this pipeline in
production. That it worked well and is worth rebuilding is Sarah's own
account, and that account is the whole of the evidence, which is why the
rebuild changes as little as it can rather than improving on what it cannot
measure. The rebuild rule, her call on 2026-08-25:
**change the least possible.** The pipeline shape, the ordering, the gates and
the hard-won refinements carry over as they are. What moves is identity, not
logic, and identity moves into these homes:

- **Config holds identifiers.** The backend, the portal or the org alias,
  the name maps, file paths.
- **Process holds judgment.** The rules the organisation decided, written as
  artifacts a person and a skill can both read.
- **The run confirms the rest.** Anything that is neither an identifier nor a
  standing rule is asked about at the moment it matters.

Nothing organisation-specific from the reference appears in this repository:
not its value lists, not its internal ids, not its field names, not its
routing. Each of those becomes a config entry or a Process artifact that
the installing organisation fills with its own answers.

---

## Rules that apply to both skills

The marketplace's shared rules apply where they reach: a hard confirmation gate
before any write, previews shown in full inline, and record only sources
actually opened. More belong to this plugin.

- **Nothing is invented to complete a row.** Every filled value names its
  source: the list, the CRM, or an enrichment answer with the tool that gave
  it. A value with no source is refused. A thin row that says it is thin beats
  a thin row that looks finished.
- **Never guess a person.** An owner comes from a routing artifact or from an
  explicit confirmation, never from a default and never from a guess.
- **Fill blanks only, in both directions.** An enrichment result never
  overwrites a value the source list provided, and a writeback to the source
  never overwrites a value already there.
- **Anything metered or paid is named and confirmed before it runs.** The
  reference ran a paid email-verification pass only on an explicit yes, and
  that rule generalises to every step that costs money.
- **No credentials, tokens or keys**: not in a property, not in a body, not in
  a preview, not in this plugin's config file. Name the vault or the variable
  instead.

---

## Where the judgment lives

Config sits at `~/.claude/import-leads.config.json` and holds identifiers
only. A `crm` field names the backend, and an absent `crm` reads as
`hubspot`, because every config written before the field existed was written
for HubSpot and nothing rewrites this file. For HubSpot: the portal, the
property-name map including any custom properties the org wants filled (a
LinkedIn URL property, a persona property), and where the Service Key lives
(never the key itself, per the credentials rule above). For Salesforce: the
org alias the `sf` CLI holds the credential under, the field-name map in the
org's own API names, and any record-type ids the org routes creates through.
No key file exists on that backend, because the CLI's keychain holds the
credential, so there is nothing key-shaped for config to name. Both backends
name the path to the company alias map. The alias map
itself is a user-owned file at a configurable path, the same pattern as the
artifact-type taxonomy, so a team can keep it in a repo and change it by pull
request.

**This plugin writes its own config, once, with confirmation.** On a first run
with no config, either skill stops, says what it needs for the backend it is
being pointed at (the `crm`; on HubSpot the portal, the property names and
where the key lives; on Salesforce the org alias, the judged mailingFields
pair, the field names and any record-type ids; and the alias-map path
either way), searches for what
it can find rather than asking
anyone to type what it could look up, shows what it will record, and writes
the file on an explicit yes. On Salesforce the search half includes the
org itself: two read-only probes, one per code field, answer which state
and country names this org carries, one measured verdict each, so a
picklist org gets the code names, a plain org the plain names, and a
mixed org a measured mixed pair (every branch measured 2026-08-26; the
plain fields' values are refused on a picklist org, the acceptance run's
finding). The draft refuses to assemble a salesforce config without the
judged pair, because a defaulted pair is the exact config the probe
exists to prevent. The foundation's config stays `setup`'s alone;
this file is this plugin's, and nothing else writes it.

Process artifacts carry the organisation's rules, read at run time:

1. **The required-fields rule.** What the org requires on a contact beyond
   this plugin's own floor, and the value the org uses for the lead source,
   shown at run time before anything is pushed. The artifact adds to the
   floor and cannot subtract from it.
2. **The campaign member-status grid.** Which status a row gets, by campaign
   type and by what is known about the person's engagement. On HubSpot the
   grid is realised as lists, one list per status per campaign, named by a
   convention the grid itself states, because a HubSpot list carries no
   member status of its own (measured 2026-08-25). Sarah's call the same
   day. On Salesforce the same grid maps onto native campaign member
   statuses, created per campaign from the grid's own values (measured
   2026-08-25: one plain call each, where the reference needed Apex), and
   the naming convention does not travel, because it exists only to stand in
   for the status HubSpot's lists cannot carry. Realising one grid two ways
   is why the grid lives in Process rather than in code.
3. **Personas, optional.** The persona list and its title-mapping rules. When
   this artifact exists, the persona step runs and unclear titles are flagged
   for review rather than guessed. When it does not exist, the step is skipped
   without complaint. Sarah's call, 2026-08-25.

A routing artifact is optional in the same way: absent, every owner is
confirmed by hand, which is the honest default for an org that has no routing.

A missing required artifact is named, not worked around. `check` says which
artifact is missing and that `process:new` is where it gets written. `run`
refuses the step that needs it rather than inventing a fallback, because a
grid this plugin invents is exactly the thing the design says lives in
Process. No plugin calls another plugin's skill.

---

## The write contract

This plugin writes to a database it does not own, so this file states which
fields it fills, the same rule `plugins/projects/SKILLS.md` follows. This section is
the one home for that list.

**The floor, this plugin's own:** a row without a first and last name is
refused, and no contact is created without its company matched or planned.
The company half of the floor governs creates: an update fills blanks on a
contact the CRM already holds, and that contact's associations are the
CRM's own, left alone by the same rule that protects every value already
there. From the list: first name, last name, email, phone, title, city,
state and country, and a LinkedIn URL where the org maps a property for it.
From the flow: the company association on a created contact, which on
Salesforce is the contact's own `AccountId` field, one write rather than a
second call; membership of what the grid names, status lists on HubSpot and
the campaign with its native member status on Salesforce; on Salesforce
only, the Marketing User flag on the operator's own User record, written
only when a plan needs a campaign while the flag is off, carried as its
own named line in the plan and never implied; the lead-source
value from the required-fields artifact, on creates only, because it records
where a new contact came from and stamping it onto contacts that already
existed would claim them; the owner, only through routing or explicit
confirmation; persona, only when the personas artifact exists. Persona and owner also
fill blanks on an update, on the same terms and never over a value already
there. On a company the flow creates rather than matches:
the name, and the website, because that is what makes the next import's
matching better. The website the person's create decision names wins; the
list's domain is the automatic fallback, and the fallback fires only where
config maps a website property, so an org without one gets its companies
created bare rather than refused. The marketing status and the email
opt-out are not in
the contract on either backend: HubSpot's marketing-contact status and its
native opt-out live in unmeasured surfaces (the marketable-status tier and
subscription statuses);
Salesforce's plain opt-out field is org-dependent, measured absent from a fresh
Developer Edition org; and nothing in the pipeline reads either from a
source list anyway. They are Open rather than implied, and the checkpoint
asks about them by name (2026-08-26).

Anything more comes from the org's own required-fields artifact. A row that
cannot meet the rule is refused with the gap named, never padded.

---

## run

**What it does.** Takes one named list and lands the approved rows in the
CRM its config names: cleaned, deduped, matched to companies, on the memberships
the grid names, verified by reading the writes back, and, when the
source is a Notion page or database, written back to the source. A CSV source
is never modified.

**When it runs.** A lead list arrives: a conference follow-up, a content-
download export, a vendor handoff, a spreadsheet somebody kept.

**What it reads and writes.** Reads the one source the user named, a CSV file
or a Notion page or database, never a search. Reads the CRM to match
companies and contacts, showing what it found for confirmation rather than
asking anyone to type what it could look up. Reads the Process artifacts
above, its own config, and the alias map that config names. Writes what the
approved plan names and nothing else: contact creates and updates, company
creates, adoption fills and associations, the membership writes (list creates and
memberships on HubSpot; campaign, member-status and campaign-member
creates on Salesforce, with the Marketing User flag fix when the plan
carries it), and the writeback
to a Notion source, into blank fields only. All of it sits behind one
confirmation.

**The pipeline, kept from the reference in order. Everything before the
confirmation plans; the push and the writeback after it are the only writes,
and both execute only what the approved plan names.**

1. **Scope.** One named source. The scope gate refuses rather than narrows,
   because there is no approval gate in front of a read: half a scope is
   refused as hard as none, and a source nobody named is never read. And
   before anything maps into the CRM, the run confirms what it creates,
   Contacts with their companies, Sarah's rule of 2026-08-26: on
   Salesforce the org's own Contact and Lead counts are read (two
   `COUNT()` queries, the envelope measured 2026-08-26) and shown as the
   evidence, because an org that works in Leads deserves the mismatch
   named at the door rather than after an import; a lead-based import is
   recorded Open work, and proceeding anyway is the person's deliberate
   choice, kept in the run's report. On HubSpot no Lead surface is
   measured, so the same confirmation is asked without counts.
2. **Map and normalise columns**, preserving the source's own column names for
   the writeback.
3. **Enrich, blanks only.** Gaps are named, and whatever enrichment the
   session actually has connected is offered the gaps. The plugin carries no
   enrichment vendor code at all; providers ship their own plugins, and this
   plugin's side is the gate. Paid verification runs only on a named yes.
   Personal addresses (gmail, yahoo and kin) are detected here and presented
   for the person's call, Sarah's rule of 2026-08-26: removed, or enriched
   to find the work email, with the enrichment offer made before anything is
   removed. A found work email is shown, never silently swapped, because the
   fill-blanks rule protects the source's own email. An approved
   replacement keeps the original address on the row, and the dedupe step
   treats both addresses as the same person's identities, in-list and
   against the CRM; a match under the original is presented, never
   auto-resolved. The rule is enforced where the plan is assembled: a row
   still carrying its personal address blocks the plan until excluded or
   deliberately decided, because a rule that lives only in conversation is
   a rule an otherwise valid plan slides past.
4. **Personas**, only when the artifact exists. Unclear titles are flagged,
   never guessed.
5. **Company names normalised** against the alias map.
6. **Companies matched, or planned for creation, by name and by domain.**
   The search runs by name and, wherever a domain is known, by domain; a
   list with no domain column still gets the domain half where the
   company's rows' own work emails agree on one, Sarah's rule of
   2026-08-26, made after the live run proved a company can exist with no
   name at all, visible only to a domain search. Companies get the same
   care as the people on them: a domain hit with no name or a disagreeing
   name is presented like any duplicate, adopt (filling only fields the
   candidate's own evidence showed empty) or create beside, decided by the
   person. An adoption's fill rides the plan whether or not any create
   needs that company, is pushed as one update (HubSpot's PATCH; the
   CLI's record update on Salesforce, whose semantics are on the build's
   unmeasured list), and is proved by its
   read-back like every other write. A planned company carries
   its name and its website on the write contract's terms: the decision's
   explicit website wins, the list's domain is the automatic fallback, both
   only where config maps a website property. On Salesforce the company is
   an Account, and the domain half of the search runs against `Website`,
   whose query shape was measured on 2026-08-26: the bare-domain LIKE finds
   the prefixed form, and the pattern over-fetches at worst, with the
   person judging the candidates. HubSpot itself
   auto-creates companies from email domains and takes the primary
   association (measured 2026-08-25), so the plan names that collision
   rather than letting it happen silently; the domain search and the
   adopt-or-create-beside presentation are `run`'s answer to it
   (2026-08-26), and the setting itself is measured as not exposed by the
   documented API the same day, so naming the behaviour is all that can
   be done beyond them. On
   2026-08-26 it was measured not firing when a company already carrying
   the domain existed. The collision is HubSpot's measured behaviour;
   nothing like it was observed on Salesforce and none is designed for,
   and whether an org's own automation creates accounts on its own is
   unmeasured rather than known absent, so the build's measurement session
   watches for it instead of assuming silence.
7. **Dedupe against the CRM**, by email, through the search surface, and
   each row gets its plan: create, update filling blanks only, or exclude.
   HubSpot also enforces email uniqueness itself, and a duplicate create is
   refused carrying the existing record's id (measured 2026-08-25), so a
   duplicate that slips past the search cannot become a second record: the
   push reports the refusal with that id, and does not improvise an update
   nobody approved. No such refusal was measured on Salesforce, and whatever
   an org's own duplicate rules enforce is that org's configuration,
   unmeasured here, so on that backend the design treats the backstop as
   absent: the search is the whole guard, and the plan treats it that way
   rather than counting on a refusal to catch what the search missed.
   Duplicates and cross-company conflicts are always presented, never
   auto-resolved. A store holding more than one contact under one of a
   row's addresses, possible on Salesforce where no uniqueness is
   measured, is presented as its own question, which record this person
   is, with each candidate carrying the verdict the row would get against
   it; the answer names one candidate and is realised as that record's
   blanks-only update or as nothing to write. Marking such a row decided
   is not an answer, because a create would add a third record: the row is
   chosen or excluded, never created.
8. **Multi-event detection, mandatory before campaign setup.** A list that
   covers several events or assets becomes several campaigns, and the signals
   (dates, locations, event names) are checked even outside the obvious
   column.
9. **Memberships matched, or planned for creation.** On HubSpot: status
   lists, one per status per campaign, named by the grid's convention. On
   Salesforce: the campaign itself, matched by name or planned, and the
   grid's statuses for it, each matched against the campaign's existing
   member-status rows (a fresh campaign carries Sent and Responded,
   measured 2026-08-25) or planned as a create. Every lookup's answer is
   bound to its question by what the answer itself carries, the campaign
   lookup by its row's Name and the status read by its rows' CampaignId,
   so saved responses passed in the wrong order surface as questions
   rather than crediting one campaign with another's records. The lookups themselves,
   the campaign by name with its empty-result absent answer and a
   campaign's status rows, were measured on 2026-08-26. A Salesforce org
   whose Marketing User flag is off refuses campaign creation outright
   (measured 2026-08-25), so a plan that needs a campaign while the flag
   is off carries the one-call fix to the operator's own User record as
   its own named line, pushed before the campaign create and proved by
   reading the flag back, rather than dying mid-push. The fix's one call
   and the flag read-back are both measured. It is a write like
   any other: in the write contract, shown in the confirmation summary,
   executed only inside the approved plan. Striking the line from the plan
   strikes the campaign half with it, because the one cannot land without
   the other, and the run says so rather than pushing a plan that dies.
10. **The checkpoint, then the confirmation summary.** Before the plan is
    assembled the run stops and asks, in as many words: "Are there any
    other fields that we should be stamping for new or updated accounts
    and contacts?", showing the lead-source value or its absence as part
    of the question rather than as a settled fact. Sarah's correction of
    2026-08-26: the first acceptance run reported "no lead source
    configured" as if that settled it, and the unasked question was the
    miss. An answer naming a field the plugin can carry (its list fields
    plus persona, owner and the lead source on contacts, name and website
    on companies) becomes a config mapping or artifact edit on its own
    explicit yes; anything else is refused by name at the checkpoint,
    with the refusal said in the run's own report, because a stamp that
    silently cannot be written reads as written. The checkpoint asks a
    second question in the same breath, Sarah's rule of 2026-08-26:
    whether these contacts should carry a marketing status or an email
    opt-out. The import writes neither, on either backend, because those
    surfaces are unmeasured and deliberately outside the write contract;
    the question exists so nobody assumes the import set one, a yes is
    refused by name like any other uncarriable field, and the recorded
    ask is the demand that un-parks the opt-out measurement (see Open).
    The checkpoint is
    deliberately conversational, no command behind it: there is no
    request to send and no response to judge, and the gate, the payload
    builders and config's validation enforce the same field lists, so a
    field waved through in conversation still cannot reach a payload.
    Then the confirmation summary: the whole plan, company creates,
    adoption fills and associations, contact creates and updates,
    exclusions, the
    membership writes (list
    creates and memberships on HubSpot; campaign, member-status and
    campaign-member creates on Salesforce, with the Marketing User flag
    fix when the plan carries it),
    and the writeback the run will make to the source, shown in full, with
    an explicit yes before any push.
11. **Push, executing exactly the approved plan**, with partial-success
    semantics per record. A duplicate list add is a silent no-op and a
    duplicate contact create returns the existing id, both measured, both
    expected, and both folded into the report rather than treated as
    errors. Those are HubSpot's answers. Salesforce answers a duplicate
    campaign member with a hard individual error, `Already a campaign
    member.`, the existing row untouched (measured 2026-08-25), folded into
    the report the same way: the same partial-success expectation in the
    other store's spelling.
12. **Verify.** Every created or updated record is fetched back: a created
    record by the id the push returned, an updated one by the id the plan
    already carried. The read-back is compared field by field against the
    approved plan. An id is a locator, not a proof; the comparison is the
    proof, and it says what it did not check. The proof also binds every
    read-back to the record it was fetched for, a single record by the id
    it carries and a campaign-scoped read by its rows' CampaignId, and it
    refuses the malformed values the judges refuse, so a response saved
    under the wrong key, reused under two, or carrying a wordy number
    fails the proof instead of passing it. The one read that carries
    nothing to bind by is HubSpot's list membership envelope, record ids
    with no list identity, so the proof names that limit in its unchecked
    rather than vouching for a binding nothing carries.
13. **Writeback** when the source was Notion: link each created record on its
    source row, fill email only if blank. A writeback failure is reported and
    never fails the run, because the CRM is the system of record.

**What it does not do.**

- Never writes without the confirmation summary and an explicit yes.
- Never guesses a person, an owner, or a persona.
- Never overwrites a source-provided value, in the CRM or in the source.
- Never auto-resolves a duplicate or a cross-company conflict.
- Never pads a row to pass the floor or the required-fields rule. A row that
  cannot meet them is refused with the gap named.
- Never reads rows from anywhere but the one named source: no second list, no
  mailbox, no search. Beyond it, the run opens only the CRM it writes, the
  Process artifacts it follows, its own config, the alias map that config
  names, and, when the person says yes to enrichment, the connected tool
  that answers.
- Never sends email, and never posts anywhere. The reference posted summaries
  to chat; that is cut, because announcing is not the plugin's job and the
  default has to work for someone with nothing else connected. The run's own
  report is the record.
- Never runs unattended. Nothing schedules it.

**The judgment it carries.**

1. **Whether two records are the same person or the same company.** Shown as a
   match with its evidence, decided by the person. The alias map holds the
   answers already settled so they are not re-asked.
2. **Whether this is one campaign or several.** The multi-event check is
   mandatory because the expensive mistake is one campaign wrapped around
   three events, discovered after the memberships are written.
3. **Which membership each row lands on**, the status list on HubSpot and
   the member status on Salesforce, read from the grid and never
   from a built-in table. When the grid does not cover a row, that is a
   question, not a default.

---

## check

**What it does.** Says whether an import would work, before anyone is
mid-import, and what it would do. The standing half: the required artifacts
exist in Process, config points at its CRM and the credential resolves (on
HubSpot, a portal and the key file config names; on Salesforce, the org
alias the `sf` CLI answers for), and the connection is alive, proved by a
cheap read. On HubSpot, automatic company creation is called out as a
standing risk, permanently: the setting is not exposed by the documented
API surface, measured 2026-08-26, so calling it out is the whole of what
`check` can do about it. On Salesforce,
the user record's Marketing User flag is read and called out when it is
off, because campaign creation is refused until it is on; naming it is the
whole of `check`'s job here, and the measured one-call fix travels in
`run`'s plan as its own named line, like any other write. The
per-list half, only when handed a list: how many rows would be new, how many
match existing records, how many are ambiguous, and which rows fail the floor
or the required-fields rule, with the failing field named per row.

**When it runs.** Before the first import ever, after anything about the org's
rules changes, and before a big list where finding out mid-run would be
expensive.

**What it reads and writes.** Reads the config, the alias map, the Process
artifacts and the CRM, and reads a list only when handed one. **Writes nothing at all**,
anywhere, and never runs a paid step. The one exception is the first-run
config write both skills share, which happens only on an explicit yes.

**What it does not do.**

- Never fixes what it finds. A missing artifact is named, with `process:new`
  as the place it gets written. A dead connection is reported, not repaired.
- Never turns into the import. It hands its findings to `run` and stops.

**The judgment it carries.** Telling the kinds of not-ready apart: a row that
can never import (refused, with the gap named), a row that needs a person's
answer (ambiguous match, uncovered status), and a setup that is not ready at
all (missing artifact; no portal or key on HubSpot, no resolvable org alias
on Salesforce). Collapsing those into one number would make
the preview useless, so they are reported separately, the same distinction
the foundation's audit makes between empty and unknown.

---

## Why there is no enrichment skill

Enrichment providers ship their own plugins and skills, so a skill here that
just enriches would duplicate what the vendor maintains. The seam is the
enrichment step of `run`: the gaps are named, whatever is connected is offered
them, and the gate does the rest. A filled value names its source or it is
refused, and person fields stay empty whatever a tool claims. There is nothing
to configure, so there is nothing to be locked into, and someone with no
enrichment tool still gets a working import with its gaps named honestly.

---

## One CRM per install

HubSpot was v1's only backend, Sarah's call on 2026-08-25, made after both
stores were measured against real accounts the same day; the reasoning and
the reversal it contains are recorded in `DECISIONS.md`. Her ask of
2026-08-26 un-parked the Salesforce port, the backend rule's real request,
and this design now covers both backends. The one-store rule survives as
one CRM per install: config's `crm` field names the store, a run reads and
writes that store and no other, and nothing ships against two at once. The
Notion writeback is the one write outside the CRM on either backend, and
the writeback rules above govern it.

The port changes the store, not the pipeline. The order, the gates, the
write contract's floor, the enrichment seam, the config and artifact homes
and the skill names all carry over unchanged; what differs per backend is
said where it differs, and the measured sections below are the evidence
each half stands on. The port is built as of 2026-08-26 and its acceptance
run passed the same day: one real list end to end against a Developer
Edition org, every write proved by read-back and the org torn down to its
starting state, recorded in `DECISIONS.md`.

## Contacts and accounts, not leads

The port lands Contacts and Accounts, and the question that moved here with
the port is answered by the plugin's own floor: no contact is created
without its company matched or planned, and a Salesforce Lead is
companyless by design, a different object with its own conversion machinery
that nothing here has measured. Building the import on Leads would mean
either abandoning the company half of the floor or inventing a conversion
step the reference is not recorded as having, and the rebuild rule is to
change the least possible. A lead-based org's import is real work for a
user who asks, the same trigger the port itself waited on, and it is Open
rather than implied. So that such an org finds this decision at the door
rather than after an import, `run` confirms the record kind at scope,
Sarah's rule of 2026-08-26: the org's own Contact and Lead counts shown as
evidence on Salesforce, the plain question on HubSpot, and proceeding as
Contacts anyway is the person's deliberate, recorded choice.

## HubSpot, and what has actually been measured

The surface is the REST API with a Service Key as a bearer header, the
credential this platform version issues.

**Measured against a real portal, 2026-08-25**: every create proved by a
read-back, every refusal and no-op by its measured response, and the test
records archived afterwards with the archival confirmed. The measured set: contact and company creates; the contact-to-company association;
email uniqueness enforced by the portal, with the duplicate refusal
carrying the existing record's id; the portal auto-creating a company from
an email domain and taking the primary association; email validation
stricter than Salesforce's, refusing an address Salesforce accepted; manual
list create, member add, membership read-back, and a duplicate add as a
silent no-op; the search surface's IN filter; and a property cleared with
an empty string reading back empty. The raw measurement records live in the
local run files, outside this public repository; the dated summary is in
`DECISIONS.md`.

**Measured by the acceptance run, 2026-08-26**, the release gate's first
full pass, one ten-row list end to end with every write proved by
read-back and torn down cleanly: the list by-name lookup's not-found
answer (`OBJECT_NOT_FOUND`, `ListError.LIST_NAME_DOES_NOT_EXIST`); the
list create wrapping its `listId` in a `list` envelope; the association
PUT answering `COMPLETE` with both directions in `results`; the
membership add answering `recordsIdsAdded`; list deletion being soft, a
deleted list still answering GET 200 with `deletedAt` set, so a teardown
read-back checks that field and never expects a 404; the portal deriving
a created company's `domain` from the `website` the push set; and
auto-company-creation not firing when a company already carrying the
domain existed. The raw records stay in the local run files; the dated
summary is in `DECISIONS.md`.

**What is not measured**: subscription statuses (HubSpot's native email
opt-out surface), the marketing campaigns object, batch endpoints, and
rate limits at volume.

---

## Salesforce, and what has actually been measured

The surface is the `sf` CLI, the transport the reference ran on and the one
measured here. The credential lives in the CLI's keychain under the alias
config names and SOQL is the query surface, through the data commands.
The writes go through `sf api request rest` with a JSON body file, settled
by measurement on 2026-08-26: the data commands' `--values` parser refuses
a value carrying an apostrophe in either spelling, and names like O'Brien
are ordinary list data, so the values route cannot be the write transport.
A REST create answers the bare `{id, success, errors}` envelope; a REST
PATCH answers HTTP 204 with an empty body, so a read-back is its only
proof; a REST error arrives as an array of `{message, errorCode}` objects,
and the data commands' errors as `{name, message, exitCode}`, both judged
as measured.

**Measured against a free Developer Edition org, 2026-08-25**: every create
proved by a query read-back, and every test record deleted afterwards with
the deletions confirmed by count queries. The measured set: browser login
landing the credential in the CLI keychain; SOQL queries, including the IN
filter; Account creates with Name and Website; Contact creates with
FirstName, LastName, Email, Title and AccountId, which makes the company
association one field on the create rather than a second call; Campaign
creation refused with `entity type cannot be inserted: Campaign` until the
user record's Marketing User flag is on, and that flag settable through the
API with one User update; a fresh campaign carrying Sent and Responded as
its default member statuses; a custom CampaignMemberStatus created with one
plain call, where the reference needed Apex; a CampaignMember created with
a custom status, the read-back carrying the status's own HasResponded; a
duplicate CampaignMember failing individually with `Already a campaign
member.` and the existing row untouched; and per-record deletes confirmed
by count read-backs. The plain email opt-out field does not exist in a
fresh org at all, so it is org-dependent. The raw measurement records live
in the local run files, outside this public repository; the dated summary
and the transcribed measured set are in `DECISIONS.md`, so the
repository's own record carries every fact this section stands on.

**Measured by the build's own session, 2026-08-26**, closing the list the
design named as the build's to measure, every record created for it deleted
afterwards with the deletions confirmed by count queries: a partial update
changes only the named field, with every untouched field surviving, and its
response shape is `{id, success, errors}` under the data commands' wrapper;
an update to an occupied field overwrites silently, so the fill-blanks gate
is the only guard, the same standing HubSpot's PATCH has; `LIKE
'%<bare domain>%'` on `Website` finds a form stored as `https://www.`, an
exact `=` matches a bare-stored form, LIKE matches case-insensitively, and
`_` is a wildcard, so a domain pattern over-fetches at worst and the
candidates are judged by the person; the campaign-by-name lookup returns
the row, and an absent name answers an empty result set rather than an
error; the member-status read returns Label, SortOrder, IsDefault and
HasResponded per row; the Marketing User flag reads back through SOQL on
the User record, for a list and for the operator's own id; a dotted
`Account.Name` select arrives nested under `Account`; and an unknown field
on a create refuses with `INVALID_FIELD` naming the column, nothing
created. The raw captures live in the local run files; the dated summary
is in `DECISIONS.md`.

**Measured by the acceptance run, 2026-08-26**, the release gate's first
full pass on this backend, one ten-row invented list end to end with every
write proved by read-back and torn down cleanly: a state/country-picklist
org refusing the plain `MailingState` and `MailingCountry` fields with
`FIELD_INTEGRITY_EXCEPTION`, and the code fields (`MailingStateCode`,
`MailingCountryCode`) accepting the ISO codes a list carries, echoing them
back exactly and deriving the label fields, so a picklist org maps the
code fields in config; the org's own standard duplicate rule, active in a
fresh Developer Edition org, refusing a deliberate same-person create with
`DUPLICATES_DETECTED` while letting distinct people through; and a
campaign delete cascading its member rows as well as its member-status
rows, confirmed by count read-backs. The raw records stay in the local run
files; the dated record is in `DECISIONS.md`.

**Measured by the follow-up session, 2026-08-26**, before the first-run
probe and the scope confirmation were built on them: a query naming a
column the org does not carry refuses with the data commands' error shape,
`name` INVALID_FIELD and the message naming the column, in both measured
spellings ("No such column ..." from a bare select, "Invalid field: ..."
from an aggregate), which is what lets the mailing-fields probe tell a
plain org from a picklist org; and a named aggregate
(`SELECT COUNT(Id) contacts FROM Contact`) answers one AggregateResult
row whose alias key carries the count, so the answer carries its question
and a saved file can be bound to the read that produced it. The raw
captures live in the local run files; the dated record is in
`DECISIONS.md`.

**What is not measured**: the full behaviour of org-configured duplicate
rules (the acceptance run observed the standard rule fire once, and email
uniqueness is still treated as absent rather than as a backstop); the
Lead object entirely; batch semantics against the per-record route; and
what a free org limits at volume. All four stay out of the port's scope
rather than being half-measured. The release gate, the acceptance run
itself, passed on 2026-08-26 and is recorded in `DECISIONS.md`.

---

## Open

1. **The email opt-out, and the marketing status beside it.** HubSpot's
   marketing-contact status and its subscription statuses are separate,
   unmeasured surfaces, and Salesforce's plain opt-out field is
   org-dependent, measured absent from a fresh Developer Edition org, so
   neither is in the write contract until a measurement session says how
   each behaves. As of 2026-08-26 the checkpoint asks about them by name,
   Sarah's rule, so the demand that un-parks the measurement arrives as a
   recorded answer instead of a silent assumption.
2. **A lead-based import.** Out of the port deliberately, per the Contacts
   and accounts section: the Lead object is unmeasured and companyless by
   design, and it waits for a user who asks for it, the backend rule's own
   trigger. As of 2026-08-26 the run confirms the record kind at scope, so
   that user finds the decision at the door.

Settled, with the answers where they now live:

- **Whether HubSpot's auto-company-creation setting can be read from the
  API**: no, measured 2026-08-26. The documented account-info endpoint
  carries no object automation settings and the API reference exposes no
  settings endpoint for it, so `check` names the behaviour as a standing
  risk permanently rather than checking it. The matching half was already
  answered on 2026-08-26, when the company search gained the domain half
  beside the name; an org's own automation stays unmeasured rather than
  assumed absent on Salesforce.
- **The Salesforce port's acceptance run**, the release gate: passed
  2026-08-26, one ten-row invented list end to end against a Developer
  Edition org, nineteen writes, a 52-check field-by-field proof with no
  problems, teardown confirmed by count read-backs. The dated record,
  including the two org behaviours the run surfaced (state and country
  picklists, and the active standard duplicate rule), is in
  `DECISIONS.md`.
- **The config-comment sweep** was the build's recorded first task and the
  build did it first; the deferral, its expiry and the sweep are dated in
  `DECISIONS.md`.
- **The alias map's shape**: `{"aliases": {"variant": "canonical"}}`, a
  variant matching case-insensitively with whitespace collapsed and nothing
  looser, because anything looser is a judgment about whether two names are
  one company, which stays with the person. Defined in the plugin's
  `scripts/rules.js` and README. Settled against fixtures, not yet against a
  real list; the live run is where it meets one.
- **What `check` says without the foundation**: the standing half runs
  everything of this plugin's own (config, key file, alias map, probe) and
  reports the Process artifacts as unreachable rather than missing, because
  those are different answers. The line is drawn in `check`'s SKILL.md.

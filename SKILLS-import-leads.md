# import-leads: what each skill does

Part 3 for `import-leads`, the first job plugin: what each skill does, in the
same slots as the other skill files. What it does, when it runs, what it
reads and writes, what it does not do, and the judgment it carries.

This plugin owns no database and no schema file. A job plugin is named for its
job, and this one's job is taking a lead list from wherever it lives and landing
it in the CRM correctly. It reads the source list, its own config and the alias
map that config names, reads its judgment from Process artifacts, and reads and
writes HubSpot.

Written 2026-08-25. The plugin and skill names are Sarah's, confirmed the same
day: the tier-2 placeholder name `list-building` is retired, because this
imports lists rather than builds them, and the old name stays free for a plugin
that actually builds lists.

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

- **Config holds identifiers.** The portal, the property-name map, file
  paths.
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
only: the portal, the property-name map including any custom properties the
org wants filled (a LinkedIn URL property, a persona property), where the
Service Key lives (never the key itself, per the credentials rule above), and
the path to the company alias map. The alias map
itself is a user-owned file at a configurable path, the same pattern as the
artifact-type taxonomy, so a team can keep it in a repo and change it by pull
request.

**This plugin writes its own config, once, with confirmation.** On a first run
with no config, either skill stops, says what it needs (the portal, the
property names, where the key lives, the alias-map path), searches for what
it can find rather than asking
anyone to type what it could look up, shows what it will record, and writes
the file on an explicit yes. The foundation's config stays `setup`'s alone;
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
   day. The Salesforce port maps this same grid onto native member statuses
   instead, which is part of why the grid lives in Process rather than in
   code.
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
fields it fills, the same rule `SKILLS-projects.md` follows. This section is
the one home for that list.

**The floor, this plugin's own:** a row without a first and last name is
refused, and no contact is pushed without its company matched or planned.
From the list: first name, last name, email, phone, title, city, state and
country, and a LinkedIn URL where the org maps a property for it. From the
flow: the company association; membership of the status lists the grid
names; the lead-source value from the required-fields artifact; the owner,
only through routing or explicit confirmation; persona, only when the
personas artifact exists. On a company the flow creates rather than matches:
the name, and the website when the list carries a domain, because that is
what makes the next import's matching better. The email opt-out is not in
the contract yet: HubSpot's native opt-out lives in subscription statuses, a
separate surface nothing here has measured, and it is Open rather than
implied.

Anything more comes from the org's own required-fields artifact. A row that
cannot meet the rule is refused with the gap named, never padded.

---

## run

**What it does.** Takes one named list and lands the approved rows in
HubSpot: cleaned, deduped, matched to companies, on the status lists the
grid names, verified by reading the writes back, and, when the
source is a Notion page or database, written back to the source. A CSV source
is never modified.

**When it runs.** A lead list arrives: a conference follow-up, a content-
download export, a vendor handoff, a spreadsheet somebody kept.

**What it reads and writes.** Reads the one source the user named, a CSV file
or a Notion page or database, never a search. Reads HubSpot to match
companies and contacts, showing what it found for confirmation rather than
asking anyone to type what it could look up. Reads the Process artifacts
above, its own config, and the alias map that config names. Writes what the
approved plan names and nothing else: contact creates and updates, company
creates and associations, list creates and memberships, and the writeback
to a Notion source, into blank fields only. All of it sits behind one
confirmation.

**The pipeline, kept from the reference in order. Everything before the
confirmation plans; the push and the writeback after it are the only writes,
and both execute only what the approved plan names.**

1. **Scope.** One named source. The scope gate refuses rather than narrows,
   because there is no approval gate in front of a read: half a scope is
   refused as hard as none, and a source nobody named is never read.
2. **Map and normalise columns**, preserving the source's own column names for
   the writeback.
3. **Enrich, blanks only.** Gaps are named, and whatever enrichment the
   session actually has connected is offered the gaps. The plugin carries no
   enrichment vendor code at all; providers ship their own plugins, and this
   plugin's side is the gate. Paid verification runs only on a named yes.
4. **Personas**, only when the artifact exists. Unclear titles are flagged,
   never guessed.
5. **Company names normalised** against the alias map.
6. **Companies matched, or planned for creation.** A planned company carries
   its name and, when the list has a domain, its website. HubSpot itself
   auto-creates companies from email domains and takes the primary
   association (measured 2026-08-25), so the plan names that collision
   rather than letting it happen silently; what `run` ultimately does about
   the portal's behaviour is deliberately Open, not guessed here.
7. **Dedupe against the CRM**, by email, through the search surface, and
   each row gets its plan: create, update filling blanks only, or exclude.
   HubSpot also enforces email uniqueness itself, and a duplicate create is
   refused carrying the existing record's id (measured 2026-08-25), so a
   duplicate that slips past the search cannot become a second record: the
   push reports the refusal with that id, and does not improvise an update
   nobody approved.
   Duplicates and cross-company conflicts are always presented, never
   auto-resolved.
8. **Multi-event detection, mandatory before campaign setup.** A list that
   covers several events or assets becomes several campaigns, and the signals
   (dates, locations, event names) are checked even outside the obvious
   column.
9. **Status lists matched, or planned for creation**, one per status per
   campaign, named by the grid's convention.
10. **The confirmation summary**: the whole plan, company creates, contact
    creates and updates, exclusions, list creates and memberships, and the
    writeback the run will make to the source, shown in full, with an
    explicit yes before any push.
11. **Push, executing exactly the approved plan**, with partial-success
    semantics per record. A duplicate list add is a silent no-op and a
    duplicate contact create returns the existing id, both measured, both
    expected, and both folded into the report rather than treated as
    errors.
12. **Verify.** Every created or updated record is fetched back by the id the
    push returned, and the read-back is compared field by field against the
    approved plan. An id is a locator, not a proof; the comparison is the
    proof, and it says what it did not check.
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
3. **Which status list each row lands on**, read from the grid and never
   from a built-in table. When the grid does not cover a row, that is a
   question, not a default.

---

## check

**What it does.** Says whether an import would work, before anyone is
mid-import, and what it would do. The standing half: the required artifacts
exist in Process, config points at a portal and the key it names resolves,
and the connection is alive. Automatic company creation is called out as a
standing risk; whether the setting itself can be read from the API is
unmeasured, and is part of the Open item on that behaviour. The
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
all (missing artifact, no portal or key). Collapsing those into one number would make
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

## HubSpot, and what has actually been measured

HubSpot is the only CRM backend in v1, Sarah's call on 2026-08-25, made
after both stores were measured against real accounts the same day; the
reasoning and the reversal it contains are recorded in `DECISIONS.md`. The
one-store rule holds: v1 ships one CRM, and the Salesforce port is Open
work rather than a half-adapter. The Notion writeback is the one write
outside the CRM, and the writeback rules above govern it. The surface is
the REST API with a Service Key as a bearer header, the credential this
platform version issues.

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

**What is not measured**: subscription statuses (HubSpot's native email
opt-out surface), the marketing campaigns object, batch endpoints, and
rate limits at volume. The live acceptance run of the whole pipeline end
to end is still the release gate, the same rule `calendar` set: this
plugin is not finished until it has run one real list through every step
against a portal, verified the writes by reading them back, and been torn
down cleanly.

---

## Open

1. **The Salesforce port.** The reference's home, and it gets native member
   statuses back in place of status lists, driven by the same grid
   artifact. Its surface is already measured: the Salesforce CLI ran
   against a free Developer Edition org on 2026-08-25 (creates, custom
   member statuses without Apex, duplicate members failing individually,
   the Marketing User flag trap and its one-call fix, the opt-out field
   being org-dependent), so the port is specified work waiting on a user
   who asks for it, per the backend rule. The contacts-versus-leads
   question moves with it.
2. **What `run` does about automatic company creation.** `check` names the
   risk; whether the setting itself can be read from the API is unmeasured
   and part of this item, and whether `run` should ask for it off, or adopt
   the portal's auto-created companies into its matching, needs the build's
   first real list rather than a guess here.
3. **The email opt-out.** HubSpot's subscription statuses are a separate,
   unmeasured surface, so the opt-out is out of the write contract until a
   measurement session says how it behaves.

Settled by the build, with the answers where they now live:

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

# import-leads

Takes a lead list from wherever it lives and lands it in the CRM correctly.

The first job plugin of the `gtm-operator` marketplace. A job plugin is named
for its job rather than for a database: this one owns no database and no
schema file, reads no foundation config, and keeps a private config of its
own, which nothing else reads or writes. One CRM per install, HubSpot or
Salesforce, named by config's `crm`; the Notion writeback is the one write
outside the CRM on either backend.

## What it is for

A lead list arrives: a conference follow-up, a content-download export, a
vendor handoff, a spreadsheet somebody kept. `run` takes that one named list
and lands the approved rows in the CRM, planned end to end and pushed only
after an explicit yes, then verifies every write by reading it back. `check`
says whether an import would work before anyone is mid-import, and writes
nothing.

## The skills

| Skill | What it does |
|---|---|
| `run` | One named list into the CRM: mapped, deduped, matched to companies, on the memberships the grid names (status lists on HubSpot, native member statuses on Salesforce), verified by read-backs, written back to a Notion source. One confirmation gate in front of every write |
| `check` | The standing half: config, the credential (the key file on HubSpot, the org alias on Salesforce), alias map, connection, artifacts, and on Salesforce the Marketing User flag. The per-list half, only when handed a list: what would import, what is refused with the gap named, and what needs a person |

## Where the judgment lives

Identifiers sit in this plugin's own config at
`~/.claude/import-leads.config.json`. A `crm` field names the backend, and
an absent one reads as `hubspot`. On HubSpot: the portal, the property-name
map, and where the Service Key lives (never the key itself). On Salesforce:
the org alias the `sf` CLI keychain holds the credential under (nothing
key-shaped exists on that backend), the field-name map in the org's own API
names, and any record-type ids. Both name the path to the
company alias map. The plugin writes that file once, with confirmation, on a
first run, and nothing else writes it.

The organisation's rules are Process artifacts, read at run time: the
required-fields rule, the campaign member-status grid, and optionally
personas and routing. A missing required artifact is named, with
`process:new` as the place it gets written; nothing here invents a fallback.

The alias map is a user-owned JSON file, `{"aliases": {"variant":
"canonical"}}`, holding the company-name answers already settled so they are
not re-asked.

## What is not proved

Read this before trusting any of it.

The pipeline's own logic (ingest, mapping, gates, dedupe verdicts, the
multi-event signals, plan assembly, request building and response judging) is
covered by the fixture suites in `tests/`. Each backend's release gate is one
real list run end to end with every write proved by read-back and the store
torn down to its starting state. **HubSpot's gate has passed twice**: the
acceptance run of 2026-08-26 and a second run the same day on the corrected
pipeline, both recorded in `DECISIONS.md`. **Salesforce's gate has passed**:
the acceptance run of 2026-08-26 against a Developer Edition org, nineteen
writes, a field-by-field proof of every one, and a teardown confirmed by
count read-backs, recorded in `DECISIONS.md` beside the two org behaviours
the run surfaced (state and country picklists refusing the plain mailing
fields, and the org's active standard duplicate rule).

Unmeasured and deliberately open: whether HubSpot's auto-company-creation
setting can be read from the API (the matching half was answered on
2026-08-26, when the company search gained the domain half beside the name);
the email opt-out (HubSpot's subscription statuses are a separate surface,
and Salesforce's plain field is org-dependent); batch surfaces and rate
limits at volume on both backends; the Lead object entirely; and the full
behaviour of org-configured Salesforce duplicate rules, which is why the
dedupe search is the whole guard there (the acceptance run observed the
standard rule refuse one deliberate same-person create, recorded in
`DECISIONS.md`).

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
first run, and nothing else writes it. On a salesforce first run the draft
asks the org which state and country fields it carries, two read-only
queries with one measured verdict per field, and refuses to assemble
without the judged pair: a picklist org refuses the plain mailing fields'
values, and a column an org does not carry is refused by name (both
branches measured 2026-08-26).

The organisation's rules are Process artifacts, read at run time: the
required-fields rule, the campaign member-status grid, and optionally
personas and routing. A missing required artifact is named, with
`process:new` as the place it gets written; nothing here invents a fallback.

The alias map is a user-owned JSON file, `{"aliases": {"variant":
"canonical"}}`, holding the company-name answers already settled so they are
not re-asked.

## Connectors

Notion is required. Clay, Lusha, Apollo and ZoomInfo are packaged as
enrichment connectors so they show in the plugin's Connectors tab; any one is
enough and none is required, and the enrichment step offers the gaps to
whichever is connected. HubSpot and Salesforce are reached through the Service
Key file and the `sf` CLI rather than through a connector, for the reasons in
`CONNECTORS.md`. On Salesforce, `check` says when the `sf` CLI is missing and
hands over the install and login commands.

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

Unmeasured and deliberately open: the email opt-out and HubSpot's
marketing-contact status (the run's checkpoint asks about both by name and
writes neither until a measurement session says how each surface behaves);
batch surfaces and rate limits at volume on both backends; the Lead object
entirely (the run confirms at scope that Contacts are what the org works
in, with the org's own Contact and Lead counts as evidence on Salesforce);
and the full behaviour of org-configured Salesforce duplicate rules, which
is why the dedupe search is the whole guard there (the acceptance run
observed the standard rule refuse one deliberate same-person create,
recorded in `DECISIONS.md`). Measured and closed, 2026-08-26: HubSpot's
auto-company-creation setting is not exposed by the documented API, so
`check` names that behaviour as a standing risk permanently rather than
checking it.

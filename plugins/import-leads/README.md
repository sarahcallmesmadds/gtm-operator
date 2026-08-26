# import-leads

Takes a lead list from wherever it lives and lands it in the CRM correctly.

The first job plugin of the `gtm-operator` marketplace. A job plugin is named
for its job rather than for a database: this one owns no database and no
schema file, reads no foundation config, and keeps a private config of its
own, which nothing else reads or writes. HubSpot is the only CRM backend in
v1; the Notion writeback is the one write outside it.

## What it is for

A lead list arrives: a conference follow-up, a content-download export, a
vendor handoff, a spreadsheet somebody kept. `run` takes that one named list
and lands the approved rows in HubSpot, planned end to end and pushed only
after an explicit yes, then verifies every write by reading it back. `check`
says whether an import would work before anyone is mid-import, and writes
nothing.

## The skills

| Skill | What it does |
|---|---|
| `run` | One named list into HubSpot: mapped, deduped, matched to companies, on the status lists the grid names, verified by read-backs, written back to a Notion source. One confirmation gate in front of every write |
| `check` | The standing half: config, key file, alias map, connection, artifacts. The per-list half, only when handed a list: what would import, what is refused with the gap named, and what needs a person |

## Where the judgment lives

Identifiers sit in this plugin's own config at
`~/.claude/import-leads.config.json`: the portal, the property-name map,
where the Service Key lives (never the key itself), and the path to the
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
covered by the fixture suites in `tests/`. The live surface is not: the
request shapes are rebuilt from the 2026-08-25 portal measurements, and the
release gate is one real list run end to end against a portal, verified by
read-backs and torn down cleanly. Until that run is recorded in
`DECISIONS.md`, this plugin has not been watched doing its job.

Unmeasured and deliberately open: what `run` does about the portal
auto-creating companies from email domains, the email opt-out (HubSpot's
subscription statuses are a separate surface), batch endpoints, rate limits
at volume, and the company search surface.

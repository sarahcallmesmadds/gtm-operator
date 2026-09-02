---
name: check
description: Say whether an import would work before anyone is mid-import, and what it would do. Use when the user asks "are we set up to import", "would this list import cleanly", "check this list", before the first import ever, after the org's rules change, or before a big list where finding out mid-run would be expensive. Reads config, the alias map, the Process artifacts and the CRM, and a list only when handed one. Writes nothing, and never runs a paid step.
allowed-tools: Read, Write, Bash(node:*), Bash(curl:*), Bash(sf:*), mcp__*__notion-fetch, mcp__*__notion-query-data-sources
---

# check

Whether an import would work, and what it would do, before anyone is
mid-import.

**This skill writes nothing at all, anywhere, and never runs a paid step.**
The one exception in the whole plugin is the first-run config write both
skills share, which happens only on an explicit yes.

## How this skill works

The same command layer as `run`:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/import-leads.js" <command> <args>
```

Requests are sent the way `run` sends them: on HubSpot with the Service Key
as a bearer read from the file config names, never printed and never
pasted; on Salesforce through the `sf` CLI, whose keychain holds the
credential under the alias the specs carry. Every request this
skill sends is a read.

## The standing half: is the setup ready at all

Run `check-standing`. It reports, in one pass. **On Salesforce, run
`sf --version` before anything else in this half**, because every
Salesforce request below goes through that CLI, the mailing-fields probe on
a first run included. When the command is not found, the org cannot be
reached from this machine at all, which is a different finding from a wrong
alias: report it under **Not ready at all**, hand over the two commands that
fix it, `npm install -g @salesforce/cli` and then
`sf org login web --alias <the alias config names>`, and mark only the
Salesforce-dependent checks as not checked (the org display, the probe, the
Marketing User flag, and the mailing-fields probe on a first run). The rest
of this half does not need the CLI and still runs: the config file, the
alias map, the enrichment connectors and the Process artifacts. The plugin
does not run the install itself; installing a command-line tool is the
person's call on their own machine. HubSpot needs no tool installed: the
Service Key file is the whole credential.

- **Config**: readable, or the refusal naming what is wrong. No config means
  a first run: gather the answers, `config-draft`, show the whole draft, and
  `config-write` only on an explicit yes. On salesforce, run
  `mailing-fields-probe <orgAlias>` and `mailing-fields-judge` first, two
  read-only queries with one measured verdict per code field, and pass the
  judged pair as the draft's `mailingFields`, which it refuses to assemble
  without (a picklist org refuses the plain fields' values; a plain org
  lacks the code fields; measured 2026-08-26).
- **The credential, per backend.** On HubSpot, the Service Key file exists
  and is not empty, at the path config names, its contents never read into
  any output. On Salesforce there is nothing key-shaped to check: the org
  alias is resolved instead, by sending the emitted org display spec and
  running `org-judge` on the saved response.
- **Which enrichment connector is connected.** The plugin packages `clay`,
  `lusha`, `apollo` and `zoominfo` so they appear in its Connectors tab.
  Say which of them, or which other enrichment tool, the session actually
  has. None connected is a fact to report, not a failure: `run` still works
  with its gaps named.
- **The alias map**: exists and parses, or what is wrong with it.
- **The probe**: a single read-only request. Send it and run `probe-judge` on
  the saved response. A connection is alive when the store answered with the
  measured envelope, and nothing more is claimed: a credential working for
  reads says nothing about writes, which only the live run proves.
- **On Salesforce, the Marketing User flag.** Read it with `flag-query` and
  `flag-judge` (whoami first, the flag read second) and call it out when it
  is off, because campaign creation is refused until it is on. Naming it is
  the whole of this skill's job; the measured one-call fix travels in
  `run`'s plan as its own named line.
- **Automatic company creation.** On HubSpot, named as a standing risk: the
  portal can auto-create a company from an email domain and take the primary
  association, and the setting is not exposed by the documented API surface
  (measured 2026-08-26: the account-info endpoint carries no object
  automation settings, and no settings endpoint for it exists in the API
  reference), so it is called out, not checked, permanently. On Salesforce
  nothing like it was observed and an org's own automation stays unmeasured
  rather than assumed absent.

Then the artifacts: read the required-fields rule and the member-status grid
from the Process library, and run `validate-rules` on what was read, with the
personas artifact when it exists. **A missing required artifact is named, not
worked around**: say which artifact is missing and that `process:new` is
where it gets written. This skill never fixes what it finds, and a dead
connection is reported, not repaired.

If the foundation is not installed at all, the standing half still runs
everything above except the artifact reads, and says so: config, key, alias
map and probe are this plugin's own, and the artifacts are reported as
unreachable rather than missing, because those are different answers.

## The per-list half, only when handed a list

Never go looking for a list. When one is named:

1. `ingest` (or `ingest-notion`), with the mapping confirmed the same way
   `run` confirms it.
2. `aliases`, then `gate` with the required-fields rule: which rows fail the
   floor or the org's rule, with the failing field named per row.
3. `dedupe-queries` and `dedupe`: how many rows would be new, how many match
   existing records, and which are ambiguous.
4. `personas`, only when the artifact exists: which titles come back flagged
   for review. Skip the step without complaint when there is no artifact,
   and then do not promise persona findings the report never computed.

Report the kinds of not-ready separately, because collapsing them into one
number would make the preview useless:

- **Refused**: rows that can never import as they are, each with the gap
  named.
- **Needs a person**: ambiguous matches, in-list duplicates, cross-company
  conflicts, rows with no email (unknown is not new), and titles the
  personas artifact does not cover.
- **Not ready at all**: a missing artifact, a config refusal, a dead
  connection.

## What this skill does not do

- Never fixes what it finds.
- Never turns into the import. It hands its findings to `run` and stops.
- Never runs a paid step, and never sends anything but reads.
- Never reads a list nobody named.

## The judgment this skill carries

Telling the kinds of not-ready apart. A row that can never import, a row that
needs a person's answer, and a setup that is not ready at all are three
different findings, reported separately, the same distinction the
foundation's audit makes between empty and unknown.

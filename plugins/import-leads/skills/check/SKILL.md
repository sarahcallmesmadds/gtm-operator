---
name: check
description: Say whether an import would work before anyone is mid-import, and what it would do. Use when the user asks "are we set up to import", "would this list import cleanly", "check this list", before the first import ever, after the org's rules change, or before a big list where finding out mid-run would be expensive. Reads config, the alias map, the Process artifacts and the CRM, and a list only when handed one. Writes nothing, and never runs a paid step.
allowed-tools: Read, Write, Bash(node:*), Bash(curl:*), mcp__*__notion-fetch, mcp__*__notion-query-data-sources
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

Requests are sent the same way, with the Service Key as a bearer read from
the file config names, never printed and never pasted. Every request this
skill sends is a read.

## The standing half: is the setup ready at all

Run `check-standing`. It reports, in one pass:

- **Config**: readable, or the refusal naming what is wrong. No config means
  a first run: gather the answers, `config-draft`, show the whole draft, and
  `config-write` only on an explicit yes.
- **The Service Key file**: exists and is not empty, at the path config
  names. Its contents are never read into any output.
- **The alias map**: exists and parses, or what is wrong with it.
- **The probe**: a single read-only request. Send it and run `probe-judge` on
  the saved response. A connection is alive when the portal answered with the
  measured envelope, and nothing more is claimed: the key working for reads
  says nothing about writes, which only the live run proves.
- **Automatic company creation**, named as a standing risk. The portal can
  auto-create a company from an email domain and take the primary
  association. Whether the setting is readable from the API is unmeasured, so
  this is called out, not checked.

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

# Connectors

`process` declares every connector it can use directly in `.mcp.json`. They
populate the plugin's Connectors tab; each optional source can be connected or
left off independently.

| Connector | Role | Required |
|---|---|---|
| Notion | Reads and maintains the Process library created by `setup` | Yes |
| Atlassian | Optional document source for Confluence material during `backfill` | No |
| Google Drive | Optional document source during `backfill` | No |
| Slack | Optional channel and specifically named DM source during `backfill` | No |
| Gmail | Optional source for the connected user's own mailbox during `backfill` | No |
| Google Calendar | Optional source for recurring meetings, operating cadence, attendees, and event descriptions | No |
| Granola | Optional raw meeting-transcript source during `backfill` | No |
| Gong | Optional call-transcript source during `backfill`; see the hosted-MCP limitation below | No |
| HubSpot | Optional CRM source for accounts, deals, and activity history | No |
| Salesforce | Optional read-only CRM source through Salesforce's SObject Reads server | No |
| Stripe | Optional billing and payment-history source | No |
| Ramp | Optional spend, vendor, procurement, and expense-history source | No |

## Read-only use inside Process

Several of these servers expose write-capable tools. Process does not use them.
The maintainer may search and read within an approved scope, but it never sends
Slack messages or email, changes calendar events or CRM records, creates Stripe
objects, initiates payments, approves Ramp work, moves money, or changes cards.
The user's existing account permissions still apply.

Gong is the packaged call source, but its hosted MCP currently returns answers
derived from calls rather than raw transcript text. Treat those answers as
transcript-derived evidence and say so in Coverage. If the task requires raw
transcript text and no Gong API or export surface is connected, list Gong as
unavailable for that part of the sweep. Never cite transcript passages the
connector did not return.

Google Workspace's hosted MCP servers are in Developer Preview and may require
an administrator to enable the APIs and OAuth client. Salesforce requires an
administrator to activate the SObject Reads MCP server and configure Claude's
OAuth callback. Missing optional sources narrow a sweep; they do not block the
rest of the Process library.

## Recommended local CLI setup

The cloud plugin cannot install software on a user's computer. For Claude Code
installations that should keep searching when a hosted connector is unavailable,
install and authenticate these vendor CLIs during local setup:

- Salesforce CLI (`sf`) for read-only `sf data query ... --json` commands.
- Ramp CLI for read-only search and export commands.

These CLIs are recommended local fallbacks, not cloud-plugin prerequisites. Ask
which org or account to read before using one. Never create, update, delete,
deploy, approve, pay, transfer, or change credentials through a CLI.

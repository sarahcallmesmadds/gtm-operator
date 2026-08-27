# Connectors

`projects` declares these connectors in `.mcp.json`:

| Connector | Role | Required |
|---|---|---|
| Notion | Reads and writes Projects, Tasks, Memos and related Process artifacts | Yes |
| Granola | Optional meeting source for `problem-scan` | No |
| Gong | Optional call-derived evidence for `problem-scan` | No |
| Slack | Optional internal conversation evidence for `problem-scan` | No |
| Gmail | Optional evidence from the user's own mailbox for `problem-scan` | No |
| HubSpot | Optional account, deal and activity context | No |
| Salesforce | Optional read-only account, opportunity, case and activity context | No |
| Outreach | Optional sequence, task, prospect and meeting context | No |
| Intercom | Optional customer conversation, contact and support context | No |
| Pylon | Optional customer issue, account, contact and conversation context | No |

All nine optional connectors are context sources only. The plugin never posts,
sends, creates, updates, deletes, assigns, labels, archives or changes a record
in any of them. Notion remains its only write destination.

`problem-scan` agrees the scope before reading: a date range for every source;
named Slack channels and individual direct-message conversations; the user's
own mailbox; one call recorder per pass; CRM providers and object families;
named Outreach activity; and named Intercom or Pylon accounts, conversations or
issues. An incomplete scope reads nothing.

Gong's hosted MCP returns answers derived from calls and emails rather than raw
transcript text. Label that evidence transcript-derived and report raw text as
unavailable unless a separate API or export surface returned it. Intercom's MCP
currently supports US-hosted workspaces. Outreach requires its MCP server to be
enabled for an eligible licensed user. Pylon requires OAuth and a Member or
Admin seat. These are optional sources, so an unavailable service is reported
as not read rather than treated as a failed project scan.

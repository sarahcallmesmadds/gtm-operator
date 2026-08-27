# Connectors

`software` declares these connectors in `.mcp.json`:

| Connector | Role | Required |
|---|---|---|
| Notion | Reads and maintains the Software directory created by `setup` | Yes |
| Box | Optional contract-folder source for `backfill` | No |
| Google Drive | Optional named contract-folder source for `backfill` | No |
| Gmail | Optional evidence from the user's own mailbox for `backfill` | No |
| Ramp | Optional card, transaction and vendor-payment evidence for `backfill` | No |
| QuickBooks | Optional bill, vendor and payment evidence for `backfill`; the official hosted MCP currently requires Intuit partner-pilot onboarding | No |
| DocuSign | Optional signed-agreement and contract-term source for `backfill` | No |
| Slack | Optional bounded workflow context used to establish business consequence and support `Importance` | No |

The folder source is always one folder the user names, never a whole Box or
Drive. Gmail is always read-only and bounded to the authenticated user's own
mailbox plus a date range. Ramp, QuickBooks and DocuSign reads name the account
and date range. Slack reads name channels or direct-message conversations and a
date range; direct messages are never all.

All seven optional connectors are evidence sources only. The plugin never
sends, drafts, labels, archives, moves or marks email; posts or reacts in Slack;
creates, approves or pays through Ramp or QuickBooks; sends, signs, edits, voids
or triggers a DocuSign workflow; or writes to Box or Google Drive. Notion is the
only write destination.

QuickBooks uses Intuit's production hosted endpoint, but that server is still a
limited-availability pilot. It requires partner onboarding, an Intuit App ID,
IP allowlisting and MCP scopes provisioned with an Intuit Solution Engineer. If
the account is not onboarded, `backfill` reports QuickBooks under `notReading`
instead of falling back to an unofficial connector. DocuSign's official MCP is
an open beta and exposes write-capable workflows, which this plugin deliberately
does not use.

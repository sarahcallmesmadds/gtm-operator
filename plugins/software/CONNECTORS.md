# Connectors

`software` declares these connectors in `.mcp.json`:

| Connector | Role | Required |
|---|---|---|
| Notion | Reads and maintains the Software directory created by `setup`; `evaluate` uses query and fetch only | Yes |
| Box | Optional named contract-folder evidence for `backfill` and `evaluate` | No |
| Google Drive | Optional named contract-folder, proposal, security, or implementation evidence | No |
| Gmail | Optional evidence from the user's own mailbox for `backfill` and `evaluate` | No |
| Ramp | Optional card, transaction and vendor-payment evidence | No |
| QuickBooks | Optional bill, vendor and payment evidence; the official hosted MCP currently requires Intuit partner-pilot onboarding | No |
| DocuSign | Optional signed-agreement and contract-term evidence | No |
| Slack | Optional bounded workflow context and internal experience | No |
| Google Calendar | Optional vendor and internal meeting metadata for `evaluate`; metadata does not prove what was said | No |
| Granola | Optional notes or transcripts from approved vendor and internal meetings | No |
| Gong | Optional transcript-derived evidence from approved calls; its hosted MCP does not establish raw transcript coverage | No |

The folder source is always one folder the user names, never a whole Box or
Drive. Gmail is always read-only and bounded to the authenticated user's own
mailbox plus a date range. Ramp, QuickBooks and DocuSign reads name the account
and date range. Slack reads name channels or direct-message conversations and a
date range; direct messages are never all. Calendar, Granola and Gong reads name
the meetings or calls and their date range.

Optional connectors are evidence sources only. The plugin never
sends, drafts, labels, archives, moves or marks email; posts or reacts in Slack;
creates, approves or pays through Ramp or QuickBooks; sends, signs, edits, voids
or triggers a DocuSign workflow; changes calendar data; contacts a vendor; or
writes to Box or Google Drive. Existing Software skills may write to Notion
through their own confirmation gates. `evaluate` is read-only everywhere,
including Notion.

QuickBooks uses Intuit's production hosted endpoint, but that server is still a
limited-availability pilot. It requires partner onboarding, an Intuit App ID,
IP allowlisting and MCP scopes provisioned with an Intuit Solution Engineer. If
the account is not onboarded, `backfill` reports QuickBooks under `notReading`
instead of falling back to an unofficial connector. DocuSign's official MCP is
an open beta and exposes write-capable workflows, which this plugin deliberately
does not use. Gong evidence is labeled transcript-derived unless a separate
approved surface actually returned raw transcript text.

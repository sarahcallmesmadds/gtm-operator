# Connectors

`software` declares these connectors in `.mcp.json`:

| Connector | Role | Required |
|---|---|---|
| Notion | Reads and maintains the Software directory created by `setup` | Yes |
| Box | Optional contract-folder source for `backfill` | No |
| Google Drive | Optional named contract-folder source for `backfill` | No |
| Gmail | Optional evidence from the user's own mailbox for `backfill` | No |

The folder source is always one folder the user names, never a whole Box or
Drive. Gmail is always read-only and bounded to the authenticated user's own
mailbox plus a date range. The plugin never sends, drafts, labels, archives,
moves or marks email, and it never writes to Box or Drive.

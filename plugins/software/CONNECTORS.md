# Connectors

`software` declares these connectors in `.mcp.json`:

| Connector | Role | Required |
|---|---|---|
| Notion | Reads and maintains the Software directory created by `setup` | Yes |
| Box | Optional contract-folder source for `backfill` | No |

`backfill` can also use a named Google Drive folder and the user's own email
when those connections already exist in Claude. They are not declared here
because this plugin does not ship their OAuth client configuration. Email is
always read-only in this plugin.

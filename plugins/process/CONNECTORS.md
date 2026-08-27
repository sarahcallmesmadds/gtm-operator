# Connectors

`process` declares the connectors it can use directly in `.mcp.json`:

| Connector | Role | Required |
|---|---|---|
| Notion | Reads and maintains the Process library created by `setup` | Yes |
| Atlassian | Optional document source for Confluence material during `backfill` | No |
| Box | Optional document source during `backfill` | No |
| Gong | Optional call-transcript source during `backfill` | No |
| Granola | Optional meeting-transcript source during `backfill` | No |

`backfill` can also use Google Drive, Slack and the user's own email when those
connections already exist in Claude. They are not declared here because this
plugin does not ship the OAuth client configuration those services require.
Missing optional sources narrow a sweep; they do not block the rest of the
Process library.

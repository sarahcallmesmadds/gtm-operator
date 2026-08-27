# Connectors

`projects` declares these connectors in `.mcp.json`:

| Connector | Role | Required |
|---|---|---|
| Notion | Reads and writes Projects, Tasks, Memos and related Process artifacts | Yes |
| Gong | Optional call source for `problem-scan` | No |
| Granola | Optional meeting source for `problem-scan` | No |

`problem-scan` can also read Slack and the user's own email when those
connections already exist in Claude. They are not declared here because this
plugin does not ship their OAuth client configuration. The plugin never posts
to Slack or sends email.

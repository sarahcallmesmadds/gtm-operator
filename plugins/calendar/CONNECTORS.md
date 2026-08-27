# Connectors

`calendar` declares one connector in `.mcp.json`:

| Connector | Role | Required |
|---|---|---|
| Notion | Reads and writes the Calendar database created by `setup` | Yes |

The plugin does not send email, publish content or create calendar events in an
external calendar service. Those are deliberately outside this version.

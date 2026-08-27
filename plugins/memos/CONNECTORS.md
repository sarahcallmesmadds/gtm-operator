# Connectors

`memos` declares these connectors in `.mcp.json`:

| Connector | Role | Required |
|---|---|---|
| Notion | Reads and writes Memos and, when approved, meeting actions in Tasks | Yes |
| Gong | Optional call transcript for `meeting-notes` | No |
| Granola | Optional meeting transcript for `meeting-notes` | No |

`meeting-notes` also accepts notes or transcripts the user provides directly,
so a call recorder is optional.

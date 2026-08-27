# Connectors

`memos` declares these connectors in `.mcp.json`:

| Connector | Role | Required |
|---|---|---|
| Notion | Reads and writes Memos and, when approved, meeting actions in Tasks | Yes |
| Granola | Optional meeting transcript for `meeting-notes` | No |
| Gong | Optional transcript-derived call source for `meeting-notes`; raw transcript text needs a separate API or export surface | No |
| Slack | Optional, explicitly named thread or bounded channel context for a memo | No |
| Gmail | Optional, explicitly named thread or bounded search in the user's own mailbox | No |

`meeting-notes` also accepts notes or transcripts the user provides directly,
so a call recorder is optional. Gong is treated as the transcript source, but
its hosted MCP returns transcript-derived answers rather than raw transcript
text, and the output says so.

Slack and Gmail are context sources, never delivery channels. The plugin uses
only their search and read tools. It never posts or reacts in Slack, and never
sends, drafts, labels, archives, moves or marks email. A Slack search names the
channels and date range, and direct messages are read only when the user names
the conversation. A Gmail search stays in the authenticated user's own mailbox
and carries a date range. A refused or incomplete scope reads nothing.

# Connectors

`import-leads` declares five connectors in `.mcp.json`:

| Connector | Role | Required |
|---|---|---|
| Notion | Reads Process rules and a Notion source, then writes approved CRM results back to that source | Yes |
| Clay | Enrichment: fills blanks and looks up work emails at the enrichment step of `run`, on a named yes | One of the four is enough, and none is required |
| Lusha | Enrichment, the same seam | As above |
| Apollo | Enrichment, the same seam | As above |
| ZoomInfo | Enrichment, the same seam | As above |

The four enrichment connectors are packaged so they show in the plugin's
Connectors tab and can be authorised from there. The plugin carries no vendor
code for any of them: the enrichment step names the gaps, offers them to
whichever of these the session has connected, and gates every paid lookup
behind a named yes. An enrichment tool that is not on this list but is already
connected to the session is offered the same way. With nothing connected the
import still runs, with its gaps named. The `run` skill pre-approves the
four servers' tools by read-shaped names only (search, enrich, match,
lookup, find, get); a call outside those names asks the person first.

One known snag, unverified here: Clay's OAuth server has been reported to
refuse a client that registers under a name containing "Claude" (the error
reads "Client name must not impersonate a known platform"). If authorising
Clay from the Connectors tab fails that way, the Clay connector already
available in Claude's own connector directory is the same server, and a local
`mcp-remote` bridge is the other reported route.

HubSpot and Salesforce are deliberately not plugin MCP connectors. Every CRM
request is built by the plugin's script as a spec, sent as a plain HTTP call
(HubSpot, with the Service Key file the plugin config names) or through the
authenticated `sf` CLI (Salesforce, under the org alias the config names), and
judged from the raw saved response. That is how every write is read back and
proved field by field, which a connector's own tools do not let the plugin do.
Declaring either connector would ask a user to authorise a service the skills
never call. `check` confirms the credential before an import, and on Salesforce
it also confirms the `sf` CLI is installed and hands over the install and login
commands when it is not. Nothing key-shaped is stored in this repository.

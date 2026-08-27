# Connectors

`import-leads` declares one connector in `.mcp.json`:

| Connector | Role | Required |
|---|---|---|
| Notion | Reads Process rules and a Notion source, then writes approved CRM results back to that source | Yes |

HubSpot and Salesforce are not plugin MCP connectors in this version. HubSpot
requests use the Service Key file the plugin config names. Salesforce requests
use the authenticated `sf` CLI org alias. The plugin checks those credentials
before an import and never stores either one in the repository.

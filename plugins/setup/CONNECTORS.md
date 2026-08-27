# Connectors

`setup` declares one connector in `.mcp.json`:

| Connector | Role | Required |
|---|---|---|
| Notion | Creates, relates, verifies and repairs the foundation databases | Yes |

The connection must be able to create pages and databases, update data sources,
create views, query data sources and read workspace users. A read-only Notion
connection is not enough.

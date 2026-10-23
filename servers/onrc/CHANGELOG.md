# @foreverworks/mcp-onrc

## 0.1.0

The first release. Romania's trade register portal for one signed-in account: the filings made there and their status, a filing's documents, the fee notes and the invoices. You grant the session once, in the browser you already use for the portal.

Everything it does at ONRC is a read; its `write` tools only hold the session: `begin_login`, `complete_login` and `logout`. Nothing here files anything or moves money: no tool is `money`.

It speaks MCP protocol revisions 2026-07-28 and 2025-11-25, over stdio and loopback HTTP, and lists the same tools to both. `begin_login` offers the sign-in page through your client where the client supports URL elicitation, and puts the link in the result where it does not.

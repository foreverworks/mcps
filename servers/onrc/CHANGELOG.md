# @foreverworks/mcp-onrc

## 1.0.0

The first release. Romania's trade register portal for one signed-in account: the filings made there and their status, a filing's documents, the fee notes and the invoices. You grant the session once, in the browser you already use for the portal.

Everything it does at ONRC is a read; its `write` tools only hold the session: `begin_login`, `complete_login` and `logout`. Nothing here files anything or moves money: no tool is `money`.

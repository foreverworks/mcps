# @foreverworks/mcp-etoll

## 0.1.0

The first release. Romania's road vignette (rovinietă) on an eToll account: each car's vignette and the days it has left, the vignettes and bridge passes bought, the invoices and their PDFs, eToll's notifications, and CNAIR's public status page. It signs in with your eToll password from a file or a vault MCP server, or once through your browser.

It can buy a vignette: `quote_vignette` prices every duration, and `place_order`, its one `money` tool, places the order after you confirm one line and hands over eToll's card payment page on euplatesc.ro, where you pay yourself. `get_order` says when it is paid; `cancel_order` (a `write`) drops an unpaid order. Signing in through the browser takes `begin_login` and `complete_login`, and `logout` ends the session; the three are `write` too.

It is an unofficial client of the API the eToll portal uses, so it is `experimental`: eToll can change that API without notice, and a tool can then fail until the server is updated.

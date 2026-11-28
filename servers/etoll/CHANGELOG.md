# @foreverworks/mcp-etoll

## 0.1.2

### Patch Changes

- d672e23: `MCP_EGRESS_ALLOW` now reaches every request the Bolt Food and Glovo servers make. Before, it did not reach them at all: the list is put on `globalThis.fetch` when the server starts to serve, but these two servers build their API clients first and the clients kept the `fetch` that existed then, so a deployment that set the variable believed it was fenced and was not. The Home Assistant REST client and the sign-out call of the eToll and ONRC servers kept the unguarded `fetch` the same way. Home Assistant already refused an instance host that was not on the list before any request; what is new there is that the guard itself now enforces the list on every request its REST client makes. A request to a host outside the list now fails before a connection is made, as the variable has always said, and is not retried. An IPv6 address in the list matches with or without brackets. Only the address a request starts at is checked: a redirect is still followed wherever it points, and the docs now say so.
  
  mcp-kit adds `liveFetch`, the global `fetch` looked up at every call: hold it wherever a fetch is kept as a value, never `fetch` itself, and the guard applies whenever it was installed. It adds `guardEgress(env)`, which puts the list in force; `serve` calls it, and an entry point that builds anything before it serves calls it first. Installing the list a second time replaces the first instead of stacking on it. The receipts package's `runServer` does this before it builds a server's dependencies, through a new `startServer` that `runServer` is now built on. A test holds the shipped code to the rule: no source file keeps the global `fetch` as a value.
  
  A deployment that sets `MCP_EGRESS_ALLOW` on these servers must now list the hosts they call: `deliveryuser.live.boltsvc.net` for Bolt Food, `api.glovoapp.com` for Glovo, and the host of the Home Assistant instance. The `--health` check of the Bolt Food and Glovo servers now runs under the same list, so a host missing from it fails the check instead of every tool call.
- Updated dependencies [d672e23]
- Updated dependencies [8f76786]
- Updated dependencies [ca27413]
- Updated dependencies [e68c576]
- Updated dependencies [6f9174c]
- Updated dependencies [579dbca]
  - @foreverworks/mcp-kit@0.4.0

## 0.1.1

### Patch Changes

- 40a1580: `ETOLL_VAULT_ARGS` that are not JSON are reported as such without repeating their first 80 characters, which could hold a vault session or token.
- Updated dependencies [a1340a4]
  - @foreverworks/mcp-kit@0.3.1

## 0.1.0

The first release. Romania's road vignette (rovinietă) on an eToll account: each car's vignette and the days it has left, the vignettes and bridge passes bought, the invoices and their PDFs, eToll's notifications, and CNAIR's public status page. It signs in with your eToll password from a file or a vault MCP server, or once through your browser.

It can buy a vignette: `quote_vignette` prices every duration, and `place_order`, its one `money` tool, places the order after you confirm one line and hands over eToll's card payment page on euplatesc.ro, where you pay yourself. `get_order` says when it is paid; `cancel_order` (a `write`) drops an unpaid order. Signing in through the browser takes `begin_login` and `complete_login`, and `logout` ends the session; the three are `write` too.

It is an unofficial client of the API the eToll portal uses, so it is `experimental`: eToll can change that API without notice, and a tool can then fail until the server is updated.

# @foreverworks/mcp-onrc

## 0.1.4

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

## 0.1.3

### Patch Changes

- c132159: The server's instructions, which your client hands the model at the start of every session, are about half as long, so every session costs less. They now say what the server reaches, the tool to start with, the flows that run across tools, and what the model must know before its first call (what spends money, sends, publishes or acts on something in a home, and what to do when a sign-in is needed). What a tool's own description already says is left to it. Nothing a tool does changes.
  
  porkbun: the vendor's paragraph on publishing a site is now one sentence, and `deploy_site`'s description carries its checks, adding that `list_hosting_files` shows what is already there before an upload replaces it.
- Updated dependencies [75ea94a]
- Updated dependencies [0834240]
- Updated dependencies [64969a3]
- Updated dependencies [4ef1bf8]
- Updated dependencies [7b93f2f]
- Updated dependencies [27f0094]
  - @foreverworks/mcp-kit@0.3.0

## 0.1.2

### Patch Changes

- ad0d6fc: No change to the server. This version is the first published by the repository's release workflow through npm's trusted publishing, with no npm token anywhere; `npm view` names GitHub Actions as its publisher.

## 0.1.1

### Patch Changes

- Updated dependencies [2447a0d]
- Updated dependencies [db52a0b]
  - @foreverworks/mcp-kit@0.2.0

## 0.1.0

The first release. Romania's trade register portal for one signed-in account: the filings made there and their status, a filing's documents, the fee notes and the invoices. You grant the session once, in the browser you already use for the portal.

Everything it does at ONRC is a read; its `write` tools only hold the session: `begin_login`, `complete_login` and `logout`. Nothing here files anything or moves money: no tool is `money`.

It speaks MCP protocol revisions 2026-07-28 and 2025-11-25, over stdio and loopback HTTP, and lists the same tools to both. `begin_login` offers the sign-in page through your client where the client supports URL elicitation, and puts the link in the result where it does not.

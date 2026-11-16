---
"@foreverworks/mcp-kit": minor
"@foreverworks/receipts": patch
"@foreverworks/mcp-bolt-food": patch
"@foreverworks/mcp-glovo": patch
"@foreverworks/mcp-home-assistant": patch
"@foreverworks/mcp-onrc": patch
"@foreverworks/mcp-etoll": patch
"@foreverworks/mcp-anaf-spv": patch
---

`MCP_EGRESS_ALLOW` now reaches every request the Bolt Food and Glovo servers make. Before, it did not reach them at all: the list is put on `globalThis.fetch` when the server starts to serve, but these two servers build their API clients first and the clients kept the `fetch` that existed then, so a deployment that set the variable believed it was fenced and was not. The Home Assistant REST client and the sign-out call of the eToll and ONRC servers kept the unguarded `fetch` the same way. Home Assistant already refused an instance host that was not on the list before any request; what is new there is that the guard itself now enforces the list on every request its REST client makes. A request to a host outside the list now fails before a connection is made, as the variable has always said, and is not retried. An IPv6 address in the list matches with or without brackets. Only the address a request starts at is checked: a redirect is still followed wherever it points, and the docs now say so.

mcp-kit adds `liveFetch`, the global `fetch` looked up at every call: hold it wherever a fetch is kept as a value, never `fetch` itself, and the guard applies whenever it was installed. It adds `guardEgress(env)`, which puts the list in force; `serve` calls it, and an entry point that builds anything before it serves calls it first. Installing the list a second time replaces the first instead of stacking on it. The receipts package's `runServer` does this before it builds a server's dependencies, through a new `startServer` that `runServer` is now built on. A test holds the shipped code to the rule: no source file keeps the global `fetch` as a value.

A deployment that sets `MCP_EGRESS_ALLOW` on these servers must now list the hosts they call: `deliveryuser.live.boltsvc.net` for Bolt Food, `api.glovoapp.com` for Glovo, and the host of the Home Assistant instance. The `--health` check of the Bolt Food and Glovo servers now runs under the same list, so a host missing from it fails the check instead of every tool call.

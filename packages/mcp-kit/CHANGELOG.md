# @foreverworks/mcp-kit

## 0.1.0

The first release. The toolkit every server here is built on: stdio and loopback HTTP transports with a token per client, a guard that classifies every tool `read`, `write` or `money` and turns that into annotations, limits, an audit line per call and a confirmation for money, the result envelope with structured content and links to saved files, progress and cancellation, an HTTP stack that never resends a write whose outcome is unknown, exact decimal arithmetic, and files read in by path and saved out with their SHA-256.

It is built on the MCP SDK v2 and is the only package here that names it: a server takes `McpServer`, `Client` and the transports from the kit. It serves protocol revisions 2026-07-28 and 2025-11-25 with the same tools. With `MCP_CONFIRM=elicit` it asks the person to confirm a money call before it runs, over stdio or for a 2026-07-28 client over HTTP; a client that cannot be asked is refused the call. `offerLink` offers a sign-in link through the client as a URL elicitation, and the link stays in the result where the client cannot show it. Tests connect with `connectInMemory` and answer the server's questions with `elicitingClient` or `confirmingClient`.

# @foreverworks/mcp-kit

## 0.2.0

### Minor Changes

- 2447a0d: `run` starts a program with no shell, a deadline and capped output, for a server that drives a command-line tool. The program leads a process group of its own and the deadline kills the whole group, so a tool's own children (ocrmypdf's tesseract, ssh's proxy command) cannot keep the call waiting past it. `truncated` says when output went past the cap and was cut, and a program killed by a signal other than the deadline's answers 128 plus the signal's number.

### Patch Changes

- db52a0b: The MCP SDK moves to `@modelcontextprotocol/server` and `client` 2.4.0 and `@modelcontextprotocol/node` 2.1.2, the first release of its HTTP transport that accepts `@hono/node-server` 2.x. The lock takes 2.1.5, past GHSA-rmxm-3fg6-px4f (a second decoding of a static path in `serveStatic`, which no server here serves). Tools and their arguments are unchanged.

## 0.1.0

The first release. The toolkit every server here is built on: stdio and loopback HTTP transports with a token per client, a guard that classifies every tool `read`, `write` or `money` and turns that into annotations, limits, an audit line per call and a confirmation for money, the result envelope with structured content and links to saved files, progress and cancellation, an HTTP stack that never resends a write whose outcome is unknown, exact decimal arithmetic, and files read in by path and saved out with their SHA-256.

It is built on the MCP SDK v2 and is the only package here that names it: a server takes `McpServer`, `Client` and the transports from the kit. It serves protocol revisions 2026-07-28 and 2025-11-25 with the same tools. With `MCP_CONFIRM=elicit` it asks the person to confirm a money call before it runs, over stdio or for a 2026-07-28 client over HTTP; a client that cannot be asked is refused the call. `offerLink` offers a sign-in link through the client as a URL elicitation, and the link stays in the result where the client cannot show it. A server for several products can load only some of them: `toolsetsFrom` reads a `<SERVER>_TOOLSETS` list (unset or `all` loads every one, an unknown name stops the start) and `toolsetPolicy` gives the policy of those loaded. Tests connect with `connectInMemory` and answer the server's questions with `elicitingClient` or `confirmingClient`.

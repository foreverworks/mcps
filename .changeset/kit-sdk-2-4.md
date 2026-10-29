---
"@foreverworks/mcp-kit": patch
---

The MCP SDK moves to `@modelcontextprotocol/server` and `client` 2.4.0 and `@modelcontextprotocol/node` 2.1.2, the first release of its HTTP transport that accepts `@hono/node-server` 2.x. The lock takes 2.1.5, past GHSA-rmxm-3fg6-px4f (a second decoding of a static path in `serveStatic`, which no server here serves). Tools and their arguments are unchanged.

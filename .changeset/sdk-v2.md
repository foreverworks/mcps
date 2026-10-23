---
"@foreverworks/mcp-kit": major
"@foreverworks/receipts": minor
"@foreverworks/mcp-anaf-efactura": minor
"@foreverworks/mcp-anaf-spv": minor
"@foreverworks/mcp-app-stores": minor
"@foreverworks/mcp-bitwarden": minor
"@foreverworks/mcp-bnr": minor
"@foreverworks/mcp-bolt-food": minor
"@foreverworks/mcp-devices": minor
"@foreverworks/mcp-eas": minor
"@foreverworks/mcp-enable-banking": minor
"@foreverworks/mcp-glovo": minor
"@foreverworks/mcp-google": minor
"@foreverworks/mcp-notion": minor
"@foreverworks/mcp-oblio": minor
"@foreverworks/mcp-onrc": minor
"@foreverworks/mcp-porkbun": minor
"@foreverworks/mcp-printer": minor
"@foreverworks/mcp-trademarks": minor
"@foreverworks/mcp-typesafe": minor
---

Every server now speaks MCP protocol 2026-07-28 as well as 2025-11-25, over stdio and HTTP, and lists the same tools to both. Nothing to change in your client: one that speaks the new revision (Claude Code does) uses it, and one that does not is served as before, a plain JSON answer included.

What you may notice:

- `MCP_CONFIRM=elicit` now works over HTTP for a client of protocol 2026-07-28: the server asks you to confirm a money call before it runs. A 2025-11-25 client over HTTP cannot be asked, so such a call is refused there instead of the server refusing to start. Sign-in links (`begin_consent`, `begin_login`, `begin_authorization`) are offered by such a client too.
- Tool schemas are JSON Schema 2020-12 (they were draft-07). The tools, their arguments and their descriptions are unchanged.
- Calling a tool the server does not have is now a protocol error, as the MCP specification has it, not a result with `isError`.
- For a client of protocol 2026-07-28, which no longer shares its folders as roots, files are read from `MCP_FILE_ROOTS` or the working directory.

No tool changed its access class.

For server authors, the kit is on SDK v2 (`@modelcontextprotocol/server`, `/client`, `/node` 2.3) and is now the only package that names it: take `McpServer`, `Client` and the transports from `@foreverworks/mcp-kit`. A tool's handler gets the SDK's v2 context in place of `extra`. `guardSettingsFrom` takes only the environment. Tests connect with `connectInMemory` and answer questions with `elicitingClient` or `confirmingClient`, each for either protocol generation.

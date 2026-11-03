---
"@foreverworks/mcp-kit": minor
---

A server whose tools only read public data can now be served to anyone, with no sign-in, at a public HTTPS address: ChatGPT, Claude and other clients connect to it by its URL alone. Set `MCP_HTTP_PUBLIC_HOSTS` to the host names your reverse proxy forwards (`rates.example.com`) instead of a token setting, and `MCP_HTTP_CLIENT_IP_HEADER` to the header the proxy puts each caller's address in (`cf-connecting-ip`, `x-forwarded-for`), so each address gets its own rate limit. The server still listens on `127.0.0.1`; TLS and anything static belong to the proxy.

It refuses to start if any `write` or `money` tool could run there, unless `MCP_MAX_ACCESS=read` refuses every call to them. It also refuses tokens or `MCP_FILE_ROOTS` beside it. Audit lines name every such caller `public`, never an address. Nothing changes for a server with tokens; see docs/configuration.md, "A public server, with no sign-in".

A smoke script run with `MCP_URL` and no `MCP_TOKEN_FILE` now connects without a token, so it can check a public server.

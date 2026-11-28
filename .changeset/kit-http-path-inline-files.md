---
"@foreverworks/mcp-kit": minor
---

`MCP_HTTP_PATH` sets the one path the HTTP listener answers `POST` on, `/mcp` by default, so a proxy can give each server its own path on one host (`/bnr`, `/ecb`). It must start with a slash and have no trailing one; any other value stops the start. Any other path still gets a 404, and a `GET` on its own path a 405.

`handInline(name, bytes)` hands a file back inside a tool's result, as embedded content (its text for XML, JSON and the like, else base64) with its type from the name, for a server with no outbox its callers can read. `embeddedFile` builds the same content.

---
"@foreverworks/mcp-relay": patch
---

A client the server holds to a ceiling (`MCP_CLIENT_MAX_ACCESS`) is refused the server's file endpoints, because a file crosses outside the tool calls that ceiling checks. For such a client the relay does not send a file a call names (the call is not made) and does not fetch a file a result links, and it says so in words about the ceiling, not as a refused token: `the upstream does not carry files for alice (403): its calls are limited by a ceiling ...`. A 403 from a file endpoint no longer sends anyone to the upstream token file. A client with no ceiling moves files as before.

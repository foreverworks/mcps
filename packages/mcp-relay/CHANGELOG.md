# @foreverworks/mcp-relay

## 0.1.0

The first release. A relay that stands in, on a client's machine, for an MCP server that runs on another, so that the tools which take a file from an inbox folder or hand one back in an outbox folder keep working. It listens like the server does (the same route, bearer tokens and `Host` check), forwards `POST`, `GET` and `DELETE` on `/mcp` with its own token to the server, uploads the inbox files a `tools/call` names by absolute path before the call goes, and fetches the outbox files a result links with a `file:` URI before the result is passed on, each checked by its SHA-256 and written whole or not at all. A stream stays a stream. `MCP_SERVER=relay` starts it from the container image.

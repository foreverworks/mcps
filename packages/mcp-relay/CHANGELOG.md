# @foreverworks/mcp-relay

## 0.1.2

### Patch Changes

- a1340a4: A client the server holds to a ceiling (`MCP_CLIENT_MAX_ACCESS`) is refused the server's file endpoints, because a file crosses outside the tool calls that ceiling checks. For such a client the relay does not send a file a call names (the call is not made) and does not fetch a file a result links, and it says so in words about the ceiling, not as a refused token: `the upstream does not carry files for alice (403): its calls are limited by a ceiling ...`. A 403 from a file endpoint no longer sends anyone to the upstream token file. A client with no ceiling moves files as before.
- Updated dependencies [a1340a4]
  - @foreverworks/mcp-kit@0.3.1

## 0.1.1

### Patch Changes

- Updated dependencies [75ea94a]
- Updated dependencies [0834240]
- Updated dependencies [64969a3]
- Updated dependencies [4ef1bf8]
- Updated dependencies [7b93f2f]
- Updated dependencies [27f0094]
  - @foreverworks/mcp-kit@0.3.0

## 0.1.0

The first release. A relay that stands in, on a client's machine, for an MCP server that runs on another, so that the tools which take a file from an inbox folder or hand one back in an outbox folder keep working. It listens like the server does (the same route, bearer tokens and `Host` check), forwards `POST`, `GET` and `DELETE` on `/mcp` with its own token to the server, uploads the inbox files a `tools/call` names by absolute path before the call goes, and fetches the outbox files a result links with a `file:` URI before the result is passed on, each checked by its SHA-256 and written whole or not at all. A stream stays a stream, and what the relay passes on is the text it was written as: it adds a note or removes a call without writing the rest again. A plain `http://` upstream on another host is refused unless `MCP_RELAY_ALLOW_PLAIN_HTTP=1` says the network is encrypted already. `MCP_SERVER=relay` starts it from the container image.

The relay presents the server a token for each of its clients, or one for all. `MCP_RELAY_UPSTREAM_TOKENS_DIR` is a folder with an `upstream-<client>` file for each client the relay accepts (`upstream-default` for a relay with one client token), so a call, a stream and the files moved for a client go to the server under that client's token only, and the server's `MCP_CLIENT_MAX_ACCESS` and audit line see the client that really called. The relay refuses to start when an accepted client has no usable file there, when a token has whitespace or a control character inside it, when a client's name cannot be a file name, or when two clients would present the same token; the message names the clients and never a token. `MCP_RELAY_UPSTREAM_TOKEN_FILE` stays for clients that may share one token and rights, and the relay warns at start when it has more than one client; setting both is refused.

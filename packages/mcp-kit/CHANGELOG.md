# @foreverworks/mcp-kit

## 0.3.1

### Patch Changes

- a1340a4: A client held to a ceiling (`MCP_CLIENT_MAX_ACCESS`) is now refused both file endpoints, `GET /files/outbox/<path>` and `PUT /files/inbox/<path>`, with a 403 and a plain sentence that says why: its calls are limited by a ceiling, and files cross outside the tool calls that ceiling checks, so the endpoints are for clients with none. Before, any client with a valid token could put a file into the server's inbox or fetch any file in its outbox, including one another client's calls had produced, however low its ceiling was. A client is held by an entry of its own, at any class (`money` too); `MCP_MAX_ACCESS` alone changes nothing here. The refusal is the first answer, before the path or the method is looked at, so it is the same whether a file is there or not and says nothing of what the folders hold; a body it refuses is read and thrown away, never stored. A client with no entry is served as before, and a request with no valid token is still a 401. There is no new setting. See docs/configuration.md, "Files to and from another machine".

## 0.3.0

### Minor Changes

- 75ea94a: A server can now listen on an address other than `127.0.0.1`, so one that runs in a container can be reached over a private network on a published port. `MCP_HTTP_HOST` is the address to bind (`0.0.0.0` for every IPv4 interface, `::` for every interface, or one interface's address), and `MCP_HTTP_ALLOWED_HOSTS` the `Host` values the server answers besides `127.0.0.1:<port>` and `localhost:<port>`: `name` for that name on any port, `name:port` for one port. It works with bearer tokens, which are still required, and any other `Host` still gets a 421.
  
  A bind address that is not a loopback one is refused at startup unless `MCP_HTTP_ALLOWED_HOSTS` (or `MCP_HTTP_PUBLIC_HOSTS`) names who the listener is for, and either variable without `MCP_HTTP_PORT` stops the start. With neither set nothing changes: the server binds `127.0.0.1` and answers the same two `Host` names. See docs/configuration.md, "A server in a container".
- 64969a3: A server that runs on another machine than its clients can now carry the files its tools take and hand back, through two routes of its HTTP listener. `MCP_HTTP_FILES_OUTBOX` (a folder) switches on `GET /files/outbox/<path>`, which streams a regular file below it with its `Content-Length`, `Content-Type` and `X-Content-SHA256`; `MCP_HTTP_FILES_INBOX` switches on `PUT /files/inbox/<path>`, which writes a file below it, whole or not at all, refuses bytes that do not match an `X-Content-SHA256` it was sent, and answers with the file's path, size and SHA-256. `MCP_HTTP_FILES_MAX_BYTES` (256 MiB by default) caps an upload.
  
  Both are off unless set, each for its own direction: a server with neither answers `/files/...` as it answers any route it does not have. When set, a request needs the same bearer token and `Host` as `/mcp`, and may only name a regular file whose real path is inside the folder; every way a path can fail (an unsafe name, a missing file, a link out, a folder, a file the server cannot read) is the same bare 404. What else an upload is told is about the request: 400 for a malformed `X-Content-SHA256`, 405 for the other method, 409 when a folder is where the file would go, 413 over the size cap and 422 for bytes that are not the ones hashed. A refused or broken upload leaves no file and takes away the folders it made. A server open to anyone (`MCP_HTTP_PUBLIC_HOSTS`) refuses to start with either variable set, and so does a server without `MCP_HTTP_PORT`.
  
  With an inbox on, Node's 30 s limit on a request's arrival, which would cut a large upload short and cannot be lifted for one route, is replaced by limits where each request is known: a refusal made before a body is read closes the connection, the body of `POST /mcp` has 30 s (or `MCP_HTTP_TIMEOUT_MS`, if less), and an upload that has signed in may not go quiet for a minute nor take longer than `MCP_HTTP_TIMEOUT_MS`. With no inbox the timeout is as it was.
  
  One thing changes for a server with none of these variables set: a request target that no URL parser takes (`//` is one) now gets a 404, where it raised an unhandled error that ended the server process. An error raised anywhere else while a request is answered is likewise a 500 now. Every other answer, the startup line and the defaults are as they were.
  
  The kit also exports what a relay needs (`FILES_OUTBOX_PATH`, `FILES_INBOX_PATH`, `SHA256_HEADER`, `filesUrlPath`, `folderFrom`, `storeStream`, `sha256OfHandle`, `openFileInside`, `folderInside`, `removeFolders`, `readRawBody`, `pathnameOf`, `plainReply`, `hostAccepted`). See docs/configuration.md, "Files to and from another machine".
- 4ef1bf8: `makeOAuthClient` adds `password(username, password, scope?)`, the resource owner password grant (RFC 6749 4.3), for an endpoint that offers it to its own public client. The eToll server signs in with it when a password is configured.
- 7b93f2f: A server whose tools only read public data can now be served to anyone, with no sign-in, at a public HTTPS address: ChatGPT, Claude and other clients connect to it by its URL alone. Set `MCP_HTTP_PUBLIC_HOSTS` to the host names your reverse proxy forwards (`rates.example.com`) instead of a token setting, and `MCP_HTTP_CLIENT_IP_HEADER` to the header the proxy puts each caller's address in (`cf-connecting-ip`, `x-forwarded-for`), so each address gets its own rate limit. The server still listens on `127.0.0.1`; TLS and anything static belong to the proxy.
  
  It refuses to start if any `write` or `money` tool could run there, unless `MCP_MAX_ACCESS=read` refuses every call to them. It also refuses tokens or `MCP_FILE_ROOTS` beside it. Audit lines name every such caller `public`, never an address. Nothing changes for a server with tokens; see docs/configuration.md, "A public server, with no sign-in".
  
  A smoke script run with `MCP_URL` and no `MCP_TOKEN_FILE` now connects without a token, so it can check a public server.
- 27f0094: Three pieces that servers had copied between them are now the kit's:
  
  - `storedFile(path, { schema, fromDisk, toDisk, corrupt?, lock? })` keeps one record (a session, a grant) in a JSON file of the state directory: checked against the server's own shape on disk at every read, written whole at 0600, and a file of the wrong shape either read as absent or reported through the server's `corrupt`.
  - `pendingAuthorizationFile(stateDir, name)` and `pendingPkceAuthorizationFile(stateDir, name)` keep the one begun authorization-code flow between the call that sends a person to the authorize page and the one that takes the address they land on.
  - `connectUpstream(endpoint, { name, client, fail })` makes a server the MCP client of another one, over Streamable HTTP or stdio, with `usingUpstream`, `fillTemplate` and `atPath` for a vault or mailbox tool the server does not know in advance. A tool that answers an error is a failure, through the server's `fail`; a failure of the server's own while the transport is made (a token file it cannot read) reaches its caller unchanged.

### Patch Changes

- 0834240: Every tool now states all four hints in `tools/list`: `destructiveHint` is `false` on a `read` tool and `true` on a `write` that does not say otherwise, where it used to be left out for the client's default. Nothing a tool may do changes. Directories that check the hints, such as OpenAI's plugin directory, find `readOnlyHint`, `destructiveHint` and `openWorldHint` on every tool.

## 0.2.1

### Patch Changes

- 2cf1e19: On Windows, a server's default state directory is `%APPDATA%\mcps\<server>` when `XDG_STATE_HOME` is not set, instead of `.local\state\mcps\<server>` in the user's profile. A server that already keeps state there finds it again with its `<SERVER>_STATE_DIR` variable, or once the folder is moved.

## 0.2.0

### Minor Changes

- 2447a0d: `run` starts a program with no shell, a deadline and capped output, for a server that drives a command-line tool. The program leads a process group of its own and the deadline kills the whole group, so a tool's own children (ocrmypdf's tesseract, ssh's proxy command) cannot keep the call waiting past it. `truncated` says when output went past the cap and was cut, and a program killed by a signal other than the deadline's answers 128 plus the signal's number.

### Patch Changes

- db52a0b: The MCP SDK moves to `@modelcontextprotocol/server` and `client` 2.4.0 and `@modelcontextprotocol/node` 2.1.2, the first release of its HTTP transport that accepts `@hono/node-server` 2.x. The lock takes 2.1.5, past GHSA-rmxm-3fg6-px4f (a second decoding of a static path in `serveStatic`, which no server here serves). Tools and their arguments are unchanged.

## 0.1.0

The first release. The toolkit every server here is built on: stdio and loopback HTTP transports with a token per client, a guard that classifies every tool `read`, `write` or `money` and turns that into annotations, limits, an audit line per call and a confirmation for money, the result envelope with structured content and links to saved files, progress and cancellation, an HTTP stack that never resends a write whose outcome is unknown, exact decimal arithmetic, and files read in by path and saved out with their SHA-256.

It is built on the MCP SDK v2 and is the only package here that names it: a server takes `McpServer`, `Client` and the transports from the kit. It serves protocol revisions 2026-07-28 and 2025-11-25 with the same tools. With `MCP_CONFIRM=elicit` it asks the person to confirm a money call before it runs, over stdio or for a 2026-07-28 client over HTTP; a client that cannot be asked is refused the call. `offerLink` offers a sign-in link through the client as a URL elicitation, and the link stays in the result where the client cannot show it. A server for several products can load only some of them: `toolsetsFrom` reads a `<SERVER>_TOOLSETS` list (unset or `all` loads every one, an unknown name stops the start) and `toolsetPolicy` gives the policy of those loaded. Tests connect with `connectInMemory` and answer the server's questions with `elicitingClient` or `confirmingClient`.

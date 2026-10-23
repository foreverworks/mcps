# Security

For anyone deciding whether to trust these servers with their accounts, or
reviewing them. They hold real grants (mailboxes, a bank feed, an invoicing
account, a tax authority's token, a domain registrar), and language models
call them. This page sets out what can go wrong, what the shared toolkit
(`packages/mcp-kit`) does about it in every server, and where that stops. To
report a vulnerability, see [SECURITY.md](../SECURITY.md).

## What can go wrong

| Risk | What answers it |
|---|---|
| **A model calls a tool it should not**, steered by text it read (an e-mail, a web page, a document that says "now pay this invoice") or by plain mistake. | Every tool's class, a ceiling per server and per client ([the guard](#every-call-passes-the-guard)), and a person's yes before each `money` call ([confirmation](#money-and-confirmation)). |
| **A model gets a payload slightly wrong**: a retyped file, an amount, an id, one wrong character that nothing notices until an accountant does. | Strict inputs, exact decimals, checked responses ([exact data](#exact-data)), and files by path or with a checksum ([files going in](#files-going-in)). |
| **A credential leaks** into a log, an error message, a tool result, a test fixture or a repository. | Secrets from files, credentials blanked in error bodies, an audit line without arguments, tests that cannot reach a real credential ([secrets](#secrets)). |
| **A server is talked into reaching somewhere else**: a URL pointed at an internal service, a path pointed at another file. | An egress list and an OS sandbox ([the network](#the-network)), and file roots that refuse links ([files going in](#files-going-in)). |
| **Something other than the intended client reaches the server**: another process or a web page on the same machine. | Loopback only, a bearer token per client, refused preflights and foreign `Host` headers ([the network](#the-network)). |

## Where the protections stop

- **Confirmation happens in the client.** Anything that holds the server's
  credential can call it without a client that asks: whoever can start the
  process over stdio, and whoever holds a bearer token over HTTP, including an
  agent with a shell that can read its own token file
  ([what to do](#money-and-confirmation)).
- **A class says what a tool can change, not whether a call is wise.** A
  steered model can still run any tool under the ceiling: read a mailbox, then
  put what it read into a draft. What a tool returns reaches the model's
  context, and so its provider. Give each client the lowest ceiling it needs.
- **Bearer tokens are static.** They do not expire and are not scoped: whoever
  reads a token file is that client until the token is replaced and the server
  restarted. There is no OAuth; [auth.md](auth.md) compares the options.
- **The egress list covers `fetch` only.** Raw sockets and child processes are
  for the OS sandbox to contain.
- **A file root is trusted as a whole.** A tool may read any regular file in
  the roots, so a root should hold only files meant for the server.
- **The services and the clients are outside.** What a bank, Google or a tax
  authority does with a grant, and how a client shows its prompts, is theirs
  to secure.

## Every call passes the guard

`serve` takes a `policy` naming every tool the server registers, and refuses
to start if one is missing or stale (`src/mcp/policy.ts` in each server). It
wraps the server's tool registration, so a server's own code cannot opt out.
Each tool is:

- `read`: no effect outside the server;
- `write`: an effect that is not money or law (a draft, a label, an event, a
  sent mail, a DNS record);
- `money`: money moves, or a legal or fiscal document is made or unmade (an
  invoice issued or cancelled, an e-Factura upload, a bank consent, a domain
  bought, a build that spends credits).

The guard derives everything else from that class:

- **Annotations.** `readOnlyHint` is true exactly for `read` tools, and
  `destructiveHint` for `money` tools (a write keeps its own, or the
  specification's default, destructive). `idempotentHint` is true for a `read`,
  and for a `write` whose policy line says `idempotent`, which a test proves by
  calling it twice; never for money, and never on a tool's own say-so, since a
  client may read it as leave to retry. `openWorldHint` is true unless a tool
  says otherwise. The class itself is in `_meta["foreverworks.com/access"]`,
  for a client or a gateway to build rules from.
- **Strict inputs.** An argument the tool does not name is refused by name,
  not dropped: a misspelt `days` must not run on the default.
- **A ceiling.** With `MCP_MAX_ACCESS=read|write|money`, a tool above it stays
  listed, says it is disabled, and refuses every call with `access_denied`.
- **A ceiling per client.** `MCP_CLIENT_MAX_ACCESS=<client>=<class>,...` holds
  a named client (by its token) lower still. A server that calls another to
  find a code in a mailbox, say, is held to `read` there: it can search the
  mailbox, not send from it.
- **An audit line per call** on stderr: server, tool, client, the `account`
  label, access class, outcome and duration. Never the other arguments, a
  result or a token.
- **Results checked against their declared shape.** A tool that declares an
  output schema also sends its result as `structuredContent`; a result that
  does not match (the schema made strict like the inputs) is answered as
  `unexpected` instead of reaching the client undescribed.
- **Failures as data.** A failed call is `{ "error": { kind, message, remedy } }`
  with `isError: true`, never a throw past this envelope; an unknown throw is
  reported as `unexpected`, not swallowed.

## Money and confirmation

The kit follows the Model Context Protocol, which puts the human in the loop
at the client: "there SHOULD always be a human in the loop with the ability to
deny tool invocations".

`MCP_CONFIRM` (default `client`) says who confirms a `money` call, and a
`write` its policy marks `confirm: true`: nothing is paid, but it acts outside
the computer, so a person approves each call (the printer server's `print` and
`scan` put paper through a printer or light up a scanner in someone's home).
Such a tool stays a write for the ceiling and is confirmed exactly like money.

- **`client`.** The client asks. Each such tool carries
  `_meta["anthropic/requiresUserInteraction"]: true`, so Claude Code prompts
  on every call, in every permission mode and whatever its allow rules say,
  with no "don't ask again", and denies the call where no person can answer
  (print mode, `dontAsk`).
  Codex needs `approval_mode = "prompt"` on each money tool, or those tools
  disabled ([how](deploying.md#over-stdio-one-copy-per-session)). VS Code and
  Cursor ask before any tool not marked read-only, unless you have allowed it.
- **`elicit`.** The server asks the person through the client, in an MCP
  elicitation: one line naming exactly what will happen (the counterparty, the
  amount and currency, the document, the account), computed by the same domain
  functions the call uses. The call runs only on an explicit yes. This suits a
  client that runs tools without asking but shows elicitations. A client that
  cannot be asked mid-call (one without elicitation, or a 2025-11-25 client
  over HTTP) has each such call refused (`confirmation_unavailable`), never run
  unconfirmed.
- **`none`.** The annotations only, for a deployment whose money calls are
  decided elsewhere.

**How an elicited answer is checked.** The question is the call's own result;
the client calls again with the answer and the state the question came with.
That state passes through the client, so it is signed with a key made when the
process starts, bound to the tool and to the client the token names, spent the
first time it comes back, and good for ten minutes. It holds a digest of the
arguments the person confirmed, and the answering call runs only if its
arguments still match (a file named by path is read again). A changed
argument, a replayed answer, another tool's answer or a forged state is
refused (`confirmation_invalid`), and nothing runs. A restart forgets the key,
so a pending question is asked again.

**Know the limit.** Confirmation covers only calls made through a client that
asks. If your agents have shells and tokens, keep money tools off
(`MCP_MAX_ACCESS=write`), keep the token out of the agent's reach, or put an
approval on another device in front of the server;
[auth.md](auth.md#layer-c-a-human-approves-consequential-tools) compares the
options.

## Exact data

- **Money never touches a float.** Amounts are decimal strings, checked by a
  pattern on the way in, computed with the kit's exact decimal arithmetic, and
  sent as strings where the API allows.
- **Wire shapes are modelled and checked.** Servers parse responses against
  the documented shapes. A documented field that goes missing fails the call
  (`drift`) instead of travelling on as an empty value, and unknown fields are
  dropped, not relayed.
- **A write whose outcome is unknown is never retried blind.** A connection
  that drops after an invoice request is `outcome_unknown`, with a remedy that
  says to look the document up first. Cancelling a call never abandons a write
  already sent, nor sends it again
  ([cancellation](architecture.md#long-calls-progress-and-cancellation)).

## Files going in

A model writes a tool call's arguments, so a file sent as text or base64 is
retyped, and can come out one character wrong with nothing noticing. MCP has
no way for a client to hand a server a file, so the kit (`src/inputFile.ts`)
gives every server two ways that cannot go wrong silently:

- **`path`**, inside the server's file roots
  ([`MCP_FILE_ROOTS`](configuration.md#files-a-tool-takes-as-input)). The file
  is opened without following a link at the end, must be a regular file, and
  the file actually opened must lie inside a root (read back from
  `/proc/self/fd`). So a link planted in a root, pointing at the server's own
  credentials, is refused.
- **`content_base64` with a required `sha256`** of the source file, written by
  a script that read the file. It is decoded strictly and hashed; any
  difference is refused as `checksum_mismatch`, with both hashes and the size,
  before anything is stored or sent.

Either way the result names the file's SHA-256 and size. A file over the
server's limit (25 MiB, unless a server sets less) is refused. A `money` tool
reads its file before the confirmation, so the person and the call see the
same bytes.

## Files going out

A server that hands a file back (an attachment, an archive, an export) writes
it into its outbox and answers with the path, the size and the SHA-256. Where
the provider publishes a checksum (Drive's MD5, a signed archive), the file is
checked against it first.

The result also links each file handed back as a `resource_link` (a `file://`
URI, the name, the MIME type and the size), so a client can show or open it
without parsing the JSON. Only outbox files are linked: never a file that came
in (an invoice read by path), and nothing for a failed call. There is no
`resources/read`, since the link names a file on the server's own machine, as
the path does.

## The network

- **HTTP listens on loopback only** (`127.0.0.1`), on one route, `POST /mcp`.
- **Every request carries a bearer token**, one per client
  (`MCP_HTTP_TOKENS_DIR/token-<client>`), compared in constant time against
  every token, so the time taken does not say which was nearly right. The
  client's name is what the audit line, the rate limit and the per-client
  ceiling count. A server with an HTTP port and no token refuses to start.
- **A web page cannot call it.** A browser cannot send `Authorization` without
  a CORS preflight, which gets a 401 with no CORS headers. A `Host` other than
  `127.0.0.1:<port>` or `localhost:<port>` gets a 421, which stops DNS
  rebinding.
- **Limits**: body size, request time, and a per-client rate
  ([configuration.md](configuration.md#limits-http)).
- **Egress**: `MCP_EGRESS_ALLOW` narrows outbound fetches to the server's
  hosts, refused before a connection is made. The OS sandbox is the outer wall
  ([below](#running-a-server-as-a-service)).

## Secrets

- **A credential comes from a file** named by a variable (or the value itself,
  for a local run), never from a default path
  ([conventions](configuration.md#conventions)).
- **An echoed credential is blanked.** Some upstreams echo the request's
  `Authorization` in their body. The kit's HTTP layer blanks a bearer token or
  a Basic pair in an error body, and in the preview of a body that was not the
  expected JSON, before either can reach a tool result.
- **A sign-in link carries nothing secret.** A link the client offers (an MCP
  URL elicitation, [architecture.md](architecture.md#links-a-person-opens)) is
  the URL the result carries anyway: a `state` and a PKCE challenge, never a
  verifier, a code or a token. The client shows the whole URL before opening
  it, and the page is between the person and the provider. The address the
  browser lands on comes back through `complete_*`, matched by its `state`,
  and its code is useless without the verifier the server kept. Who opened the
  page is checked by the provider and the server, not the link: a Google grant
  is refused unless approved as the account named, ANAF needs the qualified
  certificate, and the trade register answers from the person's own portal
  session.
- **Grants are never world-readable.** A grant given through a server's own
  consent tools is written atomically, with mode 0600 set on the temporary
  file before the rename.
- **Tests cannot reach a real credential.** Every test runs with an
  environment cut down to an allowlist, a temporary `HOME`, and a `fetch` that
  refuses anything but loopback.

## Running a server as a service

Over HTTP, run each server as its own system user, with credentials only it
can read, its own state directory, and a sandbox: no capabilities, a read-only
system, a private `/tmp`, the `@system-service` system calls, and no private
networks. [deploying.md](deploying.md#as-a-systemd-service) has a unit that
does all of it, and scores it with `systemd-analyze security`.

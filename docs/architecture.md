# Architecture

For contributors: how a server is layered, what the shared toolkit gives every
server, and what happens to a tool call between the client and a server's
code. The reasons behind the security rules are in [security.md](security.md),
the variables in [configuration.md](configuration.md), the house style in
[CONTRIBUTING.md](../CONTRIBUTING.md).

```
packages/
  mcp-kit/        the toolkit: transports, the guard, the result envelope, the
                  networking stack, exact decimals, files read and written safely
  receipts/       the shared shape of the delivery-app receipt servers
servers/
  <name>/         one MCP server: src/, test/, scripts/ (its smoke test),
                  README.md, CHANGELOG.md, package.json and the server.json
                  made from it
scripts/          repository checks (check-docs, check-pack, access-changes),
                  packaging and release (packaging, bundle, release)
docs/             this documentation
```

One repository, one toolchain, one lockfile; each server is an npm workspace.

## A server, layer by layer

Dependencies point inward. Nothing in `domain/` or `app/` imports from `infra/`
or `mcp/`, which is what lets the rules be tested without credentials.

```
  mcp/            the protocol: registers tools, owns their zod schemas and
   |              descriptions, checks the SHAPE of what came in, formats what
   |              goes out. policy.ts classifies every tool.
   v
  app/            use cases and ports. Ports are interfaces named after
   |              operations; nothing here knows a URL.
   v
  domain/         models and pure rules: validation, arithmetic, decisions. No
                  I/O, no dependencies (the kit's pure modules excepted).

  infra/          adapters that implement the ports: the only place an API's
                  URLs and parameter names appear.
  cli/            shell modes such as --health, where a server has them.
  composition.ts  the one module that names both a port and its implementation.
  index.ts        reads the environment, builds the dependencies once, calls serve.
```

Think of it as MVC: `infra` and `domain/schema.ts` are the model of the
service, `app` and `domain` the controller where data is validated and decided
on, `mcp` the view. `servers/oblio` is the reference to copy. `servers/google`
serves several products (Gmail, Calendar, Drive, the editors and more), each in
this layout under its own folder.

A module lives beside the one thing that uses it (`xyz.ts` and its helpers in
`xyz/`); something several modules use rises to their nearest common folder;
something several servers use goes to a package.

## The toolkit (`packages/mcp-kit`)

Machinery with no opinion about any one API. Anything that names an endpoint,
a field or a remedy stays in its server, where a reader looks for it; a shared
copy would be wrong for most servers. Code moves into the kit only if it would
be identical for an API none of these servers talk to.

| Module | What it is |
|---|---|
| `serve.ts`, `serve/` | `serve`: the transports, the guard every call passes, the questions it asks a person, HTTP limits and the egress allowlist (below). |
| `policy.ts` | Each tool's class, `read`, `write` or `money`; a confirmed tool's one-line `summary` and its `resolve`; a write marked `confirm` or `idempotent`. |
| `toolsets.ts` | For a server of several products: the toolsets `<SERVER>_TOOLSETS` loads, and the policy of those loaded beside the tools always there. A tool outside them is never registered. |
| `errors.ts`, `envelope.ts` | Tagged failures (`makeErrorKit`) and the result every tool answers with (`makeHandled`). |
| `guardErrors.ts`, `inputFileErrors.ts` | The kit's own failures, which every server's envelope recognises beside its own. |
| `call.ts` | The call a piece of code runs in: its abort signal, `reportProgress`, `pause` for a wait that stops on cancellation, `offerLink` for a link a person must open. |
| `http.ts` | `makeHttp`: query, body, timeout, backoff with `Retry-After`, one renewal after a 401, never resend a write that may have happened, stop when the call is cancelled. |
| `oauth.ts`, `tokens.ts` | RFC 6749 grants (refresh, client credentials, authorization code with PKCE) and a token source that mints once for every waiter, across processes. |
| `backoff.ts`, `pacer.ts`, `concurrency.ts` | The retry schedule; pacing for APIs that limit bursts (`makePacer`) or volume (`makeThrottle`); fan-out with a limit, and short-lived caches. |
| `decimal.ts`, `invoiceTotals.ts` | Exact decimal arithmetic on bigints, and an invoice's total by EN 16931's rounding: the one rule every server that issues or builds an invoice uses. |
| `dates.ts`, `identifiers.ts`, `csv.ts`, `compact.ts` | Calendar dates without a zone; check digits of Romanian CIF and CNP codes and of IBANs; CSV that is safe to open in a spreadsheet; objects without their `undefined` fields. |
| `inputFile.ts`, `clientRoots.ts` | Files a tool takes as input, byte-exact: by path inside the server's roots, or as base64 with its SHA-256 ([security.md](security.md#files-going-in)). |
| `outbox.ts`, `handedBack.ts` | Files a tool hands back (`saveToOutbox`), and the `resource_link` its result carries for each. |
| `files.ts`, `jsonFile.ts` | Files written whole or not at all, with their mode set before the rename; JSON state read and changed under a lock. |
| `env.ts`, `secret.ts`, `configFile.ts`, `once.ts`, `issues.ts` | Locations, the state directory and the time zone from the environment; secrets and `app.json` read without ever quoting them; configuration loaded on first use. |
| `verdict.ts` | The shell modes' contract: one line per check and an exit code (0 OK, 1 a person must act, 2 transient). |
| `packageVersion.ts`, `packageIdentity.ts` | The version, title, home page and icon a server announces, from its own package. |
| `mcp.ts` | The MCP SDK as the servers see it: `McpServer`, `Client` and the transports, from the one module that names the SDK's packages. |
| `smoke.ts` | The clients that drive a server: `connectSmoke` for smoke scripts (stdio, or a running server with `MCP_URL`), and `connectInMemory`, `testClient`, `elicitingClient` and `confirmingClient` for tests. |
| `readonly.ts` | Types for wire data as it really arrives (read-only, an optional field possibly `null`) and for a tool's declared output. |

### The networking stack

Each layer adds one concern, and a server adds only its API's policy on top:

```
makeHttp (http.ts)            query, body, timeout, backoff, Retry-After, one
                              renewal after a 401, never resend what may have happened
makeOAuthClient (oauth.ts)    the grants, and the code flow's pure parts: PKCE,
                              state, authorize URL, redirect
makeTokenSource (tokens.ts)   memory, then a file store, one mint for every
                              waiter, a lock across processes
bearer (oauth.ts)             the header and the renewal, from a token source
<server>/infra/http*.ts       the API's policy: which answers mean "later", where
                              its errors name a reason, which failure each becomes
<server>/<product>/infra      the endpoints
```

A plain 403 is a missing scope on one API and a missing role on another, so
`isRetryable` and the mapping to failures stay per server; the loop that
applies them does not.

## Transports

Every server ends in the same call, `serve`, and does not know which transport
it got: stdio by default, where the client spawns the server and owns it, or
Streamable HTTP when `MCP_HTTP_PORT` is set, one copy shared by several
clients ([configuration.md](configuration.md#transport)).

HTTP is **stateless**: no session id, and a fresh `McpServer` per request over
dependencies built once per process. So a restart costs a client only the call
in flight, and every client shares the token caches and API clients. That
works because tools keep their state in the dependencies, never in the
connection. A request gets one JSON response, or a stream (SSE) for a tool
call that reports progress, since only a stream carries the notifications
before the result.

Both transports serve both protocol generations ([below](#protocol-version)):
a client of 2025-11-25 or earlier and one of 2026-07-28 see the same tools,
instructions and icons, which `check-docs` holds every server to.

## The guard

`serve` hands a server's `register` function a proxy of the `McpServer` whose
`registerTool` is wrapped, so a server's own code cannot opt out. Before it
listens, `serve` registers every tool once onto a recorder and refuses to start
when the policy and the registered tools disagree. The guard then makes each
tool's input and output schemas strict, derives its annotations and `_meta`
class from the policy, ends its description with what this deployment does with
it (disabled, or who confirms it), and lists tools in name order. On each call
it applies the ceilings, asks the person where `MCP_CONFIRM=elicit` and the
tool needs a yes, runs the call in its context (`call.ts`), checks the result
against the output schema and sends it as structured content, and writes one
audit line ([why](security.md#every-call-passes-the-guard)).

## Errors

Failures are tagged plain objects thrown through a per-server namespace
(`makeErrorKit("<server>")`), not exception classes: a failure survives
serialisation and is told apart by its `kind`, and two servers in one process
cannot catch each other's failures. `instanceof Error` is false for every one,
so a catch that describes a failure calls the server's `asAppError` first.

A failed call answers `{ "error": { kind, message, remedy } }` with
`isError: true`: the top-level `error` key says the call did not happen, which
an error string alone could not, and the remedy is one sentence an operator
can act on. The kit's own failures (`access_denied`, the `confirmation_*`
kinds, `cancelled`, `outcome_unknown`, and those of an input file) carry the
kit's remedies in every server, and an unrecognised throw is reported as
`unexpected`. Results are compact JSON, since the text lands in a model's
context, followed by a `resource_link` for each file the call saved.

## Long calls: progress and cancellation

A call's context (`call.ts`) holds the request's abort signal and, when the
client sent a `progressToken`, a progress reporter.
A tool that takes a while calls `reportProgress(done, total, message)` at its
natural steps. Notifications go out in increasing order, at most every 250 ms
and always the last, and only to a client that asked.

The signal fires when the client cancels (`notifications/cancelled`) or goes
away (an HTTP client that hangs up, stdio closing). `makeHttp` honours it
without a server passing anything: nothing more is sent, a backoff or a poll's
`pause` stops, and an idempotent request is abandoned in flight. A request
that is not idempotent runs to its answer once sent, because abandoning it
would leave its outcome unknown, and the call remembers it. Cancelled before
any write left, the call ends as the kit's `cancelled` failure; after one did,
as `outcome_unknown`, and nothing sends the write again.

## Links a person opens

A sign-in tool (google `begin_consent`, onrc `begin_login`, anaf-efactura
`begin_authorization`) hands a person a page to open. Its use case calls
`offerLink({ url, message, next })` beside the result it returns, which still
carries the URL. Once the call has succeeded, the guard asks the client to
offer the link itself, as an MCP URL elicitation: the client shows the whole
URL and `message` (what to do on the page and what to bring back), and opens
it in the person's browser if they accept.

The result then says what they answered (`client_offered_link`). Accepted, the
URL leaves the result and `next` becomes the link's own, so the model asks for
the address the browser lands on instead of repeating the link. Declined or
cancelled, the result keeps the URL, since the person may want it sent to
someone else (whoever holds the certificate), and a client can decline by
policy without asking anyone.

A client that does not declare URL elicitation, and a 2025-11-25 client over
HTTP, get the result as the use case returned it, link included. Otherwise the
question is asked like any other ([Protocol version](#protocol-version)), and
the use case runs once.

Nothing waits for the page. A server learns the sign-in finished when the
person's address reaches its `complete_*` tool, matched to the sign-in by its
`state`, not from a completion notification, which 2026-07-28 removed. The
audit line's `link` says what happened to the link: the answer, `unsupported`,
or `failed` when the client did not answer.

## Protocol version

The servers are built on SDK v2 (`@modelcontextprotocol/server`, `/client` and
`/node`, which only the kit names, in `src/mcp.ts`) and serve both protocol
generations: 2025-11-25 and earlier (`initialize`, then requests) and
2026-07-28 ([changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)),
which has no `initialize` and no session and carries the client's version and
capabilities in every request's `_meta`.

- **How a request finds its generation.** Over stdio, the client's first
  message picks it for the connection (the SDK's `serveStdio`). Over HTTP, the
  body does, per request: one carrying 2026-07-28's `_meta` goes to the SDK's
  handler for that revision, which answers JSON, or a stream once a call
  reports progress. Everything else gets one JSON answer (a stream for a call
  that asks for progress), so a script that POSTs one `tools/call` with curl
  keeps working.
- **Questions to the person are one shape for both.** A money confirmation
  (`MCP_CONFIRM=elicit`) or a link a call hands a person is the call's own
  result, `input_required`, with a `requestState`; the client calls again with
  the answer. In 2026-07-28 the client does the retry, over stdio or HTTP. On a
  2025 stdio connection the SDK turns the question into that revision's
  server-to-client request and calls again itself. A 2025 client over HTTP
  cannot be asked (its stateless transport has no way back), so a confirmed
  call is refused there with `confirmation_unavailable`, and a link stays in
  the result. [security.md](security.md#money-and-confirmation) says how the
  state is checked.
- **Roots are deprecated** in 2026-07-28, which has no way to push them, so
  only a 2025 stdio client's roots count where `MCP_FILE_ROOTS` is unset
  ([configuration.md](configuration.md#files-a-tool-takes-as-input)).
- **A tool the server does not have** is a protocol error (`-32602`, "Tool x
  not found") in both generations, as the specification has it, not an
  `isError` result. A call's own failures keep the `{ error }` shape.
- **Schemas are JSON Schema 2020-12** (`$schema` on every input and output
  schema). Tools carry no `execution` field, since tasks left the SDK's core.
- **Logging is deprecated** in favour of stderr, which is all these servers use.

[auth.md](auth.md) lists what the new revision changes for authorization.

## Receipts (`packages/receipts`)

`bolt-food` and `glovo` are two servers of one shape: a delivery app's order
history as itemised receipts, and the join from a bank card charge to the order
it paid for. The package has a server's layers, each its own export
(`./domain`, `./app`, `./infra`, `./mcp`, `./cli`), and each server keeps only
what is its app's: the API adapter, the wire types and their mapping, and its
words. [Its README](../packages/receipts/README.md) has the details.

## Tests

Every workspace's tests run in isolation (`packages/mcp-kit/testing/isolate.ts`,
through the shared `testing/vitest.ts`): the environment is cut to an
allowlist, HOME is an empty temporary directory, the time zone is UTC, and
`fetch` refuses anything but loopback unless a test stubs it. Every dependency
on the outside world is a port with a fake, so no rule needs a live account to
be tested. Tests drive a server through a real client, in either protocol
generation, with the test clients of `smoke.ts` (above).

`test/tools.snapshot.json` pins the tool surface a client lists, in the servers
that keep one, so a renamed tool or argument shows in review.
`scripts/check-docs.ts` holds each README to the code. A server's smoke script
(`scripts/smoke.ts`; google has one per product) drives the built server over
the real protocol with real credentials: the check the tests cannot be.

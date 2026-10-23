# mcp-kit

`@foreverworks/mcp-kit` is the toolkit every MCP server in this repository is
built on. You write the tools; the kit serves them over stdio or HTTP, makes you
classify each as `read`, `write` or `money`, holds every call to that class, and
supplies what each integration would otherwise copy: an HTTP client that never
sends a payment twice, OAuth token sources, exact decimals, files taken byte for
byte. Endpoints, fields and remedies stay in each server.

It is not on npm yet: it ships with the servers' first release
([docs/releasing.md](../../docs/releasing.md)), and until then is a workspace
of this repository. What it exports follows what these servers need.

## A minimal server

```ts
import { makeErrorKit, makeHandled, packageVersion, serve, type ToolPolicy } from "@foreverworks/mcp-kit";
import { z } from "zod";

type AppError = { readonly kind: "input"; readonly message: string };
const { fail, asAppError } = makeErrorKit<AppError>("greeter");
const handled = makeHandled({ asAppError, remedyFor: () => "fix what the message names and call again" });

// Every tool the server registers, classified: serve refuses to start otherwise.
const POLICY: ToolPolicy = {
  greet: { access: "read" },
};

await serve({
  name: "greeter",
  version: packageVersion(import.meta.url),
  instructions: "Greets people by name.",
  policy: POLICY,
  register: (server) => {
    server.registerTool(
      "greet",
      { description: "A greeting for one person, by name.", inputSchema: { name: z.string().trim() } },
      handled(async ({ name }) => (name === "" ? fail({ kind: "input", message: "name is empty" }) : { greeting: `Hello, ${name}` })),
    );
  },
});
```

Run it and a client lists `greet` with the annotations its class implies, the
class itself, and a strict schema:

```
"annotations": { "openWorldHint": true, "readOnlyHint": true, "idempotentHint": true },
"_meta": { "foreverworks.com/access": "read" },
"inputSchema": { "properties": { "name": { "type": "string" } }, "additionalProperties": false, ... }
```

A call with `{ "nme": "Ana" }` is refused, naming the unknown key. One with
`{ "name": " " }` answers with `isError: true` and this text, and leaves one
line on stderr, without its arguments or its result:

```
{"error":{"kind":"input","message":"name is empty","remedy":"fix what the message names and call again"}}
audit {"svc":"greeter","tool":"greet","client":"stdio","account":null,"access":"read","outcome":"input","ms":2}
```

A `money` tool's policy line also gives `summary`, the one line a person
confirms before it runs (`summaryFrom(schema, line)` computes it from the
validated arguments). A server for several products passes `products` for
their icons. `servers/oblio` is a complete example.

## What it gives

- **Serving.** `serve` speaks stdio, or Streamable HTTP on `127.0.0.1` when
  `MCP_HTTP_PORT` is set, with a bearer token and a rate limit per client and
  limits on a request's size and time. Protocols 2025-11-25 and 2026-07-28 are
  served alike on both; `MCP_EGRESS_ALLOW` can narrow the hosts the process
  may reach.
- **The guard.** Every registered tool is checked against the policy at
  start. Inputs are strict; annotations and `_meta` come from the class; a
  ceiling (`MCP_MAX_ACCESS`, and `MCP_CLIENT_MAX_ACCESS` per client) refuses
  what is above it; `MCP_CONFIRM` says whether the client or the server
  confirms a `money` call; a declared output schema is checked and sent as
  structured content; every call is audited.
- **Results and failures.** `makeErrorKit` for tagged failures, `makeHandled`
  for the envelope every tool answers with, `saveToOutbox` for a file a tool
  hands back with its SHA-256 and a `resource_link`.
- **Long calls.** `reportProgress`, `pause`, cancellation that `makeHttp`
  honours by itself, and `offerLink` for a sign-in page the client opens.
- **Networking.** `makeHttp` (retries what is safe to retry, never resends a
  write whose outcome is unknown), `makeOAuthClient`, `makeTokenSource` with a
  file store locked across processes, `bearer`, `makePacer` and `makeThrottle`
  for an API's rate limits, `memoize` and `mapWithConcurrency`.
- **Exact data.** Decimal arithmetic on bigints, an invoice's total by
  EN 16931's rounding (`documentTotal`), zoneless calendar dates, check digits
  for Romanian CIF and CNP codes and IBANs, and CSV safe to open in a
  spreadsheet.
- **Files and configuration.** `inputFilesFrom` (a file by path inside the
  server's roots, or base64 with its SHA-256), `writeFileAtomic`, JSON state
  under a lock, `readSecret` and `readConfigFile`, which never quote what they
  read, `stateDirOf` and `timeZoneOf`, and `toolsetsFrom` and
  `toolsetPolicy` for a server of several products that loads only the ones
  a client asks for (`<SERVER>_TOOLSETS`).
- **Testing.** `connectInMemory` and `testClient` drive a server in either
  protocol generation; `elicitingClient` and `confirmingClient` answer what it
  asks; `connectSmoke` reaches a built or running server for a smoke script.

It needs Node 22.19 or newer, ES modules, and zod 4 for tool schemas (a schema
of another kind is not made strict). The MCP SDK v2 is the kit's own
dependency: `McpServer`, `Client` and the transports come from the kit, so a
server depends on the kit alone.

## Documentation

- [docs/architecture.md](../../docs/architecture.md): every module, the
  networking stack, the transports, the guard, and how a server is layered.
- [docs/security.md](../../docs/security.md): what the guard does and why,
  money and confirmation, files in and out.
- [docs/configuration.md](../../docs/configuration.md): every variable the kit
  reads.
- [CONTRIBUTING.md](../../CONTRIBUTING.md): adding a tool or a server.
- [CHANGELOG.md](CHANGELOG.md): what changed in each version.

In this repository, every workspace's tests run under `testing/isolate.ts`
(an emptied environment, a temporary HOME, UTC, and a `fetch` that refuses the
network) through the shared `testing/vitest.ts`; the npm package carries
neither.

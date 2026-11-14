# Configuration

The environment variables every server shares, with their defaults, and the
conventions a server's own variables follow. A server's own variables (its
credentials, its accounts) are in its README, under Configuration.

## Conventions

| What | Where the server finds it |
|---|---|
| A secret | In a file. A single secret (an API key, a password) is named by a variable ending in `_FILE` that holds its path; for a local stdio run, the same name without `_FILE` takes the value itself. A credential that is a JSON file or a folder of files is named by its path. The server's README says which. |
| State it writes itself: token caches, grants given through its own consent tools, stores | `<SERVER>_STATE_DIR`, else systemd's `STATE_DIRECTORY` when the unit has one, else `$XDG_STATE_HOME/mcps/<server>`, which is `~/.local/state/mcps/<server>` by default (`%APPDATA%\mcps\<server>` on Windows). |
| Files it hands back | Its outbox, named in its README: usually `<SERVER>_OUTBOX_DIR`, else an `outbox` folder in its state directory. |
| The time zone of calendar dates | Its own `..._TIME_ZONE` variable where it has one, else the process's zone (`TZ`, else the system's). Servers for Romanian institutions (ANAF, ONRC, BNR) use Romania's zone. |
| Which of its tools it serves, for a server with toolsets (google's products, porkbun's areas) | `<SERVER>_TOOLSETS` where it has toolsets: the toolsets to load, separated by commas. Unset, empty or `all` loads every one; the tools of the others are not registered at all. Its README lists the names. |

Four rules hold everywhere:

- **No credential has a default.** A server reads its environment and nothing
  else: no config file, no assumed path. Without its credential it still
  starts and lists its tools; the tools that need it answer with a `config`
  error naming the variable to set. So a client always sees what a server
  offers, and a misconfigured deployment says what is missing.
- **A named file must be there.** A `_FILE` variable that points at a missing
  or empty file is a configuration error, never a quiet fallback to the plain
  variable.
- **Empty is unset.** A variable set to an empty value counts as unset, with
  the same default: an installer that asks for each setting (a plugin's
  settings dialog) passes one nobody filled in as an empty string.
  `check:docs` starts every server that way and holds it to the same tools.
- **A setting the server cannot read stops it.** A port that is not a port, an
  unknown access class or confirmation mode, a limit that is not a positive
  number, a time zone that does not exist, or a toolset the server does not
  have ends the process at startup, with a message naming the variable.

## Shared variables

Read by `@foreverworks/mcp-kit`, so by every server.

### Transport

| Variable | Default | Meaning |
|---|---|---|
| `MCP_HTTP_PORT` | unset: stdio | Serve Streamable HTTP on `127.0.0.1:<port>/mcp` instead of stdio (or on `MCP_HTTP_HOST`). `0` picks a free port, which the startup line on stderr names. |
| `MCP_HTTP_HOST` | `127.0.0.1` | The address the HTTP listener binds: an IP address (`0.0.0.0` for every IPv4 interface, `::` for every interface, or one interface's address) or `localhost`, not a name to resolve. For a server in a container, reached over a private network on a published port; [below](#a-server-in-a-container). Any address but a loopback one (`127.x.x.x`, `::1`, `localhost`) needs `MCP_HTTP_ALLOWED_HOSTS` (or `MCP_HTTP_PUBLIC_HOSTS`), or the server refuses to start. |
| `MCP_HTTP_ALLOWED_HOSTS` | | The `Host` header values the server answers besides `127.0.0.1:<port>` and `localhost:<port>`, separated by commas: `name` for that name on any port (or none), `name:port` for that port only, as the client writes it. A DNS name or an IPv4 address, compared without regard to case. It works with bearer tokens: the Host check stays, and a request still needs its token. Any other `Host` gets a 421. |
| `MCP_HTTP_TOKENS_DIR` | | A directory of `token-<client>` files, one bearer token per client; other files in it are ignored. The client's name is what the audit line, the rate limit and `MCP_CLIENT_MAX_ACCESS` count. An empty file is a client this deployment does not have. |
| `MCP_HTTP_TOKEN_FILE` | | One token file, for one client, when there is no directory. |
| `MCP_HTTP_TOKEN_CLIENT` | `default` | The client name for `MCP_HTTP_TOKEN_FILE`. |
| `MCP_HTTP_PUBLIC_HOSTS` | | Instead of tokens: serve anyone, with no sign-in, as these public host names (`rates.example.com`), separated by commas, each with `:<port>` if clients reach it on a port other than 443. Only for a server whose tools all read; [below](#a-public-server-with-no-sign-in). |
| `MCP_HTTP_CLIENT_IP_HEADER` | unset: the connection's address | With `MCP_HTTP_PUBLIC_HOSTS`: the header your proxy puts each caller's address in (`cf-connecting-ip`, `x-forwarded-for`), so each address has its own rate limit. |

Over HTTP one of the two token settings, or `MCP_HTTP_PUBLIC_HOSTS`, is
required, and the directory wins when both token settings are set. Without
any the server refuses to start, because loopback is open to every process and
browser on the machine; it also refuses a token shorter than 16 characters,
and a directory whose token files are all empty. Tokens are read once, at
startup, so a new or changed one takes a restart. [auth.md](auth.md) has what
else is possible and planned.

#### A server in a container

A server in a container listens on the container's own network, so
`127.0.0.1` inside it is out of reach of the published port. Bind every
interface and name the `Host` values clients reach it by:

```bash
docker run --rm -e MCP_SERVER=bnr -e MCP_HTTP_PORT=8080 -e MCP_HTTP_HOST=0.0.0.0 \
  -e MCP_HTTP_ALLOWED_HOSTS=mcp.internal,localhost -e MCP_HTTP_TOKENS_DIR=/run/tokens \
  -v "$PWD/tokens:/run/tokens:ro" -p 127.0.0.1:8080:8080 ghcr.io/foreverworks/mcps:main
```

[Deploying](deploying.md#in-a-container) has the image and the rest.

- **The tokens stay.** `MCP_HTTP_ALLOWED_HOSTS` is not the public mode: a
  request without a bearer token gets a 401 on an allowed `Host` too, and the
  tokens are the ones of `MCP_HTTP_TOKENS_DIR` or `MCP_HTTP_TOKEN_FILE`.
- **The `Host` check is what you configure.** It stops a web page that a
  DNS-rebinding trick points at your server's address: such a page arrives
  with its own name in `Host`. So a bind address that is not a loopback one
  is refused unless you also list the names your clients use. Publish the
  container's port on the interface your clients reach, and no wider: with
  Docker, `-p 192.0.2.10:8080:8080`, or `-p 127.0.0.1:8080:8080` for this
  machine only.
- **A port in the name is exact.** `mcp.internal` accepts that name on any
  port, or none; `mcp.internal:8080` accepts it on port 8080 only. A client
  that reaches the server through a published port other than
  `MCP_HTTP_PORT` sends that port in `Host`, so list the name without one.
- **Unset, nothing changes.** Without both variables the server binds
  `127.0.0.1` and answers its two loopback names, as before.
- **Setting either without `MCP_HTTP_PORT` stops the start**, as a public
  host does: there is no HTTP listener to configure. The startup line names
  the address bound and the extra names answered.

#### A public server, with no sign-in

For a server whose tools only read public data (BNR's exchange rates, say),
hosted at a public HTTPS address that ChatGPT, Claude or any other client
connects to with no account. Set `MCP_HTTP_PORT` and `MCP_HTTP_PUBLIC_HOSTS`,
and put a reverse proxy in front:

```bash
MCP_HTTP_PORT=8750 MCP_HTTP_PUBLIC_HOSTS=rates.example.com \
MCP_HTTP_CLIENT_IP_HEADER=cf-connecting-ip npx -y @foreverworks/mcp-bnr
```

- **Only reads may run.** Anyone can call a public server, so it refuses to
  start if a `write` or `money` tool could run, and names each one. A server
  that has some can still be made public with `MCP_MAX_ACCESS=read`: those
  tools stay listed, say they are disabled, and refuse every call. Read is
  not the same as public, though: a read tool over a mailbox reads that
  mailbox to anyone. Make public only a server whose data already is.
- **It still listens on `127.0.0.1`** (unless `MCP_HTTP_HOST` says otherwise,
  for a proxy in another container). The proxy owns TLS, the firewall
  and anything static the address needs (a privacy page, files under
  `/.well-known/`). It forwards `POST /mcp` with the public `Host` it was
  reached at, or the loopback one; any other `Host` gets a 421.
- **Each caller's address has its own rate limit** (`MCP_HTTP_RATE`). Name the
  header your proxy sets in `MCP_HTTP_CLIENT_IP_HEADER`: its last address is
  taken, the one the proxy added, so `x-forwarded-for` works when the proxy
  appends to it. Without it every request seems to come from the proxy, and
  all callers share one limit. An IPv6 caller counts as its /64. ChatGPT and
  Claude call from their own servers, so many of their users share a few
  addresses: keep the rate generous.
- **Nothing identifies a caller in the log.** Every audit line names the
  client `public`, never an address.
- **Not with tokens, and not with `MCP_FILE_ROOTS`**: with no sign-in, anyone
  could read the files in a root through a tool that takes a path. The server
  refuses to start with either.

### Files to and from another machine

A server that runs on another machine than its clients no longer shares their
disk, so a file a tool saves is on the wrong disk to be read, and a file a tool
takes by path is not on its disk. The server's HTTP listener can carry those
files, and [`mcp-relay`](../packages/mcp-relay) puts them where the client
expects: it listens on the client's machine like the server, and moves the
files with each call. Both parts are off unless you set a variable.

On the server (`MCP_HTTP_PORT` and tokens needed; not with
`MCP_HTTP_PUBLIC_HOSTS`):

| Variable | Default | Meaning |
|---|---|---|
| `MCP_HTTP_FILES_OUTBOX` | unset: off | An absolute folder. Switches on `GET /files/outbox/<path>`, which streams a file below it with `Content-Length`, `Content-Type` and `X-Content-SHA256`. Set it to the folder the server's tools save to. |
| `MCP_HTTP_FILES_INBOX` | unset: off | An absolute folder. Switches on `PUT /files/inbox/<path>`, which writes a file below it, whole or not at all, with mode 0640, making the folders on the way, and answers `{ "path", "size", "sha256" }`. A request that carries `X-Content-SHA256` is refused (422) when the bytes differ, and nothing is kept. Set it to a folder in `MCP_FILE_ROOTS`. |
| `MCP_HTTP_FILES_MAX_BYTES` | `268435456` (256 MiB) | The largest file the inbox takes; a larger one gets a 413. Needs `MCP_HTTP_FILES_INBOX`. |

With neither folder set these routes do not exist: a request for one gets the
404 any unknown route gets. With either set, a request needs the same bearer
token and `Host` as `/mcp`, counts against the same rate limit, and may only
name a regular file whose real path is inside the folder; anything else is a
404 that says nothing about why. Setting the inbox lets a request take as long
as a call may (`MCP_HTTP_TIMEOUT_MS`) to arrive, so a large file on a slow
link gets through. Every transfer leaves a `files {...}` line on stderr (the
direction, the outcome, and for a file that moved its path, size and the start
of its SHA-256). [Deploying](deploying.md#a-server-on-another-machine) shows it
in use; [security](security.md#files-to-and-from-another-machine) has what it
guarantees.

On the relay (it also reads the listener variables above: `MCP_HTTP_PORT`,
`MCP_HTTP_HOST`, `MCP_HTTP_ALLOWED_HOSTS`, `MCP_HTTP_TOKENS_DIR` or
`MCP_HTTP_TOKEN_FILE`, and the [limits](#limits-http)):

| Variable | Default | Meaning |
|---|---|---|
| `MCP_RELAY_UPSTREAM` | required | The base URL of the server (`https://mcp.example.com`), without `/mcp`. |
| `MCP_RELAY_UPSTREAM_TOKEN_FILE` | required | The file holding the bearer token the server accepts from the relay. |
| `MCP_RELAY_INBOX` | unset: no file goes up | An absolute folder, the same path as the server's inbox. A file in it that a call's arguments name by absolute path is uploaded before the call. |
| `MCP_RELAY_OUTBOX` | unset: no file comes down | An absolute folder, the same path as the server's outbox. A file a result links there with a `file:` URI is fetched before the result is passed on. |
| `MCP_RELAY_MAX_FILE_BYTES` | `268435456` (256 MiB) | The largest file the relay moves, up or down. |

### Limits (HTTP)

| Variable | Default | Meaning |
|---|---|---|
| `MCP_HTTP_MAX_BODY` | `4194304` (4 MiB) | The largest request body, in bytes; a larger one gets a 413. |
| `MCP_HTTP_TIMEOUT_MS` | `900000` (15 min) | The longest a request may take before a 504. |
| `MCP_HTTP_RATE` | `20/200` | `<per second>/<burst>` per client, or per caller's address on a public server, as a token bucket; a request over it gets a 429 with `Retry-After`. |

### Network

| Variable | Default | Meaning |
|---|---|---|
| `MCP_EGRESS_ALLOW` | unset: no limit | The hosts the process may fetch from, separated by commas: `api.example.com`, or `*.example.com` for its subdomains (not `example.com` itself). A request to any other host fails before a connection is made. Raw sockets and child processes are not covered; sandbox those at the OS level. |
| `MCP_KEEPALIVE_MS` | Node's 4 s | How long idle upstream connections stay open, so a service answering calls seconds apart does not pay a TLS handshake each time. A value that is not a positive number leaves Node's default. |

### What tools may do

Each tool's class (`read`, `write` or `money`, from its server's policy) is in
`tools/list`: in the standard annotations (`readOnlyHint`, `destructiveHint`)
and in `_meta["foreverworks.com/access"]`.

| Variable | Default | Meaning |
|---|---|---|
| `MCP_MAX_ACCESS` | `money` | The highest class this server runs: `read`, `write` or `money`. A tool above it is still listed, says it is disabled, and refuses every call (`access_denied`). |
| `MCP_CLIENT_MAX_ACCESS` | | Lower ceilings for named clients, as `client=class` pairs separated by commas (`mail-reader=read,bob=write`). The client is the name of the bearer token it called with (`MCP_HTTP_TOKENS_DIR`). A call above its class is refused (`access_denied`, naming the client). Meant for another server that calls this one as its client and needs to read, not to send or pay. |
| `MCP_CONFIRM` | `client` | Who confirms with the person a `money` call, and a `write` its policy marks `confirm` (one that acts outside the computer): `client`, `elicit` or `none`, as below. |

[security.md](security.md#money-and-confirmation) explains each value of
`MCP_CONFIRM` and how each client confirms:

- **`client`**: the client asks. Each such tool also carries
  `_meta["anthropic/requiresUserInteraction"]`, which makes Claude Code ask on
  every call, whatever its permission mode.
- **`elicit`**: the server asks, through an MCP elicitation naming exactly
  what will happen. A client that cannot be asked mid-call (one without
  elicitation, or a 2025-11-25 client over HTTP) has the call refused
  (`confirmation_unavailable`).
- **`none`**: the annotations only, for a deployment whose money calls are
  decided elsewhere.

### Files a tool takes as input

[security.md](security.md#files-going-in) explains why a file goes in by path.

| Variable | Default | Meaning |
|---|---|---|
| `MCP_FILE_ROOTS` | stdio: the folders the client shares as MCP roots (a 2025-11-25 client), else the working directory. HTTP: none, so paths are refused | The directories, separated by `:`, a tool may read a file from by `path`. A relative path in a call is taken from the first. |
| `MCP_FILE_SCRIPT` | | A command on this deployment that sends a file with its SHA-256 (`content_base64` and `sha256`). Tool descriptions name it, so a model knows how to send a file it cannot pass by path. |

### Locations

| Variable | Meaning |
|---|---|
| `STATE_DIRECTORY` | Set by systemd for a unit with `StateDirectory=`: the default state directory (the first, when it lists several). |
| `CREDENTIALS_DIRECTORY` | Set by systemd for a unit with `LoadCredential=`: where servers that read several named credentials look. |
| `XDG_STATE_HOME` | The base of the default state directory outside systemd. |
| `APPDATA` | Set by Windows: the base of the default state directory there, when `XDG_STATE_HOME` is not set. |

### Smoke scripts

A server's `scripts/smoke.ts` drives the built server over the real protocol,
by default over stdio with your environment.

| Variable | Meaning |
|---|---|
| `MCP_URL` | Drive a running server at this URL (`http://127.0.0.1:<port>/mcp`) instead. |
| `MCP_TOKEN_FILE` | The file holding the bearer token for `MCP_URL`. Unset, no token is sent, as a public server needs none. |

## Keeping this page true

`npm run check` fails when a server or package reads a variable that neither
its README nor this page documents (`scripts/check-docs.ts`), so a new shared
variable is documented here in the same change.

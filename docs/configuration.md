# Configuration

The environment variables every server shares, with their defaults, and the
conventions a server's own variables follow. A server's own variables (its
credentials, its accounts) are in its README, under Configuration.

## Conventions

| What | Where the server finds it |
|---|---|
| A secret | In a file. A single secret (an API key, a password) is named by a variable ending in `_FILE` that holds its path; for a local stdio run, the same name without `_FILE` takes the value itself. A credential that is a JSON file or a folder of files is named by its path. The server's README says which. |
| State it writes itself: token caches, grants given through its own consent tools, stores | `<SERVER>_STATE_DIR`, else systemd's `STATE_DIRECTORY` when the unit has one, else `$XDG_STATE_HOME/mcps/<server>`, which is `~/.local/state/mcps/<server>` by default. |
| Files it hands back | Its outbox, named in its README: usually `<SERVER>_OUTBOX_DIR`, else an `outbox` folder in its state directory. |
| The time zone of calendar dates | Its own `..._TIME_ZONE` variable where it has one, else the process's zone (`TZ`, else the system's). Servers for Romanian institutions (ANAF, ONRC, BNR) use Romania's zone. |
| Which of its tools it serves, for a server with toolsets (google's products, porkbun's areas) | `<SERVER>_TOOLSETS` where it has toolsets: the toolsets to load, separated by commas. Unset, empty or `all` loads every one; the tools of the others are not registered at all. Its README lists the names. |

Three rules hold everywhere:

- **No credential has a default.** A server reads its environment and nothing
  else: no config file, no assumed path. Without its credential it still
  starts and lists its tools; the tools that need it answer with a `config`
  error naming the variable to set. So a client always sees what a server
  offers, and a misconfigured deployment says what is missing.
- **A named file must be there.** A `_FILE` variable that points at a missing
  or empty file is a configuration error, never a quiet fallback to the plain
  variable.
- **A setting the server cannot read stops it.** A port that is not a port, an
  unknown access class or confirmation mode, a limit that is not a positive
  number, a time zone that does not exist, or a toolset the server does not
  have ends the process at startup, with a message naming the variable.

## Shared variables

Read by `@foreverworks/mcp-kit`, so by every server.

### Transport

| Variable | Default | Meaning |
|---|---|---|
| `MCP_HTTP_PORT` | unset: stdio | Serve Streamable HTTP on `127.0.0.1:<port>/mcp` instead of stdio. `0` picks a free port, which the startup line on stderr names. |
| `MCP_HTTP_TOKENS_DIR` | | A directory of `token-<client>` files, one bearer token per client; other files in it are ignored. The client's name is what the audit line, the rate limit and `MCP_CLIENT_MAX_ACCESS` count. An empty file is a client this deployment does not have. |
| `MCP_HTTP_TOKEN_FILE` | | One token file, for one client, when there is no directory. |
| `MCP_HTTP_TOKEN_CLIENT` | `default` | The client name for `MCP_HTTP_TOKEN_FILE`. |

Over HTTP one of the two token settings is required, and the directory wins
when both are set. Without a token the server refuses to start, because
loopback is open to every process and browser on the machine; it also refuses
a token shorter than 16 characters, and a directory whose token files are all
empty. Tokens are read once, at startup, so a new or changed one takes a
restart. [auth.md](auth.md) has what else is possible and planned.

### Limits (HTTP)

| Variable | Default | Meaning |
|---|---|---|
| `MCP_HTTP_MAX_BODY` | `4194304` (4 MiB) | The largest request body, in bytes; a larger one gets a 413. |
| `MCP_HTTP_TIMEOUT_MS` | `900000` (15 min) | The longest a request may take before a 504. |
| `MCP_HTTP_RATE` | `20/200` | `<per second>/<burst>` per client, as a token bucket; a request over it gets a 429 with `Retry-After`. |

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

### Smoke scripts

A server's `scripts/smoke.ts` drives the built server over the real protocol,
by default over stdio with your environment.

| Variable | Meaning |
|---|---|
| `MCP_URL` | Drive a running server at this URL (`http://127.0.0.1:<port>/mcp`) instead. |
| `MCP_TOKEN_FILE` | The file holding the bearer token for `MCP_URL`; required with it. |

## Keeping this page true

`npm run check` fails when a server or package reads a variable that neither
its README nor this page documents (`scripts/check-docs.ts`), so a new shared
variable is documented here in the same change.

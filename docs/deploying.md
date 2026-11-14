# Deploying

How to run these servers: started by your client, for you alone (stdio), or
as one copy that several clients share (HTTP), under systemd or in a container
when it runs every day. A server's own settings are in its README; the ones every server
shares are in [configuration.md](configuration.md).

## Build

You need Node 22.19 or newer.

```bash
git clone https://github.com/foreverworks/mcps.git && cd mcps
npm ci
npm run build
```

Each server is then a Node program at `servers/<name>/dist/index.js` (`dist/`
is not in git). To build one server only, run
`npm run kit && npm run build -w @foreverworks/mcp-oblio`: the servers import
the built toolkit, so the kit comes first. Once the packages are on npm, each
server's README also offers install buttons, an `npx` command and a Claude
Desktop bundle (`.mcpb`), none of which needs a checkout.

## Over stdio: one copy per session

The default: your client starts the server, talks to it over stdin and stdout,
and stops it when the session ends. Credentials come from the environment you
give it; state goes to `~/.local/state/mcps/<server>` unless you name another
place.

**Claude Code**

```bash
claude mcp add oblio \
  --env OBLIO_CONFIG=/path/to/oblio-app.json \
  -- node /path/to/mcps/servers/oblio/dist/index.js
```

**Claude Desktop** (`claude_desktop_config.json`) and **Cursor**
(`.cursor/mcp.json`) take this entry; **VS Code** (`.vscode/mcp.json`) takes it
under `servers` instead of `mcpServers`:

```json
{
  "mcpServers": {
    "oblio": {
      "command": "node",
      "args": ["/path/to/mcps/servers/oblio/dist/index.js"],
      "env": { "OBLIO_CONFIG": "/path/to/oblio-app.json" }
    }
  }
}
```

**Codex** (`~/.codex/config.toml`) does not read Claude Code's confirmation
mark, so give each `money` tool a prompt. The server's README lists them, and
`tools/list` marks each in `_meta["foreverworks.com/access"]`.

```toml
[mcp_servers.oblio]
command = "node"
args = ["/path/to/mcps/servers/oblio/dist/index.js"]
env = { OBLIO_CONFIG = "/path/to/oblio-app.json" }

[mcp_servers.oblio.tools.create_invoice]
approval_mode = "prompt"
```

With `approval_policy = "never"` Codex prompts for nothing, so there list the
money tools in `disabled_tools` instead.

A tool reads a file by path from the folders your client shares with it, or
else from the folder the server was started in.

## Over HTTP: one copy for several clients

One process serves every client on the machine, on `127.0.0.1:<port>/mcp`
only, and each request must carry a known client's bearer token. The clients
share its caches and token stores, so a grant one of them refreshes serves
them all.

1. Make one token per client. The file name after `token-` is the client's
   name, which the audit line and the rate limit use:

   ```bash
   mkdir -p -m 0700 "$HOME/.config/mcp-tokens/oblio"
   for client in alice bob; do
     (umask 077; openssl rand -base64 32 > "$HOME/.config/mcp-tokens/oblio/token-$client")
   done
   ```

2. Start the server with a port and the token directory. Its startup line on
   stderr says whom it serves and how:

   ```bash
   MCP_HTTP_PORT=8740 MCP_HTTP_TOKENS_DIR="$HOME/.config/mcp-tokens/oblio" \
     OBLIO_CONFIG="$HOME/.config/oblio/app.json" \
     node servers/oblio/dist/index.js
   ```

   ```
   oblio: listening on http://127.0.0.1:8740/mcp for alice, bob; every tool enabled; money and confirmed calls marked for the client to confirm
   ```

3. Give each client its own token. In Claude Code:

   ```bash
   claude mcp add --transport http oblio http://127.0.0.1:8740/mcp \
     --header "Authorization: Bearer $(cat "$HOME/.config/mcp-tokens/oblio/token-alice")"
   ```

   In Codex, put the token in an environment variable Codex starts with:

   ```toml
   [mcp_servers.oblio]
   url = "http://127.0.0.1:8740/mcp"
   bearer_token_env_var = "OBLIO_MCP_TOKEN"
   ```

What changes over HTTP:

- **No file paths by default.** The server cannot see your client's folders,
  so tools refuse a `path` until `MCP_FILE_ROOTS` names a folder your clients
  can write and the server can read.
- **Server-side confirmation needs a newer client.** With `MCP_CONFIRM=elicit`
  a client of protocol 2026-07-28 is asked mid-call, and a 2025-11-25 client
  is refused each confirmed call. The default, `client`, works as over stdio.
- **Limits are per client**, so one client's runaway loop leaves the others
  their share ([Limits](configuration.md#limits-http)).
- **Tokens are read at startup.** Adding, changing or removing one takes a
  restart.
- **Loopback only.** Serving another machine or a hosted client is first a
  decision about authentication; [auth.md](auth.md) maps the options.

## As a systemd service

Each server runs as its own system user, with credentials only its process can
read, its own state directory, and a sandbox. One template unit serves every
server; the instance name is the server's folder name. Paths, names and the
port are examples.

1. **Install a built copy the service cannot write to, and a user for it.**
   Build in your own clone as above, then:

   ```bash
   sudo cp -a mcps /usr/local/lib/mcps
   sudo chown -R root:root /usr/local/lib/mcps
   sudo useradd --system --no-create-home --shell /usr/sbin/nologin mcp-server-oblio
   ```

2. **Put its secrets and tokens where only root can read them.** systemd
   copies them into the service's private credentials directory at each start.

   ```bash
   sudo install -d -m 0700 /etc/mcp-server/oblio
   sudo install -m 0600 app.json /etc/mcp-server/oblio/app.json
   for client in alice bob; do
     openssl rand -base64 32 | sudo tee /etc/mcp-server/oblio/token-$client > /dev/null
   done
   sudo chmod 0600 /etc/mcp-server/oblio/token-*
   ```

3. **Write the template unit**, `/etc/systemd/system/mcp-server@.service`:

   ```ini
   [Unit]
   Description=MCP server %i
   After=network-online.target
   Wants=network-online.target

   [Service]
   Type=simple
   User=mcp-server-%i
   Group=mcp-server-%i
   WorkingDirectory=/usr/local/lib/mcps/servers/%i
   ExecStart=/usr/bin/node dist/index.js
   Environment=NODE_ENV=production
   # A program a server starts may write to its home: give it the state directory.
   Environment=HOME=%S/mcp-server/%i
   # Tokens and credentials arrive in the private credentials directory (%d).
   # The server takes only the token-* files there for clients.
   Environment=MCP_HTTP_TOKENS_DIR=%d
   Environment=MCP_KEEPALIVE_MS=30000
   EnvironmentFile=/etc/mcp-server/%i/env
   StateDirectory=mcp-server/%i
   StateDirectoryMode=0700
   UMask=0077
   Restart=always
   RestartSec=2
   MemoryMax=1G

   NoNewPrivileges=yes
   CapabilityBoundingSet=
   ProtectSystem=strict
   ProtectHome=yes
   PrivateTmp=yes
   PrivateDevices=yes
   PrivateIPC=yes
   ProtectKernelTunables=yes
   ProtectKernelModules=yes
   ProtectKernelLogs=yes
   ProtectControlGroups=yes
   ProtectClock=yes
   ProtectHostname=yes
   ProtectProc=invisible
   ProcSubset=pid
   RestrictNamespaces=yes
   RestrictRealtime=yes
   RestrictSUIDSGID=yes
   LockPersonality=yes
   SystemCallArchitectures=native
   SystemCallFilter=@system-service
   SystemCallFilter=~@privileged @resources @mount @debug
   RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
   # No MemoryDenyWriteExecute=: V8's JIT needs writable executable pages.
   # A server reaches its public API and loopback, nothing on your private networks.
   IPAddressAllow=localhost
   IPAddressDeny=10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 100.64.0.0/10 169.254.0.0/16 fc00::/7 fe80::/10

   [Install]
   WantedBy=multi-user.target
   ```

4. **Name the server's credentials** in a drop-in,
   `/etc/systemd/system/mcp-server@oblio.service.d/credentials.conf`. Oblio
   finds `app.json` there by itself. A server that names a secret with a
   `_FILE` variable needs it set here too, where `%d` expands:
   `Environment=EXPO_TOKEN_FILE=%d/expo-token` beside
   `LoadCredential=expo-token:/etc/mcp-server/eas/expo-token`.

   ```ini
   [Service]
   LoadCredential=app.json:/etc/mcp-server/oblio/app.json
   LoadCredential=token-alice:/etc/mcp-server/oblio/token-alice
   LoadCredential=token-bob:/etc/mcp-server/oblio/token-bob
   ```

5. **Give it a port and the hosts it may reach** in `/etc/mcp-server/oblio/env`.
   A call to any other host fails with `egress to <host> is not allowed for
   this server (MCP_EGRESS_ALLOW)`, which names what to add.

   ```sh
   MCP_HTTP_PORT=8740
   MCP_EGRESS_ALLOW=www.oblio.eu
   ```

6. **Start it**, read its startup line, and score its sandbox (lower is
   better; this unit scores 1.3 with systemd 257):

   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now mcp-server@oblio
   journalctl -u mcp-server@oblio
   systemd-analyze security mcp-server@oblio
   ```

Two things the sandbox blocks until you allow them:

- **Private addresses.** If your DNS resolver has one (a home router, say),
  name lookups fail until you allow it, for example
  `IPAddressAllow=localhost 192.0.2.1`; an allow wins over a deny. A server
  whose device is on your network, such as the printer, needs its address
  allowed too.
- **Files in and out.** The service can write only its state directory, and
  `/home` is hidden. A folder for `MCP_FILE_ROOTS` must lie outside `/home`
  and be readable by the service user. An outbox your clients read
  (`<SERVER>_OUTBOX_DIR`) needs a `ReadWritePaths=` line, a group the service
  and the clients share, and `UMask=0027` so its files are readable by that
  group. Grants and token caches keep mode 0600 either way.

## In a container

One image holds every server, built once; a container runs one of them. Each
push to `main` that passes the checks publishes it as
`ghcr.io/foreverworks/mcps`, tagged with the commit (`:<full sha>`, what a
deployment should pin) and `:main` (the latest). To build it yourself, from a
checkout: `docker build -t mcps .`

A container is reached over a network, not on the machine's own loopback, so
the server binds every interface and lists the `Host` names its clients use
([the two variables](configuration.md#a-server-in-a-container)), and it still
wants its tokens:

```bash
mkdir tokens && openssl rand -base64 32 > tokens/token-alice
sudo chown -R 10001:10001 tokens && chmod 0400 tokens/token-alice
docker run --rm --name bnr \
  -e MCP_SERVER=bnr -e MCP_HTTP_PORT=8080 -e MCP_HTTP_HOST=0.0.0.0 \
  -e MCP_HTTP_ALLOWED_HOSTS=localhost,bnr.internal \
  -e MCP_HTTP_TOKENS_DIR=/run/tokens -v "$PWD/tokens:/run/tokens:ro" \
  -p 127.0.0.1:8080:8080 ghcr.io/foreverworks/mcps:main
```

```
bnr: listening on http://0.0.0.0:8080/mcp for alice, and Host localhost, bnr.internal; every tool enabled; ...
```

- **`MCP_SERVER` chooses the server**, or the first argument does
  (`docker run <image> bnr`). Anything else after the name goes to the server
  (`--health`). A name that is not a server lists the ones there are.
- **Publish the port where the clients are, and nowhere wider**:
  `-p 127.0.0.1:8080:8080` for this machine, or an interface's address for a
  private network. The container does not set `MCP_HTTP_HOST` for you: what it
  should bind and answer to is the deployment's to say, and it would stop the
  image running over stdio (`docker run -i <image> bnr`).
- **Credentials and tokens are files you mount**, read-only, and variables you
  pass: nothing is baked in. The process runs as the user `mcp`, id `10001`
  (group `10001`), so a token or credential file must be readable by it: give
  it the file, as above, rather than everyone.
- **State** (token caches, grants a server was given) goes to
  `/var/lib/mcp/mcps/<server>`, which `mcp` owns: mount a volume at
  `/var/lib/mcp` to keep it across containers, or set `<SERVER>_STATE_DIR`.
  A bind-mounted folder must belong to `10001:10001`.
- **The code is read-only to the process** (the image's files belong to root),
  so `--read-only` works with a `--tmpfs /tmp` and the state volume.
- **`docker stop` is immediate**: the process ends on SIGTERM, status 143, as
  it would outside a container.
- **Every server's tools list with no credentials**, so `tools/list` is a quick
  check that a container is up and its token works.

### What a server needs besides Node

The image holds Node and the servers' npm packages, nothing else. Most
servers need nothing more; these start a program that is not in the image:

| Server | Program | For |
|---|---|---|
| `printer` | `pdfinfo`, `pdftoppm` (Debian: `poppler-utils`) | printing a PDF |
| `rag` | `pdftotext` (`poppler-utils`), `ocrmypdf`, `tesseract` and the language packs you use, `pandoc` | reading PDFs, scans, images and documents; it also needs a PostgreSQL with pgvector and its embedding endpoints |
| `anaf-spv` | `java`, 8 or newer (`ANAF_SPV_JAVA`); and the command `ANAF_SPV_MAIL_MCP_COMMAND` names, if it is set | validating and filing declarations with ANAF's DUKIntegrator; reading a sign-in code through a mail server it starts over stdio |
| `devices` | `ssh` (`openssh-client`); the program of a host's control command, for a host with no ssh target | reaching the machines it leases devices on (it speaks adb's protocol itself, and needs no `adb` binary) |
| `google` | `gcloud` and a browser opener | its interactive `setup` command only, which runs on a person's computer, not in a container |

`bitwarden` runs the Bitwarden command-line client, which is one of its npm
dependencies and runs on the image's own Node. To add a program, build
`FROM` the image with one line: `RUN apt-get update && apt-get install -y
--no-install-recommends poppler-utils && rm -rf /var/lib/apt/lists/*`, run as
root (`USER root`), then `USER 10001:10001` again. The Dockerfile ends with
where a stage for one server belongs in it, to build with `--target`.

## A server on another machine

When a server runs in a container on another host, its clients no longer share
its disk, and the tools that save a file into its outbox folder or read a file
you copied into its inbox folder stop working: the folders are on the wrong
machine. Two small parts of this repository fix that without changing the
server or how a client uses it:

- **File endpoints in the server's HTTP listener**, off unless you set
  `MCP_HTTP_FILES_OUTBOX` (clients may read files below it) or
  `MCP_HTTP_FILES_INBOX` (clients may write files below it). Same tokens and
  `Host` check as the one route; paths confined to the folder
  ([configuration](configuration.md#files-to-and-from-another-machine)).
- **A relay**, [`mcp-relay`](../packages/mcp-relay), which runs on the clients'
  machine, listens on a local port like the server does, and sends what it is
  asked on to the server. Before a tool call it uploads the inbox files the
  call's arguments name; before a result that links a file in the outbox
  reaches the client, it fetches the file. Your client keeps its address, its
  token, its folders and the paths in its calls.

```bash
# on the server's machine: the server, with both directions switched on
docker run -d -e MCP_SERVER=notion -e MCP_HTTP_PORT=8080 -e MCP_HTTP_HOST=0.0.0.0 \
  -e MCP_HTTP_ALLOWED_HOSTS=mcp.example.com -e MCP_HTTP_TOKENS_DIR=/run/tokens \
  -e MCP_FILE_ROOTS=/srv/mcp/inbox -e NOTION_OUTBOX_DIR=/srv/mcp/outbox \
  -e MCP_HTTP_FILES_INBOX=/srv/mcp/inbox -e MCP_HTTP_FILES_OUTBOX=/srv/mcp/outbox \
  -v "$PWD/tokens:/run/tokens:ro" -v mcp-files:/srv/mcp \
  -p 127.0.0.1:8080:8080 ghcr.io/foreverworks/mcps:main

# on the client's machine: the relay, in front of it
MCP_HTTP_PORT=8750 MCP_HTTP_TOKEN_FILE=relay-client-token \
MCP_RELAY_UPSTREAM=https://mcp.example.com MCP_RELAY_UPSTREAM_TOKEN_FILE=upstream-token \
MCP_RELAY_INBOX=/srv/mcp/inbox MCP_RELAY_OUTBOX=/srv/mcp/outbox \
node packages/mcp-relay/dist/index.js     # or the image, with MCP_SERVER=relay
```

The relay's two folders must be at the same absolute paths as the server's,
because the server's tools name their files with their own paths and the relay
uses those names as they are. The relay's README has the whole setup, what goes
wrong and what a client then sees.

## Checking it

- **The startup line** (stderr, or the journal) names the address, the clients
  and what tools may do.
- **`tools/list`** answers on every server, even with no credentials. A tool
  that needs a missing one answers with a `config` error naming the variable.
- **`health`**, on most servers, calls the real API with the real grant and
  says what works, per account or product. Some servers also take
  `node dist/index.js --health` in a shell, which prints a line and exits
  non-zero when the credentials fail, for a timer; their READMEs say so.
- **`scripts/smoke.ts`** in a server's folder drives the built server over the
  real protocol: over stdio with your environment, or a running service with
  `MCP_URL` and `MCP_TOKEN_FILE`. Read its header first: some only read, some
  take options that write.

  ```bash
  cd servers/oblio
  MCP_URL=http://127.0.0.1:8740/mcp MCP_TOKEN_FILE=/path/to/token-alice npx tsx scripts/smoke.ts
  ```

- **The audit line.** Every call leaves one on stderr, without its arguments,
  its result or any token. Over stdio the client is `stdio`; the outcome is
  `ok`, the failure's kind, or `asked` when the call put a question to the
  person.

  ```
  audit {"svc":"oblio","tool":"list_series","client":"alice","account":null,"access":"read","outcome":"ok","ms":184}
  ```

## Upgrading

Build in your own clone, never in the copy a service runs from: each server's
build empties its `dist/` first, so a server that starts mid-build fails. Then
copy and restart. The HTTP transport is stateless, so a restart costs each
client only the call in flight, and a confirmation waiting for an answer is
asked again.

```bash
cd mcps && git pull && npm ci && npm run build
sudo rsync -a --delete ./ /usr/local/lib/mcps/ && sudo chown -R root:root /usr/local/lib/mcps
sudo systemctl restart 'mcp-server@*'
```

Every successful root build touches `.built` at the repository root, one file
to watch for a new build.

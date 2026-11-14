# mcp-relay

Run an MCP server on another machine, and keep working with files on this
one. The relay listens on a port here, looks like the server to your MCP
client, and sends everything on to the real server over HTTP. When a tool
takes a file from an inbox folder, or hands one back in an outbox folder, the
relay carries that file with the call, so the client keeps its paths, its
folders and its habits.

It is for you if a server has moved off your machine (into a container on
another host, say) and a tool that reads or writes files stopped working,
because the folders it names are now on the wrong disk.

## The problem

A server on your own machine shares your disk. A tool that saves an invoice
writes it into the server's outbox folder and answers with a link to the file;
a tool that signs a PDF reads the file you copied into the server's inbox
folder, named by path in the call. Nothing carries the bytes: both sides see
the same folder.

Move the server to another machine and that breaks twice. The link the tool
returns points at a file on a disk you cannot reach, and the path you give a
tool names a file that is not on the server's disk. MCP has no way for a
client to hand a server a file, or to fetch one back.

## What the relay does

```
  your machine                                  the server's machine
  ┌──────────────────────────────┐              ┌───────────────────────────────┐
  │ MCP client                   │              │ the server                    │
  │   │  http://127.0.0.1:8750   │   HTTPS      │   POST  /mcp                  │
  │   ▼                          │   + token    │   PUT   /files/inbox/<path>   │
  │ relay ───────────────────────┼─────────────▶│   GET   /files/outbox/<path>  │
  │   inbox folder   outbox      │              │   inbox folder   outbox       │
  └──────────────────────────────┘              └───────────────────────────────┘
```

- **Same address and token for your client.** It connects to the relay as it
  would to the server: the same route, the same bearer tokens, the same
  answers. Your client's configuration changes only by the port.
- **A file you name goes up first.** Before a `tools/call` goes on, the relay
  looks through the call's arguments for text that is an absolute path to a
  file inside its inbox folder. Each such file is uploaded to the server's
  inbox, to the same path, and checked by its SHA-256. The arguments go on
  unchanged, so the tool reads the path you wrote.
- **A file the server saved comes down before you hear of it.** When a result
  (a JSON answer, or an event of a stream) links a file in the outbox folder,
  the relay fetches the file to the same path on your machine, checks its
  SHA-256, and only then passes the result on. When you read the link, the
  file is there.
- **A stream stays a stream.** Progress and long calls reach your client as
  they happen; only an event that links a file waits for it.

The paths are the same on both machines, which is why nothing in a call needs
rewriting. **The relay's inbox and outbox folders must be at the same absolute
paths as the server's own**, because the tool on the server names its files
with its own paths and the relay uses those names as they are. If your server
keeps its inbox at `/srv/mcp/inbox`, the relay's inbox is `/srv/mcp/inbox` on
your machine too.

## Set it up

**1. On the server's machine,** switch on the file endpoints of the server's
own HTTP listener. They are off unless you set them, each for one direction.
Here the Notion server runs in a container, behind HTTPS at
`mcp.example.com`, with its inbox and outbox at `/srv/mcp/inbox` and
`/srv/mcp/outbox` (any server of this repository that takes a file by path or
saves one works the same; its credentials, left out here, are its own).
The image runs as user `10001`, so the two folders must belong to it; a fresh
Docker named volume belongs to root, and the server could not write there:

```bash
sudo install -d -o 10001 -g 10001 -m 0750 /srv/mcp/inbox /srv/mcp/outbox
docker run -d --name notion \
  -e MCP_SERVER=notion -e MCP_HTTP_PORT=8080 -e MCP_HTTP_HOST=0.0.0.0 \
  -e MCP_HTTP_ALLOWED_HOSTS=mcp.example.com \
  -e MCP_HTTP_TOKENS_DIR=/run/tokens -v "$PWD/tokens:/run/tokens:ro" \
  -e MCP_FILE_ROOTS=/srv/mcp/inbox -e NOTION_OUTBOX_DIR=/srv/mcp/outbox \
  -e MCP_HTTP_FILES_INBOX=/srv/mcp/inbox -e MCP_HTTP_FILES_OUTBOX=/srv/mcp/outbox \
  -v /srv/mcp:/srv/mcp \
  -p 127.0.0.1:8080:8080 ghcr.io/foreverworks/mcps:main
```

Behind your proxy this is `https://mcp.example.com`. Make one token for the
relay, a file called `token-relay` in the tokens folder, as for any client
([deploying](../../docs/deploying.md#over-http-one-copy-for-several-clients)).
The server's own settings for its folders (`MCP_FILE_ROOTS` for what it reads
by path, a `<SERVER>_OUTBOX_DIR` for what it saves; its README says which)
name the same two folders you gave the endpoints.

**2. On your machine,** put the same two folders in place, give the relay the
token, and start it. The relay (in the image, user `10001`) writes the files it
fetches into the outbox with mode 0640 and reads the files you put in the
inbox, so the outbox takes a group you are in, with the setgid bit: what the
relay writes there is then group-readable by you. The inbox is yours to write
and must stay readable by the relay (the usual mode 0644 is; a file you made
with `umask 077` is not, and a call naming it fails with a message that says
the relay cannot read it). From the image:

```bash
sudo install -d -o 10001 -g "$(id -g)" -m 2770 /srv/mcp/outbox   # the relay writes here; your group reads
install -d -m 0755 /srv/mcp/inbox                                # you write here; the relay only reads
umask 077; openssl rand -base64 32 > relay-client-token      # what your client will present
echo "paste the server's token-relay here" > upstream-token  # what the relay presents
sudo chgrp 10001 relay-client-token upstream-token && chmod 0640 relay-client-token upstream-token   # you and the container's user read them
docker run -d --name notion-relay \
  -e MCP_SERVER=relay -e MCP_HTTP_PORT=8750 -e MCP_HTTP_HOST=0.0.0.0 \
  -e MCP_HTTP_ALLOWED_HOSTS=localhost \
  -e MCP_HTTP_TOKEN_FILE=/run/secrets/client-token \
  -e MCP_RELAY_UPSTREAM=https://mcp.example.com \
  -e MCP_RELAY_UPSTREAM_TOKEN_FILE=/run/secrets/upstream-token \
  -e MCP_RELAY_INBOX=/srv/mcp/inbox -e MCP_RELAY_OUTBOX=/srv/mcp/outbox \
  -v "$PWD/relay-client-token:/run/secrets/client-token:ro" \
  -v "$PWD/upstream-token:/run/secrets/upstream-token:ro" \
  -v /srv/mcp:/srv/mcp -p 127.0.0.1:8750:8750 ghcr.io/foreverworks/mcps:main
```

Or from a clone, without a container (the relay is a workspace package; it is
not on npm):

```bash
npm ci && npm run build
MCP_HTTP_PORT=8750 MCP_HTTP_TOKEN_FILE=relay-client-token \
MCP_RELAY_UPSTREAM=https://mcp.example.com MCP_RELAY_UPSTREAM_TOKEN_FILE=upstream-token \
MCP_RELAY_INBOX=/srv/mcp/inbox MCP_RELAY_OUTBOX=/srv/mcp/outbox \
node packages/mcp-relay/dist/index.js
```

```
relay: listening on http://127.0.0.1:8750/mcp for default; forwarding to https://mcp.example.com/mcp; carrying files for inbox /srv/mcp/inbox and outbox /srv/mcp/outbox
```

**3. Point your client at the relay,** with the token you made for it:

```bash
claude mcp add --transport http notion http://127.0.0.1:8750/mcp \
  --header "Authorization: Bearer $(cat relay-client-token)"
```

Ask for something that saves a file, then look in `/srv/mcp/outbox`. Ask for
something that reads one: copy it into `/srv/mcp/inbox` and give its path.

## Settings

The relay listens as a server does, so the kit's HTTP variables apply to it
([configuration](../../docs/configuration.md#transport)): `MCP_HTTP_PORT`
(required), `MCP_HTTP_HOST` (default `127.0.0.1`), `MCP_HTTP_ALLOWED_HOSTS`,
`MCP_HTTP_TOKENS_DIR` or `MCP_HTTP_TOKEN_FILE` (required), and the limits
`MCP_HTTP_MAX_BODY`, `MCP_HTTP_TIMEOUT_MS` and `MCP_HTTP_RATE`. Its own:

| Variable | Default | Meaning |
|---|---|---|
| `MCP_RELAY_UPSTREAM` | required | The base URL of the server, for example `https://mcp.example.com`, without `/mcp`. A path prefix is kept (`https://example.com/mcp/oblio`). |
| `MCP_RELAY_UPSTREAM_TOKEN_FILE` | required | A file holding the bearer token the server accepts from the relay. Read once, at start. |
| `MCP_RELAY_INBOX` | unset: no file goes up | The folder your clients put files in, as an absolute path. It must be the same path as the server's inbox. |
| `MCP_RELAY_OUTBOX` | unset: no file comes down | The folder the server's saved files are brought to, as an absolute path. It must be the same path as the server's outbox. |
| `MCP_RELAY_MAX_FILE_BYTES` | `268435456` (256 MiB) | The largest file the relay moves, either way. |
| `MCP_RELAY_ALLOW_PLAIN_HTTP` | unset: refused | Set to `1` to allow an `http://` upstream on a host that is not this machine. The relay's token and the files then cross the network as they are written, so use it only on a network that is encrypted already (a VPN or an overlay). An `https://` upstream, or `http://` to this machine, needs nothing. |

On the server, the kit's file endpoints take three variables
([configuration](../../docs/configuration.md#files-to-and-from-another-machine)):
`MCP_HTTP_FILES_OUTBOX`, `MCP_HTTP_FILES_INBOX` and
`MCP_HTTP_FILES_MAX_BYTES`.

## Security

- **The same token, and nothing new to trust.** The file endpoints are routes
  of the server's own HTTP listener, behind the same bearer tokens and the
  same `Host` check as `/mcp`. A client that may call a tool may move files;
  one without a token reaches nothing. The relay holds the server's token for
  itself, in a file; your clients hold only the relay's.
- **Off by default.** A server answers `/files/...` exactly as it answers any
  route it does not have (a 404) until `MCP_HTTP_FILES_OUTBOX` or
  `MCP_HTTP_FILES_INBOX` turns that direction on. Each direction is its own
  switch, and a server open to anyone (`MCP_HTTP_PUBLIC_HOSTS`) refuses to
  start with either.
- **Paths are confined, on both machines.** The server resolves every path
  (percent-decoded once; no empty names, `.`, `..`, NUL or backslash; links
  followed) and serves or writes only a regular file whose real path is inside
  the folder, whatever the request says; anything else is the same bare 404,
  which says nothing about the folder. The relay does the same for what it
  sends and writes: a file that is a link out of the inbox is not sent, and a
  link in the outbox cannot lead a write out of it.
- **Whole or not at all, and checked.** Every file crosses with its SHA-256.
  A write goes to a temporary file in the target's folder and is renamed into
  place only when the bytes match; a file that arrives damaged, or is cut
  short, leaves nothing behind, and the folders made for it are taken away
  again. Files are written with mode 0640 (less what the process's umask takes
  away), so give the folder the group that must read them, with the setgid
  bit, as in the setup above.
- **Only what a call names.** The relay uploads a file only when a string in
  a `tools/call`'s arguments is the absolute path of a regular file in its
  inbox, and fetches a file only when a result links it in its outbox.
  Nothing else on either disk is reachable through it.
- **Nothing sensitive in the log or the errors.** The relay logs one line per
  file moved (direction, path, size, the first 12 characters of the hash),
  never a file's bytes, a token or the value of an argument. An error names
  the file and the reason, and the upstream's token is taken out of anything
  the upstream wrote.
- **HTTPS to a server on a network you do not own.** The token and the files
  travel as the upstream URL says. The relay refuses to start with a plain
  `http://` upstream on a host that is not this machine, unless
  `MCP_RELAY_ALLOW_PLAIN_HTTP=1` says the network is encrypted already (a VPN,
  an overlay); it then prints a warning at start.

## When something goes wrong

| What happens | What the client sees |
|---|---|
| The relay's token is missing or wrong | A 401, as from the server. The upstream is not contacted. |
| The server cannot be reached | A 502: `the upstream could not be reached (ECONNREFUSED)`. |
| The server refuses the relay's token | A 502, never a 401 (your client's own token was fine): `the upstream refused the relay's token (401); check MCP_RELAY_UPSTREAM_TOKEN_FILE`. |
| The server fails or says no | The same status, with words that say it was the upstream: `the upstream failed (500): ...`. |
| A file named in a call cannot be uploaded | The call is not made. A JSON-RPC error names the file and why, for example `The relay could not send /srv/mcp/inbox/scan.pdf to the server, so the call was not made: the upstream refused the file as too large (413)`. In a batch the other calls go on. |
| A file a result links cannot be fetched | The result goes through unchanged, with one text item added at the end that names each file and why. |
| A link is to anywhere but a `file:` path in the outbox | Left alone. |

## Good to know

- **Protocols.** Both generations the kit serves (2025-11-25 and
  2026-07-28) pass through, with every `Mcp-*` header, `Accept`,
  `Content-Type` and `Last-Event-ID`. A server of the kit is stateless, so its
  answer to a GET or DELETE is its usual 405, passed on with a sentence saying
  who said it.
- **Only absolute paths are carried.** An argument that is a relative path, a
  bare name or a `file://` URL is not looked at; the tool's description says
  what it takes, and for a file it is an absolute path.
- **Only `file:` links to the outbox are fetched.** A link to a web address, or
  to a file anywhere else, is for the client to deal with.
- **If the server stores a file elsewhere** than the path in the call (its
  inbox is a different folder), the relay writes a `relay-warning` line saying
  so, and the call goes on; the tool then cannot find the file. Make the
  folders the same path.
- **Answers are passed on as they were written.** The relay reads a JSON
  answer or an event only to look for links, and sends the original text on:
  `12.50` stays `12.50`, and a big integer keeps every digit. When it must add
  a note to a result, or a call's error to a batch's answers, it adds just
  that to the text. Only an answer or an event over 64 MiB is refused (a 502
  for an answer; a stream is ended after its last whole event). A file is
  never held in memory; it streams.
- **A request is as long as a call may be.** `MCP_HTTP_TIMEOUT_MS` (15 minutes
  by default) bounds a call including its uploads and fetches.

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
- **Each client can keep its own rights.** The relay can present a token of
  its own to the server for each of your clients, so the server still sees, and
  limits, the client that really called ([below](#give-each-client-its-own-rights)).

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
This is the simplest setup, and right for one client. If several clients will
use the relay and the server should tell them apart, make a token for each
instead, and read [Give each client its own
rights](#give-each-client-its-own-rights) before step 2.
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
relay: listening on http://127.0.0.1:8750/mcp for default; forwarding to https://mcp.example.com/mcp with one token; carrying files for inbox /srv/mcp/inbox and outbox /srv/mcp/outbox
```

**3. Point your client at the relay,** with the token you made for it:

```bash
claude mcp add --transport http notion http://127.0.0.1:8750/mcp \
  --header "Authorization: Bearer $(cat relay-client-token)"
```

Ask for something that saves a file, then look in `/srv/mcp/outbox`. Ask for
something that reads one: copy it into `/srv/mcp/inbox` and give its path.

## Give each client its own rights

The relay holds the token the server accepts, and there are two ways to give
it one. Pick before you start, because they differ in what the server can tell.

- **One token for everyone** (`MCP_RELAY_UPSTREAM_TOKEN_FILE`, the setup
  above). Every client of the relay reaches the server under that one token,
  so to the server they are one client with one set of rights, one line in its
  audit log and one rate limit. This is right when you have a single client,
  or when everything behind the relay may do what that token may.
- **A token for each client** (`MCP_RELAY_UPSTREAM_TOKENS_DIR`). A folder with
  one `upstream-<client>` file for each client of the relay. A call from alice
  goes to the server with alice's token and nobody else's, so the server
  holds alice to what it allows alice.

**Why it matters.** Say the server runs with `MCP_CLIENT_MAX_ACCESS=alice=read`,
so alice may read but not write, and bob may do more
([configuration](../../docs/configuration.md#what-tools-may-do)). Behind a
relay with one token, that setting cannot hold: alice and bob arrive as the
same client, so either both may write or neither may. Behind a relay with a
token for each, alice's request is alice's at the server, and a tool that
writes is refused for her (`access_denied`, naming alice) while bob's call
goes through. The relay adds no rights of its own and takes none away: **a
client can do through the relay what its upstream token may do on the server,
and no more.** The ceiling is always the server's.

**A held client gets back only its own files.** The ceiling checks tool
calls, and a file crosses outside them: an upload lands in the server's inbox
without a tool running, and the outbox holds what every client's calls
produced. So the server's file endpoints refuse a client named in
`MCP_CLIENT_MAX_ACCESS`, whatever its class, everything but the files its own
calls handed back. Through the relay, alice (held to `read`) can call a `read`
tool that saves a file and links it (an e-mail attachment, an invoice archive,
a downloaded document), and the relay brings that file to her machine as it
does for bob. A call whose arguments name a file in the relay's inbox is not
made for her, and a link to a file another client's call saved is not
followed, even when a result of hers carries it; each says why in words of
its own, not as a refused token. Bob, with no ceiling, moves files as before.

The server remembers which files were alice's in memory, for as long as its
outbox keeps them (`MCP_HTTP_FILES_MAX_AGE_MIN`, or 24 hours without it), and
forgets them when it restarts. The relay fetches a linked file right after the
call, so only a restart in that moment shows: the result carries a note that
names the file and says the server no longer remembers the call, and calling
the tool again brings it. If alice needs a tool that takes a file, give her a
server of her own, or take her out of `MCP_CLIENT_MAX_ACCESS`.

**Set it up.** Make a token on the server for each client, a `token-alice` and
a `token-bob` in its tokens folder, and put each token in a file on the
relay's machine, readable by the container's user (uid 10001), as in the setup
above:

```bash
# on the relay's machine: what alice and bob present to the relay ...
mkdir -p tokens upstream-tokens; umask 077
for c in alice bob; do openssl rand -base64 32 > tokens/token-$c; done
# ... and what the relay presents to the server for each: the server's token-alice and token-bob
cp server-token-alice upstream-tokens/upstream-alice; cp server-token-bob upstream-tokens/upstream-bob
sudo chgrp -R 10001 tokens upstream-tokens && chmod 0750 tokens upstream-tokens && chmod 0640 tokens/* upstream-tokens/*
```

A file the container cannot read stops the relay at start with
`cannot be read: EACCES`, naming the file: the group and mode above prevent it.

Then start the relay with `MCP_HTTP_TOKENS_DIR` (its clients, as before) and
`MCP_RELAY_UPSTREAM_TOKENS_DIR` in place of the single file:

```bash
docker run -d --name notion-relay \
  -e MCP_SERVER=relay -e MCP_HTTP_PORT=8750 -e MCP_HTTP_HOST=0.0.0.0 \
  -e MCP_HTTP_ALLOWED_HOSTS=localhost \
  -e MCP_HTTP_TOKENS_DIR=/run/tokens \
  -e MCP_RELAY_UPSTREAM=https://mcp.example.com \
  -e MCP_RELAY_UPSTREAM_TOKENS_DIR=/run/upstream-tokens \
  -e MCP_RELAY_INBOX=/srv/mcp/inbox -e MCP_RELAY_OUTBOX=/srv/mcp/outbox \
  -v "$PWD/tokens:/run/tokens:ro" -v "$PWD/upstream-tokens:/run/upstream-tokens:ro" \
  -v /srv/mcp:/srv/mcp -p 127.0.0.1:8750:8750 ghcr.io/foreverworks/mcps:main
```

```
relay: listening on http://127.0.0.1:8750/mcp for alice, bob; forwarding to https://mcp.example.com/mcp with a token of its own for each client; carrying files for inbox /srv/mcp/inbox and outbox /srv/mcp/outbox
```

**Where people get stuck.**

- **The file is named after the client.** The relay's clients are named by the
  `token-<client>` files of `MCP_HTTP_TOKENS_DIR`: `token-alice` is the client
  `alice`, so its upstream file is `upstream-alice`. A relay with a single
  client token in `MCP_HTTP_TOKEN_FILE` has one client, `default` (or the name
  in `MCP_HTTP_TOKEN_CLIENT`), so the file is `upstream-default`. The file
  holds the token the *server* knows that client by. The server names a client
  by its own token file, so what appears in its audit line and in
  `MCP_CLIENT_MAX_ACCESS` there is that name (`token-laptop` is `laptop`),
  which need not be the name the relay uses.
- **The relay will not start until every client has one.** A client with no
  `upstream-<client>` file, or one that is empty, cannot be read, or has a
  space or other control character inside the token, makes the relay stop
  with a message that names the client and the file (never the token). There
  is no fallback to another client's token: that would hand the client rights
  it was never given. A name that cannot be a file name (a slash in
  `MCP_HTTP_TOKEN_CLIENT`, say) is refused with that said.
- **Two clients with the same token are refused,** by name. They would be one
  client to the server again, under whatever name that token has there and with
  that token's rights, which is what you chose a folder to avoid. Give each its
  own token on the server. If they may share, that is the single file.
- **Read once, at start.** A client you add later needs its
  `token-<client>` and its `upstream-<client>` files and a restart of the relay,
  and so does a token you change. A file for a client the relay does not have
  is ignored, and a client whose local token file is empty (a client this
  deployment does not have) needs no upstream file.
- **One folder can hold both.** `MCP_RELAY_UPSTREAM_TOKENS_DIR` may be the same
  folder as `MCP_HTTP_TOKENS_DIR` (a systemd credentials directory, say). The
  relay reads `token-*` from it for its clients and `upstream-*` for the
  server, and neither reads the other's files.
- **Several clients, one token file.** If you give the relay more than one
  client and only `MCP_RELAY_UPSTREAM_TOKEN_FILE`, it starts, because
  that is sometimes what you want, and writes one `WARNING` line naming the
  clients: they all reach the server with the same token and the same rights.
  A single client gets no warning.

## Settings

The relay listens as a server does, so the kit's HTTP variables apply to it
([configuration](../../docs/configuration.md#transport)): `MCP_HTTP_PORT`
(required), `MCP_HTTP_HOST` (default `127.0.0.1`), `MCP_HTTP_ALLOWED_HOSTS`,
`MCP_HTTP_TOKENS_DIR` or `MCP_HTTP_TOKEN_FILE` (required), and the limits
`MCP_HTTP_MAX_BODY`, `MCP_HTTP_TIMEOUT_MS` and `MCP_HTTP_RATE`. Its own:

| Variable | Default | Meaning |
|---|---|---|
| `MCP_RELAY_UPSTREAM` | required | The base URL of the server, for example `https://mcp.example.com`, without `/mcp`. A path prefix is kept (`https://example.com/mcp/oblio`). |
| `MCP_RELAY_UPSTREAM_TOKEN_FILE` | one of the two is required | A file holding the bearer token the server accepts from the relay, for all the relay's clients: they share its rights. Read once, at start. Set this or `MCP_RELAY_UPSTREAM_TOKENS_DIR`, never both. |
| `MCP_RELAY_UPSTREAM_TOKENS_DIR` | one of the two is required | A folder with an `upstream-<client>` file for each client of the relay, holding the token the server knows that client by ([above](#give-each-client-its-own-rights)). The relay refuses to start without a usable file for every client it accepts. Read once, at start. |
| `MCP_RELAY_INBOX` | unset: no file goes up | The folder your clients put files in, as an absolute path. It must be the same path as the server's inbox. |
| `MCP_RELAY_OUTBOX` | unset: no file comes down | The folder the server's saved files are brought to, as an absolute path. It must be the same path as the server's outbox. |
| `MCP_RELAY_MAX_FILE_BYTES` | `268435456` (256 MiB) | The largest file the relay moves, either way. |
| `MCP_RELAY_ALLOW_PLAIN_HTTP` | unset: refused | Set to `1` to allow an `http://` upstream on a host that is not this machine. The relay's token and the files then cross the network as they are written, so use it only on a network that is encrypted already (a VPN or an overlay). An `https://` upstream, or `http://` to this machine, needs nothing. |

On the server, the kit's file endpoints take four variables
([configuration](../../docs/configuration.md#files-to-and-from-another-machine)):
`MCP_HTTP_FILES_OUTBOX`, `MCP_HTTP_FILES_INBOX`, `MCP_HTTP_FILES_MAX_BYTES` and
`MCP_HTTP_FILES_MAX_AGE_MIN`. The last one deletes the files from both folders
after that many minutes: set it when the server's folders are tmpfs in a
container, where nothing else clears them, since your machine keeps the real
copy of every file the relay moves.

## Security

- **The same token, and nothing new to trust.** The file endpoints are routes
  of the server's own HTTP listener, behind the same bearer tokens and the
  same `Host` check as `/mcp`. A client that may call a tool may move files;
  one without a token reaches nothing. The relay holds the server's tokens for
  itself, in files; your clients hold only the relay's.
- **A client keeps its own rights.** With `MCP_RELAY_UPSTREAM_TOKENS_DIR` a
  call, a stream, and every file moved for a client go upstream under that
  client's token and no other, so the server's ceiling for the client
  (`MCP_CLIENT_MAX_ACCESS`), its audit line and its rate limit are the real
  client's. A client with a ceiling sends no files and gets back only the ones
  its own calls handed back: the server's file endpoints are for clients with
  none, so a held client's upload, and its download of any other file, are
  refused (403) and the relay says so. The relay cannot lift a client above its upstream token, and it has
  no fallback: a client without a token of its own is a relay that does not
  start. With the single `MCP_RELAY_UPSTREAM_TOKEN_FILE` your clients share
  one identity and one set of rights, the highest any of them needs, which is
  why the relay warns when it has more than one.
- **A session is not bound to a client by the relay.** The relay passes
  `Mcp-Session-Id` and the other `Mcp-*` headers on as they come, and signs
  each request with the token of the client that sent it. It does not remember
  which client opened a session, so a server that keeps sessions has to tie
  them to a token itself (the kit's servers keep none).
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
| The server refuses the relay's token | A 502, never a 401 (your client's own token was fine): `the upstream refused the relay's token (401); check MCP_RELAY_UPSTREAM_TOKEN_FILE`. With a token for each client it names the client and its file: `the upstream refused the relay's token for alice (401); check upstream-alice in MCP_RELAY_UPSTREAM_TOKENS_DIR`. Only that client is affected. |
| The server's ceiling for the client is below the tool's class | The server's own answer, passed on: the tool result is an `access_denied` that names the client and the setting (`MCP_CLIENT_MAX_ACCESS`). Raise it on the server for that client; nothing in the relay can. |
| The server fails or says no | The same status, with words that say it was the upstream: `the upstream failed (500): ...`. |
| The server's file endpoints refuse the client (403), because it is held to a ceiling | A file named in a call is not sent and the call is not made: `the upstream takes no files from alice (403): alice's calls are limited by a ceiling (MCP_CLIENT_MAX_ACCESS on the server), ...`. Use a client with no ceiling for a tool that takes a file. A file a result links that is not one of alice's own calls' files, or one the server no longer remembers (it restarted), is not fetched: `the upstream does not give alice this file (403): ...`. If the file came from alice's own call, call the tool again. The words say it is the client's ceiling, not the token. |
| A file named in a call cannot be uploaded | The call is not made. A JSON-RPC error names the file and why, for example `The relay could not send /srv/mcp/inbox/scan.pdf to the server, so the call was not made: the upstream refused the file as too large (413)`. In a batch the other calls go on. |
| A file a result links cannot be fetched | The result goes through unchanged, with one text item added at the end that names each file and why. |
| A link is to anywhere but a `file:` path in the outbox | Left alone. |

When the relay does not start, it says why on stderr and exits, and nothing
listens. Every message names the setting and the clients or files at fault,
and never a token.

| The message says | What to do |
|---|---|
| `MCP_RELAY_UPSTREAM_TOKEN_FILE is not set, and neither is MCP_RELAY_UPSTREAM_TOKENS_DIR` | Set one: a file for one token shared by all, a folder for a token each. |
| `MCP_RELAY_UPSTREAM_TOKEN_FILE and MCP_RELAY_UPSTREAM_TOKENS_DIR are both set` | Set only one; which of them gives a client its rights would otherwise be a guess. |
| `... has no usable token for some clients of this relay: bob (upstream-bob is missing), ...` | Add the file, or fill the empty one, for every client named. A client you do not mean to have is the `token-<client>` file to remove (or empty) on the relay. |
| `... (upstream-bob has whitespace or a control character inside the token ...)` | The file holds more than a token, a pasted line break or a note among them. Only the white space at the ends is dropped; rewrite the file with the token alone. |
| `... "../x" (not a name a file can have ...)` | The client's name has a slash, a backslash or a NUL, or is too long. Rename the `token-<client>` file, or `MCP_HTTP_TOKEN_CLIENT`. |
| `... has the same token in the upstream-<client> files of alice and bob` | Give each client a token of its own on the server, or use the single `MCP_RELAY_UPSTREAM_TOKEN_FILE` if they may share. |

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

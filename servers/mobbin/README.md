# <img src="icons/icon.svg" width="36" height="36" alt="Mobbin icon"> Mobbin MCP server

Search [Mobbin](https://mobbin.com)'s library of real app screens, flows and
sections from any AI assistant, including the ones that cannot sign in to
Mobbin themselves. This server holds one sign-in to a Mobbin account, keeps it
fresh, and serves Mobbin's own search tools to every client that presents this
server's token. Nothing it forwards changes your Mobbin account, and no tool is
`money`. Its own sign-in tools are `write`: they change only what this server
keeps on disk.

**You need** a Mobbin account (the plan decides what Mobbin lets you search),
and a one-time sign-in in a browser where you are logged in to it. Mobbin's
"deep" search mode spends your account's AI credits; the "standard" mode is
free. Tokens are kept on the machine that runs this server, in its state
directory, never printed and never sent to a client.

## What you can ask

- "Show me how apps handle onboarding for a banking product."
- "Find checkout flows with a promo code field."
- "What do pricing sections look like on the best mobile subscription apps?"
- "Search Mobbin for empty states in a to-do app, then describe what they have in common."
- "Is the Mobbin connection still working, and when does its sign-in need renewing?"

**Why a bridge, when Mobbin has its own server.** Mobbin runs its own official
MCP server at `api.mobbin.com/mcp`, and it needs OAuth: whoever connects signs
in as themselves, and every client keeps its own grant. That is the right design for a person at a desktop client. It does not
fit three common cases: a client that cannot do OAuth at all (a script, a
headless agent, a hosted assistant), a team that does not want every client
holding its own long-lived grant to one account, and a deployment that wants
the refresh of that grant done in one place.

This server is the bridge for those cases. It is not a replacement for
Mobbin's server and it does not scrape anything: it is an MCP client of Mobbin's
official server on one side and an ordinary MCP server on the other.

- **One grant, held server-side.** You sign in once. The access and refresh
  tokens stay in this server's state directory (file mode 0600).
- **Refresh handled in one place.** Mobbin's sign-in service rotates the refresh
  token on every use, so two clients refreshing at once would break each other.
  Here one refresh runs at a time, and the new pair is saved before the new
  access token is used.
- **A token per client.** Over HTTP, clients authenticate to this server with
  its own bearer tokens (`MCP_HTTP_TOKENS_DIR`), one per client, which you can
  issue and revoke without touching your Mobbin sign-in. Over stdio the client
  is whoever started the process.

## Install

<!-- install:begin -->
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect/mcp/install?name=mobbin&inputs=%5B%7B%22type%22%3A%22promptString%22%2C%22id%22%3A%22mobbin_redirect_uri%22%2C%22description%22%3A%22Optional.%20Where%20the%20browser%20lands%20after%20you%20sign%20in%20to%20Mobbin%3B%20it%20need%20not%20be%20reachable.%20Defaults%20to%20a%20loopback%20address.%22%7D%5D&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40foreverworks%2Fmcp-mobbin%22%5D%2C%22env%22%3A%7B%22MOBBIN_REDIRECT_URI%22%3A%22%24%7Binput%3Amobbin_redirect_uri%7D%22%7D%7D) [![Install in Cursor](https://img.shields.io/badge/Cursor-Install_Server-000000?style=flat-square&logo=cursor&logoColor=white)](https://cursor.com/install-mcp?name=mobbin&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBmb3JldmVyd29ya3MvbWNwLW1vYmJpbiJdLCJlbnYiOnsiTU9CQklOX1JFRElSRUNUX1VSSSI6IiR7ZW52Ok1PQkJJTl9SRURJUkVDVF9VUkl9In19) [![Download for Claude Desktop](https://img.shields.io/badge/Claude_Desktop-Download_Bundle-D97757?style=flat-square&logo=claude&logoColor=white)](https://github.com/foreverworks/mcps/releases/latest/download/mcp-mobbin.mcpb)

With Claude Code:

```bash
claude mcp add mobbin -- npx -y @foreverworks/mcp-mobbin
```

Claude Desktop (Settings, Developer, Edit Config) and most other clients read the same command as JSON:

```json
{
  "mcpServers": {
    "mobbin": {
      "command": "npx",
      "args": ["-y", "@foreverworks/mcp-mobbin"]
    }
  }
}
```

Each runs the published package on Node 22.19 or newer. VS Code and the Claude Desktop bundle ask for `MOBBIN_REDIRECT_URI` as they add the server. Cursor reads it from your environment instead (`${env:MOBBIN_REDIRECT_URI}`), so set it before you start Cursor. Every setting is optional; [Configuration](#configuration) says which ones you need for which tools.

### From a clone

```bash
git clone https://github.com/foreverworks/mcps.git && cd mcps
npm ci && npm run build
claude mcp add mobbin -- node "$PWD/servers/mobbin/dist/index.js"
```

In a JSON configuration, the command is `node` and its one argument the full path of `servers/mobbin/dist/index.js`. To share one running copy between several clients over HTTP, see [docs/deploying.md](../../docs/deploying.md).
<!-- install:end -->

> [!NOTE]
> The commands above name the published package, which does not exist yet:
> this server is on `main` but has no release, so `npx` and the Claude Desktop
> bundle find nothing. Until its first release, [run it from a
> clone](#from-a-clone).

## Configuration

| Variable | Required | Meaning |
|---|---|---|
| `MOBBIN_MCP_URL` | no | Mobbin's MCP server. Default `https://api.mobbin.com/mcp`. The sign-in service is found from this address at run time, never hard-coded. |
| `MOBBIN_REDIRECT_URI` | no | Where the browser lands after you sign in. It need not be listening: you copy the address from the browser. Default `http://127.0.0.1:8976/callback`. It must be https, or http on a loopback host, or the server does not start. Changing it registers a new client at the next `begin_authorization`. |
| `MOBBIN_SCOPE` | no | The scopes to ask for, separated by spaces. Default: what Mobbin's server asks for, plus `offline_access` when the sign-in service offers it, which is what returns a refresh token. |
| `MOBBIN_STATE_DIR` | no | Where the grant, the registered client and the last tool list are kept. Default: `$STATE_DIRECTORY` when a systemd service sets it, else `$XDG_STATE_HOME/mcps/mobbin` (`~/.local/state/mcps/mobbin`; `%APPDATA%\mcps\mobbin` on Windows). |

The variables every server shares (the HTTP listener and its tokens, limits,
`MCP_EGRESS_ALLOW`) are in [docs/configuration.md](../../docs/configuration.md).
A process limited by `MCP_EGRESS_ALLOW` must allow `api.mobbin.com` and the
host of Mobbin's sign-in service, which `begin_authorization` and `health`
name in their answers.

### Connecting a Mobbin account

You do this once per deployment, from any client of this server.

1. Ask the assistant to call `begin_authorization`. It registers this server
   with Mobbin's sign-in service and returns `authorize_url`.
2. Open `authorize_url` in a browser where you are signed in to Mobbin, and
   allow access. The browser then goes to `MOBBIN_REDIRECT_URI` (by default
   `http://127.0.0.1:8976/callback`) with `?code=...&state=...` after it. The
   page itself fails to load, because nothing listens there: that is expected.
3. Copy the whole address from the browser's address bar and give it to the
   assistant, which passes it to `complete_authorization` as `redirect_url`.
   The whole address is needed, not just the code: its `state` is checked.
   You have ten minutes from step 1.
4. Call `health`. It should say `ok: true`, when the access token ends, and
   the tools Mobbin offers.

## First run

1. Call `health`. Before the sign-in it says `ok: false` and that there is no
   grant; that is the starting point, not a fault.
2. Connect the account as above.
3. Call `search_screens` with a short query. The three search tools take the
   fields Mobbin publishes for them; this server lists them once the grant has
   seen Mobbin's tool list (`health` does that), and until then passes any
   object on and lets Mobbin check it.

## Tools

Every tool is **read** or **write**; none is `money`. Mobbin's tools keep their
own names, descriptions and input fields: this server takes them from Mobbin's
own tool list, caches that list in `tools.json` in the state directory, and
serves them as given, so what you see is what Mobbin published when the list
was last read.

### This server's

| Tool | Access | What it does |
|---|---|---|
| `health` | read | Whether a grant exists and when its access token ends, whether Mobbin answers, how many tools it lists, which are offered here, which Mobbin lists that are not classified (hidden), and which classified ones it no longer lists. Never refreshes the grant and never prints a token. |
| `refresh_grant` | write | Refreshes the grant now, to prove the refresh token works. Calls refresh a due token by themselves; this is a check, and it rotates the grant. |
| `begin_authorization` | write | Registers this server as a client of Mobbin's sign-in service when needed, and returns the link to open in a browser signed in to Mobbin. |
| `complete_authorization` | write | Takes the whole address the browser landed on, checks its state belongs to the sign-in begun, exchanges its code once, and stores the grant. A new client registration replaces the old one only together with the new grant. |

### Mobbin's, forwarded

| Tool | Access | What it does |
|---|---|---|
| `search_screens` | read | Mobbin's search over app screens, answered as Mobbin answers it. Its `deep` mode spends AI credits. |
| `search_flows` | read | Mobbin's search over user flows, answered as Mobbin answers it. |
| `search_sections` | read | Mobbin's search over sections of screens, answered as Mobbin answers it. |

A tool Mobbin adds later is not offered until its class is decided here, in
the code (`src/mcp/policy.ts`): `health` names it under `hidden`, so you can
see that something is waiting. This is on purpose: a bridge that forwarded
whatever Mobbin lists would hand a client a tool nobody here has read.

## Troubleshooting

**`not_authorized`**. There is no grant, or Mobbin refused the refresh token
with `invalid_grant` or `invalid_client` (the account revoked access, or the
token had not been used for a long time). Only those two end a grant: a busy or
failing Mobbin (429, 5xx) answers `unreachable` or `upstream`, keeps the grant
and is worth retrying. The dead grant is dropped, so the next calls say "no
Mobbin account is connected to this server yet" at once. Connect the account
again as above.

**`authorization`: "no sign-in is open" or "closed"**. The address was used
already, or the sign-in is more than ten minutes old. Call `begin_authorization`
for a new link.

**`authorization`: "another sign-in"**. The address belongs to a link that a
later `begin_authorization` replaced. Use the newest link.

**`authorization`: "no refresh token"**. Mobbin granted access but sent no
refresh token, so the grant would end within the hour and was not stored. Make
sure the sign-in asks for `offline_access` (the default does when Mobbin's
sign-in service offers it, or set `MOBBIN_SCOPE`).

**`discovery`**. The sign-in documents were not found or are not what this
server expects: `MOBBIN_MCP_URL` is wrong, Mobbin cannot be reached, or Mobbin
changed its sign-in. The message names the address.

**`unreachable`** and **`upstream`**. Mobbin or its sign-in service did not
answer, or answered with a failure of its own. Retry; call `health` if it
keeps happening.

## How it works

**Discovery.** The server does not know where Mobbin signs people in. It
sends a request without a token to `MOBBIN_MCP_URL`, reads the 401's
`WWW-Authenticate: Bearer resource_metadata=...` (RFC 9728), reads that
document for the authorization server, then the server's own metadata
(RFC 8414) for the authorize, token and registration endpoints. Each document
must name what was asked about (the resource, the issuer), and every endpoint
must be https. The pieces are generic and live in the shared toolkit
(`oauthDiscovery.ts`, `rotatingGrant.ts`), so another server can bridge another
OAuth-only MCP server the same way.

**Registration and PKCE.** It registers a public client by dynamic client
registration (RFC 7591), stores the client id, and signs in with the
authorization-code flow and PKCE (S256). The verifier and the state wait in
the state directory between the two calls, so a restart in between loses
nothing.

**Rotating refresh tokens.** A refresh, like a code exchange, is sent once and
never resent: a resend after a lost answer would present a token Mobbin already
rotated. Refreshing is one exchange at a time, in this process and across processes (a lock in the state directory). The new access
and refresh tokens are written, atomically, before the access token is used;
a write that fails fails the refresh, and a crash after it loses nothing. A
call whose token Mobbin refuses before its stated expiry refreshes once and
retries once.

**Forwarding.** Each call opens a short connection to Mobbin's MCP server
(Streamable HTTP) with the access token and closes it after. The answer is
returned as Mobbin gave it, including a result Mobbin marks as an error. This
server builds its tools per request, so it lists each of Mobbin's tools with
the description and input fields Mobbin last published, kept in
`tools.json` in the state directory.

**State.** In `MOBBIN_STATE_DIR`, each file written whole at mode 0600:
`grant.json` (the tokens), `client.json` (the registered client and the
endpoints it signs in at), `candidate.json` (a new client registration, kept
apart until its sign-in completes), `pending.json` (the sign-in in progress)
and `tools.json` (Mobbin's last tool list).

## Limitations

- One Mobbin account per server. For a second, run a second copy with its own
  state directory.
- It forwards Mobbin's tools; it adds none. What Mobbin lets the account search
  and how much is Mobbin's to decide.
- A new Mobbin tool needs a code change before anyone can call it (see
  [Tools](#tools)).
- The sign-in needs a person with a browser, once, and again if the grant is
  revoked or unused for long enough that Mobbin expires it.
- Mobbin's MCP server is Mobbin's: if it changes how it signs people in or
  what its tools take, this server follows after an update.

## Other servers for Mobbin

Searched on 2026-11-21 (Mobbin's site, the MCP registry, npm, GitHub):

- **Mobbin's own hosted server**, `https://api.mobbin.com/mcp`, official and
  OAuth-only. This server bridges it rather than replacing it, and uses it as
  the one source of truth: nothing is scraped. Use it directly when your client
  can sign in and you want your own account in it.
- **`mobbin-mcp` on npm**, a community server that scrapes Mobbin's web app with
  session cookies you copy out of a browser. It does not use the official
  server, depends on page internals that can change, and needs a cookie
  refreshed by hand.
- **Composio's Mobbin connector**, a hosted integration inside Composio's own
  platform, for people who already use it.

What this server does that they do not: one OAuth grant held in one place for
many clients that cannot sign in, with the rotating refresh token handled
safely, and a separate token for each client.

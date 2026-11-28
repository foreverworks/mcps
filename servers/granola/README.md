# <img src="icons/icon.svg" width="36" height="36" alt="Granola icon"> Granola MCP server

Search and read your [Granola](https://www.granola.ai) meetings, notes, AI
summaries and transcripts from any AI assistant or script, including the ones
that cannot sign in to Granola themselves. This server holds one sign-in to a
Granola account, keeps it fresh, and serves Granola's own read-only tools to
every client that presents this server's token. It cannot change anything in
Granola: the tools that edit notes, folders or the account are left out on
purpose, and no tool is `money`. Its own sign-in tools are `write`: they change
only what this server keeps on disk.

**You need** a Granola account and a one-time sign-in in a browser. The plan
decides what Granola lets you read: on the free plan, notes from the last 30
days; the transcript tools (`get_meeting_transcript`, `search_transcripts`) need
a paid plan, and `get_agent_brief` needs Business or Enterprise. Granola limits
how often each tool may be called (see [Limits](#limits-set-by-granola)).
Tokens are kept on the machine that runs this server, in its state directory,
never printed and never sent to a client.

## What you can ask

- "What did we decide about pricing in last week's product meetings?"
- "Find every meeting with Ana Popescu since March and list the open action items."
- "Pull the transcript of Tuesday's design review and tell me who raised the onboarding concern."
- "Search my transcripts for 'data retention' and show me where it came up."
- "Is the Granola connection still working, and when does its sign-in need renewing?"

**Why a bridge, when Granola has its own server.** Granola runs its own official
MCP server at `https://mcp.granola.ai/mcp`. It uses OAuth with a browser
sign-in, supports no API keys, and each connection signs in as one person. That is the right design for a person at a
desktop client. It does not fit three common cases: a client that cannot do OAuth
at all (a script, a headless agent, a scheduled job), a setup where every client
would otherwise hold its own long-lived grant to your account, and a deployment
that wants the refresh of that grant done in one place.

This server is the bridge for those cases. It is not a replacement for
Granola's server and it does not scrape anything: it is an MCP client of Granola's
official server on one side and an ordinary MCP server on the other.

- **One grant, held server-side.** You sign in once. The access and refresh
  tokens stay in this server's state directory (file mode 0600).
- **Read-only by construction.** Granola's write and account tools are never
  registered here, so a client that can read your meetings cannot rename them,
  rewrite their summaries, move them between folders or sign the account out.
- **Transcripts untouched.** The content of each result comes back as Granola
  sent it, with no rewriting, so a transcript here is the text Granola returns.
- **Refresh handled in one place.** Granola's sign-in service rotates the refresh
  token on every use, so two clients refreshing at once would break each other.
  Here one refresh runs at a time, and the new pair is saved before the new
  access token is used.
- **A token per client.** Over HTTP, clients authenticate to this server with
  its own bearer tokens (`MCP_HTTP_TOKENS_DIR`), one per client, which you can
  issue and revoke without touching your Granola sign-in. Over stdio the client
  is whoever started the process. Every client token can call the three
  sign-in tools (`begin_authorization`, `complete_authorization`,
  `refresh_grant`), and so can replace the one grant. To keep a client to
  reading, give it a ceiling with `MCP_CLIENT_MAX_ACCESS`, for example
  `reader=read` ([configuration](../../docs/configuration.md)).

## Install

<!-- install:begin -->
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect/mcp/install?name=granola&inputs=%5B%7B%22type%22%3A%22promptString%22%2C%22id%22%3A%22granola_redirect_uri%22%2C%22description%22%3A%22Optional.%20Where%20the%20browser%20lands%20after%20you%20sign%20in%20to%20Granola%3B%20it%20need%20not%20be%20reachable.%20Defaults%20to%20a%20loopback%20address.%22%7D%5D&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40foreverworks%2Fmcp-granola%22%5D%2C%22env%22%3A%7B%22GRANOLA_REDIRECT_URI%22%3A%22%24%7Binput%3Agranola_redirect_uri%7D%22%7D%7D) [![Install in Cursor](https://img.shields.io/badge/Cursor-Install_Server-000000?style=flat-square&logo=cursor&logoColor=white)](https://cursor.com/install-mcp?name=granola&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBmb3JldmVyd29ya3MvbWNwLWdyYW5vbGEiXSwiZW52Ijp7IkdSQU5PTEFfUkVESVJFQ1RfVVJJIjoiJHtlbnY6R1JBTk9MQV9SRURJUkVDVF9VUkl9In19) [![Download for Claude Desktop](https://img.shields.io/badge/Claude_Desktop-Download_Bundle-D97757?style=flat-square&logo=claude&logoColor=white)](https://github.com/foreverworks/mcps/releases/latest/download/mcp-granola.mcpb)

> [!NOTE]
> `@foreverworks/mcp-granola` is not on npm yet: the buttons and the `npx` commands below work once it is published. Until then, [run it from a clone](#from-a-clone).

With Claude Code:

```bash
claude mcp add granola -- npx -y @foreverworks/mcp-granola
```

Claude Desktop (Settings, Developer, Edit Config) and most other clients read the same command as JSON:

```json
{
  "mcpServers": {
    "granola": {
      "command": "npx",
      "args": ["-y", "@foreverworks/mcp-granola"]
    }
  }
}
```

Each runs the published package on Node 22.19 or newer. VS Code and the Claude Desktop bundle ask for `GRANOLA_REDIRECT_URI` as they add the server. Cursor reads it from your environment instead (`${env:GRANOLA_REDIRECT_URI}`), so set it before you start Cursor. Every setting is optional; [Configuration](#configuration) says which ones you need for which tools.

### From a clone

```bash
git clone https://github.com/foreverworks/mcps.git && cd mcps
npm ci && npm run build
claude mcp add granola -- node "$PWD/servers/granola/dist/index.js"
```

In a JSON configuration, the command is `node` and its one argument the full path of `servers/granola/dist/index.js`. To share one running copy between several clients over HTTP, see [docs/deploying.md](../../docs/deploying.md).
<!-- install:end -->

> [!NOTE]
> The commands above name the published package, which does not exist yet:
> this server is on `main` but has no release, so `npx` and the Claude Desktop
> bundle find nothing. Until its first release, [run it from a
> clone](#from-a-clone).

## Configuration

| Variable | Required | Meaning |
|---|---|---|
| `GRANOLA_MCP_URL` | no | Granola's MCP server. Default `https://mcp.granola.ai/mcp`. The sign-in service is found from this address at run time, never hard-coded, and must sit on the same site (`granola.ai`) over https. |
| `GRANOLA_REDIRECT_URI` | no | Where the browser lands after you sign in. It need not be listening: you copy the address from the browser. Default `http://127.0.0.1:8977/callback`. It must be https, or http on a loopback host, or the server does not start. Changing it registers a new client at the next `begin_authorization`. |
| `GRANOLA_SCOPE` | no | The scopes to ask for, separated by spaces. Default `mcp offline_access`: the scope Granola's server names, plus `offline_access`, which is what returns a refresh token. |
| `GRANOLA_STATE_DIR` | no | Where the grant, the registered client and the last tool list are kept. Default: `$STATE_DIRECTORY` when a systemd service sets it, else `$XDG_STATE_HOME/mcps/granola` (`~/.local/state/mcps/granola`; `%APPDATA%\mcps\granola` on Windows). |

The variables every server shares (the HTTP listener and its tokens, limits,
`MCP_EGRESS_ALLOW`) are in [docs/configuration.md](../../docs/configuration.md).
A process limited by `MCP_EGRESS_ALLOW` must allow `mcp.granola.ai` and
`mcp-auth.granola.ai`, the host of Granola's sign-in service.

### Connecting a Granola account

You do this once per deployment, from any client of this server.

1. Ask the assistant to call `begin_authorization`. It registers this server
   with Granola's sign-in service and returns `authorize_url`.
2. Open `authorize_url` in a browser, sign in to Granola and allow access. The
   browser then goes to `GRANOLA_REDIRECT_URI` (by default
   `http://127.0.0.1:8977/callback`) with `?code=...&state=...` after it. The
   page itself fails to load, because nothing listens there: that is expected.
3. Copy the whole address from the browser's address bar and give it to the
   assistant, which passes it to `complete_authorization` as `redirect_url`.
   The whole address is needed, not just the code: its `state` is checked.
   You have ten minutes from step 1.
4. Call `health`. It should say `ok: true`, when the access token ends, and
   the tools Granola offers.

Enterprise workspaces: Granola's admins choose which note scopes members get,
and if none is enabled members cannot use MCP at all, here or anywhere.

## First run

1. Call `health`. Before the sign-in it says `ok: false` and that there is no
   grant; that is the starting point, not a fault.
2. Connect the account as above.
3. Ask for something small: `search_meetings` for a topic, then `get_meetings`
   with an id from the answer. The tools take the fields Granola publishes for
   them; this server lists them once the grant has seen Granola's tool list
   (`health` does that), and until then passes any object on and lets Granola
   check it.

## Tools

Every tool is **read** or **write**; none is `money`. Granola's tools keep their
own names, descriptions and input fields: this server takes them from Granola's
own tool list, caches that list in `tools.json` in the state directory, and
serves them as given, so what you see is what Granola published when the list
was last read.

### This server's

| Tool | Access | What it does |
|---|---|---|
| `health` | read | Whether a grant exists and when its access token ends, whether Granola answers, which of Granola's tools are offered here, which are withheld, which are hidden until someone has read them, and which offered ones Granola no longer lists. Never refreshes the grant and never prints a token. |
| `refresh_grant` | write | Refreshes the grant now, to prove the refresh token works. Calls refresh a due token by themselves; this is a check, and it rotates the grant. |
| `begin_authorization` | write | Registers this server as a client of Granola's sign-in service when needed, and returns the link to open in a browser to sign in to Granola. |
| `complete_authorization` | write | Takes the whole address the browser landed on, checks its state belongs to the sign-in begun, exchanges its code once, and stores the grant. A new client registration replaces the old one only together with the new grant. |

### Granola's, forwarded

| Tool | Access | What it does |
|---|---|---|
| `search_meetings` | read | Find meetings by topic, keyword, person, company, date or folder. |
| `list_meetings` | read | List meetings by date, when there is nothing to search for. Granola does not show this tool to every assistant; if it does not list it for your account, `health` names it under `missing`. |
| `get_meetings` | read | Read meetings by id: your private notes, the AI summary, attendees and links. |
| `get_meeting_transcript` | read | The word-for-word transcript of a meeting. Needs a paid Granola plan. |
| `search_transcripts` | read | Search what was said across transcripts, with passages and where to read on. Needs a paid Granola plan. |
| `list_meeting_folders` | read | The account's folders and their ids, to narrow a search. |
| `get_meeting_attachment` | read | A screenshot or photo attached to a meeting. |
| `get_account_info` | read | Which Granola account and plan the grant belongs to. |
| `list_templates` | read | The note templates available to the account. |
| `get_agent_brief` | read | The account's work context: role, projects and internal terms. Business and Enterprise plans. |
| `query_granola_meetings` | read | Ask a question across meetings and let Granola answer it. The slowest tool, and the most tightly limited: use the others first. |

### Granola's, never offered

These Granola tools change notes or the account, so this server does not register
them: `create_folder`, `update_folder`, `add_note_to_folder`,
`remove_note_from_folder`, `update_meeting_title`, `update_private_notes`,
`update_summary`, `generate_summary`, `create_meeting_note_from_transcript`,
`give_feedback`, `sign_out` and `switch_workspace`. `health` lists the ones
Granola currently offers your account under `withheld`.

A tool Granola adds later is not offered until someone has read it and decided
here, in the code (`src/domain/tools.ts`): `health` names it under `hidden`, so
you can see that something is waiting. This is on purpose: a bridge that
forwarded whatever Granola lists would hand a client a tool nobody here has read.

### Limits set by Granola

From Granola's help page on its MCP server (read on 2026-11-24; Granola says some
accounts have lower limits and that limits may change). On paid plans most tools
allow 5 requests a second (`list_meetings` included) and `query_granola_meetings` 50 an hour. On the free
plan `query_granola_meetings` allows 15 an hour, `get_meetings`,
`get_meeting_attachment` and `list_templates` 10 an hour each, and the others, `list_meetings` included, 2
a second. This server adds no limit of its own and does not retry a call: a
limited call comes back as Granola's own answer. Ask for several meeting ids in
one `get_meetings` call rather than one call each.

## Troubleshooting

**`not_authorized`**. There is no grant, or Granola refused the refresh token
with `invalid_grant` or `invalid_client` (for example because the account
revoked access). Only those two end a grant: a busy or
failing Granola (429, 5xx) answers `unreachable` or `upstream`, keeps the grant
and is worth retrying. The dead grant is dropped, so the next calls say "no
Granola account is connected to this server yet" at once. Connect the account
again as above.

**A transcript tool answers with an error from Granola.** The text is Granola's,
passed on unchanged. The usual cause is the plan: transcript tools need a paid
Granola plan.

**Granola says you are over a limit.** See [Limits](#limits-set-by-granola);
wait, then retry with fewer or larger calls.

**`authorization`: "no sign-in is open" or "closed"**. The address was used
already, or the sign-in is more than ten minutes old. Call `begin_authorization`
for a new link.

**`authorization`: "another sign-in"**. The address belongs to a link that a
later `begin_authorization` replaced. Use the newest link.

**`authorization`: "no refresh token"**. Granola granted access but sent no
refresh token, so the grant would end within the hour and was not stored. Make
sure the sign-in asks for `offline_access` (the default does, or set
`GRANOLA_SCOPE`).

**`discovery`**. The sign-in documents were not found or are not what this
server expects: `GRANOLA_MCP_URL` is wrong, Granola cannot be reached, a sign-in
endpoint is not on the same site as the MCP server, or Granola changed its
sign-in. The message names the address.

**`unreachable`** and **`upstream`**. Granola or its sign-in service did not
answer, or answered with a failure of its own. Retry; call `health` if it
keeps happening.

## How it works

**Discovery.** The server does not know where Granola signs people in. It
sends a request without a token to `GRANOLA_MCP_URL`, reads the 401's
`WWW-Authenticate: Bearer resource_metadata=...` (RFC 9728), reads that
document for the authorization server, then the server's own metadata
(RFC 8414) for the authorize, token and registration endpoints. Each document
must name what was asked about (the resource, the issuer), and every endpoint
must be https and on the same site as the MCP server, so a tampered document
cannot send your code or tokens elsewhere. The pieces are generic and live in
the shared toolkit (`oauthDiscovery.ts`, `rotatingGrant.ts`), so another server
can bridge another OAuth-only MCP server the same way.

**Registration and PKCE.** It registers a public client by dynamic client
registration (RFC 7591: no secret, the authorization-code and refresh-token
grants and a loopback redirect address, the metadata Granola asks for),
stores the client id, and signs in with the authorization-code flow and PKCE
(S256). Every authorize link and every token request names the MCP server as
the `resource`. The verifier and the state wait in the state directory between
the two calls, so a restart in between loses nothing.

**Rotating refresh tokens.** A refresh, like a code exchange, is sent once and
never resent: a resend after a lost answer would present a token Granola already
rotated. Refreshing is one exchange at a time, in this process and across processes (a lock in the state directory). The new access
and refresh tokens are written, atomically, before the access token is used;
a write that fails fails the refresh, and a crash after it loses nothing. A
call whose token Granola refuses before its stated expiry refreshes once and
retries once. No request follows a redirect, so a token or a code is sent only
where it was meant to go.

**Forwarding.** Each call opens a short connection to Granola's MCP server
(Streamable HTTP) with the access token and closes it after. The answer is
returned with the content Granola gave, unchanged, including a result Granola
marks as an error. This server builds its tools per request, so it lists each of
Granola's tools with the description and input fields Granola last published,
kept in `tools.json` in the state directory.

**State.** In `GRANOLA_STATE_DIR`, each file written whole at mode 0600:
`grant.json` (the tokens), `client.json` (the registered client and the
endpoints it signs in at), `candidate.json` (a new client registration, kept
apart until its sign-in completes), `pending.json` (the sign-in in progress)
and `tools.json` (Granola's last tool list).

## Limitations

- One Granola account per server. For a second, run a second copy with its own
  state directory. Granola's `switch_workspace` is not offered, so the grant
  stays on the workspace it signed in with.
- It forwards Granola's read tools; it adds none, and offers none that write.
  What Granola lets the account read, and how often, is Granola's to decide.
- A new Granola tool needs a code change before anyone can call it (see
  [Tools](#tools)).
- The sign-in needs a person with a browser, once, and again if the grant is
  revoked or otherwise ends. Granola has no API
  key for MCP and no headless sign-in, so there is nothing to automate there.
- Granola's MCP server is Granola's: if it changes how it signs people in or
  what its tools take, this server follows after an update.

## Other servers for Granola

Searched on 2026-11-24 (Granola's help page and a web search): Granola's own
hosted server, `https://mcp.granola.ai/mcp`, is official, uses OAuth with a
browser sign-in and has no API keys. This server bridges it rather than
replacing it, and uses it as the one source of truth. Use it directly when your
client can sign in and you want your own account in it. Community servers for
Granola also exist; check the MCP registry or GitHub for ones that suit you.

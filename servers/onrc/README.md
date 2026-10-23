# <img src="icons/icon.svg" width="36" height="36" alt="ONRC trade register icon"> ONRC trade register MCP server

Follow your filings at Romania's trade register from your AI assistant, on
[myportal.onrc.ro](https://myportal.onrc.ro): their status in the office's own
words, the documents in a filing's file, the fee notes, and the invoices with
what is still outstanding. It only reads: it files, pays and changes nothing
at ONRC, and has no `money` tools. The one thing it writes is the session it
holds for you.

**You need** a myportal.onrc.ro account you can sign in to in a browser. There
is no API key, because the portal has no public API: you hand the server your
own session once, from the browser where you are signed in, and again whenever
the portal ends it. You type nothing into the assistant but an address.

## What you can ask

- "Which of my ONRC filings are still being worked on?"
- "What is the status of the mențiune I filed for Client SRL in September, and
  when will its documents be released?"
- "Which documents are in the file of my latest filing?"
- "Do I have any ONRC fee notes I have not paid yet?"
- "How much is outstanding on my ONRC invoices this year?"

## Install

<!-- install:begin -->
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect/mcp/install?name=onrc&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40foreverworks%2Fmcp-onrc%22%5D%7D) [![Install in Cursor](https://img.shields.io/badge/Cursor-Install_Server-000000?style=flat-square&logo=cursor&logoColor=white)](https://cursor.com/install-mcp?name=onrc&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBmb3JldmVyd29ya3MvbWNwLW9ucmMiXX0%3D) [![Download for Claude Desktop](https://img.shields.io/badge/Claude_Desktop-Download_Bundle-D97757?style=flat-square&logo=claude&logoColor=white)](https://github.com/foreverworks/mcps/releases/latest/download/mcp-onrc.mcpb)

> [!NOTE]
> `@foreverworks/mcp-onrc` is not on npm yet: the buttons and the `npx` commands below work once it is published. Until then, [run it from a clone](#from-a-clone).

With Claude Code:

```bash
claude mcp add onrc -- npx -y @foreverworks/mcp-onrc
```

Claude Desktop (Settings, Developer, Edit Config) and most other clients read the same command as JSON:

```json
{
  "mcpServers": {
    "onrc": {
      "command": "npx",
      "args": ["-y", "@foreverworks/mcp-onrc"]
    }
  }
}
```

Each runs the published package on Node 22.19 or newer. It needs no settings.

### From a clone

```bash
git clone https://github.com/foreverworks/mcps.git && cd mcps
npm ci && npm run build
claude mcp add onrc -- node "$PWD/servers/onrc/dist/index.js"
```

In a JSON configuration, the command is `node` and its one argument the full path of `servers/onrc/dist/index.js`. To share one running copy between several clients over HTTP, see [docs/deploying.md](../../docs/deploying.md).
<!-- install:end -->

Over HTTP, one running copy holds one session for every client, and
`ONRC_KEEPALIVE_MIN` keeps it from lapsing between tasks.

## Configuration

Every variable is optional. Only a test realm or a mirror needs the last five;
their defaults are the public portal's.

| Variable | Required | Meaning |
|---|---|---|
| `ONRC_STATE_DIR` | no | Where `session.json` and a begun login (`login.json`) live, both 0600; the default is in [docs/configuration.md](../../docs/configuration.md). It holds a live session: keep it readable by the server's user only. |
| `ONRC_KEEPALIVE_MIN` | no | Refresh the session every N minutes while one is stored, so an idle portal session does not lapse between tasks. `0`, the default, is off. |
| `ONRC_LOGIN_SCRIPT` | no | A command your deployment provides that runs a whole login (begins it, brings the user the link, completes it). When set, every `needs_login` remedy names it first, and `health` reports it. |
| `ONRC_ISSUER` | no | The Keycloak realm. Default `https://sso.onrc.ro/realms/onrc`. |
| `ONRC_CLIENT_ID` | no | The portal's public client. Default `frontoffice-app`. |
| `ONRC_PORTAL` | no | The portal. Default `https://myportal.onrc.ro`. |
| `ONRC_REDIRECT_URI` | no | Where the sign-in server sends the browser back; it must be one the client registers. Default `<ONRC_PORTAL>/static-pages/silent-check-sso.html`. |
| `ONRC_SCOPES` | no | Space-separated. Default `openid`. |

There is no credential to configure: the server never sees the account's
password or second factor. The variables every server shares are in
[docs/configuration.md](../../docs/configuration.md).

## First run

1. Sign in to [myportal.onrc.ro](https://myportal.onrc.ro) in your browser, as
   you always do.
2. Ask your assistant for your filings. With no session stored, the tool
   answers `needs_login`, and the assistant calls `begin_login`.
3. Open its link in that same browser. A client that shows links itself (MCP
   URL elicitation: over stdio, or over HTTP with a client of protocol
   2026-07-28, as Claude Code is) offers you the page. You type nothing: the
   portal's sign-in server recognises your browser and sends it on to a blank
   page. The link stays open 15 minutes; beginning again replaces it.
4. Copy that blank page's whole address (it holds `code=` and `state=`) and
   paste it into the conversation at once: its code dies within a minute.
   `complete_login` stores the session and answers who is signed in and when
   the session expires.

Every tool then works until the portal ends the session (idle too long, or
signed out elsewhere); the next tool answers `needs_login`, and you repeat
these steps. `session_status` says where things stand, and with `probe` it
proves the session works.

## Tools

**read** changes nothing; **write** changes only what this server holds (a
begun login or the session), never anything at ONRC.

| Tool | Access | What it does |
|---|---|---|
| `health` | read | Whether a session is stored (none, present or expired), and the redirect address. No network. |
| `session_status` | read | Who is signed in, when the access and refresh tokens expire, and what to do if nobody is; `probe` refreshes once to prove the session works. Never shows a token. |
| `begin_login` | write | The link you open in the browser where you are signed in, and its 15-minute deadline. |
| `complete_login` | write | Takes the address the browser landed on, exchanges its code and stores the session. |
| `logout` | write | Forgets the session here and ends it at the sign-in server; your browser's own sign-in stays. |
| `list_requests` | read | "Cererile mele": the filings, newest first, with the portal and trade register numbers, the status, the company, and whether a fee note or invoice exists. |
| `get_request` | read | One filing by its id (a UUID from `list_requests`): its status in the office's words, the date the registrar decides by and the date the documents are released, and the documents in its file. |
| `list_calculation_notes` | read | "Notele mele de calcul": the fee notes, with amount, status and the date to pay by. |
| `list_invoices` | read | "Facturile mele": the invoices, with total, paid and outstanding. |

The three lists take a window, `from` and `to` (calendar dates in Bucharest,
`YYYY-MM-DD`; by default the last 365 days up to today), and a page: `page`
from 0, `size` from 1 to 100 (default 20).

## Troubleshooting

**`needs_login`.** The server holds no session, or the portal no longer honours
it (`reason`: `never_connected`, `expired`, `revoked` or `refused`). Sign in
again as in [First run](#first-run); if your browser is not signed in to the
portal, sign in there first.

**`needs_login` from `complete_login`, with the sign-in server's own words.**
The code in the address was spent or had died (it lives about a minute). Call
`begin_login` again and paste the new address at once.

**`input`: "the state in that address is not the one begin_login issued".**
The address comes from an older link; open the newest one `begin_login` gave.
"that login was begun more than 15 minutes ago" and "no login is in progress"
both mean: call `begin_login` again.

**`input`: "a filing's id is a UUID", or `not_found`.** `get_request` takes
the `id` that `list_requests` gives, not the filing's number.

**`forbidden`.** A filing is visible only to the account that made it.

**`config`: the session file cannot be read.** Delete the file the message
names, then sign in again.

**`rate_limited`.** The portal is throttling this session; wait a minute and
try again.

**`api`.** Status 0: the portal or its sign-in server was unreachable. Another
status: the portal failed. Try again later, and if it persists, read the
banner on the portal's home page.

**`drift`.** The portal's API changed under this server: an answer lacks a
field the server depends on. It needs updating; please report the message.

## How it works

**The session is yours, held by the server.** The portal signs in through
Keycloak, whose refresh token lasts as long as the SSO session, so a server
can hold the session and refresh it. It cannot sign in: that takes the user's
password, second factor and a captcha, none of which belong in a server. So
the one manual step is the standard authorization-code flow with PKCE, through
the user's browser. `begin_login` keeps the PKCE pair and a `state` in
`login.json`; `complete_login` checks the `state` before the code is spent,
exchanges the code, and writes `session.json`. The caller sees who signed in
and two expiry dates, never a token.

**The blank page.** The redirect must be an address the portal's client
registers. By default it is the portal's own
`static-pages/silent-check-sso.html`, keycloak-js's page for silent SSO
checks, which does nothing when opened as a tab, so the code stays unspent in
the address bar (`response_mode=query`) until the server exchanges it. A
deployment that can watch the browser for that address can run the three
steps as one command, named in `ONRC_LOGIN_SCRIPT`; the server never sees the
browser, and the command never sees a token.

**Refresh and expiry.** A read refreshes the token when it is about to expire
(once for every caller waiting, under a lock), and a 401 earns one refresh and
one retry. When Keycloak ends the session, a refresh answers `invalid_grant`,
the file is marked expired, and every tool answers `needs_login`.
`refreshTokenExpiresAt` in `session_status` shows how long Keycloak keeps an
idle session, which is how to choose `ONRC_KEEPALIVE_MIN`.

**The API is the portal's own**: every call is a read under
`https://myportal.onrc.ro/api/v1/portal-core/interf` that the portal's screens
make too. Each entry in a filing's file repeats the signed-in person, identity
document and personal numeric code included; no answer here carries any of
it, and a test checks that. The fee notes' and invoices' envelopes were read
live, but their items were modelled from the portal's code, so their fields
are all optional and the first live answer is the check (`scripts/smoke.ts`).

**Dates are Bucharest's**, whatever the host's zone: the server sends the first
moment of `from` and the last of `to` there as UTC instants, as the portal's
date pickers do; a DST Sunday is a 23- or 25-hour day.

**What comes back is checked.** Every answer is parsed against
`src/domain/schema.ts`; a field the server depends on that goes missing fails
as `drift`, not as an empty value. Amounts arrive as bare JSON numbers and
leave as exact decimal text (`"100.50"`), `outstanding` computed in decimal
arithmetic; a number that may already have lost digits is `drift`, not an
approximation. A filing's id must be a UUID, so a filing's number pasted in
its place fails before anything is sent.

`scripts/smoke.ts` drives the built server read-only. Without a session it
checks that every read answers `needs_login` with a usable remedy; it never
begins or completes a login itself.

## Limitations

- **Nothing files anything.** A filing (a mențiune, a capital increase) is a
  legal act with a fee; when it comes, it will be a `money` tool your client
  confirms with you, and the application PDF is signed with your qualified
  certificate, which stays with you.
- **Some of the portal is not reached yet**: the capital increase wizard
  (`social-capital`), `mentions`, `name-reservation`, the certificat
  constatator, a document's bytes (`portal-core-service-download-server`), and
  an invoice's PDF (a Jasper report by invoice id).
- **`get_request` lists the first 50 documents** in a filing's file.
- **One account per state directory.** A second account is a second server
  with its own `ONRC_STATE_DIR`.

## Other servers for ONRC

Searched 2026-10-15. ONRC publishes none, and the portal has no public API (the
register's company data is offered programmatically only under contract). No
community server reaches an account on the portal; searches of npm, PyPI,
GitHub, the MCP Registry and the web found only tools over public company data
(company search by name or CUI, directors, financials):

- **paianjenul.ro's hosted connector.**
- **`com.adrianhomelab/leadgen-onrc`** in the MCP Registry.
- **Libraries such as `onrc-open-data`**, for the register's open-data export.

This one covers what none of them touch: an account's own filings and their
status, a filing's documents, the fee notes and the outstanding invoices. It
never handles your password or second factor, the caller never sees a token,
and over HTTP one session serves every client. It does not search public
company data; the servers above do.

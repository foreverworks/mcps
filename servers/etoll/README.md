# <img src="icons/icon.svg" width="36" height="36" alt="eToll (rovinietă) icon"> eToll (rovinietă) MCP server

Check your cars' rovinietă from your AI assistant, on your
[eToll](https://portal.etoll.ro) account: until which day each vignette is
valid and how many days are left, the vignettes and bridge passes you bought,
the invoices, eToll's notifications and CNAIR's status page. It can also buy a
vignette: `quote_vignette` gives the price for each duration, and
`place_order`, its one **money** tool, places the order after you confirm one
line and hands you eToll's card payment page on euplatesc.ro. You pay there
yourself; the server never sees a card.

**You need** an eToll account with your cars on it. The server signs in either
with your eToll user name and password (from a file, or from a vault MCP
server), or through your browser once, for an account that signs in with
ROeID, Google or eIDAS. eToll has no public API: this is an unofficial client
of the API the portal itself uses, so it can break when eToll changes it.

## What you can ask

- "Until when is the rovinietă on B123ABC valid?"
- "Which of my cars need a new vignette this month?"
- "How much is a 12-month rovinietă for B123ABC, starting the day after the current one ends?"
- "Buy it, billed to my company."
- "Did the payment for that vignette go through?"
- "Download my eToll invoices from this year."

## Install

<!-- install:begin -->
> [!NOTE]
> eToll (rovinietă) is one of this repository's [extras](../../README.md#extras), which run from a clone and are not published to npm, the MCP Registry or as desktop bundles. Run it on Node 22.19 or newer.

With Claude Code:

```bash
git clone https://github.com/foreverworks/mcps.git && cd mcps
npm ci && npm run build
claude mcp add etoll -- node "$PWD/servers/etoll/dist/index.js"
```

Claude Desktop (Settings, Developer, Edit Config) and most other clients read the same command as JSON, with the full path of `servers/etoll/dist/index.js` in your clone:

```json
{
  "mcpServers": {
    "etoll": {
      "command": "node",
      "args": ["<path to the clone>/servers/etoll/dist/index.js"]
    }
  }
}
```

Every setting is optional; [Configuration](#configuration) says which ones you need for which tools. To share one running copy between several clients over HTTP, see [docs/deploying.md](../../docs/deploying.md).
<!-- install:end -->

## Configuration

Every variable is optional. With none set the server signs in through the
browser; set a user name and a password source to have it sign in by itself.

| Variable | Required | Meaning |
|---|---|---|
| `ETOLL_USERNAME` | no | The e-mail address or phone number you sign in to eToll with. Needed with `ETOLL_PASSWORD_FILE`; with a vault, it overrides the vault item's user name. |
| `ETOLL_PASSWORD_FILE` | no | File holding only your eToll password (`ETOLL_PASSWORD` for a local run). Read at each sign-in, never kept. |
| `ETOLL_VAULT_MCP_URL` | no | A vault MCP server over Streamable HTTP to read the user name and password from instead (this repository's bitwarden server, for one). |
| `ETOLL_VAULT_MCP_TOKEN_FILE` | no | File holding the vault server's bearer token (`ETOLL_VAULT_MCP_TOKEN` for a local run). |
| `ETOLL_VAULT_MCP_COMMAND` | no | Or a vault MCP server to spawn over stdio: a JSON array of strings, or words separated by spaces. |
| `ETOLL_VAULT_ITEM` | no | The vault item holding the eToll login. |
| `ETOLL_VAULT_TOOL` | no | The vault tool to call. Default `get_password`. |
| `ETOLL_VAULT_ARGS` | no | Its arguments as a JSON template, `{{item}}` replaced by the item. Default `{"id":"{{item}}"}`. |
| `ETOLL_VAULT_PASSWORD_FIELD` | no | Dot path to the password in the tool's JSON answer (`.` for the whole answer). Default `password`. |
| `ETOLL_VAULT_USERNAME_FIELD` | no | Dot path to the user name. Default `username`. |
| `ETOLL_STATE_DIR` | no | Where the session, a begun browser sign-in, quotes and orders live, all 0600; the default is in [docs/configuration.md](../../docs/configuration.md). It holds a live session: keep it readable by the server's user only. |
| `ETOLL_OUTBOX_DIR` | no | Where `download_invoice` writes PDFs. Default `<ETOLL_STATE_DIR>/outbox`. |
| `ETOLL_LOGIN_SCRIPT` | no | A command your deployment provides that runs a whole browser sign-in. When set, every `needs_login` remedy names it first, and `health` reports it. |
| `ETOLL_ISSUER` | no | The Keycloak realm. Default `https://sso.etoll.ro/auth/realms/external`. |
| `ETOLL_CLIENT_ID` | no | The portal's public client. Default `ddcm-authz-client`. |
| `ETOLL_API` | no | The portal. Default `https://portal.etoll.ro`. |
| `ETOLL_REDIRECT_URI` | no | Where a browser sign-in lands. Default `<ETOLL_API>/portal-extern/apm-env.js`. |
| `ETOLL_SCOPES` | no | Space-separated. Default `openid profile offline_access`. |

The variables every server shares are in
[docs/configuration.md](../../docs/configuration.md).

## First run

1. Ask your assistant for `health`. It says whether a session is stored and
   where a password would come from (`password_sign_in`), never the password.
2. Ask for your cars. With a password configured, the server signs in at that
   first call and keeps the session. Without one, the tool answers
   `needs_login`, and the assistant calls `begin_login`.
3. For a browser sign-in: open the link it gives and sign in to eToll as you
   do on the portal. A client that shows links itself (MCP URL elicitation)
   offers you the page. The link stays open 15 minutes.
4. The browser ends on a page of plain text (one of the portal's script
   files). Copy that page's whole address (it holds `code=` and `state=`) and
   paste it into the conversation at once: its code dies within a minute.
   `complete_login` stores the session.

The session is an offline one: it does not expire by the clock, only when
eToll ends it. With a password configured the server then signs in again by
itself; without one, the next tool answers `needs_login` and you repeat the
browser steps.

## Tools

**read** changes nothing at eToll; **write** changes only what this server
holds, or drops an unpaid order; **money** places an order.

| Tool | Access | What it does |
|---|---|---|
| `health` | read | Whether a session is stored (none, present or expired), how it was made, and where a password comes from. No network. |
| `session_status` | read | Who is signed in and when the tokens expire; `probe` refreshes (or signs in with the password) once to prove it works. Never shows a token. |
| `begin_login` | write | The link for a browser sign-in, and its 15-minute deadline. |
| `complete_login` | write | Takes the address the browser landed on, exchanges its code and stores the session. |
| `logout` | write | Forgets the session here and ends it at eToll's sign-in server. |
| `list_vehicles` | read | Every car on the account with its vignette: valid until (a day in Bucharest), days left, and the periods a new one may cover. |
| `list_tolls` | read | The vignettes and bridge passes bought, newest first, filtered by status or plate, a page at a time (`cursor`, `size` up to 100). |
| `list_invoices` | read | The invoices in a window of days (`from`, `to`; the last year by default), a page at a time. |
| `download_invoice` | read | Saves an invoice's PDF in the outbox; answers its path, SHA-256 and size. |
| `notifications` | read | eToll's messages to the account (a vignette about to end), and how many are unread. |
| `service_status` | read | CNAIR's public status page: each component, open incidents, planned maintenance. Needs no account. |
| `quote_vignette` | read | The price of a vignette for one car from a start date, for every duration from 1 day to 12 months, each with a `quote_id`. Orders nothing. |
| `place_order` | **money** | Orders a quoted vignette and hands over the card payment page on euplatesc.ro. |
| `get_order` | read | An order `place_order` made: pending (with its payment page), paid, expired or cancelled. |
| `cancel_order` | write | Drops an unpaid order. Safe to call twice; a paid order is refused. |

## Money

`place_order` is the only tool that buys anything. It takes a `quote_id` from
`quote_vignette` (at most 30 minutes old) and, when the account bills to more
than one person or company, a `billing_id`. Before it runs, the user confirms
one line, computed from the stored quote and the account's billing details:

```text
etoll: Buy rovinietă 12 months, category A, for B123ABC (RO), valid from 2026-12-01 to 2027-11-30, 139.41 RON, billed to Ana Popescu, paid by card on euplatesc.ro
```

Your client confirms it with you; a deployment can have the server ask
instead (`MCP_CONFIRM=elicit`, [docs/configuration.md](../../docs/configuration.md)).
Then, in order, and stopping at the first that fails:

1. The price is asked again, and must be the confirmed one to the last ban;
   otherwise `refused` with `PRICE_CHANGED`, and nothing is ordered.
2. The order is created, and its total must be there and be the confirmed
   one; otherwise it is cancelled and the answer is `PRICE_CHANGED` (or
   `drift`, when eToll gave no total). An order eToll makes but answers in a
   shape the server cannot read is cancelled too, and the answer is `drift`.
3. The payment page is asked for, and must be https on euplatesc.ro;
   otherwise the order is cancelled and the answer is `drift`. If eToll
   refuses or fails the request, the order is cancelled too, and the answer
   is eToll's error.

From the moment the order exists, any failure cancels it, and the answer says
so. If the cancel fails as well, the answer is `outcome_unknown` and names the
order that is still open, so you can `cancel_order` it: eToll lists an unpaid
order nowhere and refuses another for the same vignette while it is open.

The answer is the payment page, which a client that shows links offers you
directly. Nothing is paid until you pay there. An unpaid order expires by
itself; `cancel_order` drops it sooner, and `get_order` says when it is paid.

## Troubleshooting

**`needs_login`.** No session, or eToll no longer honours it, and no password
is configured (`reason`: `never_connected`, `expired`, `revoked` or
`refused`). Sign in through the browser as in [First run](#first-run), or
configure a password.

**`login_refused`.** eToll's sign-in server refused the configured user name
and password. Do not retry until they are fixed: it locks an account after
repeated failures, so the server itself waits 15 minutes before sending the
same password again. Fix the password file or the vault item, then call
`session_status` with `probe` to try at once. An account that signs in with
ROeID, Google or eIDAS has no eToll password: use the browser sign-in.

**`upstream`.** The vault server failed: check the `ETOLL_VAULT_*` settings,
that it is reachable, and that it is unlocked.

**`refused`, `PENDING_ORDER_SAME_PRODUCT`.** An unpaid order for the same
vignette is already open; `pendingOrderId` names it. Pay it on the page
`place_order` handed over, or `cancel_order` it and order again.

**`refused`, `ORDER_NOT_DELETABLE`.** eToll would not delete the order. It
gives the same answer for an order that is paid, expired or already
cancelled, so nothing is assumed: `get_order` or `list_tolls` shows whether
it was paid.

**`refused`, `VIGNETTE_OVERLAP` or `VIGNETTE_VALIDITY_DATE_OUT_OF_RANGE`.**
The start date overlaps a vignette you have, or is further ahead than eToll
sells. `list_vehicles` shows the periods a new one may cover.

**`refused`, `PRICE_CHANGED`.** The price moved after the quote. Nothing was
paid; quote again and confirm the new price.

**`input`: the quote is more than 30 minutes old.** Call `quote_vignette`
again.

**`outcome_unknown`.** An order or payment request failed after eToll may have
acted on it, or an order it made could not be cancelled (the message names
it; `cancel_order` drops it). It is never sent again by itself. eToll lists an order nowhere
until it is paid, so one that was created cannot be looked up; nothing is
charged unless its payment page is paid, and it expires by itself within the
hour.

**`api`.** eToll or its sign-in server was unreachable (status 0) or failed.
`service_status` says whether CNAIR reports an outage.

**`drift`.** eToll's API changed under this server: an answer lacks a field it
depends on. It needs updating; please report the message.

## How it works

**The API is the portal's own.** Every call is one the eToll web portal makes,
under `https://portal.etoll.ro/api`, with a bearer token from eToll's Keycloak
and the portal's public client. Its paths, bodies and error codes were read
from the portal's client (its WebAssembly bundle) on 2026-11-15, as was the
checkout: a quote, an order holding the chosen option, then a payment request
that answers the euplatesc.ro page. The error body, the status page, the
password sign-in, the profiles, billing details, a vehicle, a quote, an
order paid on its payment page, the vignette and invoice it made, and the
invoice's PDF were seen live; a notification's own fields, a bridge pass and
an organisation as billing entry were not yet, so every field is optional but
the ids, and `scripts/smoke.ts` is the check.

**Two ways to sign in, one session.** With a password configured the server
uses Keycloak's password grant, reading the password only at that moment.
Otherwise it runs the authorization-code flow with PKCE through your browser,
landing on a static file of the portal's that does nothing when opened, so the
code waits in the address bar (`response_mode=query`). Either way the session
is an offline one (`offline_access`), refreshed as needed under a lock, and a
401 earns one refresh and one retry.

**Money stays exact.** eToll sends prices as JSON numbers. Each becomes exact
decimal text when it arrives; one that may already have lost digits is
`drift`. The order sends the quoted amounts back as the same digits, written
into the JSON without ever being a float.

**Orders are remembered here.** eToll has no endpoint that reads an order
back, so the server keeps each order it placed (its vignettes' ids, the total,
the payment page) in `orders.json`, and `get_order` reads the vignettes'
statuses. Quotes are kept for 30 minutes in `quotes.json`, so `place_order`
takes an id, not a price a model could alter.

**Dates are Bucharest's**, whatever the host's zone: a vignette is valid until
a calendar day there, and `days_left` counts days there.

`scripts/smoke.ts` drives the built server read-only. With `--order` it also
quotes the cheapest vignette for a car, places the order and cancels it at
once, without paying.

## Limitations

- **Cars only.** Vehicles are listed with `vehicleType=CAR`; trucks, the
  per-kilometre toll and the Danube bridge passes cannot be bought here
  (`list_tolls` shows the passes you bought elsewhere).
- **No anonymous check.** eToll checks a plate without an account only behind
  a captcha, so every read needs the account.
- **No refunds.** A paid vignette is refunded through eToll's support.
- **Vehicles and billing details are managed on the portal.** A car not on
  the account cannot be quoted.
- **One account per state directory.** A second account is a second server
  with its own `ETOLL_STATE_DIR`.

## Other servers for eToll

Searched 2026-11-15. CNAIR publishes no MCP server and no public API for eToll
(it replaced eRovinieta on 1 October 2026). Searches of npm, PyPI, GitHub, the
MCP Registry and the web found:

- **Acteo's hosted MCP server**, whose `auto_rovinieta_verifica` checks any
  car's vignette by plate number. A paid API (from 19 EUR a month); it does
  not reach your eToll account, its invoices or a purchase.
- **`cnecrea/tollro`**, a Home Assistant integration that reads an eToll
  account's vehicles and vignettes. Not an MCP server, read-only, and it needs
  a paid license.

This one reaches your own account from any MCP client: the vignettes, the
invoices and their PDFs, the notifications, and a purchase you confirm and pay
for yourself.

### Credits

This server was built by Rareș Zamfiriu <!-- push-guard: allow: the credit the maintainer asked for -->
([@rzamfiriu](https://github.com/rzamfiriu)), who mapped eToll's unpublished
API, tested every tool against a live account, and bought and paid for a real
vignette through it before proposing it here.

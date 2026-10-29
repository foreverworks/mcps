# <img src="icons/icon.svg" width="36" height="36" alt="Bolt Food receipts icon"> Bolt Food receipts MCP server

Read your [Bolt Food](https://food.bolt.eu) orders from your AI assistant as
itemised receipts, add up what you spent per restaurant and per month, and find
the order behind each Bolt Food charge on your bank statement: where the bank
says only `Bolt Services Ro S.r.l. -64.20`, you get the restaurant, every
product, the fees, the tip, and what Bolt Balance paid instead of the card. It
is read-only: nothing here orders, pays or changes your account, and no tool is
`money`. It writes only CSV exports, into its own folder.

**You need** a Bolt Food account and a desktop browser signed in to it at
food.bolt.eu: you copy two values from its developer console, in a few minutes
([Getting the credentials](#getting-the-credentials)). There is no API key and
no cost. The copied sign-in lasts about a year; then you copy it again.

> [!WARNING]
> Bolt publishes no API for this: the server is an unofficial client of the web
> app's undocumented API, which can change or stop working without notice.
> Bolt's Terms and Conditions for Clients (Romania, effective 2025-05-05, read
> 2026-10-18) forbid scraping and any automated collection of data from the
> Bolt Food Platform (clause 8.5): using this server breaches them, and Bolt
> may close the account. Read the terms for your country and decide before you
> use it.

## What you can ask

- "Which Bolt Food orders were these card charges: -57.84 RON on 1 July and
  -38.10 RON on 3 July?"
- "Show the receipt of my last Bolt Food order, with the fees and the tip."
- "How much did I spend on Bolt Food each month this year, and how much of it
  went on the card?"
- "Which restaurants did I pay the most on Bolt Food since April?"
- "How many times have I ordered the falafel wrap, and what did it cost last
  time?"
- "Export every product I ordered in September to a CSV."

## Install

<!-- install:begin -->
> [!NOTE]
> Bolt Food receipts is one of this repository's [extras](../../README.md#extras), which run from a clone and are not published to npm, the MCP Registry or as desktop bundles. Run it on Node 22.19 or newer.

With Claude Code:

```bash
git clone https://github.com/foreverworks/mcps.git && cd mcps
npm ci && npm run build
claude mcp add bolt-food -e BOLT_FOOD_CREDS="<path to Bolt Food credentials.json>" -- node "$PWD/servers/bolt-food/dist/index.js"
```

Claude Desktop (Settings, Developer, Edit Config) and most other clients read the same command as JSON, with the full path of `servers/bolt-food/dist/index.js` in your clone:

```json
{
  "mcpServers": {
    "bolt-food": {
      "command": "node",
      "args": ["<path to the clone>/servers/bolt-food/dist/index.js"],
      "env": {
        "BOLT_FOOD_CREDS": "<path to Bolt Food credentials.json>"
      }
    }
  }
}
```

The commands above set only what is required; [Configuration](#configuration) has the rest. To share one running copy between several clients over HTTP, see [docs/deploying.md](../../docs/deploying.md).
<!-- install:end -->

Also set `BOLT_FOOD_TIME_ZONE` to the zone your bank books in, so that
late-night orders land on the right day: with Claude Code, add
`-e BOLT_FOOD_TIME_ZONE=Europe/Bucharest` before the `--`.

## Configuration

| Variable | Required | Meaning |
|---|---|---|
| `BOLT_FOOD_CREDS` | yes | Path of `credentials.json` (below). There is no default: unset, the server still starts and lists its tools, and each tool answers a `config` error naming the variable. |
| `BOLT_FOOD_TIME_ZONE` | no, but set it | The IANA zone dates are read in, such as `Europe/Bucharest`. Use the zone your bank books in: an order at 00:30 local time belongs to that day, not to the UTC one. Unset, it is the process's zone (`TZ`, else the system's). A name that is not a zone stops the server at start. |
| `BOLT_FOOD_STATE_DIR` | no | Where order details are stored (`orders/`); the default is in [docs/configuration.md](../../docs/configuration.md). |
| `BOLT_FOOD_EXPORTS_DIR` | no | Where `export_items` writes; the default is `exports/` in the state folder. Point it at a folder you can read when the server runs as another user. |

`credentials.json` holds two values, both required:

```json
{ "refresh_token": "<a long JWT>", "device_id": "<a UUID>" }
```

The server reads it on every call and never writes it; its errors name the path
and any missing field, never a value. The variables every server shares
(transport, limits, network) are in
[docs/configuration.md](../../docs/configuration.md).

### Getting the credentials

1. In a desktop browser, open <https://food.bolt.eu> and sign in to the
   account whose orders you want. Check that your past orders show.
2. Open the browser's developer tools on that tab (F12 on Windows and Linux,
   Cmd+Option+I on a Mac) and choose the Console tab.
3. Paste this and press Enter. If the browser asks you to type `allow pasting`
   first, type it and paste again.

   ```js
   const dec = s => [...s].map(c => String.fromCharCode(c.charCodeAt(0) ^ 24)).join('');
   let root = JSON.parse(dec(localStorage['mmkv_9$a_store_9$a_persist:root']));
   if (typeof root === 'string') root = JSON.parse(root);
   const s = typeof root.session === 'string' ? JSON.parse(root.session) : root.session;
   console.log(JSON.stringify({ refresh_token: s.token.refreshToken, device_id: s.basic.deviceId }));
   ```

   It prints one line of JSON. (The web app keeps its session scrambled
   character by character; the first line undoes that.)
4. Save that line as `credentials.json`, outside any git repository, readable
   only by you (`chmod 600 credentials.json` on macOS and Linux).
5. Set `BOLT_FOOD_CREDS` to the file's full path.
6. Close the tab, but do not sign out: signing out of the web app may end the
   session the token belongs to.

**What the file grants.** These two values are the Bolt Food app's own sign-in,
not a key limited to this server: for about a year, whoever holds them can do
what the app does as you, such as read your orders and delivery addresses and
place orders. The server only reads. Treat the file like a password.

**Renewing it.** `health` says how many days the token has left, and
`--health` fails two weeks before the end ([First run](#first-run)). Repeat the
steps and replace the file; no restart is needed. Copy both values together:
the device id is the device the token was issued to.

## First run

1. Ask your assistant to run Bolt Food's `health` check. It answers with your
   Bolt user id, the token's days left, the order count and the latest order,
   or with what to do about a refused token.
2. Start small, such as your last five orders (`list_orders`): the first
   question over the whole history takes minutes
   ([Stored orders and pacing](#stored-orders-and-pacing)).

From a shell, `node dist/index.js --health` prints one line starting `BOLT:`
and exits 0 when the server works, 1 when a person has to act (credentials
missing or refused, or a token that expires within two weeks) and 2 when Bolt
or the network is unwell, which suits a monitor.

## Tools

Every tool is **read**: none changes anything in your Bolt Food account.

| Tool | Access | What it does |
|---|---|---|
| `health` | read | Signs in for real, reads the history, and reports the Bolt user id, the token's days left, the order count, the latest order and how many details are stored. |
| `list_orders` | read | The history, newest first, filtered by date, restaurant or state. One call, no products; its `listedPrice` leaves out the tip and is not what the card paid. |
| `get_receipt` | read | One order as an itemised receipt. |
| `get_receipts` | read | Receipts for every order in a date range of up to 93 days, as headlines or in full. |
| `match_card_charges` | read | Bank card rows in (up to 500), receipts out: each debit paired with the order it paid for, and what did not pair on either side. |
| `search_items` | read | Every product ever ordered, most-ordered first, with times ordered, spend and the latest unit price. |
| `export_items` | read | One CSV row per product line, written to a new file in the exports folder; answers its path, SHA-256 and size. |
| `order_stats` | read | What delivered orders cost per restaurant and per month: orders, paid, the card's part and the average, per currency. |

## Troubleshooting

**`config`: "BOLT_FOOD_CREDS is not set"**, or the credentials "cannot be
read", "are not JSON" or "lack" a field. The file holds exactly the line the
[snippet](#getting-the-credentials) prints.

**`auth` with `permanent: true`: "the refresh token was refused".** The token
expired, or its session ended. Copy the credentials again
([steps](#getting-the-credentials)); no restart is needed.

**`auth` with `permanent: false` ("transient; retry later"), or `api` with
`code: 1005` ("Bolt is throttling").** The server's retries ran out. Wait a
minute and ask again.

**`api` with another code: "the Bolt web app may have changed its API".** Retry
once. If it keeps failing, Bolt's web API has changed:
[open an issue](https://github.com/foreverworks/mcps/issues) with the error's
`message`.

**`not_found`: "order ... is not in this account's history".** Take order ids
from `list_orders`.

**`input`**, such as "the range spans more than 93 days; split it" or "every
amount is positive". Ask for 93 days or less at a time, and send card rows
signed as the bank booked them: a debit is negative.

**A receipt with `partial: true`** in a batch. Bolt would not return that one
order; its `reason` says why. The rest of the batch is complete.

**A long wait, or a client that gives up**, on the first `search_items`,
`export_items` or `order_stats`, which read every order's details while none
are stored. Give them a `since`, or first read the history a quarter at a time
with `get_receipts`, which stores settled orders as it reads.

## How it works

### What a receipt says

- **`localDate` and `localTime` are when the order was placed**, in
  `BOLT_FOOD_TIME_ZONE`.
- **`charged.card` is the amount on the bank statement.** `charged.boltBalance`
  is what Bolt Balance paid, and `payments` lists every leg in Bolt's words.
- **`priceLines` are Bolt's breakdown, verbatim, and do not add up to the
  total**: the discount lines restate discounts already inside the subtotal,
  so nothing here re-derives a total from them.
- **`total` is Bolt's stated total, kept even when the legs add up to less**,
  as on grocery orders a picker changed after checkout: `notices` carries
  Bolt's explanation, and the changed lines carry `adjustment: "removed"` or
  `"replacement"`.
- **Amounts are decimal strings** (`"57.84"`). Bolt sends floats, and no exact
  join survives two legs of 2.35 and 57.84 adding up to 60.190000000000005, so
  each amount is rounded to the cent on arrival and counted in whole cents. One
  Bolt did not send is absent, never `0.00`.
- **No address, delivery note, phone number or courier name leaves the
  server**: no receipt needs them, so they are not modelled.

`list_orders` carries `listedPrice`, the figure the app's order list shows,
not called `total` because it leaves out the tip.

### Matching card rows

Send the rows exactly as the bank booked them, a debit negative, each with its
currency:

```json
{ "charges": [{ "id": "tx-0001", "date": "2026-07-01", "amount": "-57.84", "currency": "RON" }] }
```

- **A row pairs with a delivered order** when its amount equals the order's
  card leg (the total minus any Bolt Balance) and its booking date is one day
  before to two days after the order's local date. Joining on the total
  instead would miss every order part-paid from Bolt Balance or changed by a
  picker.
- **Same-amount orders are claimed in time order**, so two identical orders on
  one day pair with two rows.
- **A positive amount is a credit** (a refund), listed under `credits`; it
  never claims the order it refunds.
- **`unmatchedOrders` lists only orders dated inside the rows' own span**, so
  an order at the window's edge, whose row you did not send, does not look like
  missing money. Rows that paired nothing are in `unmatchedCharges`.

### Sign-in

The server trades the refresh token for one-hour access tokens
(`getAccessToken`), which leaves the refresh token as it was: safe to repeat.
Access tokens stay in memory. The server never calls `rotateRefresh`, which
would invalidate the token and sign you out of every device, and a test holds
it to that. Every call goes to `deliveryuser.live.boltsvc.net`, which
`MCP_EGRESS_ALLOW` ([docs/configuration.md](../../docs/configuration.md)) can
enforce.

### Stored orders and pacing

- **An order's details are stored a week after it reached its final state**,
  because refunds land days after delivery. The store keeps Bolt's raw answer,
  so a fix to the receipt mapping applies to stored orders too: one file per
  order under `orders/` in the state folder, written whole by rename so
  processes can share it, 0600 in a 0700 folder because it holds the delivery
  address.
- **Detail calls go out one at a time, at least 350 ms apart**: in parallel
  they were throttled often, one at a time at that gap never. Bolt throttles
  with HTTP 200 and code 1005 in the body; the server treats that as a 429 and
  backs off 1 s, 2 s, 4 s and so on, six attempts in all.
- **A cold read is two to three orders a second**; stored orders read
  instantly. The history is one call per 50 orders, remembered for five
  minutes.

### Code

What this server shares with its sibling, [Glovo receipts](../glovo), lives in
[`packages/receipts`](../../packages/receipts): the tools, the use cases behind
`get_receipts`, `match_card_charges`, `search_items`, `export_items` and
`order_stats`, and the order store. Its README says what each server adds.
[API.md](API.md) describes Bolt's API.

The unit tests use invented payloads and a fake `fetch`.
`npx tsx scripts/smoke.ts [charges.json]` drives the built server with your
credentials; it prints a real receipt, so keep its output to yourself.

## Limitations

- **Unofficial.** Bolt can change its API or refuse this client at any time;
  `api` failures or receipts with missing fields show it.
- **Read-only by design.** It does not order, cancel, rate or tip.
- **Food and grocery orders only.** Rides are billed as `Bolt.eu/o/...` or
  `Payu*bolt.eu` and are not in this API.
- **The token is renewed by hand**, about once a year: nothing can renew it
  unattended without signing you out everywhere.
- **One account per server**: the one in `credentials.json`.
- **Refunds are not subtracted** in `order_stats`, because Bolt does not say
  when one reached the card. A receipt shows a refund Bolt reports (`refund`).
- **Only the Romanian web app was examined.** Other countries are untested.

## Other servers for Bolt Food

Searched 2026-10-15, with nothing found that reads a Bolt Food account:

- **Bolt itself** publishes no MCP server and no API for a customer's food
  orders. Its personal data download includes the order history and card
  payments, but as a manual export.
- **The MCP Registry, npm, PyPI and GitHub** have nothing for Bolt Food. The
  servers named "Bolt" there belong to other products (the Bolt checkout API,
  Bolt IoT).

This one exists because nothing else reads a Bolt Food account's orders as
itemised receipts or pairs bank card charges with them.

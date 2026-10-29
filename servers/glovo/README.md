# <img src="icons/icon.svg" width="36" height="36" alt="Glovo receipts icon"> Glovo receipts MCP server

Read your [Glovo](https://glovoapp.com) orders from your AI assistant as
itemised receipts, add up what you spent per store and per month, and find the
order behind each Glovo charge on your bank statement: where the bank says only
`Glovoappro S.r.l. -52.84`, you get the store, every product, the fees, the tip,
and what Glovo credits paid instead of the card. It is read-only: nothing here
orders, pays or changes your account, and no tool is `money`. It writes only
CSV exports, into its own folder.

**You need** a Glovo account and a desktop browser signed in to it at
glovoapp.com: you copy two values from its developer console, in a few minutes
([Getting the credentials](#getting-the-credentials)). There is no API key and
no cost. The copied sign-in states no expiry: when Glovo stops accepting it,
you copy it again.

> [!WARNING]
> Glovo publishes no API for this: the server is an unofficial client of the
> web app's undocumented API, which can change or stop working without notice.
> Glovo's General Terms (read 2026-10-18) do not mention automated access, but
> they forbid altering or bypassing the app (2.3) and copying its contents for
> public or commercial purposes (13), and let Glovo suspend an account for
> illicit use (2.6). Read the terms for your country and decide before you use
> it.

## What you can ask

- "Which Glovo orders were these card charges: -52.84 RON on 15 January and
  -125.40 RON on 2 August?"
- "Show my last grocery order on Glovo, and what the picker replaced."
- "How much did I spend on Glovo per store this year?"
- "List my cancelled Glovo orders."
- "How often have I bought oat milk on Glovo, and what did it cost last time?"
- "Export every product I bought on Glovo since June to a CSV."

## Install

<!-- install:begin -->
> [!NOTE]
> Glovo receipts is one of this repository's [extras](../../README.md#extras), which run from a clone and are not published to npm, the MCP Registry or as desktop bundles. Run it on Node 22.19 or newer.

With Claude Code:

```bash
git clone https://github.com/foreverworks/mcps.git && cd mcps
npm ci && npm run build
claude mcp add glovo -e GLOVO_CREDS="<path to Glovo credentials.json>" -- node "$PWD/servers/glovo/dist/index.js"
```

Claude Desktop (Settings, Developer, Edit Config) and most other clients read the same command as JSON, with the full path of `servers/glovo/dist/index.js` in your clone:

```json
{
  "mcpServers": {
    "glovo": {
      "command": "node",
      "args": ["<path to the clone>/servers/glovo/dist/index.js"],
      "env": {
        "GLOVO_CREDS": "<path to Glovo credentials.json>"
      }
    }
  }
}
```

The commands above set only what is required; [Configuration](#configuration) has the rest. To share one running copy between several clients over HTTP, see [docs/deploying.md](../../docs/deploying.md).
<!-- install:end -->

Also set `GLOVO_TIME_ZONE` to the zone your bank books in, so that late-night
orders land on the right day: with Claude Code, add
`-e GLOVO_TIME_ZONE=Europe/Bucharest` before the `--`.

## Configuration

| Variable | Required | Meaning |
|---|---|---|
| `GLOVO_CREDS` | yes | Path of `credentials.json` (below). There is no default: unset, the server still starts and lists its tools, and each tool answers a `config` error naming the variable. |
| `GLOVO_TIME_ZONE` | no, but set it | The IANA zone dates are read in, such as `Europe/Bucharest`. Use the zone your bank books in: an order delivered at 00:30 local time belongs to that day, not to the UTC one. Unset, it is the process's zone (`TZ`, else the system's). A name that is not a zone stops the server at start. |
| `GLOVO_STATE_DIR` | no | Where order details are stored (`orders/`); the default is in [docs/configuration.md](../../docs/configuration.md). |
| `GLOVO_EXPORTS_DIR` | no | Where `export_items` writes; the default is `exports/` in the state folder. Point it at a folder you can read when the server runs as another user. |

`credentials.json` holds two values, both required:

```json
{ "refresh_token": "<a long JWT>", "device_urn": "glv:device:<a UUID>" }
```

The server reads it on every call and never writes it; its errors name the path
and any missing field, never a value. The variables every server shares
(transport, limits, network) are in
[docs/configuration.md](../../docs/configuration.md).

### Getting the credentials

1. In a desktop browser, open <https://glovoapp.com> and sign in to the account
   whose orders you want. Check that your past orders show.
2. Open the browser's developer tools on that tab (F12 on Windows and Linux,
   Cmd+Option+I on a Mac) and choose the Console tab.
3. Paste this and press Enter. If the browser asks you to type `allow pasting`
   first, type it and paste again.

   ```js
   console.log(JSON.stringify({
     refresh_token: localStorage.glovo_refresh_token,
     device_urn: JSON.parse(localStorage.glv_device).urn,
   }));
   ```

   It prints one line of JSON.
4. Save that line as `credentials.json`, outside any git repository, readable
   only by you (`chmod 600 credentials.json` on macOS and Linux).
5. Set `GLOVO_CREDS` to the file's full path.
6. Close the tab, but do not sign out: signing out of the web app may end the
   session the token belongs to.

**What the file grants.** These two values are the Glovo app's own sign-in, not
a key limited to this server: whoever holds them can do what the app does as
you, such as read your orders and delivery addresses and place orders. The
server only reads. Treat the file like a password.

**Renewing it.** When `health` says the token was refused, repeat the steps
and replace the file; no restart is needed. Copy both values together: every
call names the device urn.

## First run

1. Ask your assistant to run Glovo's `health` check. It answers with your
   Glovo user id and latest order, or with what to do about a refused token.
2. Start small, such as your last five orders (`list_orders`): the first
   question over a long range takes minutes
   ([Stored orders and pacing](#stored-orders-and-pacing)).

From a shell, `node dist/index.js --health` prints one line starting `GLOVO:`
and exits 0 when the server works, 1 when a person has to act (credentials
missing or refused) and 2 when Glovo or the network is unwell, which suits a
monitor.

## Tools

Every tool is **read**: none changes anything in your Glovo account.

| Tool | Access | What it does |
|---|---|---|
| `health` | read | Signs in for real, reads the first history page and the newest order, and reports the Glovo user id, the latest order and how many details are stored. |
| `list_orders` | read | The history, newest first, filtered by store or by the list's coarse status. No dates: Glovo's list has none. |
| `get_receipt` | read | One order as an itemised receipt. |
| `get_receipts` | read | Receipts for every order delivered or cancelled in a date range of up to 93 days, as headlines or in full. |
| `match_card_charges` | read | Bank card rows in (up to 500), receipts out: each debit paired with the order it paid for, and what did not pair on either side. |
| `search_items` | read | Every product ever ordered, most-ordered first, with times ordered, spend and the latest line price. |
| `export_items` | read | One CSV row per product line, written to a new file in the exports folder; answers its path, SHA-256 and size. |
| `order_stats` | read | What delivered orders cost per store and per month: orders, paid, the card's part and the average, per currency. |

## Troubleshooting

**`config`: "GLOVO_CREDS is not set"**, or the credentials "cannot be read",
"are not JSON" or "lack" a field. The file holds exactly the line the
[snippet](#getting-the-credentials) prints.

**`auth` with `permanent: true`: "the refresh token was refused".** The
session ended, or Glovo stopped accepting the token. Copy the credentials again
([steps](#getting-the-credentials)); no restart is needed.

**`auth` with `permanent: false` ("transient; retry later"), or `api` with
`status: 429` ("Glovo is throttling").** The server's retries ran out, and a
throttled batch stops. Wait a minute and ask again.

**`api` with another status: "the Glovo web app may have changed its API".**
Retry once. If it keeps failing, Glovo's web API has changed:
[open an issue](https://github.com/foreverworks/mcps/issues) with the error's
`message`.

**`not_found`: "there is no such order in this account".** Take order ids from
`list_orders`.

**`input`**, such as "the range spans more than 93 days; split it" or "every
amount is positive". Ask for 93 days or less at a time, and send card rows
signed as the bank booked them: a debit is negative.

**A receipt with `partial: true`** in a batch. Glovo would not return that one
order, or it carries no time to date it by; its `reason` says which. The rest
of the batch is complete.

**A long wait, or a client that gives up**, on the first `search_items`,
`export_items` or `order_stats`, which read every order's details while none
are stored, or on `list_orders` filtered by a store you rarely use. Give the
first three a `since`, or first read the history a quarter at a time with
`get_receipts`, which stores settled orders as it reads.

## How it works

### The history has no dates

Glovo's order list holds display cards (the store, a product summary, and the
total or a word such as "Cancelled") with no date, state or payment. Only an
order's details carry a time. So:

- **`list_orders` reads 15 orders per call to Glovo** and filters by store and
  coarse status (`active`, `finished`, `canceled`, `refunded`), never by date.
  It shows `state`, `localDate` and `localTime` only for orders whose details
  are stored, and `complete` says whether it read the whole history.
- **Every tool that takes dates walks the history newest first**, reading each
  order's details (newer ones too: there is no way past them) until an order is
  more than a day older than the range.

### What a receipt says

- **`localDate` and `localTime` are when the order was delivered or
  cancelled** (`deliveredAt`, `canceledAt`), in `GLOVO_TIME_ZONE`. Glovo keeps
  no order-placed time.
- **`charged.card` is the amount on the bank statement.** Apple Pay and Google
  Pay count as card (`method: "wallet"`); Glovo credits (`charged.glovoCredit`)
  and cash do not. `payments` lists every leg in Glovo's words.
- **`priceLines` are Glovo's breakdown, verbatim, and add up to the total.**
  "No cost" is `0.00`; a discount is negative, its percentage in `tag`.
- **An item's `price` is Glovo's line total, for display.** Item prices may
  not add up to the "Products" line (deposits, weighed goods, promotions), and
  a promoted line can be negative; the "Products" line is the real sum.
- **Lines a picker changed** carry `adjustment: "removed"` (not charged) or
  `"replacement"` with `replaces`. A refunded delivered order has
  `refunded: true` and Glovo's notice in `notices`.
- **Amounts are decimal strings** (`"52.84"`), parsed from Glovo's display
  text (`"1.234,56 RON"`) into whole cents, never through a float. One the
  parser cannot read is absent, never `0.00`.
- **No address, door note, phone number or courier leaves the server**: no
  receipt needs them, so they are not modelled.

`list_orders` carries `listedTotal`, the figure the app's order list shows.

### Matching card rows

Send the rows exactly as the bank booked them, a debit negative, each with its
currency:

```json
{ "charges": [{ "id": "tx-0001", "date": "2026-01-15", "amount": "-52.84", "currency": "RON" }] }
```

- **A row pairs with an order** when its amount equals the order's card leg
  (the total minus any Glovo credits) and its booking date is one day before to
  two days after the **UTC date of delivery**. The day before covers a card
  charged when the order was placed.
- **Delivered orders pair, and so do cancelled ones that still show a card
  leg**; orders in progress and cash orders do not.
- **Same-amount orders are claimed in time order**, so two identical orders on
  one day pair with two rows.
- **A positive amount is a credit** (a refund), listed under `credits`; it
  never claims the order it refunds.
- **`unmatchedOrders` lists only orders dated inside the rows' own span**, so
  an order at the window's edge, whose row you did not send, does not look like
  missing money. Rows that paired nothing, such as the monthly Glovo Prime fee,
  are in `unmatchedCharges`.

### Sign-in

The server trades the refresh token for access tokens of about 20 minutes
(`/oauth/refresh`), which leaves the refresh token valid: safe to repeat, and
the browser stays signed in. Access tokens stay in memory, and no token reaches
a log or an error message. The server never calls `/oauth/revoke`, the app's
sign-out, and a test holds it to that. Every call goes to `api.glovoapp.com`,
which `MCP_EGRESS_ALLOW` ([docs/configuration.md](../../docs/configuration.md))
can enforce.

### Stored orders and pacing

- **An order's details are stored a week after it was delivered or
  cancelled**, because refunds land after delivery. The store keeps Glovo's raw
  answer, so a fix to the receipt mapping applies to stored orders too: one
  file per order under `orders/` in the state folder, written whole by rename
  so processes can share it, 0600 in a 0700 folder because it holds the
  delivery address.
- **Every call goes out one at a time, at least 700 ms apart**, history pages
  included: a burst of history pages was throttled (HTTP 429), calls at that
  gap rarely are. A 429 is waited out at least 20 seconds (longer if
  `Retry-After` asks), four attempts in all; a 401 earns one fresh access
  token.
- **A cold read is about 1.4 orders a second**; stored orders read instantly,
  and history pages are remembered for five minutes.

### Code

What this server shares with its sibling, [Bolt Food receipts](../bolt-food),
lives in [`packages/receipts`](../../packages/receipts): the tools, the use
cases behind `get_receipts`, `match_card_charges`, `search_items`,
`export_items` and `order_stats`, and the order store. Its README says what
each server adds. Glovo's own additions are the parsers for display amounts
and payment legs (`src/domain/money.ts`, `src/domain/receipt/payments.ts`) and
the undated history walk (`src/app/usecases/details.ts`). [API.md](API.md)
describes Glovo's API.

The unit tests use invented payloads and a fake `fetch`.
`npx tsx scripts/smoke.ts [days] [charges.json]` drives the built server with
your credentials over the last `days` (30 by default) and prints counts and
shapes only.

## Limitations

- **Unofficial.** Glovo can change its API or refuse this client at any time;
  `api` failures or receipts with missing fields show it.
- **Read-only by design.** It does not order, cancel or rate.
- **No dates in the history**, so the first question over a long range takes
  minutes.
- **No warning before the token stops working**: it states no expiry.
- **One account per server**: the one in `credentials.json`.
- **Refunds are not subtracted** in `order_stats`, because Glovo does not say
  when one reached the card. A receipt marks a refunded order (`refunded`).
- **Amounts are parsed from Glovo's Romanian display format**
  (`"1.234,56 RON"`). Other countries' formats are untested; an amount the
  parser cannot read stays absent rather than wrong. Picker changes and payment
  legs are parsed from English, which the server asks for, or Romanian.

## Other servers for Glovo

Searched 2026-10-15. Glovo publishes one server, and one community server
exists; neither reads an account's orders as receipts:

- **Glovo's own** remote server, in Claude's connector directory since August
  2026, finds products and stores nearby (`search_products`,
  `render_products_carousel`). It does not read an account.
- **`glovo-skill`** on GitHub (stdio, last release July 2026) signs in once
  through a Chrome window and keeps the session in a local file. It browses
  stores and menus, reads the order history and an order's items, plans
  reorders and can change the real basket.

This one exists for what neither offers: itemised receipts with fees, tip and
the split between credits and card, bank card charges paired with their
orders, a CSV of every product line, and no change to the account.

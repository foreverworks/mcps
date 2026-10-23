# <img src="icons/icon.svg" width="36" height="36" alt="Oblio icon"> Oblio MCP server

Issue and track a Romanian company's invoices from your AI assistant, through
[Oblio](https://www.oblio.eu)'s API. It reads clients, products, series, VAT
rates and issued invoices; it issues invoices and proformas, records payments,
and cancels, restores, reverses or deletes invoices. Every tool that makes,
changes or unmakes a fiscal document is `money`: your client asks you first,
and shows the total computed the way ANAF checks it.

**You need** an Oblio account, its API secret, and the tax id (CIF) of the
company the server should act on. There is no sandbox: an invoice issued here
is real and takes the next number in its series.

## What you can ask

- "Which invoices from September are still unpaid?"
- "Invoice Client SRL for 8 hours of consulting at 1,000 RON an hour plus 21%
  VAT, due in 30 days."
- "Client SRL paid 1,000 EUR on invoice FCT 0042 by bank transfer today.
  Record it."
- "Turn proforma PRF 0007 into an invoice."
- "Reverse invoice FCT 0042, and keep the payment recorded on it."

## Install

<!-- install:begin -->
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect/mcp/install?name=oblio&inputs=%5B%7B%22type%22%3A%22promptString%22%2C%22id%22%3A%22oblio_config%22%2C%22description%22%3A%22Path%20of%20app.json%3A%20your%20Oblio%20login%20email%2C%20API%20secret%20and%20the%20company's%20CIF%2C%20as%20the%20README%20describes%20it.%22%7D%5D&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40foreverworks%2Fmcp-oblio%22%5D%2C%22env%22%3A%7B%22OBLIO_CONFIG%22%3A%22%24%7Binput%3Aoblio_config%7D%22%7D%7D) [![Install in Cursor](https://img.shields.io/badge/Cursor-Install_Server-000000?style=flat-square&logo=cursor&logoColor=white)](https://cursor.com/install-mcp?name=oblio&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBmb3JldmVyd29ya3MvbWNwLW9ibGlvIl0sImVudiI6eyJPQkxJT19DT05GSUciOiIke2VudjpPQkxJT19DT05GSUd9In19) [![Download for Claude Desktop](https://img.shields.io/badge/Claude_Desktop-Download_Bundle-D97757?style=flat-square&logo=claude&logoColor=white)](https://github.com/foreverworks/mcps/releases/latest/download/mcp-oblio.mcpb)

With Claude Code:

```bash
claude mcp add oblio -e OBLIO_CONFIG="<path to Oblio app.json>" -- npx -y @foreverworks/mcp-oblio
```

Claude Desktop (Settings, Developer, Edit Config) and most other clients read the same command as JSON:

```json
{
  "mcpServers": {
    "oblio": {
      "command": "npx",
      "args": ["-y", "@foreverworks/mcp-oblio"],
      "env": {
        "OBLIO_CONFIG": "<path to Oblio app.json>"
      }
    }
  }
}
```

Each runs the published package on Node 22.19 or newer. VS Code and the Claude Desktop bundle ask for `OBLIO_CONFIG` as they add the server. Cursor reads it from your environment instead (`${env:OBLIO_CONFIG}`), so set it before you start Cursor. [Configuration](#configuration) says what it holds.

### From a clone

```bash
git clone https://github.com/foreverworks/mcps.git && cd mcps
npm ci && npm run build
claude mcp add oblio -e OBLIO_CONFIG="<path to Oblio app.json>" -- node "$PWD/servers/oblio/dist/index.js"
```

In a JSON configuration, the command is `node` and its one argument the full path of `servers/oblio/dist/index.js`. To share one running copy between several clients over HTTP, see [docs/deploying.md](../../docs/deploying.md).
<!-- install:end -->

## Configuration

| Variable | Required | Meaning |
|---|---|---|
| `OBLIO_CONFIG` | yes | Path of `app.json` (below), which the server only reads. Under systemd, when this is unset, `app.json` in `CREDENTIALS_DIRECTORY` (`LoadCredential=app.json:<path>`) is used. |
| `OBLIO_STATE_DIR` | no | Where the access-token cache goes; the default is in [docs/configuration.md](../../docs/configuration.md). |

`app.json` holds three values, all required:

```json
{
  "client_id": "<the email you sign in to Oblio with>",
  "client_secret": "<the API secret>",
  "company_cif": "<the CIF of the company every call acts on>"
}
```

`company_cif` has no default, so no call can act on a company nobody named.
`api_base` and `token_url` override Oblio's endpoints, for tests or a proxy.
The server never writes `app.json`, and its errors name a bad field, never a
value.

### Getting the API secret

1. Sign in to the Oblio web app.
2. Open Settings, then Account Data (Setari, Date cont), and copy the API
   secret.
3. Put it in `app.json` as `client_secret`, with the email you signed in with
   as `client_id`.

Oblio makes a new secret every time the account's password is reset, so after
a reset `app.json` needs the new one.

The state folder holds `access_token.json`, the hour-long token Oblio issues
for the secret, written with mode 0600 and locked across processes. The
variables every server shares (transport, limits, confirmation) are in
[docs/configuration.md](../../docs/configuration.md).

## First run

1. Ask your assistant to run Oblio's `health` check. It answers with the
   account, the company CIF from `app.json`, and whether the account reaches
   that company. A refused secret shows up here, before anything is issued.
2. Ask for your series (`list_series`) and VAT rates (`list_vat_rates`): an
   invoice names its series and each line's rate by the names Oblio gives
   them.

From a shell, `node dist/index.js --health` prints one `OBLIO:` line and exits
non-zero when the credentials do not work, which suits a timer.

## Tools

**read** changes nothing; **write** changes something in your Oblio account;
**money** makes, changes or unmakes a fiscal document, and your client asks you
before each call.

| Tool | Access | What it does |
|---|---|---|
| `health` | read | Whether the server is up, as which account, on which company CIF, and whether the account reaches that CIF. Always asks Oblio. |
| `list_companies` | read | The companies the account is attached to. Cached 10 minutes. |
| `list_clients` | read | Saved clients, filtered by name or CIF, a page at a time. Never cached. |
| `list_products` | read | Saved products and services, filtered by name or code, a page at a time. Never cached. |
| `list_series` | read | The document series and the number each one issues next. Cached 10 minutes, and forgotten after any issue or delete. |
| `list_vat_rates` | read | The VAT rates a line's `vat_name` and `vat_percentage` come from. Cached 10 minutes. |
| `list_invoices` | read | Issued invoices by period, series, buyer, status (unpaid, paid, cancelled) and e-Factura state, newest first, a page at a time. |
| `get_invoice` / `get_proforma` | read | One document by series and number: its PDF and e-Factura links, its total and its payments. |
| `create_proforma` | write | Issues a proforma. It is not a fiscal document, but it takes a number in its series. |
| `create_invoice` | **money** | Issues an invoice. |
| `invoice_from_proforma` | **money** | Issues an invoice that references a proforma, with the proforma's client, lines and total. |
| `collect_invoice` | **money** | Records a payment received against an issued invoice: how, how much, when, and its reference. |
| `cancel_invoice` / `restore_invoice` | **money** | Cancels an invoice (its number stays used), or undoes that. |
| `reverse_invoice` | **money** | Issues the reversing invoice (storno) for an issued one, its total exactly the original's, negated. |
| `delete_invoice` | **money** | Removes an invoice for good. Oblio allows it only for the last number in a series. |

## Money

The seven `money` tools are marked so in `tools/list`, and your client asks you
to approve each call (Claude Code does, in every permission mode). With
`MCP_CONFIRM=elicit` the server asks you itself instead, in one line computed
from the arguments. For example:

```
Issue invoice in series FCT to Client SRL (CIF RO87654329): 9680.00 RON incl. VAT 1680.00 (1 line), dated 2026-09-28, due 2026-10-28, marked paid by Ordin de plata OP 7001
Record 1000.00 EUR paid on invoice FCT 0042 to Client SRL, Ordin de plata OP 7001, 2026-10-02, leaving 210.00 EUR unpaid
Issue a reversing invoice for FCT 0042, Client SRL, total -9680.00 RON, in series FCT, keeping the payment recorded on it
DELETE invoice FCT 0042 totalling 9680.00 permanently (no undo; only the last number in a series can be deleted, and anything already sent to ANAF stays there)
```

The first line is the document in [Document input](#document-input), below.
The last is `delete_invoice` given `expect_total`; without it the line says
"total not given, so not checked". The server puts its name first, so you read
`oblio: Issue invoice ...`.

What you approve is what is issued:

- **The total you confirm is the total issued.** It is computed by
  `documentTotal` (the kit's `invoiceTotals.ts`), the same function whose
  result `create_invoice` returns as `computedTotal`. After issuing, the
  document is read back, and if Oblio's total differs the call fails with
  `reason: "total_mismatch"`, naming the document that was issued.
  `invoice_from_proforma` reads the proforma first and holds the invoice to
  its total.
- **Cancel, restore and delete read the invoice first** and answer with what it
  totalled, the document Oblio acted on and the company's CIF. Given
  `expect_total`, a number that names an invoice of another total changes
  nothing. (Oblio's document read carries no buyer, so the buyer cannot be
  checked the same way.)
- **A payment is checked against the invoice**: the server refuses a cancelled
  invoice, one already paid in full, and an amount over what is still owed,
  saying how much that is.

## Troubleshooting

**`auth`: "Oblio refused the client_id and secret".** The secret changed,
usually after a password reset. Copy the new one from Settings, Account Data
into `app.json`.

**`api` with `reason: "outcome_unknown"`** after an issue or a delete. The
connection dropped, so nobody knows whether Oblio acted. Look the document up
first (`get_invoice`, or Oblio's web app). If it is not there, call again with
the `idempotency_key` the error reported: Oblio will not issue the same key
twice. A repeated `collect_invoice` is safe as it is: it finds the payment if
it landed and records nothing.

**`api` with `reason: "total_mismatch"`.** The document was issued, but
Oblio's total is not the one you confirmed. Open it (`get_invoice` or
`get_proforma`) and cancel it if it is wrong; do not issue it again.

**`api` with Oblio's own message**, such as "Seria FCT nu exista". The message
names the field or series at fault; `list_series` and `list_vat_rates` give
the names Oblio expects.

**`api` with status 401 or 403 on a call.** The account cannot act on the
company in `company_cif`; `health` and `list_companies` show which companies
it reaches.

**`api` with `reason: "drift"`.** Oblio's answer changed shape. The server
refuses to guess; please report it.

## How it works

### Document input

`create_invoice` and `create_proforma` take the document as a validated input
modelled on Oblio's "Parametri document" table, in snake_case. The company's
CIF is not part of it: it comes from `app.json`, so no pasted example can issue
against another company.

```json
{
  "client": { "name": "Client SRL", "cif": "RO87654329", "vat_payer": true },
  "series_name": "FCT",
  "issue_date": "2026-09-28",
  "due_date": "2026-10-28",
  "currency": "RON",
  "products": [
    { "name": "Consulting", "price": "1000.00", "quantity": "8", "measuring_unit": "ora",
      "vat_name": "Normala", "vat_percentage": "21", "vat_included": false, "product_type": "Serviciu" }
  ],
  "collect": { "type": "Ordin de plata", "document_number": "OP 7001" }
}
```

- **Every amount is a decimal string** (`"1000.00"`), checked by a pattern and
  sent to Oblio as that string, so it never passes through a floating-point
  number. The arithmetic is the kit's exact `decimal.ts`.
- **`vat_included` is required on every line**, because Oblio's default
  ("included") silently turns a net price into a gross one. **`vat_percentage`
  is required** because the total you confirm is computed from it.
- **The buyer's code and IBAN are checked by their check digits**: a Romanian
  buyer's `cif` must be a CIF with a valid control digit or a valid CNP, so a
  transposed digit cannot send the invoice to another company. A buyer whose
  `country` is another country passes as written. With `send_email`, the
  answer's `emailedTo` says where Oblio sent the invoice.
- **Series and numbers are checked for their form**: a series is letters and
  digits as `list_series` shows it; a number is digits only, as text
  (`"0042"`).
- **Everything else that would go wrong is refused before sending**, all at
  once (`src/domain/rules.ts`): more decimals than `precision` (Oblio would
  round silently), a zero quantity, a negative price, a rate outside 0-100, a
  due date before the issue date, a `Chitanta` without its receipt series, any
  other payment without its reference.
- **A retry cannot issue twice.** Oblio refuses a second document with the same
  `idempotency_key`. When you give none, the key is derived from the document
  (its kind, the company, its content and its issue date: `src/domain/keys.ts`).
  To issue a deliberately identical document the same day, give a key of your
  own.

### The total

EN 16931's rule, which ANAF validates every e-Factura against and Oblio
follows: a line's amount is quantity times price, rounded to 2 decimals; VAT is
computed once per rate on the sum of those amounts (VAT-inclusive and
VAT-exclusive lines at one rate are two groups, each rounded once); the total
is amounts plus VAT. The VAT inside a VAT-inclusive gross is gross x rate /
(100 + rate). Rounding is half away from zero throughout, as PHP's `round()`
does. Because that rounding is symmetric, a storno's lines add up to the
original's total exactly, negated; the tests check it on the rounding cases.

### Payments and reversals

`collect_invoice` takes the invoice's series and number, how it was paid
(`Ordin de plata` for a bank transfer, `Card`, `Chitanta` for cash with a
receipt, and Oblio's other types), the amount, the day, and the payment's
reference (a receipt takes its series instead, since Oblio numbers it). The
amount and the day are required even though Oblio would default them to the
whole total and today, because nobody should confirm those defaults unseen. The
invoice is read first, so the buyer and currency in the line you confirm are
the invoice's own, and the answer gives the balance before and after. A
repeated call finds the payment if it already landed and records nothing; to
record a second payment identical in type, reference, amount and date, give an
`idempotency_key` of your own. A payment is removed in Oblio's web app; this
server does not undo one.

`reverse_invoice` uses Oblio's own reference flow, so the storno and the
original are linked in Oblio and nothing is retyped. It reverses the whole
invoice; for a partial correction, issue a correcting invoice with
`create_invoice`. `storno_series` picks the series (the original's by
default), and `remove_payments` decides whether the payments recorded on the
original stay (the default, as when money is refunded separately) or go
(Oblio's `refund`). A cancelled invoice and one that is itself a reversal are
refused. The idempotency key comes from the invoice being reversed, so no
retry, on any day, issues a second storno; to reverse it again on purpose,
after cancelling the first, give a key of your own.

### Listing invoices

`list_invoices` gives, for each invoice, its series and number, dates,
currency, total as Oblio wrote it, whether it is cancelled, the buyer, its
payments, its e-Factura state and its PDF link. To find a buyer by name, look
them up with `list_clients` and filter by their CIF.

- `unpaid` and `paid` follow Oblio's "collected" flag and leave cancelled
  invoices out; `cancelled` lists only those. Drafts are never listed.
- Oblio reports each invoice's e-Factura state (`not_sent`, `processing`,
  `sent`, `errors`) but cannot filter by it, so that filter is applied to each
  page after Oblio answers. A filtered page says how many rows it read
  (`scanned`), and it can hold none and still offer a next page: keep following
  `nextCursor`.
- A page holds at most 100 rows. The cursor carries the last row it read, so an
  invoice issued while you page does not repeat a row, and a cursor given with
  different filters is refused.

### What a failure proves

There is no sandbox, so what each failure proves decides whether a call is
repeated (`src/infra/http.ts`, on the kit's `makeHttp`):

- **429** proves nothing happened: every call repeats, honouring `Retry-After`.
- **401 on a fresh token**: the token is minted again once, and a second 401 is
  believed.
- **A dropped connection or a 5xx** proves nothing either way. Reads, cancels
  and restores repeat. Issues and deletes do not: they fail as
  `outcome_unknown` (see [Troubleshooting](#troubleshooting)).

Oblio throttles at 30 requests per 100 seconds on documents and 30 per 10
seconds elsewhere. The server paces itself below both
(`src/infra/http/throttle.ts`: 10 at once, then one every 5 seconds for issuing
and two a second for the rest), so a burst waits instead of meeting a 429. Over
HTTP, the pacing covers every client of the process.

### What comes back

Oblio publishes no OpenAPI or JSON Schema, and its SDKs carry no types, so the
wire types are modelled by hand in `src/domain/schema.ts`, citing
https://www.oblio.eu/api and the PHP SDK at `OblioSoftware/OblioApi@027a5cc`.
Every response is parsed against them at the boundary; a documented field that
goes missing fails the call as `drift` instead of travelling on, and fields
beyond the documented ones are dropped. A flag is a boolean whichever of
`true`, `1` or `"1"` Oblio sent; a decimal is the string Oblio wrote; a series
number stays text (`"0051"`). An `api` failure leads with Oblio's own
`statusMessage`, because "Seria FCT nu exista" is the whole answer.

`npx tsx scripts/smoke.ts` drives the built server with your credentials. It
is read-only unless given `--write-proforma <series>`, which issues one 0.01
proforma; nothing `money` is reachable from it.

## Limitations

- **One company per server**: the CIF in `app.json`. An account attached to
  several companies needs one configuration per company.
- **It does not send e-Factura.** Sending an invoice to ANAF is a separate act;
  the [`anaf-efactura`](../anaf-efactura) server does it.
- **Delivery notes are out of scope**, and so is an invoice made from one.
- **Some documented Oblio fields are left out on purpose**:

| Oblio field | Why not |
|---|---|
| discount lines (`discount`, `discountType`, `discountAllAbove`) | Oblio does not document whether a value discount includes VAT or how it is rounded, so the total you confirm could not be exact. Put the discount into the line's price. |
| product `currency`, `exchangeRate` | A line in another currency needs Oblio's conversion before the total means anything. Lines are in the document's currency. |
| `disableAutoSeries`, `number` | Manual numbering can leave a gap or a duplicate in a fiscal series. Oblio numbers. |
| `referenceDocument` on `create_invoice` | A reference is its own act with its own confirmation line: `reverse_invoice` covers a storno and `invoice_from_proforma` a proforma. |
| `clientLocation` (BT-71 to BT-80), `deputyName`, `deputyIdentityCard`, `deputyAuto`, `selesAgent`, `noticeNumber` | Goods-delivery fields: a delivery location, a delegate, a vehicle, a sales agent, a delivery note. |
| `issuerId` | The issuer's personal identity number (CNP), not needed on an invoice. `issuer_name` is taken. |
| `receptionNotice`, `projectNumber`, `buyerIdentifier`, `clientAccountReference`, `contractNumberDate` | Oblio's table gives the first three shifted e-Factura field numbers, so which field each fills is unclear; the other two have no e-Factura field. `order_number` (BT-13) and `contract_number` (BT-12) are taken. |
| `spvExtern` | Sending to ANAF is a separate act (above). |
| `codeClient`, `codeEAN`, `nameTranslation`, `measuringUnitTranslation` | Catalogue and translation fields; the product's `name` and `code` are taken. |

`list_invoices` does not take Oblio's `withProducts` (the shape of a listed
line is not documented, so it cannot be checked) or its `id` and `number`
filters (`get_invoice` reads one document by series and number).

## Other servers for Oblio

Searched 2026-10-15. Oblio publishes none: its GitHub account has API clients
for PHP, Node, Python, Go, Java and C# and shop plugins, and its site does not
mention MCP. Two community servers cover more of Oblio's API than this one:

- **`oblio-mcp`** on GitHub (not on npm): stdio only, the e-mail and API secret
  in environment variables, the company chosen at runtime with `set_cif`;
  every document type including delivery notes, a document list, payments and
  e-Factura submission.
- **`io.usefulapi/oblio`** in the MCP Registry: hosted over HTTP by a third
  party that holds your Oblio credentials behind its own OAuth sign-in; similar
  coverage plus webhooks; free for 100 calls a month, then paid.

This one exists for what none of them does: it computes an invoice's total by
the rule ANAF validates e-Factura against, puts that total in the line you
confirm, and checks the issued document against it; it derives an idempotency
key when the caller gives none, so a retry cannot issue twice; it checks a
Romanian buyer's CIF or CNP by its control digit; it acts only on the one
company its configuration names; and it can run as a service of its own, with
its secret in a file the client never reads. It does not submit e-Factura.

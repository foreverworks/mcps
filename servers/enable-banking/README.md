# <img src="icons/icon.svg" width="36" height="36" alt="Enable Banking icon"> Enable Banking MCP server

Read, search and export your bank statements and balances from your AI
assistant, through [Enable Banking](https://enablebanking.com), a licensed
PSD2 provider for banks across Europe. It moves no money: besides reading, it
only starts, stores and ends consents. `start_auth` is its one `money` tool,
because it asks your bank for 180 days of read access; your client asks you
before each call.

**You need** an Enable Banking application (its id, a registered redirect URL
and its private key), and the account holder, to approve each consent in their
bank's app every 180 days. A bank allows about four reads of an account a day
without the holder present, shared by every program on that consent, so read
a period once and narrow it here.

## What you can ask

- "Which bank consents do we have, and when does each one run out?"
- "What did we pay Example Supplier SRL this year?"
- "Show incoming payments over 1,000 RON in September, across all our
  accounts."
- "What is the available balance on our EUR account?"
- "Export last quarter's transactions as CSV for our accountant."
- "Our consent with Example Bank ends next week. Renew it."

## Install

<!-- install:begin -->
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect/mcp/install?name=enable-banking&inputs=%5B%7B%22type%22%3A%22promptString%22%2C%22id%22%3A%22enable_banking_config%22%2C%22description%22%3A%22Path%20of%20app.json%3A%20your%20Enable%20Banking%20application's%20id%2C%20its%20redirect%20URL%20and%20the%20name%20of%20its%20private%20key%20file%2C%20as%20the%20README%20describes%20it.%22%7D%2C%7B%22type%22%3A%22promptString%22%2C%22id%22%3A%22enable_banking_key%22%2C%22description%22%3A%22Optional.%20Path%20of%20the%20application's%20private%20key%20(PEM)%2C%20when%20app.json%20does%20not%20name%20it.%22%7D%5D&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40foreverworks%2Fmcp-enable-banking%22%5D%2C%22env%22%3A%7B%22ENABLE_BANKING_CONFIG%22%3A%22%24%7Binput%3Aenable_banking_config%7D%22%2C%22ENABLE_BANKING_KEY%22%3A%22%24%7Binput%3Aenable_banking_key%7D%22%7D%7D) [![Install in Cursor](https://img.shields.io/badge/Cursor-Install_Server-000000?style=flat-square&logo=cursor&logoColor=white)](https://cursor.com/install-mcp?name=enable-banking&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBmb3JldmVyd29ya3MvbWNwLWVuYWJsZS1iYW5raW5nIl0sImVudiI6eyJFTkFCTEVfQkFOS0lOR19DT05GSUciOiIke2VudjpFTkFCTEVfQkFOS0lOR19DT05GSUd9IiwiRU5BQkxFX0JBTktJTkdfS0VZIjoiJHtlbnY6RU5BQkxFX0JBTktJTkdfS0VZfSJ9fQ%3D%3D) [![Download for Claude Desktop](https://img.shields.io/badge/Claude_Desktop-Download_Bundle-D97757?style=flat-square&logo=claude&logoColor=white)](https://github.com/foreverworks/mcps/releases/latest/download/mcp-enable-banking.mcpb)

> [!NOTE]
> `@foreverworks/mcp-enable-banking` is not on npm yet: the buttons and the `npx` commands below work once it is published. Until then, [run it from a clone](#from-a-clone).

With Claude Code:

```bash
claude mcp add enable-banking -e ENABLE_BANKING_CONFIG="<path to Enable Banking app.json>" -- npx -y @foreverworks/mcp-enable-banking
```

Claude Desktop (Settings, Developer, Edit Config) and most other clients read the same command as JSON:

```json
{
  "mcpServers": {
    "enable-banking": {
      "command": "npx",
      "args": ["-y", "@foreverworks/mcp-enable-banking"],
      "env": {
        "ENABLE_BANKING_CONFIG": "<path to Enable Banking app.json>"
      }
    }
  }
}
```

Each runs the published package on Node 22.19 or newer. VS Code and the Claude Desktop bundle ask for each setting as they add the server; leave an optional one empty. Cursor reads each from your environment instead (`${env:ENABLE_BANKING_CONFIG}` and so on), so set them before you start Cursor. The commands above set only what is required; [Configuration](#configuration) has the rest.

### From a clone

```bash
git clone https://github.com/foreverworks/mcps.git && cd mcps
npm ci && npm run build
claude mcp add enable-banking -e ENABLE_BANKING_CONFIG="<path to Enable Banking app.json>" -- node "$PWD/servers/enable-banking/dist/index.js"
```

In a JSON configuration, the command is `node` and its one argument the full path of `servers/enable-banking/dist/index.js`. To share one running copy between several clients over HTTP, see [docs/deploying.md](../../docs/deploying.md).
<!-- install:end -->
## Configuration

| Variable | Required | Meaning |
|---|---|---|
| `ENABLE_BANKING_CONFIG` | yes | Path of `app.json` (below), which the server only reads. |
| `ENABLE_BANKING_KEY` | no | Path of the application's private key (PEM). When unset, `app.json`'s `private_key` names it, relative to `app.json`'s folder. |
| `ENABLE_BANKING_STATE_DIR` | no | Where the consents (`sessions.json`), their backup and their lock live; the default is in [docs/configuration.md](../../docs/configuration.md). |
| `ENABLE_BANKING_EXPORTS_DIR` | no | Where `export_transactions` writes its CSV files. Default: `exports/` in the state folder. |

`app.json` holds the application's details from the control panel:

```json
{
  "application_id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  "application_name": "Example Books",
  "environment": "sandbox",
  "redirect_url": "https://example.com/bank-callback",
  "private_key": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.pem"
}
```

`application_id` and `redirect_url` are required, and `private_key` too unless
`ENABLE_BANKING_KEY` is set. `redirect_url` must match a registered one
exactly. `application_name` and `environment` only label `health`'s answer;
the `application_id` decides sandbox or production. `api_base` overrides
`https://api.enablebanking.com` for tests or a proxy; other keys are ignored.
Under systemd, a credentials directory renames files to their credential
names, so set `ENABLE_BANKING_KEY` there. The variables every server shares
are in [docs/configuration.md](../../docs/configuration.md).

### Getting the application and its key

1. In [Enable Banking's Control Panel](https://enablebanking.com/cp/), open
   API applications from the top menu. In "Add a new application", keep the
   Sandbox environment: its test banks let you try every tool without a real
   account.
2. Name the application (the account holder sees the name) and enter a
   redirect URL. Any page you control works: `complete_auth` only needs the
   address the browser lands on.
3. Keep the default private key option and press Register. Your browser
   generates the key and saves it as `<application id>.pem`; move it where
   only this server can read it, and write `app.json` beside it.

Production is a second application, registered with the Production
environment. It starts Inactive; "Activate by linking accounts" makes it
active in restricted mode, which reads only your own linked accounts until
you sign a contract with Enable Banking.

## First run

1. Ask your assistant to run Enable Banking's `health` check. It names the
   application, its environment, whether it is active and its redirect URLs,
   and counts the stored consents. A key that does not belong to the
   `application_id` fails here.
2. Find your bank with `list_aspsps` for its country. `start_auth` takes its
   `name`; `psuTypes` lists its account types (`business`, `personal`), and
   `maxConsentDays` its longest consent.
3. Ask for `start_auth` with that name, the country and the `psu_type`, and
   approve it. The link it returns is for the account holder: plan five
   minutes with the phone that holds the bank's app.
4. Open the link, sign in to the bank, and **tick every account** it offers.
   The request names no accounts, which asks for all of them.
5. The bank sends you back to the redirect URL with `?code=...`. Give that
   address (or the code) to `complete_auth` at once: the code works once, for
   minutes. Its answer lists the accounts and the consent's end date.

To renew a consent (`list_stored_sessions` says how many days it has left),
repeat steps 3 to 5 with its bank, country and type. Without a `label`, the
new consent takes the old one's place and label.

From a shell, `node dist/index.js --health` prints one `ENABLEBANKING:` line
and exits 1 when a person has to act or 2 when Enable Banking was unwell,
which suits a daily timer.

## Tools

**read** changes nothing at the bank or in the stored consents (an export
writes only its file); **write** changes the stored consents; **money** asks a
bank for access to your accounts.

| Tool | Access | What it does |
|---|---|---|
| `health` | read | Whether Enable Banking accepts the key, as which application and in which environment, where the files are, and how many consents are stored. |
| `list_aspsps` | read | The banks Enable Banking reaches in a country (empty for every market): the `name` `start_auth` takes, the account types each offers and its longest consent. Cached an hour. |
| `list_stored_sessions` | read | Every stored consent by label, with its bank, its accounts and when it **expires**, as a date and as days left. |
| `start_auth` | **money** | Starts a consent with a bank, for every account it offers, for 180 days. Returns a link **the account holder must open**. |
| `complete_auth` | write | Finishes a consent from the bank's redirect, stores it under a label, and reports its accounts and its end date. |
| `revoke_session` | write | Ends a stored consent at the bank and removes it here, keeping the previous file as a backup. |
| `list_accounts` | read | The accounts a consent reaches today, asked of the bank, each with the `uid` the other tools take. |
| `get_transactions` | read | A statement for one account, every account on a consent, or every stored account, with exact signed amounts, narrowed by text, direction and amount without another read at the bank. |
| `export_transactions` | read | The same statement written as a CSV file, for a long period, many accounts or an accountant. Returns the file's path, size and SHA-256. |
| `get_balances` | read | Every balance the bank reports for one account (booked, available and the others it sends), each an exact amount with its PSD2 code and its meaning. |

## Money

`start_auth` moves no money, but it grants 180 days of read access, which
only the account holder should decide. It is marked `money` in `tools/list`,
so your client asks you before each call (Claude Code does, in every
permission mode). With `MCP_CONFIRM=elicit` the server asks you itself, in one
line computed from the arguments:

```
enable-banking: Bank consent (PSD2, read-only: balances and transactions) with Example Bank (DE), personal accounts, every account the bank offers, valid 180 days: until 2030-07-01 if confirmed today
```

The end date is computed when you are asked and again when the call runs, so
a later confirmation moves it by the delay. Access starts when the account
holder approves in their bank.

## Troubleshooting

**`config`: "ENABLE_BANKING_CONFIG is not set"**, or a message naming
`app.json`. Set `ENABLE_BANKING_CONFIG` to a readable `app.json`, and
`ENABLE_BANKING_KEY` (or `private_key`) to the key.

**`auth`: "cannot use the private key at ..."**. The key file is missing,
unreadable or not an RS256 private key. Point `ENABLE_BANKING_KEY` or
`private_key` at the `.pem` the control panel saved; the next call reads it
again, with no restart.

**`api` with status 401 or 403.** Enable Banking refused the signed token:
the key does not belong to the `application_id` (a sandbox key beside a
production id, say).

**`api` with `reason` `EXPIRED_SESSION`, `REVOKED_SESSION`, `CLOSED_SESSION`
or `SESSION_DOES_NOT_EXIST`, or status 422 or 404, on a call that worked the
day before.** The consent lapsed or was revoked in the bank's app, and
retrying will not bring it back. Renew it with steps 3 to 5 of
[First run](#first-run).

**`api` from `complete_auth` with `reason` `EXPIRED_AUTHORIZATION_CODE`,
`WRONG_AUTHORIZATION_CODE` or `outcome_unknown`.** The code works once, for
minutes, and a dropped exchange cannot be repeated. Run `start_auth` again and
call `complete_auth` right after approving.

**`api` with `reason: "ASPSP_RATE_LIMIT_EXCEEDED"`.** The account's reads are
spent for the day. Wait a day, then read each period once and narrow it with
the filters.

**`input`: "the bank refused the consent: ..."**. The account holder declined,
or the bank failed; start again with `start_auth`. **"no code parameter
there"** means you pasted `start_auth`'s link, not the address the bank sent
you back to.

## How it works

### Statements

**Amounts stay decimal strings**, never JavaScript numbers, which keep only 15
to 17 significant digits (`9007199254740993.01` becomes `9007199254740992`).
Enable Banking sends an unsigned amount and a `credit_debit_indicator`;
`get_transactions` signs the text, negative for money out. A row whose amount
came as a JSON number, or not as a plain decimal, carries an `amountWarning`.

**Search runs here, after the read**: a bank only returns every row in a date
range. A filtered answer echoes the filter, with `fetched` (rows read) beside
`count` (rows matched).

- `text` looks in the counterparty's name and IBAN, the payment reference and
  the entry reference, ignoring case, diacritics and an IBAN's spaces:
  `santier` finds `ȘANTIER EXEMPLU SRL` and the cedilla `Şantier` some banks
  still send.
- `direction` is `credit` (money in) or `debit` (money out).
- `amount_min` and `amount_max` bound the size, sign ignored, inclusive, as
  exact decimals; a row whose amount could not be read exactly is left out and
  counted in `amountUnreadable`.
- `date_from` and `date_to` are inclusive; empty is unbounded.
  `transaction_status` defaults to `booked` and takes a name (`pending`,
  `cancelled`, ...) or a PSD2 code; empty leaves the bank's default.

**Several accounts are read one at a time**, since banks throttle bursts,
and each row names its account. A refused account appears in `accounts` with
its error and remedy, beside the others' rows. Arguments are checked before
the first read, an account `uid` (a UUID that changes with every consent) for
its form, so a typo spends nothing. Pages are followed to the end, up to 200.

**The counterparty is the other side.** On a debit, `debtor_account` is your
own IBAN, so the side is picked by direction. Remittance lines are joined with
one space, because banks split references anywhere.

**Exports** have the columns `account_label`, `account_iban`, `booking_date`,
`value_date`, `direction`, `amount`, `currency`, `counterparty_name`,
`counterparty_iban`, `remittance`, `reference`, `status`, `bank_code`,
`merchant_category_code`, `amount_warning`. Every cell is quoted; one a
spreadsheet would run as a formula (starting with `=`, `+` or `@`) gets a
leading apostrophe, but a negative amount does not. Each file is named for its
scope, dates and creation time, so it never replaces one someone has open,
and is written at mode 0640.

### Consents and sessions.json

**A consent is stored before anything else**, because Enable Banking reveals
a session id exactly once, and another costs the account holder a new
authentication. `complete_auth` exchanges the code, stores the result, then
asks for each account's details; if that fails, the consent stands and the
account carries a `detailsError`. A new bank's consent is labelled
`<bank>_<country>` (`example_bank_de`) unless you give a `label`.

**`sessions.json` is a format other programs can read**, defined in
`src/domain/sessionsFile.ts`:

- an object keyed by label (`a-z 0-9 _ -`, an identifier anywhere);
- each entry the `POST /sessions` response verbatim: `session_id`, `accounts`
  (with `uid`, `account_id.iban`, `identification_hash`, ...), `aspsp`,
  `psu_type`, `access.valid_until`;
- two-space JSON at mode 0600, written atomically under a lock, other labels
  carried over. The previous file is re-serialised into `sessions.json.bak`
  first, or kept aside as `sessions.json.unreadable-<ms>` if it is not a JSON
  object.

`identification_hash` identifies an account across consents, linking a
renewal to the history of the one it replaced. When an exchange lacks such a
field, `complete_auth` stores the consent anyway and reports `formatWarnings`.

**Ending a consent** closes the session at Enable Banking, which ends the
bank's consent, then removes the label; one the bank already ended is removed
too. If the bank refuses, nothing changes here.

### Requests

**There is no grant to refresh.** Each attempt carries a JWT signed on the
spot with the private key (RS256, valid five minutes, the `application_id` as
`kid`), so a failing `health` means the key or the id, never an expiry.
`src/infra/http.ts` tries a read up to four times on a 5xx or a dropped
connection, takes a 401 or a 422 as final, and never resends a POST Enable
Banking may have acted on.

**Wire types** are generated by openapi-typescript from
[Enable Banking's OpenAPI description](https://enablebanking.com/docs/api/reference/enablebanking-api.yaml)
(`npm run gen:types -w @foreverworks/mcp-enable-banking`; read the diff).
`src/domain/schema.ts` adds two measured adjustments: an optional field may be
`null` (a statement's last page has `continuation_key: null`), and an amount
is `string | number`.

**Only the bank catalogue is cached** (an hour per country, in memory): it is
the same for everyone. `npx tsx scripts/smoke.ts` reads one statement over the
last three days from a real consent, and with `--consent` also renews the
consent, which needs the account holder.

## Limitations

- **Account information only** (AIS): no payment initiation, none planned.
- **A consent needs the account holder**, to make it and to renew it: the
  bank's authentication is the point of PSD2.
- **Every consent asks for 180 days and every account.** A bank with a shorter
  `maxConsentDays` refuses it rather than shortening it.
- **No history of its own** (no cache, alerts or categories), so every
  statement is a read at the bank. A program that needs fewer reads should
  keep its own ledger, which `sessions.json` is designed to feed.
- **One application per server**: sandbox and production need a configuration
  each.

## Other servers for Enable Banking

Searched 2026-10-21. Enable Banking publishes none: its GitHub organisation
has API samples, a command line tool and an eIDAS broker, and its site does
not mention MCP. Four community servers read accounts through it:

- **`enable-banking-mcp`** on npm, the most downloaded (752 in the month to
  2026-10-18): stdio on macOS, secrets in the Keychain, for personal,
  noncommercial use only.
- **`bankmcp`** on npm (555 that month): local, or hosted behind its own
  sign-in, with watches that call a webhook. Amounts become floating-point
  numbers.
- **`banking-mcp`** on GitHub: a Cloudflare Worker behind OAuth that keeps
  balances and transactions in its own database, with categories and exports;
  banks are linked from a command line, not a tool.
- **`bank-mcp`** by elcukro on GitHub: Enable Banking beside Plaid, Tink and
  Teller. Amounts become floating-point numbers.

This one exists for what none of them does: amounts stay exact decimal
strings from the bank to the answer; starting a consent is a `money` tool
whose confirmation names the bank, the accounts and the end date; and
consents are kept by label in a file other programs can read, with a backup of
the previous one and, per account, the hash that ties a renewal to its
history. It lacks what the others add: alerts (`bankmcp`), a local cache and
categories (`banking-mcp`), and banks beyond Enable Banking (`bank-mcp`).

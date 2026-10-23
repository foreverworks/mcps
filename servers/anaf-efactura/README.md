# <img src="icons/icon.svg" width="36" height="36" alt="ANAF e-Factura icon"> ANAF e-Factura MCP server

Read the invoices your company sent and received through Romania's e-Factura,
check ANAF's seal on them, and file invoices and e-Transport declarations with
[ANAF](https://www.anaf.ro), from your AI assistant. It also validates, renders
and writes invoices, and looks companies up in ANAF's VAT registry. Its three
`money` tools (`upload_invoice`, `upload_invoice_b2c`, `etransport_file`) file
a document that cannot be withdrawn: your client asks you before each call,
and each goes to ANAF's test environment unless you say otherwise.

**You need** an OAuth application registered with ANAF (its client id, secret
and callback URL), the company's CIF, and a person with a qualified digital
certificate and SPV rights for the company, who signs in once in a browser.
The server then renews the grant itself, and its `--health` check warns two
weeks before it would need that person again. Validating, rendering, building
and reading an invoice, checking a seal and looking up a company need no
account.

## What you can ask

- "Which invoices did suppliers send us in the last two weeks?"
- "Download the newest invoice we received, check ANAF's seal on it, and list
  its lines."
- "Is RO87654329 a VAT payer, and does it apply VAT on collection?"
- "Invoice Client SRL for 10 hours of consulting at 500 RON an hour plus 21%
  VAT, have ANAF validate it, and file it in the test environment."
- "How many days are left on our ANAF authorization?"

## Install

<!-- install:begin -->
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect/mcp/install?name=anaf-efactura&inputs=%5B%7B%22type%22%3A%22promptString%22%2C%22id%22%3A%22anaf_config%22%2C%22description%22%3A%22Path%20of%20app.json%3A%20the%20OAuth%20app%20you%20registered%20with%20ANAF%20(its%20client%20id%20and%20secret%2C%20the%20callback%20URL)%20and%20the%20company's%20CIF%2C%20as%20the%20README%20shows.%20lookup_company%2C%20validate_invoice%20and%20parse_invoice%20work%20without%20it.%22%7D%5D&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40foreverworks%2Fmcp-anaf-efactura%22%5D%2C%22env%22%3A%7B%22ANAF_CONFIG%22%3A%22%24%7Binput%3Aanaf_config%7D%22%7D%7D) [![Install in Cursor](https://img.shields.io/badge/Cursor-Install_Server-000000?style=flat-square&logo=cursor&logoColor=white)](https://cursor.com/install-mcp?name=anaf-efactura&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBmb3JldmVyd29ya3MvbWNwLWFuYWYtZWZhY3R1cmEiXSwiZW52Ijp7IkFOQUZfQ09ORklHIjoiJHtlbnY6QU5BRl9DT05GSUd9In19) [![Download for Claude Desktop](https://img.shields.io/badge/Claude_Desktop-Download_Bundle-D97757?style=flat-square&logo=claude&logoColor=white)](https://github.com/foreverworks/mcps/releases/latest/download/mcp-anaf-efactura.mcpb)

With Claude Code:

```bash
claude mcp add anaf-efactura -e ANAF_CONFIG="<path to ANAF app.json>" -- npx -y @foreverworks/mcp-anaf-efactura
```

Claude Desktop (Settings, Developer, Edit Config) and most other clients read the same command as JSON:

```json
{
  "mcpServers": {
    "anaf-efactura": {
      "command": "npx",
      "args": ["-y", "@foreverworks/mcp-anaf-efactura"],
      "env": {
        "ANAF_CONFIG": "<path to ANAF app.json>"
      }
    }
  }
}
```

Each runs the published package on Node 22.19 or newer. VS Code and the Claude Desktop bundle ask for `ANAF_CONFIG` as they add the server. Cursor reads it from your environment instead (`${env:ANAF_CONFIG}`), so set it before you start Cursor. [Configuration](#configuration) says what it holds.

### From a clone

```bash
git clone https://github.com/foreverworks/mcps.git && cd mcps
npm ci && npm run build
claude mcp add anaf-efactura -e ANAF_CONFIG="<path to ANAF app.json>" -- node "$PWD/servers/anaf-efactura/dist/index.js"
```

In a JSON configuration, the command is `node` and its one argument the full path of `servers/anaf-efactura/dist/index.js`. To share one running copy between several clients over HTTP, see [docs/deploying.md](../../docs/deploying.md).
<!-- install:end -->

## Configuration

| Variable | Required | Meaning |
|---|---|---|
| `ANAF_CONFIG` | yes | Path of `app.json` (below), which the server only reads. |
| `ANAF_STATE_DIR` | no | Where the grant, a begun authorization and the ledger of production filings go; the default is in [docs/configuration.md](../../docs/configuration.md). |
| `ANAF_DOWNLOADS_DIR` | no | The outbox for downloaded archives, PDFs and built invoices; default `<state dir>/invoices`. |

`app.json` holds the application you register with ANAF (below):

```json
{
  "app_name": "<the name you gave it at ANAF, shown by health>",
  "client_id": "<Client ID>",
  "client_secret": "<Client Secret>",
  "redirect_uris": ["<the Callback URL you registered>"],
  "company_cif": "<the company's CIF, with or without RO>"
}
```

`client_id` and `client_secret` are required, and authorizing needs
`redirect_uris`. `company_cif` (or `cif`) is the company a call acts on when it
names none; one grant can cover several companies, so a `cif` argument
overrides it. `endpoints` overrides ANAF's URLs by name (`authorize`, `token`,
`hello`, `fctelProd`, `fctelTest`, `etransportProd`, `etransportTest`), and
`api_base` / `api_test_base` the e-Factura bases. The server never writes
`app.json`, and its errors name a bad field, never a value. Without
`ANAF_CONFIG` the server still starts, and the tools that need no grant work.

### Getting the client id and secret

ANAF calls this registering an application in an OAuth profile; its procedure,
[Oauth_procedura_inregistrare_aplicatii_portal_ANAF.pdf](https://static.anaf.ro/static/10/Anaf/Informatii_R/API/Oauth_procedura_inregistrare_aplicatii_portal_ANAF.pdf)
(in Romanian), shows each screen.

1. Check that the person who will sign in is registered in
   [SPV](https://www.anaf.ro/InregPersFizicePublic/#tabs-2) with their
   qualified certificate and one of the company's rights: legal
   representative, designated representative or empowered person
   (reprezentant legal, reprezentant desemnat, împuternicit).
2. Create a developer account at
   [anaf.ro/InregOauth](https://www.anaf.ro/InregOauth) (Servicii Online,
   Înregistrare utilizatori, Dezvoltatori aplicații, "Înregistrare pentru
   API-uri"), new or from a portal account you have, and confirm your e-mail
   with the "Cod de verificare" ANAF sends.
3. Sign in ("Autentificare utilizator"), open "Editare profil Oauth", then
   "Gestionare aplicații".
4. Name the application, choose its services (E-Factura, and E-Transport for
   the e-Transport tools), and give a Callback URL you control, such as
   `https://example.com/anaf/callback`; nothing has to answer there. Press
   "Generare Client ID".
5. Click the application in the list, and copy its Client ID, Client Secret
   and Callback URL into `app.json`.

The grant may do only what both the application's services and the
certificate holder's SPV rights allow; `health` shows its roles (`EFACTURA`,
`ETRANSPORT`).

### Files in and out

A document goes in byte for byte, never as text a model retyped, because
ANAF's seal covers the exact bytes: by path from the server's file roots
(`MCP_FILE_ROOTS`; over stdio, the client's folders or the working directory),
or as `{ "content_base64": "...", "sha256": "..." }` from a script. A link, a
file outside the roots, a wrong checksum or a document that is not UTF-8 is
refused before anything is sent. A path in the outbox is taken too, so
`build_invoice`'s file goes straight to `validate_invoice` and
`upload_invoice`.

Files come out into the outbox at mode 0640, whole or not at all, and never over
a file holding other bytes (that one gets the next numbered name, such as
`5001-2.zip`); a `save_dir` must be a folder inside it. The state dir holds
`tokens.json`, `authorization.json` and `uploads.json` at 0600. Neither the
state dir nor the outbox may sit inside `app.json`'s directory. The variables
every server shares are in [docs/configuration.md](../../docs/configuration.md).

## First run

The tools that read or file at ANAF need a grant, which only the certificate
holder can give. Ask your assistant to authorize the server with ANAF:

1. **`begin_authorization`** answers ANAF's sign-in page for your application
   (`authorizeUrl`), open for 30 minutes; `redirect_uri` picks one of several
   callback URLs. A client that shows links itself (MCP URL elicitation: over
   stdio, or over HTTP with a client of protocol 2026-07-28, as Claude Code
   is) offers you the page; if you do not hold the certificate, decline and
   pass the address on.
2. **The certificate holder opens it** in the browser where the certificate
   is installed, picks the certificate, and signs in.
3. **The browser lands on the callback URL**, with `?code=...&state=...` in
   the address. The page may fail to load; the address is what counts.
4. **Pass that whole address to `complete_authorization` (`redirect_url`) at
   once**: ANAF's code dies 60 seconds after it is issued. The server checks the
   `state`, exchanges the code, writes `tokens.json`, and answers only the two
   expiry dates; no token reaches the conversation.
5. **Ask for `health`**: the grant's roles and the days left on each token.

### Keeping the grant alive

ANAF's procedure (pp. 28 and 33) gives the access token 90 days (or the `exp` it
states) and the refresh token 365. A call within 3 days of the access token's
end refreshes it first (`refresh_token` with `force` refreshes now), and each
refresh brings a refresh token good for another 365 days. If the refresh token
runs out or ANAF refuses it (`invalid_grant`), only the certificate holder can
bring the grant back, by repeating the steps above. For a server used rarely,
refresh daily from a timer. From a clone, in `servers/anaf-efactura`:

```bash
node dist/index.js --health            # greet ANAF with the stored token; the days left
node dist/index.js --refresh           # refresh when the access token has under 14 days left
node dist/index.js --refresh --force   # refresh now
```

Each prints one `ANAF: OK|WARN|FAIL ...` line, never a token, and exits 0 for
OK, 1 for FAIL (a person has to act: a dead grant, a broken configuration) or
2 for WARN (ANAF unwell, or the refresh token ends within 14 days).

## Tools

**read** changes nothing at ANAF (some save files to the outbox); **write**
changes the stored grant; **money** files a document with ANAF, and your
client asks you before each call.

| Tool | Access | What it does |
|---|---|---|
| `health` | read | Greets ANAF with the stored token: the application, the default CIF, the grant's roles, the days left on each token. Only the greeting's first line comes back, because ANAF echoes the bearer token in it. |
| `token_status` | read | The stored grant's expiries and roles, without calling ANAF. |
| `refresh_token` | write | A new access token when the current one is within 3 days of its end, or now with `force`. |
| `begin_authorization` / `complete_authorization` | write | A new grant: ANAF's page for the certificate holder, then the address their browser landed on. |
| `list_invoices` | read | e-Factura messages from the last `zile` days, at most 60: sent, received, errors and buyer messages, with the id `download_invoice` takes. |
| `list_invoices_window` | read | The same over a date range of at most 60 days, a page at a time, filtered by `filtru` (E errors, T sent, P received, R awaiting a response). |
| `download_invoice` | read | Saves one signed ZIP to the outbox once it opens, every entry matches its checksum, and ANAF's seal holds. ANAF allows 10 downloads a day per message. |
| `upload_invoice` | **money** | Files an invoice XML (UBL, CII, CN or RASP) to a company. Test environment unless `test` is false. |
| `upload_invoice_b2c` | **money** | Files an invoice to a person through ANAF's `/uploadb2c`, otherwise as `upload_invoice`. |
| `upload_status` | read | How an upload was processed: ok (with its download id), processing, or failed with ANAF's reasons. |
| `etransport_list` | read | e-Transport declarations from the last `zile` days, at most 60: UIT, declarant, partner, carrier, vehicle, and ANAF's reasons for one it refused. |
| `etransport_file` | **money** | Files a declaration XML (schema v2): a new transport, a correction, a deletion, a confirmation or a vehicle change. Test environment unless `test` is false. |
| `etransport_status` | read | How a declaration was processed: ok (the UIT is valid from now), processing, or failed. |
| `build_invoice` | read | Writes a CIUS-RO invoice (UBL) from fields into the outbox, totals computed exactly and the draft checked first. Files nothing. |
| `parse_invoice` | read | A UBL invoice or credit note (a file, or an archive in the outbox) as JSON, every value the document's own text. Calls nothing. |
| `validate_invoice` | read | ANAF's own validation of a UBL invoice or credit note (schema, EN 16931 and CIUS-RO rules), without filing it. |
| `invoice_pdf` | read | ANAF's PDF of a UBL document, or of a filed invoice by `message_id`, saved to the outbox. |
| `verify_signature` | read | Whether an invoice is the file ANAF stored, under ANAF's seal: checked locally against a pinned CA, ANAF asked only when that cannot decide. |
| `lookup_company` | read | Up to 100 CIFs in ANAF's VAT registry, as of a date: identity, registered office, VAT payer and period, VAT on collection, split VAT, inactive, RO e-Factura registry. |

The last six need no grant, except `invoice_pdf` and `verify_signature` given
a `message_id`; the e-Transport tools need the `ETRANSPORT` role. The tools
that call ANAF take `cif` (by default `app.json`'s) and `test`: listings and
downloads read production unless `test` is true, while the three filing tools
and the two status tools use the test environment unless `test` is false, so a
status is asked where its filing went.

## Money

`upload_invoice`, `upload_invoice_b2c` and `etransport_file` file a legal or
fiscal document with ANAF, which reaches the counterparty and cannot be
withdrawn (undoing an invoice takes a credit note). They are marked `money` in
`tools/list`, and your client asks you to approve each call (Claude Code does,
in every permission mode). Whoever confirms, three rules hold:

- **Test unless you say otherwise.** Each goes to ANAF's test environment,
  where a filing has no legal effect, unless `test` is false.
- **The same bytes are not filed twice in production** unless `refile` is
  true. The SHA-256 of a production filing's exact bytes goes into a ledger
  (`uploads.json`) before it is sent; a filing ANAF refused, or one that never
  left, does not count.
- **A lost answer is never resent.** A dropped connection, a 5xx or an
  undocumented answer fails as `outcome_unknown`, because the filing may have
  happened ([Troubleshooting](#troubleshooting)).

The file is read once, before you are asked, so the line you confirm and the
filing come from the same bytes. With `MCP_CONFIRM=elicit` the server asks you
itself, in one line read from the XML and ending with the file's SHA-256:

```
anaf-efactura: FILE with ANAF e-Factura PRODUCTION (legal filing, cannot be withdrawn): invoice EX-0042 of 2026-09-28, buyer Client SRL (87654329), payable 1234.50 RON, seller Exemplu SRL (RO92345672); UBL, file sha256 3f1c0a9e27b4
anaf-efactura: File e-Transport declaration for a new UIT, Cluj-Napoca (county 12) to Iasi (county 22), vehicle CJ12ABC + trailer CJ34DEF, 1800.50 RON, environment prod; declarant 92345672, file sha256 5d0e7b2a91c4
```

A test upload's line starts `TEST upload to ANAF's test environment (no legal
effect)`, an invoice to a person reads `B2C invoice`, and a refiling adds
`AGAIN (refile)`. Amounts are the document's own decimal strings; the
e-Transport value is the exact sum of the goods' `valoareLeiFaraTva`. A
document the server cannot read says `UNREADABLE XML`: answer no.

Before you are asked, the check digits must hold on every IBAN an invoice names
for payment (BT-84, BT-91), the seller's CIF, an e-Transport declarant's CIF or
CNP, and every UIT (whose check digits, by ANAF's rule BR-019, catch a wrong
character but not two swapped ones). A new UIT counts only once
`etransport_status` says `ok`.

## Troubleshooting

**`config`: "tokens at ... are missing or unparseable".** No grant is stored
yet, or the file is damaged: authorize as in [First run](#first-run).

**`config` naming `ANAF_CONFIG`, a field of `app.json`, `company_cif`, or "...
is inside app.json's directory".** Fix the variable or field, pass `cif`, or
move `ANAF_STATE_DIR` / `ANAF_DOWNLOADS_DIR` away from `app.json`.

**`auth` with `invalid_grant`, `refresh_expired`, `invalid_client` or
`unauthorized_client`.** The grant is dead: authorize again. Any other `auth`
code is ANAF failing for now: retry later.

**`input`: "the state in that address is not the one begin_authorization
issued", or "begun more than 30 minutes ago".** The address is from an older
tab, or the window closed: call `begin_authorization` again, and pass the new
address at once (a code older than 60 seconds fails as `auth`).

**`api` with status 401 or 403.** ANAF refused the token for this CIF or role
(`token_status` shows the roles). The e-Transport tools need `ETRANSPORT`: add
the service to the application at ANAF, then authorize again.

**`api` with `reason: "outcome_unknown"`, or `input`: "this exact file ... was
already sent to ANAF production".** The filing may have reached ANAF, or these
bytes already did. Look first (`upload_status` with `test: false`,
`list_invoices`, `etransport_status` or `etransport_list`), and pass
`refile: true` only to file the same bytes again on purpose.

**`input`: "the invoice was not sent", "the declaration was not sent" or "the
invoice was not built".** A check digit or a rule failed; the message names
each. Fix the document, or `build_invoice`'s fields.

**`validate_invoice` finds only `ERRIdentif` "nu a fost identificat cui
cumparator".** The buyer is foreign, which ANAF's validator cannot be told, so
this finding is expected. Upload with `extern: true`, which `build_invoice`
answers for such a buyer.

**`checksum_mismatch`.** The bytes that arrived are not the file `sha256`
names, as when a model retypes base64. Nothing was sent: send the file by
path, or let a script encode it.

**`api` with status 0**: ANAF was unreachable, or its answer lacked a field the
call needs; retry later. **"... answered in a shape ANAF does not document"**:
ANAF's answer changed and the server refuses to guess; please report it.

## How it works

**What comes back.** ANAF's wire shape stays inside the server: a listed
message has a `kind` (`sent`, `received`, `error`, `buyerMessage`, `unknown`)
and `details` with the upload id and both CIFs, lifted out of ANAF's prose.
`createdAtLocal` is zoneless on purpose, because ANAF stamps Bucharest time
without saying so; a date window is UTC, so it reads the same anywhere.
`notice` is set when ANAF refused with HTTP 200 and an `eroare` key ("no
messages in this period" included): reading that as an empty list would be the
most expensive kind of wrong. `cui`, on a real answer the certificate holder's
CNP, is never echoed.

**ANAF's seal.** `download_invoice` keeps an archive only once every entry
matches its CRC and ANAF's seal (`semnatura_<id>.xml`) holds: a detached
XML-DSig signature whose digest is the SHA-256 of the invoice file's raw bytes
(so a re-indented copy is not the sealed file), by a certificate issued to
Ministerul Finanțelor by "Trans Sped Electronic Seal QCA G3". `verify_signature`
checks that locally: the certificate must come from the pinned CA
(`src/infra/sealTrust.ts`) and not have expired before the invoice's date, the
RSA signature must verify, and then the digest decides. So a swapped certificate
fails the CA check, and a digest rewritten for a changed invoice fails the
signature. Anything short of a verified signature goes to ANAF's public
`/api/validate/signature`, and `checkedBy` says who answered. `npx tsx
scripts/check-seals.ts <folder>` runs the check offline.

**Building an invoice.** `build_invoice` totals by EN 16931's rule, which ANAF
checks (each line rounded to 2 decimals, VAT once per category and rate on the
sum of its lines, half away from zero), with the toolkit's `invoiceTotals.ts`,
as the [oblio](../oblio) server does. Before writing, it names every problem
ANAF would refuse:

- check digits: the CIF in a Romanian VAT id or CUI, a person's CNP, the IBAN;
- the address: a Romanian one needs its county (`CJ` or `RO-CJ`), and in
  Bucharest the city is the sector (`Sector 3` is written `SECTOR3`);
- VAT: S needs a rate and the others have none; E needs a reason (AE, G and O
  default to their VATEX code); reverse charge needs the buyer's id; O names
  no VAT id and mixes with no other category;
- money: an amount due needs a due date or payment terms, a credit transfer
  the IBAN, and an invoice in another currency `vat_exchange_rate` (RON per
  unit, from the [bnr](../bnr) server), because CIUS-RO states VAT in RON too;
- CIUS-RO's lengths and counts, and a number with at least one digit.

The tests hold every built file to ANAF's own verdict on its exact bytes,
recorded by `scripts/record-validation.ts --send` from seven invented invoices
(`test/fixtures/validation`).

**Reading an invoice.** `parse_invoice` spends none of ANAF's downloads, and
`400.0000` stays `400.0000`: a faithful view, not a verdict, which is
`validate_invoice`'s job.

**Validation, PDF and the VAT registry.** `validate_invoice` and `invoice_pdf`
call ANAF's public host, `webservicesp.anaf.ro`, which takes no token (the same
operations on `api.anaf.ro` answer 401 without one), so they work after the
grant runs out. Anything over 5 MB is refused before the call. A filed
invoice's PDF is made without validating it again, so today's rules cannot
refuse a document filed under older ones; any other is validated first unless
`validate` is false. `lookup_company` checks each CIF's control digit, then
asks PlatitorTvaRest v9 one request a second, as ANAF requires; a status ANAF
did not send is absent, not false.

**Rotation.** A refresh retires the old refresh token, so the new pair is
written to `tokens.json`, under a lock every process on the state dir shares,
before the access token is used. `--refresh` keeps no backup, since a copy from
before a rotation would hold a dead refresh token.

**ANAF's endpoints** live in `src/infra/anafApi.ts`. `npm run gen:types`
regenerates their types from the OpenAPI documents in ANAF's Swagger UI pages
(`-- --offline` from the snapshots in `openapi/`; mfinante.gov.ro resets
connections from outside Romania, so
`ANAF_SPEC_MIRROR=http://web.archive.org/web/2025id_/` reads an archived
copy). What ANAF documents wrongly or not at all is modelled by hand in
`src/domain/schema.ts`, and every answer is parsed at the boundary, so drift
fails loudly.

**Smoke test.** `npx tsx scripts/smoke.ts` drives the built server with your
configuration, read-only (`--public-only` for the tools that need no grant)
unless given `--allow-writes`, which adds `refresh_token` without `force` and
`begin_authorization`. It never files anything, and spends two of the newest
message's daily downloads.

## Limitations

- **`build_invoice` writes invoices, not credit notes** (a storno is an
  invoice with negative quantities), with no document-level allowances or
  charges, no attachments, and no intra-EU supply of goods (VAT category K,
  which needs a delivery country).
- **e-Transport files a declaration you wrote.** It does not build one from
  fields, nor read `/info` (what others declared with you as the transport
  organiser).
- **Reading, validating and rendering take UBL only**, as ANAF's validator
  does; `upload_invoice` also files CII.
- **Seal revocation** (Trans Sped's CRL and OCSP) is not checked locally.
- **The ledger lives in one state dir**: deployments with separate state dirs
  do not see each other's production filings.
- **No SPV mailbox and no tax declarations.**

## Other servers for ANAF e-Factura

Searched 2026-10-15. ANAF publishes none: its one public GitHub repository is
a 2019 Java sample client for SPV, and the MCP Registry lists nothing for
e-Factura. Three community servers talk to ANAF directly:

- **`anafpy`** on PyPI, the broadest: Python, a stdio server of 48 tools (its
  `mcp` extra) for e-Factura, e-Transport filing, the SPV mailbox through a
  qualified certificate, tax declarations and the public registries, every
  filing through a prepare and confirm step bound to the document's bytes.
- **`@florinszilagyi/anaf-mcp`** on npm (stdio): lists, downloads, validates
  and uploads, B2C included; it takes the XML as a text argument, with no
  confirmation step of its own.
- **`anaf-efactura-mcp`** on npm (stdio or HTTP): builds and uploads
  invoices, on the test environment by default.

Others found only upload and poll through a hosted service, reach e-Factura
through another invoicing account, or validate files offline.

None of them combines a local seal check against a pinned CA, documents taken
only as files or checksummed bytes, test-first filing after a line read from
the XML, check digits, no second filing of the same bytes or blind resend, and
no token in the client. It does not reach the SPV mailbox or file tax
declarations, as `anafpy` does.

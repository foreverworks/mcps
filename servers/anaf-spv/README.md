# <img src="icons/icon.svg" width="36" height="36" alt="ANAF SPV icon"> ANAF SPV MCP server

Read and keep what ANAF posts to your Spațiul Privat Virtual
([pfinternet.anaf.ro](https://pfinternet.anaf.ro)) from your AI assistant:
decisions, summonses, notifications, payment confirmations and answers. It also
requests documents, writes to ANAF through SPV's contact form (a dry run unless
you say otherwise), validates declarations and files a D212. Nothing here moves
money; the one `money` tool, `submit_declaration`, files a declaration, and
your client asks you before each call.

**You need** an SPV account for a person ("persoană fizică") that signs in with
a user name and password, not a qualified certificate; its password in a file
or a vault MCP server; and a mail MCP server that reads the mailbox SPV sends
sign-in codes to (without one, someone types each code). Validating a
declaration also needs Java 8 or newer. ANAF has no API for such an account, so
the server reads SPV's web pages.

## What you can ask

- "Is there anything new from ANAF in my SPV?"
- "Download the decision ANAF posted last week into my 2026-10 folder."
- "Ask ANAF for my Obligatii de plata statement and save it when it arrives."
- "Save every SPV document I have not saved yet."
- "Check the D300 for September in d300-2026-09.xml with ANAF's validator.
  How much VAT does it make payable?"
- "What is the status of the filing INTERNT-123456789-2026?"

## Install

<!-- install:begin -->
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect/mcp/install?name=anaf-spv&inputs=%5B%7B%22type%22%3A%22promptString%22%2C%22id%22%3A%22anaf_spv_username%22%2C%22description%22%3A%22Optional.%20Your%20SPV%20user%20name%2C%20when%20the%20password%20comes%20from%20a%20file.%22%7D%2C%7B%22type%22%3A%22promptString%22%2C%22id%22%3A%22anaf_spv_password_file%22%2C%22description%22%3A%22Optional.%20Path%20of%20a%20file%20holding%20your%20SPV%20password.%20The%20README%20also%20shows%20how%20to%20read%20it%20from%20a%20vault%20MCP%20server%20instead.%22%7D%5D&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40foreverworks%2Fmcp-anaf-spv%22%5D%2C%22env%22%3A%7B%22ANAF_SPV_USERNAME%22%3A%22%24%7Binput%3Aanaf_spv_username%7D%22%2C%22ANAF_SPV_PASSWORD_FILE%22%3A%22%24%7Binput%3Aanaf_spv_password_file%7D%22%7D%7D) [![Install in Cursor](https://img.shields.io/badge/Cursor-Install_Server-000000?style=flat-square&logo=cursor&logoColor=white)](https://cursor.com/install-mcp?name=anaf-spv&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBmb3JldmVyd29ya3MvbWNwLWFuYWYtc3B2Il0sImVudiI6eyJBTkFGX1NQVl9VU0VSTkFNRSI6IiR7ZW52OkFOQUZfU1BWX1VTRVJOQU1FfSIsIkFOQUZfU1BWX1BBU1NXT1JEX0ZJTEUiOiIke2VudjpBTkFGX1NQVl9QQVNTV09SRF9GSUxFfSJ9fQ%3D%3D) [![Download for Claude Desktop](https://img.shields.io/badge/Claude_Desktop-Download_Bundle-D97757?style=flat-square&logo=claude&logoColor=white)](https://github.com/foreverworks/mcps/releases/latest/download/mcp-anaf-spv.mcpb)

> [!NOTE]
> `@foreverworks/mcp-anaf-spv` is not on npm yet: the buttons and the `npx` commands below work once it is published. Until then, [run it from a clone](#from-a-clone).

With Claude Code:

```bash
claude mcp add anaf-spv -- npx -y @foreverworks/mcp-anaf-spv
```

Claude Desktop (Settings, Developer, Edit Config) and most other clients read the same command as JSON:

```json
{
  "mcpServers": {
    "anaf-spv": {
      "command": "npx",
      "args": ["-y", "@foreverworks/mcp-anaf-spv"]
    }
  }
}
```

Each runs the published package on Node 22.19 or newer. VS Code and the Claude Desktop bundle ask for each setting as they add the server; leave an optional one empty. Cursor reads each from your environment instead (`${env:ANAF_SPV_USERNAME}` and so on), so set them before you start Cursor. Every setting is optional; [Configuration](#configuration) says which ones you need for which tools.

### From a clone

```bash
git clone https://github.com/foreverworks/mcps.git && cd mcps
npm ci && npm run build
claude mcp add anaf-spv -- node "$PWD/servers/anaf-spv/dist/index.js"
```

In a JSON configuration, the command is `node` and its one argument the full path of `servers/anaf-spv/dist/index.js`. To share one running copy between several clients over HTTP, see [docs/deploying.md](../../docs/deploying.md).
<!-- install:end -->

A complete configuration, with this repository's [bitwarden](../bitwarden) and
[google](../google) servers over HTTP as the vault and the mailbox:

```bash
claude mcp add anaf-spv \
  -e ANAF_SPV_VAULT_MCP_URL=http://127.0.0.1:<vault port>/mcp \
  -e ANAF_SPV_VAULT_MCP_TOKEN_FILE=<path to the vault token> \
  -e ANAF_SPV_VAULT_ITEM=<item id> \
  -e ANAF_SPV_MAIL_MCP_URL=http://127.0.0.1:<mail port>/mcp \
  -e ANAF_SPV_MAIL_MCP_TOKEN_FILE=<path to the mail token> \
  -e ANAF_SPV_MAIL_ACCOUNT=<mailbox label> \
  -- npx -y @foreverworks/mcp-anaf-spv
```

[docs/onboarding.md](docs/onboarding.md) walks through the setup, with other
vault and mail servers or with codes typed by hand. Over HTTP, one running copy
holds one session for every client, so fewer code e-mails go out.

## Configuration

Every variable is optional for the server to start: a tool that needs one says
which, and `health` lists what is missing.

### Where the password comes from

A vault or a file. Prefer a vault: the password then lives in one place, and a
rotation is a change there and nothing else.

| Variable | Required | Meaning |
|---|---|---|
| `ANAF_SPV_VAULT_MCP_URL` | one source | A vault MCP server over Streamable HTTP that holds the SPV login. |
| `ANAF_SPV_VAULT_MCP_TOKEN_FILE` | if the vault wants one | File holding its bearer token (`ANAF_SPV_VAULT_MCP_TOKEN` for a local run). |
| `ANAF_SPV_VAULT_MCP_COMMAND` | instead of the URL | A vault MCP server to spawn over stdio: a JSON array (`["npx","-y","some-vault-mcp"]`) or words. It gets this process's environment without the `ANAF_SPV_*` and `MCP_*` variables and `CREDENTIALS_DIRECTORY`. |
| `ANAF_SPV_VAULT_ITEM` | with a vault | The vault item holding the SPV login (its id). |
| `ANAF_SPV_VAULT_TOOL` | no | The tool that hands out a password. Default `get_password` (this repository's bitwarden server). |
| `ANAF_SPV_VAULT_ARGS` | no | Its arguments, a JSON template with `{{item}}`. Default `{"id":"{{item}}"}`. |
| `ANAF_SPV_VAULT_PASSWORD_FIELD` | no | Where the password is in its JSON answer, a dot path. Default `password`; `.` takes the whole answer. |
| `ANAF_SPV_VAULT_USERNAME_FIELD` | no | Where the user name is. Default `username`. |
| `ANAF_SPV_PASSWORD_FILE` | the other source | File holding the SPV password, mode 0600 (`ANAF_SPV_PASSWORD` for a local run). |
| `ANAF_SPV_USERNAME` | with the file | The SPV user name. With a vault, it overrides the item's. |

### Where the e-mailed code comes from

A mail MCP server, read by a driver chosen at each sign-in
([The mail drivers](#the-mail-drivers)). Without one, every sign-in waits for
`complete_login`.

| Variable | Required | Meaning |
|---|---|---|
| `ANAF_SPV_MAIL_MCP_URL` | for automatic sign-in | A mail MCP server over Streamable HTTP that reads the mailbox SPV sends codes to. |
| `ANAF_SPV_MAIL_MCP_TOKEN_FILE` | if it wants one | File holding its bearer token (`ANAF_SPV_MAIL_MCP_TOKEN` for a local run). |
| `ANAF_SPV_MAIL_MCP_COMMAND` | instead of the URL | A mail MCP server to spawn over stdio, as for the vault. |
| `ANAF_SPV_MAIL_DRIVER` | no | `auto` (the default with a mail server), `google`, `text`, or `manual` (the default without one). |
| `ANAF_SPV_MAIL_ACCOUNT` | no | Which mailbox, for a server that holds several (the google driver's `account`; `{{account}}` in a template). |
| `ANAF_SPV_MAIL_QUERY` | no | The search, in Gmail's syntax by default: `from:Autentificare.SpatiuPrivat@anaf.ro subject:"Cod de siguranta" newer_than:1d`. |
| `ANAF_SPV_MAIL_SEARCH_TOOL` | no | The `text` driver's search tool. Default: the server's tool that looks like a mail search. |
| `ANAF_SPV_MAIL_SEARCH_ARGS` | no | Its arguments, a JSON template with `{{query}}` and `{{account}}`, for a tool that needs more than a query. |
| `ANAF_SPV_CODE_WAIT_SEC` | no | How long a sign-in waits for the code to reach the mailbox. Default 90, at most 280 (SPV honours a code for 300). |

### Everything else

| Variable | Required | Meaning |
|---|---|---|
| `ANAF_SPV_KEEPALIVE_MIN` | no | Load a page every N minutes while a session is stored, so SPV's idle timeout does not end it (each new sign-in e-mails a code). `0`, the default, is off. |
| `ANAF_SPV_STATE_DIR` | no | Where `session.json`, `pending.json`, `synced.json`, `contact.json`, `cui-only.json`, `declarations.json` and formularespv-pf's `forms-session.json` live, all 0600; the default is in [docs/configuration.md](../../docs/configuration.md). It holds a live session: keep it readable by the server's user only. |
| `ANAF_SPV_DOWNLOADS_DIR` | no | The outbox downloads land in. Default `<state dir>/downloads`. |
| `ANAF_SPV_JAVA` | for declarations | The Java runtime ANAF's DUKIntegrator runs on (8 or newer). Default `java`. |
| `ANAF_SPV_DUK_DIR` | no | Where DUKIntegrator kits are built and kept, one per form and package. Default `<state dir>/duk`. |
| `ANAF_SPV_PORTAL` | no | The portal. Default `https://pfinternet.anaf.ro`. |
| `ANAF_SPV_FORMS_PORTAL` | no | Where a person files declarations, a sign-in of its own. Default `https://formularespv-pf.anaf.ro`. |
| `ANAF_SPV_STATUS_SERVICE` | no | ANAF's public status service for filings. Default `https://stare.anaf.ro/StareD112`. |

A file a tool takes (a declaration's XML, an attachment) goes in byte for byte,
by path only, from the server's file roots (`MCP_FILE_ROOTS`). Files come out
into the outbox at mode 0640, whole or not at all, and never over a file holding
other bytes (that one gets the next numbered name); a `save_dir` must be a
folder inside it. Under `MCP_EGRESS_ALLOW`, allow `pfinternet.anaf.ro`,
`formularespv-pf.anaf.ro`, `static.anaf.ro`, `stare.anaf.ro` and the vault and
mail servers' hosts. The variables every server shares are in
[docs/configuration.md](../../docs/configuration.md).

### Getting the SPV account ready

1. Check that the account signs in at pfinternet.anaf.ro with a user name and
   password. A person registers one on anaf.ro, online with an identity
   document or at an ANAF office.
2. Find the mailbox SPV sends codes to (the address in SPV's "Editare
   profil"): it holds "Cod de siguranta" mails from
   `Autentificare.SpatiuPrivat@anaf.ro`.
3. Have the account holder put the user name and password in a vault item, or
   the password in a file only the server's user can read, rather than dictate
   it to an assistant.
4. Give a mail MCP server read access to that mailbox, and point
   `ANAF_SPV_MAIL_MCP_URL` (or `_COMMAND`) at it.

## First run

1. Ask your assistant to run SPV's `health` check (no network). A good answer
   says `automatic_login: true`, names the credential source and the mail
   driver, and lists no `problems`.
2. Ask for your SPV messages (`list_messages`). The first call signs in: SPV
   e-mails the account holder a code the mail driver reads, so they can ignore
   it. Messages come back newest first, each with a `key`.
3. If a tool answers `needs_login`, pass the newest code to `complete_login`
   within five minutes ([Troubleshooting](#troubleshooting)); with no mail
   server, every sign-in ends this way.
4. Download a message (`download_message` with its `key`), then run
   `sync_messages` daily: SPV drops most documents about two months after
   posting.

## Tools

**read** changes nothing at ANAF (some save files to the outbox); **write**
changes the session this server holds (a sign-in makes SPV e-mail a code) or
sends ANAF something that is not a fiscal document; **money** files a
declaration, and your client asks you before each call.

### Session

| Tool | Access | What it does |
|---|---|---|
| `health` | read | Where the credential and the code come from, whether a session is stored, whether a sign-in waits for its code. No network. |
| `session_status` | read | The stored session, since when, when it last worked; `probe` loads a page to prove it alive. |
| `login` | write | Sign in now (any tool does it when it needs to); `code_by_hand` stops at the code. |
| `complete_login` | write | Finish a sign-in that waits for its e-mailed code. |
| `logout` | write | Sign out at SPV and forget the session. |

### Messages

| Tool | Access | What it does |
|---|---|---|
| `list_messages` | read | The message list, newest first, filtered by type, dates, tax id, request or words; each with a `key`, when it was posted and when SPV will archive it. |
| `download_message` | read | One message's document, saved to the outbox with its SHA-256. |
| `sync_messages` | read | Save every message not saved before, oldest first: the archive SPV does not keep. |
| `posting_dates` | read | When SPV posted documents, from its alert e-mails: the lasting record once SPV archives them. |

### Requests and the contact form

| Tool | Access | What it does |
|---|---|---|
| `list_document_types` | read | What the live request form offers, and the fields each type takes. |
| `request_document` | write | Ask SPV for a document; free, and its answer arrives as a message. |
| `await_reply` | read | Wait for the answer to a request (up to 120 seconds a call), and save it. |
| `submit_contact_form` | write | Write to ANAF through SPV's contact form; a dry run by default, the registration number when sent. |

### Declarations

| Tool | Access | What it does |
|---|---|---|
| `validate_declaration` | read | ANAF's own validator for a D212, D100, D300 or D112 and its period: the errors verbatim, what it makes payable, and the filing PDF, checked to carry the XML. |
| `submit_declaration` | **money** | File a D212's PDF at formularespv-pf: the index de depunere, then SPV's RECIPISA. A D100's, D300's or D112's is checked, then refused before anything is sent. |
| `declaration_status` | read | A filing's state at ANAF and its signed receipt, by its number, from ANAF's public status page. No sign-in. |

## Money

`submit_declaration` files a declaration in the account holder's name, which
cannot be withdrawn, only rectified. It is marked `money` in `tools/list`, and
your client asks you to approve each call (Claude Code does, in every
permission mode). It files only a PDF that `validate_declaration` made and
checked (by SHA-256, size and the embedded XML), only with `confirm: true`, and
the same bytes only once unless `refile` is true (a filing whose answer never
came counts). With `MCP_CONFIRM=elicit` the server asks you itself, in one line
read from the PDF: the form, the period and the taxpayer of the bytes that
will be sent.

```
anaf-spv: File D212 for reporting year 2025 for 2990101999999 at ANAF (D212_an-2025_0123456789ab.pdf, 123456 bytes, sha256 abcdef012345); a filed declaration cannot be withdrawn, only rectified
```

For a company's form the line also names the company and what the return makes
payable:

```
anaf-spv: File D100 for 09.2026 for 99999909 (EXEMPLU TEST SRL) at ANAF, to pay 1850 lei (121: 1250, 150: 600) (D100_2026-09_fedcba987654.pdf, 34567 bytes, sha256 0123456789ab); a filed declaration cannot be withdrawn, only corrected by a D710
```

ANAF takes a D100, D300 or D112 only through e-guvernare.ro, signed with the
qualified certificate of someone entitled to file for the company, which this
server does not hold. So `submit_declaration` checks such a PDF, then answers
`unsupported` before anything is sent; the PDF is ready to be signed and
uploaded there.

## Troubleshooting

**`needs_login` with `awaiting_code` or `code_not_received`.** No driver reads
the mail (`manual`, `code_by_hand`), or no new code came within
`ANAF_SPV_CODE_WAIT_SEC`. Pass the newest code to `complete_login` before the
answer's `expires_at`. If the driver should have read it, check the mailbox,
that the search shows the mails' text, and `ANAF_SPV_MAIL_QUERY`'s syntax.

**`needs_login` with `pending_expired`, or `login_refused` at `step: code`.**
The code came after SPV's five minutes, or was wrong or stale. Call `login`
again and pass only the newest code.

**`login_refused` at `step: password`.** SPV refused the user name or password
(its words are in the message). Fix the credential source `health` names, then
call `login`. Do not retry in a loop: repeated failures can lock the account.

**`upstream`.** The vault or mail server (`source`) failed. Check that it
answers and that the vault holds `ANAF_SPV_VAULT_ITEM`. Without the mail
server, `login` with `code_by_hand: true`, then `complete_login`, still signs
in.

**`config` naming a variable.** Set it from [Configuration](#configuration)
and call again; nothing reached SPV.

**`not_found`.** No message with that key, or no reply yet. `list_messages`
gives every key; a reply appears a minute or two after `request_document`.

**`refused`.** SPV refused a request, or formularespv-pf a file, in its own
words. For a request, `list_document_types` gives the fields each type takes.

**`wrong_document`.** SPV served a file named for another message; nothing was
saved. Download the same key again, and if it repeats, please report it.

**`unsupported`.** The declaration needs something this server does not have
([Money](#money)). Nothing was sent; the message says where the PDF can go.

**`api`.** Status 0: SPV was unreachable. Another status: SPV failed, as it
often does during maintenance at night and on weekends. Try again later.

**`drift`.** SPV's pages changed under this server. It needs updating; please
report the message.

## How it works

### Signing in

SPV's front door is an F5 access policy (`/my.policy`) with two forms: the
user name and password, then the e-mailed code, good for 300 seconds. The
session is then only cookies, stored 0600. When a page sends the client back
to `/my.policy`, the session has ended: the tool signs in and calls again, and
callers that meet it together cause one code, not two (one sign-in at a time
per state dir). The credential is read at each sign-in and never kept; neither
it nor a code appears in an answer, the audit line or the state dir.

### The mail drivers

The mailbox is reachable only through an MCP server; the driver decides how to
ask it.

- **`google`**: a server shaped like this repository's google server
  (`search_threads`, `get_thread`). It takes the newest code in SPV's Gmail
  thread dated after the sign-in began (less a minute for clock skew) that was
  not there before.
- **`text`**: any mail server with a search tool. It notes the codes the
  search shows before the password is sent, then searches until a new one
  appears. It guesses the tool and its query argument from `tools/list`,
  unless `ANAF_SPV_MAIL_SEARCH_TOOL` and `_ARGS` name them.
- **`auto`**: `google` when the server has those two tools, else `text`.
- **`manual`**: every sign-in stops at `awaiting_code`.

A driver that sees no new code in time leaves the sign-in open for
`complete_login`, so a slow mailbox costs a typed code, never a lost sign-in.

### Messages and downloads

**A message is named by a `key`**, a hash of what its row shows: SPV gives a
row no id, only a download link that is its position in the list last
rendered. So a download lists first, and nothing else reaches the portal until
the listing and its downloads end, from any process on the same state dir
(`portal.lock`); otherwise a reply posted in between would shift the rows and
save one request's PDF under another's metadata.

**The file's name is checked against its row.** A name carrying another row's
id fails as `wrong_document`, and nothing is saved; a name with no such id (a
decision's `SV<number>.pdf`) is taken.

**The bytes are SPV's.** SPV serves the same signed PDF every time, so a second
download finds the first. A row leaves the list for good at its `Data
Arhivare`, about two months after posting (ten years for payments).

### Posting dates

An act posted in SPV counts as communicated on the day it was made available,
which starts the terms to contest it (art. 47 alin. (15) of the Fiscal
Procedure Code); once its row is gone, SPV no longer shows that day. SPV's
"Documente noi SPV" alert e-mails, from `Portal.ANAF@anaf.ro`, are the lasting
record: `posting_dates` reads them through a mail server shaped like this
repository's google server.

### Requests

The request form's own script decides which of year, month, registration
number and PUI each type takes; `src/domain/requests.ts` follows it. SPV
answers a registered request with a RASPUNS SOLICITARE message carrying its
id, usually within a couple of minutes. Some types on a person's list are made
only for a company, and SPV refuses them for a CNP. `list_document_types`
lists them under `cui_only` and `request_document` refuses them: "Notificare",
and any other type SPV has refused that way (`cui-only.json`). Types are not
probed, because some requests make real documents.

### The contact form

SPV's contact form takes an identity, a category (with a subcategory for 1, 2
and 5), up to 1,500 characters and one attachment (pdf, tiff, rtf, zip, jpeg,
jpg, gif or png, at most 10 MB). ANAF answers a sent message later in SPV.

- **`cif` is required** and read back: the form preselects its first identity,
  the company for someone who also represents one.
- **Category 3 is the default** ("Asistență și îndrumare de specialitate în
  domeniul fiscal"), answered on the merits; a petition (category 1) gets a
  redirect.
- **A dry run is the default**, showing the message as it would go:
  diacritics stripped, typographic marks made plain, the attachment's name and
  SHA-256.
- **The same message is not sent twice** without `again: true`, even when a
  post's answer never came (`contact.json`). A page with no registration
  number is `refused`: the form answers a bad post with itself.

### Declarations

A past year's declaration has no web form (the Declarația unică app serves
only the current year), and a company's returns are made with ANAF's own
programs. So the server runs ANAF's "soft J" as ANAF documents it for Linux:
DUKIntegrator with the validator and PDF jars of the package for the period
(tried on invented D100, D300 and D112 returns).

- **A kit is built once per form and package** in `ANAF_SPV_DUK_DIR`, each
  file's source and SHA-256 in `kit.json`. A period no package covers is
  refused, never validated with the nearest one.
- **D212 has a package per reporting year** (the year filed in: 2023 declares
  2022's income), and another year's fails it. **D100, D300 and D112 have one
  package for many periods**, so the newest also validates an earlier month.
- **The verdict is read from DUKIntegrator's output**, because it exits 0
  either way; the errors are answered verbatim.
- **The PDF embeds the XML**, and is saved only once the embedded file is the
  validated XML byte for byte.

#### ANAF's packages

From the forms pages on static.anaf.ro (`Declaratii_R/declaratie_unica.html`
for D212, `100.html`, `300.html`, `112.html`), with each validator's table of
periods and update5's `versiuni.xml` for versions. A test holds this table to
`src/domain/declarations/kits.ts`, where a new ANAF version is a new row.

<!-- kits:begin -->
| Form | Package | Periods | Version | Published | What it implements |
|---|---|---|---|---|---|
| D212 | `D212_20200622.zip` | reporting year 2020 | | 2020-06-22 | |
| D212 | `D212_20210512_1607.zip` | reporting year 2021 | | 2021-05-12 | |
| D212 | `D212_20220301.zip` | reporting year 2022 | | 2022-03-01 | |
| D212 | `D212_20231002.zip` | reporting year 2023 | | 2023-10-02 | |
| D212 | `D212_20240708.zip` | reporting year 2024 | | 2024-07-08 | |
| D212 | `D212Validator_01082025.zip` | reporting year 2025 | J13.0.1, PDF P10.0.0 | 2025-08-01 | |
| D100 | `D100_14092026.zip` | 01.2024 on | J21.0.8, PDF P6.0.0 | 2026-09-14 | OPANAF 57/2026 from 01.2026; obligation 704 from 08.2026 |
| D300 | `D300Validator_11022026_2.zip` | 05.2024 on | J12.0.1, PDF P9.0.0 | 2026-02-11 | OPANAF 174/2026, structure v12 from 01.2026 |
| D112 | `D112_09102026.zip` | 01.2025 on | J27.0.7, PDF P3.0.1 | 2026-10-09 | joint order 605/95/928/2314/2026, structure v7 from 07.2026 |
<!-- kits:end -->

#### What a return makes payable

For a D100, D300 or D112, read from the XML by the form's own rules ("Anexa
validari"), in whole lei, summed exactly: a D100's `suma_plata` (to pay) and
`suma_rest` (to refund) per obligation code, its root `totalPlata_A` being only
a control sum; a D300's `R41_2` (the VAT to pay) and `R42_2` (the negative
balance, refunded when `solicit_ramb` is D, else carried forward); a D112's
`A_plata` per obligation code, whose sum must equal its `totalPlata_A` or the
file is refused before validation.

#### Filing a D212

`submit_declaration` signs in to formularespv-pf.anaf.ro with SPV's user name,
password and e-mailed code, in a session of its own (one sign-in at a time
across both: their codes come from one address). An accepted file gets an
index de depunere. SPV then posts a DECLARATIE (`<index>_depunere.pdf`) and a
RECIPISA within seconds; the tool downloads both and says whether the
DECLARATIE carries the index. The RECIPISA names the index de încărcare, an
unrelated number that ANAF's status service knows the filing by.
`declarations.json` remembers every PDF made and what became of it.

### A filing's status

`declaration_status` reads ANAF's public status page,
`stare.anaf.ro/StareD112`, with no sign-in (the old `www.anaf.ro` address
resets the connection). For an index de încărcare and a tax id, it lists the
last 200 filings of the last three months: ANAF's state (`processing`,
`not_registered`, `validation_errors` with the errors on the receipt, or
`valid`), the registration number `INTERNT-<index>-<year>`, and the signed
receipt for 60 days, which the tool saves. It also takes the registration
number or the index de depunere.

`scripts/smoke.ts` drives the built server against the real SPV. It changes
nothing at ANAF unless given `--request "<type>"`, which registers a free
document request.

## Limitations

- **Only a user name, password and e-mailed code.** An account that signs in
  with a qualified certificate is not supported.
- **Only a D212 is filed here.** All four forms are validated, for the periods
  the packages above cover; a D100, D300 or D112 is filed through
  e-guvernare.ro ([Money](#money)). A contestation is not offered.
- **`declaration_status` sees three months**, as far back as ANAF's status
  page lists; an older filing goes through a "Duplicat Recipisa" request.
- **It does not read the documents.** It answers SPV's metadata and the files;
  reading a PDF is the caller's job (`pdftotext` reads every one tried so far).
- **One account per server.** A person who also represents a company sees both
  in one list (`cif`) when SPV links them to the same login.

## Other servers for ANAF SPV

Searched 2026-10-15. ANAF publishes none, and its SPV web service (`SPVWS2`,
documented only by its 2019 sample client `MfpAnaf/ClientSPV`) takes only a
qualified certificate. One community server uses it; nothing else turned up on
npm, PyPI, GitHub or the MCP Registry:

- **`anafpy`** on PyPI (Python, stdio): lists messages, saves a message's PDF,
  and requests reports and waits for them, signing in with a qualified
  certificate from the operating system's key store and a PIN on every login.

This one is for the accounts `anafpy` cannot serve, which sign in with a user
name, password and e-mailed code: it signs in by itself, saves each document
byte for byte with its SHA-256, keeps an archive, and over HTTP holds one
session for every client. With a qualified certificate, `anafpy` is the better
fit.

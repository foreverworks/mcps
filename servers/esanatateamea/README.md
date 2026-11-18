# <img src="icons/icon.svg" width="36" height="36" alt="eSănătateaMea icon"> eSănătateaMea MCP server

Read your Romanian health records from your AI assistant, on
[eSănătateaMea](https://portal.esanatateamea.ro), the patient portal of CNAS
(Casa Națională de Asigurări de Sănătate): whether you are insured and in which
category, your service package, the prescriptions doctors wrote and what
pharmacies released, the medical services CNAS paid for on your behalf,
referrals and other medical documents with their PDFs, your emergency summary
and your appointments. It is **read-only**: nothing it does changes anything at
CNAS, and no tool spends money.

**You need** an eSănătateaMea account. The server signs in either with the
account's e-mail, password and authenticator code, by itself (the password from
a file or a vault MCP server, the code computed from the authenticator key or
read from the vault), or through ROeID in your browser, approved on your phone.
CNAS publishes no API for patients: this is an unofficial client of the API the
portal itself uses, so it can break when the portal changes.

## What you can ask

- "Am I insured right now, and until when?"
- "Which prescriptions did I get this year, and how much did I pay at the pharmacy?"
- "What did CNAS pay for my medical care in the last twelve months, and at which clinics?"
- "Do I have an unused referral? Save it as a PDF."
- "What does my emergency summary say, and who are my emergency contacts?"
- "When is my next appointment, and where?"

## Install

<!-- install:begin -->
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect/mcp/install?name=esanatateamea&inputs=%5B%7B%22type%22%3A%22promptString%22%2C%22id%22%3A%22esanatateamea_username%22%2C%22description%22%3A%22Optional.%20The%20e-mail%20address%20you%20sign%20in%20to%20eS%C4%83n%C4%83tateaMea%20with%3B%20leave%20empty%20to%20sign%20in%20with%20ROeID%20instead.%22%7D%2C%7B%22type%22%3A%22promptString%22%2C%22id%22%3A%22esanatateamea_password_file%22%2C%22description%22%3A%22Optional.%20Path%20of%20a%20file%20holding%20only%20your%20eS%C4%83n%C4%83tateaMea%20password%3B%20leave%20empty%20to%20sign%20in%20with%20ROeID%20instead.%22%7D%2C%7B%22type%22%3A%22promptString%22%2C%22id%22%3A%22esanatateamea_totp_secret_file%22%2C%22description%22%3A%22Optional.%20Path%20of%20a%20file%20holding%20the%20authenticator%20app's%20key%20for%20the%20account%2C%20so%20the%20server%20types%20the%20six-digit%20code%20itself%3B%20leave%20empty%20to%20be%20asked%20for%20the%20code.%22%7D%5D&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40foreverworks%2Fmcp-esanatateamea%22%5D%2C%22env%22%3A%7B%22ESANATATEAMEA_USERNAME%22%3A%22%24%7Binput%3Aesanatateamea_username%7D%22%2C%22ESANATATEAMEA_PASSWORD_FILE%22%3A%22%24%7Binput%3Aesanatateamea_password_file%7D%22%2C%22ESANATATEAMEA_TOTP_SECRET_FILE%22%3A%22%24%7Binput%3Aesanatateamea_totp_secret_file%7D%22%7D%7D) [![Install in Cursor](https://img.shields.io/badge/Cursor-Install_Server-000000?style=flat-square&logo=cursor&logoColor=white)](https://cursor.com/install-mcp?name=esanatateamea&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBmb3JldmVyd29ya3MvbWNwLWVzYW5hdGF0ZWFtZWEiXSwiZW52Ijp7IkVTQU5BVEFURUFNRUFfVVNFUk5BTUUiOiIke2VudjpFU0FOQVRBVEVBTUVBX1VTRVJOQU1FfSIsIkVTQU5BVEFURUFNRUFfUEFTU1dPUkRfRklMRSI6IiR7ZW52OkVTQU5BVEFURUFNRUFfUEFTU1dPUkRfRklMRX0iLCJFU0FOQVRBVEVBTUVBX1RPVFBfU0VDUkVUX0ZJTEUiOiIke2VudjpFU0FOQVRBVEVBTUVBX1RPVFBfU0VDUkVUX0ZJTEV9In19) [![Download for Claude Desktop](https://img.shields.io/badge/Claude_Desktop-Download_Bundle-D97757?style=flat-square&logo=claude&logoColor=white)](https://github.com/foreverworks/mcps/releases/latest/download/mcp-esanatateamea.mcpb)

With Claude Code:

```bash
claude mcp add esanatateamea -- npx -y @foreverworks/mcp-esanatateamea
```

Claude Desktop (Settings, Developer, Edit Config) and most other clients read the same command as JSON:

```json
{
  "mcpServers": {
    "esanatateamea": {
      "command": "npx",
      "args": ["-y", "@foreverworks/mcp-esanatateamea"]
    }
  }
}
```

Each runs the published package on Node 22.19 or newer. VS Code and the Claude Desktop bundle ask for each setting as they add the server; leave an optional one empty. Cursor reads each from your environment instead (`${env:ESANATATEAMEA_USERNAME}` and so on), so set them before you start Cursor. Every setting is optional; [Configuration](#configuration) says which ones you need for which tools.

### From a clone

```bash
git clone https://github.com/foreverworks/mcps.git && cd mcps
npm ci && npm run build
claude mcp add esanatateamea -- node "$PWD/servers/esanatateamea/dist/index.js"
```

In a JSON configuration, the command is `node` and its one argument the full path of `servers/esanatateamea/dist/index.js`. To share one running copy between several clients over HTTP, see [docs/deploying.md](../../docs/deploying.md).
<!-- install:end -->

## Configuration

Every variable is optional. With none set the server signs in through ROeID in
your browser; set an e-mail and a password source to have it sign in by itself,
and an authenticator key (or a vault that holds one) so it never has to ask you
for the six digits.

| Variable | Required | Meaning |
|---|---|---|
| `ESANATATEAMEA_USERNAME` | no | The e-mail address you sign in to eSănătateaMea with. Needed with `ESANATATEAMEA_PASSWORD_FILE`; with a vault, it overrides the vault item's user name. |
| `ESANATATEAMEA_PASSWORD_FILE` | no | File holding only your password (`ESANATATEAMEA_PASSWORD` for a local run). Read at each sign-in, never kept. |
| `ESANATATEAMEA_TOTP_SECRET_FILE` | no | File holding the authenticator key: the base32 text shown under the QR code, or the whole `otpauth://` address (`ESANATATEAMEA_TOTP_SECRET` for a local run). The server computes the six digits itself. |
| `ESANATATEAMEA_VAULT_MCP_URL` | no | A vault MCP server over Streamable HTTP to read the login and the code from instead (this repository's bitwarden server, for one). |
| `ESANATATEAMEA_VAULT_MCP_TOKEN_FILE` | no | File holding the vault server's bearer token (`ESANATATEAMEA_VAULT_MCP_TOKEN` for a local run). |
| `ESANATATEAMEA_VAULT_MCP_COMMAND` | no | Or a vault MCP server to spawn over stdio: a JSON array of strings, or words separated by spaces. |
| `ESANATATEAMEA_VAULT_ITEM` | no | The vault item holding the eSănătateaMea login. |
| `ESANATATEAMEA_VAULT_TOOL` | no | The vault tool that answers the login. Default `get_password`. |
| `ESANATATEAMEA_VAULT_ARGS` | no | The arguments of both vault tools, as a JSON template, `{{item}}` replaced by the item. Default `{"id":"{{item}}"}`. |
| `ESANATATEAMEA_VAULT_PASSWORD_FIELD` | no | Dot path to the password in the tool's JSON answer (`.` for the whole answer). Default `password`. |
| `ESANATATEAMEA_VAULT_USERNAME_FIELD` | no | Dot path to the user name. Default `username`. |
| `ESANATATEAMEA_VAULT_CODE_TOOL` | no | The vault tool that answers the item's current authenticator code. Default `totp`; `none` when the vault holds no key, so the code is asked of you. |
| `ESANATATEAMEA_VAULT_CODE_FIELD` | no | Dot path to the code in that tool's answer. Default `code`. A `secondsLeft` beside it makes the server wait for the next code when this one is about to expire. |
| `ESANATATEAMEA_STATE_DIR` | no | Where the session and a begun sign-in live, all 0600; the default is in [docs/configuration.md](../../docs/configuration.md). It holds a live session to your health records: keep it readable by the server's user only. |
| `ESANATATEAMEA_OUTBOX_DIR` | no | Where `download_medical_document` and `get_emergency_summary` write PDFs. Default `<ESANATATEAMEA_STATE_DIR>/outbox`. |
| `ESANATATEAMEA_KEEPALIVE_MIN` | no | Refresh the session every N minutes while one is stored, so a long-running service never lets it sit idle. Off by default. |
| `ESANATATEAMEA_LOGIN_SCRIPT` | no | A command your deployment provides that runs a whole ROeID sign-in. When set, every `needs_login` remedy names it first, and `health` reports it. |
| `ESANATATEAMEA_ISSUER` | no | The Keycloak realm. Default `https://sso.esanatateamea.ro/realms/eSM`. |
| `ESANATATEAMEA_CLIENT_ID` | no | The portal's public client. Default `eSm`. |
| `ESANATATEAMEA_PORTAL` | no | The portal, its APIs under `/api`. Default `https://portal.esanatateamea.ro`. |
| `ESANATATEAMEA_REDIRECT_URI` | no | Where a ROeID sign-in lands. Default `<ESANATATEAMEA_PORTAL>/env.js`. |
| `ESANATATEAMEA_SCOPES` | no | Space-separated. Default `openid offline_access`. |

The variables every server shares are in
[docs/configuration.md](../../docs/configuration.md).

### Getting a password and an authenticator key

An account made through ROeID (as most are) has no password of its own. To
give it one, so the server can sign in without your phone:

1. Sign in on [portal.esanatateamea.ro](https://portal.esanatateamea.ro) with
   ROeID, open **Contul meu** and choose **Gestionează contul**.
2. Set a password there. Keycloak may ask you to set up an authenticator app
   at the same time: when it shows the QR code, choose to see the key as text
   and keep that text (or the `otpauth://` address the QR code holds) in the
   file `ESANATATEAMEA_TOTP_SECRET_FILE` names, or on the vault item, next to
   the password. Scan the same QR code with your phone's app, too, so you can
   still sign in on the portal yourself.
3. Your user name is the e-mail address on the account.

Without the key, the server stops at the code step and asks you for the six
digits each time it has to sign in again.

## First run

1. Ask your assistant for `health`. It says whether a session is stored, where
   the password comes from (`password_sign_in`) and the code
   (`authenticator_code`: `asked` when it must ask you), never either value.
2. Ask whether you are insured. With a password and a key configured, the
   server signs in at that first call and keeps the session. With a password
   but no key, the tool answers `needs_code`: give the assistant the six digits
   your authenticator app shows, within five minutes. With neither, it answers
   `needs_login`.
3. For ROeID: the assistant calls `begin_login` with method `roeid` and gives
   you a link (a client that shows links itself offers you the page). Sign in
   with ROeID and approve the request in the ROeID app on your phone. The first
   time, ROeID then asks whether eSănătateaMea may receive your details (name,
   personal numeric code, address, identity document): choose Acceptă, or the
   sign-in ends there without a code. The browser then lands on a page of
   plain text, one of the portal's files: copy its
   whole address (it holds `code=` and `state=`) and paste it into the
   conversation at once, as its code dies within a minute.

The session is an offline one: it does not expire by the clock, only when the
portal ends it. With a password configured the server then signs in again by
itself; without one, you repeat the ROeID steps.

## Tools

**read** changes nothing at CNAS (the two that save a PDF write it only into
the server's own outbox); **write** changes only what this server holds.

| Tool | Access | What it does |
|---|---|---|
| `health` | read | Whether a session is stored (none, present or expired), how it was made, and where the password and the code come from. No network. |
| `session_status` | read | Who is signed in and when the tokens expire; `probe` refreshes (or signs in with the password) once to prove it works. Never shows a token. |
| `begin_login` | write | Method `password`: signs in with the configured login, finishing by itself when it can read the code, else answering `needs_code`. Method `roeid`: the link for a ROeID sign-in, open 15 minutes. |
| `complete_login` | write | Takes the six digits (`otp`) after `needs_code`, or the address a ROeID sign-in landed on (`redirect_url`), and stores the session. |
| `logout` | write | Forgets the session here and ends it at the portal's sign-in server. |
| `get_insurance` | read | Insured or not, the categories with their dates and the house that reported them, the service package and what it covers, the family doctor's unit, and the history of statuses. |
| `list_prescriptions` | read | Prescriptions in a window of days (the last year by default): what was prescribed, and what pharmacies released, with the copayment in lei. |
| `list_reimbursed_services` | read | The services CNAS paid a provider for on your behalf, newest first, with the window's total and top providers, a page at a time. |
| `list_medical_documents` | read | Referrals, letters, certificates and other forms providers issued, with their status, optionally searched or in a window. |
| `get_medical_document` | read | One document's contents, section by section. |
| `download_medical_document` | read | Saves one document's PDF in the outbox; answers its path, SHA-256 and size. |
| `get_emergency_summary` | read | Your emergency summary (conditions, allergies, treatments), emergency contacts and advance directives; `pdf` also saves the portal's PDF of it. |
| `list_appointments` | read | Appointments by tab (upcoming, waiting for confirmation, past, cancelled), with the date, service, doctor and place, and each tab's count. |

## Troubleshooting

**`needs_login`.** No session, or the portal no longer honours it, and no
password is configured (`reason`: `never_connected`, `expired`, `revoked` or
`refused`). Sign in with ROeID as in [First run](#first-run), or configure a
password.

**`needs_code`.** The password was accepted and the portal asks for the
authenticator code, which nothing configured can read. Give the assistant the
six digits within five minutes; or configure the key so it is never asked.

**`input`: the code was refused.** A mistyped code spends that sign-in: call
`begin_login` with method `password` again and pass the new digits.

**`login_refused`.** The portal's sign-in server refused the password or the
code the server read by itself, or asks for a step it cannot take (a new
password, terms to accept: the message names it). Do not retry until that is
fixed: Keycloak locks an account after repeated failures, so the server itself
waits 15 minutes before sending them again. Fix the file or the vault item, or
sign in once on the portal to finish the step, then call `session_status` with
`probe` to try at once. ROeID works meanwhile.

**`upstream`.** The vault server failed: check the `ESANATATEAMEA_VAULT_*`
settings, that it is reachable, and that the item exists.

**`api`.** The portal or its sign-in server was unreachable (status 0) or failed.
For one document, a 500 may also mean the id: the portal answers an id it does
not hold the same way, so take ids from `list_medical_documents`.

**`drift`.** The portal's API changed under this server: an answer lacks a
field it depends on. It needs updating; please report the message.

## How it works

**The API is the portal's own.** Every call is one the portal's web app makes,
under `https://portal.esanatateamea.ro/api`, with a bearer token from the
portal's Keycloak and its public client. The insurance, prescriptions and
reimbursement answers were read live in November 2026; the reimbursement
rows, medical documents, emergency summary and appointments from the portal's
own client code, which declares every field this server reads. Every field is
optional but the ids a later call needs, and `scripts/smoke.ts` is the check.

**Two ways in, one session.** For the password leg the server fills the
portal's own sign-in form the way a browser does, without one: the page holds
no HTML form, only the `kcContext` its theme renders, so the server reads the
step and the form's address from it, keeps Keycloak's cookies, and posts the
e-mail and password, then the code. A password is never posted twice after a
dropped connection, since Keycloak counts every attempt toward its lockout.
For ROeID it hands you an authorization-code link with PKCE and
`kc_idp_hint=roeid`, which sends you straight to ROeID; ROeID's own checks want
a real browser and your phone, so that leg runs where you are. Its link lands
on a static file of the portal's that does nothing when opened, so the code
waits in the address bar (`response_mode=query`). Either way the session is an
offline one (`offline_access`), refreshed as needed under a lock; Keycloak
replaces the refresh token on every refresh, so the server writes it each time.

**Your records stay where they are.** The server stores tokens and nothing
else; a document reaches disk only when you ask for its PDF, in the outbox.
Amounts arrive as JSON numbers and leave as exact decimal text in lei; one that
may already have lost digits is `drift`. Days are Bucharest's.

`scripts/smoke.ts` drives the built server against your account, read-only
unless given `--sign-in`, and prints only counts and field names.

## Limitations

- **Read-only.** Cancelling or making an appointment, editing the emergency
  summary or its contacts, and the portal's exports to CSV or Excel are not
  offered.
- **The signed-in person only.** Every read is for the person the session
  belongs to, never another person the account may see on the portal.
- **The documents' window.** `list_medical_documents` sends a window of days
  only when you give one, since the format the portal expects was not seen in
  a live answer; without one the portal answers every document.
- **One account per state directory.** A second person is a second server
  with its own `ESANATATEAMEA_STATE_DIR`.

## Other servers for eSănătateaMea

Searched 2026-11-18. CNAS publishes no API for patients and no MCP server for
eSănătateaMea, which opened on 1 September 2026. Searches of npm, PyPI, GitHub,
the MCP Registry and the web found no community server or client for it. This
one reads your own records from any MCP client, signing in by itself or
through ROeID.

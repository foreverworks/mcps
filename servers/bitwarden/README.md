# <img src="icons/icon.svg" width="36" height="36" alt="Bitwarden icon"> Bitwarden MCP server

Give your AI assistant a [Bitwarden](https://bitwarden.com) account of its own
to sign up and sign in with. It finds, creates and updates logins, generates
passwords and hands one out only to type it, computes 2FA codes, keeps other
secrets (an API token, a key file) in secure notes, and checks passwords
against Have I Been Pwned. Only `create_login`, `update_login` and
`create_note` write; nothing deletes, exports or changes settings, and no tool
is `money`.

**You need** a Bitwarden account set aside for the agent, not your personal
vault (any plan: Premium is not needed), with its personal API key and master
password each in a file. Every call runs Bitwarden's CLI, so tools take
seconds, not milliseconds.

## What you can ask

- "Create a login for example.com with the username bot@example.com and a
  32-character password without symbols."
- "Which logins do we have saved for example.com?"
- "What is the current 2FA code for the Example Shop login?"
- "Generate a new password for the Example Shop login, and keep the old one in
  case the site refuses the change."
- "Is the password of any of our Example Cloud logins in a known breach?"
- "Store the key in example-key.json as a secure note called 'Example Cloud
  deploy key'."

## Install

<!-- install:begin -->
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect/mcp/install?name=bitwarden&inputs=%5B%7B%22type%22%3A%22promptString%22%2C%22id%22%3A%22bitwarden_client_id_file%22%2C%22description%22%3A%22Path%20of%20a%20file%20holding%20the%20account's%20API%20key%20client%20id.%22%7D%2C%7B%22type%22%3A%22promptString%22%2C%22id%22%3A%22bitwarden_client_secret_file%22%2C%22description%22%3A%22Path%20of%20a%20file%20holding%20the%20API%20key's%20client%20secret.%22%7D%2C%7B%22type%22%3A%22promptString%22%2C%22id%22%3A%22bitwarden_master_password_file%22%2C%22description%22%3A%22Path%20of%20a%20file%20holding%20the%20master%20password%20that%20unlocks%20the%20vault.%22%7D%2C%7B%22type%22%3A%22promptString%22%2C%22id%22%3A%22bitwarden_server%22%2C%22description%22%3A%22Optional.%20A%20self-hosted%20or%20EU%20server%2C%20e.g.%20https%3A%2F%2Fvault.bitwarden.eu.%20Leave%20empty%20for%20bitwarden.com.%22%7D%5D&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40foreverworks%2Fmcp-bitwarden%22%5D%2C%22env%22%3A%7B%22BITWARDEN_CLIENT_ID_FILE%22%3A%22%24%7Binput%3Abitwarden_client_id_file%7D%22%2C%22BITWARDEN_CLIENT_SECRET_FILE%22%3A%22%24%7Binput%3Abitwarden_client_secret_file%7D%22%2C%22BITWARDEN_MASTER_PASSWORD_FILE%22%3A%22%24%7Binput%3Abitwarden_master_password_file%7D%22%2C%22BITWARDEN_SERVER%22%3A%22%24%7Binput%3Abitwarden_server%7D%22%7D%7D) [![Install in Cursor](https://img.shields.io/badge/Cursor-Install_Server-000000?style=flat-square&logo=cursor&logoColor=white)](https://cursor.com/install-mcp?name=bitwarden&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBmb3JldmVyd29ya3MvbWNwLWJpdHdhcmRlbiJdLCJlbnYiOnsiQklUV0FSREVOX0NMSUVOVF9JRF9GSUxFIjoiJHtlbnY6QklUV0FSREVOX0NMSUVOVF9JRF9GSUxFfSIsIkJJVFdBUkRFTl9DTElFTlRfU0VDUkVUX0ZJTEUiOiIke2VudjpCSVRXQVJERU5fQ0xJRU5UX1NFQ1JFVF9GSUxFfSIsIkJJVFdBUkRFTl9NQVNURVJfUEFTU1dPUkRfRklMRSI6IiR7ZW52OkJJVFdBUkRFTl9NQVNURVJfUEFTU1dPUkRfRklMRX0iLCJCSVRXQVJERU5fU0VSVkVSIjoiJHtlbnY6QklUV0FSREVOX1NFUlZFUn0ifX0%3D) [![Download for Claude Desktop](https://img.shields.io/badge/Claude_Desktop-Download_Bundle-D97757?style=flat-square&logo=claude&logoColor=white)](https://github.com/foreverworks/mcps/releases/latest/download/mcp-bitwarden.mcpb)

> [!NOTE]
> `@foreverworks/mcp-bitwarden` is not on npm yet: the buttons and the `npx` commands below work once it is published. Until then, [run it from a clone](#from-a-clone).

With Claude Code:

```bash
claude mcp add bitwarden -e BITWARDEN_CLIENT_ID_FILE="<path to API key client id file>" -e BITWARDEN_CLIENT_SECRET_FILE="<path to API key client secret file>" -e BITWARDEN_MASTER_PASSWORD_FILE="<path to Master password file>" -- npx -y @foreverworks/mcp-bitwarden
```

Claude Desktop (Settings, Developer, Edit Config) and most other clients read the same command as JSON:

```json
{
  "mcpServers": {
    "bitwarden": {
      "command": "npx",
      "args": ["-y", "@foreverworks/mcp-bitwarden"],
      "env": {
        "BITWARDEN_CLIENT_ID_FILE": "<path to API key client id file>",
        "BITWARDEN_CLIENT_SECRET_FILE": "<path to API key client secret file>",
        "BITWARDEN_MASTER_PASSWORD_FILE": "<path to Master password file>"
      }
    }
  }
}
```

Each runs the published package on Node 22.19 or newer. VS Code and the Claude Desktop bundle ask for each setting as they add the server; leave an optional one empty. Cursor reads each from your environment instead (`${env:BITWARDEN_CLIENT_ID_FILE}` and so on), so set them before you start Cursor. The commands above set only what is required; [Configuration](#configuration) has the rest.

### From a clone

```bash
git clone https://github.com/foreverworks/mcps.git && cd mcps
npm ci && npm run build
claude mcp add bitwarden -e BITWARDEN_CLIENT_ID_FILE="<path to API key client id file>" -e BITWARDEN_CLIENT_SECRET_FILE="<path to API key client secret file>" -e BITWARDEN_MASTER_PASSWORD_FILE="<path to Master password file>" -- node "$PWD/servers/bitwarden/dist/index.js"
```

In a JSON configuration, the command is `node` and its one argument the full path of `servers/bitwarden/dist/index.js`. To share one running copy between several clients over HTTP, see [docs/deploying.md](../../docs/deploying.md).
<!-- install:end -->
The official CLI, `@bitwarden/cli` (pinned to 2026.10.0), is a dependency of
the package: `npx` and `npm ci` install it with the server, which runs it
under its own Node and never uses a `bw` on your PATH.

## Configuration

| Variable | Required | Meaning |
|---|---|---|
| `BITWARDEN_CLIENT_ID_FILE` | yes | File holding the API key's `client_id` (`BITWARDEN_CLIENT_ID` for a local run). |
| `BITWARDEN_CLIENT_SECRET_FILE` | yes | File holding the API key's `client_secret` (`BITWARDEN_CLIENT_SECRET` for a local run). |
| `BITWARDEN_MASTER_PASSWORD_FILE` | yes | File holding the master password, which unlocks the vault (`BITWARDEN_MASTER_PASSWORD` for a local run). |
| `BITWARDEN_SERVER` | no | A self-hosted or EU server, e.g. `https://vault.bitwarden.eu`. Unset is bitwarden.com. |
| `BITWARDEN_DEFAULT_COLLECTION` | no | The collection a new login or note goes in when the call names none, by name or id. Unset, or naming no collection the account has: the account's own vault, outside any collection. |
| `BITWARDEN_STATE_DIR` | no | The CLI's data folder (its `data.json`), created 0700; the default is in [docs/configuration.md](../../docs/configuration.md). |

`BITWARDEN_CLIENT_ID`, `BITWARDEN_CLIENT_SECRET` and
`BITWARDEN_MASTER_PASSWORD` are read only when their `_FILE` twin is unset.
Prefer the files: a variable is visible to every process of the same user. A
named file that is missing or empty is a `config` error, never a fallback to
the variable. Without the secrets the server still starts and lists its
tools, and each call answers a `config` error naming what is missing.

`password_file` and a note field's `file` are read from `MCP_FILE_ROOTS`; that
and the other variables every server shares are in
[docs/configuration.md](../../docs/configuration.md).

### Getting the API key and master password

1. Create a Bitwarden account for the agent, on any plan, with a strong
   master password. Keep a copy where a person can recover it.
2. In the web vault, open Settings, Security, Keys, and choose View API key.
3. Write the `client_id` (it looks like `user.<uuid>`) to the first file, the
   `client_secret` to the second, and the master password to the third, each
   readable by the server's user only.
4. Optionally, create a free organization with a collection for the agent's
   logins, set `BITWARDEN_DEFAULT_COLLECTION` to it, and invite your own
   account. You then see what the agent saves, and can lend it a login by
   putting it in a second collection.

## First run

1. Ask your assistant to run Bitwarden's `health` check. It answers with the
   account's email, the server, the last sync, how many logins the vault
   holds, and the organizations and collections it can file into. The first
   call after a start logs in, unlocks and syncs, so it is the slowest. A
   refused API key or master password shows up here as `auth`.
2. To sign up somewhere, the assistant calls `create_login` first, so the
   password is stored before the site sees it, then `get_password` to type it.

## Tools

**read** changes nothing in the vault; **write** adds an item or changes one.
Nothing deletes.

| Tool | Access | What it does |
|---|---|---|
| `health` | read | Unlocked, as whom, last sync, organizations and collections. |
| `find_logins` | read | Search logins and secure notes by words, or logins by site URL; ids and usernames, never secrets. |
| `get_login` | read | One login or secure note without its password or authenticator key: notes included, hidden custom fields by name only. |
| `get_password` | read | The password, for typing into the site; with `previous`, the one it replaced. |
| `get_field` | read | One custom field's value, hidden ones included, from a login or a secure note: a licence key or a token, for typing or piping. |
| `totp` | read | The current 2FA code and how many seconds it stays valid, computed here. |
| `check_exposed` | read | Whether a login's password is in Have I Been Pwned's breach list, and how often; only five characters of its SHA-1 leave the server. |
| `sync` | read | Pull the vault now. Every read already syncs first when the last sync is older than 30 seconds. |
| `create_login` | write | A new login; the password is generated here (24 characters with symbols, by default) unless given, typed or from a file. |
| `update_login` | write | Change what is named: `rotate_password` generates a new password, `append_notes` adds to the notes, `replace_totp` allows replacing a different key. |
| `create_note` | write | A new secure note for secrets that are not a login, each in a hidden field, typed or read whole from a file; the result gives lengths and a file's SHA-256, never a value. |

`get_password`, `get_field` and `totp` return a secret and are still `read`:
the account holds the agent's own logins, made for it to use without asking
(`src/mcp/policy.ts`). What they return is for typing or piping where it goes,
never for a file, a commit, a message or a reply. Keep your own passwords in a
vault this account cannot reach, and lend it one through a shared collection.

## Troubleshooting

**`config`.** A secret is missing, or its file is missing or empty. Set
`BITWARDEN_CLIENT_ID_FILE`, `BITWARDEN_CLIENT_SECRET_FILE` and
`BITWARDEN_MASTER_PASSWORD_FILE` as [Configuration](#configuration) says.

**`auth`: "bw login --apikey: ..." or "bw unlock: ...".** Bitwarden refused the
API key or the master password. If either changed in the web vault, update the
file the server reads it from.

**`not_found`.** No item has that id. `find_logins` lists what exists, with the
ids the other tools take.

**`input`.** The arguments cannot become a request, and nothing was sent; the
message says why. Most often: a login that already has a different
authenticator key (pass `replace_totp: true`, and the old key is kept), a
Steam key (not standard TOTP), a collection the account does not have
(`health` lists them), or an edit to a secure note (notes are never edited).

**`cli`.** The CLI ran and said no: a network failure, a refused edit, or a
call past 90 seconds. Retry once; if it persists, run `health` and read the
server's log. If `create_note` failed without saying whether the note was
saved, look for it with `find_logins` before trying again.

**`unavailable`.** Have I Been Pwned could not be read, and the vault was not
changed. Retry in a minute; a deployment that limits its hosts must allow
`api.pwnedpasswords.com`.

**`BITWARDEN_SERVER` seems ignored.** It applies when the CLI first logs in,
and a state folder logged in to another server keeps that one. Start from an
empty `BITWARDEN_STATE_DIR` to switch.

## How it works

**The CLI.** Calls run the official CLI one at a time, because each run
reads and writes its single `data.json`. The process keeps only the session
key from `bw unlock`; after a restart, the next call logs in and unlocks
again. Secrets reach the CLI through its environment or stdin, never its
arguments, which every local user can read. As a child process, the CLI is not
covered by `MCP_EGRESS_ALLOW` ([docs/configuration.md](../../docs/configuration.md)).

**2FA codes** are computed in `src/domain/totp.ts`, because Bitwarden reserves
`bw get totp` for Premium. A new key is checked strictly (base32, at least 16
characters) and stored before you confirm 2FA on the site, and the result
carries the current code computed from the stored key: if the site accepts
it, the key was stored exactly. A different key already on the login is
replaced only with `replace_totp`, and kept in a hidden field
(`totp replaced <date>`), so a mistaken replacement never locks the account.

**Passwords going in.** A generated password never passes through the model:
`create_login` stores it and returns none, and `get_password` hands it out to
type into the site. An existing password goes in as `password`, or as
`password_file` (by path inside `MCP_FILE_ROOTS`, or as `content_base64` with
its `sha256` from a script), so a long key is never retyped; the result gives
`passwordLength`, never the password. Generated passwords are 12 to 128
characters.

**Other secrets.** `create_note` keeps each in a custom field of a secure
note, hidden unless the call says otherwise. A field read from a file is taken
whole and exactly (every line, a final line ending and a byte-order mark
kept), and what the vault stored is read back and compared with what was
sent; compare the SHA-256 and size in the result with the source before you
delete it. Bitwarden refuses a field over 5,000 characters and a note's text
over 10,000 once encrypted, which is 3,695 and 7,439 bytes of plain UTF-8
(`src/domain/note.ts`). A service account's JSON key or a 4,096-bit PEM key
fits; a longer value or a binary file is refused before anything is sent
(encode it first, `base64 -w0`). The note's plain `notes` say what the secret
is and where it is used, since `get_login` shows them to anyone.

**Nothing is lost by an edit.** A rotated password is stored at once, so it
survives a session that ends before the site is updated, and the one it
replaced stays in Bitwarden's password history: `get_password` with
`previous: true` reads it, should the site refuse the new one. `append_notes`
adds a line to the notes (recovery codes, answers) where `notes` replaces
them.

**Breached passwords.** `check_exposed` uses Have I Been Pwned's keyless
range API: the first five hex characters of the password's SHA-1 go out, and
the answer (every hash suffix in that range with its count, padded with
decoys) is searched here. The password, its full hash and the suffix never
leave the server. This is the one request the server makes itself.

`npx tsx scripts/smoke.ts` drives the built server against a real account,
read-only unless given `--write`, which creates a login and a secure note
named "mcp smoke test" and "mcp smoke test note". Nothing deletes, so remove
them in the web vault afterwards.

## Limitations

- **No delete, no export, no settings, no attachments, no Sends**: only what
  an agent needs to sign up and sign in, and nothing that loses data.
- **Logins and secure notes only**; cards and identities are not read. A
  secure note is created and read, never edited: a changed secret is a new
  note.
- **Steam's authenticator codes** are not standard TOTP and are refused.
- **Seconds, not milliseconds.** Every call waits for the CLI: the first after
  a start logs in, unlocks and syncs, and a tool that runs it several times
  takes several seconds.

## Other servers for Bitwarden

Searched 2026-10-15. Bitwarden publishes a server and a separate protocol;
one community server stands out:

- **`@bitwarden/mcp-server`**, Bitwarden's own: stdio only, and by its own
  warning never to be hosted. It unlocks the vault from a session key in an
  environment variable, or through a native password dialog that refuses to
  run headless. It administers the whole vault and organisation, deleting
  items, Sends, attachments and device approvals included, and hands secrets
  to the model: `get` returns an item or its password as text, `generate` the
  new password, and `create_item` takes the password as an argument.
- **Bitwarden's Agent Access**, an early-preview protocol and CLI, not an MCP
  server: it fetches one credential at a time from a paired vault and can
  inject it into a process's environment, unseen by the model, but cannot
  create or update logins.
- **`@icoretech/warden-mcp`** on npm, the most active community server: stdio
  or HTTP, the API key and master password in environment variables (or each
  HTTP request's headers), no authentication of its own. It redacts secrets
  unless a call asks for `reveal`, and can always redact, stronger than this
  one on reads; but a generated password must be revealed to be stored, and
  its 2FA codes come from the CLI, which on bitwarden.com needs Premium.

This one is the narrow surface an agent needs to sign up and sign in.
`create_login` and `rotate_password` generate and store a password without
returning it, so it never passes through the model on the way in; only
`get_password`, `get_field` and `totp` return a secret, for typing. Its 2FA
codes work on a free account, and a new authenticator key is checked, stored
and proven by the current code. Nothing deletes or exports, and it runs over
HTTP as its own service, unlocking itself from secrets held in files.

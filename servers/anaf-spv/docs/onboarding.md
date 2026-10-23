# Onboarding: setting up anaf-spv for someone

This page takes an AI agent (or a person) from "I have an SPV account" to an
`anaf-spv` server that signs in by itself and keeps an archive of what ANAF
posts. Follow it in order: each step says how to check
it worked, and asks the user only what you cannot find out yourself. The
[README](../README.md#configuration) lists every variable.

**Never print, log, paste or store the SPV password or a security code**
anywhere but where this page says: not in a chat, a commit, a note or a tool
argument you write by hand. The one exception is `complete_login`, which takes
a code a person read.

## 0. What you are building

```text
you (an MCP client) --> anaf-spv --> pfinternet.anaf.ro (SPV)
                           |
                           +--> a vault MCP server  (the SPV user name and password)
                           +--> a mail MCP server   (the code SPV e-mails at every sign-in)
```

`anaf-spv` signs in as a person does: the password from a vault (or a file),
then the code SPV e-mails from `Autentificare.SpatiuPrivat@anaf.ro`, valid for
five minutes, read through a mail MCP server the user already runs. Without
one, every sign-in waits for someone to type the code.

## 1. Check the prerequisites

| Need | How to check | If missing |
|---|---|---|
| An SPV account for a person ("persoană fizică") that signs in with a **user name and password** | Ask the user how they sign in at pfinternet.anaf.ro. A qualified-certificate login is a different door and is not supported. | They register on anaf.ro, online with an identity document or at an ANAF office. |
| The **mailbox** SPV sends codes to | Search it for mail from `Autentificare.SpatiuPrivat@anaf.ro` with the subject "Cod de siguranta". Old codes prove it is the right one. Do not read the codes out. | Ask the user which address is registered in SPV ("Editare profil"). |
| Node.js 22.19 or newer | `node --version` | Install it. |
| Java 8 or newer, only to validate declarations | `java -version` | Install it, or skip it: everything else works without it. |

Until the package is on npm, build it from a clone as the README's
[Install](../README.md#from-a-clone) section shows, and use
`node <clone>/servers/anaf-spv/dist/index.js` wherever this page says `npx`.

## 2. Choose where the password comes from

Prefer a vault: the password then lives in one place, and a rotation is a
change there and nothing else.

### 2a. A vault MCP server (recommended)

At each sign-in the server calls one tool on the vault server and reads the
password (and usually the user name) from its JSON answer.

1. Make sure the vault holds an item with the SPV user name and password, and
   note its id: the vault server's search tool usually shows ids and names
   without secrets. Do not call a tool that reveals the password only to look.
2. Find the tool that hands out a password, and its arguments (`tools/list` on
   the vault server).
3. Configure:

| Vault server | Settings |
|---|---|
| This repository's `bitwarden` server | `ANAF_SPV_VAULT_MCP_URL` (or `_COMMAND`), its token file in `ANAF_SPV_VAULT_MCP_TOKEN_FILE`, and `ANAF_SPV_VAULT_ITEM=<item id>`. Nothing else: the defaults are its tool (`get_password`), its arguments (`{"id":"{{item}}"}`) and its fields (`password`, `username`). |
| Any other vault server | The same three, plus `ANAF_SPV_VAULT_TOOL` (the tool's name), `ANAF_SPV_VAULT_ARGS` (its arguments as JSON, with `{{item}}` where the item goes), and `ANAF_SPV_VAULT_PASSWORD_FIELD` and `ANAF_SPV_VAULT_USERNAME_FIELD` (dot paths into its JSON answer, such as `login.password`; `.` when the whole answer is the password). If its answer carries no user name, set `ANAF_SPV_USERNAME`. |

For example, a vault server whose tool is `get_item`, taking
`{"name": ...}` and answering `{"login": {"username": ..., "password": ...}}`:

```bash
ANAF_SPV_VAULT_MCP_COMMAND='["npx","-y","example-vault-mcp"]'
ANAF_SPV_VAULT_ITEM=pfinternet.anaf.ro
ANAF_SPV_VAULT_TOOL=get_item
ANAF_SPV_VAULT_ARGS='{"name":"{{item}}"}'
ANAF_SPV_VAULT_PASSWORD_FIELD=login.password
ANAF_SPV_VAULT_USERNAME_FIELD=login.username
```

### 2b. A file

Ask the user to write the password to a file only the server's user can read
(`chmod 600`), rather than dictate it to you, and point at it:

```bash
ANAF_SPV_PASSWORD_FILE=<path to the password file>
ANAF_SPV_USERNAME=<SPV user name>
```

## 3. Choose where the code is read from

Connect `anaf-spv` to the MCP server that reads the mailbox from step 1:
`ANAF_SPV_MAIL_MCP_URL` and `ANAF_SPV_MAIL_MCP_TOKEN_FILE` for a server over
HTTP, or `ANAF_SPV_MAIL_MCP_COMMAND` (a JSON array) for one to spawn over
stdio. Then:

| The mail server | Settings | Driver |
|---|---|---|
| This repository's `google` server | `ANAF_SPV_MAIL_ACCOUNT=<mailbox label>`, a label from its `list_accounts`. | `auto` picks `google`. |
| Any Gmail server whose search tool takes a Gmail query as its only required argument | Nothing more. | `auto` picks `text` and guesses the tool. |
| A server whose search tool needs more arguments (a folder, a user id, a limit) | `ANAF_SPV_MAIL_SEARCH_TOOL=<tool>`, and `ANAF_SPV_MAIL_SEARCH_ARGS` with every required argument and `{{query}}` where the query goes. | `text` |
| A server that does not speak Gmail's query syntax (IMAP, Outlook) | Also `ANAF_SPV_MAIL_QUERY` in its syntax, such as `Cod de siguranta` or `FROM "Autentificare.SpatiuPrivat@anaf.ro"`. | `text` |
| No mail server | Nothing. Every sign-in stops at `awaiting_code`; a person reads the mail and calls `complete_login`. | `manual` |

To find the search tool and its template, pick the search tool from the mail
server's `tools/list` and try it with
`from:Autentificare.SpatiuPrivat@anaf.ro subject:"Cod de siguranta"` (or the
same in its syntax). Its answer must show the mails' text or snippet, where
`Cod de siguranta: NNNNNN` appears. If it shows only ids, the `text` driver
cannot use that server: use `manual`, or a server whose search shows snippets.

Two examples (the tool names are illustrative; read the real ones from
`tools/list`):

```bash
# a server whose search is search_emails({ query, maxResults })
ANAF_SPV_MAIL_MCP_COMMAND='["npx","-y","example-gmail-mcp"]'

# a server whose search is search_messages({ user_id, q, page_size })
ANAF_SPV_MAIL_MCP_URL=http://127.0.0.1:<port>/mcp
ANAF_SPV_MAIL_MCP_TOKEN_FILE=<path to its token>
ANAF_SPV_MAIL_SEARCH_TOOL=search_messages
ANAF_SPV_MAIL_SEARCH_ARGS='{"user_id":"ana@example.com","q":"{{query}}","page_size":5}'
```

The `text` driver needs nothing else, and the mail server's token needs only
to read mail.

## 4. Register the server with the client

Use absolute paths, in the client the user works in.

**Claude Code**

```bash
claude mcp add anaf-spv \
  -e ANAF_SPV_VAULT_MCP_URL=... -e ANAF_SPV_VAULT_MCP_TOKEN_FILE=... -e ANAF_SPV_VAULT_ITEM=... \
  -e ANAF_SPV_MAIL_MCP_URL=... -e ANAF_SPV_MAIL_MCP_TOKEN_FILE=... -e ANAF_SPV_MAIL_ACCOUNT=... \
  -- npx -y @foreverworks/mcp-anaf-spv
```

**Codex** (`~/.codex/config.toml`)

```toml
[mcp_servers.anaf-spv]
command = "npx"
args = ["-y", "@foreverworks/mcp-anaf-spv"]
env = { ANAF_SPV_VAULT_MCP_URL = "...", ANAF_SPV_VAULT_ITEM = "...", ANAF_SPV_MAIL_MCP_URL = "..." }
```

**Any client with an `mcpServers` JSON** (Claude Desktop, Cursor and others)

```json
{ "mcpServers": { "anaf-spv": { "command": "npx", "args": ["-y", "@foreverworks/mcp-anaf-spv"],
  "env": { "ANAF_SPV_VAULT_MCP_URL": "...", "ANAF_SPV_VAULT_ITEM": "...", "ANAF_SPV_MAIL_MCP_URL": "..." } } } }
```

**One service for several clients.** Run it with `MCP_HTTP_PORT`, a token per
client and a user of its own, as [docs/deploying.md](../../../docs/deploying.md)
describes, with a state directory only that user can read
(`ANAF_SPV_STATE_DIR`). Under `MCP_EGRESS_ALLOW`, allow `pfinternet.anaf.ro`,
`formularespv-pf.anaf.ro`, `static.anaf.ro`, `stare.anaf.ro` and the vault and
mail servers' hosts (`127.0.0.1` for local ones). One service holds one
session for every client, so the user gets fewer code e-mails.

Restart the client (or add the server again) for it to see a new server.

## 5. Verify, in this order

1. `health`: `automatic_login: true` and no `problems`; otherwise it names
   what is missing.
2. Tell the user: "I am signing in to SPV now; you will get one e-mail with a
   security code. You do not need to do anything with it."
3. `login`: `signed_in: true` within seconds, or at most
   `ANAF_SPV_CODE_WAIT_SEC` while it waits for the mail. For `awaiting_code`,
   see step 7. For `login_refused` at `step: password`, stop and check the
   credential with the user: repeated wrong passwords can lock the account.
4. `list_messages`: the documents, newest first, with `types` counting them.
5. `download_message` with the newest `key`: a path in the outbox and a
   SHA-256. Open the PDF (`pdftotext` reads them) to show the user it is
   theirs.
6. Only with the user's agreement: `request_document` with
   `type: "Obligatii de plata"` (the statement of what is owed; free, and it
   changes nothing at ANAF), then `await_reply`.

`npx tsx scripts/smoke.ts`, run from `servers/anaf-spv` with the same
environment, does steps 1, 4, 5 and more in one go, and changes nothing at
ANAF.

## 6. Keep an archive

SPV removes most documents about two months after posting them, and a summons
or a decision that is gone cannot be downloaded again. Run `sync_messages`
daily: it saves every message not saved before. Ways to run it:

- the user's agent scheduler, if their client has one;
- a timer that runs a small MCP client script (`scripts/smoke.ts` shows how to
  connect and call a tool), against the stdio server or a running service;
- a mail rule or an agent that watches for SPV's "Documente noi SPV" alert and
  calls `sync_messages` then.

Point `save_dir` (or `ANAF_SPV_DOWNLOADS_DIR`) where the user keeps their
papers, and back it up.

## 7. Troubleshooting

| Answer | Meaning | What to do |
|---|---|---|
| `config` naming a variable | Something is not set or cannot be parsed. | Set it; nothing reached SPV. |
| `upstream` with `source: vault` | The vault server failed, or the item is not there. | Call the vault server's health or search tool; check `ANAF_SPV_VAULT_ITEM`. |
| `upstream` with `source: mail` | The mail server failed. | Check that it answers; meanwhile `login` with `code_by_hand: true`, then `complete_login`. |
| `needs_login`, `awaiting_code` | No mail driver reads the code (`manual`, or `code_by_hand`). | Ask the user for the newest code, or read it yourself if you can, and call `complete_login` within five minutes. |
| `needs_login`, `code_not_received` | The mail server showed no new code in time. | `complete_login` with the newest code; then fix the driver (a wrong mailbox, a search that hides snippets, `ANAF_SPV_MAIL_QUERY` in the wrong syntax). |
| `needs_login`, `pending_expired` | `complete_login` came after the five minutes. | `login` again for a new code. |
| `login_refused`, `step: password` | SPV refused the user name or password; its words are in `message`. | Do not retry in a loop. Check with the user, and fix the vault item or the file. |
| `login_refused`, `step: code` | The code was wrong or stale. | `login` again, and pass only the newest code. |
| `wrong_document` | SPV served another message's file; nothing was saved. | Download the same key again; report it if it repeats. |
| `drift` | SPV's pages changed. | Report it with the message; nothing else will fix it. |
| `api`, status 0 or 5xx | SPV is down, often at night and on weekends. | Try again later. |

## 8. What to tell the user when you are done

- Where their documents are saved, and when `sync_messages` runs.
- That every sign-in sends them a code e-mail they can ignore, and roughly how
  often: a session lasts while it is used, and `ANAF_SPV_KEEPALIVE_MIN` keeps
  an idle one alive.
- That the password stays where they keep it (the vault or the file), and
  changing it there is all a rotation takes.
- That the server sends ANAF something only when asked: a document request
  (free), a contact-form message (a dry run unless told to send it), or a D212
  filing, which their client asks them to confirm first.

# <img src="icons/icon.svg" width="36" height="36" alt="Google Workspace icon"> Google Workspace MCP server

Search, read and organise the mail, calendars, Drive files, Docs, Sheets,
Slides, Google Tasks, contacts and Meet transcripts of several Google accounts
at once, from your AI assistant. It writes drafts, labels, filters, events,
tasks, files, documents, comments and sharing. Nothing is `money`, and nothing
deletes mail or a file for good: Gmail and Drive keep the trash for 30 days.

**Mail stays a draft until you say send.** Sending, sharing a file and
publishing a revision are `write` tools that tell your assistant to wait for
your explicit go. The server does not ask you itself; your client can, before
each call. `MCP_MAX_ACCESS=read` makes the server read-only.

**You need** one or more Google accounts, your own Google Cloud project with a
Desktop app OAuth client ([step by step](#getting-the-oauth-client)), and a
browser to approve each product for each account once. Google expires the
grants of an app left in Testing after seven days. The Workspace directory,
Meet transcripts and smart notes, and focus time and out of office events need
a Google Workspace account.

## What you can ask

- "What's on my calendar this week across both accounts, and does anything
  clash?"
- "Find 45 minutes with Ana Popescu next week, mornings first."
- "Save every PDF that came to my work mailbox as an attachment in September."
- "Draft a reply to Ana's last email saying Thursday at 10 works. I'll send it
  myself."
- "Add these invoices to the Invoices sheet, and update any row whose invoice
  number is already there."
- "What did we decide in yesterday's call with Client SRL? Read me the
  transcript."

## Install

<!-- install:begin -->
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect/mcp/install?name=google&inputs=%5B%7B%22type%22%3A%22promptString%22%2C%22id%22%3A%22google_oauth_client_file%22%2C%22description%22%3A%22Path%20of%20your%20OAuth%20client's%20JSON%20(a%20Desktop%20app%20client%20from%20the%20Google%20Cloud%20console).%22%7D%2C%7B%22type%22%3A%22promptString%22%2C%22id%22%3A%22gmail_addresses%22%2C%22description%22%3A%22Each%20account's%20label%20and%20address%2C%20e.g.%20personal%3Dana%40example.com%2Cwork%3Dana%40example.org.%22%7D%2C%7B%22type%22%3A%22promptString%22%2C%22id%22%3A%22gmail_modify_accounts%22%2C%22description%22%3A%22Where%20each%20mailbox's%20Gmail%20grant%20is%20kept%2C%20e.g.%20personal%3D%2Fpath%2Fto%2Fgrants%2Fgmail-personal.json%3B%20consent%20writes%20it%20there.%20Without%20it%20the%20other%20products%20work%2C%20but%20no%20mailbox%20does.%22%7D%2C%7B%22type%22%3A%22promptString%22%2C%22id%22%3A%22calendar_time_zone%22%2C%22description%22%3A%22Optional.%20The%20time%20zone%20a%20time%20without%20an%20offset%20is%20read%20in%2C%20e.g.%20Europe%2FParis.%22%7D%2C%7B%22type%22%3A%22promptString%22%2C%22id%22%3A%22google_toolsets%22%2C%22description%22%3A%22Optional.%20The%20products%20whose%20tools%20the%20server%20loads%2C%20separated%20by%20commas%2C%20e.g.%20gmail%2Ccalendar.%20Empty%20loads%20every%20product.%22%7D%5D&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40foreverworks%2Fmcp-google%22%5D%2C%22env%22%3A%7B%22GOOGLE_OAUTH_CLIENT_FILE%22%3A%22%24%7Binput%3Agoogle_oauth_client_file%7D%22%2C%22GMAIL_ADDRESSES%22%3A%22%24%7Binput%3Agmail_addresses%7D%22%2C%22GMAIL_MODIFY_ACCOUNTS%22%3A%22%24%7Binput%3Agmail_modify_accounts%7D%22%2C%22CALENDAR_TIME_ZONE%22%3A%22%24%7Binput%3Acalendar_time_zone%7D%22%2C%22GOOGLE_TOOLSETS%22%3A%22%24%7Binput%3Agoogle_toolsets%7D%22%7D%7D) [![Install in Cursor](https://img.shields.io/badge/Cursor-Install_Server-000000?style=flat-square&logo=cursor&logoColor=white)](https://cursor.com/install-mcp?name=google&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBmb3JldmVyd29ya3MvbWNwLWdvb2dsZSJdLCJlbnYiOnsiR09PR0xFX09BVVRIX0NMSUVOVF9GSUxFIjoiJHtlbnY6R09PR0xFX09BVVRIX0NMSUVOVF9GSUxFfSIsIkdNQUlMX0FERFJFU1NFUyI6IiR7ZW52OkdNQUlMX0FERFJFU1NFU30iLCJHTUFJTF9NT0RJRllfQUNDT1VOVFMiOiIke2VudjpHTUFJTF9NT0RJRllfQUNDT1VOVFN9IiwiQ0FMRU5EQVJfVElNRV9aT05FIjoiJHtlbnY6Q0FMRU5EQVJfVElNRV9aT05FfSIsIkdPT0dMRV9UT09MU0VUUyI6IiR7ZW52OkdPT0dMRV9UT09MU0VUU30ifX0%3D) [![Download for Claude Desktop](https://img.shields.io/badge/Claude_Desktop-Download_Bundle-D97757?style=flat-square&logo=claude&logoColor=white)](https://github.com/foreverworks/mcps/releases/latest/download/mcp-google.mcpb)

> [!NOTE]
> `@foreverworks/mcp-google` is not on npm yet: the buttons and the `npx` commands below work once it is published. Until then, [run it from a clone](#from-a-clone).

With Claude Code:

```bash
claude mcp add google -e GOOGLE_OAUTH_CLIENT_FILE="<path to OAuth client file>" -e GMAIL_ADDRESSES="<Accounts and their addresses>" -e GMAIL_MODIFY_ACCOUNTS="<Where Gmail grants are kept>" -- npx -y @foreverworks/mcp-google
```

Claude Desktop (Settings, Developer, Edit Config) and most other clients read the same command as JSON:

```json
{
  "mcpServers": {
    "google": {
      "command": "npx",
      "args": ["-y", "@foreverworks/mcp-google"],
      "env": {
        "GOOGLE_OAUTH_CLIENT_FILE": "<path to OAuth client file>",
        "GMAIL_ADDRESSES": "<Accounts and their addresses>",
        "GMAIL_MODIFY_ACCOUNTS": "<Where Gmail grants are kept>"
      }
    }
  }
}
```

Each runs the published package on Node 22.19 or newer. VS Code and the Claude Desktop bundle ask for each setting as they add the server; leave an optional one empty. Cursor reads each from your environment instead (`${env:GOOGLE_OAUTH_CLIENT_FILE}` and so on), so set them before you start Cursor. The commands above set only what is required; [Configuration](#configuration) has the rest.

### From a clone

```bash
git clone https://github.com/foreverworks/mcps.git && cd mcps
npm ci && npm run build
claude mcp add google -e GOOGLE_OAUTH_CLIENT_FILE="<path to OAuth client file>" -e GMAIL_ADDRESSES="<Accounts and their addresses>" -e GMAIL_MODIFY_ACCOUNTS="<Where Gmail grants are kept>" -- node "$PWD/servers/google/dist/index.js"
```

In a JSON configuration, the command is `node` and its one argument the full path of `servers/google/dist/index.js`. To share one running copy between several clients over HTTP, see [docs/deploying.md](../../docs/deploying.md).
<!-- install:end -->

Over HTTP (`MCP_HTTP_PORT`), one process serves every session, with one token
cache per grant.

## Configuration

The server starts with nothing set: a product not set up yet answers with a
`config` error naming what to set. Four variables cover most setups.

| Variable | Required | Meaning |
|---|---|---|
| `GOOGLE_OAUTH_CLIENT_FILE` | for consent | The OAuth client JSON from the Google Cloud console (a Desktop app client). New grants are made on it. Without it, a consent borrows the client of a credentials file the account already has. |
| `GMAIL_ADDRESSES` | for consent | `label=address,...`: the Google address each account label stands for, in every product. A consent approved as anyone else is refused, and `health` checks Gmail grants against it. |
| `GMAIL_MODIFY_ACCOUNTS` | for Gmail | `label=path,...`: where each mailbox's own `gmail.modify` grant is kept. `begin_consent` writes it there. |
| `CALENDAR_TIME_ZONE` | no | The IANA zone a time without an offset is read in, and working hours default to; default the process's zone (`TZ`). |

A label is lowercase letters, digits and hyphens (`personal`, `work`,
`client-a`), and stands for one Google identity in every product. Everything
the server writes (token caches, grants, waiting consents, downloads) goes
under `GOOGLE_STATE_DIR`: by default systemd's `STATE_DIRECTORY`, else
`$XDG_STATE_HOME/mcps/google` (`~/.local/state/mcps/google`), unless a
variable below moves a product's part.

<details>
<summary>Every other variable (all optional)</summary>

| Variable | Meaning |
|---|---|
| `GMAIL_ACCOUNTS` | `label=path,...`: a read-only (`gmail.readonly`) grant per mailbox, made elsewhere, for instance by a mail-sync program. A mailbox whose `gmail.modify` grant file does not exist runs on this one: it reads, and every write refuses. |
| `GMAIL_DEFAULT_ACCOUNT` | The mailbox a one-mailbox read uses when none is named; default the first listed. |
| `GMAIL_STATE_DIR` | Gmail's token caches, `<dir>/<label>/`; default `<GOOGLE_STATE_DIR>/gmail/state`. |
| `GMAIL_ATTACHMENTS_DIR` | Where attachments are saved, `<dir>/<label>/`; default `attachments/` in each mailbox's state folder. |
| `GMAIL_TIME_ZONE` | The zone a reply's "On `<date>` ... wrote:" line and a forward's Date line are written in, as Gmail writes them in its reader's zone; default `CALENDAR_TIME_ZONE`, else the process's zone. |
| `CALENDAR_ROOT` | Calendar grants, `<root>/<label>/credentials.json` (written by consent); default `<GOOGLE_STATE_DIR>/calendar`. |
| `CALENDAR_DEFAULT_ACCOUNT` | The account a one-account Calendar read uses; default the first by name. |
| `DRIVE_CREDENTIALS` | Drive's one grant (written by consent); default `<GOOGLE_STATE_DIR>/drive/credentials.json`. |
| `DRIVE_STATE_DIR` | Drive's token cache; default `<GOOGLE_STATE_DIR>/drive/state`. |
| `DRIVE_DOWNLOADS_DIR` | Where `download_file` and `download_revision` save; default `<GOOGLE_STATE_DIR>/drive/downloads`. |
| `DRIVE_MIRROR_ROOT` | A local copy of My Drive the server may read: `upload_file` also takes files from it, and sends each to the folder it mirrors. |
| `DRIVE_RCLONE_CONF` | An rclone config whose remote's grant Drive borrows until it has its own. The remote must carry its own `client_id` and `client_secret`, since rclone's built-in client cannot be refreshed from here. Unset: no rclone. |
| `DRIVE_RCLONE_REMOTE` | That remote's name; default `gdrive`. |
| `GOOGLE_EDITORS_ROOT` | Docs, Sheets and Slides grants, `<root>/<label>/credentials.json`; default `<GOOGLE_STATE_DIR>/editors`. |
| `GOOGLE_EDITORS_STATE_DIR` | Their token caches, `<dir>/<label>/`, for when the grants must stay read-only; default `<root>/<label>/state`. |
| `GOOGLE_EDITORS_DRIVE_ACCOUNT` | The label whose Docs, Sheets and Slides run on Drive's grant. Unset: none does. |
| `GOOGLE_EDITORS_DEFAULT_ACCOUNT` | The account a Docs, Sheets or Slides read uses when none is named; default the one on Drive's grant, else the first. |
| `TASKS_ROOT` | Google Tasks grants, `<root>/<label>/credentials.json`; default `<GOOGLE_STATE_DIR>/tasks`. |
| `CONTACTS_ROOT` | The same for contacts and the directory; default `<GOOGLE_STATE_DIR>/contacts`. |
| `MEET_ROOT` | The same for Meet's records; default `<GOOGLE_STATE_DIR>/meet`. |
| `GOOGLE_CONSENT_REDIRECT_URI` | The loopback address a consent redirects to; default `http://localhost:8123/`. |
| `GOOGLE_STATE_DIR` | The root of all of the above. |
| `GOOGLE_TOOLSETS` | The products whose tools the server loads, separated by commas; default every one ([Toolsets](#toolsets)). |

</details>

The variables every server shares (`MCP_HTTP_PORT`, `MCP_MAX_ACCESS`,
`MCP_FILE_ROOTS`, `MCP_FILE_SCRIPT` and the rest) are in
[docs/configuration.md](../../docs/configuration.md).

### Toolsets

Every tool definition the server hands your client travels with each request
the client makes, so a client that only needs mail and calendars pays for
Drive, Docs, Sheets and the rest all the same. `GOOGLE_TOOLSETS` names the
products to load, separated by commas, the way GitHub's MCP server takes
`GITHUB_TOOLSETS`. The tools of a product not loaded are not there at all:
not in the tool list, not in the server's instructions, not in
`list_accounts` or `health`. Unset, empty or `all`, every product is loaded,
as before.

| Toolset | What it loads |
|---|---|
| `gmail` | Mail: search, read, drafts, sending, labels, filters and attachments. |
| `calendar` | Events, free/busy, finding a time, and answering invitations. |
| `drive` | Drive's files and folders: paths, changes, upload and download. |
| `docs` | Google Docs, simple edits and the full API, with `editors_api_reference`. |
| `sheets` | Google Sheets, rows and ranges and the full API, with `editors_api_reference`. |
| `slides` | Google Slides, decks from an outline and the full API, with `editors_api_reference`. |
| `collaboration` | Comments, sharing and revisions on any Drive file. |
| `tasks` | Google Tasks. |
| `contacts` | `find_people`: contacts, saved addresses and a Workspace directory. |
| `meet` | Meet's meetings, transcripts and smart notes. |

`list_accounts`, `health`, `begin_consent` and `complete_consent` are always
loaded: every other tool takes a label `list_accounts` names, every remedy
points to `health`, and consent is how any grant is made, including one a
loaded product leans on (Meet reads a calendar event through the Calendar
grant). A name that is not a toolset stops the server at start, with a
message listing the ones there are. Measured with
`scripts/measure-tokens.ts` on 2026-10-23 (GPT-4 tokenizer), the tool list is
115 tools and about 84,800 tokens with every toolset (39,200 without the
product icons, which a client may not show the model), 43 tools and 35,600
(16,100) with `gmail,calendar`, and 46 tools and 32,400 (15,200) with
`drive,docs,sheets`.

To load mail and calendars only, with Claude Code:

```bash
claude mcp add google -e GOOGLE_TOOLSETS=gmail,calendar -e GOOGLE_OAUTH_CLIENT_FILE="<path to OAuth client file>" -e GMAIL_ADDRESSES="<Accounts and their addresses>" -e GMAIL_MODIFY_ACCOUNTS="<Where Gmail grants are kept>" -- npx -y @foreverworks/mcp-google
```

Or in Claude Desktop's configuration:

```json
{
  "mcpServers": {
    "google": {
      "command": "npx",
      "args": ["-y", "@foreverworks/mcp-google"],
      "env": {
        "GOOGLE_TOOLSETS": "gmail,calendar",
        "GOOGLE_OAUTH_CLIENT_FILE": "/path/to/oauth-client.json",
        "GMAIL_ADDRESSES": "personal=ana@example.com,work=ana@example.org",
        "GMAIL_MODIFY_ACCOUNTS": "personal=/path/to/grants/gmail-personal.json,work=/path/to/grants/gmail-work.json"
      }
    }
  }
}
```

A toolset removes tools; `MCP_MAX_ACCESS=read` keeps every tool listed and
refuses the writes. The shell's `--health` checks every product whatever
`GOOGLE_TOOLSETS` says; name a product to narrow it.

### Getting the OAuth client

One OAuth client of your own serves every account and product.

1. In the [Google Cloud console](https://console.cloud.google.com/), create a
   project for this server.
2. Under **APIs & Services**, **Library**, enable the APIs of the products you
   will use: Gmail API, Google Calendar API, Google Drive API, Google Docs API,
   Google Sheets API, Google Slides API, Google Tasks API, People API (contacts
   and the directory) and Google Meet REST API.
3. Open **Google Auth Platform**. Under **Branding**, name the app and give
   your e-mail. Under **Audience**, pick who may use it, then add every account
   as a test user or **Publish app**: Google expires the refresh tokens of an
   app left in *Testing* after seven days. A published app can stay unverified
   for your own accounts; at consent, continue past Google's warning screen.
4. Under **Data Access**, add the scopes of the products you will use (each is
   `https://www.googleapis.com/auth/` followed by the name below):

   | Product | Scopes |
   |---|---|
   | `gmail` | `gmail.modify`, and `gmail.settings.basic` for filters |
   | `calendar` | `calendar.events`, `calendar.calendarlist.readonly`, `calendar.events.freebusy` |
   | `drive` | `drive` |
   | `editors` (Docs, Sheets, Slides) | `documents`, `spreadsheets`, `presentations`, `drive.file` |
   | `tasks` | `tasks` |
   | `contacts` | `contacts.readonly`, `contacts.other.readonly`, and `directory.readonly` (optional: only a Workspace account has a directory) |
   | `meet` | `meetings.space.readonly` |

   Every consent also asks for `userinfo.email`, so the server can check who
   approved it.
5. Under **Clients**, **Create client** of application type **Desktop app**,
   and download its JSON (its `installed` block holds the `client_id` and
   `client_secret`). Keep the file private, and point
   `GOOGLE_OAUTH_CLIENT_FILE` at it.
6. Name your accounts and, for Gmail, where each mailbox's grant goes:

   ```
   GMAIL_ADDRESSES=personal=ana@example.com,work=ana@example.org
   GMAIL_MODIFY_ACCOUNTS=personal=/path/to/grants/gmail-personal.json,work=/path/to/grants/gmail-work.json
   ```

   Add them to the server's configuration in your client, and restart it.

## First run

Each product needs a grant per account, made once in your browser.

1. Ask your assistant for `list_accounts`: the labels each product knows (the
   mailboxes in `GMAIL_MODIFY_ACCOUNTS`; for other products, the accounts with
   a grant).
2. Ask it to begin a consent, for instance "Run begin_consent for calendar,
   account work". The product is `gmail`, `calendar`, `drive`, `editors`,
   `tasks`, `contacts` or `meet`.
3. Open the URL it returns, sign in as the address it names, and tick every
   box. A client with MCP URL elicitation offers you the page itself.
4. The browser then fails to load `http://localhost:8123/?state=...&code=...`,
   as expected: nothing listens there. Within 15 minutes, copy the whole
   address from the address bar and give it to your assistant for
   `complete_consent`. The product uses the grant from its next call.
5. Repeat for each product and account. **Drive holds one grant**: consent
   `drive` once, for the account whose Drive the Drive tools should reach.
   That account's Docs, Sheets and Slides can share it
   (`GOOGLE_EDITORS_DRIVE_ACCOUNT=personal`); every other account consents
   `editors` for its own.
6. Ask for `health`. Every grant should refresh as the address you meant,
   with the scopes you ticked, and every API it checks should answer.

From a shell, `node dist/index.js --health [gmail|calendar|drive|editors|tasks|contacts|meet]`
prints one line per account and grant and exits with the worst line's code,
for a timer.

## Tools

**read** changes nothing in your accounts (the download tools save a local
copy); **write** changes something in one of them. With `GOOGLE_TOOLSETS`
set, only the tables of the [toolsets](#toolsets) loaded apply; the accounts
and consent tools are always there.

Every tool takes `account`, a label from `list_accounts`, except Drive's (Drive
holds one grant), `list_accounts`, `complete_consent` and
`editors_api_reference`. The reads that make sense across accounts
(`search_threads`, `agenda`, `free_busy`, `find_time`, `list_calendars`,
`list_tasks`, `list_task_lists`, `find_people` and `health`) read every
account when none is named; any other read uses the product's default
account. **A write has no default**, because mail or an event made as the
wrong identity goes out under that identity.

### Accounts and consent

| Tool | Access | What it does |
|---|---|---|
| `list_accounts` | read | The accounts each product reaches, the default, and which grant each runs on. Start here. |
| `health` | read | Per product and account: whether the grant refreshes, which address it resolves to, the scopes Google granted, and, for Docs, Sheets, Slides, Tasks, contacts and Meet, whether the API is enabled. |
| `begin_consent` | write | The URL that grants one product access to one account; open it in a browser and approve as the address named. |
| `complete_consent` | write | Finishes a consent from the URL the approval redirected to; the grant is checked and saved where the product reads it. |

### Gmail

| Tool | Access | What it does |
|---|---|---|
| `search_threads` | read | Gmail query syntax across every mailbox at once, each result tagged with its account. |
| `get_thread` / `get_message` | read | A thread or message with its bodies and attachment list (`detail`: `metadata`, `text`, `raw_html`). |
| `get_messages` | read | Up to 25 messages of one mailbox in one call, in the order given; one that cannot be read comes back in its place, marked `partial`, and the rest still arrive. |
| `get_attachment` | read | One attachment saved to the attachments folder, with its size and sha256. |
| `harvest_attachments` | read | Every attachment a search matches, saved in one call, with counts to reconcile. |
| `list_history` | read | Messages added since a `historyId`: incremental sync instead of searching again. |
| `list_labels` | read | System and user labels. |
| `sender_breakdown` | read | Who the threads a search matches come from, per domain, busiest first. |
| `list_filters` | read | Filters, with the search each one's criteria amount to. |
| `get_draft` / `list_drafts` | read | Drafts, each with its Gmail web link. |
| `create_draft` / `update_draft` / `delete_draft` | write | Drafts: the default for anything addressed to someone. |
| `reply` / `forward` | write | Threaded for every party; a draft unless `send` is true. |
| `send_draft` / `send_message` | write | Send. Only on the user's explicit go for that message. |
| `modify_labels` / `modify_labels_matching` | write | Archive, mark read, star, file: labels on given threads, or on every thread a search matches (a dry run by default). |
| `create_label` / `update_label` / `delete_label` | write | User labels; system labels are refused. |
| `create_filter` / `delete_filter` | write | Filters that set labels (no forwarding); one that sends mail to TRASH or SPAM needs `discard`. |
| `trash` / `untrash` / `mark_spam` / `unmark_spam` | write | Threads or messages; there is no permanent delete. |

### Calendar

| Tool | Access | What it does |
|---|---|---|
| `agenda` | read | Events across every account in time order, with the conflicts between them and the invitations not yet answered; with `include_tasks`, the tasks due on those days too. |
| `list_calendars` | read | Every calendar each account sees, and whether `agenda` reads it. |
| `get_event` | read | One event in full: description, guests and their answers, reminders, meeting link. |
| `free_busy` | read | Busy blocks across every account, merged, plus other people's (`attendees`); what could not be read is listed. |
| `find_time` | read | Free slots of a given length inside working hours (Monday to Friday, 09:00 to 18:00 by default), after notice, with buffers. |
| `create_event` / `update_event` / `delete_event` | write | Events, with a new Meet link on request, and focus time or out of office blocks; nobody is emailed unless `send_updates` says so, and a whole series is touched only with `scope: "series"`. |
| `respond_to_invite` | write | Accept, decline or answer tentative; changes only your own answer. |

### Drive

| Tool | Access | What it does |
|---|---|---|
| `resolve_path` / `path_of` | read | A path to the id it names (or the ids, when two share it), and back. |
| `list_folder` / `find_files` / `describe_file` | read | A folder's children, a search of the whole Drive, one file's metadata. |
| `read_doc` | read | A Doc, Sheet or deck exported as text, markdown or HTML. |
| `start_drive_cursor` / `drive_changes` | read | What changed since a cursor, in one call that returns only the delta. |
| `download_file` | read | A file saved to the downloads folder, checked against Drive's checksum first (a Google file is exported). |
| `upload_file` | write | A file onto Drive byte for byte, checked against what Drive stored; a damaged upload is taken back. With `convert`, a .docx, .xlsx or .pptx (their older forms, or a .csv) becomes a Google Doc, Sheet or deck. |
| `copy_file` / `move_file` / `rename_file` | write | Copy, move (with a dry run that names every collision) and rename, Docs included. |
| `create_folder` | write | A folder and every missing folder above it. |
| `trash_file` / `untrash_file` | write | Drive's trash, recoverable for 30 days; there is no permanent delete. |

### Comments, sharing and revisions

On any Drive file (a Doc, a Sheet, a deck, a PDF), acting as a Docs, Sheets
and Slides account.

| Tool | Access | What it does |
|---|---|---|
| `list_comments` | read | Comment threads with their replies, quoted text and resolved state; open and resolved counted. |
| `add_comment` / `reply_to_comment` | write | A new thread, or a reply that may resolve or reopen one. |
| `edit_comment` / `delete_comment` | write | A comment's or a reply's text changed, or removed. |
| `list_permissions` | read | Who has access and how, and the link sharing in a line. |
| `share_file` / `update_permission` / `remove_permission` | write | Access given to a person, group, domain or anyone with the link, changed or taken away; Drive's email only when asked. Only on the user's explicit go. |
| `list_revisions` | read | A file's revisions: who, when, and the formats an old one can be saved as. |
| `download_revision` | read | One revision into the downloads folder, checked against its MD5, or exported for a Google file. |
| `update_revision` | write | Keep a revision forever, or publish a Google file's revision to the web (only on the user's explicit go). |

### Docs, Sheets and Slides: the API reference

| Tool | Access | What it does |
|---|---|---|
| `editors_api_reference` | read | What any Docs, Sheets or Slides request kind or type takes, from the API's own schema; with no name, every request kind. |

### Docs

| Tool | Access | What it does |
|---|---|---|
| `read_document` | read | A Doc (any tab) as markdown, with an index of its sections and its revisionId. |
| `edit_document_section` | write | Replaces everything under one heading with markdown, in any tab, pinned to the revision read. |
| `append_to_document` | write | Markdown after the last paragraph of any tab. |
| `create_document` | write | A new Doc from markdown, in a folder. |
| `get_document` | read | The structure with every index: tabs, paragraphs with styles and runs, tables cell by cell, objects; headers, footers, footnotes, lists, named ranges and styles on request; or the raw JSON through a field mask. |
| `find_in_document` | read | Every place a text or a regular expression appears, as ranges a request can use, with the revision they are right for. |
| `batch_update_document` | write | Any Docs API requests in one atomic batch, checked against the schema first and pinned to a revision whenever one names an index; local images through `images`. |

### Sheets

| Tool | Access | What it does |
|---|---|---|
| `list_sheets` | read | Title, locale, time zone, and each sheet's id, size and frozen rows. |
| `read_rows` | read | Rows as objects keyed by the header, typed: numbers, ISO dates, currency with its exact decimal. |
| `read_sheet_cells` | read | Sparse cells with formulas, links, chips and notes, for a sheet with no header. |
| `append_rows` / `upsert_rows` | write | Rows after the last, or matched by a key column and updated, in one atomic batch. |
| `write_range` | write | Values or formulas into a named sheet's A1 range; returns what the cells held before. |
| `format_range` | write | Number format, text style, colours, borders, frozen rows and columns. |
| `link_sheet_cells` | write | Hyperlinks on existing text cells, checked against their expected text first. |
| `add_chart` | write | A chart over a data range. |
| `create_spreadsheet` | write | A new Sheet with named sheets and bold, frozen header rows, in a folder. |
| `get_spreadsheet` | read | The structure with every id: sheets, merges, conditional formats, filters, protected and banded ranges, charts, slicers, tables, groups, named ranges, as A1; or the raw JSON with grid data through ranges and a field mask. |
| `get_values` | read | Several ranges' values (or the cells data filters choose), formatted, unformatted or as formulas. |
| `update_values` / `clear_values` | write | Values into several ranges or data filters in one call (raw or as typed), or emptied keeping their formats. |
| `append_values` | write | Rows after the table Sheets finds at a range. |
| `batch_update_spreadsheet` | write | Any Sheets API requests in one atomic batch, checked against the schema first, with A1 accepted wherever a GridRange, GridCoordinate or DimensionRange goes. |
| `copy_sheet_to` | write | One sheet copied into another spreadsheet, or the same one. |
| `search_developer_metadata` | read | Developer metadata by id or by data filters, with where each tag is attached as A1. |

### Slides

| Tool | Access | What it does |
|---|---|---|
| `list_layouts` | read | A deck's layouts and each one's placeholders. |
| `read_deck` | read | Per slide: layout, title, other text and speaker notes. |
| `get_thumbnails` | read | A PNG URL per slide (they expire in about half an hour). |
| `create_deck_from_outline` | write | A template copied into a new deck, one slide per outline entry, checked against the template first. |
| `fill_placeholders` | write | Replaces `{{tag}}`s across the deck, with a count of each. |
| `get_presentation` | read | The structure with every object id: per slide its elements with size, transform and exact text, and the notes' shape; or the raw JSON through a field mask. |
| `batch_update_presentation` | write | Any Slides API requests in one atomic batch, checked against the schema first, optionally pinned to a revision; local images through `images`. |
| `create_presentation` | write | A blank deck in a folder, to build with `batch_update_presentation`. |

### Tasks

| Tool | Access | What it does |
|---|---|---|
| `list_task_lists` | read | Every Google Tasks list of each account, the default one marked. |
| `list_tasks` | read | Tasks across every account and list, open ones unless asked, optionally due between two dates. |
| `create_task` / `create_task_list` | write | A task (title, notes, due date, as a subtask or after a sibling), or a new list. |
| `update_task` / `complete_task` | write | A task's title, notes or due date; done, or open again. Only what differs is sent, so a repeat changes nothing. |
| `move_task` | write | Under another task, after a sibling, or into another list of the same account. |

### Contacts

| Tool | Access | What it does |
|---|---|---|
| `find_people` | read | A person's address by name across every account: its contacts, the addresses Gmail saved, and a Workspace directory, merged into one entry per person. |

### Meet

| Tool | Access | What it does |
|---|---|---|
| `list_meetings` | read | The meetings of a calendar event, a Meet link or the last days, each with its transcripts, smart notes and recordings. |
| `get_transcript` | read | A transcript as lines of who said what, and when in the meeting. |

## Troubleshooting

A failure comes back as `{"error": {"kind", "message", "remedy"}}`, and the
remedy names the next step.

**`config`: "credentials at ... are missing or unparseable"**, "Drive has no
grant", or "no calendar grant for "work"" (the same for other products). Run
that product's consent for the account ([First run](#first-run)); the message
lists the accounts that have one.

**`config`: "no address is known for "work"" or ""work" is not a mailbox
here".** Add `work=<address>` to `GMAIL_ADDRESSES`, or `work=<path>` to
`GMAIL_MODIFY_ACCOUNTS`. "no OAuth client is known" means
`GOOGLE_OAUTH_CLIENT_FILE` is not set.

**`input`: "no consent is waiting for that state".** The consent expired
after 15 minutes, was already completed, or was begun by a copy of the server
with another state directory. Begin again; each consent URL works once.

**`auth` with code `wrong_account` or `insufficient_scope` at consent.** You
approved as another address or left a box unticked; nothing was saved. Begin
again as the address named, and tick every box. On a later call,
`insufficient_scope` means the grant lacks what that call needs (filters need
`gmail.settings.basic`): consent the product again.

**`auth` with code `readonly_grant`.** The mailbox runs on a read-only grant
from `GMAIL_ACCOUNTS`, so writes refuse before any request. Consent `gmail`
for it.

**`auth` with code `invalid_grant`.** The refresh token expired or was
revoked. Consent the product again; if the app is in Testing, publish it to
stop the weekly expiry. A read-only grant from `GMAIL_ACCOUNTS` is renewed by
whatever made it. `deleted_client` means the OAuth client itself is gone from
the Cloud console.

**`api` with reason `SERVICE_DISABLED` or `accessNotConfigured`.** Enable the
API the remedy names in the Cloud project of the grant's OAuth client.

**`api` with status 403 on a file.** The account cannot open or change it:
check it is shared with that account. On the `editors` scopes alone, Drive
lets the client copy only files it created or opened, so
`create_deck_from_outline` cannot copy a template made by hand; run that
account on Drive's grant (`GOOGLE_EDITORS_DRIVE_ACCOUNT`).

**`api` with reason `outcome_unknown`.** A write failed after it may have
reached Google (a dropped connection, a 5xx), so it was not retried. Look
first (Sent or Drafts, `agenda`, `list_tasks`, `read_document`, `read_rows`,
`read_deck`), and repeat it only if it is not there.

**`api` with reason `stale_revision`.** The document changed since it was
read: read it again and redo the edit.

**`api` with status 404 from `list_history`.** Gmail expired that
`historyId`: search again with `search_threads`, and take a new anchor from
`health`.

**`quota`.** Google's per-minute quota held through every retry. Wait a
minute.

**`ambiguous`, with `candidates`.** Two Drive objects answer to that path.
Call again with `file_id`, one of the ids listed.

## How it works

### Accounts and grants

- **One grant per product and account**, with its own token cache and only
  that product's scopes: a Tasks grant cannot read mail, and a Calendar token
  never reaches Gmail.
- **Grants are found, not listed**: Calendar, Docs, Sheets and Slides, Tasks,
  contacts and Meet look for `<root>/<label>/credentials.json` on every call,
  so a new consent needs no restart.
- **Credentials are google.oauth2 JSON** (`refresh_token`, `client_id`,
  `client_secret`, `token_uri`, `scopes`, `account`). A stored access token is
  ignored: the server refreshes under a lock, so copies sharing a state
  directory refresh once.
- **A file declares scopes; Google grants them.** `health` reads each grant's
  real scopes, client and address from Google's tokeninfo, and fails a
  read-only Gmail grant that has grown a write scope.
- **Consent** uses PKCE (S256) and `prompt=consent` (a refresh token every
  time), with `login_hint` set to the account's address. A grant approved as
  another address, missing a required scope, or without a refresh token is
  refused with nothing written; an optional scope may be left out. Waiting
  consents and grants are written with mode 0600, a replaced grant is kept as
  `.bak`, and no token appears in a result.

### Gmail

- **A send is never retried blind**: only answers that prove Gmail did not act
  (429, a rate-limit 403, a 401 before the refresh) are retried. Everything a
  send depends on is read before it, so a sent mail is never reported as
  failed.
- **Replies look like Gmail's own**: the original's markup, an attribution in
  Gmail's words and the inline images, so Gmail still folds the quote behind
  "•••". A forward carries the images too.
- **Attachments in are byte-exact or refused**: a `path` inside the server's
  file roots (`MCP_FILE_ROOTS`), or `content_base64` with the source's
  `sha256` from a script, never typed by a model. Capping them at 30 MiB
  together lets a message slightly over Gmail's 25 MB get Gmail's own refusal,
  and uploads nothing far beyond it.
- **Attachments out are whole or absent.** Each part's length is checked
  against the size Gmail states, and a file never replaces a different one (a
  second `invoice.pdf` becomes `invoice (2).pdf`). Gmail's "download all
  attachments" zip silently leaves out parts keyed by message id, so
  `harvest_attachments` walks each message's MIME tree instead.
- **Reads.** Bodies are cut at 40,000 characters, and an HTML-only body is
  converted to text, saying so (`bodySource`). Gmail links use
  `?authuser=<address>`, because `/u/0/` depends on sign-in order.
- **Speed.** `search_threads` fetches thread metadata 16 at a time, only the
  headers a summary reads: Gmail's batch endpoint runs its sub-requests one
  after another, and measured slower.

### Calendar

**Busy time comes from events, not from freebusy.query**, which does not
accept the `calendar.events` scope and cannot tell a tentative block or an
all-day event's day. One rule (`calendar/domain/events.ts`) serves the
agenda's conflicts, `free_busy` and `find_time`:

| Event | Counts as |
|---|---|
| confirmed, or an invitation not answered yet | busy |
| marked tentative, or answered "maybe" | busy, flagged `tentative`; `find_time` books over it only with `tentative_is_free` |
| declined, "show as available", cancelled, or a working-location entry | free |
| all-day and left as busy | busy from midnight to midnight in its calendar's zone |
| busy but without a usable start or end | listed under `unknown`, never dropped |

- **One timeline.** Overlapping and touching blocks are joined, so a meeting
  in two accounts counts once. Other people's time (`attendees`) comes from
  freebusy.query, asked through every account; someone nobody can see is
  `unknown`, never free.
- **Time.** `2026-09-29` is a whole day, and `find_time` works one local day
  at a time, so 09:00 stays 09:00 across a DST change.
- **Writes.** A series id looks like an occurrence's, so a whole series
  takes `scope: "series"`. `meet: true` sends a request id made for that
  write, so a retry makes one Meet call. Focus time and out of office are
  checked against Google's rules (primary calendar, not all day, no guests,
  always busy), and decline nothing unless `auto_decline` says so: every
  decline is mail to an organiser.

### Drive

- **A path is a query, not an address.** A folder can hold two objects of one
  name: `resolve_path` reports both ids, and `move_file` refuses to create
  such a pair. A name may contain `/` (Meet writes folders like
  `Weekly sync - 2030/01/15`) and is then reachable only by id. Names created
  on macOS are often stored in NFD, so every lookup asks for both spellings.
- **A move is one metadata call.** In a synced local copy a Doc is a
  placeholder file, and moving it there makes the sync replace the Doc with
  the placeholder.
- **Bytes are checked both ways.** `upload_file` compares Drive's own checksum
  (or the bytes read back) with the source and takes back a difference (a
  replacement's new revision deleted, a new file trashed); `download_file`
  checks before writing anything. A converted upload has no bytes to compare,
  so the check is that Drive made the Google type asked for.
- **Rate limits.** Drive reports one as a 403 with a reason, read here as a
  rate limit, not a permission failure. Its quota is per minute, so a refusal
  waits at least 22 seconds (in Docs, Sheets and Slides too).

### Docs, Sheets and Slides

**The operations** (markdown sections, rows keyed by a header, decks from an
outline) do the arithmetic that goes wrong (Docs' UTF-16 indices, Sheets' grid
coordinates, Slides' object ids) in tested pure functions. **The full APIs**
(`get_*`, `find_in_document`, `batch_update_*`) reach the rest.

- **Every write is one request**: a Docs or Slides `batchUpdate` pinned to the
  revision it was computed from, or a Sheets `batchUpdate` that applies whole
  or not at all, never retried once it may have reached Google. A file can be
  given by its id or its URL.
- **Every batch is checked before it is sent** against the API's Discovery
  document, vendored in `src/<product>/domain/discovery.json` (refresh it with
  `npx tsx scripts/refresh-discovery.ts`): kinds, fields, types, enum values,
  read-only fields and field masks, with the nearest right name for a typo.
  Every problem comes back in one refusal, and nothing is sent.
  `editors_api_reference` reads the same document, so it describes exactly
  what the check accepts, where a JSON Schema of Sheets' requests alone would
  load hundreds of kilobytes into every session.
- **Docs.** `get_document` shows each element's `[startIndex, endIndex)`, with
  one U+FFFC per index a non-text element takes. A batch that names an index
  needs `expected_revision` (refused if the document moved on) or
  `target_revision` (Docs carries the positions over later edits).
  `edit_document_section` refuses a section holding what markdown cannot carry
  (an image, a footnote: `read_document` counts them as `notShown`) unless
  `drop_hidden` is true. A `regex` in `find_in_document` runs in a fresh
  JavaScript context under a 1.5 second limit, so a backtracking pattern
  cannot stall the process.
- **Sheets.** `read_rows` reads dates in the sheet's time, and a currency
  cell as `{value, amount, formatted}`, `amount` its exact decimal string.
  Writes take `"=..."` as a formula, `"YYYY-MM-DD"` as a date and
  `{"amount": "12.50"}` as a number, refused when a double cannot hold it
  exactly.
- **Local images.** Docs and Slides insert an image only from a URL they
  fetch, so each PNG, JPEG or GIF in `images` (name to file path) goes to the
  account's Drive, shared by link for the batch, then unshared and trashed
  whatever the outcome; the result says what became of each copy.
- **Developer Preview** requests (comments, accepting suggestions) pass the
  check; Google refuses them unless the Cloud project is in its preview
  program.

### Tasks, contacts and Meet

- **Tasks.** A due date is a date: Google Tasks keeps midnight UTC and drops
  any time. `include_completed` also shows tasks completed in Google's own
  apps, which the API otherwise hides.
- **Contacts.** Results merge by address: contacts first, then the directory,
  then the addresses Gmail saved. A source an account cannot read is listed
  under `unavailable`, never read as nobody.
- **Meet.** `list_meetings` finds a calendar event's meeting by its Meet code
  (read with the account's Calendar grant) and, for one occurrence, the
  sitting that started within an hour of it. Transcripts and notes are Google
  Docs, so `read_document` opens them; `get_transcript` reads one as
  `[0:12:05] Ana Popescu: ...`, naming each speaker from the participants.

The smoke scripts in `scripts/` drive the built server (or a running one, with
`MCP_URL`) against real accounts; those that write take `SMOKE_ACCOUNT` and
clean up after themselves.

## Limitations

- **No permanent delete of mail or files**, only Gmail's and Drive's trash. A
  draft, label or filter deleted here is gone, though.
- **Filters** only set labels (no forwarding), and Gmail has no filter update:
  create the new one, delete the old.
- **Drive holds one grant**, so the Drive tools reach one account's Drive;
  other accounts reach their files through the Docs, Sheets, Slides, comment
  and sharing tools.
- **Consent needs a browser**, and the redirect address copied back by hand:
  nothing listens on the loopback port.
- **`read_doc` reads a Sheet as CSV of its first tab** (Drive's export has no
  tab selector); `read_rows` reads any tab.
- **Docs' markdown tools**: a bullet under a number comes out as a sub-number
  (one preset per list), a horizontal rule is dropped, and an image becomes a
  link.
- **What the APIs cannot do at all**: insert a horizontal rule or set one list
  level's glyph in Docs, create a suggestion, anchor an API comment to text in
  a Doc, add animations in Slides. Apps Script reaches some of these, with its
  own project and grant.
- **Images** reach Docs and Slides through a URL Google fetches, so a local
  file is shared by link on Drive for the seconds a batch takes. Sheets' API
  inserts no images (an `=IMAGE()` formula needs a link that stays public).
- **Sheets has no conditional write**: rows someone inserts between a plan's
  read and its write shift under it, and the API has no revision pin.
- **The schema check** knows the API revision this server was built with: a
  field Google added later is refused, naming that revision, until the
  Discovery documents are refreshed.
- **Tasks** have no delete here, a repeating task cannot change lists (Google
  refuses it), and a due date has no time of day.
- **The directory** answers only for a Workspace account; a personal account
  reports it under `unavailable`.
- **Meet** keeps records for 30 days, shows only meetings the account took
  part in or organised, and has transcripts or smart notes only where the
  meeting turned them on (a Workspace feature).
- **Sizes**: a message's attachments up to 30 MiB together, a Drive upload or
  download up to 100 MiB, `free_busy` and `find_time` over at most 62 days.

## Other servers for Google Workspace

Searched 2026-10-15. Google runs its own servers, and two community servers
are maintained and broad:

- **Google's remote MCP servers** for Gmail, Drive, Docs, Sheets, Slides,
  Calendar, Chat, People and Classroom: a developer preview a Google Cloud
  project must enroll in, over Streamable HTTP, with one OAuth connection per
  account. They do less: the Gmail server cannot send, download an attachment
  or sync incrementally; the Drive server cannot move, rename or trash a file;
  Docs, Sheets and Slides take a raw, unchecked `batchUpdate`.
  [docs/google-gaps.md](docs/google-gaps.md) compares them tool by tool.
- **`googleworkspace/cli`**, Google's command line, has dropped its MCP mode;
  its Gemini CLI extension **`gemini-cli-extensions/workspace`** is a stdio
  server for one signed-in account.
- **`workspace-mcp`** on PyPI: stdio, or Streamable HTTP with OAuth 2.1 for
  many users; more than 120 tools over twelve products, including Forms,
  Tasks, Chat, Contacts and Apps Script; each call acts for one account.
- **`@aaronsb/google-workspace-mcp`** on npm: stdio, an OAuth token per
  account on local disk, so several accounts sit side by side; Gmail,
  Calendar, Drive, Docs, Sheets, Tasks, Meet and Contacts, not Slides.

The community servers reach more products. This one exists for what none of
them offers: a mail search, the agenda (with conflicts between accounts) and
free/busy read every account in one call, and a write has no default account;
Gmail syncs from a `historyId`; Drive has a change cursor and revisions; and
Docs, Sheets and Slides come both as operations and as each API's full
`batchUpdate`, checked against the API's schema before sending, a Docs edit
pinned to the revision it was computed from.

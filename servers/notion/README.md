# <img src="icons/icon.svg" width="36" height="36" alt="Notion icon"> Notion MCP server

Search, read and write your [Notion](https://www.notion.so) workspaces from
your AI assistant, several through one server: pages as Markdown, databases
queried and counted by column, saved views, people, comments and files. It
creates pages, rows, columns and databases, edits properties and bodies,
comments, uploads files, and moves pages to Notion's trash (kept 30 days;
`restore_page` brings them back). No tool is `money`.

**You need** a Notion integration per workspace, its token in a file of its
own, and your top-level pages shared with it: an integration sees only what
you share. Uploads take files up to 20 MiB (5 MiB on Notion's Free plan).

## What you can ask

- "Find the Q3 roadmap page in my work workspace and summarise it."
- "How many rows of the Tasks database are in each Status?"
- "Show me my Due this week view."
- "Add 'Thinking in Systems' to the Reading List with status To read and the
  tag Books."
- "In the Onboarding page, replace 'Slack' with 'Mattermost' everywhere."
- "Download the PDFs attached to the Client SRL row of the Contracts database."

## Install

<!-- install:begin -->
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect/mcp/install?name=notion&inputs=%5B%7B%22type%22%3A%22promptString%22%2C%22id%22%3A%22notion_tokens_dir%22%2C%22description%22%3A%22A%20folder%20holding%20one%20file%20per%20workspace%2C%20notion-%3Clabel%3E%2C%20each%20with%20that%20workspace's%20integration%20token%20or%20personal%20access%20token.%22%7D%5D&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40foreverworks%2Fmcp-notion%22%5D%2C%22env%22%3A%7B%22NOTION_TOKENS_DIR%22%3A%22%24%7Binput%3Anotion_tokens_dir%7D%22%7D%7D) [![Install in Cursor](https://img.shields.io/badge/Cursor-Install_Server-000000?style=flat-square&logo=cursor&logoColor=white)](https://cursor.com/install-mcp?name=notion&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBmb3JldmVyd29ya3MvbWNwLW5vdGlvbiJdLCJlbnYiOnsiTk9USU9OX1RPS0VOU19ESVIiOiIke2VudjpOT1RJT05fVE9LRU5TX0RJUn0ifX0%3D) [![Download for Claude Desktop](https://img.shields.io/badge/Claude_Desktop-Download_Bundle-D97757?style=flat-square&logo=claude&logoColor=white)](https://github.com/foreverworks/mcps/releases/latest/download/mcp-notion.mcpb)

With Claude Code:

```bash
claude mcp add notion -e NOTION_TOKENS_DIR="<path to Notion tokens folder>" -- npx -y @foreverworks/mcp-notion
```

Claude Desktop (Settings, Developer, Edit Config) and most other clients read the same command as JSON:

```json
{
  "mcpServers": {
    "notion": {
      "command": "npx",
      "args": ["-y", "@foreverworks/mcp-notion"],
      "env": {
        "NOTION_TOKENS_DIR": "<path to Notion tokens folder>"
      }
    }
  }
}
```

Each runs the published package on Node 22.19 or newer. VS Code and the Claude Desktop bundle ask for `NOTION_TOKENS_DIR` as they add the server. Cursor reads it from your environment instead (`${env:NOTION_TOKENS_DIR}`), so set it before you start Cursor. [Configuration](#configuration) says what it holds.

### From a clone

```bash
git clone https://github.com/foreverworks/mcps.git && cd mcps
npm ci && npm run build
claude mcp add notion -e NOTION_TOKENS_DIR="<path to Notion tokens folder>" -- node "$PWD/servers/notion/dist/index.js"
```

In a JSON configuration, the command is `node` and its one argument the full path of `servers/notion/dist/index.js`. To share one running copy between several clients over HTTP, see [docs/deploying.md](../../docs/deploying.md).
<!-- install:end -->
Over HTTP, a deployment that limits its hosts sets
`MCP_EGRESS_ALLOW=api.notion.com,prod-files-secure.s3.us-west-2.amazonaws.com,s3.us-west-2.amazonaws.com`:
Notion's API and the hosts its files are served from.

## Configuration

| Variable | Required | Meaning |
|---|---|---|
| `NOTION_TOKENS_DIR` | yes, or `CREDENTIALS_DIRECTORY` | A folder holding one file per workspace, `notion-<label>`, each holding that workspace's token and nothing else. |
| `CREDENTIALS_DIRECTORY` | | Read when `NOTION_TOKENS_DIR` is unset: under systemd, `LoadCredential=notion-<label>:<path>` puts the same files there, readable by the unit alone. |
| `NOTION_OUTBOX_DIR` | for `download_files` | The folder downloaded files are saved in, which the server writes and you read. Unset, `download_files` answers a `config` error naming it; every other tool works. |

Each file is a workspace: `notion-personal` and `notion-work` are labelled
`personal` and `work`, and the server names the labels it found at start. A
label is lower-case letters, digits and hyphens; an empty file is skipped.
There is no default folder, so a test or a hand-run copy cannot reach a
workspace by accident. The files are re-read at most once a minute, and at
once after a refused token, so a new token needs no restart. The variables
every server shares (transport, limits, `MCP_FILE_ROOTS` for uploads) are in
[docs/configuration.md](../../docs/configuration.md).

### Getting a token

For each workspace:

1. Open <https://www.notion.so/profile/integrations>, signed in to that
   workspace, and create a new internal integration.
2. Turn on the capabilities the assistant needs: read, update and insert
   content for pages and databases, and the comment capabilities for
   comments. People's emails appear only if it may read user information with
   email addresses.
3. Copy its Internal Integration Secret straight into `notion-<label>` in your
   tokens folder, readable by you alone (mode 0600). Do not paste it into a
   chat.
4. **Share your pages with the integration**, which starts out seeing
   nothing. In Notion, open each top-level page the assistant should reach,
   then the ••• menu, Connections, and add the integration. Pages under it
   inherit the access; a new top-level page must be shared the same way.

A personal access token works in the same file instead (made at
<https://www.notion.so/developers/tokens>, signed in to the workspace, with
the Notion API capability). It acts as you: it sees every page you see, with
nothing to share, and can create private top-level pages, which an
integration cannot. It expires within a year.

## First run

Ask your assistant to run Notion's `health` check. Per workspace, it says
whether the token is accepted, the workspace and integration names, and
whether the integration sees any page yet; if not, do step 4 above.

From a shell, `node dist/index.js --health` prints one `NOTION:` line per
workspace and exits 0 when all is well, 1 when a person has to act (a refused
token, a missing capability), and 2 for a warning (an integration that sees
nothing yet, or Notion unwell), which suits a timer.

## Tools

**read** changes nothing; **write** changes something in a workspace. A tool
that takes an id also takes a Notion URL, and finds the workspace itself.

### Workspaces and search

| Tool | Access | What it does |
|---|---|---|
| `list_accounts` | read | The workspaces with a token file, by label. No request to Notion. |
| `health` | read | Per workspace: the token accepted, the workspace and integration names, whether it sees any page yet. |
| `list_users` | read | The people (and bots) of every workspace: id, name, and email when the token may read it; narrowed by a word. |
| `search` | read | Pages and databases by title, in every workspace at once, each hit tagged with its workspace. |

### Pages

| Tool | Access | What it does |
|---|---|---|
| `read_page` | read | A page's properties as plain values and its body as Notion's Markdown. |
| `read_blocks` | read | The blocks directly inside a page or a block: id, type, plain text. A meeting-notes block names the blocks holding its summary, notes and transcript. |
| `create_page` | write | A row in a database, checked against its columns (or started from one of its templates), or a child page; either with a Markdown body. |
| `update_page` | write | A page's properties and icon. |
| `append_content` | write | Markdown at the end, the start, or after a passage. |
| `edit_content` | write | Find and replace in a page's Markdown. |
| `replace_content` | write | A page's whole body; an empty one only with `clear`. Answers with the page's title and its block count before and after. |
| `move_page` | write | Under another page or into a database, within one workspace. |
| `trash_page` / `restore_page` | write | Into Notion's trash (kept 30 days) and back. A database template only with `allow_template`. |

### Databases

| Tool | Access | What it does |
|---|---|---|
| `describe_database` | read | A database's tables and columns: types, options, status groups, relation targets, formulas. |
| `query_database` | read | Rows, filtered by `where` (typed from the schema) or Notion's own filter, sorted, up to 1,000 in one call. |
| `count_rows` | read | How many rows match, and per value of a column ("tasks per status"), without sending the rows. |
| `list_views` | read | A database's saved views: id, name, type, and the filter and sorts saved in each, columns by name. |
| `query_view` | read | The rows a saved view shows, in its order, filtered exactly as Notion applies it, with the view's total. |
| `list_database_templates` | read | A database's page templates: their page ids, names and which is the default. |
| `add_column` | write | A column on a database: a free name, a type and its settings (options, number format, formula, relation), checked against the table first. |
| `add_options` | write | Options on a select, multi-select or status column; the ones there are kept by id and the column is read back after. |
| `create_database` | write | A database under a page, with its title column and other columns, each checked against the others first. |

### Comments and files

| Tool | Access | What it does |
|---|---|---|
| `get_comments` | read | A page's open comments. |
| `add_comment` | write | A comment on a page, or a reply in a discussion. |
| `upload_file` | write | A file by path, uploaded to a row's files column or into a block at the end of a page's body; answers its size and SHA-256. |
| `download_files` | read | A page's Notion-hosted files (its files columns and the file blocks of its body) saved to the outbox, each with its SHA-256. |

`test/tools.snapshot.json` pins what a client lists; a diff there is a
breaking change.

## Troubleshooting

**`health` says "the integration sees no page yet", or a call answers
`not_shared`.** Notion answers the same 404 for an id that does not exist and
a page not shared with the integration. Check the id, then share the page
(step 4 of [Getting a token](#getting-a-token)); sharing a top-level page
shares everything under it.

**`auth`.** The token was refused: revoked, or a personal access token past
its expiry. Put a new one in the `notion-<label>` file; the next call reads
it.

**`forbidden`.** The integration lacks a capability for this call. Turn it on
at <https://www.notion.so/profile/integrations> (step 2 of
[Getting a token](#getting-a-token)).

**`config`.** No token files where `NOTION_TOKENS_DIR` points, an unreadable
one, or one holding more than one token. For `download_files`, set
`NOTION_OUTBOX_DIR`.

**`input` from `create_page` with no parent.** Notion refuses a top-level page
from an integration; give a parent page, or use a personal access token. Any
other `input` names what to fix, and nothing changed.

**`outcome_unknown`.** An append, a find-and-replace, a new page or a comment
lost its answer; it is never resent blind. Read the page (or `search` for a
new one) before writing again: the change may be there.

**`conflict`**: someone edited the same object at that moment; read it again,
then retry. **`rate_limited`**: Notion still throttles after the retries (180
requests a minute on the Free plan); wait a minute. **`api`**: Notion was
unreachable or failed; retry later. With `reason: "drift"` its answer changed
shape: please report it.

## How it works

### An id finds its own workspace

An id lives in exactly one workspace, so `src/app/locate.ts` asks each until
one answers; a 404 from all is `not_shared`. Every id found, or revealed by a
search or query, is remembered while the process runs, so misses are paid
once. A URL may be on `notion.so`, `notion.site` or `app.notion.com`; `?p=`
names a page open over a database.

A database is named by its own id or its data source's (search gives both).
Since API 2025-09-03 a database holds data sources, nearly always one; with
several, `source` names the table, and omitting it is refused with their
names.

### The values an agent sees

| Notion type | Out | In |
|---|---|---|
| title, rich_text | string | string, split into 2000-character runs (Notion's limit), never inside a character |
| number | the JSON number Notion sent | a finite number |
| select, status | option name | an option that exists, matched ignoring case; a new select option only with `allow_new_options`; a new status never (the API cannot make one) |
| multi_select | names | names, same rule |
| date | `{start, end?, timeZone?}` | `YYYY-MM-DD`, an ISO date-time, or `{start, end, time_zone}` |
| checkbox | boolean | boolean |
| url, email, phone_number | string | string; empty clears it |
| relation | page ids, all of them | page ids or URLs, 100 at most |
| files | `[{name, url, expiresAt?}]` | external URLs; a file of your own goes in with `upload_file` |
| people, created_by, last_edited_by | `{id, name}`, the name from the workspace's users when the page gave only the id | refused |
| formula, rollup, created/edited time, unique_id (`PREFIX-12`) | the computed value | refused: Notion computes it |
| button | left out: it has no value | refused |

Empty values are left out of a page or row (`describe_database` lists every
column). A page object lists at most 25 pages of a relation; `read_page` reads
the rest from the property endpoint (up to 1,000), and a query row lists such
a column under `truncated`. The server does no arithmetic on numbers.

### `where`

Notion's filter keys a condition by the column's type, which agents get wrong.
`where` names the column, an op and a value, and takes the type from the
schema:

```json
{"where": [{"property": "Status", "op": "equals", "value": ["In progress", "Blocked"]},
           {"property": "Due", "op": "next_week"}],
 "match": "all"}
```

An op the type lacks, or an option that does not exist, is refused with what
exists, before any request. A person column takes a name, an email, a user id
or `"me"`. A name is matched against the workspace's users, exactly first,
then as part of one person's name; one that two people share or nobody has is
refused with who fits. `notion_filter` takes Notion's own filter object for
what `where` cannot say, ANDed with it.

### Templates

Search returns templates as ordinary pages, and a template shapes every
future row, so `list_database_templates` names them and `trash_page` refuses
one without `allow_template`. `create_page` with `template` checks it against
that database's templates. Notion fills the row right after making it, so
`read_page` a moment later shows the result. Properties given beside a
template are kept; a Markdown body is refused, since it would race the
template's.

### Changing a database's columns

`add_column`, `add_options` and `create_database` check the request against
the table as it is, before sending: a name already taken, an option already
there, a setting the type lacks, a formula without its expression, a relation
without its target, more than Notion's 100 options. Notion documents a schema
update's option list as the options to set, so `add_options` sends back every
current option by id, then the new ones, and reads the column back: an option
that went missing fails the call.

### Files

`upload_file` takes a file by path inside `MCP_FILE_ROOTS`, or as base64 with
its SHA-256 from a script, never as text a model types. In a row's files
column it joins the files there; otherwise it becomes a block at the end of
the body (an image, a PDF, a video or a sound, by its type). Notion's API
replaces a files column whole and cannot write back a file it hosts, so a
column holding Notion-hosted files needs `replace: true`, which lets them go;
external links are always kept.

`download_files` saves a page's Notion-hosted files to `NOTION_OUTBOX_DIR`:
its files columns and the file, image, PDF, video and audio blocks of its
body, nested ones included (the first 1,000 blocks). Notion's links are signed
URLs valid for an hour, fetched over https without the workspace's token or
following redirects. External links are listed, never fetched, since they can
point anywhere.

### Saved views

`query_view` runs a view as Notion does, quick filters and `me` included.
Notion answers with page ids only and keeps the result about 15 minutes, so
`query_view` reads each row itself (25 by default, up to 100 a call), and
`nextCursor` reads on in the same result. Once that result expires, the tool
says to start again; a row trashed or unshared meanwhile is listed under
`unreadable`.

### People and meeting notes

On an AI meeting-notes page, `read_page` with `include_transcript` answers the
summary, notes and transcript as one Markdown text. `read_blocks` names the
blocks behind them, and on `transcriptBlockId` reads the transcript line by
line, each with the block id an AI summary's citations link to.

### Replacing a whole body

`replace_content` cannot be undone through the API, and a model slips on both
its arguments: a page id from the wrong row, or a `markdown` that came out
empty. So an empty body needs `clear: true`, and the answer gives the page's
title with `blocksBefore` and `blocksAfter`, so a wrong page or a body that
shrank to almost nothing shows at once.

### The network

- **Version** `2026-03-11` in every request: the one with the Markdown
  endpoints and `in_trash`.
- **Pacing**: an integration gets 180 requests in a fixed minute on the Free
  plan. A token bucket per workspace (30 at once, then 2.5 a second), shared
  by every session the process serves, keeps any minute at 180 or under; the
  workspace-wide limit is left to the 429 backoff and `Retry-After`.
- **What is resent**: a 429 or a 409 `conflict_error` proves nothing happened,
  so every request repeats. A 5xx or a lost connection proves nothing either
  way: reads repeat, and so does whatever lands the same twice (a property
  update, a move, a whole-body replace); the rest fail as `outcome_unknown`
  (`notionApi.ts` marks which is which). A 401 is retried once, after the
  token file is read again.
- **Caches**: a data source's columns for a minute, a workspace's users for
  five.

### Why REST and not the hosted MCP

Notion scopes every token to one workspace, the hosted MCP's included, so no
single sign-in reaches several. The hosted MCP's data-source query depends on
the plan, it relays tools this repository does not model, and its refresh
token can die and need a person. A personal access token also acts as the
user, over REST, for a renewal once a year.

`scripts/smoke.ts` drives the built server read-only, or writes and trashes
one page with `--write`.

## Limitations

- **Columns are added, never renamed or deleted**; rollups, unique ids and
  buttons are made in Notion's app. **People columns cannot be written.**
- **A meeting transcript does not say who spoke or when.** The API gives it as
  plain `paragraph` blocks of text (API 2026-03-11, `@notionhq/client`
  5.27.0, whose types have no speaker field), though Notion's app shows
  speaker turns and timestamps.
- **A page moves only within its workspace**; Notion cannot move one between
  workspaces.
- **`query_database` answers at most 1,000 rows a call** (then `nextCursor`),
  and `count_rows` reads at most Notion's 10,000 per query.
- **Uploads are single-part**, at most 20 MiB a file; downloads stop at 50 MiB.
- **Notion-hosted files in a files column cannot be written back**, so adding
  to such a column needs `replace: true`, or the file goes into the body.

## Other servers for Notion

Searched 2026-10-15; Notion's MCP page re-read 2026-10-18.

- **Notion's hosted server** (`mcp.notion.com`, Streamable HTTP) needs an
  OAuth sign-in in a browser and reaches one workspace per connection; only
  Enterprise workspaces can sign in without a browser, through their identity
  provider. Its tool set is the widest (views, file uploads, SQL over data
  sources, Custom Agent sessions). AI search and unlimited SQL over data
  sources need a Business or Enterprise plan with Notion AI; querying a saved
  view works on every plan.
- **`@notionhq/notion-mcp-server`**, Notion's open-source server (stdio or
  HTTP, one token in an environment variable), is no longer actively
  maintained.
- **`notion-mcp-server`** on npm, the strongest community server: stdio or
  HTTP on one token, three tools over 47 operations, typed filters and writes
  checked against the database's schema, templates, views, file uploads and
  batched writes.
- **`@suekou/mcp-notion-server`** (stdio, one token) also queries and creates
  rows from the schema.
- **`notion-multi-workspace`**, the only multi-workspace server found, is
  archived.

This one exists for several workspaces behind one headless server, each with
its own token file: search covers them all at once, and any page or database
id or URL finds its own workspace. It also counts matching rows, per value of
a column, without sending them, and its whole-body replace refuses an empty
body unless asked and answers with the block counts before and after.

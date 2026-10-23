# <img src="icons/icon.svg" width="36" height="36" alt="TypeSafe icon"> TypeSafe MCP server

Ask [TypeSafe](https://typesafe.ai)'s Jev for typed, calibrated judgments from
your AI assistant: how likely a yes/no statement is to hold, which of your
options fits, or where something sits on your own scale. Put the same
questions to one state or to up to 1000 rows at once, so the assistant can
triage postings, transactions or emails without reading each one. Every tool
is a read: nothing changes anywhere, and no tool is `money`.

**You need** a TypeSafe account and an API key from its console. Calls are
billed by input tokens, a fraction of a cent each, and Jev answers in about
half a second.

## What you can ask

- "Go through the 300 postings in postings.jsonl and list the remote senior
  roles, with how sure Jev is of each."
- "Is this support email urgent, and which team should take it: billing,
  technical or sales?"
- "Sort last month's 600 card transactions into groceries, transport, software
  or other, and count each."
- "Rate these 40 reviews on how likely the customer is to leave, and show me
  the ten most at risk."
- "Which of these passages answer 'how do I reset my password'? Flag the ones
  Jev is unsure about for me to read."

## Install

<!-- install:begin -->
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect/mcp/install?name=typesafe&inputs=%5B%7B%22type%22%3A%22promptString%22%2C%22id%22%3A%22typesafe_api_key_file%22%2C%22description%22%3A%22Path%20of%20a%20file%20holding%20your%20TypeSafe%20API%20key.%22%7D%5D&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40foreverworks%2Fmcp-typesafe%22%5D%2C%22env%22%3A%7B%22TYPESAFE_API_KEY_FILE%22%3A%22%24%7Binput%3Atypesafe_api_key_file%7D%22%7D%7D) [![Install in Cursor](https://img.shields.io/badge/Cursor-Install_Server-000000?style=flat-square&logo=cursor&logoColor=white)](https://cursor.com/install-mcp?name=typesafe&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBmb3JldmVyd29ya3MvbWNwLXR5cGVzYWZlIl0sImVudiI6eyJUWVBFU0FGRV9BUElfS0VZX0ZJTEUiOiIke2VudjpUWVBFU0FGRV9BUElfS0VZX0ZJTEV9In19) [![Download for Claude Desktop](https://img.shields.io/badge/Claude_Desktop-Download_Bundle-D97757?style=flat-square&logo=claude&logoColor=white)](https://github.com/foreverworks/mcps/releases/latest/download/mcp-typesafe.mcpb)

> [!NOTE]
> `@foreverworks/mcp-typesafe` is not on npm yet: the buttons and the `npx` commands below work once it is published. Until then, [run it from a clone](#from-a-clone).

With Claude Code:

```bash
claude mcp add typesafe -e TYPESAFE_API_KEY_FILE="<path to API key file>" -- npx -y @foreverworks/mcp-typesafe
```

Claude Desktop (Settings, Developer, Edit Config) and most other clients read the same command as JSON:

```json
{
  "mcpServers": {
    "typesafe": {
      "command": "npx",
      "args": ["-y", "@foreverworks/mcp-typesafe"],
      "env": {
        "TYPESAFE_API_KEY_FILE": "<path to API key file>"
      }
    }
  }
}
```

Each runs the published package on Node 22.19 or newer. VS Code and the Claude Desktop bundle ask for `TYPESAFE_API_KEY_FILE` as they add the server. Cursor reads it from your environment instead (`${env:TYPESAFE_API_KEY_FILE}`), so set it before you start Cursor. [Configuration](#configuration) says what it holds.

### From a clone

```bash
git clone https://github.com/foreverworks/mcps.git && cd mcps
npm ci && npm run build
claude mcp add typesafe -e TYPESAFE_API_KEY_FILE="<path to API key file>" -- node "$PWD/servers/typesafe/dist/index.js"
```

In a JSON configuration, the command is `node` and its one argument the full path of `servers/typesafe/dist/index.js`. To share one running copy between several clients over HTTP, see [docs/deploying.md](../../docs/deploying.md).
<!-- install:end -->
## Configuration

| Variable | Required | Meaning |
|---|---|---|
| `TYPESAFE_API_KEY_FILE` | yes | File holding the API key. For a local run, `TYPESAFE_API_KEY` may hold the key itself instead. |
| `TYPESAFE_MODEL` | no | The model a call uses when it names none. Default `jev-latest`, which tracks the newest Jev. |
| `TYPESAFE_BASE_URL` | no | Default `https://api.typesafe.ai`. |
| `TYPESAFE_OUTBOX_DIR` | no | Where `ask_batch` with `save` writes its JSONL. Default `outbox/` in the state folder. Files are written 0640, so a deployment can share the folder with the user's group. |
| `TYPESAFE_STATE_DIR` | no | The state folder; the default is in [docs/configuration.md](../../docs/configuration.md). |

Without a key the server still starts and lists its tools, and each call
answers a `config` error naming the variable. `ask_batch` reads an
`items_file` from `MCP_FILE_ROOTS`; that and the other variables every server
shares are in [docs/configuration.md](../../docs/configuration.md).

### Getting an API key

1. Sign in at <https://console.typesafe.ai> and open Keys.
2. Create a key and write it to a file only you (or the server's user) can
   read.
3. Point `TYPESAFE_API_KEY_FILE` at that file.

Give each deployment its own key, so you can revoke one alone and tell them
apart on the console's usage page. Only a key from TypeSafe's own console
works; a reseller's key works only through the reseller's gateway.

## First run

Ask your assistant to run TypeSafe's `health` check. It answers with the API
it talks to, the default model, and the models your key reaches. A missing key
shows up here as `config`, a refused one as `auth`, before any batch starts.

## Tools

**read** changes nothing; every tool here is a read (billing by input tokens is
metering, not a payment).

| Tool | Access | What it does |
|---|---|---|
| `health` | read | Whether the key is present and accepted, and which models it reaches. |
| `ask` | read | Every question about one state in one round trip; the answers as TypeSafe returns them, less a Score's `legend`. |
| `ask_batch` | read | The same questions over up to 1000 states, typed in or from a file, 8 in flight by default: a summary per question and compact rows, with `save` the full rows as JSONL in the outbox. Optional act, review or abstain verdicts from your thresholds, and `where`, `top` and `counts` to list only the rows that matter. |

A question is a `noul` (the probability that a yes/no statement holds), a
`choice` (one of 2 to 255 options, with a probability for each) or a `score`
(the state placed on 2 to 10 levels you order from lowest to highest).

## Troubleshooting

**`config`.** No key: set `TYPESAFE_API_KEY_FILE` to a file holding a key from
console.typesafe.ai/keys, or `TYPESAFE_API_KEY` for a local run.

**`auth`.** TypeSafe refused the key. Check it still exists at
console.typesafe.ai/keys, and replace the file if it was revoked.

**`input`.** The question cannot be answered as asked; the message names the
field (a choice needs at least two options, a score 2 to 10 levels). Above 20
rows, every row needs an `id`.

**`rate_limited`.** TypeSafe is still throttling or overloaded after the
server's own retries. Wait a minute, or send the batch with a lower
`concurrency`.

**`api`.** Any other refusal, a 5xx that outlived its retries, or no connection
(status 0). Retry once; if it persists, run `health` and read the server's log.

**`drift`.** TypeSafe answered in a shape this server does not know (its SDK's
types may have moved on). Please report it.

## How it works

**The network.** An evaluation has no side effect, so every request
(`POST /v1/systemone`, `GET /v1/models`) may repeat: a 5xx or a dropped
connection is tried again, and a 429 or 529 ("overloaded") waits as a rate
limit, as TypeSafe's SDK does. A call times out after a minute. Every answer
is checked against the SDK's types (`@typesafe-ai/sdk`, types only, in
`src/domain/schema.ts`).

**Batches.** A batch goes on past a failed row and reports it, but stops at a
failure that would fail every row (no key, a refused key), so a thousand rows
do not each earn a 401. Answers join their rows by id, required above 20 rows:
a position is only safe to join on while you can check the rows by eye.

**Rows from a file.** Instead of typing rows into `items`, pass `items_file`:
JSONL with one `{"id", "state"}` object per line, or a JSON array of them, by
path inside `MCP_FILE_ROOTS` (or as `content_base64` with its `sha256`, from a
script). The rows never pass through a model, so they cannot change on the
way; a malformed row fails the call with its line number before anything is
sent. The reply names the file's `sha256` and size.

**Verdicts.** With `thresholds` for a question, each row's answer gets `act`
(sure enough to act on), `review` (a person should look) or `abstain` (do not
use it), from the answer's certainty: for a noul `|p - 0.5| x 2` (p 0.95 and
p 0.05 are both 0.9), for a choice or a score the confidence TypeSafe returns.
The certainty is rounded down to three places, the number the row shows, and
must be strictly above `act_above` to act and above `review_above` to be
reviewed. Once thresholds are tuned, pin `model` to a versioned Jev:
`jev-latest` can move under them.

**Choosing rows.** `where` lists only the answered rows meeting every
condition you give per question: `true` or `false` for a noul (a yes is
p >= 0.7, a no p <= 0.3, as the summary counts them), labels for a choice,
`min` and `max` on the value a row shows, and `verdict`. `top` keeps the k
rows with the highest p or score for one question, and `counts` tallies the
answers of the rows `where` kept; the summary still covers every row. Every
condition is checked before a request is sent, so a label that is not an
option fails the call, not a thousand rows.

`npx tsx scripts/smoke.ts` drives the built server against the real API, for
a few thousand input tokens: `health`, one `ask` per question type, a
five-row batch saved to the outbox, and one input failure that never reaches
TypeSafe.

## Limitations

- **Judgments only.** Jev writes no text and does no multi-step reasoning.
  Keep rules, lookups and arithmetic in code, and threshold the probabilities
  (`thresholds` does it per question).
- **`where` joins conditions with "and" only.** For "or", read the rows from a
  saved JSONL, or ask a question that states the alternatives.
- **At most 1000 rows a call**; split a larger set.
- **A batch's reply lists every row** unless `list` says otherwise. For a
  large batch, pass `list: "none"` or `"failed"` with `save`, and read the
  JSONL.

## Other servers for TypeSafe

Searched 2026-10-15. TypeSafe publishes none: its GitHub organisation has the
SDKs, agent skills and an n8n node. Two community servers are on npm:

- **`typesafe-mcp`**: stdio under Bun, the key in an environment variable,
  batches over files matched by a glob, with an act, review or abstain verdict
  per answer.
- **`@y0usaf/typesafe-mcp`**: stdio, one `evaluate` tool.

This one exists for what neither offers: it also runs over HTTP as a service
of its own, with its key in a file the calling client never reads; it saves a
batch's full answers as JSONL in an outbox and names the file's SHA-256; and
it follows the conventions every server in this repository shares. Its
verdicts and its `where`, `top` and `counts` follow `typesafe-mcp`'s, with
thresholds set per question rather than per call.

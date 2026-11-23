# Roadmap

What may come next in these servers and why it has not, what we have chosen
not to build and why, and how to ask for something. It rests on a comparison
with the strongest published MCP servers in each domain, made in October 2026
from their own code and documentation ([the list](#servers-we-compared-with)).

Nothing here is scheduled. A feature is built when someone needs it, so the way
to move an item up is to say that you do ([how to ask](#how-to-ask-for-something)).

## What may come next

Two ideas are held back by a design question, not only by demand.

- **enable-banking: a local cache of transactions**, so a repeated question
  spends none of the few reads a day that PSD2 allows without the account
  holder present. A cache is a second copy of bank data on disk, and a
  deployment that already keeps a ledger may prefer to read that. Others have
  one: banking-mcp ([schema.sql](https://github.com/matcha-ai-test/banking-mcp/blob/f77a5a7/schema.sql)).
- **bitwarden: `run_with_secret`.** It would run a command from an operator's
  allowlist with a password, a field or a TOTP code in its environment, and
  return the output with the secret scrubbed, so the model never sees the
  secret. The allowlist is all of its security and has no design yet: a command
  that echoes its environment defeats scrubbing, so the output must be scrubbed
  by value, and the result must say so. Others have it: Bitwarden's Agent
  Access, `aac run` ([README](https://github.com/bitwarden/agent-access/blob/main/README.md));
  1Password's server ([docs](https://www.1password.dev/environments/mcp-server.md)).

Everything below is missing only because nobody has asked for it yet.

| Server | What it would do | Who has it |
|---|---|---|
| typesafe | CSV rows and Markdown sections as `ask_batch` records, and files matched by a glob inside the file roots. Today it reads one JSONL or JSON file | `typesafe-mcp` ([README](https://github.com/MarkChu-git/typesafe-mcp/blob/main/README.md)) |
| devices | Notice that a leased device died, restart it on the same lease, and tell the holder through the lease's state | Callstack's simlock ([README](https://github.com/callstackincubator/simlock/blob/HEAD/README.md)) |
| google | An image handed to the model as image content. `get_thumbnails` returns URLs today | aaronsb's [gmail.yaml](https://github.com/aaronsb/google-workspace-mcp/blob/9c9f803/src/factory/manifest/gmail.yaml); the Gemini extension's `slides.getImages` in [index.ts](https://github.com/gemini-cli-extensions/workspace/blob/089927e/workspace-server/src/index.ts) |
| notion | Block update and delete. Markdown edits cover it today: `edit_content`, `append_content`, `replace_content` | suekou's [blocks/definitions.ts](https://github.com/suekou/mcp-notion-server/blob/efa09a2/src/tools/blocks/definitions.ts) |
| notion | Comment edit and delete. `get_comments` and `add_comment` exist | awkoy's [comments.ts](https://github.com/awkoy/notion-mcp-server/blob/7ea7189/src/operations/comments.ts) |
| anaf-efactura | Public registries: financial statements, farmers, religious bodies. `lookup_company` covers the VAT and e-Factura registries | anafpy's [public/tools.py](https://github.com/robert-malai/anafpy/blob/main/src/anafpy/mcp/public/tools.py) |
| anaf-spv | More declaration forms, such as the D394. D212 is filed; D100, D300 and D112 are validated but not filed ([why](#choices-that-shape-the-servers)) | anafpy's [declaratii/tools.py](https://github.com/robert-malai/anafpy/blob/main/src/anafpy/mcp/declaratii/tools.py) |
| bitwarden | Cards, identities and folders. Logins and secure notes exist | warden-mcp ([README](https://github.com/icoretech/warden-mcp/blob/main/README.md)); [Bitwarden's server](https://github.com/bitwarden/mcp-server) |
| eas | Writing a workflow file (`workflow_create`). `validate_workflow` checks one and nothing writes one. Rollouts are set per update group, and branch rollouts on a channel are not covered | Expo's hosted server ([docs](https://docs.expo.dev/eas/ai/mcp/)) |
| trademarks | More offices, such as UKIPO. USPTO and EUIPO are searched; WIPO, TMview and OSIM are not, on their terms of use (see [Rejected](#rejected)) | MarkMesh ([README](https://github.com/team-markmesh/mark_mesh_skill/blob/HEAD/README.md)) |
| all | Evals of how well a model picks the tools. None today: tool snapshots and `scripts/check-docs.ts` pin the tool surface | Sentry's `packages/mcp-server-evals` ([repo](https://github.com/getsentry/sentry-mcp)); Cloudflare's `packages/eval-tools` |

## How to ask for something

Open an issue on the repository. Say the job you want your assistant to do,
which service and account it touches, and what that needs (a grant, a key, a
plan). Say what class the tool would have (`read`, `write` or `money`), since
that decides the confirmation a person sees. A new `money` tool lands with its
confirmation line agreed and tested, and a deployment that turns client
confirmation off decides for itself whether to keep such a tool on.

A pull request is welcome too: [CONTRIBUTING.md](../CONTRIBUTING.md) has the
setup, the house style and the checks. For a vulnerability, follow
[SECURITY.md](../SECURITY.md) instead.

## What every change must keep

These are where the servers do better than the ones we compared with, and a
feature that would give one up is turned down.

| Strength | Where it lives | What others do |
|---|---|---|
| Money is exact decimal strings from the API to the answer | `packages/mcp-kit/src/decimal.ts`, each server's schemas | `bankmcp` turns amounts into numbers ([data.ts](https://github.com/noskillish/bankmcp/blob/f28fac6/src/data.ts)); `elcukro/bank-mcp` uses `parseFloat` ([enable-banking/index.ts](https://github.com/elcukro/bank-mcp/blob/c6abad5/src/providers/enable-banking/index.ts)); `ts-anaf` takes `unitPrice: z.number()` ([ubl.ts](https://github.com/florin-szilagyi/ts-anaf/blob/main/mcp/src/tools/ubl.ts)); `@pipeworx/mcp-bnr-ro` returns rates as numbers, so `4.2440` arrives as `4.244` |
| A write whose outcome is unknown is never sent again | `packages/mcp-kit/src/http.ts` | `anaf-efactura-mcp` retries its upload three times ([index.js](https://github.com/Hegetiby/anaf-efactura-mcp/blob/main/src/index.js), `fetchWithRetry`); awkoy's Notion server retries every handler on 5xx, writes included ([dispatch/index.ts](https://github.com/awkoy/notion-mcp-server/blob/7ea7189/src/dispatch/index.ts)) |
| Issuing is idempotent: oblio derives a key from the document when none is given, and anaf-efactura refuses to file the same bytes twice | `servers/oblio`, the anaf-efactura ledger | The one other Oblio server with a key keeps it in memory and needs the caller to pass it; `anaf-efactura-mcp` retries its upload (above) |
| One access class per tool drives its annotations, the ceilings, confirmation and the audit line; inputs are strict; a server refuses to start on a stale policy | `packages/mcp-kit/src/serve/guard.ts`, [security.md](security.md) | Hints set by hand per tool; unknown arguments silently dropped |
| The total a person confirms is computed by the same function whose result the call sends | `packages/mcp-kit/src/invoiceTotals.ts`, `servers/oblio/src/domain` | No other server we looked at checks the issued total |
| Files go in by path or as checksummed bytes, and come out through an outbox with their SHA-256 | `packages/mcp-kit/src/inputFile.ts`, `outbox.ts` | Base64 or XML typed into tool arguments (`ts-anaf`'s `xml: z.string()` in [upload.ts](https://github.com/florin-szilagyi/ts-anaf/blob/main/mcp/src/tools/upload.ts); awkoy's [files.ts](https://github.com/awkoy/notion-mcp-server/blob/7ea7189/src/operations/files.ts)) |
| Secrets never reach the model: generated and stored in the server (bitwarden), private keys written to a file (porkbun) | `servers/bitwarden`, `servers/porkbun` | Bitwarden's own server returns passwords and takes them as arguments ([bitwarden/mcp-server](https://github.com/bitwarden/mcp-server)) |
| HTTP on loopback only, a bearer token per client, a Host check, no CORS | `packages/mcp-kit/src/serve` | `anaf-efactura-mcp` listens on `0.0.0.0` with no check ([transport.js](https://github.com/Hegetiby/anaf-efactura-mcp/blob/main/shared/transport.js)); `warden-mcp` takes the vault password in request headers and has no authentication of its own ([README](https://github.com/icoretech/warden-mcp/blob/main/README.md)) |
| Tests cannot reach a real account or the network | `packages/mcp-kit/testing/isolate.ts` | Mocks beside live-account tests |
| Several accounts or workspaces in one call, and no default account on a write | `servers/google`, `servers/notion` | One account per connection (Google's servers, Notion's hosted server) |
| Every Google batchUpdate is checked against the API's own schema | `servers/google` ([google-gaps.md](../servers/google/docs/google-gaps.md)) | Raw, unchecked relays |

## What we will not build

Patterns we saw in other servers and left out, with the reason. Each reason
is a rule for new work too.

| Pattern | Seen in | Why not |
|---|---|---|
| Amounts as JavaScript numbers or Python floats | The files cited above; `romania-mcp` ([bnr.py](https://github.com/robyroro/romania-mcp/blob/main/src/romania_mcp/bnr.py), `round(float(...))`); anafpy's `amounts: list[float \| str]`; bnr-converter's `bill_amount: float` | A JSON float has lost digits before any decimal type sees it |
| Retrying a POST | `anaf-efactura-mcp`, awkoy's Notion server | A second invoice, page or upload |
| Open or unauthenticated HTTP | `anaf-efactura-mcp`; `workspace-mcp` in its opt-in `0.0.0.0` mode ([main.py](https://github.com/taylorwilsdon/google_workspace_mcp/blob/484f64b/main.py)); `@playwright/mcp`'s Docker example | Anything on the machine, or the network, becomes a client |
| Upstream credentials passed through in request headers | `warden-mcp`; `@notionhq/notion-mcp-server`'s token header ([token.ts](https://github.com/makenotion/notion-mcp-server/blob/main/src/openapi-mcp-server/mcp/token.ts)); Porkbun's hosted key headers | The spec forbids passing on a token not issued for the server, and the credential travels with every request |
| Secrets handed to the model | Bitwarden's server (`get`, `generate`); Porkbun's `retrieve_api_key` | A secret in a context window is a leaked secret |
| Files and XML as text arguments | `ts-anaf`, anafpy's prepare and submit, awkoy's uploads | A model copying a long text can change one character, and one wrong character breaks a signed archive |
| Moving money or changing a basket | `Algiras/enable-banking-mcp`'s `create_payment` ([server.rs](https://github.com/Algiras/enable-banking-mcp/blob/d23eadb/src/server.rs)); `glovo-skill`'s basket tools ([server.mjs](https://github.com/denya/glovo-skill/blob/42f2548/src/server.mjs)) | Out of scope for a read-only or document server |
| Sending data to a third party | Hosted gateways (`io.usefulapi/oblio`, howtoromania, leadgen); trademark aggregators (MarkMesh, Antevo) | A name under consideration, or a company's books, leave the machine |
| Answering bot challenges, scraping registers whose terms forbid it | TMview, WIPO, USPTO's challenge | The trademarks server's terms-of-use rule (its README) |
| Interactive-only OAuth for a shared service | Expo's hosted server | A service shared by several clients needs a grant that is not one person's browser session |

## Rejected

Ideas we considered and set aside. A reason that stops holding is a reason to
look again, and each row says what would change it.

| Idea | Seen in | Why not, for now |
|---|---|---|
| MCP Apps (`ui://` views) | GitHub, suekou | Few clients render them, Claude Code's terminal not among them. The strongest case, a money confirmation screen, is served by client confirmation and elicitation. Revisit when client support is wide |
| Sampling | The everything server | Deprecated in the 2026-07-28 protocol |
| Tasks | The everything server | Moved to an extension in 2026-07-28 and dropped from the core of SDK v2, which the kit runs on |
| Prompts and completions in general | anafpy, bankmcp, Expo | Low value for servers that wrap APIs; each server's instructions carry the start-here text. A prompt per workflow can come later if clients surface them |
| Resources mirroring tools (`notion://page/{id}`, `anafmsg://`) | awkoy, anafpy | They duplicate the read tools, and a file a tool writes is already linked in its result as a resource link |
| Paging `tools/list` | Nobody | No client needs it at 115 tools, the most any server here lists |
| Tool tiers that hide tools | `workspace-mcp` ([tool_tiers.yaml](https://github.com/taylorwilsdon/google_workspace_mcp/blob/484f64b/core/tool_tiers.yaml)) | The access ceiling (`MCP_MAX_ACCESS`) already narrows a deployment; hiding by tier makes a tool's absence ambiguous |
| OAuth as a resource server | GitHub, Sentry | Needed only off loopback; [auth.md](auth.md) plans it for that case |
| Webhooks in Oblio (Porkbun's are kept as the vendor offers them) | an earlier Oblio server | An inbound endpoint on a loopback-only server |
| Oblio delivery notes, e-Factura through Oblio | valentinludu's server ([mcpServer.ts](https://github.com/valentinludu/oblio-mcp/blob/4aaf4b6/src/mcpServer.ts)) | Delivery notes on demand only; e-Factura has its own server here, one source of truth |
| Payments from a bank account | Algiras's server | It moves money; out of scope for a read-only bank feed |
| Categories, alerts and watches on transactions | banking-mcp, bankmcp | They belong to whatever keeps the books; bankmcp's watches post to a webhook |
| Changing a basket, reordering, store browsing | `glovo-skill`, Glovo's own server | The receipt servers change nothing in the account |
| Apps Script execution | `workspace-mcp` | Arbitrary code with the account's grant |
| Google Chat and Forms | `workspace-mcp`, Google | Chat needs a Chat app in the Cloud project; Forms has had no use case yet |
| Starting a build from a profile | Expo | `dispatch_workflow` covers it as a `money` tool |
| Driving devices (taps, screenshots, logs) | `mobile-mcp`, manzanas | The broker hands out devices; drivers already exist and work with a lease |
| A warm pool of devices | manzanas, simlock | A warm device holds a host's memory while nobody uses it. Revisit if boot time becomes the bottleneck |
| More trademark offices through TMview or WIPO; aggregators | Antevo, MarkMesh | Their terms, and a name under consideration must reach only the office |
| Porkbun's USDC and x402 top-ups, and minting API keys (`request_api_key`, `retrieve_api_key`) | Porkbun 0.52.0 | A wallet key in the service's environment; a live API key handed to the model |
| Porkbun's sandbox tools | Porkbun 0.52.0 | They answer only to a sandbox key, and this server holds the account's live key |
| Revealing secrets on request | `warden-mcp` | A revealed secret is in the context window |
| Images in TypeSafe judgments | `typesafe-mcp` | TypeSafe marks image input experimental |
| Company search over public register data in onrc | leadgen ([tools.json](https://github.com/darksider4all/leadgen-mcp/blob/main/leadgen_mcp/tools.json)), howtoromania | A different product from the account's own filings; anaf-efactura's `lookup_company` covers the VAT registry |

## Choices that shape the servers

- **The registry namespace is `com.foreverworks/*`**, proven by a DNS record on
  foreverworks.com, rather than `io.github.foreverworks/*`
  ([releasing.md](releasing.md#the-registry-namespace-comforeverworks)).
- **anaf-spv stops before sending a D100, D300 or D112.** ANAF takes them only
  through e-guvernare.ro, as a PDF signed with a qualified certificate, which
  this server does not hold. `validate_declaration` checks the PDF, and
  `submit_declaration` stops before sending.
- **Oblio has no `send_invoice_email`.** Oblio's API cannot e-mail a document
  already issued. It e-mails only at issue, which `create_invoice` takes as
  `sendEmail` (read against [its API](https://www.oblio.eu/api) and its PHP,
  JS, Python and Go SDKs in October 2026).
- **A new dependency is weighed against what it brings in.** Porkbun's 0.52.0
  adds `@x402/core`, `@x402/evm` and `viem` though the tools that use them are
  left out; `rag` uses `pg` and `pg-connection-string` because a database has
  no SDK of its own.

## Servers we compared with

October 2026. A "they have X" in this page links to a file or a doc page, and a
"we lack X" was checked against our code. Links point at the default branch
unless a commit is named, with the tool or function name beside them, since a
file can move.

| Domain | Compared with |
|---|---|
| google | Google's remote Workspace servers ([overview](https://developers.google.com/workspace/guides/configure-mcp-servers)); [`workspace-mcp`](https://github.com/taylorwilsdon/google_workspace_mcp); [the Gemini CLI Workspace extension](https://github.com/gemini-cli-extensions/workspace); [aaronsb's server](https://github.com/aaronsb/google-workspace-mcp) |
| notion | Notion's hosted server ([tools](https://developers.notion.com/docs/mcp-supported-tools)); `@notionhq/notion-mcp-server`; [awkoy's](https://github.com/awkoy/notion-mcp-server); [suekou's](https://github.com/suekou/mcp-notion-server) |
| anaf-efactura, anaf-spv, onrc, bnr | No institution publishes one. [anafpy](https://github.com/robert-malai/anafpy/tree/main/src/anafpy/mcp); [`ts-anaf`](https://github.com/florin-szilagyi/ts-anaf/tree/main/mcp/src/tools); [`anaf-efactura-mcp`](https://github.com/Hegetiby/anaf-efactura-mcp); [howtoromania](https://github.com/howtoromania/howtoromania-mcp); for BNR, `@pipeworx/mcp-bnr-ro` and [bnr-converter](https://github.com/mionita1980/bnr-converter-mcp-server); for ONRC, only servers over public company data ([leadgen](https://github.com/darksider4all/leadgen-mcp)) |
| oblio | No vendor server. [valentinludu's](https://github.com/valentinludu/oblio-mcp); the hosted `io.usefulapi/oblio`; SmartBill's community server as the nearest neighbour ([tools](https://github.com/bogdanripa/smartbill-mcp/tree/23c4b31/src/tools)) |
| enable-banking | No vendor server. [marcosvrs's](https://github.com/marcosvrs/enable-banking-mcp); [`bankmcp`](https://github.com/noskillish/bankmcp); [`banking-mcp`](https://github.com/matcha-ai-test/banking-mcp); [`elcukro/bank-mcp`](https://github.com/elcukro/bank-mcp) |
| bolt-food, glovo | Bolt has none. Glovo's own server finds products only ([page](https://glovoapp.com/docs/en/legal/mcp/)); [`glovo-skill`](https://github.com/denya/glovo-skill) reads orders |
| porkbun | The vendor's own package, served here ([README](https://github.com/oborseth/Porkbun-MCP/blob/main/README.md)) |
| bitwarden | [Bitwarden's server](https://github.com/bitwarden/mcp-server); [Agent Access](https://github.com/bitwarden/agent-access); [`warden-mcp`](https://github.com/icoretech/warden-mcp); 1Password's server as the reference for never returning a secret ([docs](https://www.1password.dev/environments/mcp-server.md)) |
| typesafe | No vendor server. [`typesafe-mcp`](https://github.com/MarkChu-git/typesafe-mcp); [Arbitype](https://github.com/Renwang-Huang/typesafe-mcp) |
| eas, app-stores | Expo's hosted server ([docs](https://docs.expo.dev/eas/ai/mcp/)); [`asc-mcp`](https://github.com/zelentsov-dev/asc-mcp); [`play-store-mcp`](https://github.com/antoniolg/play-store-mcp) |
| devices | [simlock](https://github.com/callstackincubator/simlock); [`mobile-mcp`](https://github.com/mobile-next/mobile-mcp); [`agent-device`](https://github.com/callstack/agent-device); [manzanas](https://github.com/BariBariGood/manzanas) |
| trademarks | [MarkMesh](https://github.com/team-markmesh/mark_mesh_skill); [`patent_mcp_server`](https://github.com/riemannzeta/patent_mcp_server); [Antevo](https://github.com/ANTEVO-CH/antevo-mcp) |
| Protocol and packaging | The specification, 2025-11-25 and 2026-07-28 ([changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)); [GitHub's server](https://github.com/github/github-mcp-server); the reference [everything server](https://github.com/modelcontextprotocol/servers/tree/main/src/everything); [Sentry's](https://github.com/getsentry/sentry-mcp); [Playwright's](https://github.com/microsoft/playwright-mcp); the [`.mcpb` spec](https://github.com/modelcontextprotocol/mcpb) |

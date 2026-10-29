# Roadmap

How these servers compare with the strongest published MCP servers in each of
their domains: what is still open, what was built, what we do better and keep,
and what we chose not to copy. It was researched on 2026-10-21 from the other
servers' own code and documentation
([how](#how-this-was-researched)); most of what it found was built by
2026-10-22, when this page was last brought up to date. Item ids (K1, O3, PB1
and so on) never change: commits, code comments and notes refer to them.

## Still open

None is scheduled; the last column says what each waits on.

| Item | What it would do | Who has it | Waits on |
|---|---|---|---|
| E4 | enable-banking: a local cache of transactions, so a repeated question spends none of the few reads a day PSD2 allows without the account holder present | banking-mcp ([schema.sql](https://github.com/matcha-ai-test/banking-mcp/blob/f77a5a7/schema.sql)) | A need. A cache is a second copy of bank data on disk, and a deployment that already keeps a ledger may prefer to read that |
| W1 | bitwarden: `run_with_secret`, which runs a command from an operator's allowlist with a password, a field or a TOTP code in its environment and returns its output with the secret scrubbed, so the model never sees the secret | Bitwarden's Agent Access, `aac run` ([README](https://github.com/bitwarden/agent-access/blob/main/README.md)); 1Password's server ([docs](https://www.1password.dev/environments/mcp-server.md)) | A design for the allowlist, which is all of its security. A command that echoes its environment defeats scrubbing, so it must scrub by value and say so in the result |
| T3 | typesafe: CSV rows and Markdown sections as `ask_batch` records, and files matched by a glob inside the file roots; today it reads one JSONL or JSON file | `typesafe-mcp` ([README](https://github.com/MarkChu-git/typesafe-mcp/blob/main/README.md)) | A need |
| D2 | devices: notice that a leased device died, restart it on the same lease, and tell the holder through the lease's state | Callstack's simlock ([README](https://github.com/callstackincubator/simlock/blob/HEAD/README.md)) | A need |

### Gaps with no item yet

None is planned; an item is opened when someone needs one.

| Server | What others have | Source | Here today |
|---|---|---|---|
| google | An image handed to the model as image content | aaronsb's [gmail.yaml](https://github.com/aaronsb/google-workspace-mcp/blob/9c9f803/src/factory/manifest/gmail.yaml); the Gemini extension's `slides.getImages` in [index.ts](https://github.com/gemini-cli-extensions/workspace/blob/089927e/workspace-server/src/index.ts) | `get_thumbnails` returns URLs |
| notion | Block update and delete | suekou's [blocks/definitions.ts](https://github.com/suekou/mcp-notion-server/blob/efa09a2/src/tools/blocks/definitions.ts) | Markdown edits: `edit_content`, `append_content`, `replace_content` |
| notion | Comment edit and delete | awkoy's [comments.ts](https://github.com/awkoy/notion-mcp-server/blob/7ea7189/src/operations/comments.ts) | `get_comments` and `add_comment` |
| anaf-efactura | Public registries: financial statements, farmers, religious bodies | anafpy's [public/tools.py](https://github.com/robert-malai/anafpy/blob/main/src/anafpy/mcp/public/tools.py) | `lookup_company` covers the VAT and e-Factura registries |
| anaf-spv | More declaration forms (D394 and others) | anafpy's [declaratii/tools.py](https://github.com/robert-malai/anafpy/blob/main/src/anafpy/mcp/declaratii/tools.py) | D212 filed; D100, D300 and D112 validated but not filed (see [Decisions](#decisions)) |
| bitwarden | Cards, identities and folders | warden-mcp ([README](https://github.com/icoretech/warden-mcp/blob/main/README.md)); [Bitwarden's server](https://github.com/bitwarden/mcp-server) | Logins and secure notes |
| eas | Writing a workflow file (`workflow_create`) | Expo's hosted server ([docs](https://docs.expo.dev/eas/ai/mcp/)) | `validate_workflow` checks one; nothing writes one. Rollouts are set per update group; branch rollouts on a channel are not covered |
| trademarks | More offices, such as UKIPO | MarkMesh ([README](https://github.com/team-markmesh/mark_mesh_skill/blob/HEAD/README.md)) | USPTO and EUIPO. WIPO, TMview and OSIM are not searched, on their terms of use (see [Rejected](#rejected)) |
| all | Evals of how well a model picks the tools | Sentry's `packages/mcp-server-evals` ([repo](https://github.com/getsentry/sentry-mcp)); Cloudflare's `packages/eval-tools` | None. Tool snapshots and `scripts/check-docs.ts` pin the tool surface |

## Done

Eight work packages, in the order built, each with its tests, README rows
and snapshots. E1 to E3 came first, on their own.

| Item | What landed |
|---|---|
| **Before** | |
| E1 | enable-banking `get_transactions` filters by text, direction and an amount range compared as exact decimals, and reads every account when `account_uid` is left out |
| E2 | enable-banking `export_transactions`: CSV to the outbox with its SHA-256, written by the kit's CSV writer that the receipts servers share |
| E3 | enable-banking `revoke_session` ends a consent at the bank |
| **1. Kit foundations** | |
| K2 | The guard derives every tool's `openWorldHint` and `idempotentHint` (a write is idempotent only when its policy line says so, each with a test) and lists tools in name order; `check-docs` requires server instructions |
| K3 | A file a tool writes to the outbox is linked in its result as a `resource_link` |
| K1 | An optional output schema per tool: the guard checks the result against it and also sends it as structured content. It is opt-in because a schema roughly doubles a tool's definition (`scripts/measure-tokens.ts`); bnr, trademarks and eas's lists came first |
| **2. Read-only wins** | |
| O1 | oblio `list_invoices` by period, buyer, status and e-Factura state, with a cursor |
| B1 | bnr `convert` to or from RON at the rate in force on a day or the last one before it, rounded once by a named rule |
| B2 | bnr `rates`: several currencies on a day, or every fixing in a window |
| A2 | anaf-efactura `parse_invoice`: a UBL invoice, from a file or an archive in the outbox, as JSON whose values are the document's own text |
| A1 | anaf-efactura `build_invoice` writes a CIUS-RO invoice from fields to the outbox, its totals by the kit's shared rule (`invoiceTotals.ts`), ready for `validate_invoice` and `upload_invoice` by path |
| S1 | anaf-spv `declaration_status`: a filing's state and receipt from ANAF's public status page, at any time after filing |
| T1 | typesafe `ask_batch` takes thresholds per question and answers act, review or abstain per row |
| T2 | typesafe `where`, `top` and `counts` on a batch result |
| F1 | bolt-food and glovo `order_stats`: what orders cost per store and per month, in `packages/receipts` |
| E-EAS1 | eas `validate_workflow`: a workflow file at a ref or by path, checked by EAS's own validator |
| M1 | trademarks `search_marks` filters by goods and services text where the office's search can (USPTO), and says where it cannot |
| M2 | trademarks: a `similarity` score from 0 to 100 on every mark, computed the same way for every office |
| N3 | notion `list_views` and `query_view` run a saved view as Notion shows it |
| N4 | notion `list_users`, and a person column filtered by name or e-mail |
| G6 | google `get_messages` reads several messages of one mailbox in one call |
| **3. Long calls** | |
| K4 | Progress and cancellation: a cancelled read stops, and a write cancelled after it was sent ends as `outcome_unknown`, never resent. anaf-spv `sync_messages` and `await_reply`, google `harvest_attachments` and typesafe `ask_batch` report progress |
| E-EAS2 | eas `wait_for_run` waits for a workflow run or a build to end, with progress |
| D1 | devices `acquire` can wait for the boot (`until_booted`), and `wait` reports the place in the queue |
| **4. Writes** | |
| N1 | notion `create_page` applies a database's default or a named template |
| N2 | notion `upload_file` and `download_files`: files in by path, out to the outbox |
| N5 | notion `add_column`, `add_options` and `create_database`, each checked against the schema first |
| G2 | google `create_event` and `update_event` make a Meet link, focus time and out of office |
| G4 | google `upload_file` with `convert` turns a .docx, .xlsx or .pptx into a Google Doc, Sheet or deck |
| PB3 | porkbun `export_dns_zone` writes a BIND zone file to the outbox; `import_dns_records` takes one by path |
| W2 | bitwarden `check_exposed` checks a stored password against Have I Been Pwned by k-anonymity: five characters of its hash leave the server |
| W3 | bitwarden `create_note` keeps a secret, typed or from a file, and never returns its text |
| E-EAS3 | eas `set_rollout` raises an update's rollout and `revert_rollout` sends its devices back |
| D3 | devices `pause` and `resume` hand a leased device to a person and back without losing it |
| **5. Packaging** | |
| P1 | `check-docs` writes each server's `mcpName` and `server.json` from its package.json; the release publishes to npm with provenance, then to the MCP Registry, once the repository is public ([releasing.md](releasing.md)) |
| P3 | A changelog per package, kept with changesets; a change of access class that no changelog tells fails CI ([.changeset/README.md](../.changeset/README.md)) |
| P4 | One icon set drawn by `scripts/icons.ts`: an icon per server and per google product, at initialize, on tools and in the registry |
| P2 | VS Code and Cursor install links in every README, and a Claude Desktop `.mcpb` bundle per server built by `scripts/bundle.ts` |
| **6. New grants** | |
| G1 | google Tasks: lists and tasks read and written, and `agenda` showing the tasks due |
| G3 | google `find_people` over contacts and a Workspace directory |
| G5 | google `list_meetings` and `get_transcript` for Meet transcripts and notes |
| M3 | trademarks `mark_history`, `mark_documents` and `download_mark_documents` through USPTO's TSDR API |
| E-EAS4 | A server of its own, `app-stores`: App Store and Play reviews with replies, TestFlight feedback and crash logs |
| **7. New money tools** | |
| PB2 | porkbun refuses a purchase or top-up over the account's own limit as `over_limit` before sending it |
| PB1 | porkbun on the vendor's 0.52.0: 17 of its 21 new tools offered, 5 of them `money`, each confirmation line tested; USDC payments and API key minting left out |
| O2 | oblio `collect_invoice` records a payment; the invoice is read first, so the confirmation names its own buyer and currency |
| O4 | oblio `reverse_invoice` issues a storno whose total is the original's, negated, once per invoice |
| A3 | anaf-efactura `upload_invoice_b2c` files an invoice to a person |
| A4 | anaf-efactura `etransport_file` and `etransport_status` file and follow e-Transport declarations |
| S2 | anaf-spv `validate_declaration` takes D100, D300 and D112 beside D212; `submit_declaration` stops before sending them (see [Decisions](#decisions)) |
| **8. Protocol move** | |
| K5 | Sign-in links are offered through URL elicitation where the client supports it, and stay in the result where it does not |
| K6 | SDK v2: protocols 2025-11-25 and 2026-07-28 served side by side over stdio and HTTP, so money confirmation by elicitation also works over HTTP for 2026-07-28 clients |

## What we do better, and must keep

Every change keeps these; a feature that would give one up is rejected.

| Strength | Where it lives | What others do |
|---|---|---|
| Money is exact decimal strings from the API to the answer | `packages/mcp-kit/src/decimal.ts`, each server's schemas | `bankmcp` turns amounts into numbers ([data.ts](https://github.com/noskillish/bankmcp/blob/f28fac6/src/data.ts)); `elcukro/bank-mcp` uses `parseFloat` ([enable-banking/index.ts](https://github.com/elcukro/bank-mcp/blob/c6abad5/src/providers/enable-banking/index.ts)); `ts-anaf` takes `unitPrice: z.number()` ([ubl.ts](https://github.com/florin-szilagyi/ts-anaf/blob/main/mcp/src/tools/ubl.ts)); `@pipeworx/mcp-bnr-ro` returns rates as numbers, so `4.2440` arrives as `4.244` |
| A write whose outcome is unknown is never sent again | `packages/mcp-kit/src/http.ts` | `anaf-efactura-mcp` retries its upload three times ([index.js](https://github.com/Hegetiby/anaf-efactura-mcp/blob/main/src/index.js), `fetchWithRetry`); awkoy's Notion server retries every handler on 5xx, writes included ([dispatch/index.ts](https://github.com/awkoy/notion-mcp-server/blob/7ea7189/src/dispatch/index.ts)) |
| Idempotent issuing: oblio derives a key from the document when none is given, and anaf-efactura refuses to file the same bytes twice | `servers/oblio`, the anaf-efactura ledger | The one other Oblio server with a key keeps it in memory and needs the caller to pass it; `anaf-efactura-mcp` retries its upload (above) |
| One access class per tool drives its annotations, the ceilings, confirmation and the audit line; inputs are strict; a server refuses to start on a stale policy | `packages/mcp-kit/src/serve/guard.ts`, [security.md](security.md) | Hints set by hand per tool; unknown arguments silently dropped |
| The total a person confirms is computed by the same function whose result the call sends | `packages/mcp-kit/src/invoiceTotals.ts`, `servers/oblio/src/domain` | No competitor checks the issued total |
| Files go in by path or as checksummed bytes, and come out through an outbox with their SHA-256 | `packages/mcp-kit/src/inputFile.ts`, `outbox.ts` | Base64 or XML typed into tool arguments (`ts-anaf`'s `xml: z.string()` in [upload.ts](https://github.com/florin-szilagyi/ts-anaf/blob/main/mcp/src/tools/upload.ts); awkoy's [files.ts](https://github.com/awkoy/notion-mcp-server/blob/7ea7189/src/operations/files.ts)) |
| Secrets never reach the model: generated and stored in the server (bitwarden), private keys written to a file (porkbun) | `servers/bitwarden`, `servers/porkbun` | Bitwarden's own server returns passwords and takes them as arguments ([bitwarden/mcp-server](https://github.com/bitwarden/mcp-server)) |
| HTTP on loopback only, a bearer token per client, a Host check, no CORS | `packages/mcp-kit/src/serve` | `anaf-efactura-mcp` listens on `0.0.0.0` with no check ([transport.js](https://github.com/Hegetiby/anaf-efactura-mcp/blob/main/shared/transport.js)); `warden-mcp` takes the vault password in request headers and has no authentication of its own ([README](https://github.com/icoretech/warden-mcp/blob/main/README.md)) |
| Tests cannot reach a real account or the network | `packages/mcp-kit/testing/isolate.ts` | Mocks beside live-account tests |
| Several accounts or workspaces in one call, and no default account on a write | `servers/google`, `servers/notion` | One account per connection (Google's servers, Notion's hosted server) |
| Every Google batchUpdate is checked against the API's own schema | `servers/google` ([google-gaps.md](../servers/google/docs/google-gaps.md)) | Raw, unchecked relays |

## What we will not copy

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

| Idea | Seen in | Why not, for now |
|---|---|---|
| MCP Apps (`ui://` views) | GitHub, suekou | Few clients render them, Claude Code's terminal not among them; the strong case, a money confirmation screen, is served by client confirmation and elicitation. Revisit when client support is wide |
| Sampling | The everything server | Deprecated in 2026-07-28 |
| Tasks | The everything server | Moved to an extension in 2026-07-28 and dropped from the core of SDK v2, which the kit runs on (K6) |
| Prompts and completions in general | anafpy, bankmcp, Expo | Low value for servers that wrap APIs; server instructions (K2) carry the start-here text. A prompt per workflow can come later if clients surface them |
| Resources mirroring tools (`notion://page/{id}`, `anafmsg://`) | awkoy, anafpy | They duplicate the read tools; resource links (K3) cover files |
| Paging `tools/list` | Nobody | No client needs it at 115 tools, the most any server here lists |
| Tool tiers that hide tools | `workspace-mcp` ([tool_tiers.yaml](https://github.com/taylorwilsdon/google_workspace_mcp/blob/484f64b/core/tool_tiers.yaml)) | The access ceiling (`MCP_MAX_ACCESS`) already narrows a deployment; hiding by tier makes a tool's absence ambiguous |
| OAuth as a resource server | GitHub, Sentry | Needed only off loopback; [auth.md](auth.md) plans it for that case |
| Container images | GitHub, Playwright, Stripe | Worth it once packages are public; the systemd sandbox in [deploying.md](deploying.md) is the documented deployment |
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

## Decisions

Taken by the maintainers; none blocks an item any more.

- **New money tools are approved**: O2, O4, A3, A4, S2's submit for each new
  form, and PB1's Porkbun tools. Each lands with its confirmation line agreed
  and tested; a deployment that turns client confirmation off decides for
  itself whether to keep such a tool on.
- **New dependencies are approved**: SDK v2 (K6); Porkbun 0.52.0, which brings
  `@x402/core`, `@x402/evm` and `viem` though their tools are left out (PB1);
  changesets (P3); the `.mcpb` CLI (P2); `pg` (node-postgres) and its own URL
  parser `pg-connection-string` for `rag`, the first server with a database, which
  has no SDK of its own to bring one (approved by the maintainer on 2026-10-29).
- **New grants and egress are approved**: Google Tasks, People and Meet scopes
  (G1, G3, G5); an App Store Connect key and a Play service account (E-EAS4); a
  USPTO API key (M3); `api.pwnedpasswords.com` (W2).
- **The registry namespace is `com.foreverworks/*`**, proven by a DNS record on
  foreverworks.com, rather than `io.github.foreverworks/*`
  ([releasing.md](releasing.md)).
- **S2 stops before sending.** ANAF takes D100, D300 and D112 only through
  e-guvernare.ro, as a PDF signed with a qualified certificate, which this
  server does not hold; `submit_declaration` checks the PDF and stops.
- **O3, `send_invoice_email`, is dropped.** Oblio's API cannot e-mail a
  document already issued; it e-mails only at issue (`sendEmail`, which
  `create_invoice` takes). Checked on 2026-10-22 against
  [its API](https://www.oblio.eu/api) and its PHP, JS, Python and Go SDKs.

## How this was researched

1. **Our side, from the code.** Every server was started with an empty
   environment and asked for `tools/list`, as `scripts/check-docs.ts` does; a
   tool's access class is the one its `policy.ts` gives it.
2. **Their side, from their code.** For each domain, the two to four strongest
   published servers: the vendor's own first, then the most used (GitHub stars,
   npm or PyPI downloads, the official MCP Registry, Smithery, Glama,
   PulseMCP). Their tool lists and sources were read on GitHub or from
   unpacked packages; none of their code was run.
3. **Every claim is sourced.** A "they have X" links to a file or a doc page;
   a "we lack X" was checked against our code. Links point at the default
   branch unless a commit is named, and give the tool or function name beside
   them, since a file can move.

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

# mcps

**MCP servers that let an AI assistant do a small company's everyday work: mail
and documents, invoices and bank statements, Romanian tax filings, app releases
and domains.**

Each server connects an MCP client, such as Claude Code, Claude Desktop, VS Code
or Cursor, to one service. Most serve anyone who uses that service (Google
Workspace, Notion, Bitwarden, Porkbun, Expo, the app stores); several reach
Romanian institutions (ANAF, the trade register, the National Bank). They are
built on one toolkit, so every tool says what it can change, and a tool that
spends money or files a document waits for you to confirm it.

## Servers

Every tool is `read` (it changes nothing), `write` (it changes something in
your account) or `money`: it moves money, makes or unmakes a legal or fiscal
document, or commits you in a comparable way, such as a bank consent. Your
client asks you before each `money` call.

<!-- servers:begin -->
### Workspace

| Server | What it does |
|---|---|
| [<img src="servers/bitwarden/icons/icon.svg" width="20" height="20" alt=""> Bitwarden](servers/bitwarden)<br><sub>11 tools, read and write</sub> | Find, create and update logins, store secure notes, generate and hand out passwords, compute 2FA codes, and check passwords against known breaches |
| [<img src="servers/google/icons/icon.svg" width="20" height="20" alt=""> Google Workspace](servers/google)<br><sub>115 tools, read and write</sub> | Gmail, Calendar, Drive, Docs, Sheets, Slides, Tasks, contacts and Meet transcripts |
| [<img src="servers/notion/icons/icon.svg" width="20" height="20" alt=""> Notion](servers/notion)<br><sub>27 tools, read and write</sub> | Search, pages read and written as Markdown, typed database queries, saved views, comments and files |
| [<img src="servers/printer/icons/icon.svg" width="20" height="20" alt=""> Printer and scanner](servers/printer)<br><sub>10 tools, read and write</sub> | Printer status, lossless printing corrected for the printer's measured response, and scanning |

### Money and accounting

| Server | What it does |
|---|---|
| [<img src="servers/bnr/icons/icon.svg" width="20" height="20" alt=""> BNR exchange rates](servers/bnr)<br><sub>5 tools, read-only</sub> | The rate in force on any day, conversions to and from RON, rates over a period, and the yearly averages ANAF converts foreign income at |
| [<img src="servers/bolt-food/icons/icon.svg" width="20" height="20" alt=""> Bolt Food receipts](servers/bolt-food)<br><sub>8 tools, read-only</sub> | Itemised receipts, item search, spending by restaurant and month, and each bank card charge matched to its order; read-only |
| [<img src="servers/enable-banking/icons/icon.svg" width="20" height="20" alt=""> Enable Banking](servers/enable-banking)<br><sub>10 tools, including **money**</sub> | Read and search statements across accounts, export them as CSV, read balances, and manage the consents; it moves no money |
| [<img src="servers/glovo/icons/icon.svg" width="20" height="20" alt=""> Glovo receipts](servers/glovo)<br><sub>8 tools, read-only</sub> | Itemised receipts, item search, spending by store and month, and each bank card charge matched to its order; read-only |
| [<img src="servers/oblio/icons/icon.svg" width="20" height="20" alt=""> Oblio](servers/oblio)<br><sub>17 tools, including **money**</sub> | Issue invoices and proformas with exact totals, record payments, cancel or reverse invoices, and read clients, products and series |

### Romanian authorities

| Server | What it does |
|---|---|
| [<img src="servers/anaf-efactura/icons/icon.svg" width="20" height="20" alt=""> ANAF e-Factura](servers/anaf-efactura)<br><sub>20 tools, including **money**</sub> | Read the invoices a company received and sent, check and render them, file new invoices and e-Transport declarations, and look up companies in the VAT registry |
| [<img src="servers/anaf-spv/icons/icon.svg" width="20" height="20" alt=""> ANAF SPV](servers/anaf-spv)<br><sub>16 tools, including **money**</sub> | Download what ANAF posts to a taxpayer, request new documents, validate declarations and file a D212; it signs in by itself |
| [<img src="servers/onrc/icons/icon.svg" width="20" height="20" alt=""> ONRC trade register](servers/onrc)<br><sub>9 tools, read and write</sub> | The filings made there and their status, the documents listed on each filing, fee notes and invoices |

### Apps and developer tools

| Server | What it does |
|---|---|
| [<img src="servers/app-stores/icons/icon.svg" width="20" height="20" alt=""> App Store and Google Play](servers/app-stores)<br><sub>7 tools, read and write</sub> | Read and answer App Store and Play reviews, and read TestFlight feedback and crash logs |
| [<img src="servers/devices/icons/icon.svg" width="20" height="20" alt=""> Device broker](servers/devices)<br><sub>10 tools, read and write</sub> | Lease one, wait in a fair queue, start spares within budgets, and check each host's health |
| [<img src="servers/eas/icons/icon.svg" width="20" height="20" alt=""> Expo Application Services](servers/eas)<br><sub>23 tools, including **money**</sub> | Builds, workflow runs with each job's log and why it failed, store submissions with the store's error text, a credentials audit, fingerprints and updates |
| [<img src="servers/typesafe/icons/icon.svg" width="20" height="20" alt=""> TypeSafe](servers/typesafe)<br><sub>3 tools, read-only</sub> | Typed, calibrated judgments over text or JSON (a yes or no with its probability, one of a set, a score), one at a time or in batches |

### Domains and brands

| Server | What it does |
|---|---|
| [<img src="servers/porkbun/icons/icon.svg" width="20" height="20" alt=""> Porkbun](servers/porkbun)<br><sub>113 tools, including **money**</sub> | Porkbun's official tools, served with per-client tokens, an audit line per call, purchases marked for the client to confirm, and files uploaded by path |
| [<img src="servers/trademarks/icons/icon.svg" width="20" height="20" alt=""> Trademark search](servers/trademarks)<br><sub>6 tools, read-only</sub> | Whether a name is already a registered or pending mark, by office and Nice class (USPTO, EUIPO), and a US mark's history and documents |

### Shared packages

| Package | What it is |
|---|---|
| [mcp-kit](packages/mcp-kit) | Stdio and HTTP transports with per-client tokens, a guard that classifies, audits and can confirm every tool call, an HTTP and OAuth stack, exact decimals, and byte-exact file inputs |
| [receipts](packages/receipts) | Itemised receipts, the join from a bank card charge to the order it paid, item search and CSV exports |
<!-- servers:end -->

## Quick start

You need Node 22.19 or newer and an MCP client. The trademark search needs no
account and no key for US marks, which makes it a good first server:

```bash
git clone https://github.com/foreverworks/mcps.git && cd mcps
npm ci && npm run build
claude mcp add trademarks -- node "$PWD/servers/trademarks/dist/index.js"
```

Then ask your assistant: *"Is Turnip already a registered trademark in the US
for software?"*

Every server's README has its install buttons, the commands for Claude Code and
for clients configured with JSON, and the credentials it needs, step by step. A
server starts and lists its tools before you configure anything; a tool that
needs a credential you have not given answers with an error naming the variable
to set. To run one copy that several clients share over HTTP, see
[docs/deploying.md](docs/deploying.md).

## What every server does the same way

- **Each tool says what it can change.** Its class reaches your client in the
  standard annotations (`readOnlyHint`, `destructiveHint`), so a client can
  ask before a write. A server will not start with a tool left unclassified.
- **Money waits for you.** A `money` tool asks your client to confirm every
  call; Claude Code does, whatever its permission mode. A deployment can
  instead have the server ask you itself, in one line naming the amount, the
  counterparty and the document ([how](docs/security.md#money-and-confirmation)).
- **A deployment can set a ceiling.** `MCP_MAX_ACCESS=read` turns a server
  into a read-only one, and a lower ceiling can be set per client.
- **Your data is not retyped.** Files go in by path, never as text a model
  copies; amounts are exact decimal strings, never floating point; an unknown
  argument is refused by name; results report the SHA-256 of what was stored
  or sent.
- **Every call leaves one audit line**, without its arguments, its result or
  any token.
- **It runs where you run it**: over stdio, started by your client, or as one
  copy on loopback over Streamable HTTP, with a bearer token per client.
- **Tests never touch a real account.** Every outside dependency is a port with
  a fake, and the test environment has no credentials and no network.

## Status

The servers are used every day by the people who wrote them. They are not on
npm yet: until the first release publishes them (to npm, the MCP Registry, and
a Claude Desktop bundle for each), build them from source as above.

The Bolt Food and Glovo servers use those apps' unofficial web APIs, which can
change without notice; check the providers' terms before you use them.

## Documentation

- [Configuration](docs/configuration.md): the variables every server shares,
  and the conventions for the rest.
- [Deploying](docs/deploying.md): client configuration, the HTTP transport,
  and running a server as a systemd service.
- [Security](docs/security.md): the threat model, the guard every call passes,
  money and confirmation, files in and out.
- [Authentication](docs/auth.md): how clients, servers and the services behind
  them authenticate, and which options a deployment has.
- [Architecture](docs/architecture.md): how a server and the toolkit are built.
- [Roadmap](docs/feature-plan.md): what other MCP servers do that these do not
  yet, what is done, and what is still open.
- [Releasing](docs/releasing.md): how packages reach npm and the MCP Registry.

## Contributing

Fixes, new tools and new servers are welcome. [CONTRIBUTING.md](CONTRIBUTING.md)
has the setup, the house style and the README template, and `npm run check` is
the bar for a change. To report a vulnerability, please follow
[SECURITY.md](SECURITY.md) rather than opening a public issue.

## License

[MIT](LICENSE)

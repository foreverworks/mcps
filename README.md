# mcps

**MCP servers that let an AI assistant do a company's everyday work.** Most are
for services people use anywhere, such as Google Workspace, Notion, Bitwarden,
Porkbun, Expo, the app stores and European banks; a second line is for
companies in Romania, to file with ANAF, follow the trade register, invoice
through Oblio and read the National Bank's rates.

Each server connects an MCP client, such as Claude Code, Claude Desktop, VS Code
or Cursor, to one service. They are built on one toolkit, so every tool says
what it can change: `read` (it changes nothing), `write` (it changes something
in your account) or `money` (it moves money, makes or unmakes a legal or fiscal
document, or commits you in a comparable way, such as a bank consent). Your
client asks you before each `money` call.

<!-- servers:begin -->
Under each server's name: how settled it is, then how many tools it has and the most they can do. **Stable**: in daily use, and its tools keep their shape. **Beta**: works and is in use, but is new, still growing, or reads web pages its service may change. **Experimental**: rests on something that can break without notice, or covers only part of the service.

## For companies in Romania

The paperwork a company in Romania, and the people who run it, do online: e-invoices and declarations with ANAF, filings at the trade register, invoicing, and the National Bank's exchange rates. Each README ends with the other servers we found for that service, and what this one adds.

| Server | What it does |
|---|---|
| [<img src="servers/anaf-efactura/icons/icon.svg" width="20" height="20" alt=""> ANAF e-Factura](servers/anaf-efactura)<br><sub>Stable<br>20 tools, including **money**</sub> | Read, check and file a Romanian company's e-invoices and e-Transport declarations with ANAF. |
| [<img src="servers/anaf-spv/icons/icon.svg" width="20" height="20" alt=""> ANAF SPV](servers/anaf-spv)<br><sub>Beta<br>16 tools, including **money**</sub> | Download what ANAF posts to your SPV inbox, request documents, and validate or file declarations. |
| [<img src="servers/bnr/icons/icon.svg" width="20" height="20" alt=""> BNR exchange rates](servers/bnr)<br><sub>Stable<br>5 tools, read-only</sub> | Look up the National Bank of Romania's rate for any day, and convert amounts to and from RON. |
| [<img src="servers/oblio/icons/icon.svg" width="20" height="20" alt=""> Oblio](servers/oblio)<br><sub>Stable<br>17 tools, including **money**</sub> | Issue and track a Romanian company's invoices on Oblio, with totals computed as ANAF checks them. |
| [<img src="servers/onrc/icons/icon.svg" width="20" height="20" alt=""> ONRC trade register](servers/onrc)<br><sub>Beta<br>9 tools, read and write</sub> | Follow your filings at Romania's trade register, with their documents, fee notes and invoices. |

## For everyone

Servers for services people use anywhere. We built each one because the servers we found did less, or there were none; each README's last section names them and says what this one adds.

| Server | What it does |
|---|---|
| [<img src="servers/app-stores/icons/icon.svg" width="20" height="20" alt=""> App Store and Google Play](servers/app-stores)<br><sub>Beta<br>7 tools, read and write</sub> | Read and answer App Store and Google Play reviews, and see TestFlight feedback and crash logs. |
| [<img src="servers/bitwarden/icons/icon.svg" width="20" height="20" alt=""> Bitwarden](servers/bitwarden)<br><sub>Stable<br>11 tools, read and write</sub> | Give your assistant its own Bitwarden vault to create logins, type passwords and read 2FA codes. |
| [<img src="servers/eas/icons/icon.svg" width="20" height="20" alt=""> Expo Application Services](servers/eas)<br><sub>Beta<br>23 tools, including **money**</sub> | Find out why an Expo build, workflow run or store submission failed, and roll out updates. |
| [<img src="servers/enable-banking/icons/icon.svg" width="20" height="20" alt=""> Enable Banking](servers/enable-banking)<br><sub>Stable<br>10 tools, including **money**</sub> | Read, search and export statements and balances from banks across Europe, without moving money. |
| [<img src="servers/google/icons/icon.svg" width="20" height="20" alt=""> Google Workspace](servers/google)<br><sub>Stable<br>115 tools, read and write</sub> | Search and work in Gmail, Calendar, Drive, Docs, Sheets and Slides across several Google accounts. |
| [<img src="servers/notion/icons/icon.svg" width="20" height="20" alt=""> Notion](servers/notion)<br><sub>Stable<br>27 tools, read and write</sub> | Search, read and write your Notion workspaces, with pages as Markdown and typed database queries. |
| [<img src="servers/porkbun/icons/icon.svg" width="20" height="20" alt=""> Porkbun](servers/porkbun)<br><sub>Beta<br>113 tools, including **money**</sub> | Register domains and manage DNS, hosting and mail at Porkbun, with every purchase confirmed first. |
| [<img src="servers/trademarks/icons/icon.svg" width="20" height="20" alt=""> Trademark search](servers/trademarks)<br><sub>Beta<br>6 tools, read-only</sub> | Check whether a name is already a registered or pending trademark in the US or the EU. |
| [<img src="servers/typesafe/icons/icon.svg" width="20" height="20" alt=""> TypeSafe](servers/typesafe)<br><sub>Beta<br>3 tools, read-only</sub> | Get calibrated yes or no answers, choices and scores from TypeSafe's Jev, for one item or 1000 rows. |

## Extras

These work, and we use them, but each is built for one particular setup or on an app's unofficial API, so they are not published to npm, the MCP Registry or as desktop bundles. Run them from a clone, and read the README first: it says what the server depends on and what can break.

| Server | What it does |
|---|---|
| [<img src="servers/bolt-food/icons/icon.svg" width="20" height="20" alt=""> Bolt Food receipts](servers/bolt-food)<br><sub>Experimental<br>8 tools, read-only</sub> | Read your Bolt Food orders as itemised receipts matched to card charges, through an unofficial API. |
| [<img src="servers/devices/icons/icon.svg" width="20" height="20" alt=""> Device broker](servers/devices)<br><sub>Experimental<br>10 tools, read and write</sub> | Share your own Android emulators, iOS simulators and desktops between AI agents, in fair turns. |
| [<img src="servers/glovo/icons/icon.svg" width="20" height="20" alt=""> Glovo receipts](servers/glovo)<br><sub>Experimental<br>8 tools, read-only</sub> | Read your Glovo orders as itemised receipts matched to card charges, through an unofficial API. |
| [<img src="servers/printer/icons/icon.svg" width="20" height="20" alt=""> Printer and scanner](servers/printer)<br><sub>Experimental<br>10 tools, read and write</sub> | Print, scan and check paper and toner on a network printer, with greys corrected for that printer. |

## Shared packages

| Package | What it is |
|---|---|
| [mcp-kit](packages/mcp-kit) | Stdio and HTTP transports with per-client tokens, a guard that classifies, audits and can confirm every tool call, an HTTP and OAuth stack, exact decimals, and byte-exact file inputs |
| [receipts](packages/receipts)<br><sub>Not published: only extras use it</sub> | Itemised receipts, the join from a bank card charge to the order it paid, item search and CSV exports |
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

The servers are used every day by the people who wrote them. The servers for
Romania and for everyone are not on npm yet: until the first release publishes
them (to npm, the MCP Registry, and a Claude Desktop bundle for each), build
them from source as above. The [extras](#extras) are never published.

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

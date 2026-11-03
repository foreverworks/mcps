# Oblio

Issue and track a Romanian company's invoices on Oblio, with totals computed as ANAF checks them.

Free and open source, from [Forever Works](https://foreverworks.github.io/mcps/). It runs on your own computer, in Claude Code or Cursor, and [its documentation](https://foreverworks.github.io/mcps/servers/oblio/) walks you through setup, every tool, and what to do when something goes wrong.

## What you can ask

- "Which invoices from September are still unpaid?"
- "Invoice Client SRL for 8 hours of consulting at 1,000 RON an hour plus 21%
  VAT, due in 30 days."
- "Client SRL paid 1,000 EUR on invoice FCT 0042 by bank transfer today.
  Record it."
- "Turn proforma PRF 0007 into an invoice."
- "Reverse invoice FCT 0042, and keep the payment recorded on it."

## What it can change

It has 17 tools, and 7 of them are **money**, moving money or making or unmaking a legal or fiscal document: `create_invoice`, `invoice_from_proforma`, `collect_invoice`, `cancel_invoice`, `restore_invoice`, `reverse_invoice` and `delete_invoice`. Claude Code asks you before every call to a money tool, in every permission mode, and Cursor asks before any tool that is not read-only unless you have allowed it.

## Install

In Claude Code 2.1.275 or newer:

```
/plugin install foreverworks-oblio --marketplace foreverworks/mcps
```

This adds the repository's marketplace, `foreverworks-mcps`, and installs the plugin from it. In an older Claude Code, run `/plugin marketplace add foreverworks/mcps`, then `/plugin install foreverworks-oblio@foreverworks-mcps`.

## Settings

Claude Code asks for this setting when you enable the plugin; in Cursor, it is set in the dashboard under Plugins, Configure. The Configuration section of [its documentation](https://foreverworks.github.io/mcps/servers/oblio/#configuration) says how to get each one.

| Setting | Required | What it is |
|---|---|---|
| Oblio app.json (`OBLIO_CONFIG`) | yes | Path of app.json: your Oblio login email, API secret and the company's CIF, as the README describes it. |

## How it runs

The plugin starts the server on your computer with `npx -y @foreverworks/mcp-oblio@0.1.1`: the published npm package, at the exact version this plugin was made for, on Node 22.19 or newer.
The server sends requests only to the services its documentation names, from your computer, with the credentials you set above, so each service's own privacy policy covers what it receives.
Forever Works receives nothing: the server sends no telemetry and needs no account with us. The [privacy page](https://foreverworks.github.io/mcps/privacy/) says more.

## More

- [Documentation](https://foreverworks.github.io/mcps/servers/oblio/): setup, every tool, troubleshooting and limitations.
- [The server's README and source on GitHub](https://github.com/foreverworks/mcps/blob/main/servers/oblio/README.md).
- [Report a problem](https://github.com/foreverworks/mcps/issues).
- License: MIT, in [LICENSE](LICENSE).

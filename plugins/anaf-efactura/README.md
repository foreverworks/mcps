# ANAF e-Factura

Read, check and file a Romanian company's e-invoices and e-Transport declarations with ANAF.

Free and open source, from [Forever Works](https://foreverworks.github.io/mcps/). It runs on your own computer, in Claude Code or Cursor, and [its documentation](https://foreverworks.github.io/mcps/servers/anaf-efactura/) walks you through setup, every tool, and what to do when something goes wrong.

## What you can ask

- "Which invoices did suppliers send us in the last two weeks?"
- "Download the newest invoice we received, check ANAF's seal on it, and list
  its lines."
- "Is RO87654329 a VAT payer, and does it apply VAT on collection?"
- "Invoice Client SRL for 10 hours of consulting at 500 RON an hour plus 21%
  VAT, have ANAF validate it, and file it in the test environment."
- "How many days are left on our ANAF authorization?"

## What it can change

It has 20 tools, and 3 of them are **money**, moving money or making or unmaking a legal or fiscal document: `upload_invoice`, `upload_invoice_b2c` and `etransport_file`. Claude Code asks you before every call to a money tool, in every permission mode, and Cursor asks before any tool that is not read-only unless you have allowed it.

## Install

In Claude Code 2.1.275 or newer:

```
/plugin install foreverworks-anaf-efactura --marketplace foreverworks/mcps
```

This adds the repository's marketplace, `foreverworks-mcps`, and installs the plugin from it. In an older Claude Code, run `/plugin marketplace add foreverworks/mcps`, then `/plugin install foreverworks-anaf-efactura@foreverworks-mcps`.

## Settings

Claude Code asks for this setting when you enable the plugin; in Cursor, it is set in the dashboard under Plugins, Configure. The Configuration section of [its documentation](https://foreverworks.github.io/mcps/servers/anaf-efactura/#configuration) says how to get each one.

| Setting | Required | What it is |
|---|---|---|
| ANAF app.json (`ANAF_CONFIG`) | yes | Path of app.json: the OAuth app you registered with ANAF (its client id and secret, the callback URL) and the company's CIF, as the README shows. lookup_company, validate_invoice and parse_invoice work without it. |

## How it runs

The plugin starts the server on your computer with `npx -y @foreverworks/mcp-anaf-efactura@0.1.1`: the published npm package, at the exact version this plugin was made for, on Node 22.19 or newer.
The server sends requests only to the services its documentation names, from your computer, with the credentials you set above, so each service's own privacy policy covers what it receives.
Forever Works receives nothing: the server sends no telemetry and needs no account with us. The [privacy page](https://foreverworks.github.io/mcps/privacy/) says more.

## More

- [Documentation](https://foreverworks.github.io/mcps/servers/anaf-efactura/): setup, every tool, troubleshooting and limitations.
- [The server's README and source on GitHub](https://github.com/foreverworks/mcps/blob/main/servers/anaf-efactura/README.md).
- [Report a problem](https://github.com/foreverworks/mcps/issues).
- License: MIT, in [LICENSE](LICENSE).

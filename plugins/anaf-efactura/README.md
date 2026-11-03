# ANAF e-Factura plugin from Forever Works

Read, check and file a Romanian company's e-invoices and e-Transport declarations with ANAF. Read the invoices a company received and sent, check and render them, file new invoices and e-Transport declarations, and look up companies in the VAT registry.

This plugin adds the ANAF e-Factura MCP server from [Forever Works](https://foreverworks.github.io/mcps/) to Claude Code and Cursor. [Its documentation](https://foreverworks.github.io/mcps/servers/anaf-efactura/) says what you need before you start, what each tool does, and what to do when something goes wrong.

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

# Enable Banking

Read, search and export statements and balances from banks across Europe, without moving money.

Free and open source, from [Forever Works](https://foreverworks.github.io/mcps/). It runs on your own computer, in Claude Code or Cursor, and [its documentation](https://foreverworks.github.io/mcps/servers/enable-banking/) walks you through setup, every tool, and what to do when something goes wrong.

## What you can ask

- "Which bank consents do we have, and when does each one run out?"
- "What did we pay Example Supplier SRL this year?"
- "Show incoming payments over 1,000 RON in September, across all our
  accounts."
- "What is the available balance on our EUR account?"
- "Export last quarter's transactions as CSV for our accountant."
- "Our consent with Example Bank ends next week. Renew it."

## What it can change

It has 10 tools, and one of them is **money**, moving money or making or unmaking a legal or fiscal document: `start_auth`. Claude Code asks you before every call to a money tool, in every permission mode, and Cursor asks before any tool that is not read-only unless you have allowed it.

## Install

In Claude Code 2.1.275 or newer:

```
/plugin install foreverworks-enable-banking --marketplace foreverworks/mcps
```

This adds the repository's marketplace, `foreverworks-mcps`, and installs the plugin from it. In an older Claude Code, run `/plugin marketplace add foreverworks/mcps`, then `/plugin install foreverworks-enable-banking@foreverworks-mcps`.

## Settings

Claude Code asks for these settings when you enable the plugin; in Cursor, they are set in the dashboard under Plugins, Configure. The Configuration section of [its documentation](https://foreverworks.github.io/mcps/servers/enable-banking/#configuration) says how to get each one. Leave an optional one empty and the server uses its default.

| Setting | Required | What it is |
|---|---|---|
| Enable Banking app.json (`ENABLE_BANKING_CONFIG`) | yes | Path of app.json: your Enable Banking application's id, its redirect URL and the name of its private key file, as the README describes it. |
| Application private key (`ENABLE_BANKING_KEY`) | no | Path of the application's private key (PEM), when app.json does not name it. |

## How it runs

The plugin starts the server on your computer with `npx -y @foreverworks/mcp-enable-banking@0.1.1`: the published npm package, at the exact version this plugin was made for, on Node 22.19 or newer.
The server sends requests only to the services its documentation names, from your computer, with the credentials you set above, so each service's own privacy policy covers what it receives.
Forever Works receives nothing: the server sends no telemetry and needs no account with us. The [privacy page](https://foreverworks.github.io/mcps/privacy/) says more.

## More

- [Documentation](https://foreverworks.github.io/mcps/servers/enable-banking/): setup, every tool, troubleshooting and limitations.
- [The server's README and source on GitHub](https://github.com/foreverworks/mcps/blob/main/servers/enable-banking/README.md).
- [Report a problem](https://github.com/foreverworks/mcps/issues).
- License: MIT, in [LICENSE](LICENSE).

# Trademark search

Check whether a name is already a registered or pending trademark in the US or the EU.

Free and open source, from [Forever Works](https://foreverworks.github.io/mcps/). It runs on your own computer, in Claude Code or Cursor, and [its documentation](https://foreverworks.github.io/mcps/servers/trademarks/) walks you through setup, every tool, and what to do when something goes wrong.

## What you can ask

- "Is Turnip already a trademark for software, in the US or the EU?"
- "Search Blue Night in classes 9 and 42, dead marks included, and show me what
  sounds alike."
- "Which live US marks contain the word talon and cover mobile applications?"
- "What happened in the file of the closest US match? Was it opposed?"
- "Save the office actions in that mark's file since January 2025 as one PDF."

## What it can change

All 6 of its tools only read, so it cannot change anything.

## Install

In Claude Code 2.1.275 or newer:

```
/plugin install foreverworks-trademarks --marketplace foreverworks/mcps
```

This adds the repository's marketplace, `foreverworks-mcps`, and installs the plugin from it. In an older Claude Code, run `/plugin marketplace add foreverworks/mcps`, then `/plugin install foreverworks-trademarks@foreverworks-mcps`.

## Settings

Claude Code asks for these settings when you enable the plugin; in Cursor, they are set in the dashboard under Plugins, Configure. The Configuration section of [its documentation](https://foreverworks.github.io/mcps/servers/trademarks/#configuration) says how to get each one. Leave an optional one empty and the server uses its default.

| Setting | Required | What it is |
|---|---|---|
| USPTO TSDR API key file (`USPTO_TSDR_API_KEY_FILE`) | no | For US mark histories and documents: path of a file holding a USPTO TSDR API key. |
| EUIPO client id file (`EUIPO_CLIENT_ID_FILE`) | no | For EU marks: path of a file holding the EUIPO app's client id. |
| EUIPO client secret file (`EUIPO_CLIENT_SECRET_FILE`) | no | For EU marks: path of a file holding the EUIPO app's client secret. |

## How it runs

The plugin starts the server on your computer with `npx -y @foreverworks/mcp-trademarks@0.1.2`: the published npm package, at the exact version this plugin was made for, on Node 22.19 or newer.
The server sends requests only to the services its documentation names, from your computer, with the credentials you set above, so each service's own privacy policy covers what it receives.
Forever Works receives nothing: the server sends no telemetry and needs no account with us. The [privacy page](https://foreverworks.github.io/mcps/privacy/) says more.

## More

- [Documentation](https://foreverworks.github.io/mcps/servers/trademarks/): setup, every tool, troubleshooting and limitations.
- [The server's README and source on GitHub](https://github.com/foreverworks/mcps/blob/main/servers/trademarks/README.md).
- [Report a problem](https://github.com/foreverworks/mcps/issues).
- License: MIT, in [LICENSE](LICENSE).

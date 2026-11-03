# TypeSafe plugin from Forever Works

Get calibrated yes or no answers, choices and scores from TypeSafe's Jev, for one item or 1000 rows. Typed, calibrated judgments over text or JSON (a yes or no with its probability, one of a set, a score), one at a time or in batches.

This plugin adds the TypeSafe MCP server from [Forever Works](https://foreverworks.github.io/mcps/) to Claude Code and Cursor. [Its documentation](https://foreverworks.github.io/mcps/servers/typesafe/) says what you need before you start, what each tool does, and what to do when something goes wrong.

## What it can change

It has 3 tools, and every one only reads.

## Install

In Claude Code 2.1.275 or newer:

```
/plugin install foreverworks-typesafe --marketplace foreverworks/mcps
```

This adds the repository's marketplace, `foreverworks-mcps`, and installs the plugin from it. In an older Claude Code, run `/plugin marketplace add foreverworks/mcps`, then `/plugin install foreverworks-typesafe@foreverworks-mcps`.

## Settings

Claude Code asks for this setting when you enable the plugin; in Cursor, it is set in the dashboard under Plugins, Configure. The Configuration section of [its documentation](https://foreverworks.github.io/mcps/servers/typesafe/#configuration) says how to get each one.

| Setting | Required | What it is |
|---|---|---|
| API key file (`TYPESAFE_API_KEY_FILE`) | yes | Path of a file holding your TypeSafe API key. |

## How it runs

The plugin starts the server on your computer with `npx -y @foreverworks/mcp-typesafe@0.1.2`: the published npm package, at the exact version this plugin was made for, on Node 22.19 or newer.
The server sends requests only to the services its documentation names, from your computer, with the credentials you set above, so each service's own privacy policy covers what it receives.
Forever Works receives nothing: the server sends no telemetry and needs no account with us. The [privacy page](https://foreverworks.github.io/mcps/privacy/) says more.

## More

- [Documentation](https://foreverworks.github.io/mcps/servers/typesafe/): setup, every tool, troubleshooting and limitations.
- [The server's README and source on GitHub](https://github.com/foreverworks/mcps/blob/main/servers/typesafe/README.md).
- [Report a problem](https://github.com/foreverworks/mcps/issues).
- License: MIT, in [LICENSE](LICENSE).

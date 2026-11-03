# BNR exchange rates plugin from Forever Works

Look up the National Bank of Romania's rate for any day, and convert amounts to and from RON. The rate in force on any day, conversions to and from RON, rates over a period, and the yearly averages ANAF converts foreign income at.

This plugin adds the BNR exchange rates MCP server from [Forever Works](https://foreverworks.github.io/mcps/) to Claude Code and Cursor. [Its documentation](https://foreverworks.github.io/mcps/servers/bnr/) says what you need before you start, what each tool does, and what to do when something goes wrong.

## What it can change

It has 5 tools, and every one only reads.

## Install

In Claude Code 2.1.275 or newer:

```
/plugin install foreverworks-bnr --marketplace foreverworks/mcps
```

This adds the repository's marketplace, `foreverworks-mcps`, and installs the plugin from it. In an older Claude Code, run `/plugin marketplace add foreverworks/mcps`, then `/plugin install foreverworks-bnr@foreverworks-mcps`.

## Settings

It needs no settings.

## How it runs

The plugin starts the server on your computer with `npx -y @foreverworks/mcp-bnr@0.1.1`: the published npm package, at the exact version this plugin was made for, on Node 22.19 or newer.
The server sends requests only to the services its documentation names, from your computer, so each service's own privacy policy covers what it receives.
Forever Works receives nothing: the server sends no telemetry and needs no account with us. The [privacy page](https://foreverworks.github.io/mcps/privacy/) says more.

## More

- [Documentation](https://foreverworks.github.io/mcps/servers/bnr/): setup, every tool, troubleshooting and limitations.
- [The server's README and source on GitHub](https://github.com/foreverworks/mcps/blob/main/servers/bnr/README.md).
- [Report a problem](https://github.com/foreverworks/mcps/issues).
- License: MIT, in [LICENSE](LICENSE).

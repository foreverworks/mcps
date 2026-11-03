# BNR exchange rates

Look up the National Bank of Romania's rate for any day, and convert amounts to and from RON.

Free and open source, from [Forever Works](https://foreverworks.github.io/mcps/). It runs on your own computer, in Claude Code or Cursor, and [its documentation](https://foreverworks.github.io/mcps/servers/bnr/) walks you through setup, every tool, and what to do when something goes wrong.

## What you can ask

- "What was BNR's euro rate on 14 March 2025?"
- "Convert an invoice of 1,250.50 EUR dated 3 October 2026 to lei, at the
  last rate BNR published before that date."
- "How much is 10,000 HUF in RON today?"
- "Give me BNR's EUR and USD rates for every banking day of September 2026."
- "Which annual average USD rate goes into my D212 for 2025?"

## What it can change

All 5 of its tools only read, so it cannot change anything.

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

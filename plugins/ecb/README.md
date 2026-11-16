# ECB exchange rates

Look up the European Central Bank's euro rate for any day, and convert between any two currencies.

Free and open source, from [Forever Works](https://foreverworks.github.io/mcps/). It runs on your own computer, in Claude Code or Cursor, and [its documentation](https://foreverworks.github.io/mcps/servers/ecb/) walks you through setup, every tool, and what to do when something goes wrong.

## What you can ask

- "What was the ECB's euro to dollar rate on 14 March 2025?"
- "Convert an invoice of 1,250.50 GBP dated 3 October 2025 to US dollars at the
  ECB's rate for that day, and show me the rates you used."
- "How many euros was 10,000 Hungarian forint worth today?"
- "Give me the ECB's USD and JPY rates for every working day of September 2025."
- "Which rate did the ECB publish for the Croatian kuna on its last day?"

## What it can change

All 4 of its tools only read, so it cannot change anything.

## Install

In Claude Code 2.1.275 or newer:

```
/plugin install foreverworks-ecb --marketplace foreverworks/mcps
```

This adds the repository's marketplace, `foreverworks-mcps`, and installs the plugin from it. In an older Claude Code, run `/plugin marketplace add foreverworks/mcps`, then `/plugin install foreverworks-ecb@foreverworks-mcps`.

## Settings

It needs no settings.

## How it runs

The plugin starts the server on your computer with `npx -y @foreverworks/mcp-ecb@0.1.0`: the published npm package, at the exact version this plugin was made for, on Node 22.19 or newer.
The server sends requests only to the services its documentation names, from your computer, so each service's own privacy policy covers what it receives.
Forever Works receives nothing: the server sends no telemetry and needs no account with us. The [privacy page](https://foreverworks.github.io/mcps/privacy/) says more.

## More

- [Documentation](https://foreverworks.github.io/mcps/servers/ecb/): setup, every tool, troubleshooting and limitations.
- [The server's README and source on GitHub](https://github.com/foreverworks/mcps/blob/main/servers/ecb/README.md).
- [Report a problem](https://github.com/foreverworks/mcps/issues).
- License: MIT, in [LICENSE](LICENSE).

# ONRC trade register

Follow your filings at Romania's trade register, with their documents, fee notes and invoices.

Free and open source, from [Forever Works](https://foreverworks.github.io/mcps/). It runs on your own computer, in Claude Code or Cursor, and [its documentation](https://foreverworks.github.io/mcps/servers/onrc/) walks you through setup, every tool, and what to do when something goes wrong.

## What you can ask

- "Which of my ONRC filings are still being worked on?"
- "What is the status of the mențiune I filed for Client SRL in September, and
  when will its documents be released?"
- "Which documents are in the file of my latest filing?"
- "Do I have any ONRC fee notes I have not paid yet?"
- "How much is outstanding on my ONRC invoices this year?"

## What it can change

It has 9 tools. Some of them change things in your account, and none moves money.

## Install

In Claude Code 2.1.275 or newer:

```
/plugin install foreverworks-onrc --marketplace foreverworks/mcps
```

This adds the repository's marketplace, `foreverworks-mcps`, and installs the plugin from it. In an older Claude Code, run `/plugin marketplace add foreverworks/mcps`, then `/plugin install foreverworks-onrc@foreverworks-mcps`.

## Settings

It needs no settings.

## How it runs

The plugin starts the server on your computer with `npx -y @foreverworks/mcp-onrc@0.1.2`: the published npm package, at the exact version this plugin was made for, on Node 22.19 or newer.
The server sends requests only to the services its documentation names, from your computer, so each service's own privacy policy covers what it receives.
Forever Works receives nothing: the server sends no telemetry and needs no account with us. The [privacy page](https://foreverworks.github.io/mcps/privacy/) says more.

## More

- [Documentation](https://foreverworks.github.io/mcps/servers/onrc/): setup, every tool, troubleshooting and limitations.
- [The server's README and source on GitHub](https://github.com/foreverworks/mcps/blob/main/servers/onrc/README.md).
- [Report a problem](https://github.com/foreverworks/mcps/issues).
- License: MIT, in [LICENSE](LICENSE).

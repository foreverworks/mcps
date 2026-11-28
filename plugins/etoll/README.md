# eToll (rovinietă)

Check your cars' rovinietă on eToll, read its invoices, and buy a vignette you pay by card yourself.

Free and open source, from [Forever Works](https://foreverworks.github.io/mcps/). It runs on your own computer, in Claude Code or Cursor, and [its documentation](https://foreverworks.github.io/mcps/servers/etoll/) walks you through setup, every tool, and what to do when something goes wrong.

## What you can ask

- "Until when is the rovinietă on B123ABC valid?"
- "Which of my cars need a new vignette this month?"
- "How much is a 12-month rovinietă for B123ABC, starting the day after the current one ends?"
- "Buy it, billed to my company."
- "Did the payment for that vignette go through?"
- "Download my eToll invoices from this year."

## What it can change

It has 15 tools, and one of them is **money**, moving money or making or unmaking a legal or fiscal document: `place_order`. Claude Code asks you before every call to a money tool, in every permission mode, and Cursor asks before any tool that is not read-only unless you have allowed it.

## Install

In Claude Code 2.1.275 or newer:

```
/plugin install foreverworks-etoll --marketplace foreverworks/mcps
```

This adds the repository's marketplace, `foreverworks-mcps`, and installs the plugin from it. In an older Claude Code, run `/plugin marketplace add foreverworks/mcps`, then `/plugin install foreverworks-etoll@foreverworks-mcps`.

## Settings

Claude Code asks for these settings when you enable the plugin; in Cursor, they are set in the dashboard under Plugins, Configure. The Configuration section of [its documentation](https://foreverworks.github.io/mcps/servers/etoll/#configuration) says how to get each one. Leave an optional one empty and the server uses its default.

| Setting | Required | What it is |
|---|---|---|
| eToll user name (`ETOLL_USERNAME`) | no | The e-mail address or phone number you sign in to eToll with; leave empty to sign in through the browser instead. |
| eToll password file (`ETOLL_PASSWORD_FILE`) | no | Path of a file holding only your eToll password; leave empty to sign in through the browser instead. |

## How it runs

The plugin starts the server on your computer with `npx -y @foreverworks/mcp-etoll@0.1.2`: the published npm package, at the exact version this plugin was made for, on Node 22.19 or newer.
The server sends requests only to the services its documentation names, from your computer, with the credentials you set above, so each service's own privacy policy covers what it receives.
Forever Works receives nothing: the server sends no telemetry and needs no account with us. The [privacy page](https://foreverworks.github.io/mcps/privacy/) says more.

## More

- [Documentation](https://foreverworks.github.io/mcps/servers/etoll/): setup, every tool, troubleshooting and limitations.
- [The server's README and source on GitHub](https://github.com/foreverworks/mcps/blob/main/servers/etoll/README.md).
- [Report a problem](https://github.com/foreverworks/mcps/issues).
- License: MIT, in [LICENSE](LICENSE).

# TypeSafe

Get calibrated yes or no answers, choices and scores from TypeSafe's Jev, for one item or 1000 rows.

Free and open source, from [Forever Works](https://foreverworks.github.io/mcps/). It runs on your own computer, in Claude Code or Cursor, and [its documentation](https://foreverworks.github.io/mcps/servers/typesafe/) walks you through setup, every tool, and what to do when something goes wrong.

## What you can ask

- "Go through the 300 postings in postings.jsonl and list the remote senior
  roles, with how sure Jev is of each."
- "Is this support email urgent, and which team should take it: billing,
  technical or sales?"
- "Sort last month's 600 card transactions into groceries, transport, software
  or other, and count each."
- "Rate these 40 reviews on how likely the customer is to leave, and show me
  the ten most at risk."
- "Which of these passages answer 'how do I reset my password'? Flag the ones
  Jev is unsure about for me to read."

## What it can change

All 3 of its tools only read, so it cannot change anything.

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

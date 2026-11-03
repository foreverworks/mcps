# Google Workspace plugin from Forever Works

Search and work in Gmail, Calendar, Drive, Docs, Sheets and Slides across several Google accounts. Gmail, Calendar, Drive, Docs, Sheets, Slides, Tasks, contacts and Meet transcripts.

This plugin adds the Google Workspace MCP server from [Forever Works](https://foreverworks.github.io/mcps/) to Claude Code and Cursor. [Its documentation](https://foreverworks.github.io/mcps/servers/google/) says what you need before you start, what each tool does, and what to do when something goes wrong.

## What it can change

It has 115 tools. Some of them change things in your account, and none moves money.

## Install

In Claude Code 2.1.275 or newer:

```
/plugin install foreverworks-google --marketplace foreverworks/mcps
```

This adds the repository's marketplace, `foreverworks-mcps`, and installs the plugin from it. In an older Claude Code, run `/plugin marketplace add foreverworks/mcps`, then `/plugin install foreverworks-google@foreverworks-mcps`.

## Settings

Claude Code asks for these settings when you enable the plugin; in Cursor, they are set in the dashboard under Plugins, Configure. The Configuration section of [its documentation](https://foreverworks.github.io/mcps/servers/google/#configuration) says how to get each one. Leave an optional one empty and the server uses its default.

| Setting | Required | What it is |
|---|---|---|
| Calendar time zone (`CALENDAR_TIME_ZONE`) | no | The time zone a time without an offset is read in, e.g. Europe/Paris. |
| Products to load (`GOOGLE_TOOLSETS`) | no | The products whose tools the server loads, separated by commas, e.g. gmail,calendar. Empty loads every product. |

## How it runs

The plugin starts the server on your computer with `npx -y @foreverworks/mcp-google@0.2.0`: the published npm package, at the exact version this plugin was made for, on Node 22.19 or newer.
The server sends requests only to the services its documentation names, from your computer, with the credentials you set above, so each service's own privacy policy covers what it receives.
Forever Works receives nothing: the server sends no telemetry and needs no account with us. The [privacy page](https://foreverworks.github.io/mcps/privacy/) says more.

## More

- [Documentation](https://foreverworks.github.io/mcps/servers/google/): setup, every tool, troubleshooting and limitations.
- [The server's README and source on GitHub](https://github.com/foreverworks/mcps/blob/main/servers/google/README.md).
- [Report a problem](https://github.com/foreverworks/mcps/issues).
- License: MIT, in [LICENSE](LICENSE).

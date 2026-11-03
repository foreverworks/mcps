# Notion plugin from Forever Works

Search, read and write your Notion workspaces, with pages as Markdown and typed database queries. Search, pages read and written as Markdown, typed database queries, saved views, comments and files.

This plugin adds the Notion MCP server from [Forever Works](https://foreverworks.github.io/mcps/) to Claude Code and Cursor. [Its documentation](https://foreverworks.github.io/mcps/servers/notion/) says what you need before you start, what each tool does, and what to do when something goes wrong.

## What it can change

It has 27 tools. Some of them change things in your account, and none moves money.

## Install

In Claude Code 2.1.275 or newer:

```
/plugin install foreverworks-notion --marketplace foreverworks/mcps
```

This adds the repository's marketplace, `foreverworks-mcps`, and installs the plugin from it. In an older Claude Code, run `/plugin marketplace add foreverworks/mcps`, then `/plugin install foreverworks-notion@foreverworks-mcps`.

## Settings

Claude Code asks for this setting when you enable the plugin; in Cursor, it is set in the dashboard under Plugins, Configure. The Configuration section of [its documentation](https://foreverworks.github.io/mcps/servers/notion/#configuration) says how to get each one.

| Setting | Required | What it is |
|---|---|---|
| Notion tokens folder (`NOTION_TOKENS_DIR`) | yes | A folder holding one file per workspace, notion-<label>, each with that workspace's integration token or personal access token. |

## How it runs

The plugin starts the server on your computer with `npx -y @foreverworks/mcp-notion@0.1.1`: the published npm package, at the exact version this plugin was made for, on Node 22.19 or newer.
The server sends requests only to the services its documentation names, from your computer, with the credentials you set above, so each service's own privacy policy covers what it receives.
Forever Works receives nothing: the server sends no telemetry and needs no account with us. The [privacy page](https://foreverworks.github.io/mcps/privacy/) says more.

## More

- [Documentation](https://foreverworks.github.io/mcps/servers/notion/): setup, every tool, troubleshooting and limitations.
- [The server's README and source on GitHub](https://github.com/foreverworks/mcps/blob/main/servers/notion/README.md).
- [Report a problem](https://github.com/foreverworks/mcps/issues).
- License: MIT, in [LICENSE](LICENSE).

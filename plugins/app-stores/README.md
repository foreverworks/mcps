# App Store and Google Play plugin from Forever Works

Read and answer App Store and Google Play reviews, and see TestFlight feedback and crash logs. Read and answer App Store and Play reviews, and read TestFlight feedback and crash logs.

This plugin adds the App Store and Google Play MCP server from [Forever Works](https://foreverworks.github.io/mcps/) to Claude Code and Cursor. [Its documentation](https://foreverworks.github.io/mcps/servers/app-stores/) says what you need before you start, what each tool does, and what to do when something goes wrong.

## What it can change

It has 7 tools. Some of them change things in your account, and none moves money.

## Install

In Claude Code 2.1.275 or newer:

```
/plugin install foreverworks-app-stores --marketplace foreverworks/mcps
```

This adds the repository's marketplace, `foreverworks-mcps`, and installs the plugin from it. In an older Claude Code, run `/plugin marketplace add foreverworks/mcps`, then `/plugin install foreverworks-app-stores@foreverworks-mcps`.

## Settings

Claude Code asks for these settings when you enable the plugin; in Cursor, they are set in the dashboard under Plugins, Configure. The Configuration section of [its documentation](https://foreverworks.github.io/mcps/servers/app-stores/#configuration) says how to get each one. Leave an optional one empty and the server uses its default.

| Setting | Required | What it is |
|---|---|---|
| App Store Connect key id (`ASC_KEY_ID`) | no | For the App Store: the App Store Connect API key's id (10 characters). |
| App Store Connect issuer id (`ASC_ISSUER_ID`) | no | For the App Store: the issuer id App Store Connect shows above your team keys. |
| App Store Connect key (.p8) (`ASC_PRIVATE_KEY_FILE`) | no | For the App Store: path of the .p8 key file App Store Connect let you download. |
| Google Play service account key (`PLAY_SERVICE_ACCOUNT_FILE`) | no | For Google Play: path of the service account's JSON key. |
| Google Play package names (`PLAY_PACKAGES`) | no | For Google Play: the package names to answer for, comma-separated, e.g. com.example.app. |

## How it runs

The plugin starts the server on your computer with `npx -y @foreverworks/mcp-app-stores@0.1.2`: the published npm package, at the exact version this plugin was made for, on Node 22.19 or newer.
The server sends requests only to the services its documentation names, from your computer, with the credentials you set above, so each service's own privacy policy covers what it receives.
Forever Works receives nothing: the server sends no telemetry and needs no account with us. The [privacy page](https://foreverworks.github.io/mcps/privacy/) says more.

## More

- [Documentation](https://foreverworks.github.io/mcps/servers/app-stores/): setup, every tool, troubleshooting and limitations.
- [The server's README and source on GitHub](https://github.com/foreverworks/mcps/blob/main/servers/app-stores/README.md).
- [Report a problem](https://github.com/foreverworks/mcps/issues).
- License: MIT, in [LICENSE](LICENSE).

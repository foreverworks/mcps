# Bitwarden plugin from Forever Works

Give your assistant its own Bitwarden vault for logins, passwords, 2FA codes and passkeys. Find, create and update logins, store secure notes, generate and hand out passwords, compute 2FA codes, check passwords against known breaches, and register and sign in with passkeys.

This plugin adds the Bitwarden MCP server from [Forever Works](https://foreverworks.github.io/mcps/) to Claude Code and Cursor. [Its documentation](https://foreverworks.github.io/mcps/servers/bitwarden/) says what you need before you start, what each tool does, and what to do when something goes wrong.

## What it can change

It has 17 tools. Some of them change things in your account, and none moves money.

## Install

In Claude Code 2.1.275 or newer:

```
/plugin install foreverworks-bitwarden --marketplace foreverworks/mcps
```

This adds the repository's marketplace, `foreverworks-mcps`, and installs the plugin from it. In an older Claude Code, run `/plugin marketplace add foreverworks/mcps`, then `/plugin install foreverworks-bitwarden@foreverworks-mcps`.

## Settings

Claude Code asks for these settings when you enable the plugin; in Cursor, they are set in the dashboard under Plugins, Configure. The Configuration section of [its documentation](https://foreverworks.github.io/mcps/servers/bitwarden/#configuration) says how to get each one. Leave an optional one empty and the server uses its default.

| Setting | Required | What it is |
|---|---|---|
| API key client id file (`BITWARDEN_CLIENT_ID_FILE`) | yes | Path of a file holding the account's API key client id. |
| API key client secret file (`BITWARDEN_CLIENT_SECRET_FILE`) | yes | Path of a file holding the API key's client secret. |
| Master password file (`BITWARDEN_MASTER_PASSWORD_FILE`) | yes | Path of a file holding the master password that unlocks the vault. |
| Bitwarden server (`BITWARDEN_SERVER`) | no | A self-hosted or EU server, e.g. https://vault.bitwarden.eu. Leave empty for bitwarden.com. |

## How it runs

The plugin starts the server on your computer with `npx -y @foreverworks/mcp-bitwarden@0.2.1`: the published npm package, at the exact version this plugin was made for, on Node 22.19 or newer.
The server sends requests only to the services its documentation names, from your computer, with the credentials you set above, so each service's own privacy policy covers what it receives.
Forever Works receives nothing: the server sends no telemetry and needs no account with us. The [privacy page](https://foreverworks.github.io/mcps/privacy/) says more.

## More

- [Documentation](https://foreverworks.github.io/mcps/servers/bitwarden/): setup, every tool, troubleshooting and limitations.
- [The server's README and source on GitHub](https://github.com/foreverworks/mcps/blob/main/servers/bitwarden/README.md).
- [Report a problem](https://github.com/foreverworks/mcps/issues).
- License: MIT, in [LICENSE](LICENSE).

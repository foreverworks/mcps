# Bitwarden

Give your assistant its own Bitwarden vault for logins, passwords, 2FA codes and passkeys.

Free and open source, from [Forever Works](https://foreverworks.github.io/mcps/). It runs on your own computer, in Claude Code or Cursor, and [its documentation](https://foreverworks.github.io/mcps/servers/bitwarden/) walks you through setup, every tool, and what to do when something goes wrong.

## What you can ask

- "Create a login for example.com with the username bot@example.com and a
  32-character password without symbols."
- "Which logins do we have saved for example.com?"
- "What is the current 2FA code for the Example Shop login?"
- "Generate a new password for the Example Shop login, and keep the old one in
  case the site refuses the change."
- "Is the password of any of our Example Cloud logins in a known breach?"
- "Store the key in example-key.json as a secure note called 'Example Cloud
  deploy key'."
- "Move the Example Shop login into the Shared collection."
- "Which passkeys does the vault hold for example.com?"
- "Import the passkeys in example-export.json, then delete the file."

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

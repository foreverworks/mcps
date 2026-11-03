# Expo Application Services

Find out why an Expo build, workflow run or store submission failed, and roll out updates.

Free and open source, from [Forever Works](https://foreverworks.github.io/mcps/). It runs on your own computer, in Claude Code or Cursor, and [its documentation](https://foreverworks.github.io/mcps/servers/eas/) walks you through setup, every tool, and what to do when something goes wrong.

## What you can ask

- "Why did the last iOS workflow run of @acme/my-app fail?"
- "Does every iOS bundle have a key set for TestFlight submissions, and does
  any certificate expire in the next 30 days?"
- "Run ios-beta.yml on main and tell me when it finishes."
- "Which fingerprints have updates but no build yet?"
- "Promote the latest update on the staging branch to production."
- "Raise the rollout of the latest production update to 50%."

## What it can change

It has 23 tools, and one of them is **money**, moving money or making or unmaking a legal or fiscal document: `dispatch_workflow`. Claude Code asks you before every call to a money tool, in every permission mode, and Cursor asks before any tool that is not read-only unless you have allowed it.

## Install

In Claude Code 2.1.275 or newer:

```
/plugin install foreverworks-eas --marketplace foreverworks/mcps
```

This adds the repository's marketplace, `foreverworks-mcps`, and installs the plugin from it. In an older Claude Code, run `/plugin marketplace add foreverworks/mcps`, then `/plugin install foreverworks-eas@foreverworks-mcps`.

## Settings

Claude Code asks for these settings when you enable the plugin; in Cursor, they are set in the dashboard under Plugins, Configure. The Configuration section of [its documentation](https://foreverworks.github.io/mcps/servers/eas/#configuration) says how to get each one. Leave an optional one empty and the server uses its default.

| Setting | Required | What it is |
|---|---|---|
| Expo token file (`EXPO_TOKEN_FILE`) | yes | Path of a file holding an Expo access token. |
| Default project (`EAS_PROJECT`) | no | The project a call means when it names none, as @account/slug. |

## How it runs

The plugin starts the server on your computer with `npx -y @foreverworks/mcp-eas@0.1.2`: the published npm package, at the exact version this plugin was made for, on Node 22.19 or newer.
The server sends requests only to the services its documentation names, from your computer, with the credentials you set above, so each service's own privacy policy covers what it receives.
Forever Works receives nothing: the server sends no telemetry and needs no account with us. The [privacy page](https://foreverworks.github.io/mcps/privacy/) says more.

## More

- [Documentation](https://foreverworks.github.io/mcps/servers/eas/): setup, every tool, troubleshooting and limitations.
- [The server's README and source on GitHub](https://github.com/foreverworks/mcps/blob/main/servers/eas/README.md).
- [Report a problem](https://github.com/foreverworks/mcps/issues).
- License: MIT, in [LICENSE](LICENSE).

# Home Assistant

Read your Home Assistant's states, areas and history, and run its actions, approving locks first.

Free and open source, from [Forever Works](https://foreverworks.github.io/mcps/). It runs on your own computer, in Claude Code or Cursor, and [its documentation](https://foreverworks.github.io/mcps/servers/home-assistant/) walks you through setup, every tool, and what to do when something goes wrong.

## What you can ask

- "Which lights are on right now?"
- "How did the living room temperature change overnight?"
- "Who or what unlocked the front door this morning?"
- "Which devices are in the hallway?"
- "Dim the kitchen light to 30 percent."
- "Lock the front door." (you approve it first)

## What it can change

It has 10 tools. Some of them change things in your account, and none moves money.

## Install

In Claude Code 2.1.275 or newer:

```
/plugin install foreverworks-home-assistant --marketplace foreverworks/mcps
```

This adds the repository's marketplace, `foreverworks-mcps`, and installs the plugin from it. In an older Claude Code, run `/plugin marketplace add foreverworks/mcps`, then `/plugin install foreverworks-home-assistant@foreverworks-mcps`.

## Settings

Claude Code asks for these settings when you enable the plugin; in Cursor, they are set in the dashboard under Plugins, Configure. The Configuration section of [its documentation](https://foreverworks.github.io/mcps/servers/home-assistant/#configuration) says how to get each one. Leave an optional one empty and the server uses its default.

| Setting | Required | What it is |
|---|---|---|
| Home Assistant address (`HOME_ASSISTANT_URL`) | yes | The address you open Home Assistant at, such as http://homeassistant.local:8123. |
| Long-lived access token file (`HOME_ASSISTANT_TOKEN_FILE`) | yes | Path of a file holding a long-lived access token made in an administrator's Home Assistant profile. |
| Domains to confirm (`HOME_ASSISTANT_CONFIRM_DOMAINS`) | no | Action domains you approve call by call, comma-separated (default lock,alarm_control_panel,cover,valve; none for none). |

## How it runs

The plugin starts the server on your computer with `npx -y @foreverworks/mcp-home-assistant@0.1.2`: the published npm package, at the exact version this plugin was made for, on Node 22.19 or newer.
The server sends requests only to the services its documentation names, from your computer, with the credentials you set above, so each service's own privacy policy covers what it receives.
Forever Works receives nothing: the server sends no telemetry and needs no account with us. The [privacy page](https://foreverworks.github.io/mcps/privacy/) says more.

## More

- [Documentation](https://foreverworks.github.io/mcps/servers/home-assistant/): setup, every tool, troubleshooting and limitations.
- [The server's README and source on GitHub](https://github.com/foreverworks/mcps/blob/main/servers/home-assistant/README.md).
- [Report a problem](https://github.com/foreverworks/mcps/issues).
- License: MIT, in [LICENSE](LICENSE).

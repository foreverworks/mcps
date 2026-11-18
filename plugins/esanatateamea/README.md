# eSănătateaMea

Read your Romanian health records: insurance, prescriptions, paid care, documents and appointments.

Free and open source, from [Forever Works](https://foreverworks.github.io/mcps/). It runs on your own computer, in Claude Code or Cursor, and [its documentation](https://foreverworks.github.io/mcps/servers/esanatateamea/) walks you through setup, every tool, and what to do when something goes wrong.

## What you can ask

- "Am I insured right now, and until when?"
- "Which prescriptions did I get this year, and how much did I pay at the pharmacy?"
- "What did CNAS pay for my medical care in the last twelve months, and at which clinics?"
- "Do I have an unused referral? Save it as a PDF."
- "What does my emergency summary say, and who are my emergency contacts?"
- "When is my next appointment, and where?"

## What it can change

It has 13 tools. Some of them change things in your account, and none moves money.

## Install

In Claude Code 2.1.275 or newer:

```
/plugin install foreverworks-esanatateamea --marketplace foreverworks/mcps
```

This adds the repository's marketplace, `foreverworks-mcps`, and installs the plugin from it. In an older Claude Code, run `/plugin marketplace add foreverworks/mcps`, then `/plugin install foreverworks-esanatateamea@foreverworks-mcps`.

## Settings

Claude Code asks for these settings when you enable the plugin; in Cursor, they are set in the dashboard under Plugins, Configure. The Configuration section of [its documentation](https://foreverworks.github.io/mcps/servers/esanatateamea/#configuration) says how to get each one. Leave an optional one empty and the server uses its default.

| Setting | Required | What it is |
|---|---|---|
| eSănătateaMea e-mail (`ESANATATEAMEA_USERNAME`) | no | The e-mail address you sign in to eSănătateaMea with; leave empty to sign in with ROeID instead. |
| eSănătateaMea password file (`ESANATATEAMEA_PASSWORD_FILE`) | no | Path of a file holding only your eSănătateaMea password; leave empty to sign in with ROeID instead. |
| Authenticator key file (`ESANATATEAMEA_TOTP_SECRET_FILE`) | no | Path of a file holding the authenticator app's key for the account, so the server types the six-digit code itself; leave empty to be asked for the code. |

## How it runs

The plugin starts the server on your computer with `npx -y @foreverworks/mcp-esanatateamea@0.1.0`: the published npm package, at the exact version this plugin was made for, on Node 22.19 or newer.
The server sends requests only to the services its documentation names, from your computer, with the credentials you set above, so each service's own privacy policy covers what it receives.
Forever Works receives nothing: the server sends no telemetry and needs no account with us. The [privacy page](https://foreverworks.github.io/mcps/privacy/) says more.

## More

- [Documentation](https://foreverworks.github.io/mcps/servers/esanatateamea/): setup, every tool, troubleshooting and limitations.
- [The server's README and source on GitHub](https://github.com/foreverworks/mcps/blob/main/servers/esanatateamea/README.md).
- [Report a problem](https://github.com/foreverworks/mcps/issues).
- License: MIT, in [LICENSE](LICENSE).

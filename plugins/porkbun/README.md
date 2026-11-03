# Porkbun

Register domains and manage DNS, hosting and mail at Porkbun, with every purchase confirmed first.

Free and open source, from [Forever Works](https://foreverworks.github.io/mcps/). It runs on your own computer, in Claude Code or Cursor, and [its documentation](https://foreverworks.github.io/mcps/servers/porkbun/) walks you through setup, every tool, and what to do when something goes wrong.

## What you can ask

- "Which of my domains expire in the next three months, and which of those
  have auto-renew off?"
- "Is talonbakery.com available? If it costs less than $15 a year, register
  it."
- "Back up the DNS of example.com, then point shop.example.com at
  203.0.113.10."
- "Publish the site in ./dist to example.com's static hosting."
- "If I moved example.org to my Cloudflare account, which DNS records would be
  dropped?"
- "Save last month's Porkbun invoice as a PDF."

## What it can change

It has 113 tools, and 20 of them are **money**, moving money or making or unmaking a legal or fiscal document: `buy_closeout`, `cancel_transfer`, `configure_auto_topup`, `create_hosting`, `create_mailbox`, `create_webhook`, `create_wp_credentials`, `get_ssl_bundle`, `register_domain`, `renew_domain`, `renew_mailbox`, `rotate_webhook_secret`, `set_email_password`, `setup_mailbox`, `start_transfer`, `top_up_account_credit`, `top_up_with_card_mpp`, `transfer_domain`, `update_auto_renew` and `update_contacts`. Claude Code asks you before every call to a money tool, in every permission mode, and Cursor asks before any tool that is not read-only unless you have allowed it.

## Install

In Claude Code 2.1.275 or newer:

```
/plugin install foreverworks-porkbun --marketplace foreverworks/mcps
```

This adds the repository's marketplace, `foreverworks-mcps`, and installs the plugin from it. In an older Claude Code, run `/plugin marketplace add foreverworks/mcps`, then `/plugin install foreverworks-porkbun@foreverworks-mcps`.

## Settings

Claude Code asks for these settings when you enable the plugin; in Cursor, they are set in the dashboard under Plugins, Configure. The Configuration section of [its documentation](https://foreverworks.github.io/mcps/servers/porkbun/#configuration) says how to get each one. Leave an optional one empty and the server uses its default.

| Setting | Required | What it is |
|---|---|---|
| API key file (`PORKBUN_API_KEY_FILE`) | yes | Path of a file holding your Porkbun API key (pk1_...). |
| Secret API key file (`PORKBUN_SECRET_API_KEY_FILE`) | yes | Path of a file holding your Porkbun secret API key (sk1_...). |
| Folder for saved files (`PORKBUN_OUTBOX_DIR`) | no | Where the tools that save a file (an SSL bundle, an invoice PDF, a DNS zone export, a new mailbox's password) write it. Without it those tools answer with a configuration error; every other tool works. |
| Toolsets to load (`PORKBUN_TOOLSETS`) | no | The toolsets whose tools the server loads, separated by commas, e.g. dns,forwards. Empty loads every toolset. |

## How it runs

The plugin starts the server on your computer with `npx -y @foreverworks/mcp-porkbun@0.1.2`: the published npm package, at the exact version this plugin was made for, on Node 22.19 or newer.
The server sends requests only to the services its documentation names, from your computer, with the credentials you set above, so each service's own privacy policy covers what it receives.
Forever Works receives nothing: the server sends no telemetry and needs no account with us. The [privacy page](https://foreverworks.github.io/mcps/privacy/) says more.

## More

- [Documentation](https://foreverworks.github.io/mcps/servers/porkbun/): setup, every tool, troubleshooting and limitations.
- [The server's README and source on GitHub](https://github.com/foreverworks/mcps/blob/main/servers/porkbun/README.md).
- [Report a problem](https://github.com/foreverworks/mcps/issues).
- License: MIT, in [LICENSE](LICENSE).

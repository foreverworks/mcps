# ANAF SPV

Download what ANAF posts to your SPV inbox, request documents, and validate or file declarations.

Free and open source, from [Forever Works](https://foreverworks.github.io/mcps/). It runs on your own computer, in Claude Code or Cursor, and [its documentation](https://foreverworks.github.io/mcps/servers/anaf-spv/) walks you through setup, every tool, and what to do when something goes wrong.

## What you can ask

- "Is there anything new from ANAF in my SPV?"
- "Download the decision ANAF posted last week into my 2026-10 folder."
- "Ask ANAF for my Obligatii de plata statement and save it when it arrives."
- "Save every SPV document I have not saved yet."
- "Check the D300 for September in d300-2026-09.xml with ANAF's validator.
  How much VAT does it make payable?"
- "What is the status of the filing INTERNT-123456789-2026?"

## What it can change

It has 16 tools, and one of them is **money**, moving money or making or unmaking a legal or fiscal document: `submit_declaration`. Claude Code asks you before every call to a money tool, in every permission mode, and Cursor asks before any tool that is not read-only unless you have allowed it.

## Install

In Claude Code 2.1.275 or newer:

```
/plugin install foreverworks-anaf-spv --marketplace foreverworks/mcps
```

This adds the repository's marketplace, `foreverworks-mcps`, and installs the plugin from it. In an older Claude Code, run `/plugin marketplace add foreverworks/mcps`, then `/plugin install foreverworks-anaf-spv@foreverworks-mcps`.

## Settings

Claude Code asks for these settings when you enable the plugin; in Cursor, they are set in the dashboard under Plugins, Configure. The Configuration section of [its documentation](https://foreverworks.github.io/mcps/servers/anaf-spv/#configuration) says how to get each one. Leave an optional one empty and the server uses its default.

| Setting | Required | What it is |
|---|---|---|
| SPV user name (`ANAF_SPV_USERNAME`) | no | Your SPV user name, when the password comes from a file. |
| SPV password file (`ANAF_SPV_PASSWORD_FILE`) | no | Path of a file holding your SPV password. The README also shows how to read it from a vault MCP server instead. |
| Mail MCP server URL (`ANAF_SPV_MAIL_MCP_URL`) | no | A mail MCP server over Streamable HTTP that reads the mailbox SPV sends its codes to, so a sign-in reads the code by itself. Without one (or a command below), every sign-in asks you for the code. |
| Mail MCP token file (`ANAF_SPV_MAIL_MCP_TOKEN_FILE`) | no | Path of a file holding that mail server's bearer token, if it wants one. |
| Mail MCP command (`ANAF_SPV_MAIL_MCP_COMMAND`) | no | Instead of a URL: a mail MCP server to start over stdio, as a JSON array such as ["npx","-y","some-mail-mcp"]. |

## How it runs

The plugin starts the server on your computer with `npx -y @foreverworks/mcp-anaf-spv@0.1.2`: the published npm package, at the exact version this plugin was made for, on Node 22.19 or newer.
The server sends requests only to the services its documentation names, from your computer, with the credentials you set above, so each service's own privacy policy covers what it receives.
Forever Works receives nothing: the server sends no telemetry and needs no account with us. The [privacy page](https://foreverworks.github.io/mcps/privacy/) says more.

## More

- [Documentation](https://foreverworks.github.io/mcps/servers/anaf-spv/): setup, every tool, troubleshooting and limitations.
- [The server's README and source on GitHub](https://github.com/foreverworks/mcps/blob/main/servers/anaf-spv/README.md).
- [Report a problem](https://github.com/foreverworks/mcps/issues).
- License: MIT, in [LICENSE](LICENSE).

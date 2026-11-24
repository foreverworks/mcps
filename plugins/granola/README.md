# Granola

Read your Granola meetings, notes and transcripts from clients that cannot sign in to Granola.

Free and open source, from [Forever Works](https://foreverworks.github.io/mcps/). It runs on your own computer, in Claude Code or Cursor, and [its documentation](https://foreverworks.github.io/mcps/servers/granola/) walks you through setup, every tool, and what to do when something goes wrong.

## What you can ask

- "What did we decide about pricing in last week's product meetings?"
- "Find every meeting with Ana Popescu since March and list the open action items."
- "Pull the transcript of Tuesday's design review and tell me who raised the onboarding concern."
- "Search my transcripts for 'data retention' and show me where it came up."
- "Is the Granola connection still working, and when does its sign-in need renewing?"

**Why a bridge, when Granola has its own server.** Granola runs its own official
MCP server at `https://mcp.granola.ai/mcp`. It uses OAuth with a browser
sign-in, supports no API keys, and each connection signs in as one person. That is the right design for a person at a
desktop client. It does not fit three common cases: a client that cannot do OAuth
at all (a script, a headless agent, a scheduled job), a setup where every client
would otherwise hold its own long-lived grant to your account, and a deployment
that wants the refresh of that grant done in one place.

This server is the bridge for those cases. It is not a replacement for
Granola's server and it does not scrape anything: it is an MCP client of Granola's
official server on one side and an ordinary MCP server on the other.

- **One grant, held server-side.** You sign in once. The access and refresh
  tokens stay in this server's state directory (file mode 0600).
- **Read-only by construction.** Granola's write and account tools are never
  registered here, so a client that can read your meetings cannot rename them,
  rewrite their summaries, move them between folders or sign the account out.
- **Transcripts untouched.** The content of each result comes back as Granola
  sent it, with no rewriting, so a transcript here is the text Granola returns.
- **Refresh handled in one place.** Granola's sign-in service rotates the refresh
  token on every use, so two clients refreshing at once would break each other.
  Here one refresh runs at a time, and the new pair is saved before the new
  access token is used.
- **A token per client.** Over HTTP, clients authenticate to this server with
  its own bearer tokens (`MCP_HTTP_TOKENS_DIR`), one per client, which you can
  issue and revoke without touching your Granola sign-in. Over stdio the client
  is whoever started the process. Every client token can call the three
  sign-in tools (`begin_authorization`, `complete_authorization`,
  `refresh_grant`), and so can replace the one grant. To keep a client to
  reading, give it a ceiling with `MCP_CLIENT_MAX_ACCESS`, for example
  `reader=read` ([configuration](../../docs/configuration.md)).

## What it can change

It has 15 tools. Some of them write, and its documentation says what each one changes; none moves money.

## Install

In Claude Code 2.1.275 or newer:

```
/plugin install foreverworks-granola --marketplace foreverworks/mcps
```

This adds the repository's marketplace, `foreverworks-mcps`, and installs the plugin from it. In an older Claude Code, run `/plugin marketplace add foreverworks/mcps`, then `/plugin install foreverworks-granola@foreverworks-mcps`.

## Settings

Claude Code asks for this setting when you enable the plugin; in Cursor, it is set in the dashboard under Plugins, Configure. The Configuration section of [its documentation](https://foreverworks.github.io/mcps/servers/granola/#configuration) says how to get each one. Leave an optional one empty and the server uses its default.

| Setting | Required | What it is |
|---|---|---|
| Redirect address (`GRANOLA_REDIRECT_URI`) | no | Where the browser lands after you sign in to Granola; it need not be reachable. Defaults to a loopback address. |

## How it runs

The plugin starts the server on your computer with `npx -y @foreverworks/mcp-granola@0.1.0`: the published npm package, at the exact version this plugin was made for, on Node 22.19 or newer.
The server sends requests only to the services its documentation names, from your computer, with the credentials you set above, so each service's own privacy policy covers what it receives.
Forever Works receives nothing: the server sends no telemetry and needs no account with us. The [privacy page](https://foreverworks.github.io/mcps/privacy/) says more.

## More

- [Documentation](https://foreverworks.github.io/mcps/servers/granola/): setup, every tool, troubleshooting and limitations.
- [The server's README and source on GitHub](https://github.com/foreverworks/mcps/blob/main/servers/granola/README.md).
- [Report a problem](https://github.com/foreverworks/mcps/issues).
- License: MIT, in [LICENSE](LICENSE).

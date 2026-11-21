# Mobbin

Search Mobbin's library of app screens and flows from clients that cannot sign in to Mobbin.

Free and open source, from [Forever Works](https://foreverworks.github.io/mcps/). It runs on your own computer, in Claude Code or Cursor, and [its documentation](https://foreverworks.github.io/mcps/servers/mobbin/) walks you through setup, every tool, and what to do when something goes wrong.

## What you can ask

- "Show me how apps handle onboarding for a banking product."
- "Find checkout flows with a promo code field."
- "What do pricing sections look like on the best mobile subscription apps?"
- "Search Mobbin for empty states in a to-do app, then describe what they have in common."
- "Is the Mobbin connection still working, and when does its sign-in need renewing?"

**Why a bridge, when Mobbin has its own server.** Mobbin runs its own official
MCP server at `api.mobbin.com/mcp`, and it needs OAuth: whoever connects signs in as themselves, and every client keeps its own
grant. That is the right design for a person at a desktop client. It does not
fit three common cases: a client that cannot do OAuth at all (a script, a
headless agent, a hosted assistant), a team that does not want every client
holding its own long-lived grant to one account, and a deployment that wants
the refresh of that grant done in one place.

This server is the bridge for those cases. It is not a replacement for
Mobbin's server and it does not scrape anything: it is an MCP client of Mobbin's
official server on one side and an ordinary MCP server on the other.

- **One grant, held server-side.** You sign in once. The access and refresh
  tokens stay in this server's state directory (file mode 0600).
- **Refresh handled in one place.** Mobbin's sign-in service rotates the refresh
  token on every use, so two clients refreshing at once would break each other.
  Here one refresh runs at a time, and the new pair is saved before the new
  access token is used.
- **A token per client.** Clients authenticate to this server with its own
  bearer tokens (`MCP_HTTP_TOKENS_DIR`), one per client, which you can issue
  and revoke without touching your Mobbin sign-in.

## What it can change

It has 7 tools. Some of them change things in your account, and none moves money.

## Install

In Claude Code 2.1.275 or newer:

```
/plugin install foreverworks-mobbin --marketplace foreverworks/mcps
```

This adds the repository's marketplace, `foreverworks-mcps`, and installs the plugin from it. In an older Claude Code, run `/plugin marketplace add foreverworks/mcps`, then `/plugin install foreverworks-mobbin@foreverworks-mcps`.

## Settings

Claude Code asks for this setting when you enable the plugin; in Cursor, it is set in the dashboard under Plugins, Configure. The Configuration section of [its documentation](https://foreverworks.github.io/mcps/servers/mobbin/#configuration) says how to get each one. Leave an optional one empty and the server uses its default.

| Setting | Required | What it is |
|---|---|---|
| Redirect address (`MOBBIN_REDIRECT_URI`) | no | Where the browser lands after you sign in to Mobbin; it need not be reachable. Defaults to a loopback address. |

## How it runs

The plugin starts the server on your computer with `npx -y @foreverworks/mcp-mobbin@0.1.0`: the published npm package, at the exact version this plugin was made for, on Node 22.19 or newer.
The server sends requests only to the services its documentation names, from your computer, with the credentials you set above, so each service's own privacy policy covers what it receives.
Forever Works receives nothing: the server sends no telemetry and needs no account with us. The [privacy page](https://foreverworks.github.io/mcps/privacy/) says more.

## More

- [Documentation](https://foreverworks.github.io/mcps/servers/mobbin/): setup, every tool, troubleshooting and limitations.
- [The server's README and source on GitHub](https://github.com/foreverworks/mcps/blob/main/servers/mobbin/README.md).
- [Report a problem](https://github.com/foreverworks/mcps/issues).
- License: MIT, in [LICENSE](LICENSE).

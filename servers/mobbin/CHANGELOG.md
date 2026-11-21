# @foreverworks/mcp-mobbin

## 0.1.0

The first release. Your assistant can search Mobbin's library of real app
screens, flows and sections (`search_screens`, `search_flows`,
`search_sections`) through Mobbin's own official MCP server, from clients that
cannot sign in to Mobbin themselves. The server holds one sign-in to your
Mobbin account, refreshes it by itself (Mobbin's refresh tokens rotate, so one
refresh runs at a time and the new pair is saved before it is used), and
serves Mobbin's tools to every client that presents the server's own token.
`begin_authorization` and `complete_authorization` connect the account once
and are `write`: they change only what the server holds. `health` and the
search tools are `read`. No tool is `money`; Mobbin's "deep" search mode spends
the account's AI credits.

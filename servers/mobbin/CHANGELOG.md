# @foreverworks/mcp-mobbin

## 0.2.0

### Minor Changes

- 579dbca: A new server for Mobbin: your assistant searches Mobbin's library of real app screens, flows and sections (`search_screens`, `search_flows`, `search_sections`, all `read`) through Mobbin's own official MCP server, from clients that cannot sign in to Mobbin themselves. The server holds one sign-in to your Mobbin account and refreshes it by itself, one refresh at a time with the rotated token saved before it is used; `begin_authorization` and `complete_authorization` (`write`) connect the account once, and `refresh_grant` (`write`) proves the refresh works. No tool is `money`; Mobbin's "deep" search spends the account's AI credits.

### Patch Changes

- Updated dependencies [d672e23]
- Updated dependencies [8f76786]
- Updated dependencies [ca27413]
- Updated dependencies [e68c576]
- Updated dependencies [6f9174c]
- Updated dependencies [579dbca]
  - @foreverworks/mcp-kit@0.4.0

## 0.1.0

The first release. Your assistant can search Mobbin's library of real app
screens, flows and sections (`search_screens`, `search_flows`,
`search_sections`) through Mobbin's own official MCP server, from clients that
cannot sign in to Mobbin themselves. The server holds one sign-in to your
Mobbin account, refreshes it by itself (Mobbin's refresh tokens rotate, so one
refresh runs at a time and the new pair is saved before it is used), and
serves Mobbin's tools to every client that presents the server's own token.
`begin_authorization` and `complete_authorization` connect the account once,
and `refresh_grant` proves the refresh works; all three are `write`: they change only what the server holds. `health` and the
search tools are `read`. No tool is `money`; Mobbin's "deep" search mode spends
the account's AI credits.

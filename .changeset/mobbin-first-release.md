---
"@foreverworks/mcp-mobbin": minor
---

A new server for Mobbin: your assistant searches Mobbin's library of real app screens, flows and sections (`search_screens`, `search_flows`, `search_sections`, all `read`) through Mobbin's own official MCP server, from clients that cannot sign in to Mobbin themselves. The server holds one sign-in to your Mobbin account and refreshes it by itself, one refresh at a time with the rotated token saved before it is used; `begin_authorization` and `complete_authorization` (`write`) connect the account once. No tool is `money`; Mobbin's "deep" search spends the account's AI credits.

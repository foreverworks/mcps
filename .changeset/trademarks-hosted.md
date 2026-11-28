---
"@foreverworks/mcp-trademarks": minor
---

`TRADEMARKS_TOOLSETS` picks the tools a server loads: `search` (`search_marks`, `get_mark`) and `records` (`mark_history`, `mark_documents`, `download_mark_documents`), with `health` always there. Unset, every tool loads as before. `search` alone needs no key at all, and without `records` the TSDR source is not started.

A search that names the EU register when no EU source is enabled now says so and where to look by hand, as it already did for Romania and WIPO.

The search side is hosted for anyone, free and with no sign-in, at `https://mcp.foreverworks.com/trademarks`, and the MCP Registry lists that address beside the npm package.

The server refuses to be served to anyone (`MCP_HTTP_PUBLIC_HOSTS`) while the `records` toolset, which uses the operator's TSDR key, is loaded, even under `MCP_MAX_ACCESS=read`.

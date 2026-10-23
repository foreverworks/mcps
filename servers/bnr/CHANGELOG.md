# @foreverworks/mcp-bnr

## 0.1.0

The first release. The National Bank of Romania's reference exchange rates: the rate in force on a day with the date BNR published it, amounts converted to and from RON, several currencies or a window of fixings at once, and the annual average ANAF uses for foreign income in the D212. Rates are BNR's exact text, and every conversion is computed in exact decimals. In the first days of January, before BNR publishes the new year's file, today's rate is December's last fixing.

Every tool is `read`, and it needs no account or key. Nothing here moves money: no tool is `money`.

It speaks MCP protocol revisions 2026-07-28 and 2025-11-25, over stdio and loopback HTTP, and lists the same tools to both.

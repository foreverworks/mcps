# @foreverworks/mcp-ecb

## 0.1.0

The first release. The European Central Bank's euro foreign exchange reference rates: the rate in force on any day since 1999 with the date of the fixing it is, every currency on a day or a window of fixings, and amounts converted between any two currencies, cross rates through the euro included. Rates are the ECB's exact value, and every conversion is computed in exact decimals, rounded once by the rule you name, and answers the rate or rates and the fixing it used. A weekend, a holiday or the hours before the ECB publishes (around 16:00 CET) take the last working day's fixing, and the answer says so.

Every tool is `read`, and it needs no account or key. Nothing here moves money: no tool is `money`.

It speaks MCP protocol revisions 2026-07-28 and 2025-11-25, over stdio and loopback HTTP, and lists the same tools to both.

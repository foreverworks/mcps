# @foreverworks/mcp-ecb

## 0.1.2

### Patch Changes

- 6f9174c: The server is also hosted for anyone, free and with no sign-in, at `https://mcp.foreverworks.com/ecb`, and the MCP Registry lists that address beside the npm package. Every tool is there, rate-limited for each caller. The README says how to add it to Claude and to other clients.
- Updated dependencies [d672e23]
- Updated dependencies [8f76786]
- Updated dependencies [ca27413]
- Updated dependencies [e68c576]
- Updated dependencies [6f9174c]
- Updated dependencies [579dbca]
  - @foreverworks/mcp-kit@0.4.0

## 0.1.1

### Patch Changes

- Published through npm's trusted publishing: from this version on, each release names GitHub Actions as its publisher, with a provenance statement that ties the package to the commit it was built from.

## 0.1.0

The first release. The European Central Bank's euro foreign exchange reference rates: the rate in force on any day since 1999 with the date of the fixing it is, every currency on a day or a window of fixings, and amounts converted between any two currencies, cross rates through the euro included. Rates are the ECB's exact value, and every conversion is computed in exact decimals, rounded once by the rule you name, and answers the rate or rates and the fixing it used. A weekend, a holiday or the hours before the ECB publishes (around 16:00 CET) take the last working day's fixing, and the answer says so.

Every tool is `read`, and it needs no account or key. Nothing here moves money: no tool is `money`.

It speaks MCP protocol revisions 2026-07-28 and 2025-11-25, over stdio and loopback HTTP, and lists the same tools to both.

# @foreverworks/mcp-bolt-food

## 0.1.1

### Patch Changes

- Updated dependencies [2447a0d]
- Updated dependencies [db52a0b]
  - @foreverworks/mcp-kit@0.2.0
  - @foreverworks/receipts@0.1.1

## 0.1.0

The first release. A Bolt Food account's order history as itemised receipts: orders, their products, fees, tips and payment legs, product search across every order, spending per restaurant and per month, and a match from each bank card charge to the order it paid for. It uses Bolt Food's web API, which Bolt does not publish for this; the README says what that means.

Every tool is `read`: nothing here orders, pays or changes the account, and no tool is `money`.

It speaks MCP protocol revisions 2026-07-28 and 2025-11-25, over stdio and loopback HTTP, and lists the same tools to both.

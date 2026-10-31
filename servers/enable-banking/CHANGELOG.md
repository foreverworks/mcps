# @foreverworks/mcp-enable-banking

## 0.1.1

### Patch Changes

- Updated dependencies [2447a0d]
- Updated dependencies [db52a0b]
  - @foreverworks/mcp-kit@0.2.0

## 0.1.0

The first release. Your bank accounts through Enable Banking, a licensed PSD2 provider: statements searched across accounts by text, direction and amount, exported as CSV, balances, and the consents themselves with the date each one ends. Amounts stay exact decimal strings from the bank to the answer.

Nothing here moves money out of an account. Its one `money` tool is `start_auth`, because a new consent is a legal agreement with your bank; a client that honours the confirmation mark asks you before every call. Its `write` tools finish a consent (`complete_auth`) and end one (`revoke_session`).

It speaks MCP protocol revisions 2026-07-28 and 2025-11-25, over stdio and loopback HTTP, and lists the same tools to both.

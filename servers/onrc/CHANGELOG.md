# @foreverworks/mcp-onrc

## 0.1.3

### Patch Changes

- c132159: The server's instructions, which your client hands the model at the start of every session, are about half as long, so every session costs less. They now say what the server reaches, the tool to start with, the flows that run across tools, and what the model must know before its first call (what spends money, sends, publishes or acts on something in a home, and what to do when a sign-in is needed). What a tool's own description already says is left to it. Nothing a tool does changes.
  
  porkbun: the vendor's paragraph on publishing a site is now one sentence, and `deploy_site`'s description carries its checks, adding that `list_hosting_files` shows what is already there before an upload replaces it.
- Updated dependencies [75ea94a]
- Updated dependencies [0834240]
- Updated dependencies [64969a3]
- Updated dependencies [4ef1bf8]
- Updated dependencies [7b93f2f]
- Updated dependencies [27f0094]
  - @foreverworks/mcp-kit@0.3.0

## 0.1.2

### Patch Changes

- ad0d6fc: No change to the server. This version is the first published by the repository's release workflow through npm's trusted publishing, with no npm token anywhere; `npm view` names GitHub Actions as its publisher.

## 0.1.1

### Patch Changes

- Updated dependencies [2447a0d]
- Updated dependencies [db52a0b]
  - @foreverworks/mcp-kit@0.2.0

## 0.1.0

The first release. Romania's trade register portal for one signed-in account: the filings made there and their status, a filing's documents, the fee notes and the invoices. You grant the session once, in the browser you already use for the portal.

Everything it does at ONRC is a read; its `write` tools only hold the session: `begin_login`, `complete_login` and `logout`. Nothing here files anything or moves money: no tool is `money`.

It speaks MCP protocol revisions 2026-07-28 and 2025-11-25, over stdio and loopback HTTP, and lists the same tools to both. `begin_login` offers the sign-in page through your client where the client supports URL elicitation, and puts the link in the result where it does not.

# @foreverworks/mcp-oblio

## 0.1.2

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

## 0.1.1

### Patch Changes

- Updated dependencies [2447a0d]
- Updated dependencies [db52a0b]
  - @foreverworks/mcp-kit@0.2.0

## 0.1.0

The first release. Oblio invoicing for one company: its clients, products, document series and VAT rates, the invoices it issued (so "what is still unpaid?" has an answer), invoices and proformas looked up and issued with exact totals, and the payments a client makes. An invoice sent without an idempotency key gets one derived from its content, so a retry never issues a second copy.

Its `money` tools make, change or unmake a fiscal document: `create_invoice`, `invoice_from_proforma`, `collect_invoice`, `cancel_invoice`, `restore_invoice`, `reverse_invoice` and `delete_invoice`. A client that honours the confirmation mark asks you before every call, showing the buyer, the amount and the document.

Its one `write` tool is `create_proforma`: a proforma is not a fiscal document.

It speaks MCP protocol revisions 2026-07-28 and 2025-11-25, over stdio and loopback HTTP, and lists the same tools to both.

# @foreverworks/mcp-oblio

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

# @foreverworks/mcp-anaf-efactura

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

The first release. Romania's e-Factura and e-Transport for one company, through ANAF's own API: the invoices the company received and sent, each one's signed archive (downloaded and checked) and a PDF of it, ANAF's validation of an invoice before you file it, an invoice built from fields, the VAT registry, and the e-Transport declarations. It keeps its OAuth grant alive and walks you through the re-authorization when ANAF asks for one.

Its `money` tools file a legal document with ANAF: `upload_invoice` (to a company), `upload_invoice_b2c` (to a person) and `etransport_file`. Each goes to ANAF's test environment unless you say otherwise, and the server refuses to file the same bytes in production twice. A client that honours the confirmation mark asks you before every call.

Its `write` tools only look after the grant: `refresh_token`, `begin_authorization` and `complete_authorization`.

It speaks MCP protocol revisions 2026-07-28 and 2025-11-25, over stdio and loopback HTTP, and lists the same tools to both. `begin_authorization` offers the sign-in page through your client where the client supports URL elicitation, and puts the link in the result where it does not.

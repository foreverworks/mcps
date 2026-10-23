# @foreverworks/mcp-anaf-efactura

## 0.1.0

The first release. Romania's e-Factura and e-Transport for one company, through ANAF's own API: the invoices the company received and sent, each one's signed archive (downloaded and checked) and a PDF of it, ANAF's validation of an invoice before you file it, an invoice built from fields, the VAT registry, and the e-Transport declarations. It keeps its OAuth grant alive and walks you through the re-authorization when ANAF asks for one.

Its `money` tools file a legal document with ANAF: `upload_invoice` (to a company), `upload_invoice_b2c` (to a person) and `etransport_file`. Each goes to ANAF's test environment unless you say otherwise, and the server refuses to file the same bytes in production twice. A client that honours the confirmation mark asks you before every call.

Its `write` tools only look after the grant: `refresh_token`, `begin_authorization` and `complete_authorization`.

It speaks MCP protocol revisions 2026-07-28 and 2025-11-25, over stdio and loopback HTTP, and lists the same tools to both. `begin_authorization` offers the sign-in page through your client where the client supports URL elicitation, and puts the link in the result where it does not.

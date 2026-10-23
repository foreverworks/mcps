# @foreverworks/mcp-anaf-efactura

## 1.0.0

The first release. Romania's e-Factura and e-Transport for one company, through ANAF's own API: the invoices the company received and sent, each one's signed archive (downloaded and checked) and a PDF of it, ANAF's validation of an invoice before you file it, an invoice built from fields, the VAT registry, and the e-Transport declarations. It keeps its OAuth grant alive and walks you through the re-authorization when ANAF asks for one.

Its `money` tools file a legal document with ANAF: `upload_invoice` (to a company), `upload_invoice_b2c` (to a person) and `etransport_file`. Each goes to ANAF's test environment unless you say otherwise, and the server refuses to file the same bytes in production twice. A client that honours the confirmation mark asks you before every call.

Its `write` tools only look after the grant: `refresh_token`, `begin_authorization` and `complete_authorization`.

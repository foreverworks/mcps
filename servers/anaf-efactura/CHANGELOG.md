# @foreverworks/mcp-anaf-efactura

## 0.2.0

### Minor Changes

- 6f9174c: `ANAF_EFACTURA_TOOLSETS` picks the tools a server loads: `registry`, `documents`, `invoices`, `etransport` and `authorization`, with `health` always there. Unset, every tool loads as before. `registry,documents` needs no ANAF account: the server starts with no `app.json` and no state folder, registers only `read` tools (`lookup_company`, `validate_invoice`, `invoice_pdf`, `parse_invoice`, `verify_signature`, `build_invoice`), and its `health` reports whether ANAF's public services answer. In that mode `validate_invoice`, `invoice_pdf` and `parse_invoice` take the invoice as XML text (`xml`, at most 1,048,576 characters), and `verify_signature` takes `xml` and `signature` as text, since a server with no disk has no other way in; each answer gives the sha256 and size of what arrived, to compare with the source. With a grant, files still go in by path or checked base64 only. `message_id`, `archive` and `test` are not offered, and `build_invoice` and `invoice_pdf` hand the file back attached to the answer, with its size and SHA-256, instead of saving it to an outbox. `ANAF_DOWNLOADS_DIR` keeps an outbox anyway.
  
  That subset is hosted for anyone, free and with no sign-in, at `https://mcp.foreverworks.com/anaf-efactura`, and the MCP Registry lists that address beside the npm package.
  
  The server refuses to be served to anyone (`MCP_HTTP_PUBLIC_HOSTS`) unless only `registry` and `documents` are loaded and `ANAF_DOWNLOADS_DIR` is unset, even under `MCP_MAX_ACCESS=read`.

### Patch Changes

- Updated dependencies [d672e23]
- Updated dependencies [8f76786]
- Updated dependencies [ca27413]
- Updated dependencies [e68c576]
- Updated dependencies [6f9174c]
- Updated dependencies [579dbca]
  - @foreverworks/mcp-kit@0.4.0

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

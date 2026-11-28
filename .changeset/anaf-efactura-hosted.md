---
"@foreverworks/mcp-anaf-efactura": minor
---

`ANAF_EFACTURA_TOOLSETS` picks the tools a server loads: `registry`, `documents`, `invoices`, `etransport` and `authorization`, with `health` always there. Unset, every tool loads as before. `registry,documents` needs no ANAF account: the server starts with no `app.json` and no state folder, registers only `read` tools (`lookup_company`, `validate_invoice`, `invoice_pdf`, `parse_invoice`, `verify_signature`, `build_invoice`), and its `health` reports whether ANAF's public services answer. In that mode `message_id`, `archive` and `test` are not offered, and `build_invoice` and `invoice_pdf` hand the file back attached to the answer, with its size and SHA-256, instead of saving it to an outbox. `ANAF_DOWNLOADS_DIR` keeps an outbox anyway.

That subset is hosted for anyone, free and with no sign-in, at `https://mcp.foreverworks.com/anaf-efactura`, and the MCP Registry lists that address beside the npm package.

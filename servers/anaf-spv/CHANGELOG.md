# @foreverworks/mcp-anaf-spv

## 0.1.1

### Patch Changes

- Updated dependencies [2447a0d]
- Updated dependencies [db52a0b]
  - @foreverworks/mcp-kit@0.2.0

## 0.1.0

The first release. ANAF's Spațiul Privat Virtual for one taxpayer: every document ANAF posts there (decisions, summonses, notifications, payment confirmations, answers to your requests), downloaded byte for byte and archived before SPV drops it, and requests for new documents such as the statement of what you owe. It signs in by itself, with your password from a file or a vault MCP server and the e-mailed code read through a mail MCP server.

Its one `money` tool is `submit_declaration`: it files a D212, a tax return and so a legal document, and a client that honours the confirmation mark asks you before every call. `validate_declaration` runs ANAF's own validator on a D212, D100, D300 or D112, makes its filing PDF and says what the return makes payable; it files nothing. ANAF takes a D100, D300 or D112 only through e-guvernare.ro, signed with a qualified certificate, so `submit_declaration` checks such a PDF and stops before sending: you sign and upload it there. `declaration_status` tells you where a filed declaration stands, by the number on its receipt, and saves the signed receipt; it reads ANAF's public status page and signs in nowhere.

Its `write` tools change things at ANAF without money: a document request, a message through the contact form (a dry run unless you say otherwise), and the session itself.

It speaks MCP protocol revisions 2026-07-28 and 2025-11-25, over stdio and loopback HTTP, and lists the same tools to both.

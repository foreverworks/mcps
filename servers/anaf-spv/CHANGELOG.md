# @foreverworks/mcp-anaf-spv

## 1.0.0

The first release. ANAF's Spațiul Privat Virtual for one taxpayer: every document ANAF posts there (decisions, summonses, notifications, payment confirmations, answers to your requests), downloaded byte for byte and archived before SPV drops it, and requests for new documents such as the statement of what you owe. It signs in by itself, with your password from a file or a vault MCP server and the e-mailed code read through a mail MCP server.

Its one `money` tool is `submit_declaration`: it files a tax return, a legal document, so a client that honours the confirmation mark asks you before every call. `validate_declaration` runs ANAF's own validator first and files nothing.

Its `write` tools change things at ANAF without money: a document request, a message through the contact form (a dry run unless you say otherwise), and the session itself.

---
"@foreverworks/mcp-anaf-spv": minor
---

`validate_declaration` checks a company's D100 with ANAF's own validator and makes its filing PDF, and says what the return makes payable, per obligation. `submit_declaration` (still `money`) checks such a PDF and stops before sending: ANAF takes a D100 only through e-guvernare.ro, signed with a qualified certificate, so you sign and upload the PDF there. Its confirmation line now names the period, the taxpayer and the amounts payable.

The cached validator kits are now kept per ANAF package, so each is downloaded once more on first use.

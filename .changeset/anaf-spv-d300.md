---
"@foreverworks/mcp-anaf-spv": minor
---

`validate_declaration` checks a company's D300, the VAT return, with ANAF's own validator and makes its filing PDF, and says the VAT to pay or the negative balance and whether its refund is asked. As with a D100, `submit_declaration` (still `money`) checks the PDF and stops before sending: ANAF takes a D300 only through e-guvernare.ro, signed with a qualified certificate.

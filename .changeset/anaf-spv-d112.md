---
"@foreverworks/mcp-anaf-spv": minor
---

`validate_declaration` checks an employer's D112 with ANAF's own validator and makes its filing PDF, and says what it makes payable, per obligation; a file whose `totalPlata_A` is not the sum of its obligations is refused first. As with a D100 or D300, `submit_declaration` (still `money`) checks the PDF and stops before sending: ANAF takes a D112 only through e-guvernare.ro, signed with a qualified certificate.

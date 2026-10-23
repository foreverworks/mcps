---
"@foreverworks/mcp-anaf-spv": minor
---

`declaration_status` tells you where a filed declaration stands at ANAF and saves its signed receipt, by the number on the receipt (or the registration number, or the index `submit_declaration` answered). It reads ANAF's public status page and signs in nowhere. It is `read`. `submit_declaration` now also answers the receipt's number, the one ANAF's status page knows the filing by.

Allow `stare.anaf.ro` if the server runs behind an egress allowlist.

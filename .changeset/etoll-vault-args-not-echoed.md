---
"@foreverworks/mcp-etoll": patch
---

`ETOLL_VAULT_ARGS` that are not JSON are reported as such without repeating their first 80 characters, which could hold a vault session or token.

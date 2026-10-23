---
"@foreverworks/mcp-enable-banking": patch
---

When a bank refuses a read with `ASPSP_RATE_LIMIT_EXCEEDED`, the error's remedy now says the account's reads are spent for today and to try again tomorrow, instead of suggesting a retry.

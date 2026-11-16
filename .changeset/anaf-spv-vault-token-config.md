---
"@foreverworks/mcp-anaf-spv": patch
---

A vault or mail MCP token file that cannot be read (`ANAF_SPV_VAULT_MCP_TOKEN_FILE`, `ANAF_SPV_MAIL_MCP_TOKEN_FILE`) is now answered as a `config` error naming the variable, instead of an `upstream` error that read "[object Object]".

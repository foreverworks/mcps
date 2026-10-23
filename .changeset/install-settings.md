---
"@foreverworks/mcp-anaf-spv": patch
"@foreverworks/mcp-google": patch
"@foreverworks/mcp-anaf-efactura": patch
---

Install prompts (VS Code, the Claude Desktop bundle, the registry entry) now ask for what each server needs. anaf-spv offers its mail source (`ANAF_SPV_MAIL_MCP_URL`, `ANAF_SPV_MAIL_MCP_TOKEN_FILE`, `ANAF_SPV_MAIL_MCP_COMMAND`), so a sign-in can read the e-mailed code by itself. google asks for `GMAIL_MODIFY_ACCOUNTS`, without which no mailbox works. anaf-efactura's prompt says which tools run without `ANAF_CONFIG`.

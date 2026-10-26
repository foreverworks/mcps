# @foreverworks/mcp-bitwarden

## 0.1.0

The first release. A Bitwarden vault an agent keeps its own logins in, through the official Bitwarden CLI: find logins, create one with a password the server generates, update one, hand a password out for typing, compute 2FA codes, keep secrets that are not passwords in secure notes, and check whether a stored password is in a known breach (only five characters of its hash leave the machine). No tool returns a password for the model to read back to you.

Its `write` tools add to the vault and change it: `create_login`, `update_login`, `create_note` and `move_item`. `move_item` is `write`: it puts a login or secure note in one collection of its own organization, and never takes an item out of its organization. Nothing here moves money: no tool is `money`.

It speaks MCP protocol revisions 2026-07-28 and 2025-11-25, over stdio and loopback HTTP, and lists the same tools to both.

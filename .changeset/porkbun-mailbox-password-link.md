---
"@foreverworks/mcp-porkbun": patch
---

`create_mailbox` and `setup_mailbox` now link the password file they save in the result (a `resource_link`), as `get_ssl_bundle` links its key. A relay on your machine fetches back only the outbox files a result links, so a generated password was unreachable when the server ran elsewhere. The file's name, its mode (0640) and the answer's text are unchanged.

---
"@foreverworks/mcp-bitwarden": minor
---

`update_login` now works on a secure note for `name`, `notes` and `append_notes`, so a note can be renamed or marked for clean-up without opening the web vault. The note's custom fields, hidden ones included, go back to Bitwarden exactly as they were read: only the name and the notes change. A login-only argument on a note (`url`, `username`, `password`, `password_file`, `rotate_password`, `totp_secret`, `replace_totp`) is still refused, and the error now names the argument.

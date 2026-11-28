# @foreverworks/mcp-bitwarden

## 0.3.0

### Minor Changes

- 3adbf0a: `update_login` now works on a secure note for `name`, `notes` and `append_notes`, so a note can be renamed or marked for clean-up without opening the web vault. The note's custom fields, hidden ones included, go back to Bitwarden exactly as they were read: only the name and the notes change. A login-only argument on a note (`url`, `username`, `password`, `password_file`, `rotate_password`, `totp_secret`, `replace_totp`) is still refused, and the error now names the argument.

### Patch Changes

- Updated dependencies [d672e23]
- Updated dependencies [8f76786]
- Updated dependencies [ca27413]
- Updated dependencies [e68c576]
- Updated dependencies [6f9174c]
- Updated dependencies [579dbca]
  - @foreverworks/mcp-kit@0.4.0

## 0.2.2

### Patch Changes

- c132159: The server's instructions, which your client hands the model at the start of every session, are about half as long, so every session costs less. They now say what the server reaches, the tool to start with, the flows that run across tools, and what the model must know before its first call (what spends money, sends, publishes or acts on something in a home, and what to do when a sign-in is needed). What a tool's own description already says is left to it. Nothing a tool does changes.
  
  porkbun: the vendor's paragraph on publishing a site is now one sentence, and `deploy_site`'s description carries its checks, adding that `list_hosting_files` shows what is already there before an upload replaces it.
- Updated dependencies [75ea94a]
- Updated dependencies [0834240]
- Updated dependencies [64969a3]
- Updated dependencies [4ef1bf8]
- Updated dependencies [7b93f2f]
- Updated dependencies [27f0094]
  - @foreverworks/mcp-kit@0.3.0

## 0.2.1

### Patch Changes

- ad0d6fc: No change to the server. This version is the first published by the repository's release workflow through npm's trusted publishing, with no npm token anywhere; `npm view` names GitHub Actions as its publisher.

## 0.2.0

### Minor Changes

- 3207f82: The vault is now a passkey authenticator for an agent's own identities, storing passkeys exactly as Bitwarden's own apps do, so either can use the other's. `list_passkeys` lists them without their keys and `assert_passkey` signs a WebAuthn sign-in with one; both are `read`. `create_passkey` registers a new passkey and `import_passkeys` imports the logins that carry passkeys from a Bitwarden JSON export; both are `write`. `delete_passkey` removes one passkey from its login and is `write`, marked destructive: it is the first tool here that removes anything. `health` and `find_logins` now count passkeys, and `NODE_EXTRA_CA_CERTS` is handed to the CLI for a self-hosted server whose certificate your own authority signed.

### Patch Changes

- 40c78ce: Calls that arrive together while the server holds no session key, as they do just after a restart, now share one login and one unlock. Each `bw unlock` stores the vault's key under a new session key and the one before stops opening it, so two unlocks at once left one call with a stale key: `health` answered "the vault is locked after unlocking" and other tools unlocked again in turn, each undoing the other's key. `health` also unlocks once more when the key it holds has gone stale, as every other tool already did.

## 0.1.1

### Patch Changes

- Updated dependencies [2447a0d]
- Updated dependencies [db52a0b]
  - @foreverworks/mcp-kit@0.2.0

## 0.1.0

The first release. A Bitwarden vault an agent keeps its own logins in, through the official Bitwarden CLI: find logins, create one with a password the server generates, update one, hand a password out for typing, compute 2FA codes, keep secrets that are not passwords in secure notes, and check whether a stored password is in a known breach (only five characters of its hash leave the machine). No tool returns a password for the model to read back to you.

Its `write` tools add to the vault and change it: `create_login`, `update_login`, `create_note` and `move_item`. `move_item` is `write`: it puts a login or secure note in one collection of its own organization, and never takes an item out of its organization. Nothing here moves money: no tool is `money`.

It speaks MCP protocol revisions 2026-07-28 and 2025-11-25, over stdio and loopback HTTP, and lists the same tools to both.

---
"@foreverworks/mcp-bitwarden": minor
---

The vault is now a passkey authenticator for an agent's own identities, storing passkeys exactly as Bitwarden's own apps do, so either can use the other's. `list_passkeys` lists them without their keys and `assert_passkey` signs a WebAuthn sign-in with one; both are `read`. `create_passkey` registers a new passkey and `import_passkeys` imports the logins that carry passkeys from a Bitwarden JSON export; both are `write`. `delete_passkey` removes one passkey from its login and is `write`, marked destructive: it is the first tool here that removes anything. `health` and `find_logins` now count passkeys, and `NODE_EXTRA_CA_CERTS` is handed to the CLI for a self-hosted server whose certificate your own authority signed.

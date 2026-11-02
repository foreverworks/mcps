---
"@foreverworks/mcp-bitwarden": patch
---

Calls that arrive together while the server holds no session key, as they do just after a restart, now share one login and one unlock. Each `bw unlock` stores the vault's key under a new session key and the one before stops opening it, so two unlocks at once left one call with a stale key: `health` answered "the vault is locked after unlocking" and other tools unlocked again in turn, each undoing the other's key. `health` also unlocks once more when the key it holds has gone stale, as every other tool already did.

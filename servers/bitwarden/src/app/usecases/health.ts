import { authError, fail } from "../../domain/errors.js";
import type { Deps } from "../ports.js";

/**
 * Is this alive, as whom, and what can it reach. `status` logs in and unlocks
 * on the way, so a refused API key or master password fails HERE with its
 * remedy rather than later as an empty search.
 */
export const checkHealth = async (deps: Deps) => {
  await deps.vault.sync();
  const status = await deps.vault.status();
  if (status.status !== "unlocked") return fail(authError(`the vault is ${status.status} after unlocking`));
  const [logins, organizations, collections] = await Promise.all([
    deps.vault.listLogins({}),
    deps.vault.organizations(),
    deps.vault.collections(),
  ]);
  return {
    ok: true,
    account: status.userEmail,
    server: status.serverUrl ?? "https://vault.bitwarden.com",
    lastSync: status.lastSync,
    logins: logins.length,
    organizations: organizations.map((o) => o.name),
    collections: collections.map((c) => c.name),
    defaultCollection: deps.defaultCollection ?? null,
  };
};

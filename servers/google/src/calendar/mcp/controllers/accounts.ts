import { checkHealth } from "../../app/usecases/health.js";
import type { Registry } from "../../composition.js";
import { describeThrown, RECONSENT } from "../../domain/errors.js";
import { ALL_ACCOUNTS } from "../../infra/accounts.js";

/**
 * Calendar's section of list_accounts and health. The tools themselves are
 * registered once for the whole server (src/mcp/accounts.ts), because an
 * account is a Google identity first and a calendar second.
 */
export const listAccounts = (registry: Registry) => ({
  accounts: registry.labels.map((label) => {
    const deps = registry.get(label);
    return {
      account: label,
      ...(deps.address ? { address: deps.address } : {}),
      default: label === registry.defaultLabel,
      credentialsPath: deps.grant.credentials,
    };
  }),
  timeZone: registry.timeZone,
  ...(registry.labels.length === 0 ? { hint: `no account has a grant under ${registry.root}; ${RECONSENT}` } : {}),
});

export const health = async (registry: Registry, account: string) => {
  // One dead grant must not hide the verdict on the other.
  const results = await Promise.all(
    registry.select(account || ALL_ACCOUNTS).map((deps) =>
      checkHealth(deps).then(
        (value) => ({ account: deps.account, ...value }),
        (thrown: unknown) => ({ account: deps.account, ok: false, error: describeThrown(thrown) }),
      ),
    ),
  );
  return { accounts: results, allOk: results.every((r) => r.ok) };
};

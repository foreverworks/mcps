import { checkHealth } from "../../app/usecases/health.js";
import type { Registry } from "../../composition.js";
import { describeThrown } from "../../domain/errors.js";
import { ALL_ACCOUNTS, NO_MAILBOX } from "../../infra/accounts.js";

/**
 * Gmail's section of list_accounts and health. The tools themselves are
 * registered once for the whole server (src/mcp/accounts.ts), because an
 * account is a Google identity first and a mailbox second.
 */
export const listAccounts = (registry: Registry) => ({
  accounts: registry.labels.map((label) => {
    const deps = registry.get(label);
    return {
      account: label,
      ...(deps.address ? { address: deps.address } : {}),
      default: label === registry.defaultLabel,
      activeGrant: deps.grant.role,
      credentialsPath: deps.grant.credentials,
      ...(deps.modifyPath && deps.grant.role !== "modify" ? { modifyGrantMissingAt: deps.modifyPath } : {}),
    };
  }),
  ...(registry.labels.length === 0 ? { hint: NO_MAILBOX } : { defaultAccount: registry.defaultLabel }),
});

export const health = async (registry: Registry, account: string) => {
  if (registry.labels.length === 0 && (account || ALL_ACCOUNTS) === ALL_ACCOUNTS) return { accounts: [], allOk: true, hint: NO_MAILBOX };
  // One dead grant must not hide the verdict on the others, so a failure is
  // reported per account rather than thrown for the whole call.
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

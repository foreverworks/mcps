import { ALL_ACCOUNTS } from "../domain/accounts.js";
import type { GrantRegistry } from "./registry.js";
import type { Grant } from "./grant.js";
import { healthOfAll } from "./health.js";

/**
 * A one-grant-per-account product's sections of list_accounts and health. The
 * tools themselves are the server's (src/mcp/accounts.ts), because an account
 * is a Google identity first and a product second.
 */
export const listGrantAccounts = <D>(registry: GrantRegistry<D>, reconsent: string) => {
  const labels = registry.labels;
  return {
    accounts: labels.map((label) => {
      const address = registry.specOf(label)?.address;
      return { account: label, ...(address ? { address } : {}), credentialsPath: registry.credentialsPath(label) };
    }),
    ...(labels.length === 0 ? { hint: `no account has a ${registry.product} grant under ${registry.root}; ${reconsent}` } : {}),
  };
};

/**
 * Every account's health, or the one named. These products are consented per
 * account and by choice, so an account named that has no grant for one is
 * reported as having none, which is healthy, not as a broken configuration.
 */
export const grantAccountsHealth = async <D extends { readonly grant: Grant }>(
  registry: GrantRegistry<D>,
  account: string,
  check: (deps: D) => Promise<{ readonly ok: boolean }>,
  describe: (thrown: unknown) => string,
) => {
  const wanted = account.trim();
  if (wanted !== "" && wanted !== ALL_ACCOUNTS && !registry.labels.includes(wanted)) return { accounts: [], allOk: true, hint: `"${wanted}" has no ${registry.product} grant` };
  return healthOfAll(registry.select(account), check, describe);
};

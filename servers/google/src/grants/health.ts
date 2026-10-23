import { unlessCancelled } from "@foreverworks/mcp-kit";

import { asAppError, describeThrownWith, type AppError } from "../domain/errors.js";
import type { Grant } from "./grant.js";

/** Google's reasons for an API its client's Cloud project has not enabled. */
const isServiceDisabled = (reason: string | undefined): boolean => reason === "SERVICE_DISABLED" || reason === "accessNotConfigured";

/**
 * Alive, as whom, with which scopes, and whether the API answers: the check
 * for a product that holds one grant per account on one API.
 *
 * "As whom" matters because the consent screen offers every account signed
 * in, and a grant approved as the wrong one works perfectly for the wrong
 * person. "Whether the API answers" is the part only a call can see: a grant
 * whose client's Cloud project has not enabled the API is refused with a 403
 * that reads like a permission problem, so it is named `disabled`.
 */
export const grantHealth = async (
  grant: Grant,
  check: {
    readonly required: readonly string[];
    /** One cheap read of the product's API. */
    readonly probe: () => Promise<unknown>;
    readonly remedyFor: (error: AppError) => string;
  },
) => {
  const [scopes, address] = await Promise.all([grant.scopes(), grant.whoami()]);
  const api = await check.probe().then(
    () => "enabled",
    (thrown: unknown) => {
      unlessCancelled("the health check stopped before every API was asked");
      const error = asAppError(thrown);
      if (error?.kind === "api" && isServiceDisabled(error.reason)) return "disabled";
      return describeThrownWith(check.remedyFor)(thrown);
    },
  );
  const missingScopes = check.required.filter((s) => !scopes.includes(s));
  const addressMatches = grant.address === undefined || address === undefined ? null : grant.address.toLowerCase() === address.toLowerCase();
  return {
    ok: missingScopes.length === 0 && addressMatches !== false && api === "enabled",
    ...(address ? { address } : {}),
    addressMatches,
    scopes,
    ...(missingScopes.length ? { missingScopes } : {}),
    api,
    credentialsPath: grant.credentials,
  };
};

/** Every account's health, one dead grant never hiding the verdict on another. */
export const healthOfAll = async <D extends { readonly grant: Grant }>(
  accounts: readonly D[],
  check: (deps: D) => Promise<{ readonly ok: boolean }>,
  describe: (thrown: unknown) => string,
) => {
  const results = await Promise.all(
    accounts.map((deps) =>
      check(deps).then(
        (value) => ({ account: deps.grant.account, ...value }),
        (thrown: unknown) => {
          unlessCancelled("the health check stopped before every account was checked");
          return { account: deps.grant.account, ok: false, error: describe(thrown) };
        },
      ),
    ),
  );
  return { accounts: results, allOk: results.every((r) => r.ok) };
};

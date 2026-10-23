import type { Deps } from "../ports.js";

export type Health = {
  readonly ok: boolean;
  readonly account: string;
  readonly grant: string;
  readonly grantDetail: string;
  readonly quotaUsedBytes: number | null;
  readonly quotaLimitBytes: number | null;
};

/**
 * Alive, and as whom.
 *
 * "As whom" is the half that matters: a server holding several Google
 * identities has one Drive grant, and a server that reported only "reachable"
 * would look healthy while acting on the wrong account.
 */
export const checkHealth = async (deps: Deps): Promise<Health> => {
  const about = await deps.drive.about();
  const grant = deps.grant();
  return {
    ok: true,
    account: about.user,
    grant: grant.source,
    grantDetail: grant.detail,
    quotaUsedBytes: about.quotaUsedBytes,
    quotaLimitBytes: about.quotaLimitBytes,
  };
};

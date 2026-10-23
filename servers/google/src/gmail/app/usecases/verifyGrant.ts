import { canWrite, type GrantRole, roleProblems, splitScopes } from "../../domain/grants.js";
import type { GrantDeclaration, GrantHandle, Profile, TokenInfo } from "../ports.js";

export type Verdict = {
  readonly ok: boolean;
  /** Empty when ok. Each entry is something a human has to act on. */
  readonly problems: readonly string[];
  readonly role: GrantRole;
  readonly mailbox: string | undefined;
  readonly grantedScope: string | undefined;
  readonly canWrite: boolean;
  readonly aud: string | undefined;
  readonly historyId: string | undefined;
};

/**
 * Compare what Google GRANTS with what the credentials file DECLARES and the registry expects.
 *
 * Pure on purpose, and it carries no expected client id of its own: both sides
 * are supplied, so there is no constant here that could go stale. It catches
 * the ways a grant drifts in practice:
 * - a credentials file naming a client the live token no longer belongs to;
 * - a grant narrower than the file claims;
 * - a grant that does not fit its ROLE: the server's own grant without
 *   gmail.modify, or a read-only one that has quietly become able to write
 *   (least privilege, made checkable);
 * - a credential that resolves to a different mailbox than the registry says,
 *   which is what approving the consent screen as the wrong account produces.
 */
export const judgeGrant = (
  role: GrantRole,
  declared: GrantDeclaration,
  info: TokenInfo,
  profile: Profile,
  expectedMailbox?: string,
): Verdict => {
  const granted = splitScopes(info.scope);
  const missing = declared.scopes.filter((s) => !granted.includes(s));
  const wrongMailbox =
    expectedMailbox !== undefined &&
    profile.emailAddress != null &&
    profile.emailAddress.toLowerCase() !== expectedMailbox.toLowerCase();
  const problems = [
    ...(info.aud !== declared.clientId
      ? ["the live token belongs to a different OAuth client than credentials.json names"]
      : []),
    ...(missing.length > 0 ? [`declared but not granted: ${missing.join(", ")}`] : []),
    ...roleProblems(role, granted),
    ...(wrongMailbox ? [`this credential is ${profile.emailAddress}, but the registry says ${expectedMailbox}`] : []),
  ];
  return {
    ok: problems.length === 0,
    problems,
    role,
    mailbox: profile.emailAddress ?? undefined,
    grantedScope: info.scope,
    canWrite: canWrite(granted),
    aud: info.aud,
    historyId: profile.historyId ?? undefined,
  };
};

export const verifyGrant = async (grant: GrantHandle, expectedMailbox?: string): Promise<Verdict> => {
  const [declared, info, profile] = await Promise.all([grant.declaration(), grant.tokenInfo(), grant.profile()]);
  return judgeGrant(grant.role, declared, info, profile, expectedMailbox);
};

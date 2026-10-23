import { describeThrown } from "../../domain/errors.js";
import type { Deps } from "../ports.js";
import { verifyGrant } from "./verifyGrant.js";

/**
 * Is this alive, as whom, on which OAuth client, and can it write.
 *
 * Every grant configured for the account is checked, the one its tools do not
 * use included: a read-only grant may be shared with another program, and this
 * is where it becomes visible if it widened. A grant that fails is reported beside the
 * others rather than thrown, so one dead credential cannot hide the verdict on
 * the rest.
 */
export const checkHealth = async (deps: Deps) => {
  const grants = await Promise.all(
    deps.grants.map(async (g) => {
      const base = { role: g.role, active: g === deps.grant, credentialsPath: g.credentials };
      try {
        const v = await verifyGrant(g, deps.address);
        return { ...base, ok: v.ok, mailbox: v.mailbox, grantedScope: v.grantedScope, canWrite: v.canWrite, oauthClientAud: v.aud, problems: v.problems };
      } catch (thrown) {
        return { ...base, ok: false, error: describeThrown(thrown) };
      }
    }),
  );
  const active = grants.find((g) => g.active);
  const profile = await deps.gmail.profile();
  return {
    ok: grants.every((g) => g.ok),
    mailbox: profile.emailAddress,
    messagesTotal: profile.messagesTotal,
    historyId: profile.historyId,
    /** Which grant the tools run on, and whether the write tools will work. */
    activeGrant: deps.grant.role,
    canWrite: active !== undefined && "canWrite" in active ? active.canWrite === true : false,
    grants,
    stateDir: deps.paths.stateDir,
  };
};

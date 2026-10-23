import { isoAt } from "../../domain/dates.js";
import { isPendingLive, pendingExpiresAtMs, sessionView } from "../../domain/session.js";
import type { Deps } from "../ports.js";

/**
 * Is the server able to work: where the credential and the code come from,
 * whether a session is stored. No network: a health check that signed in
 * would e-mail the user a code on every timer tick. session_status with
 * probe, or login, is for that.
 */
export const health = async (deps: Deps) => {
  const stored = await deps.store.read();
  const pending = await deps.store.readPending();
  const credentials = deps.credentials.info;
  const codes = deps.codes.info;
  const problems = [
    ...(credentials.kind === "none" ? [`no credential: ${credentials.missing}`] : []),
    ...(codes.driver === "manual" ? [`codes are typed by hand (${codes.why}): every sign-in needs complete_login`] : []),
  ];
  return {
    ok: true as const,
    portal: deps.portalUrl,
    credential: credentials,
    code: codes,
    session: stored === undefined ? ("none" as const) : { stored: true as const, ...sessionView(stored, deps.now()) },
    ...(pending !== undefined && isPendingLive(pending, deps.now()) ? { awaiting_code_until: isoAt(pendingExpiresAtMs(pending)) } : {}),
    downloads: deps.files.root,
    automatic_login: credentials.kind !== "none" && codes.driver !== "manual",
    ...(problems.length > 0 ? { problems } : {}),
  };
};

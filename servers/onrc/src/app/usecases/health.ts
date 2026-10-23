import { isRefreshExpired } from "../../domain/session.js";
import type { Deps } from "../ports.js";

/**
 * Is the server able to answer: configured, and holding a session. No
 * network: a health check that calls Keycloak would spend a refresh on every
 * timer tick. `probe` in session_status is for that.
 */
export const health = async (deps: Deps) => {
  const stored = await deps.session.read();
  const session = stored === undefined ? "none" : isRefreshExpired(stored, deps.now()) ? "expired" : "present";
  return { ok: true as const, session, redirect_uri: deps.login.redirectUri, ...(deps.loginScript === undefined ? {} : { login_script: deps.loginScript }) };
};

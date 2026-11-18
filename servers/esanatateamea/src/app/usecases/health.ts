import { isRefreshExpired } from "../../domain/session.js";
import type { Deps } from "../ports.js";

/**
 * Is the server able to answer: configured, and holding a session or a way
 * to make one. No network: a health check that called Keycloak would spend a
 * sign-in on every timer tick. `probe` in session_status is for that.
 */
export const health = async (deps: Deps) => {
  const stored = await deps.session.read();
  const session = stored === undefined ? "none" : isRefreshExpired(stored, deps.now()) ? "expired" : "present";
  return {
    ok: true as const,
    session,
    signed_in_with: stored?.via ?? null,
    password_sign_in: deps.credentials.info,
    authenticator_code: deps.credentials.code?.info ?? { kind: "asked" as const },
    redirect_uri: deps.login.redirectUri,
    ...(deps.loginScript === undefined ? {} : { login_script: deps.loginScript }),
  };
};

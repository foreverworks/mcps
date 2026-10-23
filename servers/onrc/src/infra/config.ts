import { stateDirOf } from "@foreverworks/mcp-kit";

/**
 * Settings, from the environment only.
 *
 * ONRC_STATE_DIR is where the session and a begun login live; unset, the
 * kit's one default for state (packages/mcp-kit, env.ts). Under a service it
 * belongs in a directory only the service's user can read. The rest name the
 * portal and its Keycloak, and default to the public ones, so another
 * deployment (a test realm, a mirror) is a variable away:
 *
 * - ONRC_ISSUER: the realm, `https://sso.onrc.ro/realms/onrc`
 * - ONRC_CLIENT_ID: the portal's own public client, `frontoffice-app`
 * - ONRC_PORTAL: `https://myportal.onrc.ro`
 * - ONRC_REDIRECT_URI: where Keycloak sends the browser back. It must be one
 *   the client registers, so by default the portal's own
 *   `static-pages/silent-check-sso.html`: a static page that does nothing when
 *   opened as a tab, so the code stays in the address bar unspent.
 * - ONRC_SCOPES: space-separated, `openid`
 * - ONRC_LOGIN_SCRIPT: a command this deployment has that runs a login end to
 *   end (begins it, brings the user the link, completes it), named in the
 *   remedy when set
 * - ONRC_KEEPALIVE_MIN: refresh the session every N minutes while one exists,
 *   so an idle SSO session does not lapse between the user's tasks; 0 (off)
 *   by default
 */
export type AppConfig = {
  readonly stateDir: string;
  readonly issuer: string;
  readonly clientId: string;
  readonly portal: string;
  readonly redirectUri: string;
  readonly scopes: readonly string[];
  readonly loginScript: string | undefined;
  readonly keepaliveMin: number;
};

const trimmed = (env: NodeJS.ProcessEnv, name: string): string | undefined => {
  const value = env[name]?.trim();
  return value ? value : undefined;
};

const noSlash = (url: string): string => url.replace(/\/+$/, "");

export const configFrom = (env: NodeJS.ProcessEnv): AppConfig => {
  const stateDir = stateDirOf(env, "onrc", "ONRC_STATE_DIR");
  const portal = noSlash(trimmed(env, "ONRC_PORTAL") ?? "https://myportal.onrc.ro");
  const keepalive = Number(trimmed(env, "ONRC_KEEPALIVE_MIN") ?? "0");
  return {
    stateDir,
    issuer: noSlash(trimmed(env, "ONRC_ISSUER") ?? "https://sso.onrc.ro/realms/onrc"),
    clientId: trimmed(env, "ONRC_CLIENT_ID") ?? "frontoffice-app",
    portal,
    redirectUri: trimmed(env, "ONRC_REDIRECT_URI") ?? `${portal}/static-pages/silent-check-sso.html`,
    scopes: (trimmed(env, "ONRC_SCOPES") ?? "openid").split(/\s+/).filter((s) => s !== ""),
    loginScript: trimmed(env, "ONRC_LOGIN_SCRIPT"),
    keepaliveMin: Number.isFinite(keepalive) && keepalive > 0 ? keepalive : 0,
  };
};

/** Keycloak's endpoints under a realm (OpenID Connect discovery names them; these are its fixed paths). */
export const endpoints = (issuer: string) => ({
  authorize: `${issuer}/protocol/openid-connect/auth`,
  token: `${issuer}/protocol/openid-connect/token`,
  logout: `${issuer}/protocol/openid-connect/logout`,
});

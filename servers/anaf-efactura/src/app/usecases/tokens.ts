import { describeBundle, needsRefresh, REFRESH_SKEW_S, type TokenBundle } from "../../domain/tokens.js";
import type { Deps } from "../ports.js";

/** What is stored right now, without touching ANAF. */
export const tokenStatus = async ({ tokens, identity, paths, now }: Deps) => {
  const [bundle, app] = await Promise.all([tokens.read(), identity()]);
  return {
    ok: true,
    appName: app.appName,
    clientIdLast4: app.clientIdLast4,
    defaultCif: app.defaultCif,
    tokensPath: paths.tokens,
    ...describeBundle(bundle, now()),
  };
};

export type Refreshed = {
  readonly refreshed: boolean;
  /** Days the access token had left before this call. */
  readonly accessDaysBefore: number;
  readonly bundle: TokenBundle;
};

/**
 * Mint a new access token when the stored one is within `withinS` of expiry,
 * or always with `force`.
 *
 * Without `force` this is a no-op while the access token still has its
 * cushion, because each refresh ROTATES the refresh token: a caller who
 * refreshes on a whim spends the only credential that can recover the grant.
 * The MCP tool uses the three-day cushion every call uses; the daily
 * maintenance job (`--refresh`) passes its fourteen-day window. A refresh
 * token past its expiry is refused where it would be spent (infra/grant.ts).
 */
export const refresh = async (deps: Deps, { force, withinS }: { readonly force: boolean; readonly withinS: number }): Promise<Refreshed> => {
  const { tokens, now } = deps;
  const current = await tokens.read();
  const at = now();
  const accessDaysBefore = Math.max(0, current.accessTokenExpEpoch - at) / 86_400;

  if (!force && !needsRefresh(current, at, withinS)) return { refreshed: false, accessDaysBefore, bundle: current };
  return { refreshed: true, accessDaysBefore, bundle: await tokens.rotate() };
};

/** The `refresh_token` tool. */
export const refreshTokens = async (deps: Deps, { force }: { readonly force: boolean }) => {
  const { refreshed, bundle } = await refresh(deps, { force, withinS: REFRESH_SKEW_S });
  return {
    ok: true,
    refreshed,
    ...(refreshed ? {} : { reason: "the access token still has its cushion; pass force to refresh anyway" }),
    ...describeBundle(bundle, deps.now()),
  };
};

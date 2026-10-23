import { authError, fail } from "./errors.js";

/**
 * ANAF's OAuth2 pair, and the rules for when it is still usable.
 *
 * A refresh answers with a new access token AND a new refresh token, and ANAF's
 * procedure says both "must be saved to be used further" (source in
 * schema.ts). This server treats the old refresh token as dead from that
 * moment, which is the safe reading: the model is persisted rather than
 * derived, and the store that holds it takes a lock before writing.
 */
export type TokenBundle = {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly tokenType: string;
  readonly expiresIn: number;
  readonly scope: string;
  readonly obtainedAtEpoch: number;
  readonly accessTokenExpEpoch: number;
  readonly refreshTokenExpEpoch: number;
  /** From the access token's claims; carried forward when a refresh omits them. */
  readonly serial?: string | undefined;
  readonly issuer?: string | undefined;
  readonly roles?: string | undefined;
};

const DAY_S = 86_400;

/** ANAF: "ACCES TOKEN JWT: 129600 minute = 90 zile". Used when the token states no `exp`. */
export const ACCESS_TOKEN_LIFETIME_S = 90 * DAY_S;

/** ANAF: "REFRESH TOKEN JWT: 525600 minute = 365 zile". The refresh token is opaque, so this is derived. */
export const REFRESH_TOKEN_LIFETIME_S = 365 * DAY_S;

/**
 * An MCP call refreshes on its own this long before the access token expires.
 * The cost of being early is one HTTP call; the cost of being late is a
 * manual session with a card reader.
 */
export const REFRESH_SKEW_S = 3 * DAY_S;

/**
 * The daily maintenance job (`--refresh`) refreshes this long before expiry.
 * Two weeks of daily attempts means one ANAF outage cannot cost the grant.
 */
export const MAINTENANCE_WINDOW_S = 14 * DAY_S;

/** Warn this long before the refresh token itself runs out: recovery needs a person and a card reader. */
export const REAUTHORIZE_WARNING_S = 14 * DAY_S;

export const isAccessExpired = (b: TokenBundle, nowEpoch: number): boolean => nowEpoch >= b.accessTokenExpEpoch;

export const needsRefresh = (b: TokenBundle, nowEpoch: number, withinS: number = REFRESH_SKEW_S): boolean =>
  nowEpoch >= b.accessTokenExpEpoch - withinS;

export const isRefreshExpired = (b: TokenBundle, nowEpoch: number): boolean => nowEpoch >= b.refreshTokenExpEpoch;

/** What a token endpoint answer amounts to, once the claims are read out of the access token. */
export type Issued = {
  readonly accessToken: string;
  readonly refreshToken?: string | undefined;
  readonly tokenType?: string | undefined;
  readonly expiresIn?: number | undefined;
  readonly scope?: string | undefined;
  /** The access token's own `exp`, when it is a JWT that states one. */
  readonly accessExpEpoch?: number | undefined;
  readonly serial?: string | undefined;
  readonly issuer?: string | undefined;
  readonly roles?: string | undefined;
};

/**
 * The bundle to persist after a code exchange (no `previous`) or a refresh.
 *
 * Every optional field says what happens when it is absent:
 * - no `exp` in the access token: obtained + `expires_in`, else + 90 days;
 * - no `refresh_token` in a refresh answer: keep the old one AND its expiry,
 *   rather than writing `undefined` over the only credential that can recover
 *   the grant; in a code exchange there is nothing to keep, so that fails;
 * - a new refresh token opens a fresh 365-day window; the SAME one returned
 *   again keeps the window it already had, so a non-rotating answer can never
 *   make the grant look younger than it is;
 * - no claims: carried forward from the previous bundle.
 */
export const bundleFrom = (minted: Issued, nowEpoch: number, previous?: TokenBundle): TokenBundle => {
  const refreshToken =
    minted.refreshToken ??
    previous?.refreshToken ??
    fail(authError("no_refresh_token", "ANAF granted an access token without a refresh token; the grant cannot be kept"));
  const rotated = previous === undefined || refreshToken !== previous.refreshToken;
  const accessTokenExpEpoch = minted.accessExpEpoch ?? nowEpoch + (minted.expiresIn ?? ACCESS_TOKEN_LIFETIME_S);
  return {
    accessToken: minted.accessToken,
    refreshToken,
    tokenType: minted.tokenType ?? previous?.tokenType ?? "Bearer",
    expiresIn: minted.expiresIn ?? accessTokenExpEpoch - nowEpoch,
    scope: minted.scope ?? previous?.scope ?? "",
    obtainedAtEpoch: nowEpoch,
    accessTokenExpEpoch,
    refreshTokenExpEpoch:
      rotated || previous === undefined ? nowEpoch + REFRESH_TOKEN_LIFETIME_S : previous.refreshTokenExpEpoch,
    serial: minted.serial ?? previous?.serial,
    issuer: minted.issuer ?? previous?.issuer,
    roles: minted.roles ?? previous?.roles,
  };
};

/**
 * tokens.json, which stays snake_case and carries a human-readable
 * `obtained_at` beside the epoch: an operator reading it during an incident
 * should not have to convert a number in their head. Optional fields may be
 * absent or null in a file another program wrote.
 */
export type StoredTokens = {
  readonly access_token: string;
  readonly refresh_token: string;
  readonly token_type?: string | undefined;
  readonly expires_in?: number | undefined;
  readonly scope?: string | undefined;
  readonly obtained_at_epoch: number;
  readonly obtained_at?: string | undefined;
  readonly access_token_exp_epoch: number;
  readonly refresh_token_exp_epoch: number;
  readonly serial?: string | null | undefined;
  readonly issuer?: string | null | undefined;
  readonly roles?: string | null | undefined;
};

/** Reads the stored shape. Absent optional fields get ANAF's documented defaults. */
export const fromStored = (s: StoredTokens): TokenBundle => ({
  accessToken: s.access_token,
  refreshToken: s.refresh_token,
  tokenType: s.token_type ?? "Bearer",
  expiresIn: s.expires_in ?? ACCESS_TOKEN_LIFETIME_S,
  scope: s.scope ?? "",
  obtainedAtEpoch: s.obtained_at_epoch,
  accessTokenExpEpoch: s.access_token_exp_epoch,
  refreshTokenExpEpoch: s.refresh_token_exp_epoch,
  serial: s.serial ?? undefined,
  issuer: s.issuer ?? undefined,
  roles: s.roles ?? undefined,
});

export const toStored = (b: TokenBundle): StoredTokens => ({
  access_token: b.accessToken,
  refresh_token: b.refreshToken,
  token_type: b.tokenType,
  expires_in: b.expiresIn,
  scope: b.scope,
  obtained_at_epoch: b.obtainedAtEpoch,
  obtained_at: new Date(b.obtainedAtEpoch * 1000).toISOString(),
  access_token_exp_epoch: b.accessTokenExpEpoch,
  refresh_token_exp_epoch: b.refreshTokenExpEpoch,
  serial: b.serial ?? null,
  issuer: b.issuer ?? null,
  roles: b.roles ?? null,
});

export const days = (seconds: number): number => Math.round((seconds / DAY_S) * 100) / 100;

export const isoOf = (epoch: number): string => new Date(epoch * 1000).toISOString();

/** The two expiries, which is all a caller of complete_authorization or --refresh is told. */
export const expiries = (b: TokenBundle) => ({
  accessTokenExpiresAt: isoOf(b.accessTokenExpEpoch),
  refreshTokenExpiresAt: isoOf(b.refreshTokenExpEpoch),
});

/**
 * What `token_status` reports.
 *
 * Deliberately carries no token material: the point of the tool is to answer
 * "will this still work tomorrow", and a tool that prints a live bearer token
 * into a transcript answers a question nobody asked.
 */
export const describeBundle = (b: TokenBundle, nowEpoch: number) => ({
  scope: b.scope,
  roles: b.roles,
  serial: b.serial,
  issuer: b.issuer,
  ...expiries(b),
  accessTokenRemainingDays: days(Math.max(0, b.accessTokenExpEpoch - nowEpoch)),
  refreshTokenRemainingDays: days(Math.max(0, b.refreshTokenExpEpoch - nowEpoch)),
  needsRefresh: needsRefresh(b, nowEpoch),
  isAccessExpired: isAccessExpired(b, nowEpoch),
  isRefreshExpired: isRefreshExpired(b, nowEpoch),
});

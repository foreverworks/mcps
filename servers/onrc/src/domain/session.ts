/**
 * The user's portal session, as Keycloak hands it out: an access token that
 * lives minutes and a refresh token that lives as long as the SSO session.
 *
 * Keycloak states both lifetimes in the token answer (`expires_in`,
 * `refresh_expires_in`; 0 for an offline token that does not expire by time).
 * Both are kept as epochs so a reader of the file during an incident needs no
 * arithmetic, and the verdicts below are the one place the rules live. Pure.
 */
export type Session = {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly tokenType: string;
  readonly scope: string;
  readonly obtainedAtEpoch: number;
  readonly accessExpEpoch: number;
  /** Absent when Keycloak said the refresh token does not expire by time (refresh_expires_in 0). */
  readonly refreshExpEpoch?: number | undefined;
};

/** What a token endpoint answered, the parts this server keeps. */
export type Issued = {
  readonly accessToken: string;
  readonly refreshToken?: string | undefined;
  readonly tokenType?: string | undefined;
  readonly expiresIn: number;
  readonly refreshExpiresIn?: number | undefined;
  readonly scope?: string | undefined;
};

/** Seconds assumed for an access token when the answer states none. Keycloak's default is 5 minutes. */
export const ACCESS_LIFETIME_S = 300;

/**
 * Mint a new access token this long before the stated expiry. Keycloak's
 * access tokens are short, so the cushion is short too; the cost of being
 * early is one request to sso.onrc.ro.
 */
export const REFRESH_SKEW_S = 30;

/**
 * The session after a code exchange (no `previous`) or a refresh.
 *
 * A refresh answer without a refresh token keeps the old one AND its expiry
 * (Keycloak rotates refresh tokens only when the realm says so); a new one
 * takes the expiry the answer states. A code exchange without a refresh token
 * is a session that cannot outlive its first access token, and is refused by
 * the caller, not here: this is arithmetic.
 */
export const sessionFrom = (issued: Issued, nowEpoch: number, previous?: Session): Session | undefined => {
  const refreshToken = issued.refreshToken ?? previous?.refreshToken;
  if (refreshToken === undefined) return undefined;
  const rotated = issued.refreshToken !== undefined && issued.refreshToken !== previous?.refreshToken;
  const refreshExpEpoch = rotated || previous === undefined ? refreshExpiry(issued.refreshExpiresIn, nowEpoch) : previous.refreshExpEpoch;
  return {
    accessToken: issued.accessToken,
    refreshToken,
    tokenType: issued.tokenType ?? previous?.tokenType ?? "Bearer",
    scope: issued.scope ?? previous?.scope ?? "",
    obtainedAtEpoch: nowEpoch,
    accessExpEpoch: nowEpoch + (issued.expiresIn > 0 ? issued.expiresIn : ACCESS_LIFETIME_S),
    refreshExpEpoch,
  };
};

const refreshExpiry = (refreshExpiresIn: number | undefined, nowEpoch: number): number | undefined =>
  refreshExpiresIn !== undefined && refreshExpiresIn > 0 ? nowEpoch + refreshExpiresIn : undefined;

export const isAccessExpired = (s: Session, nowEpoch: number): boolean => nowEpoch >= s.accessExpEpoch;

export const isRefreshExpired = (s: Session, nowEpoch: number): boolean => s.refreshExpEpoch !== undefined && nowEpoch >= s.refreshExpEpoch;

export const isoOf = (epoch: number): string => new Date(epoch * 1000).toISOString();

/**
 * What session_status reports. Deliberately carries no token material: the
 * question it answers is "will the next call work", and a tool that prints a
 * bearer token into a transcript answers one nobody asked.
 */
export const describeSession = (s: Session, nowEpoch: number) => ({
  obtainedAt: isoOf(s.obtainedAtEpoch),
  accessTokenExpiresAt: isoOf(s.accessExpEpoch),
  refreshTokenExpiresAt: s.refreshExpEpoch === undefined ? null : isoOf(s.refreshExpEpoch),
  refreshTokenRemainingMinutes: s.refreshExpEpoch === undefined ? null : Math.max(0, Math.round((s.refreshExpEpoch - nowEpoch) / 60)),
  isAccessExpired: isAccessExpired(s, nowEpoch),
  isRefreshExpired: isRefreshExpired(s, nowEpoch),
  scope: s.scope,
});

/**
 * The file, snake_case like every grant file in this repo, with a readable
 * `obtained_at` beside the epoch for whoever reads it during an incident.
 */
export type StoredSession = {
  readonly access_token: string;
  readonly refresh_token: string;
  readonly token_type?: string | undefined;
  readonly scope?: string | undefined;
  readonly obtained_at_epoch: number;
  readonly obtained_at?: string | undefined;
  readonly access_exp_epoch: number;
  readonly refresh_exp_epoch?: number | null | undefined;
};

export const fromStored = (s: StoredSession): Session => ({
  accessToken: s.access_token,
  refreshToken: s.refresh_token,
  tokenType: s.token_type ?? "Bearer",
  scope: s.scope ?? "",
  obtainedAtEpoch: s.obtained_at_epoch,
  accessExpEpoch: s.access_exp_epoch,
  refreshExpEpoch: s.refresh_exp_epoch ?? undefined,
});

export const toStored = (s: Session): StoredSession => ({
  access_token: s.accessToken,
  refresh_token: s.refreshToken,
  token_type: s.tokenType,
  scope: s.scope,
  obtained_at_epoch: s.obtainedAtEpoch,
  obtained_at: isoOf(s.obtainedAtEpoch),
  access_exp_epoch: s.accessExpEpoch,
  refresh_exp_epoch: s.refreshExpEpoch ?? null,
});

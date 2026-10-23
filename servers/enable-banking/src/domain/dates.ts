import { isIsoDate } from "@foreverworks/mcp-kit";

import { fail, inputError } from "./errors.js";

const DAY_MS = 86_400_000;

/** An optional YYYY-MM-DD filter. Empty means "whatever the API defaults to". */
export const parseOptionalDate = (name: string, value: string): string | undefined => {
  if (value === "") return undefined;
  if (!isIsoDate(value)) fail(inputError(`${name} must be YYYY-MM-DD, got "${value}"`));
  return value;
};

export const parseRange = (from: string, to: string): { readonly from?: string; readonly to?: string } => {
  const parsedFrom = parseOptionalDate("date_from", from);
  const parsedTo = parseOptionalDate("date_to", to);
  if (parsedFrom !== undefined && parsedTo !== undefined && parsedFrom > parsedTo)
    fail(inputError(`date_from ${parsedFrom} is after date_to ${parsedTo}`));
  return { ...(parsedFrom === undefined ? {} : { from: parsedFrom }), ...(parsedTo === undefined ? {} : { to: parsedTo }) };
};

/**
 * How long a new consent is asked to last: 180 days, the most PSD2 lets a
 * bank grant before the account holder must authenticate again. The API
 * refuses a `valid_until` past the bank's own `maximum_consent_validity`, and
 * says so, rather than shortening it quietly.
 */
export const CONSENT_DAYS = 180;

/**
 * Enable Banking wants `valid_until` as a whole-second UTC timestamp with a `Z`.
 * A fractional second is rejected, which is a confusing 400 to debug.
 */
export const consentValidUntil = (nowMs: number, days: number = CONSENT_DAYS): string =>
  `${new Date(Math.floor(nowMs / 1000) * 1000 + days * DAY_MS).toISOString().slice(0, 19)}Z`;

export type Expiry = {
  readonly validUntil: string;
  /** Whole days until it lapses, rounded down; negative once it has. */
  readonly daysLeft: number;
  readonly expired: boolean;
};

/**
 * When a consent lapses, for a human deciding whether to renew. `undefined`
 * when the timestamp is absent or unreadable: saying nothing beats a made-up
 * date on the one figure that decides whether someone opens the bank app.
 */
export const expiryOf = (validUntil: string | null | undefined, nowEpoch: number): Expiry | undefined => {
  if (validUntil === null || validUntil === undefined) return undefined;
  const at = Date.parse(validUntil);
  if (Number.isNaN(at)) return undefined;
  const leftMs = at - nowEpoch * 1000;
  return { validUntil, daysLeft: Math.floor(leftMs / DAY_MS), expired: leftMs <= 0 };
};

/** One phrase for a person: when the consent ends, and how long that is from now. */
export const expiryPhrase = (expiry: Expiry | undefined): string => {
  if (expiry === undefined) return "unknown: the stored consent records no readable access.valid_until";
  const day = expiry.validUntil.slice(0, 10);
  if (expiry.expired) return `EXPIRED on ${day}; run start_auth and complete_auth to renew`;
  if (expiry.daysLeft === 0) return `expires today, ${day}`;
  return `expires ${day} (${expiry.daysLeft} day${expiry.daysLeft === 1 ? "" : "s"} left)`;
};

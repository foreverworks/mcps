import type { ClientConfig } from "../../domain/credentials.js";
import { splitScopes, USERINFO_EMAIL } from "../../domain/scopes.js";

/**
 * Consent through the server: what one waiting consent holds, how long it
 * waits, and the checks a finished one must pass before anything is written.
 * Pure.
 */

export const CONSENT_PRODUCTS = ["gmail", "calendar", "editors", "drive", "tasks", "contacts", "meet"] as const;
export type ConsentProduct = (typeof CONSENT_PRODUCTS)[number];

/** A consent begun and not yet completed. Kept in the service's state dir, used once. */
export type Pending = {
  /** The OAuth `state`: what ties the redirect to this consent. */
  readonly state: string;
  /** The PKCE verifier, which only the server ever holds. */
  readonly verifier: string;
  readonly product: ConsentProduct;
  readonly account: string;
  /** The client the authorization was asked on: the code can only be exchanged by it. */
  readonly client: ClientConfig;
  /** What the product needs, every one of them required in the grant. */
  readonly scopes: readonly string[];
  readonly redirectUri: string;
  /** Epoch milliseconds. */
  readonly createdAt: number;
};

/** How long a begun consent waits for its redirect: long enough to approve, short enough that a stale one cannot be replayed. */
export const PENDING_TTL_MS = 15 * 60 * 1000;

export const expiresAt = (pending: Pending): number => pending.createdAt + PENDING_TTL_MS;

export const isLive = (pending: Pending, now: number): boolean => now < expiresAt(pending);

/** What the authorization asks for: the product's scopes, and the address, so the grant can be checked against the account. */
export const requestedScopes = (scopes: readonly string[]): readonly string[] => [...scopes, USERINFO_EMAIL];

/** The required scopes a grant came back without: granular consent lets any box be left unticked. */
export const missingScopes = (required: readonly string[], granted: string | undefined): readonly string[] => {
  const got = splitScopes(granted);
  return required.filter((s) => !got.includes(s));
};

export const sameAddress = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

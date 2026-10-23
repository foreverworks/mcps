import { compact } from "@foreverworks/mcp-kit";

import { CODE_LIFETIME_MS } from "./codes.js";
import { isoAt } from "./dates.js";

/**
 * What the server keeps between calls. Pure data.
 *
 * SPV's sign-in is an F5 access policy: a session is its cookies, nothing
 * else, and it ends when SPV says so (an idle timeout, a sign-out elsewhere,
 * a restart). So a session is stored with when it was made and when it last
 * worked, and the first page that sends the client back to the sign-in form
 * is what proves it gone.
 */
export type Cookies = Readonly<Record<string, string>>;

export type Session = {
  readonly cookies: Cookies;
  readonly username: string;
  readonly signedInAtMs: number;
  /** The last time a page answered as signed in. */
  readonly lastOkAtMs: number;
};

/**
 * A sign-in waiting for its code: the cookies of the F5 session that asked
 * for it. Kept in the state dir so complete_login can finish it from another
 * call, or another process, within SPV's five minutes.
 */
export type PendingLogin = {
  readonly cookies: Cookies;
  readonly username: string;
  readonly startedAtMs: number;
};

/** Whether two cookie sets are the same session: what a caller saw die, against what is stored now. */
export const sameCookies = (a: Cookies, b: Cookies): boolean => {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
};

export const pendingExpiresAtMs = (p: PendingLogin): number => p.startedAtMs + CODE_LIFETIME_MS;

export const isPendingLive = (p: PendingLogin, nowMs: number): boolean => nowMs < pendingExpiresAtMs(p);

export const sessionView = (s: Session, nowMs: number) =>
  compact({
    username: s.username,
    signed_in_at: isoAt(s.signedInAtMs),
    last_ok_at: isoAt(s.lastOkAtMs),
    idle_minutes: Math.max(0, Math.round((nowMs - s.lastOkAtMs) / 60_000)),
  });

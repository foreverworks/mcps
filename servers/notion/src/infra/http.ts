import {
  type HttpAuth,
  type HttpFailure,
  type HttpOptions,
  type HttpRequest,
  makeHttp,
  makeThrottle,
  OUTCOME_UNKNOWN,
  type Pace,
  type ThrottleClock,
} from "@foreverworks/mcp-kit";

import { type AppError, fail } from "../domain/errors.js";
import { NOTION_FREE } from "./http/throttle.js";

/**
 * Notion's side of the kit's HTTP client (packages/mcp-kit, http.ts): the
 * version header, which answers mean "later", where a Notion error names its
 * reason, and the failure each outcome becomes. The loop, the backoff, the
 * Retry-After wait and the rule that a write is never sent twice blind are the
 * kit's.
 *
 * What each answer proves decides what happens next:
 * - 429 proves Notion did nothing: every request waits (Retry-After) and repeats.
 * - 409 `conflict_error` proves the same: Notion aborted the transaction
 *   ("a data collision"), so even a new page or an append repeats.
 * - 5xx and a dropped connection prove nothing: a read repeats; a write that is
 *   not idempotent (an append, a new page, a comment) fails as
 *   `outcome_unknown` (notionApi.ts marks which requests are which).
 * - 401 is final: an integration token does not expire, so a refusal means it
 *   was revoked. The one renewal the kit allows re-reads the token file first,
 *   so a replaced token works without a restart.
 */

export const API = "https://api.notion.com/v1";

/**
 * The API version, pinned. 2026-03-11 is the one with the Markdown endpoints
 * and `in_trash` (was `archived`); its data sources arrived in 2025-09-03.
 */
export const NOTION_VERSION = "2026-03-11";

/** The machine-readable reason in a Notion error body: `{"object": "error", "code": "object_not_found", ...}`. */
export const reasonOf = (body: unknown): string | undefined => {
  const code = (body as { readonly code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
};

/** Notion's own sentence, which usually names the id or the field. */
const messageOf = (body: unknown, fallback: string): string => {
  const message = (body as { readonly message?: unknown } | null)?.message;
  return typeof message === "string" && message.trim() !== "" ? message : fallback;
};

const failureFor = (account: string, failure: HttpFailure): AppError => {
  switch (failure.kind) {
    case "transport":
      return { kind: "api", account, status: 0, message: failure.message };
    case OUTCOME_UNKNOWN:
      return { kind: "outcome_unknown", account, message: messageOf(failure.body, failure.message) };
    case "rate_limited":
      return { kind: "rate_limited", account, message: failure.message };
    case "rejected": {
      const message = messageOf(failure.body, failure.message);
      switch (failure.status) {
        case 401:
          return { kind: "auth", account, message };
        case 403:
          return { kind: "forbidden", account, message };
        case 404:
          return { kind: "not_shared", accounts: [account], message };
        case 400:
          return { kind: "input", message, ...(failure.reason === undefined ? {} : { code: failure.reason }) };
        case 409:
          return { kind: "conflict", account, message };
        default:
          return { kind: "api", account, status: failure.status, message, ...(failure.reason === undefined ? {} : { code: failure.reason }) };
      }
    }
  }
};

/** Worth another attempt: a conflict that proves nothing happened, and an unwell server (529 is Notion's "overloaded"). */
export const isRetryable = (status: number): boolean => isHarmless(status) || status === 500 || status === 502 || status === 503 || status === 504 || status === 529;

/** Proves Notion did nothing: a 409 is an aborted transaction ("a data collision"), so even a new page or an append repeats. */
export const isHarmless = (status: number): boolean => status === 409;

/** What a caller (a test, mostly) may tune: the kit's options, and this server's pacing. */
export type NotionHttpOptions = HttpOptions & {
  readonly pace?: Pace;
  readonly clock?: ThrottleClock;
};

const realClock: ThrottleClock = { now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };

/** One workspace's client: its token, its own pace, its failures labelled with its name. */
export const makeNotionHttp = (account: string, auth: HttpAuth, { pace = NOTION_FREE, clock = realClock, timeoutMs = 60_000, sleep, random }: NotionHttpOptions = {}): HttpRequest => {
  const throttle = makeThrottle(pace, clock);
  return makeHttp({
    service: `Notion (${account})`,
    auth,
    isRetryable,
    isHarmless,
    reasonOf,
    fail: (failure) => fail(failureFor(account, failure)),
    attempts: 4,
    timeoutMs,
    headers: { "Notion-Version": NOTION_VERSION, Accept: "application/json" },
    // Each attempt, retries included, waits its turn: every attempt is a request Notion counts.
    fetch: (input, init) => throttle(() => fetch(input, init)),
    ...(sleep === undefined ? {} : { sleep }),
    ...(random === undefined ? {} : { random }),
  });
};

import { type HttpAuth, makeHttp, makePacer, makeTokenSource, memoryTokenStore, type Minted, type Query, type Sleep } from "@foreverworks/mcp-kit";

import type { GlovoPort, HistoryPage } from "../app/ports.js";
import { apiError, authError, fail } from "../domain/errors.js";
import type { RawDetails, RawListPage, RawRefresh } from "../domain/schema.js";
import type { Credentials } from "./credentials.js";
import { asApiFailure, asRefreshFailure, errorCodeOf } from "./glovoApi/failures.js";

/**
 * The Glovo customer API, as the web app at glovoapp.com (v1.2718.0) calls it.
 * Undocumented; see servers/glovo/API.md for how it was captured and how it
 * behaves.
 *
 * Auth: a refresh token mints ~20-minute access tokens via /oauth/refresh,
 * which returns the SAME refresh token and leaves the old one working, so it
 * is safe to repeat and never signs the user's browser out. /oauth/revoke is
 * logout; it is deliberately absent from this file, and a test asserts it is
 * never called. Neither the refresh response nor any token ever reaches a log
 * or an error message.
 *
 * The loop is the kit's (packages/mcp-kit: makeHttp's retries and one renewal
 * after a 401, a token source minting once for every waiter). What is Glovo's
 * is here: the paths, the headers the app sends, and the failure each outcome
 * becomes (glovoApi/failures.ts).
 */
const BASE = "https://api.glovoapp.com";
const REFRESH_PATH = "/oauth/refresh";
const LIST_PATH = "/v3/customer/orders-list";
const DETAIL_PATH = "/v3/customer/orders";
const API_VERSION = "14";
/** The parsers key on the English wording; they tolerate the Romanian too. */
const LANGUAGE = "en";

/**
 * Observed: list pages back to back are throttled with HTTP 429; detail calls
 * one at a time, ~700 ms apart, rarely are. So every API call (list pages
 * included) goes through one queue, at least this far apart.
 */
export const CALL_GAP_MS = 700;
/** The limit is capped at 15 by Glovo whatever is asked. */
const PAGE_SIZE = 15;
/**
 * On 429, wait at least this long before the next attempt (longer when
 * Retry-After says so), a few times, before giving up: Glovo's limit does not
 * reset in the kit's first seconds of backoff.
 */
const THROTTLE_FLOOR_MS = 20_000;
const ATTEMPTS = 4;

export type GlovoApiOptions = {
  readonly fetch?: typeof fetch;
  readonly sleep?: Sleep;
  /** The backoff's jitter; a test pins it to assert exact waits. */
  readonly random?: () => number;
  readonly now?: () => number;
  readonly callGapMs?: number;
  readonly timeoutMs?: number;
};

/** What the web app sends on every request, refresh included. */
const appHeaders = (deviceUrn: string) => ({
  "glovo-app-platform": "web",
  "glovo-app-type": "customer",
  "glovo-device-urn": deviceUrn,
});

export const makeGlovoApi = (credentials: () => Promise<Credentials>, options: GlovoApiOptions = {}): GlovoPort => {
  const { fetch: doFetch = fetch, now = Date.now, callGapMs = CALL_GAP_MS, timeoutMs = 30_000 } = options;
  /** Tests inject time; otherwise the kit and the pacer sleep for real. */
  const sleep = options.sleep ? { sleep: options.sleep } : {};
  const random = options.random ? { random: options.random } : {};

  const policy = {
    service: "Glovo",
    isRetryable: (status: number) => status >= 500,
    reasonOf: errorCodeOf,
    attempts: ATTEMPTS,
    timeoutMs,
    quotaFloorMs: THROTTLE_FLOOR_MS,
    ...sleep,
    ...random,
    fetch: doFetch,
  };

  const refreshHttp = makeHttp({ ...policy, fail: asRefreshFailure(REFRESH_PATH) });
  const mint = async (): Promise<Minted> => {
    const { refreshToken, deviceUrn } = await credentials();
    const body = await refreshHttp<RawRefresh | undefined>(`${BASE}${REFRESH_PATH}`, {
      method: "POST",
      idempotent: true,
      json: { refreshToken },
      headers: appHeaders(deviceUrn),
    });
    if (typeof body?.accessToken === "string" && typeof body.expiresIn === "number") {
      return { token: body.accessToken, expiresAtEpoch: Math.floor(now() / 1000) + body.expiresIn };
    }
    // Quoted by what is missing, never by what arrived: a 200 body here is a credential.
    return fail(authError(200, `${REFRESH_PATH} failed: no access token in the response`, false));
  };

  // In memory only: a mint is one call and safe to repeat, and a bearer token on disk would be one more credential file.
  const tokens = makeTokenSource({ mint, store: memoryTokenStore(), nowEpoch: () => Math.floor(now() / 1000) });
  /** The token goes RAW in `authorization`, with no "Bearer ": that is what the web app sends. */
  const auth: HttpAuth = { headers: async () => ({ authorization: await tokens.get() }), renew: tokens.force };

  const http = makeHttp({ ...policy, auth, fail: asApiFailure });

  /** An authenticated GET. A 401 on a token that still looked valid earns one forced refresh (the kit's). */
  const get = async <T>(path: string, query?: Query): Promise<T> => {
    const { deviceUrn } = await credentials();
    const body = await http<T | undefined>(`${BASE}${path}`, {
      ...(query ? { query } : {}),
      headers: { ...appHeaders(deviceUrn), accept: "application/json", "glovo-api-version": API_VERSION, "glovo-language-code": LANGUAGE },
    });
    return body ?? fail(apiError(200, `${path}: HTTP 200 with no JSON body`));
  };

  const paced = makePacer(callGapMs, { now, ...sleep });

  return {
    historyPage: async (cursor): Promise<HistoryPage> => {
      const page = await paced(() => get<RawListPage>(LIST_PATH, { offset: cursor ?? "0", limit: String(PAGE_SIZE) }));
      const next = page.pagination?.next?.offset;
      return { orders: page.orders ?? [], ...(next === undefined || next === null ? {} : { next: String(next) }) };
    },
    orderDetails: (orderId) => paced(() => get<RawDetails>(`${DETAIL_PATH}/${orderId}`)),
    probe: async () => ({ accessExpiresAt: (await tokens.rotate()).expiresAtEpoch }),
  };
};

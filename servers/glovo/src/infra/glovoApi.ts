import { type HttpAuth, liveFetch, makeHttp, makePacer, makeTokenSource, memoryTokenStore, type Minted, type Query, type Sleep } from "@foreverworks/mcp-kit";

import type { GlovoPort, HistoryPage } from "../app/ports.js";
import { apiError, authError, fail } from "../domain/errors.js";
import type { RawDetails, RawListPage, RawRefresh } from "../domain/schema.js";
import type { Credentials } from "./credentials.js";
import { asApiFailure, asRefreshFailure, errorCodeOf } from "./glovoApi/failures.js";

/**
 * The Glovo customer API, as the web app at glovoapp.com (v1.2989.0) calls it.
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
  /** The web app release to send as `Glovo-App-Version`; the constant when unset (see `resolveAppVersion`). */
  readonly appVersion?: string;
};

/**
 * The release of the web app whose headers these are, read from the app's own
 * page on 2026-11-18 (`NEXT_PUBLIC_APP_VERSION` in the HTML of glovoapp.com/en).
 * The app sends it, with a leading "v", as `Glovo-App-Version` and inside
 * `Glovo-Client-Info`, on every request. It moves with each release of the web
 * app (v1.2718.0 on 2026-11-07, v1.2989.0 on 2026-11-18), so it is a constant
 * with an override, `GLOVO_APP_VERSION`, and not a value read at run time: the
 * page that carries it is on the apex glovoapp.com, which an egress list of
 * `*.glovoapp.com` does not admit. The app's own fallback, "N/A" (a build that
 * carries no version), was accepted on 2026-11-07.
 */
export const DEFAULT_APP_VERSION = "v1.2989.0";
const VERSION_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,39}$/;

/** `GLOVO_APP_VERSION` when set (blank is unset), else the constant. A value that cannot be a header stops the server at start. */
export const resolveAppVersion = (env: NodeJS.ProcessEnv): string => {
  const named = env["GLOVO_APP_VERSION"]?.trim();
  if (!named) return DEFAULT_APP_VERSION;
  if (!VERSION_SHAPE.test(named)) throw new Error(`GLOVO_APP_VERSION "${named}" is not a web app version such as ${DEFAULT_APP_VERSION}`);
  return named;
};

/**
 * What the web app's axios instance sends that identifies the page rather than
 * the user, as read from its public bundle on 2026-11-18: the same values on
 * every request, refresh included.
 */
const WEB_ORIGIN = "https://glovoapp.com";
/** The app's `NEXT_PUBLIC_REQUEST_TTL`, sent as `Glovo-Request-TTL`. */
const REQUEST_TTL = "7500";
/** The app's `NEXT_PUBLIC_DEVELOPMENT_STATE` on the production site. */
const DEVELOPMENT_STATE = "prod";
/** A current Chrome on Linux, as it reports itself (Chrome freezes the minor numbers at 0). */
const BROWSER_USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";
/** Axios's own default `Accept`, which is what the app sends. */
const ACCEPT = "application/json, text/plain, */*";

/**
 * The analytics session the web app opens on load. Glovo has tightened its
 * check of /oauth/refresh's headers twice, and answers 403 whatever the token
 * when the set differs from the web app's:
 *
 * - 2026-11-07: required app version, client info, language code, the three
 *   Perseus headers and the request id (measured by dropping one header at a
 *   time from the app's own request; random UUIDs and the current time were
 *   accepted, and "N/A" passed as the version).
 * - 2026-11-18: 403 again for that set, with a brand-new refresh token, from
 *   Node and from a fetch inside the signed-in page, while the app's own call
 *   to the same path with the same body got 200. The set below is the one the
 *   app's axios instance sends, read from its public bundle: the API version
 *   and a real app version on refresh too, `Glovo-App-Context`,
 *   `Glovo-App-Development-State`, `Glovo-Request-TTL`, `Glovo-Dynamic-Session-Id`
 *   (the same id as the Perseus session's: the app sends one value twice),
 *   `Glovo-Client-Info` carrying that version, and the browser's own Accept,
 *   Accept-Language, Origin, Referer and User-Agent. Which of these Glovo
 *   checks has not been measured one by one (that takes the app's own token);
 *   all of them are sent.
 *
 * One session per process, as one page load is one in the app.
 */
const makeSession = (now: () => number, appVersion: string) => ({
  clientId: crypto.randomUUID(),
  sessionId: crypto.randomUUID(),
  startedAt: String(now()),
  appVersion,
});

/** What the web app sends on every request, refresh included. */
const appHeaders = (deviceUrn: string, session: ReturnType<typeof makeSession>) => ({
  accept: ACCEPT,
  "accept-language": LANGUAGE,
  origin: WEB_ORIGIN,
  referer: `${WEB_ORIGIN}/`,
  "user-agent": BROWSER_USER_AGENT,
  "glovo-api-version": API_VERSION,
  "glovo-app-context": "web",
  "glovo-app-development-state": DEVELOPMENT_STATE,
  "glovo-app-platform": "web",
  "glovo-app-type": "customer",
  "glovo-app-version": session.appVersion,
  "glovo-client-info": `web-customer-web-react/${session.appVersion} project:customer-web`,
  "glovo-language-code": LANGUAGE,
  "glovo-device-urn": deviceUrn,
  "glovo-dynamic-session-id": session.sessionId,
  "glovo-perseus-client-id": session.clientId,
  "glovo-perseus-session-id": session.sessionId,
  "glovo-perseus-session-timestamp": session.startedAt,
  "glovo-perseus-consent": "essential",
  "glovo-request-id": crypto.randomUUID(),
  "glovo-request-ttl": REQUEST_TTL,
});

export const makeGlovoApi = (credentials: () => Promise<Credentials>, options: GlovoApiOptions = {}): GlovoPort => {
  const { fetch: doFetch = liveFetch, now = Date.now, callGapMs = CALL_GAP_MS, timeoutMs = 30_000, appVersion = DEFAULT_APP_VERSION } = options;
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

  const session = makeSession(now, appVersion);
  const refreshHttp = makeHttp({ ...policy, fail: asRefreshFailure(REFRESH_PATH) });
  const mint = async (): Promise<Minted> => {
    const { refreshToken, deviceUrn } = await credentials();
    const body = await refreshHttp<RawRefresh | undefined>(`${BASE}${REFRESH_PATH}`, {
      method: "POST",
      idempotent: true,
      json: { refreshToken },
      // The kit would add "; charset=UTF-8"; axios, which the app sends this with, does not. Same spelling as the kit's, so this one replaces its.
      headers: { ...appHeaders(deviceUrn, session), "Content-Type": "application/json" },
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
      headers: appHeaders(deviceUrn, session),
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

import { bearer, makeHttp, makePacer, makeTokenSource, memoryTokenStore, type Minted, type Query, type Sleep } from "@foreverworks/mcp-kit";

import type { BoltPort } from "../app/ports.js";
import { apiError, authError, fail } from "../domain/errors.js";
import type { RawAccess, RawDetails, RawEnvelope, RawHistoryPage, RawSummary } from "../domain/schema.js";
import { codeOf, throttleAs429 } from "./boltApi/envelope.js";
import { asApiFailure, asMintFailure } from "./boltApi/failures.js";
import type { Credentials } from "./credentials.js";

/**
 * The Bolt Food eater API, as the web app (FW.1.117) calls it. Undocumented;
 * see servers/bolt-food/API.md for how it was captured and how it behaves.
 *
 * Auth: a refresh token (a JWT lasting ~364 days) mints one-hour access tokens
 * via getAccessToken, which does NOT rotate the refresh token and so is safe to
 * repeat. `rotateRefresh` DOES invalidate it and would sign the user out of
 * every device; it is deliberately absent from this file.
 *
 * The loop is the kit's (packages/mcp-kit: makeHttp's retries and one renewal
 * after a 401, a token source minting once for every waiter, bearer auth).
 * What is Bolt's is here: the paths, the parameters the app sends, the
 * envelope every answer comes in (boltApi/envelope.ts), and the failure each
 * outcome becomes (boltApi/failures.ts).
 */
const BASE = "https://deliveryuser.live.boltsvc.net";
const APP_VERSION = "FW.1.117";
const TOKEN_PATH = "/profile/eater/auth/getAccessToken";
const HISTORY_PATH = "/deliveryClient/getOrderHistory";
const DETAILS_PATH = "/deliveryClient/v2/getOrderDetails";

/**
 * Measured 2026-09-10: getOrderDetails throttled ~23% of calls at four workers
 * with a 60 ms gap, and none serially at 350 ms. So details go one at a time,
 * at least this far apart. getOrderHistory at page_size=50 was never throttled.
 */
export const DETAIL_GAP_MS = 350;
const PAGE_SIZE = 50;
/** Attempts per call; a throttled one waits the kit's backoff (1 s, 2 s, 4 s, ...) between them. */
const ATTEMPTS = 6;

export type BoltApiOptions = {
  readonly fetch?: typeof fetch;
  readonly sleep?: Sleep;
  /** The backoff's jitter; a test pins it to assert exact waits. */
  readonly random?: () => number;
  readonly now?: () => number;
  readonly detailGapMs?: number;
  readonly timeoutMs?: number;
};

export const makeBoltApi = (credentials: () => Promise<Credentials>, options: BoltApiOptions = {}): BoltPort => {
  const { fetch: doFetch = fetch, now = Date.now, detailGapMs = DETAIL_GAP_MS, timeoutMs = 30_000 } = options;
  /** Tests inject time; otherwise the kit and the pacer sleep for real. */
  const sleep = options.sleep ? { sleep: options.sleep } : {};
  const random = options.random ? { random: options.random } : {};

  /** Present on every call, GET or POST. Not validated hard by Bolt, but the app sends them. */
  const appParams = async (): Promise<Query> => {
    const { deviceId } = await credentials();
    return {
      version: APP_VERSION,
      language: "en-US",
      session_id: `${deviceId}eater${now()}`,
      device_name: "web",
      device_os_version: "web",
      deviceId,
      deviceType: "web",
    };
  };

  const policy = {
    service: "Bolt",
    isRetryable: (status: number) => status >= 500,
    reasonOf: (body: unknown) => codeOf(body)?.toString(),
    attempts: ATTEMPTS,
    timeoutMs,
    ...sleep,
    ...random,
    fetch: throttleAs429(doFetch),
  };

  // The refresh token is its own bearer on the one call that spends it.
  const mintHttp = makeHttp({ ...policy, fail: asMintFailure });
  const mint = async (): Promise<Minted> => {
    const { refreshToken } = await credentials();
    const envelope = await mintHttp<RawEnvelope<RawAccess> | undefined>(`${BASE}${TOKEN_PATH}`, {
      method: "POST",
      idempotent: true,
      query: await appParams(),
      json: { refresh_token: refreshToken },
      headers: { Authorization: `Bearer ${refreshToken}` },
    });
    const data = envelope?.data;
    if (envelope?.code === 0 && data?.access_token && data.expires_timestamp) {
      return { token: data.access_token, expiresAtEpoch: data.expires_timestamp };
    }
    return fail(authError(envelope?.code ?? 200, `getAccessToken refused: ${envelope?.message ?? "no access token in the answer"}`));
  };

  // In memory only: a mint is one call and safe to repeat, and a bearer token on disk would be one more credential file.
  const tokens = makeTokenSource({ mint, store: memoryTokenStore(), nowEpoch: () => Math.floor(now() / 1000) });
  const http = makeHttp({ ...policy, auth: bearer(tokens), fail: asApiFailure });

  /** An authenticated call. Every one reads, POST included, so every one is safe to resend. */
  const call = async <T>(path: string, spec: { readonly method: "GET" | "POST"; readonly query?: Query; readonly json?: unknown }): Promise<T> => {
    const envelope = await http<RawEnvelope<T> | undefined>(`${BASE}${path}`, {
      ...spec,
      idempotent: true,
      query: { ...(await appParams()), ...spec.query },
    });
    if (envelope?.code === 0 && envelope.data !== undefined) return envelope.data;
    return fail(apiError(200, `${path}: ${envelope?.message ?? "no message"}`, envelope?.code));
  };

  /** Detail calls only; the history was never throttled. */
  const paced = makePacer(detailGapMs, { now, ...sleep });

  return {
    history: async () => {
      const orders: RawSummary[] = [];
      let pageToken: string | undefined;
      for (;;) {
        const page = await call<RawHistoryPage>(HISTORY_PATH, {
          method: "GET",
          query: { page_size: String(PAGE_SIZE), page_token: pageToken },
        });
        orders.push(...(page.orders ?? []));
        if (!page.next_page_token || (page.orders ?? []).length === 0) return orders;
        pageToken = page.next_page_token;
      }
    },
    orderDetails: (orderId, cityId) =>
      paced(() => call<RawDetails>(DETAILS_PATH, { method: "POST", json: { order_id: orderId, city_id: cityId } })),
    probe: async () => ({ accessExpiresAt: (await tokens.rotate()).expiresAtEpoch }),
  };
};

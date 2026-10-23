import { describe, expect, it, vi } from "vitest";

import { asAppError } from "../src/domain/errors.js";
import { makeBoltApi } from "../src/infra/boltApi.js";
import { details } from "./fixtures.js";

const creds = async () => ({ refreshToken: "refresh-jwt", deviceId: "dev-1" });
const body = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const minted = (expires = 2_000_000_000) => body({ code: 0, data: { access_token: "access-jwt", expires_timestamp: expires } });
const noSleep = async () => undefined;

/** Routes by path; every request is recorded so a test can assert on the sequence. */
const fakeFetch = (routes: Record<string, (init: RequestInit, n: number) => Response>) => {
  const counts = new Map<string, number>();
  const calls: { path: string; url: string; init: RequestInit }[] = [];
  const impl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const path = new URL(url).pathname;
    const n = counts.get(path) ?? 0;
    counts.set(path, n + 1);
    calls.push({ path, url, init: init ?? {} });
    const route = routes[path];
    if (!route) throw new Error(`unrouted ${path}`);
    return route(init ?? {}, n);
  });
  return { fetch: impl as unknown as typeof fetch, calls };
};

const TOKEN = "/profile/eater/auth/getAccessToken";
const HISTORY = "/deliveryClient/getOrderHistory";
const DETAILS = "/deliveryClient/v2/getOrderDetails";

describe("makeBoltApi", () => {
  it("mints once, then sends the access token and the app's common params", async () => {
    const f = fakeFetch({ [TOKEN]: () => minted(), [HISTORY]: () => body({ code: 0, data: { orders: [], next_page_token: null } }) });
    const api = makeBoltApi(creds, { fetch: f.fetch, sleep: noSleep, now: () => 1_000_000 });
    await api.history();
    await api.history();
    expect(f.calls.filter((c) => c.path === TOKEN)).toHaveLength(1);
    const call = f.calls.find((c) => c.path === HISTORY);
    expect((call?.init.headers as Record<string, string>)["Authorization"]).toBe("Bearer access-jwt");
    expect(new URL(call?.url ?? "").searchParams.get("deviceId")).toBe("dev-1");
  });

  it("never calls rotateRefresh, which would sign the user out everywhere", async () => {
    const f = fakeFetch({ [TOKEN]: () => minted(), [HISTORY]: () => body({ code: 0, data: { orders: [] } }) });
    await makeBoltApi(creds, { fetch: f.fetch, sleep: noSleep }).history();
    expect(f.calls.some((c) => c.url.includes("rotateRefresh"))).toBe(false);
  });

  it("walks every history page", async () => {
    const f = fakeFetch({
      [TOKEN]: () => minted(),
      [HISTORY]: (_i, n) => body({ code: 0, data: { orders: [{ order_id: n }], next_page_token: n < 2 ? `p${n}` : null } }),
    });
    const orders = await makeBoltApi(creds, { fetch: f.fetch, sleep: noSleep }).history();
    expect(orders.map((o) => o.order_id)).toEqual([0, 1, 2]);
    expect(new URL(f.calls.at(-1)?.url ?? "").searchParams.get("page_token")).toBe("p1");
  });

  it("backs off on TOO_MANY_REQUESTS, which arrives as HTTP 200, on the kit's schedule", async () => {
    const sleep = vi.fn(async (_ms: number) => undefined);
    const f = fakeFetch({
      [TOKEN]: () => minted(),
      [DETAILS]: (_i, n) => (n < 2 ? body({ code: 1005, message: "TOO_MANY_REQUESTS" }) : body({ code: 0, data: details() })),
    });
    const d = await makeBoltApi(creds, { fetch: f.fetch, sleep, random: () => 0, detailGapMs: 0 }).orderDetails(1001, 1);
    expect(d.order_reference_id).toBe("AB12C");
    // makeHttp's backoff, jitter pinned to zero: 1 s, then 2 s.
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000]);
  });

  it("reports throttling that outlasts every attempt as Bolt's throttle code", async () => {
    const f = fakeFetch({ [TOKEN]: () => minted(), [HISTORY]: () => body({ code: 1005, message: "TOO_MANY_REQUESTS" }) });
    const error = await makeBoltApi(creds, { fetch: f.fetch, sleep: noSleep })
      .history()
      .catch((e: unknown) => asAppError(e));
    expect(error).toMatchObject({ kind: "api", status: 200, code: 1005 });
    expect(f.calls.filter((c) => c.path === HISTORY)).toHaveLength(6);
  });

  it("reports a refused refresh token as a permanent auth failure", async () => {
    const f = fakeFetch({ [TOKEN]: () => body({ code: 210, message: "REFRESH_TOKEN_INVALID" }) });
    const error = await makeBoltApi(creds, { fetch: f.fetch, sleep: noSleep })
      .probe()
      .catch((e: unknown) => asAppError(e));
    expect(error).toMatchObject({ kind: "auth", code: 210, permanent: true });
  });

  it("re-mints once on a 401, and believes the second", async () => {
    const f = fakeFetch({ [TOKEN]: () => minted(), [HISTORY]: () => body({ code: 999, message: "unauthorized" }, 401) });
    const error = await makeBoltApi(creds, { fetch: f.fetch, sleep: noSleep })
      .history()
      .catch((e: unknown) => asAppError(e));
    expect(error).toMatchObject({ kind: "api", status: 401 });
    expect(f.calls.filter((c) => c.path === TOKEN)).toHaveLength(2);
  });

  it("serialises detail calls and spaces them out", async () => {
    let clock = 0;
    const waits: number[] = [];
    const f = fakeFetch({ [TOKEN]: () => minted(), [DETAILS]: () => body({ code: 0, data: details() }) });
    const api = makeBoltApi(creds, {
      fetch: f.fetch,
      now: () => clock,
      sleep: async (ms) => {
        waits.push(ms);
        clock += ms;
      },
    });
    clock = 10_000;
    await Promise.all([api.orderDetails(1, 1), api.orderDetails(2, 1), api.orderDetails(3, 1)]);
    expect(waits).toEqual([350, 350]);
    expect(f.calls.filter((c) => c.path === DETAILS).map((c) => JSON.parse(String(c.init.body)).order_id)).toEqual([1, 2, 3]);
  });

  it("turns a network failure into an api error with status 0", async () => {
    const api = makeBoltApi(creds, {
      fetch: (async () => {
        throw new Error("ECONNRESET");
      }) as unknown as typeof fetch,
      sleep: noSleep,
    });
    expect(await api.probe().catch((e: unknown) => asAppError(e))).toMatchObject({ kind: "api", status: 0 });
  });
});

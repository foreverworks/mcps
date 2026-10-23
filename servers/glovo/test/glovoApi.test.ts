import { describe, expect, it, vi } from "vitest";

import { asAppError } from "../src/domain/errors.js";
import { makeGlovoApi } from "../src/infra/glovoApi.js";
import { details, row } from "./fixtures.js";

const creds = async () => ({ refreshToken: "refresh-jwt", deviceUrn: "glv:device:test" });
const json = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(value), { status, headers });
const minted = () => json({ accessToken: "access-jwt", expiresIn: 1198, refreshToken: "refresh-jwt", tokenType: "bearer" });
const noSleep = async () => undefined;

/** Routes by path; every request is recorded so a test can assert on the sequence. */
const fakeFetch = (routes: Record<string, (init: RequestInit, n: number, url: URL) => Response>) => {
  const counts = new Map<string, number>();
  const calls: { path: string; url: URL; init: RequestInit }[] = [];
  const impl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.startsWith("/v3/customer/orders/") ? "/v3/customer/orders/:id" : url.pathname;
    const n = counts.get(path) ?? 0;
    counts.set(path, n + 1);
    calls.push({ path, url, init: init ?? {} });
    const route = routes[path];
    if (!route) throw new Error(`unrouted ${path}`);
    return route(init ?? {}, n, url);
  });
  return { fetch: impl as unknown as typeof fetch, calls };
};

const REFRESH = "/oauth/refresh";
const LIST = "/v3/customer/orders-list";
const DETAIL = "/v3/customer/orders/:id";
const headersOf = (init: RequestInit) => init.headers as Record<string, string>;

describe("makeGlovoApi", () => {
  it("mints once, then sends the RAW access token and the web app's headers", async () => {
    const f = fakeFetch({ [REFRESH]: () => minted(), [LIST]: () => json({ pagination: { next: null }, orders: [] }) });
    const api = makeGlovoApi(creds, { fetch: f.fetch, sleep: noSleep, callGapMs: 0 });
    await api.historyPage(undefined);
    await api.historyPage(undefined);
    expect(f.calls.filter((c) => c.path === REFRESH)).toHaveLength(1);
    const refresh = f.calls.find((c) => c.path === REFRESH);
    expect(JSON.parse(String(refresh?.init.body))).toEqual({ refreshToken: "refresh-jwt" });
    expect(headersOf(refresh?.init ?? {})["glovo-device-urn"]).toBe("glv:device:test");
    expect(headersOf(f.calls.find((c) => c.path === LIST)?.init ?? {})).toMatchObject({
      authorization: "access-jwt",
      "glovo-app-platform": "web",
      "glovo-app-type": "customer",
      "glovo-api-version": "14",
      "glovo-language-code": "en",
      "glovo-device-urn": "glv:device:test",
    });
  });

  it("never calls /oauth/revoke, which would sign the user out", async () => {
    const f = fakeFetch({
      [REFRESH]: () => minted(),
      [LIST]: () => json({ orders: [] }),
      [DETAIL]: () => json(details()),
    });
    const api = makeGlovoApi(creds, { fetch: f.fetch, sleep: noSleep, callGapMs: 0 });
    await api.probe();
    await api.historyPage(undefined);
    await api.orderDetails(1001);
    expect(f.calls.some((c) => c.url.pathname.includes("revoke"))).toBe(false);
  });

  it("pages by the offset Glovo hands back, and says where the history ends", async () => {
    const f = fakeFetch({
      [REFRESH]: () => minted(),
      [LIST]: (_i, n) => json({ pagination: n === 0 ? { next: { offset: 555 } } : { next: null }, orders: [row(n)] }),
    });
    const api = makeGlovoApi(creds, { fetch: f.fetch, sleep: noSleep, callGapMs: 0 });
    expect(await api.historyPage(undefined)).toEqual({ orders: [row(0)], next: "555" });
    expect(await api.historyPage("555")).toEqual({ orders: [row(1)] });
    expect(f.calls.filter((c) => c.path === LIST).map((c) => c.url.searchParams.get("offset"))).toEqual(["0", "555"]);
    expect(f.calls.find((c) => c.path === LIST)?.url.searchParams.get("limit")).toBe("15");
  });

  it("waits out HTTP 429 about 20 s at a time, then succeeds", async () => {
    const sleep = vi.fn(async (_ms: number) => undefined);
    const f = fakeFetch({
      [REFRESH]: () => minted(),
      [DETAIL]: (_i, n) => (n < 2 ? json({ statusCode: 429, errorCode: "too_many_requests" }, 429) : json(details())),
    });
    const d = await makeGlovoApi(creds, { fetch: f.fetch, sleep, callGapMs: 0 }).orderDetails(1001);
    expect(d.code).toBe("1001");
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([20_000, 20_000]);
  });

  it("never waits less than 20 s, even when Retry-After says less, and gives up after a few tries as a systemic 429", async () => {
    const sleep = vi.fn(async (_ms: number) => undefined);
    const f = fakeFetch({
      [REFRESH]: () => minted(),
      [DETAIL]: () => json({ errorCode: "too_many_requests" }, 429, { "retry-after": "5" }),
    });
    const error = await makeGlovoApi(creds, { fetch: f.fetch, sleep, callGapMs: 0 })
      .orderDetails(1)
      .catch((e: unknown) => asAppError(e));
    expect(error).toMatchObject({ kind: "api", status: 429, code: "too_many_requests" });
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([20_000, 20_000, 20_000]);
  });

  it("honours a Retry-After longer than the floor", async () => {
    const sleep = vi.fn(async (_ms: number) => undefined);
    const f = fakeFetch({
      [REFRESH]: () => minted(),
      [DETAIL]: (_i, n) => (n === 0 ? json({ errorCode: "too_many_requests" }, 429, { "retry-after": "45" }) : json(details())),
    });
    await makeGlovoApi(creds, { fetch: f.fetch, sleep, random: () => 0, callGapMs: 0 }).orderDetails(1001);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([45_000]);
  });

  it("reports a refused refresh token as permanent, without quoting any token", async () => {
    const f = fakeFetch({ [REFRESH]: () => json({ statusCode: 401, errorCode: "invalid_grant" }, 401) });
    const error = await makeGlovoApi(creds, { fetch: f.fetch, sleep: noSleep })
      .probe()
      .catch((e: unknown) => asAppError(e));
    expect(error).toMatchObject({ kind: "auth", status: 401, permanent: true });
    expect(JSON.stringify(error)).not.toContain("refresh-jwt");
  });

  it("treats a throttled or failing refresh as transient", async () => {
    const f = fakeFetch({ [REFRESH]: () => json({ errorCode: "too_many_requests" }, 429) });
    const error = await makeGlovoApi(creds, { fetch: f.fetch, sleep: noSleep })
      .probe()
      .catch((e: unknown) => asAppError(e));
    expect(error).toMatchObject({ kind: "auth", permanent: false });
  });

  it("refreshes once on a 401, and believes the second", async () => {
    const f = fakeFetch({
      [REFRESH]: () => minted(),
      [LIST]: () => json({ statusCode: 401, errorCode: "invalid_token", errorDescription: "The token provided is invalid." }, 401),
    });
    const error = await makeGlovoApi(creds, { fetch: f.fetch, sleep: noSleep, callGapMs: 0 })
      .historyPage(undefined)
      .catch((e: unknown) => asAppError(e));
    expect(error).toMatchObject({ kind: "api", status: 401, code: "invalid_token" });
    expect(f.calls.filter((c) => c.path === REFRESH)).toHaveLength(2);
  });

  it("recovers when the refresh after a 401 works", async () => {
    const f = fakeFetch({
      [REFRESH]: () => minted(),
      [DETAIL]: (_i, n) => (n === 0 ? json({ errorCode: "invalid_token" }, 401) : json(details())),
    });
    const d = await makeGlovoApi(creds, { fetch: f.fetch, sleep: noSleep, callGapMs: 0 }).orderDetails(1001);
    expect(d.id).toBe(1001);
  });

  it("turns a 404 into not_found", async () => {
    const f = fakeFetch({ [REFRESH]: () => minted(), [DETAIL]: () => json({ statusCode: 404, errorCode: "not_found" }, 404) });
    const error = await makeGlovoApi(creds, { fetch: f.fetch, sleep: noSleep, callGapMs: 0 })
      .orderDetails(1)
      .catch((e: unknown) => asAppError(e));
    expect(error).toMatchObject({ kind: "not_found" });
  });

  it("serialises every call and spaces them 700 ms apart", async () => {
    let clock = 10_000;
    const waits: number[] = [];
    const f = fakeFetch({ [REFRESH]: () => minted(), [DETAIL]: () => json(details()), [LIST]: () => json({ orders: [] }) });
    const api = makeGlovoApi(creds, {
      fetch: f.fetch,
      now: () => clock,
      sleep: async (ms) => {
        waits.push(ms);
        clock += ms;
      },
    });
    await Promise.all([api.orderDetails(1), api.historyPage(undefined), api.orderDetails(3)]);
    expect(waits).toEqual([700, 700]);
    expect(f.calls.filter((c) => c.path !== REFRESH).map((c) => c.url.pathname)).toEqual([
      "/v3/customer/orders/1",
      "/v3/customer/orders-list",
      "/v3/customer/orders/3",
    ]);
  });

  it("turns a network failure into status 0", async () => {
    const api = makeGlovoApi(creds, {
      fetch: (async () => {
        throw new Error("ECONNRESET");
      }) as unknown as typeof fetch,
      sleep: noSleep,
    });
    expect(await api.probe().catch((e: unknown) => asAppError(e))).toMatchObject({ kind: "auth", status: 0, permanent: false });
  });
});

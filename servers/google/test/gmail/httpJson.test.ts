import { describe, expect, it, vi } from "vitest";

import { asAppError, configError, fail } from "../../src/gmail/domain/errors.js";
import { makeGetJson, makeRequest } from "../../src/infra/httpJson.js";
import type { Tokens } from "../../src/infra/httpJson.js";

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

/** Never actually waits: the backoff schedule is tested separately, in retry.test.ts. */
const noSleep = async () => undefined;

const tokens = (seq: string[] = ["t0", "t1"]): Tokens & { forced: number } => {
  let i = 0;
  const p = {
    forced: 0,
    get: async () => seq[Math.min(i, seq.length - 1)] as string,
    force: async () => {
      p.forced += 1;
      i += 1;
      return seq[Math.min(i, seq.length - 1)] as string;
    },
  };
  return p as Tokens & { forced: number };
};

const withFetch = (impl: (url: string, init?: RequestInit) => Promise<Response>) => {
  const spy = vi.fn(impl);
  vi.stubGlobal("fetch", spy);
  return spy;
};

describe("getJson", () => {
  it("returns the parsed body on success", async () => {
    withFetch(async () => json(200, { ok: true }));
    const get = makeGetJson(tokens(), { sleep: noSleep });
    await expect(get("https://x/y")).resolves.toEqual({ ok: true });
  });

  it("serialises repeated query keys as repeated params", async () => {
    const spy = withFetch(async () => json(200, {}));
    await makeGetJson(tokens(), { sleep: noSleep })("https://x/y", {
      format: "metadata",
      metadataHeaders: ["From", "Subject"],
    });
    const url = String(spy.mock.calls[0]?.[0]);
    expect(url).toContain("metadataHeaders=From&metadataHeaders=Subject");
    expect(url).toContain("format=metadata");
  });

  it("omits undefined query values entirely", async () => {
    const spy = withFetch(async () => json(200, {}));
    await makeGetJson(tokens(), { sleep: noSleep })("https://x/y", { q: undefined, maxResults: 20 });
    expect(String(spy.mock.calls[0]?.[0])).not.toContain("q=");
  });

  it("retries a 429 and then succeeds", async () => {
    let n = 0;
    withFetch(async () => (++n < 3 ? json(429, { error: {} }) : json(200, { ok: true })));
    await expect(makeGetJson(tokens(), { sleep: noSleep })("https://x/y")).resolves.toEqual({ ok: true });
    expect(n).toBe(3);
  });

  it("gives up immediately on a plain 403", async () => {
    let n = 0;
    withFetch(async () => {
      n += 1;
      return json(403, { error: { errors: [{ reason: "insufficientPermissions" }] } });
    });
    const thrown = await makeGetJson(tokens(), { sleep: noSleep })("https://x/y").catch((e: unknown) => e);
    expect(asAppError(thrown)).toMatchObject({ kind: "api", status: 403, reason: "insufficientPermissions" });
    expect(n).toBe(1);
  });

  it("forces exactly one refresh on a 401, then retries with the new token", async () => {
    const seen: string[] = [];
    let n = 0;
    withFetch(async (_url, init) => {
      seen.push(String((init?.headers as Record<string, string>)["Authorization"]));
      return ++n === 1 ? json(401, { error: {} }) : json(200, { ok: true });
    });
    const provider = tokens(["t0", "t1"]);
    await expect(makeGetJson(provider, { sleep: noSleep })("https://x/y")).resolves.toEqual({ ok: true });
    expect(seen).toEqual(["Bearer t0", "Bearer t1"]);
    expect(provider.forced).toBe(1);
  });

  it("believes a second 401 rather than refreshing forever", async () => {
    let n = 0;
    withFetch(async () => {
      n += 1;
      return json(401, { error: {} });
    });
    const provider = tokens(["t0", "t1", "t2"]);
    const thrown = await makeGetJson(provider, { sleep: noSleep })("https://x/y").catch((e: unknown) => e);
    expect(asAppError(thrown)).toMatchObject({ status: 401 });
    expect(n).toBe(2);
    expect(provider.forced).toBe(1);
  });

  it("turns a transport failure into an api error rather than leaking fetch's", async () => {
    withFetch(async () => {
      throw new TypeError("network down");
    });
    const thrown = await makeGetJson(tokens(), { sleep: noSleep })("https://x/y").catch((e: unknown) => e);
    expect(asAppError(thrown)).toMatchObject({ kind: "api", status: 0 });
  });
});

/**
 * A send that failed AFTER it may have reached Gmail is reported, never
 * retried: the one thing worse than a failed send is the same mail twice.
 */
describe("request, for writes", () => {
  it("does not retry a non-idempotent POST that got a 5xx, and says the outcome is unknown", async () => {
    const spy = withFetch(async () => json(503, { error: {} }));
    const request = makeRequest(tokens(), { sleep: noSleep });
    const failure = await request("https://x/send", { method: "POST", json: {}, idempotent: false }).catch(asAppError);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(failure).toMatchObject({ kind: "api", status: 503, reason: "outcome_unknown" });
  });

  it("does not retry a non-idempotent POST whose connection failed", async () => {
    const spy = withFetch(async () => {
      throw new TypeError("socket hang up");
    });
    const failure = await makeRequest(tokens(), { sleep: noSleep })("https://x/send", { method: "POST", idempotent: false }).catch(asAppError);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(failure).toMatchObject({ reason: "outcome_unknown" });
  });

  it("does retry a 429 on a send: Gmail refused it before acting", async () => {
    let n = 0;
    const spy = withFetch(async () => (++n < 2 ? json(429, { error: {} }) : json(200, { id: "s1" })));
    await expect(makeRequest(tokens(), { sleep: noSleep })("https://x/send", { method: "POST", idempotent: false })).resolves.toEqual({ id: "s1" });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("retries an idempotent write through a 5xx", async () => {
    let n = 0;
    withFetch(async () => (++n < 2 ? json(503, {}) : json(200, { id: "d" })));
    await expect(makeRequest(tokens(), { sleep: noSleep })("https://x/drafts/d", { method: "PUT", idempotent: true })).resolves.toEqual({ id: "d" });
  });

  it("returns undefined for an empty 204, as a DELETE answers", async () => {
    withFetch(async () => new Response(null, { status: 204 }));
    await expect(makeRequest(tokens(), { sleep: noSleep })("https://x/drafts/d", { method: "DELETE" })).resolves.toBeUndefined();
  });

  it("sends the method, the content type and the body it was given", async () => {
    const spy = withFetch(async () => json(200, {}));
    await makeRequest(tokens(), { sleep: noSleep })("https://x/upload", {
      method: "POST",
      query: { uploadType: "multipart" },
      body: { contentType: 'multipart/related; boundary="b"', data: "--b--" },
    });
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://x/upload?uploadType=multipart");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe('multipart/related; boundary="b"');
    expect(init.body).toBe("--b--");
  });
});

describe("a token that cannot be had", () => {
  it("fails with its own failure at once, not as a retried transport error", async () => {
    const missing = async (): Promise<string> => fail(configError("credentials at /x are missing"));
    const provider: Tokens = { get: missing, force: missing };
    const fetchSpy = withFetch(async () => json(200, {}));
    const sleep = vi.fn(async () => undefined);
    const thrown = await makeGetJson(provider, { sleep })("https://x/y").catch((e: unknown) => e);
    expect(asAppError(thrown)).toMatchObject({ kind: "config", message: "credentials at /x are missing" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe("a rate limit that does not lift", () => {
  const limited = () => json(403, { error: { errors: [{ domain: "usageLimits", reason: "rateLimitExceeded" }] } });

  it("waits at least the quota floor between attempts, then fails as quota rather than as a permission refusal", async () => {
    withFetch(async () => limited());
    const sleep = vi.fn(async (_ms: number) => undefined);
    const thrown = await makeGetJson(tokens(), { sleep, quotaFloorMs: 22_000 })("https://x/y").catch((e: unknown) => e);
    expect(asAppError(thrown)).toMatchObject({ kind: "quota" });
    expect(sleep.mock.calls.length).toBeGreaterThan(0);
    expect(sleep.mock.calls.every(([ms]) => ms >= 22_000)).toBe(true);
  });

  it("keeps the ordinary backoff where there is no floor", async () => {
    withFetch(async () => limited());
    const sleep = vi.fn(async (_ms: number) => undefined);
    await makeGetJson(tokens(), { sleep })("https://x/y").catch(() => undefined);
    expect(sleep.mock.calls.some(([ms]) => ms < 22_000)).toBe(true);
  });

  it("hands an export back as text", async () => {
    withFetch(async () => new Response("the document", { status: 200, headers: { "content-type": "text/plain" } }));
    await expect(makeRequest(tokens(), { sleep: noSleep })<string>("https://x/export", { as: "text" })).resolves.toBe("the document");
  });
});

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { inCall, unlessCancelled } from "../src/call.js";
import { mapWithConcurrency, memoize } from "../src/concurrency.js";
import { makeErrorKit } from "../src/errors.js";
import { asGuardError } from "../src/guardErrors.js";
import { makeHttp, NOT_JSON, redactCredentials, type HttpFailure, type HttpPolicy } from "../src/http.js";
import { fileTokenStore, makeTokenSource, memoryTokenStore } from "../src/tokens.js";

const kit = makeErrorKit<HttpFailure>("net-test");
const failureOf = async (p: Promise<unknown>): Promise<HttpFailure | undefined> => {
  try {
    await p;
  } catch (thrown) {
    return kit.asAppError(thrown);
  }
  throw new Error("expected a failure");
};

/** A fetch that answers from a script, and records what it was asked. */
const scripted = (answers: readonly (Response | Error)[]) => {
  const seen: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    const next = answers[seen.length - 1];
    if (next === undefined) throw new Error("unscripted request");
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  return { fetchImpl, seen };
};

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const policy = (fetchImpl: typeof fetch, over: Partial<HttpPolicy> = {}): HttpPolicy => ({
  service: "Test",
  isRetryable: (status) => status >= 500,
  fail: kit.fail,
  sleep: async () => undefined,
  fetch: fetchImpl,
  ...over,
});

describe("makeHttp", () => {
  it("sends the query, the JSON body and the auth headers, and parses the answer", async () => {
    const { fetchImpl, seen } = scripted([json(200, { ok: 1 })]);
    const http = makeHttp(policy(fetchImpl, { auth: { headers: async () => ({ Authorization: "Bearer t" }) } }));
    expect(await http("https://api.test/x", { method: "PUT", query: { a: 1, b: ["p", "q"], c: undefined }, json: { v: 2 } })).toEqual({ ok: 1 });
    expect(seen[0]!.url).toBe("https://api.test/x?a=1&b=p&b=q");
    expect(seen[0]!.init.headers).toMatchObject({ Authorization: "Bearer t", "Content-Type": "application/json; charset=UTF-8" });
    expect(seen[0]!.init.body).toBe('{"v":2}');
  });

  it("fails a 2xx that is not JSON through the policy, with a short redacted preview", async () => {
    const page = `<html>maintenance, Bearer ${"x".repeat(40)}</html>${" ".repeat(1000)}`;
    const read = scripted([new Response(page, { status: 200 })]);
    const failure = await failureOf(makeHttp(policy(read.fetchImpl))("https://api.test/x"));
    expect(failure).toMatchObject({ kind: "rejected", status: 200, reason: NOT_JSON, message: expect.stringContaining("not JSON") });
    const body = String((failure as { body?: unknown }).body);
    expect(body).toMatch(/^<html>maintenance, Bearer \[redacted\]<\/html>/);
    expect(body.length).toBeLessThan(700);
    // A POST answered 2xx may have acted: not JSON is not proof that nothing happened.
    const post = scripted([new Response("<html>ok</html>", { status: 200 })]);
    expect(await failureOf(makeHttp(policy(post.fetchImpl))("https://api.test/x", { method: "POST" }))).toMatchObject({ kind: "outcome_unknown", status: 200 });
    // Text and an empty body are still answers.
    expect(await makeHttp(policy(scripted([new Response("plain", { status: 200 })]).fetchImpl))("https://api.test/x", { as: "text" })).toBe("plain");
    expect(await makeHttp(policy(scripted([new Response("", { status: 200 })]).fetchImpl))("https://api.test/x")).toBeUndefined();
  });

  it("blanks a credential an error body echoes, text or JSON", async () => {
    const token = "eyJhbGciOiJSUzUxMiJ9.eyJyb2xlcyI6IkVGQUNUVVJBIn0.c2lnbmF0dXJl";
    const text = scripted([new Response(`Authorization: Bearer ${token}`, { status: 400 })]);
    const asText = await failureOf(makeHttp(policy(text.fetchImpl))("https://api.test/x"));
    expect(JSON.stringify(asText)).not.toContain(token);
    expect(asText).toMatchObject({ kind: "rejected", body: "Authorization: Bearer [redacted]" });
    const asJson = scripted([json(400, { headers: { authorization: `Bearer ${token}` } })]);
    expect(JSON.stringify(await failureOf(makeHttp(policy(asJson.fetchImpl))("https://api.test/x")))).not.toContain(token);
    expect(redactCredentials("Basic authentication failed")).toBe("Basic authentication failed");
  });

  it("retries an idempotent request through a 5xx and a transport error", async () => {
    const { fetchImpl, seen } = scripted([json(503, {}), new Error("reset"), json(200, [1])]);
    expect(await makeHttp(policy(fetchImpl))("https://api.test/x")).toEqual([1]);
    expect(seen).toHaveLength(3);
  });

  it("never retries a POST the server may have acted on", async () => {
    const one = scripted([json(502, { e: 1 })]);
    expect(await failureOf(makeHttp(policy(one.fetchImpl))("https://api.test/x", { method: "POST", json: {} }))).toMatchObject({ kind: "outcome_unknown", status: 502 });
    expect(one.seen).toHaveLength(1);
    const two = scripted([new Error("reset")]);
    expect(await failureOf(makeHttp(policy(two.fetchImpl))("https://api.test/x", { method: "POST" }))).toMatchObject({ kind: "outcome_unknown", status: 0 });
  });

  it("never retries a POST on a 4xx the policy calls retryable, since that does not prove nothing happened", async () => {
    const { fetchImpl, seen } = scripted([json(403, { error: "backendError" }), json(200, { id: "x" })]);
    const http = makeHttp(policy(fetchImpl, { isRetryable: (status) => status === 403 || status >= 500 }));
    expect(await failureOf(http("https://api.test/x", { method: "POST", json: {} }))).toMatchObject({ kind: "rejected", status: 403 });
    expect(seen).toHaveLength(1);
    // The same answer on a GET is retried, as the policy asks.
    const again = scripted([json(403, { error: "backendError" }), json(200, { id: "x" })]);
    expect(await makeHttp(policy(again.fetchImpl, { isRetryable: (status) => status === 403 || status >= 500 }))("https://api.test/x")).toEqual({ id: "x" });
  });

  it("retries a POST on an answer the policy says proves nothing happened", async () => {
    const { fetchImpl, seen } = scripted([json(409, { code: "conflict_error" }), json(200, { id: "x" })]);
    const http = makeHttp(policy(fetchImpl, { isHarmless: (status) => status === 409 }));
    expect(await http("https://api.test/x", { method: "POST", json: {} })).toEqual({ id: "x" });
    expect(seen).toHaveLength(2);
  });

  it("retries a POST on a rate limit, which proves nothing happened, honouring Retry-After", async () => {
    const waits: number[] = [];
    const { fetchImpl } = scripted([json(429, {}, { "retry-after": "7" }), json(200, { id: "x" })]);
    const http = makeHttp(policy(fetchImpl, { sleep: async (ms) => waits.push(ms), random: () => 0.5 }));
    expect(await http("https://api.test/x", { method: "POST" })).toEqual({ id: "x" });
    expect(waits).toEqual([7500]);
  });

  it("waits the kit's schedule exactly once its jitter is pinned", async () => {
    const waits: number[] = [];
    const { fetchImpl } = scripted([json(503, {}), new Error("reset"), json(200, [1])]);
    await makeHttp(policy(fetchImpl, { sleep: async (ms) => waits.push(ms), random: () => 0 }))("https://api.test/x");
    expect(waits).toEqual([1000, 2000]);
  });

  it("renews once after a 401, then believes the second", async () => {
    const renewals: number[] = [];
    const { fetchImpl, seen } = scripted([json(401, {}), json(401, {})]);
    const http = makeHttp(policy(fetchImpl, { auth: { headers: async () => ({}), renew: async () => renewals.push(1) } }));
    expect(await failureOf(http("https://api.test/x"))).toMatchObject({ kind: "rejected", status: 401 });
    expect(renewals).toEqual([1]);
    expect(seen).toHaveLength(2);
  });

  it("reports a plain refusal with the API's reason and body, and a rate limit that never lifts as such", async () => {
    const reasonOf = (b: unknown) => (b as { reason?: string }).reason;
    const refused = scripted([json(403, { reason: "insufficientScope" })]);
    expect(await failureOf(makeHttp(policy(refused.fetchImpl, { reasonOf }))("https://api.test/x"))).toEqual({
      kind: "rejected",
      status: 403,
      reason: "insufficientScope",
      message: "Test rejected GET https://api.test/x",
      body: { reason: "insufficientScope" },
    });
    const limited = scripted([json(429, {}), json(429, {})]);
    expect(await failureOf(makeHttp(policy(limited.fetchImpl, { attempts: 2 }))("https://api.test/x"))).toMatchObject({ kind: "rate_limited", status: 429 });
  });

  it("returns text and bytes when asked", async () => {
    const t = scripted([new Response("plain")]);
    expect(await makeHttp(policy(t.fetchImpl))("https://api.test/x", { as: "text" })).toBe("plain");
    const b = scripted([new Response(new Uint8Array([1, 2, 3]))]);
    expect(await makeHttp(policy(b.fetchImpl))("https://api.test/x", { as: "bytes" })).toEqual(new Uint8Array([1, 2, 3]));
  });
});

describe("makeTokenSource", () => {
  it("mints once for many concurrent callers, then serves from memory", async () => {
    const mints: number[] = [];
    const source = makeTokenSource({
      store: memoryTokenStore(),
      nowEpoch: () => 1000,
      mint: async () => {
        mints.push(1);
        return { token: `t${mints.length}`, expiresAtEpoch: 5000 };
      },
    });
    expect(await Promise.all([source.get(), source.get(), source.get()])).toEqual(["t1", "t1", "t1"]);
    expect(await source.get()).toBe("t1");
    expect(mints).toHaveLength(1);
  });

  it("mints again near expiry and when forced, and persists to the file store", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mcp-kit-tokens-"));
    const clock = { now: 1000 };
    const counter = { n: 0 };
    const options = {
      store: fileTokenStore(dir, "grant"),
      nowEpoch: () => clock.now,
      mint: async () => ({ token: `t${++counter.n}`, expiresAtEpoch: clock.now + 3600, scope: "s" }),
    };
    const source = makeTokenSource(options);
    expect(await source.get()).toBe("t1");
    expect(await makeTokenSource(options).get()).toBe("t1");
    clock.now += 3600 - 30;
    expect(await source.get()).toBe("t2");
    expect(await source.force()).toBe("t3");
    expect(await source.current()).toEqual({ token: "t3", expiresAtEpoch: clock.now + 3600, scope: "s" });
    expect((await makeTokenSource(options).rotate()).token).toBe("t4");
    expect(await makeTokenSource(options).get()).toBe("t4");
  });

  it("forgets the token in memory and the one in the store, so the next call mints from the replaced grant", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mcp-kit-tokens-"));
    const counter = { n: 0 };
    const options = { store: fileTokenStore(dir, "grant"), nowEpoch: () => 1000, mint: async () => ({ token: `t${++counter.n}`, expiresAtEpoch: 9000 }) };
    const source = makeTokenSource(options);
    expect(await source.get()).toBe("t1");
    await source.forget();
    expect(await fileTokenStore(dir, "grant").read()).toBeUndefined();
    expect(await source.get()).toBe("t2");
    const memory = makeTokenSource({ ...options, store: memoryTokenStore() });
    expect(await memory.get()).toBe("t3");
    await memory.forget();
    expect(await memory.get()).toBe("t4");
  });

  it("does not remember a failed mint", async () => {
    const outcomes = [new Error("down"), { token: "ok", expiresAtEpoch: 9e9 }];
    const source = makeTokenSource({
      store: memoryTokenStore(),
      mint: async () => {
        const next = outcomes.shift();
        if (next instanceof Error) throw next;
        return next!;
      },
    });
    await expect(source.get()).rejects.toThrow("down");
    expect(await source.get()).toBe("ok");
  });
});

describe("concurrency helpers", () => {
  it("keeps order and never exceeds the limit", async () => {
    const live = { now: 0, max: 0 };
    const out = await mapWithConcurrency([5, 1, 3, 2, 4], 2, async (n) => {
      live.now += 1;
      live.max = Math.max(live.max, live.now);
      await new Promise((r) => setTimeout(r, n));
      live.now -= 1;
      return n * 10;
    });
    expect(out).toEqual([50, 10, 30, 20, 40]);
    expect(live.max).toBe(2);
  });

  it("memoizes per key for the ttl, shares the call in flight, forgets failures", async () => {
    const clock = { now: 0 };
    const calls: string[] = [];
    const get = memoize(1000, async (key: string) => {
      calls.push(key);
      if (key === "bad") throw new Error("no");
      return key.toUpperCase();
    }, () => clock.now);
    expect(await Promise.all([get("a"), get("a"), get("b")])).toEqual(["A", "A", "B"]);
    clock.now = 999;
    await get("a");
    clock.now = 1000;
    await get("a");
    await expect(get("bad")).rejects.toThrow();
    await expect(get("bad")).rejects.toThrow();
    expect(calls).toEqual(["a", "b", "a", "bad", "bad"]);
  });
});

describe("makeHttp in a call the client cancels", () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
  const cancelledOf = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (thrown) {
      return asGuardError(thrown);
    }
    throw new Error("expected a failure");
  };

  /** A fetch that answers only when told, and fails the way fetch does if its signal fires first. */
  const held = () => {
    const seen: RequestInit[] = [];
    const pending: { answer?: (response: Response) => void } = {};
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      seen.push(init);
      return new Promise<Response>((resolve, reject) => {
        pending.answer = resolve;
        init.signal?.addEventListener("abort", () => reject(new Error("This operation was aborted")), { once: true });
      });
    }) as unknown as typeof fetch;
    return { fetchImpl, seen, answer: (response: Response) => pending.answer?.(response) };
  };

  it("abandons a read in flight, and sends nothing more", async () => {
    const h = held();
    const controller = new AbortController();
    const pending = inCall({ signal: controller.signal }, () => makeHttp(policy(h.fetchImpl))("https://api.test/x"));
    await settle();
    controller.abort();
    expect(await cancelledOf(pending)).toMatchObject({ kind: "cancelled", message: expect.stringContaining("GET https://api.test/x was abandoned in flight") });
    expect(h.seen).toHaveLength(1);
  });

  it("sends nothing at all once the call is cancelled, a read or a write", async () => {
    const h = held();
    const controller = new AbortController();
    controller.abort();
    const http = makeHttp(policy(h.fetchImpl));
    for (const method of ["GET", "POST"] as const) {
      expect(await cancelledOf(inCall({ signal: controller.signal }, () => http("https://api.test/x", { method })))).toMatchObject({
        kind: "cancelled",
        message: expect.stringContaining(`${method} https://api.test/x was not sent`),
      });
    }
    expect(h.seen).toHaveLength(0);
  });

  it("lets a write that was sent run to its answer: abandoning it would leave its outcome unknown", async () => {
    const h = held();
    const controller = new AbortController();
    const pending = inCall({ signal: controller.signal }, () => makeHttp(policy(h.fetchImpl))("https://api.test/invoices", { method: "POST", json: { n: 1 } }));
    await settle();
    controller.abort();
    await settle();
    h.answer(json(200, { id: 7 }));
    expect(await pending).toEqual({ id: 7 });
    expect(h.seen).toHaveLength(1);
  });

  it("ends the call as outcome_unknown when it is cancelled after a write was sent, whatever comes next", async () => {
    const h = held();
    const controller = new AbortController();
    const pending = inCall({ signal: controller.signal }, async () => {
      const issued = await makeHttp(policy(h.fetchImpl))("https://api.test/invoices", { method: "POST", json: { n: 1 } });
      unlessCancelled("the invoice was not read back");
      return issued;
    });
    await settle();
    controller.abort();
    h.answer(json(200, { id: 7 }));
    expect(await cancelledOf(pending)).toMatchObject({ kind: "outcome_unknown", message: expect.stringContaining("after a write was sent") });
    expect(h.seen).toHaveLength(1);
  });

  it("never sends a write again once the call is cancelled, even after an answer that proved nothing happened", async () => {
    const { fetchImpl, seen } = scripted([json(429, {})]);
    const controller = new AbortController();
    const http = makeHttp(policy(fetchImpl, { sleep: () => new Promise(() => undefined) }));
    const pending = inCall({ signal: controller.signal }, () => http("https://api.test/invoices", { method: "POST", json: { n: 1 } }));
    await settle();
    controller.abort();
    expect(await cancelledOf(pending)).toMatchObject({ kind: "outcome_unknown" });
    expect(seen).toHaveLength(1);
  });

  it("stops a backoff when the call is cancelled, before the retry", async () => {
    const { fetchImpl, seen } = scripted([json(503, {})]);
    const controller = new AbortController();
    const http = makeHttp(policy(fetchImpl, { sleep: () => new Promise(() => undefined) }));
    const pending = inCall({ signal: controller.signal }, () => http("https://api.test/x"));
    await settle();
    controller.abort();
    expect(await cancelledOf(pending)).toMatchObject({ kind: "cancelled", message: expect.stringContaining("was not retried") });
    expect(seen).toHaveLength(1);
  });
});

/**
 * ANAF's policy on the kit's request loop: which answers are retried, and
 * which failure each becomes. The loop itself is tested in the kit.
 */
import type { BearerTokens } from "@foreverworks/mcp-kit";
import { afterEach, describe, expect, it, vi } from "vitest";

import { configError, fail, OUTCOME_UNKNOWN } from "../src/domain/errors.js";
import { makeRequest } from "../src/infra/http.js";
import { errorOf, withFetch } from "./fixtures.js";

afterEach(() => vi.unstubAllGlobals());

/** Never actually waits; the backoff schedule is the kit's and tested there. */
const noSleep = async () => undefined;

const tokens = () => {
  const forced = vi.fn(async () => "token-forced");
  const t: BearerTokens & { forced: typeof forced } = { get: async () => "token", force: forced, forced };
  return t;
};

const request = (t: BearerTokens = tokens()) => makeRequest(t, { sleep: noSleep });

describe("request", () => {
  it("returns bytes when asked, so one adapter can serve JSON, XML and a ZIP", async () => {
    withFetch(async () => new Response(Buffer.from([0x50, 0x4b, 0x03, 0x04])));
    const bytes = await request()<Uint8Array>("https://x/y", { as: "bytes" });
    expect([...bytes]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it("sends the bearer token and drops undefined query values", async () => {
    const spy = withFetch(async () => new Response("{}"));
    await request()("https://x/y", { query: { cif: "92345672", pagina: 1, filtru: undefined }, as: "text" });
    expect(String(spy.mock.calls[0]?.[0])).toBe("https://x/y?cif=92345672&pagina=1");
    expect(new Headers(spy.mock.calls[0]?.[1]?.headers).get("authorization")).toBe("Bearer token");
  });

  it("retries a 500 on a read and succeeds on the next attempt", async () => {
    const spy = withFetch(async () => (spy.mock.calls.length === 1 ? new Response("boom", { status: 500 }) : new Response("ok")));
    await expect(request()("https://x/y", { as: "text" })).resolves.toBe("ok");
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 400, because a wrong CIF does not improve with waiting", async () => {
    const spy = withFetch(async () => new Response("<Errors errorMessage='CIF invalid'/>", { status: 400 }));
    const error = await errorOf(() => request()("https://x/y", { as: "text" }));
    expect(error).toMatchObject({ kind: "api", status: 400 });
    expect(error?.kind === "api" && String(error.body)).toContain("CIF invalid");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("forces a refresh on the first 401 and believes the second", async () => {
    const t = tokens();
    const spy = withFetch(async () => new Response("no", { status: 401 }));
    const error = await errorOf(() => request(t)("https://x/y", { as: "text" }));
    expect(t.forced).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledTimes(2);
    expect(error).toMatchObject({ kind: "api", status: 401 });
  });

  it("never resends an upload ANAF may have acted on", async () => {
    // A 5xx after a POST may be a filing that happened. The same invoice filed
    // twice is worse than one that has to be checked.
    const spy = withFetch(async () => new Response("boom", { status: 502 }));
    const error = await errorOf(() => request()("https://x/upload", { method: "POST", body: { contentType: "application/xml", data: "<x/>" } }));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(error).toMatchObject({ kind: "api", reason: OUTCOME_UNKNOWN });
  });

  it("does not disguise a token failure as an unreachable ANAF", async () => {
    const spy = withFetch(async () => new Response("ok"));
    const broken: BearerTokens = { get: async () => fail(configError("tokens missing")), force: async () => "unused" };
    expect(await errorOf(() => request(broken)("https://x/y", { as: "text" }))).toMatchObject({ kind: "config" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("reports an unreachable ANAF as status 0, not as a rejection", async () => {
    withFetch(async () => {
      throw new Error("ECONNRESET");
    });
    expect(await errorOf(() => request()("https://x/y", { as: "text" }))).toMatchObject({ kind: "api", status: 0 });
  });
});

describe("an answer that is not JSON", () => {
  it("names the endpoint when a listing answers HTTP 200 with an HTML page", async () => {
    // FCTEL sometimes answers HTTP 200 with an HTML error page.
    withFetch(async () => new Response("<html>maintenance</html>"));
    const error = await errorOf(() => request()("https://x/lista"));
    expect(error).toMatchObject({ kind: "api", status: 200, body: "<html>maintenance</html>" });
    expect(error?.message).toContain("https://x/lista");
  });
});

/**
 * The adapter against a stubbed fetch: paths, parameter names, bodies, the
 * pagination walk and the retry rules. No key and no network.
 */
import { describe, expect, it } from "vitest";

import { authError, fail } from "../src/domain/errors.js";
import { makeBankApi } from "../src/infra/bankApi.js";
import { makeRequest } from "../src/infra/http.js";
import { json, rejectionOf, routeFetch, sentBody } from "./support.js";

const noSleep = async () => undefined;
const sign = async () => "signed.jwt.token";
const base = async () => "https://api.test";

const api = (redirect = "https://example.test/cb") => makeBankApi(makeRequest(sign, base, { sleep: noSleep }), async () => redirect);

const tx = (n: number) => ({ entry_reference: `E${n}`, transaction_amount: { amount: "1.00", currency: "RON" }, credit_debit_indicator: "CRDT", status: "BOOK" });
const refs = (rows: readonly { entry_reference?: string | null }[]) => rows.map((r) => r.entry_reference);

describe("getTransactions pagination", () => {
  const pages = (bodies: readonly unknown[]) => {
    const queue = [...bodies];
    return routeFetch({ "GET /accounts/u1/transactions": () => json(queue.shift()) });
  };

  it("follows continuation keys and concatenates every page", async () => {
    const spy = pages([
      { transactions: [tx(1), tx(2)], continuation_key: "k1" },
      { transactions: [tx(3)], continuation_key: "k2" },
      { transactions: [tx(4)] },
    ]);
    expect(refs(await api().getTransactions({ accountUid: "u1", status: "BOOK" }))).toEqual(["E1", "E2", "E3", "E4"]);
    expect(spy).toHaveBeenCalledTimes(3);
    expect(String(spy.mock.calls[1]?.[0])).toContain("continuation_key=k1");
  });

  it("stops on a null continuation key, which is what the last page carries", async () => {
    // Measured against production: the final response sends an explicit null,
    // not an absent field. Checking only for undefined sent the string "null"
    // back as a key and earned a 422 on every complete statement.
    const spy = pages([
      { transactions: [tx(1)], continuation_key: "k1" },
      { transactions: [tx(2)], continuation_key: null },
    ]);
    expect(refs(await api().getTransactions({ accountUid: "u1" }))).toEqual(["E1", "E2"]);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls.map((c) => String(c[0])).join(" ")).not.toContain("null");
  });

  it("refuses to loop forever on a repeated continuation key", async () => {
    // The walk is driven entirely by a value the server chooses. A hung tool is
    // harder to diagnose than a refusal that names the key.
    const spy = routeFetch({ "GET /accounts/u1/transactions": () => json({ transactions: [tx(1)], continuation_key: "same" }) });
    expect((await rejectionOf(() => api().getTransactions({ accountUid: "u1" })))?.message).toContain("repeated continuation key");
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("url-encodes an account uid rather than splicing it into the path", async () => {
    const spy = routeFetch({ "GET /accounts/a%2Fb%20c/transactions": () => json({ transactions: [] }) });
    await api().getTransactions({ accountUid: "a/b c" });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("sends exactly the filters asked for, under the API's names", async () => {
    const spy = routeFetch({ "GET /accounts/u1/transactions": () => json({ transactions: [] }) });
    await api().getTransactions({ accountUid: "u1" });
    await api().getTransactions({ accountUid: "u1", from: "2026-09-01", to: "2026-09-03", status: "BOOK" });
    expect(String(spy.mock.calls[0]?.[0])).toBe("https://api.test/accounts/u1/transactions");
    expect(String(spy.mock.calls[1]?.[0])).toBe(
      "https://api.test/accounts/u1/transactions?transaction_status=BOOK&date_from=2026-09-01&date_to=2026-09-03",
    );
  });
});

describe("the consent calls", () => {
  it("ends a session with DELETE on its url-encoded id, and takes an empty answer as done", async () => {
    const spy = routeFetch({
      "DELETE /sessions/s%2F1": () => json({ message: "OK" }),
      "DELETE /sessions/s2": () => new Response(null, { status: 204 }),
    });
    await api().deleteSession("s/1");
    await api().deleteSession("s2");
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("asks for every account by naming none, with the redirect URL from config", async () => {
    const spy = routeFetch({ "POST /auth": () => json({ url: "https://bank.test/sca", authorization_id: "a1", psu_id_hash: "h" }) });
    await api("https://example.test/callback").startAuth({
      aspspName: "Example Bank",
      aspspCountry: "DE",
      psuType: "personal",
      validUntil: "2030-07-01T12:00:00Z",
      state: "enable-banking",
    });
    // The body that works in production: no access.accounts (every account),
    // no explicit booleans.
    expect(sentBody(spy)).toEqual({
      access: { valid_until: "2030-07-01T12:00:00Z" },
      aspsp: { name: "Example Bank", country: "DE" },
      psu_type: "personal",
      redirect_url: "https://example.test/callback",
      state: "enable-banking",
    });
  });

  it("exchanges the code with POST /sessions, and reads details per account", async () => {
    const spy = routeFetch({
      "POST /sessions": () => json({ session_id: "s1" }),
      "GET /accounts/u%201/details": () => json({ uid: "u 1", currency: "RON" }),
    });
    await api().authorizeSession("the-code");
    await api().accountDetails("u 1");
    expect(sentBody(spy)).toEqual({ code: "the-code" });
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe("listAspsps", () => {
  it("unwraps the envelope and sends the country only when there is one", async () => {
    const spy = routeFetch({ "GET /aspsps": () => json({ aspsps: [{ name: "Example Bank" }] }) });
    await expect(api().listAspsps("DE")).resolves.toEqual([{ name: "Example Bank" }]);
    await api().listAspsps(undefined);
    expect(String(spy.mock.calls[0]?.[0])).toBe("https://api.test/aspsps?country=DE");
    expect(String(spy.mock.calls[1]?.[0])).toBe("https://api.test/aspsps");
  });
});

describe("request", () => {
  it("fails an empty 2xx as an api error, never as a parse bug or an empty answer", async () => {
    routeFetch({ "GET /application": () => new Response(null, { status: 204 }) });
    expect(await rejectionOf(() => api().application())).toMatchObject({ kind: "api", message: expect.stringContaining("no body (GET /application)") });
    routeFetch({ "GET /application": () => new Response("<html>", { status: 200 }) });
    expect(await rejectionOf(() => api().application())).toMatchObject({ kind: "api", message: expect.stringContaining("not JSON") });
  });

  it("carries the API's error body and code through, because they name the consent problem", async () => {
    routeFetch({ "GET /sessions/s1": () => json({ message: "Session expired", error: "EXPIRED_SESSION" }, 422) });
    const error = await rejectionOf(() => api().getSession("s1"));
    expect(error).toMatchObject({ kind: "api", status: 422, reason: "EXPIRED_SESSION" });
    expect(error?.kind === "api" && error.body).toEqual({ message: "Session expired", error: "EXPIRED_SESSION" });
  });

  it("does not retry a 422, which is a lapsed consent", async () => {
    const spy = routeFetch({ "GET /sessions/s1": () => json({ message: "no" }, 422) });
    await rejectionOf(() => api().getSession("s1"));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("never resends the code exchange once Enable Banking may have acted on it", async () => {
    // The code is single-use: a second POST /sessions after a 5xx could only
    // fail, and would hide that the first may have created the session.
    const spy = routeFetch({ "POST /sessions": () => json({ message: "oops" }, 502) });
    expect(await rejectionOf(() => api().authorizeSession("c0de"))).toMatchObject({ kind: "api", status: 502, reason: "outcome_unknown" });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("retries a 5xx and a dropped connection, minting a fresh token per attempt", async () => {
    // A token lives five minutes; a retry after a long backoff must not reuse one.
    const answers = [() => json({}, 500), () => Promise.reject(new TypeError("fetch failed")), () => json({ name: "app" })];
    const spy = routeFetch({ "GET /application": () => (answers.shift() as () => Response)() });
    let n = 0;
    const request = makeRequest(async () => `token-${n++}`, base, { sleep: noSleep });
    await expect(request({ method: "GET", path: "/application" })).resolves.toEqual({ name: "app" });
    expect(spy.mock.calls.map((c) => new Headers(c[1]?.headers).get("authorization"))).toEqual([
      "Bearer token-0",
      "Bearer token-1",
      "Bearer token-2",
    ]);
  });

  it("reports a signing failure as itself, not as the network", async () => {
    const spy = routeFetch({ "GET /application": () => json({}) });
    const request = makeRequest(async () => fail(authError("no key")), base, { sleep: noSleep });
    expect(await rejectionOf(() => request({ method: "GET", path: "/application" }))).toMatchObject({ kind: "auth" });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("getBalances", () => {
  it("reads the account's balances path once and hands back the list as sent", async () => {
    const spy = routeFetch({
      "GET /accounts/u1/balances": () => json({ balances: [{ name: "Booked", balance_amount: { amount: "5.00", currency: "RON" }, balance_type: "CLBD" }] }),
    });
    const rows = await api().getBalances("u1");
    expect(rows).toEqual([{ name: "Booked", balance_amount: { amount: "5.00", currency: "RON" }, balance_type: "CLBD" }]);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

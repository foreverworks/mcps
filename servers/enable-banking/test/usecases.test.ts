/**
 * The use cases through the real composition: a temp dir per test for app.json,
 * the key and the state, the throwaway key signing every request, and a stubbed
 * fetch standing in for Enable Banking.
 */
import { createVerify } from "node:crypto";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { Deps } from "../src/app/ports.js";
import { getBalances, listAccounts, listStoredSessions } from "../src/app/usecases/accounts.js";
import { completeAuth, revokeSession, startAuth } from "../src/app/usecases/auth.js";
import { exportTransactions, getTransactions } from "../src/app/usecases/transactions.js";
import { checkHealth, listAspsps } from "../src/app/usecases/banks.js";
import { buildDeps } from "../src/composition.js";
import { ACCOUNTS, SESSION_ID, sessionResponse, UIDS, VALID_UNTIL } from "./fixtures.js";
import { json, pathsOf, rejectionOf, routeFetch, sentBody, TEST_APP, TEST_KEY, testEnv } from "./support.js";

const NOW = Date.UTC(2030, 0, 2, 12, 0, 0) / 1000;

const setUp = () => {
  const env = testEnv();
  const deps: Deps = { ...buildDeps(env), now: () => NOW };
  return { deps, paths: pathsOf(env) };
};

const details = (i: 0 | 1 | 2) => () => json(ACCOUNTS[i]);

const exchange = (over: Record<string, () => Response> = {}) =>
  routeFetch({
    "POST /sessions": () => json(sessionResponse()),
    [`GET /accounts/${UIDS[0]}/details`]: details(0),
    [`GET /accounts/${UIDS[1]}/details`]: details(1),
    [`GET /accounts/${UIDS[2]}/details`]: details(2),
    ...over,
  });

describe("every request", () => {
  it("carries a JWT signed with the key the environment names, for the application in app.json", async () => {
    const { deps } = setUp();
    const spy = routeFetch({ "GET /application": () => json({ name: "app", kid: "k", environment: "SANDBOX", redirect_urls: [], active: true, countries: [], services: ["AIS"] }) });
    await checkHealth(deps);
    const [header, payload, signature] = (new Headers(spy.mock.calls[0]?.[1]?.headers).get("authorization") ?? "").slice(7).split(".");
    expect(JSON.parse(Buffer.from(header ?? "", "base64url").toString())).toMatchObject({ kid: TEST_APP.application_id });
    const verified = createVerify("RSA-SHA256")
      .update(`${header}.${payload}`)
      .end()
      .verify(TEST_KEY.publicKey, Buffer.from(signature ?? "", "base64url"));
    expect(verified).toBe(true);
  });
});

describe("startAuth", () => {
  it("asks for the bank named for 180 days, and hands back the URL", async () => {
    const { deps } = setUp();
    const spy = routeFetch({ "POST /auth": () => json({ url: "https://bank.test/sca", authorization_id: "a1", psu_id_hash: "h" }) });
    const out = await startAuth(deps, { aspspName: "Example Bank", aspspCountry: "de", psuType: "personal", state: "enable-banking" });
    expect(sentBody(spy)).toMatchObject({ aspsp: { name: "Example Bank", country: "DE" }, psu_type: "personal", access: { valid_until: "2030-07-01T12:00:00Z" } });
    expect(out).toMatchObject({ url: "https://bank.test/sca", authorizationId: "a1", validUntil: "2030-07-01T12:00:00Z" });
    expect(out.nextStep).toContain("EVERY account");
  });
});

describe("completeAuth", () => {
  it("stores the exchange verbatim and reports each account as the bank describes it now", async () => {
    const { deps, paths } = setUp();
    exchange({
      [`GET /accounts/${UIDS[2]}/details`]: () => json({ ...ACCOUNTS[2], name: "Renamed GBP" }),
    });
    const out = await completeAuth(deps, { codeOrUrl: "https://example.test/callback?code=c0de&state=x", label: "example_business" });
    expect(JSON.parse(readFileSync(paths.sessions, "utf8"))).toEqual({ example_business: sessionResponse() });
    expect(out).toMatchObject({
      storedAs: "example_business",
      sessionId: SESSION_ID,
      validUntil: VALID_UNTIL,
      expires: "expires 2030-07-01 (180 days left)",
      count: 3,
      backup: expect.stringMatching(/^none/),
    });
    expect(out.accounts).toEqual([
      { uid: UIDS[0], iban: "DE00SYNT00000000000001", currency: "EUR", name: "SYNTHETIC CURRENT" },
      { uid: UIDS[1], iban: "DE00SYNT00000000000002", currency: "EUR", name: "SYNTHETIC SAVINGS" },
      { uid: UIDS[2], iban: "DE00SYNT00000000000003", currency: "GBP", name: "Renamed GBP" },
    ]);
    expect(out).not.toHaveProperty("formatWarnings");
  });

  it("takes the bare code too, and sends exactly it", async () => {
    const { deps } = setUp();
    const spy = exchange();
    await completeAuth(deps, { codeOrUrl: "  c0de-123  ", label: "example_business" });
    expect(sentBody(spy)).toEqual({ code: "c0de-123" });
  });

  it("keeps the consent it replaces in sessions.json.bak and says which one it was", async () => {
    const { deps, paths } = setUp();
    mkdirSync(paths.stateDir, { recursive: true });
    writeFileSync(paths.sessions, JSON.stringify({ example_business: sessionResponse({ session_id: "s-old", access: { valid_until: "2030-02-14T09:00:00Z" } }) }));
    exchange();
    const out = await completeAuth(deps, { codeOrUrl: "c0de", label: "example_business" });
    expect(out).toMatchObject({ backup: paths.backup, replaced: { sessionId: "s-old", validUntil: "2030-02-14T09:00:00Z" } });
    expect(JSON.parse(readFileSync(paths.backup, "utf8"))).toMatchObject({ example_business: { session_id: "s-old" } });
  });

  it("reports an account whose details fail from the exchange, because the consent is already stored", async () => {
    const { deps, paths } = setUp();
    exchange({ [`GET /accounts/${UIDS[1]}/details`]: () => json({ message: "busy", error: "ASPSP_RATE_LIMIT_EXCEEDED" }, 400) });
    const out = await completeAuth(deps, { codeOrUrl: "c0de", label: "example_business" });
    expect(out.accounts[1]).toMatchObject({ iban: "DE00SYNT00000000000002", name: "SYNTHETIC SAVINGS", detailsError: expect.stringContaining("rejected") });
    expect(existsSync(paths.sessions)).toBe(true);
  });

  it("warns, but still stores, when the exchange lacks what a reader of the file needs", async () => {
    const { deps, paths } = setUp();
    exchange({ "POST /sessions": () => json(sessionResponse({ accounts: [{ ...ACCOUNTS[0], identification_hash: "" }] })) });
    const out = await completeAuth(deps, { codeOrUrl: "c0de", label: "example_business" });
    expect(out.formatWarnings).toEqual(["accounts[0] has no identification_hash, so a renewal cannot re-link it"]);
    expect(existsSync(paths.sessions)).toBe(true);
  });

  it("reports a response missing its accounts and end date as gaps, not as a failure, once stored", async () => {
    const { deps, paths } = setUp();
    const { accounts: _a, access: _b, ...bare } = sessionResponse();
    exchange({ "POST /sessions": () => json(bare) });
    const out = await completeAuth(deps, { codeOrUrl: "c0de", label: "example_business" });
    expect(out).toMatchObject({ ok: true, count: 0, validUntil: "not in the response", expires: expect.stringMatching(/^unknown/) });
    expect(out.formatWarnings).toEqual(["no readable access.valid_until", "accounts is not a list"]);
    expect(existsSync(paths.sessions)).toBe(true);
  });

  it("stores nothing when the API issued no session", async () => {
    const { deps, paths } = setUp();
    exchange({ "POST /sessions": () => json(sessionResponse({ session_id: "" })) });
    expect((await rejectionOf(() => completeAuth(deps, { codeOrUrl: "c0de", label: "example_business" })))?.kind).toBe("api");
    expect(existsSync(paths.sessions)).toBe(false);
  });

  it("without a label, renews the stored consent for the same bank, country and account type", async () => {
    const { deps, paths } = setUp();
    mkdirSync(paths.stateDir, { recursive: true });
    writeFileSync(
      paths.sessions,
      JSON.stringify({
        example_business: sessionResponse({ session_id: "s-old" }),
        example_personal: sessionResponse({ session_id: "s-personal", psu_type: "personal" }),
      }),
    );
    exchange();
    const out = await completeAuth(deps, { codeOrUrl: "c0de" });
    expect(out).toMatchObject({ storedAs: "example_business", replaced: { sessionId: "s-old" } });
    expect(Object.keys(JSON.parse(readFileSync(paths.sessions, "utf8")) as object).sort()).toEqual(["example_business", "example_personal"]);
  });

  it("without a label and nothing to renew, stores it under the bank and its country", async () => {
    const { deps } = setUp();
    exchange();
    expect(await completeAuth(deps, { codeOrUrl: "c0de", label: " " })).toMatchObject({ storedAs: "example_bank_de" });
  });

  it("never reaches the API with a bad label or a URL that carries no code", async () => {
    const { deps } = setUp();
    const spy = exchange();
    expect((await rejectionOf(() => completeAuth(deps, { codeOrUrl: "c0de", label: "Example Bank" })))?.kind).toBe("input");
    expect((await rejectionOf(() => completeAuth(deps, { codeOrUrl: "https://x.test/cb?state=s", label: "x" })))?.kind).toBe("input");
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("listStoredSessions", () => {
  it("says when each consent expires", async () => {
    const { deps, paths } = setUp();
    mkdirSync(paths.stateDir, { recursive: true });
    writeFileSync(
      paths.sessions,
      JSON.stringify({
        example_business: sessionResponse({ access: { valid_until: "2030-04-04T18:00:00Z" } }),
        lapsed: sessionResponse({ session_id: "s-lapsed", access: { valid_until: "2029-06-01T00:00:00Z" } }),
        legacy: { session_id: "s-legacy", accounts: [] },
      }),
    );
    const out = await listStoredSessions(deps);
    expect(out.count).toBe(3);
    expect(out.sessions.map((s) => [s.label, s.expires])).toEqual([
      ["example_business", "expires 2030-04-04 (92 days left)"],
      ["lapsed", "EXPIRED on 2029-06-01; run start_auth and complete_auth to renew"],
      ["legacy", "unknown: the stored consent records no readable access.valid_until"],
    ]);
    expect(out.sessions[0]).toMatchObject({ bank: { name: "Example Bank", country: "DE" }, daysLeft: 92, expired: false });
    expect(out.sessions[0]?.accounts).toHaveLength(3);
  });

  it("counts nothing when nothing is stored", async () => {
    expect(await listStoredSessions(setUp().deps)).toEqual({ count: 0, sessions: [] });
  });
});

describe("listAccounts", () => {
  const stored = (paths: ReturnType<typeof pathsOf>) => {
    mkdirSync(paths.stateDir, { recursive: true });
    writeFileSync(paths.sessions, JSON.stringify({ example_business: sessionResponse() }));
  };
  const live = (uids: readonly string[]) => ({
    status: "AUTHORIZED",
    accounts: uids,
    accounts_data: [],
    aspsp: { name: "Example Bank", country: "DE" },
    psu_type: "business",
    psu_id_hash: "h",
    access: { valid_until: VALID_UNTIL },
    created: "2030-01-02T12:00:00Z",
  });

  it("describes the live uids with what only the stored consent knows", async () => {
    const { deps, paths } = setUp();
    stored(paths);
    routeFetch({ [`GET /sessions/${SESSION_ID}`]: () => json(live(UIDS)) });
    const out = await listAccounts(deps, { label: "example_business" });
    expect(out).toMatchObject({ status: "AUTHORIZED", count: 3, expires: "expires 2030-07-01 (180 days left)" });
    expect(out.accounts[2]).toEqual({ uid: UIDS[2], iban: "DE00SYNT00000000000003", currency: "GBP", name: "SYNTHETIC GBP" });
    expect(out).not.toHaveProperty("revoked");
  });

  it("reports an account the bank dropped, and a uid it holds no details for", async () => {
    const { deps, paths } = setUp();
    stored(paths);
    routeFetch({ [`GET /sessions/${SESSION_ID}`]: () => json(live([UIDS[0], "surprise"])) });
    const out = await listAccounts(deps, { label: "example_business" });
    expect(out).toMatchObject({ count: 1, revoked: [UIDS[1], UIDS[2]], unknownToThisServer: ["surprise"] });
  });

  it("takes the one stored consent when no label is given, and asks for one when there are several", async () => {
    const { deps, paths } = setUp();
    stored(paths);
    routeFetch({ [`GET /sessions/${SESSION_ID}`]: () => json(live(UIDS)) });
    expect(await listAccounts(deps, {})).toMatchObject({ label: "example_business", count: 3 });
    writeFileSync(paths.sessions, JSON.stringify({ a: sessionResponse(), b: sessionResponse() }));
    expect(await rejectionOf(() => listAccounts(deps, {}))).toMatchObject({ kind: "input", message: expect.stringContaining("a, b") });
  });

  it("lists the labels that do exist when the one asked for does not", async () => {
    const { deps, paths } = setUp();
    stored(paths);
    const error = await rejectionOf(() => listAccounts(deps, { label: "other_bank" }));
    expect(error).toMatchObject({ kind: "not_found", message: expect.stringContaining("example_business") });
    expect((await rejectionOf(() => listAccounts(setUp().deps, { label: "x" })))?.message).toContain("start_auth");
  });
});

describe("getTransactions", () => {
  it("returns signed string amounts and echoes the filters it actually sent", async () => {
    const { deps } = setUp();
    const spy = routeFetch({
      [`GET /accounts/${UIDS[0]}/transactions`]: () =>
        json({
          transactions: [
            { entry_reference: "E1", transaction_amount: { amount: "42.50", currency: "RON" }, credit_debit_indicator: "DBIT", status: "BOOK", creditor: { name: "Shop" } },
          ],
          continuation_key: null,
        }),
    });
    const out = await getTransactions(deps, { accountUid: UIDS[0], dateFrom: "2026-09-25", dateTo: "", status: "booked", filter: {} });
    expect(out).toMatchObject({ dateFrom: "2026-09-25", dateTo: null, transactionStatus: "BOOK", count: 1 });
    expect(out).toMatchObject({ account: expect.stringMatching(/^not in any stored consent/) });
    expect(out.transactions[0]).toMatchObject({ amount: "-42.50", direction: "debit", counterpartyName: "Shop" });
    expect(String(spy.mock.calls[0]?.[0])).not.toContain("date_to");
  });

  it("names the stored account it read", async () => {
    const { deps, paths } = setUp();
    mkdirSync(paths.stateDir, { recursive: true });
    writeFileSync(paths.sessions, JSON.stringify({ example_business: sessionResponse() }));
    routeFetch({ [`GET /accounts/${UIDS[2]}/transactions`]: () => json({ transactions: [], continuation_key: null }) });
    const out = await getTransactions(deps, { accountUid: UIDS[2], dateFrom: "", dateTo: "", status: "", filter: {} });
    expect(out).toHaveProperty("account", { label: "example_business", uid: UIDS[2], iban: "DE00SYNT00000000000003", currency: "GBP", name: "SYNTHETIC GBP" });
  });

  it("refuses a backwards date range, or an IBAN given as the uid, before spending a call", async () => {
    const { deps } = setUp();
    const spy = routeFetch({});
    expect((await rejectionOf(() => getTransactions(deps, { accountUid: UIDS[0], dateFrom: "2026-03-01", dateTo: "2026-01-01", status: "", filter: {} })))?.kind).toBe("input");
    expect(await rejectionOf(() => getTransactions(deps, { accountUid: "RO49AAAA1B31007593840000", dateFrom: "", dateTo: "", status: "", filter: {} }))).toMatchObject({
      kind: "input",
      message: expect.stringContaining("not the IBAN"),
    });
    expect(spy).not.toHaveBeenCalled();
  });
});

const row = (ref: string, amount: string | number, indicator: "DBIT" | "CRDT", over: Record<string, unknown> = {}) => ({
  entry_reference: ref,
  transaction_amount: { amount, currency: "RON" },
  credit_debit_indicator: indicator,
  status: "BOOK",
  booking_date: "2026-09-20",
  ...over,
});

const page = (...rows: readonly unknown[]) => () => json({ transactions: rows, continuation_key: null });

const storeConsent = (paths: ReturnType<typeof pathsOf>, file: Record<string, unknown> = { example_business: sessionResponse() }) => {
  mkdirSync(paths.stateDir, { recursive: true });
  writeFileSync(paths.sessions, JSON.stringify(file));
};

const all = { dateFrom: "", dateTo: "", status: "booked" } as const;

describe("getTransactions filters", () => {
  const rows = [
    row("E1", "1200.50", "DBIT", { creditor: { name: "ȘANTIER EXEMPLU SRL" }, creditor_account: { iban: "RO12SYNT0000000000000099" } }),
    row("E2", "250", "CRDT", { debtor: { name: "Client One" }, remittance_information: ["Factura", "INV 0042"] }),
    row("E3", "99.99", "DBIT", { creditor: { name: "Shop" } }),
    row("E4", 300, "DBIT", { creditor: { name: "Odd Bank Row" } }),
  ];

  it("narrows by text (case and diacritics ignored), direction and size, after one read, and says what it left", async () => {
    const { deps } = setUp();
    const spy = routeFetch({ [`GET /accounts/${UIDS[0]}/transactions`]: page(...rows) });
    const byName = await getTransactions(deps, { accountUid: UIDS[0], ...all, filter: { text: "santier" } });
    expect(byName.transactions.map((t) => t.reference)).toEqual(["E1"]);
    expect(byName).toMatchObject({ fetched: 4, count: 1, filters: { text: "santier" } });

    const byIban = await getTransactions(deps, { accountUid: UIDS[0], ...all, filter: { text: "RO12 SYNT 0000" } });
    expect(byIban.transactions.map((t) => t.reference)).toEqual(["E1"]);
    const byReference = await getTransactions(deps, { accountUid: UIDS[0], ...all, filter: { text: "factura inv 0042" } });
    expect(byReference.transactions.map((t) => t.reference)).toEqual(["E2"]);

    const sized = await getTransactions(deps, { accountUid: UIDS[0], ...all, filter: { direction: "debit", amount_min: "100", amount_max: "1200.50" } });
    expect(sized.transactions.map((t) => t.reference)).toEqual(["E1"]);
    expect(sized).toMatchObject({ amountUnreadable: 1 });
    expect(spy).toHaveBeenCalledTimes(4);
  });

  it("adds no filter keys when none are asked for, and refuses a bad bound before any read", async () => {
    const { deps } = setUp();
    const spy = routeFetch({ [`GET /accounts/${UIDS[0]}/transactions`]: page(...rows) });
    const plain = await getTransactions(deps, { accountUid: UIDS[0], ...all, filter: { text: "  " } });
    expect(plain).not.toHaveProperty("filters");
    expect(plain).not.toHaveProperty("fetched");
    spy.mockClear();
    for (const filter of [{ amount_min: "-5" }, { amount_min: "1,200" }, { amount_min: "10", amount_max: "5" }]) {
      expect((await rejectionOf(() => getTransactions(deps, { accountUid: UIDS[0], ...all, filter })))?.kind).toBe("input");
    }
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("getTransactions across accounts", () => {
  it("reads every account on the stored consents one by one, tags each row, and reports an account that failed", async () => {
    const { deps, paths } = setUp();
    storeConsent(paths);
    const order: string[] = [];
    routeFetch({
      [`GET /accounts/${UIDS[0]}/transactions`]: () => (order.push("0"), page(row("A", "10", "DBIT"))()),
      [`GET /accounts/${UIDS[1]}/transactions`]: () => (order.push("1"), json({ error: "ACCESS_DENIED", message: "the bank refused this account" }, 403)),
      [`GET /accounts/${UIDS[2]}/transactions`]: () => (order.push("2"), page(row("C", "5", "CRDT"))()),
    });
    const out = await getTransactions(deps, { ...all, filter: {} });
    expect(out).toMatchObject({ scope: "every stored consent", accountsRead: 2, accountsFailed: 1, count: 2 });
    expect(out.transactions).toEqual([
      expect.objectContaining({ reference: "A", accountUid: UIDS[0], accountIban: "DE00SYNT00000000000001" }),
      expect.objectContaining({ reference: "C", accountUid: UIDS[2], accountIban: "DE00SYNT00000000000003" }),
    ]);
    expect(out).toHaveProperty(["accounts", 1], expect.objectContaining({ accountUid: UIDS[1], label: "example_business", error: expect.objectContaining({ kind: "api", remedy: expect.any(String) }) }));
    expect(order[0]).toBe("0");
    expect(order.at(-1)).toBe("2");
  });

  it("fails as a whole when no account could be read, and refuses account_uid with label", async () => {
    const { deps, paths } = setUp();
    storeConsent(paths, { example_business: sessionResponse({ accounts: [ACCOUNTS[0]] }) });
    routeFetch({ [`GET /accounts/${UIDS[0]}/transactions`]: () => json({ error: "EXPIRED_SESSION", message: "gone" }, 422) });
    expect(await rejectionOf(() => getTransactions(deps, { ...all, label: "example_business", filter: {} }))).toMatchObject({ kind: "api", reason: "EXPIRED_SESSION" });
    expect((await rejectionOf(() => getTransactions(deps, { ...all, accountUid: UIDS[0], label: "example_business", filter: {} })))?.kind).toBe("input");
    expect((await rejectionOf(() => getTransactions(setUp().deps, { ...all, filter: {} })))?.kind).toBe("not_found");
  });
});

describe("exportTransactions", () => {
  it("writes the statement as CSV, readable by its group only, and reports what it wrote", async () => {
    const { deps, paths } = setUp();
    storeConsent(paths, { example_business: sessionResponse({ accounts: [ACCOUNTS[0]] }) });
    routeFetch({
      [`GET /accounts/${UIDS[0]}/transactions`]: page(
        row("E1", "42.50", "DBIT", { creditor: { name: '=HYPERLINK("x")' }, remittance_information: ["Plata, factura"] }),
        row("E2", "10.00", "CRDT", { debtor: { name: "Client" } }),
      ),
    });
    const out = await exportTransactions(deps, { ...all, dateFrom: "2026-09-01", label: "example_business", filter: {} });
    expect(out).toMatchObject({ rows: 2, accountsRead: 1, dateFrom: "2026-09-01" });
    expect(out.path).toMatch(/\/exports\/transactions-example_business-2026-09-01-latest-.+\.csv$/);
    const bytes = readFileSync(out.path);
    expect(out.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(out.size).toBe(bytes.length);
    expect(statSync(out.path).mode & 0o777).toBe(0o640);
    const lines = bytes.toString("utf8").trimEnd().split("\n");
    expect(lines[0]).toBe("account_label,account_iban,booking_date,value_date,direction,amount,currency,counterparty_name,counterparty_iban,remittance,reference,status,bank_code,merchant_category_code,amount_warning");
    expect(lines[1]).toContain('"-42.50","RON","\'=HYPERLINK(""x"")","","Plata, factura","E1"');
    expect(lines[1]?.startsWith('"example_business","DE00SYNT00000000000001","2026-09-20"')).toBe(true);
  });
});

describe("revokeSession", () => {
  it("ends the session at Enable Banking, then removes the label and keeps the file as it was", async () => {
    const { deps, paths } = setUp();
    storeConsent(paths, { example_business: sessionResponse(), other: sessionResponse({ session_id: "s2" }) });
    const spy = routeFetch({ [`DELETE /sessions/${SESSION_ID}`]: () => json({ message: "OK" }) });
    const out = await revokeSession(deps, { label: "example_business" });
    expect(out).toMatchObject({ label: "example_business", atBank: "revoked", accounts: 3, backup: paths.backup });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(Object.keys(JSON.parse(readFileSync(paths.sessions, "utf8")))).toEqual(["other"]);
    expect(Object.keys(JSON.parse(readFileSync(paths.backup, "utf8")))).toEqual(["example_business", "other"]);
  });

  it("removes a consent the bank already ended, and keeps one the bank would not end", async () => {
    const gone = setUp();
    storeConsent(gone.paths);
    routeFetch({ [`DELETE /sessions/${SESSION_ID}`]: () => json({ error: "EXPIRED_SESSION", message: "expired" }, 422) });
    expect(await revokeSession(gone.deps, { label: "example_business" })).toMatchObject({ atBank: "already ended" });
    expect(JSON.parse(readFileSync(gone.paths.sessions, "utf8"))).toEqual({});

    const refused = setUp();
    storeConsent(refused.paths);
    routeFetch({ [`DELETE /sessions/${SESSION_ID}`]: () => json({ error: "UNAUTHORIZED", message: "no" }, 403) });
    expect(await rejectionOf(() => revokeSession(refused.deps, { label: "example_business" }))).toMatchObject({ kind: "api", status: 403 });
    expect(Object.keys(JSON.parse(readFileSync(refused.paths.sessions, "utf8")))).toEqual(["example_business"]);
    expect((await rejectionOf(() => revokeSession(refused.deps, { label: "nope" })))?.kind).toBe("not_found");
  });
});

describe("listAspsps", () => {
  it("serves a repeat from the catalogue cache, and an empty country as every market", async () => {
    const { deps } = setUp();
    const bank = { name: "Example Bank", country: "DE", logo: "l", psu_types: ["business"], auth_methods: [], maximum_consent_validity: 15_552_000, beta: false };
    const spy = routeFetch({ "GET /aspsps": () => json({ aspsps: [bank] }) });
    expect(await listAspsps(deps, { country: "de" })).toMatchObject({ count: 1, banks: [{ name: "Example Bank", maxConsentDays: 180 }] });
    await listAspsps(deps, { country: "DE" });
    await listAspsps(deps, { country: "" });
    expect(spy.mock.calls.map((c) => String(c[0]))).toEqual(["https://api.enablebanking.com/aspsps?country=DE", "https://api.enablebanking.com/aspsps"]);
  });
});

describe("getBalances", () => {
  it("returns every balance the bank sent as an exact string, naming the stored account it read", async () => {
    const { deps } = setUp();
    exchange();
    await completeAuth(deps, { codeOrUrl: "c0de", label: "example" });
    routeFetch({
      [`GET /accounts/${UIDS[0]}/balances`]: () =>
        json({
          balances: [
            { name: "Booked", balance_amount: { amount: "1000.00", currency: "EUR" }, balance_type: "CLBD", reference_date: "2030-01-02" },
            { name: "Available", balance_amount: { amount: "987.65", currency: "EUR" }, balance_type: "ITAV" },
          ],
        }),
    });
    const out = await getBalances(deps, { accountUid: UIDS[0] });
    expect(out).toMatchObject({ ok: true, accountUid: UIDS[0], count: 2 });
    expect(out.account).toMatchObject({ label: "example", iban: "DE00SYNT00000000000001", currency: "EUR" });
    expect(out.balances.map((b) => [b.type, b.typeMeaning, b.amount])).toEqual([
      ["CLBD", "closing booked", "1000.00"],
      ["ITAV", "interim available", "987.65"],
    ]);
    expect(out.balances[0]?.referenceDate).toBe("2030-01-02");
  });

  it("refuses what is not an account uid before reaching the bank", async () => {
    const { deps } = setUp();
    const spy = routeFetch({});
    const error = await rejectionOf(() => getBalances(deps, { accountUid: "DE00SYNT00000000000001" }));
    expect(error?.kind).toBe("input");
    expect(spy).not.toHaveBeenCalled();
  });
});

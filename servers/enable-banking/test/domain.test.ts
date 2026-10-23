import { describe, expect, it } from "vitest";

import { accountSummary, preferring } from "../src/domain/accounts.js";
import { balance } from "../src/domain/balances.js";
import { bank } from "../src/domain/aspsps.js";
import { authorizationCode } from "../src/domain/callback.js";
import { consentSummary, derivedLabel, parseLabel } from "../src/domain/consent.js";
import { consentValidUntil, expiryOf, expiryPhrase, parseRange } from "../src/domain/dates.js";
import { required } from "../src/domain/errors.js";
import type { RawAccount } from "../src/domain/schema.js";
import { sessionBook, storedSession } from "../src/domain/sessions.js";
import { parseStatus } from "../src/domain/status.js";
import { thrownBy } from "./support.js";

const NOW = Date.UTC(2030, 0, 2, 12, 0, 0) / 1000;

describe("authorizationCode", () => {
  it("takes the code out of a whole redirect URL", () => {
    expect(authorizationCode("http://localhost/cb?code=abc123&state=x")).toBe("abc123");
    expect(authorizationCode("  https://example.test/cb?state=x&code=zzz  ")).toBe("zzz");
  });

  it("takes a bare code", () => {
    expect(authorizationCode("0f6a1c2e-4b5d-4e6f-8a9b-0c1d2e3f4a5b")).toBe("0f6a1c2e-4b5d-4e6f-8a9b-0c1d2e3f4a5b");
  });

  it("takes a query string pasted without the address", () => {
    expect(authorizationCode("code=abc&state=enable-banking")).toBe("abc");
    expect(authorizationCode("?state=x&code=def")).toBe("def");
    expect(authorizationCode("example.test/cb?code=ghi")).toBe("ghi");
  });

  it("says the bank refused rather than 'no code found'", () => {
    // Reporting a denial as a missing parameter sends the operator back to the
    // browser to repeat a flow that already failed on purpose.
    const error = thrownBy(() =>
      authorizationCode("http://localhost/cb?error=access_denied&error_description=User%20cancelled"),
    );
    expect(error?.kind).toBe("input");
    expect(error?.message).toContain("access_denied");
    expect(error?.message).toContain("User cancelled");
  });

  it("tells a URL with no code apart from text that is neither", () => {
    expect(thrownBy(() => authorizationCode("http://localhost/cb?state=x"))?.message).toContain("no code parameter");
    expect(thrownBy(() => authorizationCode("just some text"))?.message).toContain("neither a redirect URL nor a code");
    expect(thrownBy(() => authorizationCode("   "))?.kind).toBe("input");
  });
});

describe("parseStatus", () => {
  it("maps the friendly names nobody would guess", () => {
    expect(parseStatus("booked")).toBe("BOOK");
    expect(parseStatus("Pending")).toBe("PDNG");
    expect(parseStatus("cancelled")).toBe("CNCL");
  });

  it("passes a code through, including one it has never heard of", () => {
    expect(parseStatus("BOOK")).toBe("BOOK");
    expect(parseStatus("futr")).toBe("FUTR");
  });

  it("treats empty as no filter, which is not the same as booked", () => {
    expect(parseStatus("")).toBeUndefined();
    expect(parseStatus("   ")).toBeUndefined();
  });
});

describe("parseRange", () => {
  it("drops an empty bound instead of inventing one", () => {
    expect(parseRange("", "")).toEqual({});
    expect(parseRange("2026-01-01", "")).toEqual({ from: "2026-01-01" });
  });

  it("refuses a malformed or backwards range", () => {
    expect(thrownBy(() => parseRange("01/01/2026", ""))?.kind).toBe("input");
    expect(thrownBy(() => parseRange("2026-02-30", ""))?.kind).toBe("input");
    expect(thrownBy(() => parseRange("2026-03-01", "2026-01-01"))?.kind).toBe("input");
  });
});

describe("consent validity", () => {
  it("asks for whole seconds with a Z, because a fraction is a confusing 400", () => {
    const out = consentValidUntil(Date.UTC(2026, 0, 1, 12, 30, 15, 789), 180);
    expect(out).toBe("2026-06-30T12:30:15Z");
    expect(out).not.toContain(".");
  });

  it("counts whole days left, and says when a consent has lapsed", () => {
    expect(expiryOf("2030-04-04T18:00:00Z", NOW)).toEqual({ validUntil: "2030-04-04T18:00:00Z", daysLeft: 92, expired: false });
    expect(expiryOf("2029-12-01T00:00:00Z", NOW)).toMatchObject({ expired: true });
    expect(expiryPhrase(expiryOf("2030-04-04T18:00:00Z", NOW))).toBe("expires 2030-04-04 (92 days left)");
    expect(expiryPhrase(expiryOf("2029-12-01T00:00:00Z", NOW))).toMatch(/^EXPIRED on 2029-12-01; run start_auth/);
  });

  it("says unknown rather than inventing a date", () => {
    expect(expiryOf(undefined, NOW)).toBeUndefined();
    expect(expiryOf(null, NOW)).toBeUndefined();
    expect(expiryOf("next spring", NOW)).toBeUndefined();
    expect(expiryPhrase(undefined)).toMatch(/^unknown/);
  });
});

describe("labels", () => {
  it("accepts a-z, 0-9, _ and -, trimmed", () => {
    expect(parseLabel("example_bank_de")).toBe("example_bank_de");
    expect(parseLabel("  example-personal ")).toBe("example-personal");
  });

  it("refuses what another program could not use unchanged as an identifier", () => {
    for (const bad of ["", "Example Bank", "Example", "_leading", "a/b", "x".repeat(64)])
      expect(thrownBy(() => parseLabel(bad))?.kind, bad).toBe("input");
  });

  it("derives one from the bank and its country when none is given", () => {
    expect(derivedLabel("Example Bank", "DE")).toBe("example_bank_de");
    expect(derivedLabel("Banca Transilvania", "ro")).toBe("banca_transilvania_ro");
    expect(derivedLabel("Crédit Agricole", "FR")).toBe("credit_agricole_fr");
    expect(derivedLabel("???", "DE")).toBe("bank_de");
  });
});

describe("consentSummary", () => {
  const request = { aspspName: "Example Bank", aspspCountry: "de", psuType: "personal", validUntil: "2030-07-01T12:00:00Z" };

  it("names the bank, the country, the PSU type and the end date on one line", () => {
    const line = consentSummary(request);
    expect(line).toBe(
      "Bank consent (PSD2, read-only: balances and transactions) with Example Bank (DE), personal accounts, " +
        "every account the bank offers, valid 180 days: until 2030-07-01 if confirmed today",
    );
  });

  it("stays one line of at most 300 characters whatever the bank is called", () => {
    const line = consentSummary({ ...request, aspspName: `A\nvery ${"long ".repeat(200)}bank` });
    expect(line.length).toBeLessThanOrEqual(300);
    expect(line).not.toMatch(/[\r\n]/);
    expect(line).toContain("until 2030-07-01");
  });
});

describe("required", () => {
  it("returns a present value and fails loudly on an absent one", () => {
    expect(required("s1", "session_id")).toBe("s1");
    expect(thrownBy(() => required(null, "session_id"))).toMatchObject({ kind: "api", message: expect.stringContaining("session_id") });
    expect(thrownBy(() => required(undefined, "session_id"))?.kind).toBe("api");
  });
});

describe("storedSession", () => {
  it("reads the POST /sessions response, which is what the file holds today", () => {
    const entry = {
      session_id: "s-v2",
      accounts: [
        {
          account_id: { iban: "DE89370400440532013000", other: null },
          all_account_ids: [{ identification: "DE89370400440532013000", scheme_name: "IBAN", issuer: null }],
          account_servicer: null,
          name: "Current account",
          currency: "EUR",
          product: "SYNTHETIC BUSINESS CURRENT",
          uid: "u1",
          identification_hash: "h",
          identification_hashes: ["h"],
        },
      ],
      aspsp: { name: "Example Bank", country: "DE" },
      psu_type: "business",
      access: { accounts: null, balances: true, transactions: true, valid_until: "2030-05-15T09:00:00Z" },
    };
    expect(storedSession("example_bank_de", entry)).toEqual({
      label: "example_bank_de",
      sessionId: "s-v2",
      bank: { name: "Example Bank", country: "DE" },
      psuType: "business",
      validUntil: "2030-05-15T09:00:00Z",
      accounts: [
        { uid: "u1", iban: "DE89370400440532013000", name: "Current account", currency: "EUR" },
      ],
    });
  });

  it("reads a reduced entry: uid and identification only", () => {
    // A consent stays live for months. Reporting one as missing costs the
    // account holder a trip through SCA to recreate what was never lost.
    const legacy = {
      session_id: "s-v1",
      aspsp: { name: "Example Bank", country: "DE" },
      psu_type: "business",
      access: { valid_until: "2030-06-30T00:00:00Z" },
      accounts: [{ uid: "u1", identification: "DE89370400440532013000" }],
    };
    expect(storedSession("old", legacy)?.accounts).toEqual([
      { uid: "u1", iban: "DE89370400440532013000", name: undefined, currency: undefined },
    ]);
  });

  it("drops an entry with no session id in any shape, and a bare uid string", () => {
    // Half-built is worse than absent: an undefined id produces a confusing
    // 404 instead of an honest "not stored".
    expect(storedSession("x", { aspsp: { name: "x" } })).toBeUndefined();
    expect(storedSession("x", { session_id: "" })).toBeUndefined();
    expect(storedSession("x", null)).toBeUndefined();
    expect(storedSession("x", "nope")).toBeUndefined();
    expect(storedSession("x", { session_id: "s", accounts: ["u1"] })?.accounts).toEqual([]);
  });

  it("lists every entry in label order and names the unreadable ones", () => {
    const book = sessionBook({ zeta: { session_id: "z" }, alpha: { session_id: "a" }, broken: { nothing: true } });
    expect(book.sessions.map((s) => s.label)).toEqual(["alpha", "zeta"]);
    expect(book.unreadable).toEqual(["broken"]);
  });
});

describe("accounts as a person reads them", () => {
  const account = (over: Partial<RawAccount>): RawAccount => ({
    cash_account_type: "CACC",
    currency: "RON",
    identification_hash: "h",
    identification_hashes: ["h"],
    ...over,
  });

  it("takes the IBAN from account_id, else from an IBAN-scheme alternative", () => {
    expect(accountSummary(account({ account_id: { iban: "RO49A" } })).iban).toBe("RO49A");
    expect(
      accountSummary(account({ account_id: null, all_account_ids: [{ identification: "RO49B", scheme_name: "IBAN" }] })).iban,
    ).toBe("RO49B");
    expect(accountSummary(account({ all_account_ids: [{ identification: "123", scheme_name: "BBAN" }] })).iban).toBeUndefined();
  });

  it("names an account by its product when the bank leaves the name out", () => {
    expect(accountSummary(account({ name: null, product: "Cont de economii" })).name).toBe("Cont de economii");
  });

  it("prefers the bank's current description field by field", () => {
    expect(preferring({ uid: "u", iban: undefined, currency: "USD" }, { uid: "u", iban: "RO49A", currency: "RON", name: "x" })).toEqual({
      uid: "u",
      iban: "RO49A",
      currency: "USD",
      name: "x",
    });
  });
});

describe("bank", () => {
  it("reduces an ASPSP to the fields that decide the next call", () => {
    expect(
      bank({
        name: "Example Bank",
        country: "DE",
        logo: "https://example.test/bank.png",
        psu_types: ["business", "personal"],
        auth_methods: [
          { approach: "REDIRECT", psu_type: "business", hidden_method: false },
          { approach: "REDIRECT", psu_type: "personal", hidden_method: false },
        ],
        maximum_consent_validity: 15_552_000,
        beta: false,
      }),
    ).toEqual({ name: "Example Bank", country: "DE", psuTypes: ["business", "personal"], authApproaches: ["REDIRECT"], maxConsentDays: 180 });
  });
});

describe("balance", () => {
  it("keeps the bank's exact string, signed as the bank signed it, and spells out the PSD2 type", () => {
    expect(
      balance({
        name: "Booked balance",
        balance_amount: { amount: "-1234.50", currency: "RON" },
        balance_type: "CLBD",
        last_change_date_time: "2030-01-02T10:00:00Z",
        reference_date: "2030-01-02",
        last_committed_transaction: "E9",
      }),
    ).toEqual({
      name: "Booked balance",
      type: "CLBD",
      typeMeaning: "closing booked",
      amount: "-1234.50",
      currency: "RON",
      lastChange: "2030-01-02T10:00:00Z",
      referenceDate: "2030-01-02",
      lastCommittedTransaction: "E9",
    });
  });

  it("flags a JSON number rather than presenting it as exact, and leaves an unknown type's meaning out", () => {
    const out = balance({ name: "x", balance_amount: { amount: 10.1, currency: "EUR" }, balance_type: "ZZZZ" as "OTHR", last_change_date_time: null, reference_date: null, last_committed_transaction: null });
    expect(out).toMatchObject({ amount: "10.1", currency: "EUR", type: "ZZZZ", typeMeaning: undefined, lastChange: undefined, referenceDate: undefined });
    expect(out.amountWarning).toContain("JSON number");
  });
});

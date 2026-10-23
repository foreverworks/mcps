import { describe, expect, it } from "vitest";

import { claimsOf } from "../src/domain/claims.js";
import { loginRemedy, remedyFor } from "../src/domain/errors.js";
import { LOGIN_TTL_S, matchPending } from "../src/domain/login.js";
import { describeSession, isRefreshExpired, sessionFrom } from "../src/domain/session.js";
import { documentView, invoiceView, requestSummaryView, requestView } from "../src/domain/views.js";
import { bucharestDate, DEFAULT_DAYS, edges, windowOf } from "../src/domain/window.js";
import { DOCUMENTS, errorOf, jwt, USER, REQUEST_ROW, SUMMARY } from "./helpers.js";

const NOW = 1_800_000_000;

describe("the session's arithmetic", () => {
  it("keeps both expiries from a code exchange, as Keycloak states them", () => {
    const s = sessionFrom({ accessToken: "a1", refreshToken: "r1", expiresIn: 300, refreshExpiresIn: 1800 }, NOW);
    expect(s).toMatchObject({ accessToken: "a1", refreshToken: "r1", accessExpEpoch: NOW + 300, refreshExpEpoch: NOW + 1800, tokenType: "Bearer" });
  });

  it("has no refresh expiry for an offline token (refresh_expires_in 0), and reads it as never expired", () => {
    const s = sessionFrom({ accessToken: "a1", refreshToken: "r1", expiresIn: 300, refreshExpiresIn: 0 }, NOW);
    expect(s?.refreshExpEpoch).toBeUndefined();
    expect(isRefreshExpired(s!, NOW + 10 ** 9)).toBe(false);
    expect(describeSession(s!, NOW).refreshTokenExpiresAt).toBeNull();
  });

  it("keeps the old refresh token and its window when a refresh answers without one, and takes the new window when it rotates", () => {
    const first = sessionFrom({ accessToken: "a1", refreshToken: "r1", expiresIn: 300, refreshExpiresIn: 1800 }, NOW)!;
    const kept = sessionFrom({ accessToken: "a2", expiresIn: 300 }, NOW + 100, first)!;
    expect(kept).toMatchObject({ accessToken: "a2", refreshToken: "r1", refreshExpEpoch: NOW + 1800, accessExpEpoch: NOW + 400 });
    const rotated = sessionFrom({ accessToken: "a3", refreshToken: "r2", expiresIn: 300, refreshExpiresIn: 1800 }, NOW + 200, first)!;
    expect(rotated).toMatchObject({ refreshToken: "r2", refreshExpEpoch: NOW + 2000 });
  });

  it("is no session at all when a code exchange brings no refresh token", () => {
    expect(sessionFrom({ accessToken: "a1", expiresIn: 300 }, NOW)).toBeUndefined();
  });

  it("describes itself without any token material", () => {
    const s = sessionFrom({ accessToken: "secret-access", refreshToken: "secret-refresh", expiresIn: 300, refreshExpiresIn: 1800 }, NOW)!;
    const text = JSON.stringify(describeSession(s, NOW + 60));
    expect(text).not.toContain("secret");
    expect(describeSession(s, NOW + 60)).toMatchObject({ refreshTokenRemainingMinutes: 29, isAccessExpired: false, isRefreshExpired: false });
  });
});

describe("a begun login", () => {
  const pending = { state: "st-1", verifier: "v", redirectUri: "https://myportal.onrc.ro/static-pages/silent-check-sso.html", createdAtEpoch: NOW };

  it("answers only to its own state, and only for 15 minutes", async () => {
    expect(matchPending(pending, "st-1", NOW + 60)).toBe(pending);
    expect((await errorOf(() => matchPending(pending, "st-2", NOW)))?.message).toMatch(/not the one begin_login issued/);
    expect((await errorOf(() => matchPending(pending, "st-1", NOW + LOGIN_TTL_S + 1)))?.message).toMatch(/more than 15 minutes/);
    expect((await errorOf(() => matchPending(undefined, "st-1", NOW)))?.message).toMatch(/call begin_login first/);
  });
});

describe("the access token's claims", () => {
  it("name the account, and an opaque token names nobody", () => {
    expect(claimsOf(jwt({ ...USER, exp: 123 }))).toEqual({ username: "ana.popescu", name: "Ana Popescu", email: "ana.popescu@example.com", subject: "kc-1", expEpoch: 123 });
    expect(claimsOf("opaque")).toEqual({});
    expect(claimsOf("a.b.c")).toEqual({});
  });
});

describe("the views", () => {
  it("read a filing row as the portal's screen shows it: both numbers, the kind, the company", () => {
    expect(requestView(REQUEST_ROW)).toEqual({
      id: REQUEST_ROW.id,
      number: 20260001234,
      registrationNumber: 4000123,
      createdAt: "2026-09-01T10:15:00",
      status: "WORKING",
      type: "Menţiune",
      subtype: "Mentiune",
      flow: "MENTIUNI_PJ",
      company: "EXEMPLU S.R.L.",
      cui: "12345678",
      hasCalculationNote: false,
      hasInvoice: false,
      cancellable: false,
    });
  });

  it("read a summary with the office's status words and the two terms", () => {
    expect(requestSummaryView(SUMMARY)).toMatchObject({
      statusText: "Cerere inregistrata",
      statusCode: "03",
      resolutionDue: "2026-09-08T00:00:00",
      releaseDue: "2026-09-10T00:00:00",
      register: "RC",
      hasFilesToDownload: false,
      allCalculationNotesPaid: true,
      observations: 0,
    });
  });

  it("read a document without the person the portal attaches to it, and turn the portal's dashes into nothing", () => {
    const view = documentView(DOCUMENTS.data[0]!);
    expect(view).toEqual({
      id: "7e8f9a0b-1c2d-4e3f-8a5b-6c7d8e9f0a1b",
      kind: "Cerere de înregistrare",
      fileName: "cerere_pj_book_1_9_2026_10_05_signed.pdf",
      fileType: "CR",
      pages: 5,
      signed: false,
      viewable: true,
      deedNumber: null,
      deedDate: "2026-09-01T10:05:00",
      issuer: null,
    });
    expect(JSON.stringify(view)).not.toMatch(/uniqueId|idDocument|2990101999999/);
  });

  it("compute what an invoice still owes", () => {
    expect(invoiceView({ id: "i1", invoiceNumber: 77, date: "2026-10-01", status: "PAID", total: 100, paidValue: 40 })).toMatchObject({ number: "77", total: "100", paid: "40", outstanding: "60" });
    expect(invoiceView({ id: "i2" }).outstanding).toBeNull();
  });
});

describe("the date window", () => {
  it("defaults to the last year up to today in Bucharest, and sends the Bucharest day's edges as UTC instants", () => {
    const nowMs = Date.UTC(2026, 9, 5, 12);
    expect(windowOf(undefined, undefined, nowMs)).toEqual({ from: "2025-10-05", to: "2026-10-05" });
    expect(DEFAULT_DAYS).toBe(365);
    // September is summer time, UTC+3: the day starts at 21:00 UTC the evening before.
    expect(edges({ from: "2026-09-01", to: "2026-09-30" })).toEqual({ from: "2026-08-31T21:00:00.000Z", to: "2026-09-30T20:59:59.999Z" });
    // January is winter time, UTC+2.
    expect(edges({ from: "2026-01-15", to: "2026-01-15" })).toEqual({ from: "2026-01-14T22:00:00.000Z", to: "2026-01-15T21:59:59.999Z" });
  });

  it("counts today from Bucharest's midnight, not UTC's", () => {
    // 23:30 UTC on 4 October is 02:30 on 5 October in Bucharest.
    expect(bucharestDate(Date.UTC(2026, 9, 4, 23, 30))).toBe("2026-10-05");
    expect(windowOf(undefined, undefined, Date.UTC(2026, 9, 4, 23, 30)).to).toBe("2026-10-05");
    // 20:59:59 UTC is still the 4th there, 21:00 UTC already the 5th.
    expect(bucharestDate(Date.UTC(2026, 9, 4, 20, 59, 59))).toBe("2026-10-04");
    expect(bucharestDate(Date.UTC(2026, 9, 4, 21))).toBe("2026-10-05");
    // In winter the day turns an hour later in UTC.
    expect(bucharestDate(Date.UTC(2026, 0, 14, 21, 30))).toBe("2026-01-14");
    expect(bucharestDate(Date.UTC(2026, 0, 14, 22))).toBe("2026-01-15");
  });

  it("keeps each day whole across the DST Sundays (29 March and 25 October 2026)", () => {
    // Spring forward at 03:00: 29 March starts at UTC+2 and ends at UTC+3, a 23-hour day.
    expect(edges({ from: "2026-03-29", to: "2026-03-29" })).toEqual({ from: "2026-03-28T22:00:00.000Z", to: "2026-03-29T20:59:59.999Z" });
    // Fall back at 04:00: 25 October starts at UTC+3 and ends at UTC+2, a 25-hour day.
    expect(edges({ from: "2026-10-25", to: "2026-10-25" })).toEqual({ from: "2026-10-24T21:00:00.000Z", to: "2026-10-25T21:59:59.999Z" });
    // The days either side join up: one day's last instant is a millisecond before the next one's first.
    for (const [day, next] of [["2026-03-28", "2026-03-29"], ["2026-03-29", "2026-03-30"], ["2026-10-24", "2026-10-25"], ["2026-10-25", "2026-10-26"]] as const) {
      expect(Date.parse(edges({ from: day, to: day }).to) + 1).toBe(Date.parse(edges({ from: next, to: next }).from));
    }
  });

  it("refuses a date that is not one, and a window that ends before it starts", async () => {
    expect((await errorOf(() => windowOf("2026-13-01", undefined, 0)))?.kind).toBe("input");
    expect((await errorOf(() => windowOf("2026-02-30", "2026-03-01", 0)))?.kind).toBe("input");
    expect((await errorOf(() => windowOf("2026-10-02", "2026-10-01", 0)))?.message).toMatch(/after/);
  });
});

describe("the remedies", () => {
  it("name the login tools, and the deployment's script when it has one", () => {
    expect(loginRemedy(undefined)).toMatch(/^call begin_login/);
    expect(loginRemedy("example-login")).toMatch(/^run `example-login`: /);
    expect(remedyFor({ kind: "needs_login", reason: "expired", message: "" }, loginRemedy("example-login"))).toContain("example-login");
  });
});

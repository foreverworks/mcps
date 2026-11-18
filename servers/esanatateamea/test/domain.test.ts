/**
 * The pure rules, without a server: Keycloak's login page, the cookie jar,
 * the authenticator code (RFC 6238's own vectors), Bucharest days, the begun
 * logins, the claims, and what the tools show.
 */
import { describe, expect, it } from "vitest";

import { claimsOf } from "../src/domain/claims.js";
import { localMinute, todayIn, windowOf } from "../src/domain/dates.js";
import { asAppError } from "../src/domain/errors.js";
import { CODE_TTL_S, LOGIN_TTL_S, matchPending, matchPendingCode, otpOf } from "../src/domain/login.js";
import { sessionFrom } from "../src/domain/session.js";
import { amountText, appointmentCountsView, appointmentView, documentView, fieldText } from "../src/domain/views.js";
import { absorbCookies, cookieHeader } from "../src/infra/signIn/cookies.js";
import { keycloakPage } from "../src/infra/signIn/keycloakPage.js";
import { totpAt, totpKeyOf } from "../src/infra/signIn/totp.js";
import { jwt, keycloakHtml } from "./helpers.js";

const kindOfThrown = (run: () => unknown): string | undefined => {
  try {
    run();
    return undefined;
  } catch (thrown) {
    return asAppError(thrown)?.kind;
  }
};

const fail = (): never => {
  throw new Error("unexpected");
};

describe("Keycloak's login page", () => {
  it("reads the step, the form's action and the banner from kcContext", () => {
    const action = "https://sso.example.org/realms/r/login-actions/authenticate?session_code=a&execution=b&client_id=c&tab_id=d";
    expect(keycloakPage(keycloakHtml("login", action))).toEqual({ pageId: "login", loginAction: action, message: undefined });
    expect(keycloakPage(keycloakHtml("login-otp", action, { type: "error", summary: "Invalid authenticator code." }))).toEqual({
      pageId: "login-otp",
      loginAction: action,
      message: { type: "error", summary: "Invalid authenticator code." },
    });
    expect(keycloakPage(keycloakHtml("login", action, { type: "warning", summary: "Ai fost deconectat." })).message?.type).toBe("warning");
  });

  it("finds nothing in a page that is not Keycloak's", () => {
    expect(keycloakPage("<html><body>Mentenanță</body></html>")).toEqual({ pageId: undefined, loginAction: undefined, message: undefined });
  });
});

describe("the sign-in's cookie jar", () => {
  const sso = new URL("https://sso.example.org/realms/r/protocol/openid-connect/auth");
  it("keeps cookies by name, domain and path, sends them only where they belong, and drops expired ones", () => {
    let jar = absorbCookies([], sso, ["AUTH_SESSION_ID=a1; Path=/realms/r/; Secure; HttpOnly", "TS01=t1; Path=/", "WIDE=w1; Domain=.example.org; Path=/"]);
    expect(cookieHeader(jar, new URL("https://sso.example.org/realms/r/login-actions/authenticate"))).toBe("AUTH_SESSION_ID=a1; TS01=t1; WIDE=w1");
    expect(cookieHeader(jar, new URL("https://sso.example.org/other"))).toBe("TS01=t1; WIDE=w1");
    expect(cookieHeader(jar, new URL("https://portal.example.org/"))).toBe("WIDE=w1");
    expect(cookieHeader(jar, new URL("https://example.net/"))).toBe("");
    jar = absorbCookies(jar, sso, ["AUTH_SESSION_ID=a2; Path=/realms/r/", "TS01=; Max-Age=0; Path=/", "WIDE=gone; Domain=example.org; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT"]);
    expect(cookieHeader(jar, new URL("https://sso.example.org/realms/r/x"))).toBe("AUTH_SESSION_ID=a2");
  });
});

describe("the authenticator code", () => {
  // RFC 6238, appendix B: the ASCII seeds "1234567890" repeated to 20, 32 and 64 bytes, base32-encoded.
  const SHA1 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  const SHA256 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA";
  const SHA512 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNA";
  const vectors: readonly (readonly [string, string, number, string])[] = [
    [SHA1, "SHA1", 59, "94287082"],
    [SHA1, "SHA1", 1111111109, "07081804"],
    [SHA1, "SHA1", 1234567890, "89005924"],
    [SHA1, "SHA1", 2000000000, "69279037"],
    [SHA256, "SHA256", 59, "46119246"],
    [SHA256, "SHA256", 1234567890, "91819424"],
    [SHA512, "SHA512", 59, "90693936"],
    [SHA512, "SHA512", 2000000000, "38618901"],
  ];

  it.each(vectors)("matches RFC 6238 (%s, %s, T=%i)", (secret, algorithm, t, code) => {
    const key = totpKeyOf(`otpauth://totp/Example:ana?secret=${secret}&digits=8&algorithm=${algorithm}&period=30`);
    expect(key).toBeDefined();
    expect(totpAt(key ?? fail(), t).code).toBe(code);
  });

  it("reads a bare base32 key as Keycloak's defaults (SHA1, six digits, 30 s), spaces and lower case allowed", () => {
    const key = totpKeyOf("gezd gnbv gy3t qojq gezd gnbv gy3t qojq");
    expect(key).toMatchObject({ algorithm: "sha1", digits: 6, period: 30 });
    expect(totpAt(key ?? fail(), 59)).toEqual({ code: "287082", secondsLeft: 1 });
    expect(totpAt(key ?? fail(), 60).secondsLeft).toBe(30);
  });

  it("refuses what is not a key", () => {
    expect(totpKeyOf("not base32!")).toBeUndefined();
    expect(totpKeyOf("")).toBeUndefined();
    expect(totpKeyOf(`otpauth://totp/x?secret=${SHA1}&algorithm=MD5`)).toBeUndefined();
    expect(totpKeyOf(`otpauth://totp/x?secret=${SHA1}&digits=4`)).toBeUndefined();
    expect(totpKeyOf("otpauth://totp/x")).toBeUndefined();
  });

  it("takes six digits as a person types them", () => {
    expect(otpOf("123 456")).toBe("123456");
    expect(kindOfThrown(() => otpOf("12345"))).toBe("input");
    expect(kindOfThrown(() => otpOf("12a456"))).toBe("input");
  });
});

describe("Bucharest days", () => {
  // 2026-03-29 01:30 UTC is 04:30 in Bucharest, after the switch to summer time.
  const epochMs = Date.UTC(2026, 2, 29, 1, 30);
  it("names today and now as the portal writes them", () => {
    expect(todayIn(Date.UTC(2026, 10, 17, 22, 30))).toBe("2026-11-18");
    expect(localMinute(epochMs)).toBe("2026-03-29 04:30");
  });

  it("defaults a window to the days before today and refuses a backwards or malformed one", () => {
    expect(windowOf(undefined, undefined, epochMs, 365)).toEqual({ from: "2025-03-29", to: "2026-03-29" });
    expect(windowOf("2026-01-01", undefined, epochMs, 365)).toEqual({ from: "2026-01-01", to: "2026-03-29" });
    expect(windowOf(undefined, "2026-02-10", epochMs, 30)).toEqual({ from: "2026-01-11", to: "2026-02-10" });
    expect(kindOfThrown(() => windowOf("2026-03-01", "2026-02-01", epochMs, 365))).toBe("input");
    expect(kindOfThrown(() => windowOf("2026-02-30", undefined, epochMs, 365))).toBe("input");
  });
});

describe("begun logins", () => {
  const pending = { state: "s-1", verifier: "v-1", redirectUri: "https://portal.example.org/env.js", createdAtEpoch: 1000 };
  it("accepts only the state it issued, within its time", () => {
    expect(matchPending(pending, "s-1", 1000 + LOGIN_TTL_S)).toBe(pending);
    expect(kindOfThrown(() => matchPending(pending, "s-2", 1001))).toBe("input");
    expect(kindOfThrown(() => matchPending(pending, "s-1", 1001 + LOGIN_TTL_S))).toBe("input");
    expect(kindOfThrown(() => matchPending(undefined, "s-1", 1001))).toBe("input");
  });

  it("lets a password sign-in wait for its code as long as Keycloak's form lives", () => {
    const code = { ...pending, action: "https://sso.example.org/a", cookies: [] };
    expect(matchPendingCode(code, 1000 + CODE_TTL_S)).toBe(code);
    expect(kindOfThrown(() => matchPendingCode(code, 1001 + CODE_TTL_S))).toBe("input");
  });
});

describe("the session", () => {
  it("reads who it is and the cid from the token, and nothing from a token that is not a JWT", () => {
    expect(claimsOf(jwt({ preferred_username: "ana", name: "Ana", email: "ana@example.com", sub: "k", cid: "c-1", exp: 5 }))).toEqual({
      username: "ana",
      name: "Ana",
      email: "ana@example.com",
      subject: "k",
      cid: "c-1",
      expEpoch: 5,
    });
    expect(claimsOf("opaque")).toEqual({});
  });

  it("keeps an offline refresh token without an expiry and rotates it on refresh", () => {
    const first = sessionFrom({ accessToken: "a1", refreshToken: "r1", expiresIn: 300, refreshExpiresIn: 0 }, 100, "roeid");
    expect(first).toMatchObject({ refreshToken: "r1", accessExpEpoch: 400, refreshExpEpoch: undefined, via: "roeid" });
    const next = sessionFrom({ accessToken: "a2", refreshToken: "r2", expiresIn: 300, refreshExpiresIn: 1800 }, 200, "roeid", first);
    expect(next).toMatchObject({ refreshToken: "r2", refreshExpEpoch: 2000 });
    expect(sessionFrom({ accessToken: "a", expiresIn: 300 }, 100, "password")).toBeUndefined();
  });
});

describe("what the tools show", () => {
  it("keeps amounts exact and refuses one that is not an amount", () => {
    expect(amountText(45.67, "x")).toBe("45.67");
    expect(kindOfThrown(() => amountText(0.1 + 0.2, "x"))).toBe("drift");
    expect(amountText(" 12.50 ", "x")).toBe("12.50");
    expect(amountText(null, "x")).toBeNull();
    expect(kindOfThrown(() => amountText("doisprezece", "x"))).toBe("drift");
  });

  it("prints a document field's value the way the portal does", () => {
    expect(fieldText(" text ")).toBe("text");
    expect(fieldText("")).toBeNull();
    expect(fieldText(true)).toBe("Da");
    expect(fieldText(3)).toBe("3");
    expect(fieldText({ nested: 1 })).toBeNull();
    expect(fieldText(["a", null, "b"])).toBe("a, b");
    expect(fieldText([{ key: "k", label: "L", value: "x" }, { key: "k2", label: "L2", value: "y" }])).toBe("x, y");
    expect(
      fieldText([
        [{ key: "c", label: "Cod", value: "J06" }, { key: "d", label: "Den", value: "Infecție" }],
        [{ key: "c", label: "Cod", value: "I10" }],
      ]),
    ).toBe("J06, Infecție | I10");
    expect(fieldText([])).toBeNull();
  });

  it("names a used form as the portal does, and requires the ids a later call needs", () => {
    expect(documentView({ id: "d", statusCode: "Raportat" }).status).toBe("Consumat");
    expect(documentView({ id: "d", statusCode: "Emis" }).status).toBe("Emis");
    expect(kindOfThrown(() => documentView({ displayTitle: "fără id" }))).toBe("drift");
    expect(kindOfThrown(() => appointmentView({ date: "2026-12-01 10:00" }))).toBe("drift");
  });

  it("reads the tab counts as numbers or numeric strings, and an address from its parts", () => {
    expect(appointmentCountsView({ FUTURE: "3", WAITING: 0, PAST: "x", CANCELLED: undefined })).toEqual({ upcoming: 3, waiting: 0, past: null, cancelled: null });
    expect(appointmentView({ id: "a", locationDetails: { adress: "Strada 1", localityName: "", regionName: "Cluj" } }).address).toBe("Strada 1, Cluj");
    expect(appointmentView({ id: "a", agencyName: "Clinica A", locationDetails: { agencyName: "Clinica B" } }).provider).toBe("Clinica A");
  });
});

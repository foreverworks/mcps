/**
 * The rules, on their own. No network, no credentials, no clock of their own:
 * every time-dependent rule takes `now` as an argument, which is what makes the
 * expiry logic testable at all.
 */
import { describe, expect, it } from "vitest";

import { AUTHORIZATION_TTL_S, chooseRedirectUri, matchPending } from "../src/domain/authorization.js";
import { archiveName, looksLikeZip } from "../src/domain/archive.js";
import { normaliseCif } from "../src/domain/cif.js";
import {
  bundleFrom,
  describeBundle,
  fromStored,
  isRefreshExpired,
  needsRefresh,
  REFRESH_SKEW_S,
  REFRESH_TOKEN_LIFETIME_S,
  toStored,
} from "../src/domain/tokens.js";
import { flagParams, parseStandard } from "../src/domain/upload.js";
import { MAX_DAYS, parseDays, parseFilter, parseWindow } from "../src/domain/window.js";
import { bundle, DAY, kindOf, NOW } from "./fixtures.js";

describe("normaliseCif", () => {
  it("strips the VAT prefix ANAF's endpoints will not accept", () => {
    expect(normaliseCif("RO92345672")).toBe("92345672");
    expect(normaliseCif("ro 92.345.672")).toBe("92345672");
    expect(normaliseCif("0092345672")).toBe("92345672");
  });

  it("refuses a code whose control digit is wrong, before anything is asked", () => {
    expect(kindOf(() => normaliseCif("RO12345678"))).toBe("input");
    expect(normaliseCif("92345672")).toBe("92345672");
  });

  it("rejects anything that is not a CIF rather than passing it through", () => {
    // ANAF answers a malformed CIF with an EMPTY LIST, not an error, so letting
    // one through reads as "no invoices this month".
    expect(kindOf(() => normaliseCif("not-a-cif"))).toBe("input");
    expect(kindOf(() => normaliseCif(""))).toBe("input");
  });
});

describe("parseDays", () => {
  it("accepts ANAF's range and refuses the rest", () => {
    expect(parseDays(1)).toBe(1);
    expect(parseDays(MAX_DAYS)).toBe(MAX_DAYS);
    expect(kindOf(() => parseDays(MAX_DAYS + 1))).toBe("input");
    expect(kindOf(() => parseDays(0))).toBe("input");
    expect(kindOf(() => parseDays(7.5))).toBe("input");
  });
});

describe("parseWindow", () => {
  it("reads both ends as UTC and makes the last day inclusive", () => {
    const { startTimeMs, endTimeMs } = parseWindow("2026-01-01", "2026-01-01");
    expect(startTimeMs).toBe(Date.UTC(2026, 0, 1));
    expect(endTimeMs).toBe(Date.UTC(2026, 0, 2));
  });

  it("refuses a window wider than ANAF allows", () => {
    expect(kindOf(() => parseWindow("2026-01-01", "2026-04-01"))).toBe("input");
  });

  it("refuses a backwards window and a malformed date", () => {
    expect(kindOf(() => parseWindow("2026-02-01", "2026-01-01"))).toBe("input");
    expect(kindOf(() => parseWindow("01-02-2026", "2026-01-01"))).toBe("input");
    expect(kindOf(() => parseWindow("2026-02-30", "2026-03-01"))).toBe("input");
  });
});

describe("parseFilter", () => {
  it("upper-cases a known filter and treats empty as no filter", () => {
    expect(parseFilter("p")).toBe("P");
    expect(parseFilter("")).toBeUndefined();
    expect(kindOf(() => parseFilter("X"))).toBe("input");
  });
});

describe("flagParams", () => {
  it("omits a false flag instead of spelling it NU", () => {
    expect(flagParams({ extern: false, autofactura: false, executare: false })).toEqual({});
    expect(flagParams({ extern: true, autofactura: false, executare: true })).toEqual({
      extern: "DA",
      executare: "DA",
    });
  });

  it("rejects a standard ANAF does not know", () => {
    expect(parseStandard("ubl")).toBe("UBL");
    expect(kindOf(() => parseStandard("UBLX"))).toBe("input");
  });
});

describe("archiveName", () => {
  it("cannot be talked into writing outside the directory it was given", () => {
    expect(archiveName("4321")).toBe("4321.zip");
    expect(archiveName("../../etc/passwd")).toBe("etcpasswd.zip");
    expect(kindOf(() => archiveName("../.."))).toBe("input");
  });
});

describe("looksLikeZip", () => {
  it("tells an archive from the XML error ANAF returns with HTTP 200", () => {
    expect(looksLikeZip(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]))).toBe(true);
    expect(looksLikeZip(Buffer.from('<?xml version="1.0"?><Errors/>'))).toBe(false);
    expect(looksLikeZip(Buffer.alloc(0))).toBe(false);
  });
});

describe("token freshness", () => {
  it("wants a refresh only once the cushion is gone", () => {
    const b = bundle();
    expect(needsRefresh(b, b.accessTokenExpEpoch - REFRESH_SKEW_S - 1)).toBe(false);
    expect(needsRefresh(b, b.accessTokenExpEpoch - REFRESH_SKEW_S)).toBe(true);
    expect(needsRefresh(b, b.accessTokenExpEpoch + 1)).toBe(true);
  });

  it("takes a wider window when the maintenance job asks for one", () => {
    const b = bundle({ accessTokenExpEpoch: NOW + 10 * DAY });
    expect(needsRefresh(b, NOW)).toBe(false);
    expect(needsRefresh(b, NOW, 14 * DAY)).toBe(true);
  });

  it("separates a dead access token from a dead grant", () => {
    const b = bundle({ accessTokenExpEpoch: NOW });
    // Still recoverable without a human: the refresh window is what decides.
    expect(needsRefresh(b, NOW + 1)).toBe(true);
    expect(isRefreshExpired(b, NOW + 1)).toBe(false);
  });
});

describe("bundleFrom", () => {
  it("prefers the access token's own exp over a computed one", () => {
    const out = bundleFrom({ accessToken: "a", refreshToken: "r", expiresIn: 100, accessExpEpoch: NOW + 77 }, NOW);
    expect(out.accessTokenExpEpoch).toBe(NOW + 77);
  });

  it("falls back to expires_in, then to ANAF's documented 90 days", () => {
    expect(bundleFrom({ accessToken: "a", refreshToken: "r", expiresIn: 100 }, NOW).accessTokenExpEpoch).toBe(NOW + 100);
    expect(bundleFrom({ accessToken: "a", refreshToken: "r" }, NOW).accessTokenExpEpoch).toBe(NOW + 90 * DAY);
  });

  it("opens a fresh 365-day window for a NEW refresh token", () => {
    const out = bundleFrom({ accessToken: "a", refreshToken: "rotated" }, NOW, bundle());
    expect(out.refreshTokenExpEpoch).toBe(NOW + REFRESH_TOKEN_LIFETIME_S);
  });

  it("keeps the old refresh token AND its expiry when a refresh does not rotate it", () => {
    // Writing undefined over the only credential that can recover the grant
    // would be the most expensive way to handle a surprise; restarting its
    // clock would make a dying grant look young.
    const previous = bundle();
    expect(bundleFrom({ accessToken: "a" }, NOW, previous)).toMatchObject({
      refreshToken: "old-refresh",
      refreshTokenExpEpoch: previous.refreshTokenExpEpoch,
    });
    expect(bundleFrom({ accessToken: "a", refreshToken: "old-refresh" }, NOW, previous).refreshTokenExpEpoch).toBe(
      previous.refreshTokenExpEpoch,
    );
  });

  it("carries the certificate details forward when a refresh omits them", () => {
    expect(bundleFrom({ accessToken: "a", refreshToken: "r" }, NOW, bundle())).toMatchObject({
      serial: "serial",
      issuer: "issuer",
      roles: "EFACTURA",
    });
  });

  it("refuses a code exchange that granted no refresh token, rather than store a grant that cannot be kept", () => {
    expect(kindOf(() => bundleFrom({ accessToken: "a" }, NOW))).toBe("auth");
  });
});

describe("token persistence", () => {
  it("round-trips through the on-disk shape", () => {
    const b = bundle();
    expect(fromStored(toStored(b))).toEqual(b);
  });

  it("reads a tokens.json with nulls and missing fields", () => {
    const out = fromStored({
      access_token: "a",
      refresh_token: "r",
      obtained_at_epoch: 1,
      access_token_exp_epoch: 2,
      refresh_token_exp_epoch: 3,
      serial: null,
    });
    expect(out).toMatchObject({ tokenType: "Bearer", scope: "", serial: undefined });
  });

  it("never puts token material in the status report", () => {
    // token_status goes into a transcript. It answers "will this still work
    // next week", and a live bearer token is not part of that answer.
    const report = JSON.stringify(describeBundle(bundle({ accessToken: "ACCESS-MATERIAL", refreshToken: "REFRESH-MATERIAL" }), NOW));
    expect(report).not.toContain("ACCESS-MATERIAL");
    expect(report).not.toContain("REFRESH-MATERIAL");
    expect(report).toContain("accessTokenRemainingDays");
  });
});

describe("authorization", () => {
  const pending = { state: "s1", redirectUri: "https://example.test/cb", createdAtEpoch: NOW };

  it("sends the certificate holder to a registered redirect URI, the first by default", () => {
    expect(chooseRedirectUri(["https://a/cb", "https://b/cb"], "")).toBe("https://a/cb");
    expect(chooseRedirectUri(["https://a/cb", "https://b/cb"], "https://b/cb")).toBe("https://b/cb");
    expect(kindOf(() => chooseRedirectUri(["https://a/cb"], "https://evil/cb"))).toBe("input");
    expect(kindOf(() => chooseRedirectUri([], ""))).toBe("input");
  });

  it("accepts only the state it issued, and only while it is open", () => {
    expect(matchPending(pending, "s1", NOW + 60)).toBe(pending);
    expect(kindOf(() => matchPending(pending, "other", NOW))).toBe("input");
    expect(kindOf(() => matchPending(undefined, "s1", NOW))).toBe("input");
    expect(kindOf(() => matchPending(pending, "s1", NOW + AUTHORIZATION_TTL_S + 1))).toBe("input");
  });
});

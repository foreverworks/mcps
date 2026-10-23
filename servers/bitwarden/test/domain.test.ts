import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { encryptedLength, fieldFromFile, MAX_FIELD_BYTES, MAX_NOTES_BYTES, repeatedNames } from "../src/domain/note.js";
import { generatePassword, passwordFromFile } from "../src/domain/password.js";
import { countIn, rangeOf } from "../src/domain/pwned.js";
import { base32Decode, type Hmac, newKeyProblem, parseTotp, sameKey, totpAt } from "../src/domain/totp.js";
import { hostOf } from "../src/domain/views.js";
import { itemWire, loginOf, notePayload } from "../src/infra/bw/wire.js";

const hmac: Hmac = (algorithm, key, message) => new Uint8Array(createHmac(algorithm.toLowerCase(), key).update(message).digest());

/** RFC 6238 appendix B: the ASCII seed "12345678901234567890", 8 digits, 30 s, SHA1. */
const RFC_SEED = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("totp", () => {
  it.each([
    [59, "94287082"],
    [1111111109, "07081804"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
  ])("matches RFC 6238 at t=%i", (seconds, expected) => {
    const spec = parseTotp(`otpauth://totp/Test?secret=${RFC_SEED}&digits=8`);
    expect(spec).toBeDefined();
    expect(totpAt(spec!, seconds * 1000, hmac).code).toBe(expected);
  });

  it("reads a bare base32 secret as 6 digits every 30 s, spaces and case ignored", () => {
    const spec = parseTotp("gezd gnbv gy3t qojq gezd gnbv gy3t qojq");
    expect(spec).toMatchObject({ digits: 6, period: 30, algorithm: "SHA1" });
    expect(totpAt(spec!, 59_000, hmac)).toEqual({ code: "287082", secondsLeft: 1 });
  });

  it("honours the URI's period and algorithm", () => {
    const spec = parseTotp(`otpauth://totp/x?secret=${RFC_SEED}&period=60&algorithm=sha256`);
    expect(spec).toMatchObject({ period: 60, algorithm: "SHA256" });
    expect(totpAt(spec!, 30_000, hmac).secondsLeft).toBe(30);
  });

  it("refuses what it cannot compute rather than answering a wrong code", () => {
    expect(parseTotp("steam://ABCDEF")).toBeUndefined();
    expect(parseTotp("otpauth://hotp/x?secret=GEZDGNBV")).toBeUndefined();
    expect(parseTotp("not base32!")).toBeUndefined();
    expect(parseTotp("")).toBeUndefined();
    expect(base32Decode("GEZDGNBV")).toEqual(Uint8Array.from([0x31, 0x32, 0x33, 0x34, 0x35]));
  });
});

describe("a new authenticator key", () => {
  it("takes a key as sites show it: grouped by spaces, either case, padded or not, or in an otpauth URI", () => {
    for (const key of [RFC_SEED, "gezd gnbv gy3t qojq gezd gnbv gy3t qojq", "JBSWY3DPEHPK3PXP", "MFRGGZDFMZTWQ2LK====", "otpauth://totp/Site:me?secret=JBSWY3DPEHPK3PXP&issuer=Site"]) {
      expect(newKeyProblem(key)).toBeUndefined();
    }
  });

  it("refuses what looks mistyped or cut: other characters, under 16 characters, a length no encoding has", () => {
    expect(newKeyProblem("JBSWY3DPEHPK3PX1")).toContain("characters base32 does not use");
    expect(newKeyProblem("JBSWY3DP-EHPK3PXP")).toContain("characters base32 does not use");
    expect(newKeyProblem("JBSWY3DPEHPK3PX")).toContain("at least 16");
    expect(newKeyProblem("JBSWY3DPEHPK3PXPA")).toContain("no base32 key is 17");
    expect(newKeyProblem("otpauth://hotp/Site?secret=JBSWY3DPEHPK3PXP")).toContain("neither");
    expect(newKeyProblem("otpauth://totp/Site?secret=JBSWY3DPEHPK3PXP&digits=4")).toContain("digits");
  });

  it("knows the same key written two ways", () => {
    expect(sameKey(RFC_SEED, "gezd gnbv gy3t qojq gezd gnbv gy3t qojq")).toBe(true);
    expect(sameKey("JBSWY3DPEHPK3PXP", "otpauth://totp/Site?secret=JBSWY3DPEHPK3PXP")).toBe(true);
    expect(sameKey("JBSWY3DPEHPK3PXP", "otpauth://totp/Site?secret=JBSWY3DPEHPK3PXP&digits=8")).toBe(false);
    expect(sameKey(RFC_SEED, "JBSWY3DPEHPK3PXP")).toBe(false);
  });
});

describe("generatePassword", () => {
  let seed = 7;
  const random = (max: number): number => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed % max;
  };

  it("has the length asked for and one of every class", () => {
    for (let i = 0; i < 50; i++) {
      const pw = generatePassword({ length: 16, symbols: true }, random);
      expect(pw).toHaveLength(16);
      expect(pw).toMatch(/[a-z]/);
      expect(pw).toMatch(/[A-Z]/);
      expect(pw).toMatch(/[0-9]/);
      expect(pw).toMatch(/[!@#$%^&*\-_=+]/);
    }
  });

  it("leaves symbols out when told to", () => {
    expect(generatePassword({ length: 40, symbols: false }, random)).toMatch(/^[A-Za-z0-9]{40}$/);
  });
});

describe("passwordFromFile", () => {
  const of = (text: string | Uint8Array) => passwordFromFile(typeof text === "string" ? new TextEncoder().encode(text) : text);

  it("drops the one line ending an editor adds, and touches nothing else", () => {
    expect(of("p@ss word \n")).toEqual({ password: "p@ss word " });
    expect(of("\uFEFFsecret\r\n")).toEqual({ password: "secret" });
    expect(of("  spaced")).toEqual({ password: "  spaced" });
  });

  it("refuses what is not one password", () => {
    expect(of("")).toEqual({ refused: "the password file is empty" });
    expect(of("\n")).toEqual({ refused: "the password file is empty" });
    expect(of("a\nb")).toEqual({ refused: "the password file holds more than one line" });
    expect(of(new Uint8Array([0xff, 0xfe]))).toEqual({ refused: "the password file is not UTF-8 text" });
    expect("refused" in of("x".repeat(1001))).toBe(true);
  });
});

describe("hostOf", () => {
  it("reads a URL or a bare domain, and nothing else", () => {
    expect(hostOf("https://GitHub.com/login")).toBe("github.com");
    expect(hostOf("accounts.google.com")).toBe("accounts.google.com");
    expect(hostOf("::::")).toBeUndefined();
  });
});

describe("loginOf", () => {
  it("reads the item's password history, newest first, and skips entries with no password", () => {
    const item = itemWire.parse({
      id: "11111111-1111-4111-8111-111111111111",
      type: 1,
      name: "Site",
      revisionDate: "2026-10-07T00:00:00.000Z",
      login: { password: "now" },
      passwordHistory: [
        { password: "older", lastUsedDate: "2026-09-01T00:00:00.000Z" },
        { password: "newer", lastUsedDate: "2026-10-01T00:00:00.000Z" },
        { password: null, lastUsedDate: "2026-10-02T00:00:00.000Z" },
      ],
    });
    expect(loginOf(item).previousPasswords).toEqual([
      { password: "newer", until: "2026-10-01T00:00:00.000Z" },
      { password: "older", until: "2026-09-01T00:00:00.000Z" },
    ]);
    expect(loginOf({ ...item, passwordHistory: null }).previousPasswords).toEqual([]);
  });
});

describe("secure notes", () => {
  it("measures the encrypted text as the CLI writes it: 2.<iv>|<data>|<mac> in base64", () => {
    // One byte pads to one 16-byte block: "2." + 24 + "|" + 24 + "|" + 44.
    expect(encryptedLength(1)).toBe(96);
    expect(encryptedLength(15)).toBe(96);
    expect(encryptedLength(16)).toBe(116);
  });

  it("derives the plain limits from Bitwarden's 5,000 and 10,000 encrypted characters", () => {
    expect(MAX_FIELD_BYTES).toBe(3695);
    expect(encryptedLength(MAX_FIELD_BYTES)).toBeLessThanOrEqual(5000);
    expect(encryptedLength(MAX_FIELD_BYTES + 1)).toBeGreaterThan(5000);
    expect(MAX_NOTES_BYTES).toBe(7439);
    expect(encryptedLength(MAX_NOTES_BYTES + 1)).toBeGreaterThan(10_000);
  });

  it("reads a file as text exactly, or says why it cannot", () => {
    expect(fieldFromFile(Buffer.from("\uFEFFa\n"))).toEqual({ text: "\uFEFFa\n" });
    expect(fieldFromFile(Uint8Array.from([0xc3]))).toMatchObject({ refused: expect.stringContaining("UTF-8") });
    expect(fieldFromFile(new Uint8Array())).toEqual({ refused: "the file is empty" });
  });

  it("hands the CLI a generic secure note with its hidden fields typed hidden", () => {
    const payload = notePayload({
      name: "Key",
      organizationId: "org-1",
      collectionIds: ["c-1"],
      notes: null,
      fields: [{ name: "key", value: "k", hidden: true }, { name: "project", value: "p", hidden: false }],
    });
    expect(payload).toEqual({
      type: 2,
      name: "Key",
      organizationId: "org-1",
      collectionIds: ["c-1"],
      notes: null,
      fields: [{ name: "key", value: "k", type: 1 }, { name: "project", value: "p", type: 0 }],
      secureNote: { type: 0 },
    });
    expect(loginOf(itemWire.parse({ ...payload, id: "n-1", revisionDate: "2026-10-22T00:00:00.000Z" }))).toMatchObject({ kind: "note", fields: [{ name: "key", hidden: true }, { name: "project", hidden: false }] });
  });

  it("finds names used twice as get_field would match them", () => {
    expect(repeatedNames(["Key", "key ", "other"])).toEqual(["key"]);
    expect(repeatedNames(["a", "b"])).toEqual([]);
  });
});

describe("pwned passwords", () => {
  // SHA-1 of "password", as the k-anonymity examples use it.
  const HASH = "5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8";
  it("splits a hash into the five characters sent and the rest kept", () => {
    expect(rangeOf(HASH.toLowerCase())).toEqual({ prefix: "5BAA6", suffix: "1E4C9B93F3F0682250B6CF8331B7EE68FD8" });
  });
  it("reads a count from a range answer, padding as unseen, and refuses what is not one", () => {
    expect(countIn("1E4C9B93F3F0682250B6CF8331B7EE68FD8:9545824\r\n0018A45C4D1DEF81644B54AB7F969B88D65:0", "1E4C9B93F3F0682250B6CF8331B7EE68FD8")).toBe(9545824);
    expect(countIn("0018A45C4D1DEF81644B54AB7F969B88D65:0", "1E4C9B93F3F0682250B6CF8331B7EE68FD8")).toBe(0);
    expect(countIn("not a range", "1E4C9B93F3F0682250B6CF8331B7EE68FD8")).toBeUndefined();
  });
});

/**
 * The pure parts of the passkey authenticator: CBOR against RFC 8949's own
 * examples, credential ids in Bitwarden's two stored forms, authenticator data
 * byte by byte, and an export read.
 */
import { describe, expect, it } from "vitest";

import { counterAfterUse, homeFor } from "../src/domain/passkey.js";
import { AAGUID, attestationObject, authenticatorData, coseKey, flagsByte } from "../src/domain/passkey/authData.js";
import { cborMap, encodeCbor, type Cbor } from "../src/domain/passkey/cbor.js";
import { readExport } from "../src/domain/passkey/exportFile.js";
import { fromBase64Url, guidBytes, rawCredentialId, toBase64Url, webauthnId } from "../src/domain/passkey/ids.js";
import { login } from "./support.js";

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");

describe("CBOR", () => {
  // RFC 8949, Appendix A: every example this encoder can write.
  const vectors: [Cbor, string][] = [
    [0, "00"],
    [1, "01"],
    [10, "0a"],
    [23, "17"],
    [24, "1818"],
    [25, "1819"],
    [100, "1864"],
    [1000, "1903e8"],
    [1000000, "1a000f4240"],
    [1000000000000, "1b000000e8d4a51000"],
    [-1, "20"],
    [-10, "29"],
    [-100, "3863"],
    [-1000, "3903e7"],
    [new Uint8Array(), "40"],
    [Uint8Array.from([1, 2, 3, 4]), "4401020304"],
    ["", "60"],
    ["a", "6161"],
    ["IETF", "6449455446"],
    ['"\\', "62225c"],
    ["ü", "62c3bc"],
    ["水", "63e6b0b4"],
    ["\u{10151}", "64f0908591"],
    [[], "80"],
    [[1, 2, 3], "83010203"],
    [[1, [2, 3], [4, 5]], "8301820203820405"],
    [Array.from({ length: 25 }, (_, i) => i + 1), "98190102030405060708090a0b0c0d0e0f101112131415161718181819"],
    [cborMap(), "a0"],
    [cborMap([1, 2], [3, 4]), "a201020304"],
    [cborMap(["a", 1], ["b", [2, 3]]), "a26161016162820203"],
    [["a", cborMap(["b", "c"])], "826161a161626163"],
    [cborMap(["a", "A"], ["b", "B"], ["c", "C"], ["d", "D"], ["e", "E"]), "a56161614161626142616361436164614461656145"],
  ];
  it.each(vectors)("writes %j as RFC 8949 does", (value, expected) => {
    expect(hex(encodeCbor(value))).toBe(expected);
  });

  it("sorts a map's keys canonically, shorter encodings first, whatever order they come in", () => {
    expect(hex(encodeCbor(cborMap([-3, 0], ["authData", 1], [1, 2], ["fmt", 3], [-1, 4], [3, 5])))).toBe(
      // 1, 3, -1, -3, then "fmt" (4 bytes encoded) before "authData" (9).
      `a6${"0102"}${"0305"}${"2004"}${"2200"}${"63666d7403"}${"68617574684461746101"}`,
    );
    expect(() => encodeCbor(cborMap([1, 1], [1, 2]))).toThrow(/repeated/);
  });

  it("writes a P-256 COSE key in the bytes Bitwarden's authenticator writes by hand", () => {
    const x = new Uint8Array(32).fill(0x11);
    const y = new Uint8Array(32).fill(0x22);
    // fido2-authenticator.service.ts, generateAuthData: a5 01 02 03 26 20 01 21 58 20 <x> 22 58 20 <y>.
    expect(hex(coseKey(x, y))).toBe(`a50102032620012158 20${"11".repeat(32)}225820${"22".repeat(32)}`.replace(" ", ""));
  });
});

describe("credential ids", () => {
  it("reads a GUID as its 16 bytes, in the order its text reads, as Bitwarden's guidToRawFormat", () => {
    const guid = "08d70b74-e9f5-4522-a425-e5dcd40107e7";
    expect(hex(guidBytes(guid))).toBe("08d70b74e9f54522a425e5dcd40107e7");
    expect(webauthnId(guid)).toBe(toBase64Url(Buffer.from("08d70b74e9f54522a425e5dcd40107e7", "hex")));
    expect(webauthnId(guid.toUpperCase())).toBe(webauthnId(guid));
  });

  it('reads "b64." and base64url as the bytes it encodes, and refuses anything else', () => {
    expect(hex(rawCredentialId("b64.AQIDBA")!)).toBe("01020304");
    expect(rawCredentialId("b64.")).toBeUndefined();
    expect(rawCredentialId("b64.AQ==")).toBeUndefined();
    expect(rawCredentialId("not-a-guid")).toBeUndefined();
  });

  it("decodes base64url strictly: no padding, no other alphabet, no stray bits", () => {
    expect(hex(fromBase64Url("_-8")!)).toBe("ffef");
    expect(fromBase64Url("AQ==")).toBeUndefined();
    expect(fromBase64Url("A+/")).toBeUndefined();
    expect(fromBase64Url("A")).toBeUndefined();
    expect(fromBase64Url("AR")).toBeUndefined(); // "AR" leaves bits set past the one byte it holds
    expect(hex(fromBase64Url("AQ")!)).toBe("01");
  });
});

describe("authenticator data", () => {
  const rpIdHash = new Uint8Array(32).fill(7);

  it("sets user present, backup eligible and backed up always, user verified as asked, attested on a registration", () => {
    expect(flagsByte({ userVerified: false, attested: false })).toBe(0x19);
    expect(flagsByte({ userVerified: true, attested: false })).toBe(0x1d);
    expect(flagsByte({ userVerified: true, attested: true })).toBe(0x5d);
  });

  it("is the RP ID hash, the flags and the counter for a sign-in: 37 bytes", () => {
    const data = authenticatorData({ rpIdHash, userVerified: false, counter: 0x01020304 });
    expect(data.length).toBe(37);
    expect(hex(data.subarray(32))).toBe("1901020304");
  });

  it("adds the AAGUID, the id's length and the id, and the COSE key on a registration", () => {
    const credentialId = guidBytes("08d70b74-e9f5-4522-a425-e5dcd40107e7");
    const x = new Uint8Array(32).fill(1);
    const y = new Uint8Array(32).fill(2);
    const data = authenticatorData({ rpIdHash, userVerified: true, counter: 0, attested: { credentialId, x, y } });
    expect(data[32]).toBe(0x5d);
    expect(hex(data.subarray(37, 53))).toBe("d548826e79b4db40a3d811116f7e8349");
    expect(hex(data.subarray(37, 53))).toBe(hex(AAGUID));
    expect(hex(data.subarray(53, 55))).toBe("0010");
    expect(hex(data.subarray(55, 71))).toBe(hex(credentialId));
    expect(hex(data.subarray(71))).toBe(hex(coseKey(x, y)));
  });

  it("wraps a registration in an attestation object of format none", () => {
    const data = Uint8Array.from([1, 2, 3]);
    expect(hex(attestationObject(data))).toBe("a363666d74646e6f6e656761747453746d74a068617574684461746143010203");
  });

  it("refuses a counter or a hash a site could not read", () => {
    expect(() => authenticatorData({ rpIdHash, userVerified: false, counter: -1 })).toThrow();
    expect(() => authenticatorData({ rpIdHash, userVerified: false, counter: 2 ** 32 })).toThrow();
    expect(() => authenticatorData({ rpIdHash: new Uint8Array(31), userVerified: false, counter: 0 })).toThrow();
  });
});

describe("the vault's passkey rules", () => {
  it("advances a counter above 0 and leaves a 0 at 0, as Bitwarden's authenticator does", () => {
    expect(counterAfterUse(0)).toBe(0);
    expect(counterAfterUse(1)).toBe(2);
    expect(counterAfterUse(41)).toBe(42);
  });

  it("puts a new passkey in the one login that stands for the account on the site, and in no login when that is unclear", () => {
    const a = login({ id: "a", username: "bot@example.com", uris: [{ uri: "https://www.example.com/login" }] });
    const b = login({ id: "b", username: "other@example.com", uris: [{ uri: "https://example.com" }] });
    expect(homeFor([a, b], "example.com", "BOT@example.com")?.id).toBe("a");
    expect(homeFor([a, b], "www.example.com", "bot@example.com")?.id).toBe("a");
    expect(homeFor([a, b], "other.example.com", "bot@example.com")).toBeUndefined();
    expect(homeFor([a, login({ ...a, id: "c" })], "example.com", "bot@example.com")).toBeUndefined();
    expect(homeFor([login({ ...a, uris: [{ uri: "https://notexample.com" }] })], "example.com", "bot@example.com")).toBeUndefined();
  });
});

describe("a Bitwarden JSON export", () => {
  const entry = {
    credentialId: "08d70b74-e9f5-4522-a425-e5dcd40107e7",
    keyType: "public-key",
    keyAlgorithm: "ECDSA",
    keyCurve: "P-256",
    keyValue: "AAAA",
    rpId: "example.com",
    userHandle: "dXNlcg",
    userName: "bot@example.com",
    counter: "0",
    rpName: "Example",
    userDisplayName: "Bot",
    discoverable: "true",
    creationDate: "2026-01-02T03:04:05.000Z",
  };
  const item = (fido2Credentials: unknown[], over: Record<string, unknown> = {}) => ({
    id: "x",
    type: 1,
    name: "Example",
    notes: null,
    fields: [
      { name: "pin", value: "1", type: 1 },
      { name: "linked", value: null, type: 3, linkedId: 100 },
    ],
    login: { username: "bot@example.com", password: "pw", totp: null, uris: [{ uri: "https://example.com", match: null }], fido2Credentials },
    ...over,
  });

  it("takes the logins that carry passkeys, with the counter and discoverable read from text", () => {
    const read = readExport({ encrypted: false, folders: [], items: [item([entry]), item([], { name: "No passkey" }), { type: 2, name: "A note" }] });
    expect("logins" in read).toBe(true);
    if (!("logins" in read)) return;
    expect(read.logins).toHaveLength(1);
    expect(read.logins[0]).toMatchObject({ name: "Example", username: "bot@example.com", password: "pw", fieldsLeftOut: 1 });
    expect(read.logins[0]!.passkeys[0]).toMatchObject({ counter: 0, discoverable: true, rpId: "example.com", creationDate: "2026-01-02T03:04:05.000Z" });
    expect(read.skipped).toEqual([]);
  });

  it("takes one exported item, or an array of them", () => {
    const one = readExport(item([entry]));
    const many = readExport([item([entry]), item([{ ...entry, credentialId: "b64.AQID" }])]);
    expect("logins" in one && one.logins.length).toBe(1);
    expect("logins" in many && many.logins.length).toBe(2);
  });

  it("refuses an encrypted export with what to do, and lists an entry it cannot read without naming its key", () => {
    expect(readExport({ encrypted: true, passwordProtected: true, data: "2.x" })).toMatchObject({ refused: expect.stringContaining("not encrypted") });
    const read = readExport({ items: [item([{ ...entry, counter: "lots" }, { ...entry, keyValue: "" }])] });
    expect(read).toMatchObject({ logins: [], skipped: [{ reason: expect.stringContaining("counter") }, { reason: expect.stringContaining("no key") }] });
    expect(JSON.stringify(read)).not.toContain("AAAA");
  });
});

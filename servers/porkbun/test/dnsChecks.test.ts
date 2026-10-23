/**
 * The rules that check DNS payloads before they are sent: host names, SPF
 * text, DKIM keys, DS records and the DNSKEY a DS is computed from (against
 * the RFCs' own examples).
 */
import { generateKeyPairSync } from "node:crypto";

import { describe, expect, it } from "vitest";

import { dkimProblem } from "../src/app/dns/dkim.js";
import { dsFor } from "../src/app/dns/dnssec.js";
import { dsOf } from "../src/app/dns/dnskey.js";
import { recordProblems } from "../src/app/dns/records.js";
import { dsProblems, parseDnskey } from "../src/domain/dns/ds.js";
import { hostnameProblem } from "../src/domain/dns/hostname.js";
import { spfProblems } from "../src/domain/dns/spf.js";
import { isDkim, txtText } from "../src/domain/dns/txt.js";
import { asAppError } from "../src/domain/errors.js";

const thrown = (run: () => unknown) => {
  try {
    run();
    return undefined;
  } catch (error) {
    return asAppError(error);
  }
};

/** RFC 4034 5.4 and RFC 4509 2.3: an RSA/SHA-1 key and its SHA-1 and SHA-256 DS records. */
const RFC4034_KEY =
  "dskey.example.com. 86400 IN DNSKEY 256 3 5 ( AQOeiiR0GOMYkDshWoSKz9Xz\n fwJr1AYtsmx3TGkJaNXVbfi/\n 2pHm822aJ5iI9BMzNXxeYCmZ\n" +
  " DRD99WYwYqUSdjMmmAphXdvx\n egXd/M5+X7OrzKBaMbCVdFLU\n Uh6DhweJBjEVv5f2wwjM9Xzc\n nOf+EPbtG9DMBmADjFDc2w/r\n ljwvFw==\n ) ; key id = 60485";
/** RFC 6605 6.1: an ECDSA P-256 key-signing key and its SHA-256 DS record. */
const RFC6605_KEY = "257 3 13 GojIhhXUN/u4v54ZQqGSnyhWJwaubCvTmeexv7bR6edbkrSqQpF64cYbcB7wNcP+e+MAnLr+Wi9xMWyQLc8NAA==";
const RFC6605_DIGEST = "B4C8C1FE2E7477127B27115656AD6256F424625BF5C1E2770CE6D6E37DF61D17";

describe("a nameserver's name", () => {
  it.each([["ns1.example.com"], ["NS1.Example.COM."], ["xn--bcher-kva.example"], ["a-b.c-d.example"]])("%s is one", (name) => {
    expect(hostnameProblem(name)).toBeUndefined();
  });

  it.each([
    ["ns1", /not a fully qualified/],
    ["ns1..example.com", /label ""/],
    ["-ns.example.com", /label "-ns"/],
    ["ns_1.example.com", /label "ns_1"/],
    ["ns1.example.com/", /label "com\/"/],
    ["192.0.2.1", /IP address/],
    [`${"a".repeat(64)}.example.com`, /1 to 63/],
  ])("%s is not", (name, problem) => {
    expect(hostnameProblem(name)).toMatch(problem);
  });
});

describe("an SPF record", () => {
  it.each([
    ["v=spf1 -all"],
    ["v=spf1 include:_spf.example.net ~all"],
    ["v=spf1 ip4:192.0.2.0/24 ip6:2001:db8::/32 a mx:mail.example.com/24//64 -all"],
    ["v=spf1 a:%{d}.example.com exists:%{i}.spf.example.com ?all"],
    ["v=spf1 redirect=_spf.example.com"],
    ["V=SPF1 MX -ALL foo=bar"],
  ])("%s has no obvious mistake", (text) => {
    expect(spfProblems(text)).toEqual([]);
  });

  it.each([
    ["v=spf1 inlcude:_spf.example.net ~all", /"inlcude" is not an SPF mechanism/],
    ["v=spf1 ip4:192.0.2.300 -all", /"192.0.2.300" is not an IPv4 address/],
    ["v=spf1 ip4:192.0.2.0/33 -all", /prefix length/],
    ["v=spf1 ip6:2001:db8:::1 -all", /not an IPv6 address/],
    ["v=spf1 include: -all", /needs a domain/],
    ["v=spf1 include:example -all", /"example" is not a domain/],
    ["v=spf1 -all include:_spf.example.net", /comes after -all and is never evaluated/],
    ["v=spf1 mx v=spf1 -all", /a second v=spf1/],
    ["v=spf1 redirect=a.example.com redirect=b.example.com", /redirect= appears more than once/],
    ["v=spf1 all:example.com", /all takes no argument/],
    [`v=spf1 ${Array.from({ length: 11 }, (_, i) => `include:s${i}.example.net`).join(" ")} -all`, /11 terms need a DNS lookup/],
  ])("%s is refused", (text, problem) => {
    expect(spfProblems(text).join("; ")).toMatch(problem);
  });
});

describe("a DKIM key record", () => {
  const rsa = (bits: number) => generateKeyPairSync("rsa", { modulusLength: bits }).publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const good = rsa(1024);

  it("is a key when p= parses, whatever the spacing or quoting", () => {
    expect(dkimProblem(`v=DKIM1; k=rsa; p=${good}`)).toBeUndefined();
    expect(dkimProblem(`v=DKIM1; p=${good.slice(0, 100)} ${good.slice(100)}`)).toBeUndefined();
    expect(txtText(`"v=DKIM1; k=rsa; p=${good.slice(0, 120)}" "${good.slice(120)}"`)).toBe(`v=DKIM1; k=rsa; p=${good}`);
    expect(recordProblems({ type: "TXT", name: "s1._domainkey", content: `"v=DKIM1; p=${good.slice(0, 120)}" "${good.slice(120)}"` })).toEqual([]);
    const ed = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64");
    expect(dkimProblem(`v=DKIM1; k=ed25519; p=${ed}`)).toBeUndefined();
    expect(dkimProblem("v=DKIM1; p=")).toBeUndefined();
  });

  it("is refused when a character of the key was lost or changed", () => {
    expect(dkimProblem(`v=DKIM1; k=rsa; p=${good.slice(0, 50)}${good.slice(51)}`)).toMatch(/not standard base64/);
    const changed = `${good.slice(0, 20)}${good[20] === "A" ? "B" : "A"}${good.slice(21)}`;
    expect(dkimProblem(`v=DKIM1; p=${changed}`)).toMatch(/not an RSA public key/);
    expect(dkimProblem(`v=DKIM1; p=${rsa(512)}`)).toMatch(/512-bit RSA key/);
    expect(dkimProblem("v=DKIM1; k=rsa")).toMatch(/needs p=/);
    expect(dkimProblem("v=DKIM1; k=ed25519; p=AAAA")).toMatch(/3 bytes/);
  });

  it("is recognised by v=DKIM1, or by p= under _domainkey; other TXT records are left alone", () => {
    expect(isDkim(undefined, "v=DKIM1; p=")).toBe(true);
    expect(isDkim("s1._domainkey", "k=rsa; p=abc")).toBe(true);
    expect(isDkim("www", "k=rsa; p=abc")).toBe(false);
    expect(recordProblems({ type: "TXT", name: "", content: "google-site-verification=abc" })).toEqual([]);
    expect(recordProblems({ type: "A", name: "", content: "v=spf1 inlcude:x" })).toEqual([]);
    expect(recordProblems({ content: "v=spf1 inlcude:_spf.example.net" })).toEqual(['SPF: inlcude:_spf.example.net: "inlcude" is not an SPF mechanism (all, include, a, mx, ptr, ip4, ip6, exists)']);
  });
});

describe("a DS record", () => {
  it("has a key tag, a known algorithm and digest type, and a digest of its type's length", () => {
    expect(dsProblems({ keyTag: "55648", alg: "13", digestType: "2", digest: RFC6605_DIGEST })).toEqual([]);
    expect(dsProblems({ keyTag: "60485", alg: "5", digestType: "1", digest: "2BB183AF5F22588179A53B0A 98631FAD1A292118" })).toEqual([]);
    expect(dsProblems({ keyTag: "65536", alg: "9", digestType: "7", digest: "xyz" })).toEqual([
      'keyTag "65536" is not a key tag (a whole number from 0 to 65535)',
      expect.stringMatching(/^alg "9" is not a DNSSEC algorithm number \(1 RSAMD5, .*13 ECDSAP256SHA256/),
      expect.stringMatching(/^digestType "7" is not a DS digest type/),
      "digest is not hexadecimal",
    ]);
    expect(dsProblems({ keyTag: "1", alg: "13", digestType: "2", digest: RFC6605_DIGEST.slice(1) })).toEqual([
      "digest has 63 hex characters; a SHA-256 digest (digestType 2) has 64",
    ]);
    expect(dsProblems({ keyTag: "1", alg: "14", digestType: "4", digest: RFC6605_DIGEST })[0]).toMatch(/a SHA-384 digest \(digestType 4\) has 96/);
  });

  it("is computed from its DNSKEY as the RFCs' examples are", () => {
    const rfc4034 = parseDnskey(RFC4034_KEY);
    expect(rfc4034.owner).toBe("dskey.example.com.");
    expect(dsOf("dskey.example.com", rfc4034, 1)).toEqual({ keyTag: "60485", alg: "5", digestType: "1", digest: "2BB183AF5F22588179A53B0A98631FAD1A292118" });
    expect(dsOf("dskey.example.com", rfc4034, 2).digest).toBe("D4B7D520E7BB5F0F67674A0CCEB1E3E0614B93C4F9E99B8383F6A1E4469DA50A");
    expect(dsOf("example.net", parseDnskey(RFC6605_KEY), 2)).toEqual({ keyTag: "55648", alg: "13", digestType: "2", digest: RFC6605_DIGEST });
  });

  it("refuses a DNSKEY whose key was mistyped, or that is no zone key", () => {
    const [head, key = ""] = RFC6605_KEY.split(" 13 ");
    const changed = `${head} 13 ${key.slice(0, 40)}${key[40] === "A" ? "B" : "A"}${key.slice(41)}`;
    expect(thrown(() => dsOf("example.net", parseDnskey(changed), 2))?.message).toMatch(/not a point on P-256/);
    expect(thrown(() => parseDnskey(`257 3 13 ${key.slice(1)}`))?.message).toMatch(/not standard base64/);
    expect(thrown(() => parseDnskey(`1 3 13 ${key}`))?.message).toMatch(/zone key bit/);
    expect(thrown(() => parseDnskey(`257 2 13 ${key}`))?.message).toMatch(/always 3/);
    expect(thrown(() => parseDnskey(`257 3 99 ${key}`))?.message).toMatch(/not a DNSSEC algorithm/);
    expect(thrown(() => dsOf("example.net", parseDnskey(RFC6605_KEY), 3))?.message).toMatch(/not 3/);
  });

  it("from a DNSKEY, must agree with what the caller also typed, and belong to the zone", () => {
    expect(dsFor({ domain: "example.net", dnskey: RFC6605_KEY, keyTag: "55648", digest: RFC6605_DIGEST.toLowerCase() })).toEqual({
      ds: { keyTag: "55648", alg: "13", digestType: "2", digest: RFC6605_DIGEST },
      checked: "dnskey",
    });
    expect(thrown(() => dsFor({ domain: "example.net", dnskey: RFC6605_KEY, digest: `${RFC6605_DIGEST.slice(0, -1)}8` }))?.message).toMatch(
      /computed from the DNSKEY is keyTag 55648, alg 13, digestType 2, digest B4C8.*digest "B4C8.*8" differ/,
    );
    expect(thrown(() => dsFor({ domain: "example.com", dnskey: `example.net. IN DNSKEY ${RFC6605_KEY}` }))?.message).toMatch(/key of example.net, not of example.com/);
    const [, , , pub = ""] = RFC6605_KEY.split(" ");
    expect(dsFor({ domain: "example.net", keyDataFlags: "257", keyDataProtocol: "3", keyDataAlgo: "13", keyDataPubKey: pub }).checked).toBe("keyData");
    expect(thrown(() => dsFor({ domain: "example.net", dnskey: RFC6605_KEY, keyDataFlags: "256", keyDataProtocol: "3", keyDataAlgo: "13", keyDataPubKey: pub }))?.message).toMatch(
      /another key/,
    );
    expect(thrown(() => dsFor({ domain: "example.net", keyTag: "1", alg: "13" }))?.message).toMatch(/digestType, digest missing/);
  });
});

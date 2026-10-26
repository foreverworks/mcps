import { describe, expect, it } from "vitest";

import {
  ALLOW_FILE,
  allowedValues,
  applyAllowList,
  cnpControl,
  cnpValid,
  EXAMPLE_IBANS,
  ibanRemainder,
  ibanValid,
  ignoredDirectories,
  isText,
  MARKER,
  parseIPv6,
  phoneDigits,
  scanLine,
  scanText,
} from "../personal-data.js";

/*
 * Every value the check must flag is put together here at run time, from parts
 * no detector matches, so this file passes the check it tests. None can be a
 * real person's: CNPs are born in the 2090s, IBANs use a bank code no bank has,
 * phone numbers use the unassigned country code 999 and e-mail domains the
 * unassigned top-level domain .zz.
 */
const dotted = (...parts: string[]): string => parts.join(".");
const coloned = (...parts: string[]): string => parts.join(":");
const at = (local: string, ...host: string[]): string => `${local}@${dotted(...host)}`;
const plus = (digits: string): string => `+${digits}`;

/** A CNP from its first 12 digits and the control digit they call for. */
const cnpOf = (first12: string): string => `${first12}${cnpControl(first12)}`;

/** An IBAN from its country and BBAN, with the check digits ISO 13616 computes. */
const ibanOf = (country: string, bban: string): string => {
  const check = 98 - ibanRemainder(`${country}00${bban}`);
  return `${country}${String(check).padStart(2, "0")}${bban}`;
};

const kinds = (line: string): readonly string[] => scanLine(line).map((hit) => hit.kind);

describe("network addresses", () => {
  it("flags private, shared and link-local IPv4 addresses", () => {
    expect(kinds(`host ${dotted("10", "1", "2", "3")}`)).toEqual(["ipv4-private"]);
    expect(kinds(`http://${dotted("172", "20", "0", "5")}:8080/`)).toEqual(["ipv4-private"]);
    expect(kinds(dotted("192", "168", "1", "20"))).toEqual(["ipv4-private"]);
    expect(kinds(`peer ${dotted("100", "101", "102", "103")}.`)).toEqual(["ipv4-shared"]);
    expect(kinds(dotted("169", "254", "10", "1"))).toEqual(["ipv4-link-local"]);
  });

  it("lets through public, documentation and loopback addresses, and the ranges named as such", () => {
    for (const line of ["192.0.2.10", "198.51.100.7", "203.0.113.99", "127.0.0.1", "0.0.0.0", "8.8.8.8", "172.32.0.1", "100.128.0.1"]) expect(kinds(line)).toEqual([]);
    expect(kinds("10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 100.64.0.0/10 and 169.254.0.0/16")).toEqual([]);
    // A subnet of a house or an office is not a whole range.
    expect(kinds(`${dotted("192", "168", "1", "0")}/24`)).toEqual(["ipv4-private"]);
  });

  it("does not read a version or a longer dotted number as an address", () => {
    expect(kinds(`v${dotted("10", "1", "2", "3")}`)).toEqual([]);
    expect(kinds(dotted("10", "1", "2", "3", "4"))).toEqual([]);
    expect(kinds(dotted("10", "1", "2", "300"))).toEqual([]);
  });

  it("flags global, unique-local and link-local IPv6 addresses", () => {
    expect(kinds(coloned("3ffe", "", "1"))).toEqual(["ipv6-global"]);
    expect(kinds(`[${coloned("fd12", "3456", "789a", "", "1")}]:443`)).toEqual(["ipv6-unique-local"]);
    expect(kinds(coloned("fe80", "", "1"))).toEqual(["ipv6-link-local"]);
  });

  it("lets through documentation, loopback and the ranges named as such", () => {
    for (const line of ["2001:db8::1", "2001:db8:1:2::3/64", "3fff::1", "::1", "::", "fc00::/7, fd00::/8, fe80::/10 and 2000::/3"]) expect(kinds(line)).toEqual([]);
  });

  it("parses only real IPv6 addresses, so times, scopes and MACs are not", () => {
    expect(parseIPv6("2001:db8::1")).toBe(0x20010db8000000000000000000000001n);
    expect(parseIPv6("1:2:3:4:5:6:7:8")).toBe(0x00010002000300040005000600070008n);
    for (const text of ["12:30:45", "1:2:3:4:5:6:7", "1::2::3", "00:00:5e:00:53:01", "12345::"]) expect(parseIPv6(text)).toBeUndefined();
    expect(kinds("std::vector and a::before at 12:30:45")).toEqual([]);
  });

  it("flags MAC addresses in either notation, but not the documentation block or a longer fingerprint", () => {
    expect(kinds(coloned("02", "1a", "2b", "3c", "4d", "5e"))).toEqual(["mac"]);
    expect(kinds(["02", "1A", "2B", "3C", "4D", "5E"].join("-"))).toEqual(["mac"]);
    for (const line of ["00:00:5E:00:53:01", "00-00-5e-00-53-ff", "01:00:5E:90:10:00", "00:00:00:00:00:00", "ff:ff:ff:ff:ff:ff", "AA:BB:CC:DD:EE:FF"]) expect(kinds(line)).toEqual([]);
    expect(kinds(coloned(...Array<string>(16).fill("ab")))).toEqual([]);
    // Separators must agree.
    expect(kinds(["02", "1a", "2b", "3c", "4d", "5e"].join(":").replace(":2b", "-2b"))).toEqual([]);
  });

  it("flags a name under ts.net, but not a placeholder for one", () => {
    expect(kinds(`https://${dotted("machine", "example-tailnet", "ts", "net")}/`)).toEqual(["tailnet-host"]);
    expect(kinds("https://<machine>.<tailnet>.ts.net and *.ts.net")).toEqual([]);
  });
});

describe("contact details", () => {
  it("flags an e-mail address", () => {
    expect(scanLine(`Contact: ${at("ana.popescu", "company", "zz")}.`)).toEqual([{ column: 10, kind: "email", text: at("ana.popescu", "company", "zz") }]);
  });

  it("lets through reserved names, service senders, and names that only look like an address", () => {
    for (const line of [
      "ana@example.com",
      "billing@mail.example.org",
      "x@host.example",
      "a@b.test",
      "c@d.invalid",
      "e@f.localhost",
      "me@example.com.password",
      "git@github.com:owner/repo.git",
      "from:notifications@github.com",
      "12345+someone@users.noreply.github.com",
      "icon@2x.png",
      "backup@home.service",
      "@scope/package@1.2.3",
      "{@link Thing}",
    ])
      expect(kinds(line), line).toEqual([]);
    // example.co is someone's domain, not a reserved one.
    expect(kinds(at("a", "example", "co"))).toEqual(["email"]);
  });

  it("flags a phone number in international form or a tel: link", () => {
    expect(kinds(`Call ${plus("999 123 456 789")} now`)).toEqual(["phone"]);
    expect(kinds(plus("999123456789"))).toEqual(["phone"]);
    expect(kinds(plus("999 (12) 345-6789"))).toEqual(["phone"]);
    expect(kinds(`<a href="tel:${plus("999123456789")}">`)).toEqual(["phone"]);
  });

  it("lets through fictional numbers", () => {
    for (const line of ["+1 202 555 0123", "+1 (415) 555-0199", "+44 7700 900123", "+44 20 7946 0123", "+44 1632 960001"]) expect(kinds(line), line).toEqual([]);
    expect(kinds(plus("1 202 555 0200"))).toEqual(["phone"]);
  });

  it("does not read a time-zone offset, a signed decimal, a version or a hash as a phone number", () => {
    for (const line of [
      "2026-10-26T10:00:00+03:00",
      "2026-10-26T10:00:00+0300",
      "delta +1.2345678",
      "@@ -12,7 +12,9 @@",
      "version 1.2.3",
      "sha512-AbC+12345678dEf",
      "+12 34",
      "+999 - 123 - 456",
    ])
      expect(kinds(line), line).toEqual([]);
    expect(phoneDigits(plus("999 123 456 789"))).toBe("999123456789");
    expect(phoneDigits(plus("9991234567890123"))).toBeUndefined();
  });
});

describe("personal identifiers", () => {
  it("computes a CNP's control digit, and checks date, county and control", () => {
    const first12 = ["6", "99", "12", "31", "52", "001"].join("");
    const cnp = cnpOf(first12);
    expect(cnpValid(cnp)).toBe(true);
    expect(cnpValid(`${first12}${(cnpControl(first12) + 1) % 10}`)).toBe(false);
    expect(cnpValid(cnpOf(["5", "95", "13", "01", "40", "123"].join("")))).toBe(false);
    expect(cnpValid(cnpOf(["5", "95", "02", "30", "40", "123"].join("")))).toBe(false);
    expect(cnpValid(cnpOf(["5", "95", "06", "15", "53", "123"].join("")))).toBe(false);
    expect(cnpValid(cnpOf(["5", "95", "06", "15", "70", "123"].join("")))).toBe(true);
    expect(cnpValid(cnpOf(["0", "95", "06", "15", "40", "123"].join("")))).toBe(false);
  });

  it("counts a remainder of 10 as control digit 1", () => {
    // Search the 2090s for a code whose weighted sum leaves 10, so the rule is exercised, not assumed.
    const sum10 = Array.from({ length: 999 }, (_, i) => ["6", "93", "07", "14", "12", String(i + 1).padStart(3, "0")].join("")).find((first12) => {
      const weights = [2, 7, 9, 1, 4, 6, 3, 5, 8, 2, 7, 9];
      return weights.reduce((acc, w, i) => acc + w * Number(first12[i]), 0) % 11 === 10;
    });
    expect(sum10).toBeDefined();
    expect(cnpControl(sum10 ?? "")).toBe(1);
    expect(cnpValid(`${sum10}1`)).toBe(true);
  });

  it("flags a valid CNP on a line, and not 13 digits that fail it", () => {
    const cnp = cnpOf(["6", "98", "02", "28", "40", "007"].join(""));
    expect(scanLine(`"cnp": "${cnp}"`)).toEqual([{ column: 9, kind: "cnp", text: cnp }]);
    // A timestamp in milliseconds has the length and not the shape.
    expect(kinds(String(1_761_480_000_000))).toEqual([]);
    expect(kinds(`id ${cnp}0`)).toEqual([]);
  });

  it("checks an IBAN's length and mod-97 remainder", () => {
    for (const example of EXAMPLE_IBANS) expect(ibanValid(example), example).toBe(true);
    expect(ibanValid("GB82 WEST 1234 5698 7654 32")).toBe(true);
    expect(ibanValid("GB82WEST12345698765433")).toBe(false);
    expect(ibanValid("GB82WEST1234569876543")).toBe(false);
    expect(ibanValid("ZZ82WEST12345698765432")).toBe(false);
    const made = ibanOf("RO", ["ZZZZ", "0000", "0000", "0000", "0001"].join(""));
    expect(ibanValid(made)).toBe(true);
    expect(ibanRemainder(made)).toBe(1);
  });

  it("flags an IBAN compact or printed in groups, and lets the published examples through", () => {
    const made = ibanOf("DE", ["0000", "0000", "0000", "1234", "56"].join(""));
    expect(kinds(`IBAN ${made}`)).toEqual(["iban"]);
    expect(kinds(`IBAN ${made.replace(/(.{4})/g, "$1 ").trim()}`)).toEqual(["iban"]);
    expect(kinds("RO49AAAA1B31007593840000 or RO49 AAAA 1B31 0075 9384 0000, DE89370400440532013000")).toEqual([]);
    expect(kinds(`IBAN ${made.slice(0, -1)}9`)).toEqual([]);
  });
});

describe("the marker and the allow-list", () => {
  const flagged = `ip ${dotted("10", "9", "8", "7")}, mail ${at("ana", "company", "zz")}`;

  it("skips a line that carries the marker, and only that line", () => {
    expect(kinds(flagged)).toEqual(["ipv4-private", "email"]);
    expect(scanLine(`${flagged} // ${MARKER} (a test value)`)).toEqual([]);
    expect(scanText(`${flagged} # ${MARKER} (a test value)\n${flagged}`).map((f) => [f.line, f.kind])).toEqual([
      [2, "ipv4-private"],
      [2, "email"],
    ]);
  });

  it("reads one value per line, without comments or blank lines", () => {
    expect(allowedValues(`# why\n${at("sender", "agency", "zz")}\n\n  ${plus("999123456789")}  \n`)).toEqual(new Set([at("sender", "agency", "zz"), plus("999123456789")]));
    expect(ALLOW_FILE).toBe(".personal-data-allow");
  });

  it("passes what the list names, an IBAN with or without spaces, and reports entries nothing matched", () => {
    const iban = ibanOf("RO", ["ZZZZ", "0000", "0000", "0000", "0002"].join(""));
    const findings = scanText(`${flagged}\n${iban.replace(/(.{4})/g, "$1 ").trim()}`);
    const { reported, unused } = applyAllowList(findings, new Set([at("ana", "company", "zz"), iban, at("gone", "company", "zz")]));
    expect(reported.map((f) => f.kind)).toEqual(["ipv4-private"]);
    expect(unused).toEqual([at("gone", "company", "zz")]);
  });
});

describe("the files it reads", () => {
  it("tells text from binary as git does", () => {
    expect(isText(new TextEncoder().encode("plain text\n"))).toBe(true);
    expect(isText(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]))).toBe(false);
  });

  it("outside git, skips the directories .gitignore names, and nothing else", () => {
    const gitignore = "node_modules/\ndist/\n*.tsbuildinfo\n# comment/\n/bundles/\n!keep/\n/packages/*/LICENSE\n.built\n/_site/\nsub/dir/\n";
    expect(ignoredDirectories(gitignore)).toEqual(new Set(["node_modules", "dist", "bundles", "_site"]));
  });
});

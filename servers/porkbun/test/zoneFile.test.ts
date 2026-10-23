/**
 * Zone files both ways: export_dns_zone writes what Porkbun lists as a BIND
 * file in the outbox, and import_dns_records reads one (`zone_file`) through
 * the same checks as any other import. Invented records only.
 */
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { type ListedRecord, parseZone, zoneText } from "../src/domain/dns/zoneFile.js";
import { connect, json, keyFiles, stubFetch } from "./harness.js";

const API = "https://api.porkbun.com/api/json/v3";
const dir = (prefix: string) => mkdtempSync(join(tmpdir(), prefix));
/** A DKIM key record long enough (2048-bit RSA) that a zone file splits it into two strings. */
const DKIM = `v=DKIM1; k=rsa; p=${generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ type: "spki", format: "der" }).toString("base64")}`;

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Records as list_dns_records answers (Porkbun's /mock/dns/retrieve shape: full names, ttl and prio as strings). */
const LISTED: readonly ListedRecord[] = [
  { name: "example.com", type: "A", content: "192.0.2.10", ttl: "600", prio: "0", notes: "" },
  { name: "www.example.com", type: "CNAME", content: "example.com", ttl: "3600", prio: "0", notes: "the site\nsecond line" },
  { name: "example.com", type: "MX", content: "mail.example.net", ttl: "600", prio: "10" },
  { name: "s1._domainkey.example.com", type: "TXT", content: DKIM, ttl: "600" },
  { name: "quote.example.com", type: "TXT", content: 'say "hi" \\ café', ttl: "600" },
  { name: "_sip._tcp.example.com", type: "SRV", content: "5 5060 sip.example.net", ttl: "600", prio: "10" },
  { name: "example.com", type: "CAA", content: '0 issue "letsencrypt.org"', ttl: "600" },
  { name: "*.example.com", type: "ALIAS", content: "lb.example.net", ttl: "600" },
  { name: "example.com", type: "NS", content: "curitiba.ns.porkbun.com", ttl: "86400" },
  { name: "x.example.com", type: "A", content: "192.0.2.11" },
];

describe("zoneText", () => {
  it("writes BIND: relative owners, absolute targets, MX and SRV priorities, TXT quoted in 255-byte strings with escapes, notes as comments", () => {
    const { text, types } = zoneText("Example.COM", LISTED);
    const dkim = `"${DKIM.slice(0, 255)}" "${DKIM.slice(255)}"`;
    expect(text).toBe(
      [
        "; example.com: 10 records, as Porkbun's DNS holds them (list_dns_records).",
        "; Porkbun answers with its own SOA, so the file has none; a record's notes follow it as a comment.",
        "$ORIGIN example.com.",
        "$TTL 600 ; Porkbun's usual minimum, for a record listed without a TTL",
        "@\t600\tIN\tA\t192.0.2.10",
        "www\t3600\tIN\tCNAME\texample.com. ; the site second line",
        "@\t600\tIN\tMX\t10 mail.example.net.",
        `s1._domainkey\t600\tIN\tTXT\t${dkim}`,
        'quote\t600\tIN\tTXT\t"say \\"hi\\" \\\\ caf\\195\\169"',
        "_sip._tcp\t600\tIN\tSRV\t10 5 5060 sip.example.net.",
        '@\t600\tIN\tCAA\t0 issue "letsencrypt.org"',
        "*\t600\tIN\tALIAS\tlb.example.net.",
        "@\t86400\tIN\tNS\tcuritiba.ns.porkbun.com.",
        "x\tIN\tA\t192.0.2.11",
        "",
      ].join("\n"),
    );
    expect(types).toEqual({ A: 2, CNAME: 1, MX: 1, TXT: 2, SRV: 1, CAA: 1, ALIAS: 1, NS: 1 });
  });

  it("reads back as the records Porkbun's import takes, the NS record set aside", () => {
    const parsed = parseZone(zoneText("example.com", LISTED).text, "example.com");
    expect(parsed).toEqual({
      ok: true,
      records: [
        { name: "", type: "A", content: "192.0.2.10", ttl: 600 },
        { name: "www", type: "CNAME", content: "example.com", ttl: 3600 },
        { name: "", type: "MX", content: "mail.example.net", ttl: 600, prio: 10 },
        { name: "s1._domainkey", type: "TXT", content: DKIM, ttl: 600 },
        { name: "quote", type: "TXT", content: 'say "hi" \\ café', ttl: 600 },
        { name: "_sip._tcp", type: "SRV", content: "5 5060 sip.example.net", ttl: 600, prio: 10 },
        { name: "", type: "CAA", content: '0 issue "letsencrypt.org"', ttl: 600 },
        { name: "*", type: "ALIAS", content: "lb.example.net", ttl: 600 },
        { name: "x", type: "A", content: "192.0.2.11", ttl: 600 },
      ],
      ignored: [{ line: 13, name: "@", type: "NS", why: expect.stringContaining("Porkbun's import ignores NS records") }],
    });
  });
});

describe("parseZone", () => {
  it("reads another host's export: $ORIGIN, $TTL with units, a multi-line SOA, inherited owners, either order of TTL and class, comments, escapes", () => {
    const foreign = [
      "; exported by another DNS host",
      "$ORIGIN example.com.",
      "$TTL 1h",
      "@   IN  SOA ns1.otherdns.example. hostmaster.example.com. (",
      "        2026102201 ; serial",
      "        7200 3600 1209600 300 )",
      "    IN  NS  ns1.otherdns.example.",
      "@   300 IN A 192.0.2.1",
      "        IN AAAA 2001:db8::1",
      "www IN 600 CNAME @",
      "mail.example.com. IN A 192.0.2.2",
      "@ IN MX 10 mail",
      '@ IN TXT "v=spf1 mx -all" ; a comment; with "quotes"',
      's1._domainkey IN TXT ( "v=DKIM1; k=rsa; "',
      '    "p=MIIBIjANBgkqh" )',
      'note IN TXT "a \\"quoted\\" word; not a comment" " caf\\195\\169"',
      "_sip._tcp IN SRV 10 5 5060 sip",
      "@ IN DNSKEY 257 3 13 AAAA",
      "$ORIGIN sub.example.com.",
      "api 2d IN A 192.0.2.3",
    ].join("\n");
    expect(parseZone(foreign, "Example.com")).toEqual({
      ok: true,
      records: [
        { name: "", type: "A", content: "192.0.2.1", ttl: 300 },
        { name: "", type: "AAAA", content: "2001:db8::1", ttl: 3600 },
        { name: "www", type: "CNAME", content: "example.com", ttl: 600 },
        { name: "mail", type: "A", content: "192.0.2.2", ttl: 3600 },
        { name: "", type: "MX", content: "mail.example.com", ttl: 3600, prio: 10 },
        { name: "", type: "TXT", content: "v=spf1 mx -all", ttl: 3600 },
        { name: "s1._domainkey", type: "TXT", content: "v=DKIM1; k=rsa; p=MIIBIjANBgkqh", ttl: 3600 },
        { name: "note", type: "TXT", content: 'a "quoted" word; not a comment café', ttl: 3600 },
        { name: "_sip._tcp", type: "SRV", content: "5 5060 sip.example.com", ttl: 3600, prio: 10 },
        { name: "api.sub", type: "A", content: "192.0.2.3", ttl: 172800 },
      ],
      ignored: [
        { line: 4, name: "@", type: "SOA", why: "Porkbun answers with its own SOA" },
        { line: 7, name: "@", type: "NS", why: expect.any(String) },
        { line: 18, name: "@", type: "DNSKEY", why: "DNSSEC signing data belongs to whoever signs the zone" },
      ],
    });
  });

  it("finds every problem, each with its line, rather than importing part of the file", () => {
    const bad = [
      "$ORIGIN example.com.",
      "$INCLUDE other.zone",
      "@ IN A 192.0.2.1",
      "other.org. IN A 192.0.2.9",
      "@ IN PTR host.example.com.",
      '@ CH TXT "chaos"',
      "@ IN MX mail",
      "@ IN SRV 1 2 sip",
      "@ IN MX 70000 mail",
      '  IN TXT "inherits @"',
      'y IN TXT "never closed',
    ].join("\n");
    expect(parseZone(bad, "example.com")).toEqual({
      ok: false,
      problems: [
        "line 11: a quoted string that never closes",
        "line 2: $INCLUDE other.zone is not followed here; put its records in this file",
        "line 4: other.org is not in example.com",
        expect.stringMatching(/^line 5: Porkbun cannot hold a PTR record \(it takes A, AAAA, CNAME, ALIAS, MX, TXT, SRV, CAA, TLSA, SSHFP, HTTPS, SVCB\)$/),
        "line 6: class CH is not the Internet class (IN)",
        "line 7: MX takes 2 fields, found 1",
        "line 8: SRV takes 4 fields, found 3",
        "line 9: MX preference 70000 is not a number from 0 to 65535",
      ],
    });
    expect(parseZone("   IN A 192.0.2.1\n", "example.com")).toEqual({ ok: false, problems: ["line 1: a record with no owner name before it"] });
    expect(parseZone("x IN A ( 192.0.2.5\n", "example.com")).toEqual({ ok: false, problems: ['line 1: a "(" that never closes'] });
  });
});

describe("export_dns_zone", () => {
  it("writes the zone file to the outbox from list_dns_records, and answers with its path, size, sha256 and counts", async () => {
    const outbox = dir("porkbun-outbox-");
    const sent = stubFetch(() => json({ status: "SUCCESS", cloudflare: "enabled", records: LISTED.map((r, i) => ({ id: String(i + 1), ...r })) }));
    const { call, asked } = await connect({ ...keyFiles(), PORKBUN_OUTBOX_DIR: outbox });
    const result = await call("export_dns_zone", { domain: "Example.com" });
    const path = join(outbox, "example.com.zone");
    const bytes = readFileSync(path);
    expect(bytes.toString("utf8")).toBe(zoneText("example.com", LISTED).text);
    expect(result.value).toEqual({
      domain: "example.com",
      file: { path, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), contentType: "text/dns" },
      records: 10,
      types: { A: 2, CNAME: 1, MX: 1, TXT: 2, SRV: 1, CAA: 1, ALIAS: 1, NS: 1 },
    });
    expect(asked).toEqual([]);
    expect(sent.map((s) => s.url)).toEqual([`${API}/dns/retrieve/example.com`]);
  });

  it("links the file it saved in the result", async () => {
    const outbox = dir("porkbun-outbox-");
    stubFetch(() => json({ status: "SUCCESS", records: LISTED }));
    const { client } = await connect({ ...keyFiles(), PORKBUN_OUTBOX_DIR: outbox });
    const result = (await client.callTool({ name: "export_dns_zone", arguments: { domain: "example.com" } })) as { content: readonly Record<string, unknown>[] };
    expect(result.content.filter((c) => c["type"] === "resource_link")).toEqual([
      expect.objectContaining({ type: "resource_link", uri: `file://${join(outbox, "example.com.zone")}`, name: "example.com.zone" }),
    ]);
  });

  it("is a read, saves nothing on an answer without records, and needs the outbox", async () => {
    const outbox = dir("porkbun-outbox-");
    stubFetch(() => json({ status: "SUCCESS" }));
    const { call, client } = await connect({ ...keyFiles(), PORKBUN_OUTBOX_DIR: outbox });
    const tool = (await client.listTools()).tools.find((t) => t.name === "export_dns_zone");
    expect(tool?.annotations).toMatchObject({ readOnlyHint: true, idempotentHint: true, destructiveHint: false });
    expect((await call("export_dns_zone", { domain: "example.com" })).value).toMatchObject({ error: { kind: "drift", message: expect.stringContaining("nothing was saved") } });
    expect(readdirSync(outbox)).toEqual([]);
    const none = await connect(keyFiles());
    expect((await none.call("export_dns_zone", { domain: "example.com" })).value).toMatchObject({ error: { kind: "config", variable: "PORKBUN_OUTBOX_DIR" } });
  });
});

describe("import_dns_records with zone_file", () => {
  const inbox = (name: string, text: string) => {
    const root = dir("porkbun-inbox-");
    writeFileSync(join(root, name), text);
    return root;
  };

  it("sends the zone's records through the checked import, and says what it read and set aside", async () => {
    const text = zoneText("example.com", LISTED).text;
    const root = inbox("example.com.zone", text);
    const sent = stubFetch(() => json({ status: "SUCCESS", created: 9, skipped: 0, failed: 0 }));
    const { call } = await connect({ ...keyFiles(), MCP_FILE_ROOTS: root });
    const result = await call("import_dns_records", { domain: "example.com", zone_file: { path: "example.com.zone" } });
    expect(result.value).toMatchObject({
      status: "SUCCESS",
      created: 9,
      zone_file: { sha256: createHash("sha256").update(text).digest("hex"), size: Buffer.byteLength(text), records: 9, ignored: [{ line: 13, type: "NS", name: "@" }] },
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe(`${API}/dns/import/example.com`);
    const body = sent[0]?.body as { records: readonly Record<string, unknown>[] };
    expect(body.records).toHaveLength(9);
    expect(body.records[2]).toEqual({ name: "", type: "MX", content: "mail.example.net", ttl: 600, prio: 10 });
  });

  it("refuses the whole import, naming the record or the line, and sends nothing", async () => {
    const root = inbox("bad.zone", '$ORIGIN example.com.\ns2._domainkey IN TXT "v=DKIM1; p=AAAA"\n');
    writeFileSync(join(root, "ptr.zone"), "@ IN PTR host.example.com.\n");
    const sent = stubFetch(() => json({ status: "SUCCESS" }));
    const { call } = await connect({ ...keyFiles(), MCP_FILE_ROOTS: root });
    const dkim = await call("import_dns_records", { domain: "example.com", zone_file: { path: "bad.zone" } });
    expect(dkim.value).toMatchObject({ error: { kind: "input", message: expect.stringMatching(/^record 1 of the zone file \(TXT s2\._domainkey\): DKIM: /) } });
    const ptr = await call("import_dns_records", { domain: "example.com", zone_file: { path: "ptr.zone" } });
    expect(ptr.value).toMatchObject({ error: { kind: "input", message: expect.stringMatching(/^zone_file: line 1: Porkbun cannot hold a PTR record/) } });
    const both = await call("import_dns_records", { domain: "example.com", zone_file: { path: "ptr.zone" }, records_file: { path: "bad.zone" } });
    expect(both.value).toMatchObject({ error: { kind: "input", message: "give one of records, records_file and zone_file, not records_file and zone_file" } });
    expect(sent).toEqual([]);
  });
});

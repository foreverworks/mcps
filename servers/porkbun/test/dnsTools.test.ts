/**
 * The DNS tools through the server: what is refused before anything reaches
 * Porkbun, what is sent when it passes, and what the answer adds.
 */
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { WRAPPED } from "../src/mcp/register.js";
import { buildDeps } from "../src/composition.js";
import { connect, json, keyFiles, stubFetch } from "./harness.js";

const API = "https://api.porkbun.com/api/json/v3";
const DKIM = generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ type: "spki", format: "der" }).toString("base64");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the wrapped tools", () => {
  it("are all still offered by the vendor", () => {
    const offered = new Set(buildDeps({}).porkbun.catalog.map((t) => t.name));
    expect(Object.keys(WRAPPED).filter((name) => !offered.has(name))).toEqual([]);
  });
});

describe("create_dns_record and update_dns_record", () => {
  it("send a DKIM key that parses as it was given, and refuse one that does not, sending nothing", async () => {
    const sent = stubFetch(() => json({ status: "SUCCESS", id: "123" }));
    const { call } = await connect(keyFiles());
    const content = `v=DKIM1; k=rsa; p=${DKIM}`;

    const fine = await call("create_dns_record", { domain: "example.com", type: "TXT", name: "s1._domainkey", content });
    expect(fine.value).toEqual({ status: "SUCCESS", id: "123" });
    expect(sent[0]).toMatchObject({ url: `${API}/dns/create/example.com`, body: { type: "TXT", name: "s1._domainkey", content } });

    const typo = await call("create_dns_record", { domain: "example.com", type: "TXT", name: "s1._domainkey", content: content.replace(DKIM.slice(30, 31), "") });
    expect(typo.value).toMatchObject({ error: { kind: "input", message: expect.stringMatching(/^content: DKIM: p= /), remedy: expect.stringContaining("nothing was sent") } });

    const spf = await call("update_dns_record", { domain: "example.com", record_id: "123", content: "v=spf1 ip4:192.0.2.256 -all" });
    expect(spf.value).toMatchObject({ error: { kind: "input", message: expect.stringContaining('"192.0.2.256" is not an IPv4 address') } });
    expect(sent).toHaveLength(1);
  });
});

describe("import_dns_records", () => {
  const records = [
    { name: "", type: "TXT", content: "v=spf1 include:_spf.example.net -all" },
    { name: "s1._domainkey", type: "TXT", content: `v=DKIM1; p=${DKIM}` },
    { name: "www", type: "CNAME", content: "example.com", ttl: 600 },
  ];
  const inbox = (body: unknown) => {
    const root = mkdtempSync(join(tmpdir(), "porkbun-inbox-"));
    const text = JSON.stringify(body);
    writeFileSync(join(root, "zone.json"), text);
    return { root, text };
  };

  it("takes its records from a file, checks each, sends them, and says what it read", async () => {
    const { root, text } = inbox({ records });
    const sent = stubFetch(() => json({ status: "SUCCESS", created: 3 }));
    const { call } = await connect({ ...keyFiles(), MCP_FILE_ROOTS: root });
    const result = await call("import_dns_records", { domain: "example.com", records_file: { path: "zone.json" } });
    expect(result.value).toEqual({
      status: "SUCCESS",
      created: 3,
      records_file: { sha256: createHash("sha256").update(text).digest("hex"), size: text.length, records: 3 },
    });
    expect(sent[0]).toMatchObject({ url: `${API}/dns/import/example.com`, body: { records } });
  });

  it("refuses the whole import when one record is wrong, naming it, and a file that holds no records", async () => {
    const { root } = inbox([...records, { name: "s2._domainkey", type: "TXT", content: "v=DKIM1; p=AAAA" }]);
    writeFileSync(join(root, "not-records.json"), JSON.stringify({ zone: "example.com" }));
    writeFileSync(join(root, "not-json.txt"), "name,type,content\n");
    const sent = stubFetch(() => json({ status: "SUCCESS" }));
    const { call } = await connect({ ...keyFiles(), MCP_FILE_ROOTS: root });

    const bad = await call("import_dns_records", { domain: "example.com", records_file: { path: "zone.json" } });
    expect(bad.value).toMatchObject({ error: { kind: "input", message: expect.stringMatching(/^record 4 \(TXT s2\._domainkey\): DKIM: p= is base64 but not an RSA public key/) } });
    expect((await call("import_dns_records", { domain: "example.com", records_file: { path: "not-records.json" } })).value).toMatchObject({ error: { kind: "input", message: expect.stringContaining("JSON array of records") } });
    expect((await call("import_dns_records", { domain: "example.com", records_file: { path: "not-json.txt" } })).value).toMatchObject({ error: { kind: "input", message: expect.stringContaining("not JSON") } });
    expect((await call("import_dns_records", { domain: "example.com", records, records_file: { path: "zone.json" } })).value).toMatchObject({ error: { kind: "input", message: "give one of records, records_file and zone_file, not records and records_file" } });
    expect((await call("import_dns_records", { domain: "example.com", records: [{ name: "", type: "TXT", content: "v=spf1 -all mx" }] })).value).toMatchObject({ error: { kind: "input" } });
    expect(sent).toEqual([]);
  });

  it("still imports what a scan finds when given no records at all", async () => {
    const sent = stubFetch(() => json({ status: "SUCCESS" }));
    const { call } = await connect(keyFiles());
    expect((await call("import_dns_records", { domain: "example.com" })).isError).toBe(false);
    expect(sent[0]?.body).not.toHaveProperty("records");
  });
});

describe("update_nameservers", () => {
  it("checks each name, then answers with the set before and the one sent", async () => {
    const sent = stubFetch((url) => (url.includes("/getNs/") ? json({ status: "SUCCESS", ns: ["curitiba.ns.porkbun.com", "fortaleza.ns.porkbun.com"] }) : json({ status: "SUCCESS" })));
    const { call } = await connect(keyFiles());
    const result = await call("update_nameservers", { domain: "example.com", nameservers: ["NS1.Example.NET.", "ns2.example.net"] });
    expect(result.value).toEqual({
      status: "SUCCESS",
      nameservers: { before: ["curitiba.ns.porkbun.com", "fortaleza.ns.porkbun.com"], after: ["ns1.example.net", "ns2.example.net"] },
    });
    expect(sent.map((s) => s.url)).toEqual([`${API}/domain/getNs/example.com`, `${API}/domain/updateNs/example.com`]);
    expect(sent[1]?.body).toMatchObject({ ns: ["ns1.example.net", "ns2.example.net"] });
  });

  it("refuses a name that is not one, or one listed twice, before asking Porkbun anything", async () => {
    const sent = stubFetch(() => json({ status: "SUCCESS" }));
    const { call } = await connect(keyFiles());
    expect((await call("update_nameservers", { domain: "example.com", nameservers: ["ns1.example.net", "ns2,example.net"] })).value).toMatchObject({
      error: { kind: "input", message: expect.stringContaining('"ns2,example.net" has the label "ns2,example"') },
    });
    expect((await call("update_nameservers", { domain: "example.com", nameservers: ["ns1.example.net", "NS1.example.net."] })).value).toMatchObject({
      error: { kind: "input", message: expect.stringContaining("ns1.example.net is listed twice") },
    });
    expect(sent).toEqual([]);
  });
});

describe("create_dnssec_record", () => {
  const KEY = "257 3 13 GojIhhXUN/u4v54ZQqGSnyhWJwaubCvTmeexv7bR6edbkrSqQpF64cYbcB7wNcP+e+MAnLr+Wi9xMWyQLc8NAA==";
  const DIGEST = "B4C8C1FE2E7477127B27115656AD6256F424625BF5C1E2770CE6D6E37DF61D17";

  it("computes the DS from the zone's DNSKEY and sends that, saying so", async () => {
    const sent = stubFetch(() => json({ status: "SUCCESS" }));
    const { call } = await connect(keyFiles());
    const result = await call("create_dnssec_record", { domain: "example.net", dnskey: `example.net. 3600 IN DNSKEY ${KEY}` });
    expect(result.value).toEqual({ status: "SUCCESS", ds: { keyTag: "55648", alg: "13", digestType: "2", digest: DIGEST, checked: "dnskey" } });
    expect(sent[0]).toMatchObject({ url: `${API}/dns/createDnssecRecord/example.net`, body: { keyTag: "55648", alg: "13", digestType: "2", digest: DIGEST } });
    expect(sent[0]?.body).not.toHaveProperty("dnskey");
  });

  it("sends typed fields only when they have a DS record's shape, and refuses a digest one character short", async () => {
    const sent = stubFetch(() => json({ status: "SUCCESS" }));
    const { call } = await connect(keyFiles());
    const short = await call("create_dnssec_record", { domain: "example.net", keyTag: "55648", alg: "13", digestType: "2", digest: DIGEST.slice(0, -1) });
    expect(short.value).toMatchObject({ error: { kind: "input", message: "digest has 63 hex characters; a SHA-256 digest (digestType 2) has 64; nothing was sent" } });
    expect(sent).toEqual([]);

    const typed = await call("create_dnssec_record", { domain: "example.net", keyTag: "55648", alg: "13", digestType: "2", digest: `${DIGEST.slice(0, 32)} ${DIGEST.slice(32)}` });
    expect(typed.value).toMatchObject({ ds: { checked: "shape", digest: DIGEST } });
    expect(sent[0]?.body).toMatchObject({ digest: DIGEST });
  });
});

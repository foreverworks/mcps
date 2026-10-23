/**
 * ANAF's seal: the XML reader, canonicalization, the local check against
 * test certificates (test/fixtures/seal), the verify_signature use case, and
 * the fallback request to ANAF.
 *
 * The seals here are built in ANAF's own shape: a detached XML-DSig
 * Signature in the default namespace, one Reference URI="" over the
 * invoice's raw bytes, RSA-SHA1 over inclusive C14N, base64 wrapped with
 * `&#13;\n`. What is signed is the canonical SignedInfo WRITTEN OUT BY HAND
 * below, not computed by the code under test.
 */
import { createHash, sign, X509Certificate } from "node:crypto";
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { asInputFileError, inputFilesWith, sha256Of } from "@foreverworks/mcp-kit";
import { afterEach, describe, expect, it, vi } from "vitest";

import { verifySignature } from "../src/app/usecases/signatures.js";
import { anafSealVerdict, readSeal } from "../src/domain/seal.js";
import { canonicalize } from "../src/domain/seal/c14n.js";
import { readXml, type XmlElement } from "../src/domain/seal/xml.js";
import { makeAnafApi } from "../src/infra/anafApi.js";
import { ANAF, ANAF_PUBLIC } from "../src/infra/config.js";
import { makePublicRequest, makeRequest } from "../src/infra/http.js";
import { makeSealCheck } from "../src/infra/seal.js";
import { absent, anafStub, byPath, errorOf, fakeDeps, json, NOW, sent, UBL_INVOICE, withFetch, zipOf } from "./fixtures.js";

afterEach(() => vi.unstubAllGlobals());

const FIXTURES = join(import.meta.dirname, "fixtures", "seal");
const pem = (name: string): string => readFileSync(join(FIXTURES, name), "utf8");
const TEST_CA = new X509Certificate(pem("test-ca.crt"));

const DS = "http://www.w3.org/2000/09/xmldsig#";
const C14N = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
const RSA_SHA1 = "http://www.w3.org/2000/09/xmldsig#rsa-sha1";
const SHA256 = "http://www.w3.org/2001/04/xmlenc#sha256";

/** Base64 the way Apache Santuario writes it: 76 columns, each break an escaped CR and a newline. */
const wrapped = (bytes: Buffer): string => (bytes.toString("base64").match(/.{1,76}/g) ?? []).join("&#13;\n");

type SealOptions = {
  readonly leaf?: string;
  readonly c14n?: string;
  /** The DigestValue written into the seal; the one signed is always the true one. */
  readonly writtenDigest?: string;
  readonly reference?: string;
  readonly prefix?: boolean;
};

/**
 * A seal over `invoice`. `signed` is what the key signs: SignedInfo in its
 * canonical form, written out here as the spec says it must come out
 * (namespace on the apex, empty elements as start and end tags).
 */
const sealFor = (invoice: Buffer, o: SealOptions = {}): Buffer => {
  const leaf = o.leaf ?? "seal-ok";
  const digest = createHash("sha256").update(invoice).digest("base64");
  const c14n = o.c14n ?? C14N;
  const p = o.prefix === true ? "ds:" : "";
  const decl = o.prefix === true ? `xmlns:ds="${DS}"` : `xmlns="${DS}"`;
  const inner = (d: string, closing: (tag: string, attrs: string) => string) =>
    `${closing("CanonicalizationMethod", ` Algorithm="${c14n}"`)}${closing("SignatureMethod", ` Algorithm="${RSA_SHA1}"`)}` +
    `<${p}Reference URI="">${o.reference ?? ""}${closing("DigestMethod", ` Algorithm="${SHA256}"`)}<${p}DigestValue>${d}</${p}DigestValue></${p}Reference>`;
  const signed = `<${p}SignedInfo ${decl}>${inner(digest, (t, a) => `<${p}${t}${a}></${p}${t}>`)}</${p}SignedInfo>`;
  const signature = sign("sha1", Buffer.from(signed, "utf8"), pem(`${leaf}.key`));
  const der = new X509Certificate(pem(`${leaf}.crt`)).raw;
  return Buffer.from(
    `<?xml version="1.0" encoding="UTF-8" standalone="no"?><${p}Signature ${decl}>` +
      `<${p}SignedInfo>${inner(o.writtenDigest ?? digest, (t, a) => `<${p}${t}${a}/>`)}</${p}SignedInfo>` +
      `<${p}SignatureValue>${wrapped(signature)}</${p}SignatureValue>` +
      `<${p}KeyInfo><${p}X509Data><${p}X509SubjectName>CN=Ministerul Finantelor</${p}X509SubjectName>` +
      `<${p}X509Certificate>${wrapped(der)}</${p}X509Certificate></${p}X509Data></${p}KeyInfo></${p}Signature>`,
    "utf8",
  );
};

const INVOICE = Buffer.from(UBL_INVOICE, "utf8");
const check = makeSealCheck({ anchors: [TEST_CA], organizationIdentifier: "25886108" });
const NOW_EPOCH = Date.parse("2030-01-01T00:00:00Z") / 1000;

const root = (xml: string): XmlElement => {
  const read = readXml(xml);
  if (!read.ok) throw new Error(read.why);
  return read.root;
};
const child = (e: XmlElement, index = 0): XmlElement => e.children.filter((c): c is XmlElement => c.kind === "element")[index] as XmlElement;

describe("readXml", () => {
  it("decodes the escaped CRs ANAF wraps base64 with, and normalises line endings first", () => {
    const r = root("<a>x&#13;\r\ny&amp;&lt;&#x41;</a>");
    expect(r.children).toEqual([{ kind: "text", text: "x\r\ny&<A" }]);
  });

  it("normalises literal whitespace in an attribute, but not a character reference", () => {
    expect(root('<a b="1\t2\n3&#10;4"/>').attributes).toEqual([{ name: "b", value: "1 2 3\n4" }]);
  });

  it("refuses a DOCTYPE, an unknown entity, and a tag that closes the wrong element", () => {
    expect(readXml('<!DOCTYPE a [<!ENTITY x "y">]><a>&x;</a>')).toMatchObject({ ok: false });
    expect(readXml("<a>&nbsp;</a>")).toMatchObject({ ok: false });
    expect(readXml("<a><b></a></b>")).toMatchObject({ ok: false });
    expect(readXml("<a>x & y</a>")).toMatchObject({ ok: false });
  });
});

describe("canonicalize", () => {
  it("expands empty elements, sorts attributes, escapes text and attributes, drops comments", () => {
    const r = root('<a z="1" b="&quot;&lt;&#9;&#13;"><!-- no --><e/>&gt;&#13;<?pi data?></a>');
    expect(canonicalize(r, [], "inclusive")).toEqual({
      ok: true,
      bytes: '<a b="&quot;&lt;&#x9;&#xD;" z="1"><e></e>&gt;&#xD;<?pi data?></a>',
    });
  });

  it("puts every namespace in scope on the apex when inclusive, only the used ones when exclusive", () => {
    const doc = root('<r xmlns="urn:d" xmlns:u="urn:unused" xmlns:p="urn:p"><s><p:t/></s></r>');
    const apex = child(doc);
    expect(canonicalize(apex, [doc], "inclusive")).toEqual({
      ok: true,
      bytes: '<s xmlns="urn:d" xmlns:p="urn:p" xmlns:u="urn:unused"><p:t></p:t></s>',
    });
    expect(canonicalize(apex, [doc], "exclusive")).toEqual({ ok: true, bytes: '<s xmlns="urn:d"><p:t xmlns:p="urn:p"></p:t></s>' });
  });

  it("undeclares the default namespace where a child leaves it, and sorts attributes by namespace URI", () => {
    const doc = root('<r xmlns="urn:d" xmlns:b="urn:b" xmlns:a="urn:a"><s a:y="1" b:x="2" c="3"><t xmlns=""/></s></r>');
    expect(canonicalize(child(doc), [doc], "inclusive")).toEqual({
      ok: true,
      bytes: '<s xmlns="urn:d" xmlns:a="urn:a" xmlns:b="urn:b" c="3" a:y="1" b:x="2"><t xmlns=""></t></s>',
    });
  });

  it("carries inherited xml:* attributes onto the apex when inclusive only", () => {
    const doc = root('<r xml:lang="ro"><s/></r>');
    expect(canonicalize(child(doc), [doc], "inclusive")).toEqual({ ok: true, bytes: '<s xml:lang="ro"></s>' });
    expect(canonicalize(child(doc), [doc], "exclusive")).toEqual({ ok: true, bytes: "<s></s>" });
  });

  it("refuses a prefix that is never declared", () => {
    expect(canonicalize(root("<p:a/>"), [], "inclusive")).toMatchObject({ ok: false });
  });
});

describe("readSeal", () => {
  it("reads ANAF's shape: algorithms, the digest, the signature and the certificate", () => {
    const read = readSeal(sealFor(INVOICE).toString("utf8"));
    expect(read).toMatchObject({ ok: true, seal: { c14n: "inclusive", signatureHash: "sha1", digestHash: "sha256" } });
    if (!read.ok) return;
    expect(read.seal.digest.equals(createHash("sha256").update(INVOICE).digest())).toBe(true);
    expect(read.seal.certificates).toHaveLength(1);
    expect(read.seal.signedInfo.startsWith(`<SignedInfo xmlns="${DS}"><CanonicalizationMethod Algorithm="${C14N}"></CanonicalizationMethod>`)).toBe(true);
  });

  it("calls anything looser unsupported, never valid", () => {
    expect(readSeal(sealFor(INVOICE, { c14n: "http://www.w3.org/2006/12/xml-c14n11" }).toString())).toMatchObject({ ok: false });
    expect(readSeal(sealFor(INVOICE, { reference: `<Transforms><Transform Algorithm="${C14N}"/></Transforms>` }).toString())).toMatchObject({
      ok: false,
    });
    expect(readSeal("<Signature/>")).toMatchObject({ ok: false });
    expect(readSeal(`<Signature xmlns="urn:not-dsig"><SignedInfo/></Signature>`)).toMatchObject({ ok: false });
  });
});

describe("the local check", () => {
  const at = { nowEpoch: NOW_EPOCH };

  it("finds ANAF's seal valid: the pinned CA, the Ministry's identifier, the signature, the raw bytes", () => {
    expect(check(INVOICE, sealFor(INVOICE), at)).toMatchObject({
      verdict: "valid",
      certificate: { organizationIdentifier: "25886108", issuer: expect.stringContaining("Test Electronic Seal CA") },
    });
  });

  it("reads a ds:-prefixed seal the same way", () => {
    expect(check(INVOICE, sealFor(INVOICE, { prefix: true }), at)).toMatchObject({ verdict: "valid" });
  });

  it("calls a changed invoice invalid: the seal is genuine, the bytes are not what ANAF sealed", () => {
    const changed = Buffer.from(UBL_INVOICE.replace("1234.50", "9234.50"), "utf8");
    expect(check(changed, sealFor(INVOICE), at)).toMatchObject({ verdict: "invalid", reason: expect.stringContaining("not the file it sealed") });
    // One byte is enough: a trailing newline.
    expect(check(Buffer.concat([INVOICE, Buffer.from("\n")]), sealFor(INVOICE), at)).toMatchObject({ verdict: "invalid" });
  });

  it("does not trust a DigestValue rewritten to match a changed invoice: the signature no longer covers it", () => {
    const changed = Buffer.from(UBL_INVOICE.replace("1234.50", "9234.50"), "utf8");
    const forged = sealFor(INVOICE, { writtenDigest: createHash("sha256").update(changed).digest("base64") });
    expect(check(changed, forged, at)).toMatchObject({ verdict: "inconclusive", reason: expect.stringContaining("does not verify") });
  });

  it("does not decide on a certificate from another CA or issued to someone else", () => {
    expect(check(INVOICE, sealFor(INVOICE, { leaf: "seal-foreign" }), at)).toMatchObject({
      verdict: "inconclusive",
      reason: expect.stringContaining("not issued by a CA this server trusts"),
    });
    expect(check(INVOICE, sealFor(INVOICE, { leaf: "seal-other-org" }), at)).toMatchObject({
      verdict: "inconclusive",
      reason: expect.stringContaining("99999999"),
    });
  });

  it("does not decide on a certificate that was not valid when the invoice was made", () => {
    expect(check(INVOICE, sealFor(INVOICE), { nowEpoch: NOW_EPOCH, issuedOn: "2099-01-01" })).toMatchObject({
      verdict: "inconclusive",
      reason: expect.stringContaining("expired before"),
    });
    expect(check(INVOICE, sealFor(INVOICE), { nowEpoch: Date.parse("2001-01-01T00:00:00Z") / 1000 })).toMatchObject({
      verdict: "inconclusive",
      reason: expect.stringContaining("not valid yet"),
    });
  });

  it("does not decide on a seal it cannot read", () => {
    expect(check(INVOICE, Buffer.from("<!DOCTYPE x><Signature/>"), at)).toMatchObject({ verdict: "inconclusive" });
  });
});

describe("ANAF's verdict", () => {
  it("is read from its two documented sentences, and from nothing else", () => {
    expect(anafSealVerdict("Fișierele încărcate au fost validate cu succes, din perspectiva autenticității")).toBe(true);
    expect(anafSealVerdict("Fișierele încărcate NU au putut fi validate cu succes")).toBe(false);
    // The same words with decomposed diacritics (NFD) are the same answer.
    expect(anafSealVerdict("Fișierele încărcate au fost validate cu succes".normalize("NFD"))).toBe(true);
    expect(anafSealVerdict("A aparut o eroare tehnica")).toBeUndefined();
    expect(anafSealVerdict(undefined)).toBeUndefined();
  });
});

describe("verifySignature", () => {
  const args = { messageId: "", archive: "", xml: absent("xml"), signature: absent("signature"), test: false };
  const realCheck = makeSealCheck({ anchors: [TEST_CA], organizationIdentifier: "25886108" });
  const archive = zipOf([
    { name: "5001.xml", data: INVOICE },
    { name: "semnatura_5001.xml", data: sealFor(INVOICE) },
  ]);

  it("answers from the local check and does not ask ANAF when it can decide", async () => {
    const verifySeal = vi.fn(anafStub().verifySeal);
    const deps = fakeDeps({ anaf: anafStub({ verifySeal }), checkSeal: realCheck, now: () => NOW_EPOCH });
    const out = await verifySignature(deps, { ...args, xml: sent("xml", INVOICE), signature: sent("signature", sealFor(INVOICE)) });
    expect(out).toMatchObject({
      valid: true,
      checkedBy: "local",
      source: { invoice: { size: INVOICE.length, sha256: sha256Of(INVOICE) }, signature: { sha256: sha256Of(sealFor(INVOICE)) } },
      invoice: { number: "EX-0042" },
    });
    expect(verifySeal).not.toHaveBeenCalled();
  });

  it("answers invalid locally, with the reason, for a changed invoice", async () => {
    const deps = fakeDeps({ checkSeal: realCheck, now: () => NOW_EPOCH });
    const changed = UBL_INVOICE.replace("1234.50", "9234.50");
    expect(await verifySignature(deps, { ...args, xml: sent("xml", changed), signature: sent("signature", sealFor(INVOICE)) })).toMatchObject({
      valid: false,
      checkedBy: "local",
      reason: expect.stringContaining("not the file it sealed"),
    });
  });

  it("asks ANAF when the local check cannot decide, and says both", async () => {
    const verifySeal = vi.fn(async () => ({ msg: "Fișierele încărcate NU au putut fi validate cu succes, ..." }));
    const deps = fakeDeps({ anaf: anafStub({ verifySeal }), checkSeal: realCheck, now: () => NOW_EPOCH });
    const foreign = sealFor(INVOICE, { leaf: "seal-foreign" });
    const out = await verifySignature(deps, { ...args, xml: sent("xml", INVOICE), signature: sent("signature", foreign) });
    expect(verifySeal).toHaveBeenCalledWith(INVOICE, foreign);
    expect(out).toMatchObject({ valid: false, checkedBy: "anaf", localInconclusive: expect.stringContaining("not issued by") });
  });

  it("fails loudly when ANAF answers neither documented verdict", async () => {
    const deps = fakeDeps({ anaf: anafStub({ verifySeal: async () => ({ msg: "A aparut o eroare tehnica" }) }) });
    expect(await errorOf(() => verifySignature(deps, { ...args, xml: sent("xml", INVOICE), signature: sent("signature", "<x/>") }))).toMatchObject({ kind: "api" });
  });

  it("takes the pair from a message's archive, as the exact bytes it holds", async () => {
    const checkSeal = vi.fn(realCheck);
    const deps = fakeDeps({ anaf: anafStub({ downloadMessage: async () => ({ bytes: archive, refusal: undefined }) }), checkSeal, now: () => NOW_EPOCH });
    expect(await verifySignature(deps, { ...args, messageId: "3001" })).toMatchObject({
      valid: true,
      source: { messageId: "3001", sha256: sha256Of(archive), bytes: archive.length },
    });
    expect(checkSeal.mock.calls[0]?.[0].equals(INVOICE)).toBe(true);
  });

  it("reads an archive already in the outbox, and nothing outside it", async () => {
    const readFile = vi.fn(async () => archive);
    const deps = fakeDeps({ checkSeal: realCheck, now: () => NOW_EPOCH });
    const withFiles = { ...deps, files: { ...deps.files, readFile } };
    expect(await verifySignature(withFiles, { ...args, archive: "2026-09/5001.zip" })).toMatchObject({ valid: true });
    expect(readFile).toHaveBeenCalledWith(join(deps.paths.downloadsDir, "2026-09", "5001.zip"));
    expect(await errorOf(() => verifySignature(withFiles, { ...args, archive: "/etc/5001.zip" }))).toMatchObject({ kind: "input" });
    expect(await errorOf(() => verifySignature(withFiles, { ...args, archive: "../5001.zip" }))).toMatchObject({ kind: "input" });
    expect(await errorOf(() => verifySignature(withFiles, { ...args, archive: "notes.txt" }))).toMatchObject({ kind: "input" });
  });

  it("refuses an archive without ANAF's seal in it", async () => {
    const unsealed = zipOf([{ name: "5001.xml", data: INVOICE }]);
    const deps = fakeDeps({ anaf: anafStub({ downloadMessage: async () => ({ bytes: unsealed, refusal: undefined }) }) });
    expect(await errorOf(() => verifySignature(deps, { ...args, messageId: "3001" }))).toMatchObject({ kind: "api" });
  });

  it("takes the two files by path from the reader's roots, byte for byte, and nothing it cannot trust", async () => {
    const inbox = mkdtempSync(join(tmpdir(), "anaf-inbox-"));
    writeFileSync(join(inbox, "5001.xml"), INVOICE);
    writeFileSync(join(inbox, "semnatura_5001.xml"), sealFor(INVOICE));
    const deps = fakeDeps({ checkSeal: realCheck, now: () => NOW_EPOCH });
    const withInbox = { ...deps, files: { ...deps.files, readInput: inputFilesWith([inbox]) } };
    expect(
      await verifySignature(withInbox, { ...args, xml: byPath("xml", "5001.xml"), signature: byPath("signature", "semnatura_5001.xml") }),
    ).toMatchObject({
      valid: true,
      checkedBy: "local",
      source: { invoice: { name: "5001.xml", sha256: sha256Of(INVOICE) }, signature: { name: "semnatura_5001.xml" } },
    });
    expect(await errorOf(() => verifySignature(withInbox, { ...args, xml: byPath("xml", "5001.xml") }))).toMatchObject({ kind: "input" });
    symlinkSync(deps.paths.tokens, join(inbox, "tokens.xml"));
    const refused = await verifySignature(withInbox, {
      ...args,
      xml: byPath("xml", "tokens.xml"),
      signature: byPath("signature", "semnatura_5001.xml"),
    }).catch((t: unknown) => asInputFileError(t));
    expect(refused).toMatchObject({ code: "symlink" });
  });

  it("takes exactly one source, and xml only with its signature", async () => {
    const deps = fakeDeps();
    expect(await errorOf(() => verifySignature(deps, args))).toMatchObject({ kind: "input" });
    expect(await errorOf(() => verifySignature(deps, { ...args, xml: sent("xml", INVOICE) }))).toMatchObject({ kind: "input" });
    const wrong = { ...sent("xml", INVOICE), source: { contentBase64: INVOICE.toString("base64"), sha256: "0".repeat(64) } };
    expect(await verifySignature(deps, { ...args, xml: wrong, signature: sent("signature", sealFor(INVOICE)) }).catch((t: unknown) => asInputFileError(t))).toMatchObject({
      kind: "checksum_mismatch",
    });
    expect(await errorOf(() => verifySignature(deps, { ...args, messageId: "1", archive: "a.zip" }))).toMatchObject({ kind: "input" });
  });

  it("uses the invoice's own date as the latest a valid certificate may have expired", async () => {
    const checkSeal = vi.fn(realCheck);
    await verifySignature(fakeDeps({ checkSeal, now: () => NOW }), { ...args, xml: sent("xml", INVOICE), signature: sent("signature", sealFor(INVOICE)) });
    expect(checkSeal.mock.calls[0]?.[2]).toEqual({ nowEpoch: NOW, issuedOn: "2026-09-28" });
  });
});

describe("the fallback request", () => {
  it("POSTs both files as multipart to ANAF's public host, bytes untouched, with no token", async () => {
    const spy = withFetch(async () => json({ msg: "Fișierele încărcate au fost validate cu succes" }));
    const api = makeAnafApi(
      async () => ANAF,
      makeRequest({ get: async () => "token", force: async () => "token" }, { sleep: async () => undefined }),
      makePublicRequest({ sleep: async () => undefined }),
    );
    const seal = sealFor(INVOICE);
    expect(await api.verifySeal(INVOICE, seal)).toEqual({ msg: "Fișierele încărcate au fost validate cu succes" });
    const [url, init] = spy.mock.calls[0] ?? [];
    expect(String(url)).toBe(ANAF_PUBLIC.signature);
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBeNull();
    const boundary = /boundary=(.+)$/.exec(headers.get("content-type") ?? "")?.[1] ?? "";
    const body = Buffer.from(init?.body as Uint8Array);
    const parts = body.toString("latin1").split(`--${boundary}`);
    expect(parts[1]).toContain('name="file"');
    expect(parts[2]).toContain('name="signature"');
    expect(body.includes(INVOICE)).toBe(true);
    expect(body.includes(seal)).toBe(true);
  });
});

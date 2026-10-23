/**
 * The pieces of a filing that need no SPV: the declaration's facts, the
 * validator's verdict, ANAF's ZIPs, the XML inside the PDF, the kit built
 * from ANAF's static files, and formularespv-pf's page. Invented data only.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";

import { makeHttp } from "@foreverworks/mcp-kit";
import { describe, expect, it } from "vitest";

import { dukVerdict, factsOf, filingLine, kitFor } from "../src/domain/declarations.js";
import { makeKits } from "../src/infra/duk/kit.js";
import { unzip } from "../src/infra/duk/zip.js";
import { embeddedFiles } from "../src/infra/pdf.js";
import { filingIndexIn, uploadPageIn } from "../src/infra/portal/forms.js";
import { d212, pdfWith } from "./fakes/duk.js";
import { errorOf } from "./helpers.js";

/** A ZIP of `files`, the first stored and the rest deflated, as ANAF's archives mix them. */
const zipOf = (files: Readonly<Record<string, Uint8Array>>): Uint8Array => {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  Object.entries(files).forEach(([name, data], i) => {
    const method = i === 0 ? 0 : 8;
    const body = method === 0 ? Buffer.from(data) : deflateRawSync(data);
    const nameBytes = Buffer.from(name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, body);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + body.length;
  });
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, directory, end]));
};

const bytes = (text: string) => new TextEncoder().encode(text);

describe("a declaration's XML", () => {
  it("names its form, reporting year, taxpayer and namespace", () => {
    expect(factsOf(new TextDecoder().decode(d212()), "D212")).toEqual({
      form: "D212",
      year: 2025,
      month: 12,
      cif: "2990101999999",
      name: undefined,
      namespace: "mfp:anaf:dgti:d212:declaratie:v8",
      rectifying: false,
      payable: undefined,
    });
  });

  it("refuses what is not that form, and a year with no validator", async () => {
    expect((await errorOf(() => factsOf("<d100 an_r='2023'/>", "D212")))?.message).toContain("not a D212");
    expect((await errorOf(() => factsOf('<d212 an_r="x"/>', "D212")))?.message).toContain("an_r");
    expect(kitFor("D212", { year: 2023, month: 12 }).zip).toBe("D212_20231002.zip");
    expect((await errorOf(() => kitFor("D212", { year: 2019, month: 12 })))?.message).toContain("2020, 2021");
  });

  it("is confirmed by one line naming what is filed, for whom, and that it stays", () => {
    const line = filingLine(
      { form: "D212", year: 2025, month: 12, cif: "2990101999999", name: undefined, namespace: undefined, rectifying: false, payable: undefined },
      { name: "filing.pdf", size: 98765, sha256: "ab".repeat(32) },
    );
    expect(line).toBe("File D212 for reporting year 2025 for 2990101999999 at ANAF (filing.pdf, 98765 bytes, sha256 abababababab); a filed declaration cannot be withdrawn, only rectified");
    expect(line.length).toBeLessThan(300);
  });
});

describe("DUKIntegrator's verdict", () => {
  it("is valid only when it says so in both places: it exits 0 either way", () => {
    expect(dukVerdict("1.\nValidare fara erori fisier: /w/D212.xml\n", "ok\n")).toEqual({ valid: true });
    expect(dukVerdict("1.\nErori la validare fisier: /w/D212.xml\n", "F: validari globale")).toEqual({ valid: false });
    expect(dukVerdict("folderul config nu poate fi determinat.\neroare in linia de comanda", "")).toEqual({ valid: false });
  });
});

describe("ANAF's ZIPs and the XML inside a PDF", () => {
  it("unzips stored and deflated entries", () => {
    const files = unzip(zipOf({ "D212/D212Validator.jar": bytes("validator"), "D212/D212Pdf.jar": bytes("pdf maker ".repeat(50)) }), "test.zip");
    expect(new TextDecoder().decode(files.get("D212/D212Validator.jar"))).toBe("validator");
    expect(files.get("D212/D212Pdf.jar")?.length).toBe(500);
  });

  it("finds the embedded file byte for byte, its length an indirect object", () => {
    const xml = d212();
    const [attached] = embeddedFiles(pdfWith(xml));
    expect(createHash("sha256").update(attached ?? new Uint8Array()).digest("hex")).toBe(createHash("sha256").update(xml).digest("hex"));
    expect(embeddedFiles(bytes("%PDF-1.4\n1 0 obj\n<</Type/Catalog>>\nendobj\n%%EOF"))).toEqual([]);
  });
});

describe("a DUKIntegrator kit", () => {
  const VERSIONS = `<versiuni><integrator><iJars><jarURL>http://static.anaf.ro/static/10/Anaf/update5/ii/iText-5.0.4.jar</jarURL></iJars>
<sJars><jarURL>http://static.anaf.ro/static/10/Anaf/update5/ss8/DecValidation.jar</jarURL></sJars>
<zJars><jarURL>http://static.anaf.ro/static/10/Anaf/update5/zz9/DUKIntegrator.jar</jarURL><jarURL>http://static.anaf.ro/static/10/Anaf/update5/zz9/ajutor.chm</jarURL></zJars></integrator></versiuni>`;

  it("is built once from ANAF's current common jars, its config and the year's own jars, with every source and hash recorded", async () => {
    const asked: string[] = [];
    const files: Record<string, Uint8Array> = {
      "https://static.anaf.ro/static/10/Anaf/update5/versiuni.xml": bytes(VERSIONS),
      "https://static.anaf.ro/static/10/Anaf/update5/ii/iText-5.0.4.jar": bytes("itext"),
      "https://static.anaf.ro/static/10/Anaf/update5/ss8/DecValidation.jar": bytes("decvalidation"),
      "https://static.anaf.ro/static/10/Anaf/update5/zz9/DUKIntegrator.jar": bytes("integrator"),
      "https://static.anaf.ro/static/10/Anaf/update5/cc2/config.properties": bytes("proxy=auto\n"),
      "https://static.anaf.ro/static/10/Anaf/Declaratii_R/AplicatiiDec/D212_20231002.zip": zipOf({ "D212/D212Validator.jar": bytes("v2023"), "D212/D212Pdf.jar": bytes("p2023") }),
    };
    const fetch = (async (input: Parameters<typeof globalThis.fetch>[0]) => {
      asked.push(String(input));
      const body = files[String(input)];
      return body === undefined ? new Response("no", { status: 404 }) : new Response(body, { status: 200 });
    }) as typeof globalThis.fetch;
    const http = makeHttp({ service: "test", isRetryable: () => false, fail: (f) => { throw f; }, fetch });
    const root = mkdtempSync(join(tmpdir(), "anaf-spv-duk-"));
    const kits = makeKits(root, http, () => Date.UTC(2026, 9, 18));
    const source = kitFor("D212", { year: 2023, month: 12 });
    const [a, b] = await Promise.all([kits.kit("D212", source), kits.kit("D212", source)]);
    expect(a).toEqual(b);
    expect(a.files.map((f) => f.file).sort()).toEqual(["DUKIntegrator.jar", "config/config.properties", "lib/D212Pdf.jar", "lib/D212Validator.jar", "lib/DecValidation.jar", "lib/iText-5.0.4.jar"]);
    expect(a.files.find((f) => f.file === "lib/D212Validator.jar")?.source).toContain("D212_20231002.zip!D212/D212Validator.jar");
    expect(readFileSync(join(root, "D212-D212_20231002", "lib", "D212Validator.jar"), "utf8")).toBe("v2023");
    expect(asked.filter((u) => u.endsWith("versiuni.xml"))).toHaveLength(1);
    expect(asked.some((u) => u.endsWith("ajutor.chm"))).toBe(false);
    await kits.kit("D212", source);
    expect(asked.filter((u) => u.endsWith("versiuni.xml"))).toHaveLength(1);
    expect(existsSync(join(root, "D212-D212_20231002", "kit.json"))).toBe(true);
  });
});

describe("formularespv-pf's page", () => {
  const BASE = new URL("https://formularespv-pf.anaf.ro/SNMD/d212/d212.xhtml");
  const PAGE = `<p>Dacă depunerea se face cu succes, pe ecran se va afişa textul: "Fişierul transmis de dumneavoastră a fost preluat şi a primit indexul de depunere XXXXXXX."</p>
<form id="form2" name="form2" method="post" action="/SNMD/d212/d212.xhtml" enctype="multipart/form-data"><input id="form2:j_1" name="form2:j_1" type="file" />
<input name="form2:j_2" type="submit" value="Transmitere formular" /><input type="hidden" name="form2_SUBMIT" value="1" /><input type="hidden" name="javax.faces.ViewState" value="vs" /></form>`;

  it("reads the file input, the button and the hidden fields, and the index only as digits", () => {
    expect(uploadPageIn(PAGE, BASE)).toEqual({
      action: "/SNMD/d212/d212.xhtml",
      fileField: "form2:j_1",
      submit: ["form2:j_2", "Transmitere formular"],
      hidden: [
        ["form2_SUBMIT", "1"],
        ["javax.faces.ViewState", "vs"],
      ],
    });
    expect(filingIndexIn(PAGE)).toBeUndefined();
    expect(filingIndexIn(`${PAGE}<p>Fisierul transmis de dumneavoastra a fost preluat si a primit indexul de depunere: 16000001. Veti primi un mesaj</p>`)).toBe("16000001");
  });
});

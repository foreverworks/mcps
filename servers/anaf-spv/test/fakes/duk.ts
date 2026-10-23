/**
 * A fake DUKIntegrator and the documents it deals in: a D212 XML with
 * invented data, and a PDF carrying an embedded file the way DUKIntegrator's
 * PDF step writes it (iText: a FlateDecode stream whose /Length is an
 * indirect object).
 */
import { deflateSync } from "node:zlib";

import type { DukPort, DukResult } from "../../src/app/ports.js";
import type { FormName } from "../../src/domain/declarations.js";
import { CNP } from "./spv.js";

export const d212 = (year = 2025, cif = CNP) =>
  new TextEncoder().encode(
    `<?xml version="1.0" encoding="UTF-8"?>\n<!-- invented -->\n<d212 xmlns="mfp:anaf:dgti:d212:declaratie:v8" luna_r="12" an_r="${year}" rectif1="0" cif="${cif}" nume_c="POPESCU ANA">\n<cap14 tara="IT"/>\n</d212>\n`,
  );

/** A PDF whose one attachment is `attached`, named as DUKIntegrator names it. */
export const pdfWith = (attached: Uint8Array, name = "D212.xml"): Uint8Array => {
  const stream = deflateSync(attached);
  const head = Buffer.from(
    `%PDF-1.4\n%âãÏÓ\n1 0 obj\n<</Type/Catalog/Names<</EmbeddedFiles 3 0 R>>>>\nendobj\n` +
      `2 0 obj\n${stream.length}\nendobj\n` +
      `3 0 obj\n<</Names[(${name}) 4 0 R]>>\nendobj\n` +
      `4 0 obj\n<</Type/Filespec/F(${name})/EF<</F 5 0 R>>>>\nendobj\n` +
      `5 0 obj\n<</Type/EmbeddedFile/Length 2 0 R/Filter/FlateDecode/Params<</Size ${attached.length}>>>>stream\n`,
    "latin1",
  );
  return new Uint8Array(Buffer.concat([head, stream, Buffer.from("\nendstream\nendobj\ntrailer\n<</Root 1 0 R>>\n%%EOF\n", "latin1")]));
};

const kitOf = (form: FormName, zip: string) => ({ form, zip, builtAt: "2026-10-12T12:00:00.000Z", files: [{ file: `lib/${form}Validator.jar`, source: `https://static.anaf.ro/test/${zip}`, sha256: "0".repeat(64) }] });

/** A DUKIntegrator that says what a test tells it to, and records what it was asked. */
export const fakeDuk = (behave: { valid?: boolean; errors?: string; carry?: (xml: Uint8Array) => Uint8Array } = {}) => {
  const runs: { form: string; zip: string; pdf: boolean }[] = [];
  const port: DukPort = {
    run: async ({ form, kit, xml, pdf }): Promise<DukResult> => {
      runs.push({ form, zip: kit.zip, pdf });
      const valid = behave.valid ?? true;
      const output = valid ? `1.\nValidare fara erori fisier: ${form}.xml` : `1.\nErori la validare fisier: ${form}.xml`;
      const base = { valid, output, errors: valid ? "ok" : (behave.errors ?? "F: eroare"), kit: kitOf(form, kit.zip) };
      return valid && pdf ? { ...base, pdf: pdfWith((behave.carry ?? ((x) => x))(xml), `${form}.xml`) } : base;
    },
  };
  return { port, runs };
};

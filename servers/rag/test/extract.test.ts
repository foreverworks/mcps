/**
 * The extractors against real tools, on small invented fixtures. Each test is
 * skipped where its tool is not installed (a CI runner has none of them).
 */
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { kindOf } from "../src/domain/kinds.js";
import { normaliseText } from "../src/domain/text.js";
import { makeExtractor } from "../src/infra/extract.js";

const has = (tool: string, flag = "--version"): boolean => {
  try {
    execFileSync(tool, [flag], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

const extractor = makeExtractor();
const fixture = async (name: string) => {
  const kind = kindOf(name);
  if (kind === undefined) throw new Error(`no kind for ${name}`);
  return { name, bytes: await readFile(join(import.meta.dirname, "fixtures", name)), kind };
};

describe("extract", () => {
  it.skipIf(!has("pdftotext", "-v"))("reads a PDF's text layer page by page", async () => {
    const out = await extractor.extract(await fixture("text.pdf"), { language: "eng", ocr: false });
    expect(out.pages).toBe(1);
    expect(out.sections[0]?.location).toBe("page 1");
    expect(out.sections[0]?.text).toContain("The lamp is lit at dusk");
  });

  it.skipIf(!has("pdftotext", "-v") || !has("ocrmypdf") || !has("tesseract"))("OCRs a page that has no text layer, in Romanian", async () => {
    const out = await extractor.extract(await fixture("scan.pdf"), { language: "ron", ocr: true });
    expect(out.ocrPages).toBe(1);
    const text = normaliseText(out.sections.map((s) => s.text).join("\n"), "ron");
    expect(text).toContain("dimineața devreme");
    expect(text).toContain("Țânțarii nu supraviețuiesc");
  }, 120_000);

  it.skipIf(!has("pdftotext", "-v"))("says so when OCR is off and a page has no text", async () => {
    const out = await extractor.extract(await fixture("scan.pdf"), { language: "ron", ocr: false });
    expect(out.sections).toEqual([]);
    expect(out.warnings[0]).toContain("not OCRed");
  });

  it.skipIf(!has("pandoc"))("reads a .docx through pandoc with its headings as locations", async () => {
    const out = await extractor.extract(await fixture("notes.docx"), { language: "eng", ocr: true });
    expect(out.sections).toEqual([
      { location: "Bees", text: "A hive keeps one queen." },
      { location: "Bees > Winter", text: "The colony clusters to stay warm." },
    ]);
  });

  it("reads Markdown and text without a tool, and flags bytes that are not UTF-8", async () => {
    const md = await extractor.extract({ name: "a.md", bytes: Buffer.from("# T\n\nBody."), kind: { kind: "markdown" } }, { language: "eng", ocr: true });
    expect(md.sections).toEqual([{ location: "T", text: "Body." }]);
    const latin = await extractor.extract({ name: "a.txt", bytes: Buffer.from([0x63, 0x61, 0x66, 0xe9]), kind: { kind: "text" } }, { language: "eng", ocr: true });
    expect(latin.warnings[0]).toContain("not UTF-8");
  });
});

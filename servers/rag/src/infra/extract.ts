import { run, type RunResult } from "@foreverworks/mcp-kit";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";

import type { Extracted, Extractor } from "../app/ports.js";
import { sectionsFromMarkdown, sectionsFromPages } from "../domain/chunk.js";
import { fail } from "../domain/errors.js";
import { visibleLength } from "../domain/text.js";
import { sidecarPages } from "./extract/sidecar.js";

/**
 * Text out of a file with the tools a Debian box has: poppler's pdftotext,
 * ocrmypdf (tesseract underneath) for pages with no text layer, tesseract for
 * images, pandoc for documents. The bytes are written to a private temporary
 * folder first, so a tool never opens the caller's path: what is read is what
 * the kit's reader checked.
 */

/** A page with fewer visible characters than this has no text layer worth keeping, and is OCRed. */
const MIN_PAGE_TEXT = 20;

/** Each tool runs alone in the environment it needs: one OCR thread, a home of its own. */
const childEnv = (dir: string): NodeJS.ProcessEnv => ({
  PATH: process.env["PATH"] ?? "/usr/local/bin:/usr/bin:/bin",
  LANG: "C.UTF-8",
  HOME: dir,
  TMPDIR: dir,
  OMP_THREAD_LIMIT: "1",
});

const ensure = (tool: string, result: RunResult): string => {
  if (result.code === 127) return fail({ kind: "extract", tool, message: `${tool} is not installed (${result.stderr.trim() || "not on PATH"})` });
  if (result.code !== 0) return fail({ kind: "extract", tool, message: `${tool} exited ${result.code}: ${result.stderr.trim().slice(-400)}` });
  return result.stdout;
};

/** pdftotext separates pages with a form feed, and ends the last page with one. */
const pagesOf = (text: string): string[] => {
  const pages = text.split("\f");
  if (pages.length > 1 && (pages.at(-1) ?? "").trim() === "") pages.pop();
  return pages;
};

const readPdf = async (dir: string, file: string, language: string, ocr: boolean): Promise<Extracted> => {
  const env = childEnv(dir);
  const pages = pagesOf(ensure("pdftotext", await run(["pdftotext", "-enc", "UTF-8", file, "-"], { timeoutMs: 120_000, env, maxBytes: 64 * 1024 * 1024 })));
  const blank = pages.flatMap((p, i) => (visibleLength(p) < MIN_PAGE_TEXT ? [i] : []));
  if (blank.length === 0 || !ocr) {
    const warnings = blank.length > 0 ? [`${blank.length} page(s) without a text layer were not OCRed (ocr: false)`] : [];
    return { sections: sectionsFromPages(pages), pages: pages.length, ocrPages: 0, warnings };
  }
  // --skip-text leaves every page that has text alone; --output-type pdf skips the PDF/A conversion,
  // which only costs time here. One job: the service shares its CPU and memory with others.
  const out = join(dir, "ocr.pdf");
  const side = join(dir, "ocr.txt");
  const ocrd = await run(["ocrmypdf", "--skip-text", "--output-type", "pdf", "--jobs", "1", "--quiet", "--sidecar", side, "-l", language, file, out], {
    timeoutMs: Math.min(3_600_000, 120_000 + 60_000 * blank.length),
    env,
  });
  if (ocrd.code !== 0) {
    const why = ocrd.code === 127 ? "ocrmypdf is not installed" : `ocrmypdf exited ${ocrd.code}: ${ocrd.stderr.trim().slice(-300)}`;
    return { sections: sectionsFromPages(pages), pages: pages.length, ocrPages: 0, warnings: [`${blank.length} page(s) without text were not OCRed: ${why}`] };
  }
  // Tesseract's own text (extract/sidecar.ts says why); pdftotext of the OCRed PDF only for a page it lacks.
  const read = sidecarPages(await readFile(side, "utf8").catch(() => ""));
  const missing = blank.some((i) => !read.has(i + 1));
  const after = missing ? pagesOf(ensure("pdftotext", await run(["pdftotext", "-enc", "UTF-8", out, "-"], { timeoutMs: 120_000, env, maxBytes: 64 * 1024 * 1024 }))) : [];
  const ocrText = (i: number): string => read.get(i + 1) ?? after[i] ?? "";
  const merged = pages.map((p, i) => (blank.includes(i) ? ocrText(i) : p));
  const ocrPages = blank.filter((i) => visibleLength(ocrText(i)) >= MIN_PAGE_TEXT).length;
  const still = blank.length - ocrPages;
  return { sections: sectionsFromPages(merged), pages: pages.length, ocrPages, warnings: still > 0 ? [`${still} page(s) have no text even after OCR`] : [] };
};

const readImage = async (dir: string, file: string, language: string): Promise<Extracted> => {
  const text = ensure("tesseract", await run(["tesseract", file, "stdout", "-l", language], { timeoutMs: 300_000, env: childEnv(dir) }));
  return { sections: sectionsFromPages([text]), pages: 1, ocrPages: 1, warnings: visibleLength(text) < MIN_PAGE_TEXT ? ["OCR found almost no text in the image"] : [] };
};

/** GitHub-flavoured Markdown keeps the headings, which become each chunk's location. Images are dropped. */
const readPandoc = async (dir: string, file: string, from: string): Promise<Extracted> => {
  const markdown = ensure("pandoc", await run(["pandoc", `--from=${from}`, "--to=gfm", "--wrap=none", file], { timeoutMs: 300_000, env: childEnv(dir), maxBytes: 64 * 1024 * 1024 }));
  return { sections: sectionsFromMarkdown(markdown.replace(/!\[[^\]]*\]\([^)]*\)/gu, "")), warnings: [] };
};

const decode = (bytes: Buffer): { readonly text: string; readonly warnings: readonly string[] } => {
  const text = bytes.toString("utf8").replace(/^﻿/u, "");
  const bad = (text.match(/�/gu) ?? []).length;
  return { text, warnings: bad > 0 ? [`${bad} byte sequence(s) are not UTF-8 and were replaced; convert the file to UTF-8 and index it again`] : [] };
};

/** `tool --version` (or `-v`), first line; or why it could not be run. */
const versionOf = async (argv: readonly string[]): Promise<string> => {
  const r = await run(argv, { timeoutMs: 15_000 });
  if (r.code === 127) return `missing (${argv[0]} is not on PATH)`;
  const line = `${r.stdout}\n${r.stderr}`.split("\n").map((l) => l.trim()).find((l) => /\d+\.\d+/u.test(l));
  return line ?? `unknown (exit ${r.code})`;
};

export const makeExtractor = (): Extractor => ({
  extract: async (file, options) => {
    if (file.kind.kind === "markdown") {
      const { text, warnings } = decode(file.bytes);
      return { sections: sectionsFromMarkdown(text), warnings };
    }
    if (file.kind.kind === "text") {
      const { text, warnings } = decode(file.bytes);
      return { sections: text.trim().length === 0 ? [] : [{ location: "", text }], warnings };
    }
    const dir = await mkdtemp(join(tmpdir(), "rag-"));
    try {
      const path = join(dir, `in${extname(file.name).toLowerCase()}`);
      await writeFile(path, file.bytes, { mode: 0o600 });
      switch (file.kind.kind) {
        case "pdf":
          return await readPdf(dir, path, options.language, options.ocr);
        case "image":
          return await readImage(dir, path, options.language);
        case "pandoc":
          return await readPandoc(dir, path, file.kind.from);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
  tools: async () => {
    const [pdftotext, ocrmypdf, tesseract, pandoc, langs] = await Promise.all([
      versionOf(["pdftotext", "-v"]),
      versionOf(["ocrmypdf", "--version"]),
      versionOf(["tesseract", "--version"]),
      versionOf(["pandoc", "--version"]),
      run(["tesseract", "--list-langs"], { timeoutMs: 15_000 }),
    ]);
    const languages = langs.code === 0 ? `${langs.stdout}`.split("\n").slice(1).map((l) => l.trim()).filter((l) => l.length > 0).join(", ") : undefined;
    return { pdftotext, ocrmypdf, tesseract, pandoc, ...(languages === undefined ? {} : { tesseract_languages: languages }) };
  },
});

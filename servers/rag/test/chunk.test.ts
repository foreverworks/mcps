import { describe, expect, it } from "vitest";

import { chunkDocument, chunkId, sectionsFromMarkdown, sectionsFromPages } from "../src/domain/chunk.js";

const para = (word: string, n: number): string => Array.from({ length: n }, (_, i) => `${word}${i}`).join(" ") + ".";

describe("chunkDocument", () => {
  it("packs paragraphs up to the limit and never crosses a section", () => {
    const sections = [
      { location: "page 1", text: `${para("a", 60)}\n\n${para("b", 60)}\n\n${para("c", 60)}` },
      { location: "page 2", text: para("d", 10) },
    ];
    const chunks = chunkDocument("/srv/docs/x.pdf", sections, { maxChars: 400, minChars: 50 });
    expect(chunks.every((c) => c.body.length <= 400)).toBe(true);
    expect(chunks.map((c) => c.location)).toEqual(["page 1", "page 1", "page 1", "page 2"]);
    expect(chunks.map((c) => c.ordinal)).toEqual([0, 1, 2, 3]);
    expect(chunks[3]?.body).toBe(para("d", 10));
  });

  it("cuts a long paragraph at sentence ends, and a long sentence at spaces", () => {
    const long = Array.from({ length: 12 }, (_, i) => `Sentence number ${i} says something useful here.`).join(" ");
    const chunks = chunkDocument("/s", [{ location: "", text: long + " " + para("w", 200) }], { maxChars: 300, minChars: 10 });
    expect(chunks.every((c) => c.body.length <= 300)).toBe(true);
    expect(chunks[0]?.body.startsWith("Sentence number 0")).toBe(true);
    expect(chunks.map((c) => c.body).join(" ").replace(/\s+/g, " ")).toBe((long + " " + para("w", 200)).replace(/\s+/g, " "));
  });

  it("joins a short tail to the chunk before it when both fit", () => {
    const chunks = chunkDocument("/s", [{ location: "", text: `${para("a", 40)}\n\nShort tail.` }], { maxChars: 1200, minChars: 200 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.body.endsWith("Short tail.")).toBe(true);
  });

  it("gives the same text at the same place the same id on every run, and a repeat an id of its own", () => {
    const sections = [{ location: "page 1", text: "Footer text.\n\n" + para("x", 300) + "\n\nFooter text." }];
    const a = chunkDocument("/srv/a.pdf", sections, { maxChars: 500, minChars: 1 });
    const b = chunkDocument("/srv/a.pdf", sections, { maxChars: 500, minChars: 1 });
    expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id));
    expect(new Set(a.map((c) => c.id)).size).toBe(a.length);
    expect(chunkDocument("/srv/b.pdf", sections, { maxChars: 500, minChars: 1 })[0]?.id).not.toBe(a[0]?.id);
    expect(chunkId("/s", "page 1", "x", 0)).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("sections", () => {
  it("cuts Markdown at its headings and names each section by the trail above it", () => {
    const md = "Intro line.\n\n# Contract\n\nTerms.\n\n## Termination\n\nNotice of 30 days.\n\n```\n# not a heading\n```\n\n# Annex\n\nTable.";
    expect(sectionsFromMarkdown(md)).toEqual([
      { location: "", text: "Intro line." },
      { location: "Contract", text: "Terms." },
      { location: "Contract > Termination", text: "Notice of 30 days.\n\n```\n# not a heading\n```" },
      { location: "Annex", text: "Table." },
    ]);
  });

  it("numbers pages from 1 and keeps a blank page's number by skipping it", () => {
    expect(sectionsFromPages(["one", "  ", "three"])).toEqual([
      { location: "page 1", text: "one" },
      { location: "page 3", text: "three" },
    ]);
  });
});

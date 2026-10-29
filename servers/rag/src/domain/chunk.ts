import { sha256Of } from "@foreverworks/mcp-kit";

/**
 * A document as its extractor reads it: sections that each carry where they
 * are (a page, a heading), in reading order. Chunks never cross a section, so
 * every chunk's location is exact.
 */
export type Section = { readonly location: string; readonly text: string };

export type Chunk = {
  /** Stable: the same text at the same place in the same source has the same id on every run. */
  readonly id: string;
  /** 0-based position in the document, for reading the chunks around a hit. */
  readonly ordinal: number;
  readonly location: string;
  readonly body: string;
};

export type ChunkLimits = {
  /** A chunk is at most this many characters; a longer word is cut. */
  readonly maxChars: number;
  /** A last piece shorter than this joins the previous chunk of its section when both fit. */
  readonly minChars: number;
};

/**
 * ~1200 characters is ~350 tokens of Romanian or English for an XLM-RoBERTa
 * tokenizer (bge-m3's): long enough to hold a clause with its context, short
 * enough that a reranker reads 20 candidates in seconds on a CPU.
 */
export const DEFAULT_LIMITS: ChunkLimits = { maxChars: 1200, minChars: 200 };

/** Sentence ends: a full stop, question or exclamation mark, or an ellipsis, then white space. */
const SENTENCE_END = /(?<=[.!?…])\s+/u;

/** A word longer than max, cut into pieces of max characters (code points, so no surrogate pair is split). */
const cutWord = (word: string, max: number): string[] => {
  if (word.length <= max) return [word];
  const points = Array.from(word);
  return Array.from({ length: Math.ceil(points.length / max) }, (_, i) => points.slice(i * max, (i + 1) * max).join(""));
};

/**
 * Splits text longer than max at white space, and a word longer than max into
 * pieces: one minified line or base64 blob would otherwise be one chunk of any
 * size, past what an embedding request takes.
 */
const hardSplit = (text: string, max: number): string[] => {
  const out: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/u).flatMap((w) => (w.length > 0 ? cutWord(w, max) : []))) {
    if (current.length > 0 && current.length + 1 + word.length > max) {
      out.push(current);
      current = word;
    } else current = current.length === 0 ? word : `${current} ${word}`;
  }
  if (current.length > 0) out.push(current);
  return out;
};

/** A paragraph cut into pieces that each fit: by sentence first, by word when a sentence does not fit. */
const piecesOf = (paragraph: string, max: number): string[] =>
  paragraph.length <= max ? [paragraph] : paragraph.split(SENTENCE_END).flatMap((sentence) => (sentence.length <= max ? [sentence] : hardSplit(sentence, max)));

/** Packs the pieces of one section into chunks no longer than max, joining pieces of one paragraph with a space. */
const pack = (text: string, limits: ChunkLimits): string[] => {
  const paragraphs = text
    .split(/\n\s*\n/u)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    for (const [i, piece] of piecesOf(paragraph, limits.maxChars).entries()) {
      const joiner = current.length === 0 ? "" : i === 0 ? "\n\n" : " ";
      if (current.length > 0 && current.length + joiner.length + piece.length > limits.maxChars) {
        chunks.push(current);
        current = piece;
      } else current = `${current}${joiner}${piece}`;
    }
  }
  if (current.length > 0) {
    const last = chunks.at(-1);
    if (last !== undefined && current.length < limits.minChars && last.length + 2 + current.length <= limits.maxChars) chunks[chunks.length - 1] = `${last}\n\n${current}`;
    else chunks.push(current);
  }
  return chunks;
};

/**
 * The id hashes the source, the location and the text, plus how many times
 * that same text already occurred at that place, so a repeated paragraph (a
 * page footer) still has an id of its own.
 */
export const chunkId = (source: string, location: string, body: string, repeat: number): string =>
  sha256Of(Buffer.from(`${source}\n${location}\n${repeat}\n${body}`, "utf8")).slice(0, 32);

export const chunkDocument = (source: string, sections: readonly Section[], limits: ChunkLimits = DEFAULT_LIMITS): readonly Chunk[] => {
  const seen = new Map<string, number>();
  const out: Chunk[] = [];
  for (const section of sections) {
    for (const body of pack(section.text, limits)) {
      const key = `${section.location}\n${body}`;
      const repeat = seen.get(key) ?? 0;
      seen.set(key, repeat + 1);
      out.push({ id: chunkId(source, section.location, body, repeat), ordinal: out.length, location: section.location, body });
    }
  }
  return out;
};

/**
 * Markdown (what pandoc writes for docx, odt, html and epub, and .md itself)
 * cut at its headings: each section's location is the trail of headings above
 * it ("Contract > Termination"). Text before the first heading has none.
 */
export const sectionsFromMarkdown = (markdown: string): readonly Section[] => {
  const sections: Section[] = [];
  const trail: string[] = [];
  let lines: string[] = [];
  let inFence = false;
  const flush = () => {
    const text = lines.join("\n").trim();
    if (text.length > 0) sections.push({ location: trail.filter((t) => t.length > 0).join(" > "), text });
    lines = [];
  };
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/u.test(line)) inFence = !inFence;
    const heading = inFence ? null : /^(#{1,6})\s+(.*?)\s*#*\s*$/u.exec(line);
    if (heading === null) {
      lines.push(line);
      continue;
    }
    flush();
    const level = heading[1]?.length ?? 1;
    trail.length = level - 1;
    while (trail.length < level - 1) trail.push("");
    trail.push((heading[2] ?? "").replace(/[*_`]/g, "").trim());
  }
  flush();
  return sections;
};

/** One section per page, numbered from 1; a page with no text keeps its number by being skipped, not shifted. */
export const sectionsFromPages = (pages: readonly string[]): readonly Section[] =>
  pages.flatMap((text, i) => (text.trim().length === 0 ? [] : [{ location: `page ${i + 1}`, text }]));

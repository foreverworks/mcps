import { fail, inputError } from "./errors.js";
import type { RawDocumentTab, RawElement } from "./schema.js";
import { OBJECT_MARK } from "./structure.js";

/**
 * Where a piece of text is, as the ranges a request takes. Pure.
 *
 * What counts as a match is a Matcher: the literal one is here; a pattern runs
 * under a time limit in the app layer (app/patterns.ts), because the search
 * runs in the process every session shares and a pattern that backtracks would
 * stall all of them. A match never crosses a paragraph's end, because the
 * newline between two paragraphs is not a space a reader sees.
 */

/** Every match in each text, as [offset, length], for all the texts at once. */
export type Matcher = (texts: readonly string[]) => readonly (readonly (readonly [number, number])[])[];

type Paragraph = {
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly style?: string;
  readonly inTable: boolean;
};

const paragraphsIn = (content: readonly RawElement[], inTable: boolean): readonly Paragraph[] =>
  content.flatMap((element): readonly Paragraph[] => {
    if (element.paragraph) {
      const named = element.paragraph.paragraphStyle?.namedStyleType;
      const text = (element.paragraph.elements ?? [])
        .map((e) => (e.textRun ? (e.textRun.content ?? "") : OBJECT_MARK.repeat(Math.max(0, (e.endIndex ?? 0) - (e.startIndex ?? 0)))))
        .join("")
        .replace(/\n$/, "");
      return [{ start: element.startIndex ?? 0, end: element.endIndex ?? 0, text, ...(named && named !== "NORMAL_TEXT" ? { style: named } : {}), inTable }];
    }
    if (element.table) return (element.table.tableRows ?? []).flatMap((r) => (r.tableCells ?? []).flatMap((c) => paragraphsIn(c.content ?? [], true)));
    if (element.tableOfContents) return paragraphsIn(element.tableOfContents.content ?? [], inTable);
    return [];
  });

export type Match = {
  readonly range: readonly [number, number];
  readonly text: string;
  /** The paragraph it is in: its range and named style. */
  readonly paragraph: { readonly range: readonly [number, number]; readonly style?: string; readonly inTable?: true };
  /** Absent in the body; a header's, footer's or footnote's id otherwise, for the request's segmentId. */
  readonly segmentId?: string;
};

export type FindOptions = {
  /** "body", or "all" for the body, every header, footer and footnote. */
  readonly segments: "body" | "all";
  readonly limit: number;
};

const WORD = /[\p{L}\p{N}_]/u;

/**
 * Lower case that keeps every character's length: "İ" lowers to two code
 * units, which would shift every index after it, so such a character is
 * compared as it is.
 */
const fold = (text: string): string => {
  const lower = text.toLowerCase();
  if (lower.length === text.length) return lower;
  return [...text].map((ch) => (ch.toLowerCase().length === ch.length ? ch.toLowerCase() : ch)).join("");
};

const isWholeWord = (text: string, at: number, length: number): boolean =>
  !WORD.test(text[at - 1] ?? " ") && !WORD.test(text[at + length] ?? " ");

const segmentsOf = (tab: RawDocumentTab, which: FindOptions["segments"]) => {
  const body = [{ segmentId: undefined, content: tab.body?.content ?? [] }];
  if (which === "body") return body;
  const others = [tab.headers, tab.footers, tab.footnotes].flatMap((group) =>
    Object.entries(group ?? {}).map(([segmentId, segment]) => ({ segmentId, content: segment.content ?? [] })),
  );
  return [...body, ...others];
};

/** Literal text, by case or not, as a whole word or anywhere. */
export const literalMatcher =
  (query: string, options: { readonly matchCase: boolean; readonly wholeWord: boolean }): Matcher =>
  (texts) => {
    if (query.includes("\n")) return fail(inputError("a match never crosses a paragraph's end; search for the text of one paragraph at a time"));
    const needle = options.matchCase ? query : fold(query);
    return texts.map((text) => {
      const hay = options.matchCase ? text : fold(text);
      const found: (readonly [number, number])[] = [];
      for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + Math.max(1, needle.length))) {
        if (!options.wholeWord || isWholeWord(text, at, needle.length)) found.push([at, needle.length]);
      }
      return found;
    });
  };

export const findText = (tab: RawDocumentTab, match: Matcher, options: FindOptions): { readonly matches: readonly Match[]; readonly total: number } => {
  const paragraphs = segmentsOf(tab, options.segments).flatMap(({ segmentId, content }) => paragraphsIn(content, false).map((p) => ({ p, segmentId })));
  const found = match(paragraphs.map(({ p }) => p.text));
  const matches: Match[] = [];
  let total = 0;
  paragraphs.forEach(({ p, segmentId }, n) => {
    for (const [at, length] of found[n] ?? []) {
      total += 1;
      if (matches.length >= options.limit) continue;
      matches.push({
        range: [p.start + at, p.start + at + length],
        text: p.text.slice(at, at + length),
        paragraph: { range: [p.start, p.end], ...(p.style ? { style: p.style } : {}), ...(p.inTable ? { inTable: true as const } : {}) },
        ...(segmentId ? { segmentId } : {}),
      });
    }
  });
  return { matches, total };
};

import { type Block, type Cell, type Inline, MAX_HEADING } from "../blocks.js";
import type { DocsRequest, RawTextStyleOut } from "../schema.js";

/**
 * Blocks to Docs batchUpdate requests, inserted at one index. Pure arithmetic.
 *
 * The requests run in order, each against the document as the ones before it
 * left it, so every index below is computed for the moment its request runs.
 * Three rules keep that tractable:
 *
 * 1. Segments go in LAST FIRST, every one at the same index. A segment
 *    inserted later lands in front of the earlier ones and pushes them right,
 *    but they were finished (inserted and styled) before it arrived, so nothing
 *    ever needs an index that has moved.
 * 2. Inside a segment: insert the text, reset the styles it inherited (Docs
 *    copies the paragraph style, bullets included, of the paragraph at the
 *    insertion point, and the text style of the text before it), then apply
 *    headings and runs, and create bullets LAST and back to front, because
 *    createParagraphBullets deletes the leading tabs that set each item's depth.
 * 3. A table is always preceded by a newline Docs inserts with it. The text
 *    before a table ends WITHOUT its own newline and takes that one over, so a
 *    table after a paragraph costs no empty line; the same trick takes over the
 *    document's final empty paragraph ("intoEmpty").
 *
 * Indices are UTF-16 code units, which is what String.length counts.
 */

/**
 * Where the content goes:
 *   before     at the start of an existing paragraph, which stays after it
 *   intoEmpty  at an empty paragraph (the body's last), which the content's
 *              last paragraph takes over instead of leaving a blank line behind
 */
export type Mode = "before" | "intoEmpty";

export const CODE_FONT = "Roboto Mono";

/**
 * What Docs would strip on insert, stripped first, so every index computed
 * from a string's length is the index Docs ends up with. Docs drops U+0000 to
 * U+0008, U+000C to U+001F (carriage returns among them) and the Private Use
 * Area; a newline inside a run would start a paragraph the model does not know
 * about, so it becomes a space.
 */
const sanitize = (text: string): string =>
  text.replace(/[\u0000-\u0008\u000c-\u001f\ue000-\uf8ff]/g, "").replace(/\n/g, " ");

const RESET_TEXT = "bold,italic,underline,strikethrough,smallCaps,backgroundColor,foregroundColor,fontSize,weightedFontFamily,baselineOffset,link";
const RESET_PARAGRAPH = "namedStyleType,alignment,indentStart,indentFirstLine,indentEnd,spaceAbove,spaceBelow,lineSpacing";

const PRESET = { ordered: "NUMBERED_DECIMAL_ALPHA_ROMAN", bullets: "BULLET_DISC_CIRCLE_SQUARE" } as const;

const span = (startIndex: number, endIndex: number) => ({ startIndex, endIndex });

export const insertText = (index: number, text: string): DocsRequest => ({ insertText: { location: { index }, text } });

export const deleteRange = (startIndex: number, endIndex: number): DocsRequest => ({
  deleteContentRange: { range: span(startIndex, endIndex) },
});

/** Everything a paragraph range may have inherited, set back to the NORMAL_TEXT style's own. */
const resetRange = (start: number, end: number): readonly DocsRequest[] => [
  { deleteParagraphBullets: { range: span(start, end) } },
  { updateParagraphStyle: { range: span(start, end), paragraphStyle: { namedStyleType: "NORMAL_TEXT" }, fields: RESET_PARAGRAPH } },
  { updateTextStyle: { range: span(start, end), textStyle: {}, fields: RESET_TEXT } },
];

const textStyleOf = (inline: Inline): { readonly style: RawTextStyleOut; readonly fields: string } | undefined => {
  const style: RawTextStyleOut = {
    ...(inline.bold ? { bold: true } : {}),
    ...(inline.italic ? { italic: true } : {}),
    ...(inline.strike ? { strikethrough: true } : {}),
    ...(inline.code ? { weightedFontFamily: { fontFamily: CODE_FONT } } : {}),
    ...(inline.link ? { link: { url: inline.link } } : {}),
  };
  const fields = Object.keys(style).join(",");
  return fields ? { style, fields } : undefined;
};

/** A paragraph as the text Docs will hold, and where each styled run starts in it. */
type Laid = {
  readonly text: string;
  readonly runs: readonly { readonly offset: number; readonly inline: Inline }[];
  readonly heading?: number;
  readonly item?: { readonly ordered: boolean; readonly depth: number };
};

const layRuns = (inlines: readonly Inline[], prefix: string): Laid => {
  const clean = inlines.map((i) => ({ ...i, text: sanitize(i.text) })).filter((i) => i.text.length > 0);
  const offsets = clean.reduce<readonly number[]>((acc, i) => [...acc, (acc[acc.length - 1] ?? prefix.length) + i.text.length], []);
  return {
    text: prefix + clean.map((i) => i.text).join(""),
    runs: clean.map((inline, n) => ({ offset: n === 0 ? prefix.length : (offsets[n - 1] as number), inline })),
  };
};

const lay = (block: Exclude<Block, { kind: "table" }>): Laid => {
  switch (block.kind) {
    case "heading":
      return { ...layRuns(block.inlines, ""), heading: Math.min(Math.max(block.level, 1), MAX_HEADING) };
    case "paragraph":
      return layRuns(block.inlines, "");
    case "item": {
      // Leading tabs in the item's own text would read as more depth.
      const [first, ...rest] = block.inlines;
      const inlines = first ? [{ ...first, text: first.text.replace(/^\t+/, "") }, ...rest] : [];
      return { ...layRuns(inlines, "\t".repeat(block.depth)), item: { ordered: block.ordered, depth: block.depth } };
    }
    case "code":
      return layRuns([{ text: block.text, code: true }], "");
  }
};

const styleRuns = (laid: Laid, start: number): readonly DocsRequest[] =>
  laid.runs.flatMap(({ offset, inline }) => {
    const styled = textStyleOf(inline);
    const from = start + offset;
    return styled ? [{ updateTextStyle: { range: span(from, from + inline.text.length), textStyle: styled.style, fields: styled.fields } }] : [];
  });

type Placed = Laid & { readonly start: number; readonly end: number };

/** Consecutive items as one list, split where the top level switches between numbers and bullets. */
const listGroups = (placed: readonly Placed[]): readonly (readonly Placed[])[] =>
  placed.reduce<readonly (readonly Placed[])[]>((groups, p, i) => {
    if (!p.item) return groups;
    const previous = placed[i - 1];
    const group = groups[groups.length - 1];
    const joins = previous?.item !== undefined && group !== undefined && !(p.item.depth === 0 && p.item.ordered !== group[0]?.item?.ordered);
    return joins ? [...groups.slice(0, -1), [...group, p]] : [...groups, [p]];
  }, []);

const textSegment = (blocks: readonly Exclude<Block, { kind: "table" }>[], at: number, merge: boolean): readonly DocsRequest[] => {
  const laid = blocks.map(lay);
  const placed = laid.reduce<readonly Placed[]>((acc, p) => {
    const start = acc[acc.length - 1]?.end ?? at;
    return [...acc, { ...p, start, end: start + p.text.length + 1 }];
  }, []);
  const full = laid.map((p) => `${p.text}\n`).join("");
  const text = merge ? full.slice(0, -1) : full;
  const end = at + full.length;

  return [
    ...(text ? [insertText(at, text)] : []),
    ...resetRange(at, end),
    ...placed.flatMap((p) =>
      p.heading === undefined
        ? []
        : [{ updateParagraphStyle: { range: span(p.start, p.end), paragraphStyle: { namedStyleType: `HEADING_${p.heading}` }, fields: "namedStyleType" } }],
    ),
    ...placed.flatMap((p) => styleRuns(p, p.start)),
    ...listGroups(placed)
      .slice()
      .reverse()
      .map((group) => ({
        createParagraphBullets: {
          range: span((group[0] as Placed).start, (group[group.length - 1] as Placed).end),
          bulletPreset: group[0]?.item?.ordered ? PRESET.ordered : PRESET.bullets,
        },
      })),
  ];
};

/**
 * Where cell (r, c)'s empty paragraph sits in a table just inserted with its
 * first index at `table`: the table opens with one index, each row with one,
 * each cell with one, and each empty cell holds a single newline.
 */
export const cellIndex = (table: number, columns: number, r: number, c: number): number => table + 3 + r * (2 * columns + 1) + 2 * c;

const cellText = (cell: Cell): Laid => {
  const paragraphs = cell.map((p) => layRuns(p, ""));
  const starts = paragraphs.reduce<readonly number[]>((acc, _, i) => [...acc, i === 0 ? 0 : (acc[i - 1] as number) + (paragraphs[i - 1] as Laid).text.length + 1], []);
  return {
    text: paragraphs.map((p) => p.text).join("\n"),
    runs: paragraphs.flatMap((p, i) => p.runs.map((r) => ({ offset: r.offset + (starts[i] as number), inline: r.inline }))),
  };
};

/**
 * A table: inserted empty, then filled cell by cell from the LAST cell back,
 * so each cell's index is still the empty table's when its text goes in. The
 * header row is bold, as a markdown renderer shows it.
 */
const tableSegment = (rows: readonly (readonly Cell[])[], at: number): readonly DocsRequest[] => {
  const columns = Math.max(1, ...rows.map((r) => r.length));
  const table = at + 1;
  const cells = rows.flatMap((row, r) => Array.from({ length: columns }, (_, c) => ({ r, c, laid: cellText(row[c] ?? []) })));
  return [
    { insertTable: { rows: rows.length, columns, location: { index: at } } },
    // The newline Docs put before the table copied the style of wherever it landed, a heading included.
    ...resetRange(at, at + 1),
    ...cells
      .slice()
      .reverse()
      .flatMap(({ r, c, laid }) => {
        const index = cellIndex(table, columns, r, c);
        const bold: readonly DocsRequest[] =
          r === 0 && laid.text ? [{ updateTextStyle: { range: span(index, index + laid.text.length), textStyle: { bold: true }, fields: "bold" } }] : [];
        return [...(laid.text ? [insertText(index, laid.text)] : []), ...resetRange(index, index + laid.text.length + 1), ...bold, ...styleRuns(laid, index)];
      }),
  ];
};

type Segment =
  | { readonly kind: "text"; readonly blocks: readonly Exclude<Block, { kind: "table" }>[] }
  | { readonly kind: "table"; readonly rows: readonly (readonly Cell[])[] };

const segmentsOf = (blocks: readonly Block[]): readonly Segment[] =>
  blocks.reduce<readonly Segment[]>((segments, block) => {
    if (block.kind === "table") return [...segments, { kind: "table", rows: block.rows }];
    const last = segments[segments.length - 1];
    return last?.kind === "text" ? [...segments.slice(0, -1), { kind: "text", blocks: [...last.blocks, block] }] : [...segments, { kind: "text", blocks: [block] }];
  }, []);

/** The requests that put `blocks` at index `at` (see Mode). */
export const insertBlocks = (blocks: readonly Block[], at: number, mode: Mode): readonly DocsRequest[] => {
  const segments = segmentsOf(blocks.filter((b) => b.kind !== "table" || b.rows.length > 0));
  return segments
    .map((segment, k) => ({ segment, k }))
    .reverse()
    .flatMap(({ segment, k }) => {
      if (segment.kind === "table") return tableSegment(segment.rows, at);
      const beforeTable = segments[k + 1]?.kind === "table";
      const last = k === segments.length - 1;
      return textSegment(segment.blocks, at, beforeTable || (last && mode === "intoEmpty"));
    });
};

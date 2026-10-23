import type { Block, Cell } from "../blocks.js";
import { LINE_BREAK } from "../blocks.js";
import { parseInline } from "./parseMarkdown/inline.js";

/**
 * Markdown to blocks: ATX headings, paragraphs, bullet and numbered lists
 * nested by indentation, fenced code, GFM tables, block quotes (as plain
 * paragraphs: Docs has no quote style) and thematic breaks (dropped: the Docs
 * API has no request that inserts a horizontal rule).
 */

const FENCE = /^\s{0,3}(`{3,}|~{3,})(.*)$/;
const HEADING = /^\s{0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])(?:[ \t]+(.*)|$)/;
const RULE = /^\s{0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^\s{0,3}>[ \t]?(.*)$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

const isBlank = (line: string): boolean => line.trim() === "";

/** A tab counts to the next multiple of four, as CommonMark has it. */
const indentOf = (whitespace: string): number =>
  [...whitespace].reduce((width, ch) => (ch === "\t" ? width + 4 - (width % 4) : width + 1), 0);

const splitRow = (line: string): readonly string[] => {
  const trimmed = line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "");
  const cells: string[] = [];
  let current = "";
  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i] as string;
    if (ch === "\\" && trimmed[i + 1] === "|") {
      current += "|";
      i += 1;
    } else if (ch === "|") {
      cells.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  return [...cells, current.trim()];
};

const cellOf = (text: string): Cell => text.split(/<br\s*\/?>/i).map((part) => parseInline(part.trim()));

const startsBlock = (line: string, next: string | undefined): boolean =>
  FENCE.test(line) ||
  HEADING.test(line) ||
  ITEM.test(line) ||
  RULE.test(line) ||
  QUOTE.test(line) ||
  (line.includes("|") && next !== undefined && TABLE_SEPARATOR.test(next) && next.includes("-"));

/** Lines of one paragraph, joined: a line ending in two spaces or a backslash is a hard break. */
const joinLines = (lines: readonly string[]): string =>
  lines
    .map((line, i) => {
      const last = i === lines.length - 1;
      const text = line.trim();
      if (last) return text.replace(/\\$/, "");
      if (/ {2,}$/.test(line) || text.endsWith("\\")) return text.replace(/\\$/, "") + LINE_BREAK;
      return `${text} `;
    })
    .join("");

type State = { readonly blocks: readonly Block[]; readonly at: number };

/**
 * One list, from its first item to the first line that is neither an item, a
 * continuation of one, nor a blank line followed by more of the list.
 *
 * Depth comes from indentation against a stack of the markers seen so far:
 * deeper than the innermost opens a level, shallower closes levels until one
 * fits. So two-space, three-space and four-space nesting all read the same.
 */
const readList = (lines: readonly string[], start: number): State => {
  const blocks: Block[] = [];
  const stack: number[] = [];
  let i = start;
  let current: { ordered: boolean; depth: number; text: string[] } | undefined;
  const close = (): void => {
    if (current) blocks.push({ kind: "item", ordered: current.ordered, depth: current.depth, inlines: parseInline(joinLines(current.text)) });
    current = undefined;
  };

  while (i < lines.length) {
    const line = lines[i] as string;
    const item = ITEM.exec(line);
    if (item && !RULE.test(line)) {
      close();
      const indent = indentOf(item[1] as string);
      while (stack.length > 0 && indent < (stack[stack.length - 1] as number)) stack.pop();
      if (stack.length === 0 || indent > (stack[stack.length - 1] as number)) stack.push(indent);
      current = { ordered: /\d/.test(item[2] as string), depth: stack.length - 1, text: [(item[3] ?? "").replace(/^\t+/, "")] };
      i += 1;
      continue;
    }
    if (isBlank(line)) {
      const next = lines.slice(i).findIndex((l) => !isBlank(l));
      const following = next === -1 ? undefined : lines[i + next];
      // A blank line keeps the list open only if the list goes on after it.
      if (following !== undefined && (ITEM.test(following) && !RULE.test(following))) {
        i += next;
        continue;
      }
      break;
    }
    // A continuation: indented under the item, or a lazy line that starts nothing else.
    if (current && (indentOf(/^\s*/.exec(line)?.[0] ?? "") > 0 || !startsBlock(line, lines[i + 1]))) {
      current.text.push(line);
      i += 1;
      continue;
    }
    break;
  }
  close();
  return { blocks, at: i };
};

const readTable = (lines: readonly string[], start: number): State => {
  const header = splitRow(lines[start] as string);
  const rows: (readonly string[])[] = [header];
  let i = start + 2;
  while (i < lines.length && !isBlank(lines[i] as string) && (lines[i] as string).includes("|")) {
    rows.push(splitRow(lines[i] as string));
    i += 1;
  }
  const width = header.length;
  const cells = rows.map((row) => Array.from({ length: width }, (_, c) => cellOf(row[c] ?? "")));
  return { blocks: [{ kind: "table", rows: cells }], at: i };
};

const readFence = (lines: readonly string[], start: number): State => {
  const open = FENCE.exec(lines[start] as string);
  const mark = (open?.[1] ?? "```") as string;
  const closing = new RegExp(`^\\s{0,3}${mark[0] === "`" ? "`" : "~"}{${mark.length},}\\s*$`);
  const end = lines.findIndex((line, j) => j > start && closing.test(line));
  const body = lines.slice(start + 1, end === -1 ? lines.length : end);
  return { blocks: body.map((text) => ({ kind: "code", text })), at: end === -1 ? lines.length : end + 1 };
};

const readParagraph = (lines: readonly string[], start: number, strip: RegExp | null): State => {
  const taken: string[] = [];
  let i = start;
  while (i < lines.length && !isBlank(lines[i] as string)) {
    const line = lines[i] as string;
    if (i > start && strip === null && startsBlock(line, lines[i + 1])) break;
    if (strip !== null) {
      const quoted = strip.exec(line);
      if (!quoted) break;
      taken.push(quoted[1] ?? "");
    } else {
      taken.push(line);
    }
    i += 1;
  }
  return { blocks: [{ kind: "paragraph", inlines: parseInline(joinLines(taken)) }], at: i };
};

const readBlock = (lines: readonly string[], i: number): State => {
  const line = lines[i] as string;
  const next = lines[i + 1];
  if (FENCE.test(line)) return readFence(lines, i);
  const heading = HEADING.exec(line);
  if (heading) {
    return { blocks: [{ kind: "heading", level: (heading[1] as string).length, inlines: parseInline(heading[2] ?? "") }], at: i + 1 };
  }
  if (RULE.test(line)) return { blocks: [], at: i + 1 };
  if (line.includes("|") && next !== undefined && TABLE_SEPARATOR.test(next) && next.includes("-")) return readTable(lines, i);
  if (ITEM.test(line)) return readList(lines, i);
  if (QUOTE.test(line)) return readParagraph(lines, i, QUOTE);
  return readParagraph(lines, i, null);
};

/** A markdown document as blocks. Blank lines separate; they are not content. */
export const parseMarkdown = (markdown: string): readonly Block[] => {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    if (isBlank(lines[i] as string)) {
      i += 1;
      continue;
    }
    const read = readBlock(lines, i);
    blocks.push(...read.blocks);
    i = read.at;
  }
  return blocks;
};

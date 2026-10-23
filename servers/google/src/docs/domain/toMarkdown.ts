import { type Block, type Cell, type Inline, LINE_BREAK } from "./blocks.js";

/**
 * Blocks to markdown, written so that parseMarkdown reads it back to the same
 * blocks: text is escaped wherever it would otherwise read as markup, and
 * nested list items are indented to their parent's content column.
 */

/** A block, and the Docs list it belongs to, which is what separates two adjacent lists. */
export type Positioned = { readonly block: Block; readonly listId?: string };

const escapeText = (text: string, inTable: boolean): string => {
  const escaped = text.replace(/[\\`*_[\]~<]/g, "\\$&");
  return (inTable ? escaped.replace(/\|/g, "\\|") : escaped).replace(new RegExp(LINE_BREAK, "g"), inTable ? "<br>" : "\\\n");
};

/** A line that would start a heading, a quote, a list or a table cell by accident, escaped. */
const escapeLineStart = (line: string): string =>
  line
    .replace(/^(\s*)([#>+-])(?=\s|$)/, "$1\\$2")
    .replace(/^(\s*)(#{2,6})(?=\s|$)/, "$1\\$2")
    .replace(/^(\s*)(\d+)([.)])(?=\s|$)/, "$1$2\\$3");

const codeSpan = (text: string): string => {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longest + 1);
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
};

/** Emphasis markers cannot touch whitespace, so leading and trailing spaces move outside them. */
const wrap = (inner: string, mark: string): string => {
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner);
  const [, lead = "", core = "", trail = ""] = match ?? [];
  return core ? `${lead}${mark}${core}${mark}${trail}` : inner;
};

const linkTarget = (url: string): string => (/[\s()<>]/.test(url) ? `<${url.replace(/[<>]/g, encodeURIComponent)}>` : url);

type Key = "link" | "bold" | "italic" | "strike";
const LAYERS: readonly Key[] = ["link", "bold", "italic", "strike"];

/** Consecutive runs sharing one value of `key`, so `**a *b***` comes out nested rather than as two adjacent spans. */
const groupBy = (inlines: readonly Inline[], key: Key): readonly (readonly Inline[])[] =>
  inlines.reduce<readonly (readonly Inline[])[]>((groups, inline) => {
    const last = groups[groups.length - 1];
    return last && last[0]?.[key] === inline[key] ? [...groups.slice(0, -1), [...last, inline]] : [...groups, [inline]];
  }, []);

const render = (inlines: readonly Inline[], layer: number, inTable: boolean): string => {
  const key = LAYERS[layer];
  if (key === undefined) return inlines.map((i) => (i.code ? codeSpan(i.text) : escapeText(i.text, inTable))).join("");
  return groupBy(inlines, key)
    .map((group) => {
      const inner = render(group, layer + 1, inTable);
      const value = group[0]?.[key];
      if (!value) return inner;
      if (key === "link") return `[${inner}](${linkTarget(value as string)})`;
      return wrap(inner, key === "bold" ? "**" : key === "italic" ? "*" : "~~");
    })
    .join("");
};

export const inlineMarkdown = (inlines: readonly Inline[], inTable = false): string => render(inlines, 0, inTable);

const tableMarkdown = (rows: readonly (readonly Cell[])[]): string => {
  const width = Math.max(1, ...rows.map((r) => r.length));
  const line = (cells: readonly Cell[]): string =>
    `| ${Array.from({ length: width }, (_, c) => (cells[c] ?? []).map((p) => inlineMarkdown(p, true)).join("<br>")).join(" | ")} |`;
  const [header = [], ...body] = rows;
  return [line(header), `|${" --- |".repeat(width)}`, ...body.map(line)].join("\n");
};

type ListState = {
  readonly listId: string | undefined;
  readonly counters: readonly number[];
  readonly widths: readonly number[];
  /** Whether the list's top level is numbered: a top-level item of the other kind starts a new list, as in toRequests. */
  readonly ordered: boolean;
};
const NO_LIST: ListState = { listId: undefined, counters: [], widths: [], ordered: false };

const continues = (state: ListState, block: Extract<Block, { kind: "item" }>, listId: string | undefined): boolean =>
  state.listId === listId && state.counters.length > 0 && !(block.depth === 0 && block.ordered !== state.ordered);

/**
 * One item line. Numbering is computed, not stored: Docs numbers a list
 * itself, and a markdown reader wants 1, 2, 3 rather than 1, 1, 1. A deeper
 * item is indented to the content column of the item above it, which is what
 * CommonMark needs to nest it under a "1." as well as under a "-".
 */
const itemLine = (block: Extract<Block, { kind: "item" }>, listId: string | undefined, state: ListState): [string, ListState] => {
  const fresh = !continues(state, block, listId);
  const counters = (fresh ? [] : state.counters).slice(0, block.depth + 1);
  const count = (counters[block.depth] ?? 0) + 1;
  const marker = block.ordered ? `${count}.` : "-";
  const widths = [...(fresh ? [] : state.widths).slice(0, block.depth), marker.length + 1];
  const indent = Array.from({ length: block.depth }, (_, d) => widths[d] ?? 2).reduce((a, b) => a + b, 0);
  const text = escapeLineStart(inlineMarkdown(block.inlines));
  const nextCounters = [...Array.from({ length: block.depth }, (_, d) => counters[d] ?? 0), count];
  const ordered = fresh ? block.ordered : state.ordered;
  return [`${" ".repeat(indent)}${marker} ${text}`.trimEnd(), { listId, counters: nextCounters, widths, ordered }];
};

const blockText = (block: Exclude<Block, { kind: "item" | "code" }>): string => {
  switch (block.kind) {
    case "heading":
      return `${"#".repeat(block.level)} ${inlineMarkdown(block.inlines)}`.trimEnd();
    case "paragraph":
      return escapeLineStart(inlineMarkdown(block.inlines));
    case "table":
      return tableMarkdown(block.rows);
  }
};

/**
 * The whole sequence. Items of one list sit on consecutive lines; code lines
 * share one fence; everything else is separated by a blank line.
 */
export const toMarkdown = (positioned: readonly Positioned[]): string => {
  const out: string[] = [];
  let list: ListState = NO_LIST;
  let fence: string[] | undefined;
  const closeFence = (): void => {
    if (fence) out.push(["```", ...fence, "```"].join("\n"));
    fence = undefined;
  };

  for (const { block, listId } of positioned) {
    if (block.kind === "code") {
      list = NO_LIST;
      fence = [...(fence ?? []), block.text];
      continue;
    }
    closeFence();
    if (block.kind === "item") {
      const continuing = continues(list, block, listId);
      const [line, next] = itemLine(block, listId, list);
      list = next;
      if (continuing && out.length > 0) out[out.length - 1] += `\n${line}`;
      else out.push(line);
      continue;
    }
    list = NO_LIST;
    out.push(blockText(block));
  }
  closeFence();
  return out.join("\n\n");
};

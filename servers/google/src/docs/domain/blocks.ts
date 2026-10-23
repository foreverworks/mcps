/**
 * The one model both directions go through: a Google Doc is read into blocks
 * and written to markdown; markdown is parsed into blocks and written to a Doc.
 * Nothing here knows either format, which is what lets each converter be
 * tested on its own.
 */

/** A run of text and the few styles markdown can say. */
export type Inline = {
  readonly text: string;
  readonly bold?: true;
  readonly italic?: true;
  readonly strike?: true;
  readonly code?: true;
  readonly link?: string;
};

/** A table cell: its paragraphs, each a list of runs. */
export type Cell = readonly (readonly Inline[])[];

export type Block =
  | { readonly kind: "heading"; readonly level: number; readonly inlines: readonly Inline[] }
  | { readonly kind: "paragraph"; readonly inlines: readonly Inline[] }
  | { readonly kind: "item"; readonly ordered: boolean; readonly depth: number; readonly inlines: readonly Inline[] }
  /** One line of a code block. Docs has no code block, so each line is a paragraph in a monospace font. */
  | { readonly kind: "code"; readonly text: string }
  | { readonly kind: "table"; readonly rows: readonly (readonly Cell[])[] };

/** Docs' soft line break inside a paragraph (Shift+Enter): a vertical tab. */
export const LINE_BREAK = "\u000b";

export const MAX_HEADING = 6;

const sameStyle = (a: Inline, b: Inline): boolean =>
  a.bold === b.bold && a.italic === b.italic && a.strike === b.strike && a.code === b.code && a.link === b.link;

/** Adjacent runs with the same style, as one: Docs splits runs for reasons markdown cannot see. */
export const mergeInlines = (inlines: readonly Inline[]): readonly Inline[] =>
  inlines
    .filter((i) => i.text.length > 0)
    .reduce<readonly Inline[]>((out, next) => {
      const last = out[out.length - 1];
      return last && sameStyle(last, next) ? [...out.slice(0, -1), { ...last, text: last.text + next.text }] : [...out, next];
    }, []);

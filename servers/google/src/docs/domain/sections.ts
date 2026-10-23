import type { Inline } from "./blocks.js";
import { ambiguousError, fail, notFoundError } from "./errors.js";
import type { Located } from "./fromDocs.js";

/** One heading and what it governs: every block up to the next heading at its level or above. */
export type Section = {
  /** Docs' heading id (`h.xxxxxxxx`): stable while the heading exists. Null for a heading Docs gave none. */
  readonly id: string | null;
  readonly title: string;
  readonly level: number;
  /** The titles from the outermost heading down to this one. */
  readonly path: readonly string[];
  /** Index into the document's blocks: the heading itself. */
  readonly first: number;
  /** One past the section's last block. */
  readonly last: number;
};

/** The words, with no markup: a heading's title as a path segment. */
const plainText = (inlines: readonly Inline[]): string => inlines.map((i) => i.text).join("").replace(/\u000b/g, " ");

export const PATH_SEPARATOR = " > ";

export const pathText = (section: Section): string => section.path.join(PATH_SEPARATOR);

type Open = { readonly level: number; readonly title: string };

/** The headings still open above one at `level`: everything shallower than it. */
const openAbove = (stack: readonly Open[], level: number): readonly Open[] => {
  const keep = stack.findIndex((open) => open.level >= level);
  return keep === -1 ? stack : stack.slice(0, keep);
};

/** Every heading's section, in document order. */
export const sectionsOf = (blocks: readonly Located[]): readonly Section[] => {
  const headings = blocks.flatMap((b, index) => (b.block.kind === "heading" ? [{ index, located: b, level: b.block.level, title: plainText(b.block.inlines) }] : []));
  return headings.reduce<{ readonly stack: readonly Open[]; readonly out: readonly Section[] }>(
    ({ stack, out }, h, n) => {
      const parents = openAbove(stack, h.level);
      const ends = headings.slice(n + 1).find((later) => later.level <= h.level);
      const section: Section = {
        id: h.located.headingId ?? null,
        title: h.title,
        level: h.level,
        path: [...parents.map((p) => p.title), h.title],
        first: h.index,
        last: ends ? ends.index : blocks.length,
      };
      return { stack: [...parents, { level: h.level, title: h.title }], out: [...out, section] };
    },
    { stack: [], out: [] },
  ).out;
};

const normalise = (s: string): string => s.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * The section a caller named: by heading id, by the full path ("Plan > Risks"),
 * or by a title alone when only one heading has it. A title two headings share
 * is ambiguous rather than a coin flip, and the candidates say how to name each.
 */
export const findSection = (sections: readonly Section[], selector: string): Section => {
  const wanted = selector.trim();
  const byId = sections.find((s) => s.id === wanted);
  if (byId) return byId;
  const byPath = sections.filter((s) => normalise(pathText(s)) === normalise(wanted));
  const byTitle = byPath.length > 0 ? byPath : sections.filter((s) => normalise(s.title) === normalise(wanted));
  if (byTitle.length === 1) return byTitle[0] as Section;
  if (byTitle.length > 1) {
    return fail(ambiguousError(`${byTitle.length} headings answer to "${wanted}"`, byTitle.map((s) => `${s.id ?? "(no id)"}: ${pathText(s)}`)));
  }
  const known = sections.slice(0, 12).map(pathText).join("; ");
  return fail(notFoundError(`no heading "${wanted}" in the document (headings: ${known || "none"})`));
};

import { fail, inputError } from "./errors.js";

/**
 * A change to a page's body, in Notion's own Markdown. Checked here; written
 * in the grammar of `PATCH /v1/pages/{id}/markdown` by infra.
 *
 * None of these is safe to send twice: an insert inserts again, and a
 * find-and-replace that already ran finds nothing the second time. infra sends
 * them as not idempotent, so a lost answer is `outcome_unknown` rather than a
 * silent duplicate.
 */
export type ContentEdit =
  /** New content at the start or the end of the page, or after the passage `after` names ("first words...last words"). */
  | { readonly kind: "insert"; readonly markdown: string; readonly at: "start" | "end" | { readonly after: string } }
  /** Find and replace, each `old` matched exactly; a match in several places needs `all`. */
  | {
      readonly kind: "update";
      readonly updates: readonly { readonly old: string; readonly new: string; readonly all: boolean }[];
      readonly allowDeleting: boolean;
    }
  /** The whole body. */
  | { readonly kind: "replace"; readonly markdown: string; readonly allowDeleting: boolean };

/** Notion's limit on the find-and-replace pairs in one call. */
export const UPDATE_LIMIT = 100;

export const insertEdit = (markdown: string, at: "start" | "end", after: string | undefined): ContentEdit => {
  if (markdown.trim() === "") return fail(inputError("markdown is empty; there is nothing to add"));
  if (after !== undefined && after.trim() === "") return fail(inputError("after is empty; give the passage to insert after, as 'first words...last words'"));
  return { kind: "insert", markdown, at: after === undefined ? at : { after } };
};

export const updateEdit = (updates: readonly { readonly old: string; readonly new: string; readonly all: boolean }[], allowDeleting: boolean): ContentEdit => {
  if (updates.length === 0) return fail(inputError("edits is empty; there is nothing to change"));
  if (updates.length > UPDATE_LIMIT) return fail(inputError(`at most ${UPDATE_LIMIT} edits go in one call`));
  const blank = updates.findIndex((u) => u.old === "");
  if (blank !== -1) return fail(inputError(`edit ${blank + 1} has an empty old text; say what to find`));
  return { kind: "update", updates, allowDeleting };
};

/**
 * The whole body. An empty one erases the page, and an empty `markdown` is
 * also what a model sends when it lost the text it meant to write, so emptying
 * a page takes `clear` as well; `clear` with text is a contradiction, refused.
 */
export const replaceEdit = (markdown: string, allowDeleting: boolean, clear: boolean): ContentEdit => {
  const empty = markdown.trim() === "";
  if (empty && !clear) return fail(inputError("markdown is empty, which would erase the page's whole body; pass clear: true to empty it on purpose"));
  if (!empty && clear) return fail(inputError("clear empties the page's body, so it takes markdown \"\"; leave clear out to replace the body with this text"));
  return { kind: "replace", markdown: empty ? "" : markdown, allowDeleting };
};

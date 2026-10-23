import { inputError, fail } from "../../domain/errors.js";
import { type Label, resolveLabels } from "../../domain/labels.js";
import type { Deps, LabelChange } from "../ports.js";

export const knownLabels = async (deps: Deps): Promise<readonly Label[]> => (await deps.gmail.labels()).labels ?? [];

/**
 * Label names or ids, as a caller writes them, to the ids Gmail wants. An
 * unknown label is refused, never dropped: a change that silently loses half
 * its labels looks like it worked.
 */
export const changeFrom = (known: readonly Label[], add: readonly string[], remove: readonly string[]): LabelChange => {
  const added = resolveLabels(add, known);
  const removed = resolveLabels(remove, known);
  const unknown = [...added.unknown, ...removed.unknown];
  if (unknown.length) return fail(inputError(`unknown label(s): ${unknown.join(", ")}; list_labels shows what exists`));
  return { add: added.ids, remove: removed.ids };
};

export const labelChange = async (deps: Deps, add: readonly string[], remove: readonly string[]): Promise<LabelChange> =>
  changeFrom(await knownLabels(deps), add, remove);

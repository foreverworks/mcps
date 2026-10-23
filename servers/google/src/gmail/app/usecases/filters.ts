import { inputError, fail } from "../../domain/errors.js";
import { type FilterCriteria, filterSpec, filterView } from "../../domain/filters.js";
import type { Deps } from "../ports.js";
import { changeFrom, knownLabels } from "./labelChange.js";
import { requireFilters } from "./writeGuard.js";

/** Every filter on the mailbox, with label names and the search each amounts to. */
export const listFilters = async (deps: Deps) => {
  const [list, labels] = await Promise.all([deps.gmail.filters(), knownLabels(deps)]);
  return { account: deps.account, filters: (list.filter ?? []).map((f) => filterView(f, labels)) };
};

export type FilterInput = {
  readonly criteria: FilterCriteria;
  readonly add: readonly string[];
  readonly remove: readonly string[];
  /** A filter that adds TRASH or SPAM throws arriving mail away before anyone sees it; only with this. */
  readonly discard?: boolean;
};

const DISCARDING = new Set(["TRASH", "SPAM"]);

/**
 * A filter acts on mail as it ARRIVES. Gmail's "also apply to matching
 * conversations" is not part of its API; the result carries the search the
 * criteria amount to, for modify_labels_matching to do that part.
 */
export const createFilter = async (deps: Deps, input: FilterInput) => {
  await requireFilters(deps);
  const labels = await knownLabels(deps);
  const change = changeFrom(labels, input.add, input.remove);
  const discards = change.add.filter((id) => DISCARDING.has(id));
  if (discards.length > 0 && !input.discard) {
    return fail(inputError(`a filter that adds ${discards.join(" and ")} sends arriving mail there before anyone sees it; pass discard: true if that is meant`));
  }
  const created = await deps.write.createFilter(filterSpec(input.criteria, change));
  return { account: deps.account, filter: filterView(created, labels) };
};

export const deleteFilter = async (deps: Deps, id: string) => {
  await requireFilters(deps);
  const clean = id.trim() || fail(inputError("a filter id is required; list_filters shows them"));
  await deps.write.deleteFilter(clean);
  return { account: deps.account, deleted: true, id: clean };
};

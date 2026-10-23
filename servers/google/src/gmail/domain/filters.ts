/**
 * Gmail filters: what one may say, the search it amounts to, and how it reads
 * back with label names instead of ids. Pure.
 */
import { inputError, fail } from "./errors.js";
import type { Label } from "./labels.js";
import type { RawFilter } from "./schema.js";

export type { RawFilter };

/** The criteria. The tools create filters without size rules, but a filter made in Gmail may carry one, and reads show it. */
export type FilterCriteria = {
  readonly from?: string;
  readonly to?: string;
  readonly subject?: string;
  /** Any Gmail search, as in the search box ("Has the words"). */
  readonly query?: string;
  /** "Doesn't have": none of these words. */
  readonly negatedQuery?: string;
  readonly hasAttachment?: boolean;
  /** Bytes, with sizeComparison "larger" or "smaller". */
  readonly size?: number;
  readonly sizeComparison?: string;
};

/**
 * What Gmail is sent. The actions are labels only: forwarding is left out
 * because it sends mail elsewhere and needs a verified address and another
 * scope, which this server does not ask for.
 */
export type FilterSpec = {
  readonly criteria: FilterCriteria;
  readonly action: { readonly addLabelIds: readonly string[]; readonly removeLabelIds: readonly string[] };
};

const text = (s: string | null | undefined): string | undefined => (s?.trim() ? s.trim() : undefined);

const cleanCriteria = (c: FilterCriteria): FilterCriteria => {
  const [from, to, subject, query, negatedQuery] = [c.from, c.to, c.subject, c.query, c.negatedQuery].map(text);
  return {
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(subject ? { subject } : {}),
    ...(query ? { query } : {}),
    ...(negatedQuery ? { negatedQuery } : {}),
    ...(c.hasAttachment ? { hasAttachment: true } : {}),
    ...(c.size && (c.sizeComparison === "larger" || c.sizeComparison === "smaller") ? { size: c.size, sizeComparison: c.sizeComparison } : {}),
  };
};

/** A filter that matches everything, or does nothing, is refused before Gmail sees it. */
export const filterSpec = (criteria: FilterCriteria, change: { readonly add: readonly string[]; readonly remove: readonly string[] }): FilterSpec => {
  const clean = cleanCriteria(criteria);
  if (Object.keys(clean).length === 0) return fail(inputError("a filter needs at least one criterion (from, to, subject, query, negated_query, has_attachment)"));
  if (change.add.length + change.remove.length === 0) return fail(inputError("a filter needs an action: a label to add or remove (remove INBOX to skip the inbox)"));
  return { criteria: clean, action: { addLabelIds: change.add, removeLabelIds: change.remove } };
};

const grouped = (s: string): string => (/\s/.test(s) ? `(${s})` : s);

/**
 * The search a filter's criteria amount to, written as Gmail writes it when
 * you click "Create filter" from a search, so mail already in the mailbox can
 * be given the same treatment with that search. Approximate in one place:
 * Gmail matches a filter's `from` against the sender as it arrives, the
 * search against the indexed header, and the two agree for the address and
 * domain forms people actually use.
 */
export const queryOf = (c: FilterCriteria): string =>
  [
    c.from ? `from:${grouped(c.from)}` : "",
    c.to ? `to:${grouped(c.to)}` : "",
    c.subject ? `subject:${grouped(c.subject)}` : "",
    c.query ? grouped(c.query) : "",
    c.negatedQuery ? `-{${c.negatedQuery}}` : "",
    c.hasAttachment ? "has:attachment" : "",
    c.size && c.sizeComparison ? `${c.sizeComparison}:${c.size}` : "",
  ]
    .filter(Boolean)
    .join(" ");

export type FilterView = {
  readonly id: string | undefined;
  readonly criteria: FilterCriteria;
  /** Label names, where the id is still a label; an id Gmail no longer knows stays as it is. */
  readonly add: readonly string[];
  readonly remove: readonly string[];
  /** The same criteria as a search, for applying the filter to mail already there. */
  readonly query: string;
  /** Set only on a filter made elsewhere that forwards; these tools never create one. */
  readonly forward?: string;
};

/** A filter as Gmail returns it, with its label ids named. */
export const filterView = (raw: RawFilter, labels: readonly Label[]): FilterView => {
  const nameOf = (id: string) => labels.find((l) => l.id === id)?.name ?? id;
  const c = raw.criteria ?? {};
  const criteria = cleanCriteria({
    ...(c.from ? { from: c.from } : {}),
    ...(c.to ? { to: c.to } : {}),
    ...(c.subject ? { subject: c.subject } : {}),
    ...(c.query ? { query: c.query } : {}),
    ...(c.negatedQuery ? { negatedQuery: c.negatedQuery } : {}),
    ...(c.hasAttachment ? { hasAttachment: true } : {}),
    ...(c.size ? { size: c.size } : {}),
    ...(c.sizeComparison ? { sizeComparison: c.sizeComparison } : {}),
  });
  return {
    id: raw.id ?? undefined,
    criteria,
    add: (raw.action?.addLabelIds ?? []).map(nameOf),
    remove: (raw.action?.removeLabelIds ?? []).map(nameOf),
    query: queryOf(criteria),
    ...(raw.action?.forward ? { forward: raw.action.forward } : {}),
  };
};

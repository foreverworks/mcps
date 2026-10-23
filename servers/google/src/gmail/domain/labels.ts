import type { RawLabel as Label } from "./schema.js";

export type { Label };
/** Turning the label names a caller writes into the ids Gmail wants. Pure. */


export type Resolved = { readonly ids: readonly string[]; readonly unknown: readonly string[] };

/**
 * An id, or a name, case-insensitively: "inbox", "INBOX" and "Inbox" are the
 * same label, and so are "Label_12" and the name it was given. A caller should
 * not have to list the labels first to archive a message.
 */
/** A label that can be matched: Gmail sends every label with an id and a name. */
export type NamedLabel = { readonly id: string; readonly name: string; readonly type?: string };

const named = (known: readonly Label[]): readonly NamedLabel[] =>
  known.flatMap((l) => (l.id && l.name ? [{ id: l.id, name: l.name, ...(l.type ? { type: l.type } : {}) }] : []));

/** An exact id first, then an id or a name case-insensitively. */
const match = (wanted: string, labels: readonly NamedLabel[]): NamedLabel | undefined => {
  const lower = wanted.toLowerCase();
  return (
    labels.find((l) => l.id === wanted) ??
    labels.find((l) => l.id.toLowerCase() === lower) ??
    labels.find((l) => l.name.toLowerCase() === lower)
  );
};

export const resolveLabels = (wanted: readonly string[], known: readonly Label[]): Resolved => {
  const labels = named(known);
  const hits = wanted
    .map((x) => x.trim())
    .filter(Boolean)
    .map((w) => [w, match(w, labels)] as const);
  return {
    ids: [...new Set(hits.flatMap(([, hit]) => (hit ? [hit.id] : [])))],
    unknown: hits.flatMap(([w, hit]) => (hit ? [] : [w])),
  };
};

export const findLabel = (wanted: string, known: readonly Label[]): NamedLabel | undefined => match(wanted.trim(), named(known));

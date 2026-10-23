import type { Source } from "./grants.js";
import type { RawPerson } from "./schema.js";

/**
 * People found by name, as one list. Pure.
 *
 * The same person turns up in several places: a contact in one account, an
 * "other contact" in another, an entry in a Workspace directory. They are one
 * entry here, keyed by address, with every place they were found, so the
 * answer to "what is Ana's address" is one line rather than four.
 */

export type Found = { readonly account: string; readonly source: Source; readonly person: RawPerson };

export type PersonView = {
  readonly name: string;
  readonly emails: readonly string[];
  readonly phones?: readonly string[];
  readonly organization?: string;
  readonly title?: string;
  readonly foundIn: readonly { readonly account: string; readonly source: Source }[];
};

/** Contacts the user made first, then the directory, then addresses Gmail saved on its own. */
const RANK: Readonly<Record<Source, number>> = { contacts: 0, directory: 1, other: 2 };

const unique = (values: readonly (string | null | undefined)[]): readonly string[] => {
  const seen = new Set<string>();
  return values.flatMap((v) => {
    const text = v?.trim();
    if (!text || seen.has(text.toLowerCase())) return [];
    seen.add(text.toLowerCase());
    return [text];
  });
};

const viewOf = (person: RawPerson) => {
  const organization = person.organizations?.find((o) => o.name || o.title);
  const phones = unique((person.phoneNumbers ?? []).map((p) => p.canonicalForm ?? p.value));
  return {
    name: person.names?.find((n) => n.displayName)?.displayName ?? "",
    emails: unique((person.emailAddresses ?? []).map((e) => e.value)),
    ...(phones.length ? { phones } : {}),
    ...(organization?.name ? { organization: organization.name } : {}),
    ...(organization?.title ? { title: organization.title } : {}),
  };
};

/**
 * One entry per person, in the order found within each source's rank. People
 * sharing an address (compared without case) are one entry, transitively: a
 * person whose addresses join two entries makes them one. Someone with no
 * address (a phone number matched) stays an entry of their own; only a result
 * with nothing to show at all is dropped.
 */
export const mergePeople = (found: readonly Found[]): readonly PersonView[] => {
  const ordered = [...found].map((f, i) => ({ ...f, i })).sort((a, b) => RANK[a.source] - RANK[b.source] || a.i - b.i);
  type Entry = { view: ReturnType<typeof viewOf>; keys: Set<string>; foundIn: { account: string; source: Source }[] };
  let entries: Entry[] = [];
  /** The first sighting keeps its name and order; a later one adds what it lacked. */
  const absorb = (into: Entry, from: Entry): void => {
    const phones = unique([...(into.view.phones ?? []), ...(from.view.phones ?? [])]);
    into.view = {
      ...from.view,
      ...into.view,
      name: into.view.name || from.view.name,
      emails: unique([...into.view.emails, ...from.view.emails]),
      ...(phones.length ? { phones } : {}),
    };
    for (const k of from.keys) into.keys.add(k);
    for (const p of from.foundIn) if (!into.foundIn.some((q) => q.account === p.account && q.source === p.source)) into.foundIn.push(p);
  };
  for (const f of ordered) {
    const view = viewOf(f.person);
    if (!view.name && view.emails.length === 0 && !view.phones) continue;
    const incoming: Entry = { view, keys: new Set(view.emails.map((e) => e.toLowerCase())), foundIn: [{ account: f.account, source: f.source }] };
    const same = entries.filter((e) => [...incoming.keys].some((k) => e.keys.has(k)));
    const [first, ...rest] = same;
    if (!first) {
      entries.push(incoming);
      continue;
    }
    absorb(first, incoming);
    for (const other of rest) absorb(first, other);
    entries = entries.filter((e) => !rest.includes(e));
  }
  return entries.map((e) => ({ ...e.view, foundIn: e.foundIn }));
};

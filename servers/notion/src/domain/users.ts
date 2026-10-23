import { compact } from "@foreverworks/mcp-kit";

import { parseId } from "./ids.js";
import { present } from "./present.js";
import type { RawPropertyValue, RawUser } from "./schema.js";

/**
 * A workspace's people (and its bots), as a person column names them. A page
 * may answer a person as a bare id; the workspace's user list puts the name
 * back, and lets a filter name a person instead of an id.
 */
export type User = {
  readonly id: string;
  readonly name?: string;
  readonly type: "person" | "bot";
  /** A person's, when the token may read it. */
  readonly email?: string;
};

export const toUser = (raw: RawUser): User =>
  compact({ id: raw.id, name: raw.name ?? undefined, type: raw.type, email: raw.type === "person" ? (raw.person.email ?? undefined) : undefined });

/** User id -> name, for the people a page answered without one. */
export type PeopleNames = ReadonlyMap<string, string>;

export const namesOf = (users: readonly User[]): PeopleNames => new Map(users.flatMap((u) => (u.name === undefined ? [] : [[u.id, u.name] as const])));

/** Whether a user matches what a person typed: words in the name or the email, ignoring case. */
export const userMatches = (user: User, query: string): boolean => {
  const q = query.trim().toLowerCase();
  return (user.name ?? "").toLowerCase().includes(q) || (user.email ?? "").toLowerCase().includes(q);
};

const label = (u: User): string => `${u.name ?? "(no name)"}${u.email === undefined ? "" : ` <${u.email}>`} (${u.id})`;

/**
 * The user id a filter value names: an id as it is (a guest is not always
 * listed), an email, a name ignoring case, or a part of exactly one person's
 * name. Two people who fit are refused with both, never guessed between.
 */
export const userIdFor = (users: readonly User[], wanted: string, account: string): { readonly id: string } | { readonly refused: string } => {
  const id = parseId(wanted);
  if (id !== undefined) return { id };
  const w = wanted.trim().toLowerCase();
  const pick = (found: readonly User[]): { readonly id: string } | { readonly refused: string } | undefined => {
    if (found.length === 1) return { id: (found[0] as User).id };
    if (found.length > 1) return { refused: `"${wanted}" fits ${found.length} users in "${account}": ${found.map(label).join(", ")}; give the id or the email` };
    return undefined;
  };
  return (
    pick(users.filter((u) => u.email?.toLowerCase() === w)) ??
    pick(users.filter((u) => u.name?.toLowerCase() === w)) ??
    pick(users.filter((u) => u.type === "person" && (u.name ?? "").toLowerCase().includes(w))) ?? {
      refused: `no user "${wanted}" in "${account}"; list_users lists its people`,
    }
  );
};

type AnyUser = { readonly id: string; readonly name?: string | null };

/** The ids of the people a page's properties name without a name: what the user list has to fill in. */
export const unnamedPeople = (properties: Readonly<Record<string, RawPropertyValue | null>>): readonly string[] =>
  present(properties).flatMap(([, raw]) => {
    const users: readonly AnyUser[] =
      raw.type === "people"
        ? (raw.people as readonly AnyUser[])
        : raw.type === "created_by"
          ? [raw.created_by as AnyUser]
          : raw.type === "last_edited_by"
            ? [raw.last_edited_by as AnyUser]
            : [];
    return users.filter((u) => u.name === undefined || u.name === null).map((u) => u.id);
  });

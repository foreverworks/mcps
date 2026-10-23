import { compact } from "@foreverworks/mcp-kit";

import { chooseAccounts } from "../../domain/accounts.js";
import { type Column, findColumn } from "../../domain/columns.js";
import { asAppError, describeThrown, fail, inputError } from "../../domain/errors.js";
import type { Condition } from "../../domain/query/filter.js";
import type { RawPage } from "../../domain/schema.js";
import { namesOf, type PeopleNames, toUser, unnamedPeople, type User, userIdFor, userMatches } from "../../domain/users.js";
import type { Deps, NotionPort } from "../ports.js";

/** Notion's page size ceiling for the user list. */
const PAGE = 100;

/** Every page of a workspace's people and bots, in Notion's order. */
export const readAllUsers = async (api: NotionPort): Promise<readonly User[]> => {
  const users: User[] = [];
  let cursor: string | undefined;
  do {
    const page = await api.listUsers(PAGE, cursor);
    users.push(...page.results.map(toUser));
    cursor = page.has_more ? (page.next_cursor ?? undefined) : undefined;
  } while (cursor !== undefined);
  return users;
};

/**
 * The people (and bots) of every workspace, or of the one `account` names,
 * narrowed by `query` (words in a name or an email). A workspace that fails is
 * reported beside the others' users.
 */
export const listUsers = async (deps: Deps, args: { readonly account?: string; readonly query?: string }) => {
  const labels = chooseAccounts(args.account, await deps.accounts.labels());
  const answers = await Promise.all(
    labels.map(async (account) => {
      try {
        return { account, users: await deps.users(account) };
      } catch (thrown) {
        return { account, error: describeThrown(thrown) };
      }
    }),
  );
  const users = answers.flatMap((a) =>
    "users" in a ? a.users.filter((u) => args.query === undefined || userMatches(u, args.query)).map((u) => ({ account: a.account, ...u })) : [],
  );
  const failed = Object.fromEntries(answers.flatMap((a) => ("error" in a ? [[a.account, a.error] as const] : [])));
  return compact({ users, failed: Object.keys(failed).length === 0 ? undefined : failed });
};

const PEOPLE = new Set(["people", "created_by", "last_edited_by"]);

/**
 * `where` with each person named by a name or an email turned into the user's
 * id, from the workspace's user list (read only when a condition needs it). An
 * id and "me" go through as they are; a name nobody has, or two people have, is
 * refused before anything is sent.
 */
export const resolvePeople = async (deps: Deps, account: string, columns: readonly Column[], where: readonly Condition[]): Promise<readonly Condition[]> => {
  const named = (c: Condition): boolean =>
    c.property !== undefined && typeof c.value === "string" && c.value !== "me" && PEOPLE.has(findColumn(columns, c.property).type);
  if (!where.some(named)) return where;
  const users = await deps.users(account);
  return where.map((c) => {
    if (!named(c)) return c;
    const found = userIdFor(users, c.value as string, account);
    return "id" in found ? { ...c, value: found.id } : fail(inputError(found.refused));
  });
};

/**
 * The names of the people these pages answered as bare ids, from the
 * workspace's user list; nothing is asked when every person came with a name.
 * A token that may not list users leaves the ids as they are.
 */
export const peopleNames = async (deps: Deps, account: string, pages: readonly RawPage[]): Promise<PeopleNames | undefined> => {
  if (!pages.some((p) => unnamedPeople(p.properties).length > 0)) return undefined;
  try {
    return namesOf(await deps.users(account));
  } catch (thrown) {
    if (asAppError(thrown)?.kind === "forbidden") return undefined;
    throw thrown;
  }
};

/**
 * People: the workspace's users listed, a person column filtered by a name or
 * an email, and a person a page answered as a bare id named again.
 */
import { describe, expect, it, vi } from "vitest";

import { countRows, queryDatabase } from "../src/app/usecases/databases.js";
import { readPage } from "../src/app/usecases/pages.js";
import { listUsers } from "../src/app/usecases/users.js";
import { fail } from "../src/domain/errors.js";
import type { RawQuery } from "../src/domain/schema.js";
import { userIdFor, type User } from "../src/domain/users.js";
import { COLUMNS, database, dataSource, errorOf, fakeDeps, ID, row } from "./helpers.js";

const ANA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ANDREI = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const BOT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const person = (id: string, name: string, email: string) => ({ object: "user", id, type: "person", name, avatar_url: null, person: { email } });
const USERS = [
  person(ANA, "Ana Popescu", "ana@example.com"),
  person(ANDREI, "Andrei Ionescu", "andrei@example.com"),
  { object: "user", id: BOT, type: "bot", name: "Example Integration", avatar_url: null, bot: {} },
];
const userPage = (results: readonly unknown[], next?: string) => ({ object: "list", type: "user", user: {}, results, next_cursor: next ?? null, has_more: next !== undefined });

const OWNER = { id: "ow", name: "Owner", type: "people", people: {} };
const withOwner = () => dataSource({ properties: { ...COLUMNS, Owner: OWNER } });
const ownedRow = (who: unknown) => row({}, { Owner: { id: "ow", type: "people", people: [who] } });

const crm = (over: Parameters<typeof fakeDeps>[0]["work"] = {}) =>
  fakeDeps({
    personal: { listUsers: async () => fail({ kind: "auth", account: "personal", message: "revoked" }) },
    work: {
      getDatabase: async (id) => (id === ID.database ? database() : fail({ kind: "not_shared", accounts: ["work"], message: "no" })),
      getDataSource: async (id) => (id === ID.source ? withOwner() : fail({ kind: "not_shared", accounts: ["work"], message: "no" })),
      getPage: async (id) => (id === ID.row ? ownedRow({ object: "user", id: ANA }) : fail({ kind: "not_shared", accounts: ["work"], message: "no" })),
      listUsers: async () => userPage(USERS) as never,
      ...over,
    },
  });

const rows = (pages: readonly unknown[]) => ({ object: "list", results: pages, next_cursor: null, has_more: false, type: "page_or_data_source", page_or_data_source: {} }) as unknown as RawQuery;

describe("list_users", () => {
  it("lists every workspace's people, narrowed by a word, and names a workspace that failed", async () => {
    const out = await listUsers(crm(), { query: "an" });
    expect(out.users).toEqual([
      { account: "work", id: ANA, name: "Ana Popescu", type: "person", email: "ana@example.com" },
      { account: "work", id: ANDREI, name: "Andrei Ionescu", type: "person", email: "andrei@example.com" },
    ]);
    expect(out.failed?.["personal"]).toContain("revoked");
  });

  it("follows the list's pages", async () => {
    const list = vi.fn(async (_size: number, cursor?: string) => (cursor === undefined ? userPage([USERS[0]], "c2") : userPage([USERS[1]])) as never);
    const out = await listUsers(crm({ listUsers: list }), { account: "work" });
    expect(out.users.map((u) => u.id)).toEqual([ANA, ANDREI]);
    expect(list).toHaveBeenLastCalledWith(100, "c2");
  });
});

describe("a person column", () => {
  it("is filtered by a name, an email or a part of one name, sent as the user's id", async () => {
    const query = vi.fn(async () => rows([]));
    const deps = crm({ query });
    for (const value of ["ana popescu", "ANA@example.com", "Popescu", ANA]) {
      await queryDatabase(deps, { database: ID.database, where: [{ property: "Owner", op: "contains", value }], match: "all", sort: [], limit: 10, inTrash: false });
      expect(query).toHaveBeenLastCalledWith(ID.source, expect.objectContaining({ filter: { kind: "property", property: "Owner", key: "people", op: "contains", value: ANA } }));
    }
  });

  it("refuses a name two people fit, or nobody has, before anything is sent", async () => {
    const query = vi.fn();
    const deps = crm({ query });
    const where = (value: string) => ({ database: ID.database, where: [{ property: "Owner", op: "contains", value }], match: "all" as const, sort: [], limit: 10, inTrash: false });
    expect((await errorOf(() => queryDatabase(deps, where("an"))))?.message).toMatch(/fits 2 users in "work": Ana Popescu <ana@example.com>/);
    expect((await errorOf(() => queryDatabase(deps, where("Maria"))))?.message).toContain('no user "Maria" in "work"');
    expect((await errorOf(() => countRows(deps, { database: ID.database, where: where("Maria").where, match: "all", inTrash: false })))?.kind).toBe("input");
    expect(query).not.toHaveBeenCalled();
  });

  it("takes me without reading the user list", async () => {
    const listUsers_ = vi.fn(async () => userPage(USERS) as never);
    const query = vi.fn(async () => rows([ownedRow(USERS[0])]));
    await queryDatabase(crm({ query, listUsers: listUsers_ }), { database: ID.database, where: [{ property: "Owner", op: "contains", value: "me" }], match: "all", sort: [], limit: 10, inTrash: false });
    expect(listUsers_).not.toHaveBeenCalled();
  });

  it("names a person a page answered as a bare id, in rows, counts and pages", async () => {
    const query = vi.fn(async () => rows([ownedRow({ object: "user", id: ANA })]));
    const deps = crm({ query });
    const out = await queryDatabase(deps, { database: ID.database, where: [], match: "all", sort: [], limit: 10, inTrash: false });
    expect(out.rows[0]?.properties["Owner"]).toEqual([{ id: ANA, name: "Ana Popescu" }]);
    expect((await countRows(deps, { database: ID.database, where: [], match: "all", inTrash: false, by: "Owner" })).counts).toEqual({ [JSON.stringify({ id: ANA, name: "Ana Popescu" })]: 1 });
    expect((await readPage(deps, { page: ID.row, content: false, includeTranscript: false })).properties["Owner"]).toEqual([{ id: ANA, name: "Ana Popescu" }]);
  });

  it("leaves a bare id as it is when the token may not list users", async () => {
    const deps = crm({ listUsers: async () => fail({ kind: "forbidden", account: "work", message: "no user capability" }) });
    expect((await readPage(deps, { page: ID.row, content: false, includeTranscript: false })).properties["Owner"]).toEqual([{ id: ANA }]);
  });
});

describe("userIdFor", () => {
  const users: User[] = [
    { id: ANA, name: "Ana Popescu", type: "person", email: "ana@example.com" },
    { id: ANDREI, name: "Ana Popescu", type: "person" },
  ];
  it("refuses a name two people share, and finds one by email", () => {
    expect(userIdFor(users, "Ana Popescu", "work")).toMatchObject({ refused: expect.stringContaining("give the id or the email") });
    expect(userIdFor(users, "ana@example.com", "work")).toEqual({ id: ANA });
    expect(userIdFor(users, ANDREI.replace(/-/g, ""), "work")).toEqual({ id: ANDREI });
  });
});

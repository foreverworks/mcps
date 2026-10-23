/**
 * Saved views: listed with their filters in column names, and run as Notion
 * runs them, over fake ports and, for the wire, a stubbed fetch.
 */
import { describe, expect, it, vi } from "vitest";

import { listViews, queryView } from "../src/app/usecases/views.js";
import { buildDeps } from "../src/composition.js";
import { fail } from "../src/domain/errors.js";
import { toViewId } from "../src/domain/views.js";
import { database, dataSource, errorOf, fakeDeps, ID, json, notionError, row, tokensDir, withFetch } from "./helpers.js";

const VIEW = {
  active: "66666666-6666-4666-8666-666666666666",
  board: "77777777-7777-4777-8777-777777777777",
};
const ROW2 = "88888888-8888-4888-8888-888888888888";
const GONE = "99999999-9999-4999-8999-999999999999";

const activeView = {
  object: "view",
  id: VIEW.active,
  parent: { type: "database_id", database_id: ID.database },
  name: "Active",
  type: "table",
  created_time: "2026-09-01T10:00:00.000Z",
  last_edited_time: "2026-09-28T10:00:00.000Z",
  url: `https://www.notion.so/${ID.database.replace(/-/g, "")}?v=${VIEW.active.replace(/-/g, "")}`,
  data_source_id: ID.source,
  filter: { and: [{ property: "st%3A1", status: { does_not_equal: "Done" } }, { property: "bu", number: { greater_than: 1000 } }] },
  sorts: [{ property: "du", direction: "descending" }],
};
const dashboard = { object: "view", id: VIEW.board, parent: { type: "database_id", database_id: ID.database }, name: "Overview", type: "dashboard", created_time: "x", last_edited_time: "x", url: "u", data_source_id: null };

const ref = (id: string) => ({ object: "page", id });

/** The tracker in "work": a database with two views, and three rows the Active view shows. */
const crm = (over: Parameters<typeof fakeDeps>[0]["work"] = {}) =>
  fakeDeps({
    personal: {},
    work: {
      getDatabase: async (id) => (id === ID.database ? database() : fail({ kind: "not_shared", accounts: ["work"], message: "no" })),
      getDataSource: async (id) => (id === ID.source ? dataSource() : fail({ kind: "not_shared", accounts: ["work"], message: "no" })),
      listViews: async () => ({ object: "list", results: [{ object: "view", id: VIEW.active }, { object: "view", id: VIEW.board }], next_cursor: null, has_more: false, type: "view", view: {} }),
      getView: async (id) => (id === VIEW.active ? activeView : id === VIEW.board ? dashboard : fail({ kind: "not_shared", accounts: ["work"], message: "no" })) as never,
      getPage: async (id) => (id === GONE ? fail({ kind: "not_shared", accounts: ["work"], message: "gone" }) : row({ id })),
      ...over,
    },
  });

describe("list_views", () => {
  it("lists a database's views with their saved filter and sorts, columns by name", async () => {
    const out = await listViews(crm(), { database: ID.database });
    expect(out).toEqual({
      account: "work",
      database: ID.database,
      views: [
        {
          id: VIEW.active,
          name: "Active",
          type: "table",
          dataSourceId: ID.source,
          url: activeView.url,
          filter: { and: [{ property: "Status", status: { does_not_equal: "Done" } }, { property: "Budget", number: { greater_than: 1000 } }] },
          sorts: [{ property: "Due", direction: "descending" }],
        },
        { id: VIEW.board, name: "Overview", type: "dashboard", url: "u" },
      ],
    });
  });

  it("follows the list's pages", async () => {
    const list = vi.fn(async (_db: string, _size: number, cursor?: string) =>
      cursor === undefined
        ? { object: "list", results: [{ object: "view", id: VIEW.active }], next_cursor: "c2", has_more: true, type: "view", view: {} }
        : { object: "list", results: [{ object: "view", id: VIEW.board }], next_cursor: null, has_more: false, type: "view", view: {} },
    );
    const out = await listViews(crm({ listViews: list as never }), { database: ID.database });
    expect(out.views.map((v) => v.id)).toEqual([VIEW.active, VIEW.board]);
    expect(list).toHaveBeenLastCalledWith(ID.database, 100, "c2");
  });
});

describe("query_view", () => {
  it("reads the rows the view shows, in its order, and reads on in the same cached result", async () => {
    const queryView_ = vi.fn(async () => ({ object: "view_query", id: "q1", view_id: VIEW.active, expires_at: "x", total_count: 3, results: [ref(ROW2), ref(ID.row)], next_cursor: "n2", has_more: true }));
    const page_ = vi.fn(async () => ({ object: "list", results: [ref(GONE)], next_cursor: null, has_more: false, type: "page", page: {} }));
    const deps = crm({ queryView: queryView_ as never, viewQueryPage: page_ as never });

    const first = await queryView(deps, { view: activeView.url, limit: 2, properties: ["status"] });
    expect(first).toMatchObject({ account: "work", view: VIEW.active, name: "Active", source: ID.source, total: 3, count: 2 });
    expect(first.rows.map((r) => r.id)).toEqual([ROW2, ID.row]);
    expect(first.rows[0]?.properties).toEqual({ Status: "Not started" });
    expect(queryView_).toHaveBeenCalledWith(VIEW.active, 2);

    const second = await queryView(deps, { view: VIEW.active, limit: 2, cursor: first.nextCursor as string });
    expect(page_).toHaveBeenCalledWith(VIEW.active, "q1", 2, "n2");
    expect(queryView_).toHaveBeenCalledTimes(1);
    expect(second).toMatchObject({ total: 3, count: 0, rows: [], unreadable: [GONE] });
    expect(second.nextCursor).toBeUndefined();
  });

  it("says when the cached result has expired, and refuses a cursor from another view", async () => {
    const deps = crm({
      queryView: async () => ({ object: "view_query", id: "q1", view_id: VIEW.active, expires_at: "x", total_count: 9, results: [ref(ID.row)], next_cursor: "n2", has_more: true }) as never,
      viewQueryPage: async () => fail({ kind: "not_shared", accounts: ["work"], message: "Could not find view query" }),
    });
    const first = await queryView(deps, { view: VIEW.active, limit: 1 });
    expect((await errorOf(() => queryView(deps, { view: VIEW.active, limit: 1, cursor: first.nextCursor as string })))?.message).toContain("call query_view again without cursor");
    expect((await errorOf(() => queryView(deps, { view: VIEW.board, limit: 1, cursor: first.nextCursor as string })))?.message).toContain("another view");
  });

  it("refuses an unknown column before running the view", async () => {
    const queryView_ = vi.fn();
    expect(await errorOf(() => queryView(crm({ queryView: queryView_ }), { view: VIEW.active, limit: 5, properties: ["Nope"] }))).toMatchObject({ kind: "input" });
    expect(queryView_).not.toHaveBeenCalled();
  });

  it("takes a view's link, and refuses a database's", () => {
    expect(toViewId(`https://www.notion.so/ws/${ID.database.replace(/-/g, "")}?v=${VIEW.active.replace(/-/g, "")}`)).toBe(VIEW.active);
    expect(toViewId(VIEW.active.replace(/-/g, ""))).toBe(VIEW.active);
    expect(() => toViewId(`https://www.notion.so/ws/${ID.database.replace(/-/g, "")}`)).toThrow();
  });

  it("asks Notion for the view and its query on the documented paths", async () => {
    const calls = withFetch((url, init) => {
      const path = new URL(url).pathname.replace("/v1/", "");
      if (path === `views/${VIEW.active}`) return json(activeView);
      if (path === `views/${VIEW.active}/queries` && init?.method === "POST") return json({ object: "view_query", id: "q1", view_id: VIEW.active, expires_at: "x", total_count: 1, results: [ref(ID.row)], next_cursor: null, has_more: false });
      if (path === `data_sources/${ID.source}`) return json(dataSource());
      if (path === `pages/${ID.row}`) return json(row());
      return notionError(404, "object_not_found");
    });
    const deps = buildDeps({ NOTION_TOKENS_DIR: tokensDir({ work: "ntn_work" }) }, { sleep: async () => undefined });
    const out = await queryView(deps, { view: VIEW.active, limit: 25 });
    expect(out).toMatchObject({ account: "work", total: 1, rows: [{ id: ID.row, title: "Acme" }] });
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ page_size: 25 });
    expect(calls.every((c) => c.headers["Notion-Version"] === "2026-03-11")).toBe(true);
  });
});

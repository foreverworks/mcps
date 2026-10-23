/**
 * The use cases over fake ports, one per workspace, and the real locator:
 * what crosses workspaces, what is checked before a request, what comes back.
 */
import { describe, expect, it, vi } from "vitest";

import { checkHealth } from "../src/app/usecases/accounts.js";
import { readBlocks } from "../src/app/usecases/blocks.js";
import { addComment } from "../src/app/usecases/comments.js";
import { appendContent, replaceContent } from "../src/app/usecases/content.js";
import { listDatabaseTemplates, countRows, describeDatabase, queryDatabase } from "../src/app/usecases/databases.js";
import { createPage, movePage, readPage, setTrashed, updatePage } from "../src/app/usecases/pages.js";
import { search } from "../src/app/usecases/search.js";
import { decodeCursors } from "../src/domain/cursor.js";
import { fail } from "../src/domain/errors.js";
import type { RawQuery, RawSearch } from "../src/domain/schema.js";
import { childPage, database, dataSource, errorOf, fakeDeps, ID, row } from "./helpers.js";

const list = <T>(results: readonly T[], next?: string) => ({ object: "list", results, next_cursor: next ?? null, has_more: next !== undefined });
const md = { object: "page_markdown", id: ID.row, markdown: "# Acme\n\nNotes", truncated: false, unknown_block_ids: [] } as const;

/** The tracker lives in "work"; "personal" knows nothing of it. */
type PortOver = NonNullable<Parameters<typeof fakeDeps>[0]["work"]>;

const crm = (over: PortOver = {}, personal: PortOver = {}) =>
  fakeDeps({
    personal,
    work: {
      getPage: async (id) => (id === ID.row ? row() : fail({ kind: "not_shared", accounts: ["work"], message: "no" })),
      getDatabase: async (id) => (id === ID.database ? database() : fail({ kind: "not_shared", accounts: ["work"], message: "no" })),
      getDataSource: async (id) => (id === ID.source ? dataSource() : fail({ kind: "not_shared", accounts: ["work"], message: "no" })),
      getMarkdown: async () => md,
      ...over,
    },
  });

describe("finding the workspace", () => {
  it("reads a page from whichever workspace has it, and remembers where", async () => {
    const miss = vi.fn(async () => fail({ kind: "not_shared", accounts: ["personal"], message: "no" }));
    const deps = crm({}, { getPage: miss, getDatabase: miss, getDataSource: miss });
    const first = await readPage(deps, { page: `https://www.notion.so/Acme-${ID.row.replace(/-/g, "")}`, content: true, includeTranscript: false });
    expect(first).toMatchObject({ account: "work", id: ID.row, title: "Acme", markdown: "# Acme\n\nNotes", properties: { Status: "Not started", Budget: 5000 } });
    expect(miss).toHaveBeenCalled();
    const asked = miss.mock.calls.length;
    await readPage(deps, { page: ID.row, content: false, includeTranscript: false });
    expect(miss.mock.calls.length).toBe(asked);
  });

  it("names every workspace it asked when none has the id", async () => {
    const error = await errorOf(() => readPage(crm(), { page: ID.other, content: false, includeTranscript: false }));
    expect(error).toMatchObject({ kind: "not_shared", accounts: ["personal", "work"] });
  });

  it("refuses a database where a page is meant, and says which tool takes it", async () => {
    const error = await errorOf(() => readPage(crm(), { page: ID.database, content: false, includeTranscript: false }));
    expect(error?.message).toContain("describe_database");
  });

  it("does not hide a real failure behind the search: a revoked token is reported as such", async () => {
    const deps = fakeDeps({ personal: { getPage: async () => fail({ kind: "auth", account: "personal", message: "revoked" }) }, work: {} });
    expect(await errorOf(() => readPage(deps, { page: ID.row, content: false, includeTranscript: false }))).toMatchObject({ kind: "auth" });
  });
});

describe("pages", () => {
  it("fills a relation Notion cut at 25 from the property endpoint", async () => {
    const deps = crm({
      getPage: async () => row({}, { Company: { id: "co", type: "relation", relation: [{ id: ID.other }], has_more: true } }),
      getPropertyItems: async (_page, _prop, cursor) =>
        (cursor === undefined
          ? { ...list([{ object: "property_item", id: "co", type: "relation", relation: { id: ID.other } }], "c2"), type: "property_item", property_item: {} }
          : { ...list([{ object: "property_item", id: "co", type: "relation", relation: { id: ID.page } }]), type: "property_item", property_item: {} }) as never,
    });
    const page = await readPage(deps, { page: ID.row, content: false, includeTranscript: false, account: "work" });
    expect(page.properties["Company"]).toEqual([ID.other, ID.page]);
  });

  it("creates a row in a database named by URL, checked against its columns", async () => {
    const createPage_ = vi.fn(async () => row({ id: ID.other }));
    const deps = crm({ createPage: createPage_ });
    const out = await createPage(deps, {
      parent: `https://www.notion.so/ws/Project-Tracker-${ID.database.replace(/-/g, "")}?v=1`,
      title: "Globex",
      properties: { Status: "not started", Budget: 7000 },
      markdown: "## Why",
      allowNewOptions: false,
    });
    expect(out).toMatchObject({ account: "work", id: ID.other, in: "Projects" });
    expect(createPage_).toHaveBeenCalledWith({
      parent: { type: "data_source", id: ID.source },
      properties: { Status: { type: "status", name: "Not started" }, Budget: { type: "number", value: 7000 }, Name: { type: "title", runs: ["Globex"] } },
      markdown: "## Why",
    });
  });

  it("refuses an unknown option before anything is sent", async () => {
    const createPage_ = vi.fn();
    const error = await errorOf(() => createPage(crm({ createPage: createPage_ }), { parent: ID.database, properties: { Priority: "Urgent" }, allowNewOptions: false }));
    expect(error).toMatchObject({ kind: "input" });
    expect(createPage_).not.toHaveBeenCalled();
  });

  it("asks which table when a database holds two", async () => {
    const deps = crm({ getDatabase: async () => database({ data_sources: [{ id: ID.source, name: "Projects" }, { id: ID.other, name: "Archive" }] }) });
    const error = await errorOf(() => createPage(deps, { parent: ID.database, properties: {}, allowNewOptions: false }));
    expect(error?.message).toContain("name one with source");
  });

  it("gives a page under a page a title and no properties", async () => {
    const deps = fakeDeps({ work: { getPage: async () => childPage(), createPage: async () => childPage({ id: ID.other }) } });
    expect(await errorOf(() => createPage(deps, { parent: ID.page, properties: { Status: "x" }, allowNewOptions: false }))).toMatchObject({ kind: "input" });
    expect(await createPage(deps, { parent: ID.page, title: "Notes", properties: {}, allowNewOptions: false })).toMatchObject({ id: ID.other });
  });

  it("puts a page with no parent at the top level of the one workspace named", async () => {
    const create = vi.fn(async () => childPage({ id: ID.other }));
    const deps = fakeDeps({ personal: { createPage: create }, work: {} });
    expect((await errorOf(() => createPage(deps, { title: "Notes", properties: {}, allowNewOptions: false })))?.message).toContain("name it with account");
    expect(await createPage(deps, { title: "Notes", properties: {}, allowNewOptions: false, account: "personal" })).toMatchObject({ account: "personal", id: ID.other, in: "(top level)" });
    expect(create).toHaveBeenCalledWith({ parent: { type: "workspace" }, properties: { title: { type: "title", runs: ["Notes"] } } });
  });

  it("updates a row's columns against its own data source", async () => {
    const updatePage_ = vi.fn(async () => row({}, { Status: { id: "st%3A1", type: "status", status: { id: "s2", name: "In progress", color: "blue" } } }));
    const out = await updatePage(crm({ updatePage: updatePage_ }), { page: ID.row, properties: { Status: "In progress" }, allowNewOptions: false });
    expect(updatePage_).toHaveBeenCalledWith(ID.row, { properties: { Status: { type: "status", name: "In progress" } } });
    expect(out.properties["Status"]).toBe("In progress");
  });

  it("trashes and restores by id", async () => {
    const updatePage_ = vi.fn(async (_id: string, patch: { inTrash?: boolean }) => row({ in_trash: patch.inTrash }));
    const deps = crm({ updatePage: updatePage_ as never });
    expect(await setTrashed(deps, { page: ID.row }, true)).toMatchObject({ account: "work", inTrash: true });
    expect(await setTrashed(deps, { page: ID.row }, false)).toMatchObject({ inTrash: false });
  });

  it("moves only within the page's own workspace", async () => {
    const deps = fakeDeps({
      personal: { getPage: async (id) => (id === ID.page ? childPage() : fail({ kind: "not_shared", accounts: ["personal"], message: "no" })) },
      work: { getPage: async (id) => (id === ID.row ? row() : fail({ kind: "not_shared", accounts: ["work"], message: "no" })) },
    });
    const error = await errorOf(() => movePage(deps, { page: ID.row, to: ID.page }));
    expect(error?.message).toContain('within its own workspace, "work"');
  });
});

describe("content and comments", () => {
  it("appends at the end of a page found by id", async () => {
    const edit = vi.fn(async () => md);
    const out = await appendContent(crm({ editContent: edit }), { page: ID.row, markdown: "- [ ] follow up", at: "end" });
    expect(edit).toHaveBeenCalledWith(ID.row, { kind: "insert", markdown: "- [ ] follow up", at: "end" });
    expect(out).toEqual({ account: "work", id: ID.row, characters: md.markdown.length });
  });

  describe("replacing a page's body", () => {
    const blocks = (n: number) => Array.from({ length: n }, (_, i) => ({ object: "block", id: `${ID.other.slice(0, -4)}${String(i).padStart(4, "0")}` }));

    it("names the page and counts its blocks before and after, past Notion's 100 a page", async () => {
      let edited = false;
      const children = vi.fn(async (_id: string, _size: number, cursor?: string) => {
        if (edited) return { ...list(blocks(2)), type: "block", block: {} };
        return cursor === undefined ? { ...list(blocks(100), "next"), type: "block", block: {} } : { ...list(blocks(20)), type: "block", block: {} };
      });
      const edit = vi.fn(async () => {
        edited = true;
        return md;
      });
      const out = await replaceContent(crm({ listBlockChildren: children as never, editContent: edit }), { page: ID.row, markdown: "# Acme\n\nNotes", allowDeleting: false, clear: false });
      expect(edit).toHaveBeenCalledWith(ID.row, { kind: "replace", markdown: "# Acme\n\nNotes", allowDeleting: false });
      expect(children.mock.calls.map((c) => [c[0], c[2]])).toEqual([[ID.row, undefined], [ID.row, "next"], [ID.row, undefined]]);
      expect(out).toEqual({ account: "work", id: ID.row, title: "Acme", blocksBefore: 120, blocksAfter: 2, characters: md.markdown.length });
    });

    it("refuses an empty body without clear, before finding the page", async () => {
      const getPage = vi.fn(async () => row());
      const edit = vi.fn(async () => md);
      const error = await errorOf(() => replaceContent(crm({ getPage, editContent: edit }), { page: ID.row, markdown: "", allowDeleting: false, clear: false }));
      expect(error).toMatchObject({ kind: "input", message: expect.stringContaining("would erase the page's whole body") });
      expect(getPage).not.toHaveBeenCalled();
      expect(edit).not.toHaveBeenCalled();
    });

    it("empties it on purpose with clear", async () => {
      const edit = vi.fn(async () => ({ ...md, markdown: "" }));
      const deps = crm({ listBlockChildren: async () => ({ ...list(blocks(3)), type: "block", block: {} }) as never, editContent: edit });
      const out = await replaceContent(deps, { page: ID.row, markdown: "", allowDeleting: false, clear: true });
      expect(edit).toHaveBeenCalledWith(ID.row, { kind: "replace", markdown: "", allowDeleting: false });
      expect(out).toMatchObject({ title: "Acme", characters: 0 });
    });
  });

  it("replies in a discussion, finding the workspace through the page", async () => {
    const add = vi.fn(async () => ({
      object: "comment",
      id: ID.other,
      discussion_id: ID.page,
      created_time: "2026-09-28T10:00:00.000Z",
      created_by: { object: "user", id: "bot" },
      rich_text: [{ plain_text: "Done" }],
      display_name: { type: "integration", resolved_name: "Example Integration" },
    }));
    const out = await addComment(crm({ addComment: add as never }), { page: ID.row, markdown: "Done", discussion: ID.page });
    expect(add).toHaveBeenCalledWith({ discussionId: ID.page }, "Done");
    expect(out).toMatchObject({ account: "work", author: "Example Integration", text: "Done" });
  });
});

describe("blocks", () => {
  const paragraph = (n: number) => ({
    object: "block",
    id: `${ID.other.slice(0, -4)}${String(n).padStart(4, "0")}`,
    type: "paragraph",
    has_children: false,
    paragraph: { rich_text: [{ plain_text: `line ${n}` }], color: "default" },
  });

  it("finds a block's workspace, reads past Notion's 100 up to the limit, and hands back the cursor", async () => {
    const children = vi.fn(async (_id: string, size: number, cursor?: string) => {
      const from = cursor === undefined ? 0 : Number(cursor);
      return { ...list(Array.from({ length: size }, (_, i) => paragraph(from + i)), String(from + size)), type: "block", block: {} };
    });
    const deps = crm({ getBlock: async (id) => (id === ID.page ? ({ object: "block", id } as never) : fail({ kind: "not_shared", accounts: ["work"], message: "no" })), listBlockChildren: children as never });
    const out = await readBlocks(deps, { block: `https://app.notion.com/p/${ID.row.replace(/-/g, "")}#${ID.page.replace(/-/g, "")}`, limit: 150 });
    expect(children.mock.calls.map((c) => [c[0], c[1], c[2]])).toEqual([
      [ID.page, 100, undefined],
      [ID.page, 50, "100"],
    ]);
    expect(out).toMatchObject({ account: "work", block: ID.page, count: 150, nextCursor: "150" });
    expect(out.blocks[149]).toEqual({ id: paragraph(149).id, type: "paragraph", text: "line 149" });
  });

  it("leaves out a partial block, which carries only its id", async () => {
    const deps = crm({
      getBlock: async (id) => ({ object: "block", id }) as never,
      listBlockChildren: async () => ({ ...list([{ object: "block", id: ID.other }, paragraph(1)]), type: "block", block: {} }) as never,
    });
    const out = await readBlocks(deps, { block: ID.page, limit: 100, account: "work" });
    expect(out).toEqual({ account: "work", block: ID.page, count: 1, blocks: [{ id: paragraph(1).id, type: "paragraph", text: "line 1" }] });
  });
});

describe("databases", () => {
  it("describes the columns of every table", async () => {
    const out = await describeDatabase(crm(), { database: ID.source });
    expect(out).toMatchObject({ account: "work", id: ID.database, title: "Project Tracker", sources: [{ id: ID.source, name: "Projects" }] });
    expect(out.sources[0]?.columns.find((c) => c.name === "Status")).toMatchObject({ type: "status", options: ["Not started", "In progress", "Done"] });
  });

  it("reads past Notion's 100 a page up to the limit, and hands back the cursor", async () => {
    const query = vi.fn(async (_id: string, plan: { cursor?: string; pageSize: number }) =>
      list(Array.from({ length: plan.pageSize }, () => row()), plan.cursor === undefined ? "p2" : "p3") as unknown as RawQuery,
    );
    const out = await queryDatabase(crm({ query: query as never }), { database: ID.database, where: [], match: "all", sort: [], limit: 150, inTrash: false });
    expect(query.mock.calls.map((c) => [c[1].pageSize, c[1].cursor])).toEqual([[100, undefined], [50, "p2"]]);
    expect(out).toMatchObject({ count: 150, nextCursor: "p3", source: ID.source });
  });

  it("counts rows per value without sending them", async () => {
    const status = (name: string | null) => row({}, { Status: { id: "st%3A1", type: "status", status: name === null ? null : { id: "x", name, color: "blue" } } });
    const query = vi.fn(async (_id: string, _plan: unknown) => list([status("Not started"), status("Not started"), status("In progress"), status(null)]) as unknown as RawQuery);
    const out = await countRows(crm({ query: query as never }), { database: ID.database, where: [], match: "all", inTrash: false, by: "status" });
    expect(out).toEqual({ account: "work", database: ID.database, source: ID.source, total: 4, by: "Status", counts: { "Not started": 2, "In progress": 1, "(empty)": 1 } });
    expect(query.mock.calls[0]?.[1]).toMatchObject({ propertyIds: ["title", "st%3A1"] });
  });
});

describe("search and health across workspaces", () => {
  const hits = (label: string, n: number, next?: string) =>
    list(Array.from({ length: n }, (_, i) => row({ id: `${label}-${i}` })), next) as unknown as RawSearch;

  it("interleaves both workspaces, carries both cursors, and reports a failing one beside the hits", async () => {
    const deps = fakeDeps({ personal: { search: async () => hits("p", 2, "pc") }, work: { search: async () => hits("w", 1) } });
    const out = await search(deps, { limit: 20 });
    expect(out.hits.map((h) => `${h.account}:${h.id}`)).toEqual(["personal:p-0", "work:w-0", "personal:p-1"]);
    expect(decodeCursors(out.nextCursor as string)).toEqual({ personal: "pc" });

    const broken = fakeDeps({ personal: { search: async () => fail({ kind: "auth", account: "personal", message: "revoked" }) }, work: { search: async () => hits("w", 1) } });
    const partial = await search(broken, { limit: 20 });
    expect(partial.hits).toHaveLength(1);
    expect(partial.failed?.["personal"]).toContain("auth");
  });

  it("says when a workspace's integration sees nothing yet", async () => {
    const me = async () => ({ object: "user", id: "bot", name: "Example Integration", type: "bot", bot: { workspace_name: "Example Co" } }) as never;
    const deps = fakeDeps({ work: { me, search: async () => list([]) as unknown as RawSearch } });
    const out = await checkHealth(deps);
    expect(out).toMatchObject({ allOk: true, accounts: [{ account: "work", workspace: "Example Co", integration: "Example Integration", seesContent: false }] });
  });
});

describe("database templates", () => {
  it("resolves the workspace and table, and carries the pagination cursor", async () => {
    const listTemplates = vi.fn(async () => ({ templates: [{ id: ID.page, name: "Monthly task", is_default: true }], has_more: true, next_cursor: ID.other }));
    const result = await listDatabaseTemplates(crm({ listTemplates }), { database: ID.database, limit: 10, cursor: ID.row });
    expect(listTemplates).toHaveBeenCalledWith(ID.source, 10, ID.row);
    expect(result).toMatchObject({ account: "work", source: ID.source, templates: [{ id: ID.page, name: "Monthly task", is_default: true }], hasMore: true, nextCursor: ID.other });
  });
});

describe("template deletion", () => {
  it("checks every catalog page before a write and requires explicit template intent", async () => {
    const update = vi.fn(async () => row({ in_trash: true }));
    const templates = vi.fn(async (_source: string, _limit: number, cursor?: string) => cursor
      ? { templates: [{ id: ID.row, name: "Blank kickoff", is_default: true }], has_more: false, next_cursor: null }
      : { templates: [], has_more: true, next_cursor: ID.other });
    const deps = crm({ listTemplates: templates, updatePage: update });
    expect(await errorOf(() => setTrashed(deps, { page: ID.row }, true))).toMatchObject({ kind: "input" });
    expect(templates).toHaveBeenCalledTimes(2);
    expect(update).not.toHaveBeenCalled();
    await setTrashed(deps, { page: ID.row, allowTemplate: true }, true);
    expect(update).toHaveBeenCalledTimes(1);
  });
});

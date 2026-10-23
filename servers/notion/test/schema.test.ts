/**
 * Schema edits: a column added, options added, a database created, each
 * checked against the schema before anything is sent; fake ports, and the
 * request bodies over a stubbed fetch.
 */
import { describe, expect, it, vi } from "vitest";

import { addColumn, addOptions, createDatabase } from "../src/app/usecases/schema.js";
import { buildDeps } from "../src/composition.js";
import { fail } from "../src/domain/errors.js";
import { childPage, COLUMNS, database, dataSource, errorOf, fakeDeps, ID, json, notionError, tokensDir, withFetch } from "./helpers.js";

const NEW_DB = "abababab-abab-4bab-8bab-abababababab";
const NEW_SOURCE = "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd";

const withColumn = (name: string, config: Record<string, unknown>) => dataSource({ properties: { ...COLUMNS, [name]: { id: "nw", name, ...config } } });
const priorityWith = (...options: { id: string; name: string }[]) =>
  dataSource({ properties: { ...COLUMNS, Priority: { ...COLUMNS.Priority, select: { options: options.map((o) => ({ ...o, color: "gray" })) } } } });

const crm = (over: Parameters<typeof fakeDeps>[0]["work"] = {}) =>
  fakeDeps({
    work: {
      getDatabase: async (id) => (id === ID.database ? database() : fail({ kind: "not_shared", accounts: ["work"], message: "no" })),
      getDataSource: async (id) => (id === ID.source ? dataSource() : fail({ kind: "not_shared", accounts: ["work"], message: "no" })),
      getPage: async (id) => (id === ID.page ? childPage() : fail({ kind: "not_shared", accounts: ["work"], message: "no" })),
      ...over,
    },
  });

describe("add_column", () => {
  it("adds a select with its options, and answers the column as Notion made it", async () => {
    const add = vi.fn(async () => withColumn("Phase", { type: "select", select: { options: [{ id: "x", name: "Design", color: "gray" }] } }));
    const out = await addColumn(crm({ addColumn: add }), { database: ID.database, column: { name: "Phase", type: "select", options: ["Design"] } });
    expect(add).toHaveBeenCalledWith(ID.source, { name: "Phase", type: "select", options: ["Design"] });
    expect(out).toEqual({ account: "work", database: ID.database, source: ID.source, column: { name: "Phase", type: "select", options: ["Design"] } });
  });

  it("points a relation at another database's table, in the same workspace", async () => {
    const add = vi.fn(async () => withColumn("Client", { type: "relation", relation: { data_source_id: ID.source } }));
    await addColumn(crm({ addColumn: add }), { database: ID.database, column: { name: "Client", type: "relation", relationTo: ID.database } });
    expect(add).toHaveBeenCalledWith(ID.source, { name: "Client", type: "relation", relatesTo: ID.source });
  });

  it("refuses, before anything is sent, a name taken, settings its type lacks, or a formula without its expression", async () => {
    const add = vi.fn();
    const deps = crm({ addColumn: add });
    const refused = async (column: Record<string, unknown>) => (await errorOf(() => addColumn(deps, { database: ID.database, column: column as never })))?.message;
    expect(await refused({ name: "status", type: "rich_text" })).toContain('there is already a column "Status"');
    expect(await refused({ name: "Cost", type: "number", options: ["a"] })).toContain("has no options");
    expect(await refused({ name: "Calc", type: "formula" })).toContain("needs its expression");
    expect(await refused({ name: "Kind", type: "select", options: ["A", "a"] })).toContain("named twice");
    expect(await refused({ name: "Link2", type: "relation" })).toContain("relation_to");
    expect(await refused({ name: "Cost", type: "number", format: "Euro €" })).toContain("format");
    expect(add).not.toHaveBeenCalled();
  });
});

describe("add_options", () => {
  it("sends the whole list back, the options there by id, and skips one already there", async () => {
    const set = vi.fn(async () => priorityWith({ id: "o1", name: "Low" }, { id: "o2", name: "High" }, { id: "o3", name: "Urgent" }));
    const out = await addOptions(crm({ setOptions: set }), { database: ID.database, column: "priority", options: ["high", "Urgent"] });
    expect(set).toHaveBeenCalledWith(ID.source, { column: "Priority", type: "select", keep: [{ id: "o1", name: "Low" }, { id: "o2", name: "High" }], add: ["Urgent"] });
    expect(out).toEqual({ account: "work", database: ID.database, source: ID.source, column: "Priority", added: ["Urgent"], alreadyThere: ["high"], options: ["Low", "High", "Urgent"] });
  });

  it("puts a new status in the group asked for", async () => {
    const set = vi.fn(async () => dataSource({ properties: { ...COLUMNS, Status: { ...COLUMNS.Status, status: { ...COLUMNS.Status.status, options: [...COLUMNS.Status.status.options, { id: "s4", name: "Cancelled", color: "gray" }] } } } }));
    await addOptions(crm({ setOptions: set }), { database: ID.database, column: "Status", options: ["Cancelled"], group: "Complete" });
    expect(set).toHaveBeenCalledWith(ID.source, expect.objectContaining({ type: "status", add: ["Cancelled"], group: "Complete" }));
  });

  it("fails loudly when the column does not read back as sent", async () => {
    const deps = crm({ setOptions: async () => priorityWith({ id: "o3", name: "Urgent" }) });
    expect((await errorOf(() => addOptions(deps, { database: ID.database, column: "Priority", options: ["Urgent"] })))?.message).toContain('"Low" is gone, "High" is gone');
  });

  it("refuses what is no change, or no option column", async () => {
    const set = vi.fn();
    const deps = crm({ setOptions: set });
    expect((await errorOf(() => addOptions(deps, { database: ID.database, column: "Priority", options: ["low"] })))?.message).toContain("every one of these already");
    expect((await errorOf(() => addOptions(deps, { database: ID.database, column: "Budget", options: ["x"] })))?.message).toContain("has no options");
    expect((await errorOf(() => addOptions(deps, { database: ID.database, column: "Priority", options: ["x"], group: "Complete" })))?.message).toContain("group is for a status column");
    expect(set).not.toHaveBeenCalled();
  });
});

describe("create_database", () => {
  const made = database({ id: NEW_DB, title: [{ type: "text", text: { content: "Contacts", link: null }, plain_text: "Contacts", href: null, annotations: {} }], data_sources: [{ id: NEW_SOURCE, name: "Contacts" }] });

  it("makes a database under a page with its columns, a relation found in the same workspace", async () => {
    const create = vi.fn(async () => made);
    const out = await createDatabase(crm({ createDatabase: create }), {
      parent: ID.page,
      title: "Contacts",
      titleColumn: "Name",
      inline: false,
      columns: [{ name: "Email", type: "email" }, { name: "Projects", type: "relation", relationTo: ID.database }],
    });
    expect(create).toHaveBeenCalledWith({
      parentPageId: ID.page,
      title: "Contacts",
      titleColumn: "Name",
      inline: false,
      columns: [{ name: "Email", type: "email" }, { name: "Projects", type: "relation", relatesTo: ID.source }],
    });
    expect(out).toMatchObject({ account: "work", id: NEW_DB, title: "Contacts", under: "Home", sources: [{ id: NEW_SOURCE, name: "Contacts" }], columns: ["Name", "Email", "Projects"] });
  });

  it("refuses a column named like the title column or another, before anything is made", async () => {
    const create = vi.fn();
    const deps = crm({ createDatabase: create });
    const base = { parent: ID.page, title: "Contacts", titleColumn: "Name", inline: false };
    expect((await errorOf(() => createDatabase(deps, { ...base, columns: [{ name: "name", type: "rich_text" }] })))?.message).toContain('already a column "Name"');
    expect((await errorOf(() => createDatabase(deps, { ...base, columns: [{ name: "A", type: "url" }, { name: "a", type: "email" }] })))?.message).toContain('already a column "A"');
    expect(create).not.toHaveBeenCalled();
  });
});

describe("the schema requests", () => {
  it("are in Notion's grammar", async () => {
    const calls = withFetch((url, init) => {
      const path = new URL(url).pathname.replace("/v1/", "");
      if (path === `databases/${ID.database}`) return json(database());
      if (path === `data_sources/${ID.source}` && init?.method === "PATCH") return json(withColumn("Cost", { type: "number", number: { format: "euro" } }));
      if (path === `data_sources/${ID.source}`) return json(dataSource());
      if (path === `pages/${ID.page}`) return json(childPage());
      if (path === "databases" && init?.method === "POST") return json({ object: "database", id: NEW_DB });
      if (path === `databases/${NEW_DB}`) return json(database({ id: NEW_DB, data_sources: [{ id: NEW_SOURCE, name: "C" }] }));
      return notionError(404, "object_not_found");
    });
    const deps = buildDeps({ NOTION_TOKENS_DIR: tokensDir({ work: "ntn_work" }) }, { sleep: async () => undefined });
    await addColumn(deps, { database: ID.database, column: { name: "Cost", type: "number", format: "euro", description: "Before tax" } });
    expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ properties: { Cost: { description: "Before tax", number: { format: "euro" } } } });
    await createDatabase(deps, { parent: ID.page, title: "C", titleColumn: "Who", inline: true, columns: [{ name: "Tags", type: "multi_select", options: ["a"] }, { name: "Done", type: "checkbox" }] });
    expect(calls.find((c) => c.method === "POST" && c.url.endsWith("/databases"))?.body).toEqual({
      parent: { type: "page_id", page_id: ID.page },
      title: [{ type: "text", text: { content: "C" } }],
      is_inline: true,
      initial_data_source: { properties: { Who: { title: {} }, Tags: { multi_select: { options: [{ name: "a" }] } }, Done: { checkbox: {} } } },
    });
  });

  it("sends an option list whole", async () => {
    const calls = withFetch((url, init) => {
      const path = new URL(url).pathname.replace("/v1/", "");
      if (path === `databases/${ID.database}`) return json(database());
      if (path === `data_sources/${ID.source}` && init?.method === "PATCH") return json(priorityWith({ id: "o1", name: "Low" }, { id: "o2", name: "High" }, { id: "o9", name: "Urgent" }));
      if (path === `data_sources/${ID.source}`) return json(dataSource());
      return notionError(404, "object_not_found");
    });
    const deps = buildDeps({ NOTION_TOKENS_DIR: tokensDir({ work: "ntn_work" }) }, { sleep: async () => undefined });
    await addOptions(deps, { database: ID.database, column: "Priority", options: ["Urgent"] });
    expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ properties: { Priority: { select: { options: [{ id: "o1", name: "Low" }, { id: "o2", name: "High" }, { name: "Urgent" }] } } } });
  });
});

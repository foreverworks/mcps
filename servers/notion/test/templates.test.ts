/**
 * A row from a template: the database's default or one named, checked against
 * its own catalog before anything is made.
 */
import { describe, expect, it, vi } from "vitest";

import { createPage } from "../src/app/usecases/pages.js";
import { buildDeps } from "../src/composition.js";
import { fail } from "../src/domain/errors.js";
import { childPage, database, dataSource, errorOf, fakeDeps, ID, json, notionError, row, tokensDir, withFetch } from "./helpers.js";

const TPL = { kickoff: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", blank: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" };
const catalog = (defaults = true) => ({
  templates: [
    { id: TPL.kickoff, name: "Kickoff notes", is_default: defaults },
    { id: TPL.blank, name: "Blank", is_default: false },
  ],
  has_more: false,
  next_cursor: null,
});

const crm = (over: Parameters<typeof fakeDeps>[0]["work"] = {}) =>
  fakeDeps({
    work: {
      getDatabase: async (id) => (id === ID.database ? database() : fail({ kind: "not_shared", accounts: ["work"], message: "no" })),
      getDataSource: async (id) => (id === ID.source ? dataSource() : fail({ kind: "not_shared", accounts: ["work"], message: "no" })),
      getPage: async (id) => (id === ID.page ? childPage() : fail({ kind: "not_shared", accounts: ["work"], message: "no" })),
      listTemplates: async () => catalog() as never,
      createPage: async () => row({ id: ID.other }),
      ...over,
    },
  });

const base = { parent: ID.database, properties: {}, allowNewOptions: false };

describe("create_page from a template", () => {
  it("starts a row from the database's default template, keeping the properties given", async () => {
    const create = vi.fn(async () => row({ id: ID.other }));
    const out = await createPage(crm({ createPage: create }), { ...base, title: "Globex", properties: { Status: "Not started" }, template: "default" });
    expect(out).toMatchObject({ account: "work", id: ID.other, template: { id: TPL.kickoff, name: "Kickoff notes" } });
    expect(create).toHaveBeenCalledWith({
      parent: { type: "data_source", id: ID.source },
      properties: { Status: { type: "status", name: "Not started" }, Name: { type: "title", runs: ["Globex"] } },
      template: { type: "default" },
    });
  });

  it("names a template by name, in any case, or by id", async () => {
    const create = vi.fn(async () => row({ id: ID.other }));
    const deps = crm({ createPage: create });
    await createPage(deps, { ...base, template: "blank" });
    expect(create).toHaveBeenLastCalledWith(expect.objectContaining({ template: { type: "template_id", id: TPL.blank } }));
    await createPage(deps, { ...base, template: TPL.kickoff.replace(/-/g, "") });
    expect(create).toHaveBeenLastCalledWith(expect.objectContaining({ template: { type: "template_id", id: TPL.kickoff } }));
  });

  it("refuses, before anything is made, a template the database does not have, a default it lacks, a body beside it, or a page parent", async () => {
    const create = vi.fn();
    const deps = crm({ createPage: create });
    expect((await errorOf(() => createPage(deps, { ...base, template: "Invoice" })))?.message).toContain('its templates are "Kickoff notes" (the default), "Blank"');
    expect((await errorOf(() => createPage(crm({ createPage: create, listTemplates: async () => catalog(false) as never }), { ...base, template: "default" })))?.message).toContain("no default template");
    expect((await errorOf(() => createPage(deps, { ...base, template: "Blank", markdown: "## Notes" })))?.message).toContain("append_content");
    expect((await errorOf(() => createPage(deps, { ...base, parent: ID.page, template: "Blank" })))?.message).toContain("belongs to a database");
    expect(create).not.toHaveBeenCalled();
  });

  it("sends Notion its template grammar", async () => {
    const calls = withFetch((url, init) => {
      const path = new URL(url).pathname.replace("/v1/", "");
      if (path === `databases/${ID.database}`) return json(database());
      if (path === `data_sources/${ID.source}`) return json(dataSource());
      if (path === `data_sources/${ID.source}/templates`) return json(catalog());
      if (path === "pages" && init?.method === "POST") return json(row({ id: ID.other }));
      return notionError(404, "object_not_found");
    });
    const deps = buildDeps({ NOTION_TOKENS_DIR: tokensDir({ work: "ntn_work" }) }, { sleep: async () => undefined });
    await createPage(deps, { ...base, template: "Blank" });
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({
      parent: { type: "data_source_id", data_source_id: ID.source },
      properties: {},
      template: { type: "template_id", template_id: TPL.blank },
    });
  });
});

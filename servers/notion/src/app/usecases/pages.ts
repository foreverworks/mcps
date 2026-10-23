import { compact, mapWithConcurrency } from "@foreverworks/mcp-kit";

import { chooseAccounts } from "../../domain/accounts.js";
import { type Column, columnsOf, titleOf } from "../../domain/columns.js";
import { asAppError, fail, inputError, required } from "../../domain/errors.js";
import { toId } from "../../domain/ids.js";
import { parentOf, toPage } from "../../domain/models.js";
import { type Json, pageTitle, readProperties } from "../../domain/properties/read.js";
import { rowWrites, toWrites, type Writes } from "../../domain/properties/write.js";
import type { RawPage } from "../../domain/schema.js";
import { pickSource } from "../../domain/sources.js";
import type { Found } from "../locate.js";
import { pickTemplate } from "../../domain/templates.js";
import type { Deps, NewParent, NotionPort } from "../ports.js";
import { allRelated } from "./pages/relations.js";
import { templatesOf } from "./templates.js";
import { peopleNames } from "./users.js";

/** A page under a page has one property, its title, keyed `title`. */
const PAGE_COLUMNS: readonly Column[] = [{ id: "title", name: "title", type: "title" }];

/** Relation fills in flight at once: each is its own paginated read. */
const FILL_CONCURRENCY = 3;

/** A page, found in whichever workspace has it; a database id is refused with the tools that take one. */
export const pageOf = async (deps: Deps, page: string, account: string | undefined): Promise<{ readonly account: string; readonly raw: RawPage }> => {
  const found = await deps.locator.find(toId(page, "page"), ["page", "database", "data_source"], account);
  if (found.kind === "page") return { account: found.account, raw: found.page };
  return fail(inputError(`that id is a ${found.kind === "database" ? "database" : "data source"}, not a page: use describe_database or query_database`));
};

/** The columns a page's properties are written against: its data source's, or the lone title of a page under a page. */
export const columnsFor = async (deps: Deps, account: string, raw: RawPage): Promise<readonly Column[]> => {
  const parent = raw.parent as { readonly type: string; readonly data_source_id?: string };
  return parent.type === "data_source_id" && parent.data_source_id !== undefined
    ? columnsOf(await deps.schema(account, parent.data_source_id))
    : PAGE_COLUMNS;
};

/** Every property of a page, with each relation past its first 25 pages read in full and each person named. */
const fullProperties = async (deps: Deps, account: string, raw: RawPage): Promise<Readonly<Record<string, Json>>> => {
  const api = deps.accounts.api(account);
  const { values, truncated } = readProperties(raw.properties, await peopleNames(deps, account, [raw]));
  if (truncated.length === 0) return values;
  const filled = await mapWithConcurrency(truncated, FILL_CONCURRENCY, async (t) => [t.name, await allRelated(api, raw.id, t.propertyId)] as const);
  return { ...values, ...Object.fromEntries(filled.map(([name, r]) => [name, r.capped ? [...r.ids, "<more>"] : r.ids])) };
};

export type ReadPageArgs = { readonly page: string; readonly account?: string; readonly content: boolean; readonly includeTranscript: boolean };

/**
 * One page: its properties, and its body as Notion's Markdown. A body past
 * Notion's ~20,000 blocks comes back cut, with the ids of the blocks it left
 * out; each can be read as a page of its own.
 */
export const readPage = async (deps: Deps, args: ReadPageArgs) => {
  const { account, raw } = await pageOf(deps, args.page, args.account);
  const api = deps.accounts.api(account);
  const [properties, body] = await Promise.all([
    fullProperties(deps, account, raw),
    args.content ? api.getMarkdown(raw.id, args.includeTranscript) : Promise.resolve(undefined),
  ]);
  return {
    ...toPage(account, raw, properties),
    ...(body === undefined
      ? {}
      : {
          markdown: body.markdown,
          ...(body.truncated ? { contentTruncated: true, unknownBlockIds: body.unknown_block_ids } : {}),
        }),
  };
};

export type CreatePageArgs = {
  /** A database (a row in it), a data source, or a page (a child page); absent: the top level of `account`. */
  readonly parent?: string;
  readonly source?: string;
  readonly title?: string;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly markdown?: string;
  readonly icon?: string;
  /** "default", or a template's name or id: Notion fills the row from it after making it. */
  readonly template?: string;
  readonly allowNewOptions: boolean;
  readonly account?: string;
};

/** Where a new page goes, and the columns its properties are checked against. */
const newParent = async (deps: Deps, found: Extract<Found, { readonly kind: "page" | "database" | "data_source" }>, source: string | undefined): Promise<{ readonly parent: NewParent; readonly columns: readonly Column[]; readonly into: string }> => {
  switch (found.kind) {
    case "page":
      return { parent: { type: "page", id: found.page.id }, columns: PAGE_COLUMNS, into: pageTitle(found.page.properties) };
    case "data_source":
      return { parent: { type: "data_source", id: found.source.id }, columns: columnsOf(found.source), into: titleOf(found.source) };
    case "database": {
      const id = pickSource(found.database, source);
      const schema = await deps.schema(found.account, id);
      return { parent: { type: "data_source", id }, columns: columnsOf(schema), into: titleOf(schema) };
    }
  }
};

/** A row in a database, with its properties checked against the columns, or a child page. Either with a Markdown body. */
export const createPage = async (deps: Deps, args: CreatePageArgs) => {
  if (args.parent === undefined) return createTopLevel(deps, args);
  const found = await deps.locator.find(toId(args.parent, "parent"), ["database", "data_source", "page"], args.account);
  const { parent, columns, into } = await newParent(deps, found, args.source);
  if (parent.type === "page" && Object.keys(args.properties).length > 0) {
    return fail(inputError("a page under a page has only a title; properties are for a row in a database"));
  }
  const writes = rowWrites(columns, args.title, args.properties, { allowNewOptions: args.allowNewOptions });
  const api = deps.accounts.api(found.account);
  const template = args.template === undefined ? undefined : await templateFor(api, parent, args);
  const created = await api.createPage(compact({ parent, properties: writes, markdown: args.markdown, icon: args.icon, template: template?.choice }));
  deps.locator.learn(created.id, found.account, "page");
  return compact({
    account: found.account,
    id: created.id,
    url: created.url,
    title: pageTitle(created.properties),
    in: into,
    template: template === undefined ? undefined : { id: template.template.id, name: template.template.name },
  });
};

/**
 * The template a new row starts from, checked against its database's own
 * catalog. Notion fills the page from it after making it (the answer is the
 * blank page), so a body of the caller's own would race the template's and is
 * refused: append_content adds to the page once the template is in.
 */
const templateFor = async (api: NotionPort, parent: NewParent, args: CreatePageArgs) => {
  if (parent.type !== "data_source") return fail(inputError("a template belongs to a database: give the database as parent"));
  if (args.markdown !== undefined) {
    return fail(inputError("a template fills the page's body, so markdown is refused beside it; append_content adds to the page once the template is in"));
  }
  return pickTemplate(await templatesOf(api, parent.id), args.template as string);
};

/**
 * A private page at the top level of a workspace: what a personal access token
 * can make and an integration token cannot (Notion answers the latter with a
 * validation error, reported as such). With no parent to find the workspace
 * by, `account` has to name exactly one.
 */
const createTopLevel = async (deps: Deps, args: CreatePageArgs) => {
  const accounts = chooseAccounts(args.account, await deps.accounts.labels());
  const account = accounts.length === 1 ? (accounts[0] as string) : fail(inputError(`a page with no parent goes to the top level of one workspace: name it with account (${accounts.join(" or ")})`));
  if (Object.keys(args.properties).length > 0) return fail(inputError("a top-level page has only a title; properties are for a row in a database"));
  const created = await deps.accounts.api(account).createPage(
    compact({ parent: { type: "workspace" as const }, properties: rowWrites(PAGE_COLUMNS, args.title, {}, { allowNewOptions: false }), markdown: args.markdown, icon: args.icon }),
  );
  deps.locator.learn(created.id, account, "page");
  return { account, id: created.id, url: created.url, title: pageTitle(created.properties), in: "(top level)" };
};

export type UpdatePageArgs = {
  readonly page: string;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly icon?: string | null;
  readonly allowNewOptions: boolean;
  readonly account?: string;
};

/** Change a page's properties (a database row's columns, or a page's title), and its icon. */
export const updatePage = async (deps: Deps, args: UpdatePageArgs) => {
  const { account, raw } = await pageOf(deps, args.page, args.account);
  if (Object.keys(args.properties).length === 0 && args.icon === undefined) return fail(inputError("nothing to change: give properties or icon"));
  const writes: Writes = toWrites(await columnsFor(deps, account, raw), args.properties, { allowNewOptions: args.allowNewOptions });
  const api = deps.accounts.api(account);
  const updated = await api.updatePage(raw.id, compact({ properties: Object.keys(writes).length > 0 ? writes : undefined, icon: args.icon }));
  return toPage(account, updated, await fullProperties(deps, account, updated));
};

/** Into Notion's trash, or back out of it. Trash is kept 30 days, so neither is gated. */
export const setTrashed = async (deps: Deps, args: { readonly page: string; readonly account?: string; readonly allowTemplate?: boolean }, inTrash: boolean) => {
  const account = await deps.locator.accountOf(toId(args.page, "page"), ["page"], args.account);
  const api = deps.accounts.api(account);
  const id = toId(args.page, "page");
  if (inTrash && !args.allowTemplate) {
    const raw = await api.getPage(id);
    const parent = parentOf(raw.parent);
    if (parent.type === "database") {
      const sources = parent.dataSourceId ? [parent.dataSourceId] : (await api.getDatabase(required(parent.id, "parent database id"))).data_sources.map(source => source.id);
      for (const sourceId of sources) {
        let cursor: string | undefined;
        do {
          const catalog = await api.listTemplates(sourceId, 100, cursor);
          const template = catalog.templates.find(item => item.id === id);
          if (template) return fail(inputError(`"${template.name}" is a database template${template.is_default ? " (the default)" : ""}; inspect list_database_templates and use allow_template only when removing the template is intended`));
          if (catalog.has_more && !catalog.next_cursor) return fail(inputError("template catalog is incomplete; refusing to trash without checking it"));
          cursor = catalog.has_more ? (catalog.next_cursor ?? undefined) : undefined;
        } while (cursor);
      }
    }
  }
  const updated = await api.updatePage(id, { inTrash });
  return { account, id: updated.id, title: pageTitle(updated.properties), inTrash: updated.in_trash };
};

export type MovePageArgs = { readonly page: string; readonly to: string; readonly source?: string; readonly account?: string };

/**
 * Under another page, or into a database. Only inside one workspace: Notion
 * cannot move a page between workspaces, so the destination is looked for in
 * the page's own.
 */
export const movePage = async (deps: Deps, args: MovePageArgs) => {
  const { account, raw } = await pageOf(deps, args.page, args.account);
  const target = await deps.locator.find(toId(args.to, "to"), ["page", "database", "data_source"], account).catch((thrown: unknown) => {
    const error = asAppError(thrown);
    if (error?.kind !== "not_shared") throw thrown;
    return fail({ ...error, message: `${error.message}; a page moves only within its own workspace, "${account}"` });
  });
  const { parent } = await newParent(deps, target, args.source);
  const moved = await deps.accounts.api(account).movePage(raw.id, parent);
  return { account, id: moved.id, title: pageTitle(moved.properties), parent: parentOf(moved.parent) };
};

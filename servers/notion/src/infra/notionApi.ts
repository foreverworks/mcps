import { randomUUID } from "node:crypto";

import { compact, type HttpRequest } from "@foreverworks/mcp-kit";

import type { NotionPort } from "../app/ports.js";
import type {
  RawTemplates,
  RawBlockAnswer,
  RawBlockChildren,
  RawComment,
  RawComments,
  RawDatabase,
  RawDataSource,
  RawFileUpload,
  RawMarkdown,
  RawPage,
  RawPropertyItems,
  RawQuery,
  RawSearch,
  RawUser,
  RawUserList,
  RawView,
  RawViewList,
  RawViewQuery,
  RawViewQueryPage,
} from "../domain/schema.js";
import { multipartFile } from "../domain/files.js";
import { API } from "./http.js";
import {
  columnBody,
  databaseBody,
  editBody,
  fileBlockBody,
  filterBody,
  iconBody,
  optionsBody,
  parentBody,
  propertiesBody,
  sortsBody,
  templateBody,
} from "./notionApi/bodies.js";

/**
 * The endpoints: the only file where Notion's paths and parameter names
 * appear. Each write says whether sending it twice is harmless, because the
 * kit resends only what is.
 */

const at = (...parts: readonly string[]): string => `${API}/${parts.map(encodeURIComponent).join("/")}`;

/**
 * A property id as `filter_properties` wants it. Ids come back URL-encoded in
 * JSON (`Hx%3FL`) and are used as-is in a path; a query parameter is encoded
 * again on the way out, so it is decoded first, or Notion would read `%3F`.
 */
const plainPropertyId = (id: string): string => {
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
};

/** Path segments are encoded by `at`; a property id is already encoded, so it goes in as Notion gave it. */
const propertyPath = (pageId: string, propertyId: string): string => `${at("pages", pageId, "properties")}/${propertyId}`;

export const makeNotionApi = (request: HttpRequest): NotionPort => {
  const getPage = (id: string) => request<RawPage>(at("pages", id));

  /** Some writes may answer with only `{object, id}`; the tools want the page. */
  const full = async (answer: RawPage | { readonly object: "page"; readonly id: string }): Promise<RawPage> =>
    "properties" in answer ? answer : getPage(answer.id);

  return {
    me: () => request<RawUser>(at("users", "me")),

    listUsers: (pageSize, cursor) => request<RawUserList>(at("users"), { query: { page_size: pageSize, start_cursor: cursor } }),

    search: (spec) =>
      request<RawSearch>(at("search"), {
        method: "POST",
        idempotent: true,
        json: compact({
          query: spec.query,
          filter: spec.kind === undefined ? undefined : { property: "object", value: spec.kind === "database" ? "data_source" : "page" },
          // With no query Notion's order is undefined; newest edit first is what "list" means.
          sort: spec.query === undefined || spec.query === "" ? { timestamp: "last_edited_time", direction: "descending" } : undefined,
          page_size: spec.pageSize,
          start_cursor: spec.cursor,
        }),
      }),

    getPage,

    listTemplates: (id, pageSize, cursor) => request<RawTemplates>(at("data_sources", id, "templates"), { query: { page_size: pageSize, start_cursor: cursor } }),

    listViews: (databaseId, pageSize, cursor) =>
      request<RawViewList>(at("views"), { query: { database_id: databaseId, page_size: pageSize, start_cursor: cursor } }),

    getView: (id) => request<RawView>(at("views", id)),

    // Runs the saved view and caches the result; a second run is a second cache, never a change.
    queryView: (viewId, pageSize) =>
      request<RawViewQuery>(at("views", viewId, "queries"), { method: "POST", idempotent: true, json: { page_size: pageSize } }),

    viewQueryPage: (viewId, queryId, pageSize, cursor) =>
      request<RawViewQueryPage>(at("views", viewId, "queries", queryId), { query: { page_size: pageSize, start_cursor: cursor } }),

    getPropertyItems: (pageId, propertyId, cursor) =>
      request<RawPropertyItems>(propertyPath(pageId, propertyId), { query: { page_size: 100, start_cursor: cursor } }),

    getMarkdown: (id, includeTranscript) =>
      request<RawMarkdown>(at("pages", id, "markdown"), { query: includeTranscript ? { include_transcript: true } : {} }),

    getBlock: (id) => request<RawBlockAnswer>(at("blocks", id)),

    listBlockChildren: (id, pageSize, cursor) =>
      request<RawBlockChildren>(at("blocks", id, "children"), { query: { page_size: pageSize, start_cursor: cursor } }),

    getDatabase: (id) => request<RawDatabase>(at("databases", id)),

    // The same column, or the same whole option list, sent twice leaves the same schema.
    addColumn: (dataSourceId, spec) =>
      request<RawDataSource>(at("data_sources", dataSourceId), { method: "PATCH", idempotent: true, json: { properties: { [spec.name]: columnBody(spec) } } }),
    setOptions: (dataSourceId, change) =>
      request<RawDataSource>(at("data_sources", dataSourceId), { method: "PATCH", idempotent: true, json: { properties: { [change.column]: optionsBody(change) } } }),

    // A new database twice is two databases: never resent blind.
    createDatabase: async (db) => {
      const made = await request<RawDatabase | { readonly object: "database"; readonly id: string }>(at("databases"), { method: "POST", idempotent: false, json: databaseBody(db) });
      return "data_sources" in made ? made : request<RawDatabase>(at("databases", made.id));
    },
    getDataSource: (id) => request<RawDataSource>(at("data_sources", id)),

    query: (dataSourceId, plan) =>
      request<RawQuery>(at("data_sources", dataSourceId, "query"), {
        method: "POST",
        idempotent: true,
        query: { filter_properties: plan.propertyIds?.map(plainPropertyId) },
        json: compact({
          filter: plan.filter === undefined ? undefined : filterBody(plan.filter),
          sorts: plan.sorts.length === 0 ? undefined : sortsBody(plan.sorts),
          page_size: plan.pageSize,
          start_cursor: plan.cursor,
          in_trash: plan.inTrash ? true : undefined,
          result_type: "page",
        }),
      }),

    // A new page twice is two pages: never resent blind.
    createPage: async (page) =>
      full(
        await request<RawPage>(at("pages"), {
          method: "POST",
          idempotent: false,
          json: compact({
            parent: parentBody(page.parent),
            properties: propertiesBody(page.properties),
            markdown: page.markdown,
            icon: page.icon === undefined ? undefined : iconBody(page.icon),
            template: page.template === undefined ? undefined : templateBody(page.template),
          }),
        }),
      ),

    // Setting the same values twice leaves the same page.
    updatePage: async (id, patch) =>
      full(
        await request<RawPage>(at("pages", id), {
          method: "PATCH",
          idempotent: true,
          json: compact({
            properties: patch.properties === undefined ? undefined : propertiesBody(patch.properties),
            in_trash: patch.inTrash,
            icon: patch.icon === undefined ? undefined : iconBody(patch.icon),
            is_locked: patch.locked,
          }),
        }),
      ),

    // Moving to where it already is changes nothing.
    movePage: async (id, to) =>
      full(await request<RawPage>(at("pages", id, "move"), { method: "POST", idempotent: true, json: { parent: parentBody(to) } })),

    // An insert inserts again and a find-and-replace finds nothing the second time;
    // replacing the whole body with the same text is the one repeatable edit.
    editContent: (id, edit) =>
      request<RawMarkdown>(at("pages", id, "markdown"), { method: "PATCH", idempotent: edit.kind === "replace", json: editBody(edit) }),

    // An upload nothing attaches is forgotten within the hour: a second one changes nothing a person sees.
    createFileUpload: (filename, contentType) =>
      request<RawFileUpload>(at("file_uploads"), { method: "POST", idempotent: true, json: { mode: "single_part", filename, content_type: contentType } }),

    // The bytes go once: a second send to the same upload is refused, so it is never resent blind.
    sendFileUpload: (id, filename, contentType, bytes) => {
      const boundary = `notion-mcp-${randomUUID()}`;
      return request<RawFileUpload>(at("file_uploads", id, "send"), {
        method: "POST",
        idempotent: false,
        body: { contentType: `multipart/form-data; boundary=${boundary}`, data: multipartFile(boundary, filename, contentType, bytes) },
      });
    },

    // An append appends again: never resent blind.
    appendFileBlock: (pageId, type, uploadId) =>
      request<RawBlockChildren>(at("blocks", pageId, "children"), { method: "PATCH", idempotent: false, json: { children: [fileBlockBody(type, uploadId)] } }),

    listComments: (pageId, pageSize, cursor) =>
      request<RawComments>(at("comments"), { query: { block_id: pageId, page_size: pageSize, start_cursor: cursor } }),

    // A comment twice is two comments. A partial answer is completed by id.
    addComment: async (target, markdown) => {
      const made = await request<RawComment | { readonly object: "comment"; readonly id: string }>(at("comments"), {
        method: "POST",
        idempotent: false,
        json: "pageId" in target ? { parent: { page_id: target.pageId }, markdown } : { discussion_id: target.discussionId, markdown },
      });
      return "rich_text" in made ? made : request<RawComment>(at("comments", made.id));
    },
  };
};

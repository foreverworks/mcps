import type { NewPageParent } from "../../app/ports.js";
import type { ContentEdit } from "../../domain/content.js";
import type { PropertyWrite, Writes } from "../../domain/properties/write.js";
import type { Filter } from "../../domain/query/filter.js";
import type { Sort } from "../../domain/query.js";
import type { FileBlockType } from "../../domain/files.js";
import type { ColumnSpec, NewDatabase, OptionsChange } from "../../domain/schemaEdits.js";
import type { TemplateChoice } from "../../domain/templates.js";

/**
 * The domain's checked changes in Notion's request grammar (API 2026-03-11).
 * The only place a request body is shaped; every name below is Notion's.
 */

const runs = (texts: readonly string[]) => texts.map((content) => ({ type: "text", text: { content } }));

export const propertyValue = (write: PropertyWrite): Record<string, unknown> => {
  switch (write.type) {
    case "title":
    case "rich_text":
      return { [write.type]: runs(write.runs) };
    case "number":
      return { number: write.value };
    case "select":
    case "status":
      return { [write.type]: write.name === null ? null : { name: write.name } };
    case "multi_select":
      return { multi_select: write.names.map((name) => ({ name })) };
    case "date":
      return {
        date:
          write.date === null
            ? null
            : { start: write.date.start, ...(write.date.end === undefined ? {} : { end: write.date.end }), ...(write.date.timeZone === undefined ? {} : { time_zone: write.date.timeZone }) },
      };
    case "checkbox":
      return { checkbox: write.value };
    case "url":
    case "email":
    case "phone_number":
      return { [write.type]: write.value };
    case "relation":
      return { relation: write.ids.map((id) => ({ id })) };
    case "files":
      return {
        files: write.files.map((f) =>
          "uploadId" in f ? { name: f.name, type: "file_upload", file_upload: { id: f.uploadId } } : { name: f.name, type: "external", external: { url: f.url } },
        ),
      };
  }
};

export const propertiesBody = (writes: Writes): Record<string, unknown> =>
  Object.fromEntries(Object.entries(writes).map(([name, write]) => [name, propertyValue(write)]));

export const filterBody = (filter: Filter): Record<string, unknown> => {
  switch (filter.kind) {
    case "group":
      return { [filter.match === "all" ? "and" : "or"]: filter.filters.map(filterBody) };
    case "property":
      return { property: filter.property, [filter.key]: { [filter.op]: filter.value } };
    case "formula":
      return { property: filter.property, formula: { [filter.result]: { [filter.op]: filter.value } } };
    case "timestamp":
      return { timestamp: filter.timestamp, [filter.timestamp]: { [filter.op]: filter.value } };
    case "raw":
      return { ...filter.filter };
  }
};

export const sortsBody = (sorts: readonly Sort[]) =>
  sorts.map((s) => (s.kind === "property" ? { property: s.property, direction: s.direction } : { timestamp: s.timestamp, direction: s.direction }));

export const parentBody = (parent: NewPageParent) =>
  parent.type === "workspace"
    ? { type: "workspace", workspace: true }
    : parent.type === "page"
      ? { type: "page_id", page_id: parent.id }
      : { type: "data_source_id", data_source_id: parent.id };

export const iconBody = (icon: string | null) => (icon === null ? null : { type: "emoji", emoji: icon });

export const editBody = (edit: ContentEdit): Record<string, unknown> => {
  switch (edit.kind) {
    case "insert":
      return {
        type: "insert_content",
        insert_content:
          typeof edit.at === "string" ? { content: edit.markdown, position: { type: edit.at } } : { content: edit.markdown, after: edit.at.after },
      };
    case "update":
      return {
        type: "update_content",
        update_content: {
          content_updates: edit.updates.map((u) => ({ old_str: u.old, new_str: u.new, replace_all_matches: u.all })),
          allow_deleting_content: edit.allowDeleting,
        },
      };
    case "replace":
      return { type: "replace_content", replace_content: { new_str: edit.markdown, allow_deleting_content: edit.allowDeleting } };
  }
};

export const templateBody = (template: TemplateChoice) =>
  template.type === "default" ? { type: "default" } : { type: "template_id", template_id: template.id };

/** A block in a page's body holding an uploaded file. */
export const fileBlockBody = (type: FileBlockType, uploadId: string) => ({ object: "block", type, [type]: { type: "file_upload", file_upload: { id: uploadId } } });

/** A new column's configuration in Notion's grammar: the type's own key, with its settings. */
export const columnBody = (spec: ColumnSpec): Record<string, unknown> => {
  const config = (() => {
    switch (spec.type) {
      case "number":
        return { number: spec.format === undefined ? {} : { format: spec.format } };
      case "select":
      case "multi_select":
      case "status":
        return { [spec.type]: spec.options === undefined ? {} : { options: spec.options.map((name) => ({ name })) } };
      case "formula":
        return { formula: { expression: spec.expression } };
      case "relation":
        return { relation: { data_source_id: spec.relatesTo, type: "single_property", single_property: {} } };
      default:
        return { [spec.type]: {} };
    }
  })();
  return { ...(spec.description === undefined ? {} : { description: spec.description }), ...config };
};

/** A column's whole option list: every option there now by id, then the new ones by name. */
export const optionsBody = (change: OptionsChange) => ({
  [change.type]: {
    options: [...change.keep.map((o) => ({ id: o.id, name: o.name })), ...change.add.map((name) => ({ name, ...(change.group === undefined ? {} : { group: change.group }) }))],
  },
});

export const databaseBody = (db: NewDatabase) => ({
  parent: { type: "page_id", page_id: db.parentPageId },
  title: runs([db.title]),
  is_inline: db.inline,
  initial_data_source: { properties: { [db.titleColumn]: { title: {} }, ...Object.fromEntries(db.columns.map((c) => [c.name, columnBody(c)])) } },
});

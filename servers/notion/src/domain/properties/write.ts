import { type Column, findColumn, matchOption, optionList, titleColumn } from "../columns.js";
import { fail, inputError } from "../errors.js";
import { parseId } from "../ids.js";
import { toRuns } from "../text.js";
import { type DateInput, parseDate } from "../dates.js";

/**
 * A value an agent gave for a column, checked against the column's type and
 * options, as the change to make. infra/notionApi/bodies.ts turns it into
 * Notion's wire shape; nothing here knows that shape.
 *
 * Refused rather than guessed: a select option that does not exist (unless the
 * caller asks for new options), any status that does not exist (the API
 * cannot make one), and every column Notion computes.
 */
export type PropertyWrite =
  | { readonly type: "title" | "rich_text"; readonly runs: readonly string[] }
  | { readonly type: "number"; readonly value: number | null }
  | { readonly type: "select" | "status"; readonly name: string | null }
  | { readonly type: "multi_select"; readonly names: readonly string[] }
  | { readonly type: "date"; readonly date: DateInput | null }
  | { readonly type: "checkbox"; readonly value: boolean }
  | { readonly type: "url" | "email" | "phone_number"; readonly value: string | null }
  | { readonly type: "relation"; readonly ids: readonly string[] }
  | { readonly type: "files"; readonly files: readonly FileRef[] };

/** A file a files column is written with: an external link, or a file uploaded to Notion (upload_file). */
export type FileRef = { readonly name: string; readonly url: string } | { readonly name: string; readonly uploadId: string };

/** Columns whose value Notion computes. */
const COMPUTED = new Set(["formula", "rollup", "created_time", "created_by", "last_edited_time", "last_edited_by", "unique_id", "button"]);

/** Notion's limit on the pages one relation value may list in a write. */
export const RELATION_LIMIT = 100;

export type WriteOptions = {
  /** Let a select or multi-select value add an option the column does not have yet. */
  readonly allowNewOptions: boolean;
};

const wrong = (column: Column, expected: string, value: unknown): never =>
  fail(inputError(`column "${column.name}" is ${column.type} and takes ${expected}, not ${JSON.stringify(value)}`));

const optionFor = (column: Column, value: unknown, options: WriteOptions): string => {
  if (typeof value !== "string" || value.trim() === "") return wrong(column, "an option name", value);
  const matched = matchOption(column, value.trim());
  if (matched !== undefined) return matched;
  if (column.type === "status") {
    return fail(inputError(`status "${value}" does not exist in column "${column.name}", and Notion's API cannot add one; ${optionList(column)}`));
  }
  if (options.allowNewOptions) return value.trim();
  return fail(
    inputError(`option "${value}" does not exist in column "${column.name}"; ${optionList(column)}. Pass allow_new_options: true to add it`),
  );
};

const asList = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : [value]);

const text = (column: Column, value: unknown): string | null => {
  if (value === null) return null;
  if (typeof value !== "string") return wrong(column, "a string", value);
  return value.trim() === "" ? null : value.trim();
};

/** The change one value makes to one column. `null` clears the column where Notion allows it. */
export const toWrite = (column: Column, value: unknown, options: WriteOptions): PropertyWrite => {
  if (COMPUTED.has(column.type)) return fail(inputError(`column "${column.name}" is ${column.type}; Notion computes it and it cannot be written`));
  switch (column.type) {
    case "title":
    case "rich_text": {
      if (value !== null && typeof value !== "string") return wrong(column, "a string", value);
      return { type: column.type, runs: value === null ? [] : toRuns(value, `column "${column.name}"`) };
    }
    case "number":
      if (value === null) return { type: "number", value: null };
      if (typeof value === "number" && Number.isFinite(value)) return { type: "number", value };
      return wrong(column, "a finite number or null", value);
    case "select":
    case "status":
      return { type: column.type, name: value === null ? null : optionFor(column, value, options) };
    case "multi_select":
      return { type: "multi_select", names: value === null ? [] : [...new Set(asList(value).map((v) => optionFor(column, v, options)))] };
    case "date":
      return { type: "date", date: value === null ? null : parseDate(value, `column "${column.name}"`) };
    case "checkbox":
      return typeof value === "boolean" ? { type: "checkbox", value } : wrong(column, "true or false", value);
    case "url":
    case "email":
    case "phone_number":
      return { type: column.type, value: text(column, value) };
    case "relation": {
      const ids = value === null ? [] : asList(value).map((v) => (typeof v === "string" ? parseId(v) : undefined) ?? wrong(column, "page ids or Notion URLs", v));
      if (ids.length > RELATION_LIMIT) return fail(inputError(`column "${column.name}" takes at most ${RELATION_LIMIT} pages in one write`));
      return { type: "relation", ids: [...new Set(ids)] };
    }
    case "files":
      return {
        type: "files",
        files: value === null ? [] : asList(value).map((v) => fileOf(column, v)),
      };
    case "people":
      return fail(inputError(`column "${column.name}" is people; this server does not write people columns`));
    default:
      return fail(inputError(`column "${column.name}" is ${column.type}, which this server does not write`));
  }
};

const fileOf = (column: Column, value: unknown): { readonly name: string; readonly url: string } => {
  const url = typeof value === "string" ? value : (value as { url?: unknown } | null)?.url;
  if (typeof url !== "string" || !/^https?:\/\//.test(url)) return wrong(column, "external file URLs (or {name, url})", value);
  const name = (value as { name?: unknown } | null)?.name;
  return { name: typeof name === "string" && name.trim() !== "" ? name.trim() : (url.split("/").pop() ?? url).slice(0, 100), url };
};

/** Column name -> the change, for every column a call names. A column named twice is ambiguous. */
export type Writes = Readonly<Record<string, PropertyWrite>>;

export const toWrites = (columns: readonly Column[], values: Readonly<Record<string, unknown>>, options: WriteOptions): Writes => {
  const writes: Record<string, PropertyWrite> = {};
  for (const [name, value] of Object.entries(values)) {
    const column = findColumn(columns, name);
    if (Object.hasOwn(writes, column.name)) return fail(inputError(`column "${column.name}" is named twice`));
    writes[column.name] = toWrite(column, value, options);
  }
  return writes;
};

/**
 * The writes for a new row: the properties given, plus `title` into the title
 * column when the caller passed it on its own. Naming the title both ways is
 * ambiguous and refused.
 */
export const rowWrites = (
  columns: readonly Column[],
  title: string | undefined,
  values: Readonly<Record<string, unknown>>,
  options: WriteOptions,
): Writes => {
  const writes = toWrites(columns, values, options);
  if (title === undefined) return writes;
  const column = titleColumn(columns) ?? fail(inputError("this database has no title column"));
  if (Object.hasOwn(writes, column.name)) return fail(inputError(`the title is given twice: as title and as column "${column.name}"`));
  return { ...writes, [column.name]: toWrite(column, title, options) };
};

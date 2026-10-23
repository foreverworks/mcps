import { compact } from "@foreverworks/mcp-kit";

import { fail, inputError } from "./errors.js";
import { present } from "./present.js";
import type { RawColumn, RawDataSource } from "./schema.js";
import { plainText } from "./text.js";

/**
 * A data source's columns, as the rules need them: the type that decides how a
 * value is read, written and filtered, and the options a select, multi-select
 * or status may hold. Notion's `properties` map is keyed by name; the title
 * column comes first here because every row is known by it.
 */
export type Column = {
  readonly id: string;
  readonly name: string;
  /** Notion's type name: title, rich_text, number, select, status, date, relation, formula, ... */
  readonly type: string;
  readonly description?: string;
  /** The option names of a select, multi_select or status column. */
  readonly options?: readonly string[];
  /** A status column's groups (To-do, In progress, Complete) and the options in each. */
  readonly groups?: readonly { readonly name: string; readonly options: readonly string[] }[];
  /** A relation column: the data source its rows point at. */
  readonly relatesTo?: string;
  /** A number column's display format (number, percent, euro, ...). */
  readonly format?: string;
  /** A formula column's expression. */
  readonly expression?: string;
};

type Option = { readonly id: string; readonly name: string };

const names = (options: readonly Option[]): readonly string[] => options.map((o) => o.name);

export const columnOf = (raw: RawColumn): Column => {
  const base = { id: raw.id, name: raw.name, type: raw.type, ...compact({ description: raw.description || undefined }) };
  switch (raw.type) {
    case "select":
      return { ...base, options: names(raw.select.options) };
    case "multi_select":
      return { ...base, options: names(raw.multi_select.options) };
    case "status": {
      const byId = new Map(raw.status.options.map((o) => [o.id, o.name]));
      return {
        ...base,
        options: names(raw.status.options),
        groups: raw.status.groups.map((g) => ({ name: g.name, options: g.option_ids.flatMap((id) => byId.get(id) ?? []) })),
      };
    }
    case "relation":
      return { ...base, relatesTo: raw.relation.data_source_id };
    case "number":
      return { ...base, format: raw.number.format };
    case "formula":
      return { ...base, expression: raw.formula.expression };
    default:
      return base;
  }
};

/** Every column of a data source, the title column first. */
export const columnsOf = (source: RawDataSource): readonly Column[] => {
  const all = present(source.properties).map(([, raw]) => columnOf(raw));
  return [...all.filter((c) => c.type === "title"), ...all.filter((c) => c.type !== "title")];
};

export const titleOf = (source: RawDataSource): string => plainText(source.title);

export const titleColumn = (columns: readonly Column[]): Column | undefined => columns.find((c) => c.type === "title");

/**
 * The column an argument names: by exact name, then by id, then by name
 * ignoring case when that is unambiguous. Anything else is refused with the
 * names that do exist, because a guessed column is a write to the wrong field.
 */
export const findColumn = (columns: readonly Column[], name: string): Column => {
  const exact = columns.find((c) => c.name === name) ?? columns.find((c) => c.id === name);
  if (exact !== undefined) return exact;
  const folded = columns.filter((c) => c.name.toLowerCase() === name.toLowerCase());
  if (folded.length === 1 && folded[0] !== undefined) return folded[0];
  return fail(inputError(`no column "${name}"; the columns are ${columns.map((c) => `"${c.name}"`).join(", ")}`));
};

/** The option a value names, exactly or ignoring case when that is unambiguous; undefined when none. */
export const matchOption = (column: Column, value: string): string | undefined => {
  const options = column.options ?? [];
  if (options.includes(value)) return value;
  const folded = options.filter((o) => o.toLowerCase() === value.toLowerCase());
  return folded.length === 1 ? folded[0] : undefined;
};

export const optionList = (column: Column): string =>
  (column.options ?? []).length === 0 ? "it has no options yet" : `its options are ${(column.options ?? []).map((o) => `"${o}"`).join(", ")}`;

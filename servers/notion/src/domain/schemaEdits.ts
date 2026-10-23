import { type Column, optionList } from "./columns.js";
import { fail, inputError } from "./errors.js";

/**
 * Changes to a database's columns, checked against its schema before anything
 * is sent: a column name already taken, an option already there, a type this
 * server cannot configure, or a list past Notion's limits is refused with what
 * exists. infra/notionApi/bodies.ts writes the checked change in Notion's
 * grammar.
 */

/** The column types a new column may have. Rollups, unique ids and buttons need more than a name and a type, and are left to Notion's app. */
export const COLUMN_TYPES = [
  "rich_text",
  "number",
  "select",
  "multi_select",
  "status",
  "date",
  "people",
  "files",
  "checkbox",
  "url",
  "email",
  "phone_number",
  "formula",
  "relation",
  "created_time",
  "created_by",
  "last_edited_time",
  "last_edited_by",
] as const;
export type ColumnType = (typeof COLUMN_TYPES)[number];

/** Notion's most options in one select, multi-select or status. */
export const OPTION_LIMIT = 100;
/** Notion's longest column description. */
export const DESCRIPTION_LIMIT = 280;

/** The groups a status option belongs to. */
export const STATUS_GROUPS = ["To-do", "In progress", "Complete"] as const;
export type StatusGroup = (typeof STATUS_GROUPS)[number];

/** A new column, checked. `relatesTo` is the data source a relation points at, resolved by the caller. */
export type ColumnSpec = {
  readonly name: string;
  readonly type: ColumnType;
  readonly description?: string;
  readonly options?: readonly string[];
  readonly format?: string;
  readonly expression?: string;
  readonly relatesTo?: string;
};

/** As the tool takes it: the relation's target is still a database id or URL. */
export type ColumnInput = Omit<ColumnSpec, "relatesTo" | "type"> & { readonly type: string; readonly relationTo?: string };

const refuse = (message: string): never => fail(inputError(message));

/** Names in a list that repeat, ignoring case, as Notion matches option names. */
const repeats = (names: readonly string[]): readonly string[] => {
  const seen = new Set<string>();
  return [...new Set(names.filter((n) => (seen.has(n.toLowerCase()) ? true : (seen.add(n.toLowerCase()), false))))];
};

const OPTION_TYPES: ReadonlySet<string> = new Set(["select", "multi_select", "status"]);

/**
 * A new column against the columns there are (or, for a new database, the
 * ones beside it): a free name, a type this server configures, and only the
 * settings that type has.
 */
export const checkColumn = (input: ColumnInput, existing: readonly Pick<Column, "name">[], relatesTo?: string): ColumnSpec => {
  const name = input.name.trim();
  if (name === "") return refuse("a column needs a name");
  const taken = existing.find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (taken !== undefined) return refuse(`there is already a column "${taken.name}"; the columns are ${existing.map((c) => `"${c.name}"`).join(", ")}`);
  if (!(COLUMN_TYPES as readonly string[]).includes(input.type)) return refuse(`column "${name}": type ${input.type} is not one this server makes; it makes ${COLUMN_TYPES.join(", ")}`);
  const type = input.type as ColumnType;
  if (input.options !== undefined && !OPTION_TYPES.has(type)) return refuse(`column "${name}" is ${type}, which has no options`);
  const options = input.options?.map((o) => o.trim()).filter((o) => o !== "");
  if (options !== undefined) {
    if (options.length > OPTION_LIMIT) return refuse(`column "${name}": Notion takes at most ${OPTION_LIMIT} options`);
    const twice = repeats(options);
    if (twice.length > 0) return refuse(`column "${name}": options named twice: ${twice.join(", ")}`);
  }
  if (input.format !== undefined && type !== "number") return refuse(`column "${name}": format is for a number column`);
  if (input.format !== undefined && !/^[a-z_]+$/.test(input.format)) return refuse(`column "${name}": format is Notion's name for one, e.g. number, percent, euro, dollar`);
  if (type === "formula" && (input.expression ?? "").trim() === "") return refuse(`column "${name}": a formula needs its expression`);
  if (input.expression !== undefined && type !== "formula") return refuse(`column "${name}": expression is for a formula column`);
  if (type === "relation" && relatesTo === undefined) return refuse(`column "${name}": a relation needs relation_to, the database it points at`);
  if (input.relationTo !== undefined && type !== "relation") return refuse(`column "${name}": relation_to is for a relation column`);
  const description = input.description?.trim();
  if (description !== undefined && (description === "" || [...description].length > DESCRIPTION_LIMIT)) {
    return refuse(`column "${name}": a description is 1 to ${DESCRIPTION_LIMIT} characters`);
  }
  return {
    name,
    type,
    ...(description === undefined ? {} : { description }),
    ...(options === undefined ? {} : { options }),
    ...(input.format === undefined ? {} : { format: input.format }),
    ...(type === "formula" ? { expression: (input.expression as string).trim() } : {}),
    ...(type === "relation" ? { relatesTo: relatesTo as string } : {}),
  };
};

/** An option a column already has, by Notion's id: kept as it is when the list is sent back whole. */
export type KeptOption = { readonly id: string; readonly name: string };

/** New options for a select, multi-select or status column: the full list to send, and what was already there. */
export type OptionsChange = {
  readonly column: string;
  readonly type: "select" | "multi_select" | "status";
  readonly keep: readonly KeptOption[];
  readonly add: readonly string[];
  /** A status option's group; Notion's default otherwise (To-do when there is one). */
  readonly group?: StatusGroup;
};

/**
 * The options a column gains. Notion's API documents an option list as the
 * options to set, so the whole list goes back, every option there now by its
 * id and the new ones by name: whether Notion merges or replaces, nothing is
 * lost. A name already there (ignoring case) is not added twice.
 */
export const optionsChange = (
  column: Column,
  current: readonly KeptOption[],
  wanted: readonly string[],
  group: StatusGroup | undefined,
): { readonly change: OptionsChange; readonly already: readonly string[] } => {
  if (column.type !== "select" && column.type !== "multi_select" && column.type !== "status") {
    return refuse(`column "${column.name}" is ${column.type}, which has no options`);
  }
  if (group !== undefined && column.type !== "status") return refuse(`column "${column.name}" is ${column.type}: group is for a status column`);
  const names = wanted.map((w) => w.trim()).filter((w) => w !== "");
  if (names.length === 0) return refuse("give at least one option");
  const twice = repeats(names);
  if (twice.length > 0) return refuse(`options named twice: ${twice.join(", ")}`);
  const have = new Set(current.map((o) => o.name.toLowerCase()));
  const add = names.filter((n) => !have.has(n.toLowerCase()));
  const already = names.filter((n) => have.has(n.toLowerCase()));
  if (add.length === 0) return refuse(`column "${column.name}" has every one of these already; ${optionList(column)}`);
  if (current.length + add.length > OPTION_LIMIT) return refuse(`column "${column.name}" would hold ${current.length + add.length} options; Notion takes at most ${OPTION_LIMIT}`);
  return { change: { column: column.name, type: column.type, keep: current, add, ...(group === undefined ? {} : { group }) }, already };
};

/** A database to create under a page: its title column's name and its other columns, checked against each other. */
export type NewDatabase = {
  readonly parentPageId: string;
  readonly title: string;
  readonly titleColumn: string;
  readonly inline: boolean;
  readonly columns: readonly ColumnSpec[];
};

/** The columns of a new database, each checked against the title column and the ones before it. */
export const checkNewColumns = (titleColumn: string, inputs: readonly ColumnInput[], relationTargets: ReadonlyMap<string, string>): readonly ColumnSpec[] => {
  const title = titleColumn.trim();
  if (title === "") return refuse("the title column needs a name");
  const done: ColumnSpec[] = [];
  for (const input of inputs) done.push(checkColumn(input, [{ name: title }, ...done], input.relationTo === undefined ? undefined : relationTargets.get(input.relationTo)));
  return done;
};

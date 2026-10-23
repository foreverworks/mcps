import { type Column, findColumn, matchOption, optionList } from "../columns.js";
import { isDateText } from "../dates.js";
import { fail, inputError } from "../errors.js";
import { parseId } from "../ids.js";

/**
 * `where`, the filter an agent can write without knowing Notion's filter
 * grammar. Notion keys every condition by the column's TYPE
 * (`{"property": "Status", "status": {"equals": "In progress"}}`), which an agent
 * gets wrong; here a condition names the column, an op and a value, and the
 * type comes from the schema. The result is this module's own tree;
 * infra/notionApi/bodies.ts writes it in Notion's grammar.
 *
 * An op a column's type does not have is refused with the ones it does, and an
 * option that does not exist with the options that do.
 */

/** As parsed from the tool's input, where an absent key may arrive as `undefined`. */
export type Condition = {
  /** A column, by name (or id). */
  readonly property?: string | undefined;
  /** A page's own timestamp, when no column shows it. */
  readonly timestamp?: "created_time" | "last_edited_time" | undefined;
  readonly op: string;
  readonly value?: unknown;
};

/** What a condition compares against, after the checks. `true` for the existence ops, `{}` for the relative ranges. */
export type FilterValue = string | number | boolean | readonly string[] | Readonly<Record<string, never>>;

export type Filter =
  | { readonly kind: "group"; readonly match: "all" | "any"; readonly filters: readonly Filter[] }
  /** `key` is the grammar's name for the column type (title, number, select, date, people, ...). */
  | { readonly kind: "property"; readonly property: string; readonly key: string; readonly op: string; readonly value: FilterValue }
  | { readonly kind: "formula"; readonly property: string; readonly result: "string" | "number" | "checkbox" | "date"; readonly op: string; readonly value: FilterValue }
  | { readonly kind: "timestamp"; readonly timestamp: "created_time" | "last_edited_time"; readonly op: string; readonly value: FilterValue }
  /** Notion's own filter object, passed through as given (`notion_filter`). */
  | { readonly kind: "raw"; readonly filter: Readonly<Record<string, unknown>> };

type ValueKind = "text" | "number" | "boolean" | "options" | "date" | "person" | "page";

const EXISTENCE = ["is_empty", "is_not_empty"] as const;
/** Date ranges relative to today; they take no value. */
export const RELATIVE_RANGES = ["this_week", "past_week", "past_month", "past_year", "next_week", "next_month", "next_year"] as const;
/** The relative dates Notion accepts where a date is expected. */
export const RELATIVE_DATES = ["today", "tomorrow", "yesterday", "one_week_ago", "one_week_from_now", "one_month_ago", "one_month_from_now"] as const;

type Family = { readonly types: readonly string[]; readonly ops: Readonly<Record<string, ValueKind>>; readonly existence: boolean; readonly ranges: boolean };

const TEXT_OPS = { equals: "text", does_not_equal: "text", contains: "text", does_not_contain: "text", starts_with: "text", ends_with: "text" } as const;
const NUMBER_OPS = {
  equals: "number",
  does_not_equal: "number",
  greater_than: "number",
  less_than: "number",
  greater_than_or_equal_to: "number",
  less_than_or_equal_to: "number",
} as const;
const DATE_OPS = { equals: "date", before: "date", after: "date", on_or_before: "date", on_or_after: "date" } as const;
const PEOPLE_OPS = { contains: "person", does_not_contain: "person" } as const;

const FAMILIES: readonly Family[] = [
  { types: ["title", "rich_text", "url", "email", "phone_number"], ops: TEXT_OPS, existence: true, ranges: false },
  { types: ["number", "unique_id"], ops: NUMBER_OPS, existence: true, ranges: false },
  { types: ["checkbox"], ops: { equals: "boolean", does_not_equal: "boolean" }, existence: false, ranges: false },
  { types: ["select", "status"], ops: { equals: "options", does_not_equal: "options" }, existence: true, ranges: false },
  { types: ["multi_select"], ops: { contains: "options", does_not_contain: "options" }, existence: true, ranges: false },
  { types: ["date", "created_time", "last_edited_time"], ops: DATE_OPS, existence: true, ranges: true },
  { types: ["people", "created_by", "last_edited_by"], ops: PEOPLE_OPS, existence: true, ranges: false },
  { types: ["relation"], ops: { contains: "page", does_not_contain: "page" }, existence: true, ranges: false },
  { types: ["files"], ops: {}, existence: true, ranges: false },
];

const DATE_FAMILY = FAMILIES.find((f) => f.types.includes("date")) as Family;

const opsOf = (family: Family): readonly string[] => [
  ...Object.keys(family.ops),
  ...(family.existence ? EXISTENCE : []),
  ...(family.ranges ? RELATIVE_RANGES : []),
];

const refuse = (message: string): never => fail(inputError(message));

const valueOf = (kind: ValueKind, value: unknown, column: Column | undefined, what: string): FilterValue => {
  switch (kind) {
    case "text":
      return typeof value === "string" ? value : refuse(`${what} compares text; give a string, not ${JSON.stringify(value)}`);
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? value : refuse(`${what} compares numbers; give a number, not ${JSON.stringify(value)}`);
    case "boolean":
      return typeof value === "boolean" ? value : refuse(`${what} takes true or false, not ${JSON.stringify(value)}`);
    case "options": {
      const given = Array.isArray(value) ? value : [value];
      if (given.length === 0) return refuse(`${what} needs at least one option`);
      const names = given.map((v) => {
        if (typeof v !== "string" || column === undefined) return refuse(`${what} takes an option name or a list of them, not ${JSON.stringify(value)}`);
        return matchOption(column, v) ?? refuse(`option "${v}" does not exist in column "${column.name}"; ${optionList(column)}`);
      });
      return names.length === 1 ? (names[0] as string) : names;
    }
    case "date": {
      if (typeof value === "string" && ((RELATIVE_DATES as readonly string[]).includes(value) || isDateText(value))) return value;
      return refuse(`${what} takes YYYY-MM-DD, an ISO date-time or one of ${RELATIVE_DATES.join(", ")}; not ${JSON.stringify(value)}`);
    }
    case "person":
      if (value === "me") return "me";
      return (typeof value === "string" ? parseId(value) : undefined) ?? refuse(`${what} takes a person's name, email or id, or "me"; not ${JSON.stringify(value)}`);
    case "page":
      return (typeof value === "string" ? parseId(value) : undefined) ?? refuse(`${what} takes a page id or a Notion URL, not ${JSON.stringify(value)}`);
  }
};

/** The op and its value for one family: a valued op, an existence op or a relative range. */
const opValue = (family: Family, op: string, value: unknown, column: Column | undefined, what: string): FilterValue => {
  if ((EXISTENCE as readonly string[]).includes(op) && family.existence) return true;
  if ((RELATIVE_RANGES as readonly string[]).includes(op) && family.ranges) return {};
  const kind = family.ops[op];
  if (kind === undefined) return refuse(`${what} has no op "${op}"; its ops are ${opsOf(family).join(", ")}`);
  return valueOf(kind, value, column, `${what} ${op}`);
};

/**
 * A formula's filter needs its RESULT type, which the schema does not state
 * (only the expression). So the op and the value say it: a date op is a date,
 * a number or a number op is a number, a boolean is a checkbox, text is text.
 */
const formulaFilter = (column: Column, op: string, value: unknown): Filter => {
  const what = `column "${column.name}" (formula)`;
  if ((EXISTENCE as readonly string[]).includes(op)) return refuse(`${what}: is_empty and is_not_empty cannot tell a formula's type; use notion_filter`);
  const dated = op in DATE_OPS || (RELATIVE_RANGES as readonly string[]).includes(op);
  const result = dated ? "date" : typeof value === "number" || op in NUMBER_OPS && !(op in TEXT_OPS) ? "number" : typeof value === "boolean" ? "checkbox" : "string";
  const family = result === "date" ? DATE_FAMILY : (FAMILIES.find((f) => f.types.includes(result === "string" ? "rich_text" : result)) as Family);
  return { kind: "formula", property: column.name, result, op, value: opValue(family, op, value, column, what) };
};

export const conditionFilter = (columns: readonly Column[], condition: Condition): Filter => {
  const { property, timestamp, op, value } = condition;
  if ((property === undefined) === (timestamp === undefined)) return refuse("each condition names exactly one of property or timestamp");
  if (timestamp !== undefined) return { kind: "timestamp", timestamp, op, value: opValue(DATE_FAMILY, op, value, undefined, `timestamp ${timestamp}`) };
  const column = findColumn(columns, property as string);
  if (column.type === "formula") return formulaFilter(column, op, value);
  const family = FAMILIES.find((f) => f.types.includes(column.type));
  if (family === undefined) return refuse(`column "${column.name}" is ${column.type}, which where cannot filter; use notion_filter`);
  return { kind: "property", property: column.name, key: column.type, op, value: opValue(family, op, value, column, `column "${column.name}" (${column.type})`) };
};

/** Notion nests at most two levels of groups; a flat list under one match is one. */
export const whereFilter = (columns: readonly Column[], conditions: readonly Condition[], match: "all" | "any"): Filter | undefined => {
  if (conditions.length === 0) return undefined;
  const filters = conditions.map((c) => conditionFilter(columns, c));
  return filters.length === 1 ? filters[0] : { kind: "group", match, filters };
};

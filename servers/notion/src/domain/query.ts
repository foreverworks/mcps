import { type Column, findColumn, titleColumn } from "./columns.js";
import { fail, inputError } from "./errors.js";
import { type Condition, type Filter, whereFilter } from "./query/filter.js";

/**
 * One query of a data source, planned from the tool's arguments and the
 * schema: which rows (the filter), in what order, which columns come back,
 * and how many. Everything is checked against the columns before a request
 * is made, so a misspelt column costs no round trip.
 */

export type Sort =
  | { readonly kind: "property"; readonly property: string; readonly direction: "ascending" | "descending" }
  | { readonly kind: "timestamp"; readonly timestamp: "created_time" | "last_edited_time"; readonly direction: "ascending" | "descending" };

export type SortInput = {
  readonly property?: string | undefined;
  readonly timestamp?: "created_time" | "last_edited_time" | undefined;
  readonly direction: "ascending" | "descending";
};

export type QueryArgs = {
  readonly where: readonly Condition[];
  readonly match: "all" | "any";
  readonly notionFilter?: Readonly<Record<string, unknown>>;
  readonly sort: readonly SortInput[];
  /** Column names to return; all of them when absent. The title column always comes back. */
  readonly properties?: readonly string[];
  readonly limit: number;
  readonly cursor?: string;
  readonly inTrash: boolean;
};

export type QueryPlan = {
  readonly filter?: Filter;
  readonly sorts: readonly Sort[];
  /** Property ids for `filter_properties`; absent means every column. */
  readonly propertyIds?: readonly string[];
  readonly pageSize: number;
  readonly cursor?: string;
  readonly inTrash: boolean;
};

/** Notion's page size ceiling for a query. */
export const PAGE_LIMIT = 100;

const sortOf = (columns: readonly Column[], input: SortInput): Sort => {
  if ((input.property === undefined) === (input.timestamp === undefined)) return fail(inputError("each sort names exactly one of property or timestamp"));
  return input.timestamp !== undefined
    ? { kind: "timestamp", timestamp: input.timestamp, direction: input.direction }
    : { kind: "property", property: findColumn(columns, input.property as string).name, direction: input.direction };
};

export const planQuery = (columns: readonly Column[], args: QueryArgs): QueryPlan => {
  const where = whereFilter(columns, args.where, args.match);
  const raw: Filter | undefined = args.notionFilter === undefined ? undefined : { kind: "raw", filter: args.notionFilter };
  const filter: Filter | undefined = where !== undefined && raw !== undefined ? { kind: "group", match: "all", filters: [where, raw] } : (where ?? raw);
  const title = titleColumn(columns);
  const propertyIds =
    args.properties === undefined
      ? undefined
      : [...new Set([...(title === undefined ? [] : [title.id]), ...args.properties.map((name) => findColumn(columns, name).id)])];
  return {
    ...(filter === undefined ? {} : { filter }),
    sorts: args.sort.map((s) => sortOf(columns, s)),
    ...(propertyIds === undefined ? {} : { propertyIds }),
    pageSize: Math.min(Math.max(args.limit, 1), PAGE_LIMIT),
    ...(args.cursor === undefined ? {} : { cursor: args.cursor }),
    inTrash: args.inTrash,
  };
};

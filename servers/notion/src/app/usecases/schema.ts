import { compact } from "@foreverworks/mcp-kit";

import { columnsOf, findColumn } from "../../domain/columns.js";
import { DRIFT, fail, inputError } from "../../domain/errors.js";
import { toId } from "../../domain/ids.js";
import { present } from "../../domain/present.js";
import { pageTitle } from "../../domain/properties/read.js";
import { type ColumnInput, checkColumn, checkNewColumns, type KeptOption, optionsChange, type StatusGroup } from "../../domain/schemaEdits.js";
import type { RawDataSource } from "../../domain/schema.js";
import { pickSource } from "../../domain/sources.js";
import { plainText } from "../../domain/text.js";
import type { Deps } from "../ports.js";
import { databaseOf } from "./databases.js";

/** A table's schema as it is now, not as the one-minute cache remembers it: an edit is checked against the present. */
const freshSchema = async (deps: Deps, args: { readonly database: string; readonly source?: string; readonly account?: string }) => {
  const { account, database, sourceId: named } = await databaseOf(deps, args.database, args.account);
  const sourceId = args.source === undefined && named !== undefined ? named : pickSource(database, args.source);
  return { account, database, sourceId, raw: await deps.accounts.api(account).getDataSource(sourceId) };
};

/** The data source a relation points at, in the same workspace: a database's only table, or the one named. */
const relationTarget = async (deps: Deps, target: string, account: string): Promise<string> => {
  const found = await databaseOf(deps, target, account);
  return found.sourceId ?? pickSource(found.database);
};

const drift = (what: string): never => fail({ kind: "api", status: 0, message: `Notion's answer had no ${what}`, reason: DRIFT });

/** A new column on a database's table, checked against the columns it has now. Answers the column as Notion made it. */
export const addColumn = async (deps: Deps, args: { readonly database: string; readonly source?: string; readonly account?: string; readonly column: ColumnInput }) => {
  const { account, database, sourceId, raw } = await freshSchema(deps, args);
  const target = args.column.relationTo === undefined ? undefined : await relationTarget(deps, args.column.relationTo, account);
  const spec = checkColumn(args.column, columnsOf(raw), target);
  const updated = await deps.accounts.api(account).addColumn(sourceId, spec);
  const made = columnsOf(updated).find((c) => c.name === spec.name) ?? drift(`column "${spec.name}" after adding it`);
  const { id: _id, ...column } = made;
  return { account, database: database.id, source: sourceId, column };
};

/** A select, multi-select or status column's options, with Notion's ids, as the data source answers them. */
const optionsOf = (raw: RawDataSource, column: string): readonly KeptOption[] => {
  const property = present(raw.properties).find(([name]) => name === column)?.[1];
  if (property?.type === "select") return property.select.options.map((o) => ({ id: o.id, name: o.name }));
  if (property?.type === "multi_select") return property.multi_select.options.map((o) => ({ id: o.id, name: o.name }));
  if (property?.type === "status") return property.status.options.map((o) => ({ id: o.id, name: o.name }));
  return [];
};

/**
 * New options on a select, multi-select or status column. The whole list goes
 * back (the options there now by id, the new ones by name), and the answer is
 * read back: an option that went missing fails the call loudly.
 */
export const addOptions = async (
  deps: Deps,
  args: { readonly database: string; readonly source?: string; readonly account?: string; readonly column: string; readonly options: readonly string[]; readonly group?: StatusGroup },
) => {
  const { account, database, sourceId, raw } = await freshSchema(deps, args);
  const column = findColumn(columnsOf(raw), args.column);
  const before = optionsOf(raw, column.name);
  const { change, already } = optionsChange(column, before, args.options, args.group);
  const updated = await deps.accounts.api(account).setOptions(sourceId, change);
  const after = optionsOf(updated, column.name);
  const lost = before.filter((o) => !after.some((a) => a.id === o.id));
  const missing = change.add.filter((n) => !after.some((a) => a.name.toLowerCase() === n.toLowerCase()));
  if (lost.length > 0 || missing.length > 0) {
    return fail({
      kind: "api",
      account,
      status: 0,
      message: `column "${column.name}" does not read back as sent: ${[...lost.map((o) => `"${o.name}" is gone`), ...missing.map((n) => `"${n}" was not added`)].join(", ")}; check it in Notion`,
    });
  }
  return compact({
    account,
    database: database.id,
    source: sourceId,
    column: column.name,
    added: change.add,
    alreadyThere: already.length === 0 ? undefined : already,
    options: after.map((o) => o.name),
  });
};

export type CreateDatabaseArgs = {
  /** The page it goes under: an id or a URL. */
  readonly parent: string;
  readonly title: string;
  readonly titleColumn: string;
  readonly columns: readonly ColumnInput[];
  readonly inline: boolean;
  readonly account?: string;
};

/**
 * A new database under a page, with its title column and its other columns,
 * every one checked against the others (and a relation's target found in the
 * same workspace) before anything is made.
 */
export const createDatabase = async (deps: Deps, args: CreateDatabaseArgs) => {
  const found = await deps.locator.find(toId(args.parent, "parent"), ["page"], args.account);
  const targets = new Map<string, string>();
  for (const to of new Set(args.columns.flatMap((c) => (c.relationTo === undefined ? [] : [c.relationTo])))) targets.set(to, await relationTarget(deps, to, found.account));
  const columns = checkNewColumns(args.titleColumn, args.columns, targets);
  if (args.title.trim() === "") return fail(inputError("the database needs a title"));
  const made = await deps.accounts.api(found.account).createDatabase({
    parentPageId: found.page.id,
    title: args.title.trim(),
    titleColumn: args.titleColumn.trim(),
    inline: args.inline,
    columns,
  });
  deps.locator.learn(made.id, found.account, "database");
  for (const s of made.data_sources) deps.locator.learn(s.id, found.account, "data_source");
  return {
    account: found.account,
    id: made.id,
    url: made.url,
    title: plainText(made.title),
    under: pageTitle(found.page.properties),
    sources: made.data_sources.map((s) => ({ id: s.id, name: s.name })),
    columns: [args.titleColumn.trim(), ...columns.map((c) => c.name)],
  };
};

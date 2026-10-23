import { fail, inputError } from "./errors.js";
import { parseId } from "./ids.js";
import type { RawDatabase } from "./schema.js";

/**
 * The table a call means inside a database. Since API 2025-09-03 a database is
 * a container of data sources; nearly every one holds exactly one, and then no
 * one has to name it. With several, `source` names one by name or id, and
 * leaving it out is refused with the names, not answered from a guess.
 */
export const pickSource = (database: RawDatabase, wanted?: string): string => {
  const sources = database.data_sources;
  const list = sources.map((s) => `"${s.name}" (${s.id})`).join(", ");
  if (wanted === undefined || wanted.trim() === "") {
    const only = sources.length === 1 ? sources[0] : undefined;
    if (only !== undefined) return only.id;
    return fail(inputError(sources.length === 0 ? "this database has no data source" : `this database holds ${sources.length} data sources; name one with source: ${list}`));
  }
  const id = parseId(wanted);
  const match =
    sources.find((s) => s.id === id) ??
    sources.find((s) => s.name === wanted) ??
    (sources.filter((s) => s.name.toLowerCase() === wanted.toLowerCase()).length === 1
      ? sources.find((s) => s.name.toLowerCase() === wanted.toLowerCase())
      : undefined);
  return match?.id ?? fail(inputError(`no data source "${wanted}" in this database; it holds ${list}`));
};

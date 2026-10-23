import { isIsoDate } from "@foreverworks/mcp-kit";

import { UNCOVERED } from "../../domain/coverage.js";
import { fail, inputError } from "../../domain/errors.js";
import type { DocumentFilter, Office } from "../../domain/mark.js";
import type { Deps, RecordsPort } from "../ports.js";

/** The office's case-file source, or why there is none. */
const recordsOf = (deps: Deps, office: Office): RecordsPort =>
  deps.records.find((r) => r.office === office) ??
  fail({
    kind: "unsupported",
    message:
      office === "EM"
        ? "EM: EUIPO's search API gives a mark's status and status date (get_mark), not its history or documents; read them at https://euipo.europa.eu/eSearch"
        : `${office} ${UNCOVERED[office] ?? "has no case-file source enabled on this server"}`,
  });

/** Where a mark stands, and every step its file records, newest first. */
export const markHistory = async (deps: Deps, office: Office, id: string) => {
  const records = recordsOf(deps, office);
  return { source: records.source, ...(await records.history(id)) };
};

/** The documents in a mark's file, newest first, with the type codes download_mark_documents takes. */
export const markDocuments = async (deps: Deps, office: Office, id: string) => {
  const records = recordsOf(deps, office);
  const documents = await records.documents(id);
  return { source: records.source, office, id, count: documents.length, documents };
};

const fileName = (office: Office, id: string, filter: DocumentFilter): string =>
  [office.toLowerCase(), id, filter.type, filter.from, filter.to].filter((p) => p !== undefined).join("-") + ".pdf";

/**
 * The documents a filter picks, as one PDF saved to the outbox, reported by
 * path, SHA-256 and size. Without a filter, the whole file, which for an old
 * mark runs to many pages.
 */
export const downloadDocuments = async (deps: Deps, office: Office, id: string, filter: DocumentFilter) => {
  for (const [name, date] of [["from", filter.from], ["to", filter.to]] as const) {
    if (date !== undefined && !isIsoDate(date)) fail(inputError(`${name} must be a date, YYYY-MM-DD, not "${date}"`));
  }
  if (filter.from !== undefined && filter.to !== undefined && filter.from > filter.to) fail(inputError(`from (${filter.from}) is after to (${filter.to})`));
  const records = recordsOf(deps, office);
  const bytes = await records.bundle(id, filter);
  const saved = await deps.outbox.save(fileName(office, id, filter), bytes);
  return {
    source: records.source,
    office,
    id,
    ...(filter.type === undefined ? {} : { type: filter.type }),
    ...(filter.from === undefined ? {} : { from: filter.from }),
    ...(filter.to === undefined ? {} : { to: filter.to }),
    ...saved,
  };
};

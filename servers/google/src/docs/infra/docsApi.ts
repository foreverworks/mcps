import type { DocsPort, GetOptions } from "../app/ports.js";
import type { RawBatchUpdateResponse, RawDocument } from "../domain/schema.js";
import type { Request } from "../../infra/httpJson.js";

const DOCS = "https://docs.googleapis.com/v1";

const documentUrl = (id: string): string => `${DOCS}/documents/${encodeURIComponent(id)}`;

const getQuery = (options: GetOptions = {}) => ({
  ...(options.tabs ? { includeTabsContent: "true" } : {}),
  ...(options.suggestions ? { suggestionsViewMode: options.suggestions } : {}),
  ...(options.fields ? { fields: options.fields } : {}),
});

/**
 * The Docs REST API: documents.get and documents.batchUpdate. A batchUpdate is
 * a POST and so is never retried after a 5xx or a lost answer (httpJson): it
 * may have been applied, and the caller is told to look before trying again.
 */
export const makeDocsApi = (request: Request): DocsPort => {
  const apply: DocsPort["apply"] = (id, requests, control) =>
    request<RawBatchUpdateResponse>(`${documentUrl(id)}:batchUpdate`, {
      method: "POST",
      json: { requests, ...(Object.keys(control).length > 0 ? { writeControl: control } : {}) },
    });
  return {
    get: (id, options) => request<RawDocument>(documentUrl(id), { query: getQuery(options) }),
    batchUpdate: async (id, requests, revisionId) => {
      const body = await apply(id, requests, { requiredRevisionId: revisionId });
      return body?.writeControl?.requiredRevisionId ?? null;
    },
    apply,
  };
};

import type { ApiRequest } from "../../editors/domain/discovery.js";
import { fail, inputError } from "./errors.js";

/** What a batch is pinned to: Docs' writeControl. */
export type Pin = { readonly requiredRevisionId?: string; readonly targetRevisionId?: string };

const INDEX_KEYS = new Set(["index", "startIndex", "endIndex"]);

/** Where the requests name a position in the document: an index, which is only right for the revision it was read at. */
export const indexPaths = (requests: readonly ApiRequest[]): readonly string[] => {
  const found: string[] = [];
  const walk = (value: unknown, path: string): void => {
    if (Array.isArray(value)) return value.forEach((item, n) => walk(item, `${path}[${n}]`));
    if (typeof value !== "object" || value === null) return;
    for (const [key, item] of Object.entries(value)) {
      if (INDEX_KEYS.has(key) && typeof item === "number") found.push(`${path}.${key}`);
      else walk(item, `${path}.${key}`);
    }
  };
  requests.forEach((request, n) => walk(request, `requests[${n}]`));
  return found;
};

/**
 * The pin for a batch. An index comes from a read, and the same index means
 * other text once anyone has typed above it, so a batch that names one must
 * say which revision it was computed for: `expected_revision` refuses the
 * batch if the document moved on, `target_revision` has Docs carry the
 * positions over the edits made since (collaborators' included). A batch with
 * no index (replace all text, a new header, a tab) needs neither.
 */
export const pinFor = (requests: readonly ApiRequest[], expected: string, target: string): Pin => {
  if (expected && target) return fail(inputError("give expected_revision or target_revision, not both"));
  if (expected) return { requiredRevisionId: expected };
  if (target) return { targetRevisionId: target };
  const [first] = indexPaths(requests);
  if (first) {
    return fail(
      inputError(
        `${first} is a position from a read, right only for the revision it was read at: pass that revisionId as expected_revision ` +
          "(the batch is refused if the document changed since) or target_revision (Docs moves the positions over the edits made since)",
      ),
    );
  }
  return {};
};

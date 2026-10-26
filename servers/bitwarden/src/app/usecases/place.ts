import { fail, inputError, type AppError } from "../../domain/errors.js";
import type { Collection, LoginDraft } from "../../domain/schema.js";
import type { Deps } from "../ports.js";

/** The collection a caller named: by name, ignoring case, or by id, as health lists them. */
export const collectionNamed = (collections: readonly Collection[], wanted: string): Collection | undefined =>
  collections.find((c) => c.name.toLowerCase() === wanted.toLowerCase() || c.id === wanted);

/** The refusal for a collection the account does not have, worded the same for every tool that takes one. */
export const noCollection = (named: string): AppError => inputError(`no collection named ${named}; health lists the collections`);

/** Where a new item goes: the named collection, else the default one if it exists, else the account's own vault. */
export const placeFor = async (deps: Deps, collection: string | undefined): Promise<Pick<LoginDraft, "organizationId" | "collectionIds">> => {
  const wanted = collection ?? deps.defaultCollection;
  if (wanted === undefined) return { organizationId: null, collectionIds: [] };
  const found = collectionNamed(await deps.vault.collections(), wanted);
  if (found) return { organizationId: found.organizationId, collectionIds: [found.id] };
  if (collection !== undefined) fail(noCollection(collection));
  return { organizationId: null, collectionIds: [] };
};

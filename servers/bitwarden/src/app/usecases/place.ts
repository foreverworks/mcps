import { fail, inputError } from "../../domain/errors.js";
import type { LoginDraft } from "../../domain/schema.js";
import type { Deps } from "../ports.js";

/** Where a new item goes: the named collection, else the default one if it exists, else the account's own vault. */
export const placeFor = async (deps: Deps, collection: string | undefined): Promise<Pick<LoginDraft, "organizationId" | "collectionIds">> => {
  const wanted = collection ?? deps.defaultCollection;
  if (wanted === undefined) return { organizationId: null, collectionIds: [] };
  const found = (await deps.vault.collections()).find((c) => c.name.toLowerCase() === wanted.toLowerCase() || c.id === wanted);
  if (found) return { organizationId: found.organizationId, collectionIds: [found.id] };
  if (collection !== undefined) fail(inputError(`no collection named ${collection}; health lists the collections`));
  return { organizationId: null, collectionIds: [] };
};

import { cliError, fail, inputError } from "../../domain/errors.js";
import { alreadyIn, crossesOrganizations, crossingRefusal } from "../../domain/move.js";
import { collectionNames } from "../../domain/views.js";
import type { Deps } from "../ports.js";
import { collectionNamed, noCollection } from "./place.js";

/**
 * Puts a login or a secure note in exactly one collection of its own
 * organization: its collections become that one. Everything is decided before
 * anything is sent; an item already there is answered as it is. After the
 * move the vault is synced and the item read back, so the answer is what
 * Bitwarden holds, not what the CLI printed. Never a secret: id, name and
 * collections.
 */
export const moveItem = async (deps: Deps, id: string, collection: string) => {
  await deps.vault.sync();
  const item = await deps.vault.getLogin(id);
  const collections = await deps.vault.collections();
  const target = collectionNamed(collections, collection) ?? fail(noCollection(collection));
  if (crossesOrganizations(item, target)) return fail(inputError(crossingRefusal(item, target, await deps.vault.organizations(), collections)));
  const before = collectionNames(item.collectionIds, collections);
  if (alreadyIn(item, target)) return { id: item.id, kind: item.kind, name: item.name, collections: before, previousCollections: before, moved: false };
  await deps.vault.moveItem(item.id, [target.id]);
  await deps.vault.sync({ force: true });
  const after = await deps.vault.getLogin(item.id);
  const now = collectionNames(after.collectionIds, collections);
  if (!alreadyIn(after, target)) {
    return fail(cliError(`${item.name} was sent to ${target.name}, but after a sync Bitwarden lists it in ${now.join(", ") || "no collection"}; check it in the web vault`));
  }
  return { id: after.id, kind: after.kind, name: after.name, collections: now, previousCollections: before, moved: true };
};

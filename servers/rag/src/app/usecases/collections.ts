import { fail, inputError, notFound } from "../../domain/errors.js";
import type { CollectionInfo, Deps } from "../ports.js";

/** A collection name is also what a search filter names: short, lowercase, no spaces. */
export const COLLECTION_NAME = /^[a-z0-9][a-z0-9_-]{0,62}$/u;

/** The model the embed endpoint serves and the length of its vectors, learned by embedding one word. */
export const embeddingModel = async (deps: Deps): Promise<{ readonly model: string; readonly dimension: number }> => {
  const [info, vectors] = await Promise.all([deps.embedder.info(), deps.embedder.embed(["dimension"])]);
  const dimension = vectors[0]?.length ?? 0;
  if (dimension === 0) return fail({ kind: "model", endpoint: "embed", message: "the embed endpoint answered with an empty vector" });
  return { model: info.revision === undefined ? info.model : `${info.model}@${info.revision}`, dimension };
};

/** A collection as recorded; counting what it holds is list_collections' work, not every call's. */
export const findCollection = async (deps: Deps, name: string): Promise<CollectionInfo> =>
  (await deps.store.collectionInfos()).find((c) => c.name === name) ?? fail(notFound(`no collection named "${name}"; create_collection makes one`));

/** A collection can only be searched and grown with the model that embedded it. */
export const assertSameModel = (collection: CollectionInfo, current: { readonly model: string; readonly dimension: number }): void => {
  if (collection.model !== current.model || collection.dimension !== current.dimension)
    fail({
      kind: "mismatch",
      message: `collection "${collection.name}" was embedded with ${collection.model} (${collection.dimension} dimensions); the embed endpoint now serves ${current.model} (${current.dimension})`,
    });
};

export const listCollections = async (deps: Deps) => {
  const rows = await deps.store.collections();
  return { count: rows.length, collections: rows };
};

export const createCollection = async (deps: Deps, args: { readonly name: string; readonly description?: string | undefined }) => {
  if (!COLLECTION_NAME.test(args.name)) return fail(inputError(`"${args.name}" is not a collection name: lowercase letters, digits, - and _, at most 63, starting with a letter or digit`));
  const model = await embeddingModel(deps);
  await deps.store.ensureSchema(model.dimension);
  const created = await deps.store.createCollection({ name: args.name, description: args.description ?? "", model: model.model, dimension: model.dimension });
  const row = (await deps.store.collections()).find((c) => c.name === args.name) ?? fail(notFound(`no collection named "${args.name}"`));
  if (!created && row.description !== (args.description ?? row.description))
    return fail(inputError(`collection "${args.name}" exists with another description ("${row.description}"); drop it first or keep its description`));
  return { created, collection: row };
};

export const dropCollection = async (deps: Deps, name: string) => {
  const removed = await deps.store.dropCollection(name);
  if (removed === undefined) return fail(notFound(`no collection named "${name}"`));
  return { dropped: name, ...removed };
};

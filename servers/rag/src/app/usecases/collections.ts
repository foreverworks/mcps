import { fail, inputError, notFound } from "../../domain/errors.js";
import { compareProbe, PROBE_TEXTS, type Provider, type ProbeResult } from "../../domain/provider.js";
import type { CollectionInfo, Deps, ProviderSetting } from "../ports.js";

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

/**
 * A collection can only be searched and grown with the model that embedded it:
 * the local endpoint's, which embeds every question, and, for a collection set
 * to a remote provider, the model that provider was probed with.
 */
export const assertSameModel = (collection: CollectionInfo, current: { readonly model: string; readonly dimension: number }, deps?: Deps): void => {
  if (collection.model !== current.model || collection.dimension !== current.dimension)
    fail({
      kind: "mismatch",
      message: `collection "${collection.name}" was embedded with ${collection.model} (${collection.dimension} dimensions); the embed endpoint now serves ${current.model} (${current.dimension})`,
    });
  if (deps === undefined || collection.provider === "local") return;
  const remote = deps.remote[collection.provider];
  if (remote.model !== collection.provider_model)
    fail({
      kind: "mismatch",
      message: `collection "${collection.name}" is embedded at ${collection.provider} with ${collection.provider_model}; the server is set to ask it for ${remote.model}. create_collection with that provider probes the new model`,
    });
};

/**
 * Proves a remote provider embeds as the local endpoint does: the probe texts
 * through both, and every pair at least MIN_PROBE_COSINE alike. Refuses the
 * provider otherwise, saying how far apart they were.
 */
export const probeProvider = async (deps: Deps, provider: Exclude<Provider, "local">, local: { readonly model: string }): Promise<ProbeResult> => {
  const remote = deps.remote[provider];
  const missing = await remote.missing();
  if (missing.length > 0) return fail({ kind: "config", variable: missing[0] ?? "", message: `the ${provider} provider is not configured: ${missing.join(", ")} not set` });
  const [mine, theirs] = await Promise.all([deps.embedder.embed(PROBE_TEXTS), remote.embed(PROBE_TEXTS)]);
  const probe = compareProbe(mine, theirs.vectors);
  if (!probe.agrees)
    return fail({
      kind: "mismatch",
      message: `${provider}'s ${remote.model} does not embed as the local ${local.model}: probe cosine ${probe.min_cosine} (at least 0.999 needed), dimensions ${probe.dimensions.join(" and ")}; its vectors would not be found by questions embedded locally`,
    });
  return probe;
};

/** Where a collection's chunks will be embedded: the local model, or a remote provider that passed the probe. */
const settingFor = async (deps: Deps, provider: Provider, local: { readonly model: string }): Promise<ProviderSetting> =>
  provider === "local"
    ? { provider: "local", provider_model: local.model }
    : { provider, provider_model: deps.remote[provider].model, provider_probe: await probeProvider(deps, provider, local) };

export const listCollections = async (deps: Deps) => {
  const rows = await deps.store.collections();
  return { count: rows.length, collections: rows };
};

/**
 * Makes a collection, or, for one that exists, checks its description and
 * moves it to another embedding provider when one is named. A remote provider
 * is probed first and refused unless it embeds as the local endpoint does, so
 * chunks from either provider sit in one index and every question, embedded
 * locally, finds both.
 */
export const createCollection = async (deps: Deps, args: { readonly name: string; readonly description?: string | undefined; readonly provider?: Provider | undefined }) => {
  if (!COLLECTION_NAME.test(args.name)) return fail(inputError(`"${args.name}" is not a collection name: lowercase letters, digits, - and _, at most 63, starting with a letter or digit`));
  const model = await embeddingModel(deps);
  await deps.store.ensureSchema(model.dimension);
  const existing = (await deps.store.collectionInfos()).find((c) => c.name === args.name);
  if (existing !== undefined && args.description !== undefined && existing.description !== args.description)
    return fail(inputError(`collection "${args.name}" exists with another description ("${existing.description}"); drop it first or keep its description`));
  if (existing !== undefined) assertSameModel(existing, model);
  const wanted = args.provider ?? existing?.provider ?? "local";
  const switching = existing !== undefined && existing.provider !== wanted;
  const setting = existing === undefined || switching ? await settingFor(deps, wanted, model) : undefined;
  const created =
    existing === undefined && setting !== undefined
      ? await deps.store.createCollection({ name: args.name, description: args.description ?? "", model: model.model, dimension: model.dimension, ...setting })
      : false;
  if (switching && setting !== undefined) await deps.store.setProvider(args.name, setting);
  const row = (await deps.store.collections()).find((c) => c.name === args.name) ?? fail(notFound(`no collection named "${args.name}"`));
  return { created, ...(switching ? { switched: { from: existing.provider, to: wanted } } : {}), collection: row };
};

export const dropCollection = async (deps: Deps, name: string) => {
  const removed = await deps.store.dropCollection(name);
  if (removed === undefined) return fail(notFound(`no collection named "${name}"`));
  return { dropped: name, ...removed };
};

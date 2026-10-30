import { configError, fail, inputError, notFound } from "../../domain/errors.js";
import { compareProbe, PROBE_TEXTS, type Provider, type ProbeResult, type RemoteProvider } from "../../domain/provider.js";
import type { CollectionInfo, Deps, EmbeddingModel, ModelInfo, ProviderSetting, RemoteEmbedder } from "../ports.js";

/** A collection name is also what a search filter names: short, lowercase, no spaces. */
export const COLLECTION_NAME = /^[a-z0-9][a-z0-9_-]{0,62}$/u;

/** A model as a collection records it: its id and the revision its endpoint serves. */
const idOf = (info: ModelInfo): string => (info.revision === undefined ? info.model : `${info.model}@${info.revision}`);

/** The model an endpoint serves and the length of its vectors, learned by embedding one word. */
export const describeModel = async (model: EmbeddingModel): Promise<{ readonly name: string; readonly model: string; readonly dimension: number }> => {
  const [info, vectors] = await Promise.all([model.embedder.info(), model.embedder.embed(["dimension"])]);
  const dimension = vectors[0]?.length ?? 0;
  if (dimension === 0) return fail({ kind: "model", endpoint: "embed", message: `the ${model.name} embed endpoint answered with an empty vector` });
  return { name: model.name, model: idOf(info), dimension };
};

/** A configured model by name; the default (the first) when none is named. */
export const modelNamed = (deps: Deps, name: string | undefined): EmbeddingModel => {
  const models = deps.models();
  if (name === undefined) return models[0] ?? fail(configError("no embedding model is configured", "RAG_EMBED_URL"));
  return models.find((m) => m.name === name) ?? fail(inputError(`no embedding model named "${name}": the server has ${models.map((m) => m.name).join(", ")} (health lists them)`));
};

/** A collection as recorded; counting what it holds is list_collections' work, not every call's. */
export const findCollection = async (deps: Deps, name: string): Promise<CollectionInfo> =>
  (await deps.store.collectionInfos()).find((c) => c.name === name) ?? fail(notFound(`no collection named "${name}"; create_collection makes one`));

/**
 * The configured model that embeds a collection's questions: the one whose
 * endpoint serves the model it was built with, revision included. A collection
 * can only be searched and grown with that model. When no endpoint serves it
 * and one did not answer, that failure is the error, as it may be the one.
 */
export const modelFor = async (deps: Deps, collection: CollectionInfo): Promise<EmbeddingModel> => {
  const models = deps.models();
  const infos = await Promise.allSettled(models.map((m) => m.embedder.info()));
  const at = infos.findIndex((r) => r.status === "fulfilled" && idOf(r.value) === collection.model);
  const found = models[at];
  if (found !== undefined) return found;
  const down = infos.find((r): r is PromiseRejectedResult => r.status === "rejected");
  if (down !== undefined) throw down.reason;
  const serving = infos.map((r, i) => `${models[i]?.name ?? ""}: ${r.status === "fulfilled" ? idOf(r.value) : "?"}`).join(", ");
  return fail({ kind: "mismatch", message: `collection "${collection.name}" was embedded with ${collection.model}; no embed endpoint serves it now (${serving})` });
};

/**
 * Where indexing embeds a collection's chunks: its model's local endpoint, or
 * that model at the remote provider the collection was probed with.
 */
export const remoteFor = (collection: CollectionInfo, model: EmbeddingModel): RemoteEmbedder | undefined => {
  if (collection.provider === "local") return undefined;
  const remote = model.remote[collection.provider];
  if (remote === undefined)
    return fail(configError(`collection "${collection.name}" is embedded at ${collection.provider}, and the ${model.name} model has no ${collection.provider} counterpart configured`, "RAG_EMBED_MODELS"));
  if (remote.model !== collection.provider_model)
    fail({
      kind: "mismatch",
      message: `collection "${collection.name}" is embedded at ${collection.provider} with ${collection.provider_model}; the server is set to ask it for ${remote.model}. create_collection with that provider probes the new model`,
    });
  return remote;
};

/**
 * Proves a remote provider embeds as the model's local endpoint does: the
 * probe texts through both, and every pair at least MIN_PROBE_COSINE alike.
 * Refuses the provider otherwise, saying how far apart they were.
 */
export const probeProvider = async (deps: Deps, model: EmbeddingModel, provider: RemoteProvider, local: { readonly model: string }): Promise<ProbeResult> => {
  const missing = await deps.providers[provider].missing();
  if (missing.length > 0) return fail({ kind: "config", variable: missing[0] ?? "", message: `the ${provider} provider is not configured: ${missing.join(", ")} not set` });
  const remote = model.remote[provider] ?? fail(configError(`the ${model.name} model has no ${provider} counterpart configured (cloudflare_model in RAG_EMBED_MODELS)`, "RAG_EMBED_MODELS"));
  const [mine, theirs] = await Promise.all([model.embedder.embed(PROBE_TEXTS), remote.embed(PROBE_TEXTS)]);
  const probe = compareProbe(mine, theirs.vectors);
  if (!probe.agrees)
    return fail({
      kind: "mismatch",
      message: `${provider}'s ${remote.model} does not embed as the local ${local.model}: probe cosine ${probe.min_cosine} (at least 0.999 needed), dimensions ${probe.dimensions.join(" and ")}; its vectors would not be found by questions embedded locally`,
    });
  return probe;
};

/** Where a collection's chunks will be embedded: the local model, or a remote provider that passed the probe. */
const settingFor = async (deps: Deps, model: EmbeddingModel, provider: Provider, local: { readonly model: string }): Promise<ProviderSetting> =>
  provider === "local"
    ? { provider: "local", provider_model: local.model }
    : { provider, provider_model: model.remote[provider]?.model ?? "", provider_probe: await probeProvider(deps, model, provider, local) };

export const listCollections = async (deps: Deps) => {
  const rows = await deps.store.collections();
  return { count: rows.length, collections: rows };
};

/**
 * Makes a collection with an embedding model (the default unless one is
 * named), or, for one that exists, checks its description and model, builds
 * its own vector index if it was made without one, and moves it to another
 * embedding provider when one is named. A remote provider is probed first and
 * refused unless it embeds as the model's local endpoint does, so chunks from
 * either provider sit in one index and every question, embedded locally,
 * finds both.
 */
export const createCollection = async (
  deps: Deps,
  args: { readonly name: string; readonly description?: string | undefined; readonly provider?: Provider | undefined; readonly embeddingModel?: string | undefined },
) => {
  if (!COLLECTION_NAME.test(args.name)) return fail(inputError(`"${args.name}" is not a collection name: lowercase letters, digits, - and _, at most 63, starting with a letter or digit`));
  const existing = (await deps.store.collectionInfos()).find((c) => c.name === args.name);
  if (existing !== undefined && args.description !== undefined && existing.description !== args.description)
    return fail(inputError(`collection "${args.name}" exists with another description ("${existing.description}"); drop it first or keep its description`));
  const embedding = existing !== undefined && args.embeddingModel === undefined ? await modelFor(deps, existing) : modelNamed(deps, args.embeddingModel);
  const model = await describeModel(embedding);
  if (existing !== undefined && existing.model !== model.model)
    return fail(inputError(`collection "${args.name}" was embedded with ${existing.model}, and ${embedding.name} serves ${model.model}: a collection keeps its model, so make another one for this model`));
  await deps.store.ensureSchema(model.dimension);
  const wanted = args.provider ?? existing?.provider ?? "local";
  const switching = existing !== undefined && existing.provider !== wanted;
  const setting = existing === undefined || switching ? await settingFor(deps, embedding, wanted, model) : undefined;
  const created =
    existing === undefined && setting !== undefined
      ? await deps.store.createCollection({ name: args.name, description: args.description ?? "", model: model.model, dimension: model.dimension, ...setting })
      : false;
  const indexed = existing === undefined ? false : await deps.store.ensureIndex(args.name);
  if (switching && setting !== undefined) await deps.store.setProvider(args.name, setting);
  const row = (await deps.store.collections()).find((c) => c.name === args.name) ?? fail(notFound(`no collection named "${args.name}"`));
  return {
    created,
    embedding_model: embedding.name,
    ...(switching ? { switched: { from: existing.provider, to: wanted } } : {}),
    ...(indexed ? { vector_index: "built: the collection had none of its own" } : {}),
    collection: row,
  };
};

export const dropCollection = async (deps: Deps, name: string) => {
  const removed = await deps.store.dropCollection(name);
  if (removed === undefined) return fail(notFound(`no collection named "${name}"`));
  return { dropped: name, ...removed };
};

import { describeFailure } from "../../domain/errors.js";
import type { Deps } from "../ports.js";
import { describeModel } from "./collections.js";

/** One part's answer: what it says, or why it could not say it. */
const part = async <T extends object>(read: () => Promise<T>): Promise<({ readonly ok: true } & T) | { readonly ok: false; readonly error: string }> => {
  try {
    return { ok: true, ...(await read()) };
  } catch (thrown) {
    return { ok: false, error: describeFailure(thrown) };
  }
};

/**
 * Whether search and indexing can work: the database with its extensions and
 * tables, each embed endpoint with its model and dimension, the rerank
 * endpoint, and the text extractors on PATH. ok means the database, every
 * embedding model and the reranker answer; a missing extractor is listed under
 * problems, since only the files that need it fail.
 */
export const checkHealth = async (deps: Deps) => {
  const [database, models, rerank, tools, providers, existing] = await Promise.all([
    part(() => deps.store.status()),
    part(async () => ({ list: await Promise.all(deps.models().map(async (m) => ({ m, described: await part(() => describeModel(m)) }))) })),
    part(() => deps.reranker.info()),
    deps.extractor.tools(),
    Promise.all(Object.entries(deps.providers).map(async ([name, p]) => ({ name, missing: await p.missing() }))),
    part(async () => ({ names: (await deps.store.collectionInfos()).map((c) => c.name) })),
  ]);
  const localOnly = [...deps.localOnly].sort();
  // Informational: a collection can be created later and is covered from then on. Left out when the database did not answer.
  const unknown = existing.ok ? localOnly.filter((name) => !existing.names.includes(name)) : [];
  const list = models.ok ? models.list : [];
  const embedding_models = list.map(({ m, described }) => ({
    ...(described.ok ? described : { name: m.name, ok: false, error: described.error }),
    ...(m.queryPrompt === undefined ? {} : { query_prompt: m.queryPrompt }),
    remote: Object.fromEntries(Object.entries(m.remote).map(([provider, r]) => [provider, r.model])),
  }));
  const dimension = database.ok ? database.dimension : undefined;
  const problems = [
    ...(database.ok ? [] : [`database: ${database.error}`]),
    ...(database.ok && database.vector === undefined ? ["database: the vector extension is not installed in this database"] : []),
    ...(models.ok ? [] : [`embed: ${models.error}`]),
    ...list.flatMap(({ m, described }) => (described.ok ? [] : [`embed (${m.name}): ${described.error}`])),
    ...list.flatMap(({ m, described }) =>
      described.ok && dimension !== undefined && described.dimension !== dimension
        ? [`the tables hold ${dimension}-dimension vectors, the ${m.name} model makes ${described.dimension}: it cannot have collections in this database`]
        : [],
    ),
    ...(rerank.ok ? [] : [`rerank: ${rerank.error}`]),
    ...deps.localOnlyInvalid.map((entry) => `RAG_LOCAL_ONLY_COLLECTIONS lists "${entry}", which is not a collection name (lowercase letters, digits, - and _): it protects nothing`),
    ...(database.ok && database.unindexed.length > 0
      ? [`collections without a vector index of their own, searched through the shared one: ${database.unindexed.join(", ")}; create_collection with each name builds it`]
      : []),
    ...Object.entries(tools)
      .filter(([, v]) => v.startsWith("missing"))
      .map(([name, v]) => `${name}: ${v}`),
  ];
  const ok = database.ok && database.vector !== undefined && models.ok && list.every((x) => x.described.ok) && rerank.ok && deps.localOnlyInvalid.length === 0;
  const first = embedding_models[0];
  return {
    ok,
    ...(problems.length === 0 ? {} : { problems }),
    database,
    // The default model, which create_collection uses when none is named.
    embed: first ?? { ok: false, error: models.ok ? "no embedding model" : models.error },
    embedding_models,
    rerank,
    extractors: tools,
    // What each remote provider would need, read from the settings: health never spends a provider's units.
    providers: Object.fromEntries(providers.map(({ name, missing }) => [name, { configured: missing.length === 0, ...(missing.length === 0 ? {} : { missing }) }])),
    ...(deps.inference === undefined ? {} : { query_inference: deps.inference.status() }),
    // Whose questions and passages stay on this machine even when a remote query provider is configured.
    local_only_collections: localOnly,
    ...(unknown.length === 0 ? {} : { local_only_unknown: unknown }),
    ...(deps.localOnlyInvalid.length === 0 ? {} : { local_only_invalid: deps.localOnlyInvalid }),
    roots: deps.sources.roots,
    language: deps.settings.language,
  };
};

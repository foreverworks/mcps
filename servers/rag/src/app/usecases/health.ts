import { describeFailure } from "../../domain/errors.js";
import type { Deps } from "../ports.js";
import { embeddingModel } from "./collections.js";

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
 * tables, the embed endpoint with its model and dimension, the rerank endpoint,
 * and the text extractors on PATH. ok means the first three answer; a missing
 * extractor is listed under problems, since only the files that need it fail.
 */
export const checkHealth = async (deps: Deps) => {
  const [database, embed, rerank, tools, providers] = await Promise.all([
    part(() => deps.store.status()),
    part(() => embeddingModel(deps)),
    part(() => deps.reranker.info()),
    deps.extractor.tools(),
    Promise.all(Object.values(deps.remote).map(async (r) => ({ remote: r, missing: await r.missing() }))),
  ]);
  const problems = [
    ...(database.ok ? [] : [`database: ${database.error}`]),
    ...(database.ok && database.vector === undefined ? ["database: the vector extension is not installed in this database"] : []),
    ...(embed.ok ? [] : [`embed: ${embed.error}`]),
    ...(rerank.ok ? [] : [`rerank: ${rerank.error}`]),
    ...(database.ok && embed.ok && database.dimension !== undefined && database.dimension !== embed.dimension
      ? [`the tables hold ${database.dimension}-dimension vectors, the embed endpoint makes ${embed.dimension}`]
      : []),
    ...Object.entries(tools)
      .filter(([, v]) => v.startsWith("missing"))
      .map(([name, v]) => `${name}: ${v}`),
  ];
  const ok = database.ok && database.vector !== undefined && embed.ok && rerank.ok;
  return {
    ok,
    ...(problems.length === 0 ? {} : { problems }),
    database,
    embed,
    rerank,
    extractors: tools,
    // What each remote provider would need, read from the settings: health never spends a provider's units.
    providers: Object.fromEntries(providers.map(({ remote, missing }) => [remote.provider, { model: remote.model, configured: missing.length === 0, ...(missing.length === 0 ? {} : { missing }) }])),
    roots: deps.sources.roots,
    language: deps.settings.language,
  };
};

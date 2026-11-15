import { callSignal } from "@foreverworks/mcp-kit";

import type { EmbeddingModel, InferenceTrace, QueryInference, RemoteEmbedder, RemoteReranker, Reranker } from "./ports.js";
import { asAppError, fail } from "../domain/errors.js";
import { addUsage, batches, compareProbe, NO_USAGE, PROBE_TEXTS, type ProbeResult, type Usage } from "../domain/provider.js";

type Options = {
  readonly provider: "local" | "cloudflare";
  readonly remote: (model: EmbeddingModel) => RemoteEmbedder | undefined;
  readonly remoteReranker: RemoteReranker;
  readonly localReranker: Reranker;
  readonly batch: number;
  readonly timeoutMs: number;
  readonly now?: () => number;
  readonly observe?: (trace: InferenceTrace) => void;
};

/** Only closed categories survive a failure. Providers may echo private input in an error body. */
const fallbackOf = (thrown: unknown): NonNullable<InferenceTrace["fallback"]> => {
  const e = asAppError(thrown);
  const status = e !== undefined && "status" in e ? e.status : undefined;
  const reason = e?.kind === "provider" ? e.reason === "rejected" ? "invalid_response" : e.reason : e?.kind === "mismatch" ? "incompatible_vectors" : e?.kind === "config" ? "unconfigured" : "unreachable";
  const timeout = /timeout|timed out/iu.test(e?.message ?? (thrown instanceof Error ? thrown.message : ""));
  return { reason: timeout ? "timeout" : reason, ...(status === undefined ? {} : { status }) };
};

const validVectors = (vectors: readonly (readonly number[])[], count: number, dimension: number): boolean =>
  vectors.length === count && vectors.every((v) => v.length === dimension && v.every(Number.isFinite) && v.some((x) => x !== 0));

/**
 * Query inference is independent of a collection's indexing provider. A successful
 * equivalence probe lives for an hour, keyed by the local model and revision and
 * its remote counterpart. Failures are never cached: the next call tries remote
 * again. A rerank failure redoes ALL candidates locally, so models' scores never mix.
 */
export const makeQueryInference = (options: Options): QueryInference => {
  const now = options.now ?? Date.now;
  const probes = new Map<string, { until: number; probe: ProbeResult }>();
  const running = new Map<string, Promise<void>>();
  const verify = async (model: EmbeddingModel, remote: RemoteEmbedder) => {
    // A named local prompt has no portable meaning at a remote endpoint.
    if (model.queryPrompt !== undefined) fail({ kind: "mismatch", message: "remote query prompts need an explicit compatible mapping" });
    const info = await model.embedder.info();
    const key = `${model.name}:${info.model}@${info.revision ?? ""}:${remote.model}`;
    if ((probes.get(key)?.until ?? 0) > now()) return;
    const pending = running.get(key);
    if (pending !== undefined) return pending;
    const check = (async () => {
      const [local, other] = await Promise.all([model.embedder.embed(PROBE_TEXTS), remote.embed(PROBE_TEXTS)]);
      const probe = compareProbe(local, other.vectors);
      if (!probe.agrees) return fail({ kind: "mismatch", message: "remote query vectors do not agree with the local index model" });
      probes.set(key, { until: now() + 3_600_000, probe });
    })();
    running.set(key, check);
    try { await check; } finally { running.delete(key); }
  };
  const complete = (trace: InferenceTrace): InferenceTrace => { options.observe?.(trace); return trace; };
  return {
    status: () => ({ primary: options.provider, fallback: "local", remote_timeout_ms: options.timeoutMs, probes: [...probes.values()].filter((p) => p.until > now()).map((p) => p.probe) }),
    embed: async (model, texts, dimension) => {
      const start = now();
      let fallback: InferenceTrace["fallback"];
      if (options.provider === "cloudflare") {
        try {
          const remote = options.remote(model);
          if (remote === undefined) return fail({ kind: "config", message: "no remote counterpart for this embedding model" });
          await verify(model, remote);
          const out = await remote.embed(texts);
          if (!validVectors(out.vectors, texts.length, dimension)) return fail({ kind: "provider", provider: "cloudflare", reason: "rejected", message: "invalid query vectors" });
          return { vectors: out.vectors, trace: complete({ stage: "embed", provider: "cloudflare", model: remote.model, elapsed_ms: now() - start, usage: out.usage }) };
        } catch (thrown) {
          if (callSignal()?.aborted) throw thrown;
          fallback = fallbackOf(thrown);
        }
      }
      const vectors = await model.embedder.embed(texts, { prompt: model.queryPrompt });
      if (!validVectors(vectors, texts.length, dimension)) return fail({ kind: "model", endpoint: "embed", message: "invalid local query vectors" });
      return { vectors, trace: complete({ stage: "embed", provider: "local", model: model.name, elapsed_ms: now() - start, ...(fallback === undefined ? {} : { fallback }) }) };
    },
    rerank: async (query, texts) => {
      const start = now();
      let fallback: InferenceTrace["fallback"];
      if (options.provider === "cloudflare") {
        try {
          const scores: { index: number; score: number }[] = [];
          let usage: Usage = NO_USAGE;
          for (const [at, batch] of batches(texts, options.batch).entries()) {
            const out = await options.remoteReranker.rerank(query, batch);
            scores.push(...out.scores.map((s) => ({ index: s.index + at * options.batch, score: s.score })));
            usage = addUsage(usage, out.usage);
          }
          return { scores: scores.sort((a, b) => b.score - a.score), trace: complete({ stage: "rerank", provider: "cloudflare", model: options.remoteReranker.model, elapsed_ms: now() - start, usage }) };
        } catch (thrown) {
          if (callSignal()?.aborted) throw thrown;
          fallback = fallbackOf(thrown);
        }
      }
      const scores: { index: number; score: number }[] = [];
      for (const [at, batch] of batches(texts, options.batch).entries()) {
        const out = await options.localReranker.rerank(query, batch);
        scores.push(...out.map((s) => ({ index: s.index + at * options.batch, score: s.score })));
      }
      const info = await options.localReranker.info();
      return { scores: scores.sort((a, b) => b.score - a.score), trace: complete({ stage: "rerank", provider: "local", model: info.model, elapsed_ms: now() - start, ...(fallback === undefined ? {} : { fallback }) }) };
    },
  };
};

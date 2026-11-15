import { describe, expect, it, vi } from "vitest";

import { makeQueryInference } from "../src/app/inference.js";
import type { EmbeddingModel, InferenceTrace, RemoteEmbedder, Reranker } from "../src/app/ports.js";
import { fail } from "../src/domain/errors.js";
import { NO_USAGE, PROBE_TEXTS } from "../src/domain/provider.js";

const setup = () => {
  const local = vi.fn(async (texts: readonly string[]) => texts.map(() => [1, 0]));
  const model: EmbeddingModel = { name: "example", embedder: { info: async () => ({ model: "example/embed", revision: "one" }), embed: local }, remote: {} };
  const embed = vi.fn(async (texts: readonly string[]) => texts.map(() => [1, 0]));
  const remote: RemoteEmbedder = { provider: "cloudflare", model: "@cf/example/embed", batch: 32, missing: async () => [], embed: async (texts) => ({ vectors: await embed(texts), usage: NO_USAGE }) };
  const localRank = vi.fn(async (_query: string, texts: readonly string[]) => texts.map((_, index) => ({ index, score: 1 / (index + 1) })));
  const reranker: Reranker = { info: async () => ({ model: "example/rerank" }), rerank: localRank };
  const rank = vi.fn(async (_query: string, texts: readonly string[]) => ({ scores: texts.map((_, index) => ({ index, score: 0.9 })), usage: NO_USAGE }));
  const traces: InferenceTrace[] = [];
  let time = 0;
  const inference = makeQueryInference({ provider: "cloudflare", remote: () => remote, remoteReranker: { model: "@cf/example/rerank", rerank: rank }, localReranker: reranker, batch: 2, timeoutMs: 2000, now: () => time, observe: (t) => traces.push(t) });
  return { inference, model, local, embed, localRank, rank, traces, advance: () => { time += 3_600_001; } };
};

describe("query inference", () => {
  it("probes equivalence once, uses remote for both stages, and refreshes a successful probe", async () => {
    const s = setup();
    const result = await s.inference.embed(s.model, ["question"], 2);
    expect(result.trace.provider).toBe("cloudflare");
    expect(s.embed.mock.calls.map(([texts]) => texts)).toEqual([PROBE_TEXTS, ["question"]]);
    const localCalls = s.local.mock.calls.length;
    await s.inference.embed(s.model, ["another"], 2);
    expect(s.local).toHaveBeenCalledTimes(localCalls);
    expect((await s.inference.rerank("question", ["one", "two", "three"])).trace.provider).toBe("cloudflare");
    expect(s.localRank).not.toHaveBeenCalled();
    s.advance();
    await s.inference.embed(s.model, ["question"], 2);
    expect(s.embed.mock.calls.filter(([texts]) => texts === PROBE_TEXTS)).toHaveLength(2);
  });

  it.each(["quota", "rate_limited", "unreachable", "auth", "rejected"] as const)("falls back after %s, redacts the failure, and retries remote on the next call", async (reason) => {
    const s = setup();
    await s.inference.embed(s.model, ["warm"], 2);
    s.embed.mockRejectedValueOnce({});
    // Tagged provider failures, including an error that echoes private input.
    s.rank.mockImplementationOnce(async () => fail({ kind: "provider", provider: "cloudflare", reason, status: 429, message: "private question secret-token" }));
    const result = await s.inference.rerank("private question", ["one", "two", "three"]);
    expect(result.trace).toMatchObject({ provider: "local", fallback: { reason: reason === "rejected" ? "invalid_response" : reason, status: 429 } });
    expect(JSON.stringify(s.traces)).not.toMatch(/private question|secret-token/);
    expect((await s.inference.rerank("question", ["one", "two"])).trace.provider).toBe("cloudflare");
    expect((await s.inference.embed(s.model, ["question"], 2)).trace.provider).toBe("local");
    expect((await s.inference.embed(s.model, ["question"], 2)).trace.provider).toBe("cloudflare");
  });

  it("rejects incompatible probes and invalid query vectors, without caching a failure", async () => {
    const s = setup();
    s.embed.mockResolvedValueOnce(PROBE_TEXTS.map(() => [0, 1]));
    expect((await s.inference.embed(s.model, ["q"], 2)).trace.fallback?.reason).toBe("incompatible_vectors");
    expect((await s.inference.embed(s.model, ["q"], 2)).trace.provider).toBe("cloudflare");
    for (const vector of [[1], [0, 0], [NaN, 1], [Infinity, 1]]) {
      s.embed.mockResolvedValueOnce([vector]);
      expect((await s.inference.embed(s.model, ["q"], 2)).trace.fallback?.reason).toBe("invalid_response");
    }
  });

  it("redoes the whole rerank locally if a later remote batch fails", async () => {
    const s = setup();
    s.rank.mockImplementationOnce(async () => ({ scores: [{ index: 1, score: 0.2 }, { index: 0, score: 0.1 }], usage: NO_USAGE }));
    s.rank.mockImplementationOnce(async () => { throw new Error("TimeoutError"); });
    const out = await s.inference.rerank("q", ["one", "two", "three"]);
    expect(out.trace).toMatchObject({ provider: "local", fallback: { reason: "timeout" } });
    expect(s.localRank.mock.calls.map(([, texts]) => texts)).toEqual([["one", "two"], ["three"]]);
    expect(out.scores.map((s) => s.score)).toEqual([1, 1, 0.5]);
  });

  it("reprobes after a local revision changes and declines unmapped query prompts", async () => {
    const s = setup();
    await s.inference.embed(s.model, ["q"], 2);
    const changed = { ...s.model, embedder: { ...s.model.embedder, info: async () => ({ model: "example/embed", revision: "two" }) } };
    await s.inference.embed(changed, ["q"], 2);
    expect(s.embed.mock.calls.filter(([texts]) => texts === PROBE_TEXTS)).toHaveLength(2);
    expect((await s.inference.embed({ ...s.model, queryPrompt: "query" }, ["q"], 2)).trace.fallback?.reason).toBe("incompatible_vectors");
  });
});

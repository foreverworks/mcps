import { callSignal } from "@foreverworks/mcp-kit";

import { fail, configError } from "../domain/errors.js";
import type { Embedder, ModelInfo, Reranker } from "../app/ports.js";

/**
 * Clients of a text-embeddings-inference server (Hugging Face's TEI) or
 * anything answering its routes: GET /info, POST /embed, POST /rerank. One
 * server per model is TEI's design, so each embedding model and the reranker
 * have a base URL of their own, and `variable` is the setting that gives it:
 * a missing one fails only the tools that need it.
 */
type Endpoint = "embed" | "rerank";

/** A rerank of 50 passages measured 23 s on 8 CPU cores; a long document's batch can take longer. */
const TIMEOUT_MS = 300_000;

export type Base = { readonly url: string | undefined; readonly variable: string };

const baseOf = (base: Base, endpoint: Endpoint): string => {
  const raw = base.url?.trim();
  if (!raw) return fail(configError(`${base.variable} is not set: the base URL of the ${endpoint} server`, base.variable));
  return raw.replace(/\/+$/u, "");
};

const call = async (base: Base, endpoint: Endpoint, path: string, body?: unknown): Promise<unknown> => {
  const url = `${baseOf(base, endpoint)}${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      // The deadline, or the client cancelling the call: a cancelled search does not wait out a slow rerank.
      signal: AbortSignal.any([AbortSignal.timeout(TIMEOUT_MS), ...[callSignal()].filter((x): x is AbortSignal => x !== undefined)]),
    });
  } catch (thrown) {
    return fail({ kind: "model", endpoint, message: `${url} did not answer: ${thrown instanceof Error ? thrown.message : String(thrown)}` });
  }
  const text = await response.text();
  if (!response.ok) return fail({ kind: "model", endpoint, status: response.status, message: `${url} answered ${response.status}: ${text.slice(0, 300)}` });
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return fail({ kind: "model", endpoint, message: `${url} answered something that is not JSON: ${text.slice(0, 120)}` });
  }
};

const infoOf = async (base: Base, endpoint: Endpoint): Promise<ModelInfo> => {
  const info = (await call(base, endpoint, "/info")) as { model_id?: unknown; model_sha?: unknown };
  if (typeof info.model_id !== "string") return fail({ kind: "model", endpoint, message: "/info names no model_id" });
  return { model: info.model_id, revision: typeof info.model_sha === "string" ? info.model_sha : undefined };
};

const isVector = (v: unknown): v is number[] => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "number");

export const makeEmbedder = (base: Base): Embedder => ({
  info: () => infoOf(base, "embed"),
  embed: async (texts, options = {}) => {
    if (texts.length === 0) return [];
    // prompt_name: the prompt the model's sentence-transformers configuration defines under that name, which TEI puts before each input.
    const out = await call(base, "embed", "/embed", { inputs: texts, truncate: true, ...(options.prompt === undefined ? {} : { prompt_name: options.prompt }) });
    if (!Array.isArray(out) || out.length !== texts.length || !out.every(isVector))
      return fail({ kind: "model", endpoint: "embed", message: `expected ${texts.length} vectors from /embed` });
    return out;
  },
});

export const makeReranker = (base: Base): Reranker => ({
  info: () => infoOf(base, "rerank"),
  rerank: async (query, texts) => {
    const out = await call(base, "rerank", "/rerank", { query, texts, truncate: true });
    const ok = Array.isArray(out) && out.every((r: unknown) => typeof r === "object" && r !== null && typeof (r as { index?: unknown }).index === "number" && typeof (r as { score?: unknown }).score === "number");
    if (!ok) return fail({ kind: "model", endpoint: "rerank", message: "expected [{index, score}] from /rerank" });
    return [...(out as { index: number; score: number }[])].sort((a, b) => b.score - a.score);
  },
});

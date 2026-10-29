import { fail, configError } from "../domain/errors.js";
import type { Embedder, ModelInfo, Reranker } from "../app/ports.js";

/**
 * Clients of a text-embeddings-inference server (Hugging Face's TEI) or
 * anything answering its routes: GET /info, POST /embed, POST /rerank. One
 * server per model is TEI's design, so the embed and rerank URLs are two
 * settings. Read on every call: a URL set while the server runs needs a
 * restart, but a missing one fails only the tools that need it.
 */
type Endpoint = "embed" | "rerank";

const VARIABLE: Readonly<Record<Endpoint, string>> = { embed: "RAG_EMBED_URL", rerank: "RAG_RERANK_URL" };

/** A rerank of 50 passages measured 23 s on 8 CPU cores; a long document's batch can take longer. */
const TIMEOUT_MS = 300_000;

const baseOf = (env: NodeJS.ProcessEnv, endpoint: Endpoint): string => {
  const raw = env[VARIABLE[endpoint]]?.trim();
  if (!raw) return fail(configError(`${VARIABLE[endpoint]} is not set: the base URL of the ${endpoint} server`, VARIABLE[endpoint]));
  return raw.replace(/\/+$/u, "");
};

const call = async (env: NodeJS.ProcessEnv, endpoint: Endpoint, path: string, body?: unknown): Promise<unknown> => {
  const url = `${baseOf(env, endpoint)}${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
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

const infoOf = async (env: NodeJS.ProcessEnv, endpoint: Endpoint): Promise<ModelInfo> => {
  const info = (await call(env, endpoint, "/info")) as { model_id?: unknown; model_sha?: unknown };
  if (typeof info.model_id !== "string") return fail({ kind: "model", endpoint, message: "/info names no model_id" });
  return { model: info.model_id, revision: typeof info.model_sha === "string" ? info.model_sha : undefined };
};

const isVector = (v: unknown): v is number[] => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "number");

export const makeEmbedder = (env: NodeJS.ProcessEnv): Embedder => ({
  info: () => infoOf(env, "embed"),
  embed: async (texts) => {
    if (texts.length === 0) return [];
    const out = await call(env, "embed", "/embed", { inputs: texts, truncate: true });
    if (!Array.isArray(out) || out.length !== texts.length || !out.every(isVector))
      return fail({ kind: "model", endpoint: "embed", message: `expected ${texts.length} vectors from /embed` });
    return out;
  },
});

export const makeReranker = (env: NodeJS.ProcessEnv): Reranker => ({
  info: () => infoOf(env, "rerank"),
  rerank: async (query, texts) => {
    const out = await call(env, "rerank", "/rerank", { query, texts, truncate: true });
    const ok = Array.isArray(out) && out.every((r: unknown) => typeof r === "object" && r !== null && typeof (r as { index?: unknown }).index === "number" && typeof (r as { score?: unknown }).score === "number");
    if (!ok) return fail({ kind: "model", endpoint: "rerank", message: "expected [{index, score}] from /rerank" });
    return [...(out as { index: number; score: number }[])].sort((a, b) => b.score - a.score);
  },
});

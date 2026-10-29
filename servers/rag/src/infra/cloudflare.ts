import { makeHttp, readSecret, type HttpFailure, type HttpOptions } from "@foreverworks/mcp-kit";

import type { RemoteEmbedder } from "../app/ports.js";
import { configError, fail } from "../domain/errors.js";
import type { Usage } from "../domain/provider.js";

/**
 * Cloudflare Workers AI as an embedding provider, over its REST API:
 * POST /accounts/{account}/ai/run/{model} with {text: [...]}, answered with
 * {data, shape, pooling, meta}. `meta` carries the input tokens and the
 * neurons the request was billed, which is what a call reports as spent.
 *
 * `@cf/baai/bge-m3` is BAAI/bge-m3 with CLS pooling, the same vectors
 * text-embeddings-inference makes from the same weights; create_collection
 * proves that with a probe before a collection uses it.
 *
 * Settings: RAG_CLOUDFLARE_ACCOUNT_ID, the API token from
 * RAG_CLOUDFLARE_API_TOKEN_FILE (or RAG_CLOUDFLARE_API_TOKEN for a local run),
 * RAG_CLOUDFLARE_MODEL, RAG_CLOUDFLARE_BATCH. Read on every call, so a missing
 * one fails only the collections that use this provider.
 */

export const DEFAULT_MODEL = "@cf/baai/bge-m3";
/** Texts per request: about 25,000 tokens of 1200-character chunks, well inside the model's 60,000-token window. */
export const DEFAULT_BATCH = 64;
const API = "https://api.cloudflare.com/client/v4";
const TOKEN = { file: "RAG_CLOUDFLARE_API_TOKEN_FILE", value: "RAG_CLOUDFLARE_API_TOKEN" } as const;

/** Workers AI's error codes that matter here (developers.cloudflare.com/workers-ai/platform/errors). */
const DAILY_ALLOCATION_SPENT = "3036";
const OUT_OF_CAPACITY = "3040";

type RunResult = {
  readonly result?: {
    readonly data?: unknown;
    readonly shape?: unknown;
    readonly meta?: { readonly neurons?: unknown; readonly cost_metric_name_1?: unknown; readonly cost_metric_value_1?: unknown };
  };
};

const reasonOf = (body: unknown): string | undefined => {
  const errors = (body as { errors?: { code?: unknown }[] } | undefined)?.errors;
  const code = Array.isArray(errors) ? errors[0]?.code : undefined;
  return typeof code === "number" || typeof code === "string" ? String(code) : undefined;
};

const messageOf = (failure: HttpFailure): string => {
  const errors = "body" in failure ? (failure.body as { errors?: { code?: unknown; message?: unknown }[] } | undefined)?.errors : undefined;
  const said = Array.isArray(errors) ? errors.map((e) => `${String(e.code)} ${String(e.message)}`).join("; ") : "";
  return said === "" ? failure.message : `${failure.message}: ${said}`;
};

const failureOf = (failure: HttpFailure): never => {
  const status = "status" in failure ? failure.status : undefined;
  const reason = "reason" in failure ? failure.reason : undefined;
  const message = messageOf(failure);
  const base = { kind: "provider" as const, provider: "cloudflare", message, ...(status === undefined || status === 0 ? {} : { status }) };
  if (reason === DAILY_ALLOCATION_SPENT) return fail({ ...base, reason: "quota", message: `Workers AI's daily free allocation is spent until 00:00 UTC (${message})` });
  if (status === 401 || status === 403) return fail({ ...base, reason: "auth" });
  if (failure.kind === "rate_limited") return fail({ ...base, reason: "rate_limited" });
  if (failure.kind === "transport" || (status !== undefined && status >= 500)) return fail({ ...base, reason: "unreachable" });
  return fail({ ...base, reason: "rejected" });
};

const positive = (raw: string | undefined, fallback: number): number => {
  const n = Number(raw?.trim());
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

const asVectors = (data: unknown, count: number): readonly (readonly number[])[] | undefined =>
  Array.isArray(data) && data.length === count && data.every((v: unknown) => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "number"))
    ? (data as number[][])
    : undefined;

/** What one answer says it cost: its input tokens and neurons, 0 where it says nothing. */
export const usageOf = (result: RunResult["result"], texts: number): Usage => {
  const meta = result?.meta;
  const tokens = meta?.cost_metric_name_1 === "input_tokens" && typeof meta.cost_metric_value_1 === "number" ? meta.cost_metric_value_1 : 0;
  const neurons = typeof meta?.neurons === "number" ? meta.neurons : 0;
  return { requests: 1, texts, tokens, neurons };
};

export const makeCloudflareEmbedder = (env: NodeJS.ProcessEnv, options: HttpOptions & { readonly fetch?: typeof fetch } = {}): RemoteEmbedder => {
  const account = () => env["RAG_CLOUDFLARE_ACCOUNT_ID"]?.trim() ?? "";
  const model = env["RAG_CLOUDFLARE_MODEL"]?.trim() || DEFAULT_MODEL;
  const token = async (): Promise<string> =>
    (await readSecret(env, TOKEN, (message) => fail(configError(message, TOKEN.file)))) ??
    fail(configError("no Cloudflare API token: RAG_CLOUDFLARE_API_TOKEN_FILE names the file that holds it", TOKEN.file));
  const http = makeHttp({
    service: "Workers AI",
    auth: { headers: async () => ({ Authorization: `Bearer ${await token()}` }) },
    // Out of capacity and server errors pass; a spent daily allocation does not until midnight UTC.
    isRetryable: (status, reason) => status >= 500 || status === 408 || reason === OUT_OF_CAPACITY,
    isRateLimited: (status, reason) => status === 429 && reason !== DAILY_ALLOCATION_SPENT,
    reasonOf,
    fail: failureOf,
    attempts: 6,
    timeoutMs: 120_000,
    ...options,
  });
  return {
    provider: "cloudflare",
    model,
    batch: positive(env["RAG_CLOUDFLARE_BATCH"], DEFAULT_BATCH),
    // A service's absent credential is a file holding a lone newline: the token is read, never only its setting.
    missing: async () => {
      const hasToken = await token().then(
        () => true,
        () => false,
      );
      return [...(account() === "" ? ["RAG_CLOUDFLARE_ACCOUNT_ID"] : []), ...(hasToken ? [] : [TOKEN.file])];
    },
    embed: async (texts) => {
      if (texts.length === 0) return { vectors: [], usage: { requests: 0, texts: 0, tokens: 0, neurons: 0 } };
      if (account() === "") return fail(configError("RAG_CLOUDFLARE_ACCOUNT_ID is not set: the Cloudflare account that runs Workers AI", "RAG_CLOUDFLARE_ACCOUNT_ID"));
      // Embedding is a computation: sending it twice changes nothing, so a lost answer is asked again.
      const out = await http<RunResult>(`${API}/accounts/${encodeURIComponent(account())}/ai/run/${model}`, { method: "POST", json: { text: texts }, idempotent: true });
      const vectors = asVectors(out.result?.data, texts.length);
      if (vectors === undefined) return fail({ kind: "provider", provider: "cloudflare", reason: "rejected", message: `expected ${texts.length} vectors from Workers AI's ${model}` });
      return { vectors, usage: usageOf(out.result, texts.length) };
    },
  };
};

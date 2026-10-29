/**
 * The Workers AI client against a fake fetch: the request it sends, the usage
 * it reads from `meta`, and what it does with Cloudflare's refusals.
 */
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { asAppError } from "../src/domain/errors.js";
import { addUsage, batches, compareProbe, cosine, MIN_PROBE_COSINE, NO_USAGE } from "../src/domain/provider.js";
import { makeCloudflareEmbedder, usageOf } from "../src/infra/cloudflare.js";

type Sent = { readonly url: string; readonly headers: Record<string, string>; readonly body: unknown };

const answer = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const ok = (texts: readonly string[]) =>
  answer(200, {
    success: true,
    errors: [],
    result: {
      shape: [texts.length, 3],
      data: texts.map((_, i) => [i, 1, 0]),
      pooling: "cls",
      meta: { cost_metric_name_1: "input_tokens", cost_metric_value_1: 7 * texts.length, neurons: 0.0075 * texts.length },
    },
  });

const refusal = (status: number, code: number, message: string, headers: Record<string, string> = {}) => answer(status, { success: false, errors: [{ code, message }], result: null }, headers);

const ENV = { RAG_CLOUDFLARE_ACCOUNT_ID: "0123456789abcdef0123456789abcdef", RAG_CLOUDFLARE_API_TOKEN: "test-token-not-real" };

const client = (replies: ((sent: Sent) => Response)[], env: NodeJS.ProcessEnv = ENV) => {
  const sent: Sent[] = [];
  const waits: number[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const one: Sent = { url: String(url), headers: (init?.headers ?? {}) as Record<string, string>, body: JSON.parse(String(init?.body ?? "null")) };
    sent.push(one);
    const reply = replies[Math.min(sent.length - 1, replies.length - 1)];
    if (reply === undefined) throw new Error("no reply");
    return reply(one);
  }) as typeof globalThis.fetch;
  const embedder = makeCloudflareEmbedder(env, { fetch, sleep: async (ms) => waits.push(ms), random: () => 0 });
  return { embedder, sent, waits };
};

const failureOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (thrown) {
    return asAppError(thrown);
  }
  throw new Error("expected a failure");
};

describe("the Workers AI client", () => {
  it("posts the texts to the account's model with the token, and reads vectors and usage", async () => {
    const { embedder, sent } = client([(s) => ok((s.body as { text: string[] }).text)]);
    const out = await embedder.embed(["one", "two"]);
    expect(sent[0]?.url).toBe("https://api.cloudflare.com/client/v4/accounts/0123456789abcdef0123456789abcdef/ai/run/@cf/baai/bge-m3");
    expect(sent[0]?.headers["Authorization"]).toBe("Bearer test-token-not-real");
    expect(sent[0]?.body).toEqual({ text: ["one", "two"] });
    expect(out.vectors).toEqual([
      [0, 1, 0],
      [1, 1, 0],
    ]);
    expect(out.usage).toEqual({ requests: 1, texts: 2, tokens: 14, neurons: 0.015 });
    expect(embedder.batch).toBe(64);
  });

  it("waits and asks again when Workers AI is out of capacity or rate-limited, honouring Retry-After", async () => {
    const { embedder, sent, waits } = client([() => refusal(429, 3040, "Capacity temporarily exceeded"), () => refusal(429, 3001, "Too many requests", { "Retry-After": "7" }), (s) => ok((s.body as { text: string[] }).text)]);
    const out = await embedder.embed(["one"]);
    expect(out.vectors).toHaveLength(1);
    expect(sent).toHaveLength(3);
    expect(waits[1]).toBe(7000);
  });

  it("stops at once when the daily free allocation is spent, saying it is a quota", async () => {
    const { embedder, sent } = client([() => refusal(429, 3036, "You have used up your daily free allocation of 10,000 neurons.")]);
    const error = await failureOf(embedder.embed(["one"]));
    expect(error).toMatchObject({ kind: "provider", provider: "cloudflare", reason: "quota", status: 429 });
    expect(error?.message).toContain("00:00 UTC");
    expect(sent).toHaveLength(1);
    const after = client([() => refusal(429, 4006, "you have used up your daily free allocation")]);
    expect(await failureOf(after.embedder.embed(["one"]))).toMatchObject({ reason: "quota", status: 429 });
    expect(after.sent).toHaveLength(1);
  });

  it("names a refused token as auth, and a server that keeps failing as unreachable", async () => {
    expect(await failureOf(client([() => refusal(401, 10000, "Authentication error")]).embedder.embed(["one"]))).toMatchObject({ reason: "auth", status: 401 });
    const down = client([() => answer(502, { success: false, errors: [] })]);
    expect(await failureOf(down.embedder.embed(["one"]))).toMatchObject({ reason: "unreachable", status: 502 });
    expect(down.sent).toHaveLength(6);
  });

  it("refuses an answer with the wrong number of vectors", async () => {
    const { embedder } = client([() => ok(["only one"])]);
    expect(await failureOf(embedder.embed(["one", "two"]))).toMatchObject({ kind: "provider", reason: "rejected" });
  });

  it("says which settings are missing without calling anything, and fails a call on them", async () => {
    const { embedder, sent } = client([(s) => ok((s.body as { text: string[] }).text)], {});
    expect(await embedder.missing()).toEqual(["RAG_CLOUDFLARE_ACCOUNT_ID", "RAG_CLOUDFLARE_API_TOKEN_FILE"]);
    // As a service is started without the credential: a file holding a lone newline.
    const dir = await mkdtemp(join(tmpdir(), "rag-cf-"));
    await writeFile(join(dir, "token"), "\n");
    expect(await client([], { ...ENV, RAG_CLOUDFLARE_API_TOKEN: undefined, RAG_CLOUDFLARE_API_TOKEN_FILE: join(dir, "token") }).embedder.missing()).toEqual(["RAG_CLOUDFLARE_API_TOKEN_FILE"]);
    expect(await client([]).embedder.missing()).toEqual([]);
    expect(await failureOf(embedder.embed(["one"]))).toMatchObject({ kind: "config", variable: "RAG_CLOUDFLARE_ACCOUNT_ID" });
    expect(sent).toHaveLength(0);
    expect(client([], { RAG_CLOUDFLARE_MODEL: "@cf/baai/other", RAG_CLOUDFLARE_BATCH: "16" }).embedder).toMatchObject({ model: "@cf/baai/other", batch: 16 });
  });

  it("reads usage only from the fields Workers AI names", () => {
    expect(usageOf(undefined, 3)).toEqual({ requests: 1, texts: 3, tokens: 0, neurons: 0 });
    expect(usageOf({ meta: { cost_metric_name_1: "output_tokens", cost_metric_value_1: 9, neurons: 0.5 } }, 1)).toEqual({ requests: 1, texts: 1, tokens: 0, neurons: 0.5 });
  });
});

describe("the probe and usage arithmetic", () => {
  it("accepts vectors alike to MIN_PROBE_COSINE and refuses others or another dimension", () => {
    const local = [
      [1, 0, 0],
      [0, 1, 0],
    ];
    expect(compareProbe(local, local)).toEqual({ agrees: true, min_cosine: 1, texts: 2, dimensions: [3, 3] });
    const near = [
      [1, 0.01, 0],
      [0, 1, 0],
    ];
    expect(cosine(local[0] ?? [], near[0] ?? [])).toBeGreaterThan(MIN_PROBE_COSINE);
    expect(compareProbe(local, near).agrees).toBe(true);
    const far = [
      [1, 0.2, 0],
      [0, 1, 0],
    ];
    expect(compareProbe(local, far)).toMatchObject({ agrees: false });
    expect(compareProbe(local, [[1, 0], [0, 1]])).toMatchObject({ agrees: false, dimensions: [3, 2] });
  });

  it("adds usage with neurons kept to a millionth, and cuts batches in order", () => {
    const one = { requests: 1, texts: 2, tokens: 20, neurons: 0.021491759 };
    expect(addUsage(addUsage(NO_USAGE, one), one)).toEqual({ requests: 2, texts: 4, tokens: 40, neurons: 0.042984 });
    expect(batches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(batches([], 3)).toEqual([]);
  });
});

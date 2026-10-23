/**
 * The adapter against a stubbed fetch: what each TypeSafe answer becomes.
 */
import { asFailure } from "@foreverworks/mcp-kit";
import { describe, expect, it } from "vitest";

import { buildDeps } from "../src/composition.js";
import { asAppError, remedyFor } from "../src/domain/errors.js";
import type { AskRequest } from "../src/domain/schema.js";

const REQUEST: AskRequest = {
  state: "Help! My payouts have been failing for 3 days.",
  model: "jev-latest",
  questions: { is_urgent: { type: "noul", instructions: "Does this convey urgency?" } },
};

const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A fetch that answers from a queue and records what it was sent. */
const stub = (...answers: Response[]) => {
  const sent: { url: string; init: RequestInit | undefined }[] = [];
  const fetch = (async (url: string, init?: RequestInit) => {
    sent.push({ url, init });
    const next = answers.shift();
    if (next === undefined) throw new Error("no more answers");
    return next;
  }) as typeof globalThis.fetch;
  return { fetch, sent };
};

const errorOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (thrown) {
    return asAppError(thrown) ?? JSON.parse(asFailure(thrown, { asAppError, remedyFor }).content[0].text);
  }
  throw new Error("expected a failure");
};

describe("the TypeSafe adapter", () => {
  it("posts the request with the key as a bearer token and checks the answer", async () => {
    const { fetch, sent } = stub(json(200, { model: "jev-1.13.0", answers: { is_urgent: { type: "noul", noul: 0.95 } }, usage: { input_tokens: 296, output_tokens: 20 } }));
    const deps = buildDeps({ TYPESAFE_API_KEY: "ts-key-123" }, { fetch });
    const result = await deps.systemOne.ask(REQUEST);
    expect(result.answers["is_urgent"]).toEqual({ type: "noul", noul: 0.95 });
    expect(sent[0]?.url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(new Headers(sent[0]?.init?.headers).get("authorization")).toBe("Bearer ts-key-123");
    expect(JSON.parse(String(sent[0]?.init?.body))).toEqual(REQUEST);
  });

  it("waits out an overloaded answer (529) and repeats", async () => {
    const { fetch, sent } = stub(
      json(529, { detail: "overloaded" }),
      json(200, { model: "jev-1.13.0", answers: { is_urgent: { type: "noul", noul: 0.5 } }, usage: { input_tokens: 1, output_tokens: 1 } }),
    );
    const waits: number[] = [];
    const deps = buildDeps({ TYPESAFE_API_KEY: "k" }, { fetch, sleep: async (ms) => waits.push(ms) });
    await expect(deps.systemOne.ask(REQUEST)).resolves.toMatchObject({ model: "jev-1.13.0" });
    expect(sent).toHaveLength(2);
    expect(waits).toHaveLength(1);
  });

  it("turns 401 into auth and 422 into input with TypeSafe's detail", async () => {
    const auth = await errorOf(buildDeps({ TYPESAFE_API_KEY: "k" }, { fetch: stub(json(401, { detail: "Invalid API key" })).fetch }).systemOne.ask(REQUEST));
    expect(auth).toMatchObject({ kind: "auth", status: 401 });
    const detail = { detail: [{ loc: ["body", "questions", "x", "criteria"], msg: "field required" }] };
    const input = await errorOf(buildDeps({ TYPESAFE_API_KEY: "k" }, { fetch: stub(json(422, detail)).fetch }).systemOne.ask(REQUEST));
    expect(input).toMatchObject({ kind: "input", detail });
  });

  it("takes a usage TypeSafe left unreported as null, not as drift", async () => {
    const { fetch } = stub(json(200, { model: "jev-1.14.0", answers: { is_urgent: { type: "noul", noul: 0.9 } }, usage: { input_tokens: null, output_tokens: 4 } }));
    const result = await buildDeps({ TYPESAFE_API_KEY: "k" }, { fetch }).systemOne.ask(REQUEST);
    expect(result.usage).toEqual({ input_tokens: null, output_tokens: 4 });
  });

  it("calls a missing answer drift, not an empty result", async () => {
    const { fetch } = stub(json(200, { model: "jev-1.13.0", answers: {}, usage: { input_tokens: 1, output_tokens: 1 } }));
    expect(await errorOf(buildDeps({ TYPESAFE_API_KEY: "k" }, { fetch }).systemOne.ask(REQUEST))).toMatchObject({ kind: "drift" });
  });

  it("fails without a key before sending anything, and names both variables", async () => {
    const { fetch, sent } = stub();
    const error = await errorOf(buildDeps({}, { fetch }).systemOne.ask(REQUEST));
    expect(error).toMatchObject({ kind: "config", message: expect.stringContaining("TYPESAFE_API_KEY_FILE") });
    expect(sent).toHaveLength(0);
  });

  it("reads the model list for health", async () => {
    const { fetch, sent } = stub(json(200, { models: [{ name: "jev-latest", description: "d", release_date: "2026-09-01" }] }));
    await expect(buildDeps({ TYPESAFE_API_KEY: "k", TYPESAFE_BASE_URL: "https://example.test/" }, { fetch }).systemOne.models()).resolves.toHaveLength(1);
    expect(sent[0]?.url).toBe("https://example.test/v1/models");
  });
});

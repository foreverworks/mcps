import type { HttpRequest } from "@foreverworks/mcp-kit";
import { z } from "zod";

import type { SystemOnePort } from "../app/ports.js";
import { driftError, fail } from "../domain/errors.js";
import type { AskRequest, AskResult, ModelCard } from "../domain/schema.js";

/**
 * The two endpoints, and the check that what came back is what the SDK's
 * types say it is. The only module that knows a URL.
 */

const probabilities = z.record(z.string(), z.number());
const answer = z.discriminatedUnion("type", [
  z.object({ type: z.literal("noul"), noul: z.number() }),
  z.object({ type: z.literal("choice"), choice: z.string(), confidence: z.number(), probabilities }),
  z.object({ type: z.literal("score"), score: z.number(), confidence: z.number(), legend: z.record(z.string(), z.unknown()), probabilities }),
]);
const askResult = z.object({
  model: z.string(),
  answers: z.record(z.string(), answer),
  usage: z.object({ input_tokens: z.number().int().nullable(), output_tokens: z.number().int().nullable() }),
});
const modelList = z.object({ models: z.array(z.object({ name: z.string(), description: z.string(), release_date: z.string() })) });

const parsed = <T>(schema: z.ZodType<T>, body: unknown, what: string): T => {
  const result = schema.safeParse(body);
  return result.success ? result.data : fail(driftError(`${what} answered in an unknown shape: ${z.prettifyError(result.error).slice(0, 400)}`));
};

/** Every question asked has its answer, of its type; a missing one is drift, not an empty answer. */
const complete = (request: AskRequest, result: AskResult): AskResult => {
  for (const [id, question] of Object.entries(request.questions)) {
    const got = result.answers[id];
    if (got === undefined) return fail(driftError(`no answer for question "${id}"`));
    if (got.type !== question.type) return fail(driftError(`question "${id}" is a ${question.type} and was answered as a ${got.type}`));
  }
  return result;
};

export const makeTypesafeApi = (http: HttpRequest, baseUrl: string): SystemOnePort => ({
  ask: async (request) => {
    const body = await http<unknown>(`${baseUrl}/v1/systemone`, { method: "POST", json: request, idempotent: true });
    return complete(request, parsed(askResult, body, "POST /v1/systemone"));
  },
  models: async (): Promise<readonly ModelCard[]> => parsed(modelList, await http<unknown>(`${baseUrl}/v1/models`), "GET /v1/models").models,
});

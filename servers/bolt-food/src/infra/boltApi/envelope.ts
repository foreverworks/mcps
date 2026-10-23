import { jsonObject } from "@foreverworks/receipts/domain";

import { TOO_MANY_REQUESTS } from "../../domain/errors.js";
import type { RawEnvelope } from "../../domain/schema.js";

const envelopeOf = (body: unknown): RawEnvelope<unknown> | undefined =>
  typeof body === "object" && body !== null ? (body as RawEnvelope<unknown>) : undefined;

export const codeOf = (body: unknown): number | undefined => {
  const code = envelopeOf(body)?.code;
  return typeof code === "number" ? code : undefined;
};

export const messageOf = (body: unknown): string | undefined => {
  const message = envelopeOf(body)?.message;
  return typeof message === "string" ? message : undefined;
};

/**
 * Bolt answers HTTP 200 for almost everything; the body's `code` is the
 * verdict. Its throttle (code 1005) reaches the kit's HTTP client as the 429
 * it means, so the kit's backoff waits it out like any other API's; every
 * other answer passes through untouched.
 */
export const throttleAs429 =
  (inner: typeof fetch): typeof fetch =>
  async (input, init) => {
    const response = await inner(input, init);
    if (response.status !== 200) return response;
    const text = await response.text();
    const throttled = codeOf(jsonObject(text)) === TOO_MANY_REQUESTS;
    return new Response(text, { status: throttled ? 429 : 200, headers: response.headers });
  };

import {
  bearer,
  type BearerTokens,
  makeHttp,
  makeThrottle,
  NOT_JSON,
  type HttpFailure,
  type HttpOptions,
  type HttpRequest,
  type Throttle,
  type ThrottleClock,
} from "@foreverworks/mcp-kit";
import { z } from "zod";

import { apiError, DRIFT, fail, OUTCOME_UNKNOWN } from "../domain/errors.js";
import { GENERAL, ISSUING } from "./http/throttle.js";

/**
 * Oblio's side of the kit's HTTP client (packages/mcp-kit, http.ts): which
 * answers mean "later", the sentence an Oblio error leads with, and the failure
 * each outcome becomes. The loop, the backoff, the one token renewal after a
 * 401 and the rule that an issue is never sent twice are the kit's.
 *
 * What each failure proves decides what happens next:
 * - 429 proves Oblio did nothing: every request waits and repeats.
 * - 5xx and a dropped connection prove nothing: a read, a cancel or a restore
 *   repeats; an issue or a delete fails as `outcome_unknown` (oblioApi.ts marks
 *   which requests are which).
 */

/** Oblio's own sentence in a refusal: "Seria FCT nu exista" is the whole answer. */
const refusal = z.object({ statusMessage: z.string().min(1) });
export const messageOf = (body: unknown): string | undefined => {
  const parsed = refusal.safeParse(body);
  return parsed.success ? parsed.data.statusMessage : undefined;
};

const said = (body: unknown): string => {
  const message = messageOf(body);
  return message === undefined ? "" : `: ${message}`;
};

const asOblioFailure = (failure: HttpFailure): never => {
  switch (failure.kind) {
    case "transport":
      return fail(apiError(0, failure.message));
    case "outcome_unknown":
      return fail(
        apiError(failure.status, `${failure.message}${said(failure.body)}`, {
          reason: OUTCOME_UNKNOWN,
          ...(failure.body === undefined ? {} : { body: failure.body }),
        }),
      );
    case "rate_limited":
      return fail(apiError(failure.status, failure.message));
    case "rejected":
      // A 2xx that is not JSON is an answer Oblio does not document: drift, like any other shape.
      return fail(
        apiError(failure.status, messageOf(failure.body) ?? failure.message, {
          ...(failure.reason === NOT_JSON ? { reason: DRIFT } : {}),
          ...(failure.body === undefined ? {} : { body: failure.body }),
        }),
      );
  }
};

/** Documented throttling (429) and an unwell server are worth waiting for; every other answer is final. */
const isRetryable = (status: number): boolean => status === 429 || status >= 500;

export type OblioHttp = {
  /** Reads, cancel, restore, delete: paced by the general limit. */
  readonly request: HttpRequest;
  /** Requests that generate a document: paced by both limits. */
  readonly issue: HttpRequest;
};

export type OblioHttpOptions = HttpOptions & {
  /** What the throttles pace by; the real clock by default. */
  readonly clock?: ThrottleClock;
};

const realClock: ThrottleClock = { now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };

export const makeOblioHttp = (
  tokens: BearerTokens,
  { clock = realClock, ...options }: OblioHttpOptions = {},
): OblioHttp => {
  // One pair per process: over HTTP, every client's requests share them.
  const general = makeThrottle(GENERAL, clock);
  const issuing = makeThrottle(ISSUING, clock);
  const paced = (throttle: Throttle) =>
    makeHttp({
      service: "Oblio",
      auth: bearer(tokens),
      isRetryable,
      fail: asOblioFailure,
      attempts: 4,
      timeoutMs: 30_000,
      headers: { Accept: "application/json" },
      // Each attempt, retries included, waits its turn: every attempt is a request Oblio counts.
      fetch: (input, init) => throttle(() => fetch(input, init)),
      ...options,
    });
  return { request: paced(general), issue: paced((run) => issuing(() => general(run))) };
};

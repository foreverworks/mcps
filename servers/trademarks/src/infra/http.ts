import { makeHttp, makePacer, NOT_JSON, type HttpAuth, type HttpFailure, type HttpOptions, type HttpRequest } from "@foreverworks/mcp-kit";

import { driftError, fail, inputError } from "../domain/errors.js";

/**
 * The registers' side of the kit's HTTP client (packages/mcp-kit, http.ts):
 * which answers mean "later", the failure each outcome becomes, and the pace.
 * Every request here is a search or a lookup, so each is sent as idempotent
 * and a 5xx or a dropped connection is simply tried again.
 *
 * Both registers are public services run by public offices for people, so
 * the pace is set well under anything that could read as load: one request at
 * a time per source, `gapMs` apart, across every session the process serves.
 * A name check costs one request per office.
 */
export const USER_AGENT = "mcps-trademarks/1.0 (+https://github.com/foreverworks/mcps)";

export type RegisterHttpPolicy = {
  /** Names the source in every failure: `uspto-tmsearch`, `euipo-api`. */
  readonly source: string;
  /** Who is on the other end, in the kit's messages. */
  readonly service: string;
  readonly gapMs: number;
  readonly auth?: HttpAuth;
  /**
   * What a 401/403 after `auth` means: EUIPO issued a token, so the API's refusal is the product
   * subscription (`subscription`, the default); TSDR's key is the credential itself (`auth`).
   */
  readonly authRefusal?: "subscription" | "auth";
  /**
   * Whose fault a 400 is: the caller's (EUIPO names the part of the query it
   * refuses) or this server's (USPTO refusing a query built here means its
   * backend changed).
   */
  readonly badRequest: "input" | "drift";
  /** Added to a 401/403 from a source without credentials: what such a refusal probably means. */
  readonly refusedHint?: string;
  readonly headers?: Readonly<Record<string, string>>;
};

export type RegisterHttpOptions = HttpOptions & { readonly fetch?: typeof fetch };

const failureFor =
  (policy: RegisterHttpPolicy) =>
  (failure: HttpFailure): never => {
    const { source } = policy;
    switch (failure.kind) {
      case "transport":
        return fail({ kind: "api", source, status: 0, message: failure.message });
      case "outcome_unknown":
        return fail({ kind: "api", source, status: failure.status, message: failure.message });
      case "rate_limited":
        return fail({ kind: "rate_limited", source, status: failure.status, message: failure.message });
      case "rejected": {
        const { status, message } = failure;
        if (failure.reason === NOT_JSON) return fail(driftError(source, `${message}: the answer is not JSON`));
        // A token was issued (a refused one fails at the token endpoint first), so the API's
        // refusal is about the app's access to the product, not its credentials.
        if ((status === 401 || status === 403) && policy.auth !== undefined) return fail({ kind: policy.authRefusal ?? "subscription", source, status, message });
        if (status === 404) return fail({ kind: "not_found", message });
        if (status === 400)
          return policy.badRequest === "input" ? fail(inputError(message, failure.body)) : fail(driftError(source, `${message}: it refused a query this server built`));
        const hint = (status === 401 || status === 403) && policy.refusedHint !== undefined ? `; ${policy.refusedHint}` : "";
        return fail({ kind: "api", source, status, message: `${message}${hint}`, ...(failure.body === undefined ? {} : { body: failure.body }) });
      }
    }
  };

export const makeRegisterHttp = (policy: RegisterHttpPolicy, { fetch: injected, ...options }: RegisterHttpOptions = {}): HttpRequest => {
  const pace = makePacer(policy.gapMs, options.sleep === undefined ? {} : { sleep: options.sleep });
  // The global is read at call time, so the kit's egress guard (and a test's isolation) is the one in force.
  const send: typeof fetch = injected ?? ((input, init) => fetch(input, init));
  return makeHttp({
    service: policy.service,
    ...(policy.auth === undefined ? {} : { auth: policy.auth }),
    isRetryable: (status) => status === 429 || status >= 500,
    fail: failureFor(policy),
    attempts: 3,
    // A search answers in under a second measured (2026-10-05); twenty is a hung connection.
    timeoutMs: 20_000,
    headers: { "user-agent": USER_AGENT, accept: "application/json", ...policy.headers },
    fetch: (input, init) => pace(() => send(input, init)),
    ...options,
  });
};

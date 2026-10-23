import { backoffMs, retryAfterSeconds } from "./backoff.js";
import { callSignal, noteWriteSent, pause, unlessCancelled } from "./call.js";

/**
 * The one HTTP client every server uses: a request that retries what is worth
 * retrying and never repeats what might already have happened.
 *
 * What is shared is the loop: the query string, the body, the timeout, the
 * backoff schedule and Retry-After, one forced re-authentication after a 401,
 * the rule that a request which is not idempotent is NEVER retried once the
 * server may have acted on it, and cancellation: when the client cancels the
 * tool call (call.ts), nothing more is sent, a backoff stops, and a request
 * that is idempotent is abandoned in flight; one that is not runs to its answer
 * once sent, because abandoning it would leave its outcome unknown, and the
 * call then ends as `outcome_unknown` at its next check, never retried. What stays with each server is what it means:
 * which answers are worth waiting for (a plain 403 is a missing scope on Gmail
 * and a missing role on ANAF), how its errors name their reason, and the tagged
 * failure it reports under its own remedies. Those arrive as `HttpPolicy`.
 */

/**
 * A request that is not idempotent failed after the server may have acted on
 * it. The failure kind below, and the `reason` every server puts on its own
 * failure for it, so a remedy can say "look before you send it again".
 */
export const OUTCOME_UNKNOWN = "outcome_unknown";

/** Why a request failed, in the kit's words; each server turns it into its own failure. */
export type HttpFailure =
  | { readonly kind: "transport"; readonly message: string }
  /**
   * `reason` NOT_JSON: a 2xx whose body is not the JSON asked for (a gateway's
   * HTML page, a maintenance notice). `body` is a short, redacted preview.
   */
  /** A request that is not idempotent failed after the server may have acted on it. */
  | { readonly kind: typeof OUTCOME_UNKNOWN; readonly status: number; readonly message: string; readonly body?: unknown }
  /** Still rate-limited after every attempt. */
  | { readonly kind: "rate_limited"; readonly status: number; readonly reason: string | undefined; readonly message: string }
  | { readonly kind: "rejected"; readonly status: number; readonly reason: string | undefined; readonly message: string; readonly body?: unknown };

export type Sleep = (ms: number) => Promise<unknown>;

const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export type HttpAuth = {
  /** Headers for the next attempt: a bearer token, a signed JWT, a basic pair. */
  readonly headers: () => Promise<Readonly<Record<string, string>>>;
  /**
   * Called once after a 401 before the one retry it earns: a token can be
   * revoked before the expiry anyone cached for it. Absent: a 401 is final.
   */
  readonly renew?: () => Promise<unknown>;
};

export type HttpPolicy = {
  /** Who is on the other end, named in every failure message. */
  readonly service: string;
  readonly auth?: HttpAuth;
  /** Worth another attempt, for this API. */
  readonly isRetryable: (status: number, reason: string | undefined) => boolean;
  /** "Not so fast" rather than "no"; waits at least `quotaFloorMs`. Defaults to 429 only. */
  readonly isRateLimited?: (status: number, reason: string | undefined) => boolean;
  /**
   * An answer that proves the service did NOT act on the request (Notion's 409
   * `conflict_error`: the transaction was aborted), so even a request that is
   * not idempotent may be sent again. A rate limit is always one. Defaults to
   * none: for a request that is not idempotent, every other answer is final.
   */
  readonly isHarmless?: (status: number, reason: string | undefined) => boolean;
  /** The API's machine-readable reason in an error body, when it has one. */
  readonly reasonOf?: (body: unknown) => string | undefined;
  /** The server's own tagged failure. Must throw. */
  readonly fail: (failure: HttpFailure) => never;
  readonly attempts?: number;
  readonly timeoutMs?: number;
  /**
   * The least a rate-limit refusal waits. Drive's quota is per MINUTE, so the
   * general curve spends every attempt before the bucket refills. 0 elsewhere.
   */
  readonly quotaFloorMs?: number;
  /** Sent with every request (a User-Agent, an API version). */
  readonly headers?: Readonly<Record<string, string>>;
  readonly sleep?: Sleep;
  /** The backoff's jitter, in [0, 1). Math.random by default; a test pins it to assert exact waits. */
  readonly random?: () => number;
  readonly fetch?: typeof fetch;
};

/** What a server's HTTP constructor lets its caller (a test, mostly) tune; the rest is the server's policy. */
export type HttpOptions = Pick<HttpPolicy, "timeoutMs" | "sleep" | "random">;

export type Query = Readonly<Record<string, string | number | boolean | readonly (string | number)[] | undefined>>;

export type RequestSpec = {
  readonly method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly query?: Query;
  /** Sent as application/json. */
  readonly json?: unknown;
  /** Sent as application/x-www-form-urlencoded. */
  readonly form?: Readonly<Record<string, string>>;
  /** Sent as-is (an upload, a multipart body). */
  readonly body?: { readonly contentType: string; readonly data: string | Uint8Array };
  readonly headers?: Readonly<Record<string, string>>;
  /**
   * Whether sending it twice is harmless. GET, PUT, DELETE and PATCH are by
   * default, POST is not. A request that is not idempotent is retried only on
   * answers that prove nothing happened (a 401 before the renewal, a rate
   * limit, an answer the policy's `isHarmless` names); a transport error or a 5xx is reported as `outcome_unknown`, never
   * retried: the one thing worse than a failed invoice is the same invoice twice.
   */
  readonly idempotent?: boolean;
  /**
   * What to return: parsed JSON (the default; undefined for an empty body), text, or bytes.
   * A 2xx that is not JSON fails as `rejected` with reason NOT_JSON, or as
   * `outcome_unknown` for a request that is not idempotent: the server answered
   * 2xx, so it may well have acted.
   */
  readonly as?: "json" | "text" | "bytes";
};

const withQuery = (url: string, query: Query | undefined): string => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined) continue;
    for (const one of Array.isArray(value) ? value : [value]) params.append(key, String(one));
  }
  const qs = params.toString();
  return qs ? `${url}${url.includes("?") ? "&" : "?"}${qs}` : url;
};

const payloadOf = (spec: RequestSpec): { readonly contentType: string; readonly data: string | Uint8Array } | undefined =>
  spec.json !== undefined
    ? { contentType: "application/json; charset=UTF-8", data: JSON.stringify(spec.json) }
    : spec.form !== undefined
      ? { contentType: "application/x-www-form-urlencoded", data: new URLSearchParams(spec.form).toString() }
      : spec.body;

/**
 * A credential an answer echoed back, blanked. Some endpoints repeat the
 * request's headers in their body (ANAF's TestOauth hello does), and an error
 * body travels on into a tool result, i.e. into a model's context. So a bearer
 * token or a Basic pair in one is replaced before anything reads it. Sixteen
 * characters at least, so "Basic authentication failed" stays readable.
 */
const ECHOED_CREDENTIAL = /\b(Bearer|Basic)\s+[A-Za-z0-9\-._~+/]{16,}=*/gi;

export const redactCredentials = (text: string): string => text.replace(ECHOED_CREDENTIAL, "$1 [redacted]");

/** The `reason` on a 2xx whose body is not the JSON the request asked for. */
export const NOT_JSON = "not_json";

/** How much of a body that is not JSON a failure carries: enough to recognise an HTML error page. */
const PREVIEW_CHARS = 600;

type Body = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly text: string };

const readBody = async (response: Response, as: RequestSpec["as"]): Promise<Body> => {
  if (as === "bytes") return { ok: true, value: new Uint8Array(await response.arrayBuffer()) };
  const text = await response.text();
  if (as === "text") return { ok: true, value: text };
  if (text === "") return { ok: true, value: undefined };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, text };
  }
};

const previewOf = (text: string): string => {
  const clean = redactCredentials(text);
  return clean.length > PREVIEW_CHARS ? `${clean.slice(0, PREVIEW_CHARS)}...` : clean;
};

/** An error body, as JSON when it is JSON and as (bounded) text when it is not, with any echoed credential blanked. */
const errorBody = async (response: Response): Promise<unknown> => {
  const text = redactCredentials(await response.text().catch(() => ""));
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text.length > 0 ? text.slice(0, 2000) : undefined;
  }
};

const is429 = (status: number): boolean => status === 429;

export type HttpRequest = <T>(url: string, spec?: RequestSpec) => Promise<T>;

export const makeHttp = (policy: HttpPolicy): HttpRequest => {
  const {
    service,
    auth,
    isRetryable,
    isRateLimited = is429,
    isHarmless = () => false,
    reasonOf = () => undefined,
    fail,
    attempts = 5,
    timeoutMs = 30_000,
    quotaFloorMs = 0,
    sleep = realSleep,
    random,
  } = policy;
  const jitter = random === undefined ? {} : { random };

  return async <T>(url: string, spec: RequestSpec = {}): Promise<T> => {
    const method = spec.method ?? "GET";
    const idempotent = spec.idempotent ?? method !== "POST";
    const target = withQuery(url, spec.query);
    const payload = payloadOf(spec);
    const what = `${method} ${url}`;
    const doFetch = policy.fetch ?? fetch;

    const signal = callSignal();
    // A read listens to the call's signal in flight too; a write only before it is sent.
    const abortOf = (): AbortSignal => (idempotent && signal !== undefined ? AbortSignal.any([AbortSignal.timeout(timeoutMs), signal]) : AbortSignal.timeout(timeoutMs));

    const attempt = async (n: number, renewed: boolean): Promise<T> => {
      const last = n === attempts - 1;
      unlessCancelled(`${what} was not sent${n > 0 ? " again" : ""}`);
      // Outside the try: a missing credential or a revoked grant throws the server's own
      // failure, which is neither a transport error nor worth a retry.
      const authHeaders = auth ? await auth.headers() : {};
      if (!idempotent) noteWriteSent();
      const sent = await doFetch(target, {
        method,
        headers: {
          ...policy.headers,
          ...authHeaders,
          ...(payload ? { "Content-Type": payload.contentType } : {}),
          ...spec.headers,
        },
        ...(payload ? { body: payload.data } : {}),
        signal: abortOf(),
      }).then(
        (response) => ({ response }),
        (cause: unknown) => ({ cause: cause instanceof Error ? cause.message : String(cause) }),
      );

      if ("cause" in sent) {
        if (idempotent) unlessCancelled(`${what} was abandoned in flight`);
        if (!idempotent) return fail({ kind: OUTCOME_UNKNOWN, status: 0, message: `transport error on ${what}; ${service} may have acted on it: ${sent.cause}` });
        if (last) return fail({ kind: "transport", message: `${service} unreachable on ${what}: ${sent.cause}` });
        await pause(backoffMs(n, undefined, jitter), sleep, `${what} was not retried`);
        return attempt(n + 1, renewed);
      }
      const { response } = sent;

      if (response.ok) {
        const read = await readBody(response, spec.as).catch((cause: unknown) => {
          if (idempotent) unlessCancelled(`${what}'s answer was abandoned`);
          throw cause;
        });
        if (read.ok) return read.value as T;
        const said = `${service} answered ${what} with ${read.text.length} characters that are not JSON`;
        return idempotent
          ? fail({ kind: "rejected", status: response.status, reason: NOT_JSON, message: said, body: previewOf(read.text) })
          : fail({ kind: OUTCOME_UNKNOWN, status: response.status, message: `${said}; it may have acted on it`, body: previewOf(read.text) });
      }

      const body = await errorBody(response);
      const reason = reasonOf(body);
      if (response.status === 401 && auth?.renew !== undefined && !renewed) {
        await auth.renew();
        return attempt(n, true);
      }
      if (!idempotent && response.status >= 500) {
        return fail({ kind: OUTCOME_UNKNOWN, status: response.status, message: `${service} failed ${what}; it may have acted on it`, body });
      }
      const limited = isRateLimited(response.status, reason);
      if (limited && last) {
        return fail({ kind: "rate_limited", status: response.status, reason, message: `${service} kept refusing ${what} as rate-limited (${reason ?? response.status})` });
      }
      // A request that is not idempotent is retried only on an answer that proves nothing happened:
      // a rate limit, one the policy calls harmless (above, a 401 before the renewal). What a server
      // calls retryable (a 403 that means "later", a 408) does not prove that, so it is reported.
      const harmless = limited || isHarmless(response.status, reason);
      if (!(harmless || (idempotent && isRetryable(response.status, reason))) || last) {
        return fail({ kind: "rejected", status: response.status, reason, message: `${service} rejected ${what}`, body });
      }
      const wait = backoffMs(n, retryAfterSeconds(response.headers.get("Retry-After")), jitter);
      await pause(limited ? Math.max(quotaFloorMs, wait) : wait, sleep, `${what} was not retried`);
      return attempt(n + 1, renewed);
    };

    return attempt(0, false);
  };
};

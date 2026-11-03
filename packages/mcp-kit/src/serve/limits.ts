/**
 * The limits an HTTP server puts on its callers, as data and pure functions.
 *
 * A runaway agent loop is the realistic threat, not an attacker: one session
 * that calls a tool in a tight loop would otherwise spend a shared API quota
 * (Oblio allows 30 document calls per 100 s for the whole account) for every
 * other session on the box. So each CLIENT, the label of the token it
 * presented, has its own bucket. A public server has no tokens, so there each
 * caller's address has one (serve/public.ts).
 */

export type Limits = {
  /** Largest request body accepted, in bytes. */
  readonly maxBodyBytes: number;
  /** Longest a request may run before the server answers 504 for it. */
  readonly timeoutMs: number;
  /** Sustained requests per second, per client. */
  readonly ratePerSec: number;
  /** Requests a client may make at once after a quiet spell. */
  readonly burst: number;
};

/**
 * Generous on purpose. Many sessions can share ONE client label (one token), so
 * the rate is all of theirs together, and many sessions starting at once each
 * list tools. The timeout leaves room for the slowest legitimate call, a first
 * export of a long order history, which can take several minutes.
 */
export const DEFAULT_LIMITS: Limits = { maxBodyBytes: 4 * 1024 * 1024, timeoutMs: 900_000, ratePerSec: 20, burst: 200 };

const positive = (raw: string | undefined, name: string): number | undefined => {
  const value = raw?.trim();
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} "${value}" is not a positive number`);
  return parsed;
};

/** MCP_HTTP_MAX_BODY (bytes), MCP_HTTP_TIMEOUT_MS, MCP_HTTP_RATE ("<per second>/<burst>"). */
export const limitsFrom = (env: NodeJS.ProcessEnv): Limits => {
  const [rate, burst] = (env["MCP_HTTP_RATE"] ?? "").split("/");
  return {
    maxBodyBytes: positive(env["MCP_HTTP_MAX_BODY"], "MCP_HTTP_MAX_BODY") ?? DEFAULT_LIMITS.maxBodyBytes,
    timeoutMs: positive(env["MCP_HTTP_TIMEOUT_MS"], "MCP_HTTP_TIMEOUT_MS") ?? DEFAULT_LIMITS.timeoutMs,
    ratePerSec: positive(rate, "MCP_HTTP_RATE") ?? DEFAULT_LIMITS.ratePerSec,
    burst: positive(burst, "MCP_HTTP_RATE burst") ?? DEFAULT_LIMITS.burst,
  };
};

export type Bucket = { readonly tokens: number; readonly at: number };

/**
 * One token bucket step: refill for the time since `at`, then spend one if
 * there is one. Returns the new bucket and, when refused, how many seconds
 * until a token is back (the Retry-After).
 */
export const take = (
  bucket: Bucket | undefined,
  nowMs: number,
  { ratePerSec, burst }: Pick<Limits, "ratePerSec" | "burst">,
): { readonly bucket: Bucket; readonly allowed: boolean; readonly retryAfterSec: number } => {
  const start = bucket ?? { tokens: burst, at: nowMs };
  const refilled = Math.min(burst, start.tokens + ((nowMs - start.at) / 1000) * ratePerSec);
  return refilled >= 1
    ? { bucket: { tokens: refilled - 1, at: nowMs }, allowed: true, retryAfterSec: 0 }
    : { bucket: { tokens: refilled, at: nowMs }, allowed: false, retryAfterSec: Math.max(1, Math.ceil((1 - refilled) / ratePerSec)) };
};

/**
 * Whether a bucket has refilled to the brim by `nowMs`. It then holds what a
 * caller never seen before starts with, so forgetting it changes nothing.
 */
export const isFull = (bucket: Bucket, nowMs: number, { ratePerSec, burst }: Pick<Limits, "ratePerSec" | "burst">): boolean =>
  bucket.tokens + ((nowMs - bucket.at) / 1000) * ratePerSec >= burst;

/**
 * The most callers whose buckets are kept at once. On a public server the
 * callers are addresses, which anyone can bring by the thousand. A bucket
 * keyed by an IPv6 /64 holds about 230 bytes of heap (measured 2026-11-03,
 * Node 22, 100,000 of them), so this is about 2.3 MB at worst; and at the
 * default rate a bucket is full again, and forgotten, 10 s after its caller's
 * last request.
 */
export const MAX_CALLERS = 10_000;

/**
 * One request from `caller`, against the buckets of every caller: `take` on
 * the caller's own, then what memory needs. The map is the state, kept in the
 * order callers were last seen, and this is the one function that changes it.
 *
 * From the quiet end, a bucket that is full is dropped, which changes nothing
 * (isFull). When the map is still at `maxCallers`, the quietest caller is
 * forgotten even though its bucket is not full: that many distinct callers
 * within seconds is a flood the proxy in front must answer, and forgetting
 * costs that one caller a fresh burst, where keeping it would cost memory
 * without bound. A bucket is dropped once at most, so on average a request
 * costs the same however many callers there are.
 */
export const admit = (
  buckets: Map<string, Bucket>,
  caller: string,
  nowMs: number,
  limits: Pick<Limits, "ratePerSec" | "burst">,
  maxCallers: number = MAX_CALLERS,
): { readonly allowed: boolean; readonly retryAfterSec: number } => {
  const step = take(buckets.get(caller), nowMs, limits);
  buckets.delete(caller);
  for (const [key, bucket] of buckets) {
    if (buckets.size < maxCallers && !isFull(bucket, nowMs, limits)) break;
    buckets.delete(key);
  }
  buckets.set(caller, step.bucket);
  return { allowed: step.allowed, retryAfterSec: step.retryAfterSec };
};

/**
 * Whether a host may be reached. Patterns are exact hostnames or `*.` suffixes
 * (`*.googleapis.com` matches `gmail.googleapis.com`, not `googleapis.com`).
 */
export const hostAllowed = (host: string, patterns: readonly string[]): boolean => {
  const h = host.toLowerCase().replace(/\.$/, "");
  return patterns.some((p) => {
    const pattern = p.trim().toLowerCase();
    return pattern.startsWith("*.") ? h.endsWith(pattern.slice(1)) : h === pattern;
  });
};

/** MCP_EGRESS_ALLOW: comma-separated host patterns; unset means no in-process limit. */
export const egressFrom = (env: NodeJS.ProcessEnv): readonly string[] | undefined => {
  const raw = env["MCP_EGRESS_ALLOW"]?.trim();
  return raw ? raw.split(",").map((p) => p.trim()).filter((p) => p.length > 0) : undefined;
};

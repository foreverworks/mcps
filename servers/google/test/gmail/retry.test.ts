import { describe, expect, it } from "vitest";

import { backoffMs, isRetryable, retryAfterSeconds } from "../../src/infra/retry.js";

describe("isRetryable", () => {
  it("retries rate limits and server faults", () => {
    expect(isRetryable(429, undefined)).toBe(true);
    expect(isRetryable(500, undefined)).toBe(true);
    expect(isRetryable(403, "userRateLimitExceeded")).toBe(true);
  });

  it("does not retry a plain 403, because waiting cannot grant a scope", () => {
    expect(isRetryable(403, "insufficientPermissions")).toBe(false);
    expect(isRetryable(403, undefined)).toBe(false);
  });

  it("does not retry a 404", () => {
    expect(isRetryable(404, "notFound")).toBe(false);
  });
});

describe("backoff", () => {
  it("grows exponentially and stays bounded", () => {
    expect(backoffMs(0, undefined)).toBeLessThan(backoffMs(3, undefined));
    expect(backoffMs(20, undefined)).toBeLessThanOrEqual(33_000);
  });

  it("honours Retry-After over its own schedule", () => {
    expect(backoffMs(0, 7)).toBeGreaterThanOrEqual(7000);
  });

  it("ignores a Retry-After that is not a number", () => {
    expect(retryAfterSeconds("Wed, 26 Aug 2026 06:00:00 GMT")).toBeUndefined();
    expect(retryAfterSeconds("12")).toBe(12);
    expect(retryAfterSeconds(null)).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";

import { admit, DEFAULT_LIMITS, egressFrom, hostAllowed, isFull, limitsFrom, take, type Bucket } from "../src/serve/limits.js";
import { mergePolicies } from "../src/policy.js";

describe("take", () => {
  const limits = { ratePerSec: 2, burst: 3 };

  it("allows a burst, then refuses with a Retry-After, then refills with time", () => {
    const steps = { bucket: undefined as Bucket | undefined, allowed: [] as boolean[] };
    for (let i = 0; i < 4; i += 1) {
      const s = take(steps.bucket, 0, limits);
      steps.bucket = s.bucket;
      steps.allowed.push(s.allowed);
    }
    expect(steps.allowed).toEqual([true, true, true, false]);
    expect(take(steps.bucket, 0, limits).retryAfterSec).toBe(1);
    expect(take(steps.bucket, 500, limits).allowed).toBe(true);
  });

  it("never holds more than the burst", () => {
    expect(take({ tokens: 0, at: 0 }, 1_000_000, limits).bucket.tokens).toBe(2);
  });
});

describe("admit", () => {
  const limits = { ratePerSec: 2, burst: 3 };

  it("keeps a bucket per caller: one at its limit does not hold up another", () => {
    const buckets = new Map<string, Bucket>();
    const a = [0, 0, 0, 0].map(() => admit(buckets, "192.0.2.10", 0, limits).allowed);
    expect(a).toEqual([true, true, true, false]);
    expect(admit(buckets, "198.51.100.20", 0, limits)).toEqual({ allowed: true, retryAfterSec: 0 });
    expect(admit(buckets, "192.0.2.10", 0, limits)).toEqual({ allowed: false, retryAfterSec: 1 });
  });

  it("forgets a caller once its bucket is full again, which changes nothing it is allowed", () => {
    const buckets = new Map<string, Bucket>();
    for (let i = 0; i < 50; i += 1) admit(buckets, `192.0.2.${i}`, 0, limits);
    expect(buckets.size).toBe(50);
    expect(isFull(buckets.get("192.0.2.0")!, 499, limits)).toBe(false);
    expect(isFull(buckets.get("192.0.2.0")!, 500, limits)).toBe(true);
    admit(buckets, "198.51.100.20", 500, limits);
    expect([...buckets.keys()]).toEqual(["198.51.100.20"]);
  });

  it("keeps a caller that is still spending, and drops a quiet one", () => {
    const buckets = new Map<string, Bucket>();
    admit(buckets, "quiet", 0, limits);
    for (let t = 0; t <= 2000; t += 100) admit(buckets, "busy", t, limits);
    expect([...buckets.keys()]).toEqual(["busy"]);
  });

  it("stays bounded under a flood of callers, forgetting the quietest first", () => {
    const buckets = new Map<string, Bucket>();
    for (let i = 0; i < 10_000; i += 1) admit(buckets, `caller-${i}`, i / 1000, limits, 100);
    expect(buckets.size).toBe(100);
    expect(buckets.has("caller-9999")).toBe(true);
    expect(buckets.has("caller-9899")).toBe(false);
  });
});

describe("limitsFrom", () => {
  it("defaults, and reads each variable", () => {
    expect(limitsFrom({})).toEqual(DEFAULT_LIMITS);
    expect(limitsFrom({ MCP_HTTP_MAX_BODY: "1024", MCP_HTTP_TIMEOUT_MS: "5000", MCP_HTTP_RATE: "5/20" })).toEqual({
      maxBodyBytes: 1024,
      timeoutMs: 5000,
      ratePerSec: 5,
      burst: 20,
    });
  });

  it("refuses nonsense rather than running unlimited", () => {
    expect(() => limitsFrom({ MCP_HTTP_RATE: "fast/20" })).toThrow(/MCP_HTTP_RATE/);
    expect(() => limitsFrom({ MCP_HTTP_MAX_BODY: "-1" })).toThrow(/MCP_HTTP_MAX_BODY/);
  });
});

describe("hostAllowed", () => {
  const patterns = ["*.googleapis.com", "oauth2.googleapis.com", "api.oblio.eu"];
  it("matches exact hosts and subdomain wildcards, case- and trailing-dot-insensitively", () => {
    expect(hostAllowed("gmail.googleapis.com", patterns)).toBe(true);
    expect(hostAllowed("GMAIL.googleapis.com.", patterns)).toBe(true);
    expect(hostAllowed("api.oblio.eu", patterns)).toBe(true);
    expect(hostAllowed("googleapis.com", patterns)).toBe(false);
    expect(hostAllowed("evilgoogleapis.com", patterns)).toBe(false);
    expect(hostAllowed("api.oblio.eu.evil.com", patterns)).toBe(false);
    expect(hostAllowed("169.254.169.254", patterns)).toBe(false); // personal-data-check: allow (the cloud metadata address, which must be refused)
  });

  it("is off when MCP_EGRESS_ALLOW is unset", () => {
    expect(egressFrom({})).toBeUndefined();
    expect(egressFrom({ MCP_EGRESS_ALLOW: " a.com, *.b.com ," })).toEqual(["a.com", "*.b.com"]);
  });
});

describe("mergePolicies", () => {
  it("merges products, and refuses a tool classified twice", () => {
    expect(mergePolicies({ a: { access: "read" } }, { b: { access: "write" } })).toEqual({ a: { access: "read" }, b: { access: "write" } });
    expect(() => mergePolicies({ a: { access: "read" } }, { a: { access: "write" } })).toThrow(/classified twice: a/);
  });
});

import { describe, expect, it } from "vitest";

import { DEFAULT_LIMITS, egressFrom, hostAllowed, limitsFrom, take, type Bucket } from "../src/serve/limits.js";
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
    expect(hostAllowed("169.254.169.254", patterns)).toBe(false);
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

import { afterEach, describe, expect, it, vi } from "vitest";

import { classifyVendorError } from "../src/infra/porkbunPort/vendorErrors.js";
import { VENDOR_TOOLS, vendorConfig } from "../src/infra/vendor.js";
import { json, stubFetch } from "./harness.js";

/**
 * Every message here is thrown by the pinned vendor code itself, so a version
 * that rewords one fails this test rather than a session.
 */
const thrownBy = async (tool: string, args: Record<string, unknown>, keys = { apiKey: "pk1_fake", secretApiKey: "sk1_fake" }): Promise<unknown> => {
  const handler = VENDOR_TOOLS.find((t) => t.name === tool)?.handler;
  if (handler === undefined) throw new Error(`no vendor tool ${tool}`);
  return handler(vendorConfig(keys), args).then(
    () => {
      throw new Error(`${tool} did not throw`);
    },
    (thrown: unknown) => thrown,
  );
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the vendor's failures, sorted", () => {
  it("Porkbun's refusal with a code", async () => {
    stubFetch(() => json({ status: "ERROR", code: "INSUFFICIENT_FUNDS", message: "Short.", next_action: { hint: "top up" } }, 402));
    expect(classifyVendorError(await thrownBy("renew_domain", { domain: "example.com", cost_cents: 1108 }))).toEqual({
      kind: "api",
      code: "INSUFFICIENT_FUNDS",
      message: "Porkbun API error [INSUFFICIENT_FUNDS]: Short. — next: top up",
    });
  });

  it("Porkbun's refusal without one", async () => {
    stubFetch(() => json({}, 500));
    expect(classifyVendorError(await thrownBy("ping", {}))).toEqual({ kind: "api", message: "Porkbun API error: HTTP 500" });
  });

  it("an answer that is not JSON, and a docs page that is not there", async () => {
    stubFetch(() => new Response("<html>bad gateway</html>", { status: 502 }));
    expect(classifyVendorError(await thrownBy("ping", {}))).toMatchObject({ kind: "api", status: 502 });
    stubFetch(() => new Response("missing", { status: 404 }));
    expect(classifyVendorError(await thrownBy("list_doc_topics", {}))).toMatchObject({ kind: "api", status: 404 });
  });

  it("never carries the key pair, even when an error page echoes the request", async () => {
    // The keys ride in the body of a POST and in X-API-Key / X-Secret-API-Key on a GET.
    const sent = stubFetch(() => new Response(`<html>502 for ${JSON.stringify(sent.at(-1)?.body)}</html>`, { status: 502 }));
    const error = classifyVendorError(await thrownBy("ping", {}, { apiKey: "pk1_live_abc123", secretApiKey: "sk1_live_def456" }));
    expect(error).toMatchObject({ kind: "api", status: 502 });
    expect(JSON.stringify(error)).not.toMatch(/def456|abc123/);
    expect(error?.message).toContain("sk1_[redacted]");
  });

  it("no key pair", async () => {
    stubFetch(() => json({ status: "SUCCESS" }));
    expect(classifyVendorError(await thrownBy("ping", {}, { apiKey: "", secretApiKey: "" }))).toEqual({
      kind: "config",
      message: "no Porkbun API key pair is configured for this server",
    });
  });

  it("arguments the vendor refuses before sending anything", async () => {
    const sent = stubFetch(() => json({ status: "SUCCESS" }));
    expect(classifyVendorError(await thrownBy("register_domain", { domain: "example.com", cost_cents: 1108, cost: 1200 }))).toMatchObject({
      kind: "refused",
      message: expect.stringContaining("disagree"),
    });
    expect(classifyVendorError(await thrownBy("register_domain", { domain: "example.com" }))).toMatchObject({ kind: "refused" });
    expect(sent).toEqual([]);
  });

  it("fetch's own failures: unreachable, or a host this process may not reach", () => {
    expect(classifyVendorError(new TypeError("fetch failed", { cause: { code: "ENOTFOUND" } }))).toEqual({ kind: "network", message: "fetch failed" });
    expect(classifyVendorError(new TypeError("egress denied", { cause: { code: "EGRESS_DENIED" } }))).toEqual({ kind: "egress", message: "egress denied" });
  });

  it("leaves a bug to the kit's `unexpected`", () => {
    expect(classifyVendorError(new TypeError("Cannot read properties of undefined (reading 'map')"))).toBeUndefined();
    expect(classifyVendorError("a string")).toBeUndefined();
  });
});

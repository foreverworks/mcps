import { describe, expect, it } from "vitest";

import { apiError, authError, configError, fail } from "../../src/gmail/domain/errors.js";
import { handled } from "../../src/gmail/mcp/envelope.js";

const payload = (result: { content: [{ text: string }, ...unknown[]] }) => JSON.parse(result.content[0].text) as Record<string, any>;

describe("handled", () => {
  it("returns a successful result with no error key", async () => {
    expect(payload(await handled(async () => ({ threads: [] }))())).toEqual({ threads: [] });
  });

  it("tags an api failure with status and Google's reason", async () => {
    const out = payload(await handled(async () => fail(apiError(404, "nope", { reason: "notFound" })))());
    expect(out["error"]).toMatchObject({ kind: "api", status: 404, reason: "notFound" });
  });

  it("marks a revoked grant permanent and names the remedy", async () => {
    const out = payload(await handled(async () => fail(authError("invalid_grant", "revoked")))());
    expect(out["error"]).toMatchObject({ kind: "auth", permanent: true });
    expect(out["error"]["remedy"]).toContain("begin_consent (product gmail");
  });

  it("does not mark a Google 5xx permanent", async () => {
    const out = payload(await handled(async () => fail(authError("http_503", "backend")))());
    expect(out["error"]["permanent"]).toBe(false);
  });

  it("points a config fault at what the message names, and at consent", async () => {
    const out = payload(await handled(async () => fail(configError("no file")))());
    expect(out["error"]).toMatchObject({ kind: "config" });
    expect(out["error"]["remedy"]).toContain("the message names");
  });

  it("catches an unexpected throw instead of letting it break the protocol", async () => {
    const out = payload(await handled(async () => {
      throw new TypeError("boom");
    })());
    expect(out["error"]).toMatchObject({ kind: "unexpected" });
  });
});

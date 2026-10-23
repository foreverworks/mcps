import { describe, expect, it } from "vitest";

import { configError, fail, inputError } from "../src/domain/errors.js";
import { handled } from "../src/mcp/envelope.js";

const payload = (result: { content: [{ text: string }, ...unknown[]] }) => JSON.parse(result.content[0].text) as Record<string, any>;

describe("handled", () => {
  it("passes a result through as JSON", async () => {
    expect(payload(await handled(async () => ({ series: [] }))())).toEqual({ series: [] });
  });

  it("turns a known failure into an error KEY, not a string that reads like a result", async () => {
    const out = payload(await handled(async () => fail(inputError("series_name is required")))());
    expect(out["error"]).toMatchObject({ kind: "input", message: "series_name is required" });
    expect(out["error"].remedy).toBeTruthy();
  });

  it("carries a remedy an operator can act on", async () => {
    const out = payload(await handled(async () => fail(configError("app.json is missing")))());
    expect(out["error"].remedy).toContain("app.json");
  });

  it("never lets an unexpected throw escape as a protocol error", async () => {
    const out = payload(
      await handled(async () => {
        throw new TypeError("undefined is not a function");
      })(),
    );
    expect(out["error"]).toMatchObject({ kind: "unexpected" });
  });
});

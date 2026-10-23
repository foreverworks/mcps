import { describe, expect, it } from "vitest";

import { configError, fail, inputError } from "../src/domain/errors.js";
import { handled } from "../src/mcp/envelope.js";

const payload = (result: { content: [{ text: string }, ...unknown[]] }) => JSON.parse(result.content[0].text) as Record<string, any>;

describe("handled", () => {
  it("passes a result through as JSON", async () => {
    expect(payload(await handled(async () => ({ mesaje: [] }))())).toEqual({ mesaje: [] });
  });

  it("carries ANAF's XML inside the result rather than as the result", async () => {
    // The envelope used to pass a bare string through verbatim, for tools that
    // handed back ANAF's XML. Nothing does that now: upload_invoice and
    // upload_status are read into a verdict and keep the document under `raw`,
    // so every tool returns an object and the special case was dead.
    const out = payload(await handled(async () => ({ accepted: true, raw: '<header index_incarcare="4321"/>' }))());
    expect(out["raw"]).toBe('<header index_incarcare="4321"/>');
  });

  it("turns a known failure into an error KEY, not a string that reads like a result", async () => {
    const out = payload(await handled(async () => fail(inputError("zile must be 1 to 60")))());
    expect(out["error"]).toMatchObject({ kind: "input", message: "zile must be 1 to 60" });
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

import { describe, expect, it } from "vitest";

import { definedEnv, smokeTarget, toolJson } from "../src/smoke.js";

describe("smokeTarget", () => {
  it("spawns the built server unless a URL is set", () => {
    expect(smokeTarget({})).toEqual({ kind: "stdio" });
    expect(smokeTarget({ MCP_URL: "" })).toEqual({ kind: "stdio" });
  });

  it("talks to the running service with a URL and its token file", () => {
    expect(smokeTarget({ MCP_URL: "http://127.0.0.1:3000/mcp", MCP_TOKEN_FILE: "/t" })).toEqual({
      kind: "http",
      url: new URL("http://127.0.0.1:3000/mcp"),
      tokenFile: "/t",
    });
  });

  it("refuses a URL without a token file, and a URL that is not one", () => {
    expect(() => smokeTarget({ MCP_URL: "http://127.0.0.1:3000/mcp" })).toThrow(/MCP_TOKEN_FILE/);
    expect(() => smokeTarget({ MCP_URL: "3000", MCP_TOKEN_FILE: "/t" })).toThrow();
  });
});

describe("definedEnv", () => {
  it("drops unset entries", () => {
    expect(definedEnv({ A: "1", B: undefined, C: "" })).toEqual({ A: "1", C: "" });
  });
});

describe("toolJson", () => {
  it("reads the one text block every tool answers with", () => {
    expect(toolJson({ content: [{ type: "text", text: '{"ok":true}' }] })).toEqual({ ok: true });
    expect(toolJson({ content: [] })).toEqual({});
  });
});

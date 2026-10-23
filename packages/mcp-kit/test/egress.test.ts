import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { getGlobalDispatcher, setGlobalDispatcher } from "undici";
import { afterEach, describe, expect, it, vi } from "vitest";

import { installKeepAlive } from "../src/serve/egress.js";

/**
 * installKeepAlive hands Node's built-in fetch an Agent from the undici package, a
 * different copy of undici from the one inside Node: the two meet only through the
 * global dispatcher. Every upstream call of every server crosses that bridge, and a
 * major of the package can rebuild it (undici 8 did), so a real fetch goes through it here.
 */
describe("installKeepAlive", () => {
  const before = getGlobalDispatcher();
  afterEach(() => {
    setGlobalDispatcher(before);
    vi.restoreAllMocks();
  });

  it("puts its Agent under the built-in fetch", async () => {
    const server = createServer((_request, response) => response.end("ok"));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    installKeepAlive({ MCP_KEEPALIVE_MS: "1000" });
    const agent = getGlobalDispatcher();
    const dispatch = vi.spyOn(agent, "dispatch");
    try {
      expect(agent).not.toBe(before);
      const response = await fetch(`http://127.0.0.1:${port}/`);
      expect(await response.text()).toBe("ok");
      expect(dispatch).toHaveBeenCalled();
    } finally {
      setGlobalDispatcher(before);
      await agent.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("leaves the dispatcher alone when MCP_KEEPALIVE_MS is unset or not a positive number", () => {
    for (const env of [{}, { MCP_KEEPALIVE_MS: "" }, { MCP_KEEPALIVE_MS: "0" }, { MCP_KEEPALIVE_MS: "soon" }]) {
      installKeepAlive(env);
      expect(getGlobalDispatcher()).toBe(before);
    }
  });
});

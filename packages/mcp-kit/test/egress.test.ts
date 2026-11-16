import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { getGlobalDispatcher, setGlobalDispatcher } from "undici";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { liveFetch } from "../src/liveFetch.js";
import { guardEgress, installEgress, installKeepAlive } from "../src/serve/egress.js";

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

/**
 * The guard replaces globalThis.fetch, so each test puts a recording stub there first, which
 * the guard then wraps, and puts back what it found. No request leaves the process.
 */
describe("the egress guard", () => {
  const before = globalThis.fetch;
  const asked: string[] = [];
  const stub = (async (input: Parameters<typeof fetch>[0]) => {
    asked.push(input instanceof Request ? input.url : input.toString());
    return new Response("upstream");
  }) as typeof fetch;

  beforeEach(() => {
    asked.length = 0;
    globalThis.fetch = stub;
  });
  afterEach(() => {
    globalThis.fetch = before;
  });

  const refusal = async (request: Promise<Response>): Promise<unknown> => request.then(() => undefined, (thrown: unknown) => thrown);

  it("lets a listed host through and refuses any other before it is asked", async () => {
    installEgress(["api.example.com", "*.cdn.example.net"]);
    expect(await (await fetch("https://api.example.com/v1/orders")).text()).toBe("upstream");
    expect(await (await fetch(new Request("https://img.cdn.example.net/a.png"))).text()).toBe("upstream");
    const refused = await refusal(fetch("https://elsewhere.example.org/"));
    expect(refused).toBeInstanceOf(TypeError);
    expect(refused).toMatchObject({ cause: { code: "EGRESS_DENIED" } });
    expect((refused as Error).message).toContain("elsewhere.example.org");
    expect((refused as Error).message).toContain("MCP_EGRESS_ALLOW");
    expect(asked).toEqual(["https://api.example.com/v1/orders", "https://img.cdn.example.net/a.png"]);
  });

  it("installing again puts the new list in force instead of stacking another guard on the first", async () => {
    installEgress(["first.example.com"]);
    installEgress(["second.example.com"]);
    expect(await refusal(fetch("https://first.example.com/"))).toBeInstanceOf(TypeError);
    await fetch("https://second.example.com/");
    expect(asked).toEqual(["https://second.example.com/"]);
  });

  it("is applied from MCP_EGRESS_ALLOW, and a server without the variable is left alone", async () => {
    guardEgress({});
    guardEgress({ MCP_EGRESS_ALLOW: "  " });
    expect(globalThis.fetch).toBe(stub);
    guardEgress({ MCP_EGRESS_ALLOW: "api.example.com" });
    expect(globalThis.fetch).not.toBe(stub);
    expect(await refusal(fetch("https://other.example.com/"))).toBeInstanceOf(TypeError);
    expect(asked).toEqual([]);
  });

  it("binds a fetch that was held before the list went in force only if it is liveFetch", async () => {
    const heldBeforeServe = globalThis.fetch;
    const live = liveFetch;
    installEgress(["api.example.com"]);
    // The hazard liveFetch exists for: a reference taken early is the unguarded function.
    await heldBeforeServe("https://anywhere.example.org/");
    expect(asked).toEqual(["https://anywhere.example.org/"]);
    // liveFetch reads the global at every call, so it is the guard whenever the guard was installed.
    expect(await refusal(live("https://anywhere.example.org/"))).toBeInstanceOf(TypeError);
    await live("https://api.example.com/");
    expect(asked).toEqual(["https://anywhere.example.org/", "https://api.example.com/"]);
  });
});

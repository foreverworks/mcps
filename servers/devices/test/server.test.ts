/**
 * The server as a client sees it, through the kit's guard, against the in-memory world of fakes.ts.
 */
import { checkPolicy, connectInMemory, guard, McpServer, requestContext } from "@foreverworks/mcp-kit";
import { describe, expect, it } from "vitest";

import { makeBroker } from "../src/app/broker.js";
import { emptyCatalog, type Catalog } from "../src/domain/catalog.js";
import { instructionsFor } from "../src/mcp/describe.js";
import { POLICY } from "../src/mcp/policy.js";
import { registerAll } from "../src/mcp/register.js";
import { CATALOG, depsFor, GEAR, makeWorld, POOL, POOL_SLOTS, VARIANTS } from "./fakes.js";

const connected = async (pool = false, catalog: Catalog = pool ? POOL : CATALOG, catalogProblem?: string) => {
  const world = pool ? makeWorld(POOL_SLOTS) : makeWorld();
  const broker = makeBroker({ ...depsFor(world, catalog), ...(catalogProblem === undefined ? {} : { catalogProblem }) });
  const server = new McpServer({ name: "devices", version: "test" });
  registerAll(guard(server, { service: "devices", policy: POLICY, log: () => undefined }), broker, catalog);
  const client = await connectInMemory(server);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<any> => {
    const result = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
    return { isError: result.isError === true, ...JSON.parse(result.content[0]?.text ?? "{}") };
  };
  /** A call made with a token whose client label is `client`, as mcp-kit's HTTP layer sets it for the guard. */
  const callAs = (client: string, name: string, args: Record<string, unknown> = {}) => requestContext.run({ client }, () => call(name, args));
  return { call, callAs, client, world };
};

describe("devices over MCP", () => {
  it("classifies every tool it registers", () => {
    expect(() => checkPolicy("devices", (s) => registerAll(s, makeBroker(depsFor(makeWorld())), CATALOG), POLICY)).not.toThrow();
  });

  it("lists the same tools, arguments and descriptions as the snapshot", async () => {
    const { client } = await connected();
    const { tools } = await client.listTools();
    await expect(`${JSON.stringify(tools, null, 2)}\n`).toMatchFileSnapshot("./tools.snapshot.json");
  });

  it("answers health ok whatever the hosts' state, as a monitor calls it", async () => {
    const { call, world } = await connected();
    world.mac = "down";
    expect(await call("health")).toMatchObject({ isError: false, ok: true, broker: "broker-1", devices: 7, leases: 0 });
  });

  it("names the deployment's wrappers, session hint and profiles from its catalog, and none when it has none", async () => {
    const { client } = await connected();
    const text = JSON.stringify((await client.listTools()).tools);
    expect(text).toMatch(/the output of `show-session-id`/);
    expect(text).toMatch(/sim-run, apk-run and flow-run acquire for you/);
    expect(text).toMatch(/android-phone, ios-phone/);
    expect(instructionsFor(CATALOG)).toMatch(/sim-run, apk-run and flow-run use your lease/);

    const bare = await connected(false, emptyCatalog("broker-2"));
    const plain = JSON.stringify((await bare.client.listTools()).tools) + instructionsFor(emptyCatalog("broker-2"));
    expect(plain).not.toMatch(/sim-run|apk-run|wrapper|show-session-id/);
    expect(plain).toMatch(/CLAUDE_CODE_SESSION_ID/);
    expect(await bare.call("acquire", { want: "ios", session: "s-1", purpose: "p" })).toMatchObject({ isError: false, status: "unavailable" });
    expect(await bare.call("health")).toMatchObject({ isError: false, ok: true });
  });

  it("says what no profile means only where a slot serves several, and lists its variants' profiles", async () => {
    const profileOf = async (catalog: Catalog): Promise<string> => {
      const { client } = await connected(false, catalog);
      const acquire = (await client.listTools()).tools.find((t) => t.name === "acquire");
      return (acquire?.inputSchema.properties?.["profile"] as { description: string }).description;
    };
    expect(await profileOf(CATALOG)).toBe("A profile from status (android-phone, ios-phone); default: any device of the platform.");
    expect(await profileOf(VARIANTS)).toBe(
      "A profile from status (android-next, android-phone, ios-phone); default: any device of the platform, on its own profile (an emulator slot that serves several starts the one you ask for).",
    );
    // A platform's default profile: its other profiles (a tablet, a phone with a watch) only by name.
    expect(await profileOf(GEAR())).toBe(
      "A profile from status (android-phone, ios-phone, ios-tablet, ios-watch); default: ios-phone for ios (its other profiles only when named), else any device of the platform.",
    );
  });

  it("answers a second ask for another profile than the lease runs with an input failure", async () => {
    const { call } = await connected(false, VARIANTS);
    await call("acquire", { want: "android", session: "s-1", purpose: "api 34" });
    const r = await call("acquire", { want: "android", session: "s-1", purpose: "api 35", profile: "android-next" });
    expect(r).toMatchObject({ isError: true, error: { kind: "input", message: expect.stringMatching(/holds emulator-5554 on android-phone .*release it, then ask for android-next/) } });
  });

  it("answers every tool with a config failure when its catalog could not be read, and still lists them", async () => {
    const { call, client } = await connected(false, emptyCatalog("broker-1"), "the catalog /etc/devices.json cannot be read: ENOENT");
    expect((await client.listTools()).tools).toHaveLength(10);
    for (const [name, args] of [["health", {}], ["status", {}], ["acquire", { want: "ios", session: "s", purpose: "p" }]] as const) {
      const r = await call(name, args);
      expect(r).toMatchObject({ isError: true, error: { kind: "config", message: expect.stringMatching(/cannot be read/) } });
      expect(r.error.remedy).toMatch(/DEVICES_CATALOG_FILE/);
    }
  });

  it("refuses a lease or ticket id that is not one the broker makes, before looking it up", async () => {
    const { client } = await connected();
    for (const [name, args] of [["release", { session: "s-1", lease: "ls-1; rm" }], ["wait", { session: "s-1", ticket: "ls-1" }]] as const) {
      const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
      expect(r.isError).toBe(true);
      expect(r.content[0]?.text).toMatch(/ls-<number>|tk-<number>/);
    }
  });

  it("acquires, shows the lease in status, and releases", async () => {
    const { call } = await connected();
    const got = await call("acquire", { want: "ios", session: "s-1", purpose: "look at the sheet" });
    expect(got).toMatchObject({ isError: false, status: "granted", resource: "dev-iphone", address: { env: { IOS_SIM_DEVICE: "11111111-2222-4333-8444-555555555555" } }, next: "sim-run uses it and renews it on every call; release when done" });
    const status = await call("status", { session: "s-1" });
    expect(status.mine).toHaveLength(1);
    expect(status.devices.find((d: { id: string }) => d.id === "dev-iphone")).toMatchObject({ status: "leased", purpose: "look at the sheet" });
    expect(await call("release", { session: "s-1", want: "ios" })).toMatchObject({ status: "released", then: "shut down" });
  });

  it("answers a release of nothing with an input failure and its remedy", async () => {
    const { call } = await connected();
    const r = await call("release", { session: "s-9", want: "android" });
    expect(r).toMatchObject({ isError: true, error: { kind: "input" } });
    expect(r.error.remedy).toMatch(/status/);
  });

  it("takes the tenant from the token's client label, never from an argument: two tokens, two tenants", async () => {
    const { callAs, client } = await connected(true);
    const ours = await callAs("agent", "acquire", { want: "android", session: "same-session", purpose: "our work" });
    const guest = await callAs("guest-acme", "acquire", { want: "android", session: "same-session", purpose: "guest work" });
    expect([ours.resource, guest.resource]).toEqual(["pool1", "acmephone"]);
    const seen = await callAs("guest-acme", "status", { session: "same-session" });
    expect(seen.devices.map((d: { id: string }) => d.id)).toEqual(["acmephone"]);
    expect(JSON.stringify(seen)).not.toMatch(/pool1|16000|our work/);
    // The guest names the default tenant's lease and device: answered as things that do not exist.
    expect(await callAs("guest-acme", "release", { session: "same-session", lease: ours.lease })).toMatchObject({ isError: true, error: { kind: "input" } });
    expect(await callAs("guest-acme", "report", { session: "same-session", device: "pool1", note: "x" })).toMatchObject({ isError: true });
    // The default tenant's lease is untouched, and it cannot release the guest's.
    expect((await callAs("agent", "status", { session: "same-session" })).mine.map((l: { resource: string }) => l.resource)).toEqual(["pool1"]);
    expect(await callAs("agent", "release", { session: "same-session", lease: guest.lease })).toMatchObject({ isError: true });
    // There is no argument a caller could use to claim another tenant: the guard refuses an unknown one.
    const claimed = (await requestContext.run({ client: "guest-acme" }, () =>
      client.callTool({ name: "acquire", arguments: { want: "android", session: "s", purpose: "p", tenant: "default" } }),
    )) as { isError?: boolean; content: { text: string }[] };
    expect(claimed.isError).toBe(true);
    expect(claimed.content[0]?.text).toMatch(/tenant/);
  });
});

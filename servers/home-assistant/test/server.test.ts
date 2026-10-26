/**
 * The server as a client sees it, through the kit's guard, against an
 * invented Home Assistant (test/fakeHomeAssistant.ts) behind a fake fetch and
 * a fake WebSocket. Nothing here touches the network.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ACCESS_META, checkPolicy, confirmingClient, connectInMemory, guard, type GuardSettings, McpServer, REQUIRES_USER_META } from "@foreverworks/mcp-kit";
import { describe, expect, it } from "vitest";

import { buildDeps } from "../src/composition.js";
import { actionCallOf, actionLine, confirmDomainsFrom, confirmReason, DEFAULT_CONFIRM_DOMAINS } from "../src/domain/actions.js";
import { asAppError, remedyFor } from "../src/domain/errors.js";
import { apiUrl, baseUrlOf, egressHostOf, socketUrlOf } from "../src/infra/connection.js";
import { POLICY } from "../src/mcp/policy.js";
import { registerAll } from "../src/mcp/register.js";
import { type FakeOptions, fakeHomeAssistant, TOKEN, VERSION } from "./fakeHomeAssistant.js";

const NOW = Date.parse("2026-03-01T10:00:00Z");
const URL_ = "http://homeassistant.local:8123";

type Setup = {
  readonly fake?: FakeOptions;
  /** The token in the file; the fake accepts TOKEN. */
  readonly token?: string;
  /** Replaces the default environment; TOKEN_FILE in a value is the token file's path. */
  readonly env?: Record<string, string>;
  readonly extraEnv?: Record<string, string>;
  readonly settings?: GuardSettings;
  readonly answer?: (line: string) => boolean;
};

const setup = async (options: Setup = {}) => {
  const dir = mkdtempSync(join(tmpdir(), "home-assistant-test-"));
  const tokenFile = join(dir, "token");
  writeFileSync(tokenFile, `${options.token ?? TOKEN}\n`);
  const fake = fakeHomeAssistant(options.fake);
  const env = options.env
    ? Object.fromEntries(Object.entries(options.env).map(([k, v]) => [k, v === "TOKEN_FILE" ? tokenFile : v]))
    : { HOME_ASSISTANT_URL: URL_, HOME_ASSISTANT_TOKEN_FILE: tokenFile, ...options.extraEnv };
  const deps = buildDeps({ env, fetch: fake.fetch, openSocket: fake.openSocket, sleep: async () => undefined, random: () => 0, now: () => NOW });
  const server = new McpServer({ name: "home-assistant", version: "test" });
  const settings = options.settings ?? { maxAccess: "money", confirm: "client" };
  registerAll(guard(server, { service: "home-assistant", policy: POLICY, settings, log: () => undefined, vocabulary: { asAppError, remedyFor } }), deps);
  const confirming = confirmingClient("test", options.answer ?? (() => true));
  const client = await connectInMemory(server, confirming.client);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<any> => {
    const result = (await client.callTool({ name, arguments: args })) as { content: { text: string }[] };
    const text = result.content[0]?.text ?? "{}";
    try {
      return JSON.parse(text);
    } catch {
      // The SDK's own refusal of arguments that do not fit the schema is plain text.
      return { error: { kind: "schema", message: text } };
    }
  };
  const posts = () => fake.requests.filter((r) => r.method === "POST" && r.url.pathname.startsWith("/api/services/"));
  return { call, client, fake, tokenFile, asked: confirming.asked, posts };
};

describe("the tool surface", () => {
  it("lists the same tools, arguments and descriptions as the snapshot, every one classified", async () => {
    const { client } = await setup();
    const { tools } = await client.listTools();
    await expect(`${JSON.stringify(tools, null, 2)}\n`).toMatchFileSnapshot("./tools.snapshot.json");
    expect(() => checkPolicy("home-assistant", (server) => registerAll(server, buildDeps({ env: {} })), POLICY)).not.toThrow();
  });

  it("reads everything, writes only through call_action, and asks the user only for call_action_confirmed", async () => {
    const { client } = await setup();
    const { tools } = await client.listTools();
    expect(tools.filter((t) => t._meta?.[ACCESS_META] === "write").map((t) => t.name).sort()).toEqual(["call_action", "call_action_confirmed"]);
    expect(tools.filter((t) => t._meta?.[ACCESS_META] === "money")).toEqual([]);
    expect(tools.filter((t) => t._meta?.[REQUIRES_USER_META] === true).map((t) => t.name)).toEqual(["call_action_confirmed"]);
  });

  it("starts with an empty environment, names the missing address, and sends nothing", async () => {
    const { call, fake } = await setup({ env: {} });
    for (const tool of ["list_entities", "list_areas", "list_actions"]) {
      const out = await call(tool);
      expect(out.error).toMatchObject({ kind: "config", variable: "HOME_ASSISTANT_URL" });
      expect(out.error.remedy).toContain("HOME_ASSISTANT_URL");
    }
    expect((await call("health")).ok).toBe(false);
    expect(fake.requests).toEqual([]);
    expect(fake.sockets).toEqual([]);
  });

  it("names the missing token file, and sends nothing", async () => {
    const { call, fake } = await setup({ env: { HOME_ASSISTANT_URL: URL_ } });
    expect((await call("get_states", { entity_ids: ["light.kitchen"] })).error).toMatchObject({ kind: "config", variable: "HOME_ASSISTANT_TOKEN_FILE" });
    expect(fake.requests).toEqual([]);
  });
});

describe("the address and the egress it needs", () => {
  it("takes the address Home Assistant opens at, under a path prefix too, and nothing else", () => {
    expect(baseUrlOf("http://homeassistant.local:8123").toString()).toBe("http://homeassistant.local:8123/");
    expect(baseUrlOf(" https://ha.example.com/home/ ").toString()).toBe("https://ha.example.com/home/");
    expect(apiUrl(baseUrlOf("https://ha.example.com/home"), "api/states").toString()).toBe("https://ha.example.com/home/api/states");
    for (const bad of ["", "homeassistant.local:8123", "ftp://ha.example.com", "http://ha.example.com:8123/api", "http://user:pw@ha.example.com", "http://ha.example.com/?x=1"]) {
      expect(() => baseUrlOf(bad), bad).toThrow();
    }
  });

  it("derives the WebSocket address and the egress host from it", () => {
    expect(socketUrlOf(baseUrlOf("http://homeassistant.local:8123")).toString()).toBe("ws://homeassistant.local:8123/api/websocket");
    expect(socketUrlOf(baseUrlOf("https://ha.example.com/home")).toString()).toBe("wss://ha.example.com/home/api/websocket");
    expect(egressHostOf(baseUrlOf("http://homeassistant.local:8123"))).toBe("homeassistant.local");
    expect(egressHostOf(baseUrlOf("http://[2001:db8::10]:8123"))).toBe("2001:db8::10");
  });

  it("refuses a host MCP_EGRESS_ALLOW does not allow, before any request or socket, and works when it does", async () => {
    const refused = await setup({ extraEnv: { MCP_EGRESS_ALLOW: "api.example.com" } });
    for (const tool of ["list_actions", "list_areas"]) {
      const out = await refused.call(tool);
      expect(out.error).toMatchObject({ kind: "config", variable: "MCP_EGRESS_ALLOW" });
      expect(out.error.message).toContain("homeassistant.local");
    }
    expect(refused.fake.requests).toEqual([]);
    expect(refused.fake.sockets).toEqual([]);

    const allowed = await setup({ extraEnv: { MCP_EGRESS_ALLOW: "homeassistant.local" } });
    expect((await allowed.call("list_areas")).areas).toHaveLength(3);
    expect(allowed.fake.sockets.map((s) => s.url)).toEqual(["ws://homeassistant.local:8123/api/websocket"]);
  });
});

describe("health", () => {
  it("says the version, the state, the time zone, the WebSocket and the entities per domain", async () => {
    const { call, fake } = await setup();
    expect(await call("health")).toEqual({
      ok: true,
      url: URL_,
      version: VERSION,
      state: "RUNNING",
      time_zone: "Europe/Bucharest",
      location_name: "Test flat",
      websocket: "ok",
      entities: 7,
      entities_per_domain: { camera: 1, climate: 1, cover: 1, light: 1, lock: 1, sensor: 1, sun: 1 },
    });
    expect(fake.requests.every((r) => r.headers["Authorization"] === `Bearer ${TOKEN}`)).toBe(true);
    expect(fake.sockets[0]?.sent[0]).toEqual({ type: "auth", access_token: TOKEN });
  });

  it("is not ok while Home Assistant starts", async () => {
    const out = await (await setup({ fake: { haState: "STARTING" } })).call("health");
    expect(out.ok).toBe(false);
    expect(out.problems).toEqual(["Home Assistant is STARTING, not RUNNING"]);
  });
});

describe("entities and states", () => {
  it("lists compact rows with each entity's area, its own or its device's", async () => {
    const out = await (await setup()).call("list_entities");
    expect(out.total).toBe(7);
    expect(out.entities).toContainEqual({ entity_id: "light.kitchen", name: "Kitchen light", state: "on", area: "Kitchen" });
    expect(out.entities).toContainEqual({ entity_id: "sensor.living_room_temperature", name: "Living room temperature", state: "20.5", unit: "°C", area: "Living room" });
    expect(out.entities).toContainEqual({ entity_id: "camera.porch", name: "Porch", state: "idle", area: "Hallway" });
    expect(out.entities).toContainEqual({ entity_id: "cover.garage_door", name: "Garage door", state: "closed" });
  });

  it("filters by domain, by area name or id, and by words, and says when it cut the list", async () => {
    const { call } = await setup();
    expect((await call("list_entities", { domain: "sensor" })).entities.map((e: { entity_id: string }) => e.entity_id)).toEqual(["sensor.living_room_temperature"]);
    const ids = async (args: Record<string, unknown>) => (await call("list_entities", args)).entities.map((e: { entity_id: string }) => e.entity_id);
    expect(await ids({ area: "living room" })).toEqual(["climate.living_room", "sensor.living_room_temperature"]);
    expect(await ids({ area: "hallway" })).toEqual(["camera.porch", "lock.front_door"]);
    expect(await ids({ search: "garage DOOR" })).toEqual(["cover.garage_door"]);
    const cut = await call("list_entities", { limit: 2 });
    expect(cut).toMatchObject({ total: 7, returned: 2, truncated: true });
    expect(cut.note).toContain("5 more");
    const unknown = await call("list_entities", { area: "kitchn" });
    expect(unknown.error).toMatchObject({ kind: "not_found", what: "area", name: "kitchn" });
    expect(unknown.error.suggestions).toContain("Kitchen");
  });

  it("reads states with their attributes, and never hands a model a camera's tokens", async () => {
    const out = await (await setup()).call("get_states", { entity_ids: ["camera.porch", "light.nowhere"] });
    expect(out.not_found).toEqual(["light.nowhere"]);
    const [porch] = out.states;
    expect(porch.attributes.access_token).toBeUndefined();
    expect(porch.attributes.entity_picture).toBe("/api/camera_proxy/camera.porch?token=[redacted]&time=1");
    expect(JSON.stringify(out)).not.toContain("porch-camera-secret");
    expect(porch).toMatchObject({ entity_id: "camera.porch", state: "idle", last_changed: "2026-03-01T08:00:00+00:00" });
  });

  it("fails an entity it does not know, suggesting the near ones", async () => {
    const out = await (await setup()).call("get_states", { entity_ids: ["light.kitchn"] });
    expect(out.error).toMatchObject({ kind: "not_found", what: "entity", suggestions: ["light.kitchen"] });
  });
});

describe("areas", () => {
  it("joins the registries: floors, devices by their user's name, entities through their device, disabled ones left out", async () => {
    const out = await (await setup()).call("list_areas");
    expect(out.areas).toEqual([
      {
        area_id: "hallway",
        name: "Hallway",
        devices: [{ device_id: "1a1b2c3d4e5f60718293a4b5c6d7e8f9", name: "Front door lock" }],
        entity_count: 2,
        entities: ["camera.porch", "lock.front_door"],
      },
      { area_id: "kitchen", name: "Kitchen", floor: "Ground floor", devices: [{ device_id: "0a1b2c3d4e5f60718293a4b5c6d7e8f9", name: "Ceiling light" }], entity_count: 1, entities: ["light.kitchen"] },
      {
        area_id: "living_room",
        name: "Living room",
        floor: "Ground floor",
        devices: [{ device_id: "2a1b2c3d4e5f60718293a4b5c6d7e8f9", name: "Thermostat" }],
        entity_count: 2,
        entities: ["climate.living_room", "sensor.living_room_temperature"],
      },
    ]);
    expect(out.unassigned).toEqual({ devices: 0, entities: 1 });
  });

  it("works without floors (before 2024.4), and says when the token's user is not an administrator", async () => {
    const old = await (await setup({ fake: { socketReplies: { "config/floor_registry/list": { error: { code: "unknown_command", message: "Unknown command." } } } } })).call("list_areas", { area: "Kitchen", entities: false });
    expect(old.areas).toEqual([{ area_id: "kitchen", name: "Kitchen", devices: [{ device_id: "0a1b2c3d4e5f60718293a4b5c6d7e8f9", name: "Ceiling light" }], entity_count: 1 }]);
    const user = await (await setup({ fake: { socketReplies: { "config/entity_registry/list": { error: { code: "unauthorized", message: "Unauthorized" } } } } })).call("list_areas");
    expect(user.error.kind).toBe("permission");
    expect(user.error.remedy).toContain("administrator");
  });

  it("says the WebSocket API cannot be reached", async () => {
    const out = await (await setup({ fake: { socketDown: true } })).call("list_areas");
    expect(out.error.kind).toBe("unreachable");
    expect(out.error.message).toContain("homeassistant.local");
  });
});

describe("history and logbook", () => {
  it("asks the recorder for the window and only states, and keeps the newest changes", async () => {
    const { call, fake } = await setup();
    const out = await call("history", { entity_ids: ["sensor.living_room_temperature", "sensor.gone"], limit: 2 });
    const [req] = fake.requests;
    expect(req?.url.pathname).toBe(`/api/history/period/${encodeURIComponent("2026-02-28T10:00:00.000Z")}`);
    expect(req?.url.searchParams.get("filter_entity_id")).toBe("sensor.living_room_temperature,sensor.gone");
    expect(req?.url.searchParams.get("end_time")).toBe("2026-03-01T10:00:00.000Z");
    expect(req?.url.searchParams.has("minimal_response")).toBe(true);
    expect(req?.url.searchParams.has("no_attributes")).toBe(true);
    expect(out.entities[0]).toEqual({
      entity_id: "sensor.living_room_temperature",
      count: 3,
      earlier_omitted: 1,
      changes: [
        { state: "19.0", at: "2026-03-01T03:00:00+00:00" },
        { state: "20.5", at: "2026-03-01T07:00:00+00:00" },
      ],
    });
    expect(out.entities[1]).toMatchObject({ entity_id: "sensor.gone", count: 0 });
  });

  it("asks for attributes only when told, and refuses a window it cannot read", async () => {
    const { call, fake } = await setup();
    await call("history", { entity_ids: ["light.kitchen"], start: "2026-03-01T08:00:00+02:00", end: "2026-03-01T09:00:00Z", attributes: true });
    expect(fake.requests[0]?.url.pathname).toBe(`/api/history/period/${encodeURIComponent("2026-03-01T06:00:00.000Z")}`);
    expect(fake.requests[0]?.url.searchParams.has("minimal_response")).toBe(false);
    for (const window of [
      { start: "2026-03-01T09:00:00Z", end: "2026-03-01T08:00:00Z" },
      { start: "2026-01-01T00:00:00Z" },
      { start: "2026-03-01T08:00:00Z", hours: 2 },
      { start: "2026-03-02T08:00:00Z", end: "2026-03-03T08:00:00Z" },
    ]) {
      expect((await call("history", { entity_ids: ["light.kitchen"], ...window })).error.kind).toBe("input");
    }
    expect((await call("history", { entity_ids: ["light.kitchen"], start: "yesterday" })).error.kind).toBe("schema");
    expect(fake.requests).toHaveLength(1);
  });

  it("reads the logbook with what caused each entry", async () => {
    const { call, fake } = await setup();
    const out = await call("logbook", { entity_id: "light.kitchen", hours: 6 });
    expect(fake.requests[0]?.url.searchParams.get("entity")).toBe("light.kitchen");
    expect(out.start).toBe("2026-03-01T04:00:00.000Z");
    expect(out.entries).toEqual([
      { when: "2026-03-01T06:30:00+00:00", entity_id: "light.kitchen", name: "Kitchen light", state: "on", message: "turned on", by: { user_id: "user-1", action: "light.turn_on" } },
      { when: new Date(1772348400 * 1000).toISOString(), entity_id: "lock.front_door", name: "Front door", state: "locked", message: "was locked", by: { name: "Lock at night", event: "automation_triggered" } },
    ]);
  });

  it("says when the recorder's integration is not loaded", async () => {
    const out = await (await setup({ fake: { routes: { [`GET /api/history/period/${encodeURIComponent("2026-02-28T10:00:00.000Z")}`]: () => ({ status: 404, text: "404: Not Found" }) } } })).call("history", { entity_ids: ["light.kitchen"] });
    expect(out.error).toMatchObject({ kind: "not_found", what: "endpoint" });
    expect(out.error.remedy).toContain("integration");
  });
});

describe("actions and templates", () => {
  it("lists domains with their action names, marking the ones the user approves", async () => {
    const out = await (await setup()).call("list_actions");
    expect(out.domains).toContainEqual({ domain: "lock", confirm: true, actions: ["lock", "unlock"] });
    expect(out.domains).toContainEqual({ domain: "light", actions: ["turn_off", "turn_on"] });
  });

  it("lists one domain's actions with their fields, sections flattened", async () => {
    const { call } = await setup();
    const light = await call("list_actions", { domain: "light" });
    expect(light.actions[1]).toEqual({
      action: "light.turn_on",
      name: "Turn on",
      description: "Turns on one or more lights.",
      targets: true,
      fields: [
        { field: "brightness_pct", name: "Brightness", description: "Percent of full brightness.", type: "number", example: 40 },
        { field: "flash", name: "Flash", type: "select", options: ["short", "long"] },
      ],
    });
    expect((await call("list_actions", { domain: "weather" })).actions[0].response).toBe("only");
    const unknown = await call("list_actions", { domain: "lights" });
    expect(unknown.error).toMatchObject({ kind: "not_found", what: "domain", suggestions: ["light"] });
  });

  it("renders a template, and passes on Home Assistant's reason when it cannot", async () => {
    const { call, fake } = await setup();
    expect(await call("render_template", { template: "It is {{ states('sensor.living_room_temperature') }} degrees" })).toEqual({ result: "It is 20.5 degrees" });
    expect(fake.requests[0]?.body).toEqual({ template: "It is {{ states('sensor.living_room_temperature') }} degrees" });
    const bad = await call("render_template", { template: "{% bad" });
    expect(bad.error).toMatchObject({ kind: "rejected", status: 400 });
    expect(bad.error.message).toContain("TemplateSyntaxError");
  });

  it("runs an action with its target beside the data, and answers with what changed", async () => {
    const { call, fake, posts } = await setup();
    const out = await call("call_action", { domain: "light", service: "turn_off", target: { entity_id: "light.kitchen" }, data: { transition: 2 } });
    expect(out).toEqual({ action: "light.turn_off", changed: [{ entity_id: "light.kitchen", state: "off", last_changed: "2026-03-01T09:00:00+00:00" }] });
    expect(posts()).toHaveLength(1);
    expect(posts()[0]?.url.pathname).toBe("/api/services/light/turn_off");
    expect(posts()[0]?.body).toEqual({ transition: 2, entity_id: ["light.kitchen"] });
    expect(fake.requests.filter((r) => r.url.searchParams.has("return_response"))).toEqual([]);
  });

  it("asks for an action's answer when told", async () => {
    const { call, posts } = await setup();
    const out = await call("call_action", { domain: "weather", service: "get_forecasts", target: { entity_id: "weather.home" }, data: { type: "daily" }, return_response: true });
    expect(posts()[0]?.url.searchParams.has("return_response")).toBe(true);
    expect(out.response).toEqual({ "weather.home": { forecast: [{ temperature: 12 }] } });
  });

  it("refuses a target hidden in data, and sends nothing", async () => {
    const { call, fake } = await setup();
    const out = await call("call_action", { domain: "light", service: "turn_on", data: { entity_id: "lock.front_door" } });
    expect(out.error.kind).toBe("input");
    expect(fake.requests).toEqual([]);
  });

  it("names the action Home Assistant does not have, from its bare 400", async () => {
    const { call, posts, fake } = await setup();
    const out = await call("call_action", { domain: "light", service: "turn_of", target: { entity_id: "light.kitchen" } });
    expect(out.error).toMatchObject({ kind: "not_found", what: "action", name: "light.turn_of", suggestions: ["light.turn_off", "light.turn_on"] });
    expect(posts()).toHaveLength(1);
    expect(fake.requests.map((r) => `${r.method} ${r.url.pathname}`)).toEqual(["POST /api/services/light/turn_of", "GET /api/services"]);
  });

  it("never sends an action twice: a failure after sending is outcome_unknown", async () => {
    const { call, fake } = await setup({ fake: { network: "refused" } });
    const out = await call("call_action", { domain: "light", service: "turn_on", target: { entity_id: "light.kitchen" } });
    expect(out.error.kind).toBe("outcome_unknown");
    expect(out.error.remedy).toContain("get_states");
    expect(fake.requests).toHaveLength(1);
  });
});

describe("confirmation", () => {
  it("refuses a lock, alarm, cover or valve action in call_action, before anything is sent", async () => {
    const { call, fake } = await setup();
    for (const [domain, service] of [
      ["lock", "unlock"],
      ["cover", "open_cover"],
      ["alarm_control_panel", "alarm_disarm"],
      ["valve", "open_valve"],
    ]) {
      const out = await call("call_action", { domain, service, target: { entity_id: `${domain}.x` } });
      expect(out.error).toMatchObject({ kind: "needs_confirmation", action: `${domain}.${service}` });
      expect(out.error.remedy).toContain("call_action_confirmed");
    }
    expect(fake.requests).toEqual([]);
  });

  it("also refuses a generic action aimed at a confirmed domain, or wider than named entities", async () => {
    const { call, posts } = await setup();
    expect((await call("call_action", { domain: "homeassistant", service: "turn_off", target: { entity_id: ["light.kitchen", "cover.garage_door"] } })).error.kind).toBe("needs_confirmation");
    expect((await call("call_action", { domain: "homeassistant", service: "turn_off", target: { area_id: "kitchen" } })).error.kind).toBe("needs_confirmation");
    expect((await call("call_action", { domain: "homeassistant", service: "turn_off", target: { entity_id: "all" } })).error.kind).toBe("needs_confirmation");
    expect(posts()).toEqual([]);
    expect((await call("call_action", { domain: "light", service: "turn_on", target: { area_id: "kitchen" } })).action).toBe("light.turn_on");
    expect((await call("call_action", { domain: "homeassistant", service: "turn_off", target: { entity_id: "light.kitchen" } })).action).toBe("homeassistant.turn_off");
    expect(posts()).toHaveLength(2);
  });

  it("runs a confirmed action only once the user approves the exact line, a code shown as ****", async () => {
    const declined = await setup({ settings: { maxAccess: "money", confirm: "elicit" }, answer: () => false });
    const args = { domain: "lock", service: "unlock", target: { entity_id: "lock.front_door" }, data: { code: "1234" } };
    expect((await declined.call("call_action_confirmed", args)).error).toBeDefined();
    expect(declined.asked).toEqual(["home-assistant: run the Home Assistant action lock.unlock on lock.front_door, with code=****"]);
    expect(declined.fake.requests).toEqual([]);

    const approved = await setup({ settings: { maxAccess: "money", confirm: "elicit" } });
    const out = await approved.call("call_action_confirmed", args);
    expect(out.changed).toEqual([{ entity_id: "lock.front_door", state: "unlocked", last_changed: "2026-03-01T09:00:00+00:00" }]);
    expect(approved.asked).toHaveLength(1);
    expect(approved.posts()).toHaveLength(1);
  });

  it("follows HOME_ASSISTANT_CONFIRM_DOMAINS: other domains, none, and a value it cannot read refuses every action", async () => {
    const lights = await setup({ extraEnv: { HOME_ASSISTANT_CONFIRM_DOMAINS: "light, climate" } });
    expect((await lights.call("call_action", { domain: "light", service: "turn_on", target: { entity_id: "light.kitchen" } })).error.kind).toBe("needs_confirmation");
    expect((await lights.call("call_action", { domain: "lock", service: "lock", target: { entity_id: "lock.front_door" } })).action).toBe("lock.lock");

    const none = await setup({ extraEnv: { HOME_ASSISTANT_CONFIRM_DOMAINS: "none" } });
    expect((await none.call("call_action", { domain: "lock", service: "unlock", target: { entity_id: "lock.front_door" } })).action).toBe("lock.unlock");

    const typo = await setup({ extraEnv: { HOME_ASSISTANT_CONFIRM_DOMAINS: "lock;cover" } });
    expect((await typo.call("call_action", { domain: "light", service: "turn_on", target: { entity_id: "light.kitchen" } })).error).toMatchObject({ kind: "config", variable: "HOME_ASSISTANT_CONFIRM_DOMAINS" });
    expect(typo.fake.requests).toEqual([]);
    expect((await typo.call("health")).ok).toBe(false);
  });

  it("disables both action tools under MCP_MAX_ACCESS=read, and still reads", async () => {
    const { call, fake } = await setup({ settings: { maxAccess: "read", confirm: "client" } });
    expect((await call("call_action", { domain: "light", service: "turn_on", target: { entity_id: "light.kitchen" } })).error.kind).toBe("access_denied");
    expect((await call("call_action_confirmed", { domain: "lock", service: "unlock", target: { entity_id: "lock.front_door" } })).error.kind).toBe("access_denied");
    expect(fake.requests).toEqual([]);
    expect((await call("get_states", { entity_ids: ["light.kitchen"] })).states).toHaveLength(1);
  });

  it("decides and words confirmation from the same call, purely", () => {
    expect(confirmDomainsFrom(undefined)).toEqual({ domains: DEFAULT_CONFIRM_DOMAINS });
    expect(confirmDomainsFrom(" ")).toEqual({ domains: DEFAULT_CONFIRM_DOMAINS });
    expect(confirmDomainsFrom("None")).toEqual({ domains: [] });
    expect(confirmDomainsFrom("lock, lock,siren")).toEqual({ domains: ["lock", "siren"] });
    expect(confirmDomainsFrom("Lock")).toHaveProperty("problem");
    const call = actionCallOf({ domain: "light", service: "turn_on", target: { area_id: ["kitchen"], entity_id: "light.kitchen" }, data: { brightness_pct: 40 } });
    expect(confirmReason(call, ["lock"])).toBeUndefined();
    expect(actionLine(call)).toBe("run the Home Assistant action light.turn_on on light.kitchen; area kitchen, with brightness_pct=40");
    expect(actionLine(actionCallOf({ domain: "notify", service: "send", data: { message: "x".repeat(400) } }))).toBe(`run the Home Assistant action notify.send on no target, with message="${"x".repeat(56)}...`);
    const many = Object.fromEntries(["a", "b", "c", "d", "e", "f"].map((k) => [k, "z".repeat(50)]));
    expect(actionLine(actionCallOf({ domain: "notify", service: "send", data: many }))).toBe("run the Home Assistant action notify.send on no target, with fields a, b, c, d, e, f");
  });
});

describe("a refused token is never sent again", () => {
  it("answers a 401 at once, once, and sends nothing more with that token", async () => {
    const { call, fake } = await setup({ token: "wrong-token-0123456789" });
    const first = await call("get_states", { entity_ids: ["light.kitchen", "lock.front_door", "sun.sun"] });
    expect(first.error).toMatchObject({ kind: "auth", status: 401, sent: true });
    expect(first.error.remedy).toContain("HOME_ASSISTANT_TOKEN_FILE");
    expect(first.error.remedy).toContain("ban");
    expect(fake.requests).toHaveLength(1);

    const again = await call("list_entities");
    expect(again.error).toMatchObject({ kind: "auth", status: 401, sent: false });
    expect(again.error.message).toContain("not sent");
    const health = await call("health");
    expect(health.ok).toBe(false);
    expect(health.problems[0]).toContain("not sent");
    expect(health.problems[0]).toContain("long-lived access token");
    expect(await call("list_areas")).toMatchObject({ error: { kind: "auth", sent: false } });
    expect(fake.requests).toHaveLength(1);
    expect(fake.sockets).toEqual([]);
  });

  it("sends again once the token file holds another token", async () => {
    const { call, fake, tokenFile } = await setup({ token: "wrong-token-0123456789" });
    expect((await call("list_actions")).error.kind).toBe("auth");
    writeFileSync(tokenFile, `${TOKEN}\n`);
    expect((await call("list_actions")).domains).toBeDefined();
    expect(fake.requests).toHaveLength(2);
  });

  it("treats a 403 the same, pointing at Home Assistant's ban list", async () => {
    const { call, fake } = await setup({ fake: { routes: { "GET /api/services": () => ({ status: 403, text: "403: Forbidden" }) } } });
    const out = await call("list_actions");
    expect(out.error).toMatchObject({ kind: "auth", status: 403, sent: true });
    expect(out.error.remedy).toContain("ip_bans.yaml");
    expect((await call("get_states", { entity_ids: ["light.kitchen"] })).error).toMatchObject({ kind: "auth", sent: false });
    expect(fake.requests).toHaveLength(1);
  });

  it("remembers a token the WebSocket API refused, and sends no REST request with it", async () => {
    const { call, fake } = await setup({ token: "wrong-token-0123456789" });
    const out = await call("list_areas");
    expect(out.error).toMatchObject({ kind: "auth", status: 401, sent: true });
    expect(fake.sockets).toHaveLength(1);
    expect((await call("list_actions")).error).toMatchObject({ kind: "auth", sent: false });
    expect(fake.requests).toEqual([]);
  });
});

describe("an instance that is down or not itself", () => {
  it("says what the network said, after one more try for a read", async () => {
    const { call, fake } = await setup({ fake: { network: "refused" } });
    const out = await call("list_actions");
    expect(out.error.kind).toBe("unreachable");
    expect(out.error.message).toContain("ECONNREFUSED");
    expect(fake.requests).toHaveLength(2);
  });

  it("says how long it waited", async () => {
    const out = await (await setup({ fake: { network: "timeout" } })).call("list_actions");
    expect(out.error).toMatchObject({ kind: "unreachable", message: "Home Assistant at homeassistant.local did not answer within 30 s" });
  });

  it("tries a 503 once more, then says Home Assistant is unavailable", async () => {
    const { call, fake } = await setup({ fake: { routes: { "GET /api/services": () => ({ status: 503, text: "503: Service Unavailable" }) } } });
    expect((await call("list_actions")).error).toMatchObject({ kind: "unavailable", status: 503 });
    expect(fake.requests).toHaveLength(2);
  });

  it("calls a page that is not Home Assistant's JSON drift", async () => {
    const out = await (await setup({ fake: { routes: { "GET /api/services": () => ({ status: 200, text: "<html>Sign in</html>", contentType: "text/html" }) } } })).call("list_actions");
    expect(out.error.kind).toBe("drift");
    expect(out.error.remedy).toContain("HOME_ASSISTANT_URL");
  });
});

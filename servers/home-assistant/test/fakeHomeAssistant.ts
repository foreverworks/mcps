/**
 * An invented Home Assistant behind a fake fetch and a fake WebSocket: a
 * small flat with a kitchen, a living room and a hallway. It checks the
 * bearer token as Home Assistant does (401 "401: Unauthorized"), answers the
 * paths this server reads, and records every request and every socket, so a
 * test can assert what was sent, and that nothing was.
 */
import type { SocketLike } from "../src/infra/socket.js";

export const TOKEN = "fake-long-lived-token-0123456789";
export const VERSION = "2026.10.1";

type State = { entity_id: string; state: string; attributes: Record<string, unknown>; last_changed: string; last_updated: string };

const at = "2026-03-01T08:00:00+00:00";
const state = (entity_id: string, value: string, attributes: Record<string, unknown> = {}): State => ({ entity_id, state: value, attributes, last_changed: at, last_updated: at });

export const STATES = (): State[] => [
  state("light.kitchen", "on", { friendly_name: "Kitchen light", brightness: 180 }),
  state("lock.front_door", "locked", { friendly_name: "Front door" }),
  state("climate.living_room", "heat", { friendly_name: "Living room thermostat", temperature: 21, current_temperature: 20.5 }),
  state("sensor.living_room_temperature", "20.5", { friendly_name: "Living room temperature", unit_of_measurement: "°C" }),
  state("cover.garage_door", "closed", { friendly_name: "Garage door" }),
  state("camera.porch", "idle", { friendly_name: "Porch", access_token: "porch-camera-secret", entity_picture: "/api/camera_proxy/camera.porch?token=porch-camera-secret&time=1" }),
  state("sun.sun", "above_horizon", { friendly_name: "Sun" }),
];

export const SERVICES = [
  {
    domain: "light",
    services: {
      turn_on: {
        name: "Turn on",
        description: "Turns on one or more lights.",
        target: { entity: [{ domain: ["light"] }] },
        fields: {
          brightness_pct: { name: "Brightness", description: "Percent of full brightness.", example: 40, selector: { number: { min: 0, max: 100 } } },
          advanced_fields: { collapsed: true, fields: { flash: { name: "Flash", selector: { select: { options: ["short", { value: "long", label: "Long" }] } } } } },
        },
      },
      turn_off: { name: "Turn off", target: { entity: [{ domain: ["light"] }] }, fields: {} },
    },
  },
  { domain: "lock", services: { lock: { name: "Lock", target: {}, fields: {} }, unlock: { name: "Unlock", target: {}, fields: { code: { name: "Code", selector: { text: {} } } } } } },
  { domain: "cover", services: { open_cover: { name: "Open", target: {}, fields: {} }, close_cover: { name: "Close", target: {}, fields: {} } } },
  { domain: "homeassistant", services: { turn_off: { name: "Generic turn off", target: {}, fields: {} }, restart: { name: "Restart", fields: {} } } },
  { domain: "climate", services: { set_temperature: { name: "Set temperature", target: {}, fields: { temperature: { required: true, selector: { number: {} } } } } } },
  { domain: "weather", services: { get_forecasts: { name: "Get forecasts", target: {}, fields: { type: { required: true, selector: { select: { options: ["daily", "hourly"] } } } }, response: { optional: false } } } },
];

export const REGISTRIES = {
  "config/area_registry/list": [
    { area_id: "kitchen", name: "Kitchen", floor_id: "ground" },
    { area_id: "living_room", name: "Living room", floor_id: "ground" },
    { area_id: "hallway", name: "Hallway", floor_id: null },
  ],
  "config/floor_registry/list": [{ floor_id: "ground", name: "Ground floor", level: 0 }],
  "config/device_registry/list": [
    { id: "0a1b2c3d4e5f60718293a4b5c6d7e8f9", name: "Ceiling light", name_by_user: null, area_id: "kitchen", disabled_by: null },
    { id: "1a1b2c3d4e5f60718293a4b5c6d7e8f9", name: "Smart lock", name_by_user: "Front door lock", area_id: "hallway", disabled_by: null },
    { id: "2a1b2c3d4e5f60718293a4b5c6d7e8f9", name: "Thermostat", area_id: "living_room", disabled_by: null },
    { id: "3a1b2c3d4e5f60718293a4b5c6d7e8f9", name: "Old plug", area_id: "kitchen", disabled_by: "user" },
  ],
  "config/entity_registry/list": [
    { entity_id: "light.kitchen", device_id: "0a1b2c3d4e5f60718293a4b5c6d7e8f9", area_id: null, disabled_by: null },
    { entity_id: "lock.front_door", device_id: "1a1b2c3d4e5f60718293a4b5c6d7e8f9", area_id: null, disabled_by: null },
    { entity_id: "climate.living_room", device_id: "2a1b2c3d4e5f60718293a4b5c6d7e8f9", area_id: null, disabled_by: null },
    { entity_id: "sensor.living_room_temperature", device_id: "2a1b2c3d4e5f60718293a4b5c6d7e8f9", area_id: null, disabled_by: null },
    { entity_id: "switch.old_plug", device_id: "3a1b2c3d4e5f60718293a4b5c6d7e8f9", area_id: null, disabled_by: "user" },
    { entity_id: "cover.garage_door", device_id: null, area_id: null, disabled_by: null },
    { entity_id: "camera.porch", device_id: null, area_id: "hallway", disabled_by: null },
  ],
} as const;

export type Recorded = { readonly method: string; readonly url: URL; readonly headers: Readonly<Record<string, string>>; readonly body: unknown };

export type Reply = { readonly status?: number; readonly json?: unknown; readonly text?: string; readonly contentType?: string };

export type SocketReply = { readonly result: unknown } | { readonly error: { readonly code: string; readonly message: string } };

export type FakeOptions = {
  /** Answers by "METHOD /path", before the built-in ones (the bearer token is still checked first, as Home Assistant does). */
  readonly routes?: Readonly<Record<string, (req: Recorded) => Reply>>;
  /** Fail every fetch as undici does when nothing listens (ECONNREFUSED), or as a timeout. */
  readonly network?: "refused" | "timeout";
  /** Answers by command type, before the registries. */
  readonly socketReplies?: Readonly<Record<string, SocketReply>>;
  /** The socket cannot be opened: an error, then a close, as a browser-style WebSocket reports it. */
  readonly socketDown?: boolean;
  readonly haState?: string;
};

const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const text = (status: number, body: string): Response => new Response(body, { status, headers: { "content-type": "text/plain" } });

export const fakeHomeAssistant = (options: FakeOptions = {}) => {
  const requests: Recorded[] = [];
  const sockets: { url: string; sent: Record<string, unknown>[] }[] = [];
  const states = STATES();
  let token = TOKEN;

  const builtIn = (req: Recorded): Response => {
    const path = req.url.pathname;
    if (req.method === "GET" && path === "/api/config")
      return json(200, { version: VERSION, state: options.haState ?? "RUNNING", time_zone: "Europe/Bucharest", location_name: "Test flat", safe_mode: false, recovery_mode: false, components: ["light"] });
    if (req.method === "GET" && path === "/api/states") return json(200, states);
    if (req.method === "GET" && path.startsWith("/api/states/")) {
      const found = states.find((s) => s.entity_id === decodeURIComponent(path.slice("/api/states/".length)));
      return found === undefined ? json(404, { message: "Entity not found." }) : json(200, found);
    }
    if (req.method === "GET" && path === "/api/services") return json(200, SERVICES);
    if (req.method === "POST" && path.startsWith("/api/services/")) {
      const [domain, service] = path.slice("/api/services/".length).split("/");
      const known = SERVICES.find((d) => d.domain === domain)?.services as Record<string, unknown> | undefined;
      if (known?.[service ?? ""] === undefined) return text(400, "400: Bad Request");
      const body = (req.body ?? {}) as { entity_id?: string[] };
      const next: Record<string, string> = { turn_on: "on", turn_off: "off", lock: "locked", unlock: "unlocked", open_cover: "open", close_cover: "closed" };
      const changed = (body.entity_id ?? []).flatMap((id) => {
        const s = states.find((x) => x.entity_id === id);
        const value = next[service ?? ""];
        if (s === undefined || value === undefined || s.state === value) return [];
        s.state = value;
        s.last_changed = "2026-03-01T09:00:00+00:00";
        return [s];
      });
      if (req.url.searchParams.has("return_response")) return json(200, { changed_states: changed, service_response: { "weather.home": { forecast: [{ temperature: 12 }] } } });
      return json(200, changed);
    }
    if (req.method === "GET" && path.startsWith("/api/history/period/")) {
      const ids = (req.url.searchParams.get("filter_entity_id") ?? "").split(",");
      return json(
        200,
        ids
          .filter((id) => states.some((s) => s.entity_id === id))
          .map((id) => [
            { entity_id: id, state: "18.0", last_changed: "2026-03-01T00:00:00+00:00", last_updated: "2026-03-01T00:00:00+00:00" },
            { state: "19.0", last_changed: "2026-03-01T03:00:00+00:00" },
            { state: "20.5", last_changed: "2026-03-01T07:00:00+00:00" },
          ]),
      );
    }
    if (req.method === "GET" && path.startsWith("/api/logbook/")) {
      return json(200, [
        { when: "2026-03-01T06:30:00+00:00", name: "Kitchen light", message: "turned on", entity_id: "light.kitchen", state: "on", domain: "light", context_domain: "light", context_service: "turn_on", context_user_id: "user-1" },
        { when: 1772348400, name: "Front door", message: "was locked", entity_id: "lock.front_door", state: "locked", context_event_type: "automation_triggered", context_name: "Lock at night" },
      ]);
    }
    if (req.method === "POST" && path === "/api/template") {
      const t = (req.body as { template?: string }).template ?? "";
      if (t.includes("{% bad")) return json(400, { message: "Error rendering template: TemplateSyntaxError: unexpected end of template" });
      return text(200, t.replace("{{ states('sensor.living_room_temperature') }}", "20.5"));
    }
    return text(404, "404: Not Found");
  };

  const fetch = (async (input: Parameters<typeof globalThis.fetch>[0], init?: Parameters<typeof globalThis.fetch>[1]) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const headers = { ...((init?.headers ?? {}) as Record<string, string>) };
    let body: unknown;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    const req: Recorded = { method: init?.method ?? "GET", url, headers, body };
    requests.push(req);
    if (options.network === "refused") throw new TypeError("fetch failed", { cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }) });
    if (options.network === "timeout") throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    if (headers["Authorization"] !== `Bearer ${token}`) return text(401, "401: Unauthorized");
    const route = options.routes?.[`${req.method} ${url.pathname}`];
    if (route !== undefined) {
      const r = route(req);
      return r.json !== undefined ? json(r.status ?? 200, r.json) : new Response(r.text ?? "", { status: r.status ?? 200, headers: { "content-type": r.contentType ?? "text/plain" } });
    }
    return builtIn(req);
  }) as typeof globalThis.fetch;

  const openSocket = (url: string): SocketLike => {
    const record = { url, sent: [] as Record<string, unknown>[] };
    sockets.push(record);
    let authed = false;
    const socket: SocketLike = {
      onopen: null,
      onmessage: null,
      onerror: null,
      onclose: null,
      send: (data) => {
        const message = JSON.parse(data) as Record<string, unknown>;
        record.sent.push(message);
        const reply = (m: unknown): void => void setTimeout(() => socket.onmessage?.({ data: JSON.stringify(m) }), 0);
        if (message["type"] === "auth") {
          if (message["access_token"] === token) {
            authed = true;
            reply({ type: "auth_ok", ha_version: VERSION });
          } else {
            reply({ type: "auth_invalid", message: "Invalid access token or password" });
            setTimeout(() => socket.onclose?.({ code: 1000 }), 1);
          }
          return;
        }
        if (!authed) return;
        const type = String(message["type"]);
        const override = options.socketReplies?.[type];
        const result = override ?? (type in REGISTRIES ? { result: REGISTRIES[type as keyof typeof REGISTRIES] } : { error: { code: "unknown_command", message: "Unknown command." } });
        reply("result" in result ? { id: message["id"], type: "result", success: true, result: result.result } : { id: message["id"], type: "result", success: false, error: result.error });
      },
      close: () => undefined,
    };
    setTimeout(() => {
      if (options.socketDown === true) {
        socket.onerror?.({});
        socket.onclose?.({ code: 1006 });
      } else {
        socket.onmessage?.({ data: JSON.stringify({ type: "auth_required", ha_version: VERSION }) });
      }
    }, 0);
    return socket;
  };

  return {
    fetch,
    openSocket,
    requests,
    sockets,
    states,
    /** Make Home Assistant accept another token from now on (the owner made a new one). */
    acceptToken: (next: string) => {
      token = next;
    },
  };
};

export type FakeHomeAssistant = ReturnType<typeof fakeHomeAssistant>;

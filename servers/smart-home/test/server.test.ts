/**
 * The server as a client sees it, through the kit's guard, against fake RM4
 * minis on a fake network (test/fakeBlaster.ts) and a catalog of invented
 * devices.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkPolicy, connectInMemory, guard, McpServer, REQUIRES_USER_META } from "@foreverworks/mcp-kit";
import { describe, expect, it } from "vitest";

import { packetFor } from "../src/app/usecases/press.js";
import { buildDeps } from "../src/composition.js";
import { decodeNec, encodeNec } from "../src/domain/ir/nec.js";
import { decodeIrPacket, encodeIrPacket, microsecondsOf, unitsOf } from "../src/domain/ir/packet.js";
import { POLICY } from "../src/mcp/policy.js";
import { registerAll } from "../src/mcp/register.js";
import { type FakeBlaster, fakeBlaster, fakeNetwork } from "./fakeBlaster.js";

const CATALOG = {
  blasters: [{ name: "living-room", host: "192.0.2.10", mac: "02:00:00:00:00:01" }],
  devices: [
    {
      name: "tv",
      title: "Television",
      address: "0x04",
      buttons: [
        { name: "power", command: "0x08", toggle: true },
        { name: "volume_up", command: 2 },
      ],
    },
    {
      name: "heater",
      title: "Fan heater",
      address: 0,
      note: "On the floor by the window.",
      buttons: [
        { name: "power", command: "0x46", toggle: true, confirm: true, note: "starts heating" },
        { name: "swing", command: "0x09" },
      ],
    },
    {
      name: "purifier",
      title: "Air purifier",
      address: "0x80",
      interval_ms: 1200,
      buttons: [
        { name: "speed", command: "0x0b", wake: true },
        { name: "mode", command: "0x0c" },
      ],
    },
  ],
};

const connected = async (options: { catalog?: unknown; blaster?: Partial<FakeBlaster>; env?: Record<string, string> } = {}) => {
  const root = mkdtempSync(join(tmpdir(), "smart-home-test-"));
  const file = join(root, "catalog.json");
  writeFileSync(file, JSON.stringify(options.catalog ?? CATALOG));
  const blaster = fakeBlaster(options.blaster);
  let clock = 0;
  const sleeps: number[] = [];
  const deps = buildDeps({
    env: options.env ?? { SMART_HOME_CONFIG_FILE: file },
    exchange: fakeNetwork([blaster]),
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    random: () => 0.5,
  });
  const server = new McpServer({ name: "smart-home", version: "test" });
  registerAll(guard(server, { service: "smart-home", policy: POLICY, log: () => undefined }), deps);
  const client = await connectInMemory(server);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<any> => {
    const result = (await client.callTool({ name, arguments: args })) as { content: { text: string }[] };
    return JSON.parse(result.content[0]?.text ?? "{}");
  };
  return { call, client, blaster, file, sleeps };
};

const necOf = (packet: Uint8Array | undefined) => decodeNec((decodeIrPacket(packet ?? new Uint8Array())?.durations ?? []).map(microsecondsOf));

describe("the tool surface", () => {
  it("lists the same tools, arguments and descriptions as the snapshot, every one classified", async () => {
    const { client } = await connected();
    const { tools } = await client.listTools();
    await expect(`${JSON.stringify(tools, null, 2)}\n`).toMatchFileSnapshot("./tools.snapshot.json");
    expect(() => checkPolicy("smart-home", (server) => registerAll(server, buildDeps({ env: {} })), POLICY)).not.toThrow();
  });

  it("marks press_confirmed and send_code for the user to approve every call, and nothing else", async () => {
    const { client } = await connected();
    const { tools } = await client.listTools();
    expect(tools.filter((t) => t._meta?.[REQUIRES_USER_META] === true).map((t) => t.name).sort()).toEqual(["press_confirmed", "send_code"]);
  });

  it("names the missing catalog, and still lists its tools", async () => {
    const { call } = await connected({ env: {} });
    const out = await call("devices");
    expect(out.error.kind).toBe("config");
    expect(out.error.message).toContain("SMART_HOME_CONFIG_FILE");
    expect((await call("health")).ok).toBe(false);
  });
});

describe("status and health", () => {
  it("reports a blaster that answers: model, MAC, name, lock, firmware", async () => {
    const { call } = await connected();
    expect((await call("status")).blasters).toEqual([
      { name: "living-room", host: "192.0.2.10", online: true, model: "RM4 mini", devtype: "0x520c", mac: "02:00:00:00:00:01", name_on_device: "Living room", locked: false, firmware: 1234 },
    ]);
    expect(await call("health")).toEqual({ ok: true, blasters: [{ name: "living-room", reachable: true, locked: false }], devices: 3 });
  });

  it("says a blaster without power is offline and what to check, and stays healthy", async () => {
    const { call } = await connected({ blaster: { online: false } });
    const [b] = (await call("status")).blasters;
    expect(b.online).toBe(false);
    expect(b.error.kind).toBe("offline");
    expect(b.error.remedy).toContain("USB plug");
    expect(await call("health")).toEqual({ ok: true, blasters: [{ name: "living-room", reachable: false }], devices: 3 });
  });

  it("says a locked blaster is locked, by its flag or by a refused auth, and is not healthy", async () => {
    for (const blaster of [{ locked: true }, { refuseAuth: true }]) {
      const { call } = await connected({ blaster });
      const [b] = (await call("status")).blasters;
      expect(b.locked).toBe(true);
      expect(b.firmware).toBeUndefined();
      expect(b.attention).toContain("Lock device");
      expect((await call("health")).ok).toBe(false);
      const pressed = await call("press", { device: "tv", button: "volume_up" });
      expect(pressed.error.kind).toBe("locked");
    }
  });

  it("notices another device at the blaster's address", async () => {
    const { call } = await connected({ blaster: { mac: "02:00:00:00:00:99" } });
    const [b] = (await call("status")).blasters;
    expect(b.error).toMatchObject({ kind: "identity", expected: "02:00:00:00:00:01", found: "02:00:00:00:00:99" });
    expect((await call("health")).ok).toBe(false);
  });
});

describe("pressing", () => {
  it("lists the devices and their buttons, saying which toggle and which need approval", async () => {
    const { call } = await connected();
    const out = await call("devices");
    expect(out.devices[1]).toEqual({
      name: "heater",
      title: "Fan heater",
      blaster: "living-room",
      note: "On the floor by the window.",
      buttons: [
        { name: "power", code: "NEC 0x00/0x46", toggle: true, confirm: "the user approves each press: press_confirmed", note: "starts heating" },
        { name: "swing", code: "NEC 0x00/0x09" },
      ],
    });
    expect(out.note).toContain("IR goes one way");
    expect(out.devices[2]).toMatchObject({ name: "purifier", interval_ms: 1200, buttons: [{ name: "speed", code: "NEC 0x80/0x0b" }, { name: "mode", code: "NEC 0x80/0x0c" }] });
    expect(out.devices[2].buttons[0].wake).toContain("only wakes it");
    expect(out.devices[2].buttons[1].wake).toBeUndefined();
  });

  it("sends a button's NEC code as one natural press, and says a toggle's state is unknown", async () => {
    const { call, blaster } = await connected();
    const out = await call("press", { device: "tv", button: "power" });
    expect(out).toMatchObject({ device: "tv", button: "power", code: "NEC 0x04/0x08", times: 1, sent: true });
    expect(out.note).toContain("nothing here can read whether a device is on or off");
    expect(blaster.sent).toHaveLength(1);
    expect(necOf(blaster.sent[0])).toEqual({ address: 0x04, command: 0x08, extended: false, repeats: 1 });
  });

  it("presses several times, each a separate press, 400 ms apart unless the device or the call says otherwise", async () => {
    const { call, blaster, sleeps } = await connected();
    expect(await call("press", { device: "tv", button: "volume_up", times: 3 })).toMatchObject({ times: 3, interval_ms: 400 });
    expect(blaster.sent.map((p) => necOf(p)?.command)).toEqual([2, 2, 2]);
    expect(sleeps).toEqual([400, 400]);
    sleeps.length = 0;
    expect((await call("press", { device: "tv", button: "volume_up", times: 2, interval_ms: 1500 })).interval_ms).toBe(1500);
    expect(sleeps).toEqual([1500]);
    sleeps.length = 0;
    expect((await call("press", { device: "purifier", button: "mode", times: 2 })).interval_ms).toBe(1200);
    expect(sleeps).toEqual([1200]);
  });

  it("says nothing of spacing for a single press, and waits for none", async () => {
    const { call, sleeps } = await connected();
    expect((await call("press", { device: "tv", button: "volume_up", interval_ms: 3000 })).interval_ms).toBeUndefined();
    expect(sleeps).toEqual([]);
  });

  it("sends a wake press first for a button marked wake, and none when the call says the device is awake", async () => {
    const { call, blaster, sleeps } = await connected();
    const out = await call("press", { device: "purifier", button: "speed", times: 2 });
    expect(out).toMatchObject({ times: 2, wake_press: true, interval_ms: 1200, sent: true });
    expect(out.note).toContain("A wake press went out first");
    expect(blaster.sent.map((p) => necOf(p)?.command)).toEqual([0x0b, 0x0b, 0x0b]);
    expect(sleeps).toEqual([1200, 1200]);
    blaster.sent.length = 0;
    const awake = await call("press", { device: "purifier", button: "speed", wake: false });
    expect(awake.wake_press).toBeUndefined();
    expect(blaster.sent).toHaveLength(1);
    blaster.sent.length = 0;
    expect((await call("press", { device: "tv", button: "volume_up", wake: true })).wake_press).toBe(true);
    expect(blaster.sent).toHaveLength(2);
  });

  it("refuses presses that would wait too long in all, sending nothing", async () => {
    const { call, blaster } = await connected();
    const out = await call("press", { device: "purifier", button: "speed", times: 3, interval_ms: 10_000 });
    expect(out.error.kind).toBe("input");
    expect(out.error.message).toContain("4 presses (one of them to wake the device) 10 s apart wait 30 s in all");
    expect(blaster.datagrams).toBe(0);
    expect((await call("send_code", { device: "tv", address: 4, command: 2, times: 10, interval_ms: 3000 })).error.kind).toBe("input");
    expect(blaster.datagrams).toBe(0);
  });

  it("refuses a pause shorter than the default or longer than 10 s", async () => {
    const { client, blaster } = await connected();
    for (const interval_ms of [100, 10_001]) {
      const out = (await client.callTool({ name: "press", arguments: { device: "tv", button: "volume_up", times: 2, interval_ms } })) as { isError?: boolean };
      expect(out.isError).toBe(true);
    }
    expect(blaster.datagrams).toBe(0);
  });

  it("tells the person approving a call how it is spaced", () => {
    const line = (tool: "press_confirmed" | "send_code", args: Record<string, unknown>) => {
      const rule = POLICY[tool] as { summary?: (a: Record<string, unknown>) => string };
      return rule.summary?.(args);
    };
    expect(line("press_confirmed", { device: "heater", button: "power" })).toBe('press "power" on device "heater" by infrared, once');
    expect(line("press_confirmed", { device: "heater", button: "power", times: 3, interval_ms: 1500, wake: true })).toBe(
      'press "power" on device "heater" by infrared, 3 times, 1.5 s apart, after one press to wake it',
    );
    expect(line("send_code", { device: "heater", address: 0, command: 0x15, times: 2, interval_ms: 2000 })).toContain("0x00/0x15 2 times, 2 s apart through");
  });

  it("refuses a button marked for approval, sending nothing; press_confirmed sends it", async () => {
    const { call, blaster } = await connected();
    const refused = await call("press", { device: "heater", button: "power" });
    expect(refused.error.kind).toBe("needs_confirmation");
    expect(refused.error.message).toContain("starts heating");
    expect(refused.error.remedy).toContain("press_confirmed");
    expect(blaster.datagrams).toBe(0);
    expect((await call("press_confirmed", { device: "heater", button: "power" })).sent).toBe(true);
    expect(necOf(blaster.sent[0])).toMatchObject({ address: 0, command: 0x46 });
  });

  it("never sends a code twice when the blaster does not confirm it", async () => {
    const { call, blaster } = await connected({ blaster: { silentOnSend: true } });
    const out = await call("press", { device: "tv", button: "power", times: 2 });
    expect(out.error.kind).toBe("outcome_unknown");
    expect(out.error.remedy).toContain("toggle");
    expect(blaster.sent).toHaveLength(1);
  });

  it("names the buttons a device has when one is not there", async () => {
    const { call } = await connected();
    const out = await call("press", { device: "tv", button: "mute" });
    expect(out.error.kind).toBe("input");
    expect(out.error.message).toContain("power, volume_up");
    expect((await call("press", { device: "radio", button: "power" })).error.message).toContain("tv, heater");
  });

  it("sends a code the catalog does not hold, and names a button that already sends it", async () => {
    const { call, blaster } = await connected();
    const out = await call("send_code", { device: "heater", address: 0, command: 0x09 });
    expect(out).toMatchObject({ blaster: "living-room", code: "NEC 0x00/0x09", sent: true, known_as: [{ device: "heater", button: "swing" }] });
    expect(necOf(blaster.sent[0])).toMatchObject({ address: 0, command: 0x09 });
    expect((await call("send_code", { address: 0xbf40, command: 1 })).error.kind).toBe("input");
  });

  it("spaces a code's presses by interval_ms, else by the named device's", async () => {
    const { call, sleeps } = await connected();
    expect((await call("send_code", { device: "purifier", address: 0x80, command: 0x0d, times: 2 })).interval_ms).toBe(1200);
    expect((await call("send_code", { device: "tv", address: 4, command: 0x0d, times: 3, interval_ms: 2000 })).interval_ms).toBe(2000);
    expect(sleeps).toEqual([1200, 2000, 2000]);
  });
});

describe("learning", () => {
  const remote = (address: number, command: number, repeats: number): Uint8Array =>
    encodeIrPacket({ durations: encodeNec({ address, command }, repeats).map((us, i) => unitsOf(us) + (i % 2 === 0 ? 1 : -1)), repeat: 0 });

  it("hears a press and finds the button that sends it", async () => {
    const { call } = await connected({ blaster: { press: { afterChecks: 3, packet: remote(0, 0x46, 3) } } });
    expect(await call("learn", { device: "heater" })).toEqual({
      blaster: "living-room",
      protocol: "NEC",
      address: "0x00",
      command: "0x46",
      repeat_codes: 3,
      known_as: [{ device: "heater", button: "power" }],
      note: "Already in the catalog as known_as.",
    });
  });

  it("gives the entry to add for a code the catalog does not hold", async () => {
    const { call } = await connected({ blaster: { press: { afterChecks: 1, packet: remote(0, 0x15, 1) } } });
    const out = await call("learn", {});
    expect(out.keep).toEqual({ name: "<button>", address: "0x00", command: "0x15" });
    expect(out.known_as).toBeUndefined();
  });

  it("keeps the window open past its end, and says when nobody pressed", async () => {
    const late = await connected({ blaster: { press: { afterChecks: 30, packet: remote(4, 2, 1) } } });
    expect((await late.call("learn", { seconds: 40 })).known_as).toEqual([{ device: "tv", button: "volume_up" }]);
    const { call } = await connected();
    const out = await call("learn", { seconds: 5 });
    expect(out.error.kind).toBe("nothing_learned");
    expect(out.error.remedy).toContain("press the button once");
  });

  it("answers another protocol's press as pulses to keep", async () => {
    const sony = encodeIrPacket({ durations: [77, 19, 39, 19, 19, 19, 39, 19, 806], repeat: 0 });
    const { call } = await connected({ blaster: { press: { afterChecks: 1, packet: sony } } });
    const out = await call("learn", {});
    expect(out.protocol).toBe("not NEC");
    expect(out.keep.pulses).toHaveLength(9);
  });

  it("sends a kept raw code as it was heard", async () => {
    const pulses = [2400, 600, 1200, 600, 600, 600, 1200, 25_000];
    const catalog = { ...CATALOG, devices: [{ name: "fan", buttons: [{ name: "speed", pulses }] }] };
    const { call, blaster } = await connected({ catalog });
    expect((await call("press", { device: "fan", button: "speed" })).code).toBe("raw, 8 pulses");
    expect([...(blaster.sent[0] ?? [])]).toEqual([...packetFor({ kind: "raw", pulses })]);
  });
});

describe("the catalog", () => {
  it("names every problem in one config error", async () => {
    const catalog = {
      blasters: [
        { name: "a", host: "192.0.2.10" },
        { name: "a", host: "192.0.2.11" },
      ],
      devices: [{ name: "tv", blaster: "b", buttons: [{ name: "power", command: 8 }] }],
    };
    const out = await (await connected({ catalog })).call("devices");
    expect(out.error.kind).toBe("config");
    expect(out.error.message).toContain('two blasters are named "a"');
    expect(out.error.message).toContain('names blaster "b"');
    expect(out.error.message).toContain("neither it nor its device has an NEC address");
  });

  it("refuses a device pause outside 400 ms to 10 s", async () => {
    const catalog = { ...CATALOG, devices: [{ name: "fan", address: 0, interval_ms: 50, buttons: [{ name: "speed", command: 1 }] }] };
    const out = await (await connected({ catalog })).call("devices");
    expect(out.error.kind).toBe("config");
  });

  it("refuses a field it does not know rather than ignoring it", async () => {
    const out = await (await connected({ catalog: { ...CATALOG, rooms: [] } })).call("devices");
    expect(out.error.kind).toBe("config");
  });
});

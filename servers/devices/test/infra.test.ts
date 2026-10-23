import { createServer, type Server } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { makeAdb, parseDevices, parsePackages } from "../src/infra/adb.js";
import { loadCatalog, parseCatalog } from "../src/infra/catalog.js";
import { doorShell, makeDoor, message, readMessages } from "../src/infra/door.js";
import { makeHosts, newestIosRuntime, newestRuntime, parseAndroidProbe, parseEmulatorStates, parseMacProbe, parsePairs, userApps, watchesOf } from "../src/infra/hosts.js";
import type { Host } from "../src/domain/catalog.js";

describe("probe parsers", () => {
  it("reads an Android host's memory and load", () => {
    expect(parseAndroidProbe("43210000\n@@devices@@\n1.15\n")).toEqual({ memAvailableMiB: 42197, load: 1.15 });
  });

  it("reads each emulator's unit state from the control command's status, and ignores anything else", () => {
    const probe = parseAndroidProbe("43210000\n@@devices@@\n0.5\n@@devices@@\npool1 active\npool2 activating\npool3 inactive\n");
    expect(probe.emulators).toEqual({ pool1: "active", pool2: "activating", pool3: "inactive" });
    expect(parseEmulatorStates("pool1 active\nrm -rf / now\nBad active\n\npool4 failed")).toEqual({ pool1: "active", pool4: "failed" });
  });

  it("reads the Mac's power, load, CI and simulators", () => {
    const sims = JSON.stringify({
      devices: {
        "com.apple.CoreSimulator.SimRuntime.iOS-27-0": [
          { name: "dev-iphone", udid: "11111111-2222-4333-8444-555555555555", state: "Booted", isAvailable: true },
          { name: "ci-iphone", udid: "66666666-7777-4888-9999-AAAAAAAAAAAA", state: "Shutdown" },
        ],
      },
    });
    const p = parseMacProbe(`Now drawing from 'AC Power'\n@@devices@@\n{ 2.31 2.10 1.98 }\n@@devices@@\nidle\n@@devices@@\nnone\n@@devices@@\n${sims}`);
    expect(p).toMatchObject({ onAc: true, ciBusy: false, load: 2.31, desktop: false });
    expect(p.simulators.map((s) => s.state)).toEqual(["Booted", "Shutdown"]);
    expect(parseMacProbe(`Now drawing from 'Battery Power'\n@@devices@@\n{ 1 1 1 }\n@@devices@@\nbusy\n@@devices@@\ndesktop\n@@devices@@\n{}`)).toMatchObject({ onAc: false, ciBusy: true, desktop: true });
  });

  it("picks the newest available iOS runtime", () => {
    const json = JSON.stringify({
      runtimes: [
        { identifier: "com.apple.CoreSimulator.SimRuntime.iOS-26-5", version: "26.5", platform: "iOS", isAvailable: true },
        { identifier: "com.apple.CoreSimulator.SimRuntime.iOS-27-0", version: "27.0", platform: "iOS", isAvailable: true },
        { identifier: "com.apple.CoreSimulator.SimRuntime.iOS-27-1", version: "27.1", platform: "iOS", isAvailable: false },
        { identifier: "com.apple.CoreSimulator.SimRuntime.watchOS-12-0", version: "12.0", platform: "watchOS", isAvailable: true },
      ],
    });
    expect(newestIosRuntime(json)).toBe("com.apple.CoreSimulator.SimRuntime.iOS-27-0");
  });

  it("picks the newest available watchOS runtime, and reads which watch is paired with which phone", () => {
    const runtimes = JSON.stringify({
      runtimes: [
        { identifier: "com.apple.CoreSimulator.SimRuntime.iOS-27-0", version: "27.0", platform: "iOS", isAvailable: true },
        { identifier: "com.apple.CoreSimulator.SimRuntime.watchOS-26-4", version: "26.4", platform: "watchOS", isAvailable: true },
        { identifier: "com.apple.CoreSimulator.SimRuntime.watchOS-27-0", version: "27.0", platform: "watchOS", isAvailable: true },
      ],
    });
    expect(newestRuntime(runtimes, "watchOS")).toBe("com.apple.CoreSimulator.SimRuntime.watchOS-27-0");
    // simctl list pairs --json, in the shape a Mac answers it.
    const pairs = parsePairs(
      JSON.stringify({
        pairs: {
          "22222222-0000-4000-8000-000000000000": {
            watch: { name: "Apple Watch Series 12 (46mm)", udid: "22222222-0000-4000-8000-000000000002", state: "Shutdown" },
            phone: { name: "iPhone 17 Pro", udid: "22222222-0000-4000-8000-000000000001", state: "Shutdown" },
            state: "(active, disconnected)",
          },
          broken: { state: "(unpaired)" },
        },
      }),
    );
    expect(pairs).toEqual([{ watch: "22222222-0000-4000-8000-000000000002", phone: "22222222-0000-4000-8000-000000000001" }]);
    expect(watchesOf(pairs, "22222222-0000-4000-8000-000000000001")).toEqual(["22222222-0000-4000-8000-000000000002"]);
    expect(watchesOf(pairs, "22222222-0000-4000-8000-000000000002")).toEqual([]);
    expect(parsePairs("{}")).toEqual([]);
  });

  it("finds the user-installed apps in simctl listapps' plist", () => {
    const plist = `{
    "com.apple.Bridge" =     {
        ApplicationType = System;
        Bundle = "file:///Library/Bridge.app/";
    };
    "com.example.app" =     {
        ApplicationType = User;
        Bundle = "file:///Users/runner/App.app/";
        GroupContainers =         {
        };
    };
    "dev.mobile.maestro-driver-iosUITests.xctrunner" =     {
        ApplicationType = User;
    };
}`;
    expect(userApps(plist)).toEqual(["com.example.app", "dev.mobile.maestro-driver-iosUITests.xctrunner"]);
  });

  it("reads adb's device list and package list", () => {
    expect(parseDevices("emulator-5554\tdevice\nemulator-5556\toffline\n")).toEqual([
      { serial: "emulator-5554", state: "device" },
      { serial: "emulator-5556", state: "offline" },
    ]);
    expect(parsePackages("package:com.example.app\r\npackage:dev.mobile.maestro\nnoise\n")).toEqual(["com.example.app", "dev.mobile.maestro"]);
  });
});

describe("simulators on a Mac, over ssh", () => {
  const mac: Host = { id: "mac-1", label: "mac-1", platform: "ios", ssh: "runner@mac-1.example.com", requiresAc: true, spawnMax: 1, costMiB: 0, reserveMiB: 0, builders: 1, isolates: false };
  const PHONE = "11111111-0000-4000-8000-000000000001";
  const WATCH = "11111111-0000-4000-8000-000000000002";
  const OTHER = "11111111-0000-4000-8000-000000000003";
  const spec = { name: "spare-watch-1", type: "iPhone 17 Pro", watch: { name: "spare-watch-1-watch", type: "Apple Watch Series 12 (46mm)" } };
  const devices = (...sims: { name: string; udid: string }[]) => JSON.stringify({ devices: { "com.apple.CoreSimulator.SimRuntime.iOS-27-0": sims.map((x) => ({ ...x, state: "Shutdown" })) } });
  const pairs = (...ps: { watch: string; phone: string }[]) => JSON.stringify({ pairs: Object.fromEntries(ps.map((p, i) => [`pair-${i}`, { watch: { udid: p.watch }, phone: { udid: p.phone } }])) });
  const runtimes = JSON.stringify({
    runtimes: [
      { identifier: "com.apple.CoreSimulator.SimRuntime.iOS-27-0", version: "27.0", platform: "iOS", isAvailable: true },
      { identifier: "com.apple.CoreSimulator.SimRuntime.watchOS-27-0", version: "27.0", platform: "watchOS", isAvailable: true },
    ],
  });

  /** A Mac that answers each command by the first rule whose text it contains, and remembers what it was asked. */
  const scripted = (rules: readonly (readonly [string, string])[]) => {
    const asked: string[] = [];
    const ssh = async (_target: string, command: string): Promise<string> => {
      asked.push(command);
      return rules.find(([part]) => command.includes(part))?.[1] ?? "";
    };
    return { asked, hosts: makeHosts(ssh) };
  };

  it("creates a phone and its watch on the newest runtimes and pairs them", async () => {
    const { asked, hosts } = scripted([
      ["list devices", devices()],
      ["list runtimes", runtimes],
      ["create 'spare-watch-1' ", `${PHONE}\n`],
      ["create 'spare-watch-1-watch'", `${WATCH}\n`],
      ["list pairs", pairs()],
    ]);
    expect(await hosts.createSimulator(mac, spec)).toEqual({ udid: PHONE, watchUdid: WATCH });
    expect(asked.filter((c) => c.includes("create") || c.includes(" pair "))).toEqual([
      "xcrun simctl create 'spare-watch-1' 'iPhone 17 Pro' 'com.apple.CoreSimulator.SimRuntime.iOS-27-0'",
      "xcrun simctl create 'spare-watch-1-watch' 'Apple Watch Series 12 (46mm)' 'com.apple.CoreSimulator.SimRuntime.watchOS-27-0'",
      `xcrun simctl pair ${WATCH} ${PHONE}`,
    ]);
  });

  it("reuses a pair that exists, and refuses to take a watch paired with another phone", async () => {
    const whole = scripted([
      ["list devices", devices({ name: "spare-watch-1", udid: PHONE }, { name: "spare-watch-1-watch", udid: WATCH })],
      ["list pairs", pairs({ watch: WATCH, phone: PHONE })],
    ]);
    expect(await whole.hosts.createSimulator(mac, spec)).toEqual({ udid: PHONE, watchUdid: WATCH });
    expect(whole.asked.some((c) => c.includes("create") || c.includes("runtimes") || c.includes(" pair "))).toBe(false);

    const taken = scripted([
      ["list devices", devices({ name: "spare-watch-1", udid: PHONE }, { name: "spare-watch-1-watch", udid: WATCH })],
      ["list pairs", pairs({ watch: WATCH, phone: OTHER })],
    ]);
    await expect(taken.hosts.createSimulator(mac, spec)).rejects.toMatchObject({ error: { message: expect.stringMatching(new RegExp(`paired with another phone \\(${OTHER}\\)`)) } });
    expect(taken.asked.some((c) => c.includes(" pair "))).toBe(false);
  });

  it("creates a phone with no watch as before: one create, no pairs asked", async () => {
    const { asked, hosts } = scripted([
      ["list devices", devices()],
      ["list runtimes", runtimes],
      ["create", `${PHONE}\n`],
    ]);
    expect(await hosts.createSimulator(mac, { name: "spare-ipad-1", type: "iPad Pro 13-inch (M5)" })).toEqual({ udid: PHONE });
    expect(asked.some((c) => c.includes("pairs"))).toBe(false);
  });

  it("shuts down, resets and deletes the watch paired with a phone, found by the phone's UDID", async () => {
    const plist = `{ "com.example.app" = { ApplicationType = User; }; }`;
    const { asked, hosts } = scripted([
      [`listapps ${PHONE}`, `${plist}\n@@devices@@\n${pairs({ watch: WATCH, phone: PHONE })}`],
      [`listapps ${WATCH}`, plist],
      ["list pairs", pairs({ watch: WATCH, phone: PHONE }, { watch: OTHER, phone: "11111111-0000-4000-8000-000000000009" })],
    ]);
    await hosts.shutdownSimulator(mac, PHONE);
    expect(asked.splice(0)).toEqual([`xcrun simctl shutdown ${PHONE} >/dev/null 2>&1; xcrun simctl list pairs --json 2>/dev/null || echo '{}'`, `xcrun simctl shutdown ${WATCH} >/dev/null 2>&1; true`]);
    await hosts.resetSimulator(mac, PHONE);
    const reset = asked.splice(0).at(-1) ?? "";
    expect(reset).toContain(`xcrun simctl uninstall ${PHONE} 'com.example.app'`);
    expect(reset).toContain(`xcrun simctl uninstall ${WATCH} 'com.example.app'`);
    // The phone's privacy reset must succeed; the watch's is best effort.
    expect(reset).toMatch(new RegExp(`privacy ${PHONE} reset all; `));
    expect(reset).toMatch(new RegExp(`privacy ${WATCH} reset all >/dev/null 2>&1 \\|\\| true$`));
    await hosts.deleteSimulator(mac, PHONE);
    expect(asked.at(-1)).toBe(`xcrun simctl shutdown ${PHONE} >/dev/null 2>&1; xcrun simctl shutdown ${WATCH} >/dev/null 2>&1; xcrun simctl delete ${PHONE} ${WATCH}`);
  });

  it("acts on a phone with no watch in one call, as before", async () => {
    const { asked, hosts } = scripted([["list pairs", pairs()]]);
    await hosts.shutdownSimulator(mac, PHONE);
    expect(asked).toHaveLength(1);
  });
});

describe("adb host protocol", () => {
  let server: Server | undefined;
  afterEach(() => new Promise<void>((r) => (server === undefined ? r() : server.close(() => r()))));

  it("asks host:devices with a length prefix and reads the answer", async () => {
    const seen: string[] = [];
    server = createServer((socket) => {
      socket.on("data", (d) => {
        seen.push(d.toString());
        const body = "emulator-5556\tdevice\n";
        socket.end(`OKAY${body.length.toString(16).padStart(4, "0")}${body}`);
      });
    });
    await new Promise<void>((r) => server?.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as { port: number }).port;
    expect(await makeAdb().devices(port)).toEqual([{ serial: "emulator-5556", state: "device" }]);
    expect(seen).toEqual(["000chost:devices"]);
  });

  it("reads a device's boot through the transport, and says not booted on any doubt", async () => {
    const seen: string[] = [];
    server = createServer((socket) => {
      socket.on("data", (d) => {
        const text = d.toString();
        seen.push(text);
        if (text.includes("host:transport:")) socket.write("OKAY");
        else socket.end("OKAY1\n");
      });
    });
    await new Promise<void>((r) => server?.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as { port: number }).port;
    expect(await makeAdb().bootCompleted(port, "emulator-5558")).toBe(true);
    expect(seen).toEqual(["001chost:transport:emulator-5558", "0020shell:getprop sys.boot_completed"]);
    expect(await makeAdb().bootCompleted(1, "emulator-5558")).toBe(false);
  });

  it("fails, and starts nothing, when no server answers", async () => {
    server = createServer();
    await new Promise<void>((r) => server?.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as { port: number }).port;
    await new Promise<void>((r) => server?.close(() => r()));
    server = undefined;
    await expect(makeAdb().devices(port)).rejects.toThrow();
  });
});

/**
 * A stand-in for a pool slot's adbd behind its door: adb's device protocol (CNXN, OPEN, OKAY, WRTE,
 * CLSE), answering each shell command from a table, or asking for a key when told to.
 */
const fakeAdbd = (answers: Readonly<Record<string, string>>, opts: { readonly auth?: boolean } = {}) =>
  createServer((socket) => {
    let buffer = Buffer.alloc(0) as Buffer;
    socket.on("data", (chunk: Buffer) => {
      const { messages, rest } = readMessages(Buffer.concat([buffer, chunk]));
      buffer = rest;
      for (const m of messages) {
        if (m.command === 0x4e584e43) socket.write(opts.auth === true ? message(0x48545541, 1, 0, Buffer.alloc(20)) : message(0x4e584e43, 0x01000001, 4096, Buffer.from("device::\0")));
        if (m.command === 0x4e45504f) {
          const command = m.data.toString("utf8").replace(/\0$/, "").replace(/^shell:/, "");
          const out = answers[command];
          if (out === undefined) {
            socket.write(message(0x45534c43, 0, m.arg0));
            continue;
          }
          socket.write(message(0x59414b4f, 7, m.arg0));
          socket.write(message(0x45545257, 7, m.arg0, Buffer.from(out)));
          socket.write(message(0x45534c43, 7, m.arg0));
        }
      }
    });
  });

describe("a slot's door: adb's device protocol, no adb server", () => {
  let server: Server | undefined;
  afterEach(() => new Promise<void>((r) => (server === undefined ? r() : server.close(() => r()))));
  const listen = async (s: Server): Promise<number> => {
    server = s;
    await new Promise<void>((r) => s.listen(0, "127.0.0.1", () => r()));
    return (s.address() as { port: number }).port;
  };

  it("runs a shell command on the slot and reads its output", async () => {
    const port = await listen(fakeAdbd({ "getprop sys.boot_completed": "1\n" }));
    expect(await doorShell(port, "getprop sys.boot_completed")).toBe("1\n");
    expect(await makeDoor().bootCompleted(port)).toBe(true);
  });

  it("clears every third-party app's data", async () => {
    const port = await listen(fakeAdbd({ "pm list packages -3": "package:com.example.app\npackage:dev.mobile.maestro\n", "pm clear com.example.app": "Success\n", "pm clear dev.mobile.maestro": "Success\n" }));
    expect(await makeDoor().clearUserApps(port)).toBe(2);
  });

  it("refuses a device that asks for a key, and says not booted on any doubt", async () => {
    const port = await listen(fakeAdbd({}, { auth: true }));
    await expect(doorShell(port, "id")).rejects.toMatchObject({ error: { message: expect.stringMatching(/asked for a key/) } });
    expect(await makeDoor().bootCompleted(port)).toBe(false);
    expect(await makeDoor().bootCompleted(1)).toBe(false);
  });
});

describe("catalog", () => {
  const base = {
    box: "broker-1",
    profiles: { "ios-phone": "iPhone 17 Pro" },
    hosts: [{ id: "mac-1", label: "mac-1", platform: "ios", ssh: "runner@mac-1.example.com", requires_ac: true, spawn_max: 1, builders: 1 }],
    devices: [{ id: "dev-iphone", platform: "ios", host: "mac-1", profile: "ios-phone", mode: "fixed", maestro: true, simulator: { name: "dev-iphone", type: "iPhone 17 Pro" } }],
  };

  it("parses a catalog's hosts and devices", () => {
    const { catalog } = parseCatalog(JSON.stringify(base), "broker-1");
    expect(catalog.hosts[0]).toMatchObject({ id: "mac-1", requiresAc: true, spawnMax: 1, builders: 1, reserveMiB: 0 });
    expect(catalog.devices[0]?.simulator?.name).toBe("dev-iphone");
  });

  it("refuses a device on an undeclared host", () => {
    expect(() => parseCatalog(JSON.stringify({ ...base, devices: [{ ...base.devices[0], host: "mac-2" }] }), "broker-1")).toThrow();
    try {
      parseCatalog(JSON.stringify({ ...base, devices: [{ ...base.devices[0], host: "mac-2" }] }), "broker-1");
    } catch (e) {
      expect((e as { error: { message: string } }).error.message).toMatch(/names host mac-2/);
    }
  });

  it("parses emulator slots, each with the instance its host's control command starts", () => {
    const emu = { id: "emu-1", label: "emu-1", platform: "android", ssh: "builder@emu-1.example.com", spawn_max: 4, cost_mib: 6144, reserve_mib: 12288, control: "/usr/local/bin/emulator-ctl" };
    const slot = { id: "emulator-5558", platform: "android", host: "emu-1", profile: "android-phone", mode: "spawn", maestro: true, adb: { port: 5037, serial: "emulator-5558" }, instance: "phone3" };
    const profiles = { ...base.profiles, "android-phone": "API 34" };
    const { catalog } = parseCatalog(JSON.stringify({ ...base, profiles, hosts: [...base.hosts, emu], devices: [...base.devices, slot] }), "broker-1");
    expect(catalog.hosts[1]).toMatchObject({ id: "emu-1", spawnMax: 4, control: "/usr/local/bin/emulator-ctl" });
    expect(catalog.devices[1]).toMatchObject({ id: "emulator-5558", mode: "spawn", instance: "phone3" });
    const refused = (catalog: unknown): string => {
      try {
        parseCatalog(JSON.stringify(catalog), "broker-1");
      } catch (e) {
        return (e as { error: { message: string } }).error.message;
      }
      return "accepted";
    };
    const { instance: _none, ...noInstance } = slot;
    expect(refused({ ...base, profiles, hosts: [...base.hosts, emu], devices: [noInstance] })).toMatch(/spawn slot with no instance/);
    const { control: _no, ...noControl } = emu;
    expect(refused({ ...base, profiles, hosts: [...base.hosts, noControl], devices: [slot] })).toMatch(/no control command/);
    expect(refused({ ...base, profiles, hosts: [...base.hosts, emu], devices: [{ ...slot, instance: "phone3; reboot" }] })).toMatch(/has instance/);
    expect(refused({ ...base, profiles, hosts: [...base.hosts, { ...emu, control: "emulator-ctl" }], devices: [slot] })).toMatch(/not an absolute path/);
  });

  it("parses a pool slot's tenant and probe, and refuses a guest on a host that does not isolate", () => {
    const emu = { id: "emu-1", label: "emu-1", platform: "android", ssh: "builder@emu-1.example.com", spawn_max: 5, cost_mib: 6144, reserve_mib: 12288, control: "/usr/local/bin/pool-ctl", isolates: true };
    const slot = { id: "pool1", platform: "android", host: "emu-1", profile: "android-phone", mode: "spawn", maestro: true, adb: { port: 16100, serial: "127.0.0.1:16000" }, probe: { door: 16000 }, instance: "pool1" };
    const guestSlot = { ...slot, id: "acmephone", instance: "acmephone", adb: { port: 16101, serial: "127.0.0.1:16001" }, probe: "unit", tenant: "guest:acme" };
    const profiles = { ...base.profiles, "android-phone": "API 34" };
    const { catalog } = parseCatalog(JSON.stringify({ ...base, profiles, hosts: [...base.hosts, emu], devices: [...base.devices, slot, guestSlot] }), "broker-1");
    expect(catalog.hosts.map((h) => h.isolates)).toEqual([false, true]);
    expect(catalog.devices.map((d) => [d.id, d.tenant, d.probe])).toEqual([
      ["dev-iphone", "default", undefined],
      ["pool1", "default", { kind: "door", port: 16000 }],
      ["acmephone", "guest:acme", { kind: "unit" }],
    ]);
    const refused = (catalog: unknown): string => {
      try {
        parseCatalog(JSON.stringify(catalog), "broker-1");
      } catch (e) {
        return (e as { error: { message: string } }).error.message;
      }
      return "accepted";
    };
    const { isolates: _i, ...openHost } = emu;
    expect(refused({ ...base, profiles, hosts: [...base.hosts, openHost], devices: [guestSlot] })).toMatch(/does not isolate its devices: it may serve the default tenant only/);
    expect(refused({ ...base, devices: [{ ...base.devices[0], tenant: "guest:acme" }] })).toMatch(/does not isolate/);
    expect(refused({ ...base, profiles, hosts: [...base.hosts, emu], devices: [{ ...slot, tenant: "guests" }] })).toMatch(/has tenant "guests"/);
    expect(refused({ ...base, profiles, hosts: [...base.hosts, emu], devices: [slot, { ...slot, id: "pool2", instance: "pool2" }] })).toMatch(/door port 16000 is declared twice/);
  });

  it("parses an emulator slot's variants, and refuses each misuse of them", () => {
    const emu = { id: "emu-1", label: "emu-1", platform: "android", ssh: "builder@emu-1.example.com", spawn_max: 2, control: "/usr/local/bin/emulator-ctl" };
    const slot = { id: "emulator-5554", platform: "android", host: "emu-1", profile: "android-phone", mode: "spawn", adb: { port: 5037, serial: "emulator-5554" }, instance: "phone1", variants: [{ profile: "android-next", instance: "phone1next" }] };
    const other = { ...slot, id: "emulator-5556", adb: { port: 5037, serial: "emulator-5556" }, instance: "phone2", variants: undefined };
    const ok = { ...base, profiles: { ...base.profiles, "android-phone": "API 34", "android-next": "API 35" }, hosts: [...base.hosts, emu], devices: [...base.devices, slot, other] };
    const { catalog } = parseCatalog(JSON.stringify(ok), "broker-1");
    expect(catalog.devices[1]).toMatchObject({ instance: "phone1", variants: [{ profile: "android-next", instance: "phone1next" }] });
    expect(catalog.devices[2]).not.toHaveProperty("variants");
    const refused = (catalog: unknown): string => {
      try {
        parseCatalog(JSON.stringify(catalog), "broker-1");
      } catch (e) {
        return (e as { error: { message: string } }).error.message;
      }
      return "accepted";
    };
    const withVariants = (variants: unknown, change: object = {}) => ({ ...ok, devices: [...base.devices, { ...slot, ...change, variants }, other] });
    // Only on an emulator slot the broker starts: android, spawn, with an instance.
    expect(refused({ ...ok, devices: [{ ...base.devices[0], variants: slot.variants }] })).toMatch(/device dev-iphone has variants but is not a slot the broker starts/);
    expect(refused(withVariants(slot.variants, { mode: "fixed", instance: undefined }))).toMatch(/device emulator-5554 has variants but is not a slot the broker starts/);
    // Each variant's profile declared, and its instance a name the control command takes.
    expect(refused(withVariants([{ profile: "android-16", instance: "devsixteen" }]))).toMatch(/emulator-5554 has a variant of profile android-16, which is not declared/);
    expect(refused(withVariants([{ profile: "android-next", instance: "phone1 next" }]))).toMatch(/emulator-5554 has variant instance "phone1 next", not/);
    // Instances unique per host, across devices and variants.
    expect(refused(withVariants([{ profile: "android-next", instance: "phone2" }]))).toMatch(/instance emu-1\/phone2 is declared twice/);
    expect(refused(withVariants([{ profile: "android-next", instance: "phone1" }]))).toMatch(/instance emu-1\/phone1 is declared twice/);
    // A slot's profiles distinct: from its own, and from each other.
    expect(refused(withVariants([{ profile: "android-phone", instance: "phone1next" }]))).toMatch(/emulator-5554 serves profile android-phone twice/);
    expect(refused(withVariants([{ profile: "android-next", instance: "phone1next" }, { profile: "android-next", instance: "phone1next2" }]))).toMatch(/emulator-5554 serves profile android-next twice/);
  });

  it("parses desktops, a Mac's session and a Windows VM, and refuses each misuse of them", () => {
    const emu = { id: "emu-1", label: "emu-1", platform: "android", ssh: "builder@emu-1.example.com", spawn_max: 5, cost_mib: 6144, reserve_mib: 12288, control: "/usr/local/bin/emulator-ctl" };
    const mac = { id: "mac-desktop", platform: "macos", host: "mac-1", profile: "mac-desktop", mode: "fixed", ssh: { target: "runner@mac-1.example.com" } };
    const vm = {
      id: "windows-1",
      platform: "windows",
      host: "emu-1",
      profile: "windows-11",
      mode: "spawn",
      probe: "unit",
      instance: "win1",
      ssh: { target: "tester@127.0.0.1", port: 2222, jump: "builder@emu-1.example.com" },
      cost_mib: 16384,
    };
    const ok = { ...base, profiles: { ...base.profiles, "mac-desktop": "a desktop", "windows-11": "Windows 11" }, hosts: [...base.hosts, emu], devices: [...base.devices, mac, vm] };
    const { catalog } = parseCatalog(JSON.stringify(ok), "broker-1");
    expect(catalog.devices[1]).toMatchObject({ id: "mac-desktop", platform: "macos", ssh: { target: "runner@mac-1.example.com" } });
    expect(catalog.devices[1]).not.toHaveProperty("costMiB");
    expect(catalog.devices[2]).toMatchObject({ id: "windows-1", ssh: { target: "tester@127.0.0.1", port: 2222, jump: "builder@emu-1.example.com" }, costMiB: 16384, probe: { kind: "unit" } });
    const refused = (change: { mac?: object; vm?: object }): string => {
      try {
        parseCatalog(JSON.stringify({ ...ok, devices: [...base.devices, { ...mac, ...change.mac }, { ...vm, ...change.vm }] }), "broker-1");
      } catch (e) {
        return (e as { error: { message: string } }).error.message;
      }
      return "accepted";
    };
    expect(refused({ mac: { ssh: undefined } })).toMatch(/macos device mac-desktop has no ssh address/);
    expect(refused({ mac: { mode: "spawn" } })).toMatch(/mac-desktop is a spawn slot: a Mac's desktop session is fixed/);
    expect(refused({ mac: { host: "emu-1" } })).toMatch(/mac-desktop is on emu-1, which is not a Mac/);
    expect(refused({ vm: { probe: undefined } })).toMatch(/windows-1 is a spawn slot without probe "unit"/);
    expect(refused({ vm: { host: "mac-1" } })).toMatch(/windows-1 is started on mac-1, whose probe does not read the control command/);
    expect(refused({ vm: { instance: undefined, probe: undefined } })).toMatch(/windows device windows-1 is a spawn slot with no instance/);
    expect(refused({ mac: { cost_mib: 1024 } })).toMatch(/mac-desktop has a cost but is not a spawn slot/);
    // A phone has no ssh address of its own: its host's tooling reaches it.
    expect(
      (() => {
        try {
          parseCatalog(JSON.stringify({ ...ok, devices: [{ ...base.devices[0], ssh: { target: "runner@mac-1.example.com" } }] }), "broker-1");
        } catch (e) {
          return (e as { error: { message: string } }).error.message;
        }
        return "accepted";
      })(),
    ).toMatch(/dev-iphone has an ssh address but is not a desktop/);
  });

  it("names the box from the caller when the catalog does not, and reads the deployment's clients", () => {
    const { catalog } = parseCatalog(JSON.stringify({ ...base, box: undefined, session_hint: "the output of `show-session-id`", wrappers: { ios: ["sim-run"] } }), "broker-9");
    expect(catalog.box).toBe("broker-9");
    expect(catalog.clients).toEqual({ sessionHint: "the output of `show-session-id`", wrappers: { ios: ["sim-run"], android: [], macos: [], windows: [] } });
    expect(parseCatalog(JSON.stringify(base), "broker-9").catalog.clients).toEqual({ wrappers: { ios: [], android: [], macos: [], windows: [] } });
  });

  it("refuses a tenant name it does not know", () => {
    expect(() => parseCatalog(JSON.stringify({ ...base, devices: [{ ...base.devices[0], tenant: "staff" }] }), "broker-1")).toThrow();
  });

  it("starts with nothing configured when no catalog is named, and reports a named one it cannot read or use", async () => {
    expect(await loadCatalog(undefined, "broker-1")).toMatchObject({ catalog: { hosts: [] }, note: expect.stringMatching(/nothing is configured.*DEVICES_CATALOG_FILE is unset/) });
    const missing = await loadCatalog("/nonexistent/devices-catalog.json", "broker-1");
    expect(missing).toMatchObject({ catalog: { hosts: [] }, problem: expect.stringMatching(/\/nonexistent\/devices-catalog.json cannot be read/) });
    expect(missing).not.toHaveProperty("note");
  });

  it("parses a default profile per platform and a phone's paired watch, and refuses either when it cannot hold", () => {
    const profiles = { ...base.profiles, "ios-watch": "iPhone 17 Pro with an Apple Watch" };
    const pair = { id: "spare-watch-1", platform: "ios", host: "mac-1", profile: "ios-watch", mode: "spawn", maestro: true, simulator: { name: "spare-watch-1", type: "iPhone 17 Pro", watch: { name: "spare-watch-1-watch", type: "Apple Watch Series 12 (46mm)" } } };
    const ok = { ...base, profiles, default_profiles: { ios: "ios-phone" }, devices: [...base.devices, pair] };
    const { catalog } = parseCatalog(JSON.stringify(ok), "broker-1");
    expect(catalog.defaultProfiles).toEqual({ ios: "ios-phone" });
    expect(catalog.devices[1]?.simulator).toEqual({ name: "spare-watch-1", type: "iPhone 17 Pro", watch: { name: "spare-watch-1-watch", type: "Apple Watch Series 12 (46mm)" } });
    expect(parseCatalog(JSON.stringify(base), "broker-1").catalog.defaultProfiles).toEqual({});
    const refused = (c: unknown): string => {
      try {
        parseCatalog(JSON.stringify(c), "broker-1");
      } catch (e) {
        return (e as { error: { message: string } }).error.message;
      }
      return "accepted";
    };
    expect(refused({ ...ok, default_profiles: { ios: "ios-tablet" } })).toMatch(/the default ios profile ios-tablet is not declared/);
    expect(refused({ ...ok, default_profiles: { ios: "ios-watch" }, devices: [base.devices[0]] })).toMatch(/no ios device serves the default ios profile ios-watch/);
    expect(refused({ ...ok, default_profiles: { tvos: "ios-phone" } })).toMatch(/does not validate/);
    expect(refused({ ...ok, devices: [base.devices[0], { ...pair, mode: "fixed" }] })).toMatch(/spare-watch-1 has a watch but is not a spawn slot/);
    expect(refused({ ...ok, devices: [base.devices[0], { ...pair, simulator: { ...pair.simulator, watch: { name: "dev-iphone", type: "Apple Watch Series 12 (46mm)" } } }] })).toMatch(/simulator mac-1\/dev-iphone is declared twice/);
  });

  it("carries the note of a box without devices", () => {
    expect(parseCatalog(JSON.stringify({ box: "broker-2", note: "devices are brokered on broker-1" }), "broker-1")).toMatchObject({ note: "devices are brokered on broker-1", catalog: { hosts: [] } });
  });
});

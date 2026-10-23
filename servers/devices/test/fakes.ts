/**
 * A broker against an in-memory world: four emulator slots on a Linux host, started and stopped
 * through the host's control command, a phone1 simulator and one spawn slot on a Mac. No ssh, no adb,
 * no files. Every name, address and id here is invented.
 */
import type { AndroidHostProbe, Deps, MacProbe, SimulatorSeen } from "../src/app/ports.js";
import { makeBroker, type AcquireInput, type Broker } from "../src/app/broker.js";
import { DEFAULT_TENANT, instancesOf, type Catalog, type Device, type Tenant } from "../src/domain/catalog.js";
import { fail, hostError } from "../src/domain/errors.js";
import type { BrokerState } from "../src/domain/state.js";

/** The Linux host's emulators: instances phone1..phone4 on console ports 5554..5560, on one adb server forwarded to the broker. */
export const EMULATORS = ["phone1", "phone2", "phone3", "phone4"] as const;
export const serialOf = (instance: string): string => `emulator-${5554 + 2 * EMULATORS.indexOf(instance as (typeof EMULATORS)[number])}`;

const emulator = (instance: string): Device => ({
  id: serialOf(instance),
  platform: "android",
  host: "emu-1",
  profile: "android-phone",
  mode: "spawn",
  maestro: true,
  adb: { port: 5037, serial: serialOf(instance) },
  tenant: DEFAULT_TENANT,
  instance,
});

export const CATALOG: Catalog = {
  box: "broker-1",
  profiles: { "android-phone": "API 34, 1080x2400", "ios-phone": "iPhone 17 Pro" },
  defaultProfiles: {},
  forms: {},
  clients: { sessionHint: "the output of `show-session-id`", wrappers: { ios: ["sim-run"], android: ["apk-run", "flow-run"], macos: [], windows: [], batocera: [] } },
  hosts: [
    {
      id: "emu-1",
      label: "emu-1",
      platform: "android",
      ssh: "builder@emu-1.example.com",
      requiresAc: false,
      spawnMax: 4,
      costMiB: 6144,
      reserveMiB: 12288,
      builders: 1,
      control: "/usr/local/bin/emulator-ctl",
      isolates: false,
    },
    { id: "mac-1", label: "mac-1", platform: "ios", ssh: "runner@mac-1.example.com", requiresAc: true, spawnMax: 1, costMiB: 0, reserveMiB: 0, builders: 1, isolates: false },
  ],
  devices: [
    ...EMULATORS.map(emulator),
    { id: "dev-iphone", platform: "ios", host: "mac-1", profile: "ios-phone", mode: "fixed", maestro: true, tenant: DEFAULT_TENANT, simulator: { name: "dev-iphone", type: "iPhone 17 Pro" } },
    { id: "spare-iphone-1", platform: "ios", host: "mac-1", profile: "ios-phone", mode: "spawn", maestro: true, tenant: DEFAULT_TENANT, simulator: { name: "spare-iphone-1", type: "iPhone 17 Pro" } },
    { id: "ci-iphone", platform: "ios", host: "mac-1", profile: "ios-phone", mode: "reserved", maestro: false, tenant: DEFAULT_TENANT, simulator: { name: "ci-iphone", type: "iPhone 17 Pro" }, note: "CI's" },
  ],
};

/**
 * A pool on the same host: four slots of the default tenant, read through their own doors on the
 * broker's loopback, and a guest's slot whose door is the guest's alone, read by its state from the
 * control command. The Mac as above: it does not isolate, so it serves the default tenant only.
 */
export const GUEST: Tenant = "guest:acme";
const slot = (id: string, n: number, tenant: Tenant = DEFAULT_TENANT): Device => ({
  id,
  platform: "android",
  host: "emu-1",
  profile: "android-phone",
  mode: "spawn",
  maestro: true,
  adb: { port: 16100 + n, serial: `127.0.0.1:${16000 + n}` },
  probe: tenant === DEFAULT_TENANT ? { kind: "door", port: 16000 + n } : { kind: "unit" },
  tenant,
  instance: id,
});
export const POOL: Catalog = {
  ...CATALOG,
  hosts: CATALOG.hosts.map((h) => (h.id === "emu-1" ? { ...h, spawnMax: 5, isolates: true, control: "/usr/local/bin/pool-ctl" } : h)),
  devices: [slot("pool1", 0), slot("acmephone", 1, GUEST), slot("pool2", 2), slot("pool3", 3), slot("pool4", 4), ...CATALOG.devices.filter((d) => d.platform === "ios")],
};
export const POOL_SLOTS = ["pool1", "acmephone", "pool2", "pool3", "pool4"] as const;

/**
 * A second system image on one slot: in CATALOG, the first slot (phone1, on emulator-5554) also runs as phone1next;
 * in POOL, the guest's slot (read through its unit) also runs as acmenext. Each on its slot's serial and ports.
 */
const NEXT = "android-next";
const withVariant = (catalog: Catalog, id: string, instance: string): Catalog => ({
  ...catalog,
  profiles: { ...catalog.profiles, [NEXT]: "API 35, 1080x2400" },
  devices: catalog.devices.map((d) => (d.id === id ? { ...d, variants: [{ profile: NEXT, instance }] } : d)),
});
export const VARIANTS: Catalog = withVariant(CATALOG, "emulator-5554", "phone1next");
export const VARIANT_INSTANCES = [...EMULATORS, "phone1next"] as const;
export const POOL_VARIANTS: Catalog = withVariant(POOL, "acmephone", "acmenext");
export const POOL_VARIANT_SLOTS = [...POOL_SLOTS, "acmenext"] as const;

/** A Wear OS watch on phone4's slot (phone4watch), a form of its own: a session may hold it beside a phone. */
export const WATCH: Catalog = {
  ...VARIANTS,
  profiles: { ...VARIANTS.profiles, "wear-os": "Wear OS, round" },
  forms: { "wear-os": "watch" },
  devices: VARIANTS.devices.map((d) => (d.id === serialOf("phone4") ? { ...d, variants: [{ profile: "wear-os", instance: "phone4watch" }] } : d)),
};
export const WATCH_INSTANCES = [...VARIANT_INSTANCES, "phone4watch"] as const;

/**
 * Desktops beside the phones: the Mac's own desktop session (there while its ssh account is logged in),
 * and a Windows VM on the Linux host, started through its control command like an emulator, read by its
 * unit, reached over ssh through the host, and costing more memory than an emulator.
 */
export const VM = "win1";
export const DESKTOPS: Catalog = {
  ...CATALOG,
  profiles: { ...CATALOG.profiles, "mac-desktop": "the Mac's desktop session", "windows-11": "Windows 11, 8 GiB" },
  clients: { ...CATALOG.clients, wrappers: { ...CATALOG.clients.wrappers, macos: ["mac-run"], windows: ["win-run"] } },
  hosts: CATALOG.hosts.map((h) => (h.id === "emu-1" ? { ...h, spawnMax: 5 } : h)),
  devices: [
    ...CATALOG.devices,
    { id: "mac-desktop", platform: "macos", host: "mac-1", profile: "mac-desktop", mode: "fixed", maestro: false, tenant: DEFAULT_TENANT, ssh: { target: "runner@mac-1.example.com" } },
    {
      id: "windows-1",
      platform: "windows",
      host: "emu-1",
      profile: "windows-11",
      mode: "spawn",
      maestro: false,
      probe: { kind: "unit" },
      tenant: DEFAULT_TENANT,
      instance: VM,
      ssh: { target: "tester@127.0.0.1", port: 2222, jump: "builder@emu-1.example.com" },
      costMiB: 16384,
    },
  ],
};
export const DESKTOP_INSTANCES = [...EMULATORS, VM] as const;

/**
 * A Batocera box on the Linux host, mechanically a VM like windows-1 (started through the control command,
 * read by its unit, reached over ssh through the host, at its own memory cost), with an ephemeral mode as
 * its own profile and instance, and a command that writes a PNG of its screen to stdout.
 */
export const BOX = "bato1";
export const BOX_EPHEMERAL = "bato1eph";
export const SCREENSHOT = "grab-screen --format png";
export const BATOCERA: Catalog = {
  ...CATALOG,
  profiles: { ...CATALOG.profiles, batocera: "Batocera, stock image", "batocera-ephemeral": "Batocera, nothing kept on disk" },
  hosts: CATALOG.hosts.map((h) => (h.id === "emu-1" ? { ...h, spawnMax: 5 } : h)),
  devices: [
    ...CATALOG.devices,
    {
      id: "batocera-1",
      platform: "batocera",
      host: "emu-1",
      profile: "batocera",
      mode: "spawn",
      maestro: false,
      probe: { kind: "unit" },
      tenant: DEFAULT_TENANT,
      instance: BOX,
      variants: [{ profile: "batocera-ephemeral", instance: BOX_EPHEMERAL }],
      ssh: { target: "root@127.0.0.1", port: 2223, jump: "builder@emu-1.example.com" },
      screenshot: SCREENSHOT,
      costMiB: 4096,
    },
  ],
};
export const BATOCERA_INSTANCES = [...EMULATORS, BOX, BOX_EPHEMERAL] as const;

/**
 * The Mac's other spares: a tablet and a phone with a paired watch, each on a profile of its own that a
 * request must name, since `ios-phone` is what a request that names none gets. `spawnMax` is the Mac's.
 */
export const GEAR = (spawnMax = 1): Catalog => ({
  ...CATALOG,
  profiles: { ...CATALOG.profiles, "ios-tablet": "iPad Pro 13-inch", "ios-watch": "iPhone 17 Pro with an Apple Watch" },
  defaultProfiles: { ios: "ios-phone" },
  forms: {},
  hosts: CATALOG.hosts.map((h) => (h.id === "mac-1" ? { ...h, spawnMax } : h)),
  devices: [
    ...CATALOG.devices,
    { id: "spare-ipad-1", platform: "ios", host: "mac-1", profile: "ios-tablet", mode: "spawn", maestro: true, tenant: DEFAULT_TENANT, simulator: { name: "spare-ipad-1", type: "iPad Pro 13-inch (M5)" } },
    {
      id: "spare-watch-1",
      platform: "ios",
      host: "mac-1",
      profile: "ios-watch",
      mode: "spawn",
      maestro: true,
      tenant: DEFAULT_TENANT,
      simulator: { name: "spare-watch-1", type: "iPhone 17 Pro", watch: { name: "spare-watch-1-watch", type: "Apple Watch Series 12 (46mm)" } },
    },
  ],
});

/** What an emulator instance is doing: stopped, booting (adb lists it offline), or a booted device. */
export type EmulatorState = "stopped" | "booting" | "device";

export type World = {
  android: AndroidHostProbe | "down";
  mac: Omit<MacProbe, "simulators"> | "down";
  simulators: SimulatorSeen[];
  /** Watches paired with phones, by UDID. */
  pairs: { watch: string; phone: string }[];
  emulators: Record<string, EmulatorState>;
  /** A start the control command refuses, e.g. the service behind it missing. */
  startFails: boolean;
  /** Holds every stop until it resolves: a stop takes a while (the snapshot is saved). */
  stopGate: Promise<void> | undefined;
  calls: string[];
  saved: BrokerState | undefined;
  clock: number;
};

export const makeWorld = (instances: readonly string[] = EMULATORS): World => ({
  android: { memAvailableMiB: 40_000, load: 1 },
  mac: { onAc: true, ciBusy: false, load: 2, desktop: false },
  simulators: [{ name: "dev-iphone", udid: "11111111-2222-4333-8444-555555555555", state: "Shutdown" }],
  pairs: [],
  emulators: Object.fromEntries(instances.map((i) => [i, "stopped"])),
  startFails: false,
  stopGate: undefined,
  calls: [],
  saved: undefined,
  clock: 1_790_000_000_000,
});

/** Every emulator that is booting finishes its boot. */
export const bootAll = (world: World): void => {
  for (const [i, st] of Object.entries(world.emulators)) if (st === "booting") world.emulators[i] = "device";
};

/** What the control command's `status` says of each instance. */
const unitStates = (world: World): Record<string, string> =>
  Object.fromEntries(Object.entries(world.emulators).map(([i, st]) => [i, st === "stopped" ? "inactive" : st === "booting" ? "activating" : "active"]));

/** The serial an instance runs on: its slot's, whichever of the slot's variants it is. */
const serialIn = (catalog: Catalog, instance: string): string => catalog.devices.find((d) => instancesOf(d).includes(instance))?.adb?.serial ?? serialOf(instance);

export const depsFor = (world: World, catalog: Catalog = CATALOG): Deps => ({
  catalog,
  hosts: {
    probeAndroid: async () => (world.android === "down" ? fail(hostError("builder@emu-1.example.com", "exit 255: timed out")) : { ...world.android, emulators: unitStates(world) }),
    probeMac: async () => (world.mac === "down" ? fail(hostError("runner@mac-1.example.com", "exit 255: timed out")) : { ...world.mac, simulators: [...world.simulators] }),
    // As the Mac does it: a simulator of the name is reused, a missing one created (UDIDs ...0001, ...0002 in
    // order of creation), and a watch paired with its phone unless it already is.
    createSimulator: async (_host, spec) => {
      const made = (name: string): string => {
        const seen = world.simulators.find((x) => x.name === name);
        if (seen !== undefined) return seen.udid;
        world.calls.push(`create ${name}`);
        const udid = `AAAAAAAA-0000-0000-0000-${String(world.simulators.filter((x) => x.udid.startsWith("AAAAAAAA")).length + 1).padStart(12, "0")}`;
        world.simulators.push({ name, udid, state: "Shutdown" });
        return udid;
      };
      const udid = made(spec.name);
      if (spec.watch === undefined) return { udid };
      const watchUdid = made(spec.watch.name);
      if (!world.pairs.some((p) => p.watch === watchUdid && p.phone === udid)) {
        world.calls.push(`pair ${spec.watch.name} ${spec.name}`);
        world.pairs.push({ watch: watchUdid, phone: udid });
      }
      return { udid, watchUdid };
    },
    shutdownSimulator: async (_host, udid) => void world.calls.push(`shutdown ${udid}`),
    resetSimulator: async (_host, udid) => void world.calls.push(`reset ${udid}`),
    deleteSimulator: async (_host, udid) => void world.calls.push(`delete ${udid}`),
    startEmulator: async (_host, instance) => {
      if (world.startFails) return fail(hostError("emu-1", "emulator-ctl: no answer from its service"));
      world.calls.push(`start ${instance}`);
      if (world.emulators[instance] === "stopped") world.emulators[instance] = "booting";
    },
    stopEmulator: async (_host, instance) => {
      world.calls.push(`stop ${instance}`);
      await world.stopGate;
      world.emulators[instance] = "stopped";
    },
    emulatorStates: async () => (world.android === "down" ? fail(hostError("builder@emu-1.example.com", "exit 255: timed out")) : unitStates(world)),
  },
  // A slot's door answers only while its emulator (any of its variants) runs, and says booted once it has.
  door: {
    bootCompleted: async (port) => {
      const d = catalog.devices.find((x) => x.probe?.kind === "door" && x.probe.port === port);
      return d !== undefined && instancesOf(d).some((i) => world.emulators[i] === "device");
    },
    clearUserApps: async (port) => {
      world.calls.push(`clear door ${port}`);
      return 1;
    },
  },
  adb: {
    devices: async () =>
      Object.entries(world.emulators)
        .filter(([, st]) => st !== "stopped")
        .map(([i, st]) => ({ serial: serialIn(catalog, i), state: st === "device" ? "device" : "offline" })),
    bootCompleted: async (_port, serial) => Object.entries(world.emulators).some(([i, st]) => serialIn(catalog, i) === serial && st === "device"),
    clearUserApps: async (_port, serial) => {
      world.calls.push(`clear ${serial}`);
      return 1;
    },
  },
  store: {
    load: async () => world.saved,
    save: async (s) => {
      world.saved = s;
    },
  },
  now: () => world.clock,
  sleep: async (ms) => {
    world.clock += ms;
  },
  log: () => undefined,
});

/** The broker as one tenant calls it: every use case with that caller's tenant filled in, as the MCP layer does. */
export const as = (broker: Broker, tenant: Tenant) => ({
  acquire: (i: Omit<AcquireInput, "tenant">) => broker.acquire({ ...i, tenant }),
  wait: (i: Omit<Parameters<Broker["wait"]>[0], "tenant">) => broker.wait({ ...i, tenant }),
  renew: (i: Omit<Parameters<Broker["renew"]>[0], "tenant">) => broker.renew({ ...i, tenant }),
  pause: (i: Omit<Parameters<Broker["pause"]>[0], "tenant">) => broker.pause({ ...i, tenant }),
  resume: (i: Omit<Parameters<Broker["resume"]>[0], "tenant">) => broker.resume({ ...i, tenant }),
  release: (i: Omit<Parameters<Broker["release"]>[0], "tenant">) => broker.release({ ...i, tenant }),
  report: (i: Omit<Parameters<Broker["report"]>[0], "tenant">) => broker.report({ ...i, tenant }),
  clear: (i: Omit<Parameters<Broker["clear"]>[0], "tenant">) => broker.clear({ ...i, tenant }),
  status: (i: { readonly session?: string }) => broker.status({ ...i, tenant }),
  healthCheck: () => broker.healthCheck(tenant),
  tick: broker.tick,
  state: broker.state,
});

export const rawBrokerFor = (world: World, catalog: Catalog = CATALOG): Broker => makeBroker(depsFor(world, catalog));

/** The broker as the default tenant calls it. */
export const brokerFor = (world: World, catalog: Catalog = CATALOG) => as(rawBrokerFor(world, catalog), DEFAULT_TENANT);

/** Lets the after-lease work (reset, shutdown, stop) that runs in the background finish. */
export const settled = () => new Promise((r) => setTimeout(r, 10));

/**
 * What may exist, as the deployment's catalog file declares it: the hosts that
 * carry phones or builds, the devices on them, and the profiles an agent can
 * ask for. Nothing here says who holds what; that is the broker's state.
 */

/**
 * What a device is: a phone (an iOS simulator, an Android emulator), a desktop (a Mac's desktop
 * session, a Windows machine) or a console (a Batocera retro-gaming box). A phone is reached through
 * its host's tooling; every other device over ssh, at an address of its own.
 */
export type Platform = "ios" | "android" | "macos" | "windows" | "batocera";

export const PLATFORMS: readonly Platform[] = ["ios", "android", "macos", "windows", "batocera"];

/** The platforms whose devices their holder reaches over ssh, each at its own address, on whatever host carries it. */
export type SshPlatform = "macos" | "windows" | "batocera";

export const SSH_PLATFORMS: readonly SshPlatform[] = ["macos", "windows", "batocera"];

export const reachedOverSsh = (p: Platform): p is SshPlatform => (SSH_PLATFORMS as readonly Platform[]).includes(p);

/**
 * Whom a device serves: `default` (the deployment's own agents) or `guest:<id>` (another workspace). A
 * caller's tenant comes from its token (domain/tenant.ts), never from what it claims, and it sees,
 * leases, releases, reports and clears only its own tenant's devices.
 */
export type Tenant = string;

export const DEFAULT_TENANT: Tenant = "default";

/** A guest's id: what follows `guest-` in its token's client label, and `guest:` in its tenant. */
export const GUEST_ID = /^[a-z][a-z0-9]{1,15}$/;

/** A tenant name a catalog may use: the default tenant, or a guest by its id. */
export const TENANT = new RegExp(`^(default|guest:${GUEST_ID.source.slice(1, -1)})$`);

export type Host = {
  /** Stable id, used in builder names and in status: "linux-1", "mac-1". */
  readonly id: string;
  readonly label: string;
  /**
   * The platform its phones and builds are for, which also decides how it is probed: `ios` (a Mac:
   * simulators, power, a desktop session) or `android` (a Linux host: memory, its control command).
   * A device reached over ssh may sit on either.
   */
  readonly platform: Platform;
  /** The ssh target the broker reaches it at (`user@host`), with no password prompt. */
  readonly ssh: string;
  /** A laptop: nothing is spawned and nothing is built on it while it runs on battery. */
  readonly requiresAc: boolean;
  /** How many spawned devices may run on it at once. */
  readonly spawnMax: number;
  /** What one spawned device costs, for the memory check (MiB; 0 = no check). */
  readonly costMiB: number;
  /** MemAvailable that must remain after a spawn (MiB; 0 = no check). */
  readonly reserveMiB: number;
  /** Build slots; 0 means the host builds nothing through the broker. */
  readonly builders: number;
  /**
   * The command on the host that starts and stops its emulators, run over ssh as
   * `<control> start|stop <instance>`, and as `<control> status` (one `<instance> <state>` line each)
   * by every probe. The README states the contract; the broker's ssh account needs no other privilege.
   */
  readonly control?: string;
  /**
   * Whether a device on this host is isolated from the host and from every other device on it (a uid
   * and a network namespace each, say). A host that does not isolate (a Mac simulator runs with the
   * Mac's network and identity) serves the default tenant only.
   */
  readonly isolates: boolean;
};

/**
 * How an Android device is addressed by its HOLDER: an adb server port and a serial on it, where the
 * holder's tools run (the broker's machine for the default tenant, a guest's own machine for a guest).
 * The broker never dials it for a device with a probe (below): for a guest slot it names the guest's side.
 */
export type AdbAddress = {
  readonly port: number;
  readonly serial: string;
};

/**
 * How the BROKER tells that an emulator it started has booted, and resets one after a dirty lease:
 *   - `door`: the slot's own adbd, on this port of the broker's loopback (a tunnel to that one device):
 *     `sys.boot_completed` through the same path its holder uses, and `pm clear` through it.
 *   - `unit`: the host's control command reports the instance `active`, which it must do only once the
 *     device has booted. For a slot whose door the broker cannot reach.
 *   - absent: the adb server on the broker's loopback at `adb.port` (emulators on a shared adb server).
 */
export type Probe = { readonly kind: "door"; readonly port: number } | { readonly kind: "unit" };

/**
 * How a device of an SSH_PLATFORMS platform (a desktop, a Batocera box) is reached by its HOLDER: an ssh
 * destination (`user@host`), its port when not 22, and a host to jump through when the machine is only
 * reachable from there (a VM on its host's loopback).
 */
export type SshAddress = {
  readonly target: string;
  readonly port?: number;
  readonly jump?: string;
};

/** A watch simulator paired with a phone simulator, e.g. "Apple Watch Series 12 (46mm)". */
export type WatchSpec = {
  readonly name: string;
  readonly type: string;
};

/** How an iOS simulator is named and, for a spawned one, made. */
export type SimulatorSpec = {
  readonly name: string;
  /** The device type `simctl create` takes, e.g. "iPhone 17 Pro". */
  readonly type: string;
  /**
   * A watch the broker creates beside it on the newest watchOS runtime and pairs with it (`simctl pair`):
   * one device to its holder, shut down, reset and deleted with the phone.
   */
  readonly watch?: WatchSpec;
};

/** Another system image on an emulator slot: its own instance, on the slot's serial, adb port and probe. */
export type SlotVariant = { readonly profile: string; readonly instance: string };

/** What a device runs for a lease: a profile, and on an emulator slot the instance that is it. */
export type Variant = { readonly profile: string; readonly instance?: string };

export type DeviceMode =
  /** Exists and stays; leased as it is. */
  | "fixed"
  /** A declared slot the broker starts on demand and stops after use: an emulator, a spare simulator. */
  | "spawn"
  /** Known, so status can show it, and never leased. */
  | "reserved";

export type Device = {
  /** Stable id: the serial, the simulator's name, "pool-<entry>". */
  readonly id: string;
  readonly platform: Platform;
  readonly host: string;
  readonly profile: string;
  readonly mode: DeviceMode;
  /** Whether a Maestro flow can drive it, as the catalog says. */
  readonly maestro: boolean;
  readonly adb?: AdbAddress;
  /** How the broker reads its boot and resets it, when not through the adb server at `adb.port`. */
  readonly probe?: Probe;
  /** Whom it serves. */
  readonly tenant: Tenant;
  /**
   * A started slot's instance (an emulator's AVD, a VM), which the host's control command starts and
   * stops: its default variant.
   */
  readonly instance?: string;
  /**
   * An emulator slot's other system images: each another instance on the same serial, adb port and probe,
   * started instead of `instance` for a lease that asks for its profile. Only one of a slot's instances runs at a time.
   */
  readonly variants?: readonly SlotVariant[];
  readonly simulator?: SimulatorSpec;
  /** Where its holder reaches it over ssh. Required for the SSH_PLATFORMS, and only for them. */
  readonly ssh?: SshAddress;
  /**
   * A device reached over ssh: one line its holder runs on it, over `ssh`, that writes a PNG of its screen
   * to stdout. The catalog's, never the broker's: what grabs a screen depends on what the device runs.
   */
  readonly screenshot?: string;
  /** A spawn slot that costs its host more or less than the host's `costMiB` (a VM beside emulators). */
  readonly costMiB?: number;
  /** One line shown in status: why it is reserved, what it is for. */
  readonly note?: string;
};

/**
 * What the deployment tells its agents about its own clients, for tool descriptions and answers only:
 * where a session finds its id, and the commands that take and renew a lease for their user.
 */
export type Clients = {
  /** Where an agent on this deployment finds its session id, e.g. "the output of `show-session-id`". */
  readonly sessionHint?: string;
  /** Commands that use a lease of that platform and acquire one when their session holds none. */
  readonly wrappers: Readonly<Record<Platform, readonly string[]>>;
};

export type Catalog = {
  /** The machine this broker runs on, named in status. */
  readonly box: string;
  readonly hosts: readonly Host[];
  readonly devices: readonly Device[];
  /** Profile -> what it is, e.g. "ios-phone" -> "iPhone 17 Pro, newest runtime, 402x874 pt". */
  readonly profiles: Readonly<Record<string, string>>;
  /**
   * The profile a request that names none gets, per platform. A device on any other profile (a tablet, a
   * phone with a watch) is then handed only to a request that asks for it by name, so a wrapper that asks
   * for "a phone" never lands on one. A platform with none here: any of its devices, on its own profile.
   */
  readonly defaultProfiles: Readonly<Partial<Record<Platform, string>>>;
  /**
   * Profile -> its form, for a profile that is not its platform's usual device: "watch" for a Wear OS
   * watch. A session holds one device per platform and form, so a phone and the watch it pairs with
   * are leased together; a profile not named here is the usual device.
   */
  readonly forms: Readonly<Record<string, string>>;
  readonly clients: Clients;
};

export const NO_CLIENTS: Clients = { wrappers: { ios: [], android: [], macos: [], windows: [], batocera: [] } };

/** A catalog with nothing in it: the broker answers, and every request is unavailable with this reason. */
export const emptyCatalog = (box: string): Catalog => ({ box, hosts: [], devices: [], profiles: {}, defaultProfiles: {}, forms: {}, clients: NO_CLIENTS });

/** The form of a profile: the catalog's word for it, else the platform's usual device. */
export const USUAL_FORM = "usual";
export const formOf = (catalog: Catalog, profile: string | undefined): string => (profile === undefined ? undefined : catalog.forms[profile]) ?? USUAL_FORM;

/** The profile a request for this platform asks for: its own, else the platform's default, if the catalog names one. */
export const profileWanted = (catalog: Catalog, platform: Platform, profile: string | undefined): string | undefined => profile ?? catalog.defaultProfiles[platform];

/** Every wrapper the catalog names, every platform, each once. */
export const allWrappers = (clients: Clients): readonly string[] => [...new Set(PLATFORMS.flatMap((p) => clients.wrappers[p]))];

/** The builder resource on a host: one name per host, its slots counted by leases. */
export const builderId = (platform: Platform, host: string): string => `builder:${platform}@${host}`;

export const hostOf = (catalog: Catalog, id: string): Host | undefined => catalog.hosts.find((h) => h.id === id);

export const deviceOf = (catalog: Catalog, id: string): Device | undefined => catalog.devices.find((d) => d.id === id);

/** The platforms whose spawn slots the host's control command starts and stops: emulators and VMs. */
const STARTED: readonly Platform[] = ["android", "windows", "batocera"];

/**
 * The platforms whose spawn slots are VMs: no adb, so a boot is read from the unit, through a host whose
 * probe reads the control command. A Batocera box is one whose stop throws it away (the README's contract).
 */
const VMS: readonly Platform[] = ["windows", "batocera"];

/**
 * A slot the broker starts through its host's control command for a lease and stops after it: a spawned
 * Android emulator, Windows VM or Batocera box with an instance.
 */
export const isStartedSlot = (d: Device): boolean => STARTED.includes(d.platform) && d.mode === "spawn" && d.instance !== undefined;

/** What one spawn of this device costs its host's memory: its own cost, else the host's. */
export const costOf = (d: Device, host: Host): number => d.costMiB ?? host.costMiB;

/** What a device can run, its own profile and instance first (the default variant), then each of its `variants`. */
export const variantsOf = (d: Device): readonly [Variant, ...Variant[]] => [{ profile: d.profile, ...(d.instance === undefined ? {} : { instance: d.instance }) }, ...(d.variants ?? [])];

/** Every profile a device can serve, its own first. */
export const profilesOf = (d: Device): readonly string[] => variantsOf(d).map((v) => v.profile);

/** Every instance of a started slot, its own first: the names its host's control command starts, stops and reports. */
export const instancesOf = (d: Device): readonly string[] => variantsOf(d).flatMap((v) => (v.instance === undefined ? [] : [v.instance]));

/** The variant that serves a request: the device's own when it names no profile, else the one of that profile, if any. */
export const variantFor = (d: Device, profile: string | undefined): Variant | undefined =>
  profile === undefined ? variantsOf(d)[0] : variantsOf(d).find((v) => v.profile === profile);

/** An instance name the control command accepts: an AVD or VM name, never anything a shell could read twice. */
export const INSTANCE = /^[a-z][a-z0-9]{0,15}$/;

/** A control command: an absolute path, nothing else. */
export const CONTROL = /^\/[A-Za-z0-9/_.-]+$/;

/** Problems a catalog must not have; empty when it is sound. Checked once at startup. */
export const catalogProblems = (catalog: Catalog): readonly string[] => {
  const problems: string[] = [];
  const twice = (ids: readonly string[]) => ids.filter((id, i) => ids.indexOf(id) !== i);
  for (const id of twice(catalog.hosts.map((h) => h.id))) problems.push(`host ${id} is declared twice`);
  for (const id of twice(catalog.devices.map((d) => d.id))) problems.push(`device ${id} is declared twice`);
  // One name space per host: the control command knows a variant's instance as it knows any other.
  for (const key of twice(catalog.devices.flatMap((d) => instancesOf(d).map((i) => `${d.host}/${i}`)))) problems.push(`instance ${key} is declared twice`);
  for (const h of catalog.hosts) if (h.control !== undefined && !CONTROL.test(h.control)) problems.push(`host ${h.id} has control ${JSON.stringify(h.control)}, not an absolute path`);
  for (const port of twice(catalog.devices.flatMap((d) => (d.probe?.kind === "door" ? [String(d.probe.port)] : [])))) problems.push(`door port ${port} is declared twice`);
  // Simulators are found by name on their Mac, a paired watch as much as its phone: one name, one simulator.
  const simulatorNames = catalog.devices.flatMap((d) => (d.simulator === undefined ? [] : [d.simulator.name, ...(d.simulator.watch === undefined ? [] : [d.simulator.watch.name])].map((n) => `${d.host}/${n}`)));
  for (const key of twice(simulatorNames)) problems.push(`simulator ${key} is declared twice`);
  for (const profile of Object.keys(catalog.forms)) if (!Object.hasOwn(catalog.profiles, profile)) problems.push(`profile ${profile} has a form but is not declared`);
  for (const [platform, profile] of Object.entries(catalog.defaultProfiles)) {
    if (!Object.hasOwn(catalog.profiles, profile)) problems.push(`the default ${platform} profile ${profile} is not declared`);
    else if (!catalog.devices.some((d) => d.platform === platform && d.mode !== "reserved" && profilesOf(d).includes(profile)))
      problems.push(`no ${platform} device serves the default ${platform} profile ${profile}: a request that names no profile would find nothing`);
  }
  for (const d of catalog.devices) {
    const host = hostOf(catalog, d.host);
    if (host === undefined) problems.push(`device ${d.id} names host ${d.host}, which is not declared`);
    else if (host.platform !== d.platform && !reachedOverSsh(d.platform)) problems.push(`device ${d.id} is ${d.platform} on ${host.id}, a ${host.platform} host`);
    if (d.platform === "android" && d.adb === undefined) problems.push(`android device ${d.id} has no adb address`);
    if (STARTED.includes(d.platform) && d.mode === "spawn" && d.instance === undefined) problems.push(`${d.platform} device ${d.id} is a spawn slot with no instance to start`);
    if (d.instance !== undefined && !STARTED.includes(d.platform)) problems.push(`device ${d.id} has an instance but is not an emulator or a VM`);
    // A desktop or a console is reached over ssh; a phone is not.
    if (reachedOverSsh(d.platform) && d.ssh === undefined) problems.push(`${d.platform} device ${d.id} has no ssh address for its holder`);
    if (!reachedOverSsh(d.platform) && d.ssh !== undefined) problems.push(`device ${d.id} has an ssh address but is a phone, reached through its host's tooling`);
    // A screenshot command runs on the device over that address, as one argument to ssh.
    if (d.screenshot !== undefined && !reachedOverSsh(d.platform)) problems.push(`device ${d.id} has a screenshot command but is not reached over ssh`);
    if (d.screenshot !== undefined && d.screenshot.trim() === "") problems.push(`device ${d.id} has an empty screenshot command`);
    if (d.screenshot !== undefined && /[\r\n]/.test(d.screenshot)) problems.push(`device ${d.id} has a screenshot command of more than one line`);
    if (d.ssh?.port !== undefined && (!Number.isInteger(d.ssh.port) || d.ssh.port < 1 || d.ssh.port > 65535)) problems.push(`device ${d.id} has ssh port ${d.ssh.port}`);
    // The Mac's own desktop session is there or not: nothing starts one.
    if (d.platform === "macos" && d.mode === "spawn") problems.push(`macos device ${d.id} is a spawn slot: a Mac's desktop session is fixed, there or not`);
    if (d.platform === "macos" && host !== undefined && host.platform !== "ios") problems.push(`macos device ${d.id} is on ${host.id}, which is not a Mac (an ios host), so nothing probes its desktop session`);
    // A VM has no adb: its boot can only be read from its unit, through a host whose probe reads the control command.
    if (VMS.includes(d.platform) && d.mode === "spawn" && d.probe?.kind !== "unit") problems.push(`${d.platform} device ${d.id} is a spawn slot without probe "unit": a VM's boot is read from its unit`);
    if (VMS.includes(d.platform) && d.mode === "spawn" && host !== undefined && host.platform !== "android")
      problems.push(`${d.platform} device ${d.id} is started on ${host.id}, whose probe does not read the control command (only an android host's does)`);
    if (d.costMiB !== undefined && (d.mode !== "spawn" || !Number.isInteger(d.costMiB) || d.costMiB < 0)) problems.push(`device ${d.id} has a cost but is not a spawn slot, or the cost is not a whole number of MiB`);
    if (d.instance !== undefined && !INSTANCE.test(d.instance)) problems.push(`device ${d.id} has instance ${JSON.stringify(d.instance)}, not ${INSTANCE.source}`);
    if (d.instance !== undefined && host !== undefined && host.control === undefined) problems.push(`device ${d.id} is started on ${host.id}, which has no control command`);
    if (d.platform === "ios" && d.simulator === undefined) problems.push(`ios device ${d.id} has no simulator spec`);
    // Only a simulator the broker creates is paired by it; a fixed one's watch would be a promise nobody keeps.
    if (d.simulator?.watch !== undefined && d.mode !== "spawn") problems.push(`ios device ${d.id} has a watch but is not a spawn slot: the broker pairs only the simulators it creates`);
    if (!TENANT.test(d.tenant)) problems.push(`device ${d.id} has tenant ${JSON.stringify(d.tenant)}, not ${TENANT.source}`);
    else if (d.tenant !== DEFAULT_TENANT && host !== undefined && !host.isolates) problems.push(`device ${d.id} serves ${d.tenant} on ${host.id}, a host that does not isolate its devices: it may serve the default tenant only`);
    if (d.probe !== undefined && d.instance === undefined) problems.push(`device ${d.id} has a probe but no instance: only an emulator the broker starts is probed that way`);
    if (!Object.hasOwn(catalog.profiles, d.profile)) problems.push(`device ${d.id} has profile ${d.profile}, which is not declared`);
    if (d.variants === undefined) continue;
    if (!isStartedSlot(d)) problems.push(`device ${d.id} has variants but is not a slot the broker starts (${STARTED.join(", ")}; spawn, with an instance)`);
    for (const v of d.variants) {
      if (!INSTANCE.test(v.instance)) problems.push(`device ${d.id} has variant instance ${JSON.stringify(v.instance)}, not ${INSTANCE.source}`);
      if (!Object.hasOwn(catalog.profiles, v.profile)) problems.push(`device ${d.id} has a variant of profile ${v.profile}, which is not declared`);
    }
    for (const profile of new Set(twice(profilesOf(d)))) problems.push(`device ${d.id} serves profile ${profile} twice: each variant needs a profile of its own`);
  }
  return problems;
};

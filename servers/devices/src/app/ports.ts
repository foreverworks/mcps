/**
 * What the broker needs from the world, stated as functions. infra/ satisfies
 * them; nothing in app/ or domain/ imports from infra/.
 */
import type { Catalog, Host, SimulatorSpec } from "../domain/catalog.js";
import type { BrokerState } from "../domain/state.js";

/** An Android build-and-emulator host (Linux), read over ssh. */
export type AndroidHostProbe = {
  readonly memAvailableMiB: number;
  readonly load: number;
  /**
   * Each emulator instance's unit state, from the host's control command (`<control> status`): what is
   * running on the host whatever started it. Absent where the host has no control command.
   */
  readonly emulators?: Readonly<Record<string, string>>;
  /**
   * systemd's Result for each instance whose status line carries one, a failed unit's (`timeout`, `oom-kill`,
   * `exit-code`, `signal`). Present with `emulators`; empty from a control command that prints two columns.
   */
  readonly results?: Readonly<Record<string, string>>;
};

export type SimulatorSeen = { readonly name: string; readonly udid: string; readonly state: string };

/** An iOS host (a Mac), read over ssh. */
export type MacProbe = {
  readonly onAc: boolean;
  readonly ciBusy: boolean;
  readonly load: number;
  readonly simulators: readonly SimulatorSeen[];
  /** The ssh account has a desktop (GUI) session on the Mac, so an app it opens gets a window. */
  readonly desktop: boolean;
};

/** A spawned simulator as it exists once made: its UDID, and its paired watch's where its spec has a watch. */
export type Created = { readonly udid: string; readonly watchUdid?: string };

export type HostsPort = {
  readonly probeAndroid: (host: Host) => Promise<AndroidHostProbe>;
  readonly probeMac: (host: Host) => Promise<MacProbe>;
  /**
   * Makes the simulator exist on the newest installed iOS runtime, reusing the one of its name; with a watch
   * in its spec, the watch too (newest watchOS runtime), paired with it unless it already is.
   */
  readonly createSimulator: (host: Host, spec: SimulatorSpec) => Promise<Created>;
  /** These three act on the simulator and on every watch paired with it, found by its UDID. */
  readonly shutdownSimulator: (host: Host, udid: string) => Promise<void>;
  /** Uninstalls the apps a holder installed and resets privacy grants; a no-op on a shut-down simulator. */
  readonly resetSimulator: (host: Host, udid: string) => Promise<void>;
  readonly deleteSimulator: (host: Host, udid: string) => Promise<void>;
  /** Asks the host's control command to start an emulator instance; returns once the start is queued. */
  readonly startEmulator: (host: Host, instance: string) => Promise<void>;
  /** Asks the host's control command to stop an emulator instance; returns once it has stopped. */
  readonly stopEmulator: (host: Host, instance: string) => Promise<void>;
  /** Every emulator instance's unit state on the host (`<control> status`). */
  readonly emulatorStates: (host: Host) => Promise<Readonly<Record<string, string>>>;
};

export type AdbDevice = { readonly serial: string; readonly state: string };

/** An adb server on the broker's own loopback: a local one, or a forward of a host's. */
export type AdbPort = {
  readonly devices: (port: number) => Promise<readonly AdbDevice[]>;
  /** Whether a device in `device` state has finished booting (sys.boot_completed); false on any doubt. */
  readonly bootCompleted: (port: number, serial: string) => Promise<boolean>;
  /** `pm clear` of every third-party package; the count cleared. */
  readonly clearUserApps: (port: number, serial: string) => Promise<number>;
};

/**
 * A slot's own adbd, reached directly through its tunnel on the broker's loopback (adb's device
 * protocol, no adb server in between): the same door its holder drives it through.
 */
export type DoorPort = {
  /** Whether the device has finished booting (sys.boot_completed); false on any doubt. */
  readonly bootCompleted: (port: number) => Promise<boolean>;
  /** `pm clear` of every third-party package; the count cleared. */
  readonly clearUserApps: (port: number) => Promise<number>;
};

export type StorePort = {
  readonly load: () => Promise<BrokerState | undefined>;
  readonly save: (state: BrokerState) => Promise<void>;
};

export type Deps = {
  readonly catalog: Catalog;
  /** Why the catalog is empty, when it is on purpose: said in every unavailable answer and in status. */
  readonly catalogNote?: string;
  /** Why no catalog could be read: every tool answers it as a config failure. */
  readonly catalogProblem?: string;
  readonly hosts: HostsPort;
  readonly adb: AdbPort;
  readonly door: DoorPort;
  readonly store: StorePort;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly log: (line: string) => void;
};

import type { Blaster, Catalog } from "../domain/catalog.js";

/** What a blaster says about itself. */
export type BlasterStatus = {
  readonly mac: string;
  readonly devtype: number;
  /** Undefined for a device type that is not an RM blaster this server knows. */
  readonly model: string | undefined;
  /** The name set in the vendor's app. */
  readonly nameOnDevice: string;
  /** Lock device is on in the vendor's app, so it refuses every session. */
  readonly locked: boolean;
  /** Only once a session was granted. */
  readonly firmware?: number | undefined;
};

/**
 * The blasters, over BroadLink's local protocol. Each operation opens its own
 * session and fails with a tagged error (offline, locked, identity, device,
 * outcome_unknown, drift); operations on one blaster run one at a time.
 */
export type Blasters = {
  readonly status: (blaster: Blaster) => Promise<BlasterStatus>;
  /** Send one IR packet once; resolves when the blaster acknowledges it. */
  readonly send: (blaster: Blaster, packet: Uint8Array) => Promise<void>;
  /** Listen for a remote's code until one arrives (its IR packet) or `ms` pass (undefined). */
  readonly learn: (blaster: Blaster, ms: number) => Promise<Uint8Array | undefined>;
};

export type Deps = {
  readonly blasters: Blasters;
  /** The catalog, read again on every call. */
  readonly catalog: () => Promise<Catalog>;
  readonly sleep: (ms: number) => Promise<void>;
};

/**
 * Where a request goes: one pure function over the catalog, the hosts' last
 * probe, the leases and the request. Grant a free fixed device, else start a
 * spawn slot a host has room for, else queue if some healthy host could serve
 * it later, else say why nothing can. A caller is offered its own tenant's
 * devices only, and every reason names only those: another tenant's devices,
 * leases and addresses never reach the answer.
 */
import { builderId, costOf, DEFAULT_TENANT, deviceOf, formOf, USUAL_FORM, profilesOf, profileWanted, variantFor, type Catalog, type Device, type Host, type Tenant, type Variant } from "./catalog.js";
import { heldBy, leaseVariant, short, type BrokerState, type Lease, type Want } from "./state.js";

/** The form of what a lease runs (a phone, a watch): its variant's profile's. */
export const formOfLease = (catalog: Catalog, lease: Lease): string => {
  const device = deviceOf(catalog, lease.resource);
  return formOf(catalog, device === undefined ? lease.profile : leaseVariant(device, lease).profile);
};

/**
 * Whether a held lease answers this request: a request that names a profile is answered by the lease of
 * that profile's form only (a phone's lease never answers a request for a watch), one that names none by
 * any, as before forms.
 */
export const answersWant = (catalog: Catalog, want: Want) => (lease: Lease): boolean =>
  want.kind !== "device" || want.profile === undefined || lease.kind !== "device" || formOfLease(catalog, lease) === formOf(catalog, want.profile);

/** What the last probe of a host found. `unknown` until the first probe answers. */
export type HostHealth = {
  readonly state: "up" | "degraded" | "down" | "unknown";
  /** Why it is degraded or down, in words an agent can act on. */
  readonly reason?: string;
  readonly checkedAt: number;
  readonly onAc?: boolean;
  readonly memAvailableMiB?: number;
  /** A CI job is running on the host (a GitHub runner's Runner.Worker). */
  readonly ciBusy?: boolean;
  readonly load?: number;
  /** Device ids the probe saw alive: an emulator in adb `device` state (any of its variants), an existing simulator. */
  readonly present: readonly string[];
  /** Android: the instances its control command reports running, whichever slot's variant each is. */
  readonly runningInstances: readonly string[];
  /** iOS: device ids whose simulator is booted. */
  readonly booted: readonly string[];
  /** iOS: simulator name -> UDID, for every simulator on the host the catalog names. */
  readonly udids: Readonly<Record<string, string>>;
  /** Device id -> why the probe does not count it present, where it knows (a Mac desktop nobody is logged in to). */
  readonly why?: Readonly<Record<string, string>>;
};

export const unknownHealth = (now: number): HostHealth => ({ state: "unknown", checkedAt: now, present: [], runningInstances: [], booted: [], udids: {} });

export type Placement =
  | { readonly type: "held"; readonly lease: Lease }
  /** The session holds a device of the platform that does not run the profile it asks for: it must release it to switch. */
  | { readonly type: "conflict"; readonly lease: Lease; readonly reason: string }
  | { readonly type: "grant"; readonly resource: string; readonly spawn: boolean; readonly variant?: Variant; readonly warning?: string }
  | { readonly type: "queue"; readonly reason: string }
  | { readonly type: "unavailable"; readonly reason: string };

type Health = Readonly<Record<string, HostHealth>>;

const healthOf = (health: Health, host: string): HostHealth => health[host] ?? unknownHealth(0);

const usableHost = (h: HostHealth): boolean => h.state === "up" || h.state === "degraded";

const leaseOn = (state: BrokerState, resource: string): Lease | undefined => state.leases.find((l) => l.resource === resource);

const blocked = (state: BrokerState, d: Device): string | undefined => {
  const mark = state.marks[d.id];
  if (mark?.quarantined !== undefined) return `${d.id} is quarantined (${mark.quarantined.note})`;
  if (mark?.busy !== undefined) return `${d.id} is ${mark.busy.what}`;
  const lease = leaseOn(state, d.id);
  return lease === undefined ? undefined : `${d.id} is leased to ${short(lease.session)} (${lease.purpose})`;
};

/** The leases on devices the broker spawned on a host: what its `spawnMax` counts. */
const spawnedOn = (catalog: Catalog, state: BrokerState, host: Host): readonly Lease[] =>
  state.leases.filter((l) => l.spawned === true && catalog.devices.some((d) => d.id === l.resource && d.host === host.id));

/**
 * Whether a host has room to spawn this device, and if not, why. Memory is the probe's MemAvailable
 * less the cost of every spawn granted since that probe (it cannot have seen them yet), so several
 * sessions asking within the same minute do not all pass on one reading. A device costs its own
 * `costMiB` where it has one (a VM beside emulators), else its host's.
 */
export const spawnRoom = (catalog: Catalog, health: Health, state: BrokerState, host: Host, device: Device): string | undefined => {
  const h = healthOf(health, host.id);
  if (h.state !== "up") return `${host.label} is ${h.state}${h.reason === undefined ? "" : `: ${h.reason}`}`;
  if (host.requiresAc && h.onAc !== true) return `${host.label} runs on battery; nothing is started on it until it is on AC`;
  if (h.ciBusy === true) return `a CI job is running on ${host.label}`;
  const spawned = spawnedOn(catalog, state, host);
  if (spawned.length >= host.spawnMax) return `${host.label} already runs ${spawned.length} spawned device(s), its limit`;
  if (host.reserveMiB > 0) {
    if (h.memAvailableMiB === undefined) return `${host.label}'s free memory is unknown`;
    const unseen = spawned.filter((l) => l.grantedAt >= h.checkedAt);
    const unseenCost = unseen.reduce((sum, l) => {
      const d = deviceOf(catalog, l.resource);
      return sum + (d === undefined ? host.costMiB : costOf(d, host));
    }, 0);
    const free = h.memAvailableMiB - unseenCost;
    const cost = costOf(device, host);
    if (free - cost < host.reserveMiB)
      return `${host.label} has ${Math.round(free / 1024)} GiB available${unseen.length > 0 ? ` (counting ${unseen.length} device(s) starting)` : ""}; ${device.id} costs ${Math.round(cost / 1024)} GiB and ${Math.round(host.reserveMiB / 1024)} GiB must stay free`;
  }
  return undefined;
};

/** Whether this device itself can be handed out right now, and if not, why. */
const deviceReady = (catalog: Catalog, health: Health, state: BrokerState, d: Device): string | undefined => {
  const busy = blocked(state, d);
  if (busy !== undefined) return busy;
  const host = catalog.hosts.find((x) => x.id === d.host);
  if (host === undefined) return `${d.id}'s host ${d.host} is not declared`;
  // A spawn slot (an emulator, a spare simulator) is started or created for the lease that gets it.
  if (d.mode === "spawn") return spawnRoom(catalog, health, state, host, d);
  const h = healthOf(health, host.id);
  if (!usableHost(h)) return `${host.label} is ${h.state}${h.reason === undefined ? "" : `: ${h.reason}`}`;
  if (!h.present.includes(d.id)) return h.why?.[d.id] ?? `${d.id} is not answering on ${host.label}`;
  return undefined;
};

/** `profile` is the one the request asks for, or its platform's default: a tablet never answers a request for any phone. */
const matches = (d: Device, want: Want & { readonly kind: "device" }, profile: string | undefined): boolean =>
  d.platform === want.platform &&
  d.mode !== "reserved" &&
  (profile === undefined || profilesOf(d).includes(profile)) &&
  (want.maestro !== true || d.maestro);

const warningFor = (catalog: Catalog, health: Health, d: Device): string | undefined => {
  const host = catalog.hosts.find((x) => x.id === d.host);
  if (host === undefined) return undefined;
  const h = healthOf(health, host.id);
  if (h.ciBusy === true) return `a CI job is running on ${host.label}; a flow now can starve it, so prefer building and looking over running flows`;
  if (h.state === "degraded" && h.reason !== undefined) return `${host.label}: ${h.reason}`;
  return undefined;
};

export const place = (catalog: Catalog, health: Health, state: BrokerState, want: Want, tenant: Tenant, session: string): Placement => {
  const held = heldBy(state, tenant, session, want, answersWant(catalog, want));
  if (held !== undefined) {
    // Asking again names the lease it holds, unless it names another profile of the same form: never hand back the wrong version.
    const device = deviceOf(catalog, held.resource);
    const runs = device === undefined ? undefined : leaseVariant(device, held).profile;
    if (want.kind === "device" && want.profile !== undefined && runs !== undefined && runs !== want.profile) {
      const form = formOf(catalog, want.profile);
      const one = form === USUAL_FORM ? `one ${want.platform} device` : `one ${want.platform} ${form}`;
      return {
        type: "conflict",
        lease: held,
        reason: `session ${short(session)} holds ${held.resource} on ${runs} (lease ${held.id}), and a session holds ${one} at a time: release it, then ask for ${want.profile}`,
      };
    }
    return { type: "held", lease: held };
  }

  if (want.kind === "builder") {
    // A build runs as the host's own ssh account, which isolates nobody: the default tenant's only.
    if (tenant !== DEFAULT_TENANT) return { type: "unavailable", reason: `no host builds ${want.platform} for ${tenant} through the broker` };
    const hosts = catalog.hosts.filter((h) => h.platform === want.platform && h.builders > 0);
    if (hosts.length === 0) return { type: "unavailable", reason: `no host builds ${want.platform} through the broker on ${catalog.box}` };
    const reasons: string[] = [];
    for (const host of hosts) {
      const h = healthOf(health, host.id);
      const id = builderId(want.platform, host.id);
      const busy = state.leases.filter((l) => l.resource === id);
      if (!usableHost(h)) reasons.push(`${host.label} is ${h.state}${h.reason === undefined ? "" : `: ${h.reason}`}`);
      else if (host.requiresAc && h.onAc !== true) reasons.push(`${host.label} runs on battery`);
      else if (busy.length < host.builders) return { type: "grant", resource: id, spawn: false };
      else reasons.push(`${host.label}'s build slot is held by ${busy.map((l) => `${short(l.session)} (${l.purpose})`).join(", ")}`);
    }
    const waitable = hosts.some((host) => usableHost(healthOf(health, host.id)) && !(host.requiresAc && healthOf(health, host.id).onAc !== true));
    return waitable ? { type: "queue", reason: reasons.join("; ") } : { type: "unavailable", reason: reasons.join("; ") };
  }

  const profile = profileWanted(catalog, want.platform, want.profile);
  const candidates = catalog.devices.filter((d) => d.tenant === tenant && matches(d, want, profile));
  if (candidates.length === 0) {
    const what = [want.platform, profile, want.maestro === true ? "driveable by Maestro" : undefined].filter(Boolean).join(", ");
    return { type: "unavailable", reason: `the catalog on ${catalog.box} has no device of ${tenant} for: ${what}` };
  }
  const reasons: string[] = [];
  for (const d of [...candidates.filter((c) => c.mode === "fixed"), ...candidates.filter((c) => c.mode === "spawn")]) {
    const why = deviceReady(catalog, health, state, d);
    if (why === undefined) {
      const warning = warningFor(catalog, health, d);
      const variant = variantFor(d, profile);
      return { type: "grant", resource: d.id, spawn: d.mode === "spawn", ...(variant === undefined ? {} : { variant }), ...(warning === undefined ? {} : { warning }) };
    }
    reasons.push(why);
  }
  // Worth waiting for when some candidate is leased, busy or resetting on a host that answers, or is a spawn
  // slot whose host's spawn limit other leases fill (spares that share one slot): it comes back on its own.
  const waitable = candidates.some((d) => {
    const host = catalog.hosts.find((x) => x.id === d.host);
    if (host === undefined || !usableHost(healthOf(health, host.id)) || state.marks[d.id]?.quarantined !== undefined) return false;
    return blocked(state, d) !== undefined || (d.mode === "spawn" && host.spawnMax > 0 && spawnedOn(catalog, state, host).length >= host.spawnMax);
  });
  // One host down is one reason, however many of its devices were candidates.
  const reason = [...new Set(reasons)].join("; ");
  return waitable ? { type: "queue", reason } : { type: "unavailable", reason };
};

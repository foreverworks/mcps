/**
 * How a lease, a device and the whole broker are shown to an agent: compact,
 * with everything a wrapper needs to reach the device and nothing it does not.
 */
import { deviceOf, DEFAULT_TENANT, hostOf, instancesOf, isStartedSlot, profilesOf, variantsOf, type Catalog, type Device, type Tenant } from "./catalog.js";
import type { HostHealth } from "./place.js";
import { endsAt, eventTenant, isCallers, leaseVariant, positionOf, queueOrder, short, type BrokerState, type Lease, type Ticket } from "./state.js";

const iso = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

/**
 * How to reach a device, and the environment a tool reads to target it: adb's own ANDROID_SERIAL and
 * ANDROID_ADB_SERVER_PORT, for a simulator the Mac's ssh target and the simulator's UDID (and its paired
 * watch's, IOS_SIM_WATCH), and for a desktop its ssh destination (DEVICE_SSH), port (DEVICE_SSH_PORT) and
 * jump host (DEVICE_SSH_JUMP). A UDID not seen yet is given as the simulator's name, which simctl also takes.
 */
export type Address =
  | { readonly platform: "android"; readonly adbPort: number; readonly serial: string; readonly env: Readonly<Record<string, string>> }
  | {
      readonly platform: "ios";
      readonly ssh: string;
      readonly name: string;
      readonly udid?: string;
      readonly watch?: { readonly name: string; readonly udid?: string };
      readonly env: Readonly<Record<string, string>>;
    }
  | { readonly platform: "macos" | "windows"; readonly ssh: string; readonly port?: number; readonly jump?: string; readonly env: Readonly<Record<string, string>> };

export const addressOf = (catalog: Catalog, state: BrokerState, health: Readonly<Record<string, HostHealth>>, device: Device): Address | undefined => {
  const host = hostOf(catalog, device.host);
  if (host === undefined) return undefined;
  if (device.platform === "android" && device.adb !== undefined) {
    const env: Record<string, string> = {
      DEVICE_ID: device.id,
      ANDROID_SERIAL: device.adb.serial,
      ANDROID_ADB_SERVER_PORT: String(device.adb.port),
    };
    return { platform: "android", adbPort: device.adb.port, serial: device.adb.serial, env };
  }
  if (device.platform === "ios" && device.simulator !== undefined) {
    const udid = state.marks[device.id]?.udid ?? health[host.id]?.udids[device.simulator.name];
    const watch = device.simulator.watch;
    const watchUdid = watch === undefined ? undefined : (state.marks[device.id]?.watchUdid ?? health[host.id]?.udids[watch.name]);
    const env: Record<string, string> = {
      DEVICE_ID: device.id,
      IOS_SIM_MAC: host.ssh,
      IOS_SIM_DEVICE: udid ?? device.simulator.name,
      ...(watch === undefined ? {} : { IOS_SIM_WATCH: watchUdid ?? watch.name }),
    };
    return {
      platform: "ios",
      ssh: host.ssh,
      name: device.simulator.name,
      ...(udid === undefined ? {} : { udid }),
      ...(watch === undefined ? {} : { watch: { name: watch.name, ...(watchUdid === undefined ? {} : { udid: watchUdid }) } }),
      env,
    };
  }
  if ((device.platform === "macos" || device.platform === "windows") && device.ssh !== undefined) {
    const { target, port, jump } = device.ssh;
    const env: Record<string, string> = {
      DEVICE_ID: device.id,
      DEVICE_SSH: target,
      ...(port === undefined ? {} : { DEVICE_SSH_PORT: String(port) }),
      ...(jump === undefined ? {} : { DEVICE_SSH_JUMP: jump }),
    };
    return { platform: device.platform, ssh: target, ...(port === undefined ? {} : { port }), ...(jump === undefined ? {} : { jump }), env };
  }
  return undefined;
};

/**
 * Whether a leased device can be driven yet. A slot the broker started is `booting` until its probe
 * says it has booted (adb's boot completed, or its unit active); everything else is `ready` once granted
 * (a simulator is booted by whoever drives it, `simctl boot`).
 */
export const deviceState = (state: BrokerState, device: Device): "booting" | "ready" =>
  isStartedSlot(device) && state.marks[device.id]?.readyAt === undefined ? "booting" : "ready";

/** Whether the last probe can still be showing a device the broker has since stopped. */
export const runningPerProbe = (state: BrokerState, health: Readonly<Record<string, HostHealth>>, d: Device): boolean => {
  const h = health[d.host];
  const stoppedAt = state.marks[d.id]?.stoppedAt;
  return h !== undefined && h.present.includes(d.id) && (stoppedAt === undefined || stoppedAt < h.checkedAt);
};

/** The instances of an emulator slot (any of its variants) its host's control command last reported running, unless the broker has stopped it since. */
export const instancesRunning = (state: BrokerState, health: Readonly<Record<string, HostHealth>>, d: Device): readonly string[] => {
  const h = health[d.host];
  const stoppedAt = state.marks[d.id]?.stoppedAt;
  if (h === undefined || (stoppedAt !== undefined && stoppedAt >= h.checkedAt)) return [];
  return instancesOf(d).filter((i) => h.runningInstances.includes(i));
};

/** A person has the device: since when, until when the lease holds without its holder, and the note. */
const pausedView = (p: NonNullable<Lease["paused"]>) => ({ since: iso(p.at), until: iso(p.until), note: p.note, then: "do not drive it until resume" });

export const leaseView = (catalog: Catalog, state: BrokerState, health: Readonly<Record<string, HostHealth>>, lease: Lease) => {
  const device = lease.kind === "device" ? deviceOf(catalog, lease.resource) : undefined;
  const address = device === undefined ? undefined : addressOf(catalog, state, health, device);
  const host = device === undefined ? lease.resource.split("@")[1] : device.host;
  return {
    lease: lease.id,
    resource: lease.resource,
    kind: lease.kind,
    platform: lease.platform,
    ...(device === undefined ? {} : { profile: leaseVariant(device, lease).profile, state: deviceState(state, device) }),
    host,
    session: lease.session,
    purpose: lease.purpose,
    granted_at: iso(lease.grantedAt),
    ends_at: iso(endsAt(lease)),
    ...(lease.paused === undefined ? {} : { paused: pausedView(lease.paused) }),
    ...(lease.claimBy === undefined ? {} : { claim_by: iso(lease.claimBy) }),
    ...(lease.spawned === true ? { spawned: true } : {}),
    ...(address === undefined ? {} : { address }),
  };
};

export const ticketView = (state: BrokerState, ticket: Ticket) => ({
  ticket: ticket.id,
  want: ticket.want,
  session: ticket.session,
  purpose: ticket.purpose,
  priority: ticket.priority,
  position: positionOf(state, ticket),
  waiting_since: iso(ticket.createdAt),
});

const hostView = (h: HostHealth | undefined) =>
  h === undefined
    ? { state: "unknown" }
    : {
        state: h.state,
        ...(h.reason === undefined ? {} : { reason: h.reason }),
        checked_at: iso(h.checkedAt),
        ...(h.onAc === undefined ? {} : { on_ac: h.onAc }),
        ...(h.memAvailableMiB === undefined ? {} : { mem_available_gib: Math.round(h.memAvailableMiB / 102.4) / 10 }),
        ...(h.ciBusy === undefined ? {} : { ci_busy: h.ciBusy }),
        ...(h.load === undefined ? {} : { load: h.load }),
      };

/**
 * What a tenant may see of the catalog: its own devices, and the hosts they (or, for the default tenant,
 * its build slots) are on. Every view below reads through this, so no tenant is shown another's device, lease or event.
 */
export const visibleTo = (catalog: Catalog, tenant: Tenant) => {
  const devices = catalog.devices.filter((d) => d.tenant === tenant);
  const hosts = catalog.hosts.filter((h) => devices.some((d) => d.host === h.id) || (tenant === DEFAULT_TENANT && h.builders > 0));
  return { devices, hosts };
};

export const statusView = (catalog: Catalog, state: BrokerState, health: Readonly<Record<string, HostHealth>>, tenant: Tenant, session?: string) => {
  const leaseOn = (id: string) => state.leases.find((l) => l.resource === id);
  const seen = visibleTo(catalog, tenant);
  return {
    broker: catalog.box,
    ...(tenant === DEFAULT_TENANT ? {} : { tenant }),
    ...(session === undefined ? {} : { mine: state.leases.filter((l) => isCallers(l, tenant, session)).map((l) => leaseView(catalog, state, health, l)) }),
    hosts: seen.hosts.map((h) => ({ id: h.id, label: h.label, platform: h.platform, ...hostView(health[h.id]) })),
    devices: seen.devices.map((d) => {
      const lease = leaseOn(d.id);
      const mark = state.marks[d.id];
      const h = health[d.host];
      const status =
        d.mode === "reserved"
          ? "reserved"
          : mark?.quarantined !== undefined
            ? "quarantined"
            : mark?.busy !== undefined
              ? mark.busy.what
              : lease !== undefined
                ? deviceState(state, d) === "booting"
                  ? "booting"
                  : "leased"
                : d.mode === "spawn"
                  ? isStartedSlot(d) && runningPerProbe(state, health, d)
                    ? "running"
                    : "stopped"
                  : h !== undefined && h.present.includes(d.id)
                    ? "free"
                    : "not answering";
      const absent = status === "not answering" ? h?.why?.[d.id] : undefined;
      // A slot with variants says what it can run, and what it runs while leased or seen running.
      const profiles = profilesOf(d);
      const running = instancesRunning(state, health, d);
      const runs = lease !== undefined ? leaseVariant(d, lease).profile : variantsOf(d).find((v) => v.instance !== undefined && running.includes(v.instance))?.profile;
      return {
        id: d.id,
        platform: d.platform,
        host: d.host,
        profile: d.profile,
        ...(profiles.length > 1 ? { profiles, ...(runs === undefined ? {} : { runs }) } : {}),
        mode: d.mode,
        status,
        ...(h?.booted.includes(d.id) === true ? { booted: true } : {}),
        ...(lease === undefined ? {} : { holder: short(lease.session), purpose: lease.purpose, ends_at: iso(endsAt(lease)), ...(lease.paused === undefined ? {} : { paused: lease.paused.note }) }),
        ...(mark?.quarantined === undefined ? {} : { quarantine: mark.quarantined.note }),
        ...(absent === undefined ? {} : { why: absent }),
        ...(d.note === undefined ? {} : { note: d.note }),
      };
    }),
    builders: state.leases.filter((l) => l.kind === "builder" && l.tenant === tenant).map((l) => ({ id: l.resource, holder: short(l.session), purpose: l.purpose, ends_at: iso(endsAt(l)) })),
    queue: queueOrder(state.tickets.filter((t) => t.tenant === tenant)).map((t) => ticketView(state, t)),
    recent: state.events.filter((e) => eventTenant(e) === tenant).slice(-10).map((e) => `${iso(e.at)} ${e.text}`),
  };
};

/** "a", "a and b", "a, b and c". */
export const listed = (items: readonly string[]): string =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1) ?? ""}`;

/**
 * What a holder does next with a lease it was just given, naming the deployment's own wrappers where
 * the catalog has them: a wrapper takes the lease up by itself, so the agent only has to know its name.
 */
export const nextStep = (catalog: Catalog, lease: Lease, booting: boolean): string => {
  const wrappers = catalog.clients.wrappers[lease.platform];
  const named = listed(wrappers);
  const one = wrappers.length === 1;
  if (lease.kind === "builder") return `build, then release this lease${wrappers.length === 0 ? "" : ` (${named} ${one ? "does" : "do"} both)`}`;
  if (booting) return `the device is booting: ask again (acquire returns this lease) until state is ready${wrappers.length === 0 ? "" : `; ${named} ${one ? "waits" : "wait"} for it`}`;
  return wrappers.length === 0
    ? "drive it at its address and renew the lease while you work; release when done"
    : `${named} ${one ? "uses" : "use"} it and ${one ? "renews" : "renew"} it on every call; release when done`;
};

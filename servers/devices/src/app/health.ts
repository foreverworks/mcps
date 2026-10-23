/**
 * Turning a host's probe into its health: what is alive on it, and whether it
 * can take a spawn. The probes are infra/hosts.ts's; the judgement is here.
 */
import { instancesOf, type Catalog, type Host } from "../domain/catalog.js";
import type { HostHealth } from "../domain/place.js";
import type { Deps } from "./ports.js";

/**
 * A Mac above this one-minute load average takes no spawn: a simulator booting beside a CI job can
 * drive a laptop's load into the hundreds and starve the job.
 */
export const MAC_LOAD_LIMIT = 12;

const message = (thrown: unknown): string => {
  const known = (thrown as { error?: { message?: string } } | undefined)?.error?.message;
  return (known ?? (thrown instanceof Error ? thrown.message : String(thrown))).split("\n")[0]?.slice(0, 200) ?? "no answer";
};

/** A unit state in which the emulator's process exists: it costs the host memory and needs a lease. */
export const RUNNING = new Set(["active", "activating", "deactivating", "reloading"]);

const probeAndroidHost = async (deps: Deps, catalog: Catalog, host: Host, now: number): Promise<HostHealth> => {
  // A slot with a probe (an emulator with a door, a VM) is seen through the host's control command (its
  // unit's state); an older emulator through the adb server its address names (a serial in `device` state).
  const devices = catalog.devices.filter((d) => d.host === host.id);
  const viaUnit = devices.filter((d) => d.probe !== undefined);
  const viaServer = devices.filter((d) => d.probe === undefined && d.adb !== undefined);
  const [probe, adbPorts] = await Promise.all([
    deps.hosts.probeAndroid(host).then(
      (p) => ({ ok: true as const, p }),
      (e: unknown) => ({ ok: false as const, reason: message(e) }),
    ),
    Promise.all(
      [...new Set(viaServer.map((d) => d.adb?.port ?? 0))].map(async (port) => ({
        port,
        seen: await deps.adb.devices(port).catch(() => undefined),
      })),
    ),
  ]);
  const units = probe.ok ? (probe.p.emulators ?? {}) : {};
  // Whichever of a slot's variants runs, it is the slot that runs: one serial, one set of ports.
  const runningInstances = Object.keys(units).filter((i) => RUNNING.has(units[i] ?? ""));
  const present = [
    ...viaUnit.filter((d) => instancesOf(d).some((i) => runningInstances.includes(i))),
    ...viaServer.filter((d) => adbPorts.find((a) => a.port === d.adb?.port)?.seen?.some((s) => s.serial === d.adb?.serial && s.state === "device") === true),
  ].map((d) => d.id);
  const deadPorts = adbPorts.filter((a) => a.seen === undefined).map((a) => a.port);
  if (!probe.ok) {
    return { state: "down", reason: `no answer over ssh (${probe.reason})`, checkedAt: now, present, runningInstances: [], booted: [], udids: {} };
  }
  const reasons = [
    deadPorts.length > 0 ? `the adb server on 127.0.0.1:${deadPorts.join(", ")} does not answer` : undefined,
    viaUnit.length > 0 && probe.p.emulators === undefined ? "its control command reported no instance states" : undefined,
  ].filter((r): r is string => r !== undefined);
  return {
    state: reasons.length === 0 ? "up" : "degraded",
    ...(reasons.length === 0 ? {} : { reason: reasons.join("; ") }),
    checkedAt: now,
    memAvailableMiB: probe.p.memAvailableMiB,
    load: probe.p.load,
    present,
    runningInstances,
    booted: [],
    udids: {},
  };
};

const probeMacHost = async (deps: Deps, catalog: Catalog, host: Host, now: number): Promise<HostHealth> => {
  let probe;
  try {
    probe = await deps.hosts.probeMac(host);
  } catch (thrown) {
    return {
      state: "down",
      reason: `no answer over ssh (${message(thrown)}): asleep, off, or locked after a reboot`,
      checkedAt: now,
      present: [],
      runningInstances: [],
      booted: [],
      udids: {},
    };
  }
  const devices = catalog.devices.filter((d) => d.host === host.id && d.simulator !== undefined);
  const udids: Record<string, string> = {};
  const present: string[] = [];
  const booted: string[] = [];
  for (const d of devices) {
    // A paired watch is found the same way, by its name, so its holder is told its UDID (IOS_SIM_WATCH).
    const watches = probe.simulators.filter((s) => s.name === d.simulator?.watch?.name);
    if (watches.length === 1 && watches[0] !== undefined) udids[watches[0].name] = watches[0].udid;
    const hits = probe.simulators.filter((s) => s.name === d.simulator?.name);
    // Exactly one, or it is not ours to drive: two simulators of one name and a holder may drive the wrong one.
    const only = hits.length === 1 ? hits[0] : undefined;
    if (only === undefined) continue;
    udids[only.name] = only.udid;
    present.push(d.id);
    if (only.state === "Booted") booted.push(d.id);
  }
  // A desktop device on a Mac is its ssh account's own desktop session: there when that account is logged
  // in (at the console, or switched to the background), absent otherwise, and nothing the broker can start.
  const desktops = catalog.devices.filter((d) => d.host === host.id && d.platform === "macos");
  const why: Record<string, string> = {};
  for (const d of desktops) {
    if (probe.desktop) present.push(d.id);
    else why[d.id] = `nobody is logged in to a desktop session as ${host.ssh.split("@")[0] ?? host.ssh} on ${host.label}: someone must log in to that account on the Mac (Fast User Switching keeps any other session)`;
  }
  const reasons = [
    probe.onAc ? undefined : "on battery: it sleeps a minute after it goes idle",
    probe.ciBusy ? "a CI job is running on it" : undefined,
    probe.load > MAC_LOAD_LIMIT ? `load ${probe.load}` : undefined,
  ].filter((r): r is string => r !== undefined);
  return {
    state: reasons.length === 0 ? "up" : "degraded",
    ...(reasons.length === 0 ? {} : { reason: reasons.join("; ") }),
    checkedAt: now,
    onAc: probe.onAc,
    ciBusy: probe.ciBusy,
    load: probe.load,
    present,
    runningInstances: [],
    booted,
    udids,
    ...(Object.keys(why).length === 0 ? {} : { why }),
  };
};

export const probeHost = (deps: Deps, catalog: Catalog, host: Host, now: number): Promise<HostHealth> =>
  host.platform === "ios" ? probeMacHost(deps, catalog, host, now) : probeAndroidHost(deps, catalog, host, now);

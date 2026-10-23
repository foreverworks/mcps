import type { AndroidHostProbe, HostsPort, MacProbe, SimulatorSeen } from "../app/ports.js";
import { INSTANCE, type Host, type WatchSpec } from "../domain/catalog.js";
import { fail, hostError } from "../domain/errors.js";
import { sq, type Ssh } from "./ssh.js";

// A GitHub Actions runner's job process. `[R]unner.Worker`, not `Runner.Worker`: the remote shell's own
// command line holds the pattern, and pgrep -f would count the shell. The bracket keeps it from matching itself.
const CI_JOB = "'[R]unner.Worker'";

const SEP = "@@devices@@";

const sections = (text: string, count: number): readonly string[] => {
  const parts = text.split(SEP).map((p) => p.trim());
  if (parts.length < count) return fail(hostError("probe", `expected ${count} sections, got ${parts.length}: ${text.slice(0, 200)}`));
  return parts;
};

/** `<control> status`: one `<instance> <state>` line per emulator the host's control command knows. */
export const parseEmulatorStates = (text: string): Readonly<Record<string, string>> =>
  Object.fromEntries(
    text
      .split("\n")
      .map((line) => line.trim().split(/\s+/))
      .filter((cols): cols is [string, string] => cols.length === 2 && INSTANCE.test(cols[0] ?? "") && /^[a-z-]+$/.test(cols[1] ?? ""))
      .map(([instance, state]) => [instance, state]),
  );

export const parseAndroidProbe = (text: string): AndroidHostProbe => {
  const [mem, load, emulators] = sections(text, 2);
  const memKiB = Number.parseInt(mem ?? "", 10);
  if (!Number.isFinite(memKiB)) return fail(hostError("probe", `no MemAvailable in ${JSON.stringify(mem)}`));
  return {
    memAvailableMiB: Math.round(memKiB / 1024),
    load: Number.parseFloat(load ?? "0") || 0,
    ...(emulators === undefined ? {} : { emulators: parseEmulatorStates(emulators) }),
  };
};

/** simctl's JSON: { devices: { <runtime id>: [ { name, udid, state, isAvailable } ] } }. */
export const parseSimulators = (json: string): readonly SimulatorSeen[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return fail(hostError("probe", `simctl answered with something that is not JSON: ${json.slice(0, 120)}`));
  }
  const devices = (parsed as { devices?: Record<string, unknown> }).devices ?? {};
  return Object.values(devices).flatMap((list) =>
    Array.isArray(list)
      ? list
          .map((d) => d as { name?: unknown; udid?: unknown; state?: unknown })
          .filter((d) => typeof d.name === "string" && typeof d.udid === "string")
          .map((d) => ({ name: String(d.name), udid: String(d.udid), state: String(d.state ?? "") }))
      : [],
  );
};

export const parseMacProbe = (text: string): MacProbe => {
  const [batt, loadavg, ci, gui, sims] = sections(text, 5);
  // pmset: "Now drawing from 'AC Power'" or "'Battery Power'"; sysctl vm.loadavg: "{ 1.23 1.45 1.50 }".
  const load = Number.parseFloat((loadavg ?? "").replace(/[{}]/g, "").trim().split(/\s+/)[0] ?? "0") || 0;
  return {
    onAc: (batt ?? "").includes("AC Power"),
    ciBusy: (ci ?? "").trim() === "busy",
    load,
    simulators: parseSimulators(sims ?? "{}"),
    desktop: (gui ?? "").trim() === "desktop",
  };
};

/** The OSes a simulator runtime is for, as simctl names them. */
export type SimOs = "iOS" | "watchOS";

/** The newest available runtime's identifier for an OS, from `simctl list runtimes --json`. */
export const newestRuntime = (json: string, os: SimOs): string | undefined => {
  const runtimes = ((JSON.parse(json) as { runtimes?: unknown[] }).runtimes ?? []).map((r) => r as { identifier?: string; version?: string; platform?: string; isAvailable?: boolean; name?: string });
  const mine = runtimes.filter((r) => r.isAvailable !== false && (r.platform === os || (r.name ?? "").startsWith(`${os} `)) && r.identifier !== undefined);
  const key = (v: string | undefined) => (v ?? "0").split(".").map((n) => Number.parseInt(n, 10) || 0);
  mine.sort((a, b) => {
    const x = key(a.version);
    const y = key(b.version);
    for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
    return 0;
  });
  return mine.at(-1)?.identifier;
};

export const newestIosRuntime = (json: string): string | undefined => newestRuntime(json, "iOS");

/** A watch and the phone it is paired with, by UDID, from `simctl list pairs --json`. */
export type SimulatorPair = { readonly watch: string; readonly phone: string };

/** simctl's JSON: { pairs: { <pair id>: { watch: { udid }, phone: { udid }, state } } }. Anything else is no pair. */
export const parsePairs = (json: string): readonly SimulatorPair[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return fail(hostError("probe", `simctl answered with something that is not JSON: ${json.slice(0, 120)}`));
  }
  return Object.values((parsed as { pairs?: Record<string, unknown> }).pairs ?? {})
    .map((p) => p as { watch?: { udid?: unknown }; phone?: { udid?: unknown } })
    .filter((p) => typeof p.watch?.udid === "string" && typeof p.phone?.udid === "string")
    .map((p) => ({ watch: String(p.watch?.udid), phone: String(p.phone?.udid) }));
};

/** The watches paired with a phone. */
export const watchesOf = (pairs: readonly SimulatorPair[], phone: string): readonly string[] => pairs.filter((p) => p.phone === phone).map((p) => p.watch);

/**
 * The bundle ids of the apps a user installed, from `simctl listapps` (an old-style plist,
 * keys sorted, so ApplicationType is each app's first key).
 */
export const userApps = (plist: string): readonly string[] =>
  [...plist.matchAll(/"?([A-Za-z0-9.\-_]+)"?\s*=\s*\{\s*ApplicationType\s*=\s*"?(\w+)"?;/g)].filter((m) => m[2] === "User").map((m) => m[1] ?? "").filter((b) => b !== "");

const control = (host: Host): string => host.control ?? fail(hostError(host.id, "no control command in the catalog to start or stop its emulators"));
const checkInstance = (host: Host, instance: string): string => (INSTANCE.test(instance) ? instance : fail(hostError(host.id, `not an emulator instance: ${instance}`)));

const UDID = /^[0-9A-F-]{36}$/i;
const checkUdid = (udid: string): string => (UDID.test(udid) ? udid : fail(hostError("simulator", `not a UDID: ${udid}`)));

// A Mac with no pairs, or a simctl that cannot list them, answers no pairs: a phone without a watch is
// shut down, reset and deleted as before.
const LIST_PAIRS = "xcrun simctl list pairs --json 2>/dev/null || echo '{}'";

/**
 * What resets one simulator, given its `simctl listapps` answer: the apps a holder installed uninstalled, its
 * privacy grants reset. Empty for a shut-down one (listapps answers nothing). A watch's privacy reset is
 * best effort: a companion's grants are not worth failing the phone's reset over.
 */
const resetSteps = (udid: string, plist: string, companion: boolean): readonly string[] =>
  plist.trim() === ""
    ? []
    : [
        ...userApps(plist).map((b) => `xcrun simctl terminate ${udid} ${sq(b)} >/dev/null 2>&1; xcrun simctl uninstall ${udid} ${sq(b)}`),
        `xcrun simctl privacy ${udid} reset all${companion ? " >/dev/null 2>&1 || true" : ""}`,
      ];

/**
 * Pairs a watch with its phone unless it already is. A watch paired with another phone is refused rather
 * than taken from it: that pair is someone's, and simctl gives a watch one phone.
 */
const pair = async (ssh: Ssh, host: Host, spec: WatchSpec, watch: string, phone: string): Promise<void> => {
  const pairs = parsePairs(await ssh(host.ssh, LIST_PAIRS, 30_000));
  if (pairs.some((p) => p.watch === watch && p.phone === phone)) return;
  const other = pairs.find((p) => p.watch === watch);
  if (other !== undefined) return fail(hostError(host.id, `${spec.name} (${watch}) is paired with another phone (${other.phone}); unpair it so the broker can pair it with ${phone}`));
  await ssh(host.ssh, `xcrun simctl pair ${watch} ${phone}`, 60_000);
};

export const makeHosts = (ssh: Ssh): HostsPort => ({
  probeAndroid: async (host: Host) =>
    parseAndroidProbe(
      await ssh(
        host.ssh,
        `awk '/^MemAvailable:/{print $2}' /proc/meminfo; echo ${SEP}; cut -d' ' -f1 /proc/loadavg` +
          (host.control === undefined ? "" : `; echo ${SEP}; ${control(host)} status`),
        20_000,
      ),
    ),

  probeMac: async (host: Host) =>
    parseMacProbe(
      await ssh(
        host.ssh,
        // `gui/<uid>` exists only while the account has a desktop (Aqua) session: what an app it opens needs.
        `pmset -g batt | head -1; echo ${SEP}; sysctl -n vm.loadavg; echo ${SEP}; if pgrep -f ${CI_JOB} >/dev/null; then echo busy; else echo idle; fi; echo ${SEP}; ` +
          `if launchctl print gui/$(id -u) >/dev/null 2>&1; then echo desktop; else echo none; fi; echo ${SEP}; xcrun simctl list devices --json`,
        30_000,
      ),
    ),

  createSimulator: async (host, spec) => {
    const seen = parseSimulators(await ssh(host.ssh, "xcrun simctl list devices --json", 30_000));
    // Found by name, exactly one, as the probe finds them: two of one name and a holder may drive the wrong one.
    const named = (name: string): string | undefined => {
      const hits = seen.filter((s) => s.name === name);
      if (hits.length > 1) return fail(hostError(host.id, `${hits.length} simulators are already named ${name}; delete the extras by UDID`));
      return hits[0]?.udid;
    };
    const phone = named(spec.name);
    const watch = spec.watch === undefined ? undefined : named(spec.watch.name);
    if (phone !== undefined && spec.watch === undefined) return { udid: phone };
    let runtimes: string | undefined;
    const make = async (made: { readonly name: string; readonly type: string }, os: SimOs): Promise<string> => {
      runtimes ??= await ssh(host.ssh, "xcrun simctl list runtimes --json", 30_000);
      const runtime = newestRuntime(runtimes, os);
      if (runtime === undefined) return fail(hostError(host.id, `no available ${os} runtime`));
      const out = (await ssh(host.ssh, `xcrun simctl create ${sq(made.name)} ${sq(made.type)} ${sq(runtime)}`, 120_000)).trim();
      return checkUdid(out.split("\n").at(-1)?.trim() ?? "");
    };
    const udid = phone ?? (await make(spec, "iOS"));
    if (spec.watch === undefined) return { udid };
    const watchUdid = watch ?? (await make(spec.watch, "watchOS"));
    await pair(ssh, host, spec.watch, checkUdid(watchUdid), checkUdid(udid));
    return { udid, watchUdid };
  },

  shutdownSimulator: async (host, udid) => {
    const u = checkUdid(udid);
    // "Unable to shutdown device in current state: Shutdown" is the success we want, so the exit is ignored.
    // The pairs come back in the same call, so a phone with no watch costs no second one.
    const watches = watchesOf(parsePairs(await ssh(host.ssh, `xcrun simctl shutdown ${u} >/dev/null 2>&1; ${LIST_PAIRS}`, 120_000)), u).map(checkUdid);
    if (watches.length > 0) await ssh(host.ssh, `${watches.map((w) => `xcrun simctl shutdown ${w} >/dev/null 2>&1`).join("; ")}; true`, 120_000);
  },

  resetSimulator: async (host, udid) => {
    const u = checkUdid(udid);
    // listapps answers only for a booted device; a shut-down one has nothing running to reset.
    const [plist, pairs] = sections(await ssh(host.ssh, `xcrun simctl listapps ${u} 2>/dev/null || true; echo ${SEP}; ${LIST_PAIRS}`, 60_000), 2);
    const watches = watchesOf(parsePairs(pairs ?? "{}"), u).map(checkUdid);
    const companions = await Promise.all(watches.map(async (w) => resetSteps(w, await ssh(host.ssh, `xcrun simctl listapps ${w} 2>/dev/null || true`, 60_000), true)));
    const steps = [...resetSteps(u, plist ?? "", false), ...companions.flat()];
    if (steps.length > 0) await ssh(host.ssh, steps.join("; "), 180_000);
  },

  deleteSimulator: async (host, udid) => {
    const u = checkUdid(udid);
    const all = [u, ...watchesOf(parsePairs(await ssh(host.ssh, LIST_PAIRS, 30_000)), u).map(checkUdid)];
    await ssh(host.ssh, `${all.map((x) => `xcrun simctl shutdown ${x} >/dev/null 2>&1`).join("; ")}; xcrun simctl delete ${all.join(" ")}`, 120_000);
  },

  // The host's control command (the README's contract): `start` returns once the start is under way,
  // `stop` once the emulator has stopped (it may save a snapshot on the way down, so a stop can take a minute).
  startEmulator: async (host, instance) => void (await ssh(host.ssh, `${control(host)} start ${checkInstance(host, instance)}`, 90_000)),
  stopEmulator: async (host, instance) => void (await ssh(host.ssh, `${control(host)} stop ${checkInstance(host, instance)}`, 240_000)),
  emulatorStates: async (host) => parseEmulatorStates(await ssh(host.ssh, `${control(host)} status`, 20_000)),
});

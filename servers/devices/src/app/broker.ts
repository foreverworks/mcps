/**
 * The broker: one in-memory state, changed only inside `transact` (one change
 * at a time, saved before the next), plus what has to happen on a host when a
 * lease begins or ends. The rules themselves are domain/'s pure functions.
 */
import { pause, reportProgress } from "@foreverworks/mcp-kit";

import { DEFAULT_TENANT, deviceOf, formOf, hostOf, instancesOf, isStartedSlot, type Device, type Platform, type Tenant } from "../domain/catalog.js";
import { configError, fail, inputError } from "../domain/errors.js";
import { answersWant, place, unknownHealth, type HostHealth } from "../domain/place.js";
import {
  emptyState,
  endLease,
  expire,
  failLease,
  grant,
  isCallers,
  isFor,
  leaseVariant,
  pauseLease,
  positionOf,
  queueOrder,
  replaceLease,
  resumeLease,
  RULES,
  sameWant,
  short,
  takeFailure,
  touch,
  withEvent,
  nextId,
  type BrokerState,
  type DeviceMark,
  type EndState,
  type Ended,
  type Failure,
  type Lease,
  type Priority,
  type Ticket,
  type Want,
  withoutStaleWork,
} from "../domain/state.js";
import { deviceState, instancesRunning, leaseView, nextStep, runningPerProbe, startFailure, statusView, ticketView, visibleTo } from "../domain/view.js";
import { probeHost } from "./health.js";
import type { Deps } from "./ports.js";

/** Probes older than this are refreshed before a placement depends on them. */
export const HEALTH_MAX_AGE_MS = 60_000;

/** Who is asking: the tenant from its token (never from an argument) and the session it says it is. */
export type Caller = { readonly tenant: Tenant; readonly session: string };

export type AcquireInput = Caller & {
  readonly want: Want;
  readonly purpose: string;
  readonly minutes?: number;
  readonly priority?: Priority;
  /** Wait up to this many seconds for a device the lease started to finish booting, telling the caller how it goes. */
  readonly untilBooted?: number;
};

/** How often a boot is looked at while a caller waits for it. */
const BOOT_POLL_MS = 3_000;

export type Broker = ReturnType<typeof makeBroker>;

type AcquireOutcome =
  | { readonly kind: "failed"; readonly failure: Failure }
  | { readonly kind: "held"; readonly lease: Lease }
  | { readonly kind: "conflict"; readonly reason: string }
  | { readonly kind: "granted"; readonly lease: Lease; readonly warning: string | undefined }
  | { readonly kind: "queued"; readonly ticket: Ticket; readonly reason: string }
  | { readonly kind: "unavailable"; readonly reason: string };

type WaitOutcome =
  | { readonly kind: "gone" }
  | { readonly kind: "foreign" }
  | { readonly kind: "granted"; readonly lease: Lease }
  | { readonly kind: "waiting"; readonly ticket: Ticket; readonly position: number; readonly reason: string };

type Step<T> = { readonly ended: readonly Ended[]; readonly result: T };

export const makeBroker = (deps: Deps) => {
  const { catalog } = deps;
  let state: BrokerState | undefined;
  const health: Record<string, HostHealth> = {};
  const probing = new Map<string, Promise<HostHealth>>();
  let chain: Promise<unknown> = Promise.resolve();

  const current = async (): Promise<BrokerState> => {
    if (state === undefined) state = withoutStaleWork((await deps.store.load()) ?? emptyState(), deps.now());
    return state;
  };

  /** One change at a time, saved before the next starts: concurrent HTTP requests cannot lose an update. */
  const transact = <T>(fn: (s: BrokerState) => { readonly state: BrokerState; readonly value: T }): Promise<T> => {
    const run = chain.then(async () => {
      const before = await current();
      const { state: after, value } = fn(before);
      if (after !== before) {
        await deps.store.save(after);
        state = after;
      }
      return value;
    });
    chain = run.catch(() => undefined);
    return run;
  };

  // ---- host health ---------------------------------------------------------------------------

  const refresh = async (hostIds: readonly string[], maxAgeMs: number): Promise<void> => {
    const now = deps.now();
    await Promise.all(
      hostIds.map((id) => {
        const host = hostOf(catalog, id);
        if (host === undefined) return undefined;
        const last = health[id];
        if (last !== undefined && now - last.checkedAt < maxAgeMs) return undefined;
        const inFlight = probing.get(id);
        if (inFlight !== undefined) return inFlight;
        const p = probeHost(deps, catalog, host, now)
          .then((h) => {
            health[id] = h;
            return h;
          })
          .finally(() => probing.delete(id));
        probing.set(id, p);
        return p;
      }),
    );
  };

  /** The hosts a request for this platform depends on: those of its builds and phones, and those carrying a device of it reached over ssh. */
  const hostsFor = (platform: Platform): readonly string[] =>
    catalog.hosts.filter((h) => h.platform === platform || catalog.devices.some((d) => d.host === h.id && d.platform === platform)).map((h) => h.id);

  /** Whose device this is, for the events it causes (a builder is the default tenant's). */
  const tenantOf = (resource: string): Tenant => deviceOf(catalog, resource)?.tenant ?? DEFAULT_TENANT;

  // ---- what happens on a host when a lease ends ----------------------------------------------

  const mark = (id: string, change: (m: DeviceMark | undefined) => DeviceMark) =>
    transact((s) => ({ state: { ...s, marks: { ...s.marks, [id]: change(s.marks[id]) } }, value: undefined }));

  const udidOf = (s: BrokerState, d: Device): string | undefined =>
    s.marks[d.id]?.udid ?? (d.simulator === undefined ? undefined : health[d.host]?.udids[d.simulator.name]);

  type Work = { readonly what: "stopping" | "resetting"; readonly steps: readonly (() => Promise<unknown>)[]; readonly stops: boolean };

  /** What a device needs after a lease ends, if anything: one rule for the busy mark and for the work. */
  const workFor = (s: BrokerState, ended: Ended): Work | undefined => {
    const device = ended.lease.kind === "device" ? deviceOf(catalog, ended.lease.resource) : undefined;
    const host = device === undefined ? undefined : hostOf(catalog, device.host);
    if (device === undefined || host === undefined) return undefined;
    const udid = udidOf(s, device);
    if (device.platform === "ios" && udid !== undefined) {
      const reset = ended.state === "clean" ? [] : [() => deps.hosts.resetSimulator(host, udid)];
      // Always shut it down: a booted simulator costs its Mac gigabytes of memory, and a CI job beside it starves.
      return { what: reset.length > 0 ? "resetting" : "stopping", steps: [...reset, () => deps.hosts.shutdownSimulator(host, udid)], stops: false };
    }
    const instance = leaseVariant(device, ended.lease).instance;
    if (isStartedSlot(device) && instance !== undefined) {
      // A queued grant nobody claimed was never started: nothing to stop, and the next in line gets it now.
      if (s.marks[device.id]?.startedAt === undefined && !runningPerProbe(s, health, device)) return undefined;
      const adb = device.adb;
      const probe = device.probe;
      // A dirty holder's app data goes first (the AVD keeps it across a stop), then the emulator: nothing runs
      // unleased. Through the slot's door where it has one; a slot whose door the broker cannot reach (a
      // guest's) keeps its tenant's data, which no other tenant is ever handed, and a VM (no adb) is only stopped.
      const wipe =
        adb === undefined ? undefined : probe === undefined ? () => deps.adb.clearUserApps(adb.port, adb.serial) : probe.kind === "door" ? () => deps.door.clearUserApps(probe.port) : undefined;
      const clear = ended.state === "dirty" && s.marks[device.id]?.readyAt !== undefined && wipe !== undefined ? [wipe] : [];
      return { what: clear.length > 0 ? "resetting" : "stopping", steps: [...clear, () => deps.hosts.stopEmulator(host, instance)], stops: true };
    }
    if (device.platform === "android" && device.mode === "fixed" && device.adb !== undefined && ended.state !== "clean") {
      const { port, serial } = device.adb;
      return { what: "resetting", steps: [() => deps.adb.clearUserApps(port, serial)], stops: false };
    }
    return undefined;
  };

  /**
   * The marks a lease's end sets in the same transaction that ends it: quarantine for `broken`, and
   * busy while its after-lease work runs, so the queue cannot hand the device on before it is stopped.
   */
  const endMarks = (s0: BrokerState, ended: readonly Ended[], now: number): BrokerState => {
    let s = s0;
    for (const e of ended) {
      const id = e.lease.resource;
      if (e.lease.kind !== "device") continue;
      const work = workFor(s, e);
      const m = s.marks[id];
      s = {
        ...s,
        marks: {
          ...s.marks,
          [id]: {
            ...m,
            ...(e.state === "broken" ? { quarantined: { at: now, note: e.reason, by: e.lease.session } } : {}),
            ...(work === undefined ? {} : { busy: { since: now, what: work.what } }),
          },
        },
      };
    }
    return s;
  };

  const notBusy = (m: DeviceMark | undefined): DeviceMark => {
    const { busy: _done, ...rest } = m ?? {};
    return rest;
  };

  /** An emulator the broker stopped: not started, not ready, and any probe older than now still shows it. */
  const stoppedMark = (m: DeviceMark | undefined, now: number): DeviceMark => {
    const { busy: _done, startedAt: _s, readyAt: _r, ...rest } = m ?? {};
    return { ...rest, stoppedAt: now };
  };

  const runWork = async (id: string, work: Work, failed: string): Promise<void> => {
    try {
      for (const step of work.steps) await step();
      const now = deps.now();
      await mark(id, (m) => (work.stops ? stoppedMark(m, now) : notBusy(m)));
      if (work.stops) await transact((st) => ({ state: withEvent(st, now, `${id} stopped`, tenantOf(id)), value: undefined }));
    } catch (thrown) {
      deps.log(`devices: after-lease work on ${id} failed: ${String((thrown as { error?: { message?: string } }).error?.message ?? thrown)}`);
      await mark(id, notBusy);
      await transact((st) => ({ state: withEvent(st, deps.now(), `${id}: ${failed}`, tenantOf(id)), value: undefined }));
    }
  };

  const afterLease = async (ended: Ended): Promise<void> => {
    const s = await current();
    const work = workFor(s, ended);
    if (work === undefined) return;
    await runWork(ended.lease.resource, work, work.stops ? "stop failed; the broker tries again within a minute (status)" : "reset or stop failed; check it by hand (status)");
  };

  const settle = (ended: readonly Ended[]): void => {
    for (const e of ended) void afterLease(e).catch((thrown: unknown) => deps.log(`devices: after-lease ${e.lease.resource}: ${String(thrown)}`));
  };

  // ---- emulators the broker starts for a lease -------------------------------------------------

  const starting = new Map<string, Promise<void>>();

  /**
   * Starts a slot (an emulator, a VM) for its lease, as the variant the lease was granted, once: asking again while
   * it boots does not start it twice. Only one of a slot's instances runs at a time (they share its serial
   * and ports), so another one the last probe saw running (started by hand, or left by a restart) is stopped first.
   */
  const ensureStarted = async (lease: Lease): Promise<void> => {
    const device = deviceOf(catalog, lease.resource);
    if (device === undefined || !isStartedSlot(device)) return;
    const host = hostOf(catalog, device.host);
    const variant = leaseVariant(device, lease);
    const instance = variant.instance;
    if (host === undefined || instance === undefined) return;
    if ((await current()).marks[device.id]?.startedAt !== undefined) return;
    const inFlight =
      starting.get(device.id) ??
      (async () => {
        for (const other of instancesRunning(await current(), health, device).filter((i) => i !== instance)) await deps.hosts.stopEmulator(host, other);
        await deps.hosts.startEmulator(host, instance);
        const now = deps.now();
        const which = instancesOf(device).length > 1 ? ` as ${variant.profile}` : "";
        await transact((s) => {
          const { readyAt: _r, stoppedAt: _st, ...m } = s.marks[device.id] ?? {};
          return { state: withEvent({ ...s, marks: { ...s.marks, [device.id]: { ...m, startedAt: now } } }, now, `${device.id} started${which} on ${host.label} for ${short(lease.session)}`, device.tenant), value: undefined };
        });
      })().finally(() => starting.delete(device.id));
    starting.set(device.id, inFlight);
    await inFlight;
  };

  /**
   * Whether a booting emulator has booted, by its probe: through its door (`sys.boot_completed` over the
   * path its holder uses), by the lease's instance being `active` on its host (a pool slot's unit is active
   * only once booted), or, for an emulator on a shared adb server, adb listing it as a `device` with its boot completed.
   */
  const booted = async (device: Device, instance: string | undefined): Promise<boolean> => {
    const probe = device.probe;
    if (probe?.kind === "door") return deps.door.bootCompleted(probe.port);
    if (probe?.kind === "unit") {
      const host = hostOf(catalog, device.host);
      if (host === undefined || instance === undefined) return false;
      return (await deps.hosts.emulatorStates(host).catch(() => ({}) as Readonly<Record<string, string>>))[instance] === "active";
    }
    if (device.adb === undefined) return false;
    const { port, serial } = device.adb;
    const seen = await deps.adb.devices(port).catch(() => []);
    return seen.some((d) => d.serial === serial && d.state === "device") && (await deps.adb.bootCompleted(port, serial));
  };

  /** A lease's booting emulator is ready once its probe says it has booted. */
  const checkReady = async (lease: Lease): Promise<void> => {
    const device = deviceOf(catalog, lease.resource);
    if (device === undefined || !isStartedSlot(device)) return;
    const m = (await current()).marks[device.id];
    if (m?.startedAt === undefined || m.readyAt !== undefined) return;
    if (!(await booted(device, leaseVariant(device, lease).instance))) return;
    const now = deps.now();
    await transact((s) => {
      const mk = s.marks[device.id];
      if (mk?.startedAt === undefined || mk.readyAt !== undefined) return { state: s, value: undefined };
      return { state: withEvent({ ...s, marks: { ...s.marks, [device.id]: { ...mk, readyAt: now } } }, now, `${device.id} booted in ${Math.round((now - mk.startedAt) / 1000)} s`, device.tenant), value: undefined };
    });
  };

  /** Probe readings each reconcile has acted on: one stop attempt per device per probe. */
  const stopTried = new Map<string, number>();

  /**
   * Nothing runs without a lease: an emulator slot the last probe saw running (any of its variants), or
   * that the broker started, with no lease and no work in progress is stopped: the instances its host's
   * control command reports running, or every one of them when it reports none (stopping a stopped
   * instance succeeds). This is what takes a host to zero when idle whatever started the emulator: a
   * stop that failed, a restart of the broker, a deploy, a hand.
   */
  const reconcile = async (): Promise<void> => {
    for (const d of catalog.devices) {
      const host = hostOf(catalog, d.host);
      const h = health[d.host];
      if (!isStartedSlot(d) || host === undefined || h === undefined || (h.state !== "up" && h.state !== "degraded")) continue;
      const s = await current();
      const m = s.marks[d.id];
      if (s.leases.some((l) => l.resource === d.id) || m?.busy !== undefined || starting.has(d.id)) continue;
      const seen = instancesRunning(s, health, d);
      const instances = seen.length > 0 ? seen : runningPerProbe(s, health, d) || m?.startedAt !== undefined ? instancesOf(d) : [];
      if (instances.length === 0) continue;
      if (stopTried.get(d.id) === h.checkedAt) continue;
      stopTried.set(d.id, h.checkedAt);
      const now = deps.now();
      // Claimed in a transaction: nobody can lease it between this check and the stop.
      const claimed = await transact((st) => {
        const mk = st.marks[d.id];
        if (st.leases.some((l) => l.resource === d.id) || mk?.busy !== undefined) return { state: st, value: false };
        return { state: withEvent({ ...st, marks: { ...st.marks, [d.id]: { ...mk, busy: { since: now, what: "stopping" } } } }, now, `${d.id} was running with no lease: stopping it`, d.tenant), value: true };
      });
      if (!claimed) continue;
      void runWork(d.id, { what: "stopping", steps: instances.map((i) => () => deps.hosts.stopEmulator(host, i)), stops: true }, "stop failed; the broker tries again within a minute (status)");
    }
  };

  // ---- the queue -----------------------------------------------------------------------------

  /** Hands free resources to waiting tickets, in queue order; each grant waits for its holder to claim it. */
  const serveQueue = (s0: BrokerState, now: number): BrokerState => {
    let s = s0;
    for (const t of queueOrder(s.tickets)) {
      const p = place(catalog, health, s, t.want, t.tenant, t.session);
      if (p.type === "held") {
        s = { ...s, tickets: s.tickets.map((x) => (x.id === t.id ? { ...x, granted: p.lease.id } : x)) };
      } else if (p.type === "grant") {
        const g = grant(s, { resource: p.resource, want: t.want, tenant: t.tenant, session: t.session, purpose: t.purpose, minutes: t.minutes, now, spawned: p.spawn, claim: true, ...(p.variant === undefined ? {} : { variant: p.variant }) });
        s = { ...g.state, tickets: g.state.tickets.map((x) => (x.id === t.id ? { ...x, granted: g.lease.id } : x)) };
      }
    }
    return s;
  };

  /**
   * The leases whose slot the last probe saw fail before it booted (startFailure), ended at once: the
   * slot is stopped as after any lease, not quarantined (a failed start may be transient; the event log
   * keeps it), and the failure waits for its session's next acquire.
   */
  const failStarts = (s0: BrokerState, now: number): { readonly state: BrokerState; readonly ended: readonly Ended[] } => {
    let s = s0;
    const ended: Ended[] = [];
    for (const lease of s0.leases) {
      const device = lease.kind === "device" ? deviceOf(catalog, lease.resource) : undefined;
      const what = device === undefined ? undefined : startFailure(s, health, device, lease);
      if (what === undefined) continue;
      const r = failLease(s, lease, what, now);
      s = r.state;
      ended.push(r.ended);
    }
    return { state: s, ended };
  };

  /** Expire, end the leases whose start failed, then serve the queue: what every state-reading call does first. */
  const housekeep = (s0: BrokerState, now: number): { readonly state: BrokerState; readonly ended: readonly Ended[] } => {
    const expired = expire(s0, now);
    const failed = failStarts(expired.state, now);
    const ended = [...expired.ended, ...failed.ended];
    return { state: serveQueue(endMarks(failed.state, ended, now), now), ended };
  };

  /** What acquire answers, once, to the session whose lease ended because its slot failed to start. */
  const failedAnswer = (f: Failure) => ({
    status: "failed" as const,
    lease: f.lease.id,
    resource: f.lease.resource,
    reason: f.reason,
    next: "this lease has ended and the device is being stopped: acquire again to get a fresh device",
  });

  /** The failure of this very lease, taken (told once), for a caller that was waiting for its boot. */
  const failureOf = (lease: Lease): Promise<Failure | undefined> =>
    transact((s) => {
      const t = takeFailure(s, (f) => f.lease.id === lease.id);
      return t === undefined ? { state: s, value: undefined } : { state: t.state, value: t.failure };
    });

  /**
   * A spawned simulator must exist before its lease is handed over. One with a watch is ensured on every
   * grant, its pair included: the pair is what its lease is for, and one cut short or undone by hand is
   * mended here instead of handed out unpaired.
   */
  const ensureSpawned = async (lease: Lease): Promise<void> => {
    const device = deviceOf(catalog, lease.resource);
    if (device === undefined || device.mode !== "spawn" || device.simulator === undefined) return;
    const host = hostOf(catalog, device.host);
    if (host === undefined) return;
    const s = await current();
    const watch = device.simulator.watch;
    if (watch === undefined && udidOf(s, device) !== undefined) return;
    const made = await deps.hosts.createSimulator(host, device.simulator);
    const before = s.marks[device.id];
    if (before?.udid === made.udid && before.watchUdid === made.watchUdid) return;
    await mark(device.id, (m) => ({ ...m, udid: made.udid, ...(made.watchUdid === undefined ? {} : { watchUdid: made.watchUdid }) }));
    const paired = watch === undefined || made.watchUdid === undefined ? "" : `, paired with ${watch.name} (${made.watchUdid})`;
    await transact((x) => ({ state: withEvent(x, deps.now(), `${device.id} created on ${host.label} (${made.udid}${paired})`, device.tenant), value: undefined }));
  };

  const view = (s: BrokerState, lease: Lease) => leaseView(catalog, s, health, lease);

  const granted = async (lease: Lease, how: "granted" | "held", warning?: string | undefined) => {
    try {
      await ensureSpawned(lease);
      await ensureStarted(lease);
    } catch (thrown) {
      const reason = `could not ${lease.platform === "ios" ? "create" : "start"} ${lease.resource}: ${String((thrown as { error?: { message?: string } }).error?.message ?? thrown)}`;
      const ended = await transact((s) => {
        const live = s.leases.find((l) => l.id === lease.id);
        if (live === undefined) return { state: s, value: [] as Ended[] };
        const r = endLease(s, live, "clean", reason, deps.now());
        return { state: serveQueue(endMarks(r.state, [r.ended], deps.now()), deps.now()), value: [r.ended] };
      });
      settle(ended);
      return { status: "unavailable" as const, reason };
    }
    await checkReady(lease);
    return answerFor(lease, how, warning);
  };

  /** What acquire answers for a lease it granted or found held, as the state now says. */
  const answerFor = async (lease: Lease, how: "granted" | "held", warning?: string | undefined) => {
    const s = await current();
    const live = s.leases.find((l) => l.id === lease.id) ?? lease;
    const device = deviceOf(catalog, live.resource);
    const booting = device !== undefined && deviceState(s, device) === "booting";
    return { status: how, ...view(s, live), ...(warning === undefined ? {} : { warning }), next: nextStep(catalog, live, booting) };
  };

  /**
   * Waits, up to `seconds`, for the device a lease started to finish booting: its probe every few
   * seconds, the caller told the seconds so far. Returns when it has booted, when the time is up (the
   * answer then still says booting), or fails as cancelled when the caller gives up; the lease is
   * theirs either way.
   */
  const bootWait = async (lease: Lease, seconds: number): Promise<void> => {
    const device = deviceOf(catalog, lease.resource);
    if (device === undefined || !isStartedSlot(device)) return;
    const where = hostOf(catalog, device.host)?.label ?? device.host;
    const started = deps.now();
    for (;;) {
      const s = await current();
      // Booted, or the lease ended meanwhile (its start failed, say): nothing more to wait for.
      if (deviceState(s, device) !== "booting" || !s.leases.some((l) => l.id === lease.id)) return;
      const waited = Math.round((deps.now() - started) / 1000);
      reportProgress(waited, seconds, `${device.id} is booting on ${where}: ${waited} s so far`);
      if (deps.now() - started >= seconds * 1000) return;
      await pause(BOOT_POLL_MS, deps.sleep, `${device.id} was still booting; the lease is yours, and acquire again says its state`);
      await checkReady(lease);
    }
  };

  // ---- use cases -----------------------------------------------------------------------------

  const unavailableEmpty = () => ({ status: "unavailable" as const, reason: deps.catalogNote ?? `the catalog on ${catalog.box} is empty` });

  /** A broker whose catalog could not be read answers every call with why, as a config failure. */
  const configured = (): void => {
    if (deps.catalogProblem !== undefined) fail(configError(deps.catalogProblem));
  };

  const acquire = async (input: AcquireInput) => {
    configured();
    if (catalog.hosts.length === 0) return unavailableEmpty();
    await refresh(hostsFor(input.want.platform), HEALTH_MAX_AGE_MS);
    const now = deps.now();
    const minutes = input.minutes ?? (input.want.kind === "builder" ? RULES.builderMinutes : RULES.defaultMinutes);
    const out = await transact<Step<AcquireOutcome>>((s0) => {
      const { state: s, ended } = housekeep(s0, now);
      // The slot started for this session's last lease of the kind failed before it booted: told first, and once.
      const told = takeFailure(s, (f) => isFor(f.lease, input.tenant, input.session, input.want, answersWant(catalog, input.want)));
      if (told !== undefined) return { state: told.state, value: { ended, result: { kind: "failed" as const, failure: told.failure } } };
      // Already waiting in the queue: the same ticket, polled. Asked for another profile, it waits for that one now, in the same place.
      // A phone and a watch wait apart: one ticket per platform and form.
      const sameForm = (a: Want, b: Want) => formOf(catalog, a.kind === "device" ? a.profile : undefined) === formOf(catalog, b.kind === "device" ? b.profile : undefined);
      const waiting = s.tickets.find((t) => isCallers(t, input.tenant, input.session) && sameWant(t.want, input.want) && sameForm(t.want, input.want));
      if (waiting !== undefined && waiting.granted === undefined) {
        const profile = input.want.kind === "device" ? input.want.profile : undefined;
        const switched = profile !== undefined && waiting.want.kind === "device" && waiting.want.profile !== profile;
        const t: Ticket = { ...waiting, ...(switched ? { want: input.want } : {}), polledAt: now };
        const next = { ...s, tickets: s.tickets.map((x) => (x.id === t.id ? t : x)) };
        return { state: next, value: { ended, result: { kind: "queued" as const, ticket: t, reason: switched ? `already queued; now for ${profile}` : "already queued" } } };
      }
      const p = place(catalog, health, s, input.want, input.tenant, input.session);
      switch (p.type) {
        case "held": {
          const lease = touch(p.lease, now, minutes);
          const next = { ...replaceLease(s, lease), tickets: s.tickets.filter((t) => t.granted !== lease.id) };
          return { state: next, value: { ended, result: { kind: "held" as const, lease } } };
        }
        // A refused ask changes nothing of the lease it names.
        case "conflict":
          return { state: s, value: { ended, result: { kind: "conflict" as const, reason: p.reason } } };
        case "grant": {
          const g = grant(s, { resource: p.resource, want: input.want, tenant: input.tenant, session: input.session, purpose: input.purpose, minutes, now, spawned: p.spawn, claim: false, ...(p.variant === undefined ? {} : { variant: p.variant }) });
          return { state: g.state, value: { ended, result: { kind: "granted" as const, lease: g.lease, warning: p.warning } } };
        }
        case "queue": {
          const id = nextId(s, "tk");
          const t: Ticket = { id: id.id, want: input.want, tenant: input.tenant, session: input.session, purpose: input.purpose, priority: input.priority ?? "interactive", minutes, createdAt: now, polledAt: now };
          const next = withEvent({ ...id.state, tickets: [...id.state.tickets, t] }, now, `${input.want.kind} ${input.want.platform} queued for ${t.session.slice(0, 13)} (${p.reason})`, input.tenant);
          return { state: next, value: { ended, result: { kind: "queued" as const, ticket: t, reason: p.reason } } };
        }
        case "unavailable":
          return { state: s, value: { ended, result: { kind: "unavailable" as const, reason: p.reason } } };
      }
    });
    settle(out.ended);
    const r = out.result;
    const booted = async (answer: Awaited<ReturnType<typeof granted>>, lease: Lease, how: "granted" | "held", warning?: string | undefined) => {
      if (input.untilBooted === undefined || answer.status === "unavailable") return answer;
      await bootWait(lease, input.untilBooted);
      // A start that failed while the caller waited is told now, not as a lease still booting.
      const failure = await failureOf(lease);
      return failure === undefined ? answerFor(lease, how, warning) : failedAnswer(failure);
    };
    switch (r.kind) {
      case "failed":
        return failedAnswer(r.failure);
      case "held":
        return booted(await granted(r.lease, "held"), r.lease, "held");
      case "conflict":
        return fail(inputError(r.reason));
      case "granted":
        return booted(await granted(r.lease, "granted", r.warning), r.lease, "granted", r.warning);
      case "queued": {
        const s = await current();
        return { status: "queued" as const, ...ticketView(s, r.ticket), reason: r.reason, next: "call wait with this ticket (it holds your place for 2 min between polls)" };
      }
      case "unavailable":
        return { status: "unavailable" as const, reason: r.reason };
    }
  };

  /**
   * Long-polls a ticket: granted as soon as the queue reaches it, else its place when the time is up.
   * A caller that asked hears its place after each look; one that gives up stops the poll.
   */
  const wait = async (input: Caller & { readonly ticket: string; readonly seconds: number }) => {
    configured();
    const seconds = Math.max(0, Math.min(input.seconds, 50));
    const started = deps.now();
    const deadline = started + seconds * 1000;
    for (;;) {
      const t0 = (await current()).tickets.find((t) => t.id === input.ticket);
      if (t0 !== undefined) await refresh(hostsFor(t0.want.platform), HEALTH_MAX_AGE_MS);
      const now = deps.now();
      const out = await transact<Step<WaitOutcome>>((s0) => {
        const { state: s, ended } = housekeep(s0, now);
        // Another tenant's ticket is answered as one that does not exist: its existence is not this caller's to learn.
        const t = s.tickets.find((x) => x.id === input.ticket && x.tenant === input.tenant);
        if (t === undefined) return { state: s, value: { ended, result: { kind: "gone" as const } } };
        if (t.session !== input.session) return { state: s, value: { ended, result: { kind: "foreign" as const } } };
        if (t.granted !== undefined) {
          const lease = s.leases.find((l) => l.id === t.granted);
          if (lease !== undefined) {
            const claimed = touch(lease, now);
            const next = { ...replaceLease(s, claimed), tickets: s.tickets.filter((x) => x.id !== t.id) };
            return { state: next, value: { ended, result: { kind: "granted" as const, lease: claimed } } };
          }
        }
        const polled: Ticket = { ...t, polledAt: now };
        const next = { ...s, tickets: s.tickets.map((x) => (x.id === t.id ? polled : x)) };
        const p = place(catalog, health, next, t.want, t.tenant, t.session);
        const reason = p.type === "queue" || p.type === "unavailable" || p.type === "conflict" ? p.reason : "";
        return { state: next, value: { ended, result: { kind: "waiting" as const, ticket: polled, position: positionOf(next, polled), reason } } };
      });
      settle(out.ended);
      const r = out.result;
      if (r.kind === "gone") return fail(inputError(`no ticket ${input.ticket}: it was dropped (not polled for 2 min) or already claimed; acquire again`));
      if (r.kind === "foreign") return fail(inputError(`ticket ${input.ticket} belongs to another session`));
      if (r.kind === "granted") return granted(r.lease, "granted");
      if (deps.now() >= deadline) return { status: "queued" as const, ticket: r.ticket.id, position: r.position, reason: r.reason, next: "call wait again" };
      const waited = Math.round((deps.now() - started) / 1000);
      reportProgress(waited, seconds, `number ${r.position} in the queue${r.reason === "" ? "" : ` (${r.reason})`}, ${waited} s waited`);
      await pause(2000, deps.sleep, `ticket ${r.ticket.id} keeps its place for 2 minutes; call wait again`);
    }
  };

  /** The caller's lease, by id or by what it is for. Another tenant's lease is answered as one that does not exist. */
  const findLease = (s: BrokerState, caller: Caller, lease?: string, want?: Want): Lease => {
    const { tenant, session } = caller;
    const found =
      lease !== undefined
        ? s.leases.find((l) => l.id === lease && l.tenant === tenant)
        : s.leases.find(
            (l) => isCallers(l, tenant, session) && (want === undefined || (l.kind === want.kind && l.platform === want.platform && answersWant(catalog, want)(l))),
          );
    if (found === undefined) return fail(inputError(lease !== undefined ? `no lease ${lease}: it ended (status shows why)` : `session ${session.slice(0, 13)} holds no ${want === undefined ? "" : `${want.kind} ${want.platform} `}lease`));
    if (found.session !== session) return fail(inputError(`lease ${found.id} belongs to another session`));
    return found;
  };

  const renew = async (input: Caller & { readonly lease?: string; readonly want?: Want; readonly minutes?: number }) => {
    configured();
    const now = deps.now();
    const out = await transact((s0) => {
      const { state: s, ended } = housekeep(s0, now);
      const found = findLease(s, input, input.lease, input.want);
      const minutes = input.minutes ?? (found.kind === "builder" ? RULES.builderMinutes : RULES.defaultMinutes);
      const lease = touch(found, now, minutes);
      return { state: replaceLease(s, lease), value: { ended, lease } };
    });
    settle(out.ended);
    return { status: "renewed" as const, ...view(await current(), out.lease) };
  };

  /**
   * Hand a device to a person without losing it: the lease holds for `minutes` without its holder's
   * calls (so an agent waiting on someone does not lose the device after 20 quiet minutes), then ends
   * as a silent one does. The broker drives nothing, so the pause is a promise the holder keeps: its
   * view says paused, for the holder's tools to stop until resume.
   */
  const pauseForPerson = async (input: Caller & { readonly lease?: string; readonly want?: Want; readonly minutes?: number; readonly note: string }) => {
    configured();
    const now = deps.now();
    const out = await transact((s0) => {
      const { state: s, ended } = housekeep(s0, now);
      const found = findLease(s, input, input.lease, input.want);
      if (found.kind === "builder") return fail(inputError(`lease ${found.id} is a build slot, which no person takes over; renew it instead`));
      const paused = pauseLease(found, now, input.minutes ?? RULES.pauseDefaultMinutes, input.note);
      if (paused === undefined) {
        return fail(inputError(`lease ${found.id} has been held ${Math.round(RULES.maxHeldMs / 3_600_000)} h, the most any lease may: release it, and acquire again if it is still needed`));
      }
      const next = withEvent(replaceLease(s, paused), now, `${found.resource} paused for a person by ${short(found.session)}: ${input.note}`, found.tenant);
      return { state: next, value: { ended, lease: paused } };
    });
    settle(out.ended);
    return { status: "paused" as const, ...view(await current(), out.lease) };
  };

  /** The holder takes the device back from the person: an ordinary lease again, its idle clock starting now. Resuming twice changes nothing more. */
  const resumeFromPerson = async (input: Caller & { readonly lease?: string; readonly want?: Want }) => {
    configured();
    const now = deps.now();
    const out = await transact((s0) => {
      const { state: s, ended } = housekeep(s0, now);
      const found = findLease(s, input, input.lease, input.want);
      const lease = resumeLease(found, now);
      const replaced = replaceLease(s, lease);
      const next = found.paused === undefined ? replaced : withEvent(replaced, now, `${found.resource} back from a person to ${short(found.session)}`, found.tenant);
      return { state: next, value: { ended, lease, was: found.paused !== undefined } };
    });
    settle(out.ended);
    return { status: out.was ? ("resumed" as const) : ("not paused" as const), ...view(await current(), out.lease) };
  };

  const release = async (input: Caller & { readonly lease?: string; readonly want?: Want; readonly state: EndState; readonly note?: string }) => {
    configured();
    const now = deps.now();
    const out = await transact((s0) => {
      const { state: s, ended } = housekeep(s0, now);
      const found = findLease(s, input, input.lease, input.want);
      const reason = input.note === undefined ? "released" : `released: ${input.note}`;
      const r = endLease(s, found, input.state, reason, now);
      return { state: serveQueue(endMarks(r.state, [r.ended], now), now), value: { ended: [...ended, r.ended], lease: found } };
    });
    settle(out.ended);
    const device = deviceOf(catalog, out.lease.resource);
    const then =
      input.state === "broken"
        ? device !== undefined && isStartedSlot(device)
          ? "stopped, and quarantined until someone checks it and clears it"
          : "quarantined until someone checks it and clears it"
        : device?.platform === "ios"
          ? input.state === "dirty"
            ? "apps uninstalled, privacy reset, then shut down"
            : "shut down"
          : device !== undefined && isStartedSlot(device)
            ? input.state === "dirty" && device.adb !== undefined
              ? "app data cleared, then stopped"
              : "stopped"
            : input.state === "dirty" && device?.platform === "android" && device.mode === "fixed"
              ? "app data cleared"
              : "left as it is";
    return { status: "released" as const, lease: out.lease.id, resource: out.lease.resource, then };
  };

  /** A device of the caller's tenant; any other is answered as one the catalog does not have. */
  const ownDevice = (caller: Caller, id: string): Device => {
    configured();
    const device = deviceOf(catalog, id);
    return device !== undefined && device.tenant === caller.tenant ? device : fail(inputError(`no device ${id} in the catalog`));
  };

  const report = async (input: Caller & { readonly device: string; readonly note: string }) => {
    const device = ownDevice(input, input.device);
    const now = deps.now();
    await transact((s) => ({
      state: withEvent({ ...s, marks: { ...s.marks, [device.id]: { ...s.marks[device.id], quarantined: { at: now, note: input.note, by: input.session } } } }, now, `${device.id} reported: ${input.note}`, device.tenant),
      value: undefined,
    }));
    return { status: "quarantined" as const, device: device.id, note: input.note, next: "nothing leases it until someone checks it and clears it; release your lease on it if you hold one" };
  };

  /** Returns a quarantined device to service, with what was checked; the event names who cleared it. */
  const clear = async (input: Caller & { readonly device: string; readonly note: string }) => {
    const device = ownDevice(input, input.device);
    const now = deps.now();
    const was = await transact((s) => {
      const mark = s.marks[device.id];
      if (mark?.quarantined === undefined) return { state: s, value: undefined };
      const { quarantined, ...rest } = mark;
      return { state: withEvent({ ...s, marks: { ...s.marks, [device.id]: rest } }, now, `${device.id} cleared by ${input.session.slice(0, 13)}: ${input.note}`, device.tenant), value: quarantined };
    });
    if (was === undefined) return fail(inputError(`${device.id} is not quarantined`));
    return { status: "cleared" as const, device: device.id, was: was.note };
  };

  const status = async (input: { readonly tenant: Tenant; readonly session?: string }) => {
    configured();
    if (catalog.hosts.length === 0) return { broker: catalog.box, note: deps.catalogNote ?? `the catalog on ${catalog.box} is empty` };
    await refresh(
      visibleTo(catalog, input.tenant).hosts.map((h) => h.id),
      2 * HEALTH_MAX_AGE_MS,
    );
    const now = deps.now();
    const ended = await transact((s0) => {
      const r = housekeep(s0, now);
      return { state: r.state, value: r.ended };
    });
    settle(ended);
    return statusView(catalog, await current(), health, input.tenant, input.session);
  };

  /**
   * The clock's work: expiry and the queue every tick, host probes once a minute, booting emulators
   * checked for readiness, unleased ones stopped, old spawned simulators deleted after a week.
   */
  const tick = async () => {
    if (catalog.hosts.length === 0) return;
    await refresh(
      catalog.hosts.map((h) => h.id),
      HEALTH_MAX_AGE_MS,
    ).catch((thrown: unknown) => deps.log(`devices: probe failed: ${String(thrown)}`));
    const now = deps.now();
    const ended = await transact((s0) => {
      const r = housekeep(s0, now);
      return { state: r.state, value: r.ended };
    });
    settle(ended);
    const s = await current();
    for (const l of s.leases) await checkReady(l).catch((thrown: unknown) => deps.log(`devices: readiness of ${l.resource}: ${String(thrown)}`));
    await reconcile().catch((thrown: unknown) => deps.log(`devices: reconcile failed: ${String(thrown)}`));
    for (const d of catalog.devices) {
      const m = s.marks[d.id];
      const host = hostOf(catalog, d.host);
      if (d.mode !== "spawn" || d.platform !== "ios" || m?.udid === undefined || host === undefined) continue;
      if (s.leases.some((l) => l.resource === d.id) || m.lastUsedAt === undefined || now - m.lastUsedAt < RULES.spawnedKeepMs) continue;
      if (health[host.id]?.state !== "up") continue;
      const udid = m.udid;
      await deps.hosts
        .deleteSimulator(host, udid)
        .then(() =>
          mark(d.id, (x) => {
            // Its paired watch went with it (deleteSimulator deletes the pair).
            const { udid: _deleted, watchUdid: _watch, ...rest } = x ?? {};
            return rest;
          }),
        )
        .catch((thrown: unknown) => deps.log(`devices: deleting ${d.id} (${udid}) failed: ${String(thrown)}`));
    }
  };

  /**
   * The broker itself works: its catalog loaded and its state reads. A host that is down is not a
   * fault of the broker (a laptop sleeps), so it is reported and never makes this not ok.
   */
  const healthCheck = async (tenant: Tenant = DEFAULT_TENANT) => {
    configured();
    const s = await current();
    const seen = visibleTo(catalog, tenant);
    return {
      ok: true,
      broker: catalog.box,
      ...(deps.catalogNote === undefined ? {} : { note: deps.catalogNote }),
      hosts: seen.hosts.map((h) => ({ id: h.id, state: health[h.id]?.state ?? "unknown", ...(health[h.id]?.reason === undefined ? {} : { reason: health[h.id]?.reason }) })),
      devices: seen.devices.length,
      leases: s.leases.filter((l) => l.tenant === tenant).length,
      queued: s.tickets.filter((t) => t.granted === undefined && t.tenant === tenant).length,
    };
  };

  const healthNow = (): Readonly<Record<string, HostHealth>> => ({ ...Object.fromEntries(catalog.hosts.map((h) => [h.id, unknownHealth(0)])), ...health });

  return { acquire, wait, renew, pause: pauseForPerson, resume: resumeFromPerson, release, report, clear, status, tick, healthCheck, health: healthNow, state: current };
};

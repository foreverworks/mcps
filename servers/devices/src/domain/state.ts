/**
 * Who holds what, and the rules that end a hold. Pure: every function takes
 * the state and the time and returns the next state, so the rules are tested
 * without a clock, a file or a phone.
 */
import { DEFAULT_TENANT, variantsOf, type Device, type Platform, type Tenant, type Variant } from "./catalog.js";

/** What an agent asks for. A device by platform (and optionally a profile), or a host's build slot. */
export type Want =
  | { readonly kind: "device"; readonly platform: Platform; readonly profile?: string; readonly maestro?: boolean }
  | { readonly kind: "builder"; readonly platform: Platform };

export type Priority = "interactive" | "background";

export type Lease = {
  readonly id: string;
  /** A device id from the catalog, or a builder id (`builder:<platform>@<host>`). */
  readonly resource: string;
  readonly kind: "device" | "builder";
  readonly platform: Platform;
  /** The tenant that holds it (from its token): a lease is (tenant, session), never the session alone. */
  readonly tenant: Tenant;
  /** The session that holds it: the id its client sends on every call (the README's session contract). */
  readonly session: string;
  readonly purpose: string;
  readonly grantedAt: number;
  /** The last call that proved the holder alive (acquire, renew, wait, a wrapper's touch). */
  readonly lastSeenAt: number;
  /** The hard end: renewals move it, never past grantedAt + RULES.maxMs. */
  readonly until: number;
  /** A queued request granted this; it must be claimed by a wait before this, or it goes back. */
  readonly claimBy?: number;
  /** The broker started this device for the lease (a spawn slot), so it stops it after. */
  readonly spawned?: boolean;
  /** A device lease: the profile it was granted with. Absent in state saved before variants: the device's own (leaseVariant). */
  readonly profile?: string;
  /** An emulator slot's lease: the instance its grant starts and its end stops. Absent as `profile` is. */
  readonly instance?: string;
  /**
   * A person has the device (pause): the lease holds without its holder's calls until `until`, then
   * ends as a silent holder's does. `at` is when the pause began; `note` says who and why.
   */
  readonly paused?: { readonly at: number; readonly until: number; readonly note: string };
};

export type Ticket = {
  readonly id: string;
  readonly want: Want;
  readonly tenant: Tenant;
  readonly session: string;
  readonly purpose: string;
  readonly priority: Priority;
  readonly minutes: number;
  readonly createdAt: number;
  readonly polledAt: number;
  /** The lease the queue granted, waiting for this ticket's holder to claim it. */
  readonly granted?: string;
};

/** What the broker remembers about a device beyond its leases. */
export type DeviceMark = {
  /** Taken out of service: a holder released it broken, or a health check failed. */
  readonly quarantined?: { readonly at: number; readonly note: string; readonly by: string };
  /** Being reset or stopped after a lease; not grantable until done. */
  readonly busy?: { readonly since: number; readonly what: string };
  /** A spawned simulator's UDID, once created. */
  readonly udid?: string;
  /** Its paired watch's UDID, once created and paired, where its spec has a watch. */
  readonly watchUdid?: string;
  /** The last time a lease on it ended, for deleting spawned simulators nobody used for days. */
  readonly lastUsedAt?: number;
  /** An emulator the broker asked its host to start, and has not stopped since. */
  readonly startedAt?: number;
  /** When that emulator answered adb as a `device` with its boot completed: the lease's device is ready. */
  readonly readyAt?: number;
  /** When the broker last stopped it: a probe older than this still shows it running. */
  readonly stoppedAt?: number;
};

/** What happened, and to whose device: status shows a tenant only its own (an event with no tenant is the default tenant's). */
export type Event = { readonly at: number; readonly text: string; readonly tenant?: Tenant };

/**
 * A lease that ended because the slot started for it failed before it booted (its unit failed), kept so
 * that its session is told on its next acquire, instead of being handed another device without a word.
 */
export type Failure = {
  /** The lease as it ended: its tenant, session, platform and variant are what the notice is for. */
  readonly lease: Lease;
  /** In the unit's words: `batocera-1 did not start: its unit (bato1) failed (timeout)`. */
  readonly reason: string;
  readonly at: number;
};

export type BrokerState = {
  readonly seq: number;
  readonly leases: readonly Lease[];
  readonly tickets: readonly Ticket[];
  readonly marks: Readonly<Record<string, DeviceMark>>;
  /** The last few things that happened, newest last, for status. */
  readonly events: readonly Event[];
  /** Failed starts not yet told to their session. Absent in state saved before them: none. */
  readonly failures?: readonly Failure[];
};

export const emptyState = (): BrokerState => ({ seq: 0, leases: [], tickets: [], marks: {}, events: [], failures: [] });

const MINUTE = 60_000;

/** The rules, in one place; the README names the same numbers. */
export const RULES = {
  /** A lease whose holder made no call for this long ends: a dead session frees its device. */
  idleMs: 20 * MINUTE,
  /** A lease's first length when the request names none. */
  defaultMinutes: 45,
  /** A builder lease's first length: a build, not a working session. */
  builderMinutes: 30,
  /** No lease outlives this, however often it is renewed. */
  maxMs: 4 * 60 * MINUTE,
  /** A pause's length when the call names none. */
  pauseDefaultMinutes: 60,
  /** No pause lasts longer than this per call. */
  maxPauseMs: 4 * 60 * MINUTE,
  /** No lease outlives this, paused or not: an abandoned pause frees its device. */
  maxHeldMs: 8 * 60 * MINUTE,
  /** A queue ticket nobody polled for this long is dropped: a session that died waiting. */
  ticketTtlMs: 2 * MINUTE,
  /** A queued grant must be claimed this soon, or the next in line gets the device. */
  claimMs: 5 * MINUTE,
  /** A failed start is told to its session's next acquire within this long, then forgotten. */
  failureNoticeMs: 10 * MINUTE,
  /** A spawned simulator unused this long is deleted. */
  spawnedKeepMs: 7 * 24 * 60 * MINUTE,
  /** Events kept for status. */
  events: 40,
} as const;

/** How a lease ends, which decides what happens to the device afterwards. */
export type EndState = "clean" | "dirty" | "broken";

export type Ended = { readonly lease: Lease; readonly state: EndState; readonly reason: string };

export const nextId = (state: BrokerState, prefix: string): { readonly id: string; readonly state: BrokerState } => {
  const seq = state.seq + 1;
  return { id: `${prefix}-${seq}`, state: { ...state, seq } };
};

export const withEvent = (state: BrokerState, at: number, text: string, tenant: Tenant = DEFAULT_TENANT): BrokerState => ({
  ...state,
  events: [...state.events, { at, text, ...(tenant === DEFAULT_TENANT ? {} : { tenant }) }].slice(-RULES.events),
});

export const eventTenant = (e: Event): Tenant => e.tenant ?? DEFAULT_TENANT;

export const sameWant = (a: Want, b: Want): boolean => a.kind === b.kind && a.platform === b.platform;

/** Whether a lease or ticket is this caller's: the same tenant AND the same session. */
export const isCallers = (x: { readonly tenant: Tenant; readonly session: string }, tenant: Tenant, session: string): boolean =>
  x.tenant === tenant && x.session === session;

/**
 * Whether a lease is this caller's for this kind of thing: one per tenant and session per platform and
 * form (`sameForm`, which knows the catalog: a phone and its watch are two).
 */
export const isFor = (lease: Lease, tenant: Tenant, session: string, want: Want, sameForm: (lease: Lease) => boolean = () => true): boolean =>
  isCallers(lease, tenant, session) && lease.kind === want.kind && lease.platform === want.platform && sameForm(lease);

/** The lease this caller already holds for this kind of thing, if any (`isFor`). */
export const heldBy = (state: BrokerState, tenant: Tenant, session: string, want: Want, sameForm: (lease: Lease) => boolean = () => true): Lease | undefined =>
  state.leases.find((l) => isFor(l, tenant, session, want, sameForm));

/**
 * When a lease ends if nothing else happens: its hard end, or its holder going quiet, or an unclaimed
 * grant; a paused lease, when its pause runs out, whatever its holder does meanwhile.
 */
export const endsAt = (lease: Lease): number =>
  lease.paused !== undefined ? lease.paused.until : Math.min(lease.until, lease.lastSeenAt + RULES.idleMs, lease.claimBy ?? Infinity);

export const clampMinutes = (minutes: number): number => Math.max(1, Math.min(Math.round(minutes), RULES.maxMs / MINUTE));

/**
 * The variant a device lease runs: the one it was granted with, or the device's own for a lease saved
 * before variants (or whose variant a changed catalog no longer has).
 */
export const leaseVariant = (device: Device, lease: Lease): Variant => {
  const all = variantsOf(device);
  const recorded = lease.instance !== undefined ? all.find((v) => v.instance === lease.instance) : lease.profile !== undefined ? all.find((v) => v.profile === lease.profile) : undefined;
  return recorded ?? all[0];
};

export const grant = (
  state: BrokerState,
  input: {
    readonly resource: string;
    readonly want: Want;
    readonly tenant: Tenant;
    readonly session: string;
    readonly purpose: string;
    readonly minutes: number;
    readonly now: number;
    readonly spawned: boolean;
    readonly claim: boolean;
    /** What a device lease runs (placement's choice); a build slot has none. */
    readonly variant?: Variant;
  },
): { readonly lease: Lease; readonly state: BrokerState } => {
  const { id, state: next } = nextId(state, "ls");
  const base = {
    id,
    resource: input.resource,
    kind: input.want.kind,
    platform: input.want.platform,
    tenant: input.tenant,
    session: input.session,
    purpose: input.purpose,
    grantedAt: input.now,
    lastSeenAt: input.now,
    until: input.now + clampMinutes(input.minutes) * MINUTE,
  };
  const lease: Lease = {
    ...base,
    ...(input.claim ? { claimBy: input.now + RULES.claimMs } : {}),
    ...(input.spawned ? { spawned: true } : {}),
    ...(input.variant === undefined ? {} : { profile: input.variant.profile, ...(input.variant.instance === undefined ? {} : { instance: input.variant.instance }) }),
  };
  return { lease, state: withEvent({ ...next, leases: [...next.leases, lease] }, input.now, `${input.resource} to ${short(input.session)} (${input.purpose})`, input.tenant) };
};

/** A holder's call: the lease is alive, and its end moves to now + minutes, capped at the 4-hour limit. */
export const touch = (lease: Lease, now: number, minutes?: number): Lease => {
  const cap = lease.grantedAt + RULES.maxMs;
  const until = minutes === undefined ? lease.until : Math.min(now + clampMinutes(minutes) * MINUTE, cap);
  const { claimBy: _claimed, ...rest } = lease;
  // Never shorter than it was: a resumed lease may run past the 4-hour mark (resume), and a renewal does not cut it.
  return { ...rest, lastSeenAt: now, until: Math.max(until, lease.until) };
};

/**
 * A person takes the device over: the lease holds for `minutes` (at most RULES.maxPauseMs) without its
 * holder's calls, never past RULES.maxHeldMs after its grant. Pausing a paused lease moves its end and
 * keeps when the pause began. Undefined when the lease has already been held that long.
 */
export const pauseLease = (lease: Lease, now: number, minutes: number, note: string): Lease | undefined => {
  const until = Math.min(now + Math.min(clampMinutes(minutes) * MINUTE, RULES.maxPauseMs), lease.grantedAt + RULES.maxHeldMs);
  if (until <= now) return undefined;
  const { claimBy: _claimed, ...rest } = lease;
  return { ...rest, lastSeenAt: now, paused: { at: lease.paused?.at ?? now, until, note } };
};

/**
 * The holder takes the device back: the lease is an ordinary one again, its idle clock starting now,
 * and it lasts at least the idle window, so a pause that ran past its time limit leaves the holder
 * time to finish or release (never past RULES.maxHeldMs after the grant). A lease not paused is
 * touched and otherwise left as it is.
 */
export const resumeLease = (lease: Lease, now: number): Lease => {
  const { paused: _paused, claimBy: _claimed, ...rest } = lease;
  if (lease.paused === undefined) return { ...rest, lastSeenAt: now };
  return { ...rest, lastSeenAt: now, until: Math.min(Math.max(lease.until, now + RULES.idleMs), lease.grantedAt + RULES.maxHeldMs) };
};

export const replaceLease = (state: BrokerState, lease: Lease): BrokerState => ({
  ...state,
  leases: state.leases.map((l) => (l.id === lease.id ? lease : l)),
});

export const endLease = (state: BrokerState, lease: Lease, endState: EndState, reason: string, now: number): { readonly state: BrokerState; readonly ended: Ended } => {
  const marks = lease.kind === "device" ? { ...state.marks, [lease.resource]: { ...state.marks[lease.resource], lastUsedAt: now } } : state.marks;
  const tickets = state.tickets.filter((t) => t.granted !== lease.id);
  const next = withEvent({ ...state, leases: state.leases.filter((l) => l.id !== lease.id), tickets, marks }, now, `${lease.resource} back from ${short(lease.session)}: ${reason} (${endState})`, lease.tenant);
  return { state: next, ended: { lease, state: endState, reason } };
};

/**
 * The slot started for a lease failed before it booted (`what`: its unit failed, in the unit's words): the
 * lease ends at once, as a clean one (its holder never had a device to change), and the failure waits for
 * its session's next acquire of the same platform and form.
 */
export const failLease = (state: BrokerState, lease: Lease, what: string, now: number): { readonly state: BrokerState; readonly ended: Ended } => {
  const r = endLease(state, lease, "clean", `did not start: ${what}`, now);
  const failure: Failure = { lease, reason: `${lease.resource} did not start: ${what}`, at: now };
  return { state: { ...r.state, failures: [...(r.state.failures ?? []), failure] }, ended: r.ended };
};

/** The failure `which` picks, taken out of the state: a failed start is told once. */
export const takeFailure = (state: BrokerState, which: (f: Failure) => boolean): { readonly failure: Failure; readonly state: BrokerState } | undefined => {
  const all = state.failures ?? [];
  const failure = all.find(which);
  return failure === undefined ? undefined : { failure, state: { ...state, failures: all.filter((f) => f !== failure) } };
};

/**
 * Everything the clock ends: leases past their end (silent holders are reset,
 * an unclaimed queue grant goes back clean), tickets nobody polls, and failed
 * starts nobody asked about in time.
 */
export const expire = (state: BrokerState, now: number): { readonly state: BrokerState; readonly ended: readonly Ended[] } => {
  let next = state;
  const ended: Ended[] = [];
  for (const lease of state.leases) {
    if (endsAt(lease) > now) continue;
    const unclaimed = lease.claimBy !== undefined && lease.claimBy <= now;
    const reason = unclaimed
      ? "queued grant never claimed"
      : lease.paused !== undefined
        ? `its pause for a person ran out (${lease.paused.note})`
        : lease.until <= now
          ? "time limit reached"
          : `holder silent for ${Math.round(RULES.idleMs / MINUTE)} min`;
    const result = endLease(next, lease, unclaimed ? "clean" : "dirty", reason, now);
    next = result.state;
    ended.push(result.ended);
  }
  const stale = next.tickets.filter((t) => t.granted === undefined && now - t.polledAt > RULES.ticketTtlMs);
  if (stale.length > 0) {
    next = { ...next, tickets: next.tickets.filter((t) => !stale.includes(t)) };
    for (const tenant of [...new Set(stale.map((t) => t.tenant))]) {
      const dropped = stale.filter((t) => t.tenant === tenant).length;
      next = withEvent(next, now, `${dropped} queue ticket(s) dropped: not polled for ${Math.round(RULES.ticketTtlMs / MINUTE)} min`, tenant);
    }
  }
  const failures = next.failures ?? [];
  const kept = failures.filter((f) => now - f.at < RULES.failureNoticeMs);
  if (kept.length < failures.length) next = { ...next, failures: kept };
  return { state: next, ended };
};

/** Waiting tickets in the order the queue serves them: interactive first, then by arrival. */
export const queueOrder = (tickets: readonly Ticket[]): readonly Ticket[] =>
  [...tickets]
    .filter((t) => t.granted === undefined)
    .sort((a, b) => (a.priority === b.priority ? a.createdAt - b.createdAt : a.priority === "interactive" ? -1 : 1));

/** 1-based place of a ticket among its tenant's tickets waiting for the same kind of thing. */
export const positionOf = (state: BrokerState, ticket: Ticket): number =>
  queueOrder(state.tickets)
    .filter((t) => t.tenant === ticket.tenant && sameWant(t.want, ticket.want))
    .findIndex((t) => t.id === ticket.id) + 1;

/** A session id is usually a UUID; its head is enough to tell holders apart in a status line. */
export const short = (session: string): string => (session.length > 13 ? session.slice(0, 13) : session);

/**
 * State as a new process finds it: a busy mark left by the previous one names work that died with
 * it, and would hold its device out of service forever. An emulator it left running is stopped by
 * the broker's next reconcile; a simulator it left booted is shut down after its next lease.
 */
export const withoutStaleWork = (state: BrokerState, now: number): BrokerState => {
  const stale = Object.entries(state.marks).filter(([, m]) => m.busy !== undefined).map(([id]) => id);
  if (stale.length === 0) return state;
  const marks = Object.fromEntries(
    Object.entries(state.marks).map(([id, m]) => {
      const { busy: _cut, ...rest } = m;
      return [id, rest];
    }),
  );
  return withEvent({ ...state, marks }, now, `broker restarted during after-lease work on ${stale.join(", ")}`);
};

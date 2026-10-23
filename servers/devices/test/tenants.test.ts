/**
 * Pool slots and the tenant boundary. The broker is a security boundary between tenants: a guest sees,
 * leases, releases, reports and clears only its own slots and learns nothing of anyone else's (device ids,
 * addresses, sessions, purposes); the default tenant never leases a guest's slot. The tenant comes from the token
 * (domain/tenant.ts), so every test below calls as a tenant, the way the MCP layer does.
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_TENANT } from "../src/domain/catalog.js";
import { tenantOfClient } from "../src/domain/tenant.js";
import { as, bootAll, GUEST, makeWorld, POOL, POOL_SLOTS, rawBrokerFor, settled } from "./fakes.js";

const A = "session-a-0000000000";
const B = "session-b-0000000000";
const C = "session-c-0000000000";
const D = "session-d-0000000000";
const E = "session-e-0000000000";
const G = "guest-session-000000";
const android = { kind: "device", platform: "android" } as const;
const ios = { kind: "device", platform: "ios" } as const;

const pool = () => {
  const world = makeWorld(POOL_SLOTS);
  const raw = rawBrokerFor(world, POOL);
  return { world, ours: as(raw, DEFAULT_TENANT), guest: as(raw, GUEST), stranger: as(raw, tenantOfClient("guest-")) };
};

/** Everything a tenant is shown, as one string: what it must not contain is checked against this. */
const shown = (x: unknown): string => JSON.stringify(x);

describe("the tenant comes from the token's client label", () => {
  it("maps guest-<id> to that guest and every other label to the default tenant", () => {
    expect(tenantOfClient("agent")).toBe(DEFAULT_TENANT);
    expect(tenantOfClient("legacy")).toBe(DEFAULT_TENANT);
    expect(tenantOfClient("stdio")).toBe(DEFAULT_TENANT);
    expect(tenantOfClient("guest-acme")).toBe("guest:acme");
  });

  it("gives a malformed guest label a tenant that owns nothing, never the default tenant", () => {
    for (const label of ["guest", "guest-", "guest-Acme", "guest-acme-phone", "guest:acme"]) {
      expect(tenantOfClient(label)).not.toBe(DEFAULT_TENANT);
      expect(tenantOfClient(label)).toMatch(/^guest:!/);
    }
  });
});

describe("pool slots", () => {
  it("starts a slot of the default tenant, reads its boot through its door, and gives its holder the door's address", async () => {
    const { world, ours } = pool();
    const r = await ours.acquire({ want: android, session: A, purpose: "flows" });
    expect(r).toMatchObject({ status: "granted", resource: "pool1", state: "booting", address: { env: { ANDROID_SERIAL: "127.0.0.1:16000", ANDROID_ADB_SERVER_PORT: "16100" } } });
    expect(world.calls).toEqual(["start pool1"]);
    bootAll(world);
    expect(await ours.acquire({ want: android, session: A, purpose: "flows" })).toMatchObject({ status: "held", state: "ready" });
  });

  it("clears a dirty holder's apps through the slot's door, then stops it", async () => {
    const { world, ours } = pool();
    await ours.acquire({ want: android, session: A, purpose: "a" });
    bootAll(world);
    await ours.acquire({ want: android, session: A, purpose: "a" });
    await ours.release({ session: A, want: android, state: "dirty" });
    await settled();
    expect(world.calls).toEqual(["start pool1", "clear door 16000", "stop pool1"]);
  });

  it("gives four sessions the default tenant's four slots and queues the fifth: never the guest's slot", async () => {
    const { world, ours } = pool();
    const got = [];
    for (const s of [A, B, C, D]) got.push(await ours.acquire({ want: android, session: s, purpose: s }));
    expect(got.map((g) => (g as { resource: string }).resource)).toEqual(["pool1", "pool2", "pool3", "pool4"]);
    const fifth = await ours.acquire({ want: android, session: E, purpose: "e" });
    expect(fifth).toMatchObject({ status: "queued", position: 1 });
    expect(shown(fifth)).not.toMatch(/acmephone|16001/);
    expect(world.calls).not.toContain("start acmephone");
  });

  it("reads a guest slot's boot from its unit, since its door is the guest's alone", async () => {
    const { world, guest } = pool();
    expect(await guest.acquire({ want: android, session: G, purpose: "look" })).toMatchObject({ status: "granted", resource: "acmephone", state: "booting" });
    bootAll(world);
    await guest.tick();
    expect(await guest.acquire({ want: android, session: G, purpose: "look" })).toMatchObject({ status: "held", state: "ready", address: { env: { ANDROID_SERIAL: "127.0.0.1:16001" } } });
  });

  it("stops every slot it finds running with no lease, whoever's it is", async () => {
    const { world, ours } = pool();
    world.emulators = { pool1: "device", acmephone: "device", pool2: "stopped", pool3: "booting", pool4: "stopped" };
    await ours.tick();
    await settled();
    expect([...world.calls].sort()).toEqual(["stop acmephone", "stop pool1", "stop pool3"]);
  });
});

describe("a guest sees and touches only its own slots", () => {
  /** The default tenant holds every slot it has, with a ticket in its queue; the guest holds its own. */
  const busy = async () => {
    const p = pool();
    // Room for all five: the host's memory is one budget across tenants (the next test shows the guest refused without it).
    p.world.android = { memAvailableMiB: 80_000, load: 1 };
    const leases = [];
    for (const s of [A, B, C, D]) leases.push((await p.ours.acquire({ want: android, session: s, purpose: `our work ${s}` })) as { lease: string; resource: string });
    const ticket = (await p.ours.acquire({ want: android, session: E, purpose: "our queue" })) as { ticket: string };
    await p.ours.acquire({ want: ios, session: A, purpose: "our ios" });
    const mine = (await p.guest.acquire({ want: android, session: G, purpose: "guest work" })) as { lease: string };
    return { ...p, leases, ticket, mine };
  };

  it("is shown its own slot and host only: no other tenant's device, address, session, purpose, build slot or event", async () => {
    const { guest } = await busy();
    const s = (await guest.status({ session: G })) as { tenant: string; devices: { id: string }[]; hosts: { id: string }[]; mine: unknown[]; builders: unknown[]; queue: unknown[] };
    expect(s.tenant).toBe(GUEST);
    expect(s.devices.map((d) => d.id)).toEqual(["acmephone"]);
    expect(s.hosts.map((h) => h.id)).toEqual(["emu-1"]);
    expect(s.mine).toHaveLength(1);
    expect(s.builders).toEqual([]);
    expect(s.queue).toEqual([]);
    expect(shown(s)).not.toMatch(/pool1|pool[234]|16000|16002|16003|16004|dev-iphone|mac-1|session-[a-e]|our work|our queue|our ios/);
    const h = await guest.healthCheck();
    expect(h).toMatchObject({ devices: 1, leases: 1, queued: 0 });
    expect(shown(h)).not.toMatch(/mac-1/);
  });

  it("cannot take the default tenant's device or a build slot, and is told only that it has none", async () => {
    const { guest } = await busy();
    const r = await guest.acquire({ want: ios, session: G, purpose: "an iPhone" });
    expect(r).toMatchObject({ status: "unavailable" });
    expect(shown(r)).not.toMatch(/dev-iphone|spare-iphone|mac-1/);
    expect(await guest.acquire({ want: { kind: "builder", platform: "android" }, session: G, purpose: "build" })).toMatchObject({ status: "unavailable" });
  });

  it("cannot renew, release, report or clear another tenant's lease or device, even with its session id", async () => {
    const { world, guest, ours, leases } = await busy();
    const ourLease = leases[0] as { lease: string };
    // By lease id: answered as a lease that does not exist (not "another session's": that would confirm it).
    for (const call of [() => guest.release({ session: G, lease: ourLease.lease, state: "clean" }), () => guest.renew({ session: G, lease: ourLease.lease })]) {
      await expect(call()).rejects.toMatchObject({ error: { message: expect.stringMatching(/^no lease /) } });
    }
    // Claiming the other holder's session: still the guest's tenant, which holds nothing of that session's.
    await expect(guest.release({ session: A, want: android, state: "clean" })).rejects.toMatchObject({ error: { message: expect.stringMatching(/holds no device android lease/) } });
    for (const call of [() => guest.report({ session: G, device: "pool1", note: "x" }), () => guest.clear({ session: G, device: "pool1", note: "x" })]) {
      await expect(call()).rejects.toMatchObject({ error: { message: "no device pool1 in the catalog" } });
    }
    // Nothing of the default tenant's moved.
    expect(((await ours.status({ session: A })) as { mine: unknown[] }).mine).toHaveLength(2);
    expect(world.calls.filter((c) => c.startsWith("stop"))).toEqual([]);
  });

  it("cannot poll another tenant's queue ticket", async () => {
    const { guest, ticket } = await busy();
    await expect(guest.wait({ ticket: ticket.ticket, session: E, seconds: 0 })).rejects.toMatchObject({ error: { message: expect.stringMatching(/^no ticket /) } });
  });

  it("has its own lease under a session id the default tenant also uses: the two never meet", async () => {
    const { ours, guest } = pool();
    const f = await ours.acquire({ want: android, session: A, purpose: "ours" });
    const g = await guest.acquire({ want: android, session: A, purpose: "guest" });
    expect([(f as { resource: string }).resource, (g as { resource: string }).resource]).toEqual(["pool1", "acmephone"]);
    expect(await guest.release({ session: A, want: android, state: "clean" })).toMatchObject({ resource: "acmephone" });
    expect(((await ours.status({ session: A })) as { mine: { resource: string }[] }).mine.map((l) => l.resource)).toEqual(["pool1"]);
  });
});

describe("a host's memory is one budget for every tenant", () => {
  it("refuses a guest's slot when the default tenant's slots use the headroom, and says why without naming them", async () => {
    const { ours, guest } = pool();
    for (const s of [A, B, C, D]) await ours.acquire({ want: android, session: s, purpose: s });
    const r = await guest.acquire({ want: android, session: G, purpose: "guest work" });
    expect(r).toMatchObject({ status: "unavailable" });
    expect((r as { reason: string }).reason).toMatch(/GiB available/);
    expect(shown(r)).not.toMatch(/pool1|pool[234]|session-[a-d]/);
  });
});

describe("the default tenant never takes or touches a guest's slot", () => {
  it("cannot release, report or clear it, nor see its holder", async () => {
    const { ours, guest } = pool();
    const g = (await guest.acquire({ want: android, session: G, purpose: "guest work" })) as { lease: string };
    await expect(ours.release({ session: A, lease: g.lease, state: "clean" })).rejects.toMatchObject({ error: { message: expect.stringMatching(/^no lease /) } });
    await expect(ours.report({ session: A, device: "acmephone", note: "x" })).rejects.toMatchObject({ error: { message: "no device acmephone in the catalog" } });
    await expect(ours.clear({ session: A, device: "acmephone", note: "x" })).rejects.toBeDefined();
    const s = await ours.status({ session: A });
    expect(shown(s)).not.toMatch(/acmephone|16001|guest-session|guest work/);
  });
});

describe("a malformed guest token", () => {
  it("owns nothing and sees nothing", async () => {
    const { stranger, ours } = pool();
    await ours.acquire({ want: android, session: A, purpose: "ours" });
    expect(await stranger.acquire({ want: android, session: A, purpose: "x" })).toMatchObject({ status: "unavailable" });
    const s = (await stranger.status({ session: A })) as { devices: unknown[]; hosts: unknown[]; mine: unknown[] };
    expect([s.devices, s.hosts, s.mine]).toEqual([[], [], []]);
  });
});

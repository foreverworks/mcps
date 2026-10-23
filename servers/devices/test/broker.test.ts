import { asGuardError, idempotentWrites, inCall } from "@foreverworks/mcp-kit";
import { describe, expect, it } from "vitest";

import { emptyCatalog } from "../src/domain/catalog.js";
import { RULES } from "../src/domain/state.js";
import { POLICY } from "../src/mcp/policy.js";
import {
  as,
  BATOCERA,
  BATOCERA_INSTANCES,
  bootAll,
  BOX,
  BOX_EPHEMERAL,
  brokerFor,
  CATALOG,
  DESKTOP_INSTANCES,
  DESKTOPS,
  GEAR,
  GUEST,
  makeWorld,
  POOL_VARIANT_SLOTS,
  POOL_VARIANTS,
  rawBrokerFor,
  SCREENSHOT,
  settled,
  VARIANT_INSTANCES,
  VARIANTS,
  VM,
  WATCH,
  WATCH_INSTANCES,
} from "./fakes.js";

const A = "session-a-0000000000";
const B = "session-b-0000000000";
const C = "session-c-0000000000";
const D = "session-d-0000000000";
const E = "session-e-0000000000";
const android = { kind: "device", platform: "android" } as const;
const ios = { kind: "device", platform: "ios" } as const;

describe("acquire", () => {
  it("starts an emulator for the lease, says booting, then ready once adb has it booted", async () => {
    const world = makeWorld();
    const broker = brokerFor(world);
    const r = await broker.acquire({ want: android, session: A, purpose: "flows" });
    expect(r).toMatchObject({ status: "granted", resource: "emulator-5554", spawned: true, state: "booting", address: { env: { ANDROID_SERIAL: "emulator-5554", ANDROID_ADB_SERVER_PORT: "5037" } } });
    expect((r as { next: string }).next).toMatch(/booting/);
    expect(world.calls).toEqual(["start phone1"]);
    // adb lists it offline while it boots: still booting.
    expect(await broker.acquire({ want: android, session: A, purpose: "flows" })).toMatchObject({ status: "held", state: "booting" });
    bootAll(world);
    expect(await broker.acquire({ want: android, session: A, purpose: "flows" })).toMatchObject({ status: "held", state: "ready" });
    // Asking again never starts it twice.
    expect(world.calls).toEqual(["start phone1"]);
    const s = (await broker.status({})) as { devices: { id: string; status: string }[]; recent: string[] };
    expect(s.devices.find((d) => d.id === "emulator-5554")?.status).toBe("leased");
    expect(s.recent.join("\n")).toMatch(/emulator-5554 booted in/);
  });

  it("waits for the boot when asked, telling the caller the seconds so far, and answers ready", async () => {
    const world = makeWorld();
    const broker = brokerFor(world);
    const heard: unknown[] = [];
    const r = await inCall(
      {
        progress: (progress, total, message) => {
          heard.push({ progress, total, message });
          // The emulator finishes booting while the caller waits, after the second look.
          if (heard.length === 2) bootAll(world);
        },
      },
      () => broker.acquire({ want: android, session: A, purpose: "flows", untilBooted: 120 }),
    );
    expect(r).toMatchObject({ status: "granted", resource: "emulator-5554", state: "ready" });
    expect(heard).toEqual([
      { progress: 0, total: 120, message: "emulator-5554 is booting on emu-1: 0 s so far" },
      { progress: 3, total: 120, message: "emulator-5554 is booting on emu-1: 3 s so far" },
    ]);
  });

  it("answers booting when the boot outlasts until_booted, and stops waiting when the caller cancels", async () => {
    const world = makeWorld();
    const broker = brokerFor(world);
    expect(await broker.acquire({ want: android, session: A, purpose: "flows", untilBooted: 10 })).toMatchObject({ status: "granted", state: "booting" });
    const controller = new AbortController();
    controller.abort();
    const thrown = await inCall({ signal: controller.signal }, () => broker.acquire({ want: android, session: A, purpose: "flows", untilBooted: 60 })).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(asGuardError(thrown)).toMatchObject({ kind: "cancelled", message: expect.stringContaining("the lease is yours") });
    expect(await broker.acquire({ want: android, session: A, purpose: "flows" })).toMatchObject({ status: "held", state: "booting" });
  });

  it("extends a held lease each time the session asks again, as the wrappers do on every call", async () => {
    const world = makeWorld();
    const broker = brokerFor(world);
    await broker.acquire({ want: android, session: A, purpose: "flows" });
    for (let i = 0; i < 6; i++) {
      world.clock += 15 * 60_000;
      expect(await broker.acquire({ want: android, session: A, purpose: "flows" })).toMatchObject({ status: "held", resource: "emulator-5554" });
    }
  });

  it("returns the lease a session already holds instead of a second device", async () => {
    const broker = brokerFor(makeWorld());
    const first = await broker.acquire({ want: android, session: A, purpose: "flows" });
    const again = await broker.acquire({ want: android, session: A, purpose: "flows" });
    expect(again.status).toBe("held");
    expect(again).toMatchObject({ lease: (first as { lease: string }).lease });
  });

  it("gives four sessions four emulators and queues the fifth", async () => {
    const world = makeWorld();
    const broker = brokerFor(world);
    const got = [];
    for (const s of [A, B, C, D]) got.push(await broker.acquire({ want: android, session: s, purpose: s }));
    expect(got.map((g) => (g as { resource: string }).resource)).toEqual(["emulator-5554", "emulator-5556", "emulator-5558", "emulator-5560"]);
    expect(world.calls).toEqual(["start phone1", "start phone2", "start phone3", "start phone4"]);
    const fifth = await broker.acquire({ want: android, session: E, purpose: "e" });
    expect(fifth).toMatchObject({ status: "queued", position: 1 });
    expect((fifth as { reason: string }).reason).toMatch(/emulator-5560 is leased to session-d/);
  });

  it("counts the emulators started since the last probe against its host's memory, and queues past it", async () => {
    const world = makeWorld();
    world.android = { memAvailableMiB: 22_528, load: 3 };
    const broker = brokerFor(world);
    expect(await broker.acquire({ want: android, session: A, purpose: "a" })).toMatchObject({ status: "granted" });
    // 22 GiB less the 6 the first one will take leaves 16: one more would leave 10, under the 12 kept free.
    expect(await broker.acquire({ want: android, session: B, purpose: "b" })).toMatchObject({ status: "queued" });
    const s = (await broker.status({})) as { queue: unknown[] };
    expect(s.queue).toHaveLength(1);
  });

  it("does not start an emulator when its host is short of memory, and says why", async () => {
    const world = makeWorld();
    world.android = { memAvailableMiB: 16_000, load: 6 };
    const broker = brokerFor(world);
    const r = await broker.acquire({ want: android, session: A, purpose: "a" });
    expect(r.status).toBe("unavailable");
    expect((r as { reason: string }).reason).toMatch(/GiB available/);
    expect(world.calls).toEqual([]);
  });

  it("says why when its host will not start the emulator, and frees the slot", async () => {
    const world = makeWorld();
    world.startFails = true;
    const broker = brokerFor(world);
    const r = await broker.acquire({ want: android, session: A, purpose: "a" });
    expect(r).toMatchObject({ status: "unavailable" });
    expect((r as { reason: string }).reason).toMatch(/could not start emulator-5554: .*no answer from its service/);
    await settled();
    world.startFails = false;
    expect(await broker.acquire({ want: android, session: A, purpose: "a" })).toMatchObject({ status: "granted", resource: "emulator-5554" });
  });

  it("says the Mac is down instead of queueing forever", async () => {
    const world = makeWorld();
    world.mac = "down";
    const broker = brokerFor(world);
    const r = await broker.acquire({ want: ios, session: A, purpose: "a" });
    expect(r.status).toBe("unavailable");
    expect((r as { reason: string }).reason).toMatch(/asleep, off, or locked/);
    // Both of the Mac's leasable simulators are on it: its being down is said once.
    expect((r as { reason: string }).reason.match(/is down/g)).toHaveLength(1);
  });

  it("creates the spawn simulator the first time it is granted, and only on AC", async () => {
    const world = makeWorld();
    const broker = brokerFor(world);
    await broker.acquire({ want: ios, session: A, purpose: "a" });
    const b = await broker.acquire({ want: ios, session: B, purpose: "b" });
    expect(b).toMatchObject({ status: "granted", resource: "spare-iphone-1", address: { udid: "AAAAAAAA-0000-0000-0000-000000000001" } });
    expect(world.calls).toContain("create spare-iphone-1");

    const unplugged = makeWorld();
    unplugged.mac = { onAc: false, ciBusy: false, load: 1, desktop: false };
    const broker2 = brokerFor(unplugged);
    expect(await broker2.acquire({ want: ios, session: A, purpose: "a" })).toMatchObject({ status: "granted", resource: "dev-iphone" });
    const second = await broker2.acquire({ want: ios, session: B, purpose: "b" });
    expect(second.status).toBe("queued");
    expect((second as { reason: string }).reason).toMatch(/battery/);
  });

  it("never leases a reserved device", async () => {
    const world = makeWorld();
    const broker = brokerFor(world);
    const s = await broker.status({});
    expect((s as { devices: { id: string; status: string }[] }).devices.find((d) => d.id === "ci-iphone")?.status).toBe("reserved");
  });

  it("answers with the catalog's note on a box without devices", async () => {
    const world = makeWorld();
    const broker = brokerFor(world, emptyCatalog("broker-2"));
    expect(await broker.acquire({ want: ios, session: A, purpose: "a" })).toMatchObject({ status: "unavailable" });
  });
});

describe("queue", () => {
  const fourHeld = async (broker: ReturnType<typeof brokerFor>) => {
    for (const s of [A, B, C, D]) await broker.acquire({ want: android, session: s, purpose: s });
  };

  it("grants the waiting ticket once the released emulator has stopped, and starts it again for the claim", async () => {
    const world = makeWorld();
    const broker = brokerFor(world);
    await fourHeld(broker);
    const q = (await broker.acquire({ want: android, session: E, purpose: "e" })) as { status: string; ticket: string };
    expect(q.status).toBe("queued");
    expect(await broker.release({ session: A, want: android, state: "clean" })).toMatchObject({ then: "stopped" });
    await settled();
    expect(world.calls.slice(-1)).toEqual(["stop phone1"]);
    const w = await broker.wait({ ticket: q.ticket, session: E, seconds: 0 });
    expect(w).toMatchObject({ status: "granted", resource: "emulator-5554", session: E, state: "booting" });
    expect(w).not.toHaveProperty("claim_by");
    expect(world.calls.slice(-2)).toEqual(["stop phone1", "start phone1"]);
  });

  it("tells a caller waiting in the queue its place after each look", async () => {
    const world = makeWorld();
    const broker = brokerFor(world);
    await fourHeld(broker);
    const q = (await broker.acquire({ want: android, session: E, purpose: "e" })) as { ticket: string };
    const heard: unknown[] = [];
    const w = await inCall({ progress: (progress, total, message) => void heard.push({ progress, total, message }) }, () => broker.wait({ ticket: q.ticket, session: E, seconds: 4 }));
    expect(w).toMatchObject({ status: "queued", position: 1 });
    expect(heard[0]).toEqual({ progress: 0, total: 4, message: expect.stringMatching(/^number 1 in the queue.*, 0 s waited$/) });
    expect(heard).toHaveLength(2);
  });

  it("never hands a released emulator on before its stop has run", async () => {
    const world = makeWorld();
    const broker = brokerFor(world);
    await fourHeld(broker);
    const q = (await broker.acquire({ want: android, session: E, purpose: "e" })) as { ticket: string };
    let stopped = () => undefined as void;
    world.stopGate = new Promise((r) => (stopped = r));
    await broker.release({ session: A, want: android, state: "clean" });
    // The stop is still running: the device is stopping, so the ticket waits.
    const s = (await broker.status({})) as { devices: { id: string; status: string }[]; queue: unknown[] };
    expect(s.devices.find((d) => d.id === "emulator-5554")?.status).toBe("stopping");
    expect(s.queue).toHaveLength(1);
    expect(await broker.wait({ ticket: q.ticket, session: E, seconds: 0 })).toMatchObject({ status: "queued" });
    stopped();
    await settled();
    expect(await broker.wait({ ticket: q.ticket, session: E, seconds: 0 })).toMatchObject({ status: "granted", resource: "emulator-5554" });
  });

  it("serves interactive tickets before background ones", async () => {
    const world = makeWorld();
    const broker = brokerFor(world);
    await fourHeld(broker);
    const bg = (await broker.acquire({ want: android, session: E, purpose: "loop", priority: "background" })) as { ticket: string };
    world.clock += 1000;
    const fg = (await broker.acquire({ want: android, session: "session-f", purpose: "human" })) as { ticket: string; position: number };
    expect(fg.position).toBe(1);
    await broker.release({ session: A, want: android, state: "clean" });
    await settled();
    expect(await broker.wait({ ticket: fg.ticket, session: "session-f", seconds: 0 })).toMatchObject({ status: "granted" });
    expect(await broker.wait({ ticket: bg.ticket, session: E, seconds: 0 })).toMatchObject({ status: "queued", position: 1 });
  });

  it("drops a ticket nobody polls, and gives an unclaimed grant to the next in line", async () => {
    const world = makeWorld();
    const broker = brokerFor(world);
    await fourHeld(broker);
    await broker.acquire({ want: android, session: E, purpose: "e" });
    world.clock += 1000;
    const f = (await broker.acquire({ want: android, session: "session-f", purpose: "f" })) as { ticket: string };
    await broker.release({ session: A, want: android, state: "clean" });
    await settled();
    // Once phone1 has stopped, the queue grants it to E.
    expect(((await broker.status({})) as { devices: { id: string; status: string }[] }).devices[0]).toMatchObject({ id: "emulator-5554", status: "booting" });
    // E never claims; F keeps polling (and the other holders keep renewing).
    const answers: { status: string }[] = [];
    for (let i = 0; i < 4; i++) {
      world.clock += 90_000;
      for (const s of [B, C, D]) await broker.renew({ session: s, want: android });
      answers.push((await broker.wait({ ticket: f.ticket, session: "session-f", seconds: 0 })) as { status: string });
      await settled();
    }
    // Queued while E's grant waits to be claimed, granted once its five minutes are up. E's grant
    // never started the emulator, so it goes to F at once, with no stop in between.
    expect(answers.map((a) => a.status)).toEqual(["queued", "queued", "queued", "granted"]);
    expect(answers.at(-1)).toMatchObject({ session: "session-f", resource: "emulator-5554" });
    expect(world.calls.filter((c) => c.endsWith(" phone1"))).toEqual(["start phone1", "stop phone1", "start phone1"]);
  });
});

describe("emulators run only while leased", () => {
  it("stops an emulator when its lease is released, and boots it again for the next one", async () => {
    const world = makeWorld();
    const broker = brokerFor(world);
    await broker.acquire({ want: android, session: A, purpose: "a" });
    bootAll(world);
    await broker.acquire({ want: android, session: A, purpose: "a" });
    await broker.release({ session: A, want: android, state: "clean" });
    await settled();
    expect(world.calls).toEqual(["start phone1", "stop phone1"]);
    expect(world.emulators["phone1"]).toBe("stopped");
    const s = (await broker.status({})) as { devices: { id: string; status: string }[] };
    expect(s.devices.filter((d) => d.id.startsWith("emulator-")).map((d) => d.status)).toEqual(["stopped", "stopped", "stopped", "stopped"]);
    expect(await broker.acquire({ want: android, session: B, purpose: "b" })).toMatchObject({ resource: "emulator-5554", state: "booting" });
    expect(world.calls).toEqual(["start phone1", "stop phone1", "start phone1"]);
  });

  it("clears a dirty holder's app data before it stops the emulator", async () => {
    const world = makeWorld();
    const broker = brokerFor(world);
    await broker.acquire({ want: android, session: A, purpose: "a" });
    bootAll(world);
    await broker.acquire({ want: android, session: A, purpose: "a" });
    expect(await broker.release({ session: A, want: android, state: "dirty" })).toMatchObject({ then: "app data cleared, then stopped" });
    await settled();
    expect(world.calls).toEqual(["start phone1", "clear emulator-5554", "stop phone1"]);
  });

  it("stops every emulator it finds running with no lease, and leaves leased ones alone", async () => {
    const world = makeWorld();
    world.emulators = { phone1: "device", phone2: "device", phone3: "stopped", phone4: "stopped" };
    const broker = brokerFor(world);
    await broker.acquire({ want: android, session: A, purpose: "a" });
    // The lease got phone1, which was already running: started (a no-op on its host) and ready at once.
    expect(await broker.acquire({ want: android, session: A, purpose: "a" })).toMatchObject({ resource: "emulator-5554", state: "ready" });
    await broker.tick();
    await settled();
    expect(world.calls).toEqual(["start phone1", "stop phone2"]);
    expect(world.emulators).toEqual({ phone1: "device", phone2: "stopped", phone3: "stopped", phone4: "stopped" });
    // The next tick reads the same probe: no second stop.
    await broker.tick();
    await settled();
    expect(world.calls).toEqual(["start phone1", "stop phone2"]);
    const s = (await broker.status({})) as { recent: string[] };
    expect(s.recent.join("\n")).toMatch(/emulator-5556 was running with no lease: stopping it/);
  });

  it("forgets after-lease work a restart cut short, so the device is not held busy for ever", async () => {
    const world = makeWorld();
    const broker = brokerFor(world);
    await broker.acquire({ want: android, session: A, purpose: "a" });
    world.stopGate = new Promise(() => undefined);
    await broker.release({ session: A, want: android, state: "clean" });
    // The process dies before the stop returns: state.json keeps the busy mark.
    expect(world.saved?.marks["emulator-5554"]?.busy).toBeDefined();
    const restarted = brokerFor(world);
    const s = (await restarted.status({})) as { devices: { id: string; status: string }[]; recent: string[] };
    expect(s.devices.find((d) => d.id === "emulator-5554")?.status).not.toBe("stopping");
    expect(s.recent.join("\n")).toMatch(/restarted during after-lease work on emulator-5554/);
  });
});

describe("a lease paused for a person", () => {
  type Mine = { mine: { lease: string; paused?: { note: string; until: string; then: string }; ends_at: string }[] };
  const mine = async (broker: ReturnType<typeof brokerFor>) => ((await broker.status({ session: A })) as Mine).mine;

  it("outlives its holder's silence while the person has the device, then ends as a silent lease does", async () => {
    const world = makeWorld();
    const broker = brokerFor(world);
    await broker.acquire({ want: android, session: A, purpose: "sign-in flow" });
    bootAll(world);
    const paused = await broker.pause({ session: A, want: android, minutes: 90, note: "the owner types the one-time code" });
    expect(paused).toMatchObject({ status: "paused", resource: "emulator-5554", paused: { note: "the owner types the one-time code", then: "do not drive it until resume" } });
    // An hour of silence, three times the idle limit: still held, still running.
    world.clock += 60 * 60_000;
    await broker.tick();
    await settled();
    expect(await mine(broker)).toHaveLength(1);
    expect(world.calls).toEqual(["start phone1"]);
    const s = (await broker.status({})) as { devices: { id: string; status: string; paused?: string }[]; recent: string[] };
    expect(s.devices.find((d) => d.id === "emulator-5554")).toMatchObject({ status: "leased", paused: "the owner types the one-time code" });
    expect(s.recent.join("\n")).toMatch(/emulator-5554 paused for a person by session-a-000: the owner types/);
    // Past the 90 minutes, the pause runs out and the lease ends as a silent holder's would.
    world.clock += 31 * 60_000;
    await broker.tick();
    await settled();
    expect(await mine(broker)).toHaveLength(0);
    expect(world.calls).toEqual(["start phone1", "clear emulator-5554", "stop phone1"]);
    expect(((await broker.status({})) as { recent: string[] }).recent.join("\n")).toMatch(/its pause for a person ran out \(the owner types the one-time code\)/);
  });

  it("hands the device back on resume as an ordinary lease, with the idle window from then even past four hours", async () => {
    const world = makeWorld();
    const broker = brokerFor(world);
    const granted = (await broker.acquire({ want: android, session: A, purpose: "a", minutes: 240 })) as { lease: string };
    for (let i = 0; i < 13; i++) {
      world.clock += 15 * 60_000;
      await broker.renew({ session: A, lease: granted.lease });
    }
    await broker.pause({ session: A, lease: granted.lease, minutes: 120, note: "a person checks the layout" });
    // 285 minutes after the grant, past the four-hour limit a renewal could reach.
    world.clock += 90 * 60_000;
    const back = (await broker.resume({ session: A, lease: granted.lease })) as { status: string; paused?: unknown; ends_at: string };
    expect(back.status).toBe("resumed");
    expect(back.paused).toBeUndefined();
    expect(Date.parse(back.ends_at)).toBe(world.clock + RULES.idleMs);
    // A renewal does not cut it back to the four-hour mark, and resuming again (resume is declared idempotent) changes nothing.
    expect(idempotentWrites(POLICY)).toEqual(["resume"]);
    await broker.renew({ session: A, lease: granted.lease });
    expect(await broker.resume({ session: A, lease: granted.lease })).toMatchObject({ status: "not paused", ends_at: back.ends_at });
    world.clock += RULES.idleMs - 60_000;
    await broker.tick();
    expect(await mine(broker)).toHaveLength(1);
    world.clock += 2 * 60_000;
    await broker.tick();
    expect(await mine(broker)).toHaveLength(0);
  });

  it("is never held past eight hours from the grant, pause after pause", async () => {
    const world = makeWorld();
    const broker = brokerFor(world);
    const start = world.clock;
    await broker.acquire({ want: ios, session: A, purpose: "a" });
    const first = (await broker.pause({ session: A, want: ios, minutes: 240, note: "long review" })) as { paused: { since: string; until: string } };
    expect(Date.parse(first.paused.until)).toBe(start + 240 * 60_000);
    world.clock += 230 * 60_000;
    const second = (await broker.pause({ session: A, want: ios, minutes: 240, note: "long review" })) as { paused: { since: string; until: string } };
    expect(second.paused.since).toBe(first.paused.since);
    expect(Date.parse(second.paused.until)).toBe(start + 470 * 60_000);
    world.clock += 230 * 60_000;
    const third = (await broker.pause({ session: A, want: ios, minutes: 240, note: "long review" })) as { paused: { until: string } };
    expect(Date.parse(third.paused.until)).toBe(start + RULES.maxHeldMs);
    world.clock += 20 * 60_000;
    await broker.tick();
    expect(await mine(broker)).toHaveLength(0);
  });

  it("pauses only the caller's own device lease, never a build slot or another session's", async () => {
    const world = makeWorld();
    const broker = brokerFor(world);
    const theirs = (await broker.acquire({ want: android, session: B, purpose: "b" })) as { lease: string };
    await expect(broker.pause({ session: A, lease: theirs.lease, note: "x" })).rejects.toMatchObject({ error: { message: `lease ${theirs.lease} belongs to another session` } });
    await expect(broker.pause({ session: A, want: android, note: "x" })).rejects.toMatchObject({ error: { kind: "input" } });
    await broker.acquire({ want: { kind: "builder", platform: "android" }, session: A, purpose: "build" });
    await expect(broker.pause({ session: A, want: { kind: "builder", platform: "android" }, note: "x" })).rejects.toMatchObject({ error: { message: expect.stringContaining("build slot") } });
    const s = (await broker.status({})) as { devices: { id: string; paused?: string }[] };
    expect(s.devices.some((d) => d.paused !== undefined)).toBe(false);
  });
});

describe("leases end", () => {
  it("ends a silent holder's lease, resets the emulator and stops it", async () => {
    const world = makeWorld();
    const broker = brokerFor(world);
    await broker.acquire({ want: android, session: A, purpose: "a" });
    bootAll(world);
    await broker.acquire({ want: android, session: A, purpose: "a" });
    world.clock += RULES.idleMs + 1000;
    await broker.tick();
    await settled();
    expect(world.calls).toEqual(["start phone1", "clear emulator-5554", "stop phone1"]);
    const s = (await broker.status({})) as { devices: { id: string; status: string }[]; recent: string[] };
    expect(s.devices.find((d) => d.id === "emulator-5554")?.status).toBe("stopped");
    expect(s.recent.join("\n")).toMatch(/holder silent/);
  });

  it("keeps a lease alive while its holder renews, up to the four-hour limit", async () => {
    const world = makeWorld();
    const broker = brokerFor(world);
    await broker.acquire({ want: android, session: A, purpose: "a" });
    for (let i = 0; i < 15; i++) {
      world.clock += 15 * 60_000;
      await broker.renew({ session: A, want: android });
    }
    // 225 minutes in: still held. Past 240 the cap ends it whatever the renewals say.
    expect(((await broker.status({ session: A })) as { mine: unknown[] }).mine).toHaveLength(1);
    world.clock += 16 * 60_000;
    await broker.renew({ session: A, want: android }).catch(() => undefined);
    const s = (await broker.status({ session: A })) as { mine: unknown[] };
    expect(s.mine).toHaveLength(0);
  });

  it("shuts an iOS simulator down after a clean release, and resets it after a dirty one", async () => {
    const world = makeWorld();
    const broker = brokerFor(world);
    await broker.acquire({ want: ios, session: A, purpose: "a" });
    await broker.release({ session: A, want: ios, state: "clean" });
    await settled();
    expect(world.calls).toEqual(["shutdown 11111111-2222-4333-8444-555555555555"]);
    await broker.acquire({ want: ios, session: A, purpose: "a" });
    await broker.release({ session: A, want: ios, state: "dirty" });
    await settled();
    expect(world.calls.slice(1)).toEqual(["reset 11111111-2222-4333-8444-555555555555", "shutdown 11111111-2222-4333-8444-555555555555"]);
  });

  it("quarantines an emulator released broken, and stops it", async () => {
    const world = makeWorld();
    const broker = brokerFor(world);
    await broker.acquire({ want: android, session: A, purpose: "a" });
    expect(await broker.release({ session: A, want: android, state: "broken", note: "black screen" })).toMatchObject({ then: "stopped, and quarantined until someone checks it and clears it" });
    const r = await broker.acquire({ want: android, session: B, purpose: "b" });
    expect(r).toMatchObject({ status: "granted", resource: "emulator-5556" });
    await settled();
    expect([...world.calls].sort()).toEqual(["start phone1", "start phone2", "stop phone1"]);
    const s = (await broker.status({})) as { devices: { id: string; status: string; quarantine?: string }[] };
    expect(s.devices.find((d) => d.id === "emulator-5554")).toMatchObject({ status: "quarantined", quarantine: "released: black screen" });
  });

  it("returns a quarantined device to service when someone clears it with what they checked", async () => {
    const world = makeWorld();
    const broker = brokerFor(world);
    await broker.report({ session: A, device: "emulator-5554", note: "adb offline" });
    expect(await broker.acquire({ want: android, session: B, purpose: "b" })).toMatchObject({ resource: "emulator-5556" });
    expect(await broker.clear({ session: A, device: "emulator-5554", note: "booted it, launcher on screen" })).toMatchObject({ status: "cleared", was: "adb offline" });
    expect(await broker.acquire({ want: android, session: C, purpose: "c" })).toMatchObject({ resource: "emulator-5554" });
    await expect(broker.clear({ session: A, device: "emulator-5554", note: "again" })).rejects.toBeDefined();
  });

  it("refuses to release another session's lease", async () => {
    const broker = brokerFor(makeWorld());
    const r = (await broker.acquire({ want: android, session: A, purpose: "a" })) as { lease: string };
    await expect(broker.release({ session: B, lease: r.lease, state: "clean" })).rejects.toBeDefined();
  });
});

describe("builders", () => {
  it("leases a host's build slot, one at a time", async () => {
    const broker = brokerFor(makeWorld());
    const builder = { kind: "builder", platform: "ios" } as const;
    expect(await broker.acquire({ want: builder, session: A, purpose: "build" })).toMatchObject({ status: "granted", resource: "builder:ios@mac-1" });
    expect(await broker.acquire({ want: builder, session: B, purpose: "build" })).toMatchObject({ status: "queued" });
  });
});

describe("state", () => {
  it("survives a restart through the store", async () => {
    const world = makeWorld();
    await brokerFor(world).acquire({ want: android, session: A, purpose: "a" });
    const again = brokerFor(world);
    const s = (await again.status({ session: A })) as { mine: { resource: string }[] };
    expect(s.mine.map((l) => l.resource)).toEqual(["emulator-5554"]);
    expect(CATALOG.devices.length).toBe(7);
  });
});

describe("variants: one emulator slot, several system images", () => {
  const next = { ...android, profile: "android-next" } as const;
  const variants = () => {
    const world = makeWorld(VARIANT_INSTANCES);
    return { world, broker: brokerFor(world, VARIANTS) };
  };
  type Shown = { devices: { id: string; status: string; profile: string; profiles?: readonly string[]; runs?: string }[]; mine: { profile?: string }[]; recent: string[] };

  it("starts the variant a profile asks for on the slot that has it, and a slot's own when none is asked", async () => {
    const { world, broker } = variants();
    const r = await broker.acquire({ want: next, session: A, purpose: "api 35" });
    expect(r).toMatchObject({ status: "granted", resource: "emulator-5554", profile: "android-next", state: "booting", address: { env: { ANDROID_SERIAL: "emulator-5554", ANDROID_ADB_SERVER_PORT: "5037" } } });
    expect(world.calls).toEqual(["start phone1next"]);
    // No profile: today's answer, the next free slot on its own profile.
    expect(await broker.acquire({ want: android, session: B, purpose: "any" })).toMatchObject({ status: "granted", resource: "emulator-5556", profile: "android-phone" });
    expect(world.calls).toEqual(["start phone1next", "start phone2"]);
    const s = (await broker.status({ session: A })) as Shown;
    expect(s.mine).toMatchObject([{ profile: "android-next" }]);
    expect(s.devices[0]).toMatchObject({ id: "emulator-5554", profile: "android-phone", profiles: ["android-phone", "android-next"], runs: "android-next", status: "booting" });
    expect(s.devices[1]).not.toHaveProperty("profiles");
    expect(s.recent.join("\n")).toMatch(/emulator-5554 started as android-next on emu-1/);
    // Only that slot serves the variant: while it is leased, a request for it waits for it.
    const q = await broker.acquire({ want: next, session: C, purpose: "api 35 too" });
    expect(q).toMatchObject({ status: "queued", want: { profile: "android-next" } });
    expect((q as { reason: string }).reason).toMatch(/emulator-5554 is leased to session-a/);
    // Asked again for another profile, the ticket waits for that one, in the same place.
    expect(await broker.acquire({ want: { ...android, profile: "android-phone" }, session: C, purpose: "api 34 will do" })).toMatchObject({ status: "queued", position: 1, want: { profile: "android-phone" }, reason: "already queued; now for android-phone" });
  });

  it("starts the slot's own instance for its own profile, named", async () => {
    const { world, broker } = variants();
    expect(await broker.acquire({ want: { ...android, profile: "android-phone" }, session: A, purpose: "api 34" })).toMatchObject({ resource: "emulator-5554", profile: "android-phone" });
    expect(world.calls).toEqual(["start phone1"]);
    expect(world.saved?.leases[0]).toMatchObject({ profile: "android-phone", instance: "phone1" });
  });

  it("clears a dirty holder's data and stops the instance the lease started, then starts the slot's own for the next", async () => {
    const { world, broker } = variants();
    await broker.acquire({ want: next, session: A, purpose: "a" });
    bootAll(world);
    expect(await broker.acquire({ want: next, session: A, purpose: "a" })).toMatchObject({ status: "held", state: "ready" });
    await broker.release({ session: A, want: android, state: "dirty" });
    await settled();
    expect(world.calls).toEqual(["start phone1next", "clear emulator-5554", "stop phone1next"]);
    expect(world.emulators).toMatchObject({ phone1: "stopped", phone1next: "stopped" });
    expect(await broker.acquire({ want: android, session: B, purpose: "b" })).toMatchObject({ resource: "emulator-5554", profile: "android-phone" });
    expect(world.calls.at(-1)).toBe("start phone1");
  });

  it("stops a variant it finds running with no lease, and shows it running as that profile until then", async () => {
    const { world, broker } = variants();
    world.emulators["phone1next"] = "device";
    const before = (await broker.status({})) as Shown;
    expect(before.devices[0]).toMatchObject({ id: "emulator-5554", status: "running", runs: "android-next" });
    await broker.tick();
    await settled();
    expect(world.calls).toEqual(["stop phone1next"]);
    expect(world.emulators["phone1next"]).toBe("stopped");
    await broker.tick();
    await settled();
    expect(world.calls).toEqual(["stop phone1next"]);
  });

  it("stops another variant still running on a slot before it starts the one a lease was granted", async () => {
    const { world, broker } = variants();
    world.emulators["phone1next"] = "device";
    // The slot looks free (no lease) and the probe saw phone1next on its serial: phone1 must not start beside it.
    expect(await broker.acquire({ want: android, session: A, purpose: "api 34" })).toMatchObject({ resource: "emulator-5554", profile: "android-phone", state: "booting" });
    expect(world.calls).toEqual(["stop phone1next", "start phone1"]);
  });

  it("reads a unit-probed variant's boot from its own instance, not the slot's default", async () => {
    const world = makeWorld(POOL_VARIANT_SLOTS);
    const guest = as(rawBrokerFor(world, POOL_VARIANTS), GUEST);
    expect(await guest.acquire({ want: next, session: A, purpose: "api 35" })).toMatchObject({ status: "granted", resource: "acmephone", profile: "android-next", state: "booting" });
    expect(world.calls).toEqual(["start acmenext"]);
    // Whatever else the control command says is active, the lease's instance is still activating.
    world.emulators["acmephone"] = "device";
    world.clock += 61_000;
    await guest.tick();
    expect(await guest.acquire({ want: next, session: A, purpose: "api 35" })).toMatchObject({ status: "held", state: "booting" });
    world.emulators["acmephone"] = "stopped";
    bootAll(world);
    await guest.tick();
    expect(await guest.acquire({ want: next, session: A, purpose: "api 35" })).toMatchObject({ status: "held", state: "ready" });
  });

  it("refuses to hand back a lease on another profile than the one asked for, and changes nothing", async () => {
    const { world, broker } = variants();
    const first = (await broker.acquire({ want: android, session: A, purpose: "a" })) as { lease: string };
    await expect(broker.acquire({ want: next, session: A, purpose: "a" })).rejects.toMatchObject({
      error: { kind: "input", message: `session session-a-000 holds emulator-5554 on android-phone (lease ${first.lease}), and a session holds one android device at a time: release it, then ask for android-next` },
    });
    expect(world.calls).toEqual(["start phone1"]);
    // Its own profile, or none: the lease it holds, as today.
    expect(await broker.acquire({ want: { ...android, profile: "android-phone" }, session: A, purpose: "a" })).toMatchObject({ status: "held", lease: first.lease, profile: "android-phone" });
    expect(await broker.acquire({ want: android, session: A, purpose: "a" })).toMatchObject({ status: "held", lease: first.lease });
    // Released, the same slot serves the other profile.
    await broker.release({ session: A, want: android, state: "clean" });
    await settled();
    expect(await broker.acquire({ want: next, session: A, purpose: "a" })).toMatchObject({ status: "granted", resource: "emulator-5554", profile: "android-next" });
    expect(world.calls).toEqual(["start phone1", "stop phone1", "start phone1next"]);
    // Holding the variant, asking with no profile returns it.
    expect(await broker.acquire({ want: android, session: A, purpose: "a" })).toMatchObject({ status: "held", profile: "android-next" });
  });

  it("lets a session hold a watch beside its phone, one of each form, and releases the one asked for", async () => {
    const world = makeWorld(WATCH_INSTANCES);
    const broker = brokerFor(world, WATCH);
    const watch = { ...android, profile: "wear-os" } as const;
    const phone = (await broker.acquire({ want: android, session: A, purpose: "pair" })) as { lease: string };
    const wrist = (await broker.acquire({ want: watch, session: A, purpose: "pair" })) as { lease: string; resource: string };
    expect(wrist).toMatchObject({ status: "granted", resource: "emulator-5560", profile: "wear-os" });
    expect(wrist.lease).not.toBe(phone.lease);
    expect(world.calls).toEqual(["start phone1", "start phone4watch"]);
    // Each asked again by its form: the lease of that form.
    expect(await broker.acquire({ want: watch, session: A, purpose: "pair" })).toMatchObject({ status: "held", lease: wrist.lease });
    expect(await broker.acquire({ want: { ...android, profile: "android-phone" }, session: A, purpose: "pair" })).toMatchObject({ status: "held", lease: phone.lease });
    // Still one phone: another phone profile is refused while the phone is held.
    await expect(broker.acquire({ want: { ...android, profile: "android-next" }, session: A, purpose: "pair" })).rejects.toMatchObject({
      error: { kind: "input", message: `session session-a-000 holds emulator-5554 on android-phone (lease ${phone.lease}), and a session holds one android device at a time: release it, then ask for android-next` },
    });
    // Released by its profile, the watch goes and the phone stays.
    await broker.release({ session: A, want: watch, state: "clean" });
    await settled();
    expect(world.calls).toEqual(["start phone1", "start phone4watch", "stop phone4watch"]);
    expect(await broker.acquire({ want: android, session: A, purpose: "pair" })).toMatchObject({ status: "held", lease: phone.lease });
  });

  it("refuses an iOS lease asked again for a profile no simulator it holds runs", async () => {
    const broker = brokerFor(makeWorld());
    await broker.acquire({ want: ios, session: A, purpose: "a" });
    await expect(broker.acquire({ want: { ...ios, profile: "ios-tablet" }, session: A, purpose: "a" })).rejects.toMatchObject({ error: { kind: "input", message: expect.stringMatching(/holds dev-iphone on ios-phone/) } });
  });

  it("reads a lease saved before variants as the slot's own: its profile, its instance, its stop", async () => {
    const { world, broker } = variants();
    await broker.acquire({ want: android, session: A, purpose: "a" });
    const saved = world.saved;
    if (saved === undefined) throw new Error("nothing saved");
    world.saved = { ...saved, leases: saved.leases.map(({ profile: _p, instance: _i, ...old }) => old) };
    expect(world.saved.leases[0]).not.toHaveProperty("instance");
    const upgraded = brokerFor(world, VARIANTS);
    expect(((await upgraded.status({ session: A })) as Shown).mine).toMatchObject([{ profile: "android-phone" }]);
    await expect(upgraded.acquire({ want: next, session: A, purpose: "a" })).rejects.toMatchObject({ error: { message: expect.stringMatching(/on android-phone/) } });
    await upgraded.release({ session: A, want: android, state: "clean" });
    await settled();
    expect(world.calls).toEqual(["start phone1", "stop phone1"]);
  });
});

describe("desktops: a Mac's desktop session and a Windows VM", () => {
  const macos = { kind: "device", platform: "macos" } as const;
  const windows = { kind: "device", platform: "windows" } as const;
  const desktops = () => {
    const world = makeWorld(DESKTOP_INSTANCES);
    return { world, broker: brokerFor(world, DESKTOPS) };
  };
  type Shown = { devices: { id: string; status: string; why?: string }[] };

  it("leases the Mac's desktop only while its ssh account is logged in, and says who must log in otherwise", async () => {
    const { world, broker } = desktops();
    const r = await broker.acquire({ want: macos, session: A, purpose: "a desktop app" });
    expect(r.status).toBe("unavailable");
    expect((r as { reason: string }).reason).toMatch(/nobody is logged in to a desktop session as runner on mac-1/);
    const s = (await broker.status({})) as Shown;
    expect(s.devices.find((d) => d.id === "mac-desktop")).toMatchObject({ status: "not answering", why: expect.stringMatching(/as runner on mac-1/) });

    world.mac = { onAc: true, ciBusy: false, load: 2, desktop: true };
    world.clock += 61_000;
    await broker.tick();
    const g = await broker.acquire({ want: macos, session: A, purpose: "a desktop app" });
    expect(g).toMatchObject({ status: "granted", resource: "mac-desktop", state: "ready", address: { platform: "macos", ssh: "runner@mac-1.example.com", env: { DEVICE_ID: "mac-desktop", DEVICE_SSH: "runner@mac-1.example.com" } } });
    expect((g as { address: { env: Record<string, string> } }).address.env).not.toHaveProperty("DEVICE_SSH_PORT");
    // Nothing starts or stops a desktop session, and a release leaves it as it is.
    expect(await broker.release({ session: A, want: macos, state: "dirty" })).toMatchObject({ status: "released", then: "left as it is" });
    await settled();
    expect(world.calls).toEqual([]);
  });

  it("starts the Windows VM for a lease, booting until its unit is active, and hands out its ssh address through the host", async () => {
    const { world, broker } = desktops();
    const r = await broker.acquire({ want: windows, session: A, purpose: "a windows build" });
    expect(r).toMatchObject({
      status: "granted",
      resource: "windows-1",
      state: "booting",
      address: { platform: "windows", ssh: "tester@127.0.0.1", port: 2222, jump: "builder@emu-1.example.com", env: { DEVICE_SSH: "tester@127.0.0.1", DEVICE_SSH_PORT: "2222", DEVICE_SSH_JUMP: "builder@emu-1.example.com" } },
    });
    expect((r as { next: string }).next).toMatch(/the device is booting/);
    expect(world.calls).toEqual([`start ${VM}`]);
    bootAll(world);
    world.clock += 61_000;
    await broker.tick();
    expect(await broker.acquire({ want: windows, session: A, purpose: "a windows build" })).toMatchObject({ status: "held", state: "ready" });
    // A VM has no adb: a dirty release stops it and clears nothing.
    expect(await broker.release({ session: A, want: windows, state: "dirty" })).toMatchObject({ status: "released", then: "stopped" });
    await settled();
    expect(world.calls).toEqual([`start ${VM}`, `stop ${VM}`]);
    expect(world.emulators[VM]).toBe("stopped");
  });

  it("stops a VM it finds running with no lease, as it does an emulator", async () => {
    const { world, broker } = desktops();
    world.emulators[VM] = "device";
    world.clock += 61_000;
    await broker.tick();
    await settled();
    expect(world.calls).toEqual([`stop ${VM}`]);
  });

  it("counts a VM at its own memory cost, not its host's", async () => {
    const { world, broker } = desktops();
    // 22 GiB free: room for an emulator (6 GiB, 12 GiB kept), not for the VM (16 GiB).
    world.android = { memAvailableMiB: 22_528, load: 1 };
    const w = await broker.acquire({ want: windows, session: A, purpose: "a windows build" });
    expect(w.status).not.toBe("granted");
    expect((w as { reason: string }).reason).toMatch(/windows-1 costs 16 GiB and 12 GiB must stay free/);
    expect(await broker.acquire({ want: android, session: B, purpose: "a phone" })).toMatchObject({ status: "granted", resource: "emulator-5554" });
    // The emulator granted since the probe counts at its own cost against the next spawn.
    const third = await broker.acquire({ want: android, session: C, purpose: "another phone" });
    expect((third as { reason: string }).reason).toMatch(/has 16 GiB available \(counting 1 device\(s\) starting\); emulator-5556 costs 6 GiB/);
  });
});

describe("a Batocera box: a VM like the Windows one, fresh for every lease, with a screenshot command", () => {
  const batocera = { kind: "device", platform: "batocera" } as const;
  const boxes = () => {
    const world = makeWorld(BATOCERA_INSTANCES);
    return { world, broker: brokerFor(world, BATOCERA) };
  };
  const address = {
    platform: "batocera",
    ssh: "root@127.0.0.1",
    port: 2223,
    jump: "builder@emu-1.example.com",
    screenshot: SCREENSHOT,
    env: { DEVICE_ID: "batocera-1", DEVICE_SSH: "root@127.0.0.1", DEVICE_SSH_PORT: "2223", DEVICE_SSH_JUMP: "builder@emu-1.example.com", DEVICE_SCREENSHOT: SCREENSHOT },
  };

  it("starts the box for a lease, booting until its unit is active, hands out its ssh address and screenshot command, and stops it after", async () => {
    const { world, broker } = boxes();
    const r = await broker.acquire({ want: batocera, session: A, purpose: "a game's menu" });
    expect(r).toMatchObject({ status: "granted", resource: "batocera-1", profile: "batocera", state: "booting", address });
    expect(world.calls).toEqual([`start ${BOX}`]);
    // Activating is not booted: the box stays booting until its unit says active.
    world.clock += 61_000;
    await broker.tick();
    expect(await broker.acquire({ want: batocera, session: A, purpose: "a game's menu" })).toMatchObject({ status: "held", state: "booting" });
    bootAll(world);
    world.clock += 61_000;
    await broker.tick();
    expect(await broker.acquire({ want: batocera, session: A, purpose: "a game's menu" })).toMatchObject({ status: "held", state: "ready", address });
    // status hands its holder the same address.
    const s = (await broker.status({ session: A })) as { mine: { resource: string; address: unknown }[] };
    expect(s.mine).toMatchObject([{ resource: "batocera-1", address }]);
    // The stop after the lease is the reset: the control command throws the box away.
    expect(await broker.release({ session: A, want: batocera, state: "dirty" })).toMatchObject({ status: "released", then: "stopped" });
    await settled();
    expect(world.calls).toEqual([`start ${BOX}`, `stop ${BOX}`]);
    expect(world.emulators[BOX]).toBe("stopped");
  });

  it("starts the variant's instance for a lease that asks for its profile", async () => {
    const { world, broker } = boxes();
    const ephemeral = { ...batocera, profile: "batocera-ephemeral" } as const;
    expect(await broker.acquire({ want: ephemeral, session: A, purpose: "a quick look" })).toMatchObject({
      status: "granted",
      resource: "batocera-1",
      profile: "batocera-ephemeral",
      state: "booting",
      address,
    });
    expect(world.calls).toEqual([`start ${BOX_EPHEMERAL}`]);
    bootAll(world);
    world.clock += 61_000;
    await broker.tick();
    expect(await broker.acquire({ want: ephemeral, session: A, purpose: "a quick look" })).toMatchObject({ status: "held", state: "ready" });
    expect(await broker.release({ session: A, want: batocera, state: "clean" })).toMatchObject({ status: "released", then: "stopped" });
    await settled();
    expect(world.calls).toEqual([`start ${BOX_EPHEMERAL}`, `stop ${BOX_EPHEMERAL}`]);
    expect(world.emulators[BOX]).toBe("stopped");
  });
});

describe("spares a request must name: a tablet, and a phone with a paired watch", () => {
  const tablet = { ...ios, profile: "ios-tablet" } as const;
  const watch = { ...ios, profile: "ios-watch" } as const;
  type Address = { env: Record<string, string>; watch?: { name: string; udid?: string } };

  it("never hands a request that names no profile the tablet or the watch pair, whatever room the Mac has", async () => {
    const world = makeWorld();
    const broker = brokerFor(world, GEAR(3));
    expect(await broker.acquire({ want: ios, session: A, purpose: "a" })).toMatchObject({ status: "granted", resource: "dev-iphone", profile: "ios-phone" });
    expect(await broker.acquire({ want: ios, session: B, purpose: "b" })).toMatchObject({ status: "granted", resource: "spare-iphone-1", profile: "ios-phone" });
    // Both phones held, room for two more spares: a third phone waits for a phone.
    expect(await broker.acquire({ want: ios, session: C, purpose: "c" })).toMatchObject({ status: "queued", want: { platform: "ios" } });
    expect(await broker.acquire({ want: tablet, session: D, purpose: "d" })).toMatchObject({ status: "granted", resource: "spare-ipad-1", profile: "ios-tablet" });
    expect(await broker.acquire({ want: watch, session: E, purpose: "e" })).toMatchObject({ status: "granted", resource: "spare-watch-1", profile: "ios-watch" });
    expect(world.calls).toEqual(["create spare-iphone-1", "create spare-ipad-1", "create spare-watch-1", "create spare-watch-1-watch", "pair spare-watch-1-watch spare-watch-1"]);
    // Holding the tablet, asking with no profile (a wrapper) returns the tablet.
    expect(await broker.acquire({ want: ios, session: D, purpose: "d" })).toMatchObject({ status: "held", resource: "spare-ipad-1" });
  });

  it("creates the watch beside its phone, pairs them, and hands out both UDIDs", async () => {
    const world = makeWorld();
    const broker = brokerFor(world, GEAR());
    const g = (await broker.acquire({ want: watch, session: A, purpose: "a watch app" })) as { address: Address };
    expect(g).toMatchObject({ status: "granted", resource: "spare-watch-1" });
    expect(g.address.env).toEqual({
      DEVICE_ID: "spare-watch-1",
      IOS_SIM_MAC: "runner@mac-1.example.com",
      IOS_SIM_DEVICE: "AAAAAAAA-0000-0000-0000-000000000001",
      IOS_SIM_WATCH: "AAAAAAAA-0000-0000-0000-000000000002",
    });
    expect(g.address.watch).toEqual({ name: "spare-watch-1-watch", udid: "AAAAAAAA-0000-0000-0000-000000000002" });
    const s = (await broker.status({})) as { recent: string[] };
    expect(s.recent.join("\n")).toMatch(/spare-watch-1 created on mac-1 \(AAAAAAAA-0000-0000-0000-000000000001, paired with spare-watch-1-watch \(AAAAAAAA-0000-0000-0000-000000000002\)\)/);
    // The phone stands for the pair: its shutdown is the pair's (the host's work, tested with infra).
    await broker.release({ session: A, want: ios, state: "clean" });
    await settled();
    expect(world.calls.at(-1)).toBe("shutdown AAAAAAAA-0000-0000-0000-000000000001");
    // The next grant checks the pair again and finds it whole: nothing created, nothing paired twice.
    world.calls.length = 0;
    expect(await broker.acquire({ want: watch, session: B, purpose: "b" })).toMatchObject({ status: "granted", resource: "spare-watch-1" });
    expect(world.calls).toEqual([]);
  });

  it("mends a pair undone by hand on the next grant, and names a watch it has only by its name", async () => {
    const world = makeWorld();
    // Both simulators exist, unpaired, and the broker has not seen them yet.
    world.simulators.push({ name: "spare-watch-1", udid: "BBBBBBBB-0000-0000-0000-000000000001", state: "Shutdown" }, { name: "spare-watch-1-watch", udid: "BBBBBBBB-0000-0000-0000-000000000002", state: "Shutdown" });
    const broker = brokerFor(world, GEAR());
    const g = (await broker.acquire({ want: watch, session: A, purpose: "a" })) as { address: Address };
    expect(world.calls).toEqual(["pair spare-watch-1-watch spare-watch-1"]);
    expect(g.address.env).toMatchObject({ IOS_SIM_DEVICE: "BBBBBBBB-0000-0000-0000-000000000001", IOS_SIM_WATCH: "BBBBBBBB-0000-0000-0000-000000000002" });
  });

  it("shares the Mac's one spawn slot: a second spare waits for the first one's lease to end", async () => {
    const world = makeWorld();
    const broker = brokerFor(world, GEAR(1));
    expect(await broker.acquire({ want: tablet, session: A, purpose: "an iPad layout" })).toMatchObject({ status: "granted", resource: "spare-ipad-1" });
    const q = (await broker.acquire({ want: watch, session: B, purpose: "a watch app" })) as { status: string; ticket: string; reason: string };
    expect(q.status).toBe("queued");
    expect(q.reason).toMatch(/mac-1 already runs 1 spawned device\(s\), its limit/);
    await broker.release({ session: A, want: ios, state: "clean" });
    await settled();
    expect(await broker.wait({ ticket: q.ticket, session: B, seconds: 0 })).toMatchObject({ status: "granted", resource: "spare-watch-1" });
  });

  it("deletes the pair after a week unused, and forgets both UDIDs", async () => {
    const world = makeWorld();
    const broker = brokerFor(world, GEAR());
    await broker.acquire({ want: watch, session: A, purpose: "a" });
    await broker.release({ session: A, want: ios, state: "clean" });
    await settled();
    world.clock += RULES.spawnedKeepMs + 120_000;
    await broker.tick();
    await settled();
    expect(world.calls.at(-1)).toBe("delete AAAAAAAA-0000-0000-0000-000000000001");
    expect(world.saved?.marks["spare-watch-1"]).not.toHaveProperty("udid");
    expect(world.saved?.marks["spare-watch-1"]).not.toHaveProperty("watchUdid");
  });
});

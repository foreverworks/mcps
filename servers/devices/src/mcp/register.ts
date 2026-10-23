import { type McpServer, requestContext } from "@foreverworks/mcp-kit";
import { z } from "zod";

import type { Broker } from "../app/broker.js";
import { PLATFORMS, type Catalog, type Tenant } from "../domain/catalog.js";
import type { Want } from "../domain/state.js";
import { tenantOfClient } from "../domain/tenant.js";
import { agree, profilesFor, sessionFor, wrappersAcquire, wrappersOf } from "./describe.js";
import { handled } from "./envelope.js";

const wantName = z.enum([...PLATFORMS, "builder:ios", "builder:android"]);

const purpose = z.string().trim().min(1).max(200).describe("What you are doing, in a few words; shown to whoever waits behind you.");

/** Lease and ticket ids are the broker's own (`ls-<n>`, `tk-<n>`): anything else is a typo, refused before it is looked up. */
const leaseId = z.string().trim().regex(/^ls-[1-9][0-9]{0,9}$/, "a lease id from acquire or status: ls-<number>").describe("A lease id from acquire or status (ls-<number>).");
const ticketId = z.string().trim().regex(/^tk-[1-9][0-9]{0,9}$/, "a ticket id from acquire: tk-<number>").describe("The ticket id from acquire (tk-<number>).");

const toWant = (want: z.infer<typeof wantName>, profile?: string, maestro?: boolean): Want => {
  if (want === "builder:ios") return { kind: "builder", platform: "ios" };
  if (want === "builder:android") return { kind: "builder", platform: "android" };
  return { kind: "device", platform: want, ...(profile === undefined ? {} : { profile }), ...(maestro === undefined ? {} : { maestro }) };
};

/** The caller's tenant, from the client label of the token this request came with (never an argument). */
export const tenantOfRequest = (): Tenant => tenantOfClient(requestContext.getStore()?.client ?? "stdio");

/**
 * The whole tool surface. The catalog supplies the deployment's words (its wrappers, where a session
 * finds its id, its profiles); `tenantOf` is the request's tenant, and tests pass their own.
 */
export const registerAll = (server: McpServer, broker: Broker, catalog: Catalog, tenantOf: () => Tenant = tenantOfRequest): void => {
  const session = z.string().trim().min(1).max(200).describe(sessionFor(catalog));
  const wrappers = wrappersOf(catalog);

  server.registerTool(
    "health",
    {
      title: "Health",
      description: "Whether the broker works (its catalog loaded, its state reads), with each host's last probe. A host that is down (a laptop asleep, a machine off) is reported, not a fault.",
      inputSchema: {},
    },
    handled(() => broker.healthCheck(tenantOf())),
  );

  server.registerTool(
    "status",
    {
      title: "Devices and leases",
      description:
        "Every host your devices are on, with its health and why it is degraded or down, every device with who holds it, the build slots, the queue and the last events: those of your tenant (your token's), never another's. Pass your session to also get the leases you hold, with the address and environment of each device.",
      inputSchema: { session: session.optional() },
    },
    handled((a) => broker.status({ tenant: tenantOf(), ...(a.session === undefined ? {} : { session: a.session }) })),
  );

  server.registerTool(
    "acquire",
    {
      title: "Lease a device or a build slot",
      description:
        "Ask for a device (ios: a simulator on a Mac; android: an emulator; macos: a Mac's desktop session; windows: a Windows machine; " +
        "batocera: a fresh Batocera retro-gaming box (a VM) reached over ssh as root, every lease starting from the stock image and its release throwing the box away) " +
        "or a build slot (builder:ios, builder:android). " +
        "Answers granted (with the device's address and the environment a tool reads to reach it: ANDROID_SERIAL and ANDROID_ADB_SERVER_PORT for adb, " +
        "IOS_SIM_MAC (the Mac's ssh target) and IOS_SIM_DEVICE (the simulator's UDID) for simctl, DEVICE_SSH with DEVICE_SSH_PORT and DEVICE_SSH_JUMP where set for a device reached over ssh, " +
        "whose address may also carry screenshot (and DEVICE_SCREENSHOT): a command to run on it over ssh that writes a PNG of its screen to stdout), " +
        "queued (a ticket: call wait), or unavailable (with the reason, e.g. its host is asleep). " +
        "An Android emulator, a Windows VM or a Batocera box is started for your lease and stopped after it: a granted lease says state booting until the device has " +
        "booted (about a minute for an emulator), and asking again returns the same lease with its state; with until_booted, acquire waits for the boot " +
        "itself and reports progress meanwhile. " +
        "One device per platform and form per session (a phone and a Wear OS watch are two forms): asking again returns the one you hold and extends it, and asking for a profile it does not run is refused (release it first). A lease ends by release, after 20 min without " +
        "a call from you (acquire or renew), or at its time limit (45 min, renewable to 4 h); while a person has the device, pause keeps it." +
        wrappersAcquire(catalog),
      inputSchema: {
        want: wantName,
        session,
        purpose,
        profile: z.string().trim().min(1).max(50).optional().describe(profilesFor(catalog)),
        maestro: z.boolean().optional().describe("Only devices the catalog marks as drivable by a Maestro flow."),
        minutes: z.number().int().min(1).max(240).optional().describe("How long you expect to need it (default 45; builders 30)."),
        priority: z.enum(["interactive", "background"]).default("interactive").describe("background for a loop or a timer: it waits behind interactive sessions."),
        until_booted: z
          .number()
          .int()
          .min(10)
          .max(300)
          .optional()
          .describe("Wait up to this many seconds for a device the lease starts to finish booting, reporting progress, instead of answering state booting at once."),
      },
    },
    handled((a) =>
      broker.acquire({
        tenant: tenantOf(),
        want: toWant(a.want, a.profile, a.maestro),
        session: a.session,
        purpose: a.purpose,
        priority: a.priority,
        ...(a.minutes === undefined ? {} : { minutes: a.minutes }),
        ...(a.until_booted === undefined ? {} : { untilBooted: a.until_booted }),
      }),
    ),
  );

  server.registerTool(
    "wait",
    {
      title: "Wait in the queue",
      description:
        "Long-poll a queue ticket from acquire for up to 50 s: answers granted (the lease is yours) or queued with your position. A ticket not polled for 2 minutes is dropped, and a grant not claimed within 5 minutes goes to the next in line.",
      inputSchema: { ticket: ticketId, session, seconds: z.number().int().min(0).max(50).default(45) },
    },
    handled((a) => broker.wait({ tenant: tenantOf(), ticket: a.ticket, session: a.session, seconds: a.seconds })),
  );

  server.registerTool(
    "renew",
    {
      title: "Keep a lease",
      description: `Extend a lease you hold (by lease id, or by what it is for) to now + minutes, at most 4 h after it was granted.${wrappers === "" ? "" : ` ${wrappers} ${agree(catalog, "do", "does")} this on every use.`}`,
      inputSchema: { session, lease: leaseId.optional(), want: wantName.optional(), minutes: z.number().int().min(1).max(240).optional() },
    },
    handled((a) =>
      broker.renew({
        tenant: tenantOf(),
        session: a.session,
        ...(a.lease === undefined ? {} : { lease: a.lease }),
        ...(a.want === undefined ? {} : { want: toWant(a.want) }),
        ...(a.minutes === undefined ? {} : { minutes: a.minutes }),
      }),
    ),
  );

  server.registerTool(
    "pause",
    {
      title: "Hand a device to a person",
      description:
        "Pause a device lease you hold while a person takes the device over (signs in, types a code, looks at a screen): the lease holds " +
        "without your calls for minutes (default 60, at most 4 h per call, never past 8 h after the grant), so you do not lose the device " +
        "while you wait on them, and status shows it paused with your note. Stop driving it until you call resume. A pause that runs out " +
        "ends the lease as a silent one does; pausing again moves its end. Build slots are not paused.",
      inputSchema: {
        session,
        lease: leaseId.optional(),
        want: wantName.optional(),
        minutes: z.number().int().min(1).max(240).optional().describe("How long the person may need it (default 60)."),
        note: z.string().trim().min(1).max(300).describe('Who has it and why, e.g. "the owner signs in to the test account"; shown in status.'),
      },
    },
    handled((a) =>
      broker.pause({
        tenant: tenantOf(),
        session: a.session,
        note: a.note,
        ...(a.lease === undefined ? {} : { lease: a.lease }),
        ...(a.want === undefined ? {} : { want: toWant(a.want) }),
        ...(a.minutes === undefined ? {} : { minutes: a.minutes }),
      }),
    ),
  );

  server.registerTool(
    "resume",
    {
      title: "Take a device back",
      description:
        "End the pause on a lease you hold, once the person is done: it is an ordinary lease again, ending 20 min after your last call as " +
        "before, and lasting at least that long even if the pause ran past its time limit. Resuming a lease that is not paused changes nothing.",
      inputSchema: { session, lease: leaseId.optional(), want: wantName.optional() },
    },
    handled((a) =>
      broker.resume({
        tenant: tenantOf(),
        session: a.session,
        ...(a.lease === undefined ? {} : { lease: a.lease }),
        ...(a.want === undefined ? {} : { want: toWant(a.want) }),
      }),
    ),
  );

  server.registerTool(
    "release",
    {
      title: "Give a device back",
      description:
        "End a lease you hold. state: clean (leave it as it is, app data kept), dirty (reset it: the apps you installed uninstalled on iOS, app data cleared on Android), " +
        "or broken (quarantine it with your note; nothing leases it until someone checks it and calls clear). iOS simulators are shut down, and Android emulators, Windows VMs and Batocera boxes the broker started are stopped, after every lease " +
        "(a Batocera box is thrown away, so the next lease gets a fresh one); a Mac's desktop session is left as it is.",
      inputSchema: {
        session,
        lease: leaseId.optional(),
        want: wantName.optional(),
        state: z.enum(["clean", "dirty", "broken"]).default("clean"),
        note: z.string().trim().min(1).max(300).optional().describe("Why; required in practice for broken."),
      },
    },
    handled((a) =>
      broker.release({
        tenant: tenantOf(),
        session: a.session,
        state: a.state,
        ...(a.lease === undefined ? {} : { lease: a.lease }),
        ...(a.want === undefined ? {} : { want: toWant(a.want) }),
        ...(a.note === undefined ? {} : { note: a.note }),
      }),
    ),
  );

  server.registerTool(
    "report",
    {
      title: "Report a broken device",
      description: "Quarantine a device that is wedged (black screen, adb offline, a simulator that will not boot) so nobody is handed it, with a note for whoever checks it. It does not end your lease: release it too.",
      inputSchema: { session, device: z.string().trim().min(1).max(100).describe("The device id from status."), note: z.string().trim().min(1).max(300) },
    },
    handled((a) => broker.report({ tenant: tenantOf(), session: a.session, device: a.device, note: a.note })),
  );

  server.registerTool(
    "clear",
    {
      title: "Return a quarantined device to service",
      description:
        "Lift a quarantine (from release broken or report) once the device is checked working again: say what you checked in the note, which status and the event log keep. Only after you saw it work.",
      inputSchema: { session, device: z.string().trim().min(1).max(100), note: z.string().trim().min(1).max(300).describe("What you checked, e.g. booted it and took a screenshot of the launcher.") },
    },
    handled((a) => broker.clear({ tenant: tenantOf(), session: a.session, device: a.device, note: a.note })),
  );
};

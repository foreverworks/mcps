import type { McpServer } from "@foreverworks/mcp-kit";
import { z } from "zod";

import { devices } from "../app/usecases/devices.js";
import { learn } from "../app/usecases/learn.js";
import { press, type PressArgs, sendCode, type SendCodeArgs } from "../app/usecases/press.js";
import { health, status } from "../app/usecases/status.js";
import type { Deps } from "../app/ports.js";
import { MAX_PAUSE_MS, MAX_WAIT_MS, MIN_PAUSE_MS, PAUSE_MS } from "../domain/pacing.js";
import { handled } from "./envelope.js";
import { wire } from "./wire.js";

const deviceArg = z.string().max(48).describe("The device's name in the catalog (devices lists them).");
const buttonArg = z.string().max(48).describe("The button's name on that device (devices lists them).");
const timesArg = z.number().int().min(1).max(10).default(1).describe("How many presses, with a pause between them (1-10).");
const intervalArg = z
  .number()
  .int()
  .min(MIN_PAUSE_MS)
  .max(MAX_PAUSE_MS)
  .optional()
  .describe(
    `The pause between presses in milliseconds (${MIN_PAUSE_MS}-${MAX_PAUSE_MS}): long enough for someone to read the device's display ` +
      `between presses, or for a device to act on each. Default: the device's interval_ms in the catalog, else ${PAUSE_MS}. One call ` +
      `waits at most ${MAX_WAIT_MS / 1000} s in all.`,
  );
const wakeArg = z
  .boolean()
  .optional()
  .describe(
    "Send one press first only to wake the device (some devices light their display on the first press and act on the next): " +
      "default what the catalog says of the button (devices). false while the device is still awake from a press a moment ago " +
      "(of any of its buttons, when its display wakes as a whole).",
  );
const blasterArg = z.string().max(48).optional().describe("A blaster's name in the catalog; needed only when there are several and no device is named.");

/** The whole tool surface. */
export const registerAll = (server: McpServer, deps: Deps): void => {
  server.registerTool(
    "health",
    {
      title: "Health",
      description:
        "Whether this server works: ok unless the catalog is unusable, a blaster's address answers as another device, or a blaster is " +
        "locked in the BroadLink app. A blaster without power is not a failure; it is reported as reachable: false. Call status for details.",
      inputSchema: {},
    },
    handled(async () => wire(await health(deps))),
  );

  server.registerTool(
    "status",
    {
      title: "Blaster status",
      description:
        "What each IR blaster says about itself now: online, model, MAC, the name set in the BroadLink app, firmware, and whether Lock " +
        "device is on (then nothing can be sent until someone turns it off in the app). Each blaster answers for itself; one that does " +
        "not answer says what to check. Call it before pressing anything, and when a press fails.",
      inputSchema: { blaster: blasterArg },
    },
    handled((a: { blaster?: string | undefined }) => status(deps, { blaster: a.blaster }).then(wire)),
  );

  server.registerTool(
    "devices",
    {
      title: "Devices and buttons",
      description:
        "Every device in the catalog, the blaster facing it, and its buttons: the code each sends, whether it toggles, and whether the " +
        "user approves each press (those go through press_confirmed). IR goes one way: nothing here can read whether a device is on or " +
        "off or how it is set.",
      inputSchema: {},
    },
    handled(async () => wire(await devices(deps))),
  );

  server.registerTool(
    "press",
    {
      title: "Press a button",
      description:
        "Press one of a device's buttons by name: its blaster sends the button's infrared code and this answers once the blaster " +
        "confirms. A button the catalog marks for the user's approval (one that can start heating, for example) is refused here with " +
        "needs_confirmation: use press_confirmed. A toggle flips the device, and its new state cannot be read back. Several presses " +
        "(times) are spaced by interval_ms; a button the catalog marks wake gets one press more, first, to wake the device. If the " +
        "blaster does not confirm (outcome_unknown), the code may still have gone out: check the device before pressing again.",
      inputSchema: { device: deviceArg, button: buttonArg, times: timesArg, interval_ms: intervalArg, wake: wakeArg },
    },
    handled((a: PressArgs) => press(deps, a, false).then(wire)),
  );

  server.registerTool(
    "press_confirmed",
    {
      title: "Press a button, with the user's approval",
      description:
        "The same as press, for any button, and the user approves every call before the code goes out: the way to press a button the " +
        "catalog marks for approval. Only when the user asks for that press.",
      inputSchema: { device: deviceArg, button: buttonArg, times: timesArg, interval_ms: intervalArg, wake: wakeArg },
    },
    handled((a: PressArgs) => press(deps, a, true).then(wire)),
  );

  server.registerTool(
    "send_code",
    {
      title: "Send an NEC code",
      description:
        "Send an NEC infrared code the catalog does not hold, by its address and command byte, through the blaster facing a device: for " +
        "finding the code of a button a remote lacks or whose key no longer works, by trying candidates while someone watches the device. " +
        "The device may do anything the code means to it, so the user approves each call. A code that works goes into the catalog; for a " +
        "button that works on the remote, learn is quicker.",
      inputSchema: {
        device: z.string().max(48).optional().describe("The device the code is meant for; its blaster sends it."),
        blaster: blasterArg,
        address: z.number().int().min(0).max(0xffff).describe("The NEC address: 0-255, or 256-65535 for extended NEC. A device's address is in devices."),
        command: z.number().int().min(0).max(0xff).describe("The command byte, 0-255."),
        times: timesArg,
        interval_ms: intervalArg,
      },
    },
    handled((a: SendCodeArgs) => sendCode(deps, a).then(wire)),
  );

  server.registerTool(
    "learn",
    {
      title: "Learn a remote's button",
      description:
        "Listen for one press of a remote: the blaster's LED lights while it listens; someone points the remote at it from close by and " +
        "presses ONE button once. Answers what it heard: for an NEC remote the address and command, which catalog buttons already send " +
        "it, and the entry to add to the catalog to keep it (the catalog is the only place codes are kept); for another protocol, the " +
        "measured pulses. Ask for one button per call and leave a few seconds between calls: a press while nothing listens is lost.",
      inputSchema: {
        device: z.string().max(48).optional().describe("The device whose remote it is; its blaster listens."),
        blaster: blasterArg,
        seconds: z.number().int().min(5).max(60).default(25).describe("How long to listen (5-60)."),
      },
    },
    handled((a: { device?: string | undefined; blaster?: string | undefined; seconds: number }) => learn(deps, a).then(wire)),
  );
};

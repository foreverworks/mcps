import { summaryFrom, type ToolPolicy } from "@foreverworks/mcp-kit";
import { z } from "zod";

/**
 * Every tool, classified (packages/mcp-kit, policy.ts). Nothing here moves
 * money, but an IR code acts on a device in someone's home. A button the
 * catalog marks `confirm` (one that can start heating, say) goes only through
 * `press_confirmed`, and an arbitrary code only through `send_code`: both are
 * marked for a person to approve each call, with the line they read when the
 * server asks itself (MCP_CONFIRM=elicit).
 */

const times = (n: number | undefined, interval: number | undefined): string =>
  (n ?? 1) === 1 ? "once" : `${n} times${interval === undefined ? "" : `, ${interval / 1000} s apart`}`;

const wakeFirst = (wake: boolean | undefined): string => (wake === true ? ", after one press to wake it" : wake === false ? ", without a wake press" : "");

const pressLine = summaryFrom(
  z.object({ device: z.string(), button: z.string(), times: z.number().optional(), interval_ms: z.number().optional(), wake: z.boolean().optional() }).loose(),
  (a) => `press "${a.button}" on device "${a.device}" by infrared, ${times(a.times, a.interval_ms)}${wakeFirst(a.wake)}`,
);

const hex = (n: number, width: number): string => `0x${n.toString(16).padStart(width, "0")}`;

const codeLine = summaryFrom(
  z
    .object({ device: z.string().optional(), blaster: z.string().optional(), address: z.number(), command: z.number(), times: z.number().optional(), interval_ms: z.number().optional() })
    .loose(),
  (a) =>
    `send the untested NEC code ${hex(a.address, a.address > 0xff ? 4 : 2)}/${hex(a.command, 2)} ${times(a.times, a.interval_ms)} through ${a.device === undefined ? (a.blaster === undefined ? "the blaster" : `blaster "${a.blaster}"`) : `the blaster facing "${a.device}"`}: the device may do whatever that code means to it`,
);

export const POLICY: ToolPolicy = {
  health: { access: "read" },
  status: { access: "read" },
  devices: { access: "read" },
  press: { access: "write" },
  press_confirmed: { access: "write", confirm: true, summary: pressLine },
  send_code: { access: "write", confirm: true, summary: codeLine },
  learn: { access: "write" },
};

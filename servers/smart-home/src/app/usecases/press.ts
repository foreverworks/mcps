import { compact } from "@foreverworks/mcp-kit";

import { type Blaster, blasterFor, blasterNamed, buttonNamed, buttonsSending, type Code, codeText, deviceNamed } from "../../domain/catalog.js";
import { asAppError, fail, inputError } from "../../domain/errors.js";
import { encodeNec, sameAsPlainAddress } from "../../domain/ir/nec.js";
import { encodeIrPacket, unitsOf } from "../../domain/ir/packet.js";
import { PAUSE_MS, planPresses, type PressPlan } from "../../domain/pacing.js";
import type { Deps } from "../ports.js";
import { ONE_WAY, WAKE } from "./devices.js";

/** The IR packet a code becomes, sent once. */
export const packetFor = (code: Code): Uint8Array =>
  encodeIrPacket({ durations: (code.kind === "nec" ? encodeNec(code) : code.pulses).map(unitsOf), repeat: 0 });

/** Send the planned presses, the plan's pause between each two, saying how many went out when one fails after the first. */
const sendPresses = async (deps: Deps, blaster: Blaster, packet: Uint8Array, plan: PressPlan): Promise<void> => {
  for (let i = 0; i < plan.presses; i++) {
    if (i > 0) await deps.sleep(plan.pauseMs);
    try {
      await deps.blasters.send(blaster, packet);
    } catch (thrown) {
      const known = asAppError(thrown);
      if (known === undefined || i === 0) throw thrown;
      fail({ ...known, message: `${known.message} (after ${i} of ${plan.presses} presses went out${plan.wake ? ", the first of them to wake the device" : ""})` });
    }
  }
};

/** What an answer says of the spacing: the pause, once there was more than one press. */
const spacing = (plan: PressPlan) => (plan.presses > 1 ? plan.pauseMs : undefined);

export type PressArgs = {
  readonly device: string;
  readonly button: string;
  readonly times: number;
  /** The pause between presses; the device's, else PAUSE_MS, when unset. */
  readonly interval_ms?: number | undefined;
  /** Send a wake press first; the button's catalog flag when unset. */
  readonly wake?: boolean | undefined;
};

/** `confirmed`: the call came through the tool a person approves, so a button marked confirm may go. */
export const press = async (deps: Deps, a: PressArgs, confirmed: boolean) => {
  const catalog = await deps.catalog();
  const device = deviceNamed(catalog, a.device);
  const button = buttonNamed(device, a.button);
  if (button.confirm && !confirmed) {
    fail({
      kind: "needs_confirmation",
      device: device.name,
      button: button.name,
      message: `button "${button.name}" of "${device.name}" is marked for the user to approve each press${button.note === undefined ? "" : ` (${button.note})`}; nothing was sent`,
    });
  }
  const plan = planPresses({ times: a.times, wake: a.wake ?? button.wake, pauseMs: a.interval_ms ?? device.intervalMs ?? PAUSE_MS });
  await sendPresses(deps, blasterNamed(catalog, device.blaster), packetFor(button.code), plan);
  const notes = [plan.wake ? `A wake press went out first: ${WAKE}.` : undefined, button.toggle ? ONE_WAY : undefined].filter((n) => n !== undefined);
  return compact({
    device: device.name,
    button: button.name,
    code: codeText(button.code),
    times: a.times,
    wakePress: plan.wake ? true : undefined,
    intervalMs: spacing(plan),
    sent: true as const,
    note: notes.length === 0 ? undefined : notes.join(" "),
  });
};

export type SendCodeArgs = {
  readonly device?: string | undefined;
  readonly blaster?: string | undefined;
  readonly address: number;
  readonly command: number;
  readonly times: number;
  /** The pause between presses; the named device's, else PAUSE_MS, when unset. */
  readonly interval_ms?: number | undefined;
};

/** A code the catalog does not hold, by its NEC bytes: for finding the one a remote's button lacks. */
export const sendCode = async (deps: Deps, a: SendCodeArgs) => {
  if (sameAsPlainAddress(a.address)) fail(inputError(`address 0x${a.address.toString(16)} is the plain address 0x${(a.address & 0xff).toString(16)}; send that`));
  const catalog = await deps.catalog();
  const blaster = blasterFor(catalog, a);
  const code: Code = { kind: "nec", address: a.address, command: a.command };
  const plan = planPresses({ times: a.times, wake: false, pauseMs: a.interval_ms ?? (a.device === undefined ? undefined : deviceNamed(catalog, a.device).intervalMs) ?? PAUSE_MS });
  await sendPresses(deps, blaster, packetFor(code), plan);
  const known = buttonsSending(catalog, blaster.name, code);
  return compact({
    blaster: blaster.name,
    code: codeText(code),
    times: a.times,
    intervalMs: spacing(plan),
    sent: true as const,
    knownAs: known.length === 0 ? undefined : known,
    note: "If the device did what a button should, add the button to the catalog with this command (devices lists the catalog).",
  });
};

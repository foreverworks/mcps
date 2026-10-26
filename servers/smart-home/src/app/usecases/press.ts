import { compact } from "@foreverworks/mcp-kit";

import { type Blaster, blasterFor, blasterNamed, buttonNamed, buttonsSending, type Code, codeText, deviceNamed } from "../../domain/catalog.js";
import { asAppError, fail, inputError } from "../../domain/errors.js";
import { encodeNec, sameAsPlainAddress } from "../../domain/ir/nec.js";
import { encodeIrPacket, unitsOf } from "../../domain/ir/packet.js";
import type { Deps } from "../ports.js";
import { ONE_WAY } from "./devices.js";

/** Between the presses of one call: longer than a remote's 108 ms frame period, so each reads as a new press. */
export const PAUSE_MS = 400;

/** The IR packet a code becomes, sent once. */
export const packetFor = (code: Code): Uint8Array =>
  encodeIrPacket({ durations: (code.kind === "nec" ? encodeNec(code) : code.pulses).map(unitsOf), repeat: 0 });

/** Send `times` presses, saying how many went out when one fails after the first. */
const sendTimes = async (deps: Deps, blaster: Blaster, packet: Uint8Array, times: number): Promise<void> => {
  for (let i = 0; i < times; i++) {
    if (i > 0) await deps.sleep(PAUSE_MS);
    try {
      await deps.blasters.send(blaster, packet);
    } catch (thrown) {
      const known = asAppError(thrown);
      if (known === undefined || i === 0) throw thrown;
      fail({ ...known, message: `${known.message} (after ${i} of ${times} presses went out)` });
    }
  }
};

export type PressArgs = { readonly device: string; readonly button: string; readonly times: number };

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
  await sendTimes(deps, blasterNamed(catalog, device.blaster), packetFor(button.code), a.times);
  return compact({
    device: device.name,
    button: button.name,
    code: codeText(button.code),
    times: a.times,
    sent: true as const,
    note: button.toggle ? ONE_WAY : undefined,
  });
};

export type SendCodeArgs = {
  readonly device?: string | undefined;
  readonly blaster?: string | undefined;
  readonly address: number;
  readonly command: number;
  readonly times: number;
};

/** A code the catalog does not hold, by its NEC bytes: for finding the one a remote's button lacks. */
export const sendCode = async (deps: Deps, a: SendCodeArgs) => {
  if (sameAsPlainAddress(a.address)) fail(inputError(`address 0x${a.address.toString(16)} is the plain address 0x${(a.address & 0xff).toString(16)}; send that`));
  const catalog = await deps.catalog();
  const blaster = blasterFor(catalog, a);
  const code: Code = { kind: "nec", address: a.address, command: a.command };
  await sendTimes(deps, blaster, packetFor(code), a.times);
  const known = buttonsSending(catalog, blaster.name, code);
  return compact({
    blaster: blaster.name,
    code: codeText(code),
    times: a.times,
    sent: true as const,
    knownAs: known.length === 0 ? undefined : known,
    note: "If the device did what a button should, add the button to the catalog with this command (devices lists the catalog).",
  });
};

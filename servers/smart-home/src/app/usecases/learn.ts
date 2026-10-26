import { compact } from "@foreverworks/mcp-kit";

import { blasterFor, buttonsSending, hex2 } from "../../domain/catalog.js";
import { drift, fail } from "../../domain/errors.js";
import { decodeNec } from "../../domain/ir/nec.js";
import { decodeIrPacket, microsecondsOf } from "../../domain/ir/packet.js";
import type { Deps } from "../ports.js";

export type LearnArgs = { readonly device?: string | undefined; readonly blaster?: string | undefined; readonly seconds: number };

const addressText = (address: number): string => (address > 0xff ? `0x${address.toString(16).padStart(4, "0")}` : hex2(address));

/**
 * One press of a remote, heard by the blaster, as the code it sends. Codes
 * are compared by what they decode to, never by bytes: two presses of one
 * button differ in their timing and in how long it was held.
 */
export const learn = async (deps: Deps, a: LearnArgs) => {
  const catalog = await deps.catalog();
  const blaster = blasterFor(catalog, a);
  const bytes = await deps.blasters.learn(blaster, a.seconds * 1000);
  if (bytes === undefined) {
    return fail({ kind: "nothing_learned", blaster: blaster.name, message: `blaster "${blaster.name}" heard no remote in ${a.seconds} s` });
  }
  const packet = decodeIrPacket(bytes) ?? fail(drift(`blaster "${blaster.name}" handed over ${bytes.length} bytes that are not an infrared packet`));
  const us = packet.durations.map(microsecondsOf);
  const nec = decodeNec(us);
  if (nec === undefined) {
    return {
      blaster: blaster.name,
      protocol: "not NEC" as const,
      pulses: us.length,
      keep: { name: "<button>", pulses: us },
      note: "Add keep, named, to the device's buttons in the catalog to send this code as it was heard.",
    };
  }
  const known = buttonsSending(catalog, blaster.name, nec);
  return compact({
    blaster: blaster.name,
    protocol: "NEC" as const,
    address: addressText(nec.address),
    command: hex2(nec.command),
    extended: nec.extended ? true : undefined,
    repeatCodes: nec.repeats,
    knownAs: known.length === 0 ? undefined : known,
    keep: known.length === 0 ? { name: "<button>", address: addressText(nec.address), command: hex2(nec.command) } : undefined,
    note:
      known.length === 0
        ? "Not in the catalog: add keep, named, to the device's buttons in the catalog (an address equal to the device's may be left out)."
        : "Already in the catalog as known_as.",
  });
};

import { fail, inputError } from "./errors.js";
import { sameAsPlainAddress } from "./ir/nec.js";

/**
 * What this server drives: the blasters, the devices each one faces, and
 * every device's buttons with the code each sends. The catalog is the one
 * source of truth for codes; it is read from a file on every call, so an
 * edit takes effect on the next one. Pure.
 */

export type Blaster = {
  readonly name: string;
  readonly host: string;
  /** When set, the blaster must answer with this MAC (aa:bb:cc:dd:ee:ff), so an address that moved to another device is noticed. */
  readonly mac?: string | undefined;
};

export type Code =
  | { readonly kind: "nec"; readonly address: number; readonly command: number }
  /** Any other protocol, as the microseconds a learned press measured: mark, space, mark, ... */
  | { readonly kind: "raw"; readonly pulses: readonly number[] };

export type Button = {
  readonly name: string;
  readonly code: Code;
  /** Pressing it flips the device between two states, which nothing here can read back. */
  readonly toggle: boolean;
  /** A person approves every press (it can start heating, open something, spend something). */
  readonly confirm: boolean;
  readonly note?: string | undefined;
};

export type Device = {
  readonly name: string;
  readonly title?: string | undefined;
  readonly blaster: string;
  readonly note?: string | undefined;
  readonly buttons: readonly Button[];
};

export type Catalog = { readonly blasters: readonly Blaster[]; readonly devices: readonly Device[] };

const twice = (names: readonly string[]): readonly string[] => [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];

/** What is wrong with a catalog that has the right shape, one sentence each; empty when nothing is. */
export const catalogProblems = (catalog: Catalog): readonly string[] => {
  const blasters = new Set(catalog.blasters.map((b) => b.name));
  return [
    ...twice(catalog.blasters.map((b) => b.name)).map((n) => `two blasters are named "${n}"`),
    ...twice(catalog.devices.map((d) => d.name)).map((n) => `two devices are named "${n}"`),
    ...catalog.devices.flatMap((d) => [
      ...(blasters.has(d.blaster) ? [] : [`device "${d.name}" names blaster "${d.blaster}", which the catalog does not have`]),
      ...twice(d.buttons.map((b) => b.name)).map((n) => `device "${d.name}" has two buttons named "${n}"`),
      ...d.buttons.flatMap((b) =>
        b.code.kind === "nec" && sameAsPlainAddress(b.code.address)
          ? [`device "${d.name}" button "${b.name}": address 0x${b.code.address.toString(16)} is the plain address 0x${(b.code.address & 0xff).toString(16)}; write that`]
          : [],
      ),
    ]),
  ];
};

const listed = (names: readonly string[]): string => (names.length === 0 ? "none" : names.join(", "));

const failInput = (message: string): never => fail(inputError(message));

export const deviceNamed = (catalog: Catalog, name: string): Device =>
  catalog.devices.find((d) => d.name === name) ?? failInput(`no device is named "${name}"; the devices are: ${listed(catalog.devices.map((d) => d.name))}`);

export const buttonNamed = (device: Device, name: string): Button =>
  device.buttons.find((b) => b.name === name) ?? failInput(`device "${device.name}" has no button "${name}"; its buttons are: ${listed(device.buttons.map((b) => b.name))}`);

export const blasterNamed = (catalog: Catalog, name: string): Blaster =>
  catalog.blasters.find((b) => b.name === name) ?? failInput(`no blaster is named "${name}"; the blasters are: ${listed(catalog.blasters.map((b) => b.name))}`);

/** The blaster a call means: a device's, a named one, or the only one there is. */
export const blasterFor = (catalog: Catalog, which: { readonly device?: string | undefined; readonly blaster?: string | undefined }): Blaster => {
  if (which.device !== undefined) {
    const device = deviceNamed(catalog, which.device);
    if (which.blaster !== undefined && which.blaster !== device.blaster) failInput(`device "${device.name}" is on blaster "${device.blaster}", not "${which.blaster}"`);
    return blasterNamed(catalog, device.blaster);
  }
  if (which.blaster !== undefined) return blasterNamed(catalog, which.blaster);
  const [only, ...others] = catalog.blasters;
  if (only === undefined) return failInput("the catalog has no blasters");
  return others.length === 0 ? only : failInput(`name a device or a blaster: the blasters are ${listed(catalog.blasters.map((b) => b.name))}`);
};

/** The buttons, on devices facing this blaster, that send this NEC code. */
export const buttonsSending = (catalog: Catalog, blaster: string, code: { readonly address: number; readonly command: number }) =>
  catalog.devices
    .filter((d) => d.blaster === blaster)
    .flatMap((d) =>
      d.buttons.filter((b) => b.code.kind === "nec" && b.code.address === code.address && b.code.command === code.command).map((b) => ({ device: d.name, button: b.name })),
    );

export const hex2 = (n: number): string => `0x${n.toString(16).padStart(2, "0")}`;

/** A code as a person reads it: "NEC 0x00/0x46", or "raw, 71 pulses". */
export const codeText = (code: Code): string =>
  code.kind === "nec" ? `NEC ${code.address > 0xff ? `0x${code.address.toString(16).padStart(4, "0")}` : hex2(code.address)}/${hex2(code.command)}` : `raw, ${code.pulses.length} pulses`;

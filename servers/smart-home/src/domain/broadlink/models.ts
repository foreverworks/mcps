/**
 * The BroadLink RM blasters this server knows, by the device type their
 * hello answers with, and how each frames a command. From python-broadlink
 * 0.19's table of RM types (broadlink/__init__.py), the reference every
 * open implementation of this protocol follows. Pure.
 *
 * - `plain`: the payload is the 32-bit command, then its data (RM mini 3, RM pro).
 * - `sized`: a 16-bit length comes first (RM4 family, newer RM mini 3).
 */

export type Framing = "plain" | "sized";

export type RmModel = { readonly model: string; readonly framing: Framing };

const plain = (model: string): RmModel => ({ model, framing: "plain" });
const sized = (model: string): RmModel => ({ model, framing: "sized" });

const MODELS: ReadonlyMap<number, RmModel> = new Map([
  ...[0x2737, 0x27b7, 0x27c2, 0x27c7, 0x27cc, 0x27cd, 0x27d0, 0x27d1, 0x27d3, 0x27dc, 0x27de].map((t) => [t, plain("RM mini 3")] as const),
  [0x278f, plain("RM mini")],
  ...[0x2712, 0x272a, 0x273d, 0x2787, 0x2797, 0x279d, 0x27a9, 0x27c3].map((t) => [t, plain("RM pro")] as const),
  ...[0x277c, 0x2783].map((t) => [t, plain("RM home")] as const),
  ...[0x278b, 0x27a1, 0x27a6].map((t) => [t, plain("RM plus")] as const),
  ...[0x5f36, 0x6507, 0x6508].map((t) => [t, sized("RM mini 3")] as const),
  ...[0x51da, 0x520c, 0x5216, 0x521c, 0x610e, 0x62bc, 0x648d, 0x653a].map((t) => [t, sized("RM4 mini")] as const),
  ...[0x520d, 0x6070, 0x610f, 0x62be, 0x6539].map((t) => [t, sized("RM4C mini")] as const),
  ...[0x5209, 0x5212].map((t) => [t, sized("RM4 TV mate")] as const),
  [0x5211, sized("RM4C mate")],
  [0x6364, sized("RM4S")],
  ...[0x520b, 0x5213, 0x6026, 0x61a2, 0x649b, 0x653c].map((t) => [t, sized("RM4 pro")] as const),
  ...[0x5218, 0x6184].map((t) => [t, sized("RM4C pro")] as const),
]);

/** Undefined for a device type that is not an RM blaster this server knows. */
export const rmModelOf = (devtype: number): RmModel | undefined => MODELS.get(devtype);

export const hex4 = (n: number): string => `0x${n.toString(16).padStart(4, "0")}`;

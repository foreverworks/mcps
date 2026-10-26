/**
 * The IR packet a BroadLink RM blaster sends and learns: a header, then the
 * signal as alternating mark and space durations in the blaster's own unit.
 * Pure.
 *
 *   0x00  0x26 (infrared)
 *   0x01  how many times the blaster repeats the whole signal (0: once)
 *   0x02  length of what follows, 16-bit little-endian
 *   0x04  durations: one byte each, or 0x00 then two bytes big-endian for
 *         256 units and more
 *
 * A learned packet may carry zero padding after its declared length.
 */

/**
 * The blaster's duration unit in microseconds. Measured on an RM4 mini
 * (2026-10-26) from five learned presses of an NEC remote: the 108 ms frame
 * period came back as 3478-3481 units (31.0 us each), the 13.5 ms leader as
 * 433-436 (31.0 us), and the 1125 and 2250 us bit periods as 36.8 and 72.9
 * units on average (30.6-30.9 us). 31 us is within about a percent of all of
 * them, so a generated code lands within a unit or two of what the blaster
 * records from a real remote; python-broadlink's 32.84 us is 6% long.
 */
export const UNIT_US = 31;

const INFRARED = 0x26;

export type IrPacket = {
  /** Mark, space, mark, ... in the blaster's units. */
  readonly durations: readonly number[];
  /** Extra times the blaster sends the whole signal. */
  readonly repeat: number;
};

/** Microseconds to the blaster's units: at least 1 (a 0 byte would read as the long form) and at most 65535. */
export const unitsOf = (us: number): number => Math.min(0xffff, Math.max(1, Math.round(us / UNIT_US)));

export const microsecondsOf = (units: number): number => Math.round(units * UNIT_US);

export const encodeIrPacket = (packet: IrPacket): Uint8Array => {
  const body: number[] = [];
  for (const raw of packet.durations) {
    const units = Math.min(0xffff, Math.max(1, Math.round(raw)));
    if (units < 0x100) body.push(units);
    else body.push(0x00, units >> 8, units & 0xff);
  }
  return Uint8Array.from([INFRARED, packet.repeat & 0xff, body.length & 0xff, body.length >> 8, ...body]);
};

/** Undefined when the bytes are not an infrared packet (an RF capture, or damage). */
export const decodeIrPacket = (bytes: Uint8Array): IrPacket | undefined => {
  if (bytes.length < 4 || bytes[0] !== INFRARED) return undefined;
  const declared = (bytes[2] ?? 0) | ((bytes[3] ?? 0) << 8);
  const end = Math.min(4 + declared, bytes.length);
  const durations: number[] = [];
  for (let i = 4; i < end; ) {
    const first = bytes[i] ?? 0;
    if (first !== 0) {
      durations.push(first);
      i += 1;
      continue;
    }
    if (i + 2 >= end) break; // trailing padding, or a long form cut short
    durations.push(((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0));
    i += 3;
  }
  return durations.length === 0 ? undefined : { durations, repeat: bytes[1] ?? 0 };
};

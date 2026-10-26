/**
 * The NEC infrared protocol, the one most cheap remotes speak. Pure.
 *
 * A frame is a 9 ms mark and a 4.5 ms space, then 32 bits sent least
 * significant first, each a 562.5 us mark and a space of 562.5 us (0) or
 * 1687.5 us (1), then a closing mark. The bytes are the address, its
 * inverse, the command and its inverse; extended NEC spends the second byte
 * on a 16-bit address instead. While the button is held, a repeat code (a
 * 9 ms mark, a 2.25 ms space and a closing mark) follows every 108 ms.
 */

export type NecCode = {
  /** 0-255, or 256-65535 for extended NEC (its low byte goes first). */
  readonly address: number;
  /** 0-255. */
  readonly command: number;
};

const LEADER_MARK = 9000;
const LEADER_SPACE = 4500;
const REPEAT_SPACE = 2250;
const BIT_MARK = 562.5;
const ZERO_SPACE = 562.5;
const ONE_SPACE = 1687.5;
const FRAME_PERIOD = 108_000;

const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0);

const bytesOf = (code: NecCode): readonly number[] => {
  const command = code.command & 0xff;
  return code.address > 0xff
    ? [code.address & 0xff, (code.address >> 8) & 0xff, command, ~command & 0xff]
    : [code.address & 0xff, ~code.address & 0xff, command, ~command & 0xff];
};

/** The bytes of an extended address whose high byte is its low byte's inverse are a plain address's: the same signal. */
export const sameAsPlainAddress = (address: number): boolean => address > 0xff && ((address >> 8) & 0xff) === (~address & 0xff);

/**
 * One press as microseconds, mark first, ending with the silence after it:
 * the frame, then `repeats` repeat codes. A person's quickest press holds
 * the button past the first 108 ms, so a remote sends at least one repeat
 * code; one is the default here because that is what a real press looks
 * like to the receiver.
 */
export const encodeNec = (code: NecCode, repeats = 1): readonly number[] => {
  const frame: number[] = [LEADER_MARK, LEADER_SPACE];
  for (const byte of bytesOf(code)) {
    for (let bit = 0; bit < 8; bit++) frame.push(BIT_MARK, (byte >> bit) & 1 ? ONE_SPACE : ZERO_SPACE);
  }
  frame.push(BIT_MARK);
  const out = [...frame, FRAME_PERIOD - sum(frame)];
  for (let i = 0; i < repeats; i++) {
    const repeat = [LEADER_MARK, REPEAT_SPACE, BIT_MARK];
    out.push(...repeat, FRAME_PERIOD - sum(repeat));
  }
  return out;
};

export type DecodedNec = NecCode & {
  /** The 16-bit address form: the second byte is not the first one's inverse. */
  readonly extended: boolean;
  /** Repeat codes after the frame: how long the button was held, in 108 ms steps. */
  readonly repeats: number;
};

/** Within a quarter of the nominal length, as NEC receivers allow. */
const near = (actual: number | undefined, nominal: number): boolean => actual !== undefined && Math.abs(actual - nominal) <= nominal / 4;

/**
 * The NEC code in a signal of microseconds (mark first), or undefined when
 * it is not one: another protocol, a frame cut short, or a command byte
 * whose inverse does not match.
 */
export const decodeNec = (us: readonly number[]): DecodedNec | undefined => {
  const start = us.findIndex((d, i) => i % 2 === 0 && near(d, LEADER_MARK) && near(us[i + 1], LEADER_SPACE));
  if (start < 0) return undefined;
  const bytes = [0, 0, 0, 0];
  for (let bit = 0; bit < 32; bit++) {
    const mark = us[start + 2 + bit * 2];
    const space = us[start + 3 + bit * 2];
    if (mark === undefined || space === undefined || mark < BIT_MARK / 2 || mark > BIT_MARK * 2) return undefined;
    if (space > ONE_SPACE * 1.5) return undefined;
    const one = space > (ZERO_SPACE + ONE_SPACE) / 2;
    if (one) bytes[bit >> 3] = (bytes[bit >> 3] ?? 0) | (1 << (bit & 7));
  }
  const closing = us[start + 66];
  if (closing === undefined || closing < BIT_MARK / 2 || closing > BIT_MARK * 2) return undefined;
  const [a0 = 0, a1 = 0, command = 0, inverse = 0] = bytes;
  if ((command ^ inverse) !== 0xff) return undefined;
  const extended = (a0 ^ a1) !== 0xff;
  let repeats = 0;
  for (let i = start + 68; i < us.length; i += 4) {
    if (!(near(us[i], LEADER_MARK) && near(us[i + 1], REPEAT_SPACE) && (us[i + 2] ?? 0) > BIT_MARK / 2)) break;
    repeats += 1;
  }
  return { address: extended ? a0 | (a1 << 8) : a0, command, extended, repeats };
};

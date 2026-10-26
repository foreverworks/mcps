import type { Framing } from "./models.js";

/**
 * BroadLink's local protocol, as python-broadlink 0.19 speaks it
 * (broadlink/device.py and remote.py): every message is one UDP datagram to
 * the device's port 80. Pure: the cipher is handed in, so nothing here does
 * I/O.
 *
 * A hello (48 bytes, unencrypted) gets the device's type, MAC, name and lock
 * flag back. Everything else is a 56-byte header followed by a payload
 * encrypted with AES-128-CBC under a fixed IV: first an auth request under
 * the protocol's public default key, whose answer holds a session id and a
 * session key, then commands under that key. Every multi-byte field is
 * little-endian.
 */

export const PORT = 80;

const fromHex = (hex: string): Uint8Array => Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16));

/** The key every device accepts for the auth request, published with the protocol. */
export const DEFAULT_KEY = fromHex("097628343fe99e23765c1513accf8b02");
export const IV = fromHex("562e17996d093d28ddb3ba695a2e6f58");

/** AES-128-CBC under IV, no padding: the caller pads to 16 bytes. */
export type Cipher = {
  readonly encrypt: (key: Uint8Array, plain: Uint8Array) => Uint8Array;
  readonly decrypt: (key: Uint8Array, data: Uint8Array) => Uint8Array;
};

const u16 = (b: Uint8Array, at: number): number => (b[at] ?? 0) | ((b[at + 1] ?? 0) << 8);
const u32 = (b: Uint8Array, at: number): number => (u16(b, at) | (u16(b, at + 2) << 16)) >>> 0;
const put16 = (b: Uint8Array, at: number, v: number): void => {
  b[at] = v & 0xff;
  b[at + 1] = (v >> 8) & 0xff;
};
const put32 = (b: Uint8Array, at: number, v: number): void => {
  put16(b, at, v & 0xffff);
  put16(b, at + 2, (v >>> 16) & 0xffff);
};

/** The protocol's checksum: 0xBEAF plus every byte, to 16 bits. */
export const checksum = (bytes: Uint8Array): number => bytes.reduce((sum, b) => sum + b, 0xbeaf) & 0xffff;

// ---- hello ------------------------------------------------------------------------------------------

const HELLO = 0x06;

/**
 * The hello, with the time as python-broadlink packs it (here in UTC, offset
 * 0) and no address to answer to, so the device answers the datagram's
 * source.
 */
export const helloPacket = (now: Date): Uint8Array => {
  const p = new Uint8Array(0x30);
  put32(p, 0x08, 0);
  put16(p, 0x0c, now.getUTCFullYear());
  p[0x0e] = now.getUTCMinutes();
  p[0x0f] = now.getUTCHours();
  p[0x10] = now.getUTCFullYear() % 100;
  p[0x11] = now.getUTCDay() === 0 ? 7 : now.getUTCDay();
  p[0x12] = now.getUTCDate();
  p[0x13] = now.getUTCMonth() + 1;
  p[0x26] = HELLO;
  put16(p, 0x20, checksum(p));
  return p;
};

export type Hello = {
  readonly devtype: number;
  /** As printed on the device: aa:bb:cc:dd:ee:ff. */
  readonly mac: string;
  readonly name: string;
  /** Lock device is on in the vendor's app: the device refuses sessions. */
  readonly locked: boolean;
};

export const macText = (bytes: Uint8Array): string => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join(":");

/** A hello answer, or undefined for a datagram that is not one. */
export const parseHello = (reply: Uint8Array): Hello | undefined => {
  if (reply.length < 0x80) return undefined;
  const nameBytes = reply.subarray(0x40, 0x7f);
  const end = nameBytes.indexOf(0);
  return {
    devtype: u16(reply, 0x34),
    mac: macText(reply.slice(0x3a, 0x40).reverse()),
    name: new TextDecoder().decode(end < 0 ? nameBytes : nameBytes.subarray(0, end)),
    locked: reply[0x7f] !== 0,
  };
};

// ---- encrypted messages -----------------------------------------------------------------------------

export const AUTH = 0x65;
export const COMMAND = 0x6a;

/** Who the messages are for, and the key they are under: the default key with id 0 until auth answers. */
export type Session = {
  readonly devtype: number;
  /** Six bytes, in the order printed on the device. */
  readonly mac: Uint8Array;
  readonly id: number;
  readonly key: Uint8Array;
};

/** Each message carries a count, kept in 0x8000-0xffff. */
export const nextCount = (count: number): number => ((count + 1) | 0x8000) & 0xffff;

export const encryptedPacket = (session: Session, count: number, type: number, payload: Uint8Array, cipher: Cipher): Uint8Array => {
  const padded = new Uint8Array(Math.ceil(payload.length / 16) * 16);
  padded.set(payload);
  const body = cipher.encrypt(session.key, padded);
  const p = new Uint8Array(0x38 + body.length);
  p.set([0x5a, 0xa5, 0xaa, 0x55, 0x5a, 0xa5, 0xaa, 0x55], 0);
  put16(p, 0x24, session.devtype);
  put16(p, 0x26, type);
  put16(p, 0x28, count);
  p.set(session.mac.slice().reverse(), 0x2a);
  put32(p, 0x30, session.id);
  put16(p, 0x34, checksum(payload));
  p.set(body, 0x38);
  put16(p, 0x20, checksum(p));
  return p;
};

export type Reply = {
  /** 0, or the device's error code (broadlink/exceptions.py): -1 authentication failed, -10 nothing to read, ... */
  readonly error: number;
  readonly count: number;
  readonly body: Uint8Array;
};

/** An answer to an encrypted message, or undefined for a datagram that is not one (too short, or its checksum is wrong). */
export const parseReply = (reply: Uint8Array): Reply | undefined => {
  if (reply.length < 0x30) return undefined;
  const sum = (checksum(reply) - (reply[0x20] ?? 0) - (reply[0x21] ?? 0)) & 0xffff;
  if (sum !== u16(reply, 0x20)) return undefined;
  const raw = u16(reply, 0x22);
  return { error: raw >= 0x8000 ? raw - 0x10000 : raw, count: u16(reply, 0x28), body: reply.subarray(0x38) };
};

/** The auth request's payload: python-broadlink's, field for field. */
export const authPayload = (): Uint8Array => {
  const p = new Uint8Array(0x50);
  p.fill(0x31, 0x04, 0x14);
  p[0x1e] = 0x01;
  p[0x2d] = 0x01;
  p.set(new TextEncoder().encode("Test 1"), 0x30);
  return p;
};

/** The session the auth answer grants, decrypted; undefined when it is too short to hold one. */
export const parseAuth = (plain: Uint8Array): { readonly id: number; readonly key: Uint8Array } | undefined =>
  plain.length < 0x14 ? undefined : { id: u32(plain, 0), key: plain.slice(0x04, 0x14) };

/** The firmware version request, and its answer. */
export const FIRMWARE_REQUEST = Uint8Array.of(0x68);
export const parseFirmware = (plain: Uint8Array): number | undefined => (plain.length < 6 ? undefined : u16(plain, 4));

// ---- RM blasters ------------------------------------------------------------------------------------

/** The RM commands this server uses. */
export const RM = { send: 0x02, learn: 0x03, captured: 0x04 } as const;

/** Errors check_data answers while no code has arrived yet: read error, storage error. */
export const NOTHING_YET: ReadonlySet<number> = new Set([-10, -5]);

export const AUTH_FAILED = -1;

export const rmPayload = (framing: Framing, command: number, data: Uint8Array = new Uint8Array()): Uint8Array => {
  const head = framing === "sized" ? 6 : 4;
  const p = new Uint8Array(head + data.length);
  if (framing === "sized") put16(p, 0, data.length + 4);
  put32(p, head - 4, command);
  p.set(data, head);
  return p;
};

/** What an RM command answered, from the decrypted body. */
export const rmResult = (framing: Framing, plain: Uint8Array): Uint8Array =>
  framing === "sized" ? plain.subarray(6, Math.min(plain.length, u16(plain, 0) + 2)) : plain.subarray(4);

const ERROR_TEXT: Readonly<Record<number, string>> = {
  [-1]: "authentication failed",
  [-2]: "the session was closed",
  [-3]: "the device is offline",
  [-4]: "command not supported",
  [-5]: "storage error",
  [-6]: "malformed request",
  [-7]: "the session key expired",
  [-8]: "send error",
  [-9]: "write error",
  [-10]: "read error",
};

export const errorText = (code: number): string => ERROR_TEXT[code] ?? `error ${code}`;

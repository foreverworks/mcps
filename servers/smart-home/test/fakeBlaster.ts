/**
 * An RM4 mini as the server meets it on the network, answering the way the
 * real one does (measured 2026-10-26): a hello answer of 128 bytes, auth and
 * commands echoing the request's count, "storage error" (-5) or "read error"
 * (-10) to a check while nothing has been learned, and -1 to auth while Lock
 * device is on in the vendor's app.
 */
import * as P from "../src/domain/broadlink/protocol.js";
import { aes } from "../src/infra/cipher.js";
import type { Exchange } from "../src/infra/udp.js";

export type FakeBlaster = {
  host: string;
  mac: string;
  devtype: number;
  name: string;
  firmware: number;
  /** Answers nothing at all: no power. */
  online: boolean;
  /** The hello's lock flag. */
  locked: boolean;
  /** Auth answers -1 though the hello's flag is clear (as after re-locking in the app). */
  refuseAuth: boolean;
  /** Takes an IR code and never answers. */
  silentOnSend: boolean;
  /** A remote pressed at the given check since learning first started; heard only while a window is open. */
  press?: { readonly afterChecks: number; readonly packet: Uint8Array } | undefined;
  learning: boolean;
  checks: number;
  /** Checks since the window opened: it closes after 25, a second each, as an RM4 mini's does after about 25 s. */
  windowChecks: number;
  sent: Uint8Array[];
  datagrams: number;
};

export const fakeBlaster = (overrides: Partial<FakeBlaster> = {}): FakeBlaster => ({
  host: "192.0.2.10",
  mac: "02:00:00:00:00:01",
  devtype: 0x520c,
  name: "Living room",
  firmware: 1234,
  online: true,
  locked: false,
  refuseAuth: false,
  silentOnSend: false,
  learning: false,
  checks: 0,
  windowChecks: 0,
  sent: [],
  datagrams: 0,
  ...overrides,
});

const SESSION_KEY = Uint8Array.from({ length: 16 }, (_, i) => 0xa0 + i);
const SESSION_ID = 0x2a;

const u16 = (b: Uint8Array, at: number): number => (b[at] ?? 0) | ((b[at + 1] ?? 0) << 8);
const le16 = (v: number): number[] => [v & 0xff, (v >> 8) & 0xff];
const le32 = (v: number): number[] => [...le16(v & 0xffff), ...le16((v >>> 16) & 0xffff)];
const pad16 = (b: readonly number[]): Uint8Array => {
  const out = new Uint8Array(Math.ceil(b.length / 16) * 16 || 16);
  out.set(b);
  return out;
};

const reply = (request: Uint8Array, error: number, body: Uint8Array | undefined, key: Uint8Array): Uint8Array => {
  const encrypted = body === undefined ? new Uint8Array() : aes.encrypt(key, body);
  const r = new Uint8Array(0x38 + encrypted.length);
  r.set(request.subarray(0, 8));
  r.set(le16(error & 0xffff), 0x22);
  r.set(request.subarray(0x24, 0x30), 0x24);
  r.set(encrypted, 0x38);
  r.set(le16(P.checksum(r)), 0x20);
  return r;
};

const helloAnswer = (d: FakeBlaster): Uint8Array => {
  const a = new Uint8Array(0x80);
  a.set(le16(d.devtype), 0x34);
  a.set(d.mac.split(":").map((b) => parseInt(b, 16)).reverse(), 0x3a);
  a.set(new TextEncoder().encode(d.name), 0x40);
  a[0x7f] = d.locked ? 1 : 0;
  return a;
};

const answer = (d: FakeBlaster, request: Uint8Array): Uint8Array | undefined => {
  if (request.length === 0x30 && request[0x26] === 0x06) return helloAnswer(d);
  const type = u16(request, 0x26);
  if (type === P.AUTH) {
    if (d.refuseAuth || d.locked) return reply(request, -1, undefined, P.DEFAULT_KEY);
    return reply(request, 0, pad16([...le32(SESSION_ID), ...SESSION_KEY]), P.DEFAULT_KEY);
  }
  const plain = aes.decrypt(SESSION_KEY, request.subarray(0x38));
  if (plain[0] === 0x68) return reply(request, 0, pad16([0, 0, 0, 0, ...le16(d.firmware)]), SESSION_KEY);
  const command = u16(plain, 2);
  const data = plain.subarray(6, u16(plain, 0) + 2);
  if (command === P.RM.send) {
    d.sent.push(data.slice());
    return d.silentOnSend ? undefined : reply(request, 0, pad16([...le16(4), ...le32(P.RM.send)]), SESSION_KEY);
  }
  if (command === P.RM.learn) {
    d.learning = true;
    d.windowChecks = 0;
    return reply(request, 0, pad16([...le16(4), ...le32(P.RM.learn)]), SESSION_KEY);
  }
  if (command === P.RM.captured) {
    d.checks += 1;
    d.windowChecks += 1;
    if (d.windowChecks > 25) d.learning = false;
    if (!d.learning || d.press === undefined || d.checks !== d.press.afterChecks) return reply(request, d.checks % 2 === 0 ? -5 : -10, undefined, SESSION_KEY);
    d.learning = false;
    return reply(request, 0, pad16([...le16(d.press.packet.length + 4), ...le32(P.RM.captured), ...d.press.packet]), SESSION_KEY);
  }
  return reply(request, -4, undefined, SESSION_KEY);
};

/** The network as the server sees it, with these blasters on it. */
export const fakeNetwork =
  (blasters: readonly FakeBlaster[]): Exchange =>
  async (to, packet, plan) => {
    const d = blasters.find((b) => b.host === to.host);
    if (d === undefined || !d.online || to.port !== P.PORT) return { why: `no answer from ${to.host} in ${(plan.waitMs * plan.attempts) / 1000} s` };
    for (let attempt = 0; attempt < plan.attempts; attempt++) {
      d.datagrams += 1;
      const r = answer(d, packet);
      if (r !== undefined && plan.accept(r)) return { reply: r };
    }
    return { why: `no answer from ${to.host} in ${(plan.waitMs * plan.attempts) / 1000} s` };
  };
